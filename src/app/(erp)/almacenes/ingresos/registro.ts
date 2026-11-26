/**
 * ============================================================================
 *  LAS REGLAS DE UN INGRESO A CÁMARA · una sola vez, para todos los caminos
 * ============================================================================
 *  Un pallet entra a cámara por tres caminos:
 *
 *    1. El formulario «Registrar ingreso», de uno en uno.
 *    2. La importación desde Excel (Stock › Ingresos › Importar desde Excel).
 *    3. La confirmación de llegada de un ingreso programado.
 *
 *  Los tres tienen que exigir exactamente lo mismo: si la importación dejara
 *  pasar algo que el formulario rechaza, el Excel se convertiría en la puerta
 *  trasera del inventario. Por eso las reglas viven aquí, una sola vez, y los
 *  tres caminos las llaman:
 *
 *    cargarContexto()  trae de una vez lo que hace falta consultar (bodegas,
 *                      cámaras, productos, códigos ya usados). Para un pallet
 *                      son cuatro consultas; para trescientas filas, también.
 *    revisarIngreso()  dice TODO lo que está mal de un ingreso, campo por
 *                      campo (el formulario muestra el primero; la
 *                      importación, todos).
 *    crearIngreso()    da de alta el lote y escribe su movimiento en el Kardex.
 *
 *  Este archivo no es una acción del servidor ('use server'): sus funciones
 *  reciben el cliente y el usuario ya autorizados, y no deben poder llamarse
 *  desde el navegador. Las acciones (acciones.ts, accionesImportar.ts,
 *  accionesProgramados.ts) autorizan y después llaman aquí.
 *
 *  La base sostiene además lo más importante por su cuenta (074): un
 *  movimiento de ingreso en una bodega que no recibe ese origen se rechaza
 *  aunque alguien se salte esta capa.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import type { crearClienteServidor } from '@/lib/supabase/servidor';
import { traducirErrorBase } from '@/lib/mensajesBase';
import { NOMBRE_ORIGEN, PUEDEN_INGRESAR, type DatosIngreso } from './tipos';

export type ClienteBase = Awaited<ReturnType<typeof crearClienteServidor>>;

export type Problema = { campo: string; mensaje: string };

export type ResultadoIngreso =
  | { ok: true; id: number; codigo: string; mensaje: string }
  | { ok: false; mensaje: string; campo?: string };

type Bodega = { id: number; nombre: string; activo: boolean; recibe_produccion: boolean; recibe_compras: boolean };

export type ContextoIngreso = {
  hoy: string;
  bodegas: Map<number, Bodega>;
  camaras: Map<number, { id: number; almacen_id: number; nombre: string }>;
  /** Presentaciones activas (de un SKU activo) entre las pedidas. */
  productos: Set<number>;
  /** Cómo se lee cada presentación pedida: «169 · 2 X 10 KG · PLACAS». */
  nombres: Map<number, string>;
  /** Códigos de pallet que ya existen como lote. */
  existentes: Set<string>;
  /** Códigos que esperan como ingreso programado, con su fecha de llegada. */
  programados: Map<string, { id: number; fecha_llegada: string }>;
  /** Pallets con stock que una fila puede completar (092): por su código y por su número sin prefijo. */
  enCamara: PalletEnCamara[];
};

/** Un pallet que ya está en cámara (con stock) y al que se le pueden sumar bultos. */
export type PalletEnCamara = {
  lote_id: number; codigo: string; sku_presentacion_id: number; fecha_produccion: string;
  bultos: number; kg: number; donde: string;
  /** El producto con que está en cámara, para decirlo si la fila trae otro. */
  producto: string;
};

/** «169 · 2 X 10 KG · PLACAS», de una fila de sku_presentaciones con sus skus y presentaciones. */
function nombreProducto(sp: unknown): string {
  const uno = <T,>(x: T | T[] | null | undefined) => (Array.isArray(x) ? x[0] : x) ?? null;
  const p = uno(sp as Record<string, unknown> | Record<string, unknown>[] | null);
  const sku = uno(p?.skus as { codigo?: string } | null);
  const pres = uno(p?.presentaciones as { descripcion?: string; congelamiento?: string } | null);
  return [sku?.codigo, pres?.descripcion, pres?.congelamiento?.toUpperCase()].filter(Boolean).join(' · ');
}

/** El código de pallet como se guarda: sin espacios en los extremos y en mayúsculas. */
export const normalizarCodigo = (c: string) => String(c ?? '').trim().toUpperCase();

/**
 * «FL J23 26 32945» → «J23 26 32945»: el pallet sin su prefijo de producto.
 * En su base el mismo pallet aparece a veces con otro prefijo (NU/FL) en una
 * de sus partes; el número, el día y el año no cambian. null si el código no
 * tiene esa forma (menos de tres partes).
 */
export const palletSinPrefijo = (c: string) => {
  const t = normalizarCodigo(c).split(/\s+/);
  return t.length >= 3 ? t.slice(1).join(' ') : null;
};

/**
 * Dany (24/11): un pallet se arma en más de un día. Si la fila trae un pallet
 * que YA está en cámara con el mismo producto, sus bultos lo completan: no es
 * un pallet repetido. Primero por el código exacto; si no, por el número sin
 * prefijo, cuando hay uno solo del mismo producto (así una parte escrita «FL»
 * no crea un segundo pallet al lado del «NU»). null si no hay que completar.
 */
export function palletACompletar(d: DatosIngreso, ctx: ContextoIngreso): PalletEnCamara | null {
  const codigo = normalizarCodigo(d.codigo_pallet);
  const sku = Number(d.sku_presentacion_id);
  if (!codigo || !sku) return null;
  const exacto = ctx.enCamara.filter((p) => p.codigo === codigo);
  if (exacto.length) return exacto.find((p) => p.sku_presentacion_id === sku) ?? null;
  //  Un código que ya existe (aunque sin stock) no se cambia por otro.
  if (ctx.existentes.has(codigo)) return null;
  const resto = palletSinPrefijo(codigo);
  if (!resto) return null;
  const mismo = ctx.enCamara.filter((p) => p.sku_presentacion_id === sku && palletSinPrefijo(p.codigo) === resto);
  return mismo.length === 1 ? mismo[0] : null;
}

const fechaDMA = (iso: string) => iso.split('-').reverse().join('/');

/** Trozos para no armar una URL kilométrica con trescientos códigos. */
function trozos<T>(lista: T[], n = 150): T[][] {
  const r: T[][] = [];
  for (let i = 0; i < lista.length; i += n) r.push(lista.slice(i, i + n));
  return r;
}

/** Trae de una vez todo lo que las reglas necesitan consultar. */
export async function cargarContexto(
  supabase: ClienteBase,
  codigos: string[],
  skuIds: number[],
  hoy: string
): Promise<ContextoIngreso> {
  const unicos = [...new Set(codigos.map(normalizarCodigo).filter(Boolean))];
  const ids = [...new Set(skuIds.filter((x) => Number(x) > 0))];

  const restos = [...new Set(unicos.map(palletSinPrefijo).filter((x): x is string => Boolean(x)))];
  const enRegex = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');

  const [{ data: bodegas }, { data: camaras }, [productos, nombres], existentes, programados, enCamara] = await Promise.all([
    supabase.from('almacenes').select('id, nombre, activo, recibe_produccion, recibe_compras'),
    supabase.from('camaras').select('id, almacen_id, nombre').eq('activo', true),
    (async () => {
      const set = new Set<number>();
      const nombres = new Map<number, string>();
      for (const t of trozos(ids)) {
        const { data } = await supabase.from('sku_presentaciones')
          .select('id, activo, skus(activo, codigo), presentaciones(descripcion, congelamiento)').in('id', t);
        for (const p of data ?? []) {
          const sku = Array.isArray(p.skus) ? p.skus[0] : p.skus;
          if (p.activo && (sku as { activo?: boolean } | null)?.activo) set.add(Number(p.id));
          nombres.set(Number(p.id), nombreProducto(p));
        }
      }
      return [set, nombres] as const;
    })(),
    (async () => {
      const set = new Set<string>();
      for (const t of trozos(unicos)) {
        const { data } = await supabase.from('lotes').select('codigo_pallet').in('codigo_pallet', t);
        for (const l of data ?? []) set.add(normalizarCodigo(String(l.codigo_pallet)));
      }
      return set;
    })(),
    (async () => {
      const mapa = new Map<string, { id: number; fecha_llegada: string }>();
      for (const t of trozos(unicos)) {
        const { data } = await supabase.from('ingresos_programados')
          .select('id, codigo_pallet, fecha_llegada').eq('estado', 'programado').in('codigo_pallet', t);
        for (const p of data ?? []) {
          mapa.set(normalizarCodigo(String(p.codigo_pallet)), { id: Number(p.id), fecha_llegada: String(p.fecha_llegada) });
        }
      }
      return mapa;
    })(),
    (async () => {
      //  Los lotes con ese código, o con ese número y otro prefijo, y su stock.
      const lotes = new Map<number, { codigo: string; sku: number; fecha: string; producto: string }>();
      const guardar = (data: Record<string, unknown>[] | null) => {
        for (const l of data ?? []) {
          lotes.set(Number(l.id), {
            codigo: normalizarCodigo(String(l.codigo_pallet)), sku: Number(l.sku_presentacion_id), fecha: String(l.fecha_produccion),
            producto: nombreProducto(l.sku_presentaciones),
          });
        }
      };
      const columnas = 'id, codigo_pallet, sku_presentacion_id, fecha_produccion, sku_presentaciones(skus(codigo), presentaciones(descripcion, congelamiento))';
      for (const t of trozos(unicos)) {
        const { data } = await supabase.from('lotes').select(columnas).in('codigo_pallet', t);
        guardar(data);
      }
      for (const t of trozos(restos, 60)) {
        const { data } = await supabase.from('lotes').select(columnas)
          .filter('codigo_pallet', 'match', `^\\S+\\s+(${t.map(enRegex).join('|')})$`);
        guardar(data);
      }
      const porLote = new Map<number, PalletEnCamara>();
      for (const t of trozos([...lotes.keys()])) {
        const { data } = await supabase.from('existencias').select('lote_id, bultos, peso_neto_kg, almacenes(nombre)').in('lote_id', t).gt('bultos', 0);
        for (const e of data ?? []) {
          const id = Number(e.lote_id);
          const l = lotes.get(id)!;
          const a = Array.isArray(e.almacenes) ? e.almacenes[0] : e.almacenes;
          const p = porLote.get(id) ?? {
            lote_id: id, codigo: l.codigo, sku_presentacion_id: l.sku, fecha_produccion: l.fecha, bultos: 0, kg: 0, donde: '', producto: l.producto,
          };
          p.bultos += Number(e.bultos);
          p.kg += Number(e.peso_neto_kg);
          p.donde = [p.donde, (a as { nombre?: string } | null)?.nombre ?? '?'].filter(Boolean).join(', ');
          porLote.set(id, p);
        }
      }
      return [...porLote.values()];
    })(),
  ]);

  return {
    hoy,
    bodegas: new Map((bodegas ?? []).map((b) => [Number(b.id), {
      id: Number(b.id), nombre: String(b.nombre), activo: Boolean(b.activo),
      recibe_produccion: Boolean(b.recibe_produccion), recibe_compras: Boolean(b.recibe_compras),
    }])),
    camaras: new Map((camaras ?? []).map((c) => [Number(c.id), { id: Number(c.id), almacen_id: Number(c.almacen_id), nombre: String(c.nombre) }])),
    productos,
    nombres,
    existentes,
    programados,
    enCamara,
  };
}

/**
 * Por qué una bodega no recibe un ingreso de este origen, o null si lo recibe.
 * Dice lo mismo que la función de la base (almacen_rechaza_ingreso, 074).
 */
export function motivoBodega(ctx: ContextoIngreso, almacenId: number, origen: string): string | null {
  const b = ctx.bodegas.get(Number(almacenId));
  if (!b) return 'Esa bodega no existe.';
  if (!b.activo) return `La bodega ${b.nombre} está desactivada y no recibe ingresos.`;
  if (origen !== 'produccion' && origen !== 'compras') return null;
  if (origen === 'produccion' ? b.recibe_produccion : b.recibe_compras) return null;
  const que = NOMBRE_ORIGEN[origen];
  const admiten = [...ctx.bodegas.values()]
    .filter((x) => x.activo && (origen === 'produccion' ? x.recibe_produccion : x.recibe_compras))
    .map((x) => x.nombre).sort((a, z) => a.localeCompare(z, 'es'));
  return `La bodega ${b.nombre} no recibe ingresos de ${que}. Los ingresos de ${que} entran por: ` +
    `${admiten.join(', ') || 'ninguna bodega (no hay ninguna habilitada)'}. Si esta bodega también debe recibirlos, ` +
    'Gerencia u Operaciones lo habilita en Configuración › Maestros › Almacenes.';
}

/**
 * TODO lo que está mal de un ingreso, en el orden en que se lee el
 * formulario. Lista vacía: se puede registrar.
 *
 * `programado`: el ingreso todavía no llega; se valida igual (el pallet, el
 * producto, la bodega y las cantidades tienen que estar bien desde ya) y
 * además su fecha de llegada tiene que ser futura.
 */
export function revisarIngreso(
  d: DatosIngreso,
  ctx: ContextoIngreso,
  opciones: { fechaLlegada?: string | null } = {}
): Problema[] {
  const p: Problema[] = [];
  const codigo = normalizarCodigo(d.codigo_pallet);

  if (!codigo) {
    p.push({ campo: 'codigo_pallet', mensaje: 'El pallet necesita un código: es su matrícula para toda la trazabilidad.' });
  } else if (codigo.length > 30) {
    p.push({ campo: 'codigo_pallet', mensaje: 'El código de pallet es demasiado largo (máximo 30 caracteres).' });
  }

  if (!d.sku_presentacion_id) p.push({ campo: 'sku_presentacion_id', mensaje: 'Elija qué producto entró.' });
  else if (!ctx.productos.has(Number(d.sku_presentacion_id))) {
    p.push({ campo: 'sku_presentacion_id', mensaje: 'Ese producto no existe o está desactivado en el catálogo.' });
  }

  if (d.origen_ingreso !== 'produccion' && d.origen_ingreso !== 'compras') {
    p.push({ campo: 'origen_ingreso', mensaje: 'Indique el origen del ingreso: Producción o Compras.' });
  }
  if (d.origen_ingreso === 'compras' && !d.proveedor?.trim()) {
    p.push({ campo: 'proveedor', mensaje: 'Un ingreso por compra necesita el proveedor: es a quien se reclama si sale mal.' });
  }

  if (!d.almacen_id) p.push({ campo: 'almacen_id', mensaje: 'Elija a qué bodega entró.' });
  else {
    const motivo = motivoBodega(ctx, d.almacen_id, d.origen_ingreso);
    if (motivo) p.push({ campo: 'almacen_id', mensaje: motivo });
  }

  if (!d.fecha_produccion) p.push({ campo: 'fecha_produccion', mensaje: 'Falta la fecha de producción.' });
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fecha_produccion) || Number.isNaN(Date.parse(d.fecha_produccion))) {
    p.push({ campo: 'fecha_produccion', mensaje: 'La fecha de producción no es una fecha válida.' });
  } else if (d.fecha_produccion > ctx.hoy) {
    /*
     * Una fecha futura casi siempre es un dedazo en el año, y trae
     * consecuencias caras: el anticuamiento sale negativo y el producto nunca
     * entra en alerta de vida útil.
     */
    p.push({ campo: 'fecha_produccion', mensaje: `La fecha de producción no puede ser futura: hoy es ${fechaDMA(ctx.hoy)}.` });
  }

  if (opciones.fechaLlegada !== undefined && opciones.fechaLlegada !== null && opciones.fechaLlegada <= ctx.hoy) {
    p.push({ campo: 'fecha_llegada', mensaje: 'Un ingreso programado tiene que llegar en una fecha futura.' });
  }

  if (!(d.bultos > 0)) p.push({ campo: 'bultos', mensaje: 'Los bultos tienen que ser más de cero.' });
  else if (!Number.isInteger(d.bultos)) p.push({ campo: 'bultos', mensaje: 'Los bultos van en números enteros.' });
  if (!(d.peso_neto_kg > 0)) p.push({ campo: 'peso_neto_kg', mensaje: 'El peso neto tiene que ser mayor que cero.' });
  if (d.costo_unitario < 0) p.push({ campo: 'costo_unitario', mensaje: 'El costo no puede ser negativo.' });

  /* ---- El código no puede estar repetido ----
     Ni como lote, ni esperando como ingreso programado: es la matrícula del
     producto, y dos iguales harían imposible saber cuál es cuál si hubiera un
     reclamo. */
  if (codigo && ctx.existentes.has(codigo)) {
    p.push({
      campo: 'codigo_pallet',
      mensaje: `Ya existe un pallet con el código ${codigo}. El código es la matrícula del producto: ` +
        'dos iguales harían imposible saber cuál es cuál si hubiera un reclamo.',
    });
  } else if (codigo && ctx.programados.has(codigo)) {
    p.push({
      campo: 'codigo_pallet',
      mensaje: `El pallet ${codigo} ya está programado para llegar el ${fechaDMA(ctx.programados.get(codigo)!.fecha_llegada)}. ` +
        'Confirme su llegada en Stock › Ingresos › Ingresos programados en vez de registrarlo otra vez.',
    });
  }

  /* ---- La cámara tiene que ser de esa bodega ---- */
  if (d.camara_id) {
    const cam = ctx.camaras.get(Number(d.camara_id));
    if (!cam || cam.almacen_id !== Number(d.almacen_id)) {
      const de = cam ? ctx.bodegas.get(cam.almacen_id)?.nombre : null;
      p.push({
        campo: 'camara_id',
        mensaje: cam && de ? `La ${cam.nombre} es de la bodega ${de}, no de la elegida.` : 'Esa cámara no pertenece a la bodega elegida.',
      });
    }
  }

  return p;
}

/** Todo lo que cambia cuando entra un pallet. */
export function refrescarIngresos() {
  revalidatePath('/almacenes/ingresos');
  revalidatePath('/almacenes/ingresos/programados');
  revalidatePath('/almacenes/movimientos');
  revalidatePath('/almacenes/kardex');
  revalidatePath('/almacenes/existencias');
  revalidatePath('/almacenes/valorizado');
  revalidatePath('/almacenes/anticuamiento');
  revalidatePath('/ventas/disponibilidad');
  revalidatePath('/panel');
}

/* ==========================================================================
   DAR DE ALTA EL PALLET
   --------------------------------------------------------------------------
   Se hacen dos cosas, en este orden:

     1. Se crea el LOTE: qué producto es, de qué día, de qué turno y de qué
        línea salió, cuántos bultos y cuánto pesan.
     2. Se escribe un MOVIMIENTO de tipo «ingreso» en el Kardex.

   El segundo paso es el que mueve el inventario. Un disparador de la base de
   datos toma ese movimiento y actualiza las existencias, y de paso recalcula
   el costo promedio móvil de la bodega. Nosotros no tocamos existencias a
   mano: si lo hiciéramos, el Kardex y el stock podrían decir cosas distintas.

   Se llama DESPUÉS de revisarIngreso(): aquí no se vuelve a validar.
   ========================================================================== */
export async function crearIngreso(
  supabase: ClienteBase,
  usuarioId: string,
  d: DatosIngreso,
  extra: { documento?: string } = {}
): Promise<ResultadoIngreso> {
  const codigo = normalizarCodigo(d.codigo_pallet);

  /* La campaña se deduce del año de producción: es como se agrupa la
     temporada en los reportes, y pedirla a mano solo daría ocasión de
     equivocarse. */
  const campania = Number(d.fecha_produccion.slice(0, 4));

  const { data: lote, error: errorLote } = await supabase
    .from('lotes')
    .insert({
      codigo_pallet: codigo,
      campania,
      sku_presentacion_id: d.sku_presentacion_id,
      fecha_produccion: d.fecha_produccion,
      turno: d.turno,
      proceso: d.proceso,
      planta_id: d.planta_id,
      linea_procesadora_id: d.linea_procesadora_id,
      bultos_iniciales: d.bultos,
      peso_neto_inicial_kg: d.peso_neto_kg,
      //  Solo cuenta si el producto no tiene costo cargado: si lo tiene, la
      //  base pone el que rige hoy y descarta este (057, lotes_costo_de_ingreso).
      costo_unitario: d.costo_unitario,
      observaciones: d.observaciones?.trim() || null,
      creado_por: usuarioId,
    })
    .select('id, costo_unitario, costo_origen')
    .single();

  if (errorLote || !lote) {
    return { ok: false, mensaje: traducirErrorBase(errorLote, { que: 'crear el pallet', quien: PUEDEN_INGRESAR }) };
  }

  /* Si el movimiento fallara, quedaría un lote fantasma: existiría en la
     tabla pero con cero stock, sin Kardex y sin explicación. Se deshace el
     lote para no dejar ese cadáver en la base. */
  const { error: errorMov } = await supabase.from('movimientos').insert({
    tipo: 'ingreso',
    lote_id: lote.id,
    almacen_id: d.almacen_id,
    camara_id: d.camara_id,
    bultos: d.bultos,
    peso_neto_kg: d.peso_neto_kg,
    //  El del LOTE, no el del formulario: el Kardex tiene que valorizar el
    //  pallet con el mismo costo con el que quedó registrado.
    costo_unitario: Number(lote.costo_unitario),
    documento_tipo: 'ingreso',
    documento_ref: `ING-${String(lote.id).padStart(6, '0')}`,
    usuario_id: usuarioId,
    observaciones: d.observaciones?.trim() || null,
    origen_ingreso: d.origen_ingreso,
    proveedor: d.origen_ingreso === 'compras' ? d.proveedor?.trim() || null : null,
  });

  if (errorMov) {
    await supabase.from('lotes').delete().eq('id', lote.id);
    return { ok: false, mensaje: traducirErrorBase(errorMov, { que: 'registrar el movimiento del ingreso', quien: PUEDEN_INGRESAR }) };
  }

  const kg = d.peso_neto_kg.toLocaleString('es-PE', { maximumFractionDigits: 1 });
  await supabase.rpc('registrar_evento', {
    p_entidad: 'lotes',
    p_entidad_id: lote.id,
    p_tipo: 'ingreso_registrado',
    p_descripcion:
      `Ingreso del pallet ${codigo}: ${d.bultos} bultos, ${kg} kg, producidos el ${d.fecha_produccion}` +
      (extra.documento ? ` (${extra.documento})` : ''),
    p_severidad: 'info',
    p_metadatos: { pallet: codigo, bultos: d.bultos, kg: d.peso_neto_kg, almacen_id: d.almacen_id },
  }).then(() => undefined, () => undefined);

  return {
    ok: true,
    id: lote.id as number,
    codigo,
    mensaje: `Pallet ${codigo} ingresado: ${d.bultos} bultos y ${kg} kg ya están disponibles para vender.`,
  };
}

/**
 * Deja un ingreso PROGRAMADO: no crea lote ni mueve stock. Se llama después
 * de revisarIngreso(d, ctx, { fechaLlegada }).
 */
export async function crearProgramado(
  supabase: ClienteBase,
  usuarioId: string,
  d: DatosIngreso,
  fechaLlegada: string,
  importacionId: number | null
): Promise<{ ok: true; id: number; mensaje: string } | { ok: false; mensaje: string }> {
  const codigo = normalizarCodigo(d.codigo_pallet);
  const { data, error } = await supabase
    .from('ingresos_programados')
    .insert({
      codigo_pallet: codigo,
      sku_presentacion_id: d.sku_presentacion_id,
      almacen_id: d.almacen_id,
      camara_id: d.camara_id,
      fecha_llegada: fechaLlegada,
      fecha_produccion: d.fecha_produccion,
      turno: d.turno,
      proceso: d.proceso,
      planta_id: d.planta_id,
      linea_procesadora_id: d.linea_procesadora_id,
      bultos: d.bultos,
      peso_neto_kg: d.peso_neto_kg,
      costo_unitario: d.costo_unitario,
      origen_ingreso: d.origen_ingreso,
      proveedor: d.origen_ingreso === 'compras' ? d.proveedor?.trim() || null : null,
      observaciones: d.observaciones?.trim() || null,
      importacion_id: importacionId,
      creado_por: usuarioId,
    })
    .select('id')
    .single();

  if (error || !data) {
    return { ok: false, mensaje: traducirErrorBase(error, { que: 'programar el ingreso', quien: PUEDEN_INGRESAR }) };
  }

  await supabase.rpc('registrar_evento', {
    p_entidad: 'ingresos_programados',
    p_entidad_id: data.id,
    p_tipo: 'ingreso_programado',
    p_descripcion: `Ingreso del pallet ${codigo} programado para el ${fechaDMA(fechaLlegada)}: ${d.bultos} bultos`,
    p_severidad: 'info',
    p_metadatos: { pallet: codigo, importacion_id: importacionId },
  }).then(() => undefined, () => undefined);

  return {
    ok: true,
    id: Number(data.id),
    mensaje: `Pallet ${codigo} programado para llegar el ${fechaDMA(fechaLlegada)}. No mueve stock hasta confirmar su llegada.`,
  };
}

/* ==========================================================================
   COMPLETAR UN PALLET QUE YA ESTÁ EN CÁMARA (092)
   --------------------------------------------------------------------------
   Para la importación: la fila suma sus bultos al MISMO pallet, el saldo que
   estaba en otra cámara de la planta pasa a la cámara de la fila y el pallet
   toma la última fecha de producción. Lo hace la base en una sola operación.
   Se llama DESPUÉS de revisar la fila y de palletACompletar().
   ========================================================================== */
export async function completarIngreso(
  supabase: ClienteBase,
  pallet: PalletEnCamara,
  d: DatosIngreso,
  extra: { documento?: string } = {}
): Promise<ResultadoIngreso> {
  const escrito = normalizarCodigo(d.codigo_pallet);
  const detalle = [
    escrito !== pallet.codigo ? `en el Excel figura como ${escrito}` : '',
    d.observaciones?.trim(),
    extra.documento,
  ].filter(Boolean).join(' · ');
  const { data, error } = await supabase.rpc('pallet_completar', {
    p_lote_id: pallet.lote_id,
    p_almacen_id: d.almacen_id,
    p_camara_id: d.camara_id,
    p_bultos: d.bultos,
    p_peso_kg: d.peso_neto_kg,
    p_fecha: d.fecha_produccion,
    p_origen: d.origen_ingreso || 'produccion',
    p_detalle: detalle || null,
  });
  if (error || !data) {
    return { ok: false, mensaje: traducirErrorBase(error, { que: 'completar el pallet', quien: PUEDEN_INGRESAR }) };
  }

  const r = data as { documento: string; pallet: string; almacen: string; bultos_total: number; kg_total: number; fecha: string; aparte: string[] };
  const kg = Number(r.kg_total).toLocaleString('es-PE', { maximumFractionDigits: 1 });
  return {
    ok: true, id: pallet.lote_id, codigo: r.pallet,
    mensaje: `${r.documento}: pallet ${r.pallet} completado con ${d.bultos} bultos. Queda entero en ${r.almacen}: ` +
      `${r.bultos_total} bultos, ${kg} kg, fecha de producción ${fechaDMA(r.fecha)}.` +
      (r.aparte?.length ? ` Sigue aparte (otra bodega): ${r.aparte.join('; ')}.` : ''),
  };
}
