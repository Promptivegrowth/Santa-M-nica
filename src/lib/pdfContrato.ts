/**
 * ============================================================================
 *  EL CONTRATO EN PDF
 * ============================================================================
 *  Una hoja A4 sobria: el logo, el título, el número, el texto tal como se
 *  guardó y las dos firmas. El texto es el que quedó en `contratos.cuerpo`,
 *  así que el PDF de hoy y el de dentro de un año dicen lo mismo.
 * ============================================================================
 */
import PDFDocument from 'pdfkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MARCA_PDF as MARCA, seguro } from './textoPdf';

const MARGEN = 56;
const ANCHO = 595.28;
const ALTO = 841.89;
const UTIL = ANCHO - MARGEN * 2;

export async function generarPdfContrato(c: {
  numero: string;
  titulo: string;
  cuerpo: string;
  empresa: string;
  cliente: string;
  firmante: string;
  cargoFirmante: string;
}): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: MARGEN, info: { Title: `${c.numero} · ${c.titulo}` } });
  const trozos: Buffer[] = [];
  doc.on('data', (b: Buffer) => trozos.push(b));
  const fin = new Promise<Buffer>((ok) => doc.on('end', () => ok(Buffer.concat(trozos))));

  /* ---- Cabecera: logo a la izquierda, número a la derecha ---- */
  try {
    doc.image(readFileSync(join(process.cwd(), 'public', 'logo.png')), MARGEN, 36, { height: 30 });
  } catch { /* sin logo, el contrato sale igual */ }
  doc.fillColor(MARCA.tintaSuave).font('Helvetica').fontSize(8)
    .text(seguro(c.numero), MARGEN, 44, { width: UTIL, align: 'right' });
  doc.moveTo(MARGEN, 76).lineTo(ANCHO - MARGEN, 76).strokeColor(MARCA.linea).lineWidth(0.8).stroke();

  /* ---- Título ---- */
  doc.fillColor(MARCA.azulProfundo).font('Helvetica-Bold').fontSize(13)
    .text(seguro(c.titulo), MARGEN, 96, { width: UTIL, align: 'center' });
  doc.moveDown(1.2);

  /*
   * ---- El cuerpo ----
   * Cada párrafo se dibuja aparte. Una línea en MAYÚSCULAS que empieza con un
   * ordinal («PRIMERA · OBJETO») es el título de una cláusula: va en negrita.
   */
  for (const parrafo of c.cuerpo.replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    const lineas = parrafo.split('\n');
    for (const linea of lineas) {
      const esClausula = /^[A-ZÁÉÍÓÚÑ]{4,}( [A-ZÁÉÍÓÚÑ·]+)*( · .+)?$/.test(linea.trim()) && linea.trim() === linea.trim().toUpperCase();
      if (doc.y > ALTO - 120) doc.addPage();
      doc.fillColor(esClausula ? MARCA.azulProfundo : MARCA.tinta)
        .font(esClausula ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(esClausula ? 9.5 : 9.5)
        .text(seguro(linea), MARGEN, doc.y, { width: UTIL, align: esClausula ? 'left' : 'justify', lineGap: 2 });
    }
    doc.moveDown(0.7);
  }

  /* ---- Firmas ---- */
  if (doc.y > ALTO - 170) doc.addPage();
  const y = Math.max(doc.y + 60, ALTO - 200);
  const ancho = (UTIL - 40) / 2;
  for (const [i, f] of [[c.empresa, `${c.firmante}${c.cargoFirmante ? ` · ${c.cargoFirmante}` : ''}`, 'EL VENDEDOR'],
                        [c.cliente, '', 'EL COMPRADOR']].entries()) {
    const x = MARGEN + i * (ancho + 40);
    doc.moveTo(x, y).lineTo(x + ancho, y).strokeColor(MARCA.tinta).lineWidth(0.6).stroke();
    doc.fillColor(MARCA.tinta).font('Helvetica-Bold').fontSize(8.5).text(seguro(f[2]), x, y + 5, { width: ancho, align: 'center' });
    doc.font('Helvetica').fontSize(8).text(seguro(f[0]), x, doc.y + 1, { width: ancho, align: 'center' });
    if (f[1]) doc.fillColor(MARCA.tintaSuave).text(seguro(f[1]), x, doc.y + 1, { width: ancho, align: 'center' });
  }

  doc.end();
  return fin;
}
