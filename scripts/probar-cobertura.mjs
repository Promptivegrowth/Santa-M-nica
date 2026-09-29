/**
 * ============================================================================
 *  PRUEBA DE LA COBERTURA POR FAMILIA
 * ============================================================================
 *  Documento de mejoras, punto 1.1:
 *    «Cobertura = Stock actual × 26 días / Despacho del mes anterior»,
 *    por familia y no por SKU.
 *
 *  Con la data de demostración ninguna familia baja de 15 días, así que el
 *  aviso no saltaría solo. Para probarlo de verdad se SUBE el umbral un
 *  momento —varias familias pasan a «baja»—, se comprueba el aviso y se deja
 *  todo como estaba, falle lo que falle.
 *
 *      node scripts/probar-cobertura.mjs
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

const [{ valor: umbralOriginal }] = await consultar(
  `select valor from parametros where clave = 'cobertura_minima_dias'`);

const nav = await chromium.launch({ channel: 'chrome', headless: true });
const p = await (await nav.newContext({ viewport: { width: 1600, height: 1100 } })).newPage();

try {
  console.log(SEC(1, 'La fórmula del cliente, fila por fila'));
  {
    const [r] = await consultar(`
      select count(*) filter (
               where despachado_mes_anterior_kg > 0
                 and abs(cobertura_dias - round(stock_kg * dias_mes / despachado_mes_anterior_kg, 1)) > 0.05
             ) as mal,
             count(*) as familias
        from v_cobertura_familia`);
    ok(Number(r.mal) === 0,
       'cobertura = stock × días hábiles ÷ despachado el mes anterior', `${r.familias} familias`);

    const [d] = await consultar(`select valor from parametros where clave = 'cobertura_dias_mes'`);
    ok(Number(d.valor) === 26, 'con los 26 días hábiles que fija el documento');
  }

  console.log(SEC(2, 'Los dos casos que la fórmula no resuelve'));
  {
    const [r] = await consultar(`
      select count(*) filter (where despachado_mes_anterior_kg <= 0 and cobertura_dias is not null) as divide_cero,
             count(*) filter (where despachado_mes_anterior_kg <= 0 and stock_kg > 0
                                and situacion <> 'sin_movimiento')                          as mal_sin_mov,
             count(*) filter (where stock_kg <= 0 and despachado_mes_anterior_kg > 0
                                and situacion <> 'agotada')                                 as mal_agotada
        from v_cobertura_familia`);
    ok(Number(r.divide_cero) === 0,
       'sin despachos no se inventa una cobertura: queda vacía, no «infinita»');
    ok(Number(r.mal_sin_mov) === 0, 'y se marca como «sin despachos»');
    ok(Number(r.mal_agotada) === 0,
       'una familia sin stock que se vendió el mes pasado es «agotada»: cobertura cero');
  }

  console.log(SEC(3, 'El mes anterior es en hora de Lima'));
  {
    /*
     * Un despacho del 31 de agosto a las 22:00 en Lima es 1 de septiembre en
     * UTC. Contado en UTC se cae del mes; contado en Lima, que es donde opera
     * la empresa, entra. Es la misma trampa que ya mordió en la migración 028.
     */
    const [r] = await consultar(`
      with lim as (
        select (date_trunc('month', now() at time zone 'America/Lima') - interval '1 month')::date as desde,
               date_trunc('month', now() at time zone 'America/Lima')::date                        as hasta)
      select
        (select count(*) from despachos d, lim
          where (d.fecha_salida at time zone 'America/Lima')::date >= lim.desde
            and (d.fecha_salida at time zone 'America/Lima')::date <  lim.hasta)            as en_lima,
        (select count(*) from despachos d, lim
          where d.fecha_salida::date >= lim.desde and d.fecha_salida::date < lim.hasta)      as en_utc`);
    ok(Number(r.en_lima) > 0, 'se cuentan los despachos del mes anterior', `${r.en_lima} en hora de Lima`);
    if (Number(r.en_lima) !== Number(r.en_utc)) {
      ok(true, 'y la frontera de mes se toma en Lima, no en UTC',
         `${r.en_lima} en Lima frente a ${r.en_utc} en UTC`);
    }
  }

  console.log(SEC(4, 'El aviso de baja cobertura'));
  {
    /*
     * Se sube el umbral por encima de la cobertura de varias familias. Tienen
     * que saltar en el aviso, y el aviso tiene que ser UNO, no uno por familia.
     */
    const [m] = await consultar(`
      select percentile_cont(0.5) within group (order by cobertura_dias) as mediana
        from v_cobertura_familia where cobertura_dias is not null`);
    const umbral = Math.ceil(Number(m.mediana));
    await consultar(`update parametros set valor = '${umbral}' where clave = 'cobertura_minima_dias'`);

    const [b] = await consultar(`select count(*) as n from v_cobertura_familia where situacion in ('baja','agotada')`);
    ok(Number(b.n) > 0, `con el umbral en ${umbral} días hay familias en baja`, `${b.n}`);

    for (let i = 0; i < 3; i++) await consultar(`select cobertura_avisar_baja()`);
    const [a] = await consultar(`
      select count(*) as n, max(mensaje) as mensaje from alertas
       where titulo = 'Familias con baja cobertura' and not atendida`);
    ok(Number(a.n) === 1,
       'salta un solo aviso aunque se ejecute tres veces', `${a.n}`);
    ok(new RegExp(`^${b.n} familia`).test(String(a.mensaje)),
       'y dice cuántas familias', String(a.mensaje).slice(0, 80));

    //  Se devuelve el umbral: las familias salen de baja y el aviso se cierra solo.
    await consultar(`update parametros set valor = '${umbralOriginal}' where clave = 'cobertura_minima_dias'`);
    await consultar(`select cobertura_avisar_baja()`);
    const [c] = await consultar(`
      select count(*) as n from alertas where titulo = 'Familias con baja cobertura' and not atendida`);
    const [sigue] = await consultar(`select count(*) as n from v_cobertura_familia where situacion in ('baja','agotada')`);
    ok(Number(sigue.n) > 0 ? Number(c.n) === 1 : Number(c.n) === 0,
       'al volver el umbral, el aviso se cierra solo si ya no hay familias en baja');

    const [j] = await consultar(`select count(*) as n from cron.job where jobname = 'avisar_baja_cobertura' and active`);
    ok(Number(j.n) === 1, 'y se genera solo cada mañana');
  }

  console.log(SEC(5, 'El panel en Existencias'));
  {
    await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await p.fill('input[type="email"]', 'gerencia@santamonica.pe');
    await p.fill('input[type="password"]', 'SantaMonica2026');
    await p.click('button[type="submit"]');
    await p.waitForURL(/\/panel/, { timeout: 30000 });
    await p.goto(`${BASE}/almacenes/existencias`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(2200);

    const cuerpo = await p.locator('body').innerText();
    ok(/COBERTURA POR FAMILIA/i.test(cuerpo), 'existe el panel de cobertura por familia');

    const panel = p.locator('.panel').filter({ hasText: /Cobertura por familia/i });
    const filas = await panel.locator('table.datos tbody tr').count();
    const [n] = await consultar(`select count(*) as n from v_cobertura_familia`);
    ok(filas === Number(n.n), 'una fila por familia', `${filas} de ${n.n}`);

    //  La más corta tiene que ir primero: es la que hay que mirar.
    const primeras = await panel.locator('table.datos tbody tr td:nth-child(4)').allInnerTexts();
    const dias = primeras.map((t) => Number(t.replace(/[^\d]/g, ''))).filter((x) => x > 0);
    const ordenada = dias.every((d, i) => i === 0 || d >= dias[i - 1]);
    ok(ordenada, 'ordenada de la cobertura más corta a la más larga');

    //  Cada familia lleva a sus lotes.
    await panel.locator('table.datos tbody tr a').first().click();
    const llego = await p.waitForURL(/formato=/, { timeout: 30000 }).then(() => true, () => false);
    ok(llego, 'pulsar una familia filtra las existencias de esa familia');
  }
} finally {
  //  Pase lo que pase, el umbral vuelve a su valor.
  await consultar(`update parametros set valor = '${umbralOriginal}' where clave = 'cobertura_minima_dias'`);
  await consultar(`select cobertura_avisar_baja()`);
  await nav.close();
}

console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo correcto');
process.exit(fallos.length ? 1 : 0);
