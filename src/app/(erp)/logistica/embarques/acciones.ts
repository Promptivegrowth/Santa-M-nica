'use server';

/**
 * ============================================================================
 *  EMBARQUES Y PACKING LISTS
 * ============================================================================
 *  UN EMBARQUE ES LA SALIDA PROGRAMADA. Dice qué día sale, desde qué bodega,
 *  hacia qué puerto y con qué naviera. Puede agrupar varios pedidos —eso es
 *  consolidar— y un mismo pedido puede repartirse en varios embarques —eso es
 *  despacho parcial—.
 *
 *  UN PACKING LIST ES UN CONTENEDOR CONCRETO de ese embarque. Un embarque con
 *  tres contenedores lleva tres packing lists, cada uno con su matrícula, su
 *  precinto y su plano de estiba.
 *
 *  Por eso el packing se crea DESDE el embarque y no al revés: sin saber a
 *  dónde va y desde qué bodega, un contenedor no significa nada.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';

export type Resultado =
  | { ok: true; id: number; numero: string; mensaje: string }
  | { ok: false; mensaje: string; campo?: string };

const PUEDEN = ['gerencia', 'operaciones', 'comex', 'almacen'];

function refrescar(id?: number) {
  revalidatePath('/logistica/embarques');
  if (id) revalidatePath(`/logistica/embarques/${id}`);
  revalidatePath('/logistica/planificador');
  revalidatePath('/logistica/packing');
  revalidatePath('/ventas/pedidos');
  revalidatePath('/panel');
}

async function autorizar(que: string) {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { error: 'Su sesión caducó. Vuelva a entrar.' };
  if (!PUEDEN.includes(usuario.rol)) {
    return { error: `Su rol (${usuario.rol}) no puede ${que}.` };
  }
  return { usuario };
}

/* ==========================================================================
   CREAR UN EMBARQUE
   ========================================================================== */

export type DatosEmbarque = {
  fecha_programada: string;
  almacen_id: number;
  destino_id: number | null;
  tipo_despacho: 'exportacion' | 'mercado_nacional' | 'traslado';
  booking: string | null;
  naviera: string | null;
  transportista_id: number | null;
  vehiculo_id: number | null;
  conductor_id: number | null;
  observaciones: string | null;
  /** Los pedidos que van en este embarque. */
  pedidos: number[];
};

export async function crearEmbarque(d: DatosEmbarque): Promise<Resultado> {
  const permiso = await autorizar('programar embarques');
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  if (!d.fecha_programada) {
    return { ok: false, mensaje: 'Indique qué día sale.', campo: 'fecha_programada' };
  }
  if (!d.almacen_id) {
    return { ok: false, mensaje: 'Indique desde qué bodega sale.', campo: 'almacen_id' };
  }
  if (d.tipo_despacho === 'exportacion' && !d.destino_id) {
    return { ok: false, mensaje: 'Una exportación necesita puerto de destino.', campo: 'destino_id' };
  }

  const supabase = await crearClienteServidor();

  /*
   * El vehículo tiene que estar en regla. Un camión con el SOAT vencido no
   * puede circular, y descubrirlo en la carretera cuesta el flete y el
   * contenedor. Se avisa aquí, antes de programarlo.
   */
  if (d.vehiculo_id) {
    const { data: v } = await supabase
      .from('vehiculos')
      .select('placa, soat_vence, revision_vence')
      .eq('id', d.vehiculo_id)
      .maybeSingle();

    const vencidos: string[] = [];
    if (v?.soat_vence && String(v.soat_vence) < d.fecha_programada) vencidos.push('el SOAT');
    if (v?.revision_vence && String(v.revision_vence) < d.fecha_programada) vencidos.push('la revisión técnica');

    if (vencidos.length > 0) {
      return {
        ok: false,
        mensaje:
          `Al vehículo ${v?.placa} se le vence ${vencidos.join(' y ')} antes del ${d.fecha_programada}. ` +
          'Renuévelo o asigne otro: un camión sin documentos en regla no puede salir.',
        campo: 'vehiculo_id',
      };
    }
  }

  const anio = Number(d.fecha_programada.slice(0, 4));
  const { data: correlativo, error: errNum } = await supabase
    .rpc('siguiente_correlativo', { p_serie: 'EMB', p_anio: anio });
  if (errNum) return { ok: false, mensaje: `No se pudo reservar el número: ${errNum.message}` };

  const numero = `EMB-${anio}-${String(correlativo).padStart(4, '0')}`;

  const { data: embarque, error } = await supabase
    .from('embarques')
    .insert({
      numero,
      fecha_programada: d.fecha_programada,
      almacen_id: d.almacen_id,
      destino_id: d.destino_id,
      tipo_despacho: d.tipo_despacho,
      booking: d.booking?.trim() || null,
      naviera: d.naviera?.trim() || null,
      transportista_id: d.transportista_id,
      vehiculo_id: d.vehiculo_id,
      conductor_id: d.conductor_id,
      observaciones: d.observaciones?.trim() || null,
      estado: 'planificado',
      creado_por: permiso.usuario!.id,
    })
    .select('id')
    .single();

  if (error || !embarque) return { ok: false, mensaje: `No se pudo crear el embarque: ${error?.message}` };

  if (d.pedidos?.length) {
    const { error: errPed } = await supabase
      .from('embarque_pedidos')
      .insert(d.pedidos.map((pedido_id) => ({ embarque_id: embarque.id, pedido_id })));

    if (errPed) {
      await supabase.from('embarques').delete().eq('id', embarque.id);
      return { ok: false, mensaje: `No se pudieron asociar los pedidos: ${errPed.message}` };
    }
  }

  await supabase.rpc('registrar_evento', {
    p_entidad: 'embarques',
    p_entidad_id: embarque.id,
    p_tipo: 'embarque_creado',
    p_descripcion: `Embarque ${numero} programado para el ${d.fecha_programada} con ${d.pedidos?.length ?? 0} pedidos`,
    p_severidad: 'info',
  }).then(() => undefined, () => undefined);

  refrescar(embarque.id as number);
  return {
    ok: true,
    id: embarque.id as number,
    numero,
    mensaje:
      `Embarque ${numero} programado para el ${d.fecha_programada}. ` +
      'Ya aparece en el calendario. Ahora hay que crearle su contenedor.',
  };
}

/* ==========================================================================
   CREAR UN PACKING LIST DENTRO DE UN EMBARQUE
   ========================================================================== */

export type DatosPackingNuevo = {
  embarque_id: number;
  contenedor: string | null;
  precinto: string | null;
  filas_contenedor: number;
  sacos_por_fila: number;
  supervisor_id: string | null;
  turno: 'dia' | 'noche';
  fecha_carga: string | null;
};

export async function crearPacking(d: DatosPackingNuevo): Promise<Resultado> {
  const permiso = await autorizar('crear packing lists');
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  if (!d.embarque_id) return { ok: false, mensaje: 'Falta el embarque.' };
  if (!(d.filas_contenedor > 0) || !(d.sacos_por_fila > 0)) {
    return { ok: false, mensaje: 'La capacidad del contenedor tiene que ser mayor que cero.' };
  }

  const supabase = await crearClienteServidor();

  const { data: emb } = await supabase
    .from('embarques').select('numero, estado').eq('id', d.embarque_id).maybeSingle();
  if (!emb) return { ok: false, mensaje: 'Ese embarque ya no existe.' };
  if (emb.estado === 'despachado') {
    return { ok: false, mensaje: `El embarque ${emb.numero} ya se despachó: no admite contenedores nuevos.` };
  }

  /* ---- El código sigue el formato de la casa: PL POT### ---- */
  const { data: ultimo } = await supabase
    .from('packing_lists').select('codigo').like('codigo', 'PL POT%')
    .order('codigo', { ascending: false }).limit(1).maybeSingle();

  const n = Number(String(ultimo?.codigo ?? 'PL POT000').replace('PL POT', '')) || 0;
  const codigo = `PL POT${String(n + 1).padStart(3, '0')}`;

  const { data: packing, error } = await supabase
    .from('packing_lists')
    .insert({
      codigo,
      embarque_id: d.embarque_id,
      contenedor: d.contenedor?.trim() || null,
      precinto: d.precinto?.trim() || null,
      filas_contenedor: d.filas_contenedor,
      sacos_por_fila: d.sacos_por_fila,
      supervisor_id: d.supervisor_id || null,
      turno: d.turno,
      fecha_carga: d.fecha_carga || null,
      estado: 'abierto',
      creado_por: permiso.usuario!.id,
    })
    .select('id')
    .single();

  if (error || !packing) {
    if (error?.code === '23505') {
      return { ok: false, mensaje: `Ya existe un packing con el código ${codigo}. Vuelva a intentarlo.` };
    }
    return { ok: false, mensaje: `No se pudo crear el packing: ${error?.message}` };
  }

  // El embarque pasa a estar en preparación: ya se está armando su carga.
  if (emb.estado === 'planificado' || emb.estado === 'confirmado') {
    await supabase.from('embarques').update({ estado: 'en_preparacion' }).eq('id', d.embarque_id);
  }

  refrescar(d.embarque_id);
  revalidatePath(`/logistica/packing/${packing.id}`);

  return {
    ok: true,
    id: packing.id as number,
    numero: codigo,
    mensaje:
      `Contenedor ${codigo} creado para el embarque ${emb.numero}. ` +
      'Ahora hay que cargarle los pallets y armar su plano de estiba.',
  };
}

/* ==========================================================================
   AYUDAS PARA EL FORMULARIO
   ========================================================================== */

/** Los pedidos que se pueden meter en un embarque desde esa bodega. */
export type PedidoEmbarcable = {
  id: number;
  numero: string;
  cliente: string;
  destino: string;
  tm_pedidas: number;
  tm_reservadas: number;
  fecha_comprometida: string | null;
  /**
   * En qué bodegas está el stock que se le apartó, con sus kilos.
   *
   * Es lo que evita el error más caro de esta pantalla: un embarque sale de
   * UNA bodega, y si el pedido tiene la mercadería repartida entre dos, solo
   * se podrá cargar la parte que esté en la bodega elegida. El resto necesita
   * un traslado antes, y eso se decide ahora, no el día de la carga.
   */
  bodegas: { almacen_id: number; nombre: string; kg: number }[];
};

export async function pedidosParaEmbarcar(almacenId: number): Promise<PedidoEmbarcable[]> {
  const supabase = await crearClienteServidor();

  /*
   * El filtro va EN LA CONSULTA, no después de traer las filas.
   *
   * Antes se pedían los 120 pedidos con la fecha comprometida más próxima y
   * recién ahí se descartaban los que no tenían reserva. Con 436 pedidos en
   * el sistema, uno creado hoy quedaba fuera de esos 120 y no aparecía nunca
   * en esta lista, por mucho que estuviera cubierto al 50 %. El corte se
   * comía justo lo que se acababa de apartar.
   */
  const { data } = await supabase
    .from('v_pedidos_tablero')
    .select('id, numero_proforma, cliente, destino, tm_pedidas, tm_reservadas, fecha_comprometida')
    .gt('tm_reservadas', 0)
    .order('fecha_comprometida', { ascending: true })
    .limit(300);

  const conReserva = data ?? [];

  // Los que ya están en algún embarque no se vuelven a ofrecer.
  const { data: yaPuestos } = await supabase.from('embarque_pedidos').select('pedido_id');
  const puestos = new Set((yaPuestos ?? []).map((x) => Number(x.pedido_id)));

  const almacenNum = Number(almacenId);
  void almacenNum; // La bodega ya filtra los lotes; aquí solo se listan pedidos.

  const candidatos = conReserva.filter((p) => !puestos.has(Number(p.id)));
  const ids = candidatos.map((p) => Number(p.id));

  /* ---- Dónde está físicamente lo que se apartó a cada pedido ---- */
  const { data: reservas } = ids.length
    ? await supabase
        .from('reservas')
        .select('peso_neto_kg, almacen_id, almacenes(nombre), pedido_lineas!inner(pedido_id)')
        .in('estado', ['activa', 'en_preparacion'])
        .in('pedido_lineas.pedido_id', ids)
    : { data: [] };

  const porPedido = new Map<number, Map<number, { nombre: string; kg: number }>>();
  for (const r of reservas ?? []) {
    const pl = Array.isArray(r.pedido_lineas) ? r.pedido_lineas[0] : r.pedido_lineas;
    const alm = Array.isArray(r.almacenes) ? r.almacenes[0] : r.almacenes;
    const pedidoId = Number(pl?.pedido_id);
    const almacen = Number(r.almacen_id);
    if (!porPedido.has(pedidoId)) porPedido.set(pedidoId, new Map());
    const mapa = porPedido.get(pedidoId)!;
    const previo = mapa.get(almacen) ?? { nombre: String(alm?.nombre ?? '—'), kg: 0 };
    previo.kg += Number(r.peso_neto_kg ?? 0);
    mapa.set(almacen, previo);
  }

  return candidatos
    .map((p) => ({
      id: p.id as number,
      numero: p.numero_proforma as string,
      cliente: (p.cliente as string) ?? '—',
      destino: (p.destino as string) ?? '—',
      tm_pedidas: Number(p.tm_pedidas ?? 0),
      tm_reservadas: Number(p.tm_reservadas ?? 0),
      fecha_comprometida: (p.fecha_comprometida as string) ?? null,
      bodegas: [...(porPedido.get(Number(p.id)) ?? new Map()).entries()]
        .map(([almacen_id, v]) => ({ almacen_id, nombre: v.nombre, kg: v.kg }))
        .sort((a, b) => b.kg - a.kg),
    }))
    .sort((a, b) => (b.tm_reservadas / (b.tm_pedidas || 1)) - (a.tm_reservadas / (a.tm_pedidas || 1)));
}
