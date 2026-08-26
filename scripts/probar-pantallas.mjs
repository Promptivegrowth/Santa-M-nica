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
  ['/ventas/pedidos/nuevo',      'Nuevo pedido'],
  ['/ventas/pedidos',            'Pedidos'],
  ['/ventas/disponibilidad',     'Disponibilidad'],
  ['/ventas/control',            'Control de pedidos'],
  ['/ventas/necesidades',        'Necesidades'],
  ['/almacenes/existencias',     'Existencias'],
  ['/almacenes/reservas',        'Reservas de stock'],
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

  /* ======================================================================
     FICHAS DE DETALLE
     ======================================================================
     El ERP tiene que ser NAVEGABLE: desde cualquier listado se debe poder
     abrir el registro concreto. Aqui se toma un identificador real de cada
     tabla y se comprueba que su ficha renderiza de verdad, no que la ruta
     exista sobre el papel.
     ====================================================================== */
  console.log('\n-- Fichas de detalle de cada entidad ----------------------------');

  const unId = async (tabla) => {
    const { data } = await cli.from(tabla).select('id').limit(1).single();
    return data?.id ?? null;
  };

  const FICHAS = [
    ['lote',       '/almacenes/lotes',     await unId('lotes'),        'Identidad y origen'],
    ['traslado',   '/almacenes/traslados', await unId('traslados'),    'Cadena de custodia'],
    ['cliente',    '/ventas/clientes',     await unId('clientes'),     'Condiciones comerciales'],
    ['cotizacion', '/ventas/cotizaciones', await unId('cotizaciones'), 'Productos ofertados'],
    ['factura',    '/finanzas/facturas',   await unId('facturas'),     'Detalle facturado'],
    ['embarque',   '/logistica/embarques', await unId('embarques'),    'Datos del embarque'],
  ];

  for (const [nombre, base, id, marca] of FICHAS) {
    if (!id) { comprobar(`Ficha de ${nombre} - hay datos de prueba`, false, 'sin registros'); continue; }
    const r = await fetch(`${BASE}${base}/${id}`, { headers: { cookie } });
    const html = await r.text();
    comprobar(`Ficha de ${nombre} (${base}/${id})`,
      r.ok && !/Application error|Unhandled Runtime Error/i.test(html) && html.includes(marca),
      `HTTP ${r.status}, ${html.length} bytes, marca=${html.includes(marca)}`);
  }

  /* ----------------------------------------------------------------------
     Un identificador que no existe tiene que acabar en la pagina de "no
     encontrado", con su explicacion y su salida.

     Ojo con el codigo de estado: estas rutas tienen loading.tsx, asi que Next
     responde 200 y empieza a transmitir el esqueleto antes de que la pagina
     llegue a ejecutar notFound(). El 404 viaja despues, dentro del mismo
     flujo. Por eso se comprueba el contenido y no el status.
     ---------------------------------------------------------------------- */
  const inexistente = await fetch(`${BASE}/almacenes/lotes/99999999`, { headers: { cookie } });
  const htmlInexistente = await inexistente.text();
  comprobar('Un lote inexistente acaba en la pagina de no encontrado',
    htmlInexistente.includes('NEXT_HTTP_ERROR_FALLBACK;404')
      && htmlInexistente.includes('No encontramos ese registro'),
    `HTTP ${inexistente.status}, marca404=${htmlInexistente.includes('NEXT_HTTP_ERROR_FALLBACK;404')}`);

  comprobar('La pagina de no encontrado ofrece una salida',
    htmlInexistente.includes('Buscarlo por su c'), 'enlace al buscador universal');

  /* ======================================================================
     BOTONES DE ACCION EN LOS LISTADOS
     ======================================================================
     Cada listado tiene que ofrecer de verdad el boton de "ver detalle" y
     que ese enlace apunte a la ficha que corresponde.
     ====================================================================== */
  console.log('\n-- Acciones y enlaces en los listados ---------------------------');

  const LISTADOS_CON_ACCIONES = [
    ['/ventas/clientes',       'href="/ventas/clientes/'],
    ['/ventas/cotizaciones',   'href="/ventas/cotizaciones/'],
    ['/ventas/pedidos',        'href="/ventas/pedidos/'],
    ['/almacenes/existencias', 'href="/almacenes/lotes/'],
    ['/almacenes/traslados',   'href="/almacenes/traslados/'],
    ['/almacenes/reservas',    'href="/almacenes/lotes/'],
    ['/almacenes/kardex',      'href="/almacenes/lotes/'],
    ['/logistica/embarques',   'href="/logistica/embarques/'],
    ['/finanzas/facturas',     'href="/finanzas/facturas/'],
    ['/finanzas/cobrar',       'href="/finanzas/facturas/'],
  ];

  for (const [ruta, patron] of LISTADOS_CON_ACCIONES) {
    const r = await fetch(`${BASE}${ruta}`, { headers: { cookie } });
    const html = await r.text();
    comprobar(`${ruta} enlaza a su ficha`,
      r.ok && html.includes(patron) && html.includes('acciones-fila'),
      `enlace=${html.includes(patron)}, botones=${html.includes('acciones-fila')}`);
  }

  /* ======================================================================
     ALERTAS NAVEGABLES
     ====================================================================== */
  console.log('\n-- Las alertas llevan al registro que las provoco ---------------');

  const alertas = await fetch(`${BASE}/alertas`, { headers: { cookie } });
  const htmlAlertas = await alertas.text();
  comprobar('Las alertas se dibujan como filas pulsables',
    htmlAlertas.includes('alerta-fila') && htmlAlertas.includes('Ver detalle'));
  comprobar('Alguna alerta enlaza a la ficha de un lote',
    htmlAlertas.includes('href="/almacenes/lotes/'));
  comprobar('Alguna alerta enlaza a las reservas',
    htmlAlertas.includes('href="/almacenes/reservas'));

  /* ======================================================================
     REGLAS DE EDICION DE COTIZACIONES
     ======================================================================
     Solo se edita lo que todavia no cerro. Se comprueban los dos lados de
     la regla: la que se puede abrir y la que debe rebotar.
     ====================================================================== */
  console.log('\n-- Reglas de edicion de cotizaciones ----------------------------');

  const { data: convertidas } = await cli.from('pedidos')
    .select('cotizacion_id').not('cotizacion_id', 'is', null);
  const idsConvertidas = new Set((convertidas ?? []).map((x) => Number(x.cotizacion_id)));

  const { data: candidatas } = await cli.from('cotizaciones')
    .select('id, numero').in('estado', ['borrador', 'enviada']).limit(50);
  const editable = (candidatas ?? []).find((c) => !idsConvertidas.has(Number(c.id)));

  if (editable) {
    const r = await fetch(`${BASE}/ventas/cotizaciones/${editable.id}/editar`, { headers: { cookie } });
    const html = await r.text();
    comprobar(`La cotizacion ${editable.numero} en borrador SI se edita`,
      r.ok && html.includes('Guardar cambios'), `HTTP ${r.status}`);
  } else {
    comprobar('Hay alguna cotizacion editable en los datos de prueba', false);
  }

  const yaConvertida = [...idsConvertidas][0];
  if (yaConvertida) {
    /* Mismo caso que el 404: el redirect() viaja dentro del flujo, no en la
       cabecera, porque el esqueleto ya salio. Se comprueba que la orden de
       redireccion esta en la respuesta y que apunta a la ficha. */
    const r = await fetch(`${BASE}/ventas/cotizaciones/${yaConvertida}/editar`,
      { headers: { cookie }, redirect: 'manual' });
    const htmlEdit = await r.text();
    const rebota = r.status === 307 || r.status === 302
      || htmlEdit.includes('NEXT_REDIRECT')
      || htmlEdit.includes(`/ventas/cotizaciones/${yaConvertida}?nohayeditar=`);
    comprobar('Una cotizacion ya convertida NO se puede editar (rebota)',
      rebota, `HTTP ${r.status}, redirect en el flujo=${htmlEdit.includes('NEXT_REDIRECT')}`);
    comprobar('Y desde luego no muestra el formulario de edicion',
      !htmlEdit.includes('Guardar cambios'));

    const ficha = await fetch(`${BASE}/ventas/cotizaciones/${yaConvertida}`, { headers: { cookie } });
    const htmlFicha = await ficha.text();
    comprobar('La ficha explica por que ya no se puede modificar',
      htmlFicha.includes('Esta oferta se cerr'));
  } else {
    comprobar('Hay alguna cotizacion convertida en los datos de prueba', false);
  }

  console.log('\n════════════════════════════════════════════════════════════════');
  console.log(`  RESULTADO: ${ok} pasaron · ${fallo} fallaron`);
  console.log('════════════════════════════════════════════════════════════════');
  if (errores.length) { console.log('\n  Fallaron:'); errores.forEach((e) => console.log(`   ✗ ${e}`)); }
  console.log('');
  process.exit(fallo > 0 ? 1 : 0);
}

principal().catch((e) => { console.error('\n✗ ERROR:', e.message); process.exit(1); });
