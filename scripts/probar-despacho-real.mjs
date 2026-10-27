/**
 * ============================================================================
 *  PRUEBA · EL DESPACHO CON LO QUE SALIÓ DE VERDAD (075)
 * ============================================================================
 *  Pedido de Oliver Tello: al despachar no siempre sale exactamente lo
 *  cargado (muestreos, sacos dañados, un pallet que no entra). Se prueba en
 *  el navegador y en la base, sobre un escenario PROPIO marcado PRUEBA
 *  (pallets «PRB 075 …», pedidos y embarques «PRUEBA-075-…»):
 *
 *    1. Despacho con muestreo, merma y «no entró»: Kardex (venta, muestra y
 *       merma por separado), reservas (consumida, liberada, sigue apartada),
 *       existencias, saldo del pedido, lo programado del embarque, Fill Rate,
 *       ficha del packing, ficha del despacho y reporte de carga en PDF.
 *    2. Validaciones de la pantalla y de la base: no sale más de lo cargado,
 *       motivo obligatorio, «otro» con explicación, rol.
 *    3. Un pallet que Calidad bloqueó DESPUÉS de cargarlo: la ficha lo marca
 *       y el despacho se rechaza (pantalla, servidor y base).
 *    4. Despacho normal sin ajustes: igual que siempre.
 *    5. «Armar el traslado» apagado y explicado para Comercio Exterior.
 *    6. Un corte de red al despachar no rompe la pantalla (accionSegura).
 *
 *  La base es la de producción: todo lo creado se borra al final (finally),
 *  con su Kardex, auditoría y eventos, filtrando por los ids de la prueba.
 *
 *      BASE_URL=http://localhost:3010 node scripts/probar-despacho-real.mjs
 * ============================================================================
 */
import { chromium } from 'playwright';
import { PDFExtract } from 'pdf.js-extract';
import { readFileSync } from 'node:fs';
import { ejecutarSQL } from './db.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const consultar = async (sql) => { const r = await ejecutarSQL(sql); return Array.isArray(r) ? r : []; };
const SEC = (n, t) => `\n${'─'.repeat(3)} ${n} · ${t} ${'─'.repeat(3)}`;
const fallos = [];
const ok = (cond, texto, detalle = '') => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${texto}${detalle ? ' · ' + detalle : ''}`);
  if (!cond) fallos.push(texto);
};
const casi = (a, b, tol = 0.01) => Math.abs(Number(a) - Number(b)) <= tol;
/** Corre un bloque DO que termina con «raise exception 'RESULTADO…RESULTADO'»: se deshace entero. */
async function enTransaccion(cuerpo) {
  try {
    await consultar(`do $prueba$\n${cuerpo}\n$prueba$;`);
    return { error: 'el bloque no devolvió resultado' };
  } catch (e) {
    const m = String(e.message).match(/RESULTADO(.*?)RESULTADO/s);
    if (!m) return { error: String(e.message).slice(0, 400) };
    return JSON.parse(m[1].replace(/\\"/g, '"'));
  }
}
const lista = (a) => (a.length ? a.join(',') : '0');
const comillas = (a) => (a.length ? a.map((x) => `'${x}'`).join(',') : "''");

const marca = String(process.pid).slice(-4).padStart(4, '0');
const [{ inicio }] = await consultar(`select now()::text as inicio`);
const [{ gerente }] = await consultar(`select id gerente from usuarios where rol = 'gerencia' and activo limit 1`);
const [{ comercial }] = await consultar(`select id comercial from usuarios where rol = 'comercial' and activo limit 1`);
const anio = new Date().getFullYear();
const [{ desp0 }] = await consultar(`select coalesce((select ultimo from correlativos where serie = 'DESP' and anio = ${anio}), 0) desp0`);

/* Lo que hay que borrar al final. */
const c = { lotes: [], pedidos: [], lineas: [], reservas: [], embarques: [], packings: [], dictamenes: [] };
const nav = await chromium.launch({ channel: 'chrome', headless: true });

async function sesion(correo) {
  const ctx = await nav.newContext({ viewport: { width: 1500, height: 1000 } });
  const p = await ctx.newPage();
  p.setDefaultTimeout(60000);
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', correo);
  await p.fill('input[type="password"]', process.env.CLAVE_DEMO ?? '');
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/panel/, { timeout: 60000 });
  return p;
}
const ir = (p, ruta) => p.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle', timeout: 120000 });
const capturas = 'C:/Users/LUIGI/AppData/Local/Temp/claude/c--Users-LUIGI-Desktop-Santa-Monica/6d9be1b6-0c3f-43ef-ad6d-953e12e7c48a/scratchpad/c75';

try {
  /* ════════════════════════ PREPARACIÓN ════════════════════════ */
  const [alm1, alm2] = await consultar(`select id, nombre from almacenes where activo order by id limit 2`);
  const [sp] = await consultar(`
    select sp.id, pr.peso_bulto_kg::numeric kgb from sku_presentaciones sp
      join presentaciones pr on pr.id = sp.presentacion_id
     where pr.peso_bulto_kg between 10 and 40 order by sp.id limit 1`);
  const kgb = Number(sp.kgb);
  const [cli] = await consultar(`select id from clientes order by id limit 1`);
  const [dst] = await consultar(`select id from destinos where activo order by id limit 1`);

  /** Un pallet propio con 50 bultos en la bodega indicada. */
  async function pallet(letra, almacen) {
    const [l] = await consultar(`
      insert into lotes (codigo_pallet, campania, sku_presentacion_id, fecha_produccion, bultos_iniciales, peso_neto_inicial_kg, creado_por, observaciones)
      values ('PRB 075 ${marca} ${letra}', ${anio}, ${sp.id}, current_date - 20, 50, ${50 * kgb}, '${gerente}', 'PRUEBA-075')
      returning id, codigo_pallet`);
    c.lotes.push(l.id);
    await consultar(`
      insert into movimientos (tipo, lote_id, almacen_id, bultos, peso_neto_kg, costo_unitario, documento_tipo, documento_ref, usuario_id, origen_ingreso, observaciones)
      values ('ingreso', ${l.id}, ${almacen}, 50, ${50 * kgb}, 1, 'ingreso', 'PRUEBA-075', '${gerente}', 'produccion', 'PRUEBA-075')`);
    return l;
  }
  async function pedido(sufijo, bultos, fecha = 'current_date + 30') {
    const [p] = await consultar(`
      insert into pedidos (numero_proforma, cliente_id, tipo_cambio, ciclo, creado_por, tipo_despacho, destino_id, fecha_comprometida, observaciones)
      values ('PRUEBA-075-${marca}-${sufijo}', ${cli.id}, 3.75, 'confirmado', '${gerente}', 'exportacion', ${dst.id}, ${fecha}, 'PRUEBA-075')
      returning id, numero_proforma`);
    c.pedidos.push(p.id);
    const [ln] = await consultar(`
      insert into pedido_lineas (pedido_id, sku_presentacion_id, cantidad_tm, precio_tm)
      values (${p.id}, ${sp.id}, ${bultos * kgb / 1000}, 1500) returning id`);
    c.lineas.push(ln.id);
    return { ...p, linea: ln.id };
  }
  async function reservar(ped, lote, almacen, bultos = 50) {
    const [r] = await consultar(`
      insert into reservas (pedido_linea_id, lote_id, almacen_id, bultos, peso_neto_kg, estado, creado_por, observaciones)
      values (${ped.linea}, ${lote.id}, ${almacen}, ${bultos}, ${bultos * kgb}, 'activa', '${gerente}', 'PRUEBA-075') returning id`);
    c.reservas.push(r.id);
  }
  async function embarque(sufijo, ped, bultos, lotes) {
    const [e] = await consultar(`
      insert into embarques (numero, fecha_programada, almacen_id, destino_id, tipo_despacho, estado, booking, naviera, creado_por, observaciones)
      values ('PRUEBA-075-${marca}-${sufijo}', (now() at time zone 'America/Lima')::date + 1, ${alm1.id}, ${dst.id}, 'exportacion', 'confirmado',
              'PRB075BK', 'Naviera PRUEBA', '${gerente}', 'PRUEBA-075') returning id, numero`);
    c.embarques.push(e.id);
    await consultar(`insert into embarque_pedidos (embarque_id, pedido_id) values (${e.id}, ${ped.id})`);
    await consultar(`insert into embarque_lineas (embarque_id, pedido_linea_id, sku_presentacion_id, cantidad_kg, creado_por)
                     values (${e.id}, ${ped.linea}, ${sp.id}, ${bultos * kgb}, '${gerente}')`);
    const [pk] = await consultar(`
      insert into packing_lists (codigo, embarque_id, contenedor, precinto, guia_remision, dam, estado, creado_por, observaciones)
      values ('PRB-075-${marca}-${sufijo}', ${e.id}, 'PRBU075${marca}${sufijo}', 'PRC${marca}', 'GR-PRB-${marca}', 'DAM-PRB-${marca}', 'abierto', '${gerente}', 'PRUEBA-075')
      returning id, codigo, contenedor`);
    c.packings.push(pk.id);
    for (const l of lotes) {
      await consultar(`insert into packing_lineas (packing_list_id, lote_id, pedido_linea_id, bultos, peso_neto_kg)
                       values (${pk.id}, ${l.id}, ${ped.linea}, 50, ${50 * kgb})`);
    }
    await consultar(`select generar_plano_estiba(${pk.id})`);
    return { ...e, pk };
  }

  const [A, B, C, D] = [await pallet('A', alm1.id), await pallet('B', alm1.id), await pallet('C', alm1.id), await pallet('D', alm1.id)];
  const [E, F] = [await pallet('E', alm1.id), await pallet('F', alm1.id)];
  const [G, H] = [await pallet('G', alm1.id), await pallet('H', alm2.id)];
  const p1 = await pedido('1', 200);
  const p2 = await pedido('2', 100);
  const p3 = await pedido('3', 100, '(now() at time zone \'America/Lima\')::date - 900');
  for (const l of [A, B, C, D]) await reservar(p1, l, alm1.id);
  for (const l of [E, F]) await reservar(p2, l, alm1.id);
  await reservar(p3, G, alm1.id);
  await reservar(p3, H, alm2.id);
  const e1 = await embarque('1', p1, 200, [A, B, C, D]);
  const e2 = await embarque('2', p2, 100, [E, F]);
  ok(c.lotes.length === 8 && c.packings.length === 2, 'escenario de prueba creado', `${kgb} kg por bulto · bodegas ${alm1.nombre} y ${alm2.nombre}`);

  const g = await sesion('gerencia@santamonica.pe');
  const fallosJs = [];
  g.on('pageerror', (e) => fallosJs.push(e.message));

  /* ════════════════════════ 1 · VALIDACIONES DE LA BASE ════════════════════════ */
  console.log(SEC(1, 'La base valida lo que salió (en transacciones que se deshacen)'));
  {
    const intento = async (uid, ajustes) => enTransaccion(`
      declare v_res jsonb := '{}';
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', '${uid}', 'role', 'authenticated')::text, true);
        begin
          perform ejecutar_despacho(${e1.pk.id}, 'PRUEBA-075-X', '${JSON.stringify(ajustes)}'::jsonb);
          v_res := '{"despacho":true}';
        exception when others then v_res := jsonb_build_object('error', sqlerrm); end;
        raise exception 'RESULTADO%RESULTADO', v_res::text;
      end;`);
    const mas = await intento(gerente, [{ lote_id: B.id, bultos: 51, kg: 51 * kgb }]);
    ok(/no se despacha más de lo cargado/.test(mas.error ?? ''), 'no sale más de lo cargado', mas.error);
    const masKg = await intento(gerente, [{ lote_id: B.id, bultos: 50, kg: 50 * kgb + 5 }]);
    ok(/no se despacha más de lo cargado/.test(masKg.error ?? ''), 'ni más kilos de los cargados', masKg.error);
    const sinMotivo = await intento(gerente, [{ lote_id: B.id, bultos: 48, kg: 48 * kgb }]);
    ok(/diga el motivo/.test(sinMotivo.error ?? '') && sinMotivo.error.includes(B.codigo_pallet), 'con diferencia, el motivo es obligatorio y dice qué pallet', sinMotivo.error);
    const otro = await intento(gerente, [{ lote_id: B.id, bultos: 48, kg: 48 * kgb, motivo: 'otro', detalle: '' }]);
    ok(/escriba qué pasó/.test(otro.error ?? ''), '«otro» exige escribir qué pasó', otro.error);
    const kilosSolos = await intento(gerente, [{ lote_id: D.id, bultos: 50, kg: 50 * kgb - 3, motivo: 'no_entro' }]);
    ok(/sacos enteros/.test(kilosSolos.error ?? ''), 'lo que vuelve a cámara son sacos enteros', kilosSolos.error);
    const rol = await intento(comercial, []);
    ok(/Despachan Gerencia, Operaciones, Almacén o Comercio Exterior/.test(rol.error ?? ''), 'Comercial no despacha (la base comprueba el rol)', rol.error);
    const [nada] = await consultar(`select count(*)::int n from despachos where packing_list_id = ${e1.pk.id}`);
    ok(nada.n === 0, 'ningún intento dejó medio despacho');
  }

  /* ════════════════════════ 2 · «ARMAR EL TRASLADO» PARA COMEX ════════════════════════ */
  console.log(SEC(2, '«Armar el traslado» apagado y explicado para Comercio Exterior'));
  {
    const cx = await sesion('comex@santamonica.pe');
    await ir(cx, '/logistica/embarques/nuevo');
    const casilla = cx.locator(`input[aria-label*="${p3.numero_proforma}"], tr:has-text("${p3.numero_proforma}") input[type="checkbox"]`).first();
    await casilla.waitFor({ timeout: 60000 });
    await casilla.check();
    const boton = cx.locator('[data-accion="consolidar-nuevo"]');
    await boton.waitFor({ timeout: 60000 });
    ok(await boton.isDisabled(), 'en «Programar embarque», Comex ve «Armar el traslado» apagado');
    const motivo = await cx.locator('[data-motivo="consolidar"]').first().innerText().catch(() => '');
    ok(/Comercio Exterior no puede armar traslados de consolidación: lo hacen Gerencia, Operaciones o Almacén/.test(motivo), 'y dice por qué y quién sí puede', motivo);
    await cx.screenshot({ path: `${capturas}/comex-consolidar-nuevo.png`, fullPage: false });

    await ir(cx, `/logistica/embarques/${e1.id}`);
    await cx.click('[data-accion="agregar-pedidos"]');
    const c3 = cx.locator(`input[aria-label="Agregar ${p3.numero_proforma}"]`);
    await c3.waitFor({ timeout: 90000 });
    await c3.check();
    const b2 = cx.locator('[data-accion="consolidar-agregar"]');
    await b2.waitFor({ timeout: 60000 });
    ok(await b2.isDisabled(), 'en la ficha del embarque («Agregar pedidos») también está apagado');
    ok(/Pídales que lo armen/.test(await cx.locator('[data-bloque="agregar-pedidos"] [data-motivo="consolidar"]').innerText().catch(() => '')), 'con su explicación');
    await cx.context().close();
    const g2 = await sesion('almacen@santamonica.pe');
    await ir(g2, `/logistica/embarques/${e1.id}`);
    await g2.click('[data-accion="agregar-pedidos"]');
    const c4 = g2.locator(`input[aria-label="Agregar ${p3.numero_proforma}"]`);
    await c4.waitFor({ timeout: 90000 });
    await c4.check();
    const b3 = g2.locator('[data-accion="consolidar-agregar"]');
    await b3.waitFor({ timeout: 60000 });
    ok(await b3.isEnabled(), 'Almacén sí lo ve encendido (no se pulsa: crearía un traslado)');
    await g2.context().close();
  }

  /* ════════════════════════ 3 · DESPACHO CON MUESTREO, MERMA Y «NO ENTRÓ» ════════════════════════ */
  console.log(SEC(3, 'Despacho con muestreo, merma y «no entró» (en el navegador)'));
  let d1 = null;
  {
    await ir(g, `/logistica/packing/${e1.pk.id}`);
    await g.click('[data-accion="despachar"]');
    await g.locator('[data-bloque="resumen-salida"]').waitFor({ timeout: 60000 });
    ok(/Sale todo lo cargado/.test(await g.locator('[data-bloque="resumen-salida"]').innerText()), 'por defecto sale todo lo cargado');
    ok(await g.locator('[data-accion="confirmar-despacho"]').count() === 1, 'y se puede confirmar sin ningún clic de más');
    await g.click('[data-accion="ajustar-salida"]');
    await g.locator('[data-bloque="ajustes-despacho"]').waitFor();
    ok(await g.locator('[data-bloque="ajustes-despacho"] tbody tr').count() === 4, '«Ajustar lo que salió» abre los 4 pallets');

    // B: muestreo de 2 sacos. Los kilos se calculan solos.
    await g.fill(`input[name="salio-bultos-${B.id}"]`, '48');
    ok(casi(await g.inputValue(`input[name="salio-kg-${B.id}"]`), 48 * kgb), 'los kilos siguen a los bultos en proporción', await g.inputValue(`input[name="salio-kg-${B.id}"]`));
    ok(await g.locator('[data-accion="confirmar-despacho"]').count() === 0, 'con diferencia y sin motivo no deja confirmar');
    ok(/Elija el motivo/.test(await g.locator(`[data-bloque="ajustes-despacho"] tr[data-lote="${B.id}"]`).innerText()), 'y lo dice en la fila');
    await g.selectOption(`select[name="motivo-${B.id}"]`, 'muestreo');
    await g.fill(`input[name="detalle-${B.id}"]`, 'SGS sacó 2 sacos');
    // C: un saco dañado.
    await g.fill(`input[name="salio-bultos-${C.id}"]`, '49');
    await g.selectOption(`select[name="motivo-${C.id}"]`, 'merma');
    // D: más de lo cargado → la pantalla lo marca; después, 10 sacos que no entraron.
    await g.fill(`input[name="salio-bultos-${D.id}"]`, '51');
    ok(/No sale más de lo cargado/.test(await g.locator(`[data-bloque="ajustes-despacho"] tr[data-lote="${D.id}"]`).innerText()), 'más de lo cargado se marca en la fila');
    await g.fill(`input[name="salio-bultos-${D.id}"]`, '40');
    await g.selectOption(`select[name="motivo-${D.id}"]`, 'no_entro');
    ok(/Vuelve a cámara/.test(await g.locator(`[data-bloque="ajustes-despacho"] tr[data-lote="${D.id}"]`).innerText()), 'el motivo dice qué pasa con la diferencia');
    ok(/Salen 187 de 200 bultos/.test(await g.locator('[data-bloque="resumen-salida"]').innerText()), 'el resumen dice cuánto sale de verdad', await g.locator('[data-bloque="resumen-salida"]').innerText());
    await g.locator('.despachar').screenshot({ path: `${capturas}/despachar-ajustes.png` });
    await g.fill(`#conf-${e1.pk.id}`, e1.pk.contenedor);
    await g.click('[data-accion="confirmar-despacho"]');
    await g.locator('[data-resultado-despacho]').waitFor({ timeout: 120000 });
    const msg = await g.locator('[data-resultado-despacho]').innerText();
    ok(/Despacho DESP-.* ejecutado/.test(msg) && /No salieron 13 bultos/.test(msg), 'el despacho se ejecuta y dice lo que no salió', msg.slice(0, 160));
    [d1] = await consultar(`select id, numero from despachos where packing_list_id = ${e1.pk.id}`);
    ok(!!d1, 'queda registrado el despacho', d1?.numero);

    /* ---- La base ---- */
    const movs = await consultar(`select lote_id, tipo::text t, bultos b, peso_neto_kg::numeric kg, m.codigo motivo
                                    from movimientos mv left join motivos m on m.id = mv.motivo_id
                                   where documento_tipo = 'despacho' and documento_id = ${d1.id} order by mv.id`);
    const mov = (l, t) => movs.find((x) => Number(x.lote_id) === l.id && x.t === t);
    ok(mov(A, 'salida_despacho')?.b === 50, 'Kardex: A sale entero como venta');
    ok(mov(B, 'salida_despacho')?.b === 48 && mov(B, 'salida_muestra')?.b === 2 && mov(B, 'salida_muestra')?.motivo === 'M_DESPACHO',
       'Kardex: B, 48 de venta y 2 como muestra (motivo «Muestreo al despachar»)');
    ok(mov(C, 'salida_despacho')?.b === 49 && mov(C, 'salida_merma')?.b === 1 && mov(C, 'salida_merma')?.motivo === 'MERMA_DESPACHO',
       'Kardex: C, 49 de venta y 1 como merma («Sacos dañados al despachar»)');
    ok(mov(D, 'salida_despacho')?.b === 40 && !movs.some((x) => Number(x.lote_id) === D.id && x.t !== 'salida_despacho'),
       'Kardex: D, 40 de venta y nada más (lo que no entró no sale)');
    const ex = await consultar(`select lote_id, bultos b, peso_neto_kg::numeric kg from existencias where lote_id in (${lista([A.id, B.id, C.id, D.id])})`);
    const exDe = (l) => ex.find((x) => Number(x.lote_id) === l.id);
    ok(exDe(A)?.b === 0 && exDe(B)?.b === 0 && exDe(C)?.b === 0, 'A, B y C quedan sin stock');
    ok(exDe(D)?.b === 10 && casi(exDe(D)?.kg, 10 * kgb), 'D vuelve a cámara con 10 bultos', `${exDe(D)?.b} b · ${exDe(D)?.kg} kg`);
    const rs = await consultar(`select lote_id, estado::text e, bultos b, peso_neto_kg::numeric kg from reservas where pedido_linea_id = ${p1.linea} order by id`);
    const sum = (l, e) => rs.filter((x) => Number(x.lote_id) === l.id && x.e === e).reduce((t, x) => t + Number(x.kg), 0);
    ok(casi(sum(B, 'consumida'), 48 * kgb) && casi(sum(B, 'liberada'), 2 * kgb), 'reserva de B: consumido lo que salió, liberada la muestra');
    ok(casi(sum(C, 'consumida'), 49 * kgb) && casi(sum(C, 'liberada'), 1 * kgb), 'reserva de C: consumido lo que salió, liberada la merma');
    ok(casi(sum(D, 'consumida'), 40 * kgb) && casi(sum(D, 'activa'), 10 * kgb), 'reserva de D: lo que no entró sigue apartado para el mismo pedido (se puede liberar)');
    const [pr] = await consultar(`select * from v_pedido_linea_programacion where pedido_linea_id = ${p1.linea}`);
    ok(casi(pr.despachado_kg, 187 * kgb), 'el pedido cuenta como despachado solo lo que salió', `${pr.despachado_kg} kg`);
    ok(casi(pr.por_programar_kg, 13 * kgb) && casi(pr.reservado_kg, 10 * kgb), 'y le quedan 13 bultos por programar (10 apartados en cámara)', `${pr.por_programar_kg} kg por programar`);
    const [el] = await consultar(`select kg_no_despachado::numeric k from embarque_lineas where embarque_id = ${e1.id}`);
    ok(casi(el.k, 13 * kgb), 'el embarque anota lo que no salió de su línea', `${el.k} kg`);
    const [emb] = await consultar(`select estado::text e from embarques where id = ${e1.id}`);
    ok(emb.e === 'despachado', 'el embarque queda despachado');
    const [pl] = await consultar(`select count(*) filter (where motivo_diferencia is not null)::int n, sum(bultos)::int b, sum(coalesce(bultos_cargados, bultos))::int bc
                                    from packing_lineas where packing_list_id = ${e1.pk.id}`);
    ok(pl.n === 3 && pl.b === 187 && pl.bc === 200, 'el packing guarda lo cargado (200) y lo despachado (187)');
    const [cu] = await consultar(`select programado_kg::numeric p, despachado_kg::numeric d from v_contenedor_cumplimiento where packing_list_id = ${e1.pk.id}`);
    ok(casi(cu.p, 200 * kgb) && casi(cu.d, 187 * kgb), 'Fill Rate: el contenedor compara lo cargado con lo que salió', `${cu.d} de ${cu.p} kg`);
    const [cob] = await consultar(`select cobertura::text c from pedidos where id = ${p1.id}`);
    ok(cob.c !== 'preparado', 'la cobertura del pedido no lo da por completo', cob.c);
    // Lo que no salió se puede volver a programar (en una transacción que se deshace).
    const reprog = await enTransaccion(`
      declare v_e bigint; v_res jsonb := '{}';
      begin
        insert into embarques (numero, fecha_programada, almacen_id, tipo_despacho, estado, creado_por)
        values ('PRUEBA-075-R', current_date + 5, ${alm1.id}, 'exportacion', 'planificado', '${gerente}') returning id into v_e;
        begin
          insert into embarque_lineas (embarque_id, pedido_linea_id, sku_presentacion_id, cantidad_kg, creado_por)
          values (v_e, ${p1.linea}, ${sp.id}, ${13 * kgb}, '${gerente}');
          v_res := '{"ok":true}';
        exception when others then v_res := jsonb_build_object('error', sqlerrm); end;
        raise exception 'RESULTADO%RESULTADO', v_res::text;
      end;`);
    ok(reprog.ok === true, 'lo que no salió se puede programar en otro embarque', reprog.error);
    const [ev] = await consultar(`select descripcion from eventos where entidad = 'packing_lists' and entidad_id = ${e1.pk.id} and tipo = 'despacho_ejecutado'`);
    ok(/Salió distinto de lo cargado/.test(ev?.descripcion ?? '') && /muestreo/.test(ev?.descripcion ?? ''), 'el historial del packing dice qué salió distinto', ev?.descripcion?.slice(0, 120));
    const editar = await enTransaccion(`
      declare v_res jsonb := '{}';
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', '${gerente}', 'role', 'authenticated')::text, true);
        begin update packing_lineas set bultos = 1 where packing_list_id = ${e1.pk.id}; v_res := '{"edito":true}';
        exception when others then v_res := jsonb_build_object('error', sqlerrm); end;
        raise exception 'RESULTADO%RESULTADO', v_res::text;
      end;`);
    ok(/ya se despachó/.test(editar.error ?? ''), 'lo que salió en un packing despachado no se edita', editar.error);

    /* ---- Las pantallas ---- */
    await ir(g, `/logistica/packing/${e1.pk.id}`);
    ok(await g.locator('[data-aviso="salio-distinto"]').count() === 1, 'la ficha del packing avisa que salió distinto');
    const filaB = await g.locator(`[data-cuadro="pallets-cargados"] tr[data-lote="${B.id}"]`).innerText();
    ok(/50 b/.test(filaB) && /48 b/.test(filaB) && /Muestreo: SGS sacó 2 sacos/.test(filaB), 'y cada pallet: cargado, despachado, diferencia y motivo', filaB.replace(/\s+/g, ' '));
    await g.locator('#pallets').screenshot({ path: `${capturas}/packing-despachado.png` });

    await ir(g, `/logistica/despachos/${d1.id}`);
    ok(await g.locator('[data-aviso="salio-distinto"]').count() === 1, 'la ficha del despacho avisa que salió distinto');
    ok(await g.locator('[data-cuadro="items-despacho"] tr[data-diferencia="si"]').count() === 3, 'y marca los 3 pallets con diferencia');
    const filaD = await g.locator(`[data-cuadro="items-despacho"] tr[data-lote="${D.id}"]`).innerText();
    ok(/No entró en el contenedor/.test(filaD) && /volvió a cámara/.test(filaD), 'con el motivo y qué pasó con la diferencia', filaD.replace(/\s+/g, ' '));
    await g.screenshot({ path: `${capturas}/ficha-despacho.png`, fullPage: true });

    const resp = await g.request.get(`${BASE}/api/despachos/reporte?ids=${d1.id}`);
    const pdf = Buffer.from(await resp.body());
    ok(resp.status() === 200 && pdf.subarray(0, 4).toString() === '%PDF', 'el reporte de carga se descarga');
    const datos = await new PDFExtract().extractBuffer(pdf, {});
    const texto = datos.pages.flatMap((p) => p.content.map((x) => x.str)).join(' ');
    ok(/SALIÓ DISTINTO DE LO CARGADO/.test(texto) && /Muestreo: SGS/.test(texto) && /No entró en el contenedor/.test(texto),
       'el reporte dice cargado / despachado / diferencia y motivo');
    ok(/Cargado: 200 bultos/.test(texto) && /Despachado: 187 bultos/.test(texto), 'con los totales de lo cargado y lo despachado');

    await ir(g, `/logistica/embarques/${e1.id}`);
    const noSalio = await g.locator('[data-cuadro="embarque-lineas"] [data-no-salio]').innerText().catch(() => '');
    ok(/No salieron/.test(noSalio) && /por programar/.test(noSalio), 'la ficha del embarque dice cuánto no salió y que vuelve a «por programar»', noSalio);
  }

  /* ════════════════════════ 4 · CORTE DE RED ════════════════════════ */
  console.log(SEC(4, 'Un corte de red al despachar no rompe la pantalla'));
  {
    await ir(g, `/logistica/packing/${e2.pk.id}`);
    await g.route('**/logistica/packing/**', (r) => (r.request().method() === 'POST' ? r.abort() : r.continue()));
    await g.click('[data-accion="despachar"]');
    await g.locator('[data-resultado-despacho="mal"]').waitFor({ timeout: 60000 });
    ok(/Se perdió la conexión/.test(await g.locator('[data-resultado-despacho="mal"]').innerText()), 'el corte vuelve como aviso en el mismo panel');
    ok(await g.locator('text=No se pudo cargar esta pantalla').count() === 0, 'y no reemplaza la pantalla entera');
    await g.unroute('**/logistica/packing/**');
  }

  /* ════════════════════════ 5 · PALLET BLOQUEADO DESPUÉS DE CARGARLO ════════════════════════ */
  console.log(SEC(5, 'Calidad bloquea un pallet que ya está en el contenedor'));
  {
    const [dic] = await consultar(`
      insert into dictamenes_calidad (lote_id, tipo, estado, motivo_id, motivo_texto, vigente, emitido_por, observaciones)
      select ${E.id}, 'calidad', 'inmovilizado', id, 'PRUEBA-075', true, '${gerente}', 'PRUEBA-075'
        from motivos where ambito = 'bloqueo' and codigo = 'PARASITADO' returning id`);
    c.dictamenes.push(dic.id);
    await ir(g, `/logistica/packing/${e2.pk.id}`);
    const aviso = await g.locator('[data-aviso="bloqueo-calidad"]').innerText().catch(() => '');
    ok(aviso.includes(E.codigo_pallet) && /bloqueado/.test(aviso) && /parasitado/i.test(aviso), 'la ficha del packing avisa qué pallet está bloqueado y por qué', aviso.slice(0, 140));
    ok(await g.locator(`[data-cuadro="pallets-cargados"] tr[data-lote="${E.id}"][data-bloqueado="si"]`).count() === 1, 'y lo marca en «Pallets cargados»');
    await g.click('[data-accion="despachar"]');
    await g.locator('.despachar-bloqueo').waitFor({ timeout: 60000 });
    const imp = await g.locator('.despachar-bloqueo').innerText();
    ok(imp.includes(E.codigo_pallet) && /bloqueado por Calidad/.test(imp), 'el panel de despachar lo pone como impedimento', imp.replace(/\s+/g, ' ').slice(0, 160));
    ok(await g.locator('[data-accion="confirmar-despacho"]').count() === 0, 'y no deja confirmar');
    ok(/Quite del contenedor el pallet bloqueado/.test(await g.locator('[data-motivo="despachar"]').innerText().catch(() => '')), 'y dice qué hacer');
    await g.locator('.despachar').screenshot({ path: `${capturas}/despachar-bloqueado.png` });
    // Si ya lo bajaron del contenedor: 0 bultos y «No entró» → se puede despachar el resto (no se confirma aquí).
    await g.click('[data-accion="ajustar-salida"]');
    await g.fill(`input[name="salio-bultos-${E.id}"]`, '1');
    ok(/Bloqueado por Calidad: no puede salir/.test(await g.locator(`[data-bloque="ajustes-despacho"] tr[data-lote="${E.id}"]`).innerText()), 'en el ajuste, sacar algo del pallet bloqueado se marca');
    await g.fill(`input[name="salio-bultos-${E.id}"]`, '0');
    await g.selectOption(`select[name="motivo-${E.id}"]`, 'no_entro');
    ok(await g.locator('[data-accion="confirmar-despacho"]').count() === 1 && await g.locator('.despachar-bloqueo').count() === 0,
       'declarado entero como «No entró», el bloqueo deja de impedir el resto');
    await g.click('[data-accion="sale-todo"]');
    const base = await enTransaccion(`
      declare v_res jsonb := '{}';
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', '${gerente}', 'role', 'authenticated')::text, true);
        begin perform ejecutar_despacho(${e2.pk.id}, 'PRUEBA-075-B'); v_res := '{"despacho":true}';
        exception when others then v_res := jsonb_build_object('error', sqlerrm); end;
        raise exception 'RESULTADO%RESULTADO', v_res::text;
      end;`);
    ok((base.error ?? '').includes(E.codigo_pallet) && /bloqueado por Calidad/.test(base.error ?? ''), 'la base también lo rechaza, con el pallet y el motivo', base.error);
    const quieto = await enTransaccion(`
      declare v_res jsonb := '{}'; v_d bigint;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', '${gerente}', 'role', 'authenticated')::text, true);
        v_d := ejecutar_despacho(${e2.pk.id}, 'PRUEBA-075-Q',
                 '[{"lote_id": ${E.id}, "bultos": 0, "kg": 0, "motivo": "no_entro"}]'::jsonb);
        v_res := jsonb_build_object(
          'movs_e', (select count(*) from movimientos where documento_id = v_d and documento_tipo = 'despacho' and lote_id = ${E.id}),
          'res_e', (select string_agg(estado::text, ',') from reservas where lote_id = ${E.id}),
          'f', (select sum(bultos) from movimientos where documento_id = v_d and documento_tipo = 'despacho' and lote_id = ${F.id}));
        raise exception 'RESULTADO%RESULTADO', v_res::text;
      end;`);
    ok(quieto.movs_e === 0 && quieto.res_e === 'activa' && quieto.f === 50,
       'en la base, el bloqueado declarado «no entró» se queda en cámara apartado y sale el resto', JSON.stringify(quieto));
    const [cargar] = [await enTransaccion(`
      declare v_res jsonb := '{}';
      begin
        raise exception 'RESULTADO%RESULTADO', jsonb_build_object('t', lote_bloqueo_texto(${E.id}))::text;
      end;`)];
    ok(/inmovilizado/.test(cargar.t ?? ''), 'lote_bloqueo_texto explica el bloqueo', cargar.t);
    await consultar(`delete from dictamenes_calidad where id = ${dic.id}`);
  }

  /* ════════════════════════ 6 · DESPACHO NORMAL ════════════════════════ */
  console.log(SEC(6, 'Despacho normal, sin ajustes: igual que siempre'));
  {
    await ir(g, `/logistica/packing/${e2.pk.id}`);
    ok(await g.locator('[data-aviso="bloqueo-calidad"]').count() === 0, 'liberado el pallet, el aviso desaparece');
    await g.click('[data-accion="despachar"]');
    await g.locator(`#conf-${e2.pk.id}`).waitFor({ timeout: 60000 });
    ok(/Sí, despachar$/.test((await g.locator('[data-accion="confirmar-despacho"]').innerText()).trim()), 'el botón de siempre: «Sí, despachar»');
    await g.fill(`#conf-${e2.pk.id}`, e2.pk.contenedor);
    await g.click('[data-accion="confirmar-despacho"]');
    await g.locator('[data-resultado-despacho="ok"]').waitFor({ timeout: 120000 });
    const [d2] = await consultar(`select id from despachos where packing_list_id = ${e2.pk.id}`);
    const movs = await consultar(`select tipo::text t, sum(bultos)::int b from movimientos where documento_tipo = 'despacho' and documento_id = ${d2.id} group by 1`);
    ok(movs.length === 1 && movs[0].t === 'salida_despacho' && movs[0].b === 100, 'Kardex: salen los 100 bultos cargados, solo como venta');
    const [rs] = await consultar(`select count(*) filter (where estado = 'consumida')::int c, count(*)::int n from reservas where pedido_linea_id = ${p2.linea}`);
    ok(rs.c === 2 && rs.n === 2, 'las dos reservas quedan consumidas, sin partirse');
    const [pl] = await consultar(`select count(*) filter (where bultos_cargados is not null or motivo_diferencia is not null)::int n from packing_lineas where packing_list_id = ${e2.pk.id}`);
    ok(pl.n === 0, 'el packing no anota diferencias');
    const [pr] = await consultar(`select por_programar_kg::numeric p, despachado_kg::numeric d from v_pedido_linea_programacion where pedido_linea_id = ${p2.linea}`);
    ok(casi(pr.p, 0) && casi(pr.d, 100 * kgb), 'el pedido queda completo: nada por programar');
    await ir(g, `/logistica/despachos/${d2.id}`);
    ok(await g.locator('[data-aviso="salio-distinto"]').count() === 0 && await g.locator('[data-cuadro="items-despacho"] th', { hasText: 'Diferencia' }).count() === 0,
       'la ficha del despacho se ve como siempre');
  }

  /* ════════════════════════ 7 · TEXTOS ════════════════════════ */
  console.log(SEC(7, 'Mensajes de rol legibles'));
  {
    const archivos = ['packing/acciones.ts', 'despachos/acciones.ts', 'despachos/archivos.ts', 'embarques/acciones.ts']
      .map((f) => readFileSync(`src/app/(erp)/logistica/${f}`, 'utf8'));
    ok(archivos.every((t) => !/Su rol \(/.test(t)), 'ya no queda ningún «Su rol (clave)» en embarques, packing y despachos');
  }
  ok(fallosJs.length === 0, 'ningún error de JavaScript en las pantallas', fallosJs.slice(0, 2).join(' | '));
} catch (e) {
  ok(false, 'la prueba se interrumpió', String(e?.message ?? e).slice(0, 300));
} finally {
  /* ---- Todo vuelve a como estaba (solo lo creado por esta prueba) ---- */
  try {
    const desp = (await consultar(`select id from despachos where packing_list_id in (${lista(c.packings)})`)).map((x) => x.id);
    const movs = (await consultar(`select id from movimientos where lote_id in (${lista(c.lotes)})`)).map((x) => x.id);
    const res = (await consultar(`select id from reservas where pedido_linea_id in (${lista(c.lineas)}) or id in (${lista(c.reservas)})`)).map((x) => x.id);
    const dics = (await consultar(`select id from dictamenes_calidad where lote_id in (${lista(c.lotes)})`)).map((x) => x.id);
    /* Primero las existencias: así los pallets de prueba dejan de verse como
       stock y otra prueba que corra a la vez no los aparta mientras se limpia. */
    await consultar(`delete from existencias where lote_id in (${lista(c.lotes)})`);
    await consultar(`delete from despacho_archivos where despacho_id in (${lista(desp)})`);
    await consultar(`
      alter table movimientos disable trigger trg_kardex_no_delete;
      delete from movimientos where id in (${lista(movs)});
      alter table movimientos enable trigger trg_kardex_no_delete;`);
    await consultar(`delete from despachos where id in (${lista(desp)})`);
    await consultar(`delete from reservas where id in (${lista(res)})`);
    await consultar(`delete from plano_estiba where packing_list_id in (${lista(c.packings)})`);
    await consultar(`delete from packing_lineas where packing_list_id in (${lista(c.packings)})`);
    await consultar(`delete from packing_lists where id in (${lista(c.packings)})`);
    await consultar(`delete from embarque_lineas where embarque_id in (${lista(c.embarques)})`);
    await consultar(`delete from embarque_pedidos where embarque_id in (${lista(c.embarques)})`);
    await consultar(`delete from embarques where id in (${lista(c.embarques)})`);
    await consultar(`delete from dictamenes_calidad where id in (${lista(dics)})`);
    await consultar(`delete from existencias where lote_id in (${lista(c.lotes)})`);
    await consultar(`delete from pedido_lineas where id in (${lista(c.lineas)})`);
    await consultar(`delete from pedidos where id in (${lista(c.pedidos)})`);
    // Un pallet que otra prueba haya apartado en el intervalo no se toca: se avisa.
    const ajenos = await consultar(`select distinct lote_id from reservas where lote_id in (${lista(c.lotes)})`);
    if (ajenos.length) console.log(`  .. ${ajenos.length} pallet(s) de prueba con reservas ajenas: no se borran (${ajenos.map((x) => x.lote_id).join(', ')})`);
    await consultar(`delete from lotes l where id in (${lista(c.lotes)}) and not exists (select 1 from reservas r where r.lote_id = l.id)`);
    const porEntidad = {
      despachos: desp, despacho: desp, packing_lists: c.packings, packing_list: c.packings, embarques: c.embarques,
      reservas: res, lotes: c.lotes, pedidos: c.pedidos,
    };
    for (const [ent, ids] of Object.entries(porEntidad)) {
      if (ids.length) await consultar(`delete from eventos where entidad = '${ent}' and entidad_id in (${lista(ids)}) and ocurrido_en >= '${inicio}'`);
    }
    await consultar(`delete from alertas where generada_en >= '${inicio}' and (
                       (entidad in ('pedidos', 'pedido') and entidad_id in (${lista(c.pedidos)}))
                    or (entidad in ('lotes', 'lote') and entidad_id in (${lista(c.lotes)}))
                    or (entidad in ('embarques', 'embarque') and entidad_id in (${lista(c.embarques)})))`);
    const audit = {
      despachos: desp, movimientos: movs, reservas: res, packing_lists: c.packings, embarques: c.embarques,
      lotes: c.lotes, pedidos: c.pedidos, pedido_lineas: c.lineas, dictamenes_calidad: dics,
    };
    for (const [tabla, ids] of Object.entries(audit)) {
      if (ids.length) await consultar(`delete from auditoria where ocurrido_en >= '${inicio}' and tabla = '${tabla}' and registro_id in (${comillas(ids.map(String))})`);
    }
    await consultar(`delete from auditoria where ocurrido_en >= '${inicio}' and tabla = 'embarque_lineas'
                       and (datos_despues->>'embarque_id' in (${comillas(c.embarques.map(String))}) or datos_antes->>'embarque_id' in (${comillas(c.embarques.map(String))}))`);
    // El correlativo de despachos, solo si nadie más despachó mientras tanto.
    const usados = desp.length;
    if (usados) {
      await consultar(`update correlativos set ultimo = ${Number(desp0)}
                        where serie = 'DESP' and anio = ${anio} and ultimo = ${Number(desp0) + usados}`);
    }
    const [resto] = await consultar(`select (select count(*) from lotes where codigo_pallet like 'PRB 075 ${marca}%')::int l,
                                            (select count(*) from pedidos where numero_proforma like 'PRUEBA-075-${marca}%')::int p,
                                            (select count(*) from embarques where numero like 'PRUEBA-075-${marca}%')::int e`);
    console.log(`\n  limpieza: quedan ${resto.l} pallets, ${resto.p} pedidos y ${resto.e} embarques de la prueba`);
  } catch (e) {
    console.log(`  .. limpieza incompleta: ${String(e.message).slice(0, 300)}`);
  }
  await nav.close();
}

console.log(fallos.length ? `\n${fallos.length} FALLA(S):\n - ${fallos.join('\n - ')}` : '\nTodo en orden.');
process.exit(fallos.length ? 1 : 0);
