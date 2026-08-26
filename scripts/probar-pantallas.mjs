#!/usr/bin/env node
/**
 * ============================================================================
 *  PRUEBA DE PANTALLAS · que rendericen de verdad, con sesión real
 * ============================================================================
 *  Abre cada pantalla del ERP con una sesión iniciada y comprueba que:
 *   · responde 200,
 *   · devuelve HTML con contenido (no una página de error),
 *   · no contiene rastros de error de Next.js,
 *   · trae datos reales (busca marcas del contenido esperado).
 * ============================================================================
 */
import { createClient } from '@supabase/supabase-js';
import './db.mjs';

const BASE = process.env.URL_PRUEBA ?? 'http://localhost:3000';
const REF = process.env.SUPABASE_PROJECT_REF;
let ok = 0, fallo = 0; const errores = [];

function comprobar(n, c, d = '') {
  if (c) { ok++; console.log(`   ✓ ${n}`); }
  else { fallo++; errores.push(`${n} ${d}`); console.log(`   ✗ ${n}  (${d})`); }
}

async function cookieDe(rol) {
  const cli = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } });
  const { data, error } = await cli.auth.signInWithPassword({
    email: `${rol}@santamonica.pe`, password: 'SantaMonica2026' });
  if (error) throw new Error(error.message);
  return `sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(data.session)).toString('base64')}`;
}

const PANTALLAS = [
  ['/panel',                     'Control Tower'],
  ['/alertas',                   'Alertas'],
  ['/ventas/clientes',           'Clientes'],
  ['/ventas/cotizaciones',       'Cotizaciones'],
  ['/ventas/cotizaciones/nueva', 'Nueva cotización'],
  ['/ventas/pedidos',            'Pedidos'],
  ['/ventas/disponibilidad',     'Disponibilidad'],
  ['/ventas/control',            'Control de pedidos'],
  ['/ventas/necesidades',        'Necesidades'],
  ['/almacenes/existencias',     'Existencias'],
  ['/almacenes/kardex',          'Kardex'],
  ['/almacenes/ingresos',        'Ingresos'],
  ['/almacenes/traslados',       'Traslados'],
  ['/almacenes/calidad',         'Calidad'],
  ['/almacenes/anticuamiento',   'Anticuamiento'],
  ['/almacenes/valorizado',      'valorizado'],
  ['/logistica/planificador',    'Planificador'],
  ['/logistica/embarques',       'Embarques'],
  ['/logistica/packing',         'estiba'],
  ['/logistica/despachos',       'Despachos'],
  ['/finanzas/facturas',         'Facturación'],
  ['/finanzas/cobrar',           'cobrar'],
  ['/finanzas/rentabilidad',     'Rentabilidad'],
  ['/trazabilidad',              'Trazabilidad'],
  ['/trazabilidad/retiro',       'Retiro sanitario'],
  ['/trazabilidad/auditoria',    'Auditoría'],
  ['/reportes',                  'Reportes'],
  ['/configuracion',             'Configuración'],
];

async function principal() {
  console.log('════════════════════════════════════════════════════════════════');
  console.log('  PRUEBA DE PANTALLAS · renderizado real con sesión');
  console.log('════════════════════════════════════════════════════════════════\n');
  const cookie = await cookieDe('gerencia');

  console.log('── Todas las pantallas con rol Gerencia ─────────────────────────');
  for (const [ruta, marca] of PANTALLAS) {
    const r = await fetch(`${BASE}${ruta}`, { headers: { cookie } });
    const html = await r.text();
    const tieneError = /Application error|Unhandled Runtime Error|__NEXT_ERROR/i.test(html);
    const tieneMarca = html.includes(marca);
    comprobar(`${ruta}`,
      r.ok && !tieneError && tieneMarca && html.length > 2000,
      `HTTP ${r.status}, ${html.length} bytes, marca=${tieneMarca}, error=${tieneError}`);
  }

  console.log('\n── Restricciones por rol ────────────────────────────────────────');
  const cookieConsulta = await cookieDe('consulta');

  const valorizado = await fetch(`${BASE}/almacenes/valorizado`, { headers: { cookie: cookieConsulta }, redirect: 'manual' });
  comprobar('Consulta NO entra a inventario valorizado (redirige)',
    valorizado.status === 307 || valorizado.status === 302, `HTTP ${valorizado.status}`);

  const config = await fetch(`${BASE}/configuracion`, { headers: { cookie: cookieConsulta }, redirect: 'manual' });
  comprobar('Consulta NO entra a Configuración (redirige)',
    config.status === 307 || config.status === 302, `HTTP ${config.status}`);

  const panel = await fetch(`${BASE}/panel`, { headers: { cookie: cookieConsulta } });
  const htmlPanel = await panel.text();
  comprobar('Consulta SÍ entra al panel', panel.ok);
  comprobar('Consulta NO ve el valor del inventario en el panel',
    !htmlPanel.includes('Valor del inventario'));

  console.log('\n── Detalle de un pedido y su plano de estiba ────────────────────');
  const cli = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } });
  const { data: ped } = await cli.from('pedidos').select('id').limit(1).single();
  const { data: pk } = await cli.from('packing_lists').select('id').limit(1).single();

  for (const t of ['general', 'productos', 'reservas', 'rentabilidad', 'historial']) {
    const r = await fetch(`${BASE}/ventas/pedidos/${ped.id}?t=${t}`, { headers: { cookie } });
    const html = await r.text();
    comprobar(`Pedido · pestaña ${t}`, r.ok && !/Application error/i.test(html) && html.length > 2000,
      `HTTP ${r.status}`);
  }

  const plano = await fetch(`${BASE}/logistica/packing/${pk.id}`, { headers: { cookie } });
  const htmlPlano = await plano.text();
  comprobar('Plano de estiba renderiza la matriz',
    plano.ok && htmlPlano.includes('Saldo por fila') && htmlPlano.includes('plano-celda'),
    `HTTP ${plano.status}`);

  console.log('\n════════════════════════════════════════════════════════════════');
  console.log(`  RESULTADO: ${ok} pasaron · ${fallo} fallaron`);
  console.log('════════════════════════════════════════════════════════════════');
  if (errores.length) { console.log('\n  Fallaron:'); errores.forEach((e) => console.log(`   ✗ ${e}`)); }
  console.log('');
  process.exit(fallo > 0 ? 1 : 0);
}

principal().catch((e) => { console.error('\n✗ ERROR:', e.message); process.exit(1); });
