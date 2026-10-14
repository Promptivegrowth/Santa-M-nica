/**
 * ============================================================================
 *  PRUEBA · CLIENTES CON VERIFICACIÓN BASC (lista de Comex)
 * ============================================================================
 *  La ficha del cliente con sus cuatro controles BASC, registrar uno nuevo,
 *  el «al día» de la lista, la forma de pago habitual que propone la
 *  cotización y la carga de la lista de Comex en modo prueba (aplica y
 *  deshace). Lo que se toca se devuelve.
 *
 *      BASE_URL=http://localhost:3010 node scripts/probar-clientes-basc.mjs "<Lista Clientes - Verificación 2026.xlsx>"
 * ============================================================================
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { ejecutarSQL } from './db.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const LISTA = process.argv[2];
const consultar = async (sql) => { const r = await ejecutarSQL(sql); return Array.isArray(r) ? r : []; };
const SEC = (n, t) => `\n${'─'.repeat(3)} ${n} · ${t} ${'─'.repeat(3)}`;
const fallos = [];
const ok = (cond, texto, detalle = '') => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${texto}${detalle ? ' · ' + detalle : ''}`);
  if (!cond) fallos.push(texto);
};

const [{ hoy }] = await consultar(`select (now() at time zone 'America/Lima')::date::text hoy`);
const [cli] = await consultar(`select id, razon_social, forma_pago, adelanto_pct from clientes
  where activo and not bloqueado and not exists (select 1 from cliente_verificaciones v where v.cliente_id = clientes.id) order by id limit 1`);
const nav = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await nav.newContext({ viewport: { width: 1500, height: 1000 } });
const p = await ctx.newPage();

try {
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', 'comex@santamonica.pe');
  await p.fill('input[type="password"]', 'SantaMonica2026');
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/panel/, { timeout: 30000 });

  console.log(SEC(1, 'La ficha del cliente con su verificación BASC'));
  await p.goto(`${BASE}/ventas/clientes/${cli.id}`, { waitUntil: 'networkidle' });
  const panel = p.locator('#basc');
  ok(/Lista Clinton/i.test(await panel.innerText()) && /Sin verificar/i.test(await panel.innerText()), 'muestra los cuatro controles; sin datos, «Sin verificar»');
  ok(await p.locator('.basc-resumen[data-al-dia="no"]').count() === 1, 'y el estado «Pendiente»');

  //  Comex registra los cuatro controles, como en su lista.
  const registrar = async (control, resultado, extra = async () => {}) => {
    await p.locator('[data-accion="nueva-verificacion"]').click();
    await p.selectOption('select[name="control"]', control);
    await p.fill('input[name="resultado"]', resultado);
    await p.fill('input[name="fecha"]', hoy);
    await extra();
    await p.locator('[data-bloque="nueva-verificacion"] button', { hasText: 'Guardar' }).click();
    await p.locator('[data-accion="nueva-verificacion"]').waitFor({ timeout: 15000 });
  };
  await registrar('lista_clinton', 'OK');
  await registrar('onu_terrorismo', 'Negativo');
  await registrar('onu_armas', 'Negativo');
  ok(await p.locator('.basc-resumen[data-al-dia="no"]').count() === 1, 'con las tres listas pero sin acuerdo firmado, sigue pendiente');
  await registrar('acuerdo_seguridad', 'SI', async () => {
    await p.fill('input[name="enviado"]', hoy);
    await p.fill('input[name="firmado"]', hoy);
  });
  await p.reload({ waitUntil: 'networkidle' });
  ok(await p.locator('.basc-resumen[data-al-dia="si"]').count() === 1, 'con el acuerdo firmado: «Al día»');
  ok(await p.locator('table[data-cuadro="verificaciones"] tbody tr').count() === 4, 'queda la historia de las cuatro verificaciones');
  const [n] = await consultar(`select count(*)::int n from cliente_verificaciones where cliente_id = ${cli.id}`);
  ok(n.n === 4, 'guardadas en la base con fecha y responsable');

  console.log(SEC(2, 'La lista de clientes'));
  await p.goto(`${BASE}/ventas/clientes?basc=si&buscar=${encodeURIComponent(cli.razon_social.slice(0, 12))}`, { waitUntil: 'networkidle' });
  ok(await p.locator('[data-basc="al-dia"]').count() >= 1, 'columna BASC y filtro «Solo al día»');

  console.log(SEC(3, 'La cotización propone la forma de pago habitual del cliente'));
  await consultar(`update clientes set forma_pago = 'adelanto_saldo', adelanto_pct = 30 where id = ${cli.id}`);
  //  Cotiza Comercial o Gerencia (Comex no tiene esa pantalla).
  const ctxG = await nav.newContext({ viewport: { width: 1500, height: 1000 } });
  const g = await ctxG.newPage();
  await g.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await g.fill('input[type="email"]', 'gerencia@santamonica.pe');
  await g.fill('input[type="password"]', 'SantaMonica2026');
  await g.click('button[type="submit"]');
  await g.waitForURL(/\/panel/, { timeout: 30000 });
  await g.goto(`${BASE}/ventas/cotizaciones/nueva`, { waitUntil: 'networkidle' });
  await g.locator('select.campo').first().selectOption(String(cli.id));
  await g.waitForTimeout(500);
  ok(await g.locator('select[name="forma_pago"]').inputValue() === 'adelanto_saldo'
     && await g.locator('input[name="adelanto_pct"]').inputValue() === '30',
     'al elegir el cliente: «Adelanto y saldo», 30 %');
  await ctxG.close();

  console.log(SEC(4, 'La carga de la lista de Comex, en modo prueba'));
  if (LISTA) {
    const [antes] = await consultar(`select (select count(*) from clientes)::int c, (select count(*) from cliente_verificaciones)::int v`);
    const salida = execFileSync(process.execPath, ['scripts/importar-clientes-comex.mjs', LISTA, '--probar'], { encoding: 'utf8' });
    const prueba = /PRUEBA \(se deshizo todo\): (\{.*\})/.exec(salida);
    const r = prueba ? JSON.parse(prueba[1]) : null;
    ok(r && r.clientes > antes.c && r.verificaciones > 200, 'dentro de la transacción carga clientes y verificaciones', r ? `${r.clientes} clientes · ${r.verificaciones} verificaciones · ${r.al_dia} al día` : salida.slice(-200));
    const [despues] = await consultar(`select (select count(*) from clientes)::int c, (select count(*) from cliente_verificaciones)::int v`);
    ok(despues.c === antes.c && despues.v === antes.v, 'y al deshacer, la base queda exactamente igual');
    ok(/74 clientes/.test(salida) && /sin tocar hasta que Comex confirme: \d+/.test(salida), 'lee los 74 y aparta los dudosos para Comex');
  } else {
    console.log('   (sin ruta a la lista: se salta)');
  }
} catch (e) {
  console.error(e);
  fallos.push(String(e.message ?? e));
} finally {
  await consultar(`delete from cliente_verificaciones where cliente_id = ${cli.id};
                   update clientes set forma_pago = ${cli.forma_pago ? `'${cli.forma_pago}'` : 'null'}, adelanto_pct = ${cli.adelanto_pct ?? 'null'} where id = ${cli.id};`);
  await nav.close();
  console.log(fallos.length ? `\n${fallos.length} FALLAS:\n - ${fallos.join('\n - ')}` : '\nTodo correcto');
  process.exit(fallos.length ? 1 : 0);
}
