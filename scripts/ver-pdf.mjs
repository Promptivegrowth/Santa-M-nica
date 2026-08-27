#!/usr/bin/env node
/**
 * Abre un PDF en Chrome y guarda una captura de cómo se ve.
 *
 * Sirve para revisar el diseño de los comprobantes sin abrirlos a mano: las
 * pruebas dicen que el archivo es válido, pero no si la tabla está torcida o
 * si un texto se sale de su caja. Eso hay que verlo.
 *
 *   node scripts/ver-pdf.mjs documentos-prueba/factura-48.pdf capturas/factura.png
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const archivo = process.argv[2];
const salida = process.argv[3] ?? 'capturas/pdf.png';

if (!archivo || !fs.existsSync(archivo)) {
  console.error('No se encontró el PDF:', archivo);
  process.exit(1);
}

fs.mkdirSync(path.dirname(salida), { recursive: true });

const navegador = await chromium.launch({ channel: 'chrome', headless: true });
const pagina = await navegador.newPage({ viewport: { width: 1000, height: 1400 } });

// El visor de PDF de Chrome tarda un momento en pintar la primera página.
await pagina.goto('file:///' + path.resolve(archivo).replace(/\\/g, '/'));
await pagina.waitForTimeout(3500);
await pagina.screenshot({ path: salida });

await navegador.close();
console.log('Captura guardada en', salida);
