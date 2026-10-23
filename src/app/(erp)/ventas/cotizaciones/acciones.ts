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
import { puedeCotizar, ROLES_RECHAZAN_COTIZACION } from '@/lib/permisosVentas';
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

/**
 * Las líneas, revisadas con la misma regla al crear y al modificar.
 *
 * Antes solo se revisaban al crear: al editar se podía guardar una línea con
 * cantidad cero o un descuento de 150 %, y la base lo aceptaba. Devuelve el
 * primer problema encontrado, o null si está todo bien.
 */
function revisarLineas(lineas: LineaCotizacion[]): { ok: false; mensaje: string; campo: string } | null {
  if (!lineas.length) {
    return { ok: false, mensaje: 'Agregue al menos un producto a la cotización.', campo: 'lineas' };
  }
  const vistos = new Set<number>();
  for (const [i, l] of lineas.entries()) {
    const n = i + 1;
    if (!l.sku_presentacion_id) {
      return { ok: false, mensaje: `La línea ${n} no tiene producto seleccionado.`, campo: 'lineas' };
    }
    //  Un mismo producto dos veces: la aprobación y el descuento se siguen por producto.
    if (vistos.has(l.sku_presentacion_id)) {
      return { ok: false, mensaje: `El producto de la línea ${n} está repetido. Junte las cantidades en una sola línea.`, campo: 'lineas' };
    }
    vistos.add(l.sku_presentacion_id);
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
  return null;
}

/** Quién puede autorizar un descuento por encima del tope. */
const AUTORIZAN_DESCUENTO = ['gerencia', 'operaciones'];

/** Una línea tal como estaba guardada antes de editar. */
type LineaPrevia = {
  sku_presentacion_id: number;
  cantidad_tm: number;
  precio_tm: number;
  descuento_pct: number;
  descuento_autorizado_por: string | null;
};

/**
 * EL CONTROL DE DESCUENTO, IGUAL AL CREAR QUE AL MODIFICAR.
 *
 * Por encima del tope de Configuración (3 % por defecto) solo guardan
 * Gerencia u Operaciones, y en la línea queda quién lo autorizó. Antes este
 * control solo corría al crear: editando, un vendedor podía subir el
 * descuento al 20 % y el servidor lo aceptaba sin preguntar. Lo encontró la
 * revisión de la Guía de uso.
 *
 * Al MODIFICAR se respeta lo ya autorizado: si una línea mantiene el mismo
 * producto y un descuento igual o menor al que alguien autorizó, conserva esa
 * autorización. Sin esto, un vendedor no podría corregir ni las observaciones
 * de una oferta con un descuento que Gerencia ya había firmado.
 *
 * Devuelve, por cada línea, quién autorizó su descuento (o null si no lo
 * necesitaba).
 */
async function controlarDescuentos(
  supabase: Awaited<ReturnType<typeof crearClienteServidor>>,
  usuario: { id: string; rol: string },
  lineas: LineaCotizacion[],
  previas: LineaPrevia[] = []
): Promise<{ ok: true; tope: number; autorizadoPor: (string | null)[] } | { ok: false; mensaje: string; campo: string }> {
  const { data: pDesc } = await supabase
    .from('parametros').select('valor').eq('clave', 'descuento_max_sin_autorizacion').single();
  const tope = Number(pDesc?.valor ?? 3);
  const puedeAutorizar = AUTORIZAN_DESCUENTO.includes(usuario.rol);

  const autorizadoPor: (string | null)[] = [];
  const sinAutorizar: number[] = [];
  for (const [i, l] of lineas.entries()) {
    if (!(l.descuento_pct > tope)) { autorizadoPor.push(null); continue; }
    const previa = previas.find((p) => p.sku_presentacion_id === l.sku_presentacion_id);
    if (previa?.descuento_autorizado_por && l.descuento_pct <= Number(previa.descuento_pct) + 1e-9) {
      autorizadoPor.push(previa.descuento_autorizado_por);
    } else if (puedeAutorizar) {
      autorizadoPor.push(usuario.id);
    } else {
      sinAutorizar.push(i + 1);
      autorizadoPor.push(null);
    }
  }

  if (sinAutorizar.length) {
    return {
      ok: false,
      mensaje:
        `Hay líneas con descuento superior al ${tope} % permitido sin autorización ` +
        `(línea${sinAutorizar.length > 1 ? 's' : ''} ${sinAutorizar.join(', ')}). ` +
        'Pida a Gerencia u Operaciones que la registre, o baje el descuento.',
      campo: 'lineas',
    };
  }
  return { ok: true, tope, autorizadoPor };
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

  //  Comex registra pedidos directos, pero no entra a Cotizaciones.
  if (!puedeCotizar(usuario.rol)) {
    return {
      ok: false,
      mensaje: 'Su rol no puede crear cotizaciones. Esta acción corresponde a Comercial, Operaciones o Gerencia.',
    };
  }

  /* ---- Validación en el servidor (el navegador se puede manipular) ---- */
  if (!datos.cliente_id) {
    return { ok: false, mensaje: 'Elija el cliente al que va dirigida la cotización.', campo: 'cliente' };
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

  const problemaLineas = revisarLineas(datos.lineas);
  if (problemaLineas) return problemaLineas;

  const supabase = await crearClienteServidor();

  /* ---- Control de descuento: por encima del límite exige autorización ---- */
  const descuentos = await controlarDescuentos(supabase, usuario, datos.lineas);
  if (!descuentos.ok) return descuentos;

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
      descuento_autorizado_por: descuentos.autorizadoPor[i],
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

/*
 * DESDE QUÉ ESTADO SE LLEGA A CADA UNO A MANO.
 *
 *   enviada    ← borrador o aprobada (con la firma, si la empresa la exige)
 *   rechazada  ← aprobada o enviada: el cliente dijo que no. Antes solo se
 *                ofrecía en una enviada, y una oferta aprobada que el cliente
 *                rechazaba por teléfono antes de marcarse como enviada no
 *                tenía cómo cerrarse.
 *
 * «Aceptada» la pone la conversión en pedido y «vencida» el proceso diario:
 * ninguna de las dos se marca a mano, porque las dos afirman algo (hay un
 * pedido, pasó el plazo) que tiene que ser verdad.
 */
const TRANSICIONES: Partial<Record<string, string[]>> = {
  enviada: ['borrador', 'aprobada'],
  rechazada: ['aprobada', 'enviada'],
};

export async function cambiarEstadoCotizacion(
  id: number,
  estado: 'enviada' | 'rechazada'
): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró.' };

  if (!puedeCotizar(usuario.rol)) {
    return { ok: false, mensaje: 'Su rol no puede cambiar el estado de una cotización.' };
  }
  if (estado === 'rechazada' && !ROLES_RECHAZAN_COTIZACION.includes(usuario.rol as Rol)) {
    return { ok: false, mensaje: 'Marcar una cotización como rechazada corresponde a Gerencia, Operaciones o Comercial.' };
  }
  const origenes = TRANSICIONES[estado];
  if (!origenes) {
    return { ok: false, mensaje: `El estado «${estado}» no se pone a mano: lo pone el sistema.` };
  }

  const supabase = await crearClienteServidor();

  const { data: previa } = await supabase
    .from('cotizaciones').select('numero, estado, aprobada_en').eq('id', id).maybeSingle();
  if (!previa) return { ok: false, mensaje: 'Esa cotización ya no existe.' };

  //  Una cotización que ya es pedido está cerrada: ni se envía ni se rechaza.
  const { data: pedido } = await supabase
    .from('pedidos').select('numero_proforma').eq('cotizacion_id', id).maybeSingle();
  if (pedido) {
    return { ok: false, mensaje: `${previa.numero} ya generó el pedido ${pedido.numero_proforma}: su estado ya no cambia.` };
  }
  if (!origenes.includes(String(previa.estado))) {
    return {
      ok: false,
      mensaje: estado === 'rechazada'
        ? `${previa.numero} está ${previa.estado}: solo se marca como rechazada una cotización aprobada o enviada.`
        : `${previa.numero} está ${previa.estado}: ya no se puede marcar como enviada.`,
    };
  }

  /*
   * EL CONTROL DE VERDAD ESTÁ AQUÍ, NO EN EL BOTÓN.
   *
   * La botonera no ofrece «enviar» sin aprobación, pero esta función es
   * pública y se puede llamar de otras formas. Si la comprobación viviera
   * solo en la pantalla, el control sería decorativo.
   */
  if (estado === 'enviada' && !previa.aprobada_en && (await aprobacionObligatoria())) {
    return {
      ok: false,
      mensaje:
        `${previa.numero} todavía no está aprobada, así que no puede salir al cliente. ` +
        'Pídale a quien aprueba cotizaciones que revise el precio.',
    };
  }

  //  Se filtra también por el estado leído: si alguien la cambió en el medio, no se pisa.
  const { data, error } = await supabase
    .from('cotizaciones').update({ estado }).eq('id', id).eq('estado', String(previa.estado)).select('numero');

  if (error) return { ok: false, mensaje: `No se pudo actualizar: ${error.message}` };
  if (!data?.length) {
    return { ok: false, mensaje: `${previa.numero} cambió mientras tanto o su rol no puede modificarla. Vuelva a cargar la página.` };
  }

  await supabase.rpc('registrar_evento', {
    p_entidad: 'cotizaciones',
    p_entidad_id: id,
    p_tipo: estado === 'rechazada' ? 'cotizacion_rechazada' : 'cotizacion_enviada',
    p_descripcion: estado === 'rechazada'
      ? `${usuario.nombre} marcó la cotización ${previa.numero} como rechazada: el cliente no aceptó la oferta.`
      : `${usuario.nombre} registró que la cotización ${previa.numero} se envió al cliente.`,
    p_severidad: 'info',
  }).then(() => undefined, () => undefined);

  revalidatePath('/ventas/cotizaciones');
  revalidatePath(`/ventas/cotizaciones/${id}`);
  return {
    ok: true, id, numero: previa.numero as string,
    mensaje: estado === 'rechazada'
      ? `${previa.numero} marcada como rechazada.`
      : `${previa.numero} marcada como enviada.`,
  };
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

  /*
   * Si Configuración exige aprobar las cotizaciones, tampoco se convierte una
   * sin aprobar: el precio que pasa al pedido es el que se revisó. Antes este
   * candado solo existía para «enviar», y una cotización en borrador se podía
   * convertir directo saltándose la aprobación.
   */
  if (['rechazada', 'vencida'].includes(String(cot.estado))) {
    return { ok: false, mensaje: `${cot.numero} está ${cot.estado}: no se puede convertir en pedido.` };
  }
  if (!cot.aprobada_en && (await aprobacionObligatoria())) {
    return {
      ok: false,
      mensaje: `${cot.numero} todavía no está aprobada, así que no se puede convertir en pedido. Pídale a quien aprueba cotizaciones que revise el precio.`,
    };
  }

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
      /*
       * EL COSTO ESTIMADO SE HEREDA (067). Antes iba un 0 fijo y todo pedido
       * nuevo salía «Sin costo» en Rentabilidad. Si la cotización no lo tenía
       * (NULL), el disparador de la base pone el costo vigente de hoy.
       */
      costo_estimado_tm: l.costo_estimado_tm ?? null,
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
   Se puede editar mientras esté en BORRADOR, APROBADA o ENVIADA y no se haya
   convertido en pedido. Aceptada, rechazada o vencida ya no se tocan: para
   otra oferta se hace una cotización nueva.

   LA EDICIÓN Y LA APROBACIÓN (revisión de la Guía de uso)
   Antes una cotización enviada se podía editar —precios incluidos— y seguía
   «aprobada», con la firma de alguien que nunca vio el precio nuevo; y una
   aprobada ni siquiera se podía abrir. La regla ahora:

     · Si la empresa exige aprobación y la cotización ya estaba aprobada (o
       enviada), cambiar algo COMERCIAL —productos, cantidades, precios,
       descuentos, moneda, incoterm, forma de pago o % de adelanto, destino o
       cliente— ANULA la aprobación: vuelve a borrador, sin firma, y queda en
       el historial. Hay que aprobarla otra vez antes de enviarla.
     · Corregir lo que no toca el precio (observaciones, contacto, cuentas,
       vendedor, validez, prioridad…) la conserva.

   Lo decide este servidor comparando con lo guardado, no la pantalla.

   Se reemplazan todas las líneas: es más simple y más seguro que intentar
   casar cuáles cambiaron, y el registro de auditoría queda igualmente
   completo.
   ========================================================================== */

/** Estados en los que una cotización todavía se puede corregir. */
const EDITABLES = ['borrador', 'aprobada', 'enviada'];

const casiIgual = (a: unknown, b: unknown) => Math.abs(Number(a ?? 0) - Number(b ?? 0)) < 1e-6;

/**
 * Qué cambió de lo que el cliente ve como OFERTA, dicho en palabras.
 * Vacío = nada comercial: la aprobación se conserva.
 */
function cambiosComerciales(
  antes: Record<string, unknown>,
  lineasAntes: LineaPrevia[],
  d: DatosCotizacion,
  adelantoPct: number
): string[] {
  const cambios: string[] = [];
  if (Number(antes.cliente_id) !== Number(d.cliente_id)) cambios.push('el cliente');
  if ((antes.destino_id == null ? null : Number(antes.destino_id)) !== (d.destino_id == null ? null : Number(d.destino_id))) {
    cambios.push('el destino');
  }
  if (String(antes.moneda) !== String(d.moneda)) cambios.push('la moneda');
  if (String(antes.incoterm) !== String(d.incoterm)) cambios.push('el incoterm');
  if (((antes.forma_pago as string) || null) !== (d.forma_pago || null)) cambios.push('la forma de pago');
  if (!casiIgual(antes.adelanto_pct, adelantoPct)) cambios.push('el % de adelanto');

  //  Las líneas se casan por producto (no se admite el mismo producto dos veces).
  const skusAntes = lineasAntes.map((l) => Number(l.sku_presentacion_id)).sort((a, b) => a - b).join(',');
  const skusAhora = d.lineas.map((l) => Number(l.sku_presentacion_id)).sort((a, b) => a - b).join(',');
  if (skusAntes !== skusAhora) cambios.push('los productos');
  let cantidad = false, precio = false, descuento = false;
  for (const l of d.lineas) {
    const previa = lineasAntes.find((p) => Number(p.sku_presentacion_id) === Number(l.sku_presentacion_id));
    if (!previa) continue;
    if (!casiIgual(previa.cantidad_tm, l.cantidad_tm)) cantidad = true;
    if (!casiIgual(previa.precio_tm, l.precio_tm)) precio = true;
    if (!casiIgual(previa.descuento_pct, l.descuento_pct)) descuento = true;
  }
  if (cantidad) cambios.push('las cantidades');
  if (precio) cambios.push('los precios');
  if (descuento) cambios.push('los descuentos');
  return cambios;
}

/** «a», «a y b», «a, b y c». */
const enumerar = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`);

export async function actualizarCotizacion(
  id: number,
  datos: DatosCotizacion
): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró.' };
  if (!puedeCotizar(usuario.rol)) {
    return { ok: false, mensaje: 'Su rol no puede modificar cotizaciones.' };
  }

  const supabase = await crearClienteServidor();

  const [{ data: cot }, { data: lineasAntes }] = await Promise.all([
    supabase
      .from('cotizaciones')
      .select('numero, estado, aprobada_en, cliente_id, destino_id, moneda, incoterm, forma_pago, adelanto_pct')
      .eq('id', id).maybeSingle(),
    supabase
      .from('cotizacion_lineas')
      .select('sku_presentacion_id, cantidad_tm, precio_lista_tm, precio_tm, descuento_pct, descuento_autorizado_por, costo_estimado_tm, orden')
      .eq('cotizacion_id', id).order('orden'),
  ]);
  if (!cot) return { ok: false, mensaje: 'La cotización no existe.' };

  const { data: pedido } = await supabase
    .from('pedidos').select('numero_proforma').eq('cotizacion_id', id).maybeSingle();
  if (pedido) {
    return {
      ok: false,
      mensaje: `No se puede modificar: ya generó el pedido ${pedido.numero_proforma}. Los precios de una venta cerrada no se cambian.`,
    };
  }
  if (!EDITABLES.includes(cot.estado as string)) {
    return {
      ok: false,
      mensaje: `Una cotización ${cot.estado} no se puede modificar. Cree una nueva si necesita otra oferta.`,
    };
  }

  /* ---- Las mismas validaciones que al crear ---- */
  if (!datos.cliente_id) {
    return { ok: false, mensaje: 'Elija el cliente al que va dirigida la cotización.', campo: 'cliente' };
  }
  if (datos.validez_dias < 1 || datos.validez_dias > 365) {
    return { ok: false, mensaje: 'La validez debe estar entre 1 y 365 días.', campo: 'validez' };
  }
  const problemaTc = revisarTipoCambio(datos.tipo_cambio);
  if (problemaTc) return { ok: false, mensaje: problemaTc, campo: 'tipo_cambio' };
  const problemaLineas = revisarLineas(datos.lineas);
  if (problemaLineas) return problemaLineas;
  const condiciones = revisarCondiciones(datos);
  if (!condiciones.ok) return condiciones;

  const previas = (lineasAntes ?? []) as (LineaPrevia & { precio_lista_tm: number })[];

  /* ---- Descuento: el mismo control que al crear (punto 3 de la revisión) ---- */
  const descuentos = await controlarDescuentos(supabase, usuario, datos.lineas, previas);
  if (!descuentos.ok) return descuentos;

  //  Pasarle la oferta a un cliente bloqueado tampoco se puede editando.
  if (Number(cot.cliente_id) !== Number(datos.cliente_id)) {
    const { data: cliente } = await supabase
      .from('clientes').select('razon_social, bloqueado, motivo_bloqueo').eq('id', datos.cliente_id).maybeSingle();
    if (cliente?.bloqueado) {
      return {
        ok: false,
        mensaje: `El cliente ${cliente.razon_social} está bloqueado: ${cliente.motivo_bloqueo ?? 'sin motivo registrado'}. Regularice su situación antes de cotizar.`,
        campo: 'cliente',
      };
    }
  }

  /* ---- ¿La edición anula la aprobación? ---- */
  const cambios = cambiosComerciales(
    cot as Record<string, unknown>, previas, datos, Number(condiciones.columnas.adelanto_pct ?? 0)
  );
  const teniaFirma = Boolean(cot.aprobada_en) || ['aprobada', 'enviada'].includes(cot.estado as string);
  const anulaAprobacion = cambios.length > 0 && teniaFirma && (await aprobacionObligatoria());

  const { data: guardada, error: errCab } = await supabase
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
      ...(anulaAprobacion ? { estado: 'borrador', aprobada_en: null, aprobada_por: null } : {}),
    })
    .eq('id', id)
    //  Si otra persona la cambió de estado en el medio, no se pisa.
    .eq('estado', cot.estado as string)
    .select('id');

  if (errCab) return { ok: false, mensaje: `No se pudo guardar: ${errCab.message}` };
  //  Una política que rechaza devuelve cero filas y ningún error: se comprueba.
  if (!guardada?.length) {
    return { ok: false, mensaje: `${cot.numero} cambió mientras la editaba o su rol no puede modificarla. Vuelva a abrirla.` };
  }

  const filasLinea = (
    lineas: { sku_presentacion_id: number; cantidad_tm: number; precio_lista_tm: number; precio_tm: number; descuento_pct: number }[],
    autorizados: (string | null)[]
  ) =>
    lineas.map((l, i) => ({
      cotizacion_id: id,
      sku_presentacion_id: l.sku_presentacion_id,
      cantidad_tm: l.cantidad_tm,
      precio_lista_tm: l.precio_lista_tm,
      precio_tm: l.precio_tm,
      descuento_pct: l.descuento_pct,
      // Trazabilidad del descuento: quién lo autorizó (antes se perdía al editar)
      descuento_autorizado_por: autorizados[i] ?? null,
      /*
       * El costo estimado (067): la línea con el MISMO producto conserva el
       * que tenía; una línea nueva o con otro producto va sin él (NULL) y el
       * disparador de la base le pone el costo vigente de hoy.
       */
      costo_estimado_tm: costoPrevio(l.sku_presentacion_id),
      orden: i + 1,
    }));
  function costoPrevio(skuPresentacionId: number): number | null {
    const previa = previas.find((p) => Number(p.sku_presentacion_id) === Number(skuPresentacionId));
    const c = (previa as { costo_estimado_tm?: number | string | null } | undefined)?.costo_estimado_tm;
    return c === null || c === undefined ? null : Number(c);
  }

  await supabase.from('cotizacion_lineas').delete().eq('cotizacion_id', id);
  const { error: errLin } = await supabase
    .from('cotizacion_lineas').insert(filasLinea(datos.lineas, descuentos.autorizadoPor));
  if (errLin) {
    //  Sin líneas la oferta no vale nada: se devuelven las que tenía.
    await supabase.from('cotizacion_lineas').insert(filasLinea(previas, previas.map((p) => p.descuento_autorizado_por)));
    return { ok: false, mensaje: `No se pudieron guardar las líneas: ${errLin.message}` };
  }

  await guardarCuentas(supabase, 'cotizacion_cuentas', 'cotizacion_id', id, datos.cuentas);

  if (anulaAprobacion) {
    await supabase.rpc('registrar_evento', {
      p_entidad: 'cotizaciones',
      p_entidad_id: id,
      p_tipo: 'cotizacion_aprobacion_anulada',
      p_descripcion:
        `${usuario.nombre} editó ${cot.numero} y cambió ${enumerar(cambios)}. ` +
        'La edición anuló la aprobación: hay que volver a aprobarla.',
      p_severidad: 'advertencia',
      p_metadatos: { cambios, estado_anterior: cot.estado },
    }).then(() => undefined, () => undefined);
  }

  revalidatePath('/ventas/cotizaciones');
  revalidatePath(`/ventas/cotizaciones/${id}`);
  return {
    ok: true, id, numero: cot.numero as string,
    mensaje: anulaAprobacion
      ? `Cotización ${cot.numero} actualizada. Como cambió ${enumerar(cambios)}, la aprobación se anuló y volvió a borrador: hay que aprobarla otra vez antes de enviarla.`
      : `Cotización ${cot.numero} actualizada.`,
  };
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
   no puede depender de editar la cotización entera (que además, en una
   aceptada, ya no se puede). Esto solo toca el monto abonado y su fecha: no
   es un cambio comercial y no anula la aprobación. Mientras la cotización
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
