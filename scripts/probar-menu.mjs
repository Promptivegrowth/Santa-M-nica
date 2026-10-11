/**
 * ============================================================================
 *  PRUEBA DE LA ORGANIZACIÓN DEL MENÚ
 * ============================================================================
 *  Documento de mejoras, punto 12:
 *
 *    «Organizar el sistema en: Ventas (incluye Clientes), Stock/Inventarios,
 *     Producción, Logística y Contable/Finanzas. Trazabilidad, Reportes y
 *     Configuración permanecen como herramientas transversales.»
 *
 *  Y el cuadro resumen ubica Rentabilidad en Ventas y Tiempos de Flujo en
 *  Logística.
 *
 *  Además, con cada uno de los siete roles: todo lo que el menú le enseña se
 *  tiene que poder abrir. Un enlace que lleva a «sin acceso» es peor que no
 *  tenerlo.
 *
 *      node scripts/probar-menu.mjs
 * ============================================================================
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const fallos = [];
const ok = (cond, texto, detalle = '') => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${texto}${detalle ? ' · ' + detalle : ''}`);
  if (!cond) fallos.push(texto);
};

const nav = await chromium.launch({ channel: 'chrome', headless: true });

async function entrar(correo) {
  const ctx = await nav.newContext({ viewport: { width: 1600, height: 1100 } });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', correo);
  await p.fill('input[type="password"]', 'SantaMonica2026');
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/panel/, { timeout: 30000 });
  return p;
}

/** El menú tal como se ve: [{ grupo, entradas: [{ titulo, ruta }] }]. */
const leerMenu = (p) => p.locator('nav.barra .barra-grupo').evaluateAll((gs) => gs.map((g) => ({
  grupo: g.querySelector('.barra-grupo-titulo')?.textContent?.trim(),
  entradas: [...g.querySelectorAll('a.barra-enlace')].map((a) => ({
    titulo: a.querySelector('.barra-texto')?.textContent?.trim(),
    ruta: a.getAttribute('href'),
  })),
})));

try {
  console.log('\n─── 1 · Los módulos del documento, en su orden ───');
  {
    const p = await entrar('gerencia@santamonica.pe');
    const menu = await leerMenu(p);
    const grupos = menu.map((g) => g.grupo);
    const esperado = ['Panel', 'Ventas', 'Stock / Inventarios', 'Producción', 'Logística', 'Contable / Finanzas', 'Herramientas'];
    ok(JSON.stringify(grupos) === JSON.stringify(esperado), 'los grupos son los del documento, en su orden', grupos.join(' · '));

    const dondeEsta = (titulo) => menu.find((g) => g.entradas.some((e) => e.titulo === titulo))?.grupo;
    for (const [titulo, grupo] of [
      ['Clientes', 'Ventas'],
      ['Rentabilidad', 'Ventas'],
      ['Resumen de despachos', 'Ventas'],
      ['Existencias', 'Stock / Inventarios'],
      ['Alertas de stock', 'Stock / Inventarios'],
      ['Necesidades de producción', 'Producción'],
      ['Tiempos del flujo', 'Logística'],
      ['Planificador', 'Logística'],
      ['Costos de producción', 'Contable / Finanzas'],
      ['Facturación', 'Contable / Finanzas'],
      ['Buscador universal', 'Herramientas'],
      ['Reportes', 'Herramientas'],
      ['Configuración', 'Herramientas'],
    ]) {
      ok(dondeEsta(titulo) === grupo, `«${titulo}» está en ${grupo}`, dondeEsta(titulo) ?? 'no está');
    }
    const todas = menu.flatMap((g) => g.entradas.map((e) => e.ruta));
    ok(new Set(todas).size === todas.length, 'ninguna pantalla aparece dos veces', `${todas.length} entradas`);
    await p.context().close();
  }

  console.log('\n─── 2 · Cada rol puede abrir todo lo que su menú le enseña ───');
  for (const rol of ['gerencia', 'operaciones', 'comercial', 'comex', 'almacen', 'calidad', 'consulta']) {
    const p = await entrar(`${rol}@santamonica.pe`);
    const entradas = (await leerMenu(p)).flatMap((g) => g.entradas);
    const rotas = [];
    for (const e of entradas) {
      const r = await p.goto(`${BASE}${e.ruta}`, { waitUntil: 'domcontentloaded' });
      await p.waitForLoadState('networkidle').catch(() => {});
      const destino = new URL(p.url());
      if ((r?.status() ?? 0) >= 400 || destino.searchParams.has('sinacceso') || destino.pathname === '/login') {
        rotas.push(`${e.titulo} → ${destino.pathname}${destino.search}`);
      }
    }
    ok(rotas.length === 0, `${rol}: las ${entradas.length} entradas de su menú abren`, rotas.slice(0, 3).join(' | '));
    await p.context().close();
  }
} finally {
  await nav.close();
}

console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo correcto');
process.exit(fallos.length ? 1 : 0);
