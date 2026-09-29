/**
 * ============================================================================
 *  PRUEBA DE LAS TARJETAS · todas se pulsan y abren su detalle
 * ============================================================================
 *  Documento de mejoras, punto 7:
 *
 *    «Las tarjetas e indicadores deben permitir hacer clic y ver el detalle.»
 *
 *  Recorre todas las pantallas del menú y una ficha de cada tipo, como
 *  Gerencia —que ve todas las tarjetas—. En cada una comprueba que NINGUNA
 *  tarjeta es un cuadro muerto, y sigue cada enlace: la pantalla de destino
 *  tiene que abrir sin error y, si el enlace lleva «#sección», esa sección
 *  tiene que existir allí.
 *
 *      node scripts/probar-tarjetas.mjs
 * ============================================================================
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { ejecutarSQL } from './db.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const consultar = async (sql) => {
  const r = await ejecutarSQL(sql);
  return Array.isArray(r) ? r : [];
};
const fallos = [];
const ok = (cond, texto, detalle = '') => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${texto}${detalle ? ' · ' + detalle : ''}`);
  if (!cond) fallos.push(texto);
};

/* Las pantallas del menú, leídas del propio mapa de navegación. */
const nav = readFileSync(new URL('../src/lib/navegacion.ts', import.meta.url), 'utf8');
const rutasMenu = [...nav.matchAll(/ruta:\s*'([^']+)'/g)].map((m) => m[1]);

/* Una ficha de cada tipo, con un registro que exista. */
const uno = async (sql) => (await consultar(sql))[0]?.id;
const fichas = [
  `/almacenes/lotes/${await uno('select id from lotes order by id limit 1')}`,
  `/almacenes/traslados/${await uno('select id from traslados order by id limit 1')}`,
  `/ventas/pedidos/${await uno(`select id from pedidos where ciclo = 'confirmado' order by id limit 1`)}`,
  `/ventas/clientes/${await uno('select id from clientes order by id limit 1')}`,
  `/ventas/productos/${await uno('select id from sku_presentaciones order by id limit 1')}`,
  `/finanzas/facturas/${await uno(`select id from facturas where estado <> 'anulada' order by id limit 1`)}`,
  `/logistica/embarques/${await uno('select id from embarques order by id limit 1')}`,
  `/logistica/packing/${await uno(`select id from packing_lists where estado <> 'anulado' order by id limit 1`)}`,
  `/trazabilidad/retiro?lote=${await uno('select id from lotes order by id limit 1')}`,
];

const navegador = await chromium.launch({ channel: 'chrome', headless: true });
const p = await (await navegador.newContext({ viewport: { width: 1600, height: 1100 } })).newPage();
const erroresJs = [];
p.on('pageerror', (e) => erroresJs.push(String(e.message).slice(0, 120)));

try {
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', 'gerencia@santamonica.pe');
  await p.fill('input[type="password"]', 'SantaMonica2026');
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/panel/, { timeout: 30000 });

  let tarjetas = 0;
  const destinos = new Map();   // href → pantallas que lo usan

  console.log('\n─── 1 · Ninguna tarjeta es un cuadro muerto ───');
  for (const ruta of [...rutasMenu, ...fichas]) {
    await p.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(600);
    const muertas = await p.locator('div.kpi').count();
    const vivas = await p.locator('a.kpi').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    tarjetas += vivas.length + muertas;
    if (vivas.length + muertas === 0) continue;
    ok(muertas === 0, `${ruta}: ${vivas.length} tarjetas, todas pulsables`, muertas ? `${muertas} sin enlace` : '');
    for (const h of vivas) {
      const absoluto = h.startsWith('#') ? `${ruta.split('#')[0]}${h}` : h;
      if (!destinos.has(absoluto)) destinos.set(absoluto, ruta);
    }
  }
  ok(tarjetas > 100, 'se revisaron todas las pantallas', `${tarjetas} tarjetas`);

  console.log(`\n─── 2 · Cada enlace abre su detalle (${destinos.size} destinos distintos) ───`);
  let bien = 0;
  for (const [href, origen] of destinos) {
    const [camino, ancla] = href.split('#');
    const resp = await p.goto(`${BASE}${camino}`, { waitUntil: 'networkidle' });
    const estado = resp?.status() ?? 0;
    const texto = await p.locator('main').innerText().catch(() => '');
    const roto = estado >= 400 || /Algo salió mal|no se encontró|Application error/i.test(texto);
    const anclaExiste = !ancla || (await p.locator(`[id="${ancla}"]`).count()) > 0;
    if (!roto && anclaExiste) { bien++; continue; }
    ok(false, `${href} (desde ${origen})`, roto ? `respuesta ${estado}` : `no existe la sección #${ancla}`);
  }
  ok(bien === destinos.size, 'todos los destinos abren, con su sección', `${bien} de ${destinos.size}`);
  ok(erroresJs.length === 0, 'ningún error de JavaScript en el recorrido', erroresJs.slice(0, 2).join(' | '));
} finally {
  await navegador.close();
}

console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo correcto');
process.exit(fallos.length ? 1 : 0);
