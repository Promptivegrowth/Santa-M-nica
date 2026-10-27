/**
 * ============================================================================
 *  PRUEBA · LIMITACIONES DE CONTROL, ANÁLISIS Y PRODUCCIÓN (capítulo C)
 * ============================================================================
 *  Lo que la guía de uso avisaba como defecto y se corrigió:
 *
 *    1. Tiempos del flujo: la regla de «fechas imposibles» ya no aparta casos
 *       válidos (salir antes de lo programado, facturar antes de despachar,
 *       fechas iguales, salida nocturna en hora de Lima, pedido directo) y la
 *       pantalla dice cuántos excluyó y por qué (migración 071).
 *    2. Necesidades de producción: la nota al pie describe la consulta real.
 *    3. Rentabilidad: el desplegable de mes dice lo que hace y las líneas sin
 *       costo quedan fuera del margen, avisadas en pantalla y en el Excel.
 *    4. Cierre semanal: las casillas aceptan coma o punto decimal y preguntan
 *       cuando lo escrito se puede leer de dos maneras.
 *    5. Control de pedidos: las tablas se paginan y el total suma todo.
 *
 *  Todo lo que se cambia en la base se devuelve como estaba, y se borra la
 *  auditoría y el historial que eso dejó.
 *
 *      BASE_URL=http://localhost:3010 node --experimental-strip-types scripts/probar-analisis-limitaciones.mjs
 * ============================================================================
 */
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import { ejecutarSQL } from './db.mjs';
import { leerNumero } from '../src/lib/numeroEscrito.ts';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const consultar = async (sql) => { const r = await ejecutarSQL(sql); return Array.isArray(r) ? r : []; };
const SEC = (n, t) => `\n${'─'.repeat(3)} ${n} · ${t} ${'─'.repeat(3)}`;
/* Los números en pantalla van en es-PE: «22,527.7», «US$ 481,739». */
const numero = (t) => Number(String(t).replace(/[^\d.-]/g, ''));
const fallos = [];
const ok = (cond, texto, detalle = '') => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${texto}${detalle ? ' · ' + detalle : ''}`);
  if (!cond) fallos.push(texto);
};

const [{ inicio }] = await consultar(`select now()::text as inicio`);
const nav = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await nav.newContext({ viewport: { width: 1600, height: 1000 } });
const p = await ctx.newPage();

async function entrar(pagina, correo) {
  await pagina.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await pagina.fill('input[type="email"]', correo);
  await pagina.fill('input[type="password"]', process.env.CLAVE_DEMO ?? '');
  await pagina.click('button[type="submit"]');
  await pagina.waitForURL(/\/panel/, { timeout: 30000 });
}
const ir = async (ruta) => {
  //  Con otros agentes probando a la vez, el servidor de desarrollo a veces
  //  tarda: se espera a que cargue y, si la red no se calma, se sigue igual.
  await p.goto(`${BASE}${ruta}`, { waitUntil: 'load', timeout: 90000 });
  await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(800);
};
const kpi = async (etiqueta) => {
  const k = p.locator('.kpi').filter({ has: p.locator('.kpi-etiqueta', { hasText: new RegExp(`^${etiqueta}$`, 'i') }) }).first();
  return { valor: await k.locator('.kpi-valor').innerText(), texto: await k.innerText() };
};

/* Lo que hay que devolver a su sitio. */
let pedidoRoto = null;      // { id, fecha }
let embarqueAdelantado = null; // { id, fecha }
let loteSinCosto = null;    // { id, costo }
let lineaSinCosto = null;   // { id, costo }
const MES_CIERRE = { anio: 2027, mes: 11 };
const tocados = [];        // «(tabla = … and registro_id = …)» para limpiar la auditoría

try {
  await entrar(p, 'gerencia@santamonica.pe');

  /* ======================================================================= */
  console.log(SEC(1, 'Tiempos del flujo · la regla de fechas imposibles'));
  {
    /* 1a · Los casos, dentro de una transacción que se deshace. */
    const [base] = await consultar(`
      select t.pedido_id id, t.f_pedido, t.f_despacho, t.f_factura
        from v_tiempos_flujo t
       where t.f_despacho > t.f_pedido + 3 and t.f_factura is not null and t.cotizacion is not null
         and t.cronologia_valida
         and (select count(*) from embarque_pedidos ep join embarques e on e.id = ep.embarque_id
               where ep.pedido_id = t.pedido_id and e.estado <> 'cancelado') = 1
       order by t.pedido_id limit 1`);
    ok(!!base, 'hay un pedido despachado y facturado para probar', base && `pedido ${base.id}`);

    let mensaje = '';
    try {
      await ejecutarSQL(`
do $prueba$
declare
  v_id bigint := ${base.id};
  v_emb bigint; v_desp bigint; v_fac bigint; v_cot bigint;
  r jsonb := '{}'::jsonb;
  t record;
begin
  select e.id into v_emb from embarque_pedidos ep join embarques e on e.id = ep.embarque_id
   where ep.pedido_id = v_id and e.estado <> 'cancelado' limit 1;
  select d.id into v_desp from despachos d join packing_lists pk on pk.id = d.packing_list_id
   where pk.embarque_id = v_emb order by d.fecha_salida limit 1;
  select f.id into v_fac from facturas f where f.pedido_id = v_id and f.estado <> 'anulada' order by f.fecha_emision limit 1;
  select cotizacion_id into v_cot from pedidos where id = v_id;

  -- A · Salió 3 días ANTES de lo programado.
  update embarques set fecha_programada = (select f_despacho from v_tiempos_flujo where pedido_id = v_id) + 3 where id = v_emb;
  select cronologia_valida, dias_puntualidad into t from v_tiempos_flujo where pedido_id = v_id;
  r := r || jsonb_build_object('a_valida', t.cronologia_valida, 'a_dias', t.dias_puntualidad);

  -- B · Además, facturado el día antes de despachar.
  update facturas set fecha_emision = (select f_despacho from v_tiempos_flujo where pedido_id = v_id) - 1 where id = v_fac;
  delete from cobranzas where factura_id = v_fac;
  select cronologia_valida, dias_a_facturar into t from v_tiempos_flujo where pedido_id = v_id;
  r := r || jsonb_build_object('b_valida', t.cronologia_valida, 'b_dias', t.dias_a_facturar);

  -- C · Todo el mismo día: pedido, cotización, programado, despacho y factura.
  update pedidos set fecha_solicitada = (select f_despacho from v_tiempos_flujo where pedido_id = v_id) where id = v_id;
  update cotizaciones set fecha = (select f_pedido from v_tiempos_flujo where pedido_id = v_id) where id = v_cot;
  update embarques set fecha_programada = (select f_despacho from v_tiempos_flujo where pedido_id = v_id) where id = v_emb;
  update facturas set fecha_emision = (select f_despacho from v_tiempos_flujo where pedido_id = v_id) where id = v_fac;
  select cronologia_valida, dias_total, dias_puntualidad, dias_negociacion into t from v_tiempos_flujo where pedido_id = v_id;
  r := r || jsonb_build_object('c_valida', t.cronologia_valida, 'c_total', t.dias_total, 'c_punt', t.dias_puntualidad);

  -- D · Salida a las 21:30 de Lima del mismo día del pedido (02:30 UTC del día siguiente).
  update despachos set fecha_salida = ((select f_pedido from v_tiempos_flujo where pedido_id = v_id)::text || ' 21:30')::timestamp at time zone 'America/Lima'
   where id = v_desp;
  select cronologia_valida, f_despacho = f_pedido as mismo_dia into t from v_tiempos_flujo where pedido_id = v_id;
  r := r || jsonb_build_object('d_valida', t.cronologia_valida, 'd_mismo_dia', t.mismo_dia,
                               'd_utc', (select (fecha_salida at time zone 'UTC')::date::text from despachos where id = v_desp));

  -- E · Pedido directo, sin cotización.
  update pedidos set cotizacion_id = null where id = v_id;
  select cronologia_valida, dias_total, cotizacion into t from v_tiempos_flujo where pedido_id = v_id;
  r := r || jsonb_build_object('e_valida', t.cronologia_valida, 'e_total', t.dias_total, 'e_cot', t.cotizacion);

  -- F · Imposible: el pedido fechado 10 días DESPUÉS de su despacho.
  update pedidos set fecha_solicitada = (select f_despacho from v_tiempos_flujo where pedido_id = v_id) + 10, cotizacion_id = v_cot where id = v_id;
  select cronologia_valida, motivo_cronologia into t from v_tiempos_flujo where pedido_id = v_id;
  r := r || jsonb_build_object('f_valida', t.cronologia_valida, 'f_motivo', t.motivo_cronologia);

  raise exception 'RESULTADO%RESULTADO', r::text;
end $prueba$;`);
    } catch (e) { mensaje = String(e.message); }
    const m = mensaje.match(/RESULTADO(.*?)RESULTADO/);
    ok(!!m, 'los casos corrieron hasta el final (y se deshicieron)', m ? '' : mensaje.slice(0, 300));
    if (m) {
      const r = JSON.parse(m[1].replace(/\\"/g, '"'));
      ok(r.a_valida === true && Number(r.a_dias) === -3, 'salir 3 días antes de lo programado es válido (−3 d)', JSON.stringify([r.a_valida, r.a_dias]));
      ok(r.b_valida === true && Number(r.b_dias) === -1, 'facturar el día antes de despachar es válido (−1 d)', JSON.stringify([r.b_valida, r.b_dias]));
      ok(r.c_valida === true && Number(r.c_total) === 0 && Number(r.c_punt) === 0, 'todo el mismo día es válido (0 d)');
      ok(r.d_valida === true && r.d_mismo_dia === true, 'una salida a las 21:30 de Lima cuenta en el día de Lima, no en el de UTC', `UTC ${r.d_utc}`);
      ok(r.e_valida === true && r.e_cot === null && r.e_total !== null, 'un pedido directo (sin cotización) es válido y mide desde el pedido');
      ok(r.f_valida === false && /despachado antes del pedido/.test(r.f_motivo ?? ''), 'despachado antes del pedido SÍ es imposible, con su motivo', r.f_motivo);
    }
    const [rastro] = await consultar(`select count(*)::int n from auditoria where ocurrido_en > '${inicio}' and tabla in ('pedidos','embarques','facturas','despachos','cotizaciones','cobranzas') and registro_id::text in ('${base.id}')`);
    ok(rastro.n === 0, 'la transacción no dejó rastro en la auditoría');

    /* 1b · En la pantalla: un caso imposible y uno de salida adelantada. */
    const [roto] = await consultar(`
      select pedido_id id, numero_proforma, f_pedido fecha, f_despacho from v_tiempos_flujo
       where cronologia_valida and f_despacho is not null order by pedido_id desc limit 1`);
    pedidoRoto = { id: roto.id, fecha: roto.fecha };
    tocados.push(`(tabla = 'pedidos' and registro_id::text = '${roto.id}')`);
    await consultar(`update pedidos set fecha_solicitada = '${roto.f_despacho}'::date + 400 where id = ${roto.id}`);

    const [adel] = await consultar(`
      select t.pedido_id id, t.numero_proforma, t.f_despacho, e.id emb, e.fecha_programada
        from v_tiempos_flujo t
        join embarque_pedidos ep on ep.pedido_id = t.pedido_id
        join embarques e on e.id = ep.embarque_id and e.estado <> 'cancelado'
       where t.cronologia_valida and t.f_despacho is not null and t.pedido_id <> ${roto.id}
         and (select count(*) from embarque_pedidos x where x.embarque_id = e.id) = 1
         and (select count(*) from embarque_pedidos x join embarques y on y.id = x.embarque_id
               where x.pedido_id = t.pedido_id and y.estado <> 'cancelado') = 1
       order by t.pedido_id limit 1`);
    embarqueAdelantado = { id: adel.emb, fecha: adel.fecha_programada };
    tocados.push(`(tabla = 'embarques' and registro_id::text = '${adel.emb}')`);
    await consultar(`update embarques set fecha_programada = '${adel.f_despacho}'::date + 3 where id = ${adel.emb}`);
    const [va] = await consultar(`select cronologia_valida v, dias_puntualidad d from v_tiempos_flujo where pedido_id = ${adel.id}`);
    ok(va.v === true && Number(va.d) === -3, 'en la base, el pedido que salió antes sigue siendo válido', `${adel.numero_proforma} ${va.d} d`);

    const [cuenta] = await consultar(`select count(*) filter (where not cronologia_valida)::int rotos, count(*) filter (where cronologia_valida)::int sanos from v_tiempos_flujo`);
    await ir('/ventas/tiempos');
    const aviso = p.locator('[data-aviso="cronologia"]');
    ok(await aviso.count() === 1, 'la pantalla avisa de los pedidos con fechas imposibles');
    const textoAviso = await aviso.innerText().catch(() => '');
    ok(/despachado antes del pedido \(1\)/.test(textoAviso), 'y dice cuántos y por qué', textoAviso.slice(0, 140));
    const analizados = await kpi('Pedidos analizados');
    ok(numero(analizados.valor) === cuenta.sanos && new RegExp(`${cuenta.rotos} quedaron fuera`).test(analizados.texto),
       'la tarjeta «Pedidos analizados» cuenta los sanos y dice cuántos quedaron fuera', `${analizados.valor} · ${cuenta.rotos} fuera`);
    await p.screenshot({ path: 'C:/Users/LUIGI/AppData/Local/Temp/claude/c--Users-LUIGI-Desktop-Santa-Monica/6d9be1b6-0c3f-43ef-ad6d-953e12e7c48a/scratchpad/analisis-tiempos.png' });

    await ir(`/ventas/tiempos?buscar=${encodeURIComponent(roto.numero_proforma)}`);
    const filaRota = p.locator('tr.fila-incoherente').first();
    ok(await filaRota.count() === 1 && /despachado antes del pedido/.test(await filaRota.innerText()),
       'la fila del pedido imposible lleva la etiqueta y el motivo');

    await ir(`/ventas/tiempos?buscar=${encodeURIComponent(adel.numero_proforma)}`);
    const filaAdel = p.locator('#pedidos-lista tbody tr').first();
    const txtAdel = await filaAdel.innerText().catch(() => '');
    ok(!/Fechas imposibles/.test(txtAdel) && /-3 d|−3 d/.test(txtAdel),
       'la fila del pedido que salió antes NO se marca como imposible y muestra −3 d', txtAdel.replace(/\s+/g, ' ').slice(0, 120));
  }

  /* ======================================================================= */
  console.log(SEC(2, 'Necesidades de producción · la nota al pie'));
  {
    const [c] = await consultar(`
      select count(*) filter (where abs(pendiente_kg - con_stock_kg - producir_kg) > 0.01)::int descuadre,
             count(*) filter (where abs(pendiente_kg - (pedido_kg - despachado_kg)) > 0.01 and pedido_kg > despachado_kg)::int pendiente_mal,
             count(*) filter (where reservado_kg > 0)::int con_reserva
        from v_produccion_necesidad_linea`);
    ok(c.descuadre === 0, 'Por producir = Falta entregar − Cubre el stock, línea por línea');
    ok(c.pendiente_mal === 0, 'Falta entregar = pedido − despachado (incluye lo reservado)', `${c.con_reserva} líneas con reserva`);
    await ir('/produccion');
    const pie = await p.locator('#productos .pie-explicativo').innerText();
    ok(/incluye lo que está reservado/.test(pie) && !/ni está reservado/.test(pie), 'la nota ya no dice que «Falta entregar» excluye lo reservado');
    ok(/lo reservado para esa línea más la parte del stock libre/.test(pie), '«Cubre el stock» = reservado + stock libre asignado');
    ok(/Solo entran los pedidos confirmados/.test(pie), 'dice que solo cuentan los pedidos confirmados con algo por producir');
  }

  /* ======================================================================= */
  console.log(SEC(3, 'Rentabilidad · el mes «Todos» y las líneas sin costo'));
  {
    await ir('/finanzas/rentabilidad');
    const opciones = await p.locator('select.campo').first().locator('option').allInnerTexts();
    ok(/^El más reciente \(/.test(opciones[0]) && opciones[1] === 'Todos los meses',
       'el desplegable dice «El más reciente (…)» y «Todos los meses»', opciones.slice(0, 3).join(' | '));
    ok(!opciones.includes('Todos'), 'ya no hay una opción «Todos» que en realidad era el último mes');

    const [tot] = await consultar(`select round(sum(venta)) venta, sum(pedidos) suma_pedidos,
                                          (select count(distinct pedido_id) from v_margen_bruto_linea) pedidos
                                     from v_margen_bruto_mensual`);
    await p.locator('select.campo').first().selectOption('todos');
    await p.waitForURL(/mes=todos/, { timeout: 15000 });
    await p.waitForTimeout(1500);
    ok(Math.abs(numero((await kpi('Venta')).valor) - Number(tot.venta)) <= 1, '«Todos los meses» suma de verdad todos los meses', `US$ ${tot.venta}`);
    ok(numero((await kpi('Pedidos')).valor) === Number(tot.pedidos), 'y cuenta cada pedido una vez', `${tot.pedidos}`);

    /* Un pallet del último mes, sin costo. */
    const [ult] = await consultar(`select clave, mes from v_margen_bruto_mensual order by mes desc limit 1`);
    const [lote] = await consultar(`select l.id, l.costo_unitario from v_margen_bruto_linea v join lotes l on l.id = v.lote_id
                                     where v.mes = '${ult.mes}' order by v.venta desc limit 1`);
    loteSinCosto = { id: lote.id, costo: lote.costo_unitario };
    tocados.push(`(tabla = 'lotes' and registro_id::text = '${lote.id}')`);
    await consultar(`update lotes set costo_unitario = 0 where id = ${lote.id}`);
    const [mb] = await consultar(`select venta, margen, margen_pct, venta_con_costo, venta_sin_costo, kg_sin_costo, lineas_sin_costo,
                                         (select sum(venta - costo) from v_margen_bruto_linea where mes = '${ult.mes}') as margen_inflado
                                    from v_margen_bruto_mensual where mes = '${ult.mes}'`);
    ok(Number(mb.lineas_sin_costo) >= 1 && Number(mb.venta_sin_costo) > 0, 'la vista separa la venta sin costo', `${mb.lineas_sin_costo} líneas · US$ ${Math.round(mb.venta_sin_costo)}`);
    ok(Math.abs(Number(mb.margen) - (Number(mb.margen_inflado) - Number(mb.venta_sin_costo))) < 0.05,
       'el margen ya no suma la venta sin costo como si fuera margen');
    ok(Math.abs(Number(mb.margen_pct) - Math.round(Number(mb.margen) / Number(mb.venta_con_costo) * 10000) / 100) < 0.011,
       'el % se mide sobre la venta con costo', `${mb.margen_pct} %`);

    await ir(`/finanzas/rentabilidad?eje=bruto&mes=${ult.clave}`);
    const avisoB = p.locator('[data-aviso="sin-costo"]');
    ok(await avisoB.count() === 1, 'Margen bruto avisa de las líneas sin costo');
    const tAviso = await avisoB.innerText().catch(() => '');
    ok(new RegExp(`${Math.round(Number(mb.venta_sin_costo)).toLocaleString('en-US')}`).test(tAviso) && /TM/.test(tAviso),
       'el aviso dice las TM y el importe sin costo', tAviso.slice(0, 120));
    ok(Math.abs(numero((await kpi('Margen bruto')).valor) - Math.round(Number(mb.margen))) <= 1, 'la tarjeta Margen bruto excluye la venta sin costo');
    ok(Math.abs(numero((await kpi('Margen bruto %')).valor) - Number(mb.margen_pct)) < 0.06, 'y la de Margen bruto % también', (await kpi('Margen bruto %')).valor);
    await p.screenshot({ path: 'C:/Users/LUIGI/AppData/Local/Temp/claude/c--Users-LUIGI-Desktop-Santa-Monica/6d9be1b6-0c3f-43ef-ad6d-953e12e7c48a/scratchpad/analisis-rentabilidad.png', fullPage: false });
    await consultar(`update lotes set costo_unitario = ${lote.costo_unitario} where id = ${lote.id}`);
    loteSinCosto = null;

    /* Una línea de pedido despachado sin costo estimado. */
    const [lin] = await consultar(`select pl.id, pl.costo_estimado_tm, pl.cantidad_tm, p.id pedido_id from pedido_lineas pl join pedidos p on p.id = pl.pedido_id
                                    where p.ciclo in ('despachado','cerrado') and pl.costo_estimado_tm > 0 order by pl.id limit 1`);
    lineaSinCosto = { id: lin.id, costo: lin.costo_estimado_tm };
    tocados.push(`(tabla = 'pedido_lineas' and registro_id::text = '${lin.id}')`);
    await consultar(`update pedido_lineas set costo_estimado_tm = 0 where id = ${lin.id}`);
    const [rp] = await consultar(`select round(sum(venta_sin_costo)) vsc, sum(tm_sin_costo) tsc, round(sum(venta)::numeric, 2) venta,
                                         round(sum(margen_con_costo)::numeric, 2) margen
                                    from v_rentabilidad_pedido where ciclo in ('despachado','cerrado')`);
    await ir('/finanzas/rentabilidad?eje=pedido');
    ok(Math.abs(numero((await kpi('Venta sin costo')).valor) - Number(rp.vsc)) <= 1, 'Por pedido: la tarjeta «Venta sin costo» la cuenta aparte', `US$ ${rp.vsc}`);
    ok(await p.locator('[data-aviso="sin-costo"]').count() === 1, 'y un aviso dice que queda fuera del margen');
    const filasPed = await p.locator('table[data-cuadro="pedidos"] tbody tr').count();
    const pag = await p.locator('.paginacion').first().innerText().catch(() => '');
    ok(filasPed === 50 && /de 172|de \d{3}/.test(pag), 'la lista de pedidos se pagina de 50 en 50 (antes cortaba en 200)', pag.replace(/\s+/g, ' ').slice(0, 60));

    /* El Excel de Rentabilidad por pedido (Reportes). */
    const resp = await p.request.get(`${BASE}/api/reportes/rentabilidad`);
    ok(resp.ok(), 'el Excel de Rentabilidad por pedido se descarga');
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(Buffer.from(await resp.body()));
    const hoja = libro.worksheets[0];
    const cab = hoja.getRow(6).values.map((v) => String(v ?? ''));
    const col = (t) => cab.findIndex((c) => c === t);
    ok(col('Margen (con costo)') > 0 && col('TM sin costo') > 0 && col('Venta sin costo') > 0,
       'el Excel trae el margen con costo y las columnas sin costo', cab.filter(Boolean).join(' · '));
    let ventaX = 0, margenX = 0, tscX = 0;
    for (let r = 7; r <= hoja.rowCount; r++) {
      const fila = hoja.getRow(r);
      if (String(fila.getCell(1).value) === 'TOTAL' || !fila.getCell(1).value) continue;
      ventaX += Number(fila.getCell(col('Venta')).value) || 0;
      margenX += Number(fila.getCell(col('Margen (con costo)')).value) || 0;
      tscX += Number(fila.getCell(col('TM sin costo')).value) || 0;
    }
    ok(Math.abs(ventaX - Number(rp.venta)) < 2, 'el Excel exporta los mismos pedidos que la pantalla (despachados y cerrados)', `US$ ${Math.round(ventaX)}`);
    ok(Math.abs(margenX - Number(rp.margen)) < 2 && Math.abs(tscX - Number(rp.tsc)) < 0.001,
       'y su margen excluye la línea sin costo, que sale en «TM sin costo»', `${tscX} TM`);
    await consultar(`update pedido_lineas set costo_estimado_tm = ${lin.costo_estimado_tm} where id = ${lin.id}`);
    lineaSinCosto = null;
  }

  /* ======================================================================= */
  console.log(SEC(4, 'Cierre semanal · coma o punto decimal'));
  {
    const casos = [
      ['12,5', 12.5], ['12.5', 12.5], ['1.234,5', 1234.5], ['1,234.5', 1234.5], ['1234', 1234],
      ['0,25', 0.25], ['1 234,5', 1234.5], ['1.234.567', 1234567], ['1234,567', 1234.567], ['0,500', 0.5],
      ['', null], ['abc', 'invalido'], ['1.23,5', 'invalido'], ['1,2,3', 'invalido'],
      ['1,234', 'ambiguo'], ['535.641', 'ambiguo'],
    ];
    for (const [texto, esperado] of casos) {
      const l = leerNumero(texto);
      const obtenido = l.tipo === 'numero' ? l.valor : l.tipo === 'vacio' ? null : l.tipo;
      ok(obtenido === esperado, `leerNumero(«${texto}») → ${esperado}`, String(obtenido));
    }
    const amb = leerNumero('535,641');
    ok(amb.tipo === 'ambiguo' && amb.comoDecimal === 535.641 && amb.comoMiles === 535641, '«535,641» da las dos lecturas: 535,641 y 535 641');

    const { anio, mes } = MES_CIERRE;
    const periodo = `${anio}-${String(mes).padStart(2, '0')}`;
    const valor = async () => {
      const [v] = await consultar(`select valor from cierre_valores where categoria_id = 1 and anio = ${anio} and mes = ${mes} and campo = 'plan_mp'`);
      return v ? Number(v.valor) : null;
    };
    await ir(`/produccion/cierre?mes=${periodo}`);
    const celda = p.locator('tr[data-categoria="pota"] input[data-campo="plan_mp"]');
    const escribir = async (t) => {
      await celda.fill(t);
      await celda.press('Enter');
      await p.waitForTimeout(2500);
    };
    for (const [t, n] of [['12,5', 12.5], ['1.234,5', 1234.5], ['1,234.5', 1234.5], ['1234', 1234]]) {
      await escribir(t);
      ok(await valor() === n, `escribir «${t}» guarda ${n}`, String(await valor()));
    }
    await escribir('535,641');
    const duda = p.locator('tr[data-categoria="pota"] .celda-cierre-duda');
    ok(await duda.count() === 1, '«535,641» no se guarda a ciegas: la casilla pregunta');
    ok(await valor() === 1234, 'mientras tanto, el dato guardado no cambia');
    const botones = await duda.locator('button').allInnerTexts();
    ok(/535 TM y 641 kg/.test(botones[0] ?? '') && /535\s?641 TM/.test((botones[1] ?? '').replace(/\u202f/g, ' ')),
       'ofrece «535 TM y 641 kg» o «535 641 TM»', botones.join(' | '));
    await p.screenshot({ path: 'C:/Users/LUIGI/AppData/Local/Temp/claude/c--Users-LUIGI-Desktop-Santa-Monica/6d9be1b6-0c3f-43ef-ad6d-953e12e7c48a/scratchpad/analisis-cierre.png' });
    await duda.locator('button[data-lectura="decimal"]').click();
    await p.waitForTimeout(2500);
    ok(await valor() === 535.641, 'al elegir la lectura decimal se guarda 535,641');
    await escribir('1.234');
    await p.locator('tr[data-categoria="pota"] .celda-cierre-duda button[data-lectura="miles"]').click();
    await p.waitForTimeout(2500);
    ok(await valor() === 1234, '«1.234» con la lectura de miles se guarda 1234');
    await escribir('abc');
    const err = await p.locator('tr[data-categoria="pota"] .celda-cierre-error').innerText().catch(() => '');
    ok(/No es un número/.test(err), 'un texto que no es número se rechaza con un mensaje claro', err);
  }

  /* ======================================================================= */
  console.log(SEC(5, 'Control de pedidos · paginado y totales de todo'));
  {
    const [c] = await consultar(`select count(*)::int n, sum(tm_pedidas) tm, sum(tm_backorder) bo
                                   from v_control_pedidos where situacion_control = 'por_atender'`);
    const [b] = await consultar(`select count(*)::int n, sum(backorder_kg) / 1000 tm from v_pedido_linea_cobertura where backorder_kg > 0.5`);
    await ir('/ventas/control');
    const filas1 = await p.locator('table[data-cuadro="pedidos"] tbody tr').count();
    ok(filas1 === Math.min(50, c.n), 'la primera página muestra 50 pedidos', `${filas1} de ${c.n}`);
    ok(new RegExp(`de ${c.n.toLocaleString('es-PE')} registros`).test(await p.locator('.paginacion').innerText()), 'la paginación dice el total');
    const pie = await p.locator('tr[data-total="pedidos"]').innerText();
    ok(new RegExp(`${c.n} pedidos`).test(pie) && pie.includes(`${Number(c.tm).toLocaleString('es-PE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} TM`),
       'la fila Total suma TODOS los pedidos, no solo los visibles', pie.replace(/\s+/g, ' '));
    let vistos = filas1;
    for (let pag = 2; pag <= Math.ceil(c.n / 50); pag++) {
      await ir(`/ventas/control?vista=por_atender&pagina=${pag}`);
      vistos += await p.locator('table[data-cuadro="pedidos"] tbody tr').count();
    }
    ok(vistos === c.n, 'recorriendo las páginas se ven todos los pedidos de la tarjeta', `${vistos}`);

    await ir('/ventas/control?vista=backorder');
    const filasB = await p.locator('table[data-cuadro="backorder"] tbody tr').count();
    ok(filasB === Math.min(50, b.n), 'Backorder: 50 líneas por página', `${filasB} de ${b.n}`);
    const pieB = await p.locator('tr[data-total="backorder"]').innerText();
    ok(pieB.includes(`${Number(b.tm).toLocaleString('es-PE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} TM`) && new RegExp(`${b.n} líneas`).test(pieB),
       'y su total es el de todas las líneas', pieB.replace(/\s+/g, ' '));
    await ir(`/ventas/control?vista=backorder&pagina=${Math.ceil(b.n / 50)}`);
    const ultimas = await p.locator('table[data-cuadro="backorder"] tbody tr').count();
    ok(ultimas === b.n - 50 * (Math.ceil(b.n / 50) - 1), 'la última página trae el resto (antes no se veían más allá de 200)', `${ultimas}`);
    await p.screenshot({ path: 'C:/Users/LUIGI/AppData/Local/Temp/claude/c--Users-LUIGI-Desktop-Santa-Monica/6d9be1b6-0c3f-43ef-ad6d-953e12e7c48a/scratchpad/analisis-control.png' });
  }
} catch (e) {
  console.log(' FALLA', e.message);
  fallos.push(e.message);
} finally {
  /* ---- Todo vuelve a como estaba ---- */
  if (pedidoRoto) await consultar(`update pedidos set fecha_solicitada = '${pedidoRoto.fecha}' where id = ${pedidoRoto.id}`);
  if (embarqueAdelantado) await consultar(`update embarques set fecha_programada = '${embarqueAdelantado.fecha}' where id = ${embarqueAdelantado.id}`);
  if (loteSinCosto) await consultar(`update lotes set costo_unitario = ${loteSinCosto.costo} where id = ${loteSinCosto.id}`);
  if (lineaSinCosto) await consultar(`update pedido_lineas set costo_estimado_tm = ${lineaSinCosto.costo} where id = ${lineaSinCosto.id}`);
  await consultar(`delete from cierre_valores where anio = ${MES_CIERRE.anio} and mes = ${MES_CIERRE.mes}`);
  await consultar(`delete from cierre_historial where anio = ${MES_CIERRE.anio} and mes = ${MES_CIERRE.mes} and registrado_en > '${inicio}'`);
  if (tocados.length) await consultar(`delete from auditoria where ocurrido_en > '${inicio}' and (${tocados.join(' or ')})`);
  await consultar(`delete from eventos where ocurrido_en > '${inicio}' and tipo = 'reporte_exportado'
                     and descripcion like 'Rentabilidad por pedido exportado%'`);
  await nav.close();
}

const [rastro] = await consultar(`select
  (select count(*) from cierre_valores where anio = ${MES_CIERRE.anio})::int cierre,
  (select count(*) filter (where not cronologia_valida) from v_tiempos_flujo)::int rotos`);
ok(rastro.cierre === 0 && rastro.rotos === 0, 'la prueba no deja rastro', JSON.stringify(rastro));

console.log(fallos.length ? `\n${fallos.length} FALLA(S):\n - ${fallos.join('\n - ')}` : '\nTodo en orden.');
process.exit(fallos.length ? 1 : 0);
