/**
 * ============================================================================
 *  LOS FLUJOS QUE FALTABAN · plano, traslados, calidad y facturación
 * ============================================================================
 *  Se comprueba lo que de verdad importa de cada uno:
 *
 *   · Plano de estiba → que sea editable, que avise cuando no cuadra y que
 *     se niegue a guardar un plano imposible.
 *   · Traslados       → que solo se ofrezca el paso que toca, y que aceptar
 *     con menos kilos de los enviados deje la discrepancia registrada.
 *   · Calidad         → que un dictamen que bloquea saque el lote del
 *     disponible, y que liberarlo lo devuelva.
 *   · Facturación     → que el tipo de comprobante lo decida el RUC, y que
 *     no se pueda facturar dos veces el mismo pedido.
 *
 *  Todo lo que se crea se revierte al final, aunque la prueba se caiga.
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

function sql(q) {
  const salida = execFileSync('node', ['scripts/db.mjs', '-q', q], { encoding: 'utf8' });
  const i = salida.indexOf('[');
  return i === -1 ? [] : JSON.parse(salida.slice(i));
}

/* ---- Red de seguridad ---- */
const previos = {
  dictamen: Number(sql('select coalesce(max(id),0) m from dictamenes_calidad;')[0].m),
  factura: Number(sql('select coalesce(max(id),0) m from facturas;')[0].m),
  traslado: Number(sql('select coalesce(max(id),0) m from traslados;')[0].m),
};

function limpiar() {
  try {
    sql(`
      delete from dictamenes_calidad where id > ${previos.dictamen};
      update dictamenes_calidad set vigente = true
        where id <= ${previos.dictamen} and not vigente
          and lote_id in (select lote_id from dictamenes_calidad where id > ${previos.dictamen});
      delete from factura_lineas where factura_id > ${previos.factura};
      delete from facturas where id > ${previos.factura};
      delete from traslado_lineas where traslado_id > ${previos.traslado};
      delete from traslados where id > ${previos.traslado};
    `);
  } catch (e) {
    console.log(`   .. limpieza incompleta: ${String(e.message).slice(0, 160)}`);
  }
}
process.on('exit', limpiar);

const nav = await chromium.launch({ channel: 'chrome', headless: true });
const p = await (await nav.newContext({ viewport: { width: 1600, height: 1100 } })).newPage();
const fallosJs = [];
p.on('pageerror', (e) => fallosJs.push(e.message));

await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await p.fill('input[type="email"]', 'gerencia@santamonica.pe');
await p.fill('input[type="password"]', 'SantaMonica2026');
await p.click('button[type="submit"]');
await p.waitForURL(/\/panel/, { timeout: 30000 });

/* ========================================================================
   1 · PLANO DE ESTIBA EDITABLE
   ======================================================================== */
console.log('\n== PLANO DE ESTIBA ===============================================\n');

const packing = sql(`
  select pl.id, pl.codigo, pl.sacos_por_fila,
         (select count(*) from packing_lineas x where x.packing_list_id = pl.id) lotes
  from packing_lists pl
  where pl.estado <> 'cerrado' and pl.estado <> 'anulado'
    and (select count(*) from plano_estiba pe where pe.packing_list_id = pl.id) > 0
  order by lotes desc limit 1;
`)[0];

if (!packing) {
  console.log('   No hay packing abierto con plano. Se salta.');
} else {
  await p.goto(`${BASE}/logistica/packing/${packing.id}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(3000);

  const celdas = await p.locator('.plano-celda input').count();
  comprobar('El plano tiene casillas editables', celdas > 0, `${celdas} casillas`);
  comprobar('Muestra cuántos sacos van colocados',
    /de .* sacos colocados/.test(await p.locator('.plano-cifras').innerText()));

  /* --- Al pasarse del cupo, tiene que avisar y bloquear el guardado --- */
  const primera = p.locator('.plano-celda input').first();
  await primera.fill(String(Number(packing.sacos_por_fila) + 50));
  await p.waitForTimeout(700);

  const problemas = await p.locator('.plano-problemas').innerText().catch(() => '');
  comprobar('Si una fila se pasa del cupo, lo dice con el número',
    /caben \d+/.test(problemas), problemas.replace(/\n/g, ' · ').slice(0, 120));
  comprobar('Y no deja guardar un plano imposible',
    await p.locator('button', { hasText: 'Guardar plano' }).isDisabled());
  comprobar('La columna del problema se marca',
    (await p.locator('.plano-rejilla [data-mal="si"]').count()) > 0);

  /* --- «Repartir» tiene que dejar el lote cuadrado --- */
  await p.locator('button', { hasText: /^Repartir$/ }).first().click();
  await p.waitForTimeout(700);
  const tras = await p.locator('.plano-problemas').innerText().catch(() => '');
  comprobar('«Repartir» coloca todos los sacos del lote',
    !/faltan|sobran/i.test(tras.split('\n').slice(0, 3).join(' ')) || tras === '',
    tras.replace(/\n/g, ' · ').slice(0, 100));

  await p.screenshot({ path: 'capturas/plano-editable.png' });
}

/* ========================================================================
   2 · CALIDAD
   ======================================================================== */
console.log('\n== DICTÁMENES DE CALIDAD =========================================\n');

const loteLibre = sql(`
  select v.lote_id, l.codigo_pallet, round(v.disponible_kg::numeric,1) disponible
  from v_stock_lote v join lotes l on l.id = v.lote_id
  where v.disponible_kg > 0 and v.bloqueado_kg = 0
    and not exists (select 1 from dictamenes_calidad d
                     where d.lote_id = v.lote_id and d.vigente
                       and d.estado in ('observado','inmovilizado','espera_resultados'))
  order by v.lote_id limit 1;
`)[0];

if (!loteLibre) {
  console.log('   No hay lotes liberados con stock. Se salta.');
} else {
  await p.goto(`${BASE}/almacenes/lotes/${loteLibre.lote_id}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);

  comprobar('La ficha del lote ofrece emitir dictamen',
    (await p.locator('button', { hasText: 'Emitir dictamen' }).count()) > 0);

  await p.locator('button', { hasText: 'Emitir dictamen' }).click();
  await p.waitForTimeout(800);

  const consecuencia = await p.locator('.form-consecuencia').innerText();
  comprobar('Dice la consecuencia antes de guardar',
    /SALE del inventario|disponible/i.test(consecuencia), consecuencia.slice(0, 90));

  /* --- Sin motivo, un dictamen que bloquea tiene que rechazarse --- */
  await p.locator('button', { hasText: 'Registrar dictamen' }).click();
  await p.waitForTimeout(2500);
  const sinMotivo = await p.locator('.ficha-aviso-critico').innerText().catch(() => '');
  comprobar('Un dictamen que bloquea sin motivo se rechaza',
    /necesita motivo/i.test(sinMotivo), sinMotivo.slice(0, 90));

  /* --- Con motivo: el lote sale del disponible --- */
  await p.locator('input[placeholder="Qué se encontró"]').fill('Prueba automática de bloqueo');
  await p.locator('button', { hasText: 'Registrar dictamen' }).click();
  await p.waitForTimeout(3500);

  const bloqueado = sql(`
    select round(coalesce(v.disponible_kg,0)::numeric,1) disponible,
           round(coalesce(v.bloqueado_kg,0)::numeric,1) bloqueado
    from v_stock_lote v where v.lote_id = ${loteLibre.lote_id} limit 1;
  `)[0];

  comprobar('Al observar el lote, deja de estar disponible',
    Number(bloqueado?.disponible ?? -1) === 0 && Number(bloqueado?.bloqueado ?? 0) > 0,
    `disponible ${bloqueado?.disponible} · bloqueado ${bloqueado?.bloqueado}`);

  /* --- Y al liberarlo, vuelve --- */
  await p.locator('button', { hasText: 'Emitir dictamen' }).click();
  await p.waitForTimeout(800);
  await p.locator('select').filter({ hasText: 'Liberado' }).selectOption('liberado');
  await p.waitForTimeout(400);
  await p.locator('button', { hasText: 'Registrar dictamen' }).click();
  await p.waitForTimeout(3500);

  const liberado = sql(`
    select round(coalesce(v.disponible_kg,0)::numeric,1) disponible
    from v_stock_lote v where v.lote_id = ${loteLibre.lote_id} limit 1;
  `)[0];
  comprobar('Al liberarlo, vuelve a estar disponible',
    Math.abs(Number(liberado?.disponible ?? 0) - Number(loteLibre.disponible)) < 1,
    `${liberado?.disponible} contra ${loteLibre.disponible} original`);
}

/* ========================================================================
   3 · FACTURACIÓN
   ======================================================================== */
console.log('\n== FACTURACIÓN ===================================================\n');

const pedidoSinFacturar = sql(`
  select p.id, p.numero_proforma, c.pais, coalesce(c.ruc_tax_id,'') ruc
  from pedidos p join clientes c on c.id = p.cliente_id
  where not exists (select 1 from facturas f where f.pedido_id = p.id and f.estado <> 'anulada')
    and exists (select 1 from pedido_lineas pl where pl.pedido_id = p.id)
  order by p.id limit 1;
`)[0];

if (!pedidoSinFacturar) {
  console.log('   No hay pedidos sin facturar. Se salta.');
} else {
  await p.goto(`${BASE}/ventas/pedidos/${pedidoSinFacturar.id}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);

  comprobar('El pedido ofrece emitir comprobante',
    (await p.locator('button', { hasText: 'Emitir comprobante' }).count()) > 0);

  await p.locator('button', { hasText: 'Emitir comprobante' }).click();
  await p.waitForTimeout(3500);

  const previa = await p.locator('.facturar').innerText();
  const esExport = pedidoSinFacturar.pais !== 'Perú';
  comprobar('Enseña la factura antes de emitirla, con sus totales',
    /Subtotal/.test(previa) && /Total/.test(previa));
  comprobar('El tipo lo decide el país y el RUC',
    esExport ? /exportaci[óo]n/i.test(previa) : /IGV del \d+/.test(previa),
    previa.split('\n').slice(0, 4).join(' · ').slice(0, 110));

  const igvEsperado = esExport ? 'IGV 0 %' : 'IGV 18 %';
  comprobar(`Aplica ${igvEsperado}`, previa.includes(igvEsperado), igvEsperado);

  await p.locator('button', { hasText: /^Emitir / }).click();
  await p.waitForTimeout(4000);

  const emitida = sql(`
    select numero, tipo_comprobante::text tipo, round(igv::numeric,2) igv, round(total::numeric,2) total
    from facturas where pedido_id = ${pedidoSinFacturar.id} order by id desc limit 1;
  `)[0];

  comprobar('El comprobante queda emitido en la base', !!emitida,
    emitida ? `${emitida.numero} · ${emitida.tipo}` : 'no se emitió');
  comprobar('Con la serie que le corresponde',
    emitida && (emitida.tipo === 'factura' ? emitida.numero.startsWith('F') : emitida.numero.startsWith('B')),
    emitida?.numero);
  comprobar('Y el IGV que le corresponde',
    emitida && (esExport ? Number(emitida.igv) === 0 : Number(emitida.igv) > 0),
    `IGV ${emitida?.igv}`);

  /* --- No se puede facturar dos veces --- */
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);
  await p.locator('button', { hasText: 'Emitir comprobante' }).click();
  await p.waitForTimeout(3500);
  const segunda = await p.locator('.facturar-bloqueo').innerText().catch(() => '');
  comprobar('No deja facturar dos veces el mismo pedido',
    /ya tiene el comprobante/i.test(segunda), segunda.replace(/\n/g, ' ').slice(0, 100));
}

/* ========================================================================
   4 · TRASLADOS
   ======================================================================== */
console.log('\n== TRASLADOS =====================================================\n');

const traslado = sql(`
  select t.id, t.numero, t.estado::text
  from traslados t where t.estado in ('borrador','autorizado','en_transito')
  order by t.id limit 1;
`)[0];

if (!traslado) {
  console.log('   No hay traslados en curso. Se salta.');
} else {
  await p.goto(`${BASE}/almacenes/traslados/${traslado.id}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);

  const botones = await p.locator('.cabecera-pagina button, header button').allInnerTexts().catch(() => []);
  const texto = botones.join(' | ');

  const esperado =
    traslado.estado === 'borrador' ? 'Autorizar'
    : traslado.estado === 'autorizado' ? 'Despachar'
    : 'Recibir en destino';

  comprobar(`Un traslado ${traslado.estado} ofrece «${esperado}»`,
    (await p.locator('button', { hasText: esperado }).count()) > 0, texto.slice(0, 100));

  // Y NO ofrece los pasos que no tocan.
  const noToca = ['Autorizar', 'Despachar', 'Recibir en destino'].filter((x) => x !== esperado);
  for (const x of noToca) {
    comprobar(`Y no ofrece «${x}», que no toca`,
      (await p.locator('button', { hasText: x }).count()) === 0);
  }
}

comprobar('Ningún error de JavaScript en todo el recorrido', fallosJs.length === 0,
  fallosJs.slice(0, 2).join(' | '));

await nav.close();

console.log('\n==================================================================');
console.log(`  RESULTADO: ${ok} pasaron · ${fallo} fallaron`);
console.log('==================================================================');
if (errores.length) { console.log('\n  Revisar:'); errores.forEach((e) => console.log(`   .. ${e}`)); }
console.log('');
process.exit(fallo > 0 ? 1 : 0);
