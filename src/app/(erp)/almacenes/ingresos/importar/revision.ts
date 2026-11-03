/**
 * ============================================================================
 *  IMPORTAR INGRESOS · de texto del Excel a un ingreso, y su revisión
 * ============================================================================
 *  Lo que llega del Excel es texto: «01 · 4 X 7 KG · Pota · Filete»,
 *  «Freeko», «27/10/2026». Aquí se hace el «match» que pidió Oliver: cada
 *  texto se busca en lo que existe en el sistema (productos, bodegas,
 *  cámaras, plantas, líneas) y se convierte en el ingreso que pediría el
 *  formulario. Después se le aplican las MISMAS reglas del formulario
 *  (registro.ts, revisarIngreso), más una que solo existe en un archivo: que
 *  el código de pallet no se repita dentro del propio archivo.
 *
 *  Cada error se dice en palabras y se pega a SU columna, para que la
 *  pantalla de revisión pueda marcar la celda exacta que hay que corregir.
 *
 *  Este archivo no es una acción del servidor: lo llaman las acciones de
 *  importación, que ya autorizaron.
 * ============================================================================
 */
import { normalizarTexto, leerNumero, leerFecha } from '@/lib/importacionExcel';
import { hoyEnLima } from '@/lib/fechas';
import type { DatosIngreso } from '../tipos';
import { cargarContexto, revisarIngreso, normalizarCodigo, type ClienteBase, type ContextoIngreso } from '../registro';
import { COLUMNA_DE_CAMPO, type ErrorColumna, type EstadoFila } from './columnas';

/* ==========================================================================
   EL CATÁLOGO: lo que existe, con el texto con que se muestra en la plantilla
   ========================================================================== */
export type ProductoCatalogo = {
  id: number; etiqueta: string; codigo: string; presentacion: string; especie: string; corte: string; kg_bulto: number;
  /** placas o túnel: distingue dos presentaciones con la misma descripción. */
  congelamiento: string;
  /** La clasificación del producto en su base (FILETE, LAMINADO, ALETAS…) = formatos.nombre. */
  formato: string;
  /** El nombre con que lo ven en su base: «CLASIFICACIÓN-CORTE X PESO BULTO», p. ej. «FILETE-"B" 0-500 X 20 KG». */
  nombre_base: string;
};
export type BodegaCatalogo = {
  id: number; nombre: string; codigo: string; activo: boolean; recibe_produccion: boolean; recibe_compras: boolean;
};
export type CatalogoIngresos = {
  productos: ProductoCatalogo[];
  bodegas: BodegaCatalogo[];
  camaras: { id: number; nombre: string; almacen_id: number }[];
  plantas: { id: number; nombre: string }[];
  lineas: { id: number; nombre: string }[];
};

/** «01 · 4 X 7 KG · Pota · Filete»: código, presentación, especie y corte. */
export const etiquetaProducto = (codigo: string, presentacion: string, especie: string, corte: string) =>
  [codigo, presentacion, especie, corte].filter(Boolean).join(' · ');

const TEXTO_CONGELAMIENTO: Record<string, string> = { placas: 'Placas', tunel: 'Túnel' };

/** Kilos sin ceros de más: 20 → «20», 22.5 → «22.5», 6.25 → «6.25». */
const kgTexto = (n: number) => String(Math.round(n * 1000) / 1000);

/**
 * El nombre que usan en su base (la columna OPERACIÓN INGRESO de su Excel):
 * «CLASIFICACIÓN-CORTE X PESO BULTO», p. ej. «FILETE-"B" 0-500 X 20 KG».
 * CLASIFICACIÓN-CORTE es su FULL_TEXT; su CLASIFICACIÓN es nuestro formato.
 */
export const nombreEnSuBase = (formato: string, corte: string, kgBulto: number) =>
  formato && corte && kgBulto > 0 ? `${formato}-${corte} X ${kgTexto(kgBulto)} KG` : '';

/** Para comparar nombres de su base: sin tildes, mayúsculas ni espacios (sus textos traen espacios dobles o de más). */
const claveNombre = (t: string) => normalizarTexto(t).replace(/\s/g, '');

/** «FILETE-"B" 0-500 X 20 KG» → { texto: 'FILETE-"B" 0-500', kg: 20 }, o null si no tiene esa forma. */
function partirNombreBase(t: string): { texto: string; kg: number } | null {
  //  «KG», «KGS» o «KS» (así viene escrito alguna vez en su base).
  const x = /^(.+?)\s*X\s*(\d+(?:[.,]\d+)?)\s*K(?:G|S)S?\.?$/i.exec(String(t ?? '').trim());
  if (!x) return null;
  const kg = Number(x[2].replace(',', '.'));
  return kg > 0 ? { texto: x[1].trim(), kg } : null;
}

/**
 * Los nombres de su base que apuntan a UNA sola presentación: esos van en la
 * lista desplegable. Los que apuntan a varias (mismo producto y mismo peso
 * por bulto, p. ej. «4 X 5 KG» y «2 X 10 KG», o placas y túnel) no van: el
 * importador los acepta igual y, si no puede decidir, lo dice y propone las
 * opciones.
 */
export function nombresBaseUnicos(productos: ProductoCatalogo[]): Map<string, ProductoCatalogo> {
  const grupos = new Map<string, ProductoCatalogo[]>();
  for (const p of productos) {
    if (!p.nombre_base) continue;
    const k = claveNombre(p.nombre_base);
    grupos.set(k, [...(grupos.get(k) ?? []), p]);
  }
  const unicos = new Map<string, ProductoCatalogo>();
  for (const lista of grupos.values()) if (lista.length === 1) unicos.set(lista[0].nombre_base, lista[0]);
  return unicos;
}

export async function cargarCatalogoIngresos(supabase: ClienteBase): Promise<CatalogoIngresos> {
  const [{ data: unidades }, { data: bodegas }, { data: camaras }, { data: plantas }, { data: lineas }] = await Promise.all([
    supabase
      .from('sku_presentaciones')
      .select('id, activo, skus(codigo, corte, activo, especies(nombre), formatos(nombre)), presentaciones(descripcion, peso_bulto_kg, congelamiento)')
      .eq('activo', true)
      .limit(1000),
    supabase.from('almacenes').select('id, nombre, codigo, activo, recibe_produccion, recibe_compras').order('nombre'),
    supabase.from('camaras').select('id, nombre, almacen_id').eq('activo', true).order('nombre'),
    supabase.from('plantas').select('id, nombre').eq('activo', true).order('nombre'),
    supabase.from('lineas_procesadoras').select('id, nombre').eq('activo', true).order('nombre'),
  ]);

  type Fila = Record<string, unknown>;
  const uno = (x: unknown): Fila | null => ((Array.isArray(x) ? x[0] : x) ?? null) as Fila | null;
  const productos: ProductoCatalogo[] = [];
  for (const u of unidades ?? []) {
    const sku = uno(u.skus);
    if (!sku?.activo) continue;
    const pres = uno(u.presentaciones);
    const esp = uno(sku.especies);
    const codigo = String(sku.codigo ?? '');
    const presentacion = String(pres?.descripcion ?? '');
    const especie = String(esp?.nombre ?? '');
    const corte = String(sku.corte ?? '');
    const formato = String(uno(sku.formatos)?.nombre ?? '');
    const kg = Number(pres?.peso_bulto_kg ?? 0);
    productos.push({
      id: Number(u.id), codigo, presentacion, especie, corte, formato,
      congelamiento: String(pres?.congelamiento ?? ''),
      etiqueta: etiquetaProducto(codigo, presentacion, especie, corte),
      kg_bulto: kg,
      nombre_base: nombreEnSuBase(formato, corte, kg),
    });
  }
  productos.sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }) || a.presentacion.localeCompare(b.presentacion, 'es')
    || a.congelamiento.localeCompare(b.congelamiento));

  /* Dos presentaciones del mismo SKU con la misma descripción («2 X 10 KG»)
     solo se distinguen por el congelamiento: a esas se les agrega al final
     («… · Túnel»), para que cada texto de la lista sea UN solo producto. */
  const repetidas = new Map<string, number>();
  for (const p of productos) repetidas.set(p.etiqueta, (repetidas.get(p.etiqueta) ?? 0) + 1);
  for (const p of productos) {
    if ((repetidas.get(p.etiqueta) ?? 0) > 1 && p.congelamiento) {
      p.etiqueta = `${p.etiqueta} · ${TEXTO_CONGELAMIENTO[p.congelamiento] ?? p.congelamiento}`;
    }
  }

  return {
    productos,
    bodegas: (bodegas ?? []).map((b) => ({
      id: Number(b.id), nombre: String(b.nombre), codigo: String(b.codigo), activo: Boolean(b.activo),
      recibe_produccion: Boolean(b.recibe_produccion), recibe_compras: Boolean(b.recibe_compras),
    })),
    camaras: (camaras ?? []).map((c) => ({ id: Number(c.id), nombre: String(c.nombre), almacen_id: Number(c.almacen_id) })),
    plantas: (plantas ?? []).map((p) => ({ id: Number(p.id), nombre: String(p.nombre) })),
    lineas: (lineas ?? []).map((l) => ({ id: Number(l.id), nombre: String(l.nombre) })),
  };
}

/* ==========================================================================
   EL MATCH: de un texto a lo que existe
   ========================================================================== */
const sinCeros = (c: string) => c.replace(/^0+(?=\d)/, '');

/**
 * Por el nombre de su base: «FILETE-"B" 0-500 X 20 KG» → su CLASIFICACIÓN-CORTE
 * (formato y corte del SKU) más el peso del bulto (la presentación). null si
 * el texto no es un nombre de su base que exista.
 */
/** «Placas» / «Túnel» (o vacío) como en la base: 'placas' | 'tunel' | ''. */
const leerCongelamiento = (t: string) => {
  const x = normalizarTexto(t);
  return /^plac/.test(x) ? 'placas' : /^tun/.test(x) ? 'tunel' : '';
};

/** Si con el congelamiento escrito queda una sola opción, esa. */
function porCongelamiento(candidatos: ProductoCatalogo[], congelamiento: string): ProductoCatalogo | null {
  const c = leerCongelamiento(congelamiento);
  if (!c) return null;
  const con = candidatos.filter((p) => p.congelamiento === c);
  return con.length === 1 ? con[0] : null;
}

function buscarPorNombreBase(texto: string, cat: CatalogoIngresos, congelamiento = ''): { id: number } | { error: string } | null {
  const partes = partirNombreBase(texto);
  if (!partes) return null;
  const clave = claveNombre(partes.texto);
  const delProducto = cat.productos.filter((p) => p.formato && claveNombre(`${p.formato}-${p.corte}`) === clave);
  if (!delProducto.length) return null;
  const conPeso = delProducto.filter((p) => Math.abs(p.kg_bulto - partes.kg) < 0.0005);
  if (conPeso.length === 1) return { id: conPeso[0].id };
  const elegido = porCongelamiento(conPeso, congelamiento);
  if (elegido) return { id: elegido.id };
  if (conPeso.length === 0) {
    const pesos = [...new Set(delProducto.map((p) => `${kgTexto(p.kg_bulto)} kg (${p.presentacion})`))];
    return {
      error: `«${texto}» es el producto ${delProducto[0].codigo} (${partes.texto}), pero no tiene una presentación de ${kgTexto(partes.kg)} kg por bulto: ` +
        `tiene ${pesos.join(', ')}. Corrija el peso del bulto o elija el producto de la lista.`,
    };
  }
  //  El congelamiento se dice solo si es lo que las distingue (y la etiqueta no lo trae ya).
  const difiereCong = conPeso.some((p) => p.congelamiento !== conPeso[0].congelamiento);
  const cong = (p: ProductoCatalogo) => {
    const t = TEXTO_CONGELAMIENTO[p.congelamiento] ?? p.congelamiento;
    return difiereCong && t && !p.etiqueta.endsWith(t) ? ` (${t})` : '';
  };
  return {
    error: `«${texto}» puede ser ${conPeso.length} presentaciones del producto ${conPeso[0].codigo} con ${kgTexto(partes.kg)} kg por bulto: ` +
      `${conPeso.map((p) => `«${p.etiqueta}»${cong(p)}`).join(' o ')}. ` +
      'Escriba en «Producto» una de esas opciones (están en la lista desplegable)' +
      (difiereCong ? ', o agregue la columna «Tipo de congelamiento» (Placas o Túnel).' : '.'),
  };
}

function buscarProducto(texto: string, cat: CatalogoIngresos, congelamiento = ''): { id: number } | { error: string } {
  const t = normalizarTexto(texto);
  if (!t) return { error: 'Falta el producto.' };

  const exacto = cat.productos.find((p) => normalizarTexto(p.etiqueta) === t);
  if (exacto) return { id: exacto.id };

  //  El nombre con que lo ven en su base («FILETE-"B" 0-500 X 20 KG»): así
  //  pueden pegar su tabla tal cual.
  const porNombre = buscarPorNombreBase(texto, cat, congelamiento);
  if (porNombre) return porNombre;

  //  «01 · 4 X 7 KG …»: el código del SKU y la presentación bastan.
  const partes = t.split(' · ').map((x) => x.trim());
  const codigo = sinCeros(partes[0] ?? '');
  const delSku = cat.productos.filter((p) => sinCeros(normalizarTexto(p.codigo)) === codigo);
  if (delSku.length === 0) {
    return {
      error: `No existe el producto «${texto}». Elíjalo de la lista desplegable o copie el texto exacto de la hoja «Listas» (columna Producto).`,
    };
  }
  let candidatos = delSku;
  if (partes[1]) {
    const pres = normalizarTexto(partes[1]).replace(/\s/g, '');
    const conPres = delSku.filter((p) => normalizarTexto(p.presentacion).replace(/\s/g, '') === pres);
    if (conPres.length === 1) return { id: conPres[0].id };
    //  Misma descripción en placas y en túnel: se ofrecen solo esas.
    if (conPres.length > 1) candidatos = conPres;
  }
  if (delSku.length === 1) return { id: delSku[0].id };
  const elegido = porCongelamiento(candidatos, congelamiento);
  if (elegido) return { id: elegido.id };
  return {
    error: `El SKU ${delSku[0].codigo} tiene ${candidatos.length} presentaciones posibles (${candidatos.map((p) => `«${p.etiqueta}»`).join(', ')}): ` +
      'indique cuál, eligiendo el producto de la lista.',
  };
}

function buscarBodega(texto: string, cat: CatalogoIngresos): { id: number } | { error: string } {
  const t = normalizarTexto(texto);
  if (!t) return { error: 'Falta la bodega.' };
  const b = cat.bodegas.find((x) => normalizarTexto(x.nombre) === t || normalizarTexto(x.codigo) === t);
  if (b) return { id: b.id };
  return { error: `No existe la bodega «${texto}». Elíjala de la lista (hoja «Listas»).` };
}

function buscarCamara(texto: string, almacenId: number, cat: CatalogoIngresos): { id: number | null } | { error: string } {
  const t = normalizarTexto(texto);
  if (!t) return { id: null };
  const deLaBodega = cat.camaras.find((c) => c.almacen_id === almacenId && normalizarTexto(c.nombre) === t);
  if (deLaBodega) return { id: deLaBodega.id };
  //  Existe, pero en otra bodega: se devuelve igual y la regla común lo dice
  //  («La Cámara 01 es de la bodega …, no de la elegida»).
  const otra = cat.camaras.find((c) => normalizarTexto(c.nombre) === t);
  if (otra) return { id: otra.id };
  return { error: `No existe la cámara «${texto}». Déjela vacía o elíjala de la lista.` };
}

function buscarNombre(texto: string, lista: { id: number; nombre: string }[], que: string): { id: number | null } | { error: string } {
  const t = normalizarTexto(texto);
  if (!t) return { id: null };
  const x = lista.find((l) => normalizarTexto(l.nombre) === t);
  return x ? { id: x.id } : { error: `No existe la ${que} «${texto}». Déjela vacía o elíjala de la lista.` };
}

/* ==========================================================================
   UNA FILA → UN INGRESO
   ========================================================================== */
export type FilaInterpretada = {
  datos: DatosIngreso;
  /** Si la fila es un ingreso programado, cuándo llega. */
  fechaLlegada: string | null;
  errores: ErrorColumna[];
};

export function interpretarFila(v: Record<string, string>, cat: CatalogoIngresos, hoy: string): FilaInterpretada {
  const errores: ErrorColumna[] = [];
  const mal = (columna: string, mensaje: string) => errores.push({ columna, mensaje });

  const producto = buscarProducto(v.producto ?? '', cat, v.congelamiento ?? '');
  if ('error' in producto && v.producto?.trim()) mal('producto', producto.error);

  const o = normalizarTexto(v.origen);
  const origen: DatosIngreso['origen_ingreso'] =
    /^produc/.test(o) ? 'produccion' : /^compr/.test(o) ? 'compras' : '';
  if (o && !origen) mal('origen', `«${v.origen}» no es un origen: escriba Producción o Compras.`);

  const bodega = buscarBodega(v.bodega ?? '', cat);
  if ('error' in bodega && v.bodega?.trim()) mal('bodega', bodega.error);
  const almacenId = 'id' in bodega ? bodega.id : 0;

  const camara = buscarCamara(v.camara ?? '', almacenId, cat);
  if ('error' in camara) mal('camara', camara.error);

  const bultos = v.bultos?.trim() ? leerNumero(v.bultos) : 0;
  if (v.bultos?.trim() && Number.isNaN(bultos)) mal('bultos', `«${v.bultos}» no es un número.`);

  let peso = v.peso_kg?.trim() ? leerNumero(v.peso_kg) : 0;
  if (v.peso_kg?.trim() && Number.isNaN(peso)) mal('peso_kg', `«${v.peso_kg}» no es un número.`);
  if (!v.peso_kg?.trim() && v.kg_bulto?.trim()) {
    const kb = leerNumero(v.kg_bulto);
    if (Number.isNaN(kb)) mal('kg_bulto', `«${v.kg_bulto}» no es un número.`);
    else peso = Math.round((bultos || 0) * kb * 1000) / 1000;
  }

  const fecha = leerFecha(v.fecha_produccion ?? '');
  if (v.fecha_produccion?.trim() && !fecha) {
    mal('fecha_produccion', `«${v.fecha_produccion}» no es una fecha: escríbala como DD/MM/AAAA.`);
  }

  const t = normalizarTexto(v.turno);
  const turno: DatosIngreso['turno'] = !t || /^d/.test(t) ? 'dia' : /^n/.test(t) ? 'noche' : 'dia';
  if (t && !/^(d|n)/.test(t)) mal('turno', `«${v.turno}» no es un turno: escriba Día o Noche.`);

  const pr = normalizarTexto(v.proceso);
  const proceso: DatosIngreso['proceso'] = /maquila/.test(pr) ? 'maquila' : 'propia';
  if (pr && !/maquila|propia|produccion/.test(pr)) mal('proceso', `«${v.proceso}» no es un proceso: escriba Producción propia o Maquila.`);

  const planta = buscarNombre(v.planta ?? '', cat.plantas, 'planta');
  if ('error' in planta) mal('planta', planta.error);
  const linea = buscarNombre(v.linea ?? '', cat.lineas, 'línea procesadora');
  if ('error' in linea) mal('linea', linea.error.replace('No existe la línea procesadora', 'No existe la línea'));

  const costo = v.costo?.trim() ? leerNumero(v.costo) : 0;
  if (v.costo?.trim() && Number.isNaN(costo)) mal('costo', `«${v.costo}» no es un número.`);

  let fechaLlegada: string | null = null;
  if (v.llega_el?.trim()) {
    const f = leerFecha(v.llega_el);
    if (!f) mal('llega_el', `«${v.llega_el}» no es una fecha: escríbala como DD/MM/AAAA.`);
    //  Solo una fecha FUTURA lo vuelve programado: si ya llegó, entra al stock.
    else if (f > hoy) fechaLlegada = f;
  }

  if ((v.observaciones ?? '').length > 200) mal('observaciones', 'Las observaciones pasan de 200 caracteres: acórtelas.');

  const datos: DatosIngreso = {
    codigo_pallet: normalizarCodigo(v.codigo_pallet ?? ''),
    sku_presentacion_id: 'id' in producto ? producto.id : 0,
    almacen_id: almacenId,
    camara_id: 'id' in camara ? camara.id : null,
    fecha_produccion: fecha ?? '',
    turno,
    proceso,
    planta_id: 'id' in planta ? planta.id : null,
    linea_procesadora_id: 'id' in linea ? linea.id : null,
    bultos: Number.isNaN(bultos) ? 0 : bultos,
    peso_neto_kg: Number.isNaN(peso) ? 0 : peso,
    costo_unitario: Number.isNaN(costo) ? 0 : costo,
    observaciones: v.observaciones?.trim() || null,
    origen_ingreso: origen,
    proveedor: v.proveedor?.trim() || null,
  };

  return { datos, fechaLlegada, errores };
}

/**
 * La revisión completa de una fila: lo que no se pudo interpretar, más lo que
 * dicen las reglas comunes del ingreso. Una columna que ya tiene un error de
 * interpretación no repite el de la regla («No existe el producto X» basta;
 * no hace falta además «Elija qué producto entró»).
 */
export function revisarFila(f: FilaInterpretada, ctx: ContextoIngreso): ErrorColumna[] {
  const errores = [...f.errores];
  const ya = new Set(errores.map((e) => e.columna));
  for (const p of revisarIngreso(f.datos, ctx, { fechaLlegada: f.fechaLlegada })) {
    const columna = COLUMNA_DE_CAMPO[p.campo] ?? p.campo;
    if (!ya.has(columna)) { errores.push({ columna, mensaje: p.mensaje }); ya.add(columna); }
  }
  return errores;
}

/* ==========================================================================
   REVISAR UNA IMPORTACIÓN ENTERA
   --------------------------------------------------------------------------
   Se vuelve a revisar todo cada vez que se corrige o se descarta una fila:
   corregir el código de una fila puede hacer que choque con otra, o que deje
   de chocar. Es barato: el catálogo y los códigos se piden una vez.
   ========================================================================== */
export type FilaGuardada = {
  id: number; importacion_id: number; fila: number; datos: Record<string, string>;
  errores: ErrorColumna[]; estado: EstadoFila; resultado: string | null;
};

/** Estados que todavía se pueden revisar: lo registrado o descartado ya no cambia. */
const REVISABLES: EstadoFila[] = ['valida', 'con_error'];

export function revisarConjunto(
  filas: FilaGuardada[],
  cat: CatalogoIngresos,
  ctx: ContextoIngreso,
  forzar: Set<number> = new Set()
): FilaGuardada[] {
  /* Duplicados dentro del archivo: manda la primera aparición (por número de
     fila) entre las que siguen en juego. */
  const primera = new Map<string, number>();
  const enJuego = filas
    .filter((f) => f.estado !== 'descartada' && f.estado !== 'fallida')
    .sort((a, b) => a.fila - b.fila);
  for (const f of enJuego) {
    const c = normalizarCodigo(f.datos.codigo_pallet ?? '');
    if (c && !primera.has(c)) primera.set(c, f.fila);
  }

  const cambiadas: FilaGuardada[] = [];
  for (const f of filas) {
    if (!REVISABLES.includes(f.estado) && !forzar.has(f.id)) continue;
    const interp = interpretarFila(f.datos, cat, ctx.hoy);
    const errores = revisarFila(interp, ctx);
    const c = normalizarCodigo(f.datos.codigo_pallet ?? '');
    const pri = primera.get(c);
    if (c && pri !== undefined && pri !== f.fila && !errores.some((e) => e.columna === 'codigo_pallet')) {
      errores.unshift({ columna: 'codigo_pallet', mensaje: `El pallet ${c} ya aparece en la fila ${pri} de este archivo: cada pallet va una sola vez.` });
    }
    const estado: EstadoFila = errores.length ? 'con_error' : 'valida';
    if (estado !== f.estado || JSON.stringify(errores) !== JSON.stringify(f.errores) || forzar.has(f.id)) {
      cambiadas.push({ ...f, errores, estado, resultado: forzar.has(f.id) ? null : f.resultado });
    }
  }
  return cambiadas;
}

/** Lee las filas de una importación y las vuelve a revisar; guarda lo que cambió. */
export async function revisarImportacion(
  supabase: ClienteBase,
  importacionId: number,
  forzar: Set<number> = new Set()
): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  const { data: filas, error } = await supabase
    .from('importaciones_excel_filas')
    .select('id, importacion_id, fila, datos, errores, estado, resultado')
    .eq('importacion_id', importacionId)
    .order('fila');
  if (error) return { ok: false, mensaje: 'No se pudieron leer las filas de la importación.' };

  const lista = (filas ?? []) as unknown as FilaGuardada[];
  const cat = await cargarCatalogoIngresos(supabase);
  const ctx = await contextoDeFilas(supabase, lista, cat);
  const cambiadas = revisarConjunto(lista, cat, ctx, forzar);
  if (cambiadas.length) {
    const { error: e2 } = await supabase.from('importaciones_excel_filas').upsert(
      cambiadas.map((f) => ({
        id: f.id, importacion_id: f.importacion_id, fila: f.fila, datos: f.datos,
        errores: f.errores, estado: f.estado, resultado: f.resultado, actualizado_en: new Date().toISOString(),
      }))
    );
    if (e2) return { ok: false, mensaje: 'No se pudo guardar la revisión de las filas. Vuelva a intentarlo.' };
  }
  return { ok: true };
}

/** El contexto de las reglas para un conjunto de filas (sus códigos y productos). */
export async function contextoDeFilas(supabase: ClienteBase, filas: { datos: Record<string, string> }[], cat: CatalogoIngresos) {
  const hoy = hoyEnLima();
  const codigos = filas.map((f) => normalizarCodigo(f.datos.codigo_pallet ?? ''));
  const skus = filas.map((f) => {
    const p = buscarProducto(f.datos.producto ?? '', cat, f.datos.congelamiento ?? '');
    return 'id' in p ? p.id : 0;
  });
  return cargarContexto(supabase, codigos, skus, hoy);
}
