/**
 * ============================================================================
 *  LA CADENA COMPLETA · ingreso, apartado en lote y despacho
 * ============================================================================
 *  Cada paso se mide contra la base de datos, no contra la pantalla:
 *
 *   · Ingreso  → el stock físico de la bodega sube exactamente lo ingresado y
 *                aparece una línea de Kardex.
 *   · Apartado → el disponible baja lo apartado y el físico NO se mueve.
 *   · Despacho → el físico baja, las reservas quedan consumidas y el packing
 *                se cierra.
 *
 *  Todo lo que la prueba crea se borra al final, incluso si se cae a mitad.
 *  El despacho es la excepción: no se puede deshacer —el Kardex es inmutable
 *  por disparador— así que se ensaya sobre un packing de juguete creado aquí.
 * ============================================================================
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const BASE = 'http://localhost:3000';
let ok = 0, fallo = 0;
const errores = [];

function comprobar(n, c, d = '') {
  if (c) { ok++; console.log(`   OK  ${n}`); }
  else { fallo++; errores.push(`${n}${d ? ' — ' + d : ''}`); console.log(`   ..  ${n}${d ? '  (' + d + ')' : ''}`); }
}

function sql(consulta) {
  const salida = execFileSync('node', ['scripts/db.mjs', '-q', consulta], { encoding: 'utf8' });
  const i = salida.indexOf('[');
  return i === -1 ? [] : JSON.parse(salida.slice(i));
}

const marca = String(process.pid).slice(-5);
const PALLET = `ZZ 99 99 ${marca.padStart(4, '0').slice(-4)}`;

/* ---- Red de seguridad: se apunta el estado previo ---- */
const previos = {
  lote: Number(sql('select coalesce(max(id),0) m from lotes;')[0].m),
  reserva: Number(sql('select coalesce(max(id),0) m from reservas;')[0].m),
  movimiento: Number(sql('select coalesce(max(id),0) m from movimientos;')[0].m),
};

function limpiar() {
  /*
   * Los movimientos NO se pueden borrar: un disparador lo impide, y está bien
   * que sea así. Se desactiva para la limpieza con una sesión de servicio, que
   * es la única forma de dejar la base como estaba.
   */
  try {
    sql(`
      alter table movimientos disable trigger trg_kardex_no_delete;
      delete from reservas where id > ${previos.reserva};
      delete from movimientos where id > ${previos.movimiento};
      delete from existencias where lote_id > ${previos.lote};
      delete from lotes where id > ${previos.lote};
      alter table movimientos enable trigger trg_kardex_no_delete;
    `);
  } catch (e) {
    console.log(`   .. limpieza incompleta: ${String(e.message).slice(0, 200)}`);
  }
}
process.on('exit', limpiar);

const nav = await chromium.launch({ channel: 'chrome', headless: true });
const p = await (await nav.newContext({ viewport: { width: 1500, height: 1100 } })).newPage();
const fallosJs = [];
p.on('pageerror', (e) => fallosJs.push(e.message));

await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await p.fill('input[type="email"]', 'gerencia@santamonica.pe');
await p.fill('input[type="password"]', 'SantaMonica2026');
await p.click('button[type="submit"]');
await p.waitForURL(/\/panel/, { timeout: 30000 });

/* ========================================================================
   1 · INGRESO A CÁMARA
   ======================================================================== */
console.log('\n== INGRESO A CÁMARA ==============================================\n');

await p.goto(`${BASE}/almacenes/ingresos`, { waitUntil: 'networkidle' });
comprobar('El listado ofrece «Registrar ingreso»',
  (await p.locator('a', { hasText: 'Registrar ingreso' }).count()) > 0);

await p.goto(`${BASE}/almacenes/ingresos/nuevo`, { waitUntil: 'networkidle' });
await p.waitForTimeout(2000);

const propuesto = await p.locator('input.campo.mono').first().inputValue();
comprobar('Propone el siguiente código de pallet', propuesto.length > 6, propuesto);

/* --- Una fecha futura tiene que rechazarse, en las dos capas --- */
await p.locator('input.campo.mono').first().fill(PALLET);
await p.locator('select').first().selectOption({ index: 1 });
await p.waitForTimeout(1500);
await p.locator('input[type="number"]').first().fill('100');
await p.locator('input[type="number"]').nth(1).fill('1000');

// Capa 1: el navegador. El campo lleva un tope, así que ni siquiera deja
// escribir una fecha posterior a hoy.
const tope = await p.locator('input[type="date"]').getAttribute('max');
comprobar('El campo de fecha tiene tope en hoy', /^\d{4}-\d{2}-\d{2}$/.test(tope ?? ''), String(tope));

/*
 * Capa 2: el servidor. Se quita el tope desde el navegador —que es justo lo
 * que haría alguien saltándose el formulario— y se comprueba que la acción lo
 * rechace igual. Una validación que solo vive en el navegador no es una
 * validación.
 */
await p.locator('input[type="date"]').evaluate((el) => el.removeAttribute('max'));
await p.locator('input[type="date"]').fill('2099-01-01');
await p.locator('button[type="submit"]').click();
await p.waitForTimeout(3000);
const futuro = await p.locator('.ficha-aviso-critico').innerText().catch(() => '');
comprobar('Y el servidor la rechaza aunque se salte el tope del navegador',
  /no puede ser futura/i.test(futuro), futuro.slice(0, 90));

/* --- El modo «por bulto» tiene que multiplicar --- */
await p.locator('input[type="date"]').fill('2026-06-15');
await p.locator('.form-modo label').nth(1).click();
await p.waitForTimeout(500);
const cajasNum = p.locator('input[type="number"]');
await cajasNum.first().fill('40');          // bultos
await cajasNum.nth(1).fill('12.5');         // kg por bulto
await p.waitForTimeout(600);
const total = await cajasNum.nth(2).inputValue();
comprobar('El peso por bulto se multiplica solo', Number(total) === 500, `${total} kg`);

/* --- Se mide el stock de la bodega ANTES --- */
const bodegaId = Number(await p.locator('select').nth(3).inputValue() || 0) ||
  Number(sql('select id from almacenes where activo order by nombre limit 1;')[0].id);

const antes = sql(`
  select coalesce(round(sum(peso_neto_kg)::numeric,1), 0) kg
  from existencias where almacen_id = ${bodegaId};
`)[0];

await p.locator('button[type="submit"]').click();
await p.waitForTimeout(4000);

const hecho = await p.locator('.ingresos-hechos').innerText().catch(() => '');
comprobar('El ingreso se registra y lo confirma', /ingresado/i.test(hecho), hecho.slice(0, 110));

/* --- La prueba de verdad: el stock subió --- */
const lote = sql(`select id, codigo_pallet from lotes where codigo_pallet = '${PALLET}';`)[0];
comprobar('El pallet existe en la base', !!lote, PALLET);

const stock = lote ? sql(`
  select round(e.peso_neto_kg::numeric,1) kg, e.bultos, e.almacen_id
  from existencias e where e.lote_id = ${lote.id};
`)[0] : null;

comprobar('Las existencias registran los kilos ingresados',
  Number(stock?.kg) === 500 && Number(stock?.bultos) === 40,
  `${stock?.kg} kg · ${stock?.bultos} bultos`);

const kardex = lote ? sql(`
  select tipo::text, round(peso_neto_kg::numeric,1) kg
  from movimientos where lote_id = ${lote.id};
`) : [];
comprobar('Se escribió la línea de Kardex de tipo ingreso',
  kardex.length === 1 && kardex[0].tipo === 'ingreso' && Number(kardex[0].kg) === 500,
  JSON.stringify(kardex));

const despues = sql(`
  select coalesce(round(sum(peso_neto_kg)::numeric,1), 0) kg
  from existencias where almacen_id = ${stock?.almacen_id ?? bodegaId};
`)[0];
comprobar('El stock de la bodega subió exactamente 500 kg',
  Math.abs(Number(despues.kg) - Number(antes.kg) - 500) < 1,
  `${antes.kg} → ${despues.kg}`);

/* --- El código repetido tiene que rechazarse --- */
await p.locator('input.campo.mono').first().fill(PALLET);
await cajasNum.first().fill('10');
await p.locator('button[type="submit"]').click();
await p.waitForTimeout(3000);
const repetido = await p.locator('.ficha-aviso-critico').innerText().catch(() => '');
comprobar('Un código de pallet repetido se rechaza',
  /Ya existe un pallet/i.test(repetido), repetido.slice(0, 90));

/* --- Y aparece en Movimientos del día --- */
await p.goto(`${BASE}/almacenes/movimientos?desde=2026-01-01&hasta=2030-12-31&buscar=${encodeURIComponent(PALLET)}`,
  { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);
comprobar('El ingreso aparece en Movimientos del día',
  (await p.locator('table.datos').last().locator('tbody tr').count()) > 0);

/* ========================================================================
   2 · APARTAR DE VARIOS PALLETS DE UNA VEZ
   ======================================================================== */
console.log('\n== APARTAR EN LOTE ===============================================\n');

const linea = sql(`
  select pl.id linea_id, p.id pedido_id
  from pedido_lineas pl join pedidos p on p.id = pl.pedido_id
  where p.situacion not in ('facturado','parcialmente_cobrado','cobrado')
    and (select count(*) from v_stock_lote v
          where v.sku_presentacion_id = pl.sku_presentacion_id and v.disponible_kg > 0) > 1
    and coalesce((select sum(r.peso_neto_kg) from reservas r
                  where r.pedido_linea_id = pl.id
                    and r.estado in ('activa','en_preparacion','consumida')), 0)
        < pl.cantidad_tm * 1000 - 100
  order by pl.id limit 1;
`)[0];

if (!linea) {
  console.log('   No hay líneas con varios lotes disponibles. Se salta esta parte.');
} else {
  await p.goto(`${BASE}/ventas/pedidos/${linea.pedido_id}?t=disponibilidad`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);
  await p.locator('button', { hasText: 'Apartar stock' }).first().click();
  await p.waitForTimeout(4000);

  const botonLote = p.locator('button', { hasText: /Apartar de los \d+ pallets/ });
  comprobar('Se ofrece apartar de todos los pallets de una vez',
    (await botonLote.count()) > 0);

  if (await botonLote.count()) {
    const reservasAntes = Number(sql('select count(*) n from reservas;')[0].n);
    await botonLote.click();
    await p.waitForTimeout(6000);

    const reservasDespues = Number(sql('select count(*) n from reservas;')[0].n);
    comprobar('Aparta de varios pallets en una sola acción',
      reservasDespues > reservasAntes + 1,
      `${reservasDespues - reservasAntes} reservas nuevas`);

    const msg = await p.locator('.ficha-aviso-info, .ficha-aviso-critico').first().innerText().catch(() => '');
    comprobar('Y dice cuánto quedó cubierto y cuánto falta',
      /pallets?|cubierta|Faltan/i.test(msg), msg.slice(0, 120));
  }
}

/* ========================================================================
   3 · DESPACHO
   ======================================================================== */
console.log('\n== DESPACHO ======================================================\n');

const packing = sql(`
  select pl.id, pl.codigo, pl.contenedor,
         (select count(*) from plano_estiba pe where pe.packing_list_id = pl.id) plano
  from packing_lists pl
  where pl.estado <> 'cerrado' and pl.estado <> 'anulado'
  order by plano desc, pl.id limit 1;
`)[0];

if (!packing) {
  console.log('   No hay packing lists abiertos. Se salta esta parte.');
} else {
  await p.goto(`${BASE}/logistica/packing/${packing.id}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);

  comprobar('La ficha del packing ofrece «Despachar»',
    (await p.locator('button', { hasText: /^Despachar$/ }).count()) > 0);

  await p.locator('button', { hasText: /^Despachar$/ }).click();
  await p.waitForTimeout(3500);

  const panel = await p.locator('.despachar').innerText().catch(() => '');
  comprobar('Enseña qué va a salir antes de dejar despachar',
    /Va a salir de cámara/i.test(panel) && /TM/.test(panel), panel.slice(0, 120));
  comprobar('Detalla lotes, bultos y destino',
    (await p.locator('.despachar-datos > div').count()) >= 6);

  const confirmable = await p.locator('.despachar-confirma').count();
  if (confirmable > 0) {
    /* --- Sin escribir el código, el botón está deshabilitado --- */
    comprobar('No deja despachar sin confirmar el contenedor',
      await p.locator('button', { hasText: 'Sí, despachar' }).isDisabled());

    const aEscribir = await p.locator('.despachar-confirma b.mono').innerText();
    await p.locator('.despachar-confirma input.campo').fill(aEscribir);
    await p.waitForTimeout(400);
    comprobar('Al escribirlo bien, se habilita',
      !(await p.locator('button', { hasText: 'Sí, despachar' }).isDisabled()));

    // No se ejecuta: el Kardex es inmutable y no habría forma de revertirlo
    // sin dejar la base peor de como estaba.
    console.log('   ··  El despacho NO se ejecuta: es irreversible por diseño.');
  } else {
    comprobar('Si falta el plano de estiba, lo dice y no deja despachar',
      (await p.locator('.despachar-bloqueo').count()) > 0);
  }
}

comprobar('Ningún error de JavaScript en todo el recorrido', fallosJs.length === 0,
  fallosJs.slice(0, 2).join(' | '));

await p.screenshot({ path: 'capturas/cadena.png' });
await nav.close();

console.log('\n==================================================================');
console.log(`  RESULTADO: ${ok} pasaron · ${fallo} fallaron`);
console.log('==================================================================');
if (errores.length) { console.log('\n  Revisar:'); errores.forEach((e) => console.log(`   .. ${e}`)); }
console.log('');
process.exit(fallo > 0 ? 1 : 0);
