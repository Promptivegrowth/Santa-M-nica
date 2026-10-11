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
import { revisarTipoCambio } from '@/lib/moneda';
import { hoyEnLima, desplazarDias } from '@/lib/fechas';
import { columnasContacto, type ContactoDocumento } from '@/lib/contactoDocumento';
import { puedeVender, type Rol } from '@/lib/navegacion';
import { obtenerTipoCambioSunat, type TipoCambioSunat } from '@/lib/tipoCambioSunat';
import {
  plazoReferencia, diasDePlazos, textoCondicionPago, type FormaPago, type Prioridad,
} from '@/lib/condicionesVenta';

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
  /** Urgencia pactada con el cliente. Viaja al pedido al convertir. */
  prioridad: 'baja' | 'normal' | 'alta' | 'urgente';
  incoterm: 'EXW' | 'FOB' | 'CFR' | 'CIF' | 'DAP';
  validez_dias: number;
  observaciones: string | null;
  /** Opcional: la cotización se guarda igual sin contacto. */
  contacto?: ContactoDocumento;
  /** Opcional: identificadores de las cuentas de cobro que se imprimirán. */
  cuentas?: number[];
  lineas: LineaCotizacion[];

  /* ---- Observaciones de octubre ---- */
  /** Punto 3: de qué día es el tipo de cambio y si lo trajo SUNAT o se escribió a mano. */
  tipo_cambio_fecha?: string | null;
  tipo_cambio_fuente?: 'sunat' | 'manual' | null;
  tipo_cambio_clase?: 'compra' | 'venta' | null;
  /** Punto 4: opcional. Si está, manda sobre el plazo de la prioridad. */
  fecha_tentativa_despacho?: string | null;
  /** Punto 6: forma de pago, % de adelanto y lo que el cliente de verdad abonó. */
  forma_pago?: FormaPago | null;
  adelanto_pct?: number;
  adelanto_abonado?: number | null;
  adelanto_abonado_en?: string | null;
};

const FORMAS_VALIDAS: FormaPago[] = ['contado', 'adelanto_saldo', 'credito', 'carta_credito', 'cad'];

/**
 * Las condiciones nuevas (puntos 3, 4 y 6), revisadas y listas para guardar.
 * Se usa al crear y al modificar: la misma regla en los dos caminos.
 */
function revisarCondiciones(d: DatosCotizacion):
  { ok: true; columnas: Record<string, unknown> } | { ok: false; mensaje: string; campo: string } {
  const pct = Number(d.adelanto_pct ?? 0);
  if (!(pct >= 0 && pct <= 100)) {
    return { ok: false, mensaje: 'El % de adelanto debe estar entre 0 y 100.', campo: 'adelanto_pct' };
  }
  if (d.forma_pago && !FORMAS_VALIDAS.includes(d.forma_pago)) {
    return { ok: false, mensaje: 'Esa forma de pago no existe.', campo: 'forma_pago' };
  }
  if (d.forma_pago === 'adelanto_saldo' && !(pct > 0)) {
    return { ok: false, mensaje: 'Con «Adelanto y saldo» indique el % de adelanto.', campo: 'adelanto_pct' };
  }
  const abonado = d.adelanto_abonado === null || d.adelanto_abonado === undefined || String(d.adelanto_abonado) === ''
    ? null : Number(d.adelanto_abonado);
  if (abonado !== null && !(abonado >= 0)) {
    return { ok: false, mensaje: 'El monto abonado no puede ser negativo.', campo: 'adelanto_abonado' };
  }
  const tentativa = d.fecha_tentativa_despacho || null;
  if (tentativa && !/^\d{4}-\d{2}-\d{2}$/.test(tentativa)) {
    return { ok: false, mensaje: 'La fecha tentativa de despacho no es válida.', campo: 'fecha_tentativa_despacho' };
  }
  return {
    ok: true,
    columnas: {
      tipo_cambio_fecha: d.tipo_cambio_fecha || null,
      tipo_cambio_fuente: d.tipo_cambio_fuente ?? 'manual',
      tipo_cambio_clase: d.tipo_cambio_fuente === 'sunat' ? (d.tipo_cambio_clase ?? 'venta') : null,
      fecha_tentativa_despacho: tentativa,
      forma_pago: d.forma_pago || null,
      adelanto_pct: pct,
      adelanto_abonado: abonado,
      adelanto_abonado_en: abonado === null ? null : (d.adelanto_abonado_en || hoyEnLima()),
    },
  };
}

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
  const condiciones = revisarCondiciones(datos);
  if (!condiciones.ok) return condiciones;
  //  Una fecha tentativa en el pasado no orienta nada: se avisa al crear.
  if (datos.fecha_tentativa_despacho && datos.fecha_tentativa_despacho < hoyEnLima()) {
    return { ok: false, mensaje: 'La fecha tentativa de despacho no puede ser anterior a hoy.', campo: 'fecha_tentativa_despacho' };
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
      prioridad: datos.prioridad ?? 'normal',
      incoterm: datos.incoterm,
      validez_dias: datos.validez_dias,
      observaciones: datos.observaciones,
      estado: 'borrador',
      creado_por: usuario.id,
      ...columnasContacto(datos.contacto),
      ...condiciones.columnas,
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
/* ==========================================================================
   APROBAR LA OFERTA
   --------------------------------------------------------------------------
   Se pidió en la reunión: una cotización no sale al cliente sin que alguien
   con autoridad haya visto el precio. Es el único dato del documento que la
   empresa no puede deshacer una vez que el cliente lo tiene delante.

   QUIÉN APRUEBA
   Gerencia. Y no Comercial, aunque Comercial sea quien más sabe del precio:
   si quien redacta la oferta es también quien la autoriza, el control no
   existe. Es la razón de ser de una aprobación.
   ========================================================================== */

/*
 * QUIÉN APRUEBA NO ES UN ROL, ES UNA PERSONA.
 *
 * Aquí decía `['gerencia']`. Se lo preguntamos a Oliver y respondió: «aprueba
 * Gerente, Cathy Lee y Marco León» — tres personas concretas, y una de ellas
 * es Jefe Comercial y Exportaciones.
 *
 * Abrir el permiso al rol «comercial» entero dejaría que cualquier vendedor
 * aprobara sus propias ofertas, que es exactamente lo que se quería evitar.
 * Dejarlo solo en Gerencia no es lo que él pidió. La facultad se marca
 * PERSONA A PERSONA en el maestro de usuarios.
 */

/** ¿La aprobación es obligatoria? Lo decide Configuración, no el código. */
export async function aprobacionObligatoria(): Promise<boolean> {
  const supabase = await crearClienteServidor();
  const { data } = await supabase
    .from('parametros').select('valor').eq('clave', 'cotizacion_requiere_aprobacion').maybeSingle();
  // Ante la duda, se exige: es el lado seguro de la decisión.
  return (data?.valor ?? 'si').toLowerCase() !== 'no';
}

export async function aprobarCotizacion(id: number): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró.' };

  if (!usuario.aprueba_cotizaciones) {
    return {
      ok: false,
      mensaje:
        `${usuario.nombre} no está autorizado a aprobar cotizaciones. ` +
        'La facultad se otorga persona a persona desde el maestro de usuarios, no por cargo: ' +
        'si cualquiera del área pudiera aprobar sus propias ofertas, el control no serviría de nada.',
    };
  }

  const supabase = await crearClienteServidor();
  const { data: cot } = await supabase
    .from('cotizaciones')
    .select('numero, estado, aprobada_en, cotizacion_lineas(id)')
    .eq('id', id).maybeSingle();

  if (!cot) return { ok: false, mensaje: 'Esa cotización ya no existe.' };
  if (cot.estado !== 'borrador') {
    return { ok: false, mensaje: `${cot.numero} ya pasó de borrador: está ${cot.estado}.` };
  }
  // Aprobar una oferta vacía no significa nada.
  if (!(cot.cotizacion_lineas ?? []).length) {
    return { ok: false, mensaje: 'La cotización no tiene líneas de producto: no hay precio que aprobar.' };
  }

  const { error } = await supabase
    .from('cotizaciones')
    .update({ estado: 'aprobada', aprobada_por: usuario.id, aprobada_en: new Date().toISOString() })
    .eq('id', id);

  if (error) return { ok: false, mensaje: `No se pudo aprobar: ${error.message}` };

  await supabase.rpc('registrar_evento', {
    p_entidad: 'cotizaciones',
    p_entidad_id: id,
    p_tipo: 'cotizacion_aprobada',
    p_descripcion: `${usuario.nombre} aprobó la cotización ${cot.numero}. Ya se puede enviar al cliente.`,
    p_severidad: 'info',
  }).then(() => undefined, () => undefined);

  revalidatePath('/ventas/cotizaciones');
  revalidatePath(`/ventas/cotizaciones/${id}`);
  return {
    ok: true, id, numero: cot.numero as string,
    mensaje: `${cot.numero} aprobada. Ya se puede enviar al cliente.`,
  };
}

export async function cambiarEstadoCotizacion(
  id: number,
  estado: 'borrador' | 'enviada' | 'aceptada' | 'rechazada' | 'vencida'
): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró.' };

  const supabase = await crearClienteServidor();

  /*
   * EL CONTROL DE VERDAD ESTÁ AQUÍ, NO EN EL BOTÓN.
   *
   * La botonera no ofrece «enviar» sin aprobación, pero esta función es
   * pública y se puede llamar de otras formas. Si la comprobación viviera
   * solo en la pantalla, el control sería decorativo.
   */
  if (estado === 'enviada' && (await aprobacionObligatoria())) {
    const { data: previa } = await supabase
      .from('cotizaciones').select('numero, aprobada_en').eq('id', id).maybeSingle();

    if (previa && !previa.aprobada_en) {
      return {
        ok: false,
        mensaje:
          `${previa.numero} todavía no está aprobada, así que no puede salir al cliente. ` +
          'Pídale a Gerencia que revise el precio.',
      };
    }
  }

  const { data, error } = await supabase
    .from('cotizaciones').update({ estado }).eq('id', id).select('numero').single();

  if (error) return { ok: false, mensaje: `No se pudo actualizar: ${error.message}` };

  revalidatePath('/ventas/cotizaciones');
  revalidatePath(`/ventas/cotizaciones/${id}`);
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

  /*
   * LA FECHA COMPROMETIDA (puntos 4 y 5 de las observaciones de octubre).
   * Antes eran siempre 21 días. Ahora: la fecha tentativa de despacho si la
   * cotización la trae; si no, el plazo de su prioridad (urgente 1 semana,
   * normal 3, baja más de 3), con los días de Configuración.
   */
  const { data: paramPlazos } = await supabase
    .from('parametros').select('clave, valor').like('clave', 'plazo_dias_%');
  const prioridadCot = (cot.prioridad ?? 'normal') as Prioridad;
  const plazo = plazoReferencia(prioridadCot, hoy, cot.fecha_tentativa_despacho as string | null,
    diasDePlazos((paramPlazos ?? []) as { clave: string; valor: unknown }[]));
  const comprometida = plazo.fecha < hoy ? desplazarDias(hoy, 7) : plazo.fecha;

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
      /*
       * La forma de pago y el adelanto pactados en la cotización (punto 6)
       * viajan a la proforma. Si la cotización no la tenía, se deduce del
       * crédito del cliente, como antes.
       */
      condicion_pago: textoCondicionPago(cot.forma_pago as FormaPago | null, Number(cot.adelanto_pct ?? 0), cliente?.dias_credito ?? 0),
      forma_pago: cot.forma_pago ?? null,
      pago_adelanto_pct: Number(cot.adelanto_pct ?? 0) || null,
      adelanto_abonado: cot.adelanto_abonado ?? null,
      adelanto_abonado_en: cot.adelanto_abonado_en ?? null,
      tipo_cambio_fecha: cot.tipo_cambio_fecha ?? null,
      tipo_cambio_fuente: cot.tipo_cambio_fuente ?? null,
      tipo_cambio_clase: cot.tipo_cambio_clase ?? null,
      fecha_tentativa_despacho: cot.fecha_tentativa_despacho ?? null,
      // La urgencia se pactó con el cliente al cotizar; sería absurdo perderla
      // justo en el documento que compromete la entrega.
      prioridad: cot.prioridad ?? 'normal',
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
      /*
       * LAS OBSERVACIONES DE LA COTIZACIÓN PASAN TAL CUAL (punto 7).
       * Antes aquí iba «Generado desde la cotización COT-…» y lo que había
       * escrito el comercial se perdía. El vínculo con la cotización ya
       * existe (cotizacion_id) y la ficha del pedido lo muestra: repetirlo en
       * el texto sería duplicarlo.
       */
      observaciones: (cot.observaciones as string | null)?.trim() || null,
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
  const condiciones = revisarCondiciones(datos);
  if (!condiciones.ok) return condiciones;

  const { error: errCab } = await supabase
    .from('cotizaciones')
    .update({
      cliente_id: datos.cliente_id,
      vendedor_id: datos.vendedor_id,
      destino_id: datos.destino_id,
      lista_id: datos.lista_id,
      moneda: datos.moneda,
      tipo_cambio: datos.tipo_cambio,
      prioridad: datos.prioridad ?? 'normal',
      incoterm: datos.incoterm,
      validez_dias: datos.validez_dias,
      observaciones: datos.observaciones,
      ...columnasContacto(datos.contacto),
      ...condiciones.columnas,
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

/* ==========================================================================
   TIPO DE CAMBIO SUNAT (observaciones de octubre, punto 3)
   --------------------------------------------------------------------------
   El formulario lo pide al abrirse y al cambiar la fecha. Corre en el
   servidor: SUNAT no responde a un navegador de otro dominio, y así además
   queda guardado para todos.
   ========================================================================== */
export async function consultarTipoCambio(
  fecha?: string
): Promise<{ ok: true; tc: TipoCambioSunat } | { ok: false; mensaje: string }> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró.' };
  const supabase = await crearClienteServidor();
  return obtenerTipoCambioSunat(supabase, fecha || hoyEnLima());
}

/* ==========================================================================
   REGISTRAR LO QUE EL CLIENTE ABONÓ (punto 6)
   --------------------------------------------------------------------------
   El abono llega DESPUÉS de cotizar —a veces después de la proforma—, así que
   no puede depender de poder editar la cotización entera: una aprobada ya no
   se edita. Esto solo toca el monto abonado y su fecha. Mientras la cotización
   no tiene pedido se guarda en ella; cuando ya lo tiene, en el pedido, que es
   donde sigue la venta.
   ========================================================================== */
export async function registrarAbono(
  tipo: 'cotizacion' | 'pedido',
  id: number,
  monto: number | null,
  fecha: string | null
): Promise<{ ok: true; mensaje: string } | { ok: false; mensaje: string }> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró.' };
  if (!puedeVender(usuario.rol as Rol)) {
    return { ok: false, mensaje: 'Su rol no puede registrar abonos.' };
  }
  if (monto !== null && !(Number(monto) >= 0)) {
    return { ok: false, mensaje: 'El monto abonado no puede ser negativo.' };
  }
  if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { ok: false, mensaje: 'La fecha del abono no es válida.' };
  if (fecha && fecha > hoyEnLima()) return { ok: false, mensaje: 'La fecha del abono no puede ser futura.' };

  const supabase = await crearClienteServidor();
  const tabla = tipo === 'cotizacion' ? 'cotizaciones' : 'pedidos';
  const columnaNumero = tipo === 'cotizacion' ? 'numero' : 'numero_proforma';

  if (tipo === 'cotizacion') {
    const { data: pedido } = await supabase
      .from('pedidos').select('numero_proforma').eq('cotizacion_id', id).maybeSingle();
    if (pedido) {
      return {
        ok: false,
        mensaje: `Esta cotización ya es el pedido ${pedido.numero_proforma}: registre el abono en el pedido.`,
      };
    }
  }

  const { data, error } = await supabase
    .from(tabla)
    .update({
      adelanto_abonado: monto === null ? null : Math.round(Number(monto) * 100) / 100,
      adelanto_abonado_en: monto === null ? null : (fecha || hoyEnLima()),
    })
    .eq('id', id)
    .select(columnaNumero);

  //  Una política que rechaza devuelve cero filas y ningún error: se comprueba.
  if (error) return { ok: false, mensaje: `No se pudo guardar el abono: ${error.message}` };
  if (!data?.length) return { ok: false, mensaje: 'No tiene permiso para modificar ese documento.' };

  revalidatePath(tipo === 'cotizacion' ? `/ventas/cotizaciones/${id}` : `/ventas/pedidos/${id}`);
  return {
    ok: true,
    mensaje: monto === null ? 'Abono borrado.' : 'Abono registrado.',
  };
}
