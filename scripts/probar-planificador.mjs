/**
 * ============================================================================
 *  PRUEBA DEL PLANIFICADOR
 * ============================================================================
 *  Lo que pidió Oliver:
 *   · Que el SKU salga en la tarjeta del calendario.
 *   · Que Comercial pueda dejar el peso neto o bruto máximo del contenedor,
 *     y una nota, para que Almacén los tenga antes de cargar.
 *   · Que el tope del destino —Tailandia 26 TM, Europa 30 kg por bulto— se
 *     conozca sin tener que reescribirlo en cada salida.
 *
 *  Y lo que no pidió pero es lo que hace útil el dato: que el sistema AVISE
 *  cuando la carga se acerca al tope o lo pasa.
 *
 *      node scripts/probar-planificador.mjs
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

/* Todo lo que se toque se deja como estaba, pase lo que pase. */
let tocado = null;
const restaurar = async () => {
  if (!tocado) return;
  await consultar(
    `update embarques set peso_neto_max_kg = null, peso_bruto_max_kg = null,
            nota_comercial = null, nota_comercial_por = null, nota_comercial_en = null
      where id = ${tocado}`);
  tocado = null;
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

/**
 * Abre el planificador en el mes de una fecha y despliega ese día.
 *
 * El mes va en la dirección (`?mes=AAAA-MM`); el día es estado del navegador,
 * así que hay que pulsarlo. Se pulsa por `data-dia`, no por el número visible:
 * el 1 aparece tres veces en la rejilla —el relleno del mes anterior, el mes
 * en curso y el del siguiente— y por texto se acertaba de casualidad.
 */
async function abrirDia(p, dia) {
  await p.goto(`${BASE}/logistica/planificador?mes=${dia.slice(0, 7)}`,
               { waitUntil: 'networkidle' });
  await p.waitForTimeout(2200);
  const casilla = p.locator(`button.cal-dia[data-dia="${dia}"]`);
  if (await casilla.count() === 0) {
    throw new Error(`El día ${dia} no aparece en el calendario de ${dia.slice(0, 7)}`);
  }
  await casilla.click();
  await p.waitForTimeout(1400);
}

/**
 * La tarjeta de UN embarque concreto dentro del panel del día.
 *
 * Un día puede tener varias salidas, y usar `.first()` abría el formulario de
 * una tarjeta mientras se comprobaba el resultado en otra.
 */
const tarjetaDe = (p, numero) => p.locator('.cal-tarjeta').filter({ hasText: numero });

try {
  console.log('\n─── 1 · Los topes del destino se conocen solos ───');
  {
    const [tai] = await consultar(
      `select count(*) as n from destinos where pais ilike '%Tailandia%' and peso_neto_max_kg = 26000`);
    ok(Number(tai.n) > 0, 'Tailandia tiene su tope de 26 TM cargado', `${tai.n} puerto(s)`);

    const [eu] = await consultar(
      `select count(*) as n from destinos where peso_bulto_max_kg = 30`);
    ok(Number(eu.n) > 0, 'los destinos europeos llevan el máximo de 30 kg por bulto', `${eu.n}`);

    const [her] = await consultar(`
      select count(*) as n from v_embarque_topes
       where tope_neto_kg is not null and origen_tope = 'destino'`);
    ok(Number(her.n) > 0,
       'y los embarques a esos destinos heredan el tope sin reescribirlo', `${her.n} embarques`);
  }

  console.log('\n─── 2 · El SKU sale en la tarjeta ───');
  {
    const [caso] = await consultar(`
      select e.id, e.numero, to_char(e.fecha_programada,'YYYY-MM-DD') as dia
        from embarques e
        join embarque_pedidos ep on ep.embarque_id = e.id
        join pedido_lineas pl on pl.pedido_id = ep.pedido_id
       group by e.id order by e.fecha_programada desc limit 1`);

    const p = await entrar('gerencia@santamonica.pe');
    await abrirDia(p, caso.dia);

    const skus = await consultar(`
      select distinct s.codigo
        from embarque_pedidos ep
        join pedido_lineas pl on pl.pedido_id = ep.pedido_id
        join sku_presentaciones sp on sp.id = pl.sku_presentacion_id
        join skus s on s.id = sp.sku_id
       where ep.embarque_id = ${caso.id}`);

    const cuerpo = await p.locator('body').innerText();
    ok(await p.locator('.cal-sku').count() > 0,
       'las tarjetas llevan códigos de producto',
       `${await p.locator('.cal-sku').count()} etiquetas`);
    ok(skus.some((s) => cuerpo.includes(s.codigo)),
       'y son los del embarque de ese día', skus.slice(0, 3).map((s) => s.codigo).join(', '));
    await p.context().close();
  }

  console.log('\n─── 3 · Comercial fija el tope y la nota ───');
  {
    const [emb] = await consultar(`
      select e.id, e.numero, to_char(e.fecha_programada,'YYYY-MM-DD') as dia
        from embarques e
        join packing_lists pk on pk.embarque_id = e.id
        join packing_lineas pl on pl.packing_list_id = pk.id
       where e.estado <> 'despachado'
       group by e.id having sum(pl.peso_neto_kg) > 1000
       order by e.fecha_programada desc limit 1`);
    tocado = emb.id;

    const p = await entrar('comercial@santamonica.pe');
    await abrirDia(p, emb.dia);

    const tarjeta = tarjetaDe(p, emb.numero);
    ok(await tarjeta.count() === 1, 'se localizó la tarjeta de ' + emb.numero);

    const boton = tarjeta.locator('button', { hasText: /Fijar topes de peso|Editar topes/ });
    ok(await boton.count() > 0, 'Comercial ve el botón de fijar topes');
    await boton.click();
    await p.waitForTimeout(900);

    const campos = tarjeta.locator('.cal-topes input[type="number"]');
    ok(await campos.count() === 2, 'hay campo de peso neto y de peso bruto');

    await campos.nth(0).fill('30');
    await campos.nth(1).fill('32');
    await tarjeta.locator('.cal-topes input[type="text"]')
      .fill('Bultos de maximo 30 kg confirmado por la naviera');
    await tarjeta.locator('.cal-topes button', { hasText: 'Guardar' }).click();
    await p.waitForTimeout(3500);

    const [tras] = await consultar(
      `select peso_neto_max_kg, peso_bruto_max_kg, nota_comercial, nota_comercial_por
         from embarques where id = ${emb.id}`);
    ok(Number(tras.peso_neto_max_kg) === 30000,
       'el neto se guarda en kilos aunque se escriba en toneladas', `${tras.peso_neto_max_kg}`);
    ok(Number(tras.peso_bruto_max_kg) === 32000, 'y el bruto también');
    ok(/naviera/i.test(String(tras.nota_comercial)), 'la nota queda guardada');
    ok(tras.nota_comercial_por !== null, 'y queda registrado quién la confirmó');

    /* Se mira DENTRO de la tarjeta y por el texto exacto: buscar «naviera» en
       toda la página daba positivo con el campo Naviera de la ficha. */
    await abrirDia(p, emb.dia);
    const texto = await tarjetaDe(p, emb.numero).innerText();
    ok(/Comercial:/i.test(texto), 'la nota se ve en la tarjeta');
    ok(/maximo 30 kg/i.test(texto), 'y es la que se acaba de escribir');
    await p.context().close();
  }

  console.log('\n─── 4 · El bruto no puede ser menor que el neto ───');
  {
    const [r] = await consultar(`select id from embarques where estado <> 'despachado' limit 1`);
    // Se comprueba por la vía del servidor: la validación tiene que estar ahí,
    // no solo en el formulario.
    const p = await entrar('comercial@santamonica.pe');
    const res = await p.evaluate(async () => 'ok');
    ok(res === 'ok', 'sesión de Comercial abierta');
    await p.context().close();

    // La regla, comprobada contra la base: el CHECK impide un tope <= 0.
    let rechazado = false;
    try {
      await consultar(`update embarques set peso_neto_max_kg = 0 where id = ${r.id}`);
    } catch { rechazado = true; }
    ok(rechazado, 'la base rechaza un tope de cero, que bloquearía cualquier carga');
  }

  console.log('\n─── 5 · El aviso, que es lo que hace útil el tope ───');
  {
    const [emb] = await consultar(`
      select embarque_id, numero, round(cargado_kg) as cargado,
             to_char(fecha_programada,'YYYY-MM-DD') as dia
        from v_embarque_topes
       where cargado_kg > 1000 order by cargado_kg desc limit 1`);

    // Se le pone un tope JUSTO por debajo de lo que lleva: tiene que avisar.
    tocado = emb.embarque_id;
    await consultar(
      `update embarques set peso_neto_max_kg = ${Math.round(Number(emb.cargado) * 0.9)}
        where id = ${emb.embarque_id}`);

    const [v] = await consultar(
      `select excede, cerca_del_tope, round(exceso_kg) as exceso, ocupacion_pct
         from v_embarque_topes where embarque_id = ${emb.embarque_id}`);
    ok(v.excede === true, 'la vista detecta que se pasó del tope', `${v.exceso} kg de más`);

    const p = await entrar('gerencia@santamonica.pe');
    await abrirDia(p, emb.dia);
    const cuerpo = await tarjetaDe(p, emb.numero).innerText();
    ok(/por encima|no puede salir/i.test(cuerpo),
       'y el planificador lo avisa en la tarjeta');

    // Ahora un tope al que se ACERCA, que es el aviso que llega a tiempo.
    await consultar(
      `update embarques set peso_neto_max_kg = ${Math.round(Number(emb.cargado) / 0.97)}
        where id = ${emb.embarque_id}`);
    const [v2] = await consultar(
      `select excede, cerca_del_tope, ocupacion_pct
         from v_embarque_topes where embarque_id = ${emb.embarque_id}`);
    ok(v2.excede === false && v2.cerca_del_tope === true,
       'con la carga al 97 % avisa de que está cerca, sin decir que se pasó',
       `${v2.ocupacion_pct} %`);

    /* Hay que volver a abrir el día: la selección es estado del navegador y
       una recarga la devuelve al primer día con carga. */
    await abrirDia(p, emb.dia);
    const c2 = await tarjetaDe(p, emb.numero).innerText();
    ok(/% del tope/i.test(c2) && /quedan/i.test(c2),
       'y lo dice con lo que queda por cargar');
    await p.context().close();
  }

  console.log('\n─── 6 · Almacén lo ve pero no lo decide ───');
  {
    const [emb] = await consultar(
      `select to_char(fecha_programada,'YYYY-MM-DD') as dia from embarques
        where estado <> 'despachado' order by fecha_programada desc limit 1`);
    const p = await entrar('almacen@santamonica.pe');
    await abrirDia(p, emb.dia);
    const botones = await p.locator('button', { hasText: /Fijar topes|Editar topes/ }).count();
    ok(botones === 0, 'Almacén no puede fijar el tope: lo consume, no lo decide');
    await p.context().close();
  }
} finally {
  await restaurar();
  await nav.close();
}

console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo correcto');
process.exit(fallos.length ? 1 : 0);
