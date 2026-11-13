/**
 * ============================================================================
 *  CONCILIAR EL STOCK DEL ERP CON EL EXCEL DE OPERACIONES
 * ============================================================================
 *  13/11 · El supervisor, antes de cargar información, compara el stock: el
 *  ERP decía 2 093,4 TM y su Excel (filtro ESTATUS FINAL DEL PRODUCTO =
 *  ALMACENADO, suma de PESO NETO) 2 182,4 TM. Este guion explica la
 *  diferencia pallet por pallet en vez de dejarla como un número suelto.
 *
 *  Compara cada pallet + CODIGO de lo ALMACENADO en el Excel (mismas reglas
 *  que importar-data.mjs: una fila SALIDA con estatus ALMACENADO resta) con
 *  las existencias del ERP, y separa:
 *
 *    · FALTAN EN EL ERP   → pallets en cámara según el Excel que el ERP no
 *                           tiene: ingresos que no se registraron.
 *    · SOBRAN EN EL ERP   → pallets que el ERP tiene y el Excel ya no:
 *                           despachos, traslados o reprocesos que no se
 *                           registraron.
 *    · PESO DISTINTO      → el mismo pallet con otro peso.
 *    · SALIDAS MARCADAS ALMACENADO → filas del Excel con MOVIMIENTO SALIDA y
 *                           estatus ALMACENADO: el filtro del Excel las SUMA,
 *                           aunque son producto que salió.
 *
 *  Escribe dos archivos en la carpeta indicada (por defecto, la actual):
 *    1. «Conciliación stock ERP vs Excel.xlsx»: el informe.
 *    2. «Ingresos pendientes - para importar.xlsx»: los pallets que faltan,
 *       con los títulos de la plantilla de ingresos, listos para subirlos en
 *       Ingresos › Importar desde Excel (revisión fila por fila y validación
 *       de Gerencia u Operaciones, como cualquier importación).
 *
 *  NO ESCRIBE EN LA BASE. Solo lee.
 *
 *  Uso:  node --env-file=.env.local scripts/conciliar-stock.mjs "<excel>.xlsx" [carpeta-de-salida]
 * ============================================================================
 */
import ExcelJS from 'exceljs';
import path from 'node:path';
import { ejecutarSQL } from './db.mjs';

const [, , ARCHIVO, SALIDA = '.'] = process.argv;
if (!ARCHIVO) { console.error('Uso: node scripts/conciliar-stock.mjs "<excel>.xlsx" [carpeta]'); process.exit(1); }

/* Las columnas de su hoja GENERAL, por posición (los mismos de importar-data.mjs). */
const C = { campana: 2, fechaProduccion: 3, pallet: 6, camara: 8, almacen: 10, movimiento: 11, motivoSalida: 13,
  estatus: 14, codigo: 17, total: 24, pesoNeto: 25, condFinal: 46, resumenObs: 47 };
/* Las que se copian a la plantilla de ingresos: su título es el mismo en los dos archivos. */
const A_PLANTILLA = ['FECHA DE PRODUCCIÓN', 'N°PALLET', 'CODIGO', 'OPERACIÓN INGRESO', 'PRESENTACION', 'TIPO DE CONGELAMIENTO',
  'PESO BULTO', 'TOTAL', 'PESO NETO', 'ALMACEN', 'CAMARA DE ALMACENAMIENTO', 'TURNO', 'LINEA PROCESADORA', 'MOTIVO INGRESO', 'ID_PRES', 'N° AROS'];

const valor = (c) => {
  let v = c?.value;
  if (v && typeof v === 'object' && 'result' in v) v = v.result;
  if (v && typeof v === 'object' && v.error) return null;
  if (v && typeof v === 'object' && v.richText) return v.richText.map((t) => t.text).join('');
  return v ?? null;
};
const texto = (c) => { const v = valor(c); return v === null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim(); };
const numero = (c) => { const n = Number(String(valor(c) ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
const tm = (kg) => Math.round(kg / 100) / 10;

/* ---------------- El Excel ---------------- */
console.log(`Leyendo ${path.basename(ARCHIVO)}…`);
const libro = new ExcelJS.Workbook();
await libro.xlsx.readFile(ARCHIVO);
const general = libro.getWorksheet('GENERAL');
if (!general) { console.error('El archivo no tiene la hoja GENERAL.'); process.exit(1); }
const titulos = {};
general.getRow(1).eachCell((c, i) => { titulos[String(c.value).trim()] = i; });

let sumaFiltro = 0, ultimaFecha = '';
const excel = new Map();          // pallet|codigo → { kg, filas[], ... }
const salidasAlmacenado = [];
general.eachRow((f, n) => {
  if (n < 2) return;
  const pallet = texto(f.getCell(C.pallet));
  if (!pallet) return;
  const fp = texto(f.getCell(C.fechaProduccion));
  if (fp > ultimaFecha && /^\d{4}-/.test(fp)) ultimaFecha = fp;
  if (texto(f.getCell(C.estatus)).toUpperCase() !== 'ALMACENADO') return;
  const kg = numero(f.getCell(C.pesoNeto));
  sumaFiltro += kg;
  const mov = texto(f.getCell(C.movimiento)).toUpperCase();
  const codigo = texto(f.getCell(C.codigo));
  if (mov !== 'INGRESO') salidasAlmacenado.push({ fila: n, pallet, codigo, kg, motivo: texto(f.getCell(C.motivoSalida)), almacen: texto(f.getCell(C.almacen)) });
  const clave = `${pallet}|${codigo}`;
  const e = excel.get(clave) ?? { pallet, codigo, kg: 0, filas: [], almacen: texto(f.getCell(C.almacen)), camara: texto(f.getCell(C.camara)),
    obs: texto(f.getCell(C.resumenObs)), condicion: texto(f.getCell(C.condFinal)), campana: texto(f.getCell(C.campana)), fecha: fp };
  e.kg += mov === 'INGRESO' ? kg : -kg;
  if (mov === 'INGRESO') e.filas.push(f);
  if (fp && fp < e.fecha) e.fecha = fp;
  excel.set(clave, e);
});

/* ---------------- El ERP ---------------- */
const lotes = await ejecutarSQL(`
  select l.codigo_pallet p, s.codigo c, sum(e.peso_neto_kg) kg, string_agg(distinct a.nombre, ', ') alm
    from existencias e join lotes l on l.id = e.lote_id
    join sku_presentaciones sp on sp.id = l.sku_presentacion_id join skus s on s.id = sp.sku_id
    join almacenes a on a.id = e.almacen_id
   where e.bultos > 0 group by 1, 2`);
const erp = new Map(lotes.map((x) => [`${x.p}|${x.c}`, { kg: Number(x.kg), almacen: x.alm }]));
const kgErp = lotes.reduce((t, x) => t + Number(x.kg), 0);

/* ---------------- La comparación ---------------- */
const faltan = [], sobran = [], distinto = [];
for (const [k, e] of excel) {
  if (e.kg <= 0.5) continue;
  const d = erp.get(k);
  if (!d) faltan.push(e);
  else if (Math.abs(d.kg - e.kg) > 0.5) distinto.push({ ...e, kgErp: d.kg, almacenErp: d.almacen });
}
for (const [k, d] of erp) {
  const e = excel.get(k);
  if (!e || e.kg <= 0.5) { const [pallet, codigo] = k.split('|'); sobran.push({ pallet, codigo, ...d }); }
}
const suma = (a, f) => a.reduce((t, x) => t + f(x), 0);
const kgExcel = suma([...excel.values()].filter((e) => e.kg > 0.5), (e) => e.kg);
const kgSalidas = suma(salidasAlmacenado, (x) => x.kg);

const lineas = [
  ['Excel · filtro ALMACENADO (suma de PESO NETO, como lo ve el supervisor)', tm(sumaFiltro)],
  ['  − filas SALIDA marcadas ALMACENADO (el filtro las suma; son producto que salió) ×2', -tm(2 * kgSalidas)],
  ['  + ajuste de posiciones que quedan en negativo (no se cuentan)', tm(kgExcel - sumaFiltro + 2 * kgSalidas)],
  ['Excel · stock real en cámara (ingresos − salidas, por pallet)', tm(kgExcel)],
  ['  − pallets que el ERP no tiene (ingresos no registrados en el ERP)', -tm(suma(faltan, (x) => x.kg))],
  ['  + pallets que el ERP aún tiene y el Excel ya no (salidas no registradas)', tm(suma(sobran, (x) => x.kg))],
  ['  ± mismo pallet con otro peso', tm(suma(distinto, (x) => x.kgErp - x.kg))],
  ['ERP · stock físico (Disponibilidad › Stock físico)', tm(kgErp)],
];
console.log(`\nÚltima fecha de producción en el Excel: ${ultimaFecha}\n`);
for (const [t, v] of lineas) console.log(`  ${t.padEnd(86)} ${v.toLocaleString('es-PE', { minimumFractionDigits: 1 }).padStart(9)} TM`);
console.log(`\n  faltan en el ERP: ${faltan.length} · sobran en el ERP: ${sobran.length} · peso distinto: ${distinto.length} · salidas marcadas ALMACENADO: ${salidasAlmacenado.length}`);

/* ---------------- El informe ---------------- */
const inf = new ExcelJS.Workbook();
const hoja = (nombre, cols, filas) => {
  const h = inf.addWorksheet(nombre, { views: [{ state: 'frozen', ySplit: 1 }] });
  h.columns = cols.map(([header, key, width = 16]) => ({ header, key, width }));
  h.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  h.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2E59' } };
  filas.forEach((f) => h.addRow(f));
  return h;
};
hoja('Resumen', [['Concepto', 't', 90], ['TM', 'v', 12]], [
  { t: `Excel: ${path.basename(ARCHIVO)} · última fecha de producción ${ultimaFecha}`, v: null },
  { t: `ERP: existencias al ${new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' })}`, v: null },
  ...lineas.map(([t, v]) => ({ t, v })),
]);
hoja('Faltan en el ERP', [['N°PALLET', 'pallet', 20], ['CODIGO', 'codigo', 9], ['ALMACEN', 'almacen'], ['CAMARA', 'camara'],
  ['F. PRODUCCIÓN', 'fecha', 13], ['CAMPAÑA', 'campana', 9], ['RESUMEN OBS', 'obs', 11], ['PESO NETO (kg)', 'kg', 13]],
  faltan.sort((a, b) => a.fecha.localeCompare(b.fecha)));
hoja('Sobran en el ERP', [['N°PALLET', 'pallet', 20], ['CODIGO', 'codigo', 9], ['ALMACÉN EN EL ERP', 'almacen', 28], ['PESO EN EL ERP (kg)', 'kg', 16]], sobran);
hoja('Peso distinto', [['N°PALLET', 'pallet', 20], ['CODIGO', 'codigo', 9], ['PESO EXCEL (kg)', 'kg', 14], ['PESO ERP (kg)', 'kgErp', 14]], distinto);
hoja('Salidas marcadas ALMACENADO', [['FILA DEL EXCEL', 'fila', 12], ['N°PALLET', 'pallet', 20], ['CODIGO', 'codigo', 9], ['ALMACEN', 'almacen'],
  ['MOTIVO SALIDA', 'motivo', 20], ['PESO NETO (kg)', 'kg', 13]], salidasAlmacenado);
const rutaInforme = path.join(SALIDA, 'Conciliación stock ERP vs Excel.xlsx');
await inf.xlsx.writeFile(rutaInforme);

/* ---------------- Los ingresos pendientes, en la plantilla ---------------- */
const pend = new ExcelJS.Workbook();
const hi = pend.addWorksheet('Ingresos', { views: [{ state: 'frozen', ySplit: 1 }] });
hi.addRow(A_PLANTILLA);
hi.getRow(1).font = { bold: true };
for (const e of faltan) {
  //  Un pallet con varias filas de ingreso (carga masiva por día) entra como uno: TOTAL y PESO NETO sumados.
  const primera = e.filas[0];
  if (!primera) continue;
  hi.addRow(A_PLANTILLA.map((t) => {
    if (t === 'TOTAL') return suma(e.filas, (f) => numero(f.getCell(C.total)));
    if (t === 'PESO NETO') return e.kg;
    if (t === 'FECHA DE PRODUCCIÓN') return e.fecha.split('-').reverse().join('/');
    const col = titulos[t];
    return col ? (texto(primera.getCell(col)) || null) : null;
  }));
}
A_PLANTILLA.forEach((_, i) => { hi.getColumn(i + 1).width = 16; });
const rutaPendientes = path.join(SALIDA, 'Ingresos pendientes - para importar.xlsx');
await pend.xlsx.writeFile(rutaPendientes);

console.log(`\nInforme:            ${path.resolve(rutaInforme)}`);
console.log(`Para importar:      ${path.resolve(rutaPendientes)} (${hi.rowCount - 1} pallets)`);
