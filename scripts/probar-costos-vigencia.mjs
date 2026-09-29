/**
 * ============================================================================
 *  PRUEBA DE COSTOS CON VIGENCIA, HISTORIAL Y MARGEN BRUTO (migración 057)
 * ============================================================================
 *  Documento de mejoras 2.2 y respuesta de Oliver:
 *   · el costo se carga obligatoriamente al inicio de cada mes;
 *   · después se puede actualizar (semanalmente);
 *   · cada cambio guarda costo anterior, nuevo, fecha y usuario;
 *   · un cambio solo vale HACIA ADELANTE: para lo que ingrese desde entonces;
 *   · margen bruto = venta − costo.
 *
 *  Todo lo que la prueba crea —vigencias, un producto temporal, lotes sin
 *  movimiento— se borra al final, historial incluido, con el interruptor de
 *  mantenimiento que la aplicación no puede activar.
 *
 *      node scripts/probar-costos-vigencia.mjs
 * ============================================================================
 */
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { ejecutarSQL } from './db.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const consultar = async (sql) => {
  const r = await ejecutarSQL(sql);
  return Array.isArray(r) ? r : [];
};
/** Ejecuta y devuelve el mensaje de error de la base, o null si no falló. */
const falla = async (sql) => {
  try { await ejecutarSQL(sql); return null; } catch (e) { return String(e.message); }
};
const SEC = (n, t) => `\n${'─'.repeat(3)} ${n} · ${t} ${'─'.repeat(3)}`;
const fallos = [];
const ok = (cond, texto, detalle = '') => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${texto}${detalle ? ' · ' + detalle : ''}`);
  if (!cond) fallos.push(texto);
};
const numero = (t) => Number(String(t).replace(/[^\d.-]/g, ''));
const HOY = `(now() at time zone 'America/Lima')::date`;

const [{ ahora: INICIO }] = await consultar(`select now() as ahora`);
const [{ valor: exigirOriginal }] = await consultar(
  `select valor from parametros where clave = 'costos_exigir_carga_mensual'`);
const temporal = { sku: null, pres: null };
const lotesPrueba = [];

/** Deja la base exactamente como estaba. */
async function limpiar() {
  await consultar(`
    begin;
    select set_config('app.costos_carga_historica', 'si', true);
    ${lotesPrueba.length ? `delete from lotes where id in (${lotesPrueba.join(',')});` : ''}
    ${temporal.pres ? `delete from sku_presentaciones where id = ${temporal.pres};` : ''}
    ${temporal.sku ? `delete from skus where id = ${temporal.sku};` : ''}
    delete from costos_mensuales where creado_en >= '${INICIO}' and vigente_desde >= ${HOY};
    delete from costos_historial where registrado_en >= '${INICIO}';
    commit;`);
  await consultar(`update parametros set valor = '${exigirOriginal}' where clave = 'costos_exigir_carga_mensual'`);
  await consultar(`select costos_avisar_carga_mensual()`);
}

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
  //  Un producto con carga del mes y sin nada posterior: sobre él se prueba.
  const [base] = await consultar(`
    select c.id, c.sku_id, c.total_kg, c.materia_prima_kg as mp, c.conversion_kg as conv,
           c.variable_kg as varia, c.registrado_por, c.vigente_desde::text as desde,
           (select sp.id from sku_presentaciones sp where sp.sku_id = c.sku_id order by sp.id limit 1) as pres
      from costos_mensuales c
     where c.tipo = 'mensual' and c.vigente_desde < ${HOY}
       and c.vigente_desde >= date_trunc('month', ${HOY})::date
       and not exists (select 1 from costos_mensuales x where x.sku_id = c.sku_id and x.vigente_desde > c.vigente_desde)
     order by c.sku_id limit 1`);

  console.log(SEC(1, 'Solo hacia adelante: lo impone la base'));
  {
    const ayer = await falla(`
      insert into costos_mensuales (sku_id, anio, mes, vigente_desde, tipo, materia_prima_kg, conversion_kg, variable_kg, registrado_por)
      values (${base.sku_id}, 2000, 1, ${HOY} - 1, 'actualizacion', 1, 1, 1, '${base.registrado_por}')`);
    ok(/fecha pasada/i.test(ayer ?? ''), 'no se puede cargar un costo con fecha de ayer', (ayer ?? 'lo aceptó').slice(0, 90));

    const cambiar = await falla(`update costos_mensuales set materia_prima_kg = materia_prima_kg + 1 where id = ${base.id}`);
    ok(/ya se aplic/i.test(cambiar ?? ''), 'no se puede cambiar un costo que ya rige', (cambiar ?? 'lo aceptó').slice(0, 90));

    const borrar = await falla(`delete from costos_mensuales where id = ${base.id}`);
    ok(/no se puede borrar/i.test(borrar ?? ''), 'ni borrarlo', (borrar ?? 'lo aceptó').slice(0, 90));

    const [intacto] = await consultar(`select total_kg from costos_mensuales where id = ${base.id}`);
    ok(Math.abs(Number(intacto.total_kg) - Number(base.total_kg)) < 0.0001, 'y queda intacto');

    const [coh] = await consultar(`
      select count(*) filter (where anio <> extract(year from vigente_desde) or mes <> extract(month from vigente_desde)) as mal
        from costos_mensuales`);
    ok(Number(coh.mal) === 0, 'año y mes coinciden siempre con la vigencia');
  }

  console.log(SEC(2, 'Una actualización de hoy, con su historial'));
  let actualizacionId;
  {
    const [a] = await consultar(`
      insert into costos_mensuales (sku_id, anio, mes, vigente_desde, tipo, materia_prima_kg, conversion_kg, variable_kg, registrado_por, observaciones)
      values (${base.sku_id}, 2000, 1, ${HOY}, 'actualizacion', ${Number(base.mp) + 0.2}, ${base.conv}, ${base.varia}, '${base.registrado_por}', 'PRUEBA')
      returning id, total_kg`);
    actualizacionId = a.id;
    const [h] = await consultar(`
      select accion, total_antes, total_nuevo, usuario_nombre from costos_historial where costo_id = ${a.id}`);
    ok(h?.accion === 'alta', 'el alta queda en el historial');
    ok(Math.abs(Number(h.total_antes) - Number(base.total_kg)) < 0.0001,
       'con el costo anterior: el que regía justo antes', `${h.total_antes}`);
    ok(Math.abs(Number(h.total_nuevo) - Number(a.total_kg)) < 0.0001, 'el nuevo', `${h.total_nuevo}`);
    ok(Boolean(h.usuario_nombre), 'y el usuario', h.usuario_nombre);

    const [rige] = await consultar(`select costo_produccion_kg(${base.sku_id}, ${HOY}) as c, costo_produccion_kg(${base.sku_id}, ${HOY} - 1) as ayer`);
    ok(Math.abs(Number(rige.c) - Number(a.total_kg)) < 0.0001, 'desde hoy rige la actualización');
    ok(Math.abs(Number(rige.ayer) - Number(base.total_kg)) < 0.0001, 'y ayer seguía rigiendo la carga del mes');

    //  Lo de hoy sí se puede corregir: todavía es un error recién cometido.
    await consultar(`update costos_mensuales set variable_kg = variable_kg + 0.05 where id = ${a.id}`);
    const [c] = await consultar(`
      select accion, total_antes, total_nuevo from costos_historial where costo_id = ${a.id} and accion = 'correccion'`);
    ok(Boolean(c) && Math.abs(Number(c.total_nuevo) - Number(c.total_antes) - 0.05) < 0.0001,
       'una corrección de hoy también queda, con antes y después', c ? `${c.total_antes} → ${c.total_nuevo}` : '');

    const tocarHist = await falla(`update costos_historial set total_nuevo = 0 where costo_id = ${a.id}`);
    ok(/no se puede modificar/i.test(tocarHist ?? ''), 'el historial no se puede modificar');
    const borrarHist = await falla(`delete from costos_historial where costo_id = ${a.id}`);
    ok(/no se puede/i.test(borrarHist ?? ''), 'ni borrar');

    const [todas] = await consultar(`
      select count(*) as sin from costos_mensuales c
       where not exists (select 1 from costos_historial h where h.costo_id = c.id and h.accion = 'alta')`);
    ok(Number(todas.sin) === 0, 'todos los costos, también los viejos, tienen su alta en el historial');
  }

  console.log(SEC(3, 'El lote toma el costo que rige al ingresar, y lo conserva'));
  {
    const lote = async (sufijo, pres, costoTecleado) => {
      const [l] = await consultar(`
        insert into lotes (codigo_pallet, campania, sku_presentacion_id, fecha_produccion,
                           bultos_iniciales, peso_neto_inicial_kg, costo_unitario, observaciones)
        values ('PRUEBA-COSTO-${sufijo}-${Date.now()}', 2026, ${pres}, ${HOY}, 10, 200, ${costoTecleado}, 'PRUEBA')
        returning id, costo_unitario, costo_origen, costo_vigencia_id`);
      lotesPrueba.push(l.id);
      return l;
    };
    const [vig] = await consultar(`select id, total_kg from costos_mensuales where id = ${actualizacionId}`);
    const l1 = await lote('A', base.pres, 9.99);
    ok(Math.abs(Number(l1.costo_unitario) - Number(vig.total_kg)) < 0.0001,
       'toma el costo vigente, no el tecleado', `${l1.costo_unitario} (tecleado 9.99)`);
    ok(l1.costo_origen === 'estandar' && Number(l1.costo_vigencia_id) === Number(vig.id),
       'y sabe de qué vigencia salió');

    //  Cambia el costo: el lote de antes NO se toca; el siguiente toma el nuevo.
    await consultar(`update costos_mensuales set materia_prima_kg = materia_prima_kg + 0.3 where id = ${actualizacionId}`);
    const [nuevo] = await consultar(`select total_kg from costos_mensuales where id = ${actualizacionId}`);
    const [l1b] = await consultar(`select costo_unitario from lotes where id = ${l1.id}`);
    ok(Math.abs(Number(l1b.costo_unitario) - Number(l1.costo_unitario)) < 0.0001,
       'si después cambia el costo, el lote que ya entró conserva el suyo');
    const l2 = await lote('B', base.pres, 0);
    ok(Math.abs(Number(l2.costo_unitario) - Number(nuevo.total_kg)) < 0.0001,
       'y el que entra después toma el nuevo', `${l2.costo_unitario}`);

    /*
     * Un producto que nunca tuvo costo: el lote se queda con el tecleado y lo
     * dice. Con el parámetro de exigir la carga, no puede ingresar.
     */
    const [plantilla] = await consultar(`select especie_id, formato_id from skus where id = ${base.sku_id}`);
    const [sku] = await consultar(`
      insert into skus (codigo, especie_id, formato_id, corte, clasificacion_comercial, activo)
      values ('PRUEBA-${Date.now()}', ${plantilla.especie_id}, ${plantilla.formato_id}, 'PRUEBA', 'PRUEBA', true)
      returning id`);
    temporal.sku = sku.id;
    const [pr] = await consultar(`
      insert into sku_presentaciones (sku_id, presentacion_id)
      select ${sku.id}, presentacion_id from sku_presentaciones where id = ${base.pres} returning id`);
    temporal.pres = pr.id;

    const l3 = await lote('C', pr.id, 1.2345);
    ok(Math.abs(Number(l3.costo_unitario) - 1.2345) < 0.0001 && l3.costo_origen === 'manual',
       'un producto sin ningún costo cargado conserva el tecleado, marcado como manual');

    await consultar(`update parametros set valor = 'si' where clave = 'costos_exigir_carga_mensual'`);
    const exigido = await falla(`
      insert into lotes (codigo_pallet, campania, sku_presentacion_id, fecha_produccion, bultos_iniciales, peso_neto_inicial_kg, costo_unitario)
      values ('PRUEBA-COSTO-D-${Date.now()}', 2026, ${pr.id}, ${HOY}, 10, 200, 1)`);
    ok(/no tiene cargado el costo/i.test(exigido ?? ''),
       'con «exigir la carga del mes» en sí, ese ingreso se rechaza', (exigido ?? 'lo aceptó').slice(0, 80));
    const l4 = await lote('E', base.pres, 0);
    ok(Number(l4.costo_unitario) > 0, 'y el de un producto con su carga del mes entra sin problema');
    await consultar(`update parametros set valor = '${exigirOriginal}' where clave = 'costos_exigir_carga_mensual'`);
  }

  console.log(SEC(4, 'El aviso de la carga obligatoria del mes'));
  {
    //  El producto temporal está activo y no tiene carga: tiene que saltar.
    await consultar(`select costos_avisar_carga_mensual()`);
    const [al] = await consultar(`
      select count(*) as n, max(mensaje) as m, max(severidad::text) as sev from alertas
       where titulo = 'Costos del mes sin cargar' and not atendida`);
    const [cuenta] = await consultar(`select count(*) filter (where not cargado) as faltan, count(*) as total from v_costos_carga_mes`);
    ok(Number(al.n) === 1 && String(al.m).startsWith(`${cuenta.faltan} de ${cuenta.total} productos`),
       'salta uno solo, con cuántos faltan', String(al.m).slice(0, 70));
    ok(al.sev === 'critica', 'y es crítico: la carga es obligatoria');
    await consultar(`select costos_avisar_carga_mensual()`);
    const [dos] = await consultar(`select count(*) as n from alertas where titulo = 'Costos del mes sin cargar' and not atendida`);
    ok(Number(dos.n) === 1, 'ejecutarlo otra vez no lo duplica');

    const [j] = await consultar(`select count(*) as n from cron.job where jobname = 'avisar_costos_del_mes' and active`);
    ok(Number(j.n) === 1, 'se revisa solo cada mañana');
  }

  console.log(SEC(5, 'Quién ve el costo que se aplicará al ingresar'));
  {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const como = async (correo) => {
      const cli = createClient(url, anonKey, { auth: { persistSession: false } });
      if (correo) {
        const { error } = await cli.auth.signInWithPassword({ email: correo, password: 'SantaMonica2026' });
        if (error) throw error;
      }
      return cli.rpc('costo_vigente_ingreso', { p_sku_presentacion_id: base.pres });
    };
    const anon = await como(null);
    ok(Boolean(anon.error), 'sin sesión, la función ni siquiera se puede llamar', anon.error?.message?.slice(0, 60));
    const consulta = await como('consulta@santamonica.pe');
    ok(!consulta.error && (consulta.data ?? []).length === 0, 'el rol Consulta no recibe ningún costo');
    const almacen = await como('almacen@santamonica.pe');
    ok(!almacen.error && (almacen.data ?? []).length === 1, 'Almacén sí, porque registra los ingresos',
       almacen.data?.[0] ? `US$ ${Number(almacen.data[0].total_kg).toFixed(4)}` : '');
  }

  console.log(SEC(6, 'El formulario de ingreso enseña el costo, no lo pide'));
  {
    const p = await entrar('almacen@santamonica.pe');
    await p.goto(`${BASE}/almacenes/ingresos/nuevo`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1500);
    const selector = p.locator('select').first();
    await selector.selectOption(String(base.pres));
    await p.waitForTimeout(2000);
    const bloque = p.locator('[data-costo="vigente"]');
    ok(await bloque.count() === 1, 'con costo vigente, se muestra en solo lectura');
    const [rige] = await consultar(`select costo_produccion_kg(${base.sku_id}, ${HOY}) as c`);
    ok(Math.abs(numero(await bloque.locator('output').innerText()) - Number(rige.c)) < 0.0001,
       'y es el que rige hoy', `${Number(rige.c).toFixed(4)}`);
    ok(await p.locator('[data-costo="vigente"] input').count() === 0, 'sin casilla para cambiarlo');
    await p.context().close();
  }

  console.log(SEC(7, 'La pantalla de costos'));
  {
    const p = await entrar('gerencia@santamonica.pe');
    //  Un mes pasado: solo lectura.
    const [pasado] = await consultar(`select to_char(${HOY} - interval '1 month', 'YYYY-MM') as m`);
    await p.goto(`${BASE}/finanzas/costos?periodo=${pasado.m}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1800);
    ok(/ya pas/i.test(await p.locator('body').innerText()), 'un mes pasado avisa que ya pasó');
    ok(await p.locator('.costo-campo').first().isDisabled(), 'y sus costos no se pueden editar');

    //  El mes siguiente: se deja lista la carga, que regirá desde el día 1.
    const [sig] = await consultar(`select to_char(${HOY} + interval '1 month', 'YYYY-MM') as m,
                                          to_char(date_trunc('month', ${HOY} + interval '1 month'), 'YYYY-MM-DD') as d1`);
    await p.goto(`${BASE}/finanzas/costos?periodo=${sig.m}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1800);
    const [antes] = await consultar(`select count(*) as n from costos_mensuales where vigente_desde = '${sig.d1}'`);
    await p.locator('button', { hasText: /cargar con los costos vigentes/i }).click();
    await p.waitForTimeout(4500);
    const [desp] = await consultar(`
      select count(*) as n, count(*) filter (where tipo = 'mensual') as mensual from costos_mensuales where vigente_desde = '${sig.d1}'`);
    const [activos] = await consultar(`select count(*) as n from v_costos_carga_mes where total_kg > 0`);
    ok(Number(desp.n) - Number(antes.n) === Number(activos.n) && Number(desp.mensual) === Number(desp.n),
       'un clic deja la carga del mes siguiente, desde el día 1', `${desp.n} productos`);
    const [igual] = await consultar(`
      select count(*) as mal from costos_mensuales f
       where f.vigente_desde = '${sig.d1}' and abs(f.total_kg - costo_produccion_kg(f.sku_id, ${HOY})) > 0.0001`);
    ok(Number(igual.mal) === 0, 'con el costo que rige hoy');
    /*
     * Quedan sin carga solo los productos que nunca tuvieron costo —aquí, el
     * temporal de la prueba—: no hay ninguno que copiar, y eso se tiene que
     * seguir viendo en vez de darse por cargado.
     */
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForTimeout(1500);
    const [sinNada] = await consultar(`select count(*) as n from v_costos_carga_mes where total_kg is null`);
    const kSin = p.locator('.kpi').filter({ has: p.locator('.kpi-etiqueta', { hasText: /^Sin la carga del mes$/i }) }).first();
    ok(numero(await kSin.locator('.kpi-valor').innerText()) === Number(sinNada.n),
       'solo quedan sin carga los que nunca tuvieron costo, y se siguen viendo', `${sinNada.n}`);

    //  El historial de un producto.
    await p.goto(`${BASE}/finanzas/costos?historial=${base.sku_id}#historial`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1500);
    const filas = await p.locator('table[data-cuadro="historial"] tbody tr').count();
    const [nh] = await consultar(`select count(*) as n from costos_historial where sku_id = ${base.sku_id}`);
    ok(filas === Number(nh.n), 'el historial de un producto trae todos sus cambios', `${filas}`);
    ok(await p.locator('table[data-cuadro="historial"] tbody tr[data-accion="correccion"]').count() >= 1,
       'incluida la corrección de hoy');
    await p.context().close();
  }

  console.log(SEC(8, 'Margen bruto = venta − costo'));
  {
    //  Recalculado desde las tablas, sin pasar por la vista.
    const [r] = await consultar(`
      with l as (
        select pkl.id, pkl.peso_neto_kg as kg, lo.costo_unitario,
               a_dolares(pl.precio_tm * (1 - pl.descuento_pct / 100), p.moneda, p.tipo_cambio) as precio
          from packing_lineas pkl
          join packing_lists pk on pk.id = pkl.packing_list_id and pk.estado <> 'anulado'
          join despachos d on d.packing_list_id = pk.id
          join pedido_lineas pl on pl.id = pkl.pedido_linea_id
          join pedidos p on p.id = pl.pedido_id
          join lotes lo on lo.id = pkl.lote_id)
      select count(*) as n,
             count(*) filter (where abs(v.venta - l.precio * l.kg / 1000) > 0.01) as mal_venta,
             count(*) filter (where abs(v.costo - l.costo_unitario * l.kg) > 0.01) as mal_costo,
             count(*) filter (where abs(v.margen - (v.venta - v.costo)) > 0.01) as mal_margen
        from l join v_margen_bruto_linea v on v.packing_linea_id = l.id`);
    ok(Number(r.n) > 0, 'hay líneas despachadas que medir', `${r.n}`);
    ok(Number(r.mal_venta) === 0, 'venta = kilos despachados × precio de su línea de pedido, en US$');
    ok(Number(r.mal_costo) === 0, 'costo = esos kilos × el costo con que ingresó el pallet');
    ok(Number(r.mal_margen) === 0, 'margen bruto = venta − costo');

    const [m] = await consultar(`
      select count(*) filter (where abs(v.venta - s.venta) > 0.01 or abs(v.costo - s.costo) > 0.01) as mal
        from v_margen_bruto_mensual v
        join (select mes, sum(venta) as venta, sum(costo) as costo from v_margen_bruto_linea group by mes) s on s.mes = v.mes`);
    ok(Number(m.mal) === 0, 'cada mes suma exactamente sus líneas');

    const [dup] = await consultar(`
      select count(*) - count(distinct packing_linea_id) as dup from v_margen_bruto_linea`);
    ok(Number(dup.dup) === 0, 'cada kilo cuenta una vez: un contenedor compartido no se duplica');

    const p = await entrar('gerencia@santamonica.pe');
    await p.goto(`${BASE}/finanzas/rentabilidad`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(2000);
    const [ult] = await consultar(`select clave, venta, costo, margen, pedidos from v_margen_bruto_mensual order by mes desc limit 1`);
    const kpi = async (etiqueta) => {
      const k = p.locator('.kpi').filter({ has: p.locator('.kpi-etiqueta', { hasText: new RegExp(`^${etiqueta}$`, 'i') }) }).first();
      return numero(await k.locator('.kpi-valor').innerText());
    };
    ok(Math.abs(await kpi('Margen bruto') - Math.round(Number(ult.margen))) <= 1,
       'la pestaña principal de Rentabilidad es el margen bruto del último mes', `${ult.clave}`);
    ok(Math.abs(await kpi('Venta') - Math.round(Number(ult.venta))) <= 1, 'con su venta');
    ok(Math.abs(await kpi('Costo') - Math.round(Number(ult.costo))) <= 1, 'y su costo');
    ok(await p.locator('table[data-cuadro="bruto-pedidos"] tbody tr').count() === Number(ult.pedidos),
       'la tarjeta de pedidos abre los pedidos del mes', `${ult.pedidos}`);
    await p.context().close();
  }
} finally {
  await limpiar();
  await nav.close();
}

const [fin] = await consultar(`
  select (select count(*) from costos_mensuales where creado_en >= '${INICIO}') as costos,
         (select count(*) from costos_historial where registrado_en >= '${INICIO}') as historial`);
ok(Number(fin.costos) === 0 && Number(fin.historial) === 0, 'la prueba no deja rastro', `${fin.costos} / ${fin.historial}`);

console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo correcto');
process.exit(fallos.length ? 1 : 0);
