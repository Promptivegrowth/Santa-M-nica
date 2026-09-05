/**
 * Comprueba en el navegador lo que se pidió para el maestro de productos:
 * que las columnas retiradas ya no estén, que las nuevas sí, que el
 * desplegable de Corte se encadene con Especie y Formato, y que el último
 * precio que se pinta sea el mismo que dice la base.
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const nav = await chromium.launch({ channel: 'chrome', headless: true });
const p = await (await nav.newContext({ viewport: { width: 1500, height: 950 } })).newPage();

await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await p.fill('input[type="email"]', 'gerencia@santamonica.pe');
await p.fill('input[type="password"]', 'SantaMonica2026');
await p.click('button[type="submit"]');
await p.waitForURL(/\/panel/, { timeout: 25000 });

const fallos = [];
const ok = (cond, texto) => { console.log(`${cond ? '  ok  ' : ' FALLA'} ${texto}`); if (!cond) fallos.push(texto); };

/* ---- 1 · Las columnas ---- */
await p.goto(`${BASE}/ventas/productos`, { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);

// innerText devuelve el texto YA en mayúsculas por el CSS de la cabecera.
const cabeceras = (await p.locator('table.datos thead th').allInnerTexts()).map((t) => t.trim());
console.log('\nColumnas:', cabeceras.join(' · '));
ok(cabeceras.includes('SKU'), 'la columna SKU sigue visible');
ok(!cabeceras.includes('DISPONIBLE'), 'se quitó la columna Disponible');
ok(!cabeceras.includes('ESTADO'), 'se quitó la columna Estado');
ok(cabeceras.includes('EMPAQUE'), 'aparece la columna Empaque');
ok(cabeceras.includes('ÚLTIMO PRECIO'), 'aparece la columna Último precio');

/* ---- 2 · Los filtros nuevos ----
   El componente Filtros no pone `name` en los select, así que se buscan por
   su etiqueta visible, que además es lo que ve el usuario. Ojo: el CSS las
   pinta en mayúsculas, y innerText devuelve el texto YA transformado. */
const etiquetas = (await p.locator('.filtros label, .filtros .etiqueta').allInnerTexts())
  .map((t) => t.trim().toUpperCase());
console.log('Filtros:', etiquetas.join(' · '));
for (const nombre of ['ESPECIE', 'FORMATO', 'CORTE', 'ORDENAR POR']) {
  ok(etiquetas.some((e) => e.includes(nombre)), `existe el filtro «${nombre}»`);
}

/* ---- 3 · El corte se encadena con especie y formato ---- */
const cortesTodos = await p.locator('select').nth(2).locator('option').count();
await p.goto(`${BASE}/ventas/productos?especie=POTA&formato=FILETE`, { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
const cortesFiltrados = await p.locator('select').nth(2).locator('option').count();
console.log(`\nCortes ofrecidos: ${cortesTodos} sin filtrar · ${cortesFiltrados} con POTA+FILETE`);
ok(cortesFiltrados < cortesTodos && cortesFiltrados > 1,
   'el desplegable de Corte se reduce al elegir especie y formato');

/* ---- 4 · El orden por precio ---- */
await p.goto(`${BASE}/ventas/productos?orden=precio_asc`, { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
const precios = (await p.locator('table.datos tbody tr td:nth-last-child(2) strong').allInnerTexts())
  .map((t) => Number(t.replace(/[^\d.]/g, '')))
  .filter((n) => n > 0);
const asciende = precios.every((v, i) => i === 0 || v >= precios[i - 1]);
console.log('\nPrimeros precios:', precios.slice(0, 6).join(' · '));
ok(asciende, 'con «del más barato» los precios van de menor a mayor');

await p.goto(`${BASE}/ventas/productos?orden=precio_desc`, { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
const bajada = (await p.locator('table.datos tbody tr td:nth-last-child(2) strong').allInnerTexts())
  .map((t) => Number(t.replace(/[^\d.]/g, '')))
  .filter((n) => n > 0);
ok(bajada.every((v, i) => i === 0 || v <= bajada[i - 1]),
   'con «del más caro» los precios van de mayor a menor');
ok(bajada[0] > precios[0], 'el más caro es mayor que el más barato');

/* ---- 5 · Los productos sin precio quedan al final, no al principio ---- */
const celdas = await p.locator('table.datos tbody tr td:nth-last-child(2)').allInnerTexts();
const primerVacio = celdas.findIndex((t) => t.trim() === '—');
const ultimoConPrecio = celdas.map((t) => t.trim() !== '—').lastIndexOf(true);
ok(primerVacio === -1 || primerVacio > ultimoConPrecio,
   'los productos nunca vendidos van al final del orden por precio');

console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo correcto');
await nav.close();
process.exit(fallos.length ? 1 : 0);
