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
 *   · Se lee en DOS IDIOMAS. Lo firma un comprador que no habla castellano y
 *     lo revisa una aduana peruana que no trabaja en inglés. Cada rótulo lleva
 *     los dos: «NET WEIGHT / PESO NETO».
 *
 *   · Habla en KILOS, no en toneladas. El precio se pacta por kilo —1,700
 *     US$/KG— y el peso se declara en kilos porque así viaja al conocimiento
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
 *   · Se firma POR LAS DOS PARTES. Una factura la emite uno solo; un contrato
 *     lo firman dos, y por eso hay dos bloques de firma al pie.
 *
 *  EN QUÉ MEJORA AL MODELO QUE MANDÓ EL CLIENTE
 *  La estructura es deliberadamente la misma —quien la recibe lleva años
 *  leyéndola así y no hay que hacerle aprender otra— pero:
 *
 *   · Los pesos y los importes se comprueban contra lo que dice el sistema
 *     antes de imprimir. El original se escribía a mano en una hoja de
 *     cálculo, donde nada avisa si el total no es la suma.
 *   · Cada línea dice cuántos SACOS son, calculado del peso y no tecleado.
 *   · El identificador fiscal se rotula como se llama en el país del
 *     comprador: USCI en China, EIN en Estados Unidos.
 *   · El total va también en letras, que es lo que mira el banco cuando la
 *     cifra en números está borrosa en un fax.
 *   · Y si algo no cuadra, el aviso se imprime DENTRO del documento en lugar
 *     de quedarse en una pantalla que nadie mira.
 * ============================================================================
 */
import PDFDocument from 'pdfkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Documento, LineaDocumento } from './documentos';
import { importeEnLetras } from './importeEnLetras';
import { MARCA_PDF as MARCA, limpiarDocumento, cifra } from './textoPdf';

const MARGEN = 40;
const ANCHO_A4 = 595.28;
const ALTO_A4 = 841.89;
const ANCHO_UTIL = ANCHO_A4 - MARGEN * 2;

type Lienzo = PDFKit.PDFDocument;

/**
 * Las cinco columnas del modelo. Suman el ancho útil exacto: si sumaran de
 * más, la última se saldría de la hoja sin avisar.
 */
const COL = {
  peso: 74,
  unidad: 34,
  descripcion: ANCHO_UTIL - 74 - 34 - 62 - 76,
  precio: 62,
  total: 76,
};

/** Rótulo bilingüe: el comprador lee arriba, la aduana peruana lee abajo. */
function rotulo(doc: Lienzo, texto: string, x: number, y: number, ancho: number) {
  doc.fillColor(MARCA.tintaSuave).font('Helvetica-Bold').fontSize(6.2)
    .text(texto, x, y, { width: ancho, align: 'center' });
}

/** Una fila «ETIQUETA: valor» del bloque de condiciones. */
function condicion(doc: Lienzo, etiqueta: string, valor: string, x: number, y: number, ancho: number): number {
  if (!valor) return y;
  doc.fillColor(MARCA.tinta).font('Helvetica-Bold').fontSize(7)
    .text(etiqueta, x, y, { width: 108 });
  const alto = doc.heightOfString(valor, { width: ancho - 116 });
  doc.fillColor(MARCA.azulProfundo).font('Helvetica-Bold').fontSize(7)
    .text(valor, x + 116, y, { width: ancho - 116 });
  return y + Math.max(9, alto + 1);
}

/* ==========================================================================
   EL MEMBRETE
   ========================================================================== */
function membrete(doc: Lienzo, d: Documento): number {
  const e = d.exportacion!;
  let y = MARGEN;

  /* ---- Logotipo a la derecha, como en el original ---- */
  try {
    doc.image(readFileSync(join(process.cwd(), 'public', 'logo.png')),
      ANCHO_A4 - MARGEN - 150, y, { width: 150 });
  } catch {
    /* Sin logotipo el documento sale igual: no es motivo para no emitirlo. */
  }

  doc.fillColor(MARCA.azulProfundo).font('Helvetica-Bold').fontSize(14)
    .text(d.emisor.razonSocial.toUpperCase(), MARGEN, y, { width: 330 });

  y = doc.y + 2;
  doc.fillColor(MARCA.tinta).font('Helvetica').fontSize(6.8)
    .text(d.emisor.direccion.toUpperCase(), MARGEN, y, { width: 330 });

  const contacto = [
    e.telefono ? `TEL. ${e.telefono}` : '',
    e.fax ? `FAX. ${e.fax}` : '',
    e.web,
  ].filter(Boolean).join('  /  ');
  doc.text(contacto, MARGEN, doc.y + 1, { width: 330 });

  /*
   * Los registros sanitarios. Van en el membrete y no en un recuadro aparte
   * porque identifican a la planta igual que el nombre: es la planta la que
   * está habilitada para exportar, no el producto.
   */
  doc.fillColor(MARCA.tinta).font('Helvetica-Bold').fontSize(6.8)
    .text(`FDA NUMBER: ${e.fda}   /   CEU NUMBER: ${e.ceu}`, MARGEN, doc.y + 1, { width: 330 });

  /* ---- El título, a la derecha bajo el logotipo ---- */
  const yTitulo = MARGEN + 42;
  doc.fillColor(MARCA.azulProfundo).font('Helvetica-Bold').fontSize(12)
    .text('PROFORM / PROFORMA', ANCHO_A4 - MARGEN - 230, yTitulo, { width: 230, align: 'right' })
    .fontSize(11)
    .text('SALES CONTRACT', ANCHO_A4 - MARGEN - 230, doc.y, { width: 230, align: 'right' });

  return Math.max(doc.y, yTitulo + 30) + 9;
}

/* ==========================================================================
   EL COMPRADOR
   ========================================================================== */
function comprador(doc: Lienzo, d: Documento, y: number): number {
  const etiqueta = (t: string, yy: number) => {
    doc.fillColor(MARCA.tinta).font('Helvetica-Bold').fontSize(7.5)
      .text(t, MARGEN, yy, { width: 130 });
  };
  const xValor = MARGEN + 138;
  const anchoValor = ANCHO_UTIL - 138;

  etiqueta('CUSTOMER / CLIENTE:', y);
  doc.fillColor(MARCA.tinta).font('Helvetica-Bold').fontSize(8.5)
    .text(d.receptor.razonSocial.toUpperCase(), xValor, y - 1, { width: anchoValor });
  y = doc.y + 6;

  if (d.receptor.direccion) {
    etiqueta('ADDRESS / DIRECCIÓN:', y);
    doc.fillColor(MARCA.tinta).font('Helvetica').fontSize(7.5)
      .text(d.receptor.direccion.toUpperCase(), xValor, y, { width: anchoValor });
    y = doc.y + 2;
  }

  /*
   * El identificador fiscal se rotula como se llama EN SU PAÍS. Poner «Tax ID»
   * a todo es lo que hace un sistema que no sabe a dónde exporta: el original
   * dice «USCI» porque el comprador es chino, y su aduana busca esa palabra.
   */
  doc.fillColor(MARCA.tinta).font('Helvetica').fontSize(7.5)
    .text(`${d.receptor.etiquetaIdentificacion.toUpperCase()}: ${d.receptor.identificacion}`,
      xValor, y, { width: anchoValor });
  y = doc.y + 10;

  etiqueta('PROFORM / PROFORMA Nº:', y);
  doc.fillColor(MARCA.azulProfundo).font('Helvetica-Bold').fontSize(9)
    .text(d.numero, xValor, y - 1, { width: anchoValor });
  y = doc.y + 6;

  const fecha = d.datos.find((x) => x.etiqueta === 'Fecha')?.valor ?? '';
  etiqueta('DATE / FECHA:', y);
  doc.fillColor(MARCA.tinta).font('Helvetica-Bold').fontSize(8)
    .text(fecha, xValor, y - 1, { width: anchoValor });

  return doc.y + 12;
}

/* ==========================================================================
   LA TABLA
   ========================================================================== */

/** El recuadro de la tabla y las rayas entre columnas, de un alto dado. */
function marco(doc: Lienzo, y: number, alto: number) {
  doc.rect(MARGEN, y, ANCHO_UTIL, alto)
    .lineWidth(0.8).strokeColor(MARCA.tinta).stroke();
  let x = MARGEN;
  for (const ancho of [COL.peso, COL.unidad, COL.descripcion, COL.precio]) {
    x += ancho;
    doc.moveTo(x, y).lineTo(x, y + alto).lineWidth(0.5).strokeColor(MARCA.tinta).stroke();
  }
}
function encabezado(doc: Lienzo, y: number): number {
  const alto = 24;
  doc.rect(MARGEN, y, ANCHO_UTIL, alto).lineWidth(0.8).strokeColor(MARCA.tinta).stroke();

  let x = MARGEN;
  const celda = (ancho: number, arriba: string, abajo: string) => {
    rotulo(doc, arriba, x, y + 5, ancho);
    if (abajo) rotulo(doc, abajo, x, y + 13, ancho);
    x += ancho;
    if (x < MARGEN + ANCHO_UTIL - 1) {
      doc.moveTo(x, y).lineTo(x, y + alto).lineWidth(0.5).strokeColor(MARCA.tinta).stroke();
    }
  };

  celda(COL.peso, 'NET WEIGHT', 'PESO NETO');
  celda(COL.unidad, 'UNIT', 'UNIDAD');
  celda(COL.descripcion, 'DESCRIPTION / DESCRIPCIÓN', '');
  celda(COL.precio, 'UNIT PRICE', 'USD/KGS');
  celda(COL.total, 'TOTAL', 'USD');

  return y + alto;
}

/**
 * El cuerpo de la tabla: una caja grande con el producto arriba, las líneas de
 * empaque debajo y las condiciones del contrato dentro, igual que el original.
 *
 * Se agrupan las líneas por PRODUCTO y no se lista una por una porque así se
 * lee: el comprador compró alas de pota, y dentro de esa compra hay sacos de
 * 21 kilos y sacos de 20. Repetir «DOSIDICUS GIGAS / FROZEN GIANT SQUID WINGS»
 * en cada renglón sería ruido.
 */
function cuerpo(doc: Lienzo, d: Documento, yInicial: number): number {
  const e = d.exportacion!;
  const x = { peso: MARGEN, unidad: MARGEN + COL.peso };
  const xDesc = MARGEN + COL.peso + COL.unidad;
  const xPrecio = xDesc + COL.descripcion;
  const xTotal = xPrecio + COL.precio;

  /*
   * LA TABLA PUEDE NO CABER EN UNA HOJA.
   *
   * El modelo del cliente lleva un solo producto y entra justo; un pedido con
   * cuatro productos no entra, y la primera versión de esto lo descubrió sola:
   * pdfkit crea una página nueva en cuanto un texto cruza el margen inferior,
   * así que el documento salió en CUATRO hojas, con el marco de la tabla
   * dibujado sobre la primera y el contenido repartido por las demás.
   *
   * La solución no es apretar la letra —eso solo mueve el problema al pedido
   * siguiente— sino cerrar el marco al final de la hoja, saltar, repetir el
   * encabezado de columnas y seguir. Así la tabla se lee igual tenga una
   * página o tenga tres.
   */
  const LIMITE = ALTO_A4 - MARGEN - 18;
  const yArranque = yInicial;
  let yMarco = yInicial;
  let y = yInicial + 6;

  /** Cierra el marco de esta hoja, salta a la siguiente y repite el encabezado. */
  const saltarPagina = () => {
    marco(doc, yMarco, y - yMarco + 4);
    doc.addPage();
    y = encabezado(doc, MARGEN);
    yMarco = y;
    y += 6;
  };

  /** Reserva sitio: si lo que viene no cabe, cambia de hoja antes de dibujarlo. */
  const asegurar = (alto: number) => { if (y + alto > LIMITE) saltarPagina(); };

  /* ---- El código de planta, centrado sobre todo lo demás ---- */
  doc.fillColor(MARCA.tinta).font('Helvetica-Bold').fontSize(7.5)
    .text(`CEU NUMBER: ${e.ceu}`, xDesc, y, { width: COL.descripcion, align: 'center' });
  y = doc.y + 8;

  /* ---- Agrupación por producto ---- */
  const grupos = new Map<string, LineaDocumento[]>();
  for (const l of d.lineas) {
    const clave = `${l.cientifico}|${l.ingles}|${l.espanol}`;
    (grupos.get(clave) ?? grupos.set(clave, []).get(clave)!).push(l);
  }

  for (const [clave, lineas] of grupos) {
    const [cientifico, ingles, espanol] = clave.split('|');

    // Un producto no se parte del renglón siguiente: sus tres nombres y al
    // menos su primera línea de empaque van juntos o van a la hoja siguiente.
    asegurar(30 + 13);

    doc.fillColor(MARCA.tinta).font('Helvetica-Bold').fontSize(8);
    if (cientifico) doc.text(cientifico, xDesc + 4, y, { width: COL.descripcion - 8 });
    if (ingles) doc.text(ingles, xDesc + 4, doc.y, { width: COL.descripcion - 8 });
    if (espanol) doc.text(espanol, xDesc + 4, doc.y, { width: COL.descripcion - 8 });
    y = doc.y + 2;

    for (const l of lineas) {
      asegurar(13);
      const yFila = y;

      /*
       * La descripción del empaque, como la lee el almacén del comprador:
       * cuántos sacos, de cuánto, cómo viene partido dentro y de qué talla.
       * Los ceros a la izquierda —«03 BLOCKS»— son los del original: así lo
       * escriben en el sector y así lo esperan.
       */
      const bloques = l.bloques && l.pesoBloqueKg
        ? `PACKING: ${String(l.bloques).padStart(2, '0')} ` +
          // «01 BLOCKS» delata que el texto se arma pegando, y en un documento
          // que firma un comprador eso resta seriedad al resto.
          `${l.bloques === 1 ? 'BLOCK' : 'BLOCKS'} x ${cifra(l.pesoBloqueKg, 0)} KG`
        : '';
      const partes = [
        `${cifra(l.bultos, 0)}  BAGS X ${cifra(l.pesoBultoKg, 0)} KG`,
        bloques,
        l.talla ? `SIZE: ${l.talla}` : '',
      ].filter(Boolean);

      doc.fillColor(MARCA.tinta).font('Helvetica').fontSize(7)
        .text(partes.join(': '), xDesc + 4, y, { width: COL.descripcion - 8 });
      const yFin = doc.y;

      /* ---- Las cifras, alineadas y en monoespaciada ---- */
      doc.fillColor(MARCA.tinta).font('Courier').fontSize(7.5)
        .text(cifra(l.pesoNetoKg), x.peso + 2, yFila, { width: COL.peso - 6, align: 'right' });
      doc.font('Helvetica').fontSize(7)
        .text('KGS', x.unidad, yFila, { width: COL.unidad, align: 'center' });
      doc.font('Courier').fontSize(7.5)
        .text(cifra(l.precioKg, 3), xPrecio + 2, yFila, { width: COL.precio - 6, align: 'right' });
      doc.text(cifra(l.importe), xTotal + 2, yFila, { width: COL.total - 6, align: 'right' });

      y = Math.max(yFin, yFila + 11) + 2;
    }

    /* ---- El resumen del empaque del grupo ---- */
    asegurar(12);
    const pesos = [...new Set(lineas.map((l) => cifra(l.pesoBultoKg, 0)))];
    doc.fillColor(MARCA.tinta).font('Helvetica-Bold').fontSize(7)
      .text(`BAGS OF ${pesos.join(' KG AND/OR ')} KG`, xDesc + 4, y, { width: COL.descripcion - 8 });
    y = doc.y + 7;
  }

  /* ---- Las condiciones, dentro de la caja como en el original ---- */
  // Las condiciones se leen como un bloque: partirlas por la mitad obliga a
  // pasar de hoja para saber a qué puerto va la carga.
  asegurar(110);
  y += 6;
  const anchoCond = COL.descripcion - 8;
  const xCond = xDesc + 4;

  y = condicion(doc, 'INCOTERMS:', e.incotermCompleto, xCond, y, anchoCond);
  y = condicion(doc, 'CONTAINER:',
    e.contenedores > 0 && e.contenedorTipo
      ? `${String(e.contenedores).padStart(2, '0')} FCL ${e.contenedorTipo}`
      : e.contenedorTipo,
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
    y += 6;
    y = condicion(doc, 'PAYMENT TO:', cuenta.banco.toUpperCase(), xCond, y, anchoCond);
    if (cuenta.direccionBanco) {
      doc.fillColor(MARCA.tinta).font('Helvetica').fontSize(7)
        .text(cuenta.direccionBanco.toUpperCase(), xCond + 116, y, { width: anchoCond - 116 });
      y = doc.y + 2;
    }
    y = condicion(doc, 'SWIFT CODE:', cuenta.swift, xCond, y, anchoCond);
    y = condicion(doc, 'BANK ACCOUNT NUMBER:', cuenta.numero, xCond, y, anchoCond);
    // El CCI es peruano y solo sirve dentro del Perú; en una proforma de
    // exportación ocuparía sitio sin que nadie lo use.
    y = condicion(doc, 'BENEFICIARY:',
      (cuenta.titular || d.emisor.razonSocial).toUpperCase(), xCond, y, anchoCond);
  }

  /* ---- Documentos que se emitirán ---- */
  if (e.documentos.length) {
    asegurar(16 + e.documentos.length * 9);
    y += 6;
    doc.fillColor(MARCA.tinta).font('Helvetica-Bold').fontSize(7)
      .text('DOCUMENTS REQUIRED AND/OR TO ISSUE:', xCond, y, { width: anchoCond });
    y = doc.y + 2;
    for (const doc_ of e.documentos) {
      doc.fillColor(MARCA.azulProfundo).font('Helvetica-Bold').fontSize(7)
        .text(doc_, xCond + 116, y, { width: anchoCond - 116 });
      y = doc.y;
    }
    y += 2;
  }

  /* ---- Condiciones del contrato ---- */
  if (e.condiciones.length) {
    asegurar(14 + e.condiciones.length * 11);
    y += 4;
    doc.fillColor(MARCA.tinta).font('Helvetica-Bold').fontSize(7)
      .text('CONDITIONS:', xCond, y, { width: 112 });
    let yc = y;
    for (const c of e.condiciones) {
      doc.fillColor(MARCA.azulProfundo).font('Helvetica-Bold').fontSize(7)
        .text(c, xCond + 116, yc, { width: anchoCond - 116 });
      yc = doc.y + 1;
    }
    y = yc + 4;
  }

  /* ---- El marco de la última hoja: hasta aquí no se sabía dónde acababa ---- */
  const alto = y - yMarco + 8;
  marco(doc, yMarco, alto);

  // `yArranque` solo se usa cuando la tabla cupo entera en una hoja; si hubo
  // salto, lo que manda es dónde empezó el marco de la ÚLTIMA.
  void yArranque;
  return yMarco + alto;
}

/* ==========================================================================
   EL TOTAL
   ========================================================================== */
function total(doc: Lienzo, d: Documento, y: number): number {
  /*
   * El total, el importe en letras y las dos firmas se leen juntos: son el
   * cierre del contrato. Si no caben en lo que queda de hoja, van enteros a la
   * siguiente. Repartirlos entre dos páginas dejaría una firma huérfana, que
   * en un contrato no es un detalle de maquetación.
   */
  const ALTO_CIERRE = 88;
  if (y + ALTO_CIERRE > ALTO_A4 - MARGEN) {
    doc.addPage();
    y = MARGEN;
  }
  y += 6;
  const anchoEtiqueta = 62;
  const xTotal = MARGEN + ANCHO_UTIL - COL.total;
  const xEtiqueta = xTotal - anchoEtiqueta;

  doc.rect(xEtiqueta, y, anchoEtiqueta, 15).lineWidth(0.8).strokeColor(MARCA.tinta).stroke();
  doc.rect(xTotal, y, COL.total, 15).lineWidth(0.8).strokeColor(MARCA.tinta).stroke();

  doc.fillColor(MARCA.tinta).font('Helvetica-Bold').fontSize(8)
    .text('TOTAL USD', xEtiqueta, y + 4, { width: anchoEtiqueta, align: 'center' });
  doc.fillColor(MARCA.azulProfundo).font('Courier-Bold').fontSize(9)
    .text(cifra(d.totales.total), xTotal + 2, y + 4, { width: COL.total - 6, align: 'right' });

  /*
   * El importe en letras. No está en el modelo del cliente, y es justo lo que
   * pide el banco cuando la cifra llega borrosa: en letras no hay coma que se
   * confunda con un punto.
   */
  doc.fillColor(MARCA.tintaSuave).font('Helvetica-Bold').fontSize(6.2)
    .text('SAY / SON', MARGEN, y + 1);
  doc.fillColor(MARCA.tinta).font('Helvetica-Bold').fontSize(7.5)
    .text(importeEnLetras(d.totales.total, d.moneda), MARGEN, y + 9, {
      width: ANCHO_UTIL - COL.total - anchoEtiqueta - 16,
      // Dos líneas y para: sin tope, un importe largo empujaba el texto por
      // debajo del margen y pdfkit abría una hoja nueva para terminarlo.
      height: 20,
      ellipsis: false,
    });

  return Math.max(y + 22, doc.y + 4);
}

/* ==========================================================================
   LOS AVISOS Y LAS FIRMAS
   ========================================================================== */
function avisos(doc: Lienzo, d: Documento, y: number): number {
  if (!d.avisos.length) return y;

  const alto = 13 + d.avisos.length * 9;
  doc.roundedRect(MARGEN, y, ANCHO_UTIL, alto, 3).fillAndStroke('#FFF8E6', MARCA.atencion);
  doc.fillColor(MARCA.atencion).font('Helvetica-Bold').fontSize(6.2)
    .text('OBSERVACIONES DE LA VERIFICACIÓN · REVISAR ANTES DE ENVIAR', MARGEN + 8, y + 4);

  let yy = y + 13;
  for (const a of d.avisos) {
    doc.fillColor(MARCA.tinta).font('Helvetica').fontSize(6.5)
      .text(`· ${a}`, MARGEN + 8, yy, { width: ANCHO_UTIL - 16 });
    yy += 9;
  }
  return y + alto + 8;
}

/**
 * Las dos firmas. Un contrato lo firman dos partes: si solo firmara el
 * vendedor sería una factura, no un acuerdo.
 */
function firmas(doc: Lienzo, d: Documento, y: number) {
  const ancho = (ANCHO_UTIL - 30) / 2;
  const xDer = MARGEN + ancho + 30;
  const fecha = d.datos.find((x) => x.etiqueta === 'Fecha')?.valor ?? '';

  // Sitio para firmar a mano: una raya pegada al texto no se puede usar.
  const yRaya = y + 34;
  doc.moveTo(MARGEN, yRaya).lineTo(MARGEN + ancho, yRaya)
    .lineWidth(0.8).strokeColor(MARCA.tinta).stroke();
  doc.moveTo(xDer, yRaya).lineTo(xDer + ancho, yRaya)
    .lineWidth(0.8).strokeColor(MARCA.tinta).stroke();

  doc.fillColor(MARCA.tinta).font('Helvetica-Bold').fontSize(7.5)
    .text(d.emisor.razonSocial.toUpperCase(), MARGEN, yRaya + 4, { width: ancho });
  doc.font('Helvetica').fontSize(7)
    .text(`DATE:  ${fecha}`, MARGEN, doc.y + 1, { width: ancho });

  doc.fillColor(MARCA.tinta).font('Helvetica-Bold').fontSize(7.5)
    .text(d.receptor.razonSocial.toUpperCase(), xDer, yRaya + 4, { width: ancho });
  doc.font('Helvetica').fontSize(7)
    .text('SIGNED AND STAMPED', xDer, doc.y + 1, { width: ancho })
    .text('DATE:', xDer, doc.y + 1, { width: ancho });
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
  y = encabezado(doc, y);
  y = cuerpo(doc, d, y);
  y = total(doc, d, y);
  y = avisos(doc, d, y);
  firmas(doc, d, y);

  /* ---- Numeración y sello en todas las páginas ---- */
  const rango = doc.bufferedPageRange();
  for (let i = 0; i < rango.count; i++) {
    doc.switchToPage(rango.start + i);
    if (d.sello) sello(doc, d.sello);

    // pdfkit crea una página nueva ante cualquier texto que cruce el margen
    // inferior; se anula mientras se escribe el pie.
    const margenOriginal = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fillColor(MARCA.tintaSuave).font('Helvetica').fontSize(6)
      .text(`PROFORMA ${d.numero}   ·   ${d.emisor.razonSocial}   ·   Página ${i + 1} de ${rango.count}`,
        MARGEN, ALTO_A4 - 24, { width: ANCHO_UTIL, align: 'center', lineBreak: false });
    doc.page.margins.bottom = margenOriginal;
  }

  doc.end();
  return terminado;
}
