/**
 * ============================================================================
 *  PRUEBA DEL VENCIMIENTO Y DE LA DISTRIBUCIÓN DEL STOCK
 * ============================================================================
 *  Lo que pidió Oliver:
 *   · Filtros para separar lo YA vencido de lo que está POR vencer.
 *   · Una alerta a Comercial del producto que está por vencerse.
 *   · En existencias, una visual por grupo de producto: «filete 300 toneladas,
 *     aleta 200».
 *
 *  Y lo que hay que vigilar además: que ninguna cifra se calcule sobre las
 *  primeras mil filas. La API corta ahí sin avisar y ya mordió tres veces.
 *
 *      node scripts/probar-vencimiento.mjs
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
const numero = (t) => Number(String(t).replace(/[^\d.-]/g, ''));

try {
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', 'gerencia@santamonica.pe');
  await p.fill('input[type="password"]', 'SantaMonica2026');
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/panel/, { timeout: 25000 });

  console.log('\n─── 1 · El vencimiento se calcula con la vida útil ───');
  {
    const [r] = await consultar(`
      select count(*) as n,
             count(*) filter (where fecha_vencimiento <>
               (fecha_produccion + (vida_util_meses || ' months')::interval)::date) as mal
        from v_anticuamiento where fisico_kg > 0`);
    ok(Number(r.mal) === 0,
       'la fecha de vencimiento es producción + vida útil, lote a lote', `${r.n} lotes`);

    const [c] = await consultar(`
      select count(*) filter (where situacion_vida_util = 'vencido' and dias_para_vencer >= 0) as mal1,
             count(*) filter (where situacion_vida_util = 'vigente' and dias_para_vencer < 0) as mal2
        from v_anticuamiento where fisico_kg > 0`);
    ok(Number(c.mal1) === 0 && Number(c.mal2) === 0,
       'y la situación cuadra con los días que quedan');
  }

  console.log('\n─── 2 · Las tarjetas NO se quedan en mil filas ───');
  {
    const [base] = await consultar(`
      select
        (select lotes from v_anticuamiento_situacion where situacion = 'vencido')     as vencidos,
        (select lotes from v_anticuamiento_situacion where situacion = 'por_vencer')  as por_vencer,
        (select count(*) from v_anticuamiento where fisico_kg > 0)                    as total`);
    ok(Number(base.total) > 1000,
       'hay más de mil lotes, así que el tope de la API es un riesgo real',
       `${base.total} lotes`);

    await p.goto(`${BASE}/almacenes/anticuamiento`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(2500);
    const kpis = await p.locator('.kpi-valor').allInnerTexts();
    const textos = await p.locator('.kpi').allInnerTexts();

    const buscarKpi = (etiqueta) => {
      const i = textos.findIndex((t) => t.toUpperCase().includes(etiqueta));
      return i >= 0 ? numero(kpis[i]) : null;
    };

    ok(buscarKpi('YA VENCIDO') === Number(base.vencidos),
       'la tarjeta de vencidos cuenta TODOS, no los primeros mil',
       `${buscarKpi('YA VENCIDO')} vs ${base.vencidos}`);
    ok(buscarKpi('POR VENCER') === Number(base.por_vencer),
       'y la de por vencer también',
       `${buscarKpi('POR VENCER')} vs ${base.por_vencer}`);
  }

  console.log('\n─── 3 · Los filtros que se pidieron ───');
  {
    for (const [situacion, etiqueta] of [['vencido', 'VENCIDO'], ['por_vencer', 'POR VENCER']]) {
      await p.goto(`${BASE}/almacenes/anticuamiento?situacion=${situacion}`, { waitUntil: 'networkidle' });
      await p.waitForTimeout(1800);
      const etiquetas = await p.locator('table.datos tbody tr td:nth-last-child(2)').allInnerTexts();
      const todas = etiquetas.every((t) => t.trim().toUpperCase() === etiqueta);
      ok(todas && etiquetas.length > 0,
         `el filtro «${etiqueta.toLowerCase()}» solo trae esos`, `${etiquetas.length} filas`);
    }

    const cuerpo = await p.locator('body').innerText();
    ok(/VENCE/i.test(cuerpo), 'la tabla trae la columna de vencimiento');
    ok(/quedan|venci[óo] hace/i.test(cuerpo), 'con los días que quedan o que se pasó');
  }

  console.log('\n─── 4 · La alerta a Comercial ───');
  {
    const [r] = await consultar(`select stock_avisar_por_vencer() as n`);
    const [a] = await consultar(`
      select count(*) as n, max(mensaje) as mensaje from alertas
       where titulo = 'Stock por vencer' and not atendida`);
    ok(Number(a.n) >= 1, 'existe la alerta de stock por vencer');
    ok(Number(a.n) === 1, 'y solo una: no se duplica al volver a ejecutarla', `${a.n}`);
    ok(/pallets/.test(String(a.mensaje)) && /TM/.test(String(a.mensaje)),
       'con el resumen de cuántos pallets y cuántas toneladas',
       String(a.mensaje).slice(0, 70));

    // Y que sea visible en el panel, que es donde se pidió.
    await p.goto(`${BASE}/panel`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(2200);
    ok(/stock por vencer/i.test(await p.locator('body').innerText()),
       'y se ve en el panel principal');
  }

  console.log('\n─── 5 · Los avisos se generan solos ───');
  {
    const trabajos = await consultar(`select jobname, schedule, active from cron.job order by jobname`);
    ok(trabajos.length >= 4, 'hay tareas programadas en la base', `${trabajos.length}`);
    for (const nombre of ['avisar_stock_por_vencer', 'avisar_cotizaciones_por_vencer',
                          'cerrar_cotizaciones_vencidas', 'soltar_reservas_vencidas']) {
      const t = trabajos.find((x) => x.jobname === nombre);
      ok(Boolean(t) && t.active === true, `«${nombre}» está programada y activa`);
    }
  }

  console.log('\n─── 6 · La distribución del stock por grupo ───');
  {
    await p.goto(`${BASE}/almacenes/existencias`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(2500);
    const cuerpo = await p.locator('body').innerText();
    ok(/CÓMO SE REPARTE EL STOCK/i.test(cuerpo), 'existe el panel de distribución');
    for (const eje of ['Por formato', 'Por familia comercial', 'Por especie']) {
      ok(cuerpo.toUpperCase().includes(eje.toUpperCase()), `se puede agrupar «${eje}»`);
    }

    // El total del gráfico tiene que ser el inventario ENTERO, no mil filas.
    const [base] = await consultar(
      `select round(sum(fisico_kg)/1000, 1) as tm from v_stock_distribucion where eje = 'formato'`);
    // Ojo con el selector: la pantalla tiene DOS tablas «datos» —esta y la de
    // lotes—. Hay que quedarse con la primera o la suma sale disparatada.
    const filas = await p.locator('table.datos').first()
      .locator('tbody tr td:nth-child(2)').allInnerTexts();
    const suma = filas.map((t) => numero(t)).filter((n) => Number.isFinite(n))
      .reduce((s, n) => s + n, 0);
    ok(Math.abs(suma - Number(base.tm)) < 1,
       'la tabla suma TODO el stock, no las primeras mil filas',
       `${suma.toFixed(1)} vs ${base.tm} TM`);
  }

  console.log('\n─── 7 · El inventario valorizado, entero ───');
  {
    const [base] = await consultar(
      `select round(sum(valor)) as valor, round(sum(fisico_kg)/1000,1) as tm
         from v_anticuamiento where fisico_kg > 0`);
    await p.goto(`${BASE}/almacenes/valorizado`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(2500);
    const kpis = await p.locator('.kpi-valor').allInnerTexts();
    ok(Math.abs(numero(kpis[0]) - Number(base.valor)) <= 2,
       'el valor del inventario suma los 1 519 lotes, no mil',
       `${kpis[0]} vs ${Number(base.valor).toLocaleString('es-PE')}`);
    ok(Math.abs(numero(kpis[1]) - Number(base.tm)) < 1,
       'y las toneladas también', `${kpis[1]} vs ${base.tm}`);
  }
} finally {
  await nav.close();
}

console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo correcto');
process.exit(fallos.length ? 1 : 0);
