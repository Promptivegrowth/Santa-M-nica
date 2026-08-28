'use server';

/**
 * ============================================================================
 *  EMITIR COMPROBANTES Y REGISTRAR COBRANZAS
 * ============================================================================
 *  QUÉ COMPROBANTE SALE, LO DECIDE EL DATO
 *  No hay un desplegable donde elegir «factura» o «boleta». Se deduce del país
 *  y del RUC del cliente, que es como funciona de verdad:
 *
 *    · Cliente del extranjero        → factura de exportación, IGV 0 %.
 *    · Peruano con RUC de 11 dígitos → factura electrónica, IGV 18 %.
 *    · Peruano sin RUC               → boleta de venta, IGV 18 %.
 *
 *  Poner esa elección en manos de quien factura solo abre la puerta a emitir
 *  una boleta a una empresa, que no le sirve porque no da crédito fiscal.
 *
 *  LOS IMPORTES SALEN DEL PEDIDO, NO SE ESCRIBEN
 *  Se copian de las líneas del pedido y los totales se calculan aquí. Escribir
 *  a mano el total de una factura es exactamente el error que el verificador
 *  de documentos detecta después; mejor no cometerlo.
 *
 *  NO SE FACTURA DOS VECES EL MISMO PEDIDO
 *  Se comprueba antes. Si hiciera falta un segundo comprobante —una entrega
 *  parcial— eso es otra cosa y hoy no está: se dice claro en vez de dejar
 *  duplicar por descuido.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { hoyEnLima, desplazarDias } from '@/lib/fechas';

export type Resultado =
  | { ok: true; id: number; numero: string; mensaje: string }
  | { ok: false; mensaje: string; detalles?: string[] };

const PUEDEN_FACTURAR = ['gerencia', 'operaciones', 'comercial'];
const PUEDEN_COBRAR = ['gerencia', 'operaciones'];

/** El IGV vigente. Sale de los parámetros para no quedar escrito en el código. */
async function porcentajeIgv(): Promise<number> {
  const supabase = await crearClienteServidor();
  const { data } = await supabase
    .from('parametros').select('valor').eq('clave', 'igv_porcentaje').maybeSingle();
  return Number(data?.valor ?? 18);
}

function refrescar(id?: number) {
  revalidatePath('/finanzas/facturas');
  revalidatePath('/finanzas/cobranzas');
  if (id) revalidatePath(`/finanzas/facturas/${id}`);
  revalidatePath('/ventas/pedidos');
  revalidatePath('/panel');
  revalidatePath('/reportes');
}

const redondear = (n: number) => Math.round(n * 100) / 100;

/* ==========================================================================
   VISTA PREVIA · qué se va a emitir
   ========================================================================== */
export type Previa = {
  puede: boolean;
  pedido: string;
  cliente: string;
  identificacion: string;
  pais: string;
  tipo: 'factura' | 'boleta';
  titulo: string;
  moneda: string;
  igvPct: number;
  subtotal: number;
  igv: number;
  total: number;
  lineas: { producto: string; tm: number; precio: number; importe: number }[];
  vencimiento: string;
  impedimentos: string[];
  avisos: string[];
};

export async function previaFactura(pedidoId: number): Promise<Previa | null> {
  const supabase = await crearClienteServidor();

  const { data: pedido } = await supabase
    .from('pedidos')
    .select('id, numero_proforma, moneda, tipo_cambio, dias_credito, situacion, clientes(razon_social, pais, ruc_tax_id, dias_credito)')
    .eq('id', pedidoId)
    .maybeSingle();

  if (!pedido) return null;

  const cliente = Array.isArray(pedido.clientes) ? pedido.clientes[0] : pedido.clientes;
  const pais = String(cliente?.pais ?? '');
  const ruc = String(cliente?.ruc_tax_id ?? '');
  const esExportacion = pais !== 'Perú';
  const esFactura = esExportacion || /^\d{11}$/.test(ruc);

  const { data: lineas } = await supabase
    .from('pedido_lineas')
    .select('id, cantidad_tm, precio_tm, descuento_pct, sku_presentaciones(skus(codigo, corte, especies(nombre)))')
    .eq('pedido_id', pedidoId)
    .order('orden');

  const { data: yaFacturado } = await supabase
    .from('facturas').select('numero').eq('pedido_id', pedidoId).neq('estado', 'anulada').maybeSingle();

  const impedimentos: string[] = [];
  const avisos: string[] = [];

  if (yaFacturado) {
    impedimentos.push(`Este pedido ya tiene el comprobante ${yaFacturado.numero} emitido.`);
  }
  if (!lineas?.length) impedimentos.push('El pedido no tiene líneas de producto.');

  // Facturar antes de despachar es legal, pero conviene saberlo.
  const { count: despachos } = await supabase
    .from('embarque_pedidos').select('pedido_id', { count: 'exact', head: true }).eq('pedido_id', pedidoId);
  if ((despachos ?? 0) === 0) {
    avisos.push('Este pedido todavía no está asociado a ningún embarque: se facturaría antes de despachar.');
  }
  if (!esExportacion && !/^\d{11}$/.test(ruc)) {
    avisos.push(
      'El cliente es peruano y no tiene RUC válido, así que se emitirá BOLETA. ' +
      'Si es una empresa, cargue su RUC en el maestro antes de emitir.'
    );
  }

  const igvPct = esExportacion ? 0 : await porcentajeIgv();

  const detalle = (lineas ?? []).map((l) => {
    const sp = Array.isArray(l.sku_presentaciones) ? l.sku_presentaciones[0] : l.sku_presentaciones;
    const sku = Array.isArray(sp?.skus) ? sp.skus[0] : sp?.skus;
    const esp = Array.isArray(sku?.especies) ? sku.especies[0] : sku?.especies;
    const tm = Number(l.cantidad_tm);
    const precio = Number(l.precio_tm);
    const desc = Number(l.descuento_pct ?? 0) / 100;
    return {
      producto: `${sku?.codigo ?? ''} · ${esp?.nombre ?? ''} · ${sku?.corte ?? ''}`,
      tm, precio,
      importe: redondear(tm * precio * (1 - desc)),
    };
  });

  const subtotal = redondear(detalle.reduce((s, l) => s + l.importe, 0));
  const igv = redondear(subtotal * (igvPct / 100));
  const total = redondear(subtotal + igv);

  const dias = Number(pedido.dias_credito ?? cliente?.dias_credito ?? 0);
  const vencimiento = desplazarDias(hoyEnLima(), dias);

  return {
    puede: impedimentos.length === 0,
    pedido: pedido.numero_proforma as string,
    cliente: (cliente?.razon_social as string) ?? '—',
    identificacion: ruc || '—',
    pais,
    tipo: esFactura ? 'factura' : 'boleta',
    titulo: esFactura
      ? esExportacion ? 'Factura de exportación' : 'Factura electrónica'
      : 'Boleta de venta',
    moneda: pedido.moneda as string,
    igvPct,
    subtotal, igv, total,
    lineas: detalle,
    vencimiento,
    impedimentos,
    avisos,
  };
}

/* ==========================================================================
   EMITIR
   ========================================================================== */
export async function emitirComprobante(pedidoId: number): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión caducó. Vuelva a entrar.' };
  if (!PUEDEN_FACTURAR.includes(usuario.rol)) {
    return { ok: false, mensaje: `Su rol (${usuario.rol}) no puede emitir comprobantes.` };
  }

  const previa = await previaFactura(pedidoId);
  if (!previa) return { ok: false, mensaje: 'Ese pedido ya no existe.' };
  if (!previa.puede) {
    return { ok: false, mensaje: 'No se puede emitir el comprobante.', detalles: previa.impedimentos };
  }

  const supabase = await crearClienteServidor();

  /* ---- El correlativo, de a uno ----
     Serie F para factura, B para boleta: es lo que corresponde en el Perú. */
  const anio = new Date().getFullYear();
  const serie = previa.tipo === 'factura' ? 'F001' : 'B001';
  const { data: correlativo, error: errNum } = await supabase
    .rpc('siguiente_correlativo', { p_serie: serie, p_anio: anio });
  if (errNum) return { ok: false, mensaje: `No se pudo reservar el número: ${errNum.message}` };

  const numero = `${serie}-${String(correlativo).padStart(6, '0')}`;

  const { data: pedido } = await supabase
    .from('pedidos').select('cliente_id, moneda, tipo_cambio').eq('id', pedidoId).maybeSingle();

  // Entre la vista previa y este momento alguien pudo borrarlo. Es improbable
  // y aun así se comprueba: emitir contra un pedido inexistente dejaría una
  // factura huérfana.
  if (!pedido) return { ok: false, mensaje: 'Ese pedido ya no existe.' };

  const { data: factura, error } = await supabase
    .from('facturas')
    .insert({
      numero,
      pedido_id: pedidoId,
      cliente_id: pedido.cliente_id,
      moneda: pedido.moneda,
      tipo_cambio: pedido.tipo_cambio ?? 1,
      subtotal: previa.subtotal,
      igv: previa.igv,
      total: previa.total,
      // En Lima, no en UTC: una factura emitida a las siete de la tarde
      // salía fechada al día siguiente, o sea en otro período fiscal.
      fecha_emision: hoyEnLima(),
      fecha_vencimiento: previa.vencimiento,
      estado: 'emitida',
      tipo_comprobante: previa.tipo,
      creado_por: usuario.id,
    })
    .select('id')
    .single();

  if (error || !factura) {
    return { ok: false, mensaje: `No se pudo emitir: ${error?.message}` };
  }

  /* ---- Las líneas, copiadas del pedido ---- */
  const { data: lineasPedido } = await supabase
    .from('pedido_lineas')
    .select('id, sku_presentacion_id, cantidad_tm, precio_tm, descuento_pct')
    .eq('pedido_id', pedidoId)
    .order('orden');

  const { error: errLin } = await supabase.from('factura_lineas').insert(
    (lineasPedido ?? []).map((l) => ({
      factura_id: factura.id,
      pedido_linea_id: l.id,
      sku_presentacion_id: l.sku_presentacion_id,
      cantidad_tm: l.cantidad_tm,
      precio_tm: l.precio_tm,
      importe: redondear(
        Number(l.cantidad_tm) * Number(l.precio_tm) * (1 - Number(l.descuento_pct ?? 0) / 100)
      ),
    }))
  );

  if (errLin) {
    // Una factura sin líneas no cuadra con nada: se deshace entera.
    await supabase.from('facturas').delete().eq('id', factura.id);
    return { ok: false, mensaje: `No se pudieron copiar las líneas: ${errLin.message}` };
  }

  await supabase.from('pedidos').update({ situacion: 'facturado' }).eq('id', pedidoId);

  await supabase.rpc('registrar_evento', {
    p_entidad: 'facturas',
    p_entidad_id: factura.id,
    p_tipo: 'comprobante_emitido',
    p_descripcion:
      `${previa.titulo} ${numero} por ${previa.moneda} ${previa.total.toLocaleString('es-PE', { minimumFractionDigits: 2 })} ` +
      `a ${previa.cliente}, del pedido ${previa.pedido}`,
    p_severidad: 'info',
    p_metadatos: { numero, tipo: previa.tipo, total: previa.total, moneda: previa.moneda },
  }).then(() => undefined, () => undefined);

  refrescar(factura.id as number);

  return {
    ok: true,
    id: factura.id as number,
    numero,
    mensaje:
      `${previa.titulo} ${numero} emitida por ${previa.moneda} ` +
      `${previa.total.toLocaleString('es-PE', { minimumFractionDigits: 2 })}` +
      (previa.igv > 0 ? ` (IGV ${previa.igvPct} % incluido)` : ' (exportación, sin IGV)') +
      `. Vence el ${previa.vencimiento}.`,
  };
}

/* ==========================================================================
   ANULAR
   ========================================================================== */
export async function anularComprobante(facturaId: number, motivo: string): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión caducó.' };
  if (!PUEDEN_COBRAR.includes(usuario.rol)) {
    return { ok: false, mensaje: `Su rol (${usuario.rol}) no puede anular comprobantes.` };
  }
  if (!motivo?.trim() || motivo.trim().length < 5) {
    return { ok: false, mensaje: 'Escriba el motivo de la anulación: es un requisito contable.' };
  }

  const supabase = await crearClienteServidor();
  const { data: f } = await supabase
    .from('facturas').select('numero, estado, total').eq('id', facturaId).maybeSingle();

  if (!f) return { ok: false, mensaje: 'Ese comprobante ya no existe.' };
  if (f.estado === 'anulada') return { ok: false, mensaje: `${f.numero} ya está anulada.` };

  const { data: pagos } = await supabase
    .from('cobranzas').select('monto').eq('factura_id', facturaId);
  const cobrado = (pagos ?? []).reduce((s, c) => s + Number(c.monto), 0);

  if (cobrado > 0) {
    return {
      ok: false,
      mensaje:
        `${f.numero} tiene ${cobrado.toLocaleString('es-PE', { minimumFractionDigits: 2 })} ya cobrados. ` +
        'Anular un comprobante con pagos aplicados descuadraría la caja: primero hay que revertir los pagos.',
    };
  }

  const { error } = await supabase
    .from('facturas')
    .update({
      estado: 'anulada',
      anulada_por: usuario.id,
      anulada_en: new Date().toISOString(),
      motivo_anulacion: motivo.trim(),
    })
    .eq('id', facturaId);

  if (error) return { ok: false, mensaje: `No se pudo anular: ${error.message}` };

  refrescar(facturaId);
  return { ok: true, id: facturaId, numero: f.numero as string, mensaje: `${f.numero} anulada.` };
}

/* ==========================================================================
   COBRANZAS
   ========================================================================== */
export type DatosCobranza = {
  factura_id: number;
  monto: number;
  fecha: string;
  medio: string | null;
  referencia: string | null;
  observaciones: string | null;
};

export async function registrarCobranza(d: DatosCobranza): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión caducó.' };
  if (!PUEDEN_COBRAR.includes(usuario.rol)) {
    return { ok: false, mensaje: `Su rol (${usuario.rol}) no puede registrar cobranzas.` };
  }
  if (!(d.monto > 0)) return { ok: false, mensaje: 'El monto tiene que ser mayor que cero.' };
  if (!d.fecha) return { ok: false, mensaje: 'Indique la fecha del pago.' };

  const supabase = await crearClienteServidor();

  const { data: f } = await supabase
    .from('facturas').select('numero, total, estado, moneda').eq('id', d.factura_id).maybeSingle();
  if (!f) return { ok: false, mensaje: 'Ese comprobante ya no existe.' };
  if (f.estado === 'anulada') return { ok: false, mensaje: `${f.numero} está anulada: no admite pagos.` };

  const { data: pagos } = await supabase
    .from('cobranzas').select('monto').eq('factura_id', d.factura_id);
  const cobrado = (pagos ?? []).reduce((s, c) => s + Number(c.monto), 0);
  const saldo = redondear(Number(f.total) - cobrado);

  /*
   * Cobrar de más no es un descuido menor: descuadra la cuenta del cliente y
   * aparece después como un saldo a favor que nadie sabe de dónde salió.
   * Se admite un céntimo de tolerancia por el redondeo del tipo de cambio.
   */
  if (d.monto > saldo + 0.01) {
    return {
      ok: false,
      mensaje:
        `A ${f.numero} le quedan ${f.moneda} ${saldo.toLocaleString('es-PE', { minimumFractionDigits: 2 })} ` +
        `por cobrar y está registrando ${d.monto.toLocaleString('es-PE', { minimumFractionDigits: 2 })}. ` +
        'Si el cliente pagó de más, registre el saldo a favor por separado.',
    };
  }

  const { data: creada, error } = await supabase
    .from('cobranzas')
    .insert({
      factura_id: d.factura_id,
      monto: d.monto,
      fecha: d.fecha,
      medio: d.medio?.trim() || null,
      referencia: d.referencia?.trim() || null,
      observaciones: d.observaciones?.trim() || null,
      registrado_por: usuario.id,
    })
    .select('id')
    .single();

  if (error || !creada) return { ok: false, mensaje: `No se pudo registrar el pago: ${error?.message}` };

  /* ---- El estado de la factura se recalcula con lo cobrado ---- */
  const nuevoCobrado = redondear(cobrado + d.monto);
  const nuevoSaldo = redondear(Number(f.total) - nuevoCobrado);
  const hoy = hoyEnLima();

  const { data: fv } = await supabase
    .from('facturas').select('fecha_vencimiento').eq('id', d.factura_id).maybeSingle();

  const estado =
    nuevoSaldo <= 0.01 ? 'cobrada'
    : String(fv?.fecha_vencimiento ?? '') < hoy ? 'vencida'
    : 'parcialmente_cobrada';

  await supabase.from('facturas').update({ estado }).eq('id', d.factura_id);

  await supabase.rpc('registrar_evento', {
    p_entidad: 'facturas',
    p_entidad_id: d.factura_id,
    p_tipo: 'cobranza_registrada',
    p_descripcion:
      `Pago de ${f.moneda} ${d.monto.toLocaleString('es-PE', { minimumFractionDigits: 2 })} sobre ${f.numero}` +
      (d.referencia?.trim() ? ` · ref. ${d.referencia.trim()}` : '') +
      ` · saldo ${nuevoSaldo.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`,
    p_severidad: 'info',
  }).then(() => undefined, () => undefined);

  refrescar(d.factura_id);

  return {
    ok: true,
    id: creada.id as number,
    numero: f.numero as string,
    mensaje:
      nuevoSaldo <= 0.01
        ? `${f.numero} queda COBRADA por completo.`
        : `Pago registrado. A ${f.numero} le quedan ${f.moneda} ${nuevoSaldo.toLocaleString('es-PE', { minimumFractionDigits: 2 })} por cobrar.`,
  };
}
