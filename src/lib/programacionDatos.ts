/**
 * ============================================================================
 *  LA PROGRAMACIÓN DE EMBARQUES · de la base a una fila por embarque (084)
 * ============================================================================
 *  La lista de la pantalla y las descargas (Excel y PDF) leen de aquí, con la
 *  sesión del usuario: las políticas de la base se aplican igual a lo que se
 *  ve y a lo que se descarga.
 *
 *  UNA FILA = UN EMBARQUE, que es la fila de su Excel. Si un embarque lleva
 *  varios contenedores, sus PL y matrículas van juntos en la misma celda.
 * ============================================================================
 */
import type { crearClienteServidor } from '@/lib/supabase/servidor';
import { traerTodo } from '@/lib/traerTodo';
import { semanaIso } from '@/lib/numeroPacking';
import type { FilaProgramacion } from '@/lib/programacion';

type Cliente = Awaited<ReturnType<typeof crearClienteServidor>>;
type Obj = Record<string, unknown>;
const uno = (v: unknown) => (Array.isArray(v) ? v[0] : v) as Obj | undefined;
const lista = (v: unknown) => (Array.isArray(v) ? v : v ? [v] : []) as Obj[];
const unicos = (xs: (string | null | undefined)[]) => [...new Set(xs.map((x) => String(x ?? '').trim()).filter(Boolean))];

const ESTADO_PACKING: Record<string, string> = {
  abierto: 'Abierto', en_carga: 'En carga', cerrado: 'Despachado', anulado: 'Anulado',
};

export type RangoProgramacion = { desde?: string | null; hasta?: string | null; ids?: number[] };

/**
 * El lunes de la semana de una fecha (AAAA-MM-DD). La programación abre en la
 * semana EN CURSO —lo que sale el jueves y el viernes ya despachado sigue a
 * la vista hasta el domingo—, no en «hoy», que escondía la mitad de la semana.
 */
export function lunesDe(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  const dia = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (dia - 1));
  return d.toISOString().slice(0, 10);
}

export async function cargarProgramacion(supabase: Cliente, rango: RangoProgramacion = {}): Promise<FilaProgramacion[]> {
  const crudos = await traerTodo<Obj>((desde, hasta) => {
    let q = supabase
      .from('embarques')
      .select(
        'id, numero, fecha_programada, semana_despacho, fecha_zarpe, operador_logistico, numero_packing, estado, tipo_despacho, booking, naviera, observaciones, ' +
        'almacenes(nombre), destinos(puerto, pais), ' +
        'packing_lists(codigo, contenedor, estado, packing_lineas(peso_neto_kg), despachos(fecha_salida)), ' +
        'embarque_pedidos(pedidos(numero_proforma, clientes(razon_social), pedido_lineas(cantidad_tm, sku_presentaciones(skus(codigo))))), ' +
        'embarque_lineas(cantidad_kg, sale:sku_presentaciones(skus(codigo))), ' +
        'embarque_archivos(tipo), embarque_comentarios(id)'
      )
      .order('fecha_programada', { ascending: true })
      .order('id', { ascending: true });
    if (rango.desde) q = q.gte('fecha_programada', rango.desde);
    if (rango.hasta) q = q.lte('fecha_programada', rango.hasta);
    if (rango.ids?.length) q = q.in('id', rango.ids);
    return q.range(desde, hasta) as unknown as PromiseLike<{ data: Obj[] | null; error: unknown }>;
  });

  return crudos.map((e) => {
    const packings = lista(e.packing_lists);
    const vivos = packings.filter((p) => p.estado !== 'anulado');
    const pedidos = lista(e.embarque_pedidos).map((ep) => uno(ep.pedidos)).filter(Boolean) as Obj[];
    const programadas = lista(e.embarque_lineas);

    /* ---- Las toneladas: lo cargado si hay packing; si no, lo programado ---- */
    const kgCargados = vivos.reduce((t, p) => t + lista(p.packing_lineas).reduce((s, l) => s + Number(l.peso_neto_kg ?? 0), 0), 0);
    const kgProgramados = programadas.reduce((t, l) => t + Number(l.cantidad_kg ?? 0), 0);
    const tmPedidos = pedidos.reduce((t, p) => t + lista(p.pedido_lineas).reduce((s, l) => s + Number(l.cantidad_tm ?? 0), 0), 0);
    const tm = kgCargados > 0 ? kgCargados / 1000 : kgProgramados > 0 ? kgProgramados / 1000 : tmPedidos;

    /* ---- Los productos: lo que sale (si se eligió por producto) o lo pedido ---- */
    const skus = programadas.length
      ? unicos(programadas.map((l) => String(uno(uno(l.sale)?.skus)?.codigo ?? '')))
      : unicos(pedidos.flatMap((p) => lista(p.pedido_lineas).map((l) => String(uno(uno(l.sku_presentaciones)?.skus)?.codigo ?? ''))));

    /* ---- El PL: el del embarque primero y, después, el de cada contenedor ---- */
    const pls = unicos([e.numero_packing as string | null, ...vivos.map((p) => p.codigo as string)]);

    /* ---- La situación del packing ---- */
    const estados = unicos(vivos.map((p) => ESTADO_PACKING[String(p.estado)] ?? String(p.estado)));
    const packing = vivos.length === 0 ? 'Sin contenedor' : estados.length === 1 ? estados[0] : estados.join(' / ');

    const salidas = vivos.flatMap((p) => lista(p.despachos).map((d) => String(d.fecha_salida ?? ''))).filter(Boolean).sort();
    const archivos = lista(e.embarque_archivos);
    const cuenta = (t: string) => archivos.filter((a) => a.tipo === t).length;
    const dst = uno(e.destinos);

    return {
      id: Number(e.id),
      numero: String(e.numero),
      semana: e.semana_despacho == null ? semanaIso(String(e.fecha_programada)) : Number(e.semana_despacho),
      fecha_despacho: String(e.fecha_programada).slice(0, 10),
      fecha_zarpe: (e.fecha_zarpe as string) ?? null,
      despacho_real: salidas[0] ?? null,
      pl: pls.join(', '),
      proformas: unicos(pedidos.map((p) => p.numero_proforma as string)).join(', '),
      clientes: unicos(pedidos.map((p) => uno(p.clientes)?.razon_social as string)).join(' · '),
      destino: dst?.puerto ? `${dst.puerto}${dst.pais ? `, ${dst.pais}` : ''}` : '',
      productos: skus.join(', '),
      tm: Math.round(tm * 1000) / 1000,
      tm_cargada: kgCargados > 0,
      contenedores: unicos(vivos.map((p) => p.contenedor as string)).join(', '),
      booking: String(e.booking ?? ''),
      naviera: String(e.naviera ?? ''),
      operador: String(e.operador_logistico ?? ''),
      almacen: String(uno(e.almacenes)?.nombre ?? ''),
      tipo: String(e.tipo_despacho ?? ''),
      estado: String(e.estado),
      packing,
      docs: { etiqueta: cuenta('etiqueta'), declarado: cuenta('packing_declarado'), real: cuenta('packing_real'), otro: cuenta('otro') },
      comentarios: lista(e.embarque_comentarios).length,
      observaciones: String(e.observaciones ?? ''),
    } satisfies FilaProgramacion;
  });
}

/** 2026-11-02 → «lunes 02/11/2026». */
function diaTexto(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  return `${dias[d.getUTCDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/**
 * QUÉ FECHAS SE PIDEN A LA BASE, a partir de la dirección web. La misma
 * regla para la pantalla y para la descarga, para que el archivo traiga lo
 * mismo que se ve:
 *   · ?mes=AAAA-MM (la lista del planificador): ese mes entero;
 *   · ?todo=1: todo el histórico (o desde/hasta si vienen);
 *   · si no: desde el LUNES de la semana en curso (o ?desde=), en adelante.
 */
export function rangoDeParametros(
  p: URLSearchParams | Record<string, string | string[] | undefined>, hoy: string,
): { desde: string | null; hasta: string | null; descripcion: string; mes: string | null } {
  const leer = (k: string) => {
    const v = p instanceof URLSearchParams ? p.get(k) : p[k];
    const s = Array.isArray(v) ? v[0] : v;
    return typeof s === 'string' && s ? s : null;
  };
  const fecha = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const mes = /^(\d{4})-(\d{2})$/.exec(leer('mes') ?? '');
  if (mes && leer('vista') === 'lista') {
    const anio = Number(mes[1]);
    const m = Number(mes[2]);
    const desde = `${mes[1]}-${mes[2]}-01`;
    const hasta = new Date(Date.UTC(anio, m, 0)).toISOString().slice(0, 10);
    const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    return { desde, hasta, descripcion: `despachos de ${MESES[m - 1]} de ${anio}`, mes: `${mes[1]}-${mes[2]}` };
  }
  const desde = fecha(leer('desde'));
  const hasta = fecha(leer('hasta'));
  if (leer('todo') === '1') {
    return {
      desde, hasta, mes: null,
      descripcion: desde || hasta
        ? `despachos${desde ? ` desde el ${diaTexto(desde)}` : ''}${hasta ? ` hasta el ${diaTexto(hasta)}` : ''}`
        : 'todo el histórico',
    };
  }
  const inicio = desde ?? lunesDe(hoy);
  return {
    desde: inicio, hasta, mes: null,
    descripcion: `despachos desde el ${diaTexto(inicio)}${hasta ? ` hasta el ${diaTexto(hasta)}` : ''}${desde ? '' : ' (semana en curso)'}`,
  };
}
