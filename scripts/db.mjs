#!/usr/bin/env node
/**
 * ============================================================================
 *  EJECUTOR DE SQL CONTRA SUPABASE  ·  Santa Mónica ERP
 * ============================================================================
 *  ¿Para qué sirve?
 *  Supabase expone una API de administración que permite correr SQL directamente
 *  sobre la base de datos del proyecto. Este script toma un archivo .sql (o una
 *  sentencia suelta) y lo envía a esa API.
 *
 *  Lo usamos para aplicar las migraciones del esquema y para las auditorías,
 *  de modo que no dependamos de abrir el panel web de Supabase a mano.
 *
 *  Uso:
 *     node scripts/db.mjs archivo.sql          → ejecuta el archivo completo
 *     node scripts/db.mjs -q "select 1;"       → ejecuta una sentencia suelta
 *
 *  IMPORTANTE: el token de acceso es una credencial de administrador.
 *  Vive en .env.local, que está excluido del repositorio por .gitignore.
 * ============================================================================
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(__dirname, '..');

// --- Carga manual de .env.local (evitamos una dependencia extra) ------------
function cargarEnv() {
  const ruta = resolve(raiz, '.env.local');
  if (!existsSync(ruta)) return;
  for (const linea of readFileSync(ruta, 'utf8').split('\n')) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith('#')) continue;
    const i = limpia.indexOf('=');
    if (i === -1) continue;
    const clave = limpia.slice(0, i).trim();
    const valor = limpia.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    // El archivo del proyecto SIEMPRE manda: si la máquina del desarrollador
    // tiene otra variable con el mismo nombre (por ejemplo, el token de otro
    // proyecto Supabase), no debe pisar la configuración de este repositorio.
    process.env[clave] = valor;
  }
}
cargarEnv();

const REF = process.env.SUPABASE_PROJECT_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!REF || !TOKEN) {
  console.error('✗ Faltan SUPABASE_PROJECT_REF o SUPABASE_ACCESS_TOKEN en .env.local');
  process.exit(1);
}

/** Envía una sentencia SQL a la API de administración y devuelve el resultado. */
export async function ejecutarSQL(sql) {
  const respuesta = await fetch(
    `https://api.supabase.com/v1/projects/${REF}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    }
  );
  const texto = await respuesta.text();
  let datos;
  try { datos = JSON.parse(texto); } catch { datos = texto; }
  if (!respuesta.ok) {
    const err = new Error(typeof datos === 'string' ? datos : JSON.stringify(datos));
    err.status = respuesta.status;
    throw err;
  }
  return datos;
}

// --- Modo línea de comandos -------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('db.mjs')) {
  const args = process.argv.slice(2);
  let sql;

  if (args[0] === '-q') {
    sql = args.slice(1).join(' ');
  } else if (args[0]) {
    const ruta = resolve(process.cwd(), args[0]);
    if (!existsSync(ruta)) {
      console.error(`✗ No existe el archivo: ${ruta}`);
      process.exit(1);
    }
    sql = readFileSync(ruta, 'utf8');
    console.log(`▸ Ejecutando ${args[0]} (${sql.length.toLocaleString('es-PE')} caracteres)…`);
  } else {
    console.error('Uso: node scripts/db.mjs <archivo.sql> | -q "SELECT …"');
    process.exit(1);
  }

  try {
    const inicio = Date.now();
    const resultado = await ejecutarSQL(sql);
    const ms = Date.now() - inicio;
    console.log(`✓ OK en ${ms} ms`);
    if (Array.isArray(resultado) && resultado.length) {
      console.log(JSON.stringify(resultado.slice(0, 60), null, 2));
      if (resultado.length > 60) console.log(`… y ${resultado.length - 60} filas más`);
    }
  } catch (e) {
    console.error(`✗ Error ${e.status ?? ''}: ${e.message}`);
    process.exit(1);
  }
}
