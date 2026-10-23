/**
 * ============================================================================
 *  PRUEBA · LIMITACIONES CONOCIDAS DE STOCK / INVENTARIOS (migración 069)
 * ============================================================================
 *  Lo que la Guía de uso señalaba como limitación del capítulo de Stock, y su
 *  arreglo, probado en el navegador y comprobado en la base:
 *
 *    1. Ajustes, mermas y muestras: pantalla nueva, reglas de rol, saldo,
 *       reservas, Kardex e historial.
 *    2. Nuevo traslado a mano, con el flujo de siempre (autorizar, despachar,
 *       recibir) y la base revisando cada línea.
 *    3. La recepción con diferencias dice exactamente qué falta o sobra y qué
 *       pasa con ello (y deja el aviso en Alertas y en el historial).
 *    4. La ficha del pallet avisa el bloqueo con los estados reales y «Libre
 *       para vender» descuenta lo bloqueado.
 *    5. Reservas: «Todos los estados» muestra todos los estados.
 *    6. Existencias: la nota al pie dice lo que hace la tabla.
 *    7. Valorizado: la tarjeta «+18 meses» y el filtro al que lleva son lo mismo.
 *
 *  Todo lo que se crea se borra al final (incluido el Kardex, con su
 *  disparador apagado un instante) y las existencias y reservas tocadas
 *  vuelven a su valor exacto.
 *
 *      BASE_URL=http://localhost:3010 node scripts/probar-stock-limitaciones.mjs
 * ============================================================================
 */
import { chromium } from 'playwright';
import { ejecutarSQL } from './db.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const CLAVE = process.env.CLAVE_DEMO ?? 'SantaMonica2026';
const consultar = async (sql) => { const r = await ejecutarSQL(sql); return Array.isArray(r) ? r : []; };
const intentar = async (sql) => { try { await ejecutarSQL(sql); return null; } catch (e) { return String(e.message); } };
const SEC = (n, t) => `\n${'─'.repeat(3)} ${n} · ${t} ${'─'.repeat(3)}`;
const fallos = [];
const ok = (cond, texto, detalle = '') => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${texto}${detalle ? ' · ' + detalle : ''}`);
  if (!cond) fallos.push(texto);
};
const numero = (t) => Number(String(t ?? '').replace(/[^\d.-]/g, ''));

/* ---- Lo que hay antes, para devolverlo todo ---- */
const [prev] = await consultar(`
  select (select coalesce(max(id),0) from movimientos) mov, (select coalesce(max(id),0) from eventos) ev,
         (select coalesce(max(id),0) from auditoria) au, (select coalesce(max(id),0) from alertas) al,
         (select coalesce(max(id),0) from traslados) tr, (select coalesce(max(id),0) from reservas) res,
         (select ultimo from correlativos where serie = 'TRAS' and anio = 2026) corr`);

/* Dos pallets libres de la misma bodega (la 2 tiene además un pallet bloqueado
   para probar que la base no deja trasladarlo). Sin reservas ni dictámenes. */
const libres = await consultar(`
  select v.lote_id, v.almacen_id, v.codigo_pallet, v.fisico_bultos, v.fisico_kg::numeric kg
    from v_stock_lote v
   where v.almacen_id = 2 and v.bloqueado_kg = 0 and v.reservado_kg = 0 and v.preparacion_kg = 0
     and v.solo_nacional_kg = 0 and v.fisico_bultos between 20 and 200
     and not exists (select 1 from reservas r where r.lote_id = v.lote_id and r.estado in ('activa','en_preparacion'))
     and not exists (select 1 from dictamenes_calidad d where d.lote_id = v.lote_id and d.vigente and d.estado <> 'liberado')
     and not exists (select 1 from traslado_lineas tl join traslados t on t.id = tl.traslado_id
                      where tl.lote_id = v.lote_id and t.estado in ('borrador','autorizado','en_transito'))
   order by v.lote_id desc offset 5 limit 2`);
const [A, B] = libres;
const [bloq] = await consultar(`select lote_id, codigo_pallet from v_stock_lote where almacen_id = 2 and bloqueado_kg > 0 limit 1`);
const LOTES = [A.lote_id, B.lote_id];
const snapExist = await consultar(`select * from existencias where lote_id in (${LOTES})`);
const [pl] = await consultar(`select pl.id, pl.pedido_id from pedido_lineas pl join pedidos p on p.id = pl.pedido_id
                               where p.ciclo = 'confirmado' and p.tipo_despacho = 'exportacion' order by pl.id limit 1`);
const [{ id: gerente }] = await consultar(`select id from usuarios where rol = 'gerencia' and activo limit 1`);
const uid = async (rol) => (await consultar(`select id from usuarios where rol = '${rol}' and activo limit 1`))[0].id;
const como = (u, sql) => intentar(`begin; select set_config('request.jwt.claims', '{"sub":"${u}","role":"authenticated"}', true); set local role authenticated; ${sql}; rollback;`);

const nav = await chromium.launch({ channel: 'chrome', headless: true });
const errores = [];
async function sesion(correo) {
  const ctx = await nav.newContext({ viewport: { width: 1500, height: 1000 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errores.push(`${correo}: ${e.message}`));
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', `${correo}@santamonica.pe`);
  await p.fill('input[type="password"]', CLAVE);
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/panel/, { timeout: 40000 });
  return p;
}
/* Con CAPTURAS=<carpeta> deja capturas de las pantallas nuevas para mirarlas. */
const captura = async (p, nombre) => {
  if (process.env.CAPTURAS) await p.screenshot({ path: `${process.env.CAPTURAS}/${nombre}.png`, fullPage: true });
};
const kpi = (p, etiqueta) => p.locator(`.kpi:has(.kpi-etiqueta:text-is("${etiqueta}")) .kpi-valor`).first().textContent();

let trasladoId = null;
let reservaPrueba = null;

try {
  console.log(`Pallets de prueba: ${A.codigo_pallet} (${A.fisico_bultos} b · ${A.kg} kg), ${B.codigo_pallet}; bloqueado: ${bloq?.codigo_pallet}`);
  const g = await sesion('gerencia');

  /* ======================================================================
     1 · AJUSTES, MERMAS Y MUESTRAS
     ====================================================================== */
  console.log(SEC(1, 'Ajustes, mermas y muestras'));
  {
    await g.goto(`${BASE}/almacenes/lotes/${A.lote_id}`, { waitUntil: 'networkidle' });
    ok(await g.locator('[data-accion="ajustar-stock"]').count() === 1, 'la ficha del pallet ofrece «Ajustar stock»');
    await g.click('[data-accion="ajustar-stock"]');
    await g.waitForURL(/\/almacenes\/ajustes\/nuevo\?lote=/);
    await g.locator('[data-formulario="ajuste"]').waitFor();
    ok((await g.locator('[data-bloque="pallet"]').innerText()).includes(A.codigo_pallet), 'el formulario llega con el pallet elegido');

    // Merma de 1 bulto con el peso por bulto real del pallet.
    const kgBulto = Math.round((Number(A.kg) / A.fisico_bultos) * 10) / 10;
    await g.check('input[name="tipo_ajuste"][value="salida_merma"]');
    await g.fill('input[name="bultos"]', String(A.fisico_bultos + 5));
    await g.fill('input[name="peso_kg"]', '10');
    ok(/negativo/.test(await g.locator('[data-formulario="ajuste"]').innerText()), 'avisa antes de guardar si el pallet quedaría en negativo');
    ok(await g.locator('[data-accion="registrar-ajuste"]').isDisabled(), 'y no deja registrarlo');
    await g.fill('input[name="bultos"]', '1');
    await g.fill('input[name="peso_kg"]', String(kgBulto));
    ok(/Falta: el motivo/.test(await g.locator('[data-pista="falta"]').innerText()), 'el botón apagado dice qué falta');
    await g.selectOption('select[name="motivo"]', { label: 'Mermado' });
    await g.fill('textarea[name="detalle"]', 'PRUEBA-STOCK: caja rota en la fila 3');
    ok(/Después: .*\d+ bultos/.test(await g.locator('[data-pista="queda"]').innerText()), 'dice cómo queda el pallet antes de guardar');
    await g.click('[data-accion="registrar-ajuste"]');
    await g.locator('[data-formulario="ajuste"] [role="status"]').waitFor({ timeout: 30000 });
    const msj = await g.locator('[data-formulario="ajuste"] [role="status"]').innerText();
    await captura(g, 'ajuste-merma');
    ok(/Merma MER-\d{6} registrada/.test(msj), 'registra la merma con su documento', msj.slice(0, 90));

    const [m] = await consultar(`select tipo::text, bultos, peso_neto_kg::numeric kg, documento_ref, observaciones, usuario_id, autorizado_por
                                   from movimientos where lote_id = ${A.lote_id} and id > ${prev.mov} order by id desc limit 1`);
    ok(m?.tipo === 'salida_merma' && m.bultos === 1, 'queda un movimiento NUEVO de merma en el Kardex', `${m?.documento_ref}`);
    ok(m?.autorizado_por === gerente, 'con quién lo autorizó (el motivo pide autorización)');
    const [e1] = await consultar(`select bultos, peso_neto_kg::numeric kg from existencias where lote_id = ${A.lote_id} and almacen_id = 2`);
    ok(e1.bultos === A.fisico_bultos - 1 && Math.abs(Number(e1.kg) - (Number(A.kg) - kgBulto)) < 0.01, 'las existencias bajan exactamente lo registrado');
    const [ev] = await consultar(`select descripcion from eventos where entidad = 'lotes' and entidad_id = ${A.lote_id} and tipo = 'stock_merma' and id > ${prev.ev}`);
    ok(/Mermado/.test(ev?.descripcion ?? ''), 'y queda en el historial del pallet', (ev?.descripcion ?? '').slice(0, 80));

    // Ajuste que suma solo de peso (0 bultos).
    await g.check('input[name="tipo_ajuste"][value="ajuste_positivo"]');
    await g.fill('input[name="bultos"]', '0');
    await g.fill('input[name="peso_kg"]', '2.5');
    await g.selectOption('select[name="motivo"]', { label: 'Diferencia de conteo físico' });
    await g.fill('textarea[name="detalle"]', 'PRUEBA-STOCK: el conteo dio 2,5 kg más');
    await g.click('[data-accion="registrar-ajuste"]');
    await g.waitForFunction(() => /Ajuste que suma AJU-/.test(document.querySelector('[data-formulario="ajuste"] [role="status"]')?.textContent ?? ''), null, { timeout: 30000 });
    const [m2] = await consultar(`select tipo::text, bultos from movimientos where lote_id = ${A.lote_id} and id > ${prev.mov} order by id desc limit 1`);
    ok(m2?.tipo === 'ajuste_positivo' && m2.bultos === 0, 'un ajuste puede ser solo de peso (0 bultos)');

    // Kilos reservados: no pasan sin confirmar.
    // Reservado casi todo el físico: restar un bulto se come kilos apartados.
    [reservaPrueba] = await consultar(`
      insert into reservas (pedido_linea_id, lote_id, almacen_id, bultos, peso_neto_kg, estado, creado_por, observaciones)
      select ${pl.id}, ${A.lote_id}, 2, 2, peso_neto_kg - 5, 'activa', '${gerente}', 'PRUEBA-STOCK reserva'
        from existencias where lote_id = ${A.lote_id} and almacen_id = 2
      returning id, peso_neto_kg`);
    await g.reload({ waitUntil: 'networkidle' });
    await g.check('input[name="tipo_ajuste"][value="ajuste_negativo"]');
    await g.fill('input[name="bultos"]', '1');
    await g.fill('input[name="peso_kg"]', String(kgBulto));
    await g.selectOption('select[name="motivo"]', { label: 'Diferencia de conteo físico' });
    await g.fill('textarea[name="detalle"]', 'PRUEBA-STOCK: falta un bulto en el conteo');
    await captura(g, 'ajuste-reservas');
    ok(await g.locator('[data-aviso="reservas"]').count() === 1, 'avisa que se tocan kilos reservados y para qué pedido');
    ok(await g.locator('[data-accion="registrar-ajuste"]').isDisabled(), 'sin confirmar, no deja registrar');
    await g.check('input[name="tocar_reservas"]');
    await g.click('[data-accion="registrar-ajuste"]');
    await g.waitForFunction(() => /Reservas reducidas/.test(document.querySelector('[data-formulario="ajuste"] [role="status"]')?.textContent ?? ''), null, { timeout: 30000 });
    const [r1] = await consultar(`select estado::text, peso_neto_kg::numeric kg from reservas where id = ${reservaPrueba.id}`);
    const [e2] = await consultar(`select peso_neto_kg::numeric kg from existencias where lote_id = ${A.lote_id} and almacen_id = 2`);
    ok(Number(r1.kg) <= Number(e2.kg) + 0.01 && Number(r1.kg) < Number(reservaPrueba.peso_neto_kg), 'confirmado, la reserva se reduce a lo que queda', `${reservaPrueba.peso_neto_kg} → ${r1.kg} kg (físico ${e2.kg})`);

    // La lista de ajustes los muestra.
    await g.goto(`${BASE}/almacenes/ajustes?buscar=${encodeURIComponent(A.codigo_pallet)}`, { waitUntil: 'networkidle' });
    const lista = await g.locator('#detalle').innerText();
    ok(/MER-\d{6}/.test(lista) && /AJU-\d{6}/.test(lista) && /PRUEBA-STOCK/.test(lista), 'Ajustes de stock lista los registros con su documento y explicación');

    // Roles en la base: Almacén no ajusta; Calidad sí saca muestras; Comercial nada.
    const alm = await uid('almacen'), cal = await uid('calidad'), com = await uid('comercial');
    const [mo] = await consultar(`select (select id from motivos where codigo='CONTEO_FISICO') cf, (select id from motivos where codigo='M_SGS') sgs, (select id from motivos where codigo='MERMADO') mer`);
    const e3 = await como(alm, `select stock_ajustar(${B.lote_id}, 2, 'ajuste_negativo', 1, 10, ${mo.cf}, 'PRUEBA-STOCK almacen')`);
    ok(/Gerencia u Operaciones/.test(e3 ?? ''), 'la base no deja a Almacén registrar un ajuste');
    const e4 = await como(alm, `select stock_ajustar(${B.lote_id}, 2, 'salida_merma', 1, 10, ${mo.mer}, 'PRUEBA-STOCK almacen')`);
    ok(/requiere autorización/.test(e4 ?? ''), 'ni una merma con un motivo que pide autorización');
    const e5 = await como(cal, `select stock_ajustar(${B.lote_id}, 2, 'salida_muestra', 0, 2, ${mo.sgs}, 'PRUEBA-STOCK muestra SGS')`);
    ok(e5 === null, 'Calidad sí registra una muestra (se prueba y se deshace)', e5 ?? '');
    const e6 = await como(com, `select stock_ajustar(${B.lote_id}, 2, 'salida_muestra', 0, 2, ${mo.sgs}, 'PRUEBA-STOCK muestra SGS')`);
    ok(/no puede/.test(e6 ?? ''), 'Comercial no registra nada');
    const e7 = await como(gerente, `select stock_ajustar(${B.lote_id}, 2, 'salida_muestra', 0, 2, ${mo.cf}, 'PRUEBA-STOCK muestra con motivo de ajuste')`);
    ok(/no corresponde/.test(e7 ?? ''), 'el motivo tiene que corresponder al tipo');

    // Almacén en pantalla: ajustes apagados, muestra permitida.
    const a = await sesion('almacen');
    await a.goto(`${BASE}/almacenes/ajustes/nuevo?lote=${B.lote_id}`, { waitUntil: 'networkidle' });
    ok(await a.locator('input[name="tipo_ajuste"][value="ajuste_positivo"]').isDisabled(), 'Almacén ve el ajuste apagado');
    ok(/Gerencia u Operaciones/.test(await a.locator('[data-bloque="tipo"]').innerText()), 'y dice por qué');
    ok(!(await a.locator('input[name="tipo_ajuste"][value="salida_muestra"]').isDisabled()), 'la muestra sí la puede registrar');
    await a.context().close();

    // Consulta no ve el botón ni entra al formulario.
    const c = await sesion('consulta');
    await c.goto(`${BASE}/almacenes/lotes/${A.lote_id}`, { waitUntil: 'networkidle' });
    ok(await c.locator('[data-accion="ajustar-stock"]').count() === 0, 'Consulta no ve «Ajustar stock»');
    await c.goto(`${BASE}/almacenes/ajustes/nuevo`, { waitUntil: 'networkidle' });
    ok(!c.url().includes('/nuevo'), 'ni entra al formulario');
    await c.context().close();
  }

  /* ======================================================================
     2 y 3 · NUEVO TRASLADO Y RECEPCIÓN CON DIFERENCIA
     ====================================================================== */
  console.log(SEC(2, 'Nuevo traslado a mano'));
  {
    await g.goto(`${BASE}/almacenes/traslados`, { waitUntil: 'networkidle' });
    ok(await g.locator('[data-accion="nuevo-traslado"]').count() === 1, 'la lista de traslados ofrece «Nuevo traslado»');
    await g.click('[data-accion="nuevo-traslado"]');
    await g.waitForURL(/\/almacenes\/traslados\/nuevo/);
    await g.selectOption('select[name="origen"]', '2');
    await g.locator('input[name="filtro_pallets"]').waitFor({ timeout: 30000 });
    const textoBodega = await g.locator('[data-formulario="traslado"]').innerText();
    ok(/bloqueados por Calidad/.test(textoBodega), 'dice cuántos pallets no se ofrecen por estar bloqueados');
    await g.fill('input[name="filtro_pallets"]', bloq.codigo_pallet);
    ok(await g.locator(`input[aria-label="Trasladar el pallet ${bloq.codigo_pallet}"]`).count() === 0, 'un pallet bloqueado por Calidad no se ofrece');
    await g.fill('input[name="filtro_pallets"]', B.codigo_pallet);
    await g.check(`input[aria-label="Trasladar el pallet ${B.codigo_pallet}"]`);
    const fila = g.locator(`tr:has(input[aria-label="Trasladar el pallet ${B.codigo_pallet}"])`);
    await fila.locator('input[type="number"]').first().fill('10');
    const destino = (await consultar(`select id from almacenes where activo and id <> 2 order by id limit 1`))[0].id;
    await g.selectOption('select[name="destino"]', String(destino));
    await g.fill('input[name="guia"]', 'EG07-PRUEBA01');
    await g.fill('input[name="filtro_pallets"]', '');
    await captura(g, 'traslado-nuevo');
    await g.click('[data-accion="crear-traslado"]');
    await g.waitForURL(/\/almacenes\/traslados\/\d+\?creado=1/, { timeout: 30000 });
    trasladoId = Number(g.url().match(/traslados\/(\d+)/)[1]);
    ok(await g.locator('[data-aviso="traslado-creado"]').count() === 1, 'crea el traslado en borrador y lo dice', `#${trasladoId}`);
    const [tl] = await consultar(`select t.estado::text, t.guia_numero, l.bultos_enviados, l.peso_enviado_kg::numeric kg
                                    from traslados t join traslado_lineas l on l.traslado_id = t.id where t.id = ${trasladoId}`);
    const kgEnviado = Number(tl.kg);
    ok(tl.estado === 'borrador' && tl.bultos_enviados === 10 && tl.guia_numero === 'EG07-PRUEBA01', 'en la base: borrador, 10 bultos y la guía', `${kgEnviado} kg`);

    // La base revisa cada línea, venga de donde venga.
    const errLinea = await intentar(`insert into traslado_lineas (traslado_id, lote_id, bultos_enviados, peso_enviado_kg)
                                      values (${trasladoId}, ${bloq.lote_id}, 1, 10)`);
    ok(/bloqueado por Calidad/.test(errLinea ?? ''), 'la base rechaza una línea con un pallet bloqueado');
    const errDemasiado = await intentar(`insert into traslado_lineas (traslado_id, lote_id, bultos_enviados, peso_enviado_kg)
                                         values (${trasladoId}, ${A.lote_id}, 99999, 10)`);
    ok(/hay .* bultos/.test(errDemasiado ?? ''), 'y una línea con más de lo que hay en el origen');
    const errRol = await como(await uid('consulta'), `select traslado_despachar(${trasladoId}, 'X')`);
    ok(/Solo Gerencia, Operaciones o Almacén/.test(errRol ?? ''), 'despachar comprueba el rol en la base');

    /*
     * Qué reservas viajan (regla acordada con Logística). Se prueba en la base,
     * dentro de transacciones que se deshacen: no deja rastro.
     *   · Traslado a mano de stock libre de un pallet con una reserva de otro
     *     pedido: la reserva se queda en el origen, y no deja sacar lo apartado.
     *   · Consolidación de un pallet apartado entero: la reserva viaja.
     */
    const [eb] = await consultar(`select bultos, peso_neto_kg::numeric kg from existencias where lote_id = ${B.lote_id} and almacen_id = 2`);
    const escenario = (consolida, bultos, kg, reservaKg) => `
      begin;
      insert into reservas (pedido_linea_id, lote_id, almacen_id, bultos, peso_neto_kg, estado, creado_por, observaciones)
        values (${pl.id}, ${B.lote_id}, 2, 1, ${reservaKg}, 'activa', '${gerente}', 'PRUEBA-STOCK-R');
      insert into traslados (numero, almacen_origen_id, almacen_destino_id, estado, creado_por, consolida_pedidos, guia_numero)
        values ('PRUEBA-STOCK-T', 2, ${destino}, 'borrador', '${gerente}', ${consolida ? `array[${pl.pedido_id}]::bigint[]` : 'null'}, 'EG07-PRUEBA02');
      insert into traslado_lineas (traslado_id, lote_id, bultos_enviados, peso_enviado_kg)
        select id, ${B.lote_id}, ${bultos}, ${kg} from traslados where numero = 'PRUEBA-STOCK-T';
      update traslados set estado = 'autorizado' where numero = 'PRUEBA-STOCK-T';
      select set_config('request.jwt.claims', '{"sub":"${gerente}","role":"authenticated"}', true);
      set local role authenticated;
      select traslado_despachar((select id from traslados where numero = 'PRUEBA-STOCK-T'), 'EG07-PRUEBA02');
      select traslado_aceptar((select id from traslados where numero = 'PRUEBA-STOCK-T'));
      select string_agg(almacen_id::text || ':' || peso_neto_kg::text, ',' order by almacen_id) donde
        from reservas where observaciones = 'PRUEBA-STOCK-R' or reasignada_desde in (select id from reservas where observaciones = 'PRUEBA-STOCK-R');`;
    const deshacer = async (sql) => { try { const r = await ejecutarSQL(sql + ' rollback;'); return { r }; } catch (e) { await intentar('rollback;'); return { error: String(e.message) }; } };
    const libreB = Number(eb.kg) - 100;
    const m1 = await deshacer(escenario(false, eb.bultos, Number(eb.kg), 100));
    ok(/se quedan allí/.test(m1.error ?? ''), 'un traslado a mano no puede llevarse lo apartado para otro pedido', (m1.error ?? '').slice(60, 200));
    const m2 = await deshacer(escenario(false, 5, Math.min(150, libreB), 100));
    ok(m2.r?.[0]?.donde === '2:100.000', 'traslado a mano de stock libre: la reserva del otro pedido se queda en el origen', m2.r?.[0]?.donde ?? m2.error);
    const m3 = await deshacer(escenario(true, eb.bultos, Number(eb.kg), Number(eb.kg)));
    ok(m3.r?.[0]?.donde === `${destino}:${Number(eb.kg).toFixed(3)}`, 'consolidación de un pallet apartado entero: la reserva viaja con él', m3.r?.[0]?.donde ?? m3.error);

    // Las tres firmas de siempre.
    await g.click('button:text-is("Autorizar")');
    await g.locator('button:text-is("Despachar")').waitFor({ timeout: 30000 });
    await g.click('button:text-is("Despachar")');
    ok(await g.locator('.traslado-panel input.campo').inputValue() === 'EG07-PRUEBA01', 'la guía escrita al crear viene puesta al despachar');
    await g.click('.traslado-panel button:text-is("Despachar")');
    await g.locator('button:text-is("Recibir en destino")').waitFor({ timeout: 30000 });

    console.log(SEC(3, 'Recepción con diferencia'));
    await g.click('button:text-is("Recibir en destino")');
    const filaRec = g.locator('.traslado-panel tbody tr').first();
    await filaRec.locator('input[type="number"]').nth(0).fill('9');
    await filaRec.locator('input[type="number"]').nth(1).fill(String(Math.round((kgEnviado - 12.5) * 10) / 10));
    ok(/Faltan 1/.test(await filaRec.innerText()) && /Faltan 12\.5 kg/.test(await filaRec.innerText()), 'en la fila: cuántos bultos y kilos faltan');
    await captura(g, 'traslado-recepcion');
    const resumen = await g.locator('[data-bloque="diferencia-recepcion"]').innerText();
    ok(/faltan 1 bulto · 12\.5 kg/.test(resumen), 'el resumen dice el faltante en bultos y kilos', resumen.slice(0, 80));
    ok(/No se escribe ningún ajuste/.test(resumen) && /deja de figurar en el inventario/.test(resumen), 'y qué pasa con él (no hay ajuste, sale del inventario)');
    await filaRec.locator('input:not([type="number"])').fill('PRUEBA-STOCK caja caída');
    await g.click('button:text-is("Confirmar recepción")');
    await g.waitForFunction(() => /Traslado aceptado con 1 diferencia/.test(document.body.innerText), null, { timeout: 30000 });
    ok(/faltan 12\.5 kg, 1 bulto menos/.test(await g.locator('body').innerText()), 'el mensaje al confirmar describe la diferencia');
    await g.reload({ waitUntil: 'networkidle' });
    await captura(g, 'traslado-cerrado');
    const aviso = await g.locator('[data-aviso="diferencia-traslado"]').innerText();
    ok(/faltaron 1 bulto · 12\.5 kg/.test(aviso) && /no se escribió\s+ningún ajuste/.test(aviso), 'la ficha cerrada dice el faltante y que no hay ajuste', aviso.slice(0, 90));
    ok(!/se registró como ajuste/.test(await g.locator('body').innerText()), 'ya no dice que se registró un ajuste');

    const kard = await consultar(`select tipo::text, peso_neto_kg::numeric kg from movimientos where documento_tipo = 'traslado' and documento_id = ${trasladoId} order by id`);
    ok(kard.length === 2 && Number(kard[0].kg) === kgEnviado && Math.abs(Number(kard[1].kg) - (kgEnviado - 12.5)) < 0.01,
      'Kardex: salida por lo enviado y entrada por lo recibido, nada más');
    const [al] = await consultar(`select titulo, severidad::text, mensaje from alertas where entidad = 'traslado' and entidad_id = ${trasladoId}`);
    ok(al?.titulo === 'Faltante al recibir un traslado' && al.severidad === 'critica', 'deja un aviso crítico en Alertas');
    const evs = await consultar(`select tipo from eventos where entidad = 'traslados' and entidad_id = ${trasladoId}`);
    ok(evs.some((e) => e.tipo === 'discrepancia_traslado') && evs.some((e) => e.tipo === 'traslado_despachado'), 'y lo anota en el historial DEL traslado (que la ficha sí lee)');
    ok(/Faltante: 12\.5 kg/.test(await g.locator('.linea-tiempo').innerText()), 'el historial de la ficha lo muestra');
  }

  /* ======================================================================
     4 · FICHA DEL PALLET: BLOQUEO Y LIBRE PARA VENDER
     ====================================================================== */
  console.log(SEC(4, 'Ficha del pallet bloqueado'));
  {
    const [d] = await consultar(`select d.estado::text from dictamenes_calidad d left join motivos m on m.id = d.motivo_id
                                  where d.lote_id = ${bloq.lote_id} and d.vigente and d.estado <> 'liberado' and not coalesce(m.condiciona_venta,false) limit 1`);
    await g.goto(`${BASE}/almacenes/lotes/${bloq.lote_id}`, { waitUntil: 'networkidle' });
    const av = await g.locator('[data-aviso="bloqueo-calidad"]').innerText().catch(() => '');
    ok(/por\s+Calidad/.test(av), `avisa el bloqueo de un pallet «${d?.estado}»`, av.slice(0, 80));
    await captura(g, 'lote-bloqueado');
    ok(numero(await kpi(g, 'Libre para vender')) === 0, '«Libre para vender» descuenta lo bloqueado (0)');
    const [sn] = await consultar(`select lote_id from v_stock_lote where solo_nacional_kg > 0 and bloqueado_kg = 0 limit 1`);
    if (sn) {
      await g.goto(`${BASE}/almacenes/lotes/${sn.lote_id}`, { waitUntil: 'networkidle' });
      ok(await g.locator('[data-aviso="solo-nacional"]').count() === 1 && await g.locator('[data-aviso="bloqueo-calidad"]').count() === 0,
        'un pallet «solo mercado nacional» no sale como bloqueado: sale con su condición');
    }
  }

  /* ======================================================================
     5 · RESERVAS: «TODOS LOS ESTADOS»
     ====================================================================== */
  console.log(SEC(5, 'Reservas: todos los estados'));
  {
    const [n] = await consultar(`select count(*)::int total, count(*) filter (where estado = 'activa')::int activas from reservas`);
    await g.goto(`${BASE}/almacenes/reservas`, { waitUntil: 'networkidle' });
    const titulo = await g.locator('#lista .panel-titulo').first().innerText().catch(() => '');
    ok(numero(titulo) === n.activas, 'al entrar muestra las activas', titulo);
    await g.locator('#lista label:has-text("Estado") select').selectOption('todos');
    await g.waitForURL(/estado=todos/, { timeout: 20000 });
    await g.waitForLoadState('networkidle');
    const [n2] = await consultar(`select count(*)::int total from reservas`);
    const titulo2 = await g.locator('#lista .panel-titulo').first().innerText().catch(() => '');
    ok(numero(titulo2) === n2.total, '«Todos los estados» muestra todas las reservas', `${titulo2} / ${n2.total}`);
  }

  /* ======================================================================
     6 · EXISTENCIAS: LA NOTA AL PIE
     ====================================================================== */
  console.log(SEC(6, 'Existencias: la nota al pie'));
  {
    await g.goto(`${BASE}/almacenes/existencias`, { waitUntil: 'networkidle' });
    const nota = await g.locator('[data-nota="existencias"]').innerText();
    ok(/abren la ficha del lote/.test(nota) && /físico − bloqueado por Calidad − reservado/.test(nota), 'la nota dice qué abre el código y qué es el disponible');
    ok(!/se abre la trazabilidad completa/.test(await g.locator('body').innerText()), 'ya no promete que el código abre la trazabilidad');
    await g.locator('table.datos a.enlace-ficha').first().click();
    await g.waitForURL(/\/almacenes\/lotes\/\d+/, { timeout: 20000 });
    ok(true, 'y el código de pallet, en efecto, abre la ficha del lote');
  }

  /* ======================================================================
     7 · VALORIZADO: LA TARJETA «+18 MESES» Y SU FILTRO
     ====================================================================== */
  console.log(SEC(7, 'Valorizado: +18 meses'));
  {
    const [v] = await consultar(`select round(sum(valor))::bigint valor, count(*)::int n from v_anticuamiento where fisico_kg > 0 and rango in ('18-24','>24')`);
    await g.goto(`${BASE}/almacenes/valorizado`, { waitUntil: 'networkidle' });
    const tarjeta = numero(await kpi(g, 'Capital en producto de +18 meses'));
    ok(Math.abs(tarjeta - Number(v.valor)) <= 2, 'la tarjeta suma 18-24 y más de 24', `${tarjeta} / ${v.valor}`);
    await g.locator('.kpi:has(.kpi-etiqueta:text-is("Capital en producto de +18 meses"))').click();
    await g.waitForURL(/rango=18%2B/, { timeout: 20000 });
    await g.waitForLoadState('networkidle');
    const filtrado = numero(await kpi(g, 'Valor de lo filtrado'));
    ok(Math.abs(filtrado - tarjeta) <= 2, 'al hacer clic, lo filtrado vale exactamente lo que decía la tarjeta', `${filtrado}`);
    ok(/18 meses o más/.test(await g.locator('#detalle select').nth(1).locator('option:checked').innerText()), 'y el filtro Antigüedad dice «18 meses o más»');
    const titulo = await g.locator('#detalle').innerText();
    ok(titulo.toLowerCase().includes(`${v.n.toLocaleString('es-PE')} posiciones`), 'el detalle trae esas mismas posiciones', `${v.n}`);
    const r = await g.evaluate(async () => {
      const x = await fetch('/api/reportes/valorizado?rango=18%2B');
      return { estado: x.status, filas: x.headers.get('X-Filas') };
    });
    ok(r.estado === 200 && Number(r.filas) === v.n, 'el Excel con ese filtro trae las mismas filas', `${r.filas}`);
    // Y el Excel completo ya no se corta en mil filas (la API pagina).
    const [{ total }] = await consultar(`select count(*)::int total from v_anticuamiento where fisico_kg > 0`);
    const todo = await g.evaluate(async () => (await fetch('/api/reportes/valorizado')).headers.get('X-Filas'));
    ok(Math.abs(Number(todo) - total) <= 2 && Number(todo) > 1000, 'el Excel sin filtros trae todas las posiciones, no solo mil', `${todo} / ${total}`);
  }

  ok(errores.length === 0, 'sin errores de JavaScript en las pantallas', errores.slice(0, 2).join(' | '));
} catch (e) {
  ok(false, 'la prueba terminó sin excepciones', String(e.message).slice(0, 300));
  // Lo que la pantalla decía en ese momento, para saber por qué.
  for (const pg of nav.contexts().flatMap((c) => c.pages())) {
    const avisos = await pg.locator('[role="alert"]').allInnerTexts().catch(() => []);
    if (avisos.length) console.log('   avisos en pantalla:', avisos.join(' | ').slice(0, 400));
  }
} finally {
  /* ---- Todo a su sitio ---- */
  try {
    const misTraslados = (await consultar(`select id from traslados where id > ${prev.tr} and (guia_numero = 'EG07-PRUEBA01' or id = ${trasladoId ?? 0})`)).map((t) => t.id);
    const misMov = (await consultar(`select id from movimientos where id > ${prev.mov} and lote_id in (${LOTES})`)).map((m) => m.id);
    const misRes = (await consultar(`select id from reservas where id > ${prev.res} and lote_id in (${LOTES})`)).map((r) => r.id);
    await ejecutarSQL(`
      alter table movimientos disable trigger trg_kardex_no_delete;
      ${misMov.length ? `delete from movimientos where id in (${misMov});` : ''}
      alter table movimientos enable trigger trg_kardex_no_delete;
      ${misTraslados.length ? `delete from alertas where entidad = 'traslado' and entidad_id in (${misTraslados}) and id > ${prev.al};
        delete from eventos where entidad in ('traslados','traslado') and entidad_id in (${misTraslados}) and id > ${prev.ev};
        delete from traslados where id in (${misTraslados});` : ''}
      ${misRes.length ? `delete from eventos where entidad = 'reservas' and entidad_id in (${misRes}) and id > ${prev.ev};
        delete from reservas where id in (${misRes});` : ''}
      delete from eventos where entidad = 'lotes' and entidad_id in (${LOTES}) and id > ${prev.ev};
      delete from existencias where lote_id in (${LOTES});
      ${snapExist.map((e) => `insert into existencias (lote_id, almacen_id, camara_id, bultos, peso_neto_kg, costo_promedio, actualizado_en)
        values (${e.lote_id}, ${e.almacen_id}, ${e.camara_id ?? 'null'}, ${e.bultos}, ${e.peso_neto_kg}, ${e.costo_promedio}, '${e.actualizado_en}');`).join('\n')}
      delete from auditoria where id > ${prev.au} and (
        (tabla = 'movimientos' and registro_id = any(array[${misMov.map((x) => `'${x}'`).join(',') || "''"}]))
        or (tabla in ('traslados') and registro_id = any(array[${misTraslados.map((x) => `'${x}'`).join(',') || "''"}]))
        or (tabla = 'traslado_lineas' and (datos_despues->>'traslado_id' = any(array[${misTraslados.map((x) => `'${x}'`).join(',') || "''"}])
                                         or datos_antes->>'traslado_id' = any(array[${misTraslados.map((x) => `'${x}'`).join(',') || "''"}])))
        or (tabla = 'reservas' and registro_id = any(array[${misRes.map((x) => `'${x}'`).join(',') || "''"}])));
      -- Red de seguridad: avisos e historial que apunten a un traslado que ya no existe.
      delete from alertas where id > ${prev.al} and entidad = 'traslado' and entidad_id not in (select id from traslados);
      delete from eventos where id > ${prev.ev} and entidad in ('traslados','traslado') and entidad_id not in (select id from traslados);
      update correlativos set ultimo = ${prev.corr} where serie = 'TRAS' and anio = 2026 and ultimo = ${Number(prev.corr) + 1};
    `);
    const [{ n }] = await consultar(`select count(*)::int n from movimientos where id > ${prev.mov} and lote_id in (${LOTES})`);
    const ahora = await consultar(`select * from existencias where lote_id in (${LOTES}) order by lote_id, almacen_id`);
    const igual = JSON.stringify(ahora.map((e) => [e.lote_id, e.almacen_id, e.bultos, e.peso_neto_kg, e.costo_promedio])) ===
      JSON.stringify([...snapExist].sort((a, b) => a.lote_id - b.lote_id || a.almacen_id - b.almacen_id).map((e) => [e.lote_id, e.almacen_id, e.bultos, e.peso_neto_kg, e.costo_promedio]));
    ok(n === 0 && igual, 'limpieza: Kardex, existencias, reservas, traslado, avisos e historial como estaban');
  } catch (e) {
    ok(false, 'limpieza', String(e.message).slice(0, 300));
    await intentar('alter table movimientos enable trigger trg_kardex_no_delete;');
  }
  await nav.close();
}

console.log(fallos.length ? `\n${fallos.length} FALLO(S):\n - ${fallos.join('\n - ')}` : '\nTodo correcto');
process.exit(fallos.length ? 1 : 0);
