/**
 * ============================================================================
 *  PRUEBA DE LA LISTA DE PEDIDOS
 * ============================================================================
 *  Las observaciones de Oliver sobre esta pantalla:
 *   · Que se retire la columna «Origen» y entre el producto.
 *   · Tarjetas con la cantidad de pedidos, el peso y el valor, filtrables.
 *   · Poder ver el acumulado por cliente.
 *   · Que los urgentes salgan primero.
 *   · Distinguir el compromiso con el cliente de la salida programada.
 *
 *      node scripts/probar-pedidos.mjs
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

const nav = await chromium.launch({ channel: 'chrome', headless: true });
const p = await (await nav.newContext({ viewport: { width: 1600, height: 1100 } })).newPage();

try {
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', 'gerencia@santamonica.pe');
  await p.fill('input[type="password"]', 'SantaMonica2026');
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/panel/, { timeout: 25000 });

  console.log('\n─── 1 · Las columnas ───');
  await p.goto(`${BASE}/ventas/pedidos`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2200);

  // innerText devuelve el texto YA en mayúsculas por el CSS de la cabecera.
  const cab = (await p.locator('table.datos thead th').allInnerTexts()).map((t) => t.trim());
  console.log('   columnas:', cab.join(' · '));
  ok(!cab.includes('ORIGEN'), 'se quitó la columna Origen');
  ok(cab.includes('PRODUCTO'), 'aparece la columna Producto');
  ok(cab.includes('COMPROMISO'), 'sigue el compromiso con el cliente');
  ok(cab.some((c) => /SALIDA PROG/.test(c)), 'y entra la salida programada, que es otra cosa');
  ok(cab.some((c) => /VENTA US\$/.test(c)), 'la venta va en dólares');

  const conProducto = await p.locator('table.datos tbody tr td:nth-child(4)').allInnerTexts();
  ok(conProducto.filter((t) => t.trim() && t.trim() !== '—').length > 0,
     'las filas traen el producto', `${conProducto.filter((t) => t.trim() !== '—').length} de ${conProducto.length}`);

  console.log('\n─── 2 · Las tarjetas dicen la verdad ───');
  const cuerpo = await p.locator('body').innerText();
  for (const etiqueta of ['PEDIDOS', 'TONELADAS', 'VALOR DE LA VENTA', 'CLIENTES DISTINTOS']) {
    ok(cuerpo.includes(etiqueta), `hay tarjeta de «${etiqueta.toLowerCase()}»`);
  }

  {
    // El total de las tarjetas contra la base, con los mismos criterios.
    const [r] = await consultar(`
      select count(*) as pedidos,
             round(sum(tm_pedidas)::numeric, 1) as tm,
             round(sum(venta_usd)::numeric) as venta,
             count(distinct cliente_id) as clientes
        from v_pedidos_tablero`);
    const kpis = await p.locator('.kpi-valor').allInnerTexts();
    const numero = (t) => Number(String(t).replace(/[^\d.-]/g, ''));

    ok(numero(kpis[0]) === Number(r.pedidos),
       'la tarjeta de pedidos coincide con la base', `${kpis[0]} vs ${r.pedidos}`);
    ok(Math.abs(numero(kpis[1]) - Number(r.tm)) < 1,
       'la de toneladas coincide', `${kpis[1]} vs ${r.tm}`);
    ok(Math.abs(numero(kpis[2]) - Number(r.venta)) < 2,
       'la del valor coincide', `${kpis[2]} vs ${r.venta}`);
    ok(numero(kpis[4]) === Number(r.clientes),
       'la de clientes distintos coincide', `${kpis[4]} vs ${r.clientes}`);
  }

  console.log('\n─── 3 · Las tarjetas obedecen al filtro ───');
  {
    await p.goto(`${BASE}/ventas/pedidos?vista=urgentes`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1800);
    const [r] = await consultar(
      `select count(*) as n from v_pedidos_tablero where prioridad = 'urgente'`);
    const kpis = await p.locator('.kpi-valor').allInnerTexts();
    const n = Number(String(kpis[0]).replace(/[^\d]/g, ''));
    ok(n === Number(r.n),
       'al filtrar por urgentes, la tarjeta cuenta solo esos', `${n} vs ${r.n}`);
    ok(n > 0 && n < 443, 'y es un subconjunto, no el total');
  }

  console.log('\n─── 4 · Los urgentes salen primero ───');
  {
    await p.goto(`${BASE}/ventas/pedidos?orden=prioridad`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1800);
    const prioridades = (await p.locator('table.datos tbody tr td:nth-last-child(2)').allInnerTexts())
      .map((t) => t.trim().toUpperCase());
    ok(prioridades[0] === 'URGENTE',
       'la primera fila es urgente', prioridades.slice(0, 3).join(' · '));

    const peso = { URGENTE: 4, ALTA: 3, NORMAL: 2, BAJA: 1 };
    const desciende = prioridades.every(
      (v, i) => i === 0 || (peso[v] ?? 0) <= (peso[prioridades[i - 1]] ?? 0));
    ok(desciende, 'y la prioridad no vuelve a subir en toda la página');
  }

  console.log('\n─── 5 · El acumulado por cliente ───');
  {
    await p.goto(`${BASE}/ventas/pedidos?agrupar=cliente`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(2000);
    const cabC = (await p.locator('table.datos thead th').allInnerTexts()).map((t) => t.trim());
    ok(cabC.includes('CLIENTE') && cabC.includes('PEDIDOS') && cabC.includes('TONELADAS'),
       'la tabla cambia a resumen por cliente', cabC.join(' · '));
    ok(cabC.some((c) => /PARTICIPACI/.test(c)), 'con su participación sobre el total');

    const filas = await p.locator('table.datos tbody tr').count();
    const [r] = await consultar(
      `select count(distinct cliente_id) as n from v_pedidos_tablero`);
    ok(filas === Number(r.n), 'hay una fila por cliente', `${filas} vs ${r.n}`);

    // El primero tiene que ser el de mayor valor.
    const valores = (await p.locator('table.datos tbody tr td:nth-child(4)').allInnerTexts())
      .map((t) => Number(t.replace(/[^\d]/g, '')));
    ok(valores.every((v, i) => i === 0 || v <= valores[i - 1]),
       'ordenado de mayor a menor valor');

    // Y la suma por cliente tiene que dar el total de arriba.
    const suma = valores.reduce((s, v) => s + v, 0);
    const [t] = await consultar(`select round(sum(venta_usd)::numeric) as v from v_pedidos_tablero`);
    ok(Math.abs(suma - Number(t.v)) / Number(t.v) < 0.001,
       'la suma por cliente cuadra con el total general',
       `${suma.toLocaleString('es-PE')} vs ${Number(t.v).toLocaleString('es-PE')}`);
  }

  console.log('\n─── 6 · Compromiso y salida programada son distintos ───');
  {
    const [r] = await consultar(`
      select count(*) filter (where fecha_salida_programada is not null) as con_salida,
             count(*) filter (where desfase_programacion > 0) as tarde
        from v_pedidos_tablero`);
    ok(Number(r.con_salida) > 0, 'hay pedidos con salida programada', `${r.con_salida}`);
    ok(Number(r.tarde) > 0,
       'y algunos programados por detrás de lo prometido', `${r.tarde} pedidos`);

    await p.goto(`${BASE}/ventas/pedidos?orden=compromiso`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1800);
    const texto = await p.locator('table.datos').first().innerText();
    ok(/D TARDE|SIN PROGRAMAR/i.test(texto),
       'la tabla distingue lo programado tarde de lo que no tiene fecha');
  }

  console.log('\n─── 7 · Los atajos ───');
  for (const [ruta, nombre] of [
    ['/ventas/pedidos?agrupar=cliente', 'Acumulado por cliente'],
    ['/ventas/pedidos?orden=prioridad', 'Urgentes primero'],
    ['/ventas/pedidos?orden=valor', 'Por valor'],
    ['/ventas/pedidos?campo_fecha=fecha_salida_programada&desde=2026-01-01', 'Por salida programada'],
  ]) {
    const r = await p.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1300);
    const t = await p.locator('body').innerText();
    ok(r.ok() && !/Application error/i.test(t), `«${nombre}» responde`);
  }
  console.log('\n─── 8 · Los contenedores, numerados dentro de la proforma ───');
  {
    const [caso] = await consultar(`
      select pedido_id, numero_proforma
        from v_pedido_contenedores
       where total_contenedores > 1
       order by pedido_id limit 1`);
    ok(Boolean(caso), 'hay algún pedido repartido en varios contenedores');

    const filas = await consultar(
      `select referencia, secuencia, total_contenedores, packing_codigo, proformas_dentro
         from v_pedido_contenedores where pedido_id = ${caso.pedido_id} order by secuencia`);

    ok(filas.every((f, i) => Number(f.secuencia) === i + 1),
       'la secuencia va 1, 2, 3… sin saltos',
       filas.map((f) => f.secuencia).join(', '));
    ok(filas.every((f) => f.referencia === `${caso.numero_proforma}-${f.secuencia}`),
       'la referencia es la proforma más el número de contenedor',
       filas.map((f) => f.referencia).join(' · '));
    ok(new Set(filas.map((f) => f.packing_codigo)).size === filas.length,
       'cada referencia apunta a un packing distinto');

    await p.goto(`${BASE}/ventas/pedidos/${caso.pedido_id}?t=embarques`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(2000);
    const ficha = await p.locator('body').innerText();
    ok(ficha.includes(filas[0].referencia), 'la ficha del pedido muestra la referencia',
       filas[0].referencia);
    ok(/CONTENEDOR 1 DE \d/i.test(ficha), 'y dice «contenedor 1 de N»');
    ok(/PL POT/i.test(ficha), 'sin perder el código propio del packing');

    // Un contenedor compartido tiene que avisarlo: sus toneladas no son todas
    // de este pedido.
    if (filas.some((f) => Number(f.proformas_dentro) > 1)) {
      ok(/comparte con otra proforma/i.test(ficha),
         'avisa cuando el contenedor lleva otra proforma dentro');
    }
  }

  console.log('\n─── 9 · El producto en Control de pedidos ───');
  {
    await p.goto(`${BASE}/ventas/control`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(2000);
    const cabC = (await p.locator('table.datos thead th').allInnerTexts()).map((t) => t.trim());
    ok(cabC.includes('PRODUCTO'), 'la tabla trae la columna Producto', cabC.join(' · '));

    const prods = await p.locator('table.datos tbody tr td:nth-child(4)').allInnerTexts();
    const llenos = prods.filter((t) => t.trim() && t.trim() !== '—').length;
    ok(llenos > 0, 'y las filas la traen llena', `${llenos} de ${prods.length}`);
  }
} finally {
  await nav.close();
}

console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo correcto');
process.exit(fallos.length ? 1 : 0);
