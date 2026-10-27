/**
 * ============================================================================
 *  LAS REGLAS DE UN TRASLADO · una sola vez, para el formulario y el Excel
 * ============================================================================
 *  Un traslado nace por dos caminos: el formulario «Nuevo traslado» y la
 *  importación desde Excel (Stock › Traslados › Importar desde Excel). Los dos
 *  exigen lo mismo de cada pallet, y por eso la regla vive aquí:
 *
 *    · que tenga stock en la bodega de origen;
 *    · que no esté bloqueado por Calidad;
 *    · que lo que se mueve no pase de lo DISPONIBLE (lo apartado para un
 *      pedido no se lleva a otra cámara sin darse cuenta);
 *    · que no vaya ya en otro traslado que todavía no sale (borrador o
 *      autorizado): pedirlo dos veces es mover dos veces lo mismo.
 *
 *  Y el alta (número, cabecera y líneas) también es una sola: insertarTraslado.
 *  Nace en BORRADOR y sigue su circuito normal (autorizar, despachar, recibir).
 *  La base revisa además cada línea por su cuenta (069).
 *
 *  Este archivo no es una acción del servidor: lo llaman las acciones, que ya
 *  autorizaron.
 * ============================================================================
 */
import type { crearClienteServidor } from '@/lib/supabase/servidor';
import { traerTodo } from '@/lib/traerTodo';
import { traducirErrorBase } from '@/lib/mensajesBase';

export type ClienteBase = Awaited<ReturnType<typeof crearClienteServidor>>;

/** Quién puede pedir un traslado (y por tanto importarlos). */
export const PUEDEN_SOLICITAR = ['gerencia', 'operaciones', 'almacen'] as const;

export type LineaTraslado = { lote_id: number; bultos: number; peso_kg: number };

export type StockLote = {
  lote_id: number; almacen_id: number; codigo_pallet: string; sku_presentacion_id: number;
  fisico_kg: number; fisico_bultos: number; disponible_kg: number; bloqueado_kg: number; meses: number;
};

export type ContextoTraslado = {
  /** Clave «lote-bodega». */
  stock: Map<string, StockLote>;
  /** El traslado que ya lleva cada pallet sin haber salido todavía. */
  pendientes: Map<number, { numero: string; estado: string }>;
};

const kg1 = (n: number) => n.toLocaleString('es-PE', { maximumFractionDigits: 1 });

/** El stock de unos pallets en todas sus bodegas, y los traslados que ya los llevan. */
export async function cargarContextoTraslado(supabase: ClienteBase, loteIds: number[]): Promise<ContextoTraslado> {
  const ids = [...new Set(loteIds.filter((x) => Number(x) > 0))];
  const stock = new Map<string, StockLote>();
  const pendientes = new Map<number, { numero: string; estado: string }>();
  for (let i = 0; i < ids.length; i += 150) {
    const trozo = ids.slice(i, i + 150);
    const [{ data: s }, { data: p }] = await Promise.all([
      supabase.from('v_stock_lote')
        .select('lote_id, almacen_id, codigo_pallet, sku_presentacion_id, fisico_kg, fisico_bultos, disponible_kg, bloqueado_kg, meses_almacenado')
        .in('lote_id', trozo),
      supabase.from('traslado_lineas').select('lote_id, traslados!inner(numero, estado)')
        .in('lote_id', trozo).in('traslados.estado', ['borrador', 'autorizado']),
    ]);
    for (const x of s ?? []) {
      stock.set(`${x.lote_id}-${x.almacen_id}`, {
        lote_id: Number(x.lote_id), almacen_id: Number(x.almacen_id), codigo_pallet: String(x.codigo_pallet),
        sku_presentacion_id: Number(x.sku_presentacion_id), fisico_kg: Number(x.fisico_kg), fisico_bultos: Number(x.fisico_bultos),
        disponible_kg: Number(x.disponible_kg), bloqueado_kg: Number(x.bloqueado_kg), meses: Number(x.meses_almacenado ?? 0),
      });
    }
    for (const x of p ?? []) {
      const t = Array.isArray(x.traslados) ? x.traslados[0] : x.traslados;
      if (t) pendientes.set(Number(x.lote_id), { numero: String((t as { numero: string }).numero), estado: String((t as { estado: string }).estado) });
    }
  }
  return { stock, pendientes };
}

/**
 * Los bultos que se pueden mover de un pallet: todos si nada está apartado;
 * si hay algo apartado, la parte libre en proporción (redondeando hacia abajo).
 */
export function bultosDisponibles(s: StockLote): number {
  if (s.disponible_kg >= s.fisico_kg - 0.001) return s.fisico_bultos;
  return s.fisico_kg > 0 ? Math.floor(s.fisico_bultos * (s.disponible_kg / s.fisico_kg)) : 0;
}

/** Kilos por bulto REALES del pallet (no el estándar): así el total cuadra. */
export const kgPorBulto = (s: StockLote) => (s.fisico_bultos > 0 ? s.fisico_kg / s.fisico_bultos : 0);

/**
 * Qué está mal de una línea, o null si se puede trasladar.
 * `nombreOrigen` solo sirve para decirlo en el mensaje.
 */
export function problemaLinea(
  l: LineaTraslado,
  origenId: number,
  ctx: ContextoTraslado,
  nombreOrigen = 'la bodega de origen'
): { campo: 'pallet' | 'bultos' | 'kilos'; mensaje: string } | null {
  const s = ctx.stock.get(`${l.lote_id}-${origenId}`);
  if (!s || s.fisico_kg <= 0.001) {
    return { campo: 'pallet', mensaje: `El pallet no tiene saldo en ${nombreOrigen}.` };
  }
  if (s.bloqueado_kg > 0) {
    return { campo: 'pallet', mensaje: `El pallet ${s.codigo_pallet} está bloqueado por Calidad y no puede moverse de bodega hasta que lo liberen.` };
  }
  if (s.disponible_kg <= 0.001) {
    return { campo: 'pallet', mensaje: `El pallet ${s.codigo_pallet} está apartado entero para pedidos: no tiene nada disponible para trasladar.` };
  }
  const p = ctx.pendientes.get(l.lote_id);
  if (p) {
    return {
      campo: 'pallet',
      mensaje: `El pallet ${s.codigo_pallet} ya va en el traslado ${p.numero} (${p.estado === 'borrador' ? 'en borrador' : 'autorizado'}), que todavía no sale: ` +
        'no se puede pedir dos veces. Anule ese traslado o espere a que se despache.',
    };
  }
  if (!(l.bultos > 0) || !Number.isInteger(l.bultos)) {
    return { campo: 'bultos', mensaje: 'Los bultos tienen que ser un número entero mayor que cero.' };
  }
  if (!(l.peso_kg > 0)) return { campo: 'kilos', mensaje: 'Los kilos tienen que ser mayores que cero.' };
  if (l.peso_kg > s.disponible_kg + 0.001) {
    return {
      campo: 'kilos',
      mensaje: `Del pallet ${s.codigo_pallet} hay ${kg1(s.disponible_kg)} kg disponibles y quiere mover ${kg1(l.peso_kg)} kg. ` +
        (s.disponible_kg < s.fisico_kg - 0.001 ? 'El resto está apartado para un pedido.' : ''),
    };
  }
  if (l.bultos > s.fisico_bultos) {
    return { campo: 'bultos', mensaje: `El pallet ${s.codigo_pallet} tiene ${s.fisico_bultos} bultos en el origen y quiere mover ${l.bultos}.` };
  }
  return null;
}

export type DatosTraslado = {
  almacen_origen_id: number;
  almacen_destino_id: number;
  /** Opcional al crear: si ya se conoce, viene puesta al despachar. */
  guia_numero?: string | null;
  fecha_programada: string | null;
  transportista_id: number | null;
  vehiculo_id: number | null;
  conductor_id: number | null;
  observaciones: string | null;
  lineas: LineaTraslado[];
};

/**
 * Da de alta el traslado en BORRADOR con sus líneas. Se llama después de
 * revisar cada línea con problemaLinea(): aquí no se vuelve a validar (la
 * base sí lo hace, línea por línea).
 */
export async function insertarTraslado(
  supabase: ClienteBase,
  usuarioId: string,
  d: DatosTraslado
): Promise<{ ok: true; id: number; numero: string } | { ok: false; mensaje: string }> {
  const anio = new Date().getFullYear();
  const { data: correlativo, error: errNum } = await supabase
    .rpc('siguiente_correlativo', { p_serie: 'TRAS', p_anio: anio });
  if (errNum) return { ok: false, mensaje: traducirErrorBase(errNum, { que: 'reservar el número del traslado', quien: PUEDEN_SOLICITAR }) };

  const numero = `TRAS-${anio}-${String(correlativo).padStart(4, '0')}`;

  const { data: traslado, error } = await supabase
    .from('traslados')
    .insert({
      numero,
      almacen_origen_id: d.almacen_origen_id,
      almacen_destino_id: d.almacen_destino_id,
      // El primer estado del enum es «borrador», no «solicitado».
      estado: 'borrador',
      guia_numero: d.guia_numero?.trim() || null,
      fecha_programada: d.fecha_programada || null,
      transportista_id: d.transportista_id,
      vehiculo_id: d.vehiculo_id,
      conductor_id: d.conductor_id,
      observaciones: d.observaciones?.trim() || null,
      creado_por: usuarioId,
    })
    .select('id')
    .single();

  if (error || !traslado) return { ok: false, mensaje: traducirErrorBase(error, { que: 'crear el traslado', quien: PUEDEN_SOLICITAR }) };

  const { error: errLin } = await supabase.from('traslado_lineas').insert(
    d.lineas.map((l) => ({
      traslado_id: traslado.id,
      lote_id: l.lote_id,
      bultos_enviados: Math.round(l.bultos),
      peso_enviado_kg: l.peso_kg,
    }))
  );

  if (errLin) {
    // Un traslado sin líneas no significa nada: se deshace entero.
    await supabase.from('traslados').delete().eq('id', traslado.id);
    return { ok: false, mensaje: traducirErrorBase(errLin, { que: 'cargar los pallets del traslado', quien: PUEDEN_SOLICITAR }) };
  }

  return { ok: true, id: Number(traslado.id), numero };
}

/** Todos los pallets con algo disponible, de todas las bodegas (para la plantilla). */
export async function palletsDisponibles(supabase: ClienteBase) {
  return traerTodo<{
    lote_id: number; almacen_id: number; codigo_pallet: string; sku_presentacion_id: number;
    fisico_kg: number; fisico_bultos: number; disponible_kg: number; bloqueado_kg: number; meses_almacenado: number;
  }>((d, h) => supabase
    .from('v_stock_lote')
    .select('lote_id, almacen_id, codigo_pallet, sku_presentacion_id, fisico_kg, fisico_bultos, disponible_kg, bloqueado_kg, meses_almacenado')
    .gt('disponible_kg', 0.001)
    .eq('bloqueado_kg', 0)
    .order('almacen_id').order('codigo_pallet').order('lote_id')
    .range(d, h));
}
