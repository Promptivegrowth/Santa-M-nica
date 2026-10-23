/**
 * ============================================================================
 *  PRUEBA · LO QUE ENCONTRÓ LA REVISIÓN DE LA GUÍA DE USO
 * ============================================================================
 *  Al recorrer el sistema pantalla por pantalla para escribir la Guía de uso
 *  aparecieron huecos en el flujo principal. Esto prueba sus arreglos:
 *
 *    1. Confirmar y cancelar un pedido desde su ficha (antes no había botón).
 *    2. Solo una cotización aprobada se convierte en pedido.
 *    3. Los datos del contenedor (precinto, guía, DAM) se editan en el packing.
 *    4. Cada pallet del packing guarda la línea del pedido a la que va.
 *    5. «Ver en el calendario» abre el mes y el día del embarque.
 *    6. El despacho consume solo lo cargado y no cierra el embarque antes de
 *       tiempo (migración 066). Se prueba dentro de una transacción que se
 *       deshace: no deja rastro en la base.
 *
 *  Todo lo que se crea o se cambia se devuelve como estaba al final.
 *
 *      BASE_URL=http://localhost:3010 node scripts/probar-correcciones-guia.mjs
 * ============================================================================
 */
import { chromium } from 'playwright';
import { ejecutarSQL } from './db.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const consultar = async (sql) => { const r = await ejecutarSQL(sql); return Array.isArray(r) ? r : []; };
const SEC = (n, t) => `\n${'─'.repeat(3)} ${n} · ${t} ${'─'.repeat(3)}`;
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
  await pagina.fill('input[type="password"]', process.env.CLAVE_DEMO ?? 'SantaMonica2026');
  await pagina.click('button[type="submit"]');
  await pagina.waitForURL(/\/panel/, { timeout: 30000 });
}

/* Lo que hay que devolver a su sitio al terminar. */
let pedido = null;
let reservaPrueba = null;
let packingOriginal = null;
let reservaPacking = null;
let cotizacionPrueba = null;
const PACKING = 106;      // PL POT406: abierto, vacío, embarque nacional 191
const LINEA_PACKING = 978; // línea del pedido 457, que va en ese embarque
const LOTE_PACKING = 1069; // misma presentación, con stock libre en la bodega 4

try {
  await entrar(p, 'gerencia@santamonica.pe');

  console.log(SEC(1, 'Confirmar y cancelar un pedido desde su ficha'));
  {
    [pedido] = await consultar(`
      select p.id, p.numero_proforma, p.ciclo::text ciclo
        from pedidos p join clientes c on c.id = p.cliente_id
       where p.ciclo = 'borrador' and not c.bloqueado
         and exists (select 1 from pedido_lineas pl where pl.pedido_id = p.id)
         and not exists (select 1 from embarque_pedidos ep where ep.pedido_id = p.id)
       order by p.id desc limit 1`);
    ok(!!pedido, 'hay un pedido en borrador para probar', pedido?.numero_proforma);

    await p.goto(`${BASE}/ventas/pedidos/${pedido.id}`, { waitUntil: 'networkidle' });
    ok(await p.locator('[data-accion="confirmar-pedido"]').count() === 1, 'Gerencia ve «Confirmar pedido» en un borrador');
    await p.click('[data-accion="confirmar-pedido"]');
    await p.locator('[data-bloque="ciclo-pedido"] [role="status"]').waitFor({ timeout: 20000 });
    const [c1] = await consultar(`select ciclo::text from pedidos where id = ${pedido.id}`);
    ok(c1.ciclo === 'confirmado', 'el pedido queda confirmado en la base');
    const [ev] = await consultar(`select count(*)::int n from eventos where entidad = 'pedidos' and entidad_id = ${pedido.id} and tipo = 'pedido_confirmado' and ocurrido_en > '${inicio}'`);
    ok(ev.n === 1, 'y queda en su historial');
    await p.reload({ waitUntil: 'networkidle' });
    ok(await p.locator('[data-accion="confirmar-pedido"]').count() === 0, 'ya confirmado, el botón de confirmar desaparece');

    // Una reserva para comprobar que cancelar la suelta.
    const [lin] = await consultar(`select pl.id, pl.sku_presentacion_id sp from pedido_lineas pl where pl.pedido_id = ${pedido.id} order by pl.id limit 1`);
    const [lote] = await consultar(`
      select v.lote_id, v.almacen_id, pr.peso_bulto_kg::numeric kg
        from v_stock_lote v join lotes l on l.id = v.lote_id
        join sku_presentaciones sp on sp.id = l.sku_presentacion_id join presentaciones pr on pr.id = sp.presentacion_id
       where v.disponible_kg > 500 and v.solo_nacional_kg = 0
       order by (v.sku_presentacion_id = ${lin.sp}) desc, v.disponible_kg desc limit 1`);
    const [{ id: gerente }] = await consultar(`select id from usuarios where rol = 'gerencia' and activo limit 1`);
    [reservaPrueba] = await consultar(`
      insert into reservas (pedido_linea_id, lote_id, almacen_id, bultos, peso_neto_kg, estado, creado_por, observaciones)
      values (${lin.id}, ${lote.lote_id}, ${lote.almacen_id}, 5, ${5 * Number(lote.kg)}, 'activa', '${gerente}', 'PRUEBA guía: cancelar pedido')
      returning id`);

    await p.click('[data-accion="cancelar-pedido"]');
    await p.fill('input[name="motivo_cancelacion"]', 'no');
    await p.click('[data-accion="confirmar-cancelacion"]');
    await p.locator('[data-bloque="ciclo-pedido"] [role="alert"]').waitFor({ timeout: 20000 });
    ok(/al menos 5 caracteres/.test(await p.locator('[data-bloque="ciclo-pedido"] [role="alert"]').innerText()), 'sin un motivo de verdad no se cancela');
    await p.fill('input[name="motivo_cancelacion"]', 'El cliente desistió de la compra');
    await p.click('[data-accion="confirmar-cancelacion"]');
    await p.locator('[data-bloque="ciclo-pedido"] [role="status"]').waitFor({ timeout: 20000 }).catch(() => {});
    const [c2] = await consultar(`select ciclo::text from pedidos where id = ${pedido.id}`);
    ok(c2.ciclo === 'cancelado', 'con motivo, el pedido queda cancelado');
    const [r2] = await consultar(`select estado::text from reservas where id = ${reservaPrueba.id}`);
    ok(r2.estado === 'liberada', 'y su reserva se suelta: el stock vuelve a estar disponible', r2.estado);
    const [ev2] = await consultar(`select descripcion from eventos where entidad = 'pedidos' and entidad_id = ${pedido.id} and tipo = 'pedido_cancelado' and ocurrido_en > '${inicio}'`);
    ok(/desistió/.test(ev2?.descripcion ?? ''), 'el motivo queda en el historial');
    await p.reload({ waitUntil: 'networkidle' });
    ok(await p.locator('[data-bloque="ciclo-pedido"]').count() === 0, 'un pedido cancelado ya no ofrece ni confirmar ni cancelar');

    // Un pedido que ya está en un embarque no se cancela desde aquí.
    const [enEmb] = await consultar(`
      select p.id from pedidos p join embarque_pedidos ep on ep.pedido_id = p.id join embarques e on e.id = ep.embarque_id
       where p.ciclo = 'confirmado' and e.estado <> 'cancelado' limit 1`);
    if (enEmb) {
      await p.goto(`${BASE}/ventas/pedidos/${enEmb.id}`, { waitUntil: 'networkidle' });
      await p.click('[data-accion="cancelar-pedido"]');
      await p.fill('input[name="motivo_cancelacion"]', 'Prueba que no debe pasar');
      await p.click('[data-accion="confirmar-cancelacion"]');
      await p.locator('[data-bloque="ciclo-pedido"] [role="alert"]').waitFor({ timeout: 20000 });
      ok(/embarque/.test(await p.locator('[data-bloque="ciclo-pedido"] [role="alert"]').innerText()), 'un pedido ya embarcado no se cancela: pide sacarlo del embarque');
      const [c3] = await consultar(`select ciclo::text from pedidos where id = ${enEmb.id}`);
      ok(c3.ciclo === 'confirmado', 'y sigue confirmado');
    }

    // Comercial no confirma ni cancela.
    const c = await ctx.browser().newContext({ viewport: { width: 1400, height: 900 } });
    const pc = await c.newPage();
    await entrar(pc, 'comercial@santamonica.pe');
    await pc.goto(`${BASE}/ventas/pedidos/${pedido.id}`, { waitUntil: 'networkidle' });
    ok(await pc.locator('[data-bloque="ciclo-pedido"]').count() === 0, 'Comercial no ve los botones de confirmar ni cancelar');
    await c.close();
  }

  console.log(SEC(2, 'Solo una cotización aprobada se convierte en pedido'));
  {
    const [{ valor }] = await consultar(`select valor from parametros where clave = 'cotizacion_requiere_aprobacion'`);
    ok(valor === 'si', 'la empresa exige aprobar cotizaciones');
    const [cot] = await consultar(`
      select c.id, c.numero from cotizaciones c
       where c.estado = 'borrador' and c.aprobada_en is null
         and not exists (select 1 from pedidos p where p.cotizacion_id = c.id) limit 1`);
    await p.goto(`${BASE}/ventas/cotizaciones/${cot.id}`, { waitUntil: 'networkidle' });
    const boton = p.locator('[data-accion="convertir"]');
    ok(await boton.isDisabled(), `${cot.numero} sin aprobar: «Convertir en pedido» está deshabilitado`);
    ok(/aprobarse/.test(await boton.getAttribute('title') ?? ''), 'y dice por qué');

    /*
     * Aunque la pantalla esté desactualizada, el servidor lo rechaza: se abre
     * la ficha con la cotización aprobada, se le quita la aprobación por
     * detrás y recién entonces se pulsa.
     */
    await consultar(`update cotizaciones set aprobada_en = now() where id = ${cot.id}`);
    cotizacionPrueba = cot.id;
    await p.reload({ waitUntil: 'networkidle' });
    ok(await boton.isEnabled(), 'aprobada, el botón se habilita');
    await consultar(`update cotizaciones set aprobada_en = null where id = ${cot.id}`);
    await boton.click();
    await p.locator('.accion-error').waitFor({ timeout: 20000 });
    ok(/no está aprobada/.test(await p.locator('.accion-error').innerText()), 'forzando el botón, el servidor tampoco lo convierte');
    const [n] = await consultar(`select count(*)::int n from pedidos where cotizacion_id = ${cot.id}`);
    ok(n.n === 0, 'no se creó ningún pedido');

    await p.goto(`${BASE}/ventas/cotizaciones?estado=borrador`, { waitUntil: 'networkidle' });
    const fila = p.locator('tr', { hasText: cot.numero }).first();
    const iconoPedido = fila.locator('button[title*="aprobarse"]');
    ok(await iconoPedido.count() === 1 && await iconoPedido.isDisabled(), 'en el listado, el icono de convertir también está apagado y explica por qué');
  }

  console.log(SEC(3, 'Datos del contenedor editables en el packing'));
  {
    [packingOriginal] = await consultar(`select contenedor, precinto, guia_remision, dam, supervisor_id, turno::text, fecha_carga::text,
                                                hora_inicio::text, hora_fin::text, filas_contenedor, sacos_por_fila, observaciones, estado::text
                                           from packing_lists where id = ${PACKING}`);
    ok(['abierto', 'en_carga'].includes(packingOriginal.estado), 'el packing de prueba está abierto');
    await p.goto(`${BASE}/logistica/packing/${PACKING}`, { waitUntil: 'networkidle' });
    await p.click('[data-accion="editar-datos-packing"]');
    await p.fill('input[name="precinto"]', 'PRU-0001');
    await p.fill('input[name="guia_remision"]', 'EG07-PRUEBA1');
    await p.fill('input[name="dam"]', '235-2026-40-000001');
    await p.click('[data-accion="guardar-datos-packing"]');
    await p.locator('[data-accion="editar-datos-packing"]').waitFor({ timeout: 20000 });
    const [d] = await consultar(`select precinto, guia_remision, dam from packing_lists where id = ${PACKING}`);
    ok(d.precinto === 'PRU-0001' && d.guia_remision === 'EG07-PRUEBA1' && d.dam === '235-2026-40-000001', 'precinto, guía y DAM quedan guardados');
    await p.reload({ waitUntil: 'networkidle' });
    ok(/EG07-PRUEBA1/.test(await p.locator('main').innerText()), 'y se ven en «Datos del embarque»');

    // No se puede achicar el contenedor por debajo del plano: probado en el servidor; aquí, filas en 0.
    await p.click('[data-accion="editar-datos-packing"]');
    await p.fill('input[name="filas_contenedor"]', '0');
    await p.click('[data-accion="guardar-datos-packing"]');
    await p.locator('[data-bloque="editar-datos-packing"] [role="alert"]').waitFor({ timeout: 20000 });
    ok(/mayores que cero/.test(await p.locator('[data-bloque="editar-datos-packing"] [role="alert"]').innerText()), 'cero filas se rechaza con un mensaje claro');

    // Un packing cerrado no ofrece editar.
    const [cerrado] = await consultar(`select id from packing_lists where estado = 'cerrado' limit 1`);
    await p.goto(`${BASE}/logistica/packing/${cerrado.id}`, { waitUntil: 'networkidle' });
    ok(await p.locator('[data-accion="editar-datos-packing"]').count() === 0, 'un packing ya despachado no se edita');

    // El supervisor actual sale elegido aunque su rol no sea de logística (si no, guardar lo borraría).
    await p.goto(`${BASE}/logistica/packing/${PACKING}`, { waitUntil: 'networkidle' });
    await p.click('[data-accion="editar-datos-packing"]');
    ok(await p.locator('select[name="supervisor_id"]').inputValue() === String(packingOriginal.supervisor_id ?? ''),
       'el formulario abre con el supervisor que ya tenía el packing');
    await p.getByRole('button', { name: 'Cancelar', exact: true }).click();
  }

  console.log(SEC(4, 'Cada pallet del packing sabe a qué línea de pedido va'));
  {
    const [{ id: gerente }] = await consultar(`select id from usuarios where rol = 'gerencia' and activo limit 1`);
    [reservaPacking] = await consultar(`
      insert into reservas (pedido_linea_id, lote_id, almacen_id, bultos, peso_neto_kg, estado, creado_por, observaciones)
      values (${LINEA_PACKING}, ${LOTE_PACKING}, 4, 10, 280, 'activa', '${gerente}', 'PRUEBA guía: pallet con su línea')
      returning id`);
    await p.goto(`${BASE}/logistica/packing/${PACKING}`, { waitUntil: 'networkidle' });
    await p.getByRole('button', { name: /Agregar pallet/ }).click();
    const [{ codigo_pallet }] = await consultar(`select codigo_pallet from lotes where id = ${LOTE_PACKING}`);
    const filaApartada = p.locator('.cargar-panel tr', { hasText: codigo_pallet }).first();
    await filaApartada.waitFor({ timeout: 20000 });
    ok(/SM26|SM-|\d/.test(await filaApartada.innerText()), 'el pallet apartado aparece en «Apartado para los pedidos de este embarque»');
    await filaApartada.getByRole('button', { name: 'Elegir' }).click();
    await p.locator('.cargar-confirma input').fill('10');
    await p.getByRole('button', { name: /Agregar al contenedor/ }).click();
    await p.waitForTimeout(2500);
    const [pl] = await consultar(`select pedido_linea_id from packing_lineas where packing_list_id = ${PACKING} and lote_id = ${LOTE_PACKING}`);
    ok(Number(pl?.pedido_linea_id) === LINEA_PACKING, 'la línea del packing guarda la línea del pedido', String(pl?.pedido_linea_id));
  }

  console.log(SEC(5, '«Ver en el calendario» abre el mes y el día del embarque'));
  {
    const [e] = await consultar(`select id, numero, fecha_programada::date::text f from embarques
                                  where to_char(fecha_programada, 'YYYY-MM') <> to_char(now() at time zone 'America/Lima', 'YYYY-MM')
                                    and estado <> 'cancelado' order by fecha_programada desc limit 1`);
    await p.goto(`${BASE}/logistica/planificador?embarque=${e.id}`, { waitUntil: 'networkidle' });
    ok(await p.locator(`[data-dia="${e.f}"][data-elegido="si"]`).count() === 1, `abre el ${e.f}, el día del embarque ${e.numero}, ya elegido`);
    ok(/./.test(await p.locator('main').innerText()) && (await p.locator('main').innerText()).includes(e.numero), 'y el embarque aparece en el detalle del día');
  }

  console.log(SEC(6, 'Despacho parcial: se consume solo lo cargado (en una transacción que se deshace)'));
  {
    let mensaje = '';
    try {
      await consultar(String.raw`
do $prueba$
declare
  v_uid uuid; v_lote bigint; v_alm bigint; v_l1 bigint; v_l2 bigint; v_p1 bigint;
  v_emb bigint; v_pk1 bigint; v_pk2 bigint; v_r1 bigint; v_r2 bigint; v_res jsonb := '{}';
begin
  select id into v_uid from usuarios where rol = 'gerencia' and activo limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  select v.lote_id, v.almacen_id into v_lote, v_alm
    from v_stock_lote v where v.disponible_kg >= 1000 and v.solo_nacional_kg = 0 order by v.disponible_kg desc limit 1;
  select pl.id, pl.pedido_id into v_l1, v_p1 from pedido_lineas pl join pedidos p on p.id = pl.pedido_id
   where p.ciclo = 'confirmado' and p.tipo_despacho = 'exportacion' order by pl.id limit 1;
  select pl.id into v_l2 from pedido_lineas pl where pl.pedido_id <> v_p1 order by pl.id desc limit 1;

  insert into embarques (numero, fecha_programada, almacen_id, tipo_despacho, estado, creado_por)
  values ('PRUEBA-066', current_date, v_alm, 'exportacion', 'en_preparacion', v_uid) returning id into v_emb;
  insert into embarque_pedidos (embarque_id, pedido_id) values (v_emb, v_p1);
  insert into packing_lists (codigo, embarque_id, creado_por) values ('PRUEBA-066-A', v_emb, v_uid) returning id into v_pk1;
  insert into packing_lists (codigo, embarque_id, creado_por) values ('PRUEBA-066-B', v_emb, v_uid) returning id into v_pk2;

  -- 600 kg apartados para el pedido del embarque; 200 kg del mismo pallet para OTRO pedido.
  insert into reservas (pedido_linea_id, lote_id, almacen_id, bultos, peso_neto_kg, estado, creado_por)
  values (v_l1, v_lote, v_alm, 10, 600, 'activa', v_uid) returning id into v_r1;
  insert into reservas (pedido_linea_id, lote_id, almacen_id, bultos, peso_neto_kg, estado, creado_por)
  values (v_l2, v_lote, v_alm, 5, 200, 'activa', v_uid) returning id into v_r2;

  -- Primer contenedor: se cargan 240 de los 600 kg.
  insert into packing_lineas (packing_list_id, lote_id, pedido_linea_id, bultos, peso_neto_kg) values (v_pk1, v_lote, v_l1, 4, 240);
  insert into plano_estiba (packing_list_id, lote_id, fila, sacos) values (v_pk1, v_lote, 1, 4);
  perform ejecutar_despacho(v_pk1, 'PRUEBA-066-D1');

  v_res := v_res || jsonb_build_object(
    'r1_kg', (select peso_neto_kg from reservas where id = v_r1),
    'r1_estado', (select estado from reservas where id = v_r1),
    'consumida_kg', (select sum(peso_neto_kg) from reservas where pedido_linea_id = v_l1 and lote_id = v_lote and estado = 'consumida' and observaciones like 'Parte despachada en PRUEBA-066-D1'),
    'r2_estado_1', (select estado from reservas where id = v_r2),
    'emb_1', (select estado from embarques where id = v_emb),
    'salida_1', (select sum(peso_neto_kg) from movimientos where documento_ref = 'PRUEBA-066-D1'));

  -- Segundo contenedor: el resto (360 kg). Ahora sí se cierra el embarque.
  insert into packing_lineas (packing_list_id, lote_id, pedido_linea_id, bultos, peso_neto_kg) values (v_pk2, v_lote, v_l1, 6, 360);
  insert into plano_estiba (packing_list_id, lote_id, fila, sacos) values (v_pk2, v_lote, 1, 6);
  perform ejecutar_despacho(v_pk2, 'PRUEBA-066-D2');

  v_res := v_res || jsonb_build_object(
    'r1_estado_2', (select estado from reservas where id = v_r1),
    'activas_l1', (select count(*) from reservas where pedido_linea_id = v_l1 and lote_id = v_lote and estado = 'activa' and id >= v_r1),
    'r2_estado_2', (select estado from reservas where id = v_r2),
    'r2_kg', (select peso_neto_kg from reservas where id = v_r2),
    'emb_2', (select estado from embarques where id = v_emb));

  raise exception 'RESULTADO%RESULTADO', v_res::text;
end $prueba$;`);
    } catch (e) {
      mensaje = String(e.message);
    }
    const m = mensaje.match(/RESULTADO(.*?)RESULTADO/);
    ok(!!m, 'la prueba corrió hasta el final (y se deshizo)', m ? '' : mensaje.slice(0, 300));
    if (m) {
      const r = JSON.parse(m[1].replace(/\\"/g, '"'));
      ok(Number(r.salida_1) === 240, 'el Kardex saca los 240 kg cargados', String(r.salida_1));
      ok(Number(r.r1_kg) === 360 && r.r1_estado === 'activa', 'de la reserva de 600 kg quedan 360 apartados', `${r.r1_kg} ${r.r1_estado}`);
      ok(Number(r.consumida_kg) === 240, 'y 240 kg quedan como consumidos en ese despacho', String(r.consumida_kg));
      ok(r.r2_estado_1 === 'activa', 'la reserva de otro pedido (otro embarque) no se toca');
      ok(r.emb_1 === 'en_preparacion', 'con otro contenedor abierto, el embarque sigue en preparación', r.emb_1);
      ok(r.r1_estado_2 === 'consumida' && Number(r.activas_l1) === 0, 'con el segundo contenedor se consume el resto');
      ok(r.r2_estado_2 === 'activa' && Number(r.r2_kg) === 200, 'la del otro pedido sigue intacta: 200 kg apartados');
      ok(r.emb_2 === 'despachado', 'y recién entonces el embarque queda despachado', r.emb_2);
    }
    const [rastro] = await consultar(`select count(*)::int n from embarques where numero = 'PRUEBA-066'`);
    ok(rastro.n === 0, 'no quedó rastro en la base');
  }
} catch (e) {
  console.log(' FALLA', e.message);
  fallos.push(e.message);
} finally {
  /* ---- Todo vuelve a como estaba ---- */
  if (pedido) {
    await consultar(`update pedidos set ciclo = '${pedido.ciclo}' where id = ${pedido.id}`);
    await consultar(`delete from eventos where entidad = 'pedidos' and entidad_id = ${pedido.id} and ocurrido_en > '${inicio}'`);
  }
  if (cotizacionPrueba) await consultar(`update cotizaciones set aprobada_en = null where id = ${cotizacionPrueba}`);
  if (reservaPrueba) await consultar(`delete from reservas where id = ${reservaPrueba.id}`);
  if (packingOriginal) {
    const v = (x) => (x == null ? 'null' : `'${String(x).replace(/'/g, "''")}'`);
    await consultar(`delete from packing_lineas where packing_list_id = ${PACKING} and lote_id = ${LOTE_PACKING}`);
    await consultar(`update packing_lists set contenedor = ${v(packingOriginal.contenedor)}, precinto = ${v(packingOriginal.precinto)},
      guia_remision = ${v(packingOriginal.guia_remision)}, dam = ${v(packingOriginal.dam)}, supervisor_id = ${v(packingOriginal.supervisor_id)},
      turno = ${v(packingOriginal.turno)}, fecha_carga = ${v(packingOriginal.fecha_carga)}, hora_inicio = ${v(packingOriginal.hora_inicio)},
      hora_fin = ${v(packingOriginal.hora_fin)}, filas_contenedor = ${packingOriginal.filas_contenedor},
      sacos_por_fila = ${packingOriginal.sacos_por_fila}, observaciones = ${v(packingOriginal.observaciones)} where id = ${PACKING}`);
  }
  if (reservaPacking) await consultar(`delete from reservas where id = ${reservaPacking.id}`);
  /* La auditoría de lo que se tocó y se devolvió: no debe ensuciar el historial de esas fichas. */
  const tocados = [
    pedido && `(tabla = 'pedidos' and registro_id::text = '${pedido.id}')`,
    cotizacionPrueba && `(tabla = 'cotizaciones' and registro_id::text = '${cotizacionPrueba}')`,
    packingOriginal && `(tabla = 'packing_lists' and registro_id::text = '${PACKING}')`,
    reservaPrueba && `(tabla = 'reservas' and registro_id::text = '${reservaPrueba.id}')`,
    reservaPacking && `(tabla = 'reservas' and registro_id::text = '${reservaPacking.id}')`,
  ].filter(Boolean);
  if (tocados.length) await consultar(`delete from auditoria where ocurrido_en > '${inicio}' and (${tocados.join(' or ')})`);
  await nav.close();
}

console.log(fallos.length ? `\n${fallos.length} FALLA(S):\n - ${fallos.join('\n - ')}` : '\nTodo en orden.');
process.exit(fallos.length ? 1 : 0);
