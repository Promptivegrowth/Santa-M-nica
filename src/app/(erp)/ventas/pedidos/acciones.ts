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
  if (datos.tipo_cambio <= 0) {
    return { ok: false, mensaje: 'El tipo de cambio debe ser mayor que cero.', campo: 'tipo_cambio' };
  }
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
      costo_estimado_tm: 0,
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
