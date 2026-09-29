/**
 * ============================================================================
 *  OBJETIVOS MENSUALES · exportación a Excel
 * ============================================================================
 *  El archivo sale con lo mismo que la pantalla —los mismos filtros— y con la
 *  identidad de los demás reportes: logotipo, azul de marca, fecha de corte,
 *  los filtros aplicados y quién lo exportó.
 *
 *  Dos hojas:
 *    · el tablero, con el semáforo pintado en cada celda;
 *    · «Cómo se calcula»: la fórmula de cada indicador y de dónde sale. Oliver
 *      llevaba las fórmulas escondidas en las celdas del Excel; aquí quedan a
 *      la vista, para poder revisarlas.
 * ============================================================================
 */
import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MARCA } from './excel';
import { NOMBRE_MES, TEXTO_ESTADO, type Celda, type Estado, type FilaTablero, type Indicador } from './objetivos';
import type { Filtros } from './objetivosDatos';

const FONDO: Record<Estado, string> = {
  supera: 'FFDBECE7', cumple: 'FFDBECE7', alerta: 'FFF7ECD9', no_cumple: 'FFF8E0DF',
};
const TINTA: Record<Estado, string> = {
  supera: 'FF1F6B57', cumple: 'FF1F6B57', alerta: 'FF8A5A10', no_cumple: 'FF95302C',
};
const TIPO: Record<string, string> = { manual: 'Se digita', erp: 'Del ERP', calculado: 'Calculado' };
const SENTIDO: Record<string, string> = { menor: 'Menos es mejor', mayor: 'Más es mejor', informativo: 'Informativo' };
const AGREGACION: Record<string, string> = {
  suma: 'Suma de los meses', promedio: 'Promedio de los meses', primero: 'El primer mes', ratio: 'La fórmula sobre las sumas del año',
};

const formato = (dec: number) => (dec <= 0 ? '#,##0' : `#,##0.${'0'.repeat(dec)}`);

/** La fórmula de un indicador, en palabras. */
export function formulaEnTexto(i: Indicador, nombreDe: (codigo: string) => string): string {
  if (i.tipo === 'manual') return 'Lo digita el responsable.';
  if (i.tipo === 'erp') return `Del ERP (${i.descripcion ?? i.fuente}).`;
  const lista = (cs: string[]) => cs.map(nombreDe).join(' + ');
  let t = (i.numerador?.length ?? 0) > 1 ? `(${lista(i.numerador!)})` : lista(i.numerador ?? []);
  if (i.denominador?.length) {
    t += ` ÷ ${i.denominador.length > 1 ? `(${lista(i.denominador)})` : lista(i.denominador)}`;
  }
  if (Number(i.factor) !== 1) t += ` × ${Number(i.factor)}`;
  if (i.dividir_tc) t += ' ÷ tipo de cambio';
  return t;
}

export async function generarExcelObjetivos(op: {
  filas: FilaTablero[];
  todas: FilaTablero[];
  filtros: Filtros;
  filtrosTexto: Record<string, string>;
  usuario: string;
  tipoCambio: number;
}): Promise<Buffer> {
  const { filas, filtros: f } = op;
  const meses = Array.from({ length: f.hasta - f.desde + 1 }, (_, k) => f.desde + k);
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Santa Mónica ERP';
  libro.company = 'Industrial Pesquera Santa Mónica S.A.';
  libro.created = new Date();

  /* ─────────── Las columnas según la vista ─────────── */
  type Sub = { titulo: string; de: (c: Celda) => number | null; pinta: boolean };
  const subcolumnas: Sub[] =
    f.vista === 'real' ? [{ titulo: '', de: (c) => c.valor, pinta: true }]
    : f.vista === 'metas' ? [
        { titulo: 'esp.', de: (c) => (c.metaDelAnio ? null : c.esperado), pinta: false },
        { titulo: 'máx.', de: (c) => (c.metaDelAnio ? null : c.maximo), pinta: false },
      ]
    : [
        { titulo: 'real', de: (c) => c.valor, pinta: true },
        { titulo: 'esp.', de: (c) => c.esperado, pinta: false },
        { titulo: 'máx.', de: (c) => c.maximo, pinta: false },
      ];
  const fijas = ['Bloque', 'Indicador', 'Unidad', 'Origen', 'Sentido'];
  const cabeceras = [
    ...fijas,
    ...meses.flatMap((m) => subcolumnas.map((s) => `${NOMBRE_MES[m - 1]}${s.titulo ? ` ${s.titulo}` : ''}`)),
    ...subcolumnas.map((s) => `Año ${f.anio}${s.titulo ? ` ${s.titulo}` : ''}`),
  ];
  const nCol = cabeceras.length;

  const hoja = libro.addWorksheet(`Objetivos ${f.anio}`, {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 6 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  /* ─────────── Cabecera con logotipo ─────────── */
  try {
    const logo = await readFile(join(process.cwd(), 'public', 'logo.png'));
    const id = libro.addImage({ buffer: logo as unknown as ArrayBuffer, extension: 'png' });
    hoja.addImage(id, { tl: { col: 0.2, row: 0.3 }, ext: { width: 168, height: 44 } });
  } catch {
    // Sin logotipo el archivo igual se genera.
  }
  hoja.getRow(1).height = 20;
  hoja.getRow(2).height = 20;
  hoja.getRow(3).height = 8;
  hoja.mergeCells(1, 3, 1, nCol);
  const t = hoja.getCell(1, 3);
  t.value = `Objetivos mensuales ${f.anio} · Compromisos para el éxito`;
  t.font = { name: 'Calibri', size: 16, bold: true, color: { argb: MARCA.azulProfundo } };
  hoja.mergeCells(2, 3, 2, nCol);
  const st = hoja.getCell(2, 3);
  st.value = 'Industrial Pesquera Santa Mónica S.A. · RUC 20205572229 · Documento confidencial';
  st.font = { name: 'Calibri', size: 9, color: { argb: 'FF6F7D95' } };

  const ahora = new Date();
  const corte = `${ahora.toLocaleDateString('es-PE', { timeZone: 'America/Lima' })} ${ahora.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Lima' })}`;
  hoja.mergeCells(4, 1, 4, nCol);
  const info = hoja.getCell(4, 1);
  info.value = `Fecha de corte: ${corte}   ·   Indicadores: ${filas.length}   ·   Tipo de cambio: ${op.tipoCambio}   ·   Filtros → ` +
    Object.entries(op.filtrosTexto).map(([k, v]) => `${k}: ${v}`).join('  ·  ');
  info.font = { name: 'Calibri', size: 9, color: { argb: 'FF41506A' } };
  info.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MARCA.grisSuave } };
  info.alignment = { vertical: 'middle', indent: 1 };
  hoja.getRow(4).height = 18;
  hoja.getRow(5).height = 6;

  /* ─────────── Encabezados ─────────── */
  const filaEnc = 6;
  cabeceras.forEach((c, k) => {
    const celda = hoja.getCell(filaEnc, k + 1);
    celda.value = c;
    celda.font = { name: 'Calibri', size: 10, bold: true, color: { argb: MARCA.blanco } };
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MARCA.azulProfundo } };
    celda.alignment = { vertical: 'middle', horizontal: k < fijas.length ? 'left' : 'right', wrapText: true };
    celda.border = { bottom: { style: 'medium', color: { argb: MARCA.verdeAzulado } } };
  });
  hoja.getRow(filaEnc).height = 26;
  [14, 40, 10, 11, 15].forEach((w, k) => { hoja.getColumn(k + 1).width = w; });
  for (let k = fijas.length + 1; k <= nCol; k++) hoja.getColumn(k).width = 12;

  /* ─────────── Datos ─────────── */
  filas.forEach((fila, idx) => {
    const i = fila.indicador;
    const r = filaEnc + 1 + idx;
    const origen = TIPO[i.tipo];
    const fijosValores = [i.bloque, i.nombre, i.unidad, origen, SENTIDO[i.sentido]];
    fijosValores.forEach((v, k) => {
      const c = hoja.getCell(r, k + 1);
      c.value = v;
      c.font = { name: 'Calibri', size: 10, color: { argb: MARCA.tinta } };
    });
    let col = fijas.length + 1;
    const escribir = (celda: Celda, s: Sub, esAnio: boolean) => {
      const c = hoja.getCell(r, col++);
      const v = s.de(celda);
      c.value = v === null ? null : v;
      c.numFmt = formato(i.decimales);
      c.alignment = { horizontal: 'right' };
      c.font = {
        name: 'Calibri', size: 10, bold: esAnio,
        //  Un dato del Excel que manda sobre el cálculo va en cursiva.
        italic: s.pinta && celda.origen === 'ajuste',
        color: { argb: s.pinta && celda.estado ? TINTA[celda.estado] : MARCA.tinta },
      };
      if (s.pinta && celda.estado) {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FONDO[celda.estado] } };
      }
      c.border = { bottom: { style: 'hair', color: { argb: MARCA.grisLinea } } };
    };
    for (const m of meses) for (const s of subcolumnas) escribir(fila.meses[m - 1], s, false);
    for (const s of subcolumnas) escribir(fila.anio, s, true);
  });

  if (filas.length) {
    hoja.autoFilter = { from: { row: filaEnc, column: 1 }, to: { row: filaEnc + filas.length, column: nCol } };
  }

  /* ─────────── Leyenda y pie ─────────── */
  let r = filaEnc + filas.length + 2;
  const leyenda: [string, string | null][] = [
    ...(['supera', 'cumple', 'alerta', 'no_cumple'] as Estado[]).map((e) => [TEXTO_ESTADO[e], FONDO[e]] as [string, string]),
    ['En cursiva: dato del Excel histórico que manda sobre el cálculo del ERP', null],
    ['Costos: cumplir es quedar por debajo del esperado; pasar el máximo es no cumplir. Volúmenes: al revés.', null],
  ];
  for (const [texto, fondo] of leyenda) {
    const c = hoja.getCell(r, 2);
    c.value = texto;
    c.font = { name: 'Calibri', size: 9, color: { argb: 'FF41506A' }, italic: fondo === null };
    if (fondo) hoja.getCell(r, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fondo } };
    r++;
  }
  r++;
  hoja.mergeCells(r, 1, r, nCol);
  const pie = hoja.getCell(r, 1);
  pie.value = `Generado por el ERP de Santa Mónica el ${corte} por ${op.usuario} · Uso interno y confidencial`;
  pie.font = { name: 'Calibri', size: 8, italic: true, color: { argb: 'FF6F7D95' } };

  /* ─────────── Hoja 2: cómo se calcula ─────────── */
  const nombreDe = new Map(op.todas.map((x) => [x.indicador.codigo, x.indicador.nombre]));
  const h2 = libro.addWorksheet('Cómo se calcula', { views: [{ state: 'frozen', ySplit: 1 }] });
  const enc2 = ['Bloque', 'Indicador', 'Unidad', 'Cómo se obtiene', 'Fórmula', 'El año es', 'Sentido', 'Decimales'];
  enc2.forEach((c, k) => {
    const celda = h2.getCell(1, k + 1);
    celda.value = c;
    celda.font = { name: 'Calibri', size: 10, bold: true, color: { argb: MARCA.blanco } };
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MARCA.azulProfundo } };
  });
  [16, 40, 10, 14, 70, 32, 16, 10].forEach((w, k) => { h2.getColumn(k + 1).width = w; });
  op.todas.forEach((fila, idx) => {
    const i = fila.indicador;
    h2.getRow(idx + 2).values = [
      i.bloque, i.nombre, i.unidad, TIPO[i.tipo],
      formulaEnTexto(i, (c) => nombreDe.get(c) ?? c),
      AGREGACION[i.agregacion], SENTIDO[i.sentido], i.decimales,
    ];
    h2.getRow(idx + 2).font = { name: 'Calibri', size: 10 };
    h2.getCell(idx + 2, 5).alignment = { wrapText: true, vertical: 'top' };
  });

  return Buffer.from(await libro.xlsx.writeBuffer());
}
