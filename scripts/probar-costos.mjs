/**
 * ============================================================================
 *  PRUEBA DE LOS COSTOS Y DEL MARGEN DE CONTRIBUCIÓN
 * ============================================================================
 *  Lo que pidió Oliver:
 *   · Tres costos por producto y por mes: materia prima, conversión, variable.
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
 *      node scripts/probar-costos.mjs
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

/* Lo que se toque se deja como estaba. */
let borrado = null;
const restaurar = async () => {
  if (!borrado) return;
  await consultar(`
    insert into costos_mensuales
      (sku_id, anio, mes, materia_prima_kg, conversion_kg, variable_kg, registrado_por)
    values (${borrado.sku_id}, ${borrado.anio}, ${borrado.mes},
            ${borrado.mp}, ${borrado.conv}, ${borrado.varia},
            '${borrado.registrado_por}')
    on conflict (sku_id, anio, mes) do update
      set materia_prima_kg = excluded.materia_prima_kg,
          conversion_kg    = excluded.conversion_kg,
          variable_kg      = excluded.variable_kg`);
  borrado = null;
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

  console.log('\n─── 4 · El costo que rige es el último cargado ───');
  {
    const [caso] = await consultar(`
      select sku_id, anio, mes, materia_prima_kg as mp, conversion_kg as conv,
             variable_kg as varia, total_kg, registrado_por
        from costos_mensuales order by anio desc, mes desc, sku_id limit 1`);

    const [vig] = await consultar(
      `select costo_produccion_kg(${caso.sku_id}, make_date(${caso.anio}, ${caso.mes}, 15)) as c`);
    ok(Math.abs(Number(vig.c) - Number(caso.total_kg)) < 0.0001,
       'dentro del mes rige el costo de ese mes');

    // Se borra el del mes y tiene que caer al anterior, no a cero.
    borrado = { ...caso };
    await consultar(
      `delete from costos_mensuales where sku_id = ${caso.sku_id} and anio = ${caso.anio} and mes = ${caso.mes}`);

    const [tras] = await consultar(
      `select costo_produccion_kg(${caso.sku_id}, make_date(${caso.anio}, ${caso.mes}, 15)) as c`);
    ok(tras.c !== null && Number(tras.c) > 0,
       'si falta el mes, se usa el último anterior — no cero', `US$ ${Number(tras.c).toFixed(4)}/kg`);
    ok(Math.abs(Number(tras.c) - Number(caso.total_kg)) > 0.00001,
       'y es un valor distinto: de verdad cayó al mes anterior');

    await restaurar();
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
    ok(!/copiar del mes anterior/i.test(cuerpo), 'y no se le ofrece copiar el mes anterior');
    await pc.context().close();

    // Almacén no entra siquiera.
    const pa = await entrar('almacen@santamonica.pe');
    const r = await pa.goto(`${BASE}/finanzas/costos`, { waitUntil: 'networkidle' });
    await pa.waitForTimeout(1800);
    ok(!pa.url().includes('/finanzas/costos'),
       'Almacén no accede a los costos: se le redirige', pa.url().replace(BASE, ''));
    await pa.context().close();
  }

  console.log('\n─── 6 · Gerencia edita en la propia tabla ───');
  {
    const [sku] = await consultar(`
      select c.sku_id, s.codigo, c.anio, c.mes,
             c.materia_prima_kg as mp, c.conversion_kg as conv, c.variable_kg as varia,
             c.registrado_por
        from costos_mensuales c join skus s on s.id = c.sku_id
       order by c.anio desc, c.mes desc, s.codigo limit 1`);
    borrado = { ...sku };

    const p = await entrar('gerencia@santamonica.pe');
    const periodo = `${sku.anio}-${String(sku.mes).padStart(2, '0')}`;
    await p.goto(`${BASE}/finanzas/costos?periodo=${periodo}&buscar=${sku.codigo}`,
                 { waitUntil: 'networkidle' });
    await p.waitForTimeout(2200);

    const fila = p.locator('table.datos tbody tr').first();
    const campos = fila.locator('.costo-campo');
    ok(await campos.count() === 3, 'la fila tiene los tres campos');
    ok(!(await campos.first().isDisabled()), 'y para Gerencia están activos');

    const nuevo = 2.5;
    await campos.nth(0).fill(String(nuevo));
    await campos.nth(1).press('Tab');          // salir del campo dispara el guardado
    await campos.nth(0).blur().catch(() => {});
    await p.waitForTimeout(3500);

    const [tras] = await consultar(
      `select materia_prima_kg, total_kg from costos_mensuales
        where sku_id = ${sku.sku_id} and anio = ${sku.anio} and mes = ${sku.mes}`);
    ok(Math.abs(Number(tras.materia_prima_kg) - nuevo) < 0.0001,
       'el cambio se guarda al salir del campo', `${tras.materia_prima_kg}`);
    ok(Math.abs(Number(tras.total_kg)
        - (nuevo + Number(sku.conv) + Number(sku.varia))) < 0.0001,
       'y el total se recalcula solo');

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
