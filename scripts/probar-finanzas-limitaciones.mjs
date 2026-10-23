/**
 * ============================================================================
 *  PRUEBA · LIMITACIONES DE FINANZAS Y HERRAMIENTAS (migración 070)
 * ============================================================================
 *  Lo que la Guía de uso dejó escrito como «limitación conocida» y ya no lo es:
 *
 *    1. Registrar un cobro, anular un cobro mal registrado (070b) y anular un
 *       comprobante desde su ficha.
 *    2. El estado de la factura se calcula (saldo y vencimiento en Lima).
 *    3. Los anulados se ven en la lista con el filtro de estado.
 *    4. La búsqueda del Retiro sanitario se queda en el Retiro.
 *    5. El buscador universal lleva a la ficha real del producto.
 *    6. Las reglas de alerta cambian algo al encenderlas y apagarlas, y un
 *       mismo pallet no sale en dos reglas (070b).
 *    7. Gerencia crea, desactiva y cambia el rol de un usuario; la persona
 *       entra con su contraseña temporal y el sistema le obliga a cambiarla.
 *    8. Roles coherentes: Operaciones ve Facturación y Cobrar; Consulta baja
 *       el reporte de Cuentas por cobrar.
 *    9. Cada reporte de la pantalla Reportes se descarga también en PDF.
 *   10. Ningún texto manda a «Configuración → Módulos».
 *
 *  Todo lo que se crea o se cambia se devuelve como estaba al final, incluida
 *  la auditoría y los eventos de lo que se tocó.
 *
 *      BASE_URL=http://localhost:3010 node scripts/probar-finanzas-limitaciones.mjs
 * ============================================================================
 */
import { chromium } from 'playwright';
import { readFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { ejecutarSQL } from './db.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const CLAVE = process.env.CLAVE_DEMO ?? 'SantaMonica2026';
const CAPTURAS = process.env.CAPTURAS ?? 'capturas/finanzas-070';
mkdirSync(CAPTURAS, { recursive: true });

const consultar = async (sql) => { const r = await ejecutarSQL(sql); return Array.isArray(r) ? r : []; };
const SEC = (n, t) => `\n${'─'.repeat(3)} ${n} · ${t} ${'─'.repeat(3)}`;
const fallos = [];
const ok = (cond, texto, detalle = '') => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${texto}${detalle ? ' · ' + detalle : ''}`);
  if (!cond) fallos.push(texto);
};
const captura = (p, nombre) => p.screenshot({ path: join(CAPTURAS, `${nombre}.png`), fullPage: true });

/* Cliente de Supabase con la clave anónima, como el navegador. */
const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const clienteComo = async (correo, clave = CLAVE) => {
  const c = createClient(URL_SB, ANON, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email: correo, password: clave });
  if (error) throw new Error(`No entra ${correo}: ${error.message}`);
  return c;
};

const [{ inicio }] = await consultar(`select now()::text as inicio`);
const nav = await chromium.launch({ channel: 'chrome', headless: true });

async function entrar(correo, clave = CLAVE) {
  const ctx = await nav.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('dialog', (d) => d.accept());
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', correo);
  await p.fill('input[type="password"]', clave);
  await p.click('button[type="submit"]');
  return p;
}
async function entrarAlPanel(correo) {
  const p = await entrar(correo);
  await p.waitForURL(/\/panel/, { timeout: 30000 });
  return p;
}
const leerMenu = (p) => p.locator('nav.barra a.barra-enlace').evaluateAll((as) => as.map((a) => a.getAttribute('href')));

/* Lo que hay que devolver a su sitio al terminar. */
let factura = null;          // la factura de prueba, con su estado original
let pedidoOriginal = null;
let alertasRegla7 = null;    // ids abiertos de la regla 7 antes de tocarla
let usuarioPrueba = null;    // id del usuario creado
const CORREO_PRUEBA = `prueba.f70.${Date.now()}@santamonica.pe`;

try {
  /* =====================================================================
     2 · EL ESTADO SE CALCULA
     ===================================================================== */
  console.log(SEC(2, 'El estado de la factura se calcula, en hora de Lima'));
  {
    const [f] = await consultar(`
      select estado_factura_al_dia('emitida', 100, 0, (now() at time zone 'America/Lima')::date)::text hoy,
             estado_factura_al_dia('emitida', 100, 0, (now() at time zone 'America/Lima')::date - 1)::text ayer,
             estado_factura_al_dia('emitida', 100, 40, (now() at time zone 'America/Lima')::date + 5)::text parcial,
             estado_factura_al_dia('vencida', 100, 100, (now() at time zone 'America/Lima')::date - 9)::text pagada,
             estado_factura_al_dia('anulada', 100, 0, (now() at time zone 'America/Lima')::date - 9)::text anulada`);
    ok(f.hoy === 'emitida', 'vence hoy (Lima) y sin pagos: emitida', f.hoy);
    ok(f.ayer === 'vencida', 'venció ayer con saldo: vencida', f.ayer);
    ok(f.parcial === 'parcialmente_cobrada', 'con un pago y sin vencer: parcialmente cobrada', f.parcial);
    ok(f.pagada === 'cobrada', 'saldo cero: cobrada aunque estuviera vencida', f.pagada);
    ok(f.anulada === 'anulada', 'una anulada sigue anulada', f.anulada);

    const [d] = await consultar(`
      select count(*)::int n from facturas f
       cross join lateral (select coalesce(sum(monto),0) c from cobranzas where factura_id = f.id) cb
       where f.estado is distinct from estado_factura_al_dia(f.estado, f.total, cb.c, f.fecha_vencimiento)`);
    ok(d.n === 0, 'ninguna factura tiene guardado un estado distinto del real', `${d.n} desfasadas`);
    const [v] = await consultar(`
      select count(*)::int n from v_cuentas_cobrar v join facturas f on f.id = v.id where v.estado <> f.estado`);
    ok(v.n === 0, 'la vista de cuentas por cobrar y la tabla dicen lo mismo');
    const [j] = await consultar(`select count(*)::int n from cron.job where jobname = 'actualizar_estado_facturas'`);
    ok(j.n === 1, 'y cada noche (00:05 de Lima) se pone al día solo');
  }

  /* Factura de prueba: con saldo, sin cobros y con pedido. */
  [factura] = await consultar(`
    select f.id, f.numero, f.estado::text estado, f.pedido_id, f.moneda::text moneda, v.saldo::float saldo
      from facturas f join v_comprobantes v on v.id = f.id
     where v.cobrado = 0 and v.saldo > 1000 and f.pedido_id is not null and f.moneda = 'USD'
     order by f.id desc limit 1`);
  ok(!!factura, 'hay una factura con saldo y sin cobros para probar', factura?.numero);
  [pedidoOriginal] = await consultar(`select id, situacion::text situacion from pedidos where id = ${factura.pedido_id}`);

  /* =====================================================================
     1 · REGISTRAR UN COBRO
     ===================================================================== */
  console.log(SEC(1, 'Registrar un cobro desde la ficha'));
  {
    const p = await entrarAlPanel('gerencia@santamonica.pe');
    await p.goto(`${BASE}/finanzas/facturas/${factura.id}`, { waitUntil: 'networkidle' });
    const boton = p.locator('[data-accion="registrar-cobro"]');
    ok(await boton.isEnabled(), 'Gerencia ve «Registrar cobro» habilitado');
    await boton.click();
    await p.fill('[data-bloque="registrar-cobro"] input[name="monto"]', String(factura.saldo + 500));
    ok(await p.locator('[data-accion="guardar-cobro"]').isDisabled(), 'un monto mayor que el saldo no se puede guardar');
    ok(await p.locator('[data-bloque="registrar-cobro"] [role="alert"]').count() > 0, 'y lo explica en pantalla');

    const parcial = Math.round(factura.saldo * 0.4 * 100) / 100;
    await p.fill('[data-bloque="registrar-cobro"] input[name="monto"]', String(parcial));
    await p.selectOption('[data-bloque="registrar-cobro"] select[name="medio"]', 'Transferencia');
    await p.fill('[data-bloque="registrar-cobro"] input[name="referencia"]', 'PRUEBA-F70');
    await captura(p, '01-registrar-cobro');
    await p.click('[data-accion="guardar-cobro"]');
    await p.locator('.cobro-barra [role="status"]').waitFor({ timeout: 20000 });
    const textoOk = await p.locator('.cobro-barra [role="status"]').innerText();
    ok(/Cobro registrado/.test(textoOk), 'confirma el cobro y el saldo que queda', textoOk.slice(0, 90));

    const [c] = await consultar(`select count(*)::int n, sum(monto)::float m from cobranzas where factura_id = ${factura.id} and referencia = 'PRUEBA-F70'`);
    ok(c.n === 1 && Math.abs(c.m - parcial) < 0.01, 'el cobro queda en la base con su monto');
    const [e] = await consultar(`
      select f.estado::text guardado, v.estado::text calculado from facturas f join v_comprobantes v on v.id = f.id where f.id = ${factura.id}`);
    ok(e.guardado === e.calculado && ['vencida', 'parcialmente_cobrada'].includes(e.guardado),
      'el estado de la factura se recalculó solo con el cobro', e.guardado);
    const [ev] = await consultar(`select count(*)::int n from eventos where entidad = 'facturas' and entidad_id = ${factura.id} and tipo = 'cobranza_registrada' and ocurrido_en > '${inicio}'`);
    ok(ev.n === 1, 'y queda en el historial de la factura');
    await p.reload({ waitUntil: 'networkidle' });
    ok(await p.locator('#cobros').innerText().then((t) => t.includes('PRUEBA-F70')), 'el cobro aparece en «Cobros registrados»');
    await captura(p, '02-ficha-con-cobro');

    /* La base también lo impone, aunque se salte la pantalla. */
    const g = await clienteComo('gerencia@santamonica.pe');
    const [{ hoy }] = await consultar(`select (now() at time zone 'America/Lima')::date::text hoy`);
    const exceso = await g.rpc('registrar_cobranza', {
      p_factura_id: factura.id, p_monto: factura.saldo, p_fecha: hoy, p_medio: 'Transferencia',
    });
    ok(!!exceso.error && /le quedan/.test(exceso.error.message), 'la base rechaza cobrar más que el saldo', exceso.error?.message?.slice(0, 70));
    const directo = await g.from('cobranzas').insert({ factura_id: factura.id, monto: factura.saldo * 2, fecha: '2026-10-01' }).select('id');
    ok(!!directo.error, 'y también un insert directo que se pase del saldo');
    const futuro = await g.rpc('registrar_cobranza', {
      p_factura_id: factura.id, p_monto: 1, p_fecha: '2099-01-01', p_medio: 'Efectivo',
    });
    ok(!!futuro.error && /posterior a hoy/.test(futuro.error.message), 'no acepta una fecha futura');

    /* Con cobros no se anula: el botón lo dice. */
    const anular = p.locator('[data-accion="anular-comprobante"]');
    ok(await anular.isDisabled(), 'con cobros, «Anular comprobante» está apagado');
    ok(/cobros registrados/i.test(await anular.getAttribute('title') ?? ''), 'y explica por qué');

    /* Comercial ve la ficha pero no cobra; el botón lo dice. */
    const pc = await entrarAlPanel('comercial@santamonica.pe');
    await pc.goto(`${BASE}/finanzas/facturas/${factura.id}`, { waitUntil: 'networkidle' });
    ok(await pc.locator('[data-accion="registrar-cobro"]').isDisabled(), 'Comercial ve «Registrar cobro» apagado');
    ok(/Gerencia y Operaciones/.test(await pc.locator('[data-motivo="cobro"]').innerText()), 'con el motivo escrito');
    const comercialRpc = await (await clienteComo('comercial@santamonica.pe')).rpc('registrar_cobranza', {
      p_factura_id: factura.id, p_monto: 1, p_fecha: '2026-10-01', p_medio: 'Efectivo',
    });
    ok(!!comercialRpc.error, 'y la base tampoco le deja');
    await pc.context().close();

    /* =====================================================================
       1a · ANULAR EL COBRO MAL REGISTRADO (070b)
       ===================================================================== */
    console.log(SEC('1a', 'Anular un cobro mal registrado'));
    const [cobro] = await consultar(`select id from cobranzas where factura_id = ${factura.id} and referencia = 'PRUEBA-F70'`);
    const filaCobro = p.locator(`tr[data-cobro="${cobro.id}"]`);
    await filaCobro.locator('[data-accion="anular-cobro"]').click();
    await filaCobro.locator('textarea[name="motivo_cobro"]').fill('corto');
    ok(await filaCobro.locator('[data-accion="confirmar-anular-cobro"]').isDisabled(), 'sin motivo suficiente no deja anular el cobro');
    await filaCobro.locator('textarea[name="motivo_cobro"]').fill('Prueba F70: monto digitado en la factura equivocada');
    await captura(p, '02b-anular-cobro');
    await filaCobro.locator('[data-accion="confirmar-anular-cobro"]').click();
    await p.locator(`tr[data-cobro="${cobro.id}"][data-anulado="si"]`).waitFor({ timeout: 20000 });
    ok(true, 'el cobro queda en la tabla marcado como anulado');
    ok(/Anulado/i.test(await p.locator(`tr[data-cobro="${cobro.id}"]`).innerText()) && /equivocada/.test(await p.locator(`tr[data-cobro-motivo="${cobro.id}"]`).innerText()), 'con su etiqueta y su motivo');
    await captura(p, '02c-cobro-anulado');
    const [ca] = await consultar(`select anulada, anulada_por is not null quien, anulada_en is not null cuando, motivo_anulacion m from cobranzas where id = ${cobro.id}`);
    ok(ca.anulada && ca.quien && ca.cuando && /equivocada/.test(ca.m), 'en la base: anulado, con quién, cuándo y motivo (no se borró)');
    const [e2] = await consultar(`select f.estado::text e, v.saldo::float saldo from facturas f join v_cuentas_cobrar v on v.id = f.id where f.id = ${factura.id}`);
    ok(e2.e === factura.estado && Math.abs(e2.saldo - factura.saldo) < 0.01, 'deja de contar: el saldo y el estado vuelven solos', `${e2.e} · ${e2.saldo}`);
    const [evc] = await consultar(`select count(*)::int n from eventos where entidad = 'facturas' and entidad_id = ${factura.id} and tipo = 'cobranza_anulada' and ocurrido_en > '${inicio}'`);
    ok(evc.n === 1, 'y queda en el historial de la factura');
    const [tf] = await consultar(`select count(*)::int n from v_tiempos_flujo where pedido_id = ${factura.pedido_id} and f_cobro is not null`);
    ok(tf.n === 0, 'los tiempos del flujo no cuentan el cobro anulado como fecha de cobro');
    {
      const pp = await p.context().newPage();
      await pp.goto(`${BASE}/ventas/pedidos/${factura.pedido_id}?t=cobranza`, { waitUntil: 'networkidle' });
      ok(!(await pp.locator('main').innerText()).includes('PRUEBA-F70'), 'la pestaña Cobranza del pedido no muestra el cobro anulado');
      await pp.close();
    }
    const reactivarCobro = await g.from('cobranzas').update({ anulada: false }).eq('id', cobro.id).select('id');
    ok(!!reactivarCobro.error, 'un cobro anulado no se reactiva ni con un update directo');
    const otraVez = await g.rpc('anular_cobranza', { p_cobranza_id: cobro.id, p_motivo: 'segunda vez sobre el mismo' });
    ok(!!otraVez.error, 'ni se anula dos veces');
    const comercialAnula = await (await clienteComo('comercial@santamonica.pe')).rpc('anular_cobranza', { p_cobranza_id: cobro.id, p_motivo: 'Comercial intenta anular' });
    ok(!!comercialAnula.error, 'Comercial no puede anular cobros (la base lo rechaza)');

    /* =====================================================================
       1b · ANULAR
       ===================================================================== */
    console.log(SEC('1b', 'Anular un comprobante con motivo'));
    await p.reload({ waitUntil: 'networkidle' });
    ok(await anular.isEnabled(), 'sin cobros, «Anular comprobante» se habilita');
    await anular.click();
    await p.fill('[data-bloque="anular"] textarea[name="motivo"]', 'corto');
    ok(await p.locator('[data-accion="confirmar-anulacion"]').isDisabled(), 'con un motivo corto no deja confirmar');
    await p.fill('[data-bloque="anular"] textarea[name="motivo"]', 'Prueba automática F70: precio mal digitado');
    await captura(p, '03-anular');
    await p.click('[data-accion="confirmar-anulacion"]');
    await p.locator('.ficha-aviso-critico strong', { hasText: 'Factura anulada' }).waitFor({ timeout: 20000 });
    const [a] = await consultar(`select estado::text e, motivo_anulacion m, anulada_por is not null quien from facturas where id = ${factura.id}`);
    ok(a.e === 'anulada' && /precio mal digitado/.test(a.m) && a.quien, 'queda anulada, con motivo y con quién la anuló');
    const [pe] = await consultar(`select situacion::text s from pedidos where id = ${factura.pedido_id}`);
    ok(pe.s === 'sin_facturar', 'el pedido queda libre para emitirle otro comprobante', pe.s);
    ok(await p.locator('[data-accion="anular-comprobante"]').count() === 0, 'un anulado ya no ofrece anular');
    ok(await p.locator('[data-accion="registrar-cobro"]').isDisabled(), 'ni admite cobros');
    await captura(p, '04-ficha-anulada');

    const g2 = await clienteComo('gerencia@santamonica.pe');
    const reactivar = await g2.from('facturas').update({ estado: 'emitida' }).eq('id', factura.id).select('id');
    ok(!!reactivar.error && /no se reactiva/.test(reactivar.error.message), 'un anulado no se «desanula» ni con un update directo');
    const editar = await g2.from('facturas').update({ total: 1 }).eq('id', factura.id).select('id');
    ok(!!editar.error, 'y un comprobante no se edita');

    /* =====================================================================
       3 · LOS ANULADOS EN LA LISTA
       ===================================================================== */
    console.log(SEC(3, 'Los anulados se ven con el filtro de estado'));
    const filas = async (url) => {
      await p.goto(`${BASE}${url}`, { waitUntil: 'networkidle' });
      return p.locator('table.datos tbody tr').allInnerTexts();
    };
    const porDefecto = await filas(`/finanzas/facturas?buscar=${encodeURIComponent(factura.numero)}`);
    ok(!porDefecto.some((t) => t.includes(factura.numero)), 'por defecto la lista no muestra el anulado');
    const anuladas = await filas(`/finanzas/facturas?estado=anulada`);
    ok(anuladas.some((t) => t.includes(factura.numero) && /Anulada/i.test(t)), 'con Estado «Anulada» aparece');
    await captura(p, '05-lista-anuladas');
    const todas = await filas(`/finanzas/facturas?estado=todas&buscar=${encodeURIComponent(factura.numero)}`);
    ok(todas.some((t) => t.includes(factura.numero)), 'y con «Todas, incluidas las anuladas» también');
    const vencidas = await filas(`/finanzas/facturas?estado=vencida`);
    ok(vencidas.length > 0 && vencidas.every((t) => /Vencida/i.test(t)), 'el filtro «Vencida» usa el estado calculado', `${vencidas.length} filas`);
    await p.context().close();
  }

  /* Se devuelve la factura a como estaba (como Sistema: el guardián deja pasar). */
  await consultar(`update facturas set estado = '${factura.estado}', anulada_por = null, anulada_en = null, motivo_anulacion = null where id = ${factura.id}`);
  await consultar(`update pedidos set situacion = '${pedidoOriginal.situacion}' where id = ${pedidoOriginal.id}`);

  /* =====================================================================
     4 · RETIRO SANITARIO
     ===================================================================== */
  console.log(SEC(4, 'La búsqueda del Retiro se queda en el Retiro'));
  {
    const [l] = await consultar(`select codigo_pallet from lotes where codigo_pallet is not null order by id desc limit 1`);
    const p = await entrarAlPanel('calidad@santamonica.pe');
    await p.goto(`${BASE}/trazabilidad/retiro`, { waitUntil: 'networkidle' });
    await p.fill('form.buscador-traza input[type="search"]', l.codigo_pallet);
    await p.click('form.buscador-traza button[type="submit"]');
    await p.waitForURL(/\/trazabilidad\/retiro\?q=/, { timeout: 20000 });
    await p.waitForLoadState('networkidle');
    ok(new URL(p.url()).pathname === '/trazabilidad/retiro', 'sigue en el Retiro sanitario', p.url().replace(BASE, ''));
    ok(await p.getByText('Ya despachado').count() > 0, 'y calcula el alcance del lote');
    await captura(p, '06-retiro-busqueda');
    await p.fill('form.buscador-traza input[type="search"]', 'ZZZ-NO-EXISTE');
    await p.click('form.buscador-traza button[type="submit"]');
    await p.waitForURL(/ZZZ-NO-EXISTE/, { timeout: 20000 });
    await p.waitForLoadState('networkidle');
    ok(await p.getByText('Ningún lote coincide').count() > 0, 'un código sin lotes lo dice, sin salir de la pantalla');
    await p.context().close();
  }

  /* =====================================================================
     5 · BUSCADOR → FICHA DEL PRODUCTO
     ===================================================================== */
  console.log(SEC(5, 'El buscador lleva a la ficha real del producto'));
  {
    // Un código que el buscador devuelva como Producto (los códigos cortos
    // también coinciden con decenas de pallets y llenan los 60 resultados).
    const [s] = await consultar(`
      select s.codigo from skus s
       where exists (select 1 from sku_presentaciones sp where sp.sku_id = s.id)
         and exists (select 1 from buscar_universal(s.codigo) b where b.tipo = 'Producto')
       order by length(s.codigo) desc, s.id limit 1`);
    const p = await entrarAlPanel('consulta@santamonica.pe');
    await p.goto(`${BASE}/trazabilidad?q=${encodeURIComponent(s.codigo)}`, { waitUntil: 'networkidle' });
    const fila = p.locator('table.datos tbody tr', { hasText: 'Producto' }).first();
    const href = await fila.locator('a', { hasText: 'Abrir' }).getAttribute('href');
    ok(/^\/ventas\/productos\/\d+$/.test(href ?? ''), 'el enlace apunta a /ventas/productos/<id>', href);
    const r = await p.goto(`${BASE}${href}`, { waitUntil: 'networkidle' });
    ok((r?.status() ?? 0) === 200 && !/no encontr/i.test(await p.title()), 'y la ficha abre', `HTTP ${r?.status()}`);
    const [m] = await consultar(`select count(*)::int n from buscar_universal('${s.codigo}') where ruta like '/almacenes/productos%'`);
    ok(m.n === 0, 'ningún resultado apunta ya a /almacenes/productos');
    await p.context().close();
  }

  /* =====================================================================
     6 · REGLAS
     ===================================================================== */
  console.log(SEC(6, 'Las reglas de alerta tienen efecto'));
  {
    const ev = await consultar(`select r.id, r.nombre, e.medible, e.abiertas from reglas r left join reglas_evaluacion e on e.regla_id = r.id order by r.id`);
    ok(ev.every((r) => r.medible === true), 'el evaluador sabe medir las 7 reglas', ev.map((r) => `${r.id}:${r.abiertas}`).join(' '));
    const [dup] = await consultar(`
      select count(*)::int n from alertas a join alertas b on b.entidad_id = a.entidad_id
       where a.regla_id = 1 and b.regla_id = 2 and not a.atendida and not b.atendida`);
    ok(dup.n === 0, 'ningún pallet sale a la vez en «12 meses» y en «vida útil» (070b)');
    const [cubiertos] = await consultar(`
      select count(*)::int n from (select lote_id from v_anticuamiento where fisico_kg > 0 group by lote_id having max(meses_almacenado) >= 12) l
       where not exists (select 1 from alertas a where a.entidad_id = l.lote_id and a.regla_id in (1, 2) and (not a.atendida or a.atendida_por is not null))`);
    ok(cubiertos.n === 0, 'y todo pallet de 12 meses o más está en una de las dos');
    alertasRegla7 = await consultar(`select id, datos from alertas where regla_id = 7 and not atendida`);
    const [t] = await consultar(`select count(*)::int n from traslados where estado = 'en_transito' and (now() at time zone 'America/Lima')::date - (coalesce(despachado_en, creado_en) at time zone 'America/Lima')::date >= 5`);
    ok(alertasRegla7.length === t.n, 'la regla de traslados tiene una alerta por traslado detenido', `${alertasRegla7.length} = ${t.n}`);

    const p = await entrarAlPanel('operaciones@santamonica.pe');
    await p.goto(`${BASE}/configuracion?t=reglas`, { waitUntil: 'networkidle' });
    const fila = p.locator('tr', { hasText: 'Traslado detenido en tránsito' });
    await fila.locator('button[role="switch"]').click();
    await fila.locator('.interruptor-hecho').waitFor({ timeout: 20000 });
    const msg = await fila.locator('.interruptor-hecho').innerText();
    const [abiertas] = await consultar(`select count(*)::int n from alertas where regla_id = 7 and not atendida`);
    ok(abiertas.n === 0, 'al apagarla se cierran sus alertas abiertas', msg);
    await captura(p, '07-regla-apagada');
    await fila.locator('button[role="switch"]').click();
    await p.waitForFunction(() => /Regla activada/.test(document.body.innerText), null, { timeout: 20000 });
    const [otra] = await consultar(`select count(*)::int n from alertas where regla_id = 7 and not atendida`);
    ok(otra.n === t.n, 'al encenderla vuelven a abrirse', `${otra.n}`);
    await p.context().close();
  }

  /* =====================================================================
     7 · USUARIOS
     ===================================================================== */
  console.log(SEC(7, 'Gerencia administra los usuarios'));
  {
    const p = await entrarAlPanel('gerencia@santamonica.pe');
    await p.goto(`${BASE}/configuracion?t=usuarios`, { waitUntil: 'networkidle' });
    const propio = p.locator('tr[data-usuario="gerencia@santamonica.pe"]');
    ok(await propio.locator('select[data-control="rol"]').isDisabled(), 'Gerencia no puede quitarse a sí misma el rol (selector apagado)');
    ok(await propio.locator('[data-accion="desactivar-usuario"]').isDisabled(), 'ni desactivarse');

    await p.click('[data-accion="nuevo-usuario"]');
    await p.fill('.usuarios-form input[name="nombre"]', 'Persona de Prueba F70');
    await p.fill('.usuarios-form input[name="email"]', CORREO_PRUEBA);
    await p.selectOption('.usuarios-form select[name="rol"]', 'consulta');
    await captura(p, '08-nuevo-usuario');
    await p.click('[data-accion="crear-usuario"]');
    await p.locator('[data-clave-temporal]').waitFor({ timeout: 20000 });
    const temporal = (await p.locator('[data-clave-temporal]').innerText()).trim();
    ok(temporal.length >= 8, 'se crea y muestra la contraseña temporal una vez');
    await captura(p, '09-usuario-creado');
    const [u] = await consultar(`select id, rol::text rol, activo, debe_cambiar_clave from usuarios where email = '${CORREO_PRUEBA}'`);
    usuarioPrueba = u?.id;
    ok(u && u.rol === 'consulta' && u.activo && u.debe_cambiar_clave, 'su ficha queda activa, con rol y obligada a cambiar la contraseña');

    /* La persona entra con la temporal y el sistema la lleva a cambiarla. */
    const n = await entrar(CORREO_PRUEBA, temporal);
    await n.waitForURL(/\/(panel|cuenta\/clave)/, { timeout: 30000 });
    await n.goto(`${BASE}/panel`, { waitUntil: 'networkidle' });
    ok(new URL(n.url()).pathname === '/cuenta/clave', 'con la temporal, cualquier pantalla la lleva a «Cambiar mi contraseña»', n.url().replace(BASE, ''));
    await captura(n, '10-cambiar-clave');
    await n.fill('input[name="actual"]', temporal);
    await n.fill('input[name="nueva"]', 'NuevaClave2026');
    await n.fill('input[name="repetida"]', 'NuevaClave2026');
    await n.click('[data-accion="guardar-clave"]');
    await n.waitForURL(/\/panel/, { timeout: 30000 });
    ok(true, 'cambia la contraseña y entra al panel');
    const [u2] = await consultar(`select debe_cambiar_clave from usuarios where id = '${usuarioPrueba}'`);
    ok(u2.debe_cambiar_clave === false, 'ya no se le pide cambiarla');
    const menuNuevo = await leerMenu(n);
    ok(!menuNuevo.includes('/configuracion'), 'como Consulta, no ve Configuración');
    await n.context().close();

    /* Cambio de rol desde la tabla. */
    await p.reload({ waitUntil: 'networkidle' });
    const fila = p.locator(`tr[data-usuario="${CORREO_PRUEBA}"]`);
    await fila.locator('select[data-control="rol"]').selectOption('comex');
    await fila.locator('.rol-ok').waitFor({ timeout: 20000 });
    const [u3] = await consultar(`select rol::text rol from usuarios where id = '${usuarioPrueba}'`);
    ok(u3.rol === 'comex', 'Gerencia le cambia el rol', u3.rol);

    /* Desactivar: no puede entrar y no aparece en las listas de selección. */
    await fila.locator('[data-accion="desactivar-usuario"]').click();
    await p.waitForFunction((c) => {
      const tr = document.querySelector(`tr[data-usuario="${c}"]`);
      return tr && /Inactivo/i.test(tr.textContent ?? '');
    }, CORREO_PRUEBA, { timeout: 20000 });
    const [u4] = await consultar(`select u.activo, a.banned_until is not null baneado from usuarios u join auth.users a on a.id = u.id where u.id = '${usuarioPrueba}'`);
    ok(u4.activo === false && u4.baneado, 'queda inactivo y bloqueado en la cuenta de acceso');
    await captura(p, '11-usuario-desactivado');
    const d = await entrar(CORREO_PRUEBA, 'NuevaClave2026');
    await d.locator('.acceso-error').waitFor({ timeout: 20000 });
    const errorAcceso = await d.locator('.acceso-error').innerText();
    ok(/desactivada/.test(errorAcceso), 'al intentar entrar, le dice que su cuenta está desactivada', errorAcceso.slice(0, 60));
    await d.context().close();
    const [lista] = await consultar(`select count(*)::int n from usuarios where activo and id = '${usuarioPrueba}'`);
    ok(lista.n === 0, 'y no sale en las listas que filtran activos (supervisores, responsables)');

    /* Operaciones ve la pestaña, pero los controles están apagados. */
    const o = await entrarAlPanel('operaciones@santamonica.pe');
    await o.goto(`${BASE}/configuracion?t=usuarios`, { waitUntil: 'networkidle' });
    ok(await o.locator('[data-accion="nuevo-usuario"]').isDisabled(), 'Operaciones ve «Nuevo usuario» apagado');
    ok(await o.getByText('Solo Gerencia da de alta usuarios').count() > 0, 'con el motivo');
    const oc = await (await clienteComo('operaciones@santamonica.pe')).rpc('usuario_cambiar_estado', { p_id: usuarioPrueba, p_activo: true });
    ok(!!oc.error, 'y la base no le deja reactivar a nadie');
    await o.context().close();
    await p.context().close();
  }

  /* =====================================================================
     8 · ROLES COHERENTES
     ===================================================================== */
  console.log(SEC(8, 'Menú, ruta y acción dicen lo mismo'));
  {
    const o = await entrarAlPanel('operaciones@santamonica.pe');
    const menu = await leerMenu(o);
    ok(menu.includes('/finanzas/facturas') && menu.includes('/finanzas/cobrar'), 'Operaciones tiene Facturación y Cuentas por cobrar en el menú');
    const r1 = await o.goto(`${BASE}/finanzas/cobrar`, { waitUntil: 'networkidle' });
    ok((r1?.status() ?? 0) === 200 && new URL(o.url()).pathname === '/finanzas/cobrar', 'y la pantalla abre');
    await captura(o, '12-cobrar-operaciones');
    await o.goto(`${BASE}/finanzas/facturas/${factura.id}`, { waitUntil: 'networkidle' });
    ok(await o.locator('[data-accion="registrar-cobro"]').isEnabled(), 'Operaciones puede registrar cobros');
    const [pol] = await consultar(`select qual from pg_policies where tablename = 'facturas' and policyname = 'escritura_finanzas'`);
    ok(/operaciones/.test(pol.qual), 'la política de facturas deja emitir a Operaciones (tenía el botón y fallaba)');
    await o.context().close();

    const c = await entrarAlPanel('consulta@santamonica.pe');
    const rc = await c.request.get(`${BASE}/api/reportes/cuentas_cobrar`);
    ok(rc.status() === 200 && /spreadsheetml/.test(rc.headers()['content-type'] ?? ''), 'Consulta descarga el Excel de Cuentas por cobrar', `HTTP ${rc.status()}`);
    const rv = await c.request.get(`${BASE}/api/reportes/valorizado`);
    ok(rv.status() === 403, 'pero sigue sin bajar los reportes con costos');
    await c.goto(`${BASE}/reportes`, { waitUntil: 'networkidle' });
    ok(await c.locator('[data-reporte="cuentas_cobrar"] button', { hasText: 'Excel' }).count() === 1, 'en Reportes tiene el botón de Cuentas por cobrar');
    await c.goto(`${BASE}/finanzas/facturas/${factura.id}`, { waitUntil: 'networkidle' });
    ok(await c.locator('[data-accion="registrar-cobro"]').isDisabled(), 'Consulta ve «Registrar cobro» apagado');
    await c.context().close();

    const al = await entrarAlPanel('almacen@santamonica.pe');
    const ra = await al.request.get(`${BASE}/api/reportes/cuentas_cobrar`);
    ok(ra.status() === 403, 'Almacén, que no ve la pantalla, tampoco baja su reporte');
    await al.context().close();
  }

  /* =====================================================================
     9 · REPORTES EN PDF
     ===================================================================== */
  console.log(SEC(9, 'Cada reporte de la pantalla se baja también en PDF'));
  {
    const p = await entrarAlPanel('gerencia@santamonica.pe');
    await p.goto(`${BASE}/reportes`, { waitUntil: 'networkidle' });
    const claves = await p.locator('[data-reporte]').evaluateAll((ts) => ts.map((t) => t.getAttribute('data-reporte')));
    ok(claves.length === 11, 'la pantalla tiene los 11 reportes', claves.join(', '));
    const conPdf = await p.locator('[data-reporte] button', { hasText: 'PDF' }).count();
    ok(conPdf === claves.length, 'cada tarjeta tiene su botón PDF', `${conPdf}`);
    await captura(p, '13-reportes');
    const malos = [];
    for (const k of claves) {
      const r = await p.request.get(`${BASE}/api/reportes/${k}?formato=pdf`, { timeout: 240000 });
      const cuerpo = await r.body();
      if (r.status() !== 200 || !/pdf/.test(r.headers()['content-type'] ?? '') || cuerpo.subarray(0, 4).toString() !== '%PDF') {
        malos.push(`${k}:${r.status()}`);
      }
    }
    ok(malos.length === 0, 'los 11 PDF se generan', malos.join(' '));

    /* Y el botón de la pantalla descarga de verdad. */
    const [descarga] = await Promise.all([
      p.waitForEvent('download', { timeout: 60000 }),
      p.locator('[data-reporte="cuentas_cobrar"] button', { hasText: 'PDF' }).click(),
    ]);
    ok(/SantaMonica_cuentas_cobrar_.*\.pdf$/.test(descarga.suggestedFilename()), 'el botón PDF baja el archivo', descarga.suggestedFilename());
    await descarga.saveAs(join(CAPTURAS, 'cuentas_cobrar.pdf'));
    await p.context().close();
  }

  /* =====================================================================
     10 · TEXTO DE AYUDA
     ===================================================================== */
  console.log(SEC(10, 'Ningún texto manda a «Configuración → Módulos»'));
  {
    const hallados = [];
    const recorrer = (d) => {
      for (const n of readdirSync(d)) {
        const r = join(d, n);
        if (statSync(r).isDirectory()) recorrer(r);
        else if (/\.(tsx?|css)$/.test(n) && /Configuración\s*(›|→|>|->)\s*Módulos/.test(readFileSync(r, 'utf8'))) hallados.push(r);
      }
    };
    recorrer('src');
    ok(hallados.length === 0, 'no queda ninguno en src/', hallados.join(', '));
  }
} catch (e) {
  console.log(' FALLA', e.message);
  fallos.push(e.message);
} finally {
  /* ---- Todo vuelve a como estaba ---- */
  if (factura) {
    await consultar(`delete from cobranzas where factura_id = ${factura.id} and referencia = 'PRUEBA-F70'`);
    await consultar(`select facturas_actualizar_estados()`);
    await consultar(`update facturas set estado = '${factura.estado}', anulada_por = null, anulada_en = null, motivo_anulacion = null where id = ${factura.id}`);
    await consultar(`delete from eventos where ocurrido_en > '${inicio}' and ((entidad = 'facturas' and entidad_id = ${factura.id}) or (entidad = 'pedidos' and entidad_id = ${factura.pedido_id}))`);
    await consultar(`delete from auditoria where ocurrido_en > '${inicio}' and (
      (tabla = 'facturas' and registro_id::text = '${factura.id}')
      or (tabla = 'cobranzas' and 'PRUEBA-F70' in (datos_antes->>'referencia', datos_despues->>'referencia'))
      or (tabla = 'pedidos' and registro_id::text = '${factura.pedido_id}'))`);
  }
  if (pedidoOriginal) await consultar(`update pedidos set situacion = '${pedidoOriginal.situacion}' where id = ${pedidoOriginal.id}`);
  if (alertasRegla7) {
    await consultar(`update reglas set activa = true where id = 7`);
    await consultar(`delete from alertas where regla_id = 7 and generada_en > '${inicio}'`);
    if (alertasRegla7.length) {
      await consultar(`update alertas set atendida = false, atendida_en = null, datos = datos - 'cerrada_por' where id in (${alertasRegla7.map((a) => a.id).join(',')})`);
    }
    await consultar(`select count(*) from reglas_evaluar(7)`);
    await consultar(`delete from auditoria where ocurrido_en > '${inicio}' and tabla = 'reglas'`);
  }
  const [u] = await consultar(`select id from usuarios where email = '${CORREO_PRUEBA}'`);
  const idUsuario = usuarioPrueba ?? u?.id;
  if (idUsuario) {
    await consultar(`delete from eventos where entidad = 'usuarios' and metadatos->>'usuario_id' = '${idUsuario}'`);
    await consultar(`delete from auditoria where tabla = 'usuarios' and registro_id::text = '${idUsuario}'`);
    await consultar(`delete from auth.users where id = '${idUsuario}'`);
  }
  await consultar(`delete from eventos where entidad = 'reportes' and ocurrido_en > '${inicio}' and descripcion like '%exportado en PDF por Marco%'`);
  const [rastro] = await consultar(`select
      (select count(*) from cobranzas where referencia = 'PRUEBA-F70')::int cobros,
      (select count(*) from auth.users where email = '${CORREO_PRUEBA}')::int usuarios,
      (select count(*) from facturas where motivo_anulacion like 'Prueba automática F70%')::int anuladas`);
  ok(rastro.cobros === 0 && rastro.usuarios === 0 && rastro.anuladas === 0, 'no quedó rastro en la base');
  await nav.close();
}

console.log(fallos.length ? `\n${fallos.length} FALLA(S):\n - ${fallos.join('\n - ')}` : '\nTodo en orden.');
process.exit(fallos.length ? 1 : 0);
