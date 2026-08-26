#!/usr/bin/env node
/**
 * ============================================================================
 *  PRUEBA REAL DE LA EXPORTACIÓN A EXCEL
 * ============================================================================
 *  No comprueba "que el código no falle": descarga los archivos de verdad
 *  desde el servidor, los abre con la misma librería que los generó y verifica
 *  que traigan el logotipo, los colores de marca, los encabezados y los datos.
 *
 *  Uso:  npm run dev   (en otra terminal)
 *        node scripts/probar-excel.mjs
 * ============================================================================
 */
import { createClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';
import { writeFileSync, mkdirSync } from 'node:fs';
import './db.mjs'; // carga las variables de entorno

const BASE = process.env.URL_PRUEBA ?? 'http://localhost:3000';
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const REF = process.env.SUPABASE_PROJECT_REF;
const SALIDA = 'reportes-prueba';

let ok = 0, fallo = 0;
const errores = [];

function comprobar(nombre, condicion, detalle = '') {
  if (condicion) { ok++; console.log(`   ✓ ${nombre}`); }
  else { fallo++; errores.push(nombre); console.log(`   ✗ ${nombre}${detalle ? '  (' + detalle + ')' : ''}`); }
}

/** Inicia sesión y arma la cookie que espera el servidor. */
async function cookieDeSesion(rol) {
  const cli = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await cli.auth.signInWithPassword({
    email: `${rol}@santamonica.pe`,
    password: 'SantaMonica2026',
  });
  if (error) throw new Error(`No se pudo iniciar sesión como ${rol}: ${error.message}`);

  // @supabase/ssr guarda la sesión como JSON codificado en base64
  const payload = Buffer.from(JSON.stringify(data.session)).toString('base64');
  return `sb-${REF}-auth-token=base64-${payload}`;
}

async function principal() {
  console.log('════════════════════════════════════════════════════════════════');
  console.log('  PRUEBA DE EXPORTACIÓN A EXCEL');
  console.log('════════════════════════════════════════════════════════════════\n');

  // Comprobamos que el servidor esté levantado antes de nada
  try {
    const r = await fetch(`${BASE}/login`);
    if (!r.ok) throw new Error(`respondió ${r.status}`);
  } catch (e) {
    console.error(`✗ El servidor no responde en ${BASE}. Levántelo con "npm run dev".`);
    console.error(`  Detalle: ${e.message}`);
    process.exit(1);
  }

  mkdirSync(SALIDA, { recursive: true });
  const cookie = await cookieDeSesion('gerencia');

  const REPORTES = [
    'existencias', 'valorizado', 'kardex', 'anticuamiento', 'ocupabilidad',
    'disponibilidad', 'pedidos', 'cuentas_cobrar', 'rentabilidad', 'necesidades', 'despachos',
  ];

  console.log('── Descarga y verificación de cada reporte ──────────────────────');

  for (const tipo of REPORTES) {
    const resp = await fetch(`${BASE}/api/reportes/${tipo}`, { headers: { cookie } });

    if (!resp.ok) {
      comprobar(`${tipo}: se descarga`, false, `HTTP ${resp.status}`);
      continue;
    }

    const tipoContenido = resp.headers.get('content-type') ?? '';
    const disposicion = resp.headers.get('content-disposition') ?? '';
    const buffer = Buffer.from(await resp.arrayBuffer());
    writeFileSync(`${SALIDA}/${tipo}.xlsx`, buffer);

    // Lo abrimos de verdad para comprobar que es un Excel válido
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(buffer);
    const hoja = libro.worksheets[0];

    const celdaTitulo = hoja.getCell('D1').value;
    const filaEnc = hoja.getRow(6);
    const colorEnc = filaEnc.getCell(1).fill?.fgColor?.argb;
    const tieneImagen = (hoja.getImages?.() ?? []).length > 0;
    const filasDatos = hoja.rowCount - 7;

    comprobar(
      `${tipo}: descarga como Excel (${(buffer.length / 1024).toFixed(0)} kB, ${filasDatos} filas)`,
      tipoContenido.includes('spreadsheetml') && disposicion.includes('.xlsx')
    );
    comprobar(`${tipo}: lleva el logotipo de la empresa`, tieneImagen);
    comprobar(`${tipo}: encabezados con el azul de marca`, colorEnc === 'FF304F8C', `color = ${colorEnc}`);
    comprobar(`${tipo}: tiene título`, typeof celdaTitulo === 'string' && celdaTitulo.length > 3);
    comprobar(`${tipo}: contiene datos`, filasDatos > 0, `${filasDatos} filas`);
  }

  console.log('\n── Control de permisos en la exportación ───────────────────────');

  // Un rol sin acceso a costos NO debe poder descargar reportes valorizados
  const cookieAlmacen = await cookieDeSesion('almacen');
  const rechazado = await fetch(`${BASE}/api/reportes/valorizado`, { headers: { cookie: cookieAlmacen } });
  comprobar(
    'El rol Almacén NO puede descargar el inventario valorizado',
    rechazado.status === 403,
    `HTTP ${rechazado.status}`
  );

  const permitido = await fetch(`${BASE}/api/reportes/existencias`, { headers: { cookie: cookieAlmacen } });
  comprobar('El rol Almacén SÍ puede descargar existencias', permitido.ok, `HTTP ${permitido.status}`);

  // Sin sesión no se descarga nada
  // 'manual' evita que fetch siga la redirección y nos oculte el código real
  const sinSesion = await fetch(`${BASE}/api/reportes/existencias`, { redirect: 'manual' });
  comprobar('Sin sesión la API responde 401 y no entrega datos',
    sinSesion.status === 401, `HTTP ${sinSesion.status}`);

  const pantallaSinSesion = await fetch(`${BASE}/panel`, { redirect: 'manual' });
  comprobar('Sin sesión una pantalla redirige al login',
    pantallaSinSesion.status === 307 || pantallaSinSesion.status === 302,
    `HTTP ${pantallaSinSesion.status}`);

  // Un reporte inexistente responde con un error claro
  const inexistente = await fetch(`${BASE}/api/reportes/no_existe`, { headers: { cookie } });
  comprobar('Un reporte inexistente devuelve 404 con explicación', inexistente.status === 404);

  console.log('\n════════════════════════════════════════════════════════════════');
  console.log(`  RESULTADO: ${ok} pasaron · ${fallo} fallaron`);
  console.log(`  Archivos guardados en ./${SALIDA}/`);
  console.log('════════════════════════════════════════════════════════════════');
  if (errores.length) {
    console.log('\n  Fallaron:');
    errores.forEach((e) => console.log(`   ✗ ${e}`));
  }
  console.log('');
  process.exit(fallo > 0 ? 1 : 0);
}

principal().catch((e) => {
  console.error('\n✗ ERROR:', e.message);
  process.exit(1);
});
