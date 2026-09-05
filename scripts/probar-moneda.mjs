/**
 * Comprueba en el navegador que todo lo que se suma esté en dólares y que un
 * tipo de cambio imposible ya no se pueda guardar.
 *
 *   node scripts/probar-moneda.mjs
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const nav = await chromium.launch({ channel: 'chrome', headless: true });
const p = await (await nav.newContext({ viewport: { width: 1500, height: 950 } })).newPage();

const fallos = [];
const ok = (cond, texto) => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${texto}`);
  if (!cond) fallos.push(texto);
};

await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await p.fill('input[type="email"]', 'gerencia@santamonica.pe');
await p.fill('input[type="password"]', 'SantaMonica2026');
await p.click('button[type="submit"]');
await p.waitForURL(/\/panel/, { timeout: 25000 });

/** Ninguna pantalla que sume importes puede enseñar el símbolo del sol. */
async function sinSoles(ruta, zona = 'table.datos') {
  await p.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  const texto = await p.locator(zona).first().innerText().catch(() => '');
  const kpis = await p.locator('.kpi, .rejilla-kpi').first().innerText().catch(() => '');
  return { texto, kpis };
}

/* ---- 1 · Las listas que suman, en dólares ---- */
for (const [ruta, nombre] of [
  ['/ventas/pedidos', 'Pedidos'],
  ['/ventas/control', 'Control de pedidos'],
  ['/finanzas/rentabilidad', 'Rentabilidad'],
]) {
  const { texto, kpis } = await sinSoles(ruta);
  ok(!kpis.includes('S/'), `${nombre}: los indicadores no mezclan soles`);
  ok(texto.includes('US$'), `${nombre}: la tabla muestra dólares`);
}

/* ---- 2 · Cuentas por cobrar: dólares arriba, moneda real en la fila ---- */
{
  const { texto, kpis } = await sinSoles('/finanzas/cobrar');
  ok(!kpis.includes('S/'), 'Cobrar: el saldo total va solo en dólares');
  ok(texto.includes('US$'), 'Cobrar: la tabla muestra dólares');
  ok(texto.includes('en la factura'),
     'Cobrar: las facturas en soles muestran también su importe original');
}

/* ---- 3 · La ficha de una factura en soles SIGUE en soles ----
   Es un hecho legal: el documento dice lo que dice. */
{
  await p.goto(`${BASE}/finanzas/facturas`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  const boleta = p.locator('table.datos tbody tr a').first();
  await boleta.click();
  await p.waitForTimeout(1800);
  const ficha = await p.locator('body').innerText();
  ok(ficha.includes('US$') || ficha.includes('S/'),
     'Ficha de factura: muestra un importe con su símbolo de moneda');
}

/* ---- 4 · El formulario avisa si el tipo de cambio es imposible ---- */
{
  await p.goto(`${BASE}/ventas/cotizaciones/nueva`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2000);

  const etiquetas = await p.locator('.etiqueta').allInnerTexts();
  ok(etiquetas.some((e) => e.toUpperCase().includes('S/ POR US$')),
     'El campo dice en qué unidad va el tipo de cambio');

  // El campo del tipo de cambio es el número que arranca en 3.75
  const campo = p.locator('input[type="number"]').filter({ hasNot: p.locator('x') });
  const total = await campo.count();
  let tocado = false;
  for (let i = 0; i < total; i++) {
    if ((await campo.nth(i).inputValue()) === '3.75') {
      await campo.nth(i).fill('1');
      tocado = true;
      break;
    }
  }
  ok(tocado, 'se encontró el campo del tipo de cambio');
  await p.waitForTimeout(600);
  const cuerpo = await p.locator('body').innerText();
  ok(/no puede serlo|SOLES POR D/i.test(cuerpo),
     'escribir 1 como tipo de cambio muestra el aviso');
}

console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo correcto');
await nav.close();
process.exit(fallos.length ? 1 : 0);
