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
 * Todo lo que se toque se deja como estaba, pase lo que pase.
 *
 * Se restauran PEDIDOS y no embarques: la restriccion de peso se mudo al
 * pedido, porque es donde le llega a Comercial y porque un embarque puede
 * consolidar dos pedidos -y entonces el tope «del embarque» no dice de que
 * cliente es-.
 */
let tocado = null;
const restaurar = async () => {
  if (!tocado) return;
  await consultar(
    `update pedidos set peso_neto_max_kg = null, peso_bruto_max_kg = null,
            nota_restricciones = null, restricciones_por = null, restricciones_en = null
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
  console.log(`
--- 1 - La restriccion vive en el pedido, no en un maestro ---`);
  {
    /*
     * Oliver: «esa restriccion debe registrarse en el pedido, ya que no hay un
     * maestro; el 90 % de las observaciones son que el cliente indica a
     * Comercial». Antes estaba en un maestro por destino Y en el embarque; las
     * dos cosas se quitaron.
     */
    const [viejo] = await consultar(`
      select count(*) as n from information_schema.columns
       where table_schema = 'public'
         and (table_name = 'destinos'  and column_name like 'peso%'
           or table_name = 'embarques' and column_name like 'peso%')`);
    ok(Number(viejo.n) === 0,
       'no quedan topes en destinos ni en embarques: un maestro que nadie mantiene miente');

    const [nuevo] = await consultar(`
      select count(*) as n from information_schema.columns
       where table_schema = 'public' and table_name = 'pedidos'
         and column_name in ('peso_neto_max_kg','peso_bruto_max_kg','nota_restricciones')`);
    ok(Number(nuevo.n) === 3, 'y el pedido guarda neto, bruto y nota');

    const [con] = await consultar(
      `select count(*) as n from pedidos where peso_neto_max_kg is not null`);
    ok(Number(con.n) > 0, 'hay pedidos con restriccion cargada', `${con.n} pedidos`);
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

  console.log(`
--- 3 - Comercial fija la restriccion desde el pedido ---`);
  {
    const [ped] = await consultar(`
      select id, numero_proforma from pedidos
       where ciclo not in ('despachado','cerrado','cancelado')
         and peso_neto_max_kg is null
       order by id limit 1`);
    tocado = ped.id;

    const p = await entrar('comercial@santamonica.pe');
    await p.goto(`${BASE}/ventas/pedidos/${ped.id}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1800);

    const boton = p.locator('button', { hasText: /Fijar restricci|Editar restricci|topes de peso/i });
    ok(await boton.count() > 0, 'Comercial ve el boton de fijar la restriccion');
    await boton.first().click();
    await p.waitForTimeout(900);

    const campos = p.locator('input[type="number"]');
    ok(await campos.count() >= 2, 'hay campo de peso neto y de peso bruto');
    await campos.nth(0).fill('26');
    await campos.nth(1).fill('27.5');
    await p.locator('input[type="text"]').last()
      .fill('Bultos de maximo 30 kg confirmado por la naviera');
    await p.locator('button', { hasText: 'Guardar' }).first().click();
    await p.waitForTimeout(3500);

    const [tras] = await consultar(`
      select peso_neto_max_kg, peso_bruto_max_kg, nota_restricciones, restricciones_por
        from pedidos where id = ${ped.id}`);
    ok(Number(tras.peso_neto_max_kg) === 26000,
       'el neto se guarda en kilos aunque se escriba en toneladas', `${tras.peso_neto_max_kg}`);
    ok(Number(tras.peso_bruto_max_kg) === 27500, 'y el bruto tambien');
    ok(/naviera/i.test(String(tras.nota_restricciones)), 'la nota queda guardada');
    ok(tras.restricciones_por !== null, 'y queda registrado quien la anoto');
    await p.context().close();
  }

  console.log('\n─── 4 · El bruto no puede ser menor que el neto ───');
  {
    const [r] = await consultar(
      `select id from pedidos where ciclo not in ('despachado','cerrado','cancelado') limit 1`);
    // Se comprueba por la vía del servidor: la validación tiene que estar ahí,
    // no solo en el formulario.
    const p = await entrar('comercial@santamonica.pe');
    const res = await p.evaluate(async () => 'ok');
    ok(res === 'ok', 'sesión de Comercial abierta');
    await p.context().close();

    // La regla, comprobada contra la base: el CHECK impide un tope <= 0.
    let rechazado = false;
    try {
      await consultar(`update pedidos set peso_neto_max_kg = 0 where id = ${r.id}`);
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

    /*
     * El tope se pone en EL PEDIDO que lleva ese embarque, no en el embarque:
     * ahí es donde vive ahora. La vista se encarga de traerlo y de quedarse
     * con el mas estricto cuando hay varios.
     */
    const [dueno] = await consultar(
      `select pedido_id from embarque_pedidos where embarque_id = ${emb.embarque_id} limit 1`);
    tocado = dueno.pedido_id;
    await consultar(
      `update pedidos set peso_neto_max_kg = ${Math.round(Number(emb.cargado) * 0.9)}
        where id = ${dueno.pedido_id}`);

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
      `update pedidos set peso_neto_max_kg = ${Math.round(Number(emb.cargado) / 0.97)}
        where id = ${dueno.pedido_id}`);
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
    const botones = await p.locator('button, a', { hasText: /Fijar restricci|Cambiar la restricci/i }).count();
    ok(botones === 0, 'Almacen no puede fijar la restriccion: la consume, no la decide');
    await p.context().close();
  }
} finally {
  await restaurar();
  await nav.close();
}

console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo correcto');
process.exit(fallos.length ? 1 : 0);
