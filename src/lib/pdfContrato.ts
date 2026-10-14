/**
 * ============================================================================
 *  EL CONTRATO EN PDF, CON LA FORMA DEL MODELO DE SANTA MÓNICA
 * ============================================================================
 *  Misma estructura que el Word institucional (contrato SM26-378 que envió
 *  Oliver): logo y membrete arriba, la web al pie, los datos en dos columnas
 *  —rótulo bilingüe a la izquierda, valor en negrita a la derecha—, cada
 *  cláusula en inglés y debajo en castellano en cursiva, la firma del gerente
 *  y el Anexo N° 2 antisoborno.
 *
 *  El Word sale de la plantilla exacta (docxContrato.ts); este PDF es la
 *  versión lista para enviar, igual que la proforma. Los dos leen el MISMO
 *  objeto de datos guardado, así que no pueden decir cosas distintas.
 * ============================================================================
 */
import PDFDocument from 'pdfkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { seguro as seguroLinea } from './textoPdf';
import type { DatosContrato } from './contratoVenta';
import {
  ENTREGA, SEGURO, PAGO_FIJO, DOCUMENTOS, OTRAS_CONDICIONES, TITULO_DECLARACIONES,
  DECLARACIONES, ANEXO_TITULO, ANEXO, type Bilingue,
} from './contratoTextos';

const ANCHO = 595.28;
const ALTO = 841.89;
const IZQ = 57;
const DER = ANCHO - 57;
const UTIL = DER - IZQ;
/** Donde empieza la columna de los valores, como en el modelo. */
const COL = 227;
const ARRIBA = 92;
const ABAJO = ALTO - 70;
const TINTA = '#000000';
const AZUL = '#1F5AA6';
const T = 9;

/**
 * La limpieza de caracteres del PDF trabaja línea por línea: aplicada al texto
 * entero se comía los saltos y «CO., LTD» quedaba pegado a la dirección.
 */
const seguro = (t: string) => String(t ?? '').split('\n').map(seguroLinea).join('\n');

function imagen(nombre: string): Buffer | null {
  try { return readFileSync(join(process.cwd(), 'public', nombre)); } catch { return null; }
}

export async function generarPdfContrato(d: DatosContrato, firmaElegida: { imagen: string | null; esBloque: boolean }): Promise<Buffer> {
  const firmaDataUrl = firmaElegida.imagen;
  const doc = new PDFDocument({ size: 'A4', margins: { top: ARRIBA, bottom: ALTO - ABAJO, left: IZQ, right: ANCHO - DER }, bufferPages: true,
    info: { Title: `Contrato ${d.numero}`, Author: d.vendedor.nombre } });
  const trozos: Buffer[] = [];
  doc.on('data', (b: Buffer) => trozos.push(b));
  const fin = new Promise<Buffer>((ok) => doc.on('end', () => ok(Buffer.concat(trozos))));

  const logo = imagen('contrato-logo.png');
  const membrete = imagen('contrato-membrete.png');
  const firma = firmaDataUrl?.startsWith('data:image/') ? Buffer.from(firmaDataUrl.split(',')[1], 'base64') : null;

  /* ---- Cabecera y pie en cada página, como el Word ---- */
  const cabecera = () => {
    if (logo) doc.image(logo, IZQ, 24, { height: 40 });
    if (membrete) doc.image(membrete, DER - 175, 20, { width: 175 });
    //  El pie va debajo del margen: sin quitarlo un momento, pdfkit abriría una página nueva.
    const margen = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fillColor(AZUL).font('Helvetica').fontSize(9)
      .text('https://www.santamonicafishing.com/', IZQ + 40, ALTO - 48, { link: 'https://www.santamonicafishing.com/', underline: true, lineBreak: false, width: 220 });
    doc.page.margins.bottom = margen;
    doc.fillColor(TINTA);
  };
  //  Al saltar de página se sigue arriba; la cabecera y el pie se dibujan al final.
  doc.on('pageAdded', () => { doc.x = IZQ; doc.y = ARRIBA; });

  const espacio = (pt: number) => { doc.y += pt; };
  const caber = (alto: number) => { if (doc.y + alto > ABAJO) doc.addPage(); };

  /** Una fila rótulo / valor. El valor puede traer varias líneas. */
  const fila = (rotulo: string, valor: string, opciones: { negrita?: boolean; cursiva?: boolean } = {}) => {
    const v = seguro(valor);
    doc.font(opciones.negrita === false ? 'Helvetica' : 'Helvetica-Bold').fontSize(T);
    const altoValor = doc.heightOfString(v, { width: DER - COL });
    doc.font('Helvetica-Bold');
    const altoRotulo = doc.heightOfString(seguro(rotulo), { width: COL - IZQ - 10 });
    caber(Math.max(altoValor, altoRotulo));
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(T).fillColor(TINTA).text(seguro(rotulo), IZQ, y, { width: COL - IZQ - 10 });
    doc.font(opciones.negrita === false ? (opciones.cursiva ? 'Helvetica-Oblique' : 'Helvetica') : 'Helvetica-Bold')
      .text(v, COL, y, { width: DER - COL });
    doc.y = y + Math.max(altoValor, altoRotulo);
    doc.x = IZQ;
    espacio(11);
  };

  /** Un párrafo en inglés y su traducción en cursiva, en la columna de valores. */
  const bilingueEnColumna = (rotulo: string, b: Bilingue) => {
    doc.font('Helvetica').fontSize(T);
    const en = seguro(b.en); const es = seguro(b.es);
    const a1 = doc.heightOfString(en, { width: DER - COL, align: 'justify' });
    caber(a1 + 10);
    const y = doc.y;
    doc.font('Helvetica-Bold').text(seguro(rotulo), IZQ, y, { width: COL - IZQ - 10 });
    doc.font('Helvetica').text(en, COL, y, { width: DER - COL, align: 'justify' });
    doc.y = y + a1 + 9;
    doc.font('Helvetica-Oblique');
    caber(doc.heightOfString(es, { width: DER - COL }));
    doc.text(es, COL, doc.y, { width: DER - COL, align: 'justify' });
    doc.x = IZQ;
    espacio(13);
  };

  const titulo = (texto: string) => {
    caber(30);
    doc.font('Helvetica-Bold').fontSize(T).fillColor(TINTA).text(seguro(texto), IZQ, doc.y, { width: UTIL });
    espacio(6);
  };

  /** Viñeta o letra, con el inglés y debajo el castellano en cursiva. */
  const item = (marca: string, b: Bilingue, sangria = 170, separar = true) => {
    const x = IZQ + sangria;
    const ancho = DER - x;
    doc.fontSize(T);
    const en = seguro(b.en); const es = seguro(b.es);
    doc.font('Helvetica');
    const a1 = doc.heightOfString(en, { width: ancho, align: 'justify' });
    caber(a1 + 12);
    const y = doc.y;
    doc.font(marca.length > 1 ? 'Helvetica-Bold' : 'Helvetica').text(marca, x - 18, y, { width: 16 });
    doc.font('Helvetica').text(en, x, y, { width: ancho, align: 'justify' });
    doc.y = y + a1 + (separar ? 6 : 1);
    if (es) {
      doc.font('Helvetica-Oblique');
      caber(doc.heightOfString(es, { width: ancho }));
      doc.text(es, x, doc.y, { width: ancho, align: 'justify' });
    }
    doc.x = IZQ;
    espacio(separar ? 11 : 3);
  };

  /**
   * Las dos firmas, como el modelo: SELLER con el bloque firmado del gerente
   * (trazo, nombre, cargo, empresa y RUC) y BUYER en blanco. Si en
   * Configuración solo está la firma suelta, el nombre y el cargo se escriben.
   */
  const firmas = () => {
    caber(130);
    const y = doc.y + 4;
    doc.font('Helvetica-Bold').fontSize(T).text('SELLER', IZQ, y);
    doc.text('BUYER', IZQ + 330, y);
    const x = IZQ + 88;
    if (firma) {
      try { doc.image(firma, x, y + 4, { fit: firmaElegida.esBloque ? [92, 95] : [110, 52], align: 'center' }); } catch { /* sin imagen, queda el espacio */ }
    }
    if (!firmaElegida.esBloque && d.firmante?.nombre) {
      const yl = y + 60;
      doc.moveTo(x, yl).lineTo(x + 120, yl).lineWidth(0.6).strokeColor(TINTA).stroke();
      doc.font('Helvetica-Bold').fontSize(7).text(seguro(d.firmante.nombre), x, yl + 3, { width: 120, align: 'center' });
      doc.font('Helvetica').text(seguro(d.firmante.cargo), x, doc.y, { width: 120, align: 'center' })
        .text(seguro(d.vendedor.nombre), x, doc.y, { width: 120, align: 'center' })
        .text(`RUC: ${seguro(d.firmante.ruc)}`, x, doc.y, { width: 120, align: 'center' });
    }
    doc.y = y + 112;
    doc.x = IZQ;
    espacio(10);
  };

  /* ══════ LOS DATOS ══════ */
  doc.y = ARRIBA;
  fila('CONTRACT N° / CONTRATO N°:', d.numero);
  fila('PROFORM / PROFORMA:', d.proforma);
  fila('DATE / FECHA:', d.fecha);
  {
    //  El vendedor: el nombre en negrita y la dirección no, como el modelo.
    const y = doc.y;
    caber(40);
    doc.font('Helvetica-Bold').fontSize(T).text('SELLER  / VENDEDOR:', IZQ, y, { width: COL - IZQ - 10 });
    doc.text(seguro(d.vendedor.nombre), COL, y, { width: DER - COL });
    doc.font('Helvetica').text(seguro(d.vendedor.direccion), COL, doc.y, { width: DER - COL, align: 'justify' });
    doc.x = IZQ; espacio(11);
  }
  {
    //  El comprador: el nombre en negrita; dirección y documento, no. Como el modelo.
    caber(50);
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(T).text('BUYER / COMPRADOR:', IZQ, y, { width: COL - IZQ - 10 });
    doc.text(seguro(d.comprador.nombre), COL, y, { width: DER - COL });
    doc.font('Helvetica').text(seguro([d.comprador.direccion, d.comprador.documento].filter(Boolean).join('\n')), COL, doc.y, { width: DER - COL });
    doc.x = IZQ; espacio(11);
  }
  fila('PRODUCT / PRODUCTO:', `${d.producto.en}\n${d.producto.es}`);
  fila('QUANTITY  / CANTIDAD:', d.cantidad);
  fila('PRICE / PRECIO:', d.precio);
  fila('PACKING / EMPAQUETADO:', d.empaque);
  fila('PERIOD FOR SHIPMENT  / PERIODO DE ENVÍO:', `${d.periodo.en}\n${d.periodo.es}`);
  fila('LOADING PORT / PUERTO DE CARGA:', `${d.puertoCarga}\n${d.puertoCarga}`);
  fila('DESTINATION PORT / PUERTO DE DESCARGA:', `${d.puertoDescarga}\n${d.puertoDescarga}`);
  bilingueEnColumna('DELIVERY  / ENTREGA:', ENTREGA);
  bilingueEnColumna('INSURANCE POLICY / POLITICA DE SEGURO:', SEGURO);

  /* ══════ PAGO ══════ */
  {
    caber(60);
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(T).text('PAYMENT TERMS / TÉRMINOS DE PAGO:', IZQ, y, { width: COL - IZQ - 40 });
    const x = COL - 25;
    doc.text(seguro(d.pago.en), x, y, { width: DER - x });
    espacio(9);
    doc.text(seguro(d.pago.es), x, doc.y, { width: DER - x });
    espacio(9);
    doc.font('Helvetica').text(seguro(PAGO_FIJO.en), x, doc.y, { width: DER - x, align: 'justify' });
    espacio(9);
    doc.font('Helvetica-Oblique').text(seguro(PAGO_FIJO.es), x, doc.y, { width: DER - x, align: 'justify' });
    doc.x = IZQ; espacio(16);
  }

  /* ══════ BANCO ══════ */
  titulo('BANK DETAILS  / DETALLES  DEL BANCO:');
  espacio(4);
  for (const [r, v] of [
    ['PAYMENT TO / PAGAR A:', d.banco.nombre],
    ['BANK ADDRESS / DIRECCIÓN DEL BANCO:', d.banco.direccion],
    ['COUNTRY / PAÍS:', d.banco.pais],
    ['SWIFT CODE / CÓDIGO SWIFT:', d.banco.swift],
    ['ACCOUNT NUMBER  / CUENTA BANCARIA:', d.banco.cuenta],
    ['BENEFICIARY  / BENEFICIARIO:', d.banco.beneficiario],
  ] as const) {
    const x = IZQ + 108;
    caber(14);
    const y = doc.y;
    doc.font('Helvetica').fontSize(T).text('•', x - 14, y);
    doc.font('Helvetica-Bold').text(`${seguro(r)} `, x, y, { width: DER - x, continued: true })
      .font('Helvetica').text(seguro(v));
    doc.x = IZQ;
    espacio(1);
  }
  espacio(12);

  /* ══════ DOCUMENTOS ══════ */
  titulo('DOCUMENTS  / DOCUMENTOS:');
  const docs = [...DOCUMENTOS, ...(d.documentoF.en.trim() ? [d.documentoF] : [])];
  docs.forEach((x, i) => item(`${String.fromCharCode(65 + i)}.`, x, 108, false));
  espacio(14);

  /* ══════ OTRAS CONDICIONES ══════ */
  titulo('OTHER CONDITIONS  / OTRAS CONDICIONES:');
  for (const c of OTRAS_CONDICIONES) item('•', c, 108);
  espacio(4);

  /* ══════ DECLARACIONES COMBINADAS ══════ */
  titulo(TITULO_DECLARACIONES);
  espacio(6);
  for (const c of DECLARACIONES) item('•', c, 108);
  firmas();

  /* ══════ ANEXO N° 2 ══════ */
  caber(80);
  doc.font('Helvetica-Bold').fontSize(T).text(seguro(ANEXO_TITULO.en), IZQ, doc.y, { width: UTIL, align: 'center' });
  doc.font('Helvetica-BoldOblique').text(seguro(ANEXO_TITULO.es), IZQ, doc.y + 4, { width: UTIL, align: 'center' });
  espacio(12);
  const X = IZQ + 28;
  for (const b of ANEXO) {
    if (b.tipo === 'subtitulo') {
      caber(30);
      doc.font('Helvetica-Bold').fontSize(T).text(seguro(b.en), X, doc.y, { width: DER - X });
      espacio(6);
      continue;
    }
    doc.font('Helvetica').fontSize(T);
    caber(doc.heightOfString(seguro(b.en), { width: DER - X }) + 6);
    doc.text(seguro(b.en), X, doc.y, { width: DER - X, align: 'justify' });
    espacio(6);
    doc.font('Helvetica-Oblique');
    caber(doc.heightOfString(seguro(b.es), { width: DER - X }));
    doc.text(seguro(b.es), X, doc.y, { width: DER - X, align: 'justify' });
    espacio(8);
  }
  espacio(30);
  firmas();

  /* ---- Cabecera y pie en todas las páginas ---- */
  const rango = doc.bufferedPageRange();
  for (let i = rango.start; i < rango.start + rango.count; i++) {
    doc.switchToPage(i);
    cabecera();
  }

  doc.end();
  return fin;
}
