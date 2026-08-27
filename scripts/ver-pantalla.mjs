/**
 * Captura una o varias pantallas del ERP para poder mirarlas.
 *
 *   node scripts/_ver.mjs /almacenes/existencias /ventas/pedidos
 *   node scripts/_ver.mjs --oscuro /panel
 */
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import './db.mjs';

const BASE = 'http://localhost:3000';
const OSCURO = process.argv.includes('--oscuro');
const RUTAS = process.argv.slice(2).filter((a) => !a.startsWith('--'));

fs.mkdirSync('capturas', { recursive: true });

const nav = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await nav.newContext({
  viewport: { width: 1500, height: 950 },
  colorScheme: OSCURO ? 'dark' : 'light',
});
const p = await ctx.newPage();

await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await p.fill('input[type="email"]', 'gerencia@santamonica.pe');
await p.fill('input[type="password"]', 'SantaMonica2026');
await p.click('button[type="submit"]');
await p.waitForURL(/\/panel/, { timeout: 25000 });

for (const ruta of RUTAS) {
  await p.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1800);
  const nombre = `vista${OSCURO ? '-oscuro' : ''}${ruta.replace(/\W+/g, '-')}.png`;
  await p.screenshot({ path: path.join('capturas', nombre) });
  console.log('->', nombre);
}

await nav.close();
