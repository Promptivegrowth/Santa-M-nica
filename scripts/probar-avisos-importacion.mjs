/**
 * ============================================================================
 *  PRUEBA · LA PANTALLA DE IMPORTACIÓN DICE SI SE CARGÓ O QUÉ FALLÓ (13/11)
 * ============================================================================
 *  Pedido de Gerencia: «si el proceso está cargado, o si ha habido un error,
 *  que lo muestre amablemente: el tipo y otras informaciones». En el
 *  navegador, como Almacén:
 *
 *    1. Un archivo que no es .xlsx → tarjeta «no se pudo abrir como Excel»,
 *       con qué hacer, el nombre, el tamaño y la hora.
 *    2. Un archivo más grande de lo permitido (su base completa) → tipo
 *       «demasiado grande», y no se sube nada.
 *    3. Un Excel sin los encabezados de la plantilla → tipo «formato».
 *    4. Un Excel con encabezados y sin filas → tipo «sin datos».
 *    5. Un corte de red al subir → tipo «se perdió la conexión».
 *    6. Una plantilla con filas buenas y malas → la revisión abre con el
 *       resumen «Todavía no se cargó: hay errores» y los TIPOS de error por
 *       columna, con los números de fila.
 *    7. La lista de importaciones muestra la columna «Resultado».
 *    8. resultadoCarga() da la etiqueta correcta para cada caso.
 *
 *  Base compartida con producción: no se registra nada (no se valida). La
 *  importación de prueba y sus filas se borran en `finally`.
 *
 *  Uso:  npm run dev   (en otra terminal)
 *        node scripts/probar-avisos-importacion.mjs
 * ============================================================================
 */
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ejecutarSQL } from './db.mjs';
import { resultadoCarga } from '../src/lib/falloCarga.ts';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const CLAVE = process.env.CLAVE_DEMO ?? '';
const consultar = async (sql) => { const r = await ejecutarSQL(sql); return Array.isArray(r) ? r : []; };
const fallos = [];
const ok = (cond, texto, detalle = '') => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${texto}${detalle ? ' · ' + detalle : ''}`);
  if (!cond) fallos.push(texto);
};
const CARPETA = join(tmpdir(), 'probar-avisos-importacion');
mkdirSync(CARPETA, { recursive: true });
const SELLO = String(Date.now()).slice(-5);

const [prev] = await consultar(`select coalesce(max(id),0) imp from importaciones_excel`);

/* ---- 8 · la etiqueta de la lista, sin navegador ---- */
console.log('\n── 8 · resultadoCarga ──');
ok(resultadoCarga(['registrada', 'programada', 'descartada']).texto === 'Cargada', 'todo registrado → «Cargada»');
ok(resultadoCarga(['registrada', 'fallida']).texto === 'Parcial · 1 con error', 'una registrada y una fallida → «Parcial · 1 con error»');
ok(resultadoCarga(['con_error', 'valida']).tono === 'critico', 'nada registrado y con errores → crítico');
ok(resultadoCarga(['valida', 'valida']).texto === 'Sin errores · falta registrar', 'todo bien sin registrar → «falta registrar»');
ok(resultadoCarga(['procesando', 'registrada']).texto === 'Cargando…', 'a mitad de registrar → «Cargando…»');

const nav = await chromium.launch({ channel: 'chrome', headless: true });
const erroresPagina = [];
let creadas = [];
try {
  const ctx = await nav.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => erroresPagina.push(e.message));
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', 'almacen@santamonica.pe');
  await p.fill('input[type="password"]', CLAVE);
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/panel/, { timeout: 60000 });
  await p.goto(`${BASE}/almacenes/ingresos/importar`, { waitUntil: 'networkidle' });

  const tarjeta = p.locator('[data-bloque="subir-archivo"] [data-aviso="carga"]');
  const subir = async (ruta, { clic = true } = {}) => {
    await p.setInputFiles('input[type="file"][name="archivo"]', ruta);
    if (clic) await p.click('[data-accion="subir-archivo"]');
    await tarjeta.waitFor({ timeout: 60000 });
    return { tipo: await tarjeta.getAttribute('data-tipo'), texto: (await tarjeta.innerText()).replace(/\s+/g, ' ') };
  };

  /* ---- 1 · no es .xlsx ---- */
  console.log('\n── 1 · archivo que no es Excel ──');
  const csv = join(CARPETA, `ingresos-${SELLO}.csv`);
  writeFileSync(csv, 'N°PALLET;PESO NETO\nX;1\n');
  let r = await subir(csv, { clic: false });
  ok(r.tipo === 'archivo', 'tipo «archivo»', r.tipo);
  ok(/no se pudo abrir como Excel/.test(r.texto) && /es un archivo CSV/.test(r.texto), 'el título y qué es el archivo', r.texto.slice(0, 120));
  ok(/Qué hacer:.*Guardar como/.test(r.texto), 'dice qué hacer');
  ok(new RegExp(`Archivo: ingresos-${SELLO}\\.csv · Tamaño: \\d+ KB · Hora: \\d\\d:\\d\\d`).test(r.texto), 'y los datos del intento: archivo, tamaño, hora', r.texto.slice(-80));
  ok(await p.locator('[data-accion="subir-archivo"]').isDisabled(), 'y no deja subirlo');

  /* ---- 2 · demasiado grande ---- */
  console.log('\n── 2 · archivo demasiado grande ──');
  const grande = join(CARPETA, `base-completa-${SELLO}.xlsx`);
  writeFileSync(grande, Buffer.alloc(6 * 1024 * 1024, 1));
  r = await subir(grande, { clic: false });
  ok(r.tipo === 'tamano', 'tipo «tamaño»', r.tipo);
  ok(/demasiado grande/.test(r.texto) && /6\.0 MB/.test(r.texto) && /parece la base completa/.test(r.texto), 'dice cuánto pesa y que parece la base completa', r.texto.slice(0, 160));

  /* ---- 3 · sin encabezados de la plantilla ---- */
  console.log('\n── 3 · Excel sin el formato de la plantilla ──');
  const otro = new ExcelJS.Workbook();
  otro.addWorksheet('Hoja1').addRow(['CLIENTE', 'IMPORTE']).commit();
  otro.getWorksheet('Hoja1').addRow(['ACME', 10]);
  const sinFormato = join(CARPETA, `otro-${SELLO}.xlsx`);
  await otro.xlsx.writeFile(sinFormato);
  r = await subir(sinFormato);
  ok(r.tipo === 'formato', 'tipo «formato»', r.tipo);
  ok(/no tiene el formato de la plantilla/.test(r.texto) && /Descargue la plantilla/.test(r.texto), 'título y qué hacer', r.texto.slice(0, 140));

  /* ---- 4 · plantilla sin filas ---- */
  console.log('\n── 4 · plantilla sin filas ──');
  const [descarga] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), p.click('[data-accion="descargar-plantilla"]')]);
  const plantilla = join(CARPETA, `plantilla-${SELLO}.xlsx`);
  await descarga.saveAs(plantilla);
  r = await subir(plantilla);
  ok(r.tipo === 'vacio', 'tipo «sin datos»', r.tipo);
  ok(/no trae filas con datos/.test(r.texto), 'lo dice en palabras', r.texto.slice(0, 120));

  /* ---- 5 · corte de red ---- */
  console.log('\n── 5 · corte de red al subir ──');
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.readFile(plantilla);
  const hoja = libro.getWorksheet('Ingresos');
  const col = {};
  hoja.getRow(4).eachCell((c, k) => { col[String(c.value).replace(' *', '')] = k; });
  const fila = (n, v) => { for (const [t, x] of Object.entries(v)) hoja.getCell(5 + n, col[t]).value = x; };
  const [prod] = await consultar(`select s.codigo, p.descripcion pres from sku_presentaciones sp join skus s on s.id = sp.sku_id
    join presentaciones p on p.id = sp.presentacion_id where sp.activo and s.activo order by s.codigo, sp.id limit 1`);
  const base = { 'FECHA DE PRODUCCIÓN': '01/11/2026', 'CODIGO': prod.codigo, 'PRESENTACION': prod.pres, 'TOTAL': 10, 'PESO NETO': 200,
    'ALMACEN': 'SANTA MONICA', 'CAMARA DE ALMACENAMIENTO': 'CAMARA N° 01' };
  fila(1, { ...base, 'N°PALLET': `PRB AV ${SELLO} 01` });
  fila(2, { ...base, 'N°PALLET': `PRB AV ${SELLO} 02`, 'PESO NETO': 'mucho' });
  fila(3, { ...base, 'N°PALLET': `PRB AV ${SELLO} 03`, 'PESO NETO': 0, 'TOTAL': 0 });
  fila(4, { ...base, 'N°PALLET': `PRB AV ${SELLO} 01` });
  const conFilas = join(CARPETA, `ingresos-${SELLO}.xlsx`);
  await libro.xlsx.writeFile(conFilas);
  await p.route('**/almacenes/ingresos/importar', (x) => (x.request().method() === 'POST' ? x.abort('internetdisconnected') : x.continue()));
  r = await subir(conFilas);
  ok(r.tipo === 'conexion', 'tipo «conexión»', r.tipo);
  ok(/Se perdió la conexión/.test(r.texto) && /aparece en la lista de abajo/.test(r.texto), 'y qué mirar antes de repetir', r.texto.slice(0, 140));
  await p.unroute('**/almacenes/ingresos/importar');
  ok((await consultar(`select 1 from importaciones_excel where id > ${prev.imp} and archivo = 'ingresos-${SELLO}.xlsx'`)).length === 0, 'y no se guardó ninguna importación');

  /* ---- 6 · subida con errores: el resumen ---- */
  console.log('\n── 6 · revisión con el resumen de la carga ──');
  await p.click('[data-accion="subir-archivo"]');
  await p.waitForURL(/\/almacenes\/ingresos\/importar\/\d+/, { timeout: 90000 });
  const resumen = p.locator('[data-resumen="carga"]');
  await resumen.waitFor({ timeout: 30000 });
  const tr = (await resumen.innerText()).replace(/\s+/g, ' ');
  creadas = (await consultar(`select id from importaciones_excel where id > ${prev.imp} and archivo = 'ingresos-${SELLO}.xlsx'`)).map((x) => x.id);
  ok(await resumen.getAttribute('data-tono') === 'critico', 'tono crítico: nada entró', await resumen.getAttribute('data-tono'));
  ok(/Todavía no se cargó: hay errores/.test(tr) && /Archivo leído: 4 filas/.test(tr), 'dice que no se cargó y cuántas filas leyó', tr.slice(0, 120));
  ok(/Tipos de error:/.test(tr) && /PESO NETO · 2 filas \(filas 7, 8\)/.test(tr), 'agrupa por columna con las filas del Excel', tr.slice(0, 400));
  ok(/N°PALLET · 1 fila \(fila 9\)/.test(tr), 'el pallet repetido, en su propio tipo');
  ok(/Ej\.:/.test(tr), 'con un ejemplo del motivo');

  /* ---- 7 · la lista ---- */
  console.log('\n── 7 · lista de importaciones ──');
  await p.goto(`${BASE}/almacenes/ingresos/importar`, { waitUntil: 'networkidle' });
  const celda = p.locator(`tr[data-importacion="${creadas[0]}"] td[data-resultado]`);
  ok(/No cargada · 3 con error/i.test(await celda.innerText().catch(() => '')), 'columna «Resultado» con el estado real', await celda.innerText().catch(() => '—'));

  ok(erroresPagina.length === 0, 'sin errores de JavaScript en la página', erroresPagina.join(' | ').slice(0, 200));
} finally {
  if (creadas.length) {
    await ejecutarSQL(`delete from importaciones_excel_filas where importacion_id in (${creadas.join(',')});
                       delete from importaciones_excel where id in (${creadas.join(',')});`);
  }
  const [queda] = await consultar(`select count(*)::int n from importaciones_excel where id > ${prev.imp} and archivo like '%${SELLO}%'`);
  console.log(`\nLimpieza: ${queda.n === 0 ? 'no quedó nada de la prueba' : `QUEDARON ${queda.n} importaciones`}`);
  await nav.close();
}

console.log(fallos.length ? `\n✗ ${fallos.length} falla(s):\n - ${fallos.join('\n - ')}` : '\n✓ Todo bien');
process.exit(fallos.length ? 1 : 0);
