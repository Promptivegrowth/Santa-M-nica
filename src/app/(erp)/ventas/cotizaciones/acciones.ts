'use server';

/**
 * ============================================================================
 *  ACCIONES DE COTIZACIÓN
 * ============================================================================
 *  Aquí vive lo que ocurre cuando alguien guarda una cotización o la convierte
 *  en pedido. Todo corre EN EL SERVIDOR: la validación y el guardado suceden
 *  donde el usuario no los puede manipular.
 *
 *  El principio de REUSO que pidió el cliente se aplica aquí de forma literal:
 *  al convertir una cotización en pedido no se vuelve a teclear nada. El pedido
 *  hereda cliente, vendedor, moneda, tipo de cambio, incoterm, destino y todas
 *  las líneas con sus precios y descuentos.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { hoyEnLima, desplazarDias } from '@/lib/fechas';
import { columnasContacto, type ContactoDocumento } from '@/lib/contactoDocumento';
import { puedeVender, type Rol } from '@/lib/navegacion';

export type LineaCotizacion = {
  sku_presentacion_id: number;
  cantidad_tm: number;
  precio_lista_tm: number;
  precio_tm: number;
  descuento_pct: number;
};


export type DatosCotizacion = {
  cliente_id: number;
  vendedor_id: number | null;
  destino_id: number | null;
  lista_id: number | null;
  moneda: 'USD' | 'PEN';
  tipo_cambio: number;
  incoterm: 'EXW' | 'FOB' | 'CFR' | 'CIF' | 'DAP';
  validez_dias: number;
  observaciones: string | null;
  /** Opcional: la cotización se guarda igual sin contacto. */
  contacto?: ContactoDocumento;
  /** Opcional: identificadores de las cuentas de cobro que se imprimirán. */
  cuentas?: number[];
  lineas: LineaCotizacion[];
};

export type Resultado =
  | { ok: true; id: number; numero: string; mensaje: string }
  | { ok: false; mensaje: string; campo?: string };

/**
 * Reemplaza la lista de cuentas de un documento.
 *
 * Se borran todas y se vuelven a insertar en vez de calcular la diferencia:
 * son dos o tres filas sin datos propios, y el código que calcula diferencias
 * es donde se cuelan los errores.
 *
 * Si falla, NO se aborta el guardado. Las cuentas son un dato de presentación
 * —dónde pagar— y perder la cotización entera por eso sería desproporcionado.
 */
async function guardarCuentas(
  supabase: Awaited<ReturnType<typeof crearClienteServidor>>,
  tabla: 'cotizacion_cuentas' | 'pedido_cuentas',
  columna: 'cotizacion_id' | 'pedido_id',
  id: number,
  cuentas?: number[]
) {
  await supabase.from(tabla).delete().eq(columna, id);
  if (!cuentas?.length) return;

  await supabase
    .from(tabla)
    .insert(cuentas.map((cuenta_id) => ({ [columna]: id, cuenta_id })));
}


/**
 * Pide a la base el siguiente número de una serie.
 *
 * Antes esto se calculaba contando las filas de la tabla y sumando uno. Fallaba
 * de dos maneras: si había huecos en la numeración el número calculado ya
 * existía —y la conversión reventaba con un error de clave duplicada delante
 * del usuario—, y dos personas guardando a la vez obtenían el mismo.
 *
 * La función de la base lo resuelve de forma atómica.
 */
async function siguienteNumero(
  supabase: Awaited<ReturnType<typeof crearClienteServidor>>,
  serie: string
): Promise<number | null> {
  const { data, error } = await supabase.rpc('siguiente_correlativo', {
    p_serie: serie,
    p_anio: new Date().getFullYear(),
  });
  if (error || data === null || data === undefined) return null;
  return Number(data);
}

/* ==========================================================================
   CREAR COTIZACIÓN
   ========================================================================== */
export async function crearCotizacion(datos: DatosCotizacion): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró. Vuelva a iniciar sesión.' };

  if (!puedeVender(usuario.rol as Rol)) {
    return {
      ok: false,
      mensaje: 'Su rol no puede crear cotizaciones. Esta acción corresponde a Comercial, Comex, Operaciones o Gerencia.',
    };
  }

  /* ---- Validación en el servidor (el navegador se puede manipular) ---- */
  if (!datos.cliente_id) {
    return { ok: false, mensaje: 'Elija el cliente al que va dirigida la cotización.', campo: 'cliente' };
  }
  if (!datos.lineas.length) {
    return { ok: false, mensaje: 'Agregue al menos un producto a la cotización.', campo: 'lineas' };
  }
  if (datos.validez_dias < 1 || datos.validez_dias > 365) {
    return { ok: false, mensaje: 'La validez debe estar entre 1 y 365 días.', campo: 'validez' };
  }
  if (datos.tipo_cambio <= 0) {
    return { ok: false, mensaje: 'El tipo de cambio debe ser mayor que cero.', campo: 'tipo_cambio' };
  }

  for (const [i, l] of datos.lineas.entries()) {
    const n = i + 1;
    if (!l.sku_presentacion_id) {
      return { ok: false, mensaje: `La línea ${n} no tiene producto seleccionado.`, campo: 'lineas' };
    }
    if (!(l.cantidad_tm > 0)) {
      return { ok: false, mensaje: `La cantidad de la línea ${n} debe ser mayor que cero.`, campo: 'lineas' };
    }
    if (l.precio_tm < 0) {
      return { ok: false, mensaje: `El precio de la línea ${n} no puede ser negativo.`, campo: 'lineas' };
    }
    if (l.descuento_pct < 0 || l.descuento_pct > 100) {
      return { ok: false, mensaje: `El descuento de la línea ${n} debe estar entre 0 y 100 %.`, campo: 'lineas' };
    }
  }

  const supabase = await crearClienteServidor();

  /* ---- Control de descuento: por encima del límite exige autorización ---- */
  const { data: pDesc } = await supabase
    .from('parametros').select('valor').eq('clave', 'descuento_max_sin_autorizacion').single();
  const topeDescuento = Number(pDesc?.valor ?? 3);
  const requiereAutorizacion = datos.lineas.some((l) => l.descuento_pct > topeDescuento);

  if (requiereAutorizacion && !['gerencia', 'operaciones'].includes(usuario.rol)) {
    return {
      ok: false,
      mensaje: `Hay líneas con descuento superior al ${topeDescuento} % permitido sin autorización. Pida a Gerencia u Operaciones que la registre, o baje el descuento.`,
      campo: 'lineas',
    };
  }

  /* ---- Aviso si el cliente está bloqueado ---- */
  const { data: cliente } = await supabase
    .from('clientes').select('razon_social, bloqueado, motivo_bloqueo').eq('id', datos.cliente_id).single();
  if (cliente?.bloqueado) {
    return {
      ok: false,
      mensaje: `El cliente ${cliente.razon_social} está bloqueado: ${cliente.motivo_bloqueo ?? 'sin motivo registrado'}. Regularice su situación antes de cotizar.`,
      campo: 'cliente',
    };
  }

  /* ---- Número correlativo ---- */
  const anio = new Date().getFullYear();
  const correlativo = await siguienteNumero(supabase, 'COT');
  if (correlativo === null) {
    return { ok: false, mensaje: 'No se pudo reservar el número de cotización. Vuelva a intentarlo.' };
  }
  const numero = `COT-${anio}-${String(correlativo).padStart(4, '0')}`;

  /* ---- Cabecera ---- */
  const { data: cot, error: errCab } = await supabase
    .from('cotizaciones')
    .insert({
      numero,
      cliente_id: datos.cliente_id,
      vendedor_id: datos.vendedor_id,
      destino_id: datos.destino_id,
      lista_id: datos.lista_id,
      moneda: datos.moneda,
      tipo_cambio: datos.tipo_cambio,
      incoterm: datos.incoterm,
      validez_dias: datos.validez_dias,
      observaciones: datos.observaciones,
      estado: 'borrador',
      creado_por: usuario.id,
      ...columnasContacto(datos.contacto),
    })
    .select('id, numero')
    .single();

  if (errCab || !cot) {
    return {
      ok: false,
      mensaje: /policy/i.test(errCab?.message ?? '')
        ? 'Su rol no tiene permiso para crear cotizaciones.'
        : `No se pudo guardar la cotización: ${errCab?.message}`,
    };
  }

  /* ---- Líneas ---- */
  const { error: errLin } = await supabase.from('cotizacion_lineas').insert(
    datos.lineas.map((l, i) => ({
      cotizacion_id: cot.id,
      sku_presentacion_id: l.sku_presentacion_id,
      cantidad_tm: l.cantidad_tm,
      precio_lista_tm: l.precio_lista_tm,
      precio_tm: l.precio_tm,
      descuento_pct: l.descuento_pct,
      // Trazabilidad del descuento: queda constancia de quién lo autorizó
      descuento_autorizado_por: l.descuento_pct > topeDescuento ? usuario.id : null,
      orden: i + 1,
    }))
  );

  if (errLin) {
    // Si las líneas fallan, la cabecera sola no sirve de nada
    await supabase.from('cotizaciones').delete().eq('id', cot.id);
    return { ok: false, mensaje: `No se pudieron guardar las líneas: ${errLin.message}` };
  }

  await guardarCuentas(supabase, 'cotizacion_cuentas', 'cotizacion_id', cot.id as number, datos.cuentas);

  revalidatePath('/ventas/cotizaciones');
  return {
    ok: true,
    id: cot.id as number,
    numero: cot.numero as string,
    mensaje: `Cotización ${cot.numero} creada con ${datos.lineas.length} línea(s).`,
  };
}

/* ==========================================================================
   CAMBIAR EL ESTADO DE UNA COTIZACIÓN
   ========================================================================== */
export async function cambiarEstadoCotizacion(
  id: number,
  estado: 'borrador' | 'enviada' | 'aceptada' | 'rechazada' | 'vencida'
): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró.' };

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase
    .from('cotizaciones').update({ estado }).eq('id', id).select('numero').single();

  if (error) return { ok: false, mensaje: `No se pudo actualizar: ${error.message}` };

  revalidatePath('/ventas/cotizaciones');
  return { ok: true, id, numero: data.numero as string, mensaje: `Cotización marcada como ${estado}.` };
}

/* ==========================================================================
   CONVERTIR EN PEDIDO
   --------------------------------------------------------------------------
   Esta es la función que materializa el principio de reuso: el pedido nace de
   la cotización sin que nadie vuelva a escribir un solo dato.
   ========================================================================== */
export async function convertirEnPedido(cotizacionId: number): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró.' };

  if (!puedeVender(usuario.rol as Rol)) {
    return { ok: false, mensaje: 'Su rol no puede convertir cotizaciones en pedidos.' };
  }

  const supabase = await crearClienteServidor();

  /* ---- Cotización y sus líneas ---- */
  const [{ data: cot }, { data: lineas }] = await Promise.all([
    supabase.from('cotizaciones').select('*').eq('id', cotizacionId).single(),
    supabase.from('cotizacion_lineas').select('*').eq('cotizacion_id', cotizacionId).order('orden'),
  ]);

  if (!cot) return { ok: false, mensaje: 'La cotización no existe.' };
  if (!lineas?.length) return { ok: false, mensaje: 'La cotización no tiene líneas de producto.' };

  /* ---- No se convierte dos veces ---- */
  const { data: yaExiste } = await supabase
    .from('pedidos').select('id, numero_proforma').eq('cotizacion_id', cotizacionId).maybeSingle();
  if (yaExiste) {
    return {
      ok: false,
      mensaje: `Esta cotización ya se convirtió en el pedido ${yaExiste.numero_proforma}.`,
    };
  }

  /* ---- El cliente no puede estar bloqueado ---- */
  const { data: cliente } = await supabase
    .from('clientes')
    .select('razon_social, bloqueado, motivo_bloqueo, dias_credito')
    .eq('id', cot.cliente_id).single();

  if (cliente?.bloqueado) {
    return {
      ok: false,
      mensaje: `No se puede generar el pedido: ${cliente.razon_social} tiene el crédito bloqueado (${cliente.motivo_bloqueo ?? 'sin motivo'}).`,
    };
  }

  /* ---- Número de proforma ---- */
  const anio = String(new Date().getFullYear()).slice(2);
  const correlativo = await siguienteNumero(supabase, 'SM');
  if (correlativo === null) {
    return { ok: false, mensaje: 'No se pudo reservar el número de proforma. Vuelva a intentarlo.' };
  }
  const numeroProforma = `SM${anio}-${correlativo}`;

  /*
   * En Lima, no en UTC. Un pedido creado de noche nacía con fecha de mañana
   * y aparecía como «futuro» en los reportes del propio día en que se creó.
   */
  const hoy = hoyEnLima();
  const comprometida = desplazarDias(hoy, 21);

  /* ---- El pedido HEREDA todo de la cotización ---- */
  const { data: pedido, error: errPed } = await supabase
    .from('pedidos')
    .insert({
      numero_proforma: numeroProforma,
      cotizacion_id: cotizacionId,
      cliente_id: cot.cliente_id,
      vendedor_id: cot.vendedor_id,
      moneda: cot.moneda,
      tipo_cambio: cot.tipo_cambio,
      incoterm: cot.incoterm,
      destino_id: cot.destino_id,
      tipo_despacho: cot.incoterm === 'EXW' ? 'mercado_nacional' : 'exportacion',
      dias_credito: cliente?.dias_credito ?? 0,
      condicion_pago: (cliente?.dias_credito ?? 0) > 0 ? `Crédito ${cliente?.dias_credito} días` : 'Contado',
      prioridad: 'normal',
      fecha_solicitada: hoy,
      fecha_comprometida: comprometida,
      ciclo: 'pendiente_validacion',
      cobertura: 'pendiente_stock',
      situacion: 'sin_facturar',
      /*
       * El contacto y las cuentas viajan de la cotización al pedido tal como
       * estaban. Es lo que se pidió, y además es lo correcto: la proforma es
       * la continuación de esa oferta, y volver a preguntar a quién iba
       * dirigida sería teclear dos veces lo mismo.
       */
      contacto_id: cot.contacto_id,
      contacto_nombre: cot.contacto_nombre,
      contacto_cargo: cot.contacto_cargo,
      contacto_telefono: cot.contacto_telefono,
      contacto_email: cot.contacto_email,
      observaciones: `Generado desde la cotización ${cot.numero}`,
      creado_por: usuario.id,
    })
    .select('id, numero_proforma')
    .single();

  if (errPed || !pedido) {
    return { ok: false, mensaje: `No se pudo crear el pedido: ${errPed?.message}` };
  }

  /* ---- Las líneas también se heredan ---- */
  const { error: errLin } = await supabase.from('pedido_lineas').insert(
    lineas.map((l, i) => ({
      pedido_id: pedido.id,
      sku_presentacion_id: l.sku_presentacion_id,
      cantidad_tm: l.cantidad_tm,
      precio_lista_tm: l.precio_lista_tm,
      precio_tm: l.precio_tm,
      descuento_pct: l.descuento_pct,
      descuento_autorizado_por: l.descuento_autorizado_por,
      costo_estimado_tm: 0,
      orden: i + 1,
    }))
  );

  if (errLin) {
    await supabase.from('pedidos').delete().eq('id', pedido.id);
    return { ok: false, mensaje: `No se pudieron copiar las líneas: ${errLin.message}` };
  }

  /* ---- Las cuentas de cobro también pasan al pedido ---- */
  const { data: cuentasCot } = await supabase
    .from('cotizacion_cuentas')
    .select('cuenta_id')
    .eq('cotizacion_id', cotizacionId);

  await guardarCuentas(
    supabase,
    'pedido_cuentas',
    'pedido_id',
    pedido.id as number,
    (cuentasCot ?? []).map((c) => Number(c.cuenta_id))
  );

  // La cotización queda marcada como aceptada
  await supabase.from('cotizaciones').update({ estado: 'aceptada' }).eq('id', cotizacionId);

  revalidatePath('/ventas/cotizaciones');
  revalidatePath('/ventas/pedidos');

  return {
    ok: true,
    id: pedido.id as number,
    numero: pedido.numero_proforma as string,
    mensaje: `Pedido ${pedido.numero_proforma} creado a partir de la cotización ${cot.numero}.`,
  };
}

/* ==========================================================================
   RESOLVER PRECIO
   --------------------------------------------------------------------------
   Consulta el precio que corresponde según cliente, producto y volumen, usando
   la misma función de base de datos que usa el resto del sistema.
   ========================================================================== */
export async function consultarPrecio(
  skuPresentacionId: number,
  clienteId: number,
  cantidadTm: number
): Promise<{ precio: number; disponible_kg: number }> {
  const supabase = await crearClienteServidor();

  const [{ data: precio }, { data: disp }] = await Promise.all([
    supabase.rpc('resolver_precio', {
      p_sku_presentacion_id: skuPresentacionId,
      p_cliente_id: clienteId,
      p_cantidad_tm: cantidadTm,
    }),
    supabase
      .from('v_disponibilidad')
      .select('disponible_kg')
      .eq('sku_presentacion_id', skuPresentacionId),
  ]);

  const disponible = (disp ?? []).reduce((s, d) => s + Number(d.disponible_kg ?? 0), 0);
  return { precio: Number(precio ?? 0), disponible_kg: disponible };
}

/* ==========================================================================
   ELIMINAR COTIZACIÓN
   --------------------------------------------------------------------------
   Solo se puede borrar lo que todavía no comprometió nada. Una cotización que
   ya se convirtió en pedido NO se borra: hacerlo dejaría el pedido huérfano y
   rompería la trazabilidad de por qué se vendió a ese precio.
   ========================================================================== */
export async function eliminarCotizacion(id: number): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró.' };

  if (!puedeVender(usuario.rol as Rol)) {
    return { ok: false, mensaje: 'Su rol no puede eliminar cotizaciones.' };
  }

  const supabase = await crearClienteServidor();

  const { data: cot } = await supabase
    .from('cotizaciones').select('numero, estado, creado_por').eq('id', id).single();
  if (!cot) return { ok: false, mensaje: 'La cotización no existe o ya fue eliminada.' };

  // ¿Generó un pedido? Entonces es historia y no se toca.
  const { data: pedido } = await supabase
    .from('pedidos').select('numero_proforma').eq('cotizacion_id', id).maybeSingle();
  if (pedido) {
    return {
      ok: false,
      mensaje: `No se puede eliminar: esta cotización generó el pedido ${pedido.numero_proforma}. Si quiere anularla, cambie su estado a rechazada.`,
    };
  }

  // Una cotización ya enviada al cliente es un documento con historia:
  // solo gerencia u operaciones pueden borrarla.
  if (cot.estado !== 'borrador' && !['gerencia', 'operaciones'].includes(usuario.rol)) {
    return {
      ok: false,
      mensaje: `La cotización ${cot.numero} ya fue enviada al cliente. Solo Gerencia u Operaciones pueden eliminarla; usted puede marcarla como rechazada.`,
    };
  }

  // Las líneas se van solas por la cascada definida en la base de datos
  const { error } = await supabase.from('cotizaciones').delete().eq('id', id);
  if (error) {
    return {
      ok: false,
      mensaje: /policy/i.test(error.message)
        ? 'Su rol no tiene permiso para eliminar esta cotización.'
        : `No se pudo eliminar: ${error.message}`,
    };
  }

  revalidatePath('/ventas/cotizaciones');
  return { ok: true, id, numero: cot.numero as string, mensaje: `Cotización ${cot.numero} eliminada.` };
}

/* ==========================================================================
   ACTUALIZAR UNA COTIZACIÓN EXISTENTE
   --------------------------------------------------------------------------
   Solo mientras sea borrador o esté enviada y aún no convertida. Se reemplazan
   todas las líneas: es más simple y más seguro que intentar casar cuáles
   cambiaron, y el registro de auditoría queda igualmente completo.
   ========================================================================== */
export async function actualizarCotizacion(
  id: number,
  datos: DatosCotizacion
): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró.' };
  if (!puedeVender(usuario.rol as Rol)) {
    return { ok: false, mensaje: 'Su rol no puede modificar cotizaciones.' };
  }

  const supabase = await crearClienteServidor();

  const { data: cot } = await supabase
    .from('cotizaciones').select('numero, estado').eq('id', id).single();
  if (!cot) return { ok: false, mensaje: 'La cotización no existe.' };

  const { data: pedido } = await supabase
    .from('pedidos').select('numero_proforma').eq('cotizacion_id', id).maybeSingle();
  if (pedido) {
    return {
      ok: false,
      mensaje: `No se puede modificar: ya generó el pedido ${pedido.numero_proforma}. Los precios de una venta cerrada no se cambian.`,
    };
  }
  if (!['borrador', 'enviada'].includes(cot.estado as string)) {
    return {
      ok: false,
      mensaje: `Una cotización ${cot.estado} no se puede modificar. Cree una nueva si necesita otra oferta.`,
    };
  }
  if (!datos.lineas.length) {
    return { ok: false, mensaje: 'La cotización debe tener al menos un producto.', campo: 'lineas' };
  }

  const { error: errCab } = await supabase
    .from('cotizaciones')
    .update({
      cliente_id: datos.cliente_id,
      vendedor_id: datos.vendedor_id,
      destino_id: datos.destino_id,
      lista_id: datos.lista_id,
      moneda: datos.moneda,
      tipo_cambio: datos.tipo_cambio,
      incoterm: datos.incoterm,
      validez_dias: datos.validez_dias,
      observaciones: datos.observaciones,
      ...columnasContacto(datos.contacto),
    })
    .eq('id', id);

  if (errCab) return { ok: false, mensaje: `No se pudo guardar: ${errCab.message}` };

  await supabase.from('cotizacion_lineas').delete().eq('cotizacion_id', id);
  const { error: errLin } = await supabase.from('cotizacion_lineas').insert(
    datos.lineas.map((l, i) => ({
      cotizacion_id: id,
      sku_presentacion_id: l.sku_presentacion_id,
      cantidad_tm: l.cantidad_tm,
      precio_lista_tm: l.precio_lista_tm,
      precio_tm: l.precio_tm,
      descuento_pct: l.descuento_pct,
      orden: i + 1,
    }))
  );
  if (errLin) return { ok: false, mensaje: `No se pudieron guardar las líneas: ${errLin.message}` };

  await guardarCuentas(supabase, 'cotizacion_cuentas', 'cotizacion_id', id, datos.cuentas);

  revalidatePath('/ventas/cotizaciones');
  revalidatePath(`/ventas/cotizaciones/${id}`);
  return { ok: true, id, numero: cot.numero as string, mensaje: `Cotización ${cot.numero} actualizada.` };
}
