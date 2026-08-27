/**
 * ============================================================================
 *  DOCUMENTOS IMPRIMIBLES · cotización, proforma, factura y boleta
 * ============================================================================
 *  Los cuatro documentos que salen del sistema hacia fuera —hacia el cliente,
 *  hacia la aduana, hacia el contador— se arman aquí, en un solo sitio.
 *
 *  ¿POR QUÉ UNO SOLO Y NO CUATRO?
 *  Porque los cuatro dicen lo mismo con distinto encabezado: quién vende,
 *  quién compra, qué, cuánto, a qué precio y cuánto suma. Si cada uno se
 *  armara por su cuenta, el día que cambie el RUC de la empresa habría que
 *  acordarse de cambiarlo en cuatro lugares, y en el cuarto no se acordaría
 *  nadie.
 *
 *  LA VERIFICACIÓN NO ES DECORATIVA
 *  Un documento que dice algo distinto de lo que dice el sistema es peor que
 *  no tener documento: se manda al cliente, se cobra otra cifra, y cuando se
 *  descubre ya se firmó. Así que antes de imprimir se comprueba:
 *
 *    · que los importes de cada línea cuadren con cantidad × precio − descuento
 *    · que la suma de las líneas cuadre con el subtotal guardado
 *    · que subtotal + IGV cuadre con el total guardado
 *    · que no falte nada obligatorio: RUC del emisor, datos del comprador,
 *      al menos una línea, cantidades y precios con sentido
 *    · que el impuesto corresponda: una exportación peruana no lleva IGV
 *
 *  Lo que impide emitir se devuelve como ERROR; lo que hay que mirar pero no
 *  invalida el documento, como AVISO —y se imprime dentro, para que quien lo
 *  recibe lo vea y no quede escondido en una pantalla.
 * ============================================================================
 */
import { crearClienteServidor } from '@/lib/supabase/servidor';

export type TipoDocumento = 'cotizacion' | 'proforma' | 'factura' | 'boleta';

/** Céntimo de tolerancia: los decimales de la base y los de aquí redondean distinto. */
const TOLERANCIA = 0.02;

export type LineaDocumento = {
  n: number;
  codigo: string;
  descripcion: string;
  presentacion: string;
  cantidadTm: number;
  precioTm: number;
  descuentoPct: number;
  importe: number;
};

export type Documento = {
  tipo: TipoDocumento;
  /** «FACTURA», «BOLETA DE VENTA», «COTIZACIÓN», «PROFORMA INVOICE». */
  titulo: string;
  numero: string;
  /** Sello diagonal sobre el documento: ANULADA, VENCIDA, BORRADOR. */
  sello: string | null;

  emisor: { razonSocial: string; ruc: string; direccion: string; marca: string };
  receptor: {
    razonSocial: string;
    identificacion: string;
    etiquetaIdentificacion: string;
    pais: string;
    contacto: string;
    email: string;
  };

  /** Pares etiqueta/valor de la cabecera. Cambian según el documento. */
  datos: { etiqueta: string; valor: string }[];

  lineas: LineaDocumento[];
  totales: { subtotal: number; descuento: number; igv: number; igvPct: number; total: number };
  moneda: 'USD' | 'PEN';

  /** Texto legal y condiciones que van al pie. */
  notas: string[];
  observaciones: string | null;

  /** Resultado de la verificación. */
  errores: string[];
  avisos: string[];
};

/* ==========================================================================
   AYUDANTES
   ========================================================================== */

function uno<T>(v: unknown): T | undefined {
  return (Array.isArray(v) ? v[0] : v) as T | undefined;
}

const redondear = (n: number) => Math.round(n * 100) / 100;

/** ¿Es un RUC peruano? Once dígitos, ni más ni menos. */
const esRucPeruano = (id: string | null | undefined) => !!id && /^[0-9]{11}$/.test(id.trim());

function fechaCorta(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/**
 * Los datos de la empresa que emite. Viven en Parámetros y no en el código
 * justamente para que cambiar una dirección no requiera un despliegue.
 */
async function cargarEmisor() {
  const supabase = await crearClienteServidor();
  const { data } = await supabase
    .from('parametros')
    .select('clave, valor')
    .in('clave', ['empresa_razon_social', 'empresa_ruc', 'empresa_direccion', 'empresa_marca']);

  const p = new Map((data ?? []).map((x) => [x.clave as string, String(x.valor ?? '')]));
  return {
    razonSocial: p.get('empresa_razon_social') ?? '',
    ruc: p.get('empresa_ruc') ?? '',
    direccion: p.get('empresa_direccion') ?? '',
    marca: p.get('empresa_marca') ?? '',
  };
}

/** Arma la descripción del producto tal como debe leerla el cliente. */
function describirProducto(sp: Record<string, unknown> | undefined) {
  const sku = uno<Record<string, unknown>>(sp?.skus);
  const pres = uno<Record<string, unknown>>(sp?.presentaciones);
  const especie = uno<Record<string, unknown>>(sku?.especies);
  const formato = uno<Record<string, unknown>>(sku?.formatos);
  return {
    codigo: String(sku?.codigo ?? '—'),
    descripcion: [especie?.nombre, formato?.nombre, sku?.corte].filter(Boolean).join(' · '),
    presentacion: String(pres?.descripcion ?? '—'),
  };
}

/* ==========================================================================
   VERIFICACIÓN
   --------------------------------------------------------------------------
   Se separa de la carga a propósito: así se puede comprobar un documento sin
   imprimirlo, que es lo que hace la pantalla antes de ofrecer el botón.
   ========================================================================== */
function verificar(
  doc: Omit<Documento, 'errores' | 'avisos'>,
  guardado?: { subtotal: number; igv: number; total: number }
): { errores: string[]; avisos: string[] } {
  const errores: string[] = [];
  const avisos: string[] = [];

  /* ---- Lo que impide emitir ---- */
  if (!doc.emisor.razonSocial || !doc.emisor.ruc) {
    errores.push('Faltan los datos de la empresa emisora. Complételos en Configuración → Parámetros.');
  }
  if (!doc.receptor.razonSocial) {
    errores.push('El documento no tiene cliente.');
  }
  if (doc.lineas.length === 0) {
    errores.push('El documento no tiene ninguna línea de producto.');
  }

  for (const l of doc.lineas) {
    if (!(l.cantidadTm > 0)) {
      errores.push(`La línea ${l.n} (${l.codigo}) no tiene cantidad.`);
    }
    if (l.precioTm < 0) {
      errores.push(`La línea ${l.n} (${l.codigo}) tiene un precio negativo.`);
    }
    // El importe se recalcula y se compara con el que va a imprimirse.
    const esperado = redondear(l.cantidadTm * l.precioTm * (1 - l.descuentoPct / 100));
    if (Math.abs(esperado - l.importe) > TOLERANCIA) {
      errores.push(
        `La línea ${l.n} no cuadra: ${l.cantidadTm} TM × ${l.precioTm} con ${l.descuentoPct} % de descuento ` +
          `da ${esperado}, pero figura ${l.importe}.`
      );
    }
  }

  /* ---- Los totales, recalculados desde cero ---- */
  const sumaLineas = redondear(doc.lineas.reduce((s, l) => s + l.importe, 0));
  if (Math.abs(sumaLineas - doc.totales.subtotal) > TOLERANCIA) {
    errores.push(
      `El subtotal no cuadra con las líneas: suman ${sumaLineas} y figura ${doc.totales.subtotal}.`
    );
  }

  const totalEsperado = redondear(doc.totales.subtotal + doc.totales.igv);
  if (Math.abs(totalEsperado - doc.totales.total) > TOLERANCIA) {
    errores.push(
      `El total no cuadra: ${doc.totales.subtotal} + ${doc.totales.igv} da ${totalEsperado}, ` +
        `pero figura ${doc.totales.total}.`
    );
  }

  /*
   * Y contra lo GUARDADO en la base, cuando el documento tiene sus totales
   * escritos. Esta es la comprobación que de verdad importa: detecta que la
   * factura diga una cosa y la contabilidad otra.
   */
  if (guardado) {
    if (Math.abs(guardado.subtotal - doc.totales.subtotal) > TOLERANCIA) {
      errores.push(
        `El subtotal guardado (${guardado.subtotal}) no coincide con el de las líneas (${doc.totales.subtotal}).`
      );
    }
    if (Math.abs(guardado.total - doc.totales.total) > TOLERANCIA) {
      errores.push(
        `El total guardado (${guardado.total}) no coincide con el calculado (${doc.totales.total}).`
      );
    }
  }

  /* ---- Lo que hay que mirar, pero no impide emitir ---- */
  if (!doc.receptor.identificacion || doc.receptor.identificacion === '—') {
    avisos.push(
      `El cliente no tiene ${doc.receptor.etiquetaIdentificacion} registrado. Un comprobante sin ` +
        'identificación fiscal del comprador puede ser observado.'
    );
  }

  if (doc.tipo === 'factura' && doc.receptor.pais === 'Perú' && !esRucPeruano(doc.receptor.identificacion)) {
    avisos.push(
      'Factura a un cliente peruano sin RUC válido de 11 dígitos. Si es consumidor final, ' +
        'corresponde emitir boleta.'
    );
  }

  /*
   * La exportación de bienes no grava IGV en Perú. Si una factura a un cliente
   * del extranjero lleva impuesto, o está mal calculada o está mal clasificada;
   * en ambos casos alguien va a pagar de más.
   */
  const esExportacion = doc.receptor.pais !== 'Perú' && doc.receptor.pais !== '—';
  if (esExportacion && doc.totales.igv > TOLERANCIA) {
    avisos.push(
      `Documento de exportación (${doc.receptor.pais}) con IGV de ${doc.totales.igv}. ` +
        'La exportación de bienes no grava IGV: revise la clasificación de la operación.'
    );
  }

  if (doc.tipo === 'boleta' && doc.numero.toUpperCase().startsWith('F')) {
    avisos.push(
      `El correlativo ${doc.numero} usa serie de factura (F) en una boleta. Las boletas van con serie B.`
    );
  }

  if (doc.totales.descuento > 0 && doc.totales.subtotal > 0) {
    const pct = (doc.totales.descuento / (doc.totales.subtotal + doc.totales.descuento)) * 100;
    if (pct > 20) {
      avisos.push(`El descuento total es del ${pct.toFixed(1)} %, por encima de lo habitual.`);
    }
  }

  return { errores, avisos };
}

/* ==========================================================================
   CARGA DE CADA DOCUMENTO
   ========================================================================== */

async function cargarCotizacion(id: number): Promise<Documento> {
  const supabase = await crearClienteServidor();
  const [emisor, { data: cot }, { data: lineas }, { data: parametros }] = await Promise.all([
    cargarEmisor(),
    supabase
      .from('cotizaciones')
      .select('*, clientes(razon_social, ruc_tax_id, pais, contacto, email), vendedores(nombre), destinos(puerto, pais), listas_precio(nombre, incoterm)')
      .eq('id', id)
      .single(),
    supabase
      .from('cotizacion_lineas')
      .select('cantidad_tm, precio_tm, descuento_pct, orden, sku_presentaciones(skus(codigo, corte, especies(nombre), formatos(nombre)), presentaciones(descripcion))')
      .eq('cotizacion_id', id)
      .order('orden'),
    supabase.from('parametros').select('clave, valor').eq('clave', 'igv_porcentaje'),
  ]);

  if (!cot) throw new Error('La cotización no existe.');

  const cliente = uno<Record<string, unknown>>(cot.clientes);
  const moneda = cot.moneda as 'USD' | 'PEN';
  const igvPct = Number(parametros?.[0]?.valor ?? 18);

  const filas: LineaDocumento[] = (lineas ?? []).map((l, i) => {
    const p = describirProducto(uno<Record<string, unknown>>(l.sku_presentaciones));
    const cantidad = Number(l.cantidad_tm);
    const precio = Number(l.precio_tm);
    const desc = Number(l.descuento_pct ?? 0);
    return {
      n: i + 1,
      ...p,
      cantidadTm: cantidad,
      precioTm: precio,
      descuentoPct: desc,
      importe: redondear(cantidad * precio * (1 - desc / 100)),
    };
  });

  const subtotal = redondear(filas.reduce((s, l) => s + l.importe, 0));
  const bruto = redondear((lineas ?? []).reduce((s, l) => s + Number(l.cantidad_tm) * Number(l.precio_tm), 0));

  /*
   * La cotización no grava: es una oferta, no una operación. Se muestra el
   * IGV que se aplicaría para que el cliente sepa a qué atenerse, salvo en
   * exportación, donde no hay.
   */
  const esExportacion = String(cliente?.pais ?? '') !== 'Perú';
  const igv = esExportacion ? 0 : redondear(subtotal * (igvPct / 100));

  const validez = Number(cot.validez_dias ?? 15);
  const vence = new Date(new Date(cot.fecha as string).getTime() + validez * 86400000);

  const base: Omit<Documento, 'errores' | 'avisos'> = {
    tipo: 'cotizacion',
    titulo: 'COTIZACIÓN',
    numero: String(cot.numero),
    sello: cot.estado === 'rechazada' ? 'RECHAZADA' : cot.estado === 'borrador' ? 'BORRADOR' : null,
    emisor,
    receptor: {
      razonSocial: String(cliente?.razon_social ?? ''),
      identificacion: String(cliente?.ruc_tax_id ?? '—'),
      etiquetaIdentificacion: esExportacion ? 'Tax ID' : 'RUC',
      pais: String(cliente?.pais ?? '—'),
      contacto: String(cliente?.contacto ?? ''),
      email: String(cliente?.email ?? ''),
    },
    datos: [
      { etiqueta: 'Fecha', valor: fechaCorta(cot.fecha as string) },
      { etiqueta: 'Validez', valor: `${validez} días · hasta ${fechaCorta(vence.toISOString())}` },
      { etiqueta: 'Incoterm', valor: String(cot.incoterm ?? '—') },
      { etiqueta: 'Destino', valor: String(uno<Record<string, unknown>>(cot.destinos)?.puerto ?? 'Por definir') },
      { etiqueta: 'Vendedor', valor: String(uno<Record<string, unknown>>(cot.vendedores)?.nombre ?? 'Venta directa') },
      { etiqueta: 'Moneda', valor: `${moneda}${moneda === 'USD' ? ` · TC ${Number(cot.tipo_cambio).toFixed(3)}` : ''}` },
    ],
    lineas: filas,
    totales: { subtotal, descuento: redondear(bruto - subtotal), igv, igvPct: esExportacion ? 0 : igvPct, total: redondear(subtotal + igv) },
    moneda,
    notas: [
      `Esta cotización es una oferta y tiene una validez de ${validez} días desde su emisión.`,
      'Los precios están sujetos a disponibilidad al momento de confirmar el pedido.',
      esExportacion
        ? 'Operación de exportación: no grava IGV según la legislación peruana.'
        : `Los precios no incluyen IGV (${igvPct} %), que se detalla por separado.`,
      'Este documento no constituye compromiso de entrega hasta su conversión en pedido.',
    ],
    observaciones: (cot.observaciones as string) ?? null,
  };

  return { ...base, ...verificar(base) };
}

async function cargarProforma(id: number): Promise<Documento> {
  const supabase = await crearClienteServidor();
  const [emisor, { data: ped }, { data: lineas }, { data: parametros }] = await Promise.all([
    cargarEmisor(),
    supabase
      .from('pedidos')
      .select('*, clientes(razon_social, ruc_tax_id, pais, contacto, email), vendedores(nombre), destinos(puerto, pais)')
      .eq('id', id)
      .single(),
    supabase
      .from('pedido_lineas')
      .select('cantidad_tm, precio_tm, descuento_pct, orden, sku_presentaciones(skus(codigo, corte, especies(nombre), formatos(nombre)), presentaciones(descripcion))')
      .eq('pedido_id', id)
      .order('orden'),
    supabase.from('parametros').select('clave, valor').eq('clave', 'igv_porcentaje'),
  ]);

  if (!ped) throw new Error('El pedido no existe.');

  const cliente = uno<Record<string, unknown>>(ped.clientes);
  const moneda = ped.moneda as 'USD' | 'PEN';
  const igvPct = Number(parametros?.[0]?.valor ?? 18);
  const esExportacion = String(cliente?.pais ?? '') !== 'Perú';

  const filas: LineaDocumento[] = (lineas ?? []).map((l, i) => {
    const p = describirProducto(uno<Record<string, unknown>>(l.sku_presentaciones));
    const cantidad = Number(l.cantidad_tm);
    const precio = Number(l.precio_tm);
    const desc = Number(l.descuento_pct ?? 0);
    return {
      n: i + 1,
      ...p,
      cantidadTm: cantidad,
      precioTm: precio,
      descuentoPct: desc,
      importe: redondear(cantidad * precio * (1 - desc / 100)),
    };
  });

  const subtotal = redondear(filas.reduce((s, l) => s + l.importe, 0));
  const bruto = redondear((lineas ?? []).reduce((s, l) => s + Number(l.cantidad_tm) * Number(l.precio_tm), 0));
  const igv = esExportacion ? 0 : redondear(subtotal * (igvPct / 100));

  const base: Omit<Documento, 'errores' | 'avisos'> = {
    tipo: 'proforma',
    titulo: esExportacion ? 'PROFORMA INVOICE' : 'PROFORMA',
    numero: String(ped.numero_proforma),
    sello: ped.ciclo === 'cancelado' ? 'CANCELADO' : ped.ciclo === 'borrador' ? 'BORRADOR' : null,
    emisor,
    receptor: {
      razonSocial: String(cliente?.razon_social ?? ''),
      identificacion: String(cliente?.ruc_tax_id ?? '—'),
      etiquetaIdentificacion: esExportacion ? 'Tax ID' : 'RUC',
      pais: String(cliente?.pais ?? '—'),
      contacto: String(cliente?.contacto ?? ''),
      email: String(cliente?.email ?? ''),
    },
    datos: [
      { etiqueta: 'Fecha', valor: fechaCorta(ped.creado_en as string) },
      { etiqueta: 'Orden de compra', valor: String(ped.oc_cliente ?? '—') },
      { etiqueta: 'Incoterm', valor: String(ped.incoterm ?? '—') },
      { etiqueta: 'Destino', valor: String(uno<Record<string, unknown>>(ped.destinos)?.puerto ?? 'Por definir') },
      { etiqueta: 'Entrega comprometida', valor: fechaCorta(ped.fecha_comprometida as string) },
      { etiqueta: 'Condición de pago', valor: `${String(ped.condicion_pago ?? '—')} · ${Number(ped.dias_credito ?? 0)} días` },
      { etiqueta: 'Moneda', valor: `${moneda}${moneda === 'USD' ? ` · TC ${Number(ped.tipo_cambio).toFixed(3)}` : ''}` },
    ],
    lineas: filas,
    totales: { subtotal, descuento: redondear(bruto - subtotal), igv, igvPct: esExportacion ? 0 : igvPct, total: redondear(subtotal + igv) },
    moneda,
    notas: [
      'Documento proforma emitido para trámites de importación y apertura de crédito documentario.',
      esExportacion
        ? 'Operación de exportación: no grava IGV según la legislación peruana.'
        : `Incluye IGV del ${igvPct} %.`,
      'La mercadería viaja bajo el incoterm indicado. Los pesos son netos.',
      'Producto congelado. Conservar a −18 °C o menos.',
    ],
    observaciones: (ped.observaciones as string) ?? null,
  };

  return { ...base, ...verificar(base) };
}

async function cargarComprobante(id: number): Promise<Documento> {
  const supabase = await crearClienteServidor();
  const [emisor, { data: fac }, { data: lineas }] = await Promise.all([
    cargarEmisor(),
    supabase
      .from('facturas')
      .select('*, clientes(razon_social, ruc_tax_id, pais, contacto, email, dias_credito), pedidos(numero_proforma, incoterm, oc_cliente, destinos(puerto, pais))')
      .eq('id', id)
      .single(),
    supabase
      .from('factura_lineas')
      .select('cantidad_tm, precio_tm, importe, sku_presentaciones(skus(codigo, corte, especies(nombre), formatos(nombre)), presentaciones(descripcion))')
      .eq('factura_id', id),
  ]);

  if (!fac) throw new Error('El comprobante no existe.');

  const cliente = uno<Record<string, unknown>>(fac.clientes);
  const pedido = uno<Record<string, unknown>>(fac.pedidos);
  const moneda = fac.moneda as 'USD' | 'PEN';
  const esBoleta = fac.tipo_comprobante === 'boleta';
  const esExportacion = String(cliente?.pais ?? '') !== 'Perú';

  const filas: LineaDocumento[] = (lineas ?? []).map((l, i) => {
    const p = describirProducto(uno<Record<string, unknown>>(l.sku_presentaciones));
    return {
      n: i + 1,
      ...p,
      cantidadTm: Number(l.cantidad_tm),
      precioTm: Number(l.precio_tm),
      descuentoPct: 0,
      // El importe se toma TAL COMO ESTÁ GUARDADO, no recalculado: es lo que
      // se contabilizó. Si no cuadra, la verificación lo dirá; corregirlo por
      // nuestra cuenta escondería el problema.
      importe: Number(l.importe),
    };
  });

  const subtotalGuardado = Number(fac.subtotal);
  const igvGuardado = Number(fac.igv);
  const totalGuardado = Number(fac.total);
  const igvPct = subtotalGuardado > 0 ? redondear((igvGuardado / subtotalGuardado) * 100) : 0;

  const base: Omit<Documento, 'errores' | 'avisos'> = {
    tipo: esBoleta ? 'boleta' : 'factura',
    titulo: esBoleta
      ? 'BOLETA DE VENTA ELECTRÓNICA'
      : esExportacion
      ? 'FACTURA DE EXPORTACIÓN'
      : 'FACTURA ELECTRÓNICA',
    numero: String(fac.numero),
    sello: fac.estado === 'anulada' ? 'ANULADA' : null,
    emisor,
    receptor: {
      razonSocial: String(cliente?.razon_social ?? ''),
      identificacion: String(cliente?.ruc_tax_id ?? '—'),
      etiquetaIdentificacion: esBoleta ? 'DNI' : esExportacion ? 'Tax ID' : 'RUC',
      pais: String(cliente?.pais ?? '—'),
      contacto: String(cliente?.contacto ?? ''),
      email: String(cliente?.email ?? ''),
    },
    datos: [
      { etiqueta: 'Fecha de emisión', valor: fechaCorta(fac.fecha_emision as string) },
      { etiqueta: 'Fecha de vencimiento', valor: fechaCorta(fac.fecha_vencimiento as string) },
      { etiqueta: 'Proforma', valor: String(pedido?.numero_proforma ?? '—') },
      { etiqueta: 'Orden de compra', valor: String(pedido?.oc_cliente ?? '—') },
      { etiqueta: 'Incoterm', valor: String(pedido?.incoterm ?? '—') },
      { etiqueta: 'Destino', valor: String(uno<Record<string, unknown>>(pedido?.destinos)?.puerto ?? '—') },
      { etiqueta: 'Condición', valor: `${Number(cliente?.dias_credito ?? 0)} días de crédito` },
      { etiqueta: 'Moneda', valor: `${moneda}${moneda === 'USD' ? ` · TC ${Number(fac.tipo_cambio).toFixed(3)}` : ''}` },
    ],
    lineas: filas,
    totales: {
      subtotal: subtotalGuardado,
      descuento: 0,
      igv: igvGuardado,
      igvPct,
      total: totalGuardado,
    },
    moneda,
    notas: [
      esBoleta
        ? 'Representación impresa de la boleta de venta electrónica.'
        : 'Representación impresa de la factura electrónica.',
      esExportacion
        ? 'Operación de exportación de bienes. Inafecta al IGV.'
        : `Operación gravada con IGV del ${igvPct.toFixed(0)} %.`,
      'Producto congelado. Conservar a −18 °C o menos.',
      fac.estado === 'anulada'
        ? `Documento ANULADO el ${fechaCorta(fac.anulada_en as string)}. ${String(fac.motivo_anulacion ?? '')}`
        : 'Conserve este documento para cualquier reclamo.',
    ],
    observaciones: null,
  };

  return {
    ...base,
    ...verificar(base, { subtotal: subtotalGuardado, igv: igvGuardado, total: totalGuardado }),
  };
}

/* ==========================================================================
   PUNTO DE ENTRADA
   ========================================================================== */

/**
 * Arma el documento pedido, ya verificado.
 *
 * No lanza si la verificación falla: devuelve el documento con sus errores,
 * y quien lo pinta decide qué hacer. Así la pantalla puede avisar «esta
 * factura no cuadra» sin dejar de mostrar por qué.
 */
export async function cargarDocumento(tipo: TipoDocumento, id: number): Promise<Documento> {
  switch (tipo) {
    case 'cotizacion':
      return cargarCotizacion(id);
    case 'proforma':
      return cargarProforma(id);
    case 'factura':
    case 'boleta':
      return cargarComprobante(id);
    default:
      throw new Error(`Tipo de documento desconocido: ${tipo}`);
  }
}

/** Nombre del archivo que se descarga, sin extensión. */
export function nombreArchivo(doc: Documento): string {
  // Se quitan los acentos antes de armar el nombre: un archivo llamado
  // «FACTURA-DE-EXPORTACIÓN» viaja mal por correo y peor por FTP.
  const limpio = (t: string) =>
    t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '-');
  return `${limpio(doc.titulo)}-${limpio(doc.numero)}`;
}
