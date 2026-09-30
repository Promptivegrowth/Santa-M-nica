/**
 * ============================================================================
 *  EL MAESTRO DE CLIENTES, SACADO DE LA DATA DE OLIVER
 * ============================================================================
 *  Oliver: no hay maestro de clientes; se van creando según las compras. Así
 *  que se arma de lo que ya está en «DATA 2025»: las columnas CLIENTE (O) y
 *  CLIENTE DESPACHO (AE).
 *
 *  El problema es que el mismo cliente aparece escrito de varias formas
 *  —«SACRAMENTO CO., LIMITED», «SACRAMENTO CO., LTD.», «SACRAMENTO CO., LTD»—.
 *  Se agrupan por un nombre normalizado (sin mayúsculas/minúsculas, puntos,
 *  comas ni «LTD», «CO.», «S.A.C.»…) y se propone como nombre el que más se
 *  usa. Pero unir dos clientes que no son el mismo sería grave, así que NO se
 *  carga nada: se genera un Excel para que Oliver confirme las uniones.
 *
 *  El archivo va FUERA del repositorio, junto a la DATA: lleva nombres reales.
 *
 *      node scripts/clientes-desde-data.mjs ["../DATA 2025 (2).xlsx"]
 * ============================================================================
 */
import ExcelJS from 'exceljs';
import path from 'node:path';

const ARCHIVO = process.argv.find((a) => a.endsWith('.xlsx')) ?? '../DATA 2025 (2).xlsx';
const SALIDA = path.resolve('..', 'Clientes DATA 2025 - para revisar con Oliver.xlsx');
const C = { campana: 2, fecha: 3, cliente: 15, destino: 32, clienteDespacho: 31 };

const texto = (celda) => {
  let v = celda.value;
  if (v && typeof v === 'object' && 'result' in v) v = v.result;
  if (v && typeof v === 'object' && v.richText) v = v.richText.map((r) => r.text).join('');
  return v == null ? '' : String(v).trim();
};

/** La forma con la que se comparan nombres: la que decide qué es «el mismo». */
export function normalizar(nombre) {
  return nombre.toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[.,]/g, ' ')
    .replace(/\b(S ?A ?C|S ?A|S ?R ?L|E ?I ?R ?L|CO|LTD|LIMITED|INC|CORP|CORPORATION|COMPANY|TRADING|LLC)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const libro = new ExcelJS.Workbook();
await libro.xlsx.readFile(path.resolve(ARCHIVO));
const hoja = libro.getWorksheet('GENERAL');

/* ---- Cada nombre, cuántas filas y a qué destinos ---- */
const nombres = new Map(); // nombre → { filas, destinos: Map }
hoja.eachRow((fila, n) => {
  if (n < 2) return;
  const destino = texto(fila.getCell(C.destino));
  for (const col of [C.cliente, C.clienteDespacho]) {
    const nombre = texto(fila.getCell(col)).replace(/\s+/g, ' ');
    if (!nombre) continue;
    const x = nombres.get(nombre) ?? { filas: 0, destinos: new Map() };
    x.filas++;
    //  Los números de booking se colaron en la columna de destino.
    if (destino && !/^(LMM|\d{8,})/.test(destino)) x.destinos.set(destino, (x.destinos.get(destino) ?? 0) + 1);
    nombres.set(nombre, x);
  }
});

/* ---- Agrupar variantes ---- */
const grupos = new Map(); // normalizado → [{ nombre, filas, destinos }]
for (const [nombre, x] of nombres) {
  const clave = normalizar(nombre) || nombre.toUpperCase();
  if (!grupos.has(clave)) grupos.set(clave, []);
  grupos.get(clave).push({ nombre, ...x });
}
const clientes = [...grupos.values()].map((vs) => {
  vs.sort((a, b) => b.filas - a.filas);
  const destinos = new Map();
  for (const v of vs) for (const [d, k] of v.destinos) destinos.set(d, (destinos.get(d) ?? 0) + k);
  return {
    propuesto: vs[0].nombre,
    variantes: vs.map((v) => `${v.nombre} (${v.filas})`),
    filas: vs.reduce((s, v) => s + v.filas, 0),
    destinos: [...destinos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([d]) => d).join(', '),
  };
}).sort((a, b) => b.filas - a.filas);
const uniones = clientes.filter((c) => c.variantes.length > 1);

/* ---- El Excel para Oliver ---- */
const salida = new ExcelJS.Workbook();
const estiloEnc = (fila) => fila.eachCell((c) => {
  c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF304F8C' } };
});
const h1 = salida.addWorksheet('Uniones a confirmar', { views: [{ state: 'frozen', ySplit: 1 }] });
h1.columns = [
  { header: 'Nombre que se propone', key: 'propuesto', width: 48 },
  { header: 'Variantes que se unirían (filas en la DATA)', key: 'variantes', width: 90 },
  { header: '¿Es el mismo cliente? (SÍ / NO)', key: 'ok', width: 26 },
  { header: 'Nombre correcto, si es otro', key: 'correcto', width: 36 },
];
estiloEnc(h1.getRow(1));
uniones.forEach((c) => h1.addRow({ propuesto: c.propuesto, variantes: c.variantes.join('  |  ') }));
h1.getColumn(2).alignment = { wrapText: true, vertical: 'top' };

const h2 = salida.addWorksheet('Todos los clientes', { views: [{ state: 'frozen', ySplit: 1 }] });
h2.columns = [
  { header: 'Cliente', key: 'propuesto', width: 48 },
  { header: 'Filas en la DATA', key: 'filas', width: 16 },
  { header: 'Destinos más frecuentes', key: 'destinos', width: 40 },
  { header: 'Variantes', key: 'n', width: 10 },
  { header: 'País (completar)', key: 'pais', width: 18 },
  { header: 'RUC / Tax ID (completar)', key: 'ruc', width: 22 },
];
estiloEnc(h2.getRow(1));
clientes.forEach((c) => h2.addRow({ propuesto: c.propuesto, filas: c.filas, destinos: c.destinos, n: c.variantes.length }));
h2.autoFilter = { from: 'A1', to: 'F1' };
await salida.xlsx.writeFile(SALIDA);

console.log(`\n  ${path.basename(ARCHIVO)} · columnas CLIENTE y CLIENTE DESPACHO`);
console.log(`  ${nombres.size} nombres distintos → ${clientes.length} clientes`);
console.log(`  ${uniones.length} clientes escritos de más de una forma (a confirmar)`);
uniones.slice(0, 5).forEach((c) => console.log(`    ${c.propuesto}  ←  ${c.variantes.length} variantes`));
console.log(`\n  Archivo para Oliver: ${SALIDA}\n  No se cargó nada en la base.\n`);
