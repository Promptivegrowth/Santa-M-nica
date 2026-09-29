/**
 * ============================================================================
 *  PRUEBA DE VENTAS VS. OBJETIVO
 * ============================================================================
 *  Documento de mejoras, punto 2.1: planificados / despachados / pendientes /
 *  % de cumplimiento, por mes, en contenedores. Plan = planificador; real =
 *  lo que tuvo salida (Oliver).
 *
 *  Un escenario mueve la fecha de salida de un despacho al primer minuto del
 *  mes siguiente —en hora de Lima— y la devuelve en el `finally`.
 *
 *      node scripts/probar-objetivo.mjs
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

let despachoMovido = null;   // { id, fecha_salida original }

const nav = await chromium.launch({ channel: 'chrome', headless: true });
const p = await (await nav.newContext({ viewport: { width: 1600, height: 1100 } })).newPage();

try {
  console.log(SEC(1, 'El plan es el planificador'));
  {
    //  Recalculado desde las tablas, sin pasar por las vistas.
    const [r] = await consultar(`
      with plan as (
        select date_trunc('month', fecha_programada)::date as mes, count(*) as n
          from embarques where estado <> 'cancelado' group by 1)
      select count(*) filter (where v.planificados <> coalesce(plan.n, 0)) as mal, count(*) as meses
        from v_ventas_objetivo_mensual v left join plan on plan.mes = v.mes`);
    ok(Number(r.mal) === 0, 'planificados = embarques no cancelados con fecha en el mes', `${r.meses} meses`);

    const [c] = await consultar(`
      select (select count(*) from embarques where estado = 'cancelado') as cancelados,
             (select count(*) from v_objetivo_contenedores o join embarques e on e.id = o.embarque_id
               where e.estado = 'cancelado') as colados`);
    ok(Number(c.colados) === 0, 'un embarque cancelado no es plan', `${c.cancelados} cancelados en la base`);

    const [u] = await consultar(`
      select count(*) as n from (select embarque_id from packing_lists where estado <> 'anulado'
                                  group by 1 having count(*) > 1) x`);
    ok(Number(u.n) === 0, 'un embarque es un contenedor: ninguno lleva dos packing lists');
  }

  console.log(SEC(2, 'Lo real: salida dentro del mes, en hora de Lima'));
  {
    const [r] = await consultar(`
      with real as (
        select date_trunc('month', e.fecha_programada)::date as mes, count(*) as n
          from embarques e
          join packing_lists pk on pk.embarque_id = e.id and pk.estado <> 'anulado'
          join despachos d on d.packing_list_id = pk.id
         where e.estado <> 'cancelado'
           and (d.fecha_salida at time zone 'America/Lima')::date
               < (date_trunc('month', e.fecha_programada) + interval '1 month')::date
         group by 1)
      select count(*) filter (where v.despachados <> coalesce(real.n, 0)) as mal
        from v_ventas_objetivo_mensual v left join real on real.mes = v.mes`);
    ok(Number(r.mal) === 0, 'despachados = del plan del mes, con salida antes de que acabe');

    const [s] = await consultar(`
      select count(*) filter (where pendientes <> planificados - despachados)          as mal_pend,
             count(*) filter (where planificados > 0
                                and cumplimiento <> round(despachados::numeric / planificados * 100, 1)) as mal_pct,
             count(*) filter (where mes_abierto) as abiertos
        from v_ventas_objetivo_mensual`);
    ok(Number(s.mal_pend) === 0, 'pendientes = planificados − despachados: las cuatro cifras cuadran');
    ok(Number(s.mal_pct) === 0, '% de cumplimiento = despachados ÷ planificados');
    ok(Number(s.abiertos) <= 1, 'como mucho un mes en curso');
  }

  console.log(SEC(3, 'Escenario: un contenedor sale el primer minuto del mes siguiente'));
  {
    /*
     * Se toma un contenedor despachado dentro de su mes y se le pone salida
     * el día 1 del mes siguiente a las 00:30 de Lima —05:30 UTC—. Tiene que
     * dejar de contar en su mes, pasar a «salió tarde» y aparecer como
     * arrastre en el mes siguiente. Y a las 23:30 del último día, en Lima
     * —ya el día 1 en UTC—, tiene que seguir contando en su mes.
     */
    const [c] = await consultar(`
      select o.embarque_id, o.mes_plan, d.id as despacho_id, d.fecha_salida
        from v_objetivo_contenedores o
        join despachos d on d.packing_list_id = o.packing_list_id
       where o.situacion = 'despachado' order by o.embarque_id limit 1`);
    despachoMovido = { id: c.despacho_id, fecha: c.fecha_salida };
    const cifras = async () => (await consultar(`
      select mes, despachados, arrastre from v_ventas_objetivo_mensual
       where mes in ('${c.mes_plan}'::date, ('${c.mes_plan}'::date + interval '1 month')::date) order by mes`));
    const antes = await cifras();

    await consultar(`
      update despachos set fecha_salida =
        (('${c.mes_plan}'::date + interval '1 month')::timestamp + interval '30 minutes') at time zone 'America/Lima'
       where id = ${c.despacho_id}`);
    const [o] = await consultar(`select situacion from v_objetivo_contenedores where embarque_id = ${c.embarque_id}`);
    const tarde = await cifras();
    ok(o.situacion === 'salio_tarde', 'sale 00:30 del día 1 en Lima: «salió tarde»', o.situacion);
    ok(Number(tarde[0].despachados) === Number(antes[0].despachados) - 1, 'y deja de contar en su mes');
    ok(tarde[1] && Number(tarde[1].arrastre) === Number(antes[1]?.arrastre ?? 0) + 1,
       'y aparece como arrastre en el mes siguiente');

    await consultar(`
      update despachos set fecha_salida =
        (('${c.mes_plan}'::date + interval '1 month')::timestamp - interval '30 minutes') at time zone 'America/Lima'
       where id = ${c.despacho_id}`);
    const [o2] = await consultar(`select situacion from v_objetivo_contenedores where embarque_id = ${c.embarque_id}`);
    ok(o2.situacion === 'despachado',
       'sale 23:30 del último día en Lima —ya día 1 en UTC—: cuenta en su mes', o2.situacion);

    await consultar(`update despachos set fecha_salida = '${despachoMovido.fecha}' where id = ${despachoMovido.id}`);
    despachoMovido = null;
    const despues = await cifras();
    ok(JSON.stringify(despues) === JSON.stringify(antes), 'y al devolver la fecha todo queda como estaba');
  }

  console.log(SEC(4, 'La pantalla'));
  {
    await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await p.fill('input[type="email"]', 'gerencia@santamonica.pe');
    await p.fill('input[type="password"]', 'SantaMonica2026');
    await p.click('button[type="submit"]');
    await p.waitForURL(/\/panel/, { timeout: 30000 });

    ok(await p.locator('aside a[href="/ventas/resumen"], nav a[href="/ventas/resumen"]').count() > 0,
       'está en el menú de Ventas');

    //  Un mes cerrado con de todo: el de más planificados.
    const [m] = await consultar(`
      select clave, planificados, despachados, pendientes, cumplimiento, arrastre
        from v_ventas_objetivo_mensual where not mes_abierto order by planificados desc limit 1`);
    await p.goto(`${BASE}/ventas/resumen?mes=${m.clave}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1200);

    const kpi = async (etiqueta) => {
      const k = p.locator('.kpi').filter({ has: p.locator('.kpi-etiqueta', { hasText: new RegExp(`^${etiqueta}$`, 'i') }) }).first();
      return numero(await k.locator('.kpi-valor').innerText());
    };
    ok(await kpi('Contenedores planificados') === Number(m.planificados), 'tarjeta planificados', `${m.planificados} (${m.clave})`);
    ok(await kpi('Contenedores despachados') === Number(m.despachados), 'tarjeta despachados', `${m.despachados}`);
    ok(await kpi('Pendientes') === Number(m.pendientes), 'tarjeta pendientes', `${m.pendientes}`);
    ok(Math.abs(await kpi('% de cumplimiento') - Number(m.cumplimiento)) < 0.05, 'tarjeta % de cumplimiento', `${m.cumplimiento}`);

    //  Cada tarjeta abre exactamente los contenedores que cuenta.
    for (const [etiqueta, ver, esperado, situaciones] of [
      ['Contenedores despachados', 'despachados', m.despachados, ['despachado']],
      ['Pendientes', 'pendientes', m.pendientes, ['pendiente', 'salio_tarde']],
      ['Contenedores planificados', 'planificados', m.planificados, ['despachado', 'pendiente', 'salio_tarde']],
    ]) {
      await p.locator('.kpi').filter({ has: p.locator('.kpi-etiqueta', { hasText: new RegExp(`^${etiqueta}$`, 'i') }) }).first().click();
      await p.waitForURL(new RegExp(`ver=${ver}`), { timeout: 30000 });
      await p.waitForTimeout(900);
      const sits = await p.locator('table[data-cuadro="contenedores"] tbody tr').evaluateAll(
        (trs) => trs.map((tr) => tr.getAttribute('data-situacion')));
      ok(sits.length === Number(esperado) && sits.every((s) => situaciones.includes(s)),
         `pulsar «${etiqueta}» lista esos ${esperado} contenedores`, `${sits.length}`);
    }

    //  La evolución: una fila por mes, las cifras de la base.
    const vista = await consultar(`
      select clave, planificados, despachados, pendientes from v_ventas_objetivo_mensual order by mes desc limit 12`);
    const filas = await p.locator('table[data-cuadro="evolucion"] tbody tr').evaluateAll(
      (trs) => trs.map((tr) => [tr.getAttribute('data-mes'), ...[...tr.querySelectorAll('td')].slice(1, 4).map((td) => td.innerText)]));
    const distintas = filas.filter((f, k) => f[0] !== vista[k].clave
      || numero(f[1]) !== Number(vista[k].planificados)
      || numero(f[2]) !== Number(vista[k].despachados)
      || numero(f[3]) !== Number(vista[k].pendientes)).length;
    ok(filas.length === vista.length && distintas === 0, 'la evolución mensual cuadra con la base', `${filas.length} meses`);

    //  Cada contenedor lleva a su embarque.
    await p.locator('table[data-cuadro="contenedores"] tbody tr a').first().click();
    const llego = await p.waitForURL(/\/logistica\/embarques\/\d+/, { timeout: 30000 }).then(() => true, () => false);
    ok(llego, 'cada contenedor lleva a su embarque');
  }
} finally {
  if (despachoMovido) {
    await consultar(`update despachos set fecha_salida = '${despachoMovido.fecha}' where id = ${despachoMovido.id}`);
  }
  await nav.close();
}

console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo correcto');
process.exit(fallos.length ? 1 : 0);
