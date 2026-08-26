/**
 * ============================================================================
 *  GENERADOR DE REPORTES EN EXCEL · con la marca de Santa Mónica
 * ============================================================================
 *  El objetivo es que el archivo salga listo para enviar, sin que nadie tenga
 *  que retocarlo. Por eso cada reporte incluye:
 *
 *   · El logotipo de la empresa en la cabecera.
 *   · Los colores de marca en los encabezados de columna.
 *   · La razón social, la fecha de corte y los filtros que se aplicaron.
 *   · Formato de número correcto: miles, decimales y moneda.
 *   · Filas alternadas, columnas congeladas y filtros automáticos.
 *   · Un pie con quién exportó y cuándo, para trazabilidad del documento.
 *
 *  Todo eso se define UNA vez aquí y lo heredan todos los reportes.
 * ============================================================================
 */
import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/* --- Colores de marca en el formato que entiende Excel (ARGB) --- */
const MARCA = {
  azulProfundo: 'FF304F8C',
  azulMedio: 'FF5095BF',
  verdeAzulado: 'FF53A6A6',
  blanco: 'FFFFFFFF',
  tinta: 'FF101A2C',
  grisSuave: 'FFF0F5FA',
  grisLinea: 'FFC9D4E4',
  atencion: 'FF8A5A10',
  critico: 'FF95302C',
};

export type ColumnaExcel = {
  titulo: string;
  clave: string;
  ancho?: number;
  /** Formato numérico de Excel. Ej: '#,##0.00' o '"US$" #,##0' */
  formato?: string;
  /** Alineación; por defecto, izquierda para texto y derecha para números. */
  alineacion?: 'left' | 'center' | 'right';
};

export type OpcionesReporte = {
  /** Nombre del reporte, sale como título grande. */
  titulo: string;
  /** Explicación de una línea, debajo del título. */
  subtitulo?: string;
  /** Nombre de la pestaña del libro. */
  hoja?: string;
  columnas: ColumnaExcel[];
  filas: Record<string, unknown>[];
  /** Filtros aplicados, para dejar constancia en el documento. */
  filtros?: Record<string, string>;
  /** Quién lo exportó. */
  usuario?: string;
  /** Totales al pie: qué columnas se suman. */
  totalizar?: string[];
};

/**
 * Construye el libro de Excel y lo devuelve como buffer, listo para descargar.
 */
export async function generarReporte(op: OpcionesReporte): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Santa Mónica ERP';
  libro.company = 'Industrial Pesquera Santa Mónica S.A.C.';
  libro.created = new Date();

  const hoja = libro.addWorksheet(op.hoja ?? 'Reporte', {
    views: [{ state: 'frozen', ySplit: 7 }], // congela la cabecera
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
  });

  const numCols = op.columnas.length;
  const ultimaCol = String.fromCharCode(64 + Math.min(numCols, 26));

  /* ─────────── 1. CABECERA CON LOGOTIPO ─────────── */
  try {
    const rutaLogo = join(process.cwd(), 'public', 'logo.png');
    const datosLogo = await readFile(rutaLogo);
    const idImagen = libro.addImage({ buffer: datosLogo as unknown as ArrayBuffer, extension: 'png' });
    hoja.addImage(idImagen, {
      tl: { col: 0.2, row: 0.3 },
      ext: { width: 168, height: 44 },
    });
  } catch {
    // Si el logo no está disponible, el reporte igual se genera sin él.
  }

  hoja.getRow(1).height = 20;
  hoja.getRow(2).height = 20;
  hoja.getRow(3).height = 8;

  /* ─────────── 2. TÍTULO ─────────── */
  hoja.mergeCells(`D1:${ultimaCol}1`);
  const celdaTitulo = hoja.getCell('D1');
  celdaTitulo.value = op.titulo;
  celdaTitulo.font = { name: 'Calibri', size: 16, bold: true, color: { argb: MARCA.azulProfundo } };
  celdaTitulo.alignment = { vertical: 'middle', horizontal: 'left' };

  hoja.mergeCells(`D2:${ultimaCol}2`);
  const celdaSub = hoja.getCell('D2');
  celdaSub.value = op.subtitulo ?? 'Industrial Pesquera Santa Mónica S.A.C. · RUC 20205572229';
  celdaSub.font = { name: 'Calibri', size: 9, color: { argb: 'FF6F7D95' } };
  celdaSub.alignment = { vertical: 'top', horizontal: 'left' };

  /* ─────────── 3. DATOS DEL DOCUMENTO ─────────── */
  const ahora = new Date();
  const fechaCorte = ahora.toLocaleDateString('es-PE', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Lima',
  });
  const horaCorte = ahora.toLocaleTimeString('es-PE', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Lima',
  });

  const infoFiltros = op.filtros && Object.keys(op.filtros).length
    ? Object.entries(op.filtros).map(([k, v]) => `${k}: ${v}`).join('  ·  ')
    : 'Sin filtros aplicados';

  hoja.mergeCells(`A4:${ultimaCol}4`);
  const celdaInfo = hoja.getCell('A4');
  celdaInfo.value = `Fecha de corte: ${fechaCorte} ${horaCorte}   ·   Registros: ${op.filas.length.toLocaleString('es-PE')}   ·   Filtros → ${infoFiltros}`;
  celdaInfo.font = { name: 'Calibri', size: 9, color: { argb: 'FF41506A' } };
  celdaInfo.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MARCA.grisSuave } };
  celdaInfo.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  hoja.getRow(4).height = 18;

  hoja.getRow(5).height = 6;

  /* ─────────── 4. ENCABEZADOS DE COLUMNA ─────────── */
  const filaEnc = 6;
  op.columnas.forEach((c, i) => {
    const celda = hoja.getCell(filaEnc, i + 1);
    celda.value = c.titulo;
    celda.font = { name: 'Calibri', size: 10, bold: true, color: { argb: MARCA.blanco } };
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MARCA.azulProfundo } };
    celda.alignment = {
      vertical: 'middle',
      horizontal: c.alineacion ?? (c.formato ? 'right' : 'left'),
      wrapText: true,
    };
    celda.border = {
      top: { style: 'thin', color: { argb: MARCA.azulProfundo } },
      bottom: { style: 'medium', color: { argb: MARCA.verdeAzulado } },
    };
    hoja.getColumn(i + 1).width = c.ancho ?? Math.max(12, Math.min(38, c.titulo.length + 6));
  });
  hoja.getRow(filaEnc).height = 26;

  /* ─────────── 5. DATOS ─────────── */
  op.filas.forEach((fila, idx) => {
    const nFila = filaEnc + 1 + idx;
    op.columnas.forEach((c, i) => {
      const celda = hoja.getCell(nFila, i + 1);
      const valor = fila[c.clave];

      celda.value = (valor === null || valor === undefined) ? '' : (valor as ExcelJS.CellValue);
      if (c.formato) celda.numFmt = c.formato;

      celda.font = { name: 'Calibri', size: 10, color: { argb: MARCA.tinta } };
      celda.alignment = {
        vertical: 'middle',
        horizontal: c.alineacion ?? (c.formato ? 'right' : 'left'),
      };
      // Filas alternadas, para que la vista no se pierda en tablas largas
      if (idx % 2 === 1) {
        celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MARCA.grisSuave } };
      }
      celda.border = { bottom: { style: 'hair', color: { argb: MARCA.grisLinea } } };
    });
  });

  /* ─────────── 6. TOTALES ─────────── */
  if (op.totalizar?.length && op.filas.length) {
    const nTotal = filaEnc + 1 + op.filas.length;
    op.columnas.forEach((c, i) => {
      const celda = hoja.getCell(nTotal, i + 1);
      if (i === 0) {
        celda.value = 'TOTAL';
      } else if (op.totalizar!.includes(c.clave)) {
        const suma = op.filas.reduce((s, f) => s + (Number(f[c.clave]) || 0), 0);
        celda.value = suma;
        if (c.formato) celda.numFmt = c.formato;
      }
      celda.font = { name: 'Calibri', size: 10, bold: true, color: { argb: MARCA.azulProfundo } };
      celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDFEAF4' } };
      celda.alignment = { vertical: 'middle', horizontal: c.alineacion ?? (c.formato ? 'right' : 'left') };
      celda.border = { top: { style: 'medium', color: { argb: MARCA.azulProfundo } } };
    });
    hoja.getRow(nTotal).height = 20;
  }

  /* ─────────── 7. FILTROS AUTOMÁTICOS ─────────── */
  if (op.filas.length) {
    hoja.autoFilter = {
      from: { row: filaEnc, column: 1 },
      to: { row: filaEnc + op.filas.length, column: numCols },
    };
  }

  /* ─────────── 8. PIE DEL DOCUMENTO ─────────── */
  const nPie = filaEnc + op.filas.length + (op.totalizar?.length ? 3 : 2);
  hoja.mergeCells(nPie, 1, nPie, numCols);
  const pie = hoja.getCell(nPie, 1);
  pie.value = `Generado por el ERP de Santa Mónica el ${fechaCorte} a las ${horaCorte}` +
              (op.usuario ? ` por ${op.usuario}` : '') +
              '  ·  Documento interno de uso confidencial';
  pie.font = { name: 'Calibri', size: 8, italic: true, color: { argb: 'FF6F7D95' } };
  pie.alignment = { horizontal: 'left', indent: 1 };

  const buffer = await libro.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/* --- Formatos numéricos listos para usar --- */
export const FORMATO = {
  toneladas: '#,##0.000',
  kilos: '#,##0',
  entero: '#,##0',
  decimal: '#,##0.00',
  dolares: '"US$" #,##0.00',
  soles: '"S/" #,##0.00',
  porcentaje: '0.0"%"',
  fecha: 'dd/mm/yyyy',
};
