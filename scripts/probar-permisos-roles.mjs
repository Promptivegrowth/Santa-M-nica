/**
 * ============================================================================
 *  PRUEBA · PERMISOS Y VISTAS POR ROL (ronda «pedidos de Oliver», migración 076)
 * ============================================================================
 *  Entra con cada rol afectado y mira, en el navegador, lo que ve y lo que no;
 *  hace las acciones permitidas (Almacén aparta y libera su propia reserva) y
 *  comprueba que las no permitidas se rechazan en español, también en la base.
 *
 *    1. Almacén aparta stock; la base lo deja (y a Comercio Exterior no).
 *    2. Liberar: la reserva ajena se ve apagada, con su porqué; icono nuevo.
 *    3. Sin importes para Almacén y Calidad (panel, productos, reportes);
 *       Comercio Exterior no ve la línea de crédito.
 *    4. PDF / Excel / Contrato apagados; enlaces a pantallas que el rol no
 *       tiene, fuera; Buscador → despacho; aviso de ?sinacceso=.
 *    5. Cotizaciones: papelera de una vencida; no se aprueba vencida; tipo de
 *       cambio con el valor de SUNAT.
 *    6. Clientes: ?cliente= filtra la cartera; crédito y bloqueo apagados
 *       para Comercial; la base lo exige.
 *    7. Facturación solo de un pedido confirmado; vista previa en dd/mm/aaaa
 *       y debajo de los botones.
 *    8. Un corte de red en un formulario: aviso en el formulario, sin perder
 *       lo escrito (accionSegura).
 *
 *  La base es la de producción: lo único que se crea es la reserva de
 *  Almacén (con la marca «PRUEBA-076») y se borra al final con sus eventos y
 *  su auditoría. Las pruebas de la base van dentro de transacciones que se
 *  deshacen.
 *
 *      BASE_URL=http://localhost:3010 node scripts/probar-permisos-roles.mjs
 * ============================================================================
 */
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import { ejecutarSQL } from './db.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const CLAVE = process.env.CLAVE_DEMO ?? '';
const CAPTURAS = process.env.CAPTURAS ?? null;
const consultar = async (sql) => { const r = await ejecutarSQL(sql); return Array.isArray(r) ? r : []; };
const SEC = (n, t) => `\n${'─'.repeat(3)} ${n} · ${t} ${'─'.repeat(3)}`;
const fallos = [];
let aciertos = 0;
const ok = (cond, texto, detalle = '') => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${texto}${detalle ? ' · ' + detalle : ''}`);
  if (cond) aciertos += 1; else fallos.push(texto);
};

/** Ejecuta SQL «como» un usuario (rol authenticated + su id), en una transacción que se deshace. */
async function comoUsuario(uid, sql) {
  try {
    const r = await ejecutarSQL(
      `begin; set local role authenticated; ` +
      `select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true); ` +
      `${sql}; rollback;`
    );
    return { ok: true, r };
  } catch (e) {
    return { ok: false, mensaje: String(e.message) };
  }
}

const [{ inicio }] = await consultar(`select now()::text as inicio`);
const usuarios = Object.fromEntries((await consultar(
  `select rol::text, id from usuarios where email like '%@santamonica.pe' and activo`
)).map((u) => [u.rol, u.id]));

const nav = await chromium.launch({ channel: 'chrome', headless: true });
const contextos = {};

/** Una pestaña con la sesión del rol (se reutiliza). */
async function como(rol) {
  if (contextos[rol]) return contextos[rol];
  const ctx = await nav.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', `${rol}@santamonica.pe`);
  await p.fill('input[type="password"]', CLAVE);
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/panel/, { timeout: 45000 });
  contextos[rol] = p;
  return p;
}
const ir = async (p, ruta) => { await p.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle', timeout: 90000 }); };
const captura = async (p, nombre) => { if (CAPTURAS) await p.screenshot({ path: `${CAPTURAS}/${nombre}.png`, fullPage: false }); };

/** Encabezados de la primera fila con datos de un Excel bajado con la sesión de la página. */
async function encabezadosExcel(p, ruta) {
  const r = await p.request.get(`${BASE}${ruta}`);
  if (!r.ok()) return { status: r.status(), cabeceras: [] };
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(await r.body());
  const hoja = libro.worksheets[0];
  const todas = [];
  hoja.eachRow((fila) => todas.push(fila.values.filter((v) => v !== undefined && v !== null).map(String)));
  return { status: r.status(), cabeceras: todas.flat() };
}

let reservaCreada = null;
let pedidoDeLaReserva = null;

try {
  /* ════════════════════ 1 · ALMACÉN APARTA ════════════════════ */
  console.log(SEC(1, 'Almacén aparta stock (una sola lista para apartar)'));
  {
    const [caso] = await consultar(`
      select * from (
        select pl.id linea, p.id pedido, p.numero_proforma,
               pl.cantidad_tm * 1000 - coalesce((select sum(peso_neto_kg) from reservas r
                 where r.pedido_linea_id = pl.id and r.estado in ('activa','en_preparacion','consumida')), 0) falta,
               (select sum(disponible_kg) from v_stock_lote v where v.sku_presentacion_id = pl.sku_presentacion_id
                 and v.disponible_kg > 0 and (p.tipo_despacho = 'mercado_nacional' or v.solo_nacional_kg = 0)) disp
          from pedidos p join pedido_lineas pl on pl.pedido_id = p.id
         where p.ciclo = 'confirmado' and p.situacion not in ('facturado','parcialmente_cobrado','cobrado')
      ) x where falta > 600 and disp > 600 order by pedido limit 1`);
    ok(!!caso, 'hay un pedido confirmado con una línea por cubrir y stock libre', caso?.numero_proforma);
    [pedidoDeLaReserva] = await consultar(`select id, cobertura::text, actualizado_en::text from pedidos where id = ${caso.pedido}`);

    const p = await como('almacen');
    await ir(p, `/ventas/pedidos/${caso.pedido}?t=disponibilidad`);
    const boton = p.locator(`tr[data-linea="${caso.linea}"] button`, { hasText: 'Apartar stock' });
    ok(await boton.count() === 1, 'Almacén ve «Apartar stock» en la línea');
    await boton.click();
    await p.locator('.reservar table.datos tbody tr').first().waitFor({ timeout: 30000 });
    await p.locator('.reservar table.datos tbody tr').first().locator('button', { hasText: 'Elegir' }).click();
    await p.locator('.reservar-confirma input.campo').fill('300');
    await p.locator('button', { hasText: /^Apartar$/ }).click();
    await p.locator('.reservar-mensaje').first().waitFor({ timeout: 30000 });
    const texto = await p.locator('.reservar-mensaje').first().innerText();
    ok(/Apartados 300 kg/.test(texto), 'Almacén aparta 300 kg y lo dice en español', texto.slice(0, 90));
    ok(!/row-level|violates|policy/i.test(texto), 'sin mensaje técnico de la base');
    [reservaCreada] = await consultar(`
      select id, creado_por from reservas where pedido_linea_id = ${caso.linea} and creado_por = '${usuarios.almacen}'
         and creado_en > '${inicio}' order by id desc limit 1`);
    ok(!!reservaCreada, 'la reserva quedó en la base, a nombre de Almacén');
    if (reservaCreada) await consultar(`update reservas set observaciones = 'PRUEBA-076 · almacén aparta' where id = ${reservaCreada.id}`);

    // La base: Almacén inserta; Comercio Exterior y Calidad no (antes era al revés con Comex).
    const [lin] = await consultar(`select pl.id, (select lote_id from v_stock_lote v where v.sku_presentacion_id = pl.sku_presentacion_id and v.disponible_kg > 100 limit 1) lote,
                                          (select almacen_id from v_stock_lote v where v.sku_presentacion_id = pl.sku_presentacion_id and v.disponible_kg > 100 limit 1) alm
                                     from pedido_lineas pl where pl.id = ${caso.linea}`);
    const insertar = `insert into reservas (pedido_linea_id, lote_id, almacen_id, bultos, peso_neto_kg, estado, creado_por)
                      values (${lin.id}, ${lin.lote}, ${lin.alm}, 1, 10, 'activa', auth.uid())`;
    const a = await comoUsuario(usuarios.almacen, insertar);
    ok(a.ok, 'la base deja apartar a Almacén (política reservas_apartar)', a.mensaje?.slice(0, 120));
    const c = await comoUsuario(usuarios.comex, insertar);
    ok(!c.ok && /row-level security/i.test(c.mensaje), 'la base ya no deja apartar a Comercio Exterior (misma lista que pantalla y servidor)');
    const q = await comoUsuario(usuarios.calidad, insertar);
    ok(!q.ok, 'ni a Calidad');
    const u = await comoUsuario(usuarios.comercial, `update reservas set estado = 'liberada' where id = ${reservaCreada?.id ?? 0} returning id`);
    //  Sin filas actualizadas, la API devuelve el resultado anterior (el set_config): no trae «id».
    ok(u.ok && !JSON.stringify(u.r).includes('"id"'), 'Comercial no puede soltar a mano una reserva en la tabla (solo por reserva_liberar)');

    // Comex no ve el botón.
    const pc = await como('comex');
    await ir(pc, `/ventas/pedidos/${caso.pedido}?t=disponibilidad`);
    ok(await pc.locator('button', { hasText: 'Apartar stock' }).count() === 0, 'Comercio Exterior no ve «Apartar stock»');
  }

  /* ════════════════════ 2 · LIBERAR ════════════════════ */
  console.log(SEC(2, 'Liberar: la reserva ajena, apagada y explicada'));
  {
    const pc = await como('comercial');
    await ir(pc, `/almacenes/reservas?id=${reservaCreada.id}`);
    const btn = pc.locator('button[data-accion="liberar"]');
    ok(await btn.count() === 1 && await btn.isDisabled(), 'Comercial ve apagado «Liberar» en la reserva que apartó Almacén');
    const titulo = await btn.getAttribute('title');
    ok(/otra persona: solo Gerencia u Operaciones/.test(titulo ?? ''), 'y el porqué al pasar el ratón', titulo ?? '');
    const forma = await btn.locator('svg rect').count();
    ok(forma === 1, 'el icono es el candado abierto, no la flecha de «ingresos»');
    await captura(pc, 'reservas-ajena-comercial');

    const pa = await como('almacen');
    await ir(pa, `/almacenes/reservas?id=${reservaCreada.id}`);
    const suyo = pa.locator('button[data-accion="liberar"]');
    ok(await suyo.count() === 1 && !(await suyo.isDisabled()), 'Almacén tiene encendido «Liberar» en su propia reserva');
    await suyo.click();
    await pa.fill('textarea[aria-label="Motivo de la liberación"]', 'PRUEBA-076: Almacén suelta su propia reserva');
    await pa.click('button:has-text("Liberar stock")');
    await pa.waitForTimeout(2500);
    const [r] = await consultar(`select estado::text from reservas where id = ${reservaCreada.id}`);
    ok(r.estado === 'liberada', 'Almacén libera la suya: queda liberada en la base', r.estado);

    // Una ajena vieja: activa y de otra persona, vista por Almacén.
    const [ajena] = await consultar(`select id from reservas where estado = 'activa' and creado_por is distinct from '${usuarios.almacen}' order by id desc limit 1`);
    if (ajena) {
      await ir(pa, `/almacenes/reservas?id=${ajena.id}`);
      const b = pa.locator('button[data-accion="liberar"]');
      ok(await b.count() === 1 && await b.isDisabled(), 'Almacén ve apagada una reserva que apartó otro');
    }
    const pg = await como('gerencia');
    if (ajena) {
      await ir(pg, `/almacenes/reservas?id=${ajena.id}`);
      const b = pg.locator('button[data-accion="liberar"]');
      ok(await b.count() === 1 && !(await b.isDisabled()), 'Gerencia la tiene encendida (la base le deja)');
    }
  }

  /* ════════════════════ 3 · SIN IMPORTES ════════════════════ */
  console.log(SEC(3, 'Importes solo para quien ve precios'));
  {
    for (const rol of ['almacen', 'calidad']) {
      const p = await como(rol);
      await ir(p, '/panel');
      //  textContent y no innerText: las etiquetas van en mayúsculas por CSS.
      const kpis = await p.locator('.rejilla-kpi').first().textContent();
      const nivel2 = await p.locator('.rejilla-3').first().textContent();
      ok(!/US\$|\$\s?\d/.test(kpis + nivel2), `${rol}: el Control Tower no enseña dólares`);
      ok(/Comprometido en pedidos/.test(kpis) && /TM sin stock completo/.test(nivel2), `${rol}: ve toneladas y cantidad de pedidos`);
      await ir(p, '/ventas/productos');
      const t = await p.locator('main').textContent();
      ok(!/Último precio/.test(t) && !/Con precio de venta/.test(t), `${rol}: Productos sin «Último precio» ni «Con precio de venta»`);
    }
    const pg = await como('gerencia');
    await ir(pg, '/panel');
    ok(/Venta comprometida/.test(await pg.locator('main').textContent()), 'Gerencia sigue viendo «Venta comprometida» en dólares');
    await ir(pg, '/ventas/productos');
    ok(/Último precio/.test(await pg.locator('main').textContent()), 'y el «Último precio» en Productos');

    // Ficha del cliente: la línea de crédito, solo Gerencia, Operaciones y Comercial.
    const [cli] = await consultar(`select id from clientes where linea_credito > 0 and activo order by id limit 1`);
    const px = await como('comex');
    await ir(px, `/ventas/clientes/${cli.id}`);
    ok(await px.locator('[data-campo="linea-credito"]').count() === 0, 'Comercio Exterior no ve la línea de crédito en la ficha del cliente');
    await ir(pg, `/ventas/clientes/${cli.id}`);
    ok(await pg.locator('[data-campo="linea-credito"]').count() === 1, 'Gerencia sí');

    // Reportes: el archivo sin la columna de importes.
    const pq = await como('calidad');
    const ant = await encabezadosExcel(pq, '/api/reportes/anticuamiento?formato=excel');
    ok(ant.status === 200 && ant.cabeceras.includes('Físico (kg)') && !ant.cabeceras.includes('Valor'), 'Calidad baja Anticuamiento sin la columna Valor', `HTTP ${ant.status}`);
    const ped = await encabezadosExcel(pq, '/api/reportes/pedidos?formato=excel');
    ok(ped.status === 200 && ped.cabeceras.includes('TM pedidas') && !ped.cabeceras.includes('Venta US$'), 'y «Pedidos y su avance» sin Venta US$');
    const pcons = await como('consulta');
    const ped2 = await encabezadosExcel(pcons, '/api/reportes/pedidos?formato=excel');
    ok(ped2.status === 200 && !ped2.cabeceras.includes('Venta US$'), 'Consulta, igual');
    const ped3 = await encabezadosExcel(pg, '/api/reportes/pedidos?formato=excel');
    ok(ped3.cabeceras.includes('Venta US$'), 'Gerencia lo baja con Venta US$');
  }

  /* ════════════════════ 4 · BOTONES Y ENLACES ════════════════════ */
  console.log(SEC(4, 'Botones que fallaban y enlaces a pantallas que el rol no tiene'));
  {
    const [ped] = await consultar(`select id from pedidos where ciclo = 'confirmado' order by id desc limit 1`);
    const [cot] = await consultar(`select id from cotizaciones order by id desc limit 1`);
    for (const rol of ['calidad', 'almacen', 'consulta']) {
      const p = await como(rol);
      await ir(p, `/ventas/pedidos/${ped.id}`);
      const apagados = await p.locator('.cab-pagina-acciones [data-apagado="si"]').count();
      ok(apagados === 3, `${rol}: PDF, Excel y Contrato del pedido, apagados`, `${apagados}`);
      const titulo = await p.locator('.cab-pagina-acciones [data-documento="pdf"]').getAttribute('title');
      ok(/no descarga documentos con precios: lo hacen Gerencia, Operaciones, Comercial o Comercio Exterior/.test(titulo ?? ''), `${rol}: con el porqué`, titulo ?? '');
    }
    const pcons = await como('consulta');
    await ir(pcons, `/ventas/cotizaciones/${cot.id}`);
    ok(await pcons.locator('[data-documento="pdf"][data-apagado="si"]').count() === 1, 'Consulta: PDF de la cotización apagado');
    await ir(pcons, `/ventas/pedidos/${ped.id}/contrato`);
    const tc = await pcons.locator('main').innerText();
    ok(/no está disponible para su rol/.test(tc) && !/pulse «Generar»/.test(tc), 'Consulta en el contrato: texto según su rol, sin «pulse Generar»');

    const pq = await como('calidad');
    const doc = await pq.request.get(`${BASE}/api/documentos/proforma/${ped.id}?formato=pdf`);
    const cuerpo = await doc.json().catch(() => ({}));
    ok(doc.status() === 403 && /^Calidad no descarga/.test(cuerpo.error ?? ''), 'la API de documentos responde con el nombre del rol', cuerpo.error ?? '');
    const [contrato] = await consultar(`select id from contratos where datos is not null order by id desc limit 1`);
    if (contrato) {
      const rc = await pq.request.get(`${BASE}/api/contratos/${contrato.id}?formato=pdf`);
      ok(rc.status() === 403, 'la descarga del contrato ahora revisa el rol (Calidad: 403)', `HTTP ${rc.status()}`);
      const pgc = await como('comercial');
      const rc2 = await pgc.request.get(`${BASE}/api/contratos/${contrato.id}?formato=pdf`);
      ok(rc2.status() === 200, 'Comercial sí lo baja', `HTTP ${rc2.status()}`);
    }

    const [lote] = await consultar(`select lote_id id from v_stock_lote where fisico_kg > 0 limit 1`);
    await ir(pcons, `/almacenes/lotes/${lote.id}`);
    ok(await pcons.locator('a', { hasText: 'Simular retiro' }).count() === 0, 'Consulta no ve «Simular retiro» en la ficha del lote');
    await ir(pq, `/almacenes/lotes/${lote.id}`);
    ok(await pq.locator('a', { hasText: 'Simular retiro' }).count() === 1, 'Calidad sí (tiene Retiro sanitario)');
    const pa = await como('almacen');
    await ir(pa, '/trazabilidad');
    ok(await pa.locator('a', { hasText: 'Retiro sanitario' }).count() === 0, 'Almacén no ve «Retiro sanitario» en el Buscador');

    await ir(pq, '/panel');
    ok(await pq.locator('a', { hasText: 'Ver control' }).count() === 0, 'Calidad no ve «Ver control» en el panel');
    const [fac] = await consultar(`select id from facturas order by id desc limit 1`);
    const px = await como('comex');
    await ir(px, `/finanzas/facturas/${fac.id}`);
    ok(await px.locator('a.ficha-enlace', { hasText: 'Cuentas por cobrar' }).count() === 0, 'Comercio Exterior no ve el acceso a Cuentas por cobrar en el comprobante');
    const pg = await como('gerencia');
    await ir(pg, `/finanzas/facturas/${fac.id}`);
    ok(await pg.locator('a.ficha-enlace', { hasText: 'Cuentas por cobrar' }).count() === 1, 'Gerencia sí');

    // Buscador: Calidad abre el packing → va al despacho.
    const [pk] = await consultar(`select pk.codigo, d.id despacho from packing_lists pk join despachos d on d.packing_list_id = pk.id order by d.id desc limit 1`);
    await ir(pq, `/trazabilidad?q=${encodeURIComponent(pk.codigo)}`);
    const verDesp = pq.locator(`a[href="/logistica/despachos/${pk.despacho}"]`, { hasText: 'Ver despacho' });
    ok(await verDesp.count() >= 1, 'Calidad: el packing del Buscador la lleva al despacho', pk.codigo);
    ok(await pq.locator('a[href^="/logistica/packing/"]').count() === 0, 'y ya no al packing, que no tiene');

    // ?sinacceso
    await ir(pq, '/logistica/packing');
    ok(/sinacceso=/.test(pq.url()), 'Calidad pide Packing y la devuelven al panel', pq.url());
    const aviso = pq.locator('[data-aviso="sin-acceso"]');
    ok(await aviso.count() === 1 && /no está disponible para su rol \(Calidad\)/.test(await aviso.innerText()), 'el panel muestra el aviso «Esa pantalla no está disponible para su rol…»');
    await captura(pq, 'panel-sinacceso-calidad');
  }

  /* ════════════════════ 5 · COTIZACIONES ════════════════════ */
  console.log(SEC(5, 'Cotizaciones: papelera, aprobar vencida, tipo de cambio'));
  {
    const [venc] = await consultar(`select c.id, c.numero from cotizaciones c where c.estado = 'vencida'
                                      and not exists (select 1 from pedidos p where p.cotizacion_id = c.id) order by c.id desc limit 1`);
    const pc = await como('comercial');
    if (venc) {
      await ir(pc, `/ventas/cotizaciones/${venc.id}`);
      const b = pc.locator('.ficha-botonera button[data-accion="eliminar"]');
      ok(await b.isDisabled(), `Comercial: «Eliminar» apagado en ${venc.numero} (vencida)`);
      const t = await b.getAttribute('title');
      ok(/está vencida/.test(t ?? '') && !/enviada al cliente/.test(t ?? ''), 'el porqué dice la causa real', t ?? '');
      await ir(pc, `/ventas/cotizaciones?estado=vencida`);
      const papelera = pc.locator('button[data-accion="eliminar"]').first();
      ok(await papelera.isDisabled(), 'en el listado, la papelera de una vencida también apagada');
      const pg = await como('gerencia');
      await ir(pg, `/ventas/cotizaciones/${venc.id}`);
      ok(!(await pg.locator('.ficha-botonera button[data-accion="eliminar"]').isDisabled()), 'Gerencia sí puede eliminarla (no se pulsa)');
    }
    const [c130] = await consultar(`select id, numero, vence_el::text from cotizaciones where estado = 'borrador' and vence_el < (now() at time zone 'America/Lima')::date order by id limit 1`);
    if (c130) {
      const pg = await como('gerencia');
      await ir(pg, `/ventas/cotizaciones/${c130.id}`);
      const ap = pg.locator('button[data-accion="aprobar"]');
      if (await ap.count()) {
        ok(await ap.isDisabled(), `«Aprobar» apagado en ${c130.numero}, vencida`);
        const [a, m, d] = c130.vence_el.slice(0, 10).split('-');
        const esperado = `La validez venció el ${d}/${m}/${a}: pídale a Comercial que la actualice antes de aprobar`;
        ok((await ap.getAttribute('title'))?.includes(esperado), 'con el mensaje pedido', esperado);
        ok((await pg.locator('[data-aviso="validez-vencida"]').innerText()).includes(esperado), 'y el mismo texto en el aviso de la ficha');
      } else ok(true, 'la empresa no exige aprobación: no hay botón «Aprobar»');
    }
    // Tipo de cambio: el aviso del formulario con el valor de SUNAT del día.
    const [sunat] = await consultar(`select venta::text, compra::text from tipos_cambio_sunat order by fecha desc limit 1`);
    await ir(pc, '/ventas/cotizaciones/nueva');
    await pc.locator('[data-tc="sunat"]').waitFor({ timeout: 30000 }).catch(() => {});
    const tc = pc.locator('label:has-text("Tipo de cambio") input');
    await tc.fill('1');
    const avisoTc = await pc.locator('label:has-text("Tipo de cambio") .form-aviso-campo').innerText();
    ok(!/ronda 3,75/.test(avisoTc) && /SUNAT/.test(avisoTc), 'el aviso del tipo de cambio ya no dice «ronda 3,75»', avisoTc.slice(0, 120));
    ok(sunat ? /SUNAT publicó \d[.,]\d{3}/.test(avisoTc) : true, 'y trae el valor publicado por SUNAT');
  }

  /* ════════════════════ 6 · CLIENTES ════════════════════ */
  console.log(SEC(6, 'Clientes: cartera filtrada, crédito y bloqueo de Gerencia y Operaciones'));
  {
    const [deudor] = await consultar(`select cliente_id id, count(*)::int n from v_cuentas_cobrar where saldo > 0.01 group by 1 order by 2 asc limit 1`);
    const [total] = await consultar(`select count(*)::int n from v_cuentas_cobrar where saldo > 0.01`);
    const pg = await como('gerencia');
    await ir(pg, `/finanzas/cobrar?cliente=${deudor.id}`);
    ok(await pg.locator('[data-filtro="cliente"]').count() === 1, '«?cliente=» se dice en pantalla, con enlace a toda la cartera');
    const titulo = await pg.locator('#documentos').textContent();
    ok(titulo.includes(`${deudor.n} documento`) && total.n !== deudor.n, `filtra: ${deudor.n} documentos de ese cliente (de ${total.n})`);

    const [cli] = await consultar(`select id from clientes where activo order by id limit 1`);
    const pc = await como('comercial');
    await ir(pc, `/ventas/clientes/${cli.id}/editar`);
    ok(await pc.locator('input[name="linea_credito"]').isDisabled(), 'Comercial: la línea de crédito, apagada en Editar');
    ok(await pc.locator('input[name="bloqueado"]').isDisabled(), 'y «Bloquear al cliente», apagado');
    ok(/Gerencia u Operaciones/.test(await pc.locator('form.form-maestro').textContent()), 'con la explicación');
    ok(!/Se propone solo al cotizar/.test(await pc.locator('form.form-maestro').textContent()), 'el vendedor asignado ya no dice «se propone solo al cotizar»');
    await captura(pc, 'cliente-editar-comercial');
    await ir(pg, `/ventas/clientes/${cli.id}/editar`);
    ok(!(await pg.locator('input[name="linea_credito"]').isDisabled()), 'Gerencia los tiene encendidos');

    const b = await comoUsuario(usuarios.comercial, `update clientes set bloqueado = not bloqueado, motivo_bloqueo = 'PRUEBA-076' where id = ${cli.id}`);
    ok(!b.ok && /Bloquear o desbloquear un cliente lo hacen Gerencia u Operaciones/.test(b.mensaje), 'la base no deja a Comercial bloquear (en español)');
    const l = await comoUsuario(usuarios.comercial, `update clientes set linea_credito = linea_credito + 1000 where id = ${cli.id}`);
    ok(!l.ok && /línea de crédito/.test(l.mensaje), 'ni cambiar la línea de crédito');
    const t = await comoUsuario(usuarios.comercial, `update clientes set telefono = telefono where id = ${cli.id} returning id`);
    ok(t.ok && JSON.stringify(t.r).includes(String(cli.id)), 'el resto de la ficha, sí');
    const o = await comoUsuario(usuarios.operaciones, `update clientes set linea_credito = linea_credito + 1000 where id = ${cli.id} returning id`);
    ok(o.ok, 'Operaciones sí cambia la línea (transacción deshecha)');
  }

  /* ════════════════════ 7 · FACTURACIÓN ════════════════════ */
  console.log(SEC(7, 'Facturación: solo de un pedido confirmado'));
  {
    const pg = await como('gerencia');
    const [pend] = await consultar(`select p.id, p.numero_proforma from pedidos p where p.ciclo = 'pendiente_validacion'
                                      and not exists (select 1 from facturas f where f.pedido_id = p.id and f.estado <> 'anulada') order by p.id desc limit 1`);
    if (pend) {
      await ir(pg, `/ventas/pedidos/${pend.id}`);
      const b = pg.locator('button[data-accion="emitir-comprobante"]');
      ok(await b.isDisabled(), `«Emitir comprobante» apagado en ${pend.numero_proforma} (pendiente de validación)`);
      ok(/Primero Gerencia u Operaciones debe confirmar el pedido/.test(await b.getAttribute('title') ?? ''), 'con el mensaje claro');
      const r = await comoUsuario(usuarios.comercial, `insert into facturas (numero, pedido_id, cliente_id, moneda, tipo_cambio, subtotal, igv, total, fecha_emision, fecha_vencimiento, estado, tipo_comprobante)
                                                       select 'PRUEBA-076', p.id, p.cliente_id, p.moneda, 3.7, 1, 0, 1, current_date, current_date, 'emitida', 'factura' from pedidos p where p.id = ${pend.id}`);
      ok(!r.ok && /Primero Gerencia u Operaciones debe confirmar el pedido/.test(r.mensaje), 'la base tampoco lo deja (transacción deshecha)', r.mensaje?.slice(0, 140));
    }
    const [conf] = await consultar(`select p.id, p.numero_proforma from pedidos p where p.ciclo = 'confirmado'
                                      and not exists (select 1 from facturas f where f.pedido_id = p.id and f.estado <> 'anulada')
                                      and exists (select 1 from pedido_lineas pl where pl.pedido_id = p.id) order by p.id desc limit 1`);
    await ir(pg, `/ventas/pedidos/${conf.id}`);
    await pg.click('button[data-accion="emitir-comprobante"]');
    await pg.locator('.facturar').waitFor({ timeout: 30000 });
    const vence = await pg.locator('.facturar-vence').innerText();
    ok(/Vence el \d{2}\/\d{2}\/\d{4}\./.test(vence), 'la vista previa dice «Vence el dd/mm/aaaa»', vence);
    const caja = await pg.locator('.facturar').boundingBox();
    const botones = await pg.locator('.cab-pagina-acciones > button, .cab-pagina-acciones > a, [data-bloque="ciclo-pedido"]').evaluateAll(
      (els) => els.filter((e) => !e.closest('.facturar')).map((e) => e.getBoundingClientRect().bottom));
    ok(caja && botones.every((b) => b <= caja.y + 1), 'y queda debajo de todos los botones (no empuja Confirmar/Cancelar)');
    await captura(pg, 'factura-vista-previa');
    await pg.click('button[data-accion="emitir-comprobante"]'); // «Cancelar»: cierra la vista previa, no emite
  }

  /* ════════════════════ 8 · CORTE DE RED ════════════════════ */
  console.log(SEC(8, 'Un corte de red en el formulario no rompe la pantalla'));
  {
    const [cli] = await consultar(`select id from clientes where activo order by id limit 1`);
    const pg = await como('gerencia');
    await ir(pg, `/ventas/clientes/${cli.id}/editar`);
    const ruta = `**/ventas/clientes/${cli.id}/editar`;
    await pg.route(ruta, (r) => (r.request().method() === 'POST' ? r.abort() : r.continue()));
    const campo = pg.locator('input[placeholder="+51 999 999 999"]');
    await campo.fill('PRUEBA-076 no se guarda');
    await pg.click('button[type="submit"]');
    await pg.locator('form.form-maestro [role="alert"]').waitFor({ timeout: 20000 });
    const aviso = await pg.locator('form.form-maestro [role="alert"]').innerText();
    ok(/Se perdió la conexión/.test(aviso), 'el aviso de conexión sale en el formulario', aviso.slice(0, 80));
    ok(await campo.inputValue() === 'PRUEBA-076 no se guarda', 'y lo escrito sigue ahí');
    ok(!/No se pudo cargar esta pantalla/.test(await pg.locator('body').innerText()), 'la pantalla no se cae');
    await pg.unroute(ruta);
    const [tel] = await consultar(`select coalesce(telefono, '') t from clientes where id = ${cli.id}`);
    ok(!tel.t.includes('PRUEBA-076'), 'no se guardó nada');
  }
} catch (e) {
  console.error(e);
  fallos.push(`excepción: ${e.message}`);
} finally {
  /* ---- Limpieza: solo lo que creó esta prueba ---- */
  try {
    const mias = await consultar(`select id from reservas where creado_en > '${inicio}' and observaciones like 'PRUEBA-076%'`);
    const ids = mias.map((r) => r.id);
    if (reservaCreada && !ids.includes(reservaCreada.id)) ids.push(reservaCreada.id);
    if (ids.length) {
      const lista = ids.join(',');
      await consultar(`delete from eventos where entidad in ('reservas','reserva') and entidad_id in (${lista}) and ocurrido_en > '${inicio}'`);
      await consultar(`delete from reservas where id in (${lista})`);
      await consultar(`delete from auditoria where tabla = 'reservas' and registro_id in (${ids.map((i) => `'${i}'`).join(',')}) and ocurrido_en > '${inicio}'`);
    }
    if (pedidoDeLaReserva) {
      //  La cobertura del pedido vuelve a como estaba (y su fecha de cambio); su rastro en la auditoría, fuera.
      const pid = pedidoDeLaReserva.id;
      await consultar(`update pedidos set cobertura = '${pedidoDeLaReserva.cobertura}', actualizado_en = '${pedidoDeLaReserva.actualizado_en}' where id = ${pid}`);
      await consultar(`delete from auditoria where tabla = 'pedidos' and registro_id = '${pid}' and ocurrido_en > '${inicio}'`);
      await consultar(`delete from eventos where entidad in ('pedidos','pedido') and entidad_id = ${pid} and ocurrido_en > '${inicio}' and tipo like '%cobertura%'`);
    }
    await consultar(`delete from eventos where tipo = 'reporte_exportado' and ocurrido_en > '${inicio}' and usuario_id in ('${usuarios.calidad}','${usuarios.consulta}','${usuarios.gerencia}')`).catch(() => {});
    const [quedan] = await consultar(`select count(*)::int n from reservas where observaciones like 'PRUEBA-076%'`);
    console.log(`\nLimpieza: ${ids.length} reserva(s) de prueba borradas; quedan ${quedan.n} con la marca.`);
  } catch (e) {
    console.error('Limpieza incompleta:', e.message);
    fallos.push('limpieza');
  }
  await nav.close();
}

console.log(`\n${aciertos} comprobaciones bien, ${fallos.length} fallas.`);
if (fallos.length) { console.log(fallos.map((f) => ' · ' + f).join('\n')); process.exit(1); }
