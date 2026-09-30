/**
 * ============================================================================
 *  PRUEBA DE LAS OBSERVACIONES DE OLIVER (30/09)
 * ============================================================================
 *    1. «Solo mercado nacional» debe estar libre, con la condición de venta
 *       para mercado nacional (migración 061).
 *    2. La base del producto son las toneladas, no los pallets (062).
 *    3. Los costos los cargan Marco y él, por producto, y tiene que quedar
 *       claro dónde se hace la carga del mes y la actualización semanal (062).
 *
 *  Todo lo que la prueba toca se devuelve en el `finally`.
 *
 *      node scripts/probar-observaciones-oliver.mjs
 * ============================================================================
 */
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { ejecutarSQL } from './db.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const consultar = async (sql) => { const r = await ejecutarSQL(sql); return Array.isArray(r) ? r : []; };
const falla = async (sql) => { try { await ejecutarSQL(sql); return null; } catch (e) { return String(e.message); } };
const SEC = (n, t) => `\n${'─'.repeat(3)} ${n} · ${t} ${'─'.repeat(3)}`;
const fallos = [];
const ok = (cond, texto, detalle = '') => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${texto}${detalle ? ' · ' + detalle : ''}`);
  if (!cond) fallos.push(texto);
};
const numero = (t) => Number(String(t).replace(/[^\d.-]/g, ''));
const HOY = `(now() at time zone 'America/Lima')::date`;

const [{ ahora: INICIO }] = await consultar(`select now() as ahora`);
const [gerente] = await consultar(`select id from usuarios where email = 'gerencia@santamonica.pe'`);
let pedidoTocado = null;   // { id, tipo } para devolver su tipo de despacho
const reservasPrueba = [];

async function limpiar() {
  if (reservasPrueba.length) await consultar(`delete from reservas where id in (${reservasPrueba.join(',')})`);
  if (pedidoTocado) await consultar(`update pedidos set tipo_despacho = '${pedidoTocado.tipo}' where id = ${pedidoTocado.id}`);
  await consultar(`delete from dictamenes_calidad where motivo_texto = 'PRUEBA observaciones'`);
  await consultar(`
    begin;
    select set_config('app.costos_carga_historica', 'si', true);
    delete from costos_mensuales where creado_en >= '${INICIO}' and vigente_desde >= ${HOY};
    delete from costos_historial where registrado_en >= '${INICIO}';
    commit;`);
}

const cliente = async (email) => {
  const cli = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await cli.auth.signInWithPassword({ email, password: 'SantaMonica2026' });
  if (error) throw error;
  return { cli, id: data.user.id };
};
const nav = await chromium.launch({ channel: 'chrome', headless: true });
async function entrar(correo) {
  const p = await (await nav.newContext({ viewport: { width: 1600, height: 1100 } })).newPage();
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', correo);
  await p.fill('input[type="password"]', 'SantaMonica2026');
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/panel/, { timeout: 30000 });
  return p;
}
const kpi = async (p, etiqueta) => {
  const k = p.locator('.kpi').filter({ has: p.locator('.kpi-etiqueta', { hasText: new RegExp(`^${etiqueta}$`, 'i') }) }).first();
  return { valor: numero(await k.locator('.kpi-valor').innerText()), texto: await k.innerText() };
};

try {
  console.log(SEC(1, '«Solo mercado nacional»: libre, pero solo para pedidos nacionales'));
  {
    const [lote] = await consultar(`
      select v.lote_id, v.almacen_id, v.sku_presentacion_id, v.disponible_kg, v.solo_nacional_kg, v.bloqueado_kg
        from v_stock_lote v where v.solo_nacional_kg > 0 order by v.lote_id limit 1`);
    ok(Boolean(lote) && Number(lote.bloqueado_kg) === 0 && Number(lote.disponible_kg) > 0,
       'el pallet ya no está bloqueado: cuenta como disponible', lote ? `${Number(lote.disponible_kg).toFixed(0)} kg` : '');

    //  Una línea de pedido confirmado del mismo producto; se le cambia el
    //  tipo de despacho un momento para probar los dos casos.
    const [linea] = await consultar(`
      select pl.id, p.id as pedido_id, p.tipo_despacho::text as tipo from pedido_lineas pl join pedidos p on p.id = pl.pedido_id
       where pl.sku_presentacion_id = ${lote.sku_presentacion_id} and p.ciclo = 'confirmado' order by pl.id limit 1`);
    ok(Boolean(linea), 'hay un pedido confirmado de ese producto para probar');
    pedidoTocado = { id: linea.pedido_id, tipo: linea.tipo };
    const reservar = () => falla(`
      insert into reservas (pedido_linea_id, lote_id, almacen_id, bultos, peso_neto_kg, creado_por)
      values (${linea.id}, ${lote.lote_id}, ${lote.almacen_id}, 1, 10, '${gerente.id}')`);

    await consultar(`update pedidos set tipo_despacho = 'exportacion' where id = ${linea.pedido_id}`);
    const e1 = await reservar();
    ok(/Solo mercado nacional/.test(e1 ?? ''), 'reservarlo para un pedido de exportación se rechaza', (e1 ?? 'lo aceptó').slice(60, 170));
    const e2 = await falla(`
      insert into packing_lineas (packing_list_id, lote_id, pedido_linea_id, bultos, peso_neto_kg)
      select id, ${lote.lote_id}, ${linea.id}, 1, 10 from packing_lists order by id limit 1`);
    ok(/Solo mercado nacional/.test(e2 ?? ''), 'y cargarlo en un contenedor de exportación también');

    await consultar(`update pedidos set tipo_despacho = 'mercado_nacional' where id = ${linea.pedido_id}`);
    const e3 = await reservar();
    const [creada] = await consultar(`select id from reservas where lote_id = ${lote.lote_id} and pedido_linea_id = ${linea.id} and creado_en >= '${INICIO}'`);
    if (creada) reservasPrueba.push(creada.id);
    ok(e3 === null && Boolean(creada), 'para un pedido de mercado nacional, sí se puede', e3 ?? '');

    /*
     * Y la regla no estorba a lo normal: cargar un pallet cualquiera en un
     * packing tiene que seguir funcionando. (Una primera versión de la regla
     * rompía TODA carga a packing; esta comprobación es la que lo detectó.)
     */
    const [normal] = await consultar(`
      select v.lote_id, pl.id as linea, (select id from packing_lists order by id limit 1) as pk
        from v_stock_lote v join pedido_lineas pl on pl.sku_presentacion_id = v.sku_presentacion_id
       where v.solo_nacional_kg = 0 and v.disponible_kg > 0 limit 1`);
    const e5 = await falla(`begin;
      insert into packing_lineas (packing_list_id, lote_id, pedido_linea_id, bultos, peso_neto_kg)
      values (${normal.pk}, ${normal.lote_id}, ${normal.linea}, 1, 10);
      rollback;`);
    ok(e5 === null, 'un pallet normal se sigue cargando en packing sin problema', e5?.slice(0, 120) ?? '');

    //  Al revés: no se puede condicionar un pallet ya apartado para exportación.
    await consultar(`update pedidos set tipo_despacho = 'exportacion' where id = ${linea.pedido_id}`)
      .catch(() => undefined);
    const [otro] = await consultar(`
      select v.lote_id, v.almacen_id from v_stock_lote v
       where v.sku_presentacion_id = ${lote.sku_presentacion_id} and v.disponible_kg > 20 and v.solo_nacional_kg = 0
       order by v.lote_id limit 1`);
    if (otro) {
      await consultar(`insert into reservas (pedido_linea_id, lote_id, almacen_id, bultos, peso_neto_kg, creado_por)
        values (${linea.id}, ${otro.lote_id}, ${otro.almacen_id}, 1, 10, '${gerente.id}')`);
      const [r2] = await consultar(`select id from reservas where lote_id = ${otro.lote_id} and creado_en >= '${INICIO}' order by id desc limit 1`);
      reservasPrueba.push(r2.id);
      const e4 = await falla(`
        insert into dictamenes_calidad (lote_id, tipo, estado, motivo_id, motivo_texto, vigente)
        select ${otro.lote_id}, 'calidad', 'observado', id, 'PRUEBA observaciones', true
          from motivos where codigo = 'MERCADO_NACIONAL'`);
      ok(/apartado para el pedido/.test(e4 ?? ''), 'marcar «mercado nacional» un pallet apartado para exportación se rechaza',
         (e4 ?? 'lo aceptó').slice(60, 160));
    }

    /*
     * El reparto del stock entre pedidos: la bolsa «solo nacional» no cubre
     * pedidos de exportación. Por producto, lo que cubren los de exportación
     * no puede pasar del stock general.
     */
    const [rep] = await consultar(`
      with pools as (
        select sku_presentacion_id, sum(disponible_kg - solo_nacional_kg) as general, sum(solo_nacional_kg) as nacional
          from v_disponibilidad group by 1),
      usos as (
        select c.sku_presentacion_id,
               sum(c.cubre_libre_kg) filter (where p.tipo_despacho <> 'mercado_nacional') as export_kg,
               sum(c.cubre_libre_kg) as total_kg
          from v_pedido_linea_cobertura c join pedidos p on p.id = c.pedido_id group by 1)
      select count(*) filter (where coalesce(u.export_kg, 0) > coalesce(po.general, 0) + 0.01) as export_de_mas,
             count(*) filter (where coalesce(u.total_kg, 0) > coalesce(po.general, 0) + coalesce(po.nacional, 0) + 0.01) as total_de_mas
        from usos u left join pools po on po.sku_presentacion_id = u.sku_presentacion_id`);
    ok(Number(rep.export_de_mas) === 0, 'ningún pedido de exportación se cubre con stock «solo nacional»');
    ok(Number(rep.total_de_mas) === 0, 'y nunca se reparte más stock del que hay');
    const [inv] = await consultar(`
      select count(*) filter (where abs(pendiente_kg - con_stock_kg - backorder_kg) > 0.01) as mal from v_pedido_linea_cobertura`);
    ok(Number(inv.mal) === 0, 'cada línea: pendiente = con stock + backorder');
  }

  console.log(SEC(2, 'La base es la tonelada'));
  {
    const p = await entrar('operaciones@santamonica.pe');
    await p.goto(`${BASE}/alertas`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1200);
    const [a] = await consultar(`select cifra, unidad from v_alertas_principales where clave = 'por_vencer'`);
    const tarjeta = p.locator('[data-bloque="principales"] .kpi').first();
    ok(/TM/.test(await tarjeta.locator('.kpi-valor').innerText()) && Math.abs(numero(await tarjeta.locator('.kpi-valor').innerText()) - Number(a.cifra)) < 0.05,
       'Alertas: «próximos a vencer» en toneladas', `${a.cifra} ${a.unidad}`);

    await p.goto(`${BASE}/almacenes/anticuamiento`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1200);
    const [v] = await consultar(`select round(coalesce(sum(fisico_kg), 0) / 1000, 1) as tm, count(*) as n from v_anticuamiento
      where fisico_kg > 0 and situacion_vida_util = 'vencido'`);
    const k = await kpi(p, 'Ya vencido');
    ok(Math.abs(k.valor - Number(v.tm)) < 0.05 && k.texto.includes(`${v.n} pallets`),
       'Anticuamiento: «Ya vencido» en TM, con los pallets de apoyo', `${v.tm} TM · ${v.n} pallets`);

    await p.goto(`${BASE}/almacenes/calidad`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1200);
    const [c] = await consultar(`select round(coalesce(sum(fisico_kg), 0) / 1000, 1) as tm from v_stock_condicion where condicion = 'observado'`);
    ok(Math.abs((await kpi(p, 'Observado')).valor - Number(c.tm)) < 0.05,
       'Calidad: toneladas observadas, no número de dictámenes', `${c.tm} TM`);
    const [n] = await consultar(`select round(coalesce(sum(fisico_kg), 0) / 1000, 1) as tm from v_stock_condicion where condicion = 'condicionado'`);
    ok(Math.abs((await kpi(p, 'Solo mercado nacional')).valor - Number(n.tm)) < 0.05,
       'y una tarjeta propia para lo de mercado nacional', `${n.tm} TM`);

    await p.goto(`${BASE}/ventas/disponibilidad`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1200);
    ok(/solo mercado nacional/i.test((await kpi(p, 'Disponible')).texto),
       'Disponibilidad: dice cuánto del disponible es solo para mercado nacional');
    await p.context().close();
  }

  console.log(SEC(3, 'Los costos: Marco y Oliver, y dónde se hace cada cosa'));
  {
    const [perm] = await consultar(`select string_agg(email, ', ' order by email) as quienes from usuarios where carga_costos`);
    ok(perm.quienes === 'gerencia@santamonica.pe, operaciones@santamonica.pe', 'cargan costos Marco y Oliver', perm.quienes);

    const [sku] = await consultar(`
      select c.sku_id, c.materia_prima_kg, c.conversion_kg, c.variable_kg from costos_vigentes_al(${HOY}) c
       where c.vigente_desde < ${HOY} order by c.sku_id limit 1`);
    const oliver = await cliente('operaciones@santamonica.pe');
    const w = await oliver.cli.from('costos_mensuales').insert({
      sku_id: sku.sku_id, vigente_desde: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' }),
      anio: 2026, mes: 9, tipo: 'actualizacion', registrado_por: oliver.id,
      materia_prima_kg: Number(sku.materia_prima_kg), conversion_kg: Number(sku.conversion_kg), variable_kg: Number(sku.variable_kg) + 0.01,
    }).select('id');
    ok(!w.error && (w.data ?? []).length === 1, 'Oliver ya puede escribir costos (antes solo Gerencia)', w.error?.message ?? '');

    const comercial = await cliente('comercial@santamonica.pe');
    const w2 = await comercial.cli.from('costos_mensuales').insert({
      sku_id: sku.sku_id, vigente_desde: '2099-01-01', anio: 2099, mes: 1, tipo: 'mensual', registrado_por: comercial.id,
      materia_prima_kg: 1, conversion_kg: 1, variable_kg: 1,
    });
    ok(Boolean(w2.error), 'Comercial no');
    const w3 = await comercial.cli.from('usuarios').update({ carga_costos: true }).eq('id', comercial.id);
    ok(Boolean(w3.error), 'ni puede darse el permiso a sí mismo');

    //  La pantalla, como Oliver: las dos tareas con nombre, y el bloque.
    const p = await entrar('operaciones@santamonica.pe');
    await p.goto(`${BASE}/finanzas/costos`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1500);
    const cuerpo = await p.locator('body').innerText();
    ok(!/solo lectura/i.test(cuerpo), 'Oliver ya no ve la pantalla en solo lectura');
    ok(/Carga del mes/.test(cuerpo) && /Actualización semanal/.test(cuerpo), 'y ve las dos tareas: carga del mes y actualización semanal');

    const [fam] = await consultar(`
      select s.clasificacion_comercial as familia, count(*) as n from skus s
        join costos_vigentes_al(${HOY}) c on c.sku_id = s.id where s.activo
       group by 1 having count(*) between 2 and 4 order by 1 limit 1`);
    const bloque = p.locator('[data-bloque="actualizar"]');
    await bloque.locator('select[name="familia"]').selectOption(fam.familia);
    await bloque.locator('select[name="componente"]').selectOption('conversion_kg');
    await bloque.locator('select[name="modo"]').selectOption('porcentaje');
    await bloque.locator('input[name="cantidad"]').fill('10');
    await bloque.locator('[data-accion="ver-alcance"]').click();
    await p.waitForTimeout(2500);
    const previa = await bloque.innerText();
    ok(new RegExp(`Afectará a ${fam.n} producto`).test(previa), 'antes de aplicar dice a cuántos productos afecta', `${fam.n} de «${fam.familia}»`);

    const antes = await consultar(`
      select c.sku_id, c.conversion_kg from costos_vigentes_al(${HOY}) c join skus s on s.id = c.sku_id
       where s.clasificacion_comercial = '${fam.familia.replace(/'/g, "''")}' and s.activo`);
    await bloque.locator('[data-accion="aplicar-bloque"]').click();
    await p.waitForTimeout(3500);
    const despues = await consultar(`
      select m.sku_id, m.conversion_kg, m.tipo from costos_mensuales m join skus s on s.id = m.sku_id
       where s.clasificacion_comercial = '${fam.familia.replace(/'/g, "''")}' and m.vigente_desde = ${HOY}`);
    const bien = antes.every((a) => {
      const d = despues.find((x) => Number(x.sku_id) === Number(a.sku_id));
      return d && Math.abs(Number(d.conversion_kg) - Math.round(Number(a.conversion_kg) * 1.1 * 10000) / 10000) < 0.0001;
    });
    ok(despues.length === Number(fam.n) && bien, 'aplica +10 % a la conversión de todos, desde hoy', `${despues.length} productos`);
    const [h] = await consultar(`
      select count(*) as n, bool_and(usuario_nombre = 'Oliver Tello') as de_oliver from costos_historial
       where registrado_en >= '${INICIO}' and observaciones like 'Actualización en bloque%'`);
    ok(Number(h.n) === Number(fam.n) && h.de_oliver, 'y cada producto queda en el historial, a su nombre', `${h.n}`);
    await p.context().close();

    //  Configuración: solo Gerencia cambia quién carga costos.
    const pm = await entrar('gerencia@santamonica.pe');
    await pm.goto(`${BASE}/configuracion?t=usuarios`, { waitUntil: 'networkidle' });
    await pm.waitForTimeout(1500);
    ok(await pm.locator('input[data-costos]').count() >= 7, 'Marco ve la columna «Carga costos» con casillas');
    await pm.context().close();
    const po = await entrar('operaciones@santamonica.pe');
    await po.goto(`${BASE}/configuracion?t=usuarios`, { waitUntil: 'networkidle' });
    await po.waitForTimeout(1500);
    ok(await po.locator('input[data-costos]').count() === 0, 'Oliver la ve sin casillas: ese permiso lo da Gerencia');
    await po.context().close();
  }
} finally {
  await limpiar();
  await nav.close();
}

const [fin] = await consultar(`
  select (select count(*) from costos_mensuales where creado_en >= '${INICIO}') as costos,
         (select count(*) from reservas where creado_en >= '${INICIO}') as reservas`);
ok(Number(fin.costos) === 0 && Number(fin.reservas) === 0, 'la prueba no deja rastro', `${fin.costos} / ${fin.reservas}`);
console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo correcto');
process.exit(fallos.length ? 1 : 0);
