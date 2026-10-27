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

export async function cargarCatalogoIngresos(supabase: ClienteBase): Promise<CatalogoIngresos> {
  const [{ data: unidades }, { data: bodegas }, { data: camaras }, { data: plantas }, { data: lineas }] = await Promise.all([
    supabase
      .from('sku_presentaciones')
      .select('id, activo, skus(codigo, corte, activo, especies(nombre)), presentaciones(descripcion, peso_bulto_kg)')
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
    productos.push({
      id: Number(u.id), codigo, presentacion, especie, corte,
      etiqueta: etiquetaProducto(codigo, presentacion, especie, corte),
      kg_bulto: Number(pres?.peso_bulto_kg ?? 0),
    });
  }
  productos.sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }) || a.presentacion.localeCompare(b.presentacion, 'es'));

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

function buscarProducto(texto: string, cat: CatalogoIngresos): { id: number } | { error: string } {
  const t = normalizarTexto(texto);
  if (!t) return { error: 'Falta el producto.' };

  const exacto = cat.productos.find((p) => normalizarTexto(p.etiqueta) === t);
  if (exacto) return { id: exacto.id };

  //  «01 · 4 X 7 KG …»: el código del SKU y la presentación bastan.
  const partes = t.split(' · ').map((x) => x.trim());
  const codigo = sinCeros(partes[0] ?? '');
  const delSku = cat.productos.filter((p) => sinCeros(normalizarTexto(p.codigo)) === codigo);
  if (delSku.length === 0) {
    return {
      error: `No existe el producto «${texto}». Elíjalo de la lista desplegable o copie el texto exacto de la hoja «Listas» (columna Producto).`,
    };
  }
  if (partes[1]) {
    const pres = normalizarTexto(partes[1]).replace(/\s/g, '');
    const conPres = delSku.filter((p) => normalizarTexto(p.presentacion).replace(/\s/g, '') === pres);
    if (conPres.length === 1) return { id: conPres[0].id };
  }
  if (delSku.length === 1) return { id: delSku[0].id };
  return {
    error: `El SKU ${delSku[0].codigo} tiene ${delSku.length} presentaciones (${delSku.map((p) => p.presentacion).join(', ')}): ` +
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

  const producto = buscarProducto(v.producto ?? '', cat);
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
    const p = buscarProducto(f.datos.producto ?? '', cat);
    return 'id' in p ? p.id : 0;
  });
  return cargarContexto(supabase, codigos, skus, hoy);
}
