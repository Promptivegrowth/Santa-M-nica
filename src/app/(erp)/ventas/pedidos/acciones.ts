'use server';

/**
 * ============================================================================
 *  ACCIONES DE PEDIDO
 * ============================================================================
 *  Un pedido —lo que en Santa Mónica se llama PROFORMA— puede nacer por dos
 *  caminos, y los dos son legítimos:
 *
 *   1. DESDE UNA COTIZACIÓN
 *      Hubo negociación previa. El cliente recibió una oferta, la aceptó, y
 *      se pulsa «Convertir». El pedido hereda todo sin retipear nada.
 *      (Esa lógica vive en ventas/cotizaciones/acciones.ts)
 *
 *   2. DIRECTO
 *      El cliente habitual pide sin negociar. Aquí se registra el pedido de
 *      una vez, sin inventarse una cotización que nunca existió.
 *
 *  ¿Por qué importa la distinción? Porque el indicador «conversión de
 *  cotizaciones» solo tiene sentido si mide las ofertas que de verdad se
 *  hicieron. Si obligáramos a crear una cotización falsa para cada pedido
 *  directo, ese número diría siempre 100 % y no serviría para nada.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { columnasContacto, type ContactoDocumento } from '@/lib/contactoDocumento';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { revisarTipoCambio } from '@/lib/moneda';
import { hoyEnLima } from '@/lib/fechas';
import { puedeVender, type Rol } from '@/lib/navegacion';

export type LineaPedido = {
  sku_presentacion_id: number;
  cantidad_tm: number;
  precio_lista_tm: number;
  precio_tm: number;
  descuento_pct: number;
};

export type DatosPedido = {
  cliente_id: number;
  vendedor_id: number | null;
  destino_id: number | null;
  moneda: 'USD' | 'PEN';
  tipo_cambio: number;
  incoterm: 'EXW' | 'FOB' | 'CFR' | 'CIF' | 'DAP';
  oc_cliente: string | null;
  prioridad: 'baja' | 'normal' | 'alta' | 'urgente';
  fecha_solicitada: string;
  fecha_comprometida: string;
  observaciones: string | null;
  /** Opcional: el pedido se registra igual sin contacto. */
  contacto?: ContactoDocumento;
  /** Opcional: cuentas de cobro que se imprimirán en la proforma. */
  cuentas?: number[];
  lineas: LineaPedido[];
  /**
   * De qué día es el tipo de cambio y si lo trajo SUNAT o se escribió a mano.
   * La cotización ya lo guardaba; el pedido directo lo perdía y su ficha
   * decía «Anterior al tipo de cambio automático» aunque se hubiera traído de
   * SUNAT ese mismo día. Lo encontró la revisión de la Guía de uso.
   */
  tipo_cambio_fecha?: string | null;
  tipo_cambio_fuente?: 'sunat' | 'manual' | null;
  tipo_cambio_clase?: 'compra' | 'venta' | null;
};

export type Resultado =
  | { ok: true; id: number; numero: string; mensaje: string }
  | { ok: false; mensaje: string; campo?: string };

/* ==========================================================================
   CREAR PEDIDO DIRECTO
   ========================================================================== */
export async function crearPedidoDirecto(datos: DatosPedido): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró. Vuelva a iniciar sesión.' };

  if (!puedeVender(usuario.rol as Rol)) {
    return {
      ok: false,
      mensaje: 'Su rol no puede registrar pedidos. Esta acción corresponde a Comercial, Comex, Operaciones o Gerencia.',
    };
  }

  /* ---- Validación en el servidor ---- */
  if (!datos.cliente_id) {
    return { ok: false, mensaje: 'Elija el cliente que hace el pedido.', campo: 'cliente' };
  }
  if (!datos.lineas.length) {
    return { ok: false, mensaje: 'Agregue al menos un producto al pedido.', campo: 'lineas' };
  }
  /*
   * El tipo de cambio son soles por dólar, siempre. Un documento en soles con
   * un «1» aquí no se puede convertir después, y de ahí salían totales que
   * mezclaban monedas. La base lo rechaza igual, pero su mensaje no le sirve a
   * un comercial.
   */
  const problemaTc = revisarTipoCambio(datos.tipo_cambio);
  if (problemaTc) {
    return { ok: false, mensaje: problemaTc, campo: 'tipo_cambio' };
  }
  //  Solo dos orígenes posibles; lo que no sea SUNAT se guarda como escrito a mano.
  const fuenteTc: 'sunat' | 'manual' = datos.tipo_cambio_fuente === 'sunat' ? 'sunat' : 'manual';
  const fechaTc = datos.tipo_cambio_fecha && /^\d{4}-\d{2}-\d{2}$/.test(datos.tipo_cambio_fecha)
    ? datos.tipo_cambio_fecha : hoyEnLima();
  const claseTc = fuenteTc === 'sunat' ? (datos.tipo_cambio_clase === 'compra' ? 'compra' : 'venta') : null;

  if (!datos.fecha_solicitada || !datos.fecha_comprometida) {
    return { ok: false, mensaje: 'Indique la fecha de solicitud y la fecha comprometida.', campo: 'fechas' };
  }
  if (datos.fecha_comprometida < datos.fecha_solicitada) {
    return {
      ok: false,
      mensaje: 'La fecha comprometida no puede ser anterior a la de solicitud.',
      campo: 'fechas',
    };
  }

  for (const [i, l] of datos.lineas.entries()) {
    const n = i + 1;
    if (!l.sku_presentacion_id) {
      return { ok: false, mensaje: `La línea ${n} no tiene producto seleccionado.`, campo: 'lineas' };
    }
    if (!(l.cantidad_tm > 0)) {
      return { ok: false, mensaje: `La cantidad de la línea ${n} debe ser mayor que cero.`, campo: 'lineas' };
    }
    if (l.descuento_pct < 0 || l.descuento_pct > 100) {
      return { ok: false, mensaje: `El descuento de la línea ${n} debe estar entre 0 y 100 %.`, campo: 'lineas' };
    }
  }

  const supabase = await crearClienteServidor();

  /* ---- Control de descuento ---- */
  const { data: pDesc } = await supabase
    .from('parametros').select('valor').eq('clave', 'descuento_max_sin_autorizacion').single();
  const topeDescuento = Number(pDesc?.valor ?? 3);
  const requiereAutorizacion = datos.lineas.some((l) => l.descuento_pct > topeDescuento);

  if (requiereAutorizacion && !['gerencia', 'operaciones'].includes(usuario.rol)) {
    return {
      ok: false,
      mensaje: `Hay líneas con descuento superior al ${topeDescuento} % permitido sin autorización. Pida a Gerencia u Operaciones que lo registre, o baje el descuento.`,
      campo: 'lineas',
    };
  }

  /* ---- Un pedido es un compromiso: el crédito del cliente sí importa ---- */
  const { data: cliente } = await supabase
    .from('clientes')
    .select('razon_social, bloqueado, motivo_bloqueo, dias_credito')
    .eq('id', datos.cliente_id)
    .single();

  if (cliente?.bloqueado) {
    return {
      ok: false,
      mensaje: `${cliente.razon_social} tiene el crédito bloqueado: ${cliente.motivo_bloqueo ?? 'sin motivo registrado'}. No se puede comprometer entrega hasta regularizarlo.`,
      campo: 'cliente',
    };
  }

  /* ---- Número de proforma ---- */
  const anio = String(new Date().getFullYear()).slice(2);
  /*
   * El número lo da la base, no una cuenta de filas: contar fallaba en cuanto
   * había huecos en la numeración, y dos personas guardando a la vez obtenían
   * el mismo número.
   */
  const { data: correlativo, error: errNum } = await supabase.rpc('siguiente_correlativo', {
    p_serie: 'SM',
    p_anio: new Date().getFullYear(),
  });
  if (errNum || correlativo === null) {
    return { ok: false, mensaje: 'No se pudo reservar el número de proforma. Vuelva a intentarlo.' };
  }
  const numeroProforma = `SM${anio}-${Number(correlativo)}`;

  /* ---- Cabecera ----
     cotizacion_id queda en NULL a propósito: es lo que distingue un pedido
     directo de uno que vino de una oferta, y lo que permite que el indicador
     de conversión mida algo real. */
  const { data: pedido, error: errCab } = await supabase
    .from('pedidos')
    .insert({
      numero_proforma: numeroProforma,
      cotizacion_id: null,
      cliente_id: datos.cliente_id,
      vendedor_id: datos.vendedor_id,
      oc_cliente: datos.oc_cliente,
      moneda: datos.moneda,
      tipo_cambio: datos.tipo_cambio,
      tipo_cambio_fecha: fechaTc,
      tipo_cambio_fuente: fuenteTc,
      tipo_cambio_clase: claseTc,
      incoterm: datos.incoterm,
      destino_id: datos.destino_id,
      tipo_despacho: datos.incoterm === 'EXW' ? 'mercado_nacional' : 'exportacion',
      dias_credito: cliente?.dias_credito ?? 0,
      condicion_pago:
        (cliente?.dias_credito ?? 0) > 0 ? `Crédito ${cliente?.dias_credito} días` : 'Contado',
      prioridad: datos.prioridad,
      fecha_solicitada: datos.fecha_solicitada,
      fecha_comprometida: datos.fecha_comprometida,
      ciclo: 'pendiente_validacion',
      cobertura: 'pendiente_stock',
      situacion: 'sin_facturar',
      observaciones: datos.observaciones,
      ...columnasContacto(datos.contacto),
      creado_por: usuario.id,
    })
    .select('id, numero_proforma')
    .single();

  if (errCab || !pedido) {
    return {
      ok: false,
      mensaje: /policy/i.test(errCab?.message ?? '')
        ? 'Su rol no tiene permiso para crear pedidos.'
        : `No se pudo guardar el pedido: ${errCab?.message}`,
    };
  }

  /* ---- Líneas ---- */
  const { error: errLin } = await supabase.from('pedido_lineas').insert(
    datos.lineas.map((l, i) => ({
      pedido_id: pedido.id,
      sku_presentacion_id: l.sku_presentacion_id,
      cantidad_tm: l.cantidad_tm,
      precio_lista_tm: l.precio_lista_tm,
      precio_tm: l.precio_tm,
      descuento_pct: l.descuento_pct,
      descuento_autorizado_por: l.descuento_pct > topeDescuento ? usuario.id : null,
      /*
       * Sin costo aquí a propósito (067): el disparador de la base pone el
       * costo vigente de Finanzas para ese producto, o 0 si no hay. Así
       * también lo tienen los pedidos que registra Comex, que no ve costos.
       */
      costo_estimado_tm: null,
      orden: i + 1,
    }))
  );

  if (errLin) {
    // Una cabecera sin líneas no sirve de nada: se deshace
    await supabase.from('pedidos').delete().eq('id', pedido.id);
    return { ok: false, mensaje: `No se pudieron guardar las líneas: ${errLin.message}` };
  }

  /*
   * Las cuentas de cobro que se imprimirán en la proforma. Se guardan aparte
   * porque son muchas a muchas: una proforma puede llevar la cuenta en
   * dólares y la de detracción a la vez.
   */
  if (datos.cuentas?.length) {
    await supabase
      .from('pedido_cuentas')
      .insert(datos.cuentas.map((cuenta_id) => ({ pedido_id: pedido.id, cuenta_id })));
  }

  revalidatePath('/ventas/pedidos');
  revalidatePath('/panel');

  return {
    ok: true,
    id: pedido.id as number,
    numero: pedido.numero_proforma as string,
    mensaje: `Pedido ${pedido.numero_proforma} registrado con ${datos.lineas.length} línea(s).`,
  };
}

/* ==========================================================================
   CONFIRMAR Y CANCELAR UN PEDIDO
   --------------------------------------------------------------------------
   Todo pedido nace «pendiente de validación» (o «borrador»), pero no había
   ninguna pantalla para confirmarlo, y el Control de pedidos, el backorder,
   las necesidades de producción y los tableros solo cuentan los
   CONFIRMADOS. Un pedido nuevo se quedaba fuera de todo eso. Lo encontró la
   revisión de la Guía de uso.

   Validar es una decisión de jefatura —el precio, el crédito, la fecha—, así
   que la toman Gerencia y Operaciones, no quien vendió.
   ========================================================================== */
const PUEDEN_VALIDAR = ['gerencia', 'operaciones'];

export async function confirmarPedido(id: number): Promise<{ ok: boolean; mensaje: string }> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró.' };
  if (!PUEDEN_VALIDAR.includes(usuario.rol)) {
    return { ok: false, mensaje: 'Confirmar un pedido corresponde a Gerencia u Operaciones.' };
  }
  const supabase = await crearClienteServidor();
  const { data: p } = await supabase
    .from('pedidos').select('numero_proforma, ciclo, clientes(razon_social, bloqueado, motivo_bloqueo), pedido_lineas(id)')
    .eq('id', id).maybeSingle();
  if (!p) return { ok: false, mensaje: 'Ese pedido no existe.' };
  if (!['borrador', 'pendiente_validacion'].includes(String(p.ciclo))) {
    return { ok: false, mensaje: `${p.numero_proforma} ya está ${String(p.ciclo).replace('_', ' ')}.` };
  }
  const cli = Array.isArray(p.clientes) ? p.clientes[0] : p.clientes;
  if (cli?.bloqueado) {
    return { ok: false, mensaje: `${cli.razon_social} tiene el crédito bloqueado (${cli.motivo_bloqueo ?? 'sin motivo'}): no se puede confirmar.` };
  }
  if (!(p.pedido_lineas ?? []).length) return { ok: false, mensaje: 'El pedido no tiene productos.' };

  const { data, error } = await supabase.from('pedidos').update({ ciclo: 'confirmado' }).eq('id', id).select('id');
  if (error) return { ok: false, mensaje: `No se pudo confirmar: ${error.message}` };
  if (!data?.length) return { ok: false, mensaje: 'No tiene permiso para modificar este pedido.' };

  await supabase.rpc('registrar_evento', {
    p_entidad: 'pedidos', p_entidad_id: id, p_tipo: 'pedido_confirmado',
    p_descripcion: `${usuario.nombre} confirmó el pedido ${p.numero_proforma}.`, p_severidad: 'info',
  }).then(() => undefined, () => undefined);

  revalidatePath('/ventas/pedidos');
  revalidatePath(`/ventas/pedidos/${id}`);
  revalidatePath('/ventas/control');
  return { ok: true, mensaje: `${p.numero_proforma} confirmado. Ya cuenta en el Control de pedidos y en las necesidades de producción.` };
}

/**
 * Cancelar: con motivo, y soltando lo que tenía apartado para que vuelva a
 * estar disponible. No se cancela lo que ya salió ni lo que está metido en un
 * embarque vivo: primero hay que sacarlo de ahí.
 */
export async function cancelarPedido(id: number, motivo: string): Promise<{ ok: boolean; mensaje: string }> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró.' };
  if (!PUEDEN_VALIDAR.includes(usuario.rol)) {
    return { ok: false, mensaje: 'Cancelar un pedido corresponde a Gerencia u Operaciones.' };
  }
  const limpio = motivo.trim();
  if (limpio.length < 5) return { ok: false, mensaje: 'Explique por qué se cancela (al menos 5 caracteres): queda en el historial.' };

  const supabase = await crearClienteServidor();
  const { data: p } = await supabase.from('pedidos').select('numero_proforma, ciclo').eq('id', id).maybeSingle();
  if (!p) return { ok: false, mensaje: 'Ese pedido no existe.' };
  if (['despachado', 'cerrado', 'cancelado'].includes(String(p.ciclo))) {
    return { ok: false, mensaje: `${p.numero_proforma} ya está ${p.ciclo}: no se puede cancelar.` };
  }
  const { data: emb } = await supabase
    .from('embarque_pedidos').select('embarques!inner(numero, estado)').eq('pedido_id', id).neq('embarques.estado', 'cancelado');
  if ((emb ?? []).length) {
    const e = (emb ?? []).map((x) => (Array.isArray(x.embarques) ? x.embarques[0] : x.embarques)?.numero).join(', ');
    return { ok: false, mensaje: `${p.numero_proforma} está en el embarque ${e}. Sáquelo del embarque antes de cancelar.` };
  }

  //  Lo apartado vuelve a estar disponible, con el motivo en cada reserva.
  const { data: reservas } = await supabase
    .from('reservas').select('id, pedido_lineas!inner(pedido_id)').eq('pedido_lineas.pedido_id', id).in('estado', ['activa', 'en_preparacion']);
  for (const r of reservas ?? []) {
    const { error } = await supabase.rpc('reserva_liberar', { p_reserva_id: r.id, p_motivo: `Pedido ${p.numero_proforma} cancelado: ${limpio}` });
    if (error) return { ok: false, mensaje: `No se pudo soltar una reserva: ${error.message}` };
  }

  const { data, error } = await supabase.from('pedidos').update({ ciclo: 'cancelado' }).eq('id', id).select('id');
  if (error) return { ok: false, mensaje: `No se pudo cancelar: ${error.message}` };
  if (!data?.length) return { ok: false, mensaje: 'No tiene permiso para modificar este pedido.' };

  await supabase.rpc('registrar_evento', {
    p_entidad: 'pedidos', p_entidad_id: id, p_tipo: 'pedido_cancelado',
    p_descripcion: `${usuario.nombre} canceló el pedido ${p.numero_proforma}: ${limpio}`, p_severidad: 'advertencia',
  }).then(() => undefined, () => undefined);

  revalidatePath('/ventas/pedidos');
  revalidatePath(`/ventas/pedidos/${id}`);
  revalidatePath('/ventas/control');
  revalidatePath('/almacenes/reservas');
  return {
    ok: true,
    mensaje: `${p.numero_proforma} cancelado.${(reservas ?? []).length ? ` Se soltaron ${(reservas ?? []).length} reserva(s): ese stock vuelve a estar disponible.` : ''}`,
  };
}
