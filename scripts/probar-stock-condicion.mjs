/**
 * ============================================================================
 *  PRUEBA DE LAS ALERTAS DE STOCK · por vencer y con condición
 * ============================================================================
 *  Documento de mejoras, cuadro resumen, filas 2 y 3:
 *    · próximos a vencer con producto, familia, lote, cantidad, fecha de
 *      vencimiento y días restantes;
 *    · cuadro de stock observado, inmovilizado o con condición especial de
 *      venta, en especial el de mercado nacional.
 *
 *  Dos escenarios tocan datos —un dictamen de más, un lote liberado un
 *  momento— y se deshacen en el `finally`, falle lo que falle.
 *
 *      node scripts/probar-stock-condicion.mjs
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
const HOY_LIMA = `(now() at time zone 'America/Lima')::date`;

//  Lo que los escenarios tocan, para devolverlo.
let dictamenPrueba = null;
let liberados = [];

const nav = await chromium.launch({ channel: 'chrome', headless: true });
const p = await (await nav.newContext({ viewport: { width: 1600, height: 1100 } })).newPage();

try {
  console.log(SEC(1, 'El motivo «Solo mercado nacional»'));
  {
    const [m] = await consultar(`
      select id, condiciona_venta, activo from motivos
       where ambito = 'bloqueo' and codigo = 'MERCADO_NACIONAL'`);
    ok(Boolean(m), 'existe entre los motivos de observación de Calidad');
    ok(m?.condiciona_venta === true && m?.activo === true, 'marcado como condición de venta, y activo');
    const [d] = await consultar(`select count(*) as n from motivos where codigo = 'MERCADO_NACIONAL'`);
    ok(Number(d.n) === 1, 'uno solo, aunque la migración se aplique dos veces');

    //  Oliver: OBS no es disponible. Mercado nacional va con OBS.
    const [b] = await consultar(`
      select count(*) as n, coalesce(sum(v.disponible_kg), 0) as disp
        from v_stock_condicion c
        join v_stock_lote v on v.lote_id = c.lote_id and v.almacen_id = c.almacen_id
       where c.condicion = 'condicionado'`);
    ok(Number(b.n) > 0 && Number(b.disp) === 0,
       'lo de mercado nacional no cuenta como disponible para exportar', `${b.n} pallets, ${b.disp} kg disponibles`);
  }

  console.log(SEC(2, 'El cuadro de stock con condición'));
  {
    //  Recalculado por otro camino: todo lote con stock y un dictamen abierto.
    const [r] = await consultar(`
      with esperado as (
        select distinct v.lote_id, v.almacen_id
          from v_stock_lote v
          join dictamenes_calidad d on d.lote_id = v.lote_id and d.vigente and d.estado <> 'liberado'
         where v.fisico_kg > 0)
      select (select count(*) from esperado) as esperado,
             (select count(*) from v_stock_condicion) as vista,
             (select count(*) from (select lote_id, almacen_id from v_stock_condicion
                                    group by 1, 2 having count(*) > 1) x) as duplicados`);
    ok(Number(r.esperado) === Number(r.vista), 'están todos los lotes retenidos con stock, y solo ellos',
       `${r.vista} de ${r.esperado}`);
    ok(Number(r.duplicados) === 0, 'una fila por lote y almacén, aunque tenga varios dictámenes');

    const [k] = await consultar(`
      select count(*) filter (where c.condicion <> case
                 when x.inm then 'inmovilizado' when x.cond then 'condicionado'
                 when x.obs then 'observado' else 'en_espera' end) as mal
        from v_stock_condicion c
        join (select d.lote_id,
                     bool_or(d.estado = 'inmovilizado') as inm,
                     bool_or(coalesce(m.condiciona_venta, false)) as cond,
                     bool_or(d.estado = 'observado') as obs
                from dictamenes_calidad d left join motivos m on m.id = d.motivo_id
               where d.vigente and d.estado <> 'liberado' group by 1) x on x.lote_id = c.lote_id`);
    ok(Number(k.mal) === 0, 'cada lote con su condición más fuerte');

    const [f] = await consultar(`
      select count(*) filter (where familia is null or motivos is null or desde is null) as incompletas,
             count(*) filter (where dias_en_condicion <> ${HOY_LIMA} - (desde at time zone 'America/Lima')::date) as mal_dias
        from v_stock_condicion`);
    ok(Number(f.incompletas) === 0, 'todas con familia, motivo y fecha desde la que está retenido');
    ok(Number(f.mal_dias) === 0, 'y los días que lleva retenido, en hora de Lima');

    //  La familia se nombra igual que en la cobertura por familia (053).
    const [fam] = await consultar(`
      select count(*) as mal from v_stock_condicion c
       where c.familia <> case when c.especie = 'POTA' then c.formato
                               else c.formato || ' (' || lower(c.especie) || ')' end`);
    ok(Number(fam.mal) === 0, 'la familia se llama igual que en la cobertura');
  }

  console.log(SEC(3, 'Escenario: SANIPES inmoviliza un lote de mercado nacional'));
  {
    /*
     * Un lote condicionado a mercado nacional se puede vender dentro del país.
     * Si además SANIPES lo inmoviliza, ya no se puede vender a nadie: tiene
     * que pasar a inmovilizado, no quedarse como «mercado nacional».
     */
    const [lote] = await consultar(`
      select lote_id from v_stock_condicion where condicion = 'condicionado' order by lote_id limit 1`);
    const [dic] = await consultar(`
      insert into dictamenes_calidad (lote_id, tipo, estado, motivo_id, motivo_texto, vigente)
      select ${lote.lote_id}, 'camara', 'inmovilizado', id, 'PRUEBA · probar-stock-condicion', true
        from motivos where ambito = 'bloqueo' and codigo = 'SANIPES'
      returning id`);
    dictamenPrueba = dic.id;
    const [c] = await consultar(`select condicion from v_stock_condicion where lote_id = ${lote.lote_id} limit 1`);
    ok(c.condicion === 'inmovilizado', 'pasa a inmovilizado: lo más grave manda', c.condicion);

    await consultar(`delete from dictamenes_calidad where id = ${dictamenPrueba}`);
    dictamenPrueba = null;
    const [c2] = await consultar(`select condicion from v_stock_condicion where lote_id = ${lote.lote_id} limit 1`);
    ok(c2.condicion === 'condicionado', 'y al levantarse vuelve a «solo mercado nacional»');
  }

  console.log(SEC(4, 'Escenario: Calidad libera un lote'));
  {
    const [lote] = await consultar(`
      select lote_id from v_stock_condicion where condicion = 'observado' order by lote_id limit 1`);
    liberados = (await consultar(`
      update dictamenes_calidad set vigente = false
       where lote_id = ${lote.lote_id} and vigente and estado <> 'liberado' returning id`)).map((x) => x.id);
    const [c] = await consultar(`select count(*) as n from v_stock_condicion where lote_id = ${lote.lote_id}`);
    ok(Number(c.n) === 0, 'sale del cuadro en cuanto no le queda ningún dictamen abierto',
       `${liberados.length} dictámenes cerrados`);
    await consultar(`update dictamenes_calidad set vigente = true where id in (${liberados.join(',')})`);
    liberados = [];
  }

  console.log(SEC(5, 'El cuadro de próximos a vencer'));
  {
    const [r] = await consultar(`
      select count(*) filter (where dias_restantes <> fecha_vencimiento - ${HOY_LIMA})              as mal_dias,
             count(*) filter (where (situacion = 'vencido') <> (fecha_vencimiento < ${HOY_LIMA}))    as mal_sit,
             count(*) filter (where dias_restantes > param_num('vencimiento_aviso_dias', 90))       as fuera,
             count(*) filter (where codigo_lote is null or familia is null)                          as incompletas,
             count(*) as n
        from v_stock_por_vencer`);
    ok(Number(r.mal_dias) === 0, 'días restantes = vencimiento − hoy en Lima', `${r.n} pallets`);
    ok(Number(r.mal_sit) === 0, 'vencido si la fecha ya pasó, por vencer si no');
    ok(Number(r.fuera) === 0, 'solo los que caen dentro del aviso configurado');
    ok(Number(r.incompletas) === 0, 'todos con lote y familia');

    //  El mismo universo que la pantalla de Anticuamiento: si no, las dos
    //  pantallas darían cifras distintas del mismo stock.
    const [a] = await consultar(`
      select (select count(*) from v_anticuamiento
               where fisico_kg > 0 and situacion_vida_util in ('vencido','por_vencer')) as anti,
             (select count(*) from v_stock_por_vencer) as alertas,
             (select count(*) from v_anticuamiento
               where dias_para_vencer <> fecha_vencimiento - ${HOY_LIMA}) as utc`);
    ok(Number(a.anti) === Number(a.alertas), 'cuadra con Anticuamiento', `${a.alertas} = ${a.anti}`);
    ok(Number(a.utc) === 0, 'Anticuamiento también cuenta los días en hora de Lima');

    const [c] = await consultar(`
      select count(*) as n from v_stock_por_vencer p
        join v_stock_condicion c on c.lote_id = p.lote_id and c.almacen_id = p.almacen_id
       where p.condicion is distinct from c.condicion`);
    ok(Number(c.n) === 0, 'y dice si el pallet que vence además está retenido por Calidad');
  }

  console.log(SEC(6, 'El aviso'));
  {
    for (let k = 0; k < 3; k++) await consultar(`select stock_avisar_condicion()`);
    const [al] = await consultar(`
      select count(*) as n, max(mensaje) as m from alertas
       where titulo = 'Stock observado, inmovilizado o condicionado' and not atendida`);
    ok(Number(al.n) === 1, 'uno solo aunque se ejecute tres veces', `${al.n}`);
    const [v] = await consultar(`
      select count(*) as n, count(*) filter (where condicion = 'condicionado') as nac from v_stock_condicion`);
    ok(String(al.m).startsWith(`${v.n} pallets`) && String(al.m).includes(`${v.nac} solo para mercado nacional`),
       'con las cifras del cuadro', String(al.m).slice(0, 100));
    const [j] = await consultar(`select count(*) as n from cron.job where jobname = 'avisar_stock_condicion' and active`);
    ok(Number(j.n) === 1, 'y se genera solo cada mañana');
  }

  console.log(SEC(7, 'La pantalla'));
  {
    await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await p.fill('input[type="email"]', 'gerencia@santamonica.pe');
    await p.fill('input[type="password"]', 'SantaMonica2026');
    await p.click('button[type="submit"]');
    await p.waitForURL(/\/panel/, { timeout: 30000 });
    await p.goto(`${BASE}/almacenes/alertas`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1500);

    ok(await p.locator('nav a[href="/almacenes/alertas"], aside a[href="/almacenes/alertas"]').count() > 0,
       'está en el menú de Almacenes');

    const [t] = await consultar(`
      select (select count(*) from v_stock_por_vencer where situacion = 'vencido')    as vencidos,
             (select count(*) from v_stock_por_vencer where situacion = 'por_vencer') as por_vencer,
             (select count(*) from v_stock_por_vencer)                                as vencer,
             (select count(*) from v_stock_condicion)                                 as condicion,
             (select round(sum(fisico_kg) / 1000, 1) from v_stock_condicion where condicion = 'condicionado') as nac_tm`);
    const kpi = async (etiqueta) => {
      const k = p.locator('.kpi').filter({ has: p.locator('.kpi-etiqueta', { hasText: new RegExp(`^${etiqueta}$`, 'i') }) }).first();
      return numero(await k.locator('.kpi-valor').innerText());
    };
    ok(await kpi('Ya vencido') === Number(t.vencidos), 'tarjeta «Ya vencido»', `${t.vencidos}`);
    ok(await kpi('Próximos a vencer') === Number(t.por_vencer), 'tarjeta «Próximos a vencer»', `${t.por_vencer}`);
    ok(await kpi('Con condición') === Number(t.condicion), 'tarjeta «Con condición»', `${t.condicion}`);
    ok(Math.abs(await kpi('Solo mercado nacional') - Number(t.nac_tm)) < 0.05,
       'tarjeta «Solo mercado nacional» en TM', `${t.nac_tm}`);

    const filasVencer = p.locator('table[data-cuadro="por-vencer"] tbody tr');
    ok(await filasVencer.count() === Number(t.vencer), 'el cuadro de por vencer trae todos', `${t.vencer}`);
    const encabezados = (await p.locator('table[data-cuadro="por-vencer"] thead th').allInnerTexts()).join(' ').toUpperCase();
    ok(['PRODUCTO', 'FAMILIA', 'LOTE', 'CANTIDAD', 'VENCE', 'DÍAS RESTANTES'].every((c) => encabezados.includes(c)),
       'con las columnas que pide el documento');
    const dias = (await p.locator('table[data-cuadro="por-vencer"] td[data-dias]').evaluateAll(
      (tds) => tds.map((td) => Number(td.getAttribute('data-dias')))));
    ok(dias.every((d, i) => i === 0 || d >= dias[i - 1]), 'lo más urgente arriba');

    ok(await p.locator('table[data-cuadro="condicion"] tbody tr').count() === Number(t.condicion),
       'el cuadro de condición trae todos', `${t.condicion}`);

    //  La tarjeta lleva al detalle filtrado.
    await p.locator('.kpi').filter({ hasText: /Solo mercado nacional/i }).first().click();
    await p.waitForURL(/cond=condicionado/, { timeout: 30000 });
    await p.waitForTimeout(1200);
    const conds = await p.locator('table[data-cuadro="condicion"] tbody tr').evaluateAll(
      (trs) => trs.map((tr) => tr.getAttribute('data-condicion')));
    const [nac] = await consultar(`select count(*) as n from v_stock_condicion where condicion = 'condicionado'`);
    ok(conds.length === Number(nac.n) && conds.every((c) => c === 'condicionado'),
       'pulsar «Solo mercado nacional» deja solo esos', `${conds.length}`);

    //  El filtro de familia recorta los dos cuadros.
    const [fam] = await consultar(`
      select familia, count(*) as n from v_stock_condicion group by 1 order by 2 desc limit 1`);
    await p.goto(`${BASE}/almacenes/alertas?familia=${encodeURIComponent(fam.familia)}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1200);
    ok(await p.locator('table[data-cuadro="condicion"] tbody tr').count() === Number(fam.n),
       `filtrar por familia «${fam.familia}»`, `${fam.n}`);

    //  Cada fila lleva a su lote.
    await p.locator('table[data-cuadro="condicion"] tbody tr a').first().click();
    const llego = await p.waitForURL(/\/almacenes\/lotes\/\d+/, { timeout: 30000 }).then(() => true, () => false);
    ok(llego, 'cada pallet lleva a la ficha de su lote');
  }
} finally {
  if (dictamenPrueba) await consultar(`delete from dictamenes_calidad where id = ${dictamenPrueba}`);
  if (liberados.length) await consultar(`update dictamenes_calidad set vigente = true where id in (${liberados.join(',')})`);
  await consultar(`delete from dictamenes_calidad where motivo_texto = 'PRUEBA · probar-stock-condicion'`);
  await consultar(`select stock_avisar_condicion()`);
  await nav.close();
}

console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo correcto');
process.exit(fallos.length ? 1 : 0);
