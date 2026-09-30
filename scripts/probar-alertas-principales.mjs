/**
 * ============================================================================
 *  PRUEBA DE LAS SEIS ALERTAS PRINCIPALES
 * ============================================================================
 *  Documento de mejoras, punto 6: concentrar próximos a vencer, stock con
 *  condición, baja cobertura, pendientes con stock, backorder y fuera de
 *  tiempo. Y el 7: cada tarjeta se pulsa y abre su detalle.
 *
 *  Cada cifra se recalcula por su cuenta y se compara con la de la pantalla
 *  de detalle a la que lleva: si la alerta dice 110 pedidos, al pulsarla
 *  tienen que salir 110.
 *
 *      node scripts/probar-alertas-principales.mjs
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

const [{ valor: coberturaOriginal }] = await consultar(
  `select valor from parametros where clave = 'cobertura_minima_dias'`);

const nav = await chromium.launch({ channel: 'chrome', headless: true });
const p = await (await nav.newContext({ viewport: { width: 1600, height: 1100 } })).newPage();

try {
  console.log(SEC(1, 'Las seis del documento, en su orden'));
  const filas = await consultar(`select * from v_alertas_principales order by orden`);
  {
    const esperadas = ['por_vencer', 'condicion', 'cobertura', 'pendientes_con_stock', 'backorder', 'fuera_de_tiempo'];
    ok(JSON.stringify(filas.map((f) => f.clave)) === JSON.stringify(esperadas), 'son exactamente las seis, en orden',
       filas.map((f) => f.clave).join(', '));
  }

  console.log(SEC(2, 'Cada cifra, recalculada por su cuenta'));
  const de = (clave) => filas.find((f) => f.clave === clave);
  {
    const [r] = await consultar(`
      select
        (select round(coalesce(sum(fisico_kg), 0) / 1000, 1) from v_anticuamiento where fisico_kg > 0 and situacion_vida_util = 'por_vencer') as por_vencer,
        (select round(coalesce(sum(s.fisico_kg), 0) / 1000, 1) from v_stock_lote s where s.fisico_kg > 0 and exists (
           select 1 from dictamenes_calidad d where d.lote_id = s.lote_id and d.vigente and d.estado <> 'liberado')) as condicion,
        (select count(*) from v_cobertura_familia where situacion in ('baja', 'agotada')) as cobertura,
        (select count(*) from v_control_pedidos where situacion_control = 'por_atender' and tiene_stock) as con_stock,
        (select round(sum(backorder_kg) / 1000, 1) from v_pedido_linea_cobertura) as backorder,
        (select count(*) from v_demora_pedidos where incumple_programacion or incumple_despacho) as demora`);
    ok(Math.abs(Number(de('por_vencer').cifra) - Number(r.por_vencer)) < 0.05 && de('por_vencer').unidad === 'TM',
       'próximos a vencer, en toneladas', `${r.por_vencer} TM`);
    ok(Math.abs(Number(de('condicion').cifra) - Number(r.condicion)) < 0.05 && de('condicion').unidad === 'TM',
       'stock con condición, en toneladas', `${r.condicion} TM`);
    ok(Number(de('cobertura').cifra) === Number(r.cobertura), 'familias con baja cobertura', `${r.cobertura}`);
    ok(Number(de('pendientes_con_stock').cifra) === Number(r.con_stock), 'pendientes con stock', `${r.con_stock} pedidos`);
    ok(Math.abs(Number(de('backorder').cifra) - Number(r.backorder)) < 0.05, 'backorder', `${r.backorder} TM`);
    ok(Number(de('fuera_de_tiempo').cifra) === Number(r.demora), 'fuera de tiempo', `${r.demora} pedidos`);

    //  Una sola regla de gravedad para las seis.
    const malas = filas.filter((f) => (Number(f.cifra) === 0) !== (f.severidad === 'ok'));
    ok(malas.length === 0, 'sin nada que atender es «ok», y con algo nunca lo es');
  }

  console.log(SEC(3, 'En vivo, no de la última revisión'));
  {
    /*
     * Se sube el umbral de cobertura: sin ejecutar ningún aviso, la tarjeta
     * de cobertura tiene que cambiar ya. Luego se devuelve.
     */
    const [m] = await consultar(`
      select ceil(percentile_cont(0.5) within group (order by cobertura_dias)) as u
        from v_cobertura_familia where cobertura_dias is not null`);
    await consultar(`update parametros set valor = '${m.u}' where clave = 'cobertura_minima_dias'`);
    const [c] = await consultar(`select cifra, severidad from v_alertas_principales where clave = 'cobertura'`);
    ok(Number(c.cifra) > 0 && c.severidad !== 'ok', 'al cambiar la situación, la cifra cambia al momento',
       `${c.cifra} familias con umbral ${m.u} días`);
    await consultar(`update parametros set valor = '${coberturaOriginal}' where clave = 'cobertura_minima_dias'`);
  }

  console.log(SEC(4, 'Los dos avisos nuevos'));
  {
    for (const [fn, titulo] of [
      ['pedidos_avisar_con_stock', 'Pedidos pendientes con stock'],
      ['pedidos_avisar_backorder', 'Backorder por falta de stock'],
    ]) {
      for (let k = 0; k < 3; k++) await consultar(`select ${fn}()`);
      const [a] = await consultar(`select count(*) as n, max(mensaje) as m from alertas where titulo = '${titulo}' and not atendida`);
      ok(Number(a.n) === 1, `«${titulo}»: uno solo aunque se ejecute tres veces`, String(a.m).slice(0, 70));
    }
    const [j] = await consultar(`
      select count(*) as n from cron.job where jobname in ('avisar_pedidos_con_stock', 'avisar_backorder') and active`);
    ok(Number(j.n) === 2, 'y los dos se generan solos cada mañana');
    const [anon] = await consultar(`
      select bool_or(has_function_privilege('anon', p.oid, 'execute')) as puede
        from pg_proc p where p.proname in ('pedidos_avisar_con_stock', 'pedidos_avisar_backorder')`);
    ok(anon.puede === false, 'sin sesión no se pueden llamar');
  }

  console.log(SEC(5, 'La pantalla: cada tarjeta abre su detalle'));
  {
    await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await p.fill('input[type="email"]', 'gerencia@santamonica.pe');
    await p.fill('input[type="password"]', 'SantaMonica2026');
    await p.click('button[type="submit"]');
    await p.waitForURL(/\/panel/, { timeout: 30000 });

    const vivas = await consultar(`select * from v_alertas_principales order by orden`);
    await p.goto(`${BASE}/alertas`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1500);
    const tarjetas = p.locator('[data-bloque="principales"] .kpi');
    ok(await tarjetas.count() === 6, 'arriba, las seis tarjetas');
    const valores = (await tarjetas.locator('.kpi-valor').allInnerTexts()).map(numero);
    ok(valores.every((v, k) => Math.abs(v - Number(vivas[k].cifra)) < 0.05), 'con las cifras de ahora',
       valores.join(' · '));

    /*
     * Lo que dice la tarjeta y lo que enseña su detalle: la misma cifra.
     * Para cada una se lee el número en la pantalla a la que lleva.
     */
    const kpiEn = async (etiqueta) => {
      const k = p.locator('.kpi').filter({ has: p.locator('.kpi-etiqueta', { hasText: new RegExp(`^${etiqueta}$`, 'i') }) }).first();
      return numero(await k.locator('.kpi-valor').innerText());
    };
    const comprobaciones = {
      por_vencer: { ruta: /\/almacenes\/alertas/, leer: () => kpiEn('Próximos a vencer') },
      condicion: { ruta: /\/almacenes\/alertas/, leer: () => kpiEn('Con condición') },
      cobertura: { ruta: /\/almacenes\/existencias/, leer: null },
      pendientes_con_stock: { ruta: /\/ventas\/control\?vista=pendientes/, leer: () => kpiEn('Pedidos pendientes') },
      backorder: { ruta: /\/produccion/, leer: () => kpiEn('Por producir') },
      fuera_de_tiempo: { ruta: /\/ventas\/tiempos\?completos=incumplen/, leer: null },
    };
    for (let k = 0; k < 6; k++) {
      const v = vivas[k];
      await p.goto(`${BASE}/alertas`, { waitUntil: 'networkidle' });
      await p.locator('[data-bloque="principales"] .kpi').nth(k).click();
      const c = comprobaciones[v.clave];
      const llego = await p.waitForURL(c.ruta, { timeout: 30000 }).then(() => true, () => false);
      await p.waitForLoadState('networkidle');
      await p.waitForTimeout(1200);
      if (!c.leer) {
        ok(llego, `«${v.titulo}» abre su detalle`, new URL(p.url()).pathname);
        continue;
      }
      const alla = await c.leer();
      ok(llego && Math.abs(alla - Number(v.cifra)) < 0.05, `«${v.titulo}» abre su detalle, con la misma cifra`,
         `${v.cifra} = ${alla}`);
    }

    //  Los avisos de resumen de la lista también llevan a su detalle.
    await p.goto(`${BASE}/alertas?titulo=${encodeURIComponent('Backorder por falta de stock')}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1200);
    const href = await p.locator('ul.lista-alertas-nav a.alerta-fila').first().getAttribute('href');
    ok(href === '/produccion', 'el aviso de backorder de la lista lleva a Producción', String(href));
  }
} finally {
  await consultar(`update parametros set valor = '${coberturaOriginal}' where clave = 'cobertura_minima_dias'`);
  await consultar(`select cobertura_avisar_baja()`);
  await nav.close();
}

console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo correcto');
process.exit(fallos.length ? 1 : 0);
