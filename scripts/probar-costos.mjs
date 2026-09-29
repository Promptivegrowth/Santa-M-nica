/**
 * ============================================================================
 *  PRUEBA DE LOS COSTOS Y DEL MARGEN DE CONTRIBUCIÓN
 * ============================================================================
 *  Lo que pidió Oliver:
 *   · Tres costos por producto: materia prima, conversión, variable.
 *   · Que los cargue Gerencia al inicio de mes.
 *   · Margen de contribución = precio de venta − costo total de producción.
 *
 *  Y lo que hay que demostrar para que sirva:
 *   · Que el margen cuadre con la aritmética, no solo que salga un número.
 *   · Que un producto SIN costo no se cuente como si costara cero — un cero
 *     daría margen del 100 % y nadie lo notaría.
 *   · Que solo Gerencia pueda escribirlos, y que si otro lo intenta el sistema
 *     lo DIGA en vez de fingir que guardó.
 *
 *  Las reglas nuevas de la migración 057 —vigencias, solo hacia adelante,
 *  historial, costo del lote, margen bruto— tienen su propia prueba:
 *  scripts/probar-costos-vigencia.mjs.
 *
 *      node scripts/probar-costos.mjs
 * ============================================================================
 */
import { chromium } from 'playwright';
import { ejecutarSQL } from './db.mjs';

/*
 * El puerto se puede cambiar con BASE_URL. En esta máquina conviven varios
 * servidores de prueba a la vez y dar por supuesto el 3000 hacía que las
 * pruebas se ejecutaran contra la aplicación equivocada — o peor, que alguien
 * matara el proceso de otro para liberarlo.
 */
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const consultar = async (sql) => {
  const r = await ejecutarSQL(sql);
  return Array.isArray(r) ? r : [];
};

const fallos = [];
const ok = (cond, texto, detalle = '') => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${texto}${detalle ? ' · ' + detalle : ''}`);
  if (!cond) fallos.push(texto);
};

/*
 * Lo que se toque se deja como estaba.
 *
 * Desde la migración 057 un costo que ya rige no se puede borrar ni cambiar,
 * así que la prueba solo CREA vigencias de hoy y al final las quita, junto con
 * su rastro en el historial. Para eso usa el interruptor de mantenimiento
 * (app.costos_carga_historica) dentro de una transacción: desde la aplicación
 * no se puede activar.
 */
const [{ ahora: INICIO }] = await consultar(`select now() as ahora`);
let tocado = false;   // si la prueba llegó a crear algo
/*
 * Se quita TODO lo creado desde que empezó la prueba, no solo lo del producto
 * que se quería tocar: si la pantalla guardara en otro por error, también se
 * limpia. Borrar la vigencia deja una «baja» en el historial, que se borra
 * después en la misma transacción.
 */
const restaurar = async () => {
  if (!tocado) return;
  await consultar(`
    begin;
    select set_config('app.costos_carga_historica', 'si', true);
    delete from costos_mensuales
     where creado_en >= '${INICIO}'
       and vigente_desde >= (now() at time zone 'America/Lima')::date;
    delete from costos_historial where registrado_en >= '${INICIO}';
    commit;`);
  tocado = false;
};

const nav = await chromium.launch({ channel: 'chrome', headless: true });

async function entrar(correo) {
  const ctx = await nav.newContext({ viewport: { width: 1600, height: 1100 } });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', correo);
  await p.fill('input[type="password"]', 'SantaMonica2026');
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/panel/, { timeout: 25000 });
  return p;
}

try {
  console.log('\n─── 1 · Los tres costos y su total ───');
  {
    const [r] = await consultar(`
      select count(*) as filas, count(distinct sku_id) as skus,
             count(*) filter (where abs(total_kg - (materia_prima_kg + conversion_kg + variable_kg)) > 0.00005) as descuadrados
        from costos_mensuales`);
    ok(Number(r.filas) > 0, 'hay costos cargados', `${r.filas} filas · ${r.skus} productos`);
    ok(Number(r.descuadrados) === 0,
       'el total es siempre la suma de los tres: es columna generada, no puede desincronizarse');
  }

  console.log('\n─── 2 · El margen de contribución cuadra ───');
  {
    const [r] = await consultar(`
      select count(*) as n,
             count(*) filter (where abs(margen_tm - (precio_tm - costo_produccion_tm)) > 0.01) as mal
        from v_margen_contribucion where not sin_costo`);
    ok(Number(r.n) > 0, 'hay líneas con costo para medir', `${r.n}`);
    ok(Number(r.mal) === 0, 'margen = precio de venta − costo de producción, línea por línea');

    const [c] = await consultar(`
      select count(*) filter (where abs(costo_produccion_tm
             - (materia_prima_tm + conversion_tm + variable_tm)) > 0.01) as mal
        from v_margen_contribucion where not sin_costo`);
    ok(Number(c.mal) === 0, 'y el costo es la suma de los tres componentes');
  }

  console.log('\n─── 3 · Sin costo NO es costo cero ───');
  {
    const [r] = await consultar(`
      select count(*) filter (where sin_costo) as sin_costo,
             count(*) filter (where sin_costo and margen_tm is not null) as calculados
        from v_margen_contribucion`);
    ok(Number(r.sin_costo) > 0, 'hay líneas sin costo cargado', `${r.sin_costo}`);
    ok(Number(r.calculados) === 0,
       'y a ninguna se le inventa un margen: sin costo, el margen es nulo');

    // Y sobre todo: no entran en los totales agregados.
    const [f] = await consultar(`
      select count(*) filter (where lineas_sin_costo > 0) as familias_afectadas,
             count(*) filter (where margen_pct = 100) as al_cien
        from v_margen_contribucion_familia`);
    ok(Number(f.al_cien) === 0,
       'ninguna familia sale al 100 % de margen, que es lo que daría un costo cero',
       `${f.familias_afectadas} familias tienen líneas fuera del cálculo`);
  }

  console.log('\n─── 4 · El costo que rige es la última vigencia que empezó ───');
  {
    /*
     * Un producto con carga del mes y una actualización a mitad de mes: el
     * día antes de la actualización rige la carga; desde ese día, la
     * actualización; y el día antes de la carga, el mes anterior.
     */
    const [caso] = await consultar(`
      select a.sku_id, a.vigente_desde::text as desde_act, a.total_kg as t_act,
             m.vigente_desde::text as desde_men, m.total_kg as t_men,
             (a.vigente_desde - 1)::text as antes_act, (m.vigente_desde - 1)::text as antes_men
        from costos_mensuales a
        join costos_mensuales m on m.sku_id = a.sku_id and m.tipo = 'mensual'
                               and m.anio = a.anio and m.mes = a.mes
       where a.tipo = 'actualizacion' order by a.vigente_desde desc, a.sku_id limit 1`);
    ok(Boolean(caso), 'hay productos con carga del mes y actualización posterior');

    const vig = async (f) => Number((await consultar(
      `select costo_produccion_kg(${caso.sku_id}, '${f}'::date) as c`))[0].c);

    ok(Math.abs(await vig(caso.antes_act) - Number(caso.t_men)) < 0.0001,
       'el día antes de la actualización rige la carga del mes');
    ok(Math.abs(await vig(caso.desde_act) - Number(caso.t_act)) < 0.0001,
       'desde el día de la actualización rige la actualización');
    const previo = await vig(caso.antes_men);
    ok(previo > 0 && Math.abs(previo - Number(caso.t_men)) > 0.00001,
       'y antes de la carga rige el mes anterior —no cero—', `US$ ${previo.toFixed(4)}/kg`);
  }

  console.log('\n─── 5 · Solo Gerencia escribe ───');
  {
    // Comercial ve la pantalla en solo lectura.
    const pc = await entrar('comercial@santamonica.pe');
    await pc.goto(`${BASE}/finanzas/costos`, { waitUntil: 'networkidle' });
    await pc.waitForTimeout(2200);
    const cuerpo = await pc.locator('body').innerText();
    ok(/solo lectura/i.test(cuerpo), 'Comercial ve la pantalla, y se le dice que es solo lectura');

    const campos = pc.locator('.costo-campo');
    ok(await campos.count() > 0, 'los campos se muestran');
    ok(await campos.first().isDisabled(), 'pero desactivados');
    ok(!/cargar con los costos vigentes/i.test(cuerpo), 'y no se le ofrece cargar el mes');
    await pc.context().close();

    // Almacén no entra siquiera.
    const pa = await entrar('almacen@santamonica.pe');
    await pa.goto(`${BASE}/finanzas/costos`, { waitUntil: 'networkidle' });
    await pa.waitForTimeout(1800);
    ok(!pa.url().includes('/finanzas/costos'),
       'Almacén no accede a los costos: se le redirige', pa.url().replace(BASE, ''));
    await pa.context().close();
  }

  console.log('\n─── 6 · Gerencia edita en la propia tabla ───');
  {
    /*
     * En el mes en curso, editar un producto que ya tiene su carga del mes
     * crea una ACTUALIZACIÓN que rige desde hoy. La carga no se toca: ya se
     * aplicó a los ingresos de estos días.
     */
    const [sku] = await consultar(`
      with hoy as (select (now() at time zone 'America/Lima')::date as d)
      select c.id as carga_id, c.sku_id, s.codigo, c.total_kg,
             c.materia_prima_kg as mp, c.conversion_kg as conv, c.variable_kg as varia
        from costos_mensuales c join skus s on s.id = c.sku_id, hoy
       where c.tipo = 'mensual' and c.vigente_desde < hoy.d
         and c.vigente_desde >= date_trunc('month', hoy.d)::date
         and not exists (select 1 from costos_mensuales x
                          where x.sku_id = c.sku_id and x.vigente_desde > c.vigente_desde)
       order by s.codigo limit 1`);
    tocado = true;

    const p = await entrar('gerencia@santamonica.pe');
    await p.goto(`${BASE}/finanzas/costos?buscar=${encodeURIComponent(sku.codigo)}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(2200);

    //  La fila EXACTA: buscar «04» también trae «104» y «041».
    const filaDe = () => p.locator('table.tabla-costos tbody tr')
      .filter({ has: p.locator('td:first-child', { hasText: new RegExp(`^${sku.codigo}$`) }) }).first();
    const fila = filaDe();
    const campos = fila.locator('.costo-campo');
    ok(await campos.count() === 3, 'la fila tiene los tres campos');
    ok(!(await campos.first().isDisabled()), 'y para Gerencia están activos');

    const nuevo = Number((Number(sku.mp) + 0.1).toFixed(4));
    await campos.nth(0).fill(String(nuevo));
    await campos.nth(0).press('Enter');         // Enter guarda
    await p.waitForTimeout(3500);

    const [hoyRow] = await consultar(`
      select id, tipo, materia_prima_kg, total_kg,
             vigente_desde = (now() at time zone 'America/Lima')::date as es_hoy
        from costos_mensuales where sku_id = ${sku.sku_id} order by vigente_desde desc limit 1`);
    ok(hoyRow.es_hoy && hoyRow.tipo === 'actualizacion',
       'se guarda como actualización que rige desde hoy', hoyRow.tipo);
    ok(Math.abs(Number(hoyRow.materia_prima_kg) - nuevo) < 0.0001, 'con el valor escrito', `${hoyRow.materia_prima_kg}`);
    ok(Math.abs(Number(hoyRow.total_kg) - (nuevo + Number(sku.conv) + Number(sku.varia))) < 0.0001,
       'y el total se recalcula solo');
    const [carga] = await consultar(`select total_kg from costos_mensuales where id = ${sku.carga_id}`);
    ok(Math.abs(Number(carga.total_kg) - Number(sku.total_kg)) < 0.0001, 'la carga del mes queda intacta');

    const [h] = await consultar(`
      select accion, total_antes, total_nuevo, usuario_nombre from costos_historial
       where costo_id = ${hoyRow.id} order by id desc limit 1`);
    ok(h && h.accion === 'alta'
       && Math.abs(Number(h.total_antes) - Number(sku.total_kg)) < 0.0001
       && Math.abs(Number(h.total_nuevo) - Number(hoyRow.total_kg)) < 0.0001
       && Boolean(h.usuario_nombre),
       'el historial guarda costo anterior, nuevo y usuario',
       h ? `${h.total_antes} → ${h.total_nuevo} · ${h.usuario_nombre}` : '');

    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForTimeout(1500);
    const vig = await filaDe().locator('td[data-vigencia]').innerText();
    ok(/actualizaci/i.test(vig), 'la fila dice desde cuándo rige y que es una actualización',
       vig.replace(/\s+/g, ' '));

    await restaurar();
    await p.context().close();
  }

  console.log('\n─── 7 · La pantalla del margen ───');
  {
    const p = await entrar('gerencia@santamonica.pe');
    await p.goto(`${BASE}/finanzas/rentabilidad?eje=contribucion`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(2500);
    const cuerpo = await p.locator('body').innerText();

    ok(/MARGEN DE CONTRIBUCI/i.test(cuerpo), 'existe la pestaña de margen de contribución');
    ok(/esto no es la utilidad/i.test(cuerpo),
       'y se aclara que no es la utilidad, que es la confusión clásica');
    for (const parte of ['Materia prima', 'Conversión', 'Variable']) {
      ok(cuerpo.toUpperCase().includes(parte.toUpperCase()),
         `se desglosa «${parte}»`);
    }
    ok(/l[íi]neas sin costo cargado/i.test(cuerpo),
       'y se dice cuántas líneas quedan fuera por no tener costo');

    // Las cuatro partes tienen que sumar el 100 % de la venta.
    const [t] = await consultar(`
      select round(sum(materia_prima) + sum(conversion) + sum(variable) + sum(margen)) as partes,
             round(sum(venta)) as venta
        from v_margen_contribucion_familia where venta is not null`);
    ok(Math.abs(Number(t.partes) - Number(t.venta)) <= 2,
       'las cuatro partes suman exactamente la venta',
       `${Number(t.partes).toLocaleString('es-PE')} vs ${Number(t.venta).toLocaleString('es-PE')}`);
    await p.context().close();
  }
} finally {
  await restaurar();
  await nav.close();
}

console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo correcto');
process.exit(fallos.length ? 1 : 0);
