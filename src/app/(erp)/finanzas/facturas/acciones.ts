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
import { PUEDEN_FACTURAR, PUEDEN_COBRAR, MEDIOS_DE_PAGO, MOTIVO_MINIMO, motivoNoFacturarCiclo } from '@/lib/permisosFinanzas';
import { nombreRol, listaDeRoles } from '@/lib/permisosVentas';
import type { Rol } from '@/lib/navegacion';

export type Resultado =
  | { ok: true; id: number; numero: string; mensaje: string }
  | { ok: false; mensaje: string; detalles?: string[] };

/*
 * Quién emite y quién cobra se decide en '@/lib/permisosFinanzas', el mismo
 * sitio que usan los botones. La base lo vuelve a exigir (070).
 */
const puedeFacturar = (rol: string) => PUEDEN_FACTURAR.includes(rol as Rol);
const puedeCobrar = (rol: string) => PUEDEN_COBRAR.includes(rol as Rol);

/**
 * El mensaje de una excepción de la base, sin el ruido técnico.
 * Las funciones de la 070 ya escriben sus motivos en castellano para el
 * usuario; aquí solo se quita lo que añade PostgREST cuando lo hay.
 */
function motivoDeLaBase(mensaje: string | undefined): string {
  const m = (mensaje ?? '').replace(/^ERROR:\s*/i, '').trim();
  /*
   * Lo técnico de PostgreSQL no llega a la pantalla (076): «new row violates
   * row-level security policy…» o un nombre de restricción no le dicen nada
   * a quien factura.
   */
  if (/row-level security|permission denied|violates.*policy/i.test(m)) {
    return `No tiene permiso para esta operación. Emiten comprobantes ${listaDeRoles(PUEDEN_FACTURAR)}; ` +
      `cobran y anulan ${listaDeRoles(PUEDEN_COBRAR)}.`;
  }
  if (!m || /violates|constraint|column|relation|syntax|null value|duplicate key/i.test(m)) {
    return 'La base rechazó la operación. Recargue la pantalla y vuelva a intentarlo; si se repite, avise a Sistemas.';
  }
  return m;
}

/** «2026-11-26» → «26/11/2026». */
const dma = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

/** El IGV vigente. Sale de los parámetros para no quedar escrito en el código. */
async function porcentajeIgv(): Promise<number> {
  const supabase = await crearClienteServidor();
  const { data } = await supabase
    .from('parametros').select('valor').eq('clave', 'igv_porcentaje').maybeSingle();
  return Number(data?.valor ?? 18);
}

function refrescar(id?: number) {
  revalidatePath('/finanzas/facturas');
  revalidatePath('/finanzas/cobrar');
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
    .select('id, numero_proforma, ciclo, moneda, tipo_cambio, dias_credito, situacion, clientes(razon_social, pais, ruc_tax_id, dias_credito)')
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
  /* Solo de un pedido confirmado (076). La base lo exige también. */
  const sinConfirmar = motivoNoFacturarCiclo(pedido.ciclo as string);
  if (sinConfirmar) impedimentos.push(sinConfirmar);
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
  if (!puedeFacturar(usuario.rol)) {
    return { ok: false, mensaje: `${nombreRol(usuario.rol)} no emite comprobantes: lo hacen ${listaDeRoles(PUEDEN_FACTURAR)}.` };
  }

  const previa = await previaFactura(pedidoId);
  if (!previa) return { ok: false, mensaje: 'Ese pedido ya no existe.' };
  if (!previa.puede) {
    //  Con un solo impedimento, el mensaje ES el impedimento: «Primero Gerencia u Operaciones…».
    return previa.impedimentos.length === 1
      ? { ok: false, mensaje: previa.impedimentos[0] }
      : { ok: false, mensaje: 'No se puede emitir el comprobante.', detalles: previa.impedimentos };
  }

  const supabase = await crearClienteServidor();

  /* ---- El correlativo, de a uno ----
     Serie F para factura, B para boleta: es lo que corresponde en el Perú. */
  // El año del correlativo es el de Lima: el 31 de diciembre a las 8 de la
  // noche todavía no es el año siguiente.
  const anio = Number(hoyEnLima().slice(0, 4));
  const serie = previa.tipo === 'factura' ? 'F001' : 'B001';
  const { data: correlativo, error: errNum } = await supabase
    .rpc('siguiente_correlativo', { p_serie: serie, p_anio: anio });
  if (errNum) return { ok: false, mensaje: `No se pudo reservar el número: ${motivoDeLaBase(errNum.message)}` };

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
      /*
       * El tipo de cambio se hereda del pedido, que es donde se pactó. El
       * antiguo «?? 1» de respaldo ya no vale: la base rechaza cualquier valor
       * por debajo de 1,5 porque no puede ser una cotización del dólar, y una
       * factura en soles con un 1 era justamente lo que impedía convertirla.
       */
      tipo_cambio: Number(pedido.tipo_cambio),
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
    return { ok: false, mensaje: `No se pudo emitir: ${motivoDeLaBase(error?.message)}` };
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
    return { ok: false, mensaje: `No se pudieron copiar las líneas: ${motivoDeLaBase(errLin.message)}` };
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
      `. Vence el ${dma(previa.vencimiento)}.`,
  };
}

/* ==========================================================================
   ANULAR
   --------------------------------------------------------------------------
   La decisión la toma la base (anular_comprobante, 070), con el comprobante
   bloqueado: solo Gerencia y Operaciones, con motivo escrito, nunca con cobros
   aplicados, y el número no se reutiliza. El pedido vuelve a «sin facturar»
   para poder emitirle el comprobante correcto.
   ========================================================================== */
export async function anularComprobante(facturaId: number, motivo: string): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión caducó. Vuelva a entrar.' };
  if (!puedeCobrar(usuario.rol)) {
    return { ok: false, mensaje: `${nombreRol(usuario.rol)} no anula comprobantes: lo hacen ${listaDeRoles(PUEDEN_COBRAR)}.` };
  }
  const texto = (motivo ?? '').trim();
  if (texto.length < MOTIVO_MINIMO) {
    return {
      ok: false,
      mensaje: `Escriba el motivo de la anulación (al menos ${MOTIVO_MINIMO} caracteres): queda en el comprobante para la contabilidad.`,
    };
  }

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc('anular_comprobante', { p_factura_id: facturaId, p_motivo: texto });
  if (error) return { ok: false, mensaje: motivoDeLaBase(error.message) };

  const r = (data ?? {}) as { numero?: string; pedido_id?: number | null };
  refrescar(facturaId);
  if (r.pedido_id) revalidatePath(`/ventas/pedidos/${r.pedido_id}`);

  return {
    ok: true,
    id: facturaId,
    numero: r.numero ?? '',
    mensaje:
      `${r.numero} quedó anulado. Su número no se vuelve a usar` +
      (r.pedido_id ? ' y el pedido queda libre para emitirle el comprobante correcto.' : '.'),
  };
}

/* ==========================================================================
   ANULAR UN COBRO MAL REGISTRADO (070b)
   --------------------------------------------------------------------------
   El cobro no se borra: queda anulado con motivo, quién y cuándo, y deja de
   sumar en el saldo. El estado de la factura y la situación del pedido se
   recalculan solos (disparador de cobranzas). Lo decide la base.
   ========================================================================== */
export async function anularCobranza(cobranzaId: number, motivo: string): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión caducó. Vuelva a entrar.' };
  if (!puedeCobrar(usuario.rol)) {
    return { ok: false, mensaje: `${nombreRol(usuario.rol)} no anula cobros: lo hacen ${listaDeRoles(PUEDEN_COBRAR)}.` };
  }
  const texto = (motivo ?? '').trim();
  if (texto.length < MOTIVO_MINIMO) {
    return { ok: false, mensaje: `Escriba el motivo de la anulación del cobro (al menos ${MOTIVO_MINIMO} caracteres).` };
  }

  const supabase = await crearClienteServidor();
  const { data: cobro } = await supabase.from('cobranzas').select('factura_id').eq('id', cobranzaId).maybeSingle();
  const { data, error } = await supabase.rpc('anular_cobranza', { p_cobranza_id: cobranzaId, p_motivo: texto });
  if (error) return { ok: false, mensaje: motivoDeLaBase(error.message) };

  const r = (data ?? {}) as { numero?: string; moneda?: string; saldo?: number; estado?: string };
  if (cobro?.factura_id) refrescar(Number(cobro.factura_id));
  revalidatePath('/finanzas/cobrar');

  return {
    ok: true,
    id: cobranzaId,
    numero: r.numero ?? '',
    mensaje:
      `Cobro anulado. A ${r.numero} le quedan ${r.moneda} ` +
      `${Number(r.saldo ?? 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} por cobrar.`,
  };
}

/* ==========================================================================
   COBRANZAS
   --------------------------------------------------------------------------
   Las reglas viven en la base (registrar_cobranza y su disparador, 070): no
   más que el saldo, fecha no futura ni anterior a la emisión, nunca sobre un
   anulado. Aquí se adelantan las comprobaciones baratas para dar el mensaje
   sin ir y volver, pero la última palabra es de la base.
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
  if (!usuario) return { ok: false, mensaje: 'Su sesión caducó. Vuelva a entrar.' };
  if (!puedeCobrar(usuario.rol)) {
    return { ok: false, mensaje: `${nombreRol(usuario.rol)} no registra cobros: lo hacen ${listaDeRoles(PUEDEN_COBRAR)}.` };
  }
  if (!Number.isFinite(d.monto) || !(d.monto > 0)) {
    return { ok: false, mensaje: 'Escriba el monto cobrado: tiene que ser mayor que cero.' };
  }
  if (!d.fecha || !/^\d{4}-\d{2}-\d{2}$/.test(d.fecha)) {
    return { ok: false, mensaje: 'Indique la fecha en que llegó el pago.' };
  }
  if (d.fecha > hoyEnLima()) {
    return { ok: false, mensaje: 'La fecha del cobro es posterior a hoy. Registre el cobro el día que llega el dinero.' };
  }
  if (!d.medio || !(MEDIOS_DE_PAGO as readonly string[]).includes(d.medio)) {
    return { ok: false, mensaje: `Elija el medio de pago: ${MEDIOS_DE_PAGO.join(', ')}.` };
  }

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc('registrar_cobranza', {
    p_factura_id: d.factura_id,
    p_monto: Math.round(d.monto * 100) / 100,
    p_fecha: d.fecha,
    p_medio: d.medio,
    p_referencia: d.referencia?.trim() || null,
    p_observaciones: d.observaciones?.trim() || null,
  });
  if (error) return { ok: false, mensaje: motivoDeLaBase(error.message) };

  const r = (data ?? {}) as { id?: number; numero?: string; moneda?: string; saldo?: number; estado?: string };
  const saldo = Number(r.saldo ?? 0);
  refrescar(d.factura_id);
  revalidatePath('/finanzas/cobrar');

  return {
    ok: true,
    id: Number(r.id ?? 0),
    numero: r.numero ?? '',
    mensaje:
      saldo <= 0.01
        ? `Cobro registrado. ${r.numero} queda COBRADA por completo.`
        : `Cobro registrado. A ${r.numero} le quedan ${r.moneda} ${saldo.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} por cobrar` +
          (r.estado === 'vencida' ? ' y sigue vencida.' : '.'),
  };
}
