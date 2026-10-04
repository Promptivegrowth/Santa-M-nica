/**
 * ============================================================================
 *  CIERRE SEMANAL DE PRODUCCIÓN · exportación a Excel
 * ============================================================================
 *  Con la cara de la hoja «1. RESUMEN T» de Marco: logotipo, «Avance de
 *  Plan», «Actualizado al», «Gestión al», las 14 columnas, los porcentajes
 *  bajo el 90 % en rojo y el total general resaltado. Los porcentajes y
 *  proyecciones van como VALORES calculados por el sistema, no como fórmulas:
 *  así el archivo dice exactamente lo que decía la pantalla.
 * ============================================================================
 */
import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MARCA } from './excel';
import { UMBRAL_ALERTA, type FilaCierre } from './cierre';
import type { FilaConCategoria } from './cierreDatos';

const COLUMNAS: { titulo: string; clave: keyof FilaCierre; tipo: 'tn' | 'pct' | 'dif'; alerta?: boolean }[] = [
  { titulo: 'Plan MP(T)', clave: 'plan_mp', tipo: 'tn' },
  { titulo: 'Real MP(T)', clave: 'real_mp', tipo: 'tn' },
  { titulo: '%Cump', clave: 'cump_mp', tipo: 'pct', alerta: true },
  { titulo: 'Ped/Ent.(T)', clave: 'dif_mp', tipo: 'dif' },
  { titulo: 'Prod. Plan (T)', clave: 'plan_prod', tipo: 'tn' },
  { titulo: 'Prod. Real (T)', clave: 'real_prod', tipo: 'tn' },
  { titulo: '%Cump', clave: 'cump_prod', tipo: 'pct', alerta: true },
  { titulo: 'Stock Real (T)', clave: 'stock_inicial', tipo: 'tn' },
  { titulo: 'Plan Ventas (T)', clave: 'plan_ventas', tipo: 'tn' },
  { titulo: 'Ventas (T)', clave: 'ventas', tipo: 'tn' },
  { titulo: 'Proy Lineal Prod. (T)', clave: 'proy_prod', tipo: 'tn' },
  { titulo: '%Cum.Proy Lineal Prod', clave: 'cump_proy_prod', tipo: 'pct', alerta: true },
  { titulo: 'Proy Lineal Ventas (T)', clave: 'proy_ventas', tipo: 'tn' },
  { titulo: '%Cum.Proy Lineal Ventas', clave: 'cump_ventas', tipo: 'pct' },
];
const FORMATO = { tn: '#,##0.0', pct: '0%', dif: '#,##0;"("#,##0")"' };

export async function generarExcelCierre(op: {
  filas: FilaConCategoria[];
  total: Partial<FilaCierre>;
  actualizadoTexto: string;
  gestion: number;
  mesTexto: string;
  usuario: string;
  dias: { proyeccion: number; mes: number };
}): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Santa Mónica ERP';
  libro.company = 'Industrial Pesquera Santa Mónica S.A.';
  const hoja = libro.addWorksheet('1. RESUMEN T', {
    views: [{ state: 'frozen', ySplit: 7, xSplit: 1 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const nCol = COLUMNAS.length + 1;

  try {
    const logo = await readFile(join(process.cwd(), 'public', 'logo.png'));
    const id = libro.addImage({ buffer: logo as unknown as ArrayBuffer, extension: 'png' });
    hoja.addImage(id, { tl: { col: 0.2, row: 0.2 }, ext: { width: 168, height: 44 } });
  } catch {
    // sin logotipo, el archivo igual sale
  }
  hoja.getRow(1).height = 22;
  hoja.getRow(2).height = 22;

  const t = hoja.getCell('A4');
  t.value = `Avance de Plan · ${op.mesTexto}`;
  t.font = { name: 'Calibri', size: 14, bold: true, underline: true, color: { argb: MARCA.tinta } };

  hoja.mergeCells(3, 6, 3, 9);
  const g = hoja.getCell(3, 6);
  g.value = `Gestión al: ${Math.round(op.gestion * 100)}%`;
  g.font = { name: 'Calibri', size: 11, bold: true };
  hoja.mergeCells(4, 6, 4, 12);
  const a = hoja.getCell(4, 6);
  a.value = `Actualizado al: ${op.actualizadoTexto}`;
  a.font = { name: 'Calibri', size: 11, bold: true };
  a.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
  a.alignment = { horizontal: 'center' };
  const nota = hoja.getCell(5, 6);
  nota.value = `Proyección lineal = real ÷ ${op.dias.proyeccion} × ${op.dias.mes}`;
  nota.font = { name: 'Calibri', size: 8, italic: true, color: { argb: 'FF6F7D95' } };

  /* ---- Encabezados ---- */
  const enc = hoja.getRow(7);
  ['Categoria', ...COLUMNAS.map((c) => c.titulo)].forEach((texto, k) => {
    const c = enc.getCell(k + 1);
    c.value = texto;
    c.font = { name: 'Calibri', size: 10, bold: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9DDE3' } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  });
  enc.height = 32;
  hoja.getColumn(1).width = 30;
  for (let k = 2; k <= nCol; k++) hoja.getColumn(k).width = 13;

  /* ---- Filas ---- */
  const escribirFila = (r: number, nombre: string, f: Partial<FilaCierre>, esTotal: boolean) => {
    const fila = hoja.getRow(r);
    fila.getCell(1).value = nombre;
    COLUMNAS.forEach((col, k) => {
      const c = fila.getCell(k + 2);
      const v = f[col.clave];
      c.value = typeof v === 'number' ? v : null;
      c.numFmt = FORMATO[col.tipo];
      c.alignment = { horizontal: 'right' };
      if (col.alerta && typeof v === 'number' && v < UMBRAL_ALERTA) {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4C7C3' } };
        c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFC00000' } };
      }
    });
    for (let k = 1; k <= nCol; k++) {
      const c = fila.getCell(k);
      c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
      if (esTotal) {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
        c.font = { name: 'Calibri', size: 10, bold: true };
      } else if (!c.font?.bold) {
        c.font = { name: 'Calibri', size: 10 };
      }
    }
  };
  op.filas.forEach((x, i) => escribirFila(8 + i, x.categoria.nombre, x.fila, false));
  const rTotal = 8 + op.filas.length + 1;
  escribirFila(rTotal, 'Total general', op.total, true);

  const pie = hoja.getCell(rTotal + 2, 1);
  pie.value = `Generado por el ERP de Santa Mónica por ${op.usuario}. Prod. Real, Stock Real y Ventas de pota y merluza salen del sistema; el resto se ingresa.`;
  pie.font = { name: 'Calibri', size: 8, italic: true, color: { argb: 'FF6F7D95' } };

  return Buffer.from(await libro.xlsx.writeBuffer());
}
