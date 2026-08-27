/**
 * ============================================================================
 *  PRUEBA DE APARTAR STOCK
 * ============================================================================
 *  Lo que importa no es que el botón exista, sino que apartar tenga EFECTO
 *  medible: que el disponible del lote baje exactamente lo apartado, que el
 *  avance del pedido suba, y que las validaciones muerdan.
 *
 *  Al final se revierte todo: la reserva creada se borra y se comprueba que el
 *  disponible volvió a su valor original.
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

/** Consulta directa a la base, para medir el efecto real. */
function sql(consulta) {
  const salida = execFileSync('node', ['scripts/db.mjs', '-q', consulta], { encoding: 'utf8' });
  const i = salida.indexOf('[');
  return i === -1 ? [] : JSON.parse(salida.slice(i));
}

console.log('\n== APARTAR STOCK =================================================\n');

/*
 * La red de seguridad.
 *
 * Se apunta el último id de reserva ANTES de empezar. Si la prueba se cae a
 * mitad —un selector que cambió, una espera corta—, la limpieza del final
 * nunca se ejecuta y queda stock apartado de mentira. Ya pasó: una corrida
 * rota dejó 500 kg retenidos que hubo que buscar a mano.
 *
 * Con esto, cualquier reserva creada durante la prueba se borra al terminar,
 * termine bien o termine mal.
 */
const ultimoIdPrevio = Number(sql('select coalesce(max(id), 0) m from reservas;')[0].m);

function limpiarLoCreado() {
  const sobrantes = sql(`select id from reservas where id > ${ultimoIdPrevio};`);
  if (sobrantes.length === 0) return 0;
  sql(`delete from reservas where id > ${ultimoIdPrevio};`);
  return sobrantes.length;
}

process.on('exit', () => {
  const n = limpiarLoCreado();
  if (n > 0) console.log(`
   [limpieza] Se borraron ${n} reserva(s) creadas por la prueba.`);
});


/* ---- Se busca un pedido con línea sin cubrir y con stock disponible ---- */
const candidatos = sql(`
  select pl.id linea_id, p.id pedido_id, p.numero_proforma,
         pl.cantidad_tm,
         coalesce((select sum(r.peso_neto_kg) from reservas r
                   where r.pedido_linea_id = pl.id
                     and r.estado in ('activa','en_preparacion','consumida')), 0) apartado_kg,
         (select count(*) from v_stock_lote v
           where v.sku_presentacion_id = pl.sku_presentacion_id and v.disponible_kg > 0) lotes
  from pedido_lineas pl
  join pedidos p on p.id = pl.pedido_id
  where p.situacion not in ('facturado','parcialmente_cobrado','cobrado')
  order by lotes desc, pl.id
  limit 40;
`);

const caso = candidatos.find(
  (c) => Number(c.lotes) > 0 && Number(c.apartado_kg) < Number(c.cantidad_tm) * 1000 - 100
);

if (!caso) {
  console.log('   No hay ninguna línea con stock disponible por apartar. Nada que probar.');
  process.exit(0);
}

console.log(`   Caso: pedido ${caso.numero_proforma}, línea ${caso.linea_id}`);
console.log(`   Pedidas ${caso.cantidad_tm} TM · ya apartados ${Number(caso.apartado_kg).toFixed(1)} kg\n`);

const nav = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await nav.newContext({ viewport: { width: 1500, height: 1100 } });
const p = await ctx.newPage();
const fallosJs = [];
p.on('pageerror', (e) => fallosJs.push(e.message));

await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await p.fill('input[type="email"]', 'gerencia@santamonica.pe');
await p.fill('input[type="password"]', 'SantaMonica2026');
await p.click('button[type="submit"]');
await p.waitForURL(/\/panel/, { timeout: 30000 });

await p.goto(`${BASE}/ventas/pedidos/${caso.pedido_id}?t=disponibilidad`, { waitUntil: 'networkidle' });
await p.waitForTimeout(2000);

comprobar('La pestaña de cobertura ofrece «Apartar stock»',
  (await p.locator('button', { hasText: 'Apartar stock' }).count()) > 0);

/* ---- Se abre el panel ---- */
await p.locator('button', { hasText: 'Apartar stock' }).first().click();
await p.waitForTimeout(3500);

comprobar('Se abre el panel con los lotes candidatos',
  (await p.locator('.reservar').count()) > 0);

const filasLote = await p.locator('.reservar table.datos tbody tr').count();
comprobar('Trae lotes del mismo producto con saldo', filasLote > 0, `${filasLote} lotes`);

/* ---- El orden tiene que ser del más antiguo al más nuevo ---- */
const meses = (await p.locator('.reservar table.datos tbody tr td:nth-child(4)').allInnerTexts())
  .map((t) => Number(t.replace(',', '.')));
const ordenado = meses.every((m, i) => i === 0 || meses[i - 1] >= m - 0.01);
comprobar('Los lotes salen del más antiguo al más nuevo', ordenado,
  meses.slice(0, 5).join(' → '));

const cabecera = await p.locator('.reservar-cab').innerText();
comprobar('Dice cuánto falta por apartar', /faltan|cubierta/i.test(cabecera), cabecera.replace(/\n/g, ' · '));

/* ---- Se mide el disponible ANTES ---- */
const palletElegido = (await p.locator('.reservar table.datos tbody tr td:first-child').first().innerText()).trim();
const antes = sql(`
  select v.lote_id, v.almacen_id, round(v.disponible_kg::numeric, 3) disponible
  from v_stock_lote v join lotes l on l.id = v.lote_id
  where l.codigo_pallet = '${palletElegido}' and v.disponible_kg > 0 limit 1;
`)[0];

comprobar('Se pudo medir el disponible del pallet elegido', !!antes, palletElegido);

/* ---- Se elige y se aparta ---- */
await p.locator('.reservar table.datos tbody tr').first()
  .locator('button', { hasText: 'Elegir' }).click();
await p.waitForTimeout(600);

comprobar('La fila elegida se resalta',
  (await p.locator('.reservar table.datos tr[data-elegido="si"]').count()) === 1);

const cajaKg = p.locator('.reservar-confirma input.campo');
const propuesto = Number(await cajaKg.inputValue());
comprobar('Propone una cantidad ya calculada', propuesto > 0, `${propuesto} kg`);

const ayuda = await p.locator('.reservar-campo small').innerText();
comprobar('Y convierte los kilos a bultos', /bultos de/.test(ayuda), ayuda.slice(0, 80));

/* --- Pasarse del tope tiene que rechazarse --- */
await cajaKg.fill(String(Math.round(propuesto * 10 + 5000)));
await p.locator('button', { hasText: /^Apartar$/ }).click();
await p.waitForTimeout(3000);
const rechazo = await p.locator('.ficha-aviso-critico').innerText().catch(() => '');
comprobar('Apartar más de lo posible se rechaza y se explica',
  /solo quedan|se pasar[íi]a de lo pedido/i.test(rechazo), rechazo.slice(0, 100));

/* --- Ahora la cantidad correcta --- */
const aApartar = Math.min(propuesto, 500);
await cajaKg.fill(String(aApartar));
await p.locator('button', { hasText: /^Apartar$/ }).click();
await p.waitForTimeout(4000);

const confirma = await p.locator('.ficha-aviso-info').innerText().catch(() => '');
comprobar('Se aparta y lo confirma con el pallet y los kilos',
  /Apartados/i.test(confirma), confirma.slice(0, 110));

/* ---- Se mide el disponible DESPUÉS: es la prueba de verdad ---- */
const despues = sql(`
  select round(v.disponible_kg::numeric, 3) disponible
  from v_stock_lote v
  where v.lote_id = ${antes.lote_id} and v.almacen_id = ${antes.almacen_id};
`)[0];

const bajo = Number(antes.disponible) - Number(despues?.disponible ?? 0);
comprobar(
  'El disponible del pallet bajó exactamente lo apartado',
  Math.abs(bajo - aApartar) < 0.5,
  `bajó ${bajo.toFixed(1)} kg y se apartaron ${aApartar} kg`
);

/* ---- Y la línea que se cubrió registra el apartado ----
   Se lee cuál fue la reserva creada en vez de suponerla: la pantalla puede
   ofrecer varias líneas y el botón que se pulsó no tiene por qué ser el de la
   línea que eligió la consulta de arriba. Suponerlo hacía que la prueba
   verificara una línea y limpiara otra, dejando stock apartado de mentira. */
const creada = sql(`
  select r.id, r.pedido_linea_id, round(r.peso_neto_kg::numeric, 1) kg
  from reservas r
  where r.creado_en > now() - interval '5 minutes'
  order by r.creado_en desc limit 1;
`)[0];

comprobar('Quedó registrada la reserva que se acaba de crear',
  !!creada && Math.abs(Number(creada.kg) - aApartar) < 0.5,
  creada ? `reserva ${creada.id} · ${creada.kg} kg` : 'no se encontró');

const avance = creada ? sql(`
  select round(sum(r.peso_neto_kg)::numeric, 1) apartado
  from reservas r where r.pedido_linea_id = ${creada.pedido_linea_id}
    and r.estado in ('activa','en_preparacion','consumida');
`)[0] : null;
comprobar('La línea del pedido registra el apartado',
  Number(avance?.apartado ?? 0) >= aApartar - 0.5,
  `${avance?.apartado} kg apartados en total`);

/* ---- Aparece en la pantalla de Reservas ---- */
await p.goto(`${BASE}/almacenes/reservas`, { waitUntil: 'networkidle' });
await p.waitForTimeout(2000);
comprobar('La reserva nueva aparece en Almacenes → Reservas',
  (await p.locator('table.datos tbody tr').filter({ hasText: palletElegido }).count()) > 0);

comprobar('Ningún error de JavaScript', fallosJs.length === 0, fallosJs.slice(0, 2).join(' | '));

await p.screenshot({ path: 'capturas/reservar.png', fullPage: false });
await nav.close();

/* ========================================================================
   REVERSIÓN · la prueba no puede dejar stock apartado de mentira
   ======================================================================== */
console.log('\n== REVERSIÓN =====================================================\n');

// Se borra POR ID la reserva que se creó, no por línea: es la única forma de
// no dejar nada y de no tocar reservas que ya existían.
// Se borra todo lo que la prueba haya creado, no solo la última: si una
// validación dejara pasar algo de más, aquí se cae igual.
limpiarLoCreado();

const final = sql(`
  select round(v.disponible_kg::numeric, 3) disponible
  from v_stock_lote v
  where v.lote_id = ${antes.lote_id} and v.almacen_id = ${antes.almacen_id};
`)[0];

comprobar(
  'Al borrar la reserva, el disponible volvió a su valor original',
  Math.abs(Number(final?.disponible ?? 0) - Number(antes.disponible)) < 0.5,
  `${final?.disponible} contra ${antes.disponible} original`
);

console.log('\n==================================================================');
console.log(`  RESULTADO: ${ok} pasaron · ${fallo} fallaron`);
console.log('==================================================================');
if (errores.length) { console.log('\n  Revisar:'); errores.forEach((e) => console.log(`   .. ${e}`)); }
console.log('');
process.exit(fallo > 0 ? 1 : 0);
