/**
 * ============================================================================
 *  PROFORMA DE EXPORTACIÓN · el contrato de venta internacional
 * ============================================================================
 *  Este documento NO es un presupuesto con otro membrete. Es el papel con el
 *  que el comprador abre la carta de crédito en su banco y con el que su
 *  aduana autoriza la importación. Por eso se dibuja aparte del resto: cambia
 *  la estructura entera, no el color de una franja.
 *
 *  QUÉ LO HACE DISTINTO DE UNA FACTURA
 *
 *   · Habla en KILOS, no en toneladas. El precio se pacta por kilo —2.450
 *     USD/KG— y el peso se declara en kilos porque así viaja al conocimiento
 *     de embarque y al certificado sanitario.
 *
 *   · Identifica a la PLANTA, no solo a la empresa: el número FDA y el código
 *     CEU de SANIPES. Sin ellos el banco no acepta el documento.
 *
 *   · Nombra el producto tres veces —científico, inglés y castellano— porque
 *     cada autoridad usa uno distinto, y describe cada línea por sacos,
 *     bloques y talla, que es como se recibe la mercadería.
 *
 *   · Lleva las CONDICIONES del contrato: tolerancia de peso, zona de pesca,
 *     puertos, reparto del pago, documentos que se emitirán y las cláusulas
 *     que protegen al vendedor cuando la pesca no alcanza.
 *
 *   · Se firma POR LAS DOS PARTES, y por eso hay dos bloques de firma al pie.
 *
 *  083 · IGUAL QUE LA PROFORMA DE SANTA MÓNICA («Observaciones ERP 4»)
 *  Con la proforma SM26-384 de KULALIA como modelo, en su mismo orden:
 *
 *   · Punto 02: el detalle completo. Los ítems se agrupan por producto (con
 *     punta / sin punta) y cada línea dice sus sacos, el empaque por dentro y
 *     la talla: «4,050  BAGS X 20 KG - PACKING: 02 BLOCKS x 10 KG, SIZE:
 *     50CM-UP». Los reproductores con su nombre propio (productoDocumento.ts).
 *   · TODAS LAS LETRAS EN NEGRO. Antes los valores iban en azul de la marca.
 *   · Punto 04: sin el total en letras («que no aparezca, solo el número») y
 *     sin el recuadro de «observaciones de la verificación»: esas
 *     observaciones son para quien emite, no para el cliente, y ahora se
 *     muestran en pantalla al descargar.
 *   · Punto 05: el certificado de captura solo si se negoció en la cotización.
 *   · La firma de quien aprobó la cotización (o la de Gerencia por defecto).
 *
 *  Lo que se mantiene de antes, y en lo que mejora al modelo: los pesos y los
 *  importes se comprueban contra el sistema antes de imprimir —el TOTAL es la
 *  suma de las líneas; en el modelo, escrito a mano, decía 255 950,00 con
 *  cuatro líneas que suman 265 950,00—, los sacos se calculan del peso, y el
 *  identificador fiscal se rotula como se llama en el país del comprador.
 * ============================================================================
 */
import PDFDocument from 'pdfkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Documento, LineaDocumento } from './documentos';
import { limpiarDocumento, cifra } from './textoPdf';
import { pesoCorto } from './productoDocumento';

const MARGEN = 40;
const ANCHO_A4 = 595.28;
const ALTO_A4 = 841.89;
const ANCHO_UTIL = ANCHO_A4 - MARGEN * 2;

/** 083 · Todo el texto en negro, como el modelo (punto 02). */
const NEGRO = '#000000';
/** Solo el pie técnico (número de página) va en gris: no es parte del contrato. */
const GRIS_PIE = NEGRO;

type Lienzo = PDFKit.PDFDocument;

/**
 * Las cinco columnas del modelo. Suman el ancho útil exacto: si sumaran de
 * más, la última se saldría de la hoja sin avisar.
 */
const COL = {
  peso: 52,
  unidad: 46,
  descripcion: ANCHO_UTIL - 52 - 46 - 56 - 60,
  precio: 56,
  total: 60,
};

/** Dónde empiezan los valores dentro del bloque de condiciones. */
const SANGRIA_VALOR = 118;

/** Una fila «ETIQUETA: valor» del bloque de condiciones. */
function condicion(
  doc: Lienzo, etiqueta: string, valor: string, x: number, y: number, ancho: number,
  negrita = true,
): number {
  if (!valor) return y;
  if (etiqueta) {
    doc.fillColor(NEGRO).font('Helvetica-Bold').fontSize(7)
      .text(etiqueta, x, y, { width: SANGRIA_VALOR - 4 });
  }
  doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(7);
  const alto = doc.heightOfString(valor, { width: ancho - SANGRIA_VALOR });
  doc.fillColor(NEGRO).text(valor, x + SANGRIA_VALOR, y, { width: ancho - SANGRIA_VALOR });
  return y + Math.max(9, alto + 1);
}

/* ==========================================================================
   EL MEMBRETE
   ========================================================================== */
function membrete(doc: Lienzo, d: Documento): number {
  const e = d.exportacion!;
  let y = MARGEN;

  /*
   * El logotipo del modelo, a la derecha: el mismo del contrato (083, punto
   * 04, «unificar formato»). Si faltara, el de la aplicación.
   */
  for (const archivo of ['contrato-logo.png', 'logo.png']) {
    try {
      doc.image(readFileSync(join(process.cwd(), 'public', archivo)),
        ANCHO_A4 - MARGEN - 170, y - 6, { width: 170 });
      break;
    } catch {
      /* Sin logotipo el documento sale igual: no es motivo para no emitirlo. */
    }
  }

  doc.fillColor(NEGRO).font('Helvetica-Bold').fontSize(14)
    .text(d.emisor.razonSocial.toUpperCase(), MARGEN, y, { width: 330 });

  y = doc.y + 3;
  doc.fillColor(NEGRO).font('Helvetica').fontSize(6.8)
    .text(d.emisor.direccion.toUpperCase(), MARGEN, y, { width: 330 });

  const contacto = [
    e.telefono ? `TEL. ${e.telefono}` : '',
    e.fax ? `FAX. ${e.fax}` : '',
    e.web,
  ].filter(Boolean).join('  /  ');
  doc.text(contacto, MARGEN, doc.y + 2, { width: 330 });

  /*
   * Los registros sanitarios. Van en el membrete y no en un recuadro aparte
   * porque identifican a la planta igual que el nombre: es la planta la que
   * está habilitada para exportar, no el producto.
   */
  doc.text(`FDA NUMBER: ${e.fda}  /  CEU NUMBER: ${e.ceu}`, MARGEN, doc.y + 2, { width: 330 });

  /* ---- El título, a la derecha bajo el logotipo ---- */
  const yTitulo = MARGEN + 40;
  doc.fillColor(NEGRO).font('Helvetica-Bold').fontSize(11)
    .text('PROFORM / PROFORMA', ANCHO_A4 - MARGEN - 230, yTitulo, { width: 230, align: 'right' })
    .text('SALES CONTRACT', ANCHO_A4 - MARGEN - 230, doc.y, { width: 230, align: 'right' });

  return Math.max(doc.y, yTitulo + 28) + 10;
}

/* ==========================================================================
   EL COMPRADOR
   ========================================================================== */
function comprador(doc: Lienzo, d: Documento, y: number): number {
  const etiqueta = (t: string, yy: number) => {
    doc.fillColor(NEGRO).font('Helvetica-Bold').fontSize(7.5)
      .text(t, MARGEN, yy, { width: 140 });
  };
  /* Los valores van en negrita, como el modelo. */
  const valor = (t: string, yy: number) => {
    doc.fillColor(NEGRO).font('Helvetica-Bold').fontSize(8)
      .text(t, xValor, yy, { width: anchoValor });
  };
  const xValor = MARGEN + 150;
  const anchoValor = ANCHO_UTIL - 150 - 120;

  etiqueta('CUSTOMER / CLIENTE:', y);
  valor(d.receptor.razonSocial.toUpperCase(), y);
  y = doc.y + 8;

  etiqueta('ADDRESS / DIRECCIÓN:', y);
  if (d.receptor.direccion) {
    valor(d.receptor.direccion.toUpperCase(), y);
    y = doc.y;
  }
  /*
   * El identificador fiscal se rotula como se llama EN SU PAÍS: «CIF» en
   * España, «USCI» en China. Va debajo de la dirección, como el modelo.
   */
  if (d.receptor.identificacion && d.receptor.identificacion !== '—') {
    valor(`${d.receptor.etiquetaIdentificacion.toUpperCase()} ${d.receptor.identificacion}`, y);
  }
  y = doc.y + 10;

  etiqueta('PROFORM / PROFORMA Nº:', y);
  valor(d.numero, y);
  y = doc.y + 8;

  etiqueta('DATE / FECHA:', y);
  valor(d.exportacion?.fechaTexto || (d.datos.find((x) => x.etiqueta === 'Fecha')?.valor ?? ''), y);

  return doc.y + 12;
}

/* ==========================================================================
   LA TABLA
   ========================================================================== */

/** El recuadro de la tabla y las rayas entre columnas, de un alto dado. */
function marco(doc: Lienzo, y: number, alto: number) {
  doc.rect(MARGEN, y, ANCHO_UTIL, alto)
    .lineWidth(0.8).strokeColor(NEGRO).stroke();
  let x = MARGEN;
  for (const ancho of [COL.peso, COL.unidad, COL.descripcion, COL.precio]) {
    x += ancho;
    doc.moveTo(x, y).lineTo(x, y + alto).lineWidth(0.5).strokeColor(NEGRO).stroke();
  }
}

/** La fila de rótulos. Como el modelo: «UNIT PRICE / CFR USD/KGS». */
function encabezado(doc: Lienzo, d: Documento, y: number): number {
  const alto = 24;
  doc.rect(MARGEN, y, ANCHO_UTIL, alto).lineWidth(0.8).strokeColor(NEGRO).stroke();
  const incoterm = d.exportacion?.incoterm ?? '';

  let x = MARGEN;
  const celda = (ancho: number, arriba: string, abajo: string) => {
    doc.fillColor(NEGRO).font('Helvetica').fontSize(6.5);
    if (abajo) {
      doc.text(arriba, x, y + 5, { width: ancho, align: 'center' });
      doc.text(abajo, x, y + 13, { width: ancho, align: 'center' });
    } else {
      doc.text(arriba, x, y + 9, { width: ancho, align: 'center' });
    }
    x += ancho;
    if (x < MARGEN + ANCHO_UTIL - 1) {
      doc.moveTo(x, y).lineTo(x, y + alto).lineWidth(0.5).strokeColor(NEGRO).stroke();
    }
  };

  celda(COL.peso, 'NET WEIGHT', '');
  celda(COL.unidad, 'UNIT', '');
  celda(COL.descripcion, 'DESCRIPTION', '');
  celda(COL.precio, 'UNIT PRICE', `${incoterm ? `${incoterm} ` : ''}USD/KGS`);
  celda(COL.total, 'TOTAL', 'USD');

  return y + alto;
}

/**
 * La descripción de empaque de una línea, como la lee el almacén del
 * comprador: «BAGS X 20 KG - PACKING: 02 BLOCKS x 10 KG, SIZE: 50CM-UP».
 * Los ceros a la izquierda —«02 BLOCKS»— son los del modelo.
 */
function textoEmpaque(l: LineaDocumento): string {
  const bloques = l.bloques && l.pesoBloqueKg
    ? `PACKING: ${String(l.bloques).padStart(2, '0')} ${l.bloques === 1 ? 'BLOCK' : 'BLOCKS'} x ${pesoCorto(l.pesoBloqueKg)} KG`
    : '';
  const cabeza = `BAGS X ${pesoCorto(l.pesoBultoKg)} KG`;
  const resto = [bloques, l.talla ? `SIZE: ${l.talla}` : ''].filter(Boolean).join(', ');
  return resto ? `${cabeza} - ${resto}` : cabeza;
}

/**
 * El cuerpo de la tabla: una caja grande con el producto arriba, las líneas de
 * empaque debajo y las condiciones del contrato dentro, igual que el modelo.
 *
 * Se agrupan las líneas por PRODUCTO y no se lista una por una porque así se
 * lee: el comprador compró reproductores con punta, y dentro de esa compra hay
 * sacos de 20 kilos y sacos de 30. Repetir el nombre en cada renglón sería
 * ruido. El nombre científico va una sola vez mientras no cambie la especie.
 */
function cuerpo(doc: Lienzo, d: Documento, yInicial: number): number {
  const e = d.exportacion!;
  const x = { peso: MARGEN, unidad: MARGEN + COL.peso };
  const xDesc = MARGEN + COL.peso + COL.unidad;
  const xPrecio = xDesc + COL.descripcion;
  const xTotal = xPrecio + COL.precio;
  const anchoTexto = COL.descripcion - 10;

  /*
   * LA TABLA PUEDE NO CABER EN UNA HOJA.
   *
   * pdfkit crea una página nueva en cuanto un texto cruza el margen inferior,
   * así que un pedido largo salía con el marco de la tabla dibujado sobre la
   * primera hoja y el contenido repartido por las demás. Se cierra el marco al
   * final de la hoja, se salta, se repite el encabezado de columnas y se sigue.
   */
  const LIMITE = ALTO_A4 - MARGEN - 18;
  let yMarco = yInicial;
  let y = yInicial + 6;

  /** Cierra el marco de esta hoja, salta a la siguiente y repite el encabezado. */
  const saltarPagina = () => {
    marco(doc, yMarco, y - yMarco + 4);
    doc.addPage();
    y = encabezado(doc, d, MARGEN);
    yMarco = y;
    y += 6;
  };

  /** Reserva sitio: si lo que viene no cabe, cambia de hoja antes de dibujarlo. */
  const asegurar = (alto: number) => { if (y + alto > LIMITE) saltarPagina(); };

  /* ---- El código de planta, centrado sobre todo lo demás ---- */
  doc.fillColor(NEGRO).font('Helvetica-Bold').fontSize(7.5)
    .text(`CEU NUMBER: ${e.ceu}`, xDesc, y, { width: COL.descripcion, align: 'center' });
  y = doc.y + 4;

  /* ---- Agrupación por producto ---- */
  const grupos = new Map<string, LineaDocumento[]>();
  for (const l of d.lineas) {
    const clave = `${l.cientifico}|${l.ingles}|${l.espanol}`;
    (grupos.get(clave) ?? grupos.set(clave, []).get(clave)!).push(l);
  }

  let cientificoAnterior = '';
  let primero = true;
  for (const [clave, lineas] of grupos) {
    const [cientifico, ingles, espanol] = clave.split('|');

    // Un producto no se parte del renglón siguiente: sus nombres y al menos
    // su primera línea de empaque van juntos o van a la hoja siguiente.
    asegurar(30 + 11);
    if (!primero) y += 8;
    primero = false;

    doc.fillColor(NEGRO).font('Helvetica-Bold').fontSize(7.5);
    if (cientifico && cientifico.toUpperCase() !== cientificoAnterior) {
      doc.text(cientifico.toUpperCase(), xDesc + 4, y, { width: anchoTexto });
      y = doc.y;
      cientificoAnterior = cientifico.toUpperCase();
    }
    if (ingles) { doc.text(ingles, xDesc + 4, y, { width: anchoTexto }); y = doc.y; }
    if (espanol) { doc.text(espanol, xDesc + 4, y, { width: anchoTexto }); y = doc.y; }
    y += 1;

    for (const l of lineas) {
      asegurar(11);
      const yFila = y;

      /* Los sacos, alineados a la derecha en su propio hueco, como el modelo. */
      doc.fillColor(NEGRO).font('Helvetica').fontSize(7)
        .text(cifra(l.bultos, 0), xDesc + 4, yFila, { width: 26, align: 'right' });
      doc.text(textoEmpaque(l), xDesc + 36, yFila, { width: anchoTexto - 32 });
      const yFin = doc.y;

      /* ---- Las cifras ---- */
      doc.font('Helvetica').fontSize(7)
        .text(cifra(l.pesoNetoKg), x.peso + 2, yFila, { width: COL.peso - 8, align: 'right' })
        .text('KGS', x.unidad, yFila, { width: COL.unidad, align: 'center' })
        .text(cifra(l.precioKg, 3), xPrecio + 2, yFila, { width: COL.precio - 8, align: 'right' })
        .text(cifra(l.importe), xTotal + 2, yFila, { width: COL.total - 8, align: 'right' });

      y = Math.max(yFin, yFila + 9) + 1;
    }

    /* ---- El resumen del empaque del grupo: «*BAGS OF 30 KG AND/OR 20 KG» ---- */
    asegurar(11);
    const pesos = [...new Set(lineas.map((l) => l.pesoBultoKg).filter((k) => k > 0))]
      .sort((a, b) => b - a).map((k) => `${pesoCorto(k)} KG`);
    if (pesos.length) {
      doc.fillColor(NEGRO).font('Helvetica-Bold').fontSize(7)
        .text(`*BAGS OF ${pesos.join(' AND/OR ')}`, xDesc + 4, y, { width: anchoTexto });
      y = doc.y;
    }
  }

  /* ---- Las condiciones, dentro de la caja como en el modelo ---- */
  // Se leen como un bloque: partirlas por la mitad obliga a pasar de hoja
  // para saber a qué puerto va la carga.
  asegurar(110);
  y += 14;
  const anchoCond = anchoTexto;
  const xCond = xDesc + 4;

  y = condicion(doc, 'INCOTERMS:', e.incotermCompleto, xCond, y, anchoCond);
  y = condicion(doc, 'CONTAINER:',
    e.contenedores > 0 && e.contenedorTipo
      ? `${String(e.contenedores).padStart(2, '0')} FCL ${e.contenedorTipo}`
      : '',
    xCond, y, anchoCond);
  y = condicion(doc, 'TOLERANCE:',
    e.toleranciaPct > 0 ? `${cifra(e.toleranciaPct, 0)}% +/-` : '', xCond, y, anchoCond);
  y = condicion(doc, 'COUNTRY OF ORIGIN:', e.paisOrigen, xCond, y, anchoCond);
  y = condicion(doc, 'FISHING ZONE:', e.zonaPesca, xCond, y, anchoCond);
  y = condicion(doc, 'SHIPMENT DATE:', e.mesEmbarque, xCond, y, anchoCond);
  y = condicion(doc, 'PORT OF LOADING:', e.puertoEmbarque, xCond, y, anchoCond);
  y = condicion(doc, 'PORT OF DISCHARGE:', e.puertoDescarga, xCond, y, anchoCond);

  /*
   * El reparto del pago. Se arma con el porcentaje pactado y no con un texto
   * fijo: es la condición que más se negocia, y un texto fijo obligaría a
   * corregir el PDF a mano cada vez que cambie.
   */
  if (e.adelantoPct > 0 && e.adelantoPct < 100) {
    y = condicion(doc, 'PAYMENT:', `${cifra(e.adelantoPct, 0)}% ADVANCE PAYMENT`, xCond, y, anchoCond);
    y = condicion(doc, '', `${cifra(100 - e.adelantoPct, 0)}% AGAINST COPY OF DOCUMENTS BY EMAIL`,
      xCond, y, anchoCond);
  } else if (e.adelantoPct >= 100) {
    y = condicion(doc, 'PAYMENT:', '100% ADVANCE PAYMENT', xCond, y, anchoCond);
  }

  /* ---- Dónde se paga ---- */
  const cuenta = d.cuentas.find((c) => c.tipo !== 'detraccion') ?? d.cuentas[0];
  if (cuenta) {
    asegurar(60);
    y += 8;
    y = condicion(doc, 'PAYMENT TO:', cuenta.banco.toUpperCase(), xCond, y, anchoCond);
    if (cuenta.direccionBanco) {
      y = condicion(doc, '', cuenta.direccionBanco.toUpperCase(), xCond, y, anchoCond, false);
    }
    y += 2;
    y = condicion(doc, 'SWIFT CODE:', cuenta.swift, xCond, y, anchoCond, false);
    y = condicion(doc, 'BANK ACCOUNT NUMBER:', cuenta.numero, xCond, y, anchoCond, false);
    // El CCI es peruano y solo sirve dentro del Perú; en una proforma de
    // exportación ocuparía sitio sin que nadie lo use.
    y = condicion(doc, 'BENEFICIARY:',
      (cuenta.titular || d.emisor.razonSocial).toUpperCase(), xCond, y, anchoCond);
  }

  /* ---- Documentos que se emitirán (con el certificado de captura si se negoció) ---- */
  if (e.documentos.length) {
    asegurar(16 + e.documentos.length * 9);
    y += 8;
    doc.fillColor(NEGRO).font('Helvetica-Bold').fontSize(7)
      .text('DOCUMENTS REQUIRED AND/OR TO ISSUE:', xCond, y, { width: anchoCond });
    y = doc.y + 1;
    for (const doc_ of e.documentos) {
      doc.fillColor(NEGRO).font('Helvetica-Bold').fontSize(7)
        .text(doc_, xCond + SANGRIA_VALOR, y, { width: anchoCond - SANGRIA_VALOR });
      y = doc.y;
    }
  }

  /* ---- Condiciones del contrato ---- */
  if (e.condiciones.length) {
    asegurar(14 + e.condiciones.length * 11);
    y += 8;
    doc.fillColor(NEGRO).font('Helvetica-Bold').fontSize(7)
      .text('CONDITIONS:', xCond, y, { width: SANGRIA_VALOR - 4 });
    let yc = y;
    for (const c of e.condiciones) {
      doc.fillColor(NEGRO).font('Helvetica-Bold').fontSize(7)
        .text(c, xCond + SANGRIA_VALOR, yc, { width: anchoCond - SANGRIA_VALOR });
      yc = doc.y;
    }
    y = yc;
  }

  /* ---- El marco de la última hoja: hasta aquí no se sabía dónde acababa ---- */
  const alto = y - yMarco + 10;
  marco(doc, yMarco, alto);
  return yMarco + alto;
}

/* ==========================================================================
   EL TOTAL
   ========================================================================== */
function total(doc: Lienzo, d: Documento, y: number): number {
  /*
   * El total y las dos firmas se leen juntos: son el cierre del contrato. Si
   * no caben en lo que queda de hoja, van enteros a la siguiente. Repartirlos
   * dejaría una firma huérfana, que en un contrato no es un detalle.
   */
  const ALTO_CIERRE = 112;
  if (y + ALTO_CIERRE > ALTO_A4 - MARGEN) {
    doc.addPage();
    y = MARGEN;
  }
  y += 8;
  const anchoEtiqueta = 62;
  const xTotal = MARGEN + ANCHO_UTIL - COL.total;
  const xEtiqueta = xTotal - anchoEtiqueta;

  doc.rect(xEtiqueta, y, anchoEtiqueta, 13).lineWidth(0.8).strokeColor(NEGRO).stroke();
  doc.rect(xTotal, y, COL.total, 13).lineWidth(0.8).strokeColor(NEGRO).stroke();

  doc.fillColor(NEGRO).font('Helvetica-Bold').fontSize(7.5)
    .text('TOTAL USD', xEtiqueta, y + 3.5, { width: anchoEtiqueta, align: 'center' });
  /*
   * Solo el número (083, punto 04: «que no aparezca [el total en letras],
   * solo el número»). Es la SUMA de las líneas, comprobada antes de imprimir.
   */
  doc.text(cifra(d.totales.total), xTotal + 2, y + 3.5, { width: COL.total - 8, align: 'right' });

  return y + 20;
}

/* ==========================================================================
   LAS FIRMAS
   ========================================================================== */

/**
 * Las dos firmas. Un contrato lo firman dos partes: si solo firmara el
 * vendedor sería una factura, no un acuerdo.
 *
 * Como el modelo: a la izquierda, encima de la raya, la firma de quien
 * aprobó la cotización con su nombre, su cargo, la empresa y el RUC (el
 * «sello» de Cathy Lee en la SM26-384); debajo, la empresa y la fecha. A la
 * derecha, la raya del comprador.
 */
function firmas(doc: Lienzo, d: Documento, y: number) {
  const ancho = 230;
  const xDer = MARGEN + ANCHO_UTIL - 200;
  const fecha = d.exportacion?.fechaTexto ?? '';
  const firmante = d.exportacion?.firmante ?? null;

  // Sitio para la firma y el sello encima de la raya.
  const yRaya = y + 66;
  const xSello = MARGEN + 40;
  const anchoSello = 150;

  if (firmante) {
    /*
     * La firma escaneada, si la hay. Si la imagen está mal —recortada, en un
     * formato que pdfkit no entiende— el documento sale igual, sin ella: un
     * contrato que no se puede emitir por una firma corrupta sería peor
     * problema que el que resuelve.
     */
    if (firmante.firma?.startsWith('data:image/')) {
      try {
        const base64 = firmante.firma.slice(firmante.firma.indexOf(',') + 1);
        doc.image(Buffer.from(base64, 'base64'), xSello, y, {
          fit: [anchoSello, 36], align: 'center', valign: 'bottom',
        });
      } catch {
        /* Sin firma escaneada: queda la raya, que es igual de válida. */
      }
    }
    let ys = y + 36;
    doc.fillColor(NEGRO).font('Helvetica').fontSize(6)
      .text(firmante.nombre, xSello, ys, { width: anchoSello, align: 'center' });
    ys = doc.y;
    if (firmante.cargo) {
      doc.text(firmante.cargo, xSello, ys, { width: anchoSello, align: 'center' });
      ys = doc.y;
    }
    doc.text(d.emisor.razonSocial, xSello, ys, { width: anchoSello, align: 'center' })
      .text(`RUC: ${d.emisor.ruc}`, xSello, doc.y, { width: anchoSello, align: 'center' });
  }

  doc.moveTo(MARGEN, yRaya).lineTo(MARGEN + ancho, yRaya)
    .lineWidth(0.6).strokeColor(NEGRO).stroke();
  doc.moveTo(xDer, yRaya).lineTo(xDer + 200, yRaya)
    .lineWidth(0.6).strokeColor(NEGRO).stroke();

  doc.fillColor(NEGRO).font('Helvetica-Bold').fontSize(7)
    .text(d.emisor.razonSocial.toUpperCase(), MARGEN, yRaya + 4, { width: ancho });
  const yFecha = doc.y + 1;
  doc.font('Helvetica').text('DATE:', MARGEN, yFecha, { width: 60 });
  doc.font('Helvetica-Bold').text(fecha, MARGEN + 62, yFecha, { width: ancho - 62 });

  doc.font('Helvetica-Bold').fontSize(7)
    .text(d.receptor.razonSocial.toUpperCase(), xDer, yRaya + 4, { width: 200 });
  doc.font('Helvetica')
    .text('SIGNED AND STAMPED', xDer, doc.y + 1, { width: 200 })
    .text('DATE:', xDer, doc.y + 1, { width: 200 });
}

/** El sello diagonal: BORRADOR, CANCELADO. */
function sello(doc: Lienzo, texto: string) {
  doc.save();
  doc.rotate(-32, { origin: [ANCHO_A4 / 2, ALTO_A4 / 2] });
  doc.fillColor('#C62828').opacity(0.1).font('Helvetica-Bold').fontSize(76)
    .text(texto, 0, ALTO_A4 / 2 - 40, { width: ANCHO_A4, align: 'center' });
  doc.restore();
  doc.opacity(1);
}

/* ==========================================================================
   EL DOCUMENTO ENTERO
   ========================================================================== */
export async function generarProformaExportacion(documento: Documento): Promise<Buffer> {
  const d = limpiarDocumento(documento);

  if (!d.exportacion) {
    throw new Error('Esta proforma no es de exportación: no lleva los datos del contrato internacional.');
  }
  if (d.errores.length) {
    throw new Error(
      `El documento no se puede emitir porque sus datos no cuadran:\n· ${d.errores.join('\n· ')}`
    );
  }

  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGEN,
    bufferPages: true,
    info: {
      Title: `PROFORMA ${d.numero}`,
      Author: d.emisor.razonSocial,
      Subject: `Proforma invoice / sales contract for ${d.receptor.razonSocial}`,
      Creator: 'Santa Mónica ERP',
    },
  });

  const trozos: Buffer[] = [];
  doc.on('data', (c: Buffer) => trozos.push(c));
  const terminado = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(trozos)));
  });

  let y = membrete(doc, d);
  y = comprador(doc, d, y);
  y = encabezado(doc, d, y);
  y = cuerpo(doc, d, y);
  y = total(doc, d, y);
  firmas(doc, d, y);

  /* ---- Numeración y sello en todas las páginas ---- */
  const rango = doc.bufferedPageRange();
  for (let i = 0; i < rango.count; i++) {
    doc.switchToPage(rango.start + i);
    if (d.sello) sello(doc, d.sello);

    // Solo con más de una hoja: el modelo, de una, no lleva pie. pdfkit crea
    // una página nueva ante cualquier texto que cruce el margen inferior; se
    // anula mientras se escribe el pie.
    if (rango.count > 1) {
      const margenOriginal = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.fillColor(GRIS_PIE).font('Helvetica').fontSize(6)
        .text(`PROFORMA ${d.numero}   ·   Page ${i + 1} / ${rango.count}`,
          MARGEN, ALTO_A4 - 24, { width: ANCHO_UTIL, align: 'center', lineBreak: false });
      doc.page.margins.bottom = margenOriginal;
    }
  }

  doc.end();
  return terminado;
}
