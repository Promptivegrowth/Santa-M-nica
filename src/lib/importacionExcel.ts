/**
 * ============================================================================
 *  PLANTILLAS DE IMPORTACIÓN · el Excel que da el sistema y cómo se lee
 * ============================================================================
 *  Pedido de Oliver Tello (jefe de Operaciones): «no queremos hacer un
 *  retrabajo estar llenando por formulario». Su equipo ya lleva en Excel lo
 *  que entra a cámara y lo que se traslada. En vez de pedirles que lo vuelvan
 *  a teclear pallet por pallet, el sistema les da una plantilla con el formato
 *  correcto; copian ahí sus tablas, la suben, y el sistema la revisa fila por
 *  fila.
 *
 *  Este archivo hace las dos mitades que no dependen de QUÉ se importa:
 *
 *   · ARMAR la plantilla con la identidad de los demás reportes (logotipo,
 *     azul de marca), los encabezados con su explicación, una fila de
 *     ejemplo, listas desplegables donde se puede, una hoja con las listas
 *     válidas y otra con las instrucciones.
 *   · LEER lo que vuelve: encuentra la fila de encabezados aunque se haya
 *     movido, junta cada columna por su título (no por su posición: si alguien
 *     inserta una columna, igual se lee bien) y devuelve cada valor como
 *     texto. Qué significa cada texto lo decide quien importa (ingresos,
 *     traslados), con las reglas de siempre.
 * ============================================================================
 */
import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MARCA } from './excel';

export type ColumnaPlantilla = {
  clave: string;
  titulo: string;
  obligatoria?: boolean;
  /** Una línea: qué va en la columna. Sale como nota del encabezado y en Instrucciones. */
  ayuda: string;
  ancho?: number;
  tipo?: 'texto' | 'numero' | 'fecha';
  /** Otros títulos con que se acepta la columna al leer. */
  alias?: string[];
};

/** Una lista desplegable: a qué columna va y de dónde salen sus valores. */
export type ListaPlantilla = { clave: string; titulo: string; valores: string[] };

/** El marcador de la fila de ejemplo: al leer, esa fila se salta. */
export const MARCA_EJEMPLO = 'EJEMPLO';

/** Filas preparadas con listas desplegables. */
const FILAS_PREPARADAS = 500;
/** Lo máximo que se lee de un archivo: más es otro archivo. */
export const MAXIMO_FILAS = 1000;

const FILA_TITULO = 1;
const FILA_ENCABEZADOS = 4;

const letra = (n: number) => {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

const estiloEncabezado = (c: ExcelJS.Cell, obligatoria: boolean) => {
  c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: MARCA.blanco } };
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: obligatoria ? MARCA.azulProfundo : MARCA.azulMedio } };
  c.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  c.border = { bottom: { style: 'medium', color: { argb: MARCA.verdeAzulado } } };
};

/**
 * Arma el libro de la plantilla.
 *
 *  · Hoja principal: encabezados (los obligatorios en azul oscuro y con *),
 *    la fila de ejemplo en gris y cursiva, y 500 filas con listas desplegables.
 *  · Hojas de referencia (p. ej. «Listas», «Pallets disponibles»): tablas
 *    para consultar o copiar. Las listas desplegables leen de «Listas».
 *  · «Instrucciones»: qué va en cada columna y cómo se sube.
 */
export async function generarPlantilla(op: {
  titulo: string;
  subtitulo: string;
  hoja: string;
  columnas: ColumnaPlantilla[];
  ejemplo: Record<string, string | number>;
  listas: ListaPlantilla[];
  /** Tablas de consulta, cada una en su hoja. */
  referencias?: { hoja: string; titulo: string; encabezados: string[]; filas: (string | number)[][]; anchos?: number[] }[];
  instrucciones: string[];
  usuario: string;
}): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Santa Mónica ERP';
  libro.company = 'Industrial Pesquera Santa Mónica S.A.';
  libro.created = new Date();

  const hoja = libro.addWorksheet(op.hoja, {
    views: [{ state: 'frozen', ySplit: FILA_ENCABEZADOS, xSplit: 1 }],
    properties: { tabColor: { argb: MARCA.azulProfundo } },
  });
  const nCol = op.columnas.length;

  /* ─────────── Cabecera ─────────── */
  try {
    const logo = await readFile(join(process.cwd(), 'public', 'logo.png'));
    const id = libro.addImage({ buffer: logo as unknown as ArrayBuffer, extension: 'png' });
    hoja.addImage(id, { tl: { col: 0.1, row: 0.15 }, ext: { width: 130, height: 34 } });
  } catch {
    // Sin logotipo la plantilla sirve igual.
  }
  hoja.getRow(1).height = 22;
  hoja.getRow(2).height = 30;
  hoja.mergeCells(FILA_TITULO, 3, FILA_TITULO, nCol);
  const t = hoja.getCell(FILA_TITULO, 3);
  t.value = op.titulo;
  t.font = { name: 'Calibri', size: 15, bold: true, color: { argb: MARCA.azulProfundo } };
  hoja.mergeCells(2, 3, 2, nCol);
  const st = hoja.getCell(2, 3);
  st.value = op.subtitulo;
  st.font = { name: 'Calibri', size: 9, color: { argb: 'FF41506A' } };
  st.alignment = { wrapText: true, vertical: 'top' };
  hoja.getRow(3).height = 6;

  /* ─────────── Encabezados ─────────── */
  op.columnas.forEach((c, k) => {
    const celda = hoja.getCell(FILA_ENCABEZADOS, k + 1);
    celda.value = c.obligatoria ? `${c.titulo} *` : c.titulo;
    estiloEncabezado(celda, Boolean(c.obligatoria));
    celda.note = { texts: [{ text: c.ayuda }] };
    hoja.getColumn(k + 1).width = c.ancho ?? 16;
  });
  hoja.getRow(FILA_ENCABEZADOS).height = 32;

  /* ─────────── Fila de ejemplo ─────────── */
  const filaEj = FILA_ENCABEZADOS + 1;
  op.columnas.forEach((c, k) => {
    const celda = hoja.getCell(filaEj, k + 1);
    const v = op.ejemplo[c.clave];
    celda.value = v === undefined ? null : v;
    celda.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF6F7D95' } };
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MARCA.grisSuave } };
  });

  /* ─────────── Formato de las filas para llenar ─────────── */
  const desde = filaEj;
  const hasta = filaEj + FILAS_PREPARADAS;
  op.columnas.forEach((c, k) => {
    for (let r = desde + 1; r <= hasta; r++) {
      const celda = hoja.getCell(r, k + 1);
      if (c.tipo === 'fecha') celda.numFmt = 'dd/mm/yyyy';
      //  Los códigos de pallet como texto: «SM 26 02 0168» no es un número, y
      //  un código «0168» perdería el cero.
      if (c.tipo === 'texto') celda.numFmt = '@';
    }
  });

  /* ─────────── Hoja «Listas» y desplegables ─────────── */
  if (op.listas.length) {
    const hl = libro.addWorksheet('Listas', { views: [{ state: 'frozen', ySplit: 1 }] });
    op.listas.forEach((l, k) => {
      const col = k + 1;
      const enc = hl.getCell(1, col);
      enc.value = l.titulo;
      estiloEncabezado(enc, true);
      hl.getColumn(col).width = Math.min(60, Math.max(14, ...l.valores.map((v) => v.length + 2)));
      l.valores.forEach((v, i) => { hl.getCell(i + 2, col).value = v; });

      const k2 = op.columnas.findIndex((c) => c.clave === l.clave);
      if (k2 < 0 || l.valores.length === 0) return;
      const rango = `Listas!$${letra(col)}$2:$${letra(col)}$${l.valores.length + 1}`;
      for (let r = desde; r <= hasta; r++) {
        hoja.getCell(r, k2 + 1).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [rango],
          showErrorMessage: true,
          errorStyle: 'warning',
          errorTitle: 'Valor fuera de la lista',
          error: `Elija un valor de la lista (hoja «Listas», columna «${l.titulo}»). Si lo deja así, el sistema le dirá qué no reconoció.`,
        };
      }
    });
  }

  /* ─────────── Hojas de consulta ─────────── */
  for (const ref of op.referencias ?? []) {
    const h = libro.addWorksheet(ref.hoja, { views: [{ state: 'frozen', ySplit: 2 }] });
    h.mergeCells(1, 1, 1, Math.max(1, ref.encabezados.length));
    h.getCell(1, 1).value = ref.titulo;
    h.getCell(1, 1).font = { name: 'Calibri', size: 11, bold: true, color: { argb: MARCA.azulProfundo } };
    ref.encabezados.forEach((e, k) => {
      const c = h.getCell(2, k + 1);
      c.value = e;
      estiloEncabezado(c, true);
      h.getColumn(k + 1).width = ref.anchos?.[k] ?? 18;
    });
    ref.filas.forEach((f, i) => { h.getRow(i + 3).values = f; });
    if (ref.filas.length) {
      h.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2 + ref.filas.length, column: ref.encabezados.length } };
    }
  }

  /* ─────────── Instrucciones ─────────── */
  const hi = libro.addWorksheet('Instrucciones');
  hi.getColumn(1).width = 30;
  hi.getColumn(2).width = 100;
  hi.getCell(1, 1).value = 'Cómo usar esta plantilla';
  hi.getCell(1, 1).font = { name: 'Calibri', size: 14, bold: true, color: { argb: MARCA.azulProfundo } };
  let r = 3;
  op.instrucciones.forEach((linea, i) => {
    hi.getCell(r, 1).value = `${i + 1}.`;
    hi.getCell(r, 1).alignment = { horizontal: 'right', vertical: 'top' };
    hi.getCell(r, 2).value = linea;
    hi.getCell(r, 2).alignment = { wrapText: true, vertical: 'top' };
    r++;
  });
  r++;
  hi.getCell(r, 1).value = 'Columna';
  hi.getCell(r, 2).value = 'Qué va';
  estiloEncabezado(hi.getCell(r, 1), true);
  estiloEncabezado(hi.getCell(r, 2), true);
  r++;
  for (const c of op.columnas) {
    hi.getCell(r, 1).value = c.obligatoria ? `${c.titulo} *` : c.titulo;
    hi.getCell(r, 1).font = { name: 'Calibri', size: 10, bold: Boolean(c.obligatoria) };
    hi.getCell(r, 2).value = `${c.obligatoria ? 'Obligatoria. ' : 'Opcional. '}${c.ayuda}`;
    hi.getCell(r, 2).alignment = { wrapText: true, vertical: 'top' };
    r++;
  }
  r++;
  const ahora = new Date();
  hi.getCell(r, 1).value =
    `Plantilla generada por el ERP de Santa Mónica el ${ahora.toLocaleDateString('es-PE', { timeZone: 'America/Lima' })} ` +
    `${ahora.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Lima' })} para ${op.usuario}.`;
  hi.getCell(r, 1).font = { name: 'Calibri', size: 8, italic: true, color: { argb: 'FF6F7D95' } };

  return Buffer.from(await libro.xlsx.writeBuffer());
}

/* ==========================================================================
   LEER EL ARCHIVO SUBIDO
   ========================================================================== */

/** Para comparar textos sin que importen tildes, mayúsculas ni espacios de más. */
export function normalizarTexto(t: unknown): string {
  return String(t ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[·|•]/g, ' · ')
    .replace(/\s+/g, ' ')
    .trim();
}

const tituloNormal = (t: string) => normalizarTexto(t.replace(/\*/g, ''));

/** Una fecha de Excel (número de serie) o un objeto Date, como «AAAA-MM-DD». */
function fechaISO(v: Date | number): string {
  const d = typeof v === 'number' ? new Date(Math.round((v - 25569) * 86400000)) : v;
  return d.toISOString().slice(0, 10);
}

/** El valor de una celda, como texto. */
function textoCelda(v: ExcelJS.CellValue, tipo: ColumnaPlantilla['tipo']): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return fechaISO(v);
  if (typeof v === 'number') {
    //  Una fecha que Excel guardó como número de serie (p. ej. 46322).
    if (tipo === 'fecha' && v > 20000 && v < 80000) return fechaISO(v);
    return String(v);
  }
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>;
    if ('result' in o) return textoCelda(o.result as ExcelJS.CellValue, tipo);       // fórmula
    if ('richText' in o) return (o.richText as { text: string }[]).map((x) => x.text).join('');
    if ('text' in o) return String(o.text ?? '');                                     // hipervínculo
    if ('error' in o) return '';
  }
  return String(v).trim();
}

export type FilaLeida = { fila: number; valores: Record<string, string> };

/**
 * Lee la hoja de datos de una plantilla.
 *
 * Busca la hoja por su nombre y, si no está, usa la primera. Dentro, busca la
 * fila de encabezados entre las quince primeras (la que reconoce más
 * columnas): así funciona con la plantilla tal cual y con una tabla pegada
 * que traiga sus propios títulos arriba.
 */
export async function leerPlantilla(
  archivo: ArrayBuffer,
  op: { hoja: string; columnas: ColumnaPlantilla[]; claveEjemplo: string }
): Promise<{ ok: true; filas: FilaLeida[]; ignoradas: string[] } | { ok: false; mensaje: string }> {
  const libro = new ExcelJS.Workbook();
  try {
    await libro.xlsx.load(archivo);
  } catch {
    return {
      ok: false,
      mensaje: 'No se pudo leer el archivo como Excel. Guárdelo como «Libro de Excel (.xlsx)» —no .xls ni .csv— y vuelva a subirlo.',
    };
  }

  const hoja = libro.getWorksheet(op.hoja) ?? libro.worksheets[0];
  if (!hoja) return { ok: false, mensaje: 'El archivo no tiene ninguna hoja.' };

  const porTitulo = new Map<string, ColumnaPlantilla>();
  for (const c of op.columnas) {
    porTitulo.set(tituloNormal(c.titulo), c);
    for (const a of c.alias ?? []) porTitulo.set(tituloNormal(a), c);
  }

  /* ---- La fila de encabezados ---- */
  let filaEnc = 0;
  let mejor = 0;
  let columnas = new Map<number, ColumnaPlantilla>();
  for (let r = 1; r <= Math.min(15, hoja.rowCount); r++) {
    const mapa = new Map<number, ColumnaPlantilla>();
    hoja.getRow(r).eachCell({ includeEmpty: false }, (celda, col) => {
      const c = porTitulo.get(tituloNormal(textoCelda(celda.value, 'texto')));
      if (c && ![...mapa.values()].includes(c)) mapa.set(col, c);
    });
    if (mapa.size > mejor) { mejor = mapa.size; filaEnc = r; columnas = mapa; }
  }

  const obligatorias = op.columnas.filter((c) => c.obligatoria);
  const faltan = obligatorias.filter((c) => ![...columnas.values()].includes(c));
  if (!filaEnc || faltan.length) {
    return {
      ok: false,
      mensaje: filaEnc
        ? `Al archivo le faltan columnas obligatorias: ${faltan.map((c) => `«${c.titulo}»`).join(', ')}. ` +
          'Descargue la plantilla y pegue sus datos debajo de los encabezados, sin cambiarles el nombre.'
        : 'No se encontraron los encabezados de la plantilla. Descargue la plantilla y pegue sus datos debajo de los encabezados, sin cambiarles el nombre.',
    };
  }

  /* ---- Columnas que vinieron pero no se reconocen (se avisan, no se leen) ---- */
  const ignoradas: string[] = [];
  hoja.getRow(filaEnc).eachCell({ includeEmpty: false }, (celda, col) => {
    const t = textoCelda(celda.value, 'texto');
    if (t && !columnas.has(col)) ignoradas.push(t);
  });

  /* ---- Los datos ---- */
  const filas: FilaLeida[] = [];
  for (let r = filaEnc + 1; r <= hoja.rowCount; r++) {
    const fila = hoja.getRow(r);
    const valores: Record<string, string> = {};
    let algo = false;
    for (const [col, c] of columnas) {
      const t = textoCelda(fila.getCell(col).value, c.tipo).trim();
      valores[c.clave] = t;
      if (t) algo = true;
    }
    if (!algo) continue;
    //  La fila de ejemplo de la plantilla no se importa.
    if (normalizarTexto(valores[op.claveEjemplo]).startsWith(normalizarTexto(MARCA_EJEMPLO))) continue;
    filas.push({ fila: r, valores });
    if (filas.length > MAXIMO_FILAS) {
      return {
        ok: false,
        mensaje: `El archivo tiene más de ${MAXIMO_FILAS} filas con datos. Divídalo en varios archivos y súbalos por separado.`,
      };
    }
  }

  if (!filas.length) {
    return { ok: false, mensaje: 'El archivo no tiene filas con datos debajo de los encabezados (la fila de ejemplo no cuenta).' };
  }
  return { ok: true, filas, ignoradas };
}

/* ==========================================================================
   INTERPRETAR TEXTOS
   ========================================================================== */

/**
 * Un número escrito como sea: 1234.5, «1,234.5», «1.234,5», «1234,5».
 * NaN si no es un número.
 */
export function leerNumero(t: string): number {
  let s = String(t ?? '').replace(/\s|kg|KG|Kg|US\$|\$/g, '');
  if (!s) return NaN;
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

/**
 * Una fecha escrita como sea: «AAAA-MM-DD», «DD/MM/AAAA», «D/M/AA», o el
 * número de serie de Excel. Devuelve «AAAA-MM-DD» o null si no se entiende.
 */
export function leerFecha(t: string): string | null {
  const s = String(t ?? '').trim();
  if (!s) return null;
  let a: number, m: number, d: number;
  let x = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (x) { a = +x[1]; m = +x[2]; d = +x[3]; }
  else if ((x = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s))) {
    d = +x[1]; m = +x[2]; a = +x[3]; if (a < 100) a += 2000;
  } else if (/^\d{5}(\.\d+)?$/.test(s)) {
    return fechaISO(Number(s));
  } else return null;
  const f = new Date(Date.UTC(a, m - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null;
  return f.toISOString().slice(0, 10);
}
