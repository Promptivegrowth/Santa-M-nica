/**
 * ============================================================================
 *  AUDITORÍA DEL TOPE DE MIL FILAS
 * ============================================================================
 *  La API de Supabase devuelve como mucho MIL FILAS por consulta, y el tope no
 *  se puede subir desde el cliente: pedir `limit(5000)` devuelve mil igual.
 *
 *  Eso convierte cualquier «traer todo y sumarlo en la pantalla» en una bomba
 *  silenciosa: la cifra sale, parece razonable, y le falta un pedazo. Ya mordió
 *  dos veces en este proyecto —las tarjetas de anticuamiento decían 26 pallets
 *  vencidos cuando había 47, y el gráfico de existencias se pintaba con dos
 *  tercios del inventario—.
 *
 *  Esta auditoría recorre las tablas y vistas grandes y avisa de las que ya
 *  pasan de mil filas: son las que NO se pueden agregar en memoria.
 *
 *      node scripts/auditar-limite-filas.mjs
 * ============================================================================
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const cli = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
                         { auth: { persistSession: false } });

/** El tope real de la API, comprobado y no supuesto. */
const TOPE = 1000;

const objetivos = [
  'lotes', 'movimientos', 'existencias', 'reservas',
  'pedido_lineas', 'cotizacion_lineas', 'packing_lineas', 'plano_estiba',
  'costos_mensuales', 'precios',
  'v_anticuamiento', 'v_disponibilidad', 'v_kardex', 'v_stock_lote',
  'v_pedidos_tablero', 'v_margen_contribucion', 'v_tiempos_flujo',
];

console.log('\nTablas y vistas por encima del tope de la API\n');

const riesgo = [];
for (const t of objetivos) {
  const { count, error } = await cli.from(t).select('*', { count: 'exact', head: true });
  if (error) { console.log(`  ??   ${t.padEnd(24)} ${error.message.slice(0, 50)}`); continue; }

  const n = count ?? 0;
  const pasa = n > TOPE;
  if (pasa) riesgo.push({ t, n });
  console.log(`  ${pasa ? 'OJO ' : ' ok '} ${t.padEnd(24)} ${String(n).padStart(7)} filas`);
}

console.log(`\n${riesgo.length} de ${objetivos.length} ya pasan de ${TOPE} filas.`);
if (riesgo.length) {
  console.log('\nEn estas, NO se puede traer todo y sumar en la pantalla:');
  for (const r of riesgo) console.log(`  · ${r.t} (${r.n})`);
  console.log('\nHay que agregar en la base —una vista— o contar con');
  console.log('`select(..., { count: \'exact\', head: true })`, que devuelve el');
  console.log('número sin traerse las filas.');
}

/* ---- Y se comprueba que el tope es el que se cree que es ---- */
console.log('\nComprobación del tope:');
const { data } = await cli.from('v_anticuamiento').select('lote_id').limit(5000);
console.log(`  pidiendo limit(5000) llegan ${data?.length} filas` +
            (data?.length === TOPE ? '  → el tope manda sobre el limit' : ''));

process.exit(0);
