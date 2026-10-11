/**
 * ============================================================================
 *  LOS DESPACHOS CON TODO LO QUE LOS RODEA
 * ============================================================================
 *  Observaciones ERP (oct. 2026), puntos 14, 15 y 17. La lista con selector,
 *  la ficha y el reporte de carga necesitan lo mismo: el despacho, su
 *  contenedor, su embarque, el transporte y, ítem por ítem, qué pallet salió
 *  de qué producto y para qué proforma. Se arma una sola vez aquí.
 *
 *  «Mantener la trazabilidad Cotización → Proforma → Disponibilidad →
 *  Embarque → Despacho»: cada ítem lleva su proforma y su pedido, y el
 *  despacho su embarque. De ahí hacia atrás ya está todo enlazado.
 * ============================================================================
 */
import type { crearClienteServidor } from '@/lib/supabase/servidor';
import { traerTodo } from '@/lib/traerTodo';

type Cliente = Awaited<ReturnType<typeof crearClienteServidor>>;
const uno = <T = Record<string, unknown>>(v: unknown) => (Array.isArray(v) ? v[0] : v) as T | undefined;

export type ItemDespacho = {
  /** El id de la línea del packing: es lo que se marca en el selector. */
  id: number;
  lote_id: number;
  pallet: string;
  sku: string;
  producto: string;
  bultos: number;
  kg: number;
  pedido_id: number | null;
  proforma: string | null;
  cliente: string | null;
};

export type Despacho = {
  id: number;
  numero: string;
  fecha_salida: string;
  observaciones: string | null;
  packing_id: number | null;
  packing: string | null;
  contenedor: string | null;
  precinto: string | null;
  guia: string | null;
  dam: string | null;
  supervisor: string | null;
  turno: string | null;
  fecha_carga: string | null;
  hora_inicio: string | null;
  hora_fin: string | null;
  embarque_id: number | null;
  embarque: string | null;
  booking: string | null;
  naviera: string | null;
  tipo_despacho: string | null;
  destino: string | null;
  almacen: string | null;
  encargado: string | null;
  transportista: string | null;
  placa: string | null;
  conductor: string | null;
  items: ItemDespacho[];
  /** Proformas distintas del despacho, para mostrarlas juntas. */
  proformas: { pedido_id: number; numero: string; cliente: string | null }[];
};

const CAMPOS =
  'id, numero, fecha_salida, observaciones, almacenes(nombre), encargado:usuarios!despachos_encargado_id_fkey(nombre), ' +
  'packing_lists(id, codigo, contenedor, precinto, guia_remision, dam, turno, fecha_carga, hora_inicio, hora_fin, ' +
  'supervisor:usuarios!packing_lists_supervisor_id_fkey(nombre), ' +
  'embarques(id, numero, booking, naviera, tipo_despacho, destinos(puerto, pais), transportistas(razon_social), vehiculos(placa), conductores(nombre)))';

/**
 * Los despachos, del más reciente al más antiguo. Con `ids`, solo esos; sin
 * ellos, los últimos `limite`.
 */
export async function cargarDespachos(supabase: Cliente, opciones: { ids?: number[]; limite?: number } = {}): Promise<Despacho[]> {
  let consulta = supabase.from('despachos').select(CAMPOS).order('fecha_salida', { ascending: false }).order('id', { ascending: false });
  if (opciones.ids?.length) consulta = consulta.in('id', opciones.ids);
  const { data } = await consulta.limit(opciones.ids?.length ? opciones.ids.length : opciones.limite ?? 150);
  const filas = (data ?? []) as unknown as Record<string, unknown>[];

  /* ---- Los ítems de todos esos contenedores, de una vez ---- */
  const idsPacking = filas.map((d) => Number(uno(d.packing_lists)?.id)).filter(Boolean);
  const lineas = idsPacking.length
    ? await traerTodo<Record<string, unknown>>((desde, hasta) =>
        supabase.from('packing_lineas')
          .select('id, packing_list_id, lote_id, bultos, peso_neto_kg, lotes(codigo_pallet, sku_presentaciones(skus(codigo, corte, especies(nombre)), presentaciones(descripcion))), pedido_lineas(pedido_id, pedidos(numero_proforma, clientes(razon_social)))')
          .in('packing_list_id', idsPacking)
          .order('id')
          .range(desde, hasta))
    : [];

  const porPacking = new Map<number, ItemDespacho[]>();
  for (const l of lineas) {
    const lote = uno(l.lotes);
    const sp = uno(lote?.sku_presentaciones);
    const sku = uno(sp?.skus);
    const pl = uno(l.pedido_lineas);
    const ped = uno(pl?.pedidos);
    const item: ItemDespacho = {
      id: Number(l.id),
      lote_id: Number(l.lote_id),
      pallet: String(lote?.codigo_pallet ?? '—'),
      sku: String(sku?.codigo ?? ''),
      producto: `${uno(sku?.especies)?.nombre ?? ''} ${sku?.corte ?? ''} · ${uno(sp?.presentaciones)?.descripcion ?? ''}`.trim(),
      bultos: Number(l.bultos ?? 0),
      kg: Number(l.peso_neto_kg ?? 0),
      pedido_id: pl?.pedido_id ? Number(pl.pedido_id) : null,
      proforma: (ped?.numero_proforma as string) ?? null,
      cliente: (uno(ped?.clientes)?.razon_social as string) ?? null,
    };
    const k = Number(l.packing_list_id);
    porPacking.set(k, [...(porPacking.get(k) ?? []), item]);
  }

  return filas.map((d) => {
    const pk = uno(d.packing_lists);
    const emb = uno(pk?.embarques);
    const dst = uno(emb?.destinos);
    const items = porPacking.get(Number(pk?.id)) ?? [];
    const proformas = [...new Map(items.filter((i) => i.pedido_id).map((i) => [i.pedido_id!, {
      pedido_id: i.pedido_id!, numero: i.proforma ?? '—', cliente: i.cliente,
    }])).values()];
    return {
      id: Number(d.id),
      numero: String(d.numero),
      fecha_salida: String(d.fecha_salida),
      observaciones: (d.observaciones as string) ?? null,
      packing_id: pk?.id ? Number(pk.id) : null,
      packing: (pk?.codigo as string) ?? null,
      contenedor: (pk?.contenedor as string) ?? null,
      precinto: (pk?.precinto as string) ?? null,
      guia: (pk?.guia_remision as string) ?? null,
      dam: (pk?.dam as string) ?? null,
      supervisor: (uno(pk?.supervisor)?.nombre as string) ?? null,
      turno: (pk?.turno as string) ?? null,
      fecha_carga: (pk?.fecha_carga as string) ?? null,
      hora_inicio: (pk?.hora_inicio as string) ?? null,
      hora_fin: (pk?.hora_fin as string) ?? null,
      embarque_id: emb?.id ? Number(emb.id) : null,
      embarque: (emb?.numero as string) ?? null,
      booking: (emb?.booking as string) ?? null,
      naviera: (emb?.naviera as string) ?? null,
      tipo_despacho: (emb?.tipo_despacho as string) ?? null,
      destino: dst?.puerto ? `${dst.puerto}${dst.pais ? `, ${dst.pais}` : ''}` : null,
      almacen: (uno(d.almacenes)?.nombre as string) ?? null,
      encargado: (uno(d.encargado)?.nombre as string) ?? null,
      transportista: (uno(emb?.transportistas)?.razon_social as string) ?? null,
      placa: (uno(emb?.vehiculos)?.placa as string) ?? null,
      conductor: (uno(emb?.conductores)?.nombre as string) ?? null,
      items,
      proformas,
    };
  });
}

/** Lee «1,2,3» de la dirección y devuelve números válidos. */
export function idsDeTexto(texto: string | null | undefined): number[] {
  return [...new Set(String(texto ?? '').split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0))];
}
