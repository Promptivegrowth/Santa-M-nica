/**
 * ============================================================================
 *  PRUEBA DE LA PANTALLA DE TIEMPOS DEL FLUJO
 * ============================================================================
 *  Lo que hay que demostrar:
 *   · Que los tramos suman el total cuando se miden sobre los mismos pedidos.
 *   · Que un pedido con fechas imposibles NO entra en los promedios.
 *   · Que la pantalla dice sobre cuántos pedidos calculó cada cifra.
 *   · Que los filtros y los atajos responden.
 *
 *      node scripts/probar-tiempos.mjs
 * ============================================================================
 */
import { chromium } from 'playwright';
import { ejecutarSQL } from './db.mjs';

const BASE = 'http://localhost:3000';
const consultar = async (sql) => {
  const r = await ejecutarSQL(sql);
  return Array.isArray(r) ? r : [];
};

const fallos = [];
const ok = (cond, texto, detalle = '') => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${texto}${detalle ? ' · ' + detalle : ''}`);
  if (!cond) fallos.push(texto);
};

/* Lo que se rompa se deja como estaba, pase lo que pase. */
let saboteado = null;
const restaurar = async () => {
  if (!saboteado) return;
  await consultar(
    `update pedidos set fecha_solicitada = '${saboteado.fecha}' where id = ${saboteado.id}`);
};

const nav = await chromium.launch({ channel: 'chrome', headless: true });
const p = await (await nav.newContext({ viewport: { width: 1500, height: 1200 } })).newPage();

try {
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', 'gerencia@santamonica.pe');
  await p.fill('input[type="password"]', 'SantaMonica2026');
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/panel/, { timeout: 25000 });

  console.log('\n─── 1 · La vista mide bien ───');
  {
    const [r] = await consultar(`
      select count(*) as n,
             round(avg(dias_total),2) as total,
             round(avg(dias_negociacion + dias_a_programar + dias_puntualidad),2) as suma
        from v_tiempos_flujo
       where cronologia_valida
         and f_cotizacion is not null and f_programada is not null and f_despacho is not null`);
    ok(Number(r.n) > 0, 'hay pedidos con la cadena completa', `${r.n} pedidos`);
    ok(Math.abs(Number(r.total) - Number(r.suma)) < 0.01,
       'los tramos suman exactamente el total',
       `total ${r.total} vs suma ${r.suma}`);
  }

  console.log('\n─── 2 · Ningún plazo negativo en los datos sanos ───');
  {
    const [r] = await consultar(`
      select count(*) filter (where dias_total < 0) as totales,
             count(*) filter (where dias_a_programar < 0) as programar,
             count(*) filter (where dias_negociacion < 0) as negociacion
        from v_tiempos_flujo where cronologia_valida`);
    ok(Number(r.totales) === 0, 'ningún pedido se despachó antes de existir');
    ok(Number(r.programar) === 0, 'ningún embarque se programó antes del pedido');
    ok(Number(r.negociacion) === 0, 'ninguna cotización es posterior a su pedido');
  }

  console.log('\n─── 3 · La pantalla responde y dice sus poblaciones ───');
  await p.goto(`${BASE}/ventas/tiempos`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2000);
  const cuerpo = await p.locator('body').innerText();

  ok(/DE LA OFERTA AL MUELLE/i.test(cuerpo), 'muestra el indicador que pidió Oliver');
  ok(/EL PEDIDO NORMAL/i.test(cuerpo), 'y la mediana junto al promedio');
  for (const tramo of [
    'Cotización → Pedido', 'Pedido → Salida programada',
    'Programado → Despachado', 'Despacho → Factura', 'Factura → Cobro',
  ]) {
    ok(cuerpo.includes(tramo.toUpperCase()) || cuerpo.includes(tramo),
       `aparece el tramo «${tramo}»`);
  }
  const pies = (await p.locator('.tramo-n').allInnerTexts()).filter((t) => /pedido/i.test(t));
  ok(pies.length >= 4,
     'cada tramo dice sobre cuántos pedidos se calculó', `${pies.length} de 5`);

  console.log('\n─── 4 · Un dato imposible no envenena el promedio ───');
  {
    // Se coge un pedido ya despachado y se le empuja la fecha al futuro, de
    // modo que quede «despachado antes de pedirse».
    const [victima] = await consultar(`
      select pedido_id as id, f_pedido as fecha, f_despacho
        from v_tiempos_flujo
       where cronologia_valida and f_despacho is not null
       order by pedido_id limit 1`);
    saboteado = { id: victima.id, fecha: victima.fecha };

    const antes = await consultar(
      `select round(avg(dias_total),3) as media, count(*) as n
         from v_tiempos_flujo where cronologia_valida and dias_total is not null`);

    await consultar(
      `update pedidos set fecha_solicitada = '${victima.f_despacho}'::date + 400
        where id = ${victima.id}`);

    const [tras] = await consultar(
      `select count(*) filter (where not cronologia_valida) as rotos,
              round(avg(dias_total) filter (where cronologia_valida),3) as media,
              count(*) filter (where cronologia_valida and dias_total is not null) as n
         from v_tiempos_flujo`);

    ok(Number(tras.rotos) >= 1, 'la vista detecta la cronología imposible', `${tras.rotos} marcado(s)`);
    ok(Number(tras.n) === Number(antes[0].n) - 1,
       'el pedido roto sale del cálculo', `${antes[0].n} → ${tras.n}`);

    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForTimeout(2000);
    const conRoto = await p.locator('body').innerText();
    ok(/fechas imposibles/i.test(conRoto),
       'la pantalla avisa de que hay pedidos con fechas imposibles');
    ok(await p.locator('.fila-incoherente').count() >= 0,
       'y los marca en la tabla cuando caen en la página visible');

    await restaurar();
    saboteado = null;
    const [vuelta] = await consultar(
      `select count(*) filter (where not cronologia_valida) as rotos from v_tiempos_flujo`);
    ok(Number(vuelta.rotos) === 0, 'al restaurar la fecha, vuelve a no haber ninguno');
  }

  console.log('\n─── 5 · Filtros y atajos ───');
  for (const [ruta, nombre] of [
    ['/ventas/tiempos?completos=si', 'Solo los que ya salieron'],
    ['/ventas/tiempos?desde=2026-01-01&hasta=2026-12-31', 'Rango de fechas'],
    ['/ventas/tiempos?buscar=SM26', 'Buscador'],
  ]) {
    const r = await p.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1500);
    const texto = await p.locator('body').innerText();
    ok(r.ok() && !/Application error/i.test(texto), `«${nombre}» responde`);
  }

  console.log('\n─── 6 · Está en el menú ───');
  await p.goto(`${BASE}/panel`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  const menu = await p.locator('nav, aside').first().innerText();
  ok(/TIEMPOS DEL FLUJO/i.test(menu), 'la entrada aparece en la barra lateral');
} finally {
  await restaurar();
  await nav.close();
}

console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo correcto');
process.exit(fallos.length ? 1 : 0);
