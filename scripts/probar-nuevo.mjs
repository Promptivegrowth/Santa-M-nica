/**
 * ============================================================================
 *  PRUEBAS DE LO NUEVO · calendario, valorizado y movimientos del día
 * ============================================================================
 *  Se entra a la aplicación de verdad, con un navegador de verdad, y se
 *  comprueba lo que ve un usuario: que el calendario pinta, que el día se
 *  puede elegir con el ratón y con el teclado, que los filtros filtran y que
 *  los archivos que se descargan traen lo que había en pantalla.
 *
 *  Los archivos no se dan por buenos porque el navegador los baje: se abren y
 *  se mira que tengan tamaño, cabecera correcta y el nombre esperado.
 * ============================================================================
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import './db.mjs';

const BASE = 'http://localhost:3000';
let ok = 0, fallo = 0;
const errores = [];

function comprobar(nombre, condicion, detalle = '') {
  if (condicion) { ok++; console.log(`   OK  ${nombre}`); }
  else {
    fallo++;
    errores.push(`${nombre}${detalle ? ' — ' + detalle : ''}`);
    console.log(`   ..  ${nombre}${detalle ? '  (' + detalle + ')' : ''}`);
  }
}

if (!existsSync('capturas')) mkdirSync('capturas');

const nav = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await nav.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
const p = await ctx.newPage();

const fallosJs = [];
p.on('pageerror', (e) => fallosJs.push(e.message));

async function entrar() {
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', 'gerencia@santamonica.pe');
  await p.fill('input[type="password"]', 'SantaMonica2026');
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/panel/, { timeout: 30000 });
}

/** Pulsa un botón de descarga y devuelve {nombre, bytes, tipo}. */
async function bajar(texto) {
  const espera = p.waitForEvent('download', { timeout: 40000 }).catch(() => null);
  await p.locator('button', { hasText: texto }).first().click();
  const d = await espera;
  if (!d) return null;
  const ruta = await d.path();
  return {
    nombre: d.suggestedFilename(),
    bytes: ruta ? readFileSync(ruta).length : 0,
    cabecera: ruta ? readFileSync(ruta).subarray(0, 4) : Buffer.alloc(0),
  };
}

await entrar();

/* ========================================================================
   1 · CALENDARIO DE EMBARQUES
   ======================================================================== */
console.log('\n== CALENDARIO DE EMBARQUES =======================================\n');

await p.goto(`${BASE}/logistica/planificador`, { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);

comprobar('Se dibuja una cuadrícula de calendario, no una lista',
  (await p.locator('table.cal-rejilla').count()) === 1);
comprobar('Tiene las siete columnas de la semana',
  (await p.locator('table.cal-rejilla thead th').count()) === 7);
comprobar('La primera columna es lunes',
  // innerText devuelve lo que se VE, y el CSS lo pone en mayusculas.
  (await p.locator('table.cal-rejilla thead th').first().innerText())
    .trim().toLowerCase().startsWith('lun'));

const celdas = await p.locator('.cal-dia').count();
comprobar('Hay entre 28 y 42 celdas de día', celdas >= 28 && celdas <= 42, `${celdas} celdas`);

const conCarga = await p.locator('.cal-dia:has(.cal-ficha)').count();
comprobar('Hay días con embarques pintados', conCarga > 0, `${conCarga} días con carga`);

const fichas = await p.locator('.cal-ficha').count();
comprobar('Las fichas muestran destino y toneladas', fichas > 0, `${fichas} fichas`);

comprobar('El día de hoy está marcado',
  (await p.locator('.cal-dia[data-hoy="si"]').count()) === 1);
comprobar('Los domingos están diferenciados',
  (await p.locator('.cal-dia[data-domingo="si"]').count()) >= 4);
comprobar('Hay leyenda de estados',
  (await p.locator('.cal-leyenda-item').count()) >= 4);

/* --- Interacción: elegir un día con el ratón --- */
const conCargaPrimero = p.locator('.cal-dia:has(.cal-ficha)').first();
await conCargaPrimero.click();
await p.waitForTimeout(400);
comprobar('Al pulsar un día se marca como elegido',
  (await conCargaPrimero.getAttribute('data-elegido')) === 'si');

const tarjetas = await p.locator('.cal-tarjeta').count();
comprobar('El panel lateral lista los embarques de ese día', tarjetas > 0, `${tarjetas} tarjetas`);

const detalle = await p.locator('.cal-detalle').innerText();
comprobar('Cada embarque muestra su carga en TM', /TM/.test(detalle));
comprobar('Y su estado', /PLANIFICADO|CONFIRMADO|DESPACHADO|EN PREPARACIÓN|CANCELADO/i.test(detalle));
comprobar('El resumen del día suma bultos', /bultos/i.test(detalle));

/* --- Interacción: moverse con el teclado --- */
const antes = await p.locator('.cal-dia[data-elegido="si"]').getAttribute('aria-label');
await p.locator('.cal-dia[data-elegido="si"]').press('ArrowRight');
await p.waitForTimeout(300);
const despues = await p.locator('.cal-dia[data-elegido="si"]').getAttribute('aria-label');
comprobar('La flecha derecha mueve al día siguiente', antes !== despues, `${antes} -> ${despues}`);

await p.locator('.cal-dia[data-elegido="si"]').press('ArrowDown');
await p.waitForTimeout(300);
const semana = await p.locator('.cal-dia[data-elegido="si"]').getAttribute('aria-label');
comprobar('La flecha abajo salta una semana', semana !== despues);

/* --- Navegación de mes --- */
const mesActual = await p.locator('.cal-mes strong').innerText();
await p.locator('a[aria-label="Mes siguiente"]').click();
await p.waitForTimeout(1800);
const mesSiguiente = await p.locator('.cal-mes strong').innerText();
comprobar('El botón de mes siguiente cambia de mes', mesActual !== mesSiguiente,
  `${mesActual} -> ${mesSiguiente}`);
comprobar('Y la dirección web lo refleja', /mes=\d{4}-\d{2}/.test(p.url()), p.url());

await p.locator('a[aria-label="Mes anterior"]').click();
await p.waitForTimeout(1800);
comprobar('El botón de mes anterior vuelve',
  (await p.locator('.cal-mes strong').innerText()) === mesActual);

await p.screenshot({ path: 'capturas/nuevo-calendario.png' });

/* --- El mismo calendario en un móvil --- */
const movil = await ctx.newPage();
await movil.setViewportSize({ width: 390, height: 844 });
await movil.goto(`${BASE}/logistica/planificador`, { waitUntil: 'networkidle' });
await movil.waitForTimeout(1500);
const anchoCuerpo = await movil.evaluate(() => document.body.scrollWidth);
comprobar('En móvil no hay desbordamiento horizontal', anchoCuerpo <= 400, `${anchoCuerpo} px`);
comprobar('En móvil siguen viéndose los embarques',
  (await movil.locator('.cal-ficha').count()) > 0);
await movil.screenshot({ path: 'capturas/nuevo-calendario-movil.png', fullPage: true });
await movil.close();

/* ========================================================================
   2 · INVENTARIO VALORIZADO
   ======================================================================== */
console.log('\n== INVENTARIO VALORIZADO =========================================\n');

await p.goto(`${BASE}/almacenes/valorizado`, { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);

comprobar('Tiene botón de Excel',
  (await p.locator('button', { hasText: /^Excel/ }).count()) > 0);
comprobar('Tiene botón de PDF',
  (await p.locator('button', { hasText: /^PDF$/ }).count()) > 0);

const camposValorizado = await p.locator('.filtros input, .filtros select').count();
comprobar('Tiene filtros de búsqueda', camposValorizado >= 5, `${camposValorizado} campos`);
comprobar('Incluye rango de fechas',
  (await p.locator('.filtros input[type="date"]').count()) === 2);
comprobar('Muestra el detalle por lote',
  (await p.locator('table.datos tbody tr').count()) > 0);

/* --- Los KPI tienen que responder a los filtros --- */
const valorSinFiltro = await p.locator('.kpi').first().innerText();
await p.goto(`${BASE}/almacenes/valorizado?rango=%3E24`, { waitUntil: 'networkidle' });
await p.waitForTimeout(1800);
const valorFiltrado = await p.locator('.kpi').first().innerText();
comprobar('Al filtrar por antigüedad cambian los totales de arriba',
  valorSinFiltro !== valorFiltrado,
  `${valorSinFiltro.split('\n').pop()} vs ${valorFiltrado.split('\n').pop()}`);

const filasFiltradas = await p.locator('table.datos tbody tr').count();
const rangosDistintos = await p.locator('table.datos tbody tr td:nth-child(7)').allInnerTexts();
comprobar('Y la tabla solo trae ese rango',
  filasFiltradas > 0 && rangosDistintos.every((r) => r.trim() === '>24'),
  `${filasFiltradas} filas`);

/* --- Descargas: con el filtro puesto --- */
const excelVal = await bajar('Excel');
comprobar('El Excel del valorizado se descarga', !!excelVal, excelVal?.nombre ?? 'sin descarga');
comprobar('Y es un archivo de Excel de verdad',
  excelVal?.bytes > 5000 && excelVal?.cabecera.toString('hex').startsWith('504b'),
  `${excelVal?.bytes} bytes`);

const pdfVal = await bajar('PDF');
comprobar('El PDF del valorizado se descarga', !!pdfVal, pdfVal?.nombre ?? 'sin descarga');
comprobar('Y es un PDF de verdad',
  pdfVal?.bytes > 3000 && pdfVal?.cabecera.toString('latin1') === '%PDF',
  `${pdfVal?.bytes} bytes`);

await p.screenshot({ path: 'capturas/nuevo-valorizado.png' });

/* ========================================================================
   3 · MOVIMIENTOS DEL DÍA
   ======================================================================== */
console.log('\n== MOVIMIENTOS DEL DÍA ===========================================\n');

await p.goto(`${BASE}/almacenes/movimientos`, { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);

comprobar('La sección existe y carga',
  (await p.locator('h1').first().innerText()).toLowerCase().includes('movimientos'));
comprobar('Está en el menú de Almacenes',
  (await p.locator('nav a[href="/almacenes/movimientos"]').count()) > 0);

const kpisMov = await p.locator('.kpi').count();
comprobar('Muestra los indicadores del período', kpisMov === 4, `${kpisMov} indicadores`);

// Igual que arriba: se compara sin distinguir mayusculas de minusculas.
const textoMov = (await p.locator('body').innerText()).toLowerCase();
comprobar('Separa lo que entró de lo que salió',
  textoMov.includes('entró') && textoMov.includes('salió'));
comprobar('Y da el saldo del período', /saldo del per[ií]odo/.test(textoMov));

comprobar('Tiene filtro de rango de fechas',
  (await p.locator('.filtros input[type="date"]').count()) === 2);
comprobar('Tiene filtro por tipo de movimiento',
  (await p.locator('.filtros select').count()) >= 2);
comprobar('Tiene caja de búsqueda',
  // El componente de filtros usa <input type="search">, no "text".
  (await p.locator('.filtros input[type="search"]').count()) >= 1);

/* --- Un rango que sí tiene datos --- */
await p.goto(`${BASE}/almacenes/movimientos?desde=2026-01-01&hasta=2026-12-31`, { waitUntil: 'networkidle' });
await p.waitForTimeout(2000);

const filasMov = await p.locator('table.datos').last().locator('tbody tr').count();
comprobar('Con un rango amplio salen movimientos', filasMov > 0, `${filasMov} filas`);

const detalleMov = (await p.locator('body').innerText()).toLowerCase();
comprobar('El detalle indica quién registró cada movimiento', /registró/.test(detalleMov));
comprobar('Y el documento de respaldo', /documento/.test(detalleMov));
comprobar('Hay desglose por tipo de movimiento', /por tipo de movimiento/.test(detalleMov));
comprobar('El signo distingue entradas de salidas',
  /\+[\d.,]+ kg/.test(detalleMov) && /−[\d.,]+ kg/.test(detalleMov));

/* --- El filtro por tipo tiene que recortar de verdad --- */
await p.goto(`${BASE}/almacenes/movimientos?desde=2026-01-01&hasta=2026-12-31&tipo=salida_despacho`,
  { waitUntil: 'networkidle' });
await p.waitForTimeout(2000);
const tipos = await p.locator('table.datos').last()
  .locator('tbody tr td:nth-child(3)').allInnerTexts();
comprobar('Al filtrar por tipo, solo sale ese tipo',
  tipos.length > 0 && tipos.every((t) => /despacho/i.test(t)),
  `${tipos.length} filas, ejemplo «${tipos[0]?.trim()}»`);

/* --- Descargas --- */
const excelMov = await bajar('Excel');
comprobar('El Excel de movimientos se descarga', !!excelMov, excelMov?.nombre ?? 'sin descarga');
comprobar('Y es un archivo de Excel de verdad',
  excelMov?.bytes > 5000 && excelMov?.cabecera.toString('hex').startsWith('504b'),
  `${excelMov?.bytes} bytes`);

const pdfMov = await bajar('PDF');
comprobar('El PDF de movimientos se descarga', !!pdfMov, pdfMov?.nombre ?? 'sin descarga');
comprobar('Y es un PDF de verdad',
  pdfMov?.bytes > 3000 && pdfMov?.cabecera.toString('latin1') === '%PDF',
  `${pdfMov?.bytes} bytes`);

/* --- Un día sin movimientos tiene que explicarse, no quedarse mudo --- */
await p.goto(`${BASE}/almacenes/movimientos?desde=1999-01-01&hasta=1999-01-02`,
  { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
const vacio = await p.locator('body').innerText();
comprobar('Un rango sin datos lo dice y ofrece el último día con actividad',
  /No hubo movimientos/i.test(vacio) && /última|último/i.test(vacio));

await p.screenshot({ path: 'capturas/nuevo-movimientos.png' });

/* ========================================================================
   4 · LA API DIRECTAMENTE
   ======================================================================== */
console.log('\n== LA API DE REPORTES ============================================\n');

for (const [tipo, params] of [
  ['movimientos', 'desde=2026-01-01&hasta=2026-12-31'],
  ['valorizado', 'rango=%3E24'],
  ['existencias', ''],
  ['kardex', 'tipo=ingreso'],
]) {
  for (const formato of ['excel', 'pdf']) {
    const r = await p.request.get(`${BASE}/api/reportes/${tipo}?${params}&formato=${formato}`);
    const cuerpo = await r.body();
    const esperado = formato === 'pdf' ? 'application/pdf' : 'spreadsheetml';
    comprobar(
      `/api/reportes/${tipo} en ${formato.toUpperCase()}`,
      r.ok() && (r.headers()['content-type'] ?? '').includes(esperado) && cuerpo.length > 2000,
      `HTTP ${r.status()}, ${cuerpo.length} bytes`
    );
  }
}

/*
 * LO IMPORTANTE: que el filtro llegue al archivo.
 *
 * Que el PDF se descargue no prueba nada. Un reporte que ignora los filtros
 * se descarga igual de bien, y el usuario se lleva a una reunión un archivo
 * con cifras distintas de las que enseñó en pantalla. Aquí se compara el
 * tamaño del reporte filtrado contra el completo: si el filtro no se está
 * aplicando, los dos pesan lo mismo.
 */
for (const [tipo, filtro] of [
  ['valorizado', 'rango=%3E24'],
  ['movimientos', 'desde=2026-08-24&hasta=2026-08-31'],
  ['existencias', 'rango=%3E24'],
]) {
  const completo = await p.request.get(`${BASE}/api/reportes/${tipo}?formato=pdf`);
  const acotado = await p.request.get(`${BASE}/api/reportes/${tipo}?${filtro}&formato=pdf`);
  const bytesCompleto = (await completo.body()).length;
  const bytesAcotado = (await acotado.body()).length;
  comprobar(
    `El filtro llega al PDF de ${tipo}`,
    bytesAcotado < bytesCompleto,
    `filtrado ${bytesAcotado} B vs completo ${bytesCompleto} B`
  );

  // Y lo mismo con el Excel, que es el que de verdad se reenvía por correo.
  const xlCompleto = (await (await p.request.get(`${BASE}/api/reportes/${tipo}?formato=excel`)).body()).length;
  const xlAcotado = (await (await p.request.get(`${BASE}/api/reportes/${tipo}?${filtro}&formato=excel`)).body()).length;
  comprobar(
    `El filtro llega al Excel de ${tipo}`,
    xlAcotado < xlCompleto,
    `filtrado ${xlAcotado} B vs completo ${xlCompleto} B`
  );
}

// Un reporte inexistente tiene que decir que no existe, no reventar
const inventado = await p.request.get(`${BASE}/api/reportes/no_existe`);
comprobar('Un reporte inexistente responde 404 con explicación',
  inventado.status() === 404 && (await inventado.json()).error?.includes('no existe'));

comprobar('Ningún error de JavaScript en todo el recorrido', fallosJs.length === 0,
  fallosJs.slice(0, 2).join(' | '));

await nav.close();

console.log('\n==================================================================');
console.log(`  RESULTADO: ${ok} pasaron · ${fallo} fallaron`);
console.log('==================================================================');
if (errores.length) {
  console.log('\n  Revisar:');
  errores.forEach((e) => console.log(`   .. ${e}`));
}
console.log('');
process.exit(fallo > 0 ? 1 : 0);
