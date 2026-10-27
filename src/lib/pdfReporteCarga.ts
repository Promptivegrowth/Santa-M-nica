/**
 * ============================================================================
 *  REPORTE DE CARGA EN PDF (observaciones de octubre, punto 17)
 * ============================================================================
 *  «Consolida la información de la operación e incluye las imágenes como
 *  evidencia de la carga». Por cada despacho:
 *
 *    1. La operación: despacho, embarque, proformas, contenedor, precinto,
 *       guía, DAM, transporte, supervisor y horario de carga.
 *    2. Qué salió, pallet por pallet, con su proforma, y los totales.
 *       Si salió distinto de lo cargado (075: muestreo, sacos dañados, lo que
 *       no entró), un cuadro «cargado / despachado / diferencia y motivo».
 *    3. Las fotos, dos por fila, con su nombre.
 *
 *  El diseño es provisional: el documento dice que depende de un reporte
 *  modelo que todavía no llegó. Cuando llegue, se ajusta aquí; los datos ya
 *  están todos.
 * ============================================================================
 */
import PDFDocument from 'pdfkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MARCA_PDF as MARCA, seguro } from './textoPdf';
import { MOTIVO_DIFERENCIA, DESTINO_DIFERENCIA, type Despacho } from './despachosDatos';

const M = 40;
const ANCHO = 595.28;
const ALTO = 841.89;
const UTIL = ANCHO - M * 2;
const PIE = 36;

export type FotoReporte = { nombre: string; datos: Buffer };

const cifra = (n: number, d = 3) => n.toLocaleString('es-PE', { minimumFractionDigits: d, maximumFractionDigits: d });
const cuando = (v: string) => new Date(v).toLocaleString('es-PE', { timeZone: 'America/Lima', hour12: false, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export async function generarReporteCarga(op: {
  despachos: Despacho[];
  fotos: Map<number, FotoReporte[]>;
  /** Si se eligieron ítems sueltos (selector, punto 14), se dice en el reporte. */
  parciales: Set<number>;
  usuario: string;
  generadoEn: Date;
}): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margins: { top: M, bottom: PIE + 10, left: M, right: M }, bufferPages: true, info: { Title: 'Reporte de carga' } });
  const trozos: Buffer[] = [];
  doc.on('data', (b: Buffer) => trozos.push(b));
  const fin = new Promise<Buffer>((ok) => doc.on('end', () => ok(Buffer.concat(trozos))));

  let logo: Buffer | null = null;
  try { logo = readFileSync(join(process.cwd(), 'public', 'logo.png')); } catch { /* sin logo */ }

  const saltoSiHaceFalta = (alto: number) => { if (doc.y + alto > ALTO - PIE - 14) doc.addPage(); };

  op.despachos.forEach((d, n) => {
    if (n > 0) doc.addPage();

    /* ---- Cabecera ---- */
    if (logo) doc.image(logo, M, M - 6, { height: 28 });
    doc.fillColor(MARCA.azulProfundo).font('Helvetica-Bold').fontSize(14)
      .text('REPORTE DE CARGA', M, M - 2, { width: UTIL, align: 'right' });
    doc.fillColor(MARCA.tintaSuave).font('Helvetica').fontSize(8.5)
      .text(seguro(`${d.numero} · salida ${cuando(d.fecha_salida)}`), M, doc.y + 1, { width: UTIL, align: 'right' });
    doc.moveTo(M, M + 34).lineTo(ANCHO - M, M + 34).strokeColor(MARCA.linea).lineWidth(0.8).stroke();
    doc.y = M + 44;

    if (op.parciales.has(d.id)) {
      doc.fillColor(MARCA.atencion).font('Helvetica-Bold').fontSize(8)
        .text('Incluye solo los ítems elegidos en el selector de despachos, no el despacho completo.', M, doc.y, { width: UTIL });
      doc.moveDown(0.5);
    }

    /* ---- 1. La operación: dos columnas de etiqueta y valor ---- */
    const datos: [string, string][] = [
      ['Despacho', d.numero],
      ['Embarque', d.embarque ?? '—'],
      ['Proformas', d.proformas.map((p) => `${p.numero}${p.cliente ? ` (${p.cliente})` : ''}`).join(', ') || '—'],
      ['Destino', d.destino ?? '—'],
      ['Booking · naviera', [d.booking, d.naviera].filter(Boolean).join(' · ') || '—'],
      ['Almacén de salida', d.almacen ?? '—'],
      ['Contenedor', d.contenedor ?? '—'],
      ['Precinto', d.precinto ?? '—'],
      ['Guía de remisión', d.guia ?? '—'],
      ['DAM', d.dam ?? '—'],
      ['Transportista', d.transportista ?? '—'],
      ['Placa · conductor', [d.placa, d.conductor].filter(Boolean).join(' · ') || '—'],
      ['Fecha de carga', d.fecha_carga ? d.fecha_carga.split('-').reverse().join('/') : '—'],
      ['Horario · turno', [d.hora_inicio ? `${d.hora_inicio.slice(0, 5)}–${(d.hora_fin ?? '').slice(0, 5)}` : null, d.turno].filter(Boolean).join(' · ') || '—'],
      ['Supervisor', d.supervisor ?? '—'],
      ['Encargado del despacho', d.encargado ?? '—'],
    ];
    doc.fillColor(MARCA.azulProfundo).font('Helvetica-Bold').fontSize(9).text('LA OPERACIÓN', M, doc.y);
    doc.moveDown(0.3);
    const col = UTIL / 2;
    for (let i = 0; i < datos.length; i += 2) {
      const y = doc.y;
      let alto = 0;
      for (const [j, par] of [datos[i], datos[i + 1]].entries()) {
        if (!par) continue;
        const x = M + j * col;
        doc.fillColor(MARCA.tintaSuave).font('Helvetica').fontSize(7.5).text(seguro(par[0]), x, y, { width: 92 });
        doc.fillColor(MARCA.tinta).font('Helvetica-Bold').fontSize(8).text(seguro(par[1]), x + 94, y, { width: col - 100 });
        alto = Math.max(alto, doc.y - y);
      }
      doc.y = y + Math.max(alto, 11) + 2;
    }
    doc.moveDown(0.6);

    /* ---- 2. Qué se cargó ---- */
    const cols = [
      { t: 'PALLET', w: 78, a: 'left' as const },
      { t: 'SKU', w: 52, a: 'left' as const },
      { t: 'PRODUCTO', w: 196, a: 'left' as const },
      { t: 'PROFORMA', w: 70, a: 'left' as const },
      { t: 'BULTOS', w: 50, a: 'right' as const },
      { t: 'TM', w: UTIL - 78 - 52 - 196 - 70 - 50, a: 'right' as const },
    ];
    const encabezado = () => {
      const y = doc.y;
      doc.rect(M, y, UTIL, 15).fill(MARCA.azulProfundo);
      let x = M;
      for (const c of cols) {
        doc.fillColor(MARCA.blanco).font('Helvetica-Bold').fontSize(7).text(c.t, x + 4, y + 4, { width: c.w - 8, align: c.a });
        x += c.w;
      }
      doc.y = y + 17;
    };
    const conDiferencia = d.items.filter((i) => i.motivo);
    doc.fillColor(MARCA.azulProfundo).font('Helvetica-Bold').fontSize(9)
      .text(conDiferencia.length ? `QUÉ SALIÓ · ${d.items.length} PALLETS` : `QUÉ SE CARGÓ · ${d.items.length} PALLETS`, M, doc.y);
    doc.moveDown(0.3);
    encabezado();
    d.items.forEach((it, k) => {
      if (doc.y + 13 > ALTO - PIE - 14) { doc.addPage(); encabezado(); }
      const y = doc.y;
      if (k % 2 === 1) doc.rect(M, y - 1, UTIL, 12).fill(MARCA.grisSuave);
      const valores = [it.pallet, it.sku, it.producto, it.proforma ?? '—', it.bultos.toLocaleString('es-PE'), cifra(it.kg / 1000)];
      let x = M;
      cols.forEach((c, i) => {
        doc.fillColor(MARCA.tinta).font('Helvetica').fontSize(7.2)
          .text(seguro(valores[i]), x + 4, y + 1, { width: c.w - 8, align: c.a, lineBreak: false, ellipsis: true });
        x += c.w;
      });
      doc.y = y + 12;
    });
    const kg = d.items.reduce((t, i) => t + i.kg, 0);
    const bultos = d.items.reduce((t, i) => t + i.bultos, 0);
    doc.moveTo(M, doc.y + 1).lineTo(ANCHO - M, doc.y + 1).strokeColor(MARCA.tinta).lineWidth(0.6).stroke();
    const yT = doc.y + 4;
    doc.fillColor(MARCA.tinta).font('Helvetica-Bold').fontSize(7.8)
      .text('TOTAL', M + 4, yT, { width: 300 })
      .text(bultos.toLocaleString('es-PE'), M + UTIL - cols[5].w - cols[4].w + 4, yT, { width: cols[4].w - 8, align: 'right' })
      .text(cifra(kg / 1000), M + UTIL - cols[5].w + 4, yT, { width: cols[5].w - 8, align: 'right' });
    doc.y = yT + 18;

    /* ---- 2 bis. Cargado / despachado / diferencia y motivo (075) ---- */
    if (conDiferencia.length) {
      const kgCargado = d.items.reduce((t, i) => t + i.kg_cargados, 0);
      const bultosCargados = d.items.reduce((t, i) => t + i.bultos_cargados, 0);
      saltoSiHaceFalta(60);
      doc.fillColor(MARCA.atencion).font('Helvetica-Bold').fontSize(9)
        .text(`SALIÓ DISTINTO DE LO CARGADO · ${conDiferencia.length} PALLET${conDiferencia.length === 1 ? '' : 'S'}`, M, doc.y);
      doc.fillColor(MARCA.tintaSuave).font('Helvetica').fontSize(7.5)
        .text(seguro(`Cargado: ${bultosCargados.toLocaleString('es-PE')} bultos · ${cifra(kgCargado / 1000)} TM. ` +
          `Despachado: ${bultos.toLocaleString('es-PE')} bultos · ${cifra(kg / 1000)} TM. ` +
          `Diferencia: ${(bultosCargados - bultos).toLocaleString('es-PE')} bultos · ${cifra((kgCargado - kg) / 1000)} TM.`),
          M, doc.y + 1, { width: UTIL });
      doc.moveDown(0.3);
      const colsD = [
        { t: 'PALLET', w: 78, a: 'left' as const },
        { t: 'CARGADO', w: 80, a: 'right' as const },
        { t: 'DESPACHADO', w: 80, a: 'right' as const },
        { t: 'DIFERENCIA', w: 80, a: 'right' as const },
        { t: 'MOTIVO Y QUÉ PASÓ', w: UTIL - 78 - 80 - 80 - 80, a: 'left' as const },
      ];
      const encabezadoD = () => {
        const y = doc.y;
        doc.rect(M, y, UTIL, 15).fill(MARCA.atencion);
        let x = M;
        for (const c of colsD) {
          doc.fillColor(MARCA.blanco).font('Helvetica-Bold').fontSize(7).text(c.t, x + 4, y + 4, { width: c.w - 8, align: c.a });
          x += c.w;
        }
        doc.y = y + 17;
      };
      encabezadoD();
      conDiferencia.forEach((it, k) => {
        const motivo = `${MOTIVO_DIFERENCIA[it.motivo ?? ''] ?? it.motivo}${it.detalle ? `: ${it.detalle}` : ''} — ${DESTINO_DIFERENCIA[it.motivo ?? ''] ?? ''}`;
        const alto = Math.max(12, doc.font('Helvetica').fontSize(7.2).heightOfString(seguro(motivo), { width: colsD[4].w - 8 }) + 3);
        if (doc.y + alto > ALTO - PIE - 14) { doc.addPage(); encabezadoD(); }
        const y = doc.y;
        if (k % 2 === 1) doc.rect(M, y - 1, UTIL, alto).fill(MARCA.grisSuave);
        const valores = [
          it.pallet,
          `${it.bultos_cargados.toLocaleString('es-PE')} b · ${cifra(it.kg_cargados / 1000)}`,
          `${it.bultos.toLocaleString('es-PE')} b · ${cifra(it.kg / 1000)}`,
          `-${(it.bultos_cargados - it.bultos).toLocaleString('es-PE')} b · ${cifra((it.kg_cargados - it.kg) / 1000)}`,
        ];
        let x = M;
        colsD.slice(0, 4).forEach((c, i) => {
          doc.fillColor(MARCA.tinta).font('Helvetica').fontSize(7.2)
            .text(seguro(valores[i]), x + 4, y + 1, { width: c.w - 8, align: c.a, lineBreak: false, ellipsis: true });
          x += c.w;
        });
        doc.fillColor(MARCA.tinta).font('Helvetica').fontSize(7.2).text(seguro(motivo), x + 4, y + 1, { width: colsD[4].w - 8 });
        doc.y = y + alto;
      });
      doc.fillColor(MARCA.tintaSuave).font('Helvetica').fontSize(6.8)
        .text('Toneladas en TM. El muestreo y la merma salieron del stock con su propio movimiento; lo que no entró volvió a cámara apartado para su pedido. El plano de estiba es el de la carga.',
          M, doc.y + 3, { width: UTIL });
      doc.y += 12;
    }

    /* ---- 3. Las fotos ---- */
    const fotos = op.fotos.get(d.id) ?? [];
    saltoSiHaceFalta(40);
    doc.fillColor(MARCA.azulProfundo).font('Helvetica-Bold').fontSize(9).text(`EVIDENCIA FOTOGRÁFICA · ${fotos.length}`, M, doc.y);
    doc.moveDown(0.4);
    if (fotos.length === 0) {
      doc.fillColor(MARCA.tintaSuave).font('Helvetica').fontSize(8)
        .text('Este despacho todavía no tiene fotos de la carga. Se suben desde su ficha.', M, doc.y, { width: UTIL });
    }
    const anchoFoto = (UTIL - 14) / 2;
    const altoFoto = 175;
    for (let i = 0; i < fotos.length; i += 2) {
      saltoSiHaceFalta(altoFoto + 20);
      const y = doc.y;
      for (const [j, f] of [fotos[i], fotos[i + 1]].entries()) {
        if (!f) continue;
        const x = M + j * (anchoFoto + 14);
        doc.rect(x, y, anchoFoto, altoFoto).fill(MARCA.grisSuave);
        try {
          doc.image(f.datos, x + 3, y + 3, { fit: [anchoFoto - 6, altoFoto - 6], align: 'center', valign: 'center' });
        } catch {
          doc.fillColor(MARCA.tintaSuave).font('Helvetica').fontSize(7.5).text('No se pudo dibujar esta imagen.', x + 8, y + altoFoto / 2, { width: anchoFoto - 16, align: 'center' });
        }
        doc.fillColor(MARCA.tintaSuave).font('Helvetica').fontSize(6.8)
          .text(seguro(f.nombre), x, y + altoFoto + 2, { width: anchoFoto, align: 'center', lineBreak: false, ellipsis: true });
      }
      doc.y = y + altoFoto + 16;
    }
  });

  /* ---- Pie en todas las páginas ---- */
  const rango = doc.bufferedPageRange();
  for (let i = rango.start; i < rango.start + rango.count; i++) {
    doc.switchToPage(i);
    doc.fillColor(MARCA.tintaSuave).font('Helvetica').fontSize(6.8)
      .text(seguro(`Generado por ${op.usuario} el ${cuando(op.generadoEn.toISOString())} · Industrial Pesquera Santa Mónica S.A.`),
        M, ALTO - PIE + 8, { width: UTIL - 60, lineBreak: false })
      .text(`Página ${i - rango.start + 1} de ${rango.count}`, ANCHO - M - 60, ALTO - PIE + 8, { width: 60, align: 'right', lineBreak: false });
  }

  doc.end();
  return fin;
}
