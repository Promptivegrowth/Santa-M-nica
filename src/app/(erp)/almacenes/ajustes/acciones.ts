'use server';

/**
 * ============================================================================
 *  AJUSTES, MERMAS Y MUESTRAS
 * ============================================================================
 *  El Kardex tenía desde el principio cuatro tipos de movimiento que nadie
 *  podía registrar: el ajuste que suma, el que resta, la merma y la muestra.
 *  Esta es la puerta para los cuatro.
 *
 *  LA REGLA DE FONDO NO CAMBIA
 *  El Kardex no se edita. Un ajuste no «corrige» una línea vieja: escribe una
 *  línea NUEVA, con su motivo, quién la hizo y quién la autorizó. Las dos
 *  quedan a la vista, que es lo que hace confiable el inventario.
 *
 *  TODO LO IMPORTANTE LO HACE LA BASE
 *  La función stock_ajustar() (migración 069) valida el rol, el motivo, que el
 *  pallet no quede en negativo y que no se coma kilos reservados sin avisar, y
 *  escribe el movimiento, el historial y —si hace falta— reduce las reservas,
 *  todo en una transacción. Aquí solo se traduce la respuesta.
 *
 *  QUIÉN PUEDE QUÉ (lo decide la base; esto solo evita ofrecer lo imposible)
 *    · Ajustes (+ y −) .......... Gerencia, Operaciones.
 *    · Merma .................... Gerencia, Operaciones; Almacén solo con un
 *                                 motivo que no pida autorización.
 *    · Muestra .................. Gerencia, Operaciones, Almacén, Calidad.
 *    · Reducir reservas ......... Gerencia, Operaciones.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { uno, campo } from '@/lib/relaciones';
import { NOMBRE_ROL, type Rol } from '@/lib/navegacion';

export type TipoAjuste = 'ajuste_positivo' | 'ajuste_negativo' | 'salida_merma' | 'salida_muestra';

/* No se exporta: un archivo 'use server' solo puede exportar funciones. */
const TIPOS_AJUSTE: TipoAjuste[] = ['ajuste_positivo', 'ajuste_negativo', 'salida_merma', 'salida_muestra'];

/** Los roles que pueden entrar al formulario (cada uno ve lo que le toca). */
const PUEDEN_REGISTRAR = ['gerencia', 'operaciones', 'almacen', 'calidad'];

/** Una posición: un pallet en una bodega, con lo que hace falta para decidir. */
export type PosicionPallet = {
  lote_id: number;
  almacen_id: number;
  pallet: string;
  producto: string;
  almacen: string;
  bultos: number;
  fisico_kg: number;
  /** Activas y en preparación: lo que un pedido tiene apartado. */
  reservado_kg: number;
  bloqueado_kg: number;
  disponible_kg: number;
  kg_por_bulto: number;
  reservas: { pedido: string; kg: number; estado: string }[];
};

export type DatosAjuste = {
  lote_id: number;
  almacen_id: number;
  tipo: TipoAjuste;
  bultos: number;
  peso_kg: number;
  motivo_id: number;
  detalle: string;
  /** Confirmación expresa de que se reducen reservas. */
  tocar_reservas: boolean;
};

export type ResultadoAjuste =
  | { ok: true; mensaje: string; documento: string; lote_id: number }
  | { ok: false; mensaje: string; confirmar?: boolean };

function refrescar(loteId: number) {
  for (const ruta of [
    '/almacenes/ajustes', '/almacenes/existencias', '/almacenes/kardex', '/almacenes/movimientos',
    '/almacenes/valorizado', '/almacenes/anticuamiento', '/almacenes/reservas', '/almacenes/alertas',
    '/ventas/disponibilidad', '/panel',
  ]) revalidatePath(ruta);
  revalidatePath(`/almacenes/lotes/${loteId}`);
}

const NOMBRE: Record<TipoAjuste, string> = {
  ajuste_positivo: 'Ajuste que suma',
  ajuste_negativo: 'Ajuste que resta',
  salida_merma: 'Merma',
  salida_muestra: 'Muestra',
};

const bultos = (n: number) => `${n} bulto${n === 1 ? '' : 's'}`;
const kg = (n: number) => n.toLocaleString('es-PE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/* ==========================================================================
   REGISTRAR
   ========================================================================== */
export async function registrarAjuste(d: DatosAjuste): Promise<ResultadoAjuste> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión caducó. Vuelva a entrar.' };
  if (!PUEDEN_REGISTRAR.includes(usuario.rol)) {
    return {
      ok: false,
      mensaje: `${NOMBRE_ROL[usuario.rol as Rol] ?? 'Su rol'} no puede registrar ajustes, mermas ni muestras: los registran Gerencia y Operaciones (y, según el tipo, Almacén y Calidad).`,
    };
  }
  if (!TIPOS_AJUSTE.includes(d.tipo)) return { ok: false, mensaje: 'Elija qué pasó: ajuste, merma o muestra.' };
  if (!d.lote_id || !d.almacen_id) return { ok: false, mensaje: 'Elija el pallet y la bodega.' };
  if (!d.motivo_id) return { ok: false, mensaje: 'Elija el motivo de la lista.' };
  if (!Number.isInteger(d.bultos) || d.bultos < 0) {
    return { ok: false, mensaje: 'Los bultos van en número entero (cero si solo cambia el peso).' };
  }
  if (!(d.peso_kg > 0)) return { ok: false, mensaje: 'Indique los kilos (más de cero).' };

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc('stock_ajustar', {
    p_lote_id: d.lote_id,
    p_almacen_id: d.almacen_id,
    p_tipo: d.tipo,
    p_bultos: d.bultos,
    p_peso_kg: d.peso_kg,
    p_motivo_id: d.motivo_id,
    p_detalle: d.detalle ?? '',
    p_tocar_reservas: Boolean(d.tocar_reservas),
  });

  if (error) {
    /* La base rechaza la primera vez que se tocan kilos reservados y deja la
       pista «tocar_reservas»: la pantalla pide la confirmación con ese texto. */
    if (error.hint === 'tocar_reservas') return { ok: false, mensaje: error.message, confirmar: true };
    return { ok: false, mensaje: error.message };
  }

  const r = data as {
    documento: string; pallet: string; almacen: string;
    bultos_antes: number; kg_antes: number; bultos_despues: number; kg_despues: number;
    reservas_reducidas: { pedido: string | null; kg_antes: number; kg_despues: number }[];
  };

  refrescar(d.lote_id);

  const reducidas = r.reservas_reducidas ?? [];
  const detalleReservas = reducidas.length
    ? ' Reservas reducidas: ' + reducidas.map((x) =>
        `${x.pedido ?? 'un pedido'} de ${kg(Number(x.kg_antes))} a ${kg(Number(x.kg_despues))} kg` +
        (Number(x.kg_despues) <= 0.001 ? ' (liberada)' : '')).join(' · ') + '.'
    : '';

  return {
    ok: true,
    documento: r.documento,
    lote_id: d.lote_id,
    mensaje:
      `${NOMBRE[d.tipo]} ${r.documento} registrada. El pallet ${r.pallet} en ${r.almacen} pasó de ` +
      `${bultos(r.bultos_antes)} · ${kg(Number(r.kg_antes))} kg a ${bultos(r.bultos_despues)} · ` +
      `${kg(Number(r.kg_despues))} kg. Queda en el Kardex y en el historial del pallet.` + detalleReservas,
  };
}

/* ==========================================================================
   AYUDAS PARA EL FORMULARIO
   ========================================================================== */

/**
 * Las posiciones de un pallet (o de los pallets cuyo código coincide).
 *
 * Se leen de `existencias` y no de la vista de stock porque un ajuste que suma
 * puede hacerse sobre una posición que quedó en cero (el conteo encontró
 * producto que el sistema daba por salido). Lo reservado y lo bloqueado se
 * completan desde v_stock_lote, que es donde se calculan.
 */
export async function posicionesDePallet(
  filtro: { texto?: string; loteId?: number }
): Promise<PosicionPallet[]> {
  const supabase = await crearClienteServidor();
  const texto = (filtro.texto ?? '').trim().replace(/[%,()]/g, ' ');
  if (!filtro.loteId && texto.length < 3) return [];

  let consulta = supabase
    .from('existencias')
    .select('lote_id, almacen_id, bultos, peso_neto_kg, almacenes(nombre), lotes!inner(codigo_pallet, sku_presentaciones(skus(codigo, corte, especies(nombre)), presentaciones(peso_bulto_kg)))')
    .order('peso_neto_kg', { ascending: false })
    .limit(25);
  consulta = filtro.loteId
    ? consulta.eq('lote_id', filtro.loteId)
    : consulta.ilike('lotes.codigo_pallet', `%${texto}%`);

  const { data: filas } = await consulta;
  const lista = filas ?? [];
  if (!lista.length) return [];

  const ids = [...new Set(lista.map((f) => Number(f.lote_id)))];
  const [{ data: stock }, { data: reservas }] = await Promise.all([
    supabase.from('v_stock_lote')
      .select('lote_id, almacen_id, bloqueado_kg, reservado_kg, preparacion_kg, disponible_kg')
      .in('lote_id', ids),
    supabase.from('reservas')
      .select('lote_id, almacen_id, peso_neto_kg, estado, pedido_lineas(pedidos(numero_proforma))')
      .in('lote_id', ids)
      .in('estado', ['activa', 'en_preparacion']),
  ]);

  return lista.map((f) => {
    const lote = uno<Record<string, unknown>>(f.lotes);
    const sp = uno<Record<string, unknown>>(lote?.sku_presentaciones);
    const sku = uno<Record<string, unknown>>(sp?.skus);
    const s = (stock ?? []).find((x) => x.lote_id === f.lote_id && x.almacen_id === f.almacen_id);
    const propias = (reservas ?? []).filter((r) => r.lote_id === f.lote_id && r.almacen_id === f.almacen_id);
    const fisico = Number(f.peso_neto_kg ?? 0);
    return {
      lote_id: Number(f.lote_id),
      almacen_id: Number(f.almacen_id),
      pallet: String(lote?.codigo_pallet ?? ''),
      producto: `${campo(sku, 'codigo')} · ${campo(sku?.especies, 'nombre')} · ${campo(sku, 'corte')}`,
      almacen: campo(f.almacenes, 'nombre'),
      bultos: Number(f.bultos ?? 0),
      fisico_kg: fisico,
      reservado_kg: Number(s?.reservado_kg ?? 0) + Number(s?.preparacion_kg ?? 0),
      bloqueado_kg: Number(s?.bloqueado_kg ?? 0),
      disponible_kg: Number(s?.disponible_kg ?? 0),
      kg_por_bulto: Number(campo(sp?.presentaciones, 'peso_bulto_kg', '0')) || 0,
      reservas: propias.map((r) => {
        const pl = uno<Record<string, unknown>>(r.pedido_lineas);
        return {
          pedido: campo(pl?.pedidos, 'numero_proforma', '(sin número)'),
          kg: Number(r.peso_neto_kg ?? 0),
          estado: String(r.estado),
        };
      }),
    };
  });
}
