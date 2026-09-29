/**
 * ============================================================================
 *  PRUEBA DE FILL RATE, OTIF Y ALERTAS DE DEMORA
 * ============================================================================
 *  Documento de mejoras, punto 4:
 *    Fill Rate = Cantidad atendida / Cantidad programada × 100
 *    OTIF      = Pedidos completos y a tiempo / Total programados × 100
 *    Alertas   : Programado → Despachado > 6 días
 *                Pedido → Salida programada > 12 días
 *
 *  Y Oliver: el plan es lo que está en el planificador, y «a tiempo» se mide
 *  contra la salida programada.
 *
 *      node scripts/probar-cumplimiento.mjs
 * ============================================================================
 */
import { chromium } from 'playwright';
import { ejecutarSQL } from './db.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const consultar = async (sql) => {
  const r = await ejecutarSQL(sql);
  return Array.isArray(r) ? r : [];
};
const SEC = (n, t) => `\n${'─'.repeat(3)} ${n} · ${t} ${'─'.repeat(3)}`;
const fallos = [];
const ok = (cond, texto, detalle = '') => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${texto}${detalle ? ' · ' + detalle : ''}`);
  if (!cond) fallos.push(texto);
};
const numero = (t) => Number(String(t).replace(/[^\d.-]/g, ''));

const nav = await chromium.launch({ channel: 'chrome', headless: true });
const p = await (await nav.newContext({ viewport: { width: 1600, height: 1100 } })).newPage();

try {
  console.log(SEC(1, 'Fill Rate: la fórmula del documento'));
  {
    const [r] = await consultar(`
      select count(*) filter (
               where programado_kg > 0
                 and abs(fill_rate - round(atendido_kg / programado_kg * 100, 1)) > 0.05) as mal,
             count(*) as semanas
        from v_cumplimiento_semanal`);
    ok(Number(r.mal) === 0, 'Fill Rate = atendido ÷ programado × 100, semana a semana', `${r.semanas} semanas`);

    /*
     * La trampa: un contenedor puede llevar dos proformas. Si el Fill Rate se
     * sumara por pedido, ese contenedor contaría dos veces.
     */
    const [d] = await consultar(`
      select abs(
        (select sum(programado_kg) from v_cumplimiento_semanal) -
        (select sum(programado_kg) from v_contenedor_cumplimiento)) as diferencia`);
    ok(Number(d.diferencia) < 1,
       'suma contenedores distintos: los compartidos no cuentan dos veces');

    const [c] = await consultar(`
      select count(*) as n from v_pedido_contenedores where proformas_dentro > 1`);
    ok(Number(c.n) > 0, 'y los hay compartidos, así que la prueba no es trivial', `${c.n}`);
  }

  console.log(SEC(2, 'OTIF: completos Y a tiempo'));
  {
    const [r] = await consultar(`
      select count(*) filter (
               where pedidos_programados > 0
                 and abs(otif - round(pedidos_otif::numeric / pedidos_programados * 100, 1)) > 0.05) as mal
        from v_cumplimiento_semanal`);
    ok(Number(r.mal) === 0, 'OTIF = pedidos completos y a tiempo ÷ pedidos programados × 100');

    //  «A tiempo» contra la salida programada, como respondió Oliver.
    const [t] = await consultar(`
      select count(*) filter (where a_tiempo <> (despachado and fecha_salida <= fecha_programada)) as mal
        from v_contenedor_cumplimiento`);
    ok(Number(t.mal) === 0, 'a tiempo = salió en o antes de su fecha del planificador');

    /*
     * Un pedido es completo y a tiempo solo si TODOS sus contenedores de la
     * semana salieron y a tiempo. Se recalcula por otro camino —contando los
     * pedidos que tienen algún contenedor fallido— y tiene que dar lo mismo.
     */
    const [i] = await consultar(`
      with pp as (
        select date_trunc('week', pc.fecha_programada)::date as semana, pc.pedido_id,
               count(*) filter (where not cc.despachado or not cc.a_tiempo) as fallidos
          from v_pedido_contenedores pc
          join v_contenedor_cumplimiento cc on cc.packing_list_id = pc.packing_list_id
         group by 1, 2),
      otra as (select semana, count(*) filter (where fallidos = 0) as otif from pp group by 1)
      select count(*) as mal from otra o
        join v_cumplimiento_semanal v on v.semana = o.semana
       where v.pedidos_otif <> o.otif`);
    ok(Number(i.mal) === 0, 'basta un contenedor tarde o sin salir para que el pedido no cuente');
  }

  console.log(SEC(3, 'La semana en curso no se juzga como cerrada'));
  {
    const [r] = await consultar(`
      select count(*) filter (where semana_abierta
                                and semana + 6 < (now() at time zone 'America/Lima')::date) as mal
        from v_cumplimiento_semanal`);
    ok(Number(r.mal) === 0, 'solo se marca abierta la semana que todavía no terminó');
  }

  console.log(SEC(4, 'Las alertas por demora'));
  {
    const [u] = await consultar(`
      select max(valor) filter (where clave = 'alerta_programado_despacho_dias') as desp,
             max(valor) filter (where clave = 'alerta_pedido_programacion_dias') as prog
        from parametros`);
    ok(Number(u.desp) === 6 && Number(u.prog) === 12,
       'con los umbrales del documento: 6 y 12 días', `${u.desp} / ${u.prog}`);

    const [r] = await consultar(`
      select
        count(*) filter (where incumple_despacho <>
          (f_programada is not null and dias_a_despachar > umbral_programado_despacho))  as mal_desp,
        count(*) filter (where incumple_programacion <>
          (f_pedido is not null and dias_a_programar > umbral_pedido_programacion))       as mal_prog
        from v_demora_pedidos`);
    ok(Number(r.mal_desp) === 0, 'Programado → Despachado > 6 días se detecta bien');
    ok(Number(r.mal_prog) === 0, 'Pedido → Salida programada > 12 días se detecta bien');

    /*
     * Lo importante: se detecta ANTES de que ocurra. Un pedido programado hace
     * diez días que todavía no salió ya incumple, aunque no tenga fecha de
     * salida. Esperar a que salga para avisar es avisar tarde.
     */
    const [a] = await consultar(`
      select count(*) as n from v_demora_pedidos
       where incumple_despacho and f_despacho is null`);
    ok(Number(a.n) > 0,
       'se avisa de los que llevan días programados SIN salir, sin esperar a que salgan',
       `${a.n} pedidos`);

    for (let k = 0; k < 3; k++) await consultar(`select demora_avisar()`);
    const [al] = await consultar(`
      select count(*) as n, max(mensaje) as m from alertas
       where titulo = 'Pedidos fuera de los tiempos establecidos' and not atendida`);
    ok(Number(al.n) === 1, 'un solo aviso aunque se ejecute tres veces', `${al.n}`);
    ok(/sin programar/.test(String(al.m)) && /sin salir/.test(String(al.m)),
       'y distingue los dos incumplimientos', String(al.m).slice(0, 90));

    const [j] = await consultar(`select count(*) as n from cron.job where jobname = 'avisar_demora_pedidos' and active`);
    ok(Number(j.n) === 1, 'y se genera solo cada mañana');
  }

  console.log(SEC(5, 'La pantalla'));
  {
    await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await p.fill('input[type="email"]', 'gerencia@santamonica.pe');
    await p.fill('input[type="password"]', 'SantaMonica2026');
    await p.click('button[type="submit"]');
    await p.waitForURL(/\/panel/, { timeout: 30000 });
    await p.goto(`${BASE}/ventas/tiempos`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(2200);

    const panel = p.locator('.panel').filter({ hasText: /Cumplimiento semanal/i });
    ok(await panel.count() === 1, 'existe el panel de cumplimiento semanal');

    //  Las dos tarjetas enseñan la última semana CERRADA, no la que está en curso.
    const [ult] = await consultar(`
      select numero_semana, fill_rate, otif from v_cumplimiento_semanal
       where not semana_abierta order by semana desc limit 1`);
    const etiq = (await panel.locator('.kpi .kpi-etiqueta').allInnerTexts()).map((t) => t.toUpperCase());
    const vals = (await panel.locator('.kpi .kpi-valor').allInnerTexts()).map(numero);
    const fr = vals[etiq.findIndex((e) => e.includes('FILL RATE'))];
    const ot = vals[etiq.findIndex((e) => e.includes('OTIF'))];
    ok(Math.abs(fr - Number(ult.fill_rate ?? 0)) < 0.05, 'la tarjeta de Fill Rate es la de la última semana cerrada',
       `${fr} vs ${ult.fill_rate} (semana ${ult.numero_semana})`);
    ok(Math.abs(ot - Number(ult.otif ?? 0)) < 0.05, 'y la de OTIF también', `${ot} vs ${ult.otif}`);

    const filas = await panel.locator('table.datos tbody tr').count();
    ok(filas >= 1 && filas <= 12, 'con la evolución de las últimas semanas', `${filas} semanas`);

    //  Cada fila de la tabla dice lo mismo que la base de datos.
    const vista = await consultar(`
      select numero_semana, fill_rate, otif from v_cumplimiento_semanal order by semana desc limit 12`);
    const celdas = await panel.locator('table.datos tbody tr').evaluateAll((trs) =>
      trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.innerText)));
    let distintas = 0;
    celdas.forEach((c, k) => {
      const v = vista[k];
      const pct = (t) => (t.trim() === '—' ? null : numero(t));
      const igual = (a, b) => (a === null ? b === null : b !== null && Math.abs(a - Number(b)) < 0.05);
      if (!c[0].includes(`Semana ${v.numero_semana}`) || !igual(pct(c[4]), v.fill_rate) || !igual(pct(c[7]), v.otif)) distintas++;
    });
    ok(distintas === 0, 'cada semana de la tabla cuadra con la base de datos', `${celdas.length - distintas} de ${celdas.length}`);

    /* «También debe identificarse visualmente el despacho que incumple.» */
    const marcas = await p.locator('text=Fuera de tiempo').count();
    ok(marcas > 0, 'los pedidos que incumplen van marcados en la tabla', `${marcas} en esta página`);

    //  El atajo dice cuántos incumplen, y el filtro trae solo esos.
    const atajo = await p.locator('a', { hasText: /Incumplen los tiempos/ }).innerText();
    const cuantos = numero(atajo.match(/\((\d[\d,.]*)\)/)?.[1] ?? '0');
    const [b] = await consultar(`
      select count(*) as n from v_demora_pedidos where incumple_programacion or incumple_despacho`);
    ok(cuantos === Number(b.n), 'el atajo cuenta los que incumplen', `${cuantos} vs ${b.n}`);

    await p.goto(`${BASE}/ventas/tiempos?completos=incumplen`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(2000);
    const tituloDetalle = await p.locator('.panel-titulo, .panel h2, .panel header').allInnerTexts();
    const total = numero(tituloDetalle.find((t) => /pedidos$/i.test(t.trim())) ?? '0');
    ok(total === Number(b.n), 'y el filtro trae exactamente esos', `${total} vs ${b.n}`);
  }
} finally {
  await nav.close();
}

console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo correcto');
process.exit(fallos.length ? 1 : 0);
