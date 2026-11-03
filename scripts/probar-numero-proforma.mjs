/**
 * ============================================================================
 *  PRUEBA · EL NÚMERO DE PROFORMA SE PUEDE ESCRIBIR Y CORREGIR (migración 082)
 * ============================================================================
 *  Pedido de Oliver Tello (Operaciones): «poder modificar el número de
 *  Proforma». En el navegador y comprobado en la base:
 *
 *    1. Configuración › Parámetros › «Numeración de proformas»: Gerencia fija
 *       el próximo número automático; un número ya usado se rechaza; queda
 *       quién y cuándo. Comercial no puede (la base lo rechaza).
 *    2. Pedido directo: «N.º de proforma» viene propuesto (= la base), avisa
 *       si se escribe uno de la serie mayor que el propuesto, rechaza la
 *       barra, rechaza uno repetido (sin importar mayúsculas ni espacios) sin
 *       perder lo escrito, aguanta un corte de red, y guarda el escrito
 *       normalizado.
 *    3. «Convertir en pedido» desde la ficha de la cotización: propuesto y
 *       aceptado tal cual; el contador avanza hasta ese número.
 *    4. «Cambiar número» en la ficha (Comercio Exterior): repetido y barra
 *       rechazados; el cambio queda en el historial (de X a Y, quién); avisa
 *       del contrato y el contrato avisa que hay que generarlo otra vez; las
 *       alertas abiertas toman el número nuevo.
 *    5. Los documentos y búsquedas leen el número vigente: PDF y Excel de la
 *       proforma, reporte de pedidos, buscador universal, listado de pedidos.
 *    6. Con comprobante emitido el número ya no se cambia (botón apagado con
 *       su porqué; la base lo rechaza). Almacén no ve el botón y la base no
 *       le deja.
 *    7. Desde el listado de cotizaciones y desde «Contrato» de la cotización:
 *       el campo con el propuesto; un número escrito a mano se respeta.
 *    8. En la base, dentro de transacciones que se deshacen: el contador
 *       salta con un número mayor escrito a mano, la propuesta salta los
 *       números usados, SM26-26 = SM26-026, Configuración no acepta uno usado.
 *
 *  La base es la de producción. La prueba crea SUS cosas (cliente «PRUEBA-NP
 *  …», cotizaciones «COT-PRUEBA-NP…», pedidos «PRB-NP-…» y uno con el número
 *  propuesto) y las borra en `finally` con sus eventos y alertas. No reserva
 *  ni despacha (nada toca el stock ni el Kardex) y NO borra filas de
 *  auditoría: las que dejan sus pedidos se cuentan al final. El contador SM
 *  y la marca «fijado a mano» vuelven a como estaban.
 *
 *      BASE_URL=http://localhost:3010 node scripts/probar-numero-proforma.mjs
 * ============================================================================
 */
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ejecutarSQL } from './db.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3010';
const CLAVE = process.env.CLAVE_DEMO ?? (() => {
  try { return (/^CLAVE_DEMO=(.*)$/m.exec(readFileSync('.env.local', 'utf8'))?.[1] ?? '').trim(); } catch { return ''; }
})();
const consultar = async (sql) => { const r = await ejecutarSQL(sql); return Array.isArray(r) ? r : []; };
const intentar = async (sql) => { try { await ejecutarSQL(sql); return null; } catch (e) { return String(e.message); } };
const SEC = (n, t) => `\n${'─'.repeat(3)} ${n} · ${t} ${'─'.repeat(3)}`;
const fallos = [];
const ok = (cond, texto, detalle = '') => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${texto}${detalle ? ' · ' + detalle : ''}`);
  if (!cond) fallos.push(texto);
};
const CARPETA = process.env.CAPTURAS ?? join(tmpdir(), 'probar-numero-proforma');
mkdirSync(CARPETA, { recursive: true });
const captura = async (p, nombre) => { if (process.env.CAPTURAS) await p.screenshot({ path: join(CARPETA, `${nombre}.png`), fullPage: true }); };

const SELLO = String(Date.now()).slice(-5);
const RAZON = `PRUEBA-NP ${SELLO} SAC`;
const NUM_A = `PRB-NP-${SELLO}A`;          // pedido directo (escrito a mano, en minúsculas y con espacios)
const NUM_B = `PRB-NP-${SELLO}-B`;         // el nuevo número del pedido convertido
const NUM_C = `PRB-NP-${SELLO}-C`;         // convertido desde «Contrato» de la cotización
const MSJ_SIN_CONEXION = 'Se perdió la conexión con el sistema';

/* ---- Lo que hay antes, para devolverlo todo ---- */
const [prev] = await consultar(`
  select (select coalesce(max(id),0) from eventos) ev, (select coalesce(max(id),0) from auditoria) au,
         (select coalesce(max(id),0) from alertas) al, (select coalesce(max(id),0) from pedidos) ped,
         (select coalesce(max(id),0) from cotizaciones) cot, (select coalesce(max(id),0) from clientes) cli,
         (select coalesce(max(id),0) from contratos) ctr`);
const [corr] = await consultar(`
  select ultimo, actualizado_en::text, actualizado_por::text from correlativos
   where serie = 'SM' and anio = anio_numeracion_proforma()`);
const [{ anio }] = await consultar(`select anio_numeracion_proforma() anio`);
const AA = String(anio).slice(2);
const usuarios = Object.fromEntries((await consultar(`
  select split_part(email, '@', 1) k, id::text, nombre from usuarios
   where email in ('gerencia@santamonica.pe','operaciones@santamonica.pe','comercial@santamonica.pe','comex@santamonica.pe','almacen@santamonica.pe')`))
  .map((u) => [u.k, u]));
const como = (u, sql) => intentar(`begin; select set_config('request.jwt.claims', '{"sub":"${u}","role":"authenticated"}', true); set local role authenticated; ${sql}; rollback;`);
/* La API devuelve las filas de la última consulta aunque después venga el rollback. */
const comoFilas = (u, sql) =>
  ejecutarSQL(`begin; select set_config('request.jwt.claims', '{"sub":"${u}","role":"authenticated"}', true); set local role authenticated; ${sql}; rollback;`);
const propuestaBD = async () => (await consultar(`select proponer_numero_proforma() p`))[0].p;
const ultimoBD = async () => Number((await consultar(`select ultimo from correlativos where serie = 'SM' and anio = ${anio}`))[0]?.ultimo ?? 0);
const nSerie = (num) => Number(/^SM\d{2}-(\d+)$/.exec(num)?.[1] ?? NaN);
const serie = (n) => `SM${AA}-${String(n).padStart(3, '0')}`;

const nav = await chromium.launch({ channel: 'chrome', headless: true });
const errores = [];
async function sesion(correo) {
  const ctx = await nav.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errores.push(`${correo}: ${e.message}`));
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', `${correo}@santamonica.pe`);
  await p.fill('input[type="password"]', CLAVE);
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/panel/, { timeout: 60000 });
  return p;
}

const mios = { cli: null, cot: [], ped: [], fac: [] };
let tocoCorrelativo = false;

try {
  /* ---- Lo que la prueba necesita: un cliente y dos cotizaciones aprobadas ---- */
  const [cli] = await consultar(`
    insert into clientes (codigo, razon_social, pais, moneda) values ('PRB-NP-${SELLO}', '${RAZON}', 'Chile', 'USD') returning id`);
  mios.cli = cli.id;
  const [sp] = await consultar(`
    select sp.id from sku_presentaciones sp join skus s on s.id = sp.sku_id
     where sp.activo and s.activo order by sp.id limit 1`);
  async function cotizacion(sufijo) {
    const [c] = await consultar(`
      insert into cotizaciones (numero, cliente_id, estado, moneda, tipo_cambio, incoterm, validez_dias, creado_por, aprobada_en, aprobada_por, tipo_cambio_fuente, tipo_cambio_fecha, observaciones)
      values ('COT-PRUEBA-NP${SELLO}${sufijo}', ${cli.id}, 'aprobada', 'USD', 3.45, 'FOB', 15, '${usuarios.gerencia.id}', now(), '${usuarios.gerencia.id}', 'manual', current_date, 'PRUEBA-NP')
      returning id, numero`);
    await consultar(`insert into cotizacion_lineas (cotizacion_id, sku_presentacion_id, cantidad_tm, precio_lista_tm, precio_tm, descuento_pct, orden)
                     values (${c.id}, ${sp.id}, 2, 2000, 2000, 0, 1)`);
    mios.cot.push(c.id);
    return c;
  }
  const cotA = await cotizacion('A');
  const cotB = await cotizacion('B');
  const [otro] = await consultar(`select id, numero_proforma from pedidos where id <= ${prev.ped} order by id desc limit 1`);

  const g = await sesion('gerencia');
  const c = await sesion('comercial');

  /* ======================================================================
     1 · CONFIGURACIÓN: EL PRÓXIMO NÚMERO AUTOMÁTICO
     ====================================================================== */
  console.log(SEC(1, 'Configuración › Parámetros › Numeración de proformas'));
  {
    const p0 = await propuestaBD();
    const n0 = nSerie(p0);
    await g.goto(`${BASE}/configuracion?t=parametros`, { waitUntil: 'networkidle' });
    const bloque = g.locator('[data-bloque="numeracion-proforma"]');
    ok(await bloque.count() === 1, 'Gerencia ve el panel «Numeración de proformas» en Parámetros');
    ok((await bloque.locator('[data-propuesto]').innerText()).trim() === p0, 'muestra el que se propondrá, igual que la base', p0);
    ok(await g.locator('input[name="proximo_numero_proforma"]').inputValue() === String(n0), 'el campo trae el próximo número', String(n0));

    //  Uno ya usado: se rechaza y no cambia nada.
    if (otro && nSerie(otro.numero_proforma)) {
      await g.locator('input[name="proximo_numero_proforma"]').fill(String(nSerie(otro.numero_proforma)));
      await g.click('[data-accion="fijar-numeracion"]');
      const aviso = g.locator('[data-aviso="numeracion"]');
      await aviso.waitFor({ timeout: 20000 });
      const t = await aviso.innerText();
      ok(/ya es la proforma de/.test(t) && await ultimoBD() === corr.ultimo, 'un número que ya usa un pedido se rechaza con su motivo, sin tocar el contador', t.slice(0, 110));
    }

    //  Uno libre: se guarda, queda quién y cuándo, y la propuesta cambia.
    tocoCorrelativo = true;
    await g.locator('input[name="proximo_numero_proforma"]').fill(String(n0 + 1));
    ok(/se propondrá como/.test(await bloque.locator('[data-vista]').innerText()), 'antes de guardar dice cómo se propondrá');
    await g.click('[data-accion="fijar-numeracion"]');
    await g.locator('[data-aviso="numeracion"]').waitFor({ timeout: 20000 });
    const t1 = await g.locator('[data-aviso="numeracion"]').innerText();
    const [c1] = await consultar(`select ultimo, actualizado_por::text por from correlativos where serie = 'SM' and anio = ${anio}`);
    ok(new RegExp(`próximo pedido se propondrá como ${serie(n0 + 1)}`).test(t1) && Number(c1.ultimo) === n0 && c1.por === usuarios.gerencia.id,
      'se guarda: el contador queda en el anterior y se anota quién lo fijó', `${t1} · último ${c1.ultimo}`);
    ok(await propuestaBD() === serie(n0 + 1), 'la base ya propone el número fijado', serie(n0 + 1));
    const [ev] = await consultar(`select descripcion from eventos where id > ${prev.ev} and entidad = 'correlativos' and tipo = 'numeracion_proforma_fijada' order by id desc limit 1`);
    ok(new RegExp(`fijó el próximo número automático de proforma en ${serie(n0 + 1)}`).test(ev?.descripcion ?? ''), 'queda en los eventos (quién, de cuál a cuál)', ev?.descripcion);
    await g.waitForLoadState('networkidle');
    await g.reload({ waitUntil: 'networkidle' });
    ok(/Marco|·/.test(await g.locator('[data-fijado]').innerText()), 'el panel muestra «fijado a mano por última vez»', await g.locator('[data-fijado]').innerText());
    await captura(g, '01-configuracion-numeracion');

    //  Y de vuelta a como estaba (el panel no deja guardar el mismo propuesto).
    await g.locator('input[name="proximo_numero_proforma"]').fill(String(n0));
    await g.click('[data-accion="fijar-numeracion"]');
    await g.locator('[data-aviso="numeracion"]').waitFor({ timeout: 20000 });
    ok(await propuestaBD() === p0, 'se vuelve a fijar el de antes', p0);

    //  Comercial no entra a Configuración, y la base tampoco le deja.
    const eCom = await como(usuarios.comercial.id, `select fijar_proximo_numero_proforma(${n0})`);
    ok(/corresponde a Gerencia u Operaciones/.test(eCom ?? ''), 'la base no deja a Comercial fijar la numeración', (eCom ?? '').slice(60, 160));
    const eOp = await como(usuarios.operaciones.id, `select fijar_proximo_numero_proforma(${n0})`);
    ok(eOp === null, 'Operaciones sí puede (dentro de una transacción que se deshace)');
  }

  /* ======================================================================
     2 · PEDIDO DIRECTO: EL NÚMERO PROPUESTO Y EDITABLE
     ====================================================================== */
  console.log(SEC(2, 'Pedido directo: N.º de proforma propuesto y editable'));
  {
    const p0 = await propuestaBD();
    await c.goto(`${BASE}/ventas/pedidos/nuevo`, { waitUntil: 'networkidle' });
    const campo = c.locator('[data-campo="numero-proforma"]');
    ok(await campo.inputValue() === p0, 'el campo viene con el propuesto de la base', p0);
    ok(/Propuesto por el sistema/.test(await c.locator('[data-numero-origen]').innerText()), 'y dice que es el propuesto');

    await campo.fill(serie(nSerie(p0) + 50));
    const salto = await c.locator('[data-aviso-numero="salto"]').innerText();
    ok(new RegExp(`seguirá desde ${serie(nSerie(p0) + 51)}`).test(salto), 'uno de la serie mayor que el propuesto: avisa que la numeración seguirá desde ahí', salto.slice(0, 120));
    await captura(c, '02-pedido-aviso-salto');
    await campo.fill('SM26/1');
    ok(/no lleva barra/.test(await c.locator('[data-aviso-numero="problema"]').innerText()), 'la barra se rechaza al escribir');
    await c.click('[data-numero-origen] button');
    ok(await campo.inputValue() === p0, '«Volver al propuesto» lo repone');

    //  El resto del formulario.
    await c.locator('small[data-tc="sunat"], small[data-tc="manual"]').first().waitFor({ timeout: 25000 });
    await c.locator('select.campo').first().selectOption(String(mios.cli));
    await c.waitForTimeout(800);
    await c.locator('input.form-buscador-input').fill('POTA');
    await c.waitForTimeout(1500);
    await c.locator('.form-resultados button').first().click();
    await c.waitForTimeout(2000);

    //  Repetido, escrito distinto (minúsculas y espacios): el servidor lo rechaza y no se pierde nada.
    const repetido = ` ${otro.numero_proforma.toLowerCase().replace('-', ' - ')} `;
    await campo.fill(repetido);
    await c.locator('button', { hasText: 'Registrar pedido' }).click();
    const msg = c.locator('.form-mensaje, [role="alert"], [role="status"]').filter({ hasText: /Ya existe la proforma/ });
    await msg.first().waitFor({ timeout: 30000 });
    ok(/\/ventas\/pedidos\/nuevo/.test(c.url()) && await campo.inputValue() === repetido,
      'un número repetido (sin importar mayúsculas ni espacios) se rechaza con su motivo y lo escrito se queda', (await msg.first().innerText()).slice(0, 120));
    ok(Number((await consultar(`select count(*)::int n from pedidos where cliente_id = ${mios.cli}`))[0].n) === 0, 'y no se guardó nada');

    //  Un corte de red: aviso en el formulario, sin perder lo escrito.
    await campo.fill(`prb-np-${SELLO} a`);
    let cortes = 0;
    await c.route('**/ventas/pedidos/nuevo', async (r) => {
      if (r.request().method() === 'POST' && cortes === 0) { cortes++; await r.abort('internetdisconnected'); } else await r.continue();
    });
    await c.locator('button', { hasText: 'Registrar pedido' }).click();
    const sinRed = c.locator('.form-mensaje, [role="alert"], [role="status"]').filter({ hasText: MSJ_SIN_CONEXION });
    await sinRed.first().waitFor({ timeout: 30000 }).catch(() => null);
    ok(await sinRed.count() > 0 && await campo.inputValue() === `prb-np-${SELLO} a`, 'un corte de red avisa en el formulario y no pierde el número escrito');
    await c.unroute('**/ventas/pedidos/nuevo');

    //  Y ahora sí: se guarda normalizado.
    await c.locator('button', { hasText: 'Registrar pedido' }).click();
    await c.waitForURL(/\/ventas\/pedidos\/\d+$/, { timeout: 30000 });
    const id = Number(c.url().match(/(\d+)$/)[1]);
    mios.ped.push(id);
    const [pd] = await consultar(`select numero_proforma n from pedidos where id = ${id}`);
    ok(pd.n === NUM_A, 'se guarda en mayúsculas y sin espacios', `«prb-np-${SELLO} a» → ${pd.n}`);
    ok(await ultimoBD() === Number(corr.ultimo) || await ultimoBD() >= Number(corr.ultimo), 'un número fuera de la serie no mueve el contador', String(await ultimoBD()));
    await c.waitForLoadState('networkidle');
    ok((await c.locator('[data-numero-proforma]').innerText()).trim() === NUM_A, 'la ficha muestra el número escrito');
  }

  /* ======================================================================
     3 · CONVERTIR EN PEDIDO (ficha de la cotización): el propuesto tal cual
     ====================================================================== */
  console.log(SEC(3, '«Convertir en pedido» desde la ficha de la cotización'));
  let pedB = null;
  let numPropuestoB = null;
  {
    await c.goto(`${BASE}/ventas/cotizaciones/${cotA.id}`, { waitUntil: 'networkidle' });
    await c.click('[data-accion="convertir"]');
    const campo = c.locator('[data-confirmar="convertir"] [data-campo="numero-proforma"]');
    await c.waitForFunction(() => document.querySelector('[data-confirmar="convertir"] [data-campo="numero-proforma"]')?.value, null, { timeout: 20000 });
    numPropuestoB = await campo.inputValue();
    ok(numPropuestoB === await propuestaBD(), 'al pulsar «Convertir en pedido» pide el N.º de proforma, con el propuesto de la base', numPropuestoB);
    await captura(c, '03-convertir-ficha');
    await c.click('[data-accion="confirmar-conversion"]');
    await c.waitForURL(/\/ventas\/pedidos\/\d+$/, { timeout: 30000 });
    pedB = Number(c.url().match(/(\d+)$/)[1]);
    mios.ped.push(pedB);
    const [pd] = await consultar(`select numero_proforma n, cotizacion_id from pedidos where id = ${pedB}`);
    ok(pd.n === numPropuestoB && Number(pd.cotizacion_id) === cotA.id, 'el pedido nace con el número propuesto', pd.n);
    ok(await ultimoBD() === nSerie(numPropuestoB), 'y el contador avanza hasta ese número (no se volverá a proponer)', String(await ultimoBD()));
    ok(nSerie(await propuestaBD()) === nSerie(numPropuestoB) + 1, 'la propuesta siguiente es la que sigue', await propuestaBD());
  }

  /* ======================================================================
     4 · «CAMBIAR NÚMERO» EN LA FICHA (Comercio Exterior)
     ====================================================================== */
  console.log(SEC(4, '«Cambiar número» en la ficha del pedido'));
  {
    //  Un contrato y una alerta abierta con el número viejo, para ver qué pasa con ellos.
    await consultar(`insert into contratos (numero, pedido_id, cotizacion_id, revision, titulo, datos, generado_por)
                     values ('C-${numPropuestoB}', ${pedB}, ${cotA.id}, 0, 'PRUEBA-NP', '{"proforma":"${numPropuestoB}","numero":"C-${numPropuestoB}"}', '${usuarios.gerencia.id}')`);
    await consultar(`insert into alertas (entidad, entidad_id, severidad, titulo, mensaje, datos)
                     values ('pedidos', ${pedB}, 'info', 'PRUEBA-NP', 'El pedido ${numPropuestoB} lleva días sin movimiento', '{"numero_proforma":"${numPropuestoB}"}')`);

    const x = await sesion('comex');
    await x.goto(`${BASE}/ventas/pedidos/${pedB}`, { waitUntil: 'networkidle' });
    const boton = x.locator('[data-accion="cambiar-numero"]');
    ok(await boton.count() === 1 && await boton.isEnabled(), 'Comercio Exterior ve «Cambiar número» encendido');
    await boton.click();
    const campo = x.locator('[data-bloque="cambiar-numero"] [data-campo="numero-proforma"]');
    ok(await campo.inputValue() === numPropuestoB, 'el campo arranca con el número actual');
    ok(/ya tiene contrato/.test(await x.locator('[data-bloque="cambiar-numero"]').innerText()), 'avisa antes que ya hay contrato y habrá que generarlo otra vez');

    await campo.fill('PRB/1');
    ok(await x.locator('[data-accion="guardar-numero"]').isDisabled(), 'con barra, «Guardar número» se apaga (y dice por qué)');
    await campo.fill(NUM_A.toLowerCase());
    await x.click('[data-accion="guardar-numero"]');
    await x.locator('[data-aviso="cambiar-numero"]').waitFor({ timeout: 20000 });
    const tRep = await x.locator('[data-aviso="cambiar-numero"]').innerText();
    ok(/Ya existe la proforma/.test(tRep) && await campo.inputValue() === NUM_A.toLowerCase(), 'uno repetido se rechaza y el campo sigue con lo escrito', tRep.slice(0, 100));

    //  Un corte de red, una vez.
    let cortes = 0;
    await x.route(`**/ventas/pedidos/${pedB}*`, async (r) => {
      if (r.request().method() === 'POST' && cortes === 0) { cortes++; await r.abort('internetdisconnected'); } else await r.continue();
    });
    await campo.fill(` ${NUM_B.toLowerCase()} `);
    await x.click('[data-accion="guardar-numero"]');
    await x.locator('[data-aviso="cambiar-numero"]').filter({ hasText: MSJ_SIN_CONEXION }).waitFor({ timeout: 20000 }).catch(() => null);
    ok(await x.locator('[data-aviso="cambiar-numero"]').filter({ hasText: MSJ_SIN_CONEXION }).count() === 1 && await campo.isVisible(),
      'un corte de red avisa y deja el campo abierto con lo escrito');
    await x.unroute(`**/ventas/pedidos/${pedB}*`);

    await x.click('[data-accion="guardar-numero"]');
    await x.locator('[data-aviso="cambiar-numero"]').filter({ hasText: /Listo/ }).waitFor({ timeout: 20000 });
    const tOk = await x.locator('[data-aviso="cambiar-numero"]').innerText();
    ok(new RegExp(`${numPropuestoB} ahora es ${NUM_B}`).test(tOk), 'se cambia y lo confirma (de cuál a cuál)', tOk.slice(0, 90));
    ok(/contrato generado con el número anterior/.test(tOk), 'el mensaje recuerda generar el contrato otra vez');
    await x.locator('[data-numero-proforma]').filter({ hasText: NUM_B }).waitFor({ timeout: 20000 }).catch(() => null);
    const enFicha = (await x.locator('[data-numero-proforma]').innerText()).trim();
    const titulo = await x.locator('h1').allInnerTexts();
    ok(enFicha === NUM_B && titulo.some((t) => t.includes(NUM_B)), 'la ficha y su título ya dicen el número nuevo', `${enFicha} · ${titulo.join(' | ')}`);
    await captura(x, '04-cambiar-numero');

    const [pd] = await consultar(`select numero_proforma n from pedidos where id = ${pedB}`);
    ok(pd.n === NUM_B, 'en la base, normalizado', pd.n);
    const [ev] = await consultar(`select descripcion, usuario_id::text u from eventos where id > ${prev.ev} and entidad = 'pedidos' and entidad_id = ${pedB} and tipo = 'numero_proforma_cambiado'`);
    ok(ev && ev.u === usuarios.comex.id && new RegExp(`cambió el número de proforma de ${numPropuestoB} a ${NUM_B}`).test(ev.descripcion),
      'el evento dice quién y de cuál a cuál', ev?.descripcion);
    const [au] = await consultar(`select count(*)::int n from auditoria where id > ${prev.au} and tabla = 'pedidos' and registro_id = '${pedB}' and 'numero_proforma' = any(campos_cambiados)`);
    ok(au.n === 1, 'y la auditoría guarda el valor anterior y el nuevo');
    await x.goto(`${BASE}/ventas/pedidos/${pedB}?t=historial`, { waitUntil: 'networkidle' });
    const hist = await x.locator('main').innerText();
    ok(hist.includes(`cambió el número de proforma de ${numPropuestoB} a ${NUM_B}`) && /número de proforma \(de «/.test(hist),
      'la pestaña Historial lo muestra (evento y cambio de dato)');
    ok(await ultimoBD() === nSerie(numPropuestoB), 'el contador no retrocede al liberar el número');
    const [al] = await consultar(`select mensaje, datos->>'numero_proforma' d from alertas where id > ${prev.al} and entidad = 'pedidos' and entidad_id = ${pedB}`);
    ok(al.mensaje.includes(NUM_B) && al.d === NUM_B, 'la alerta abierta del pedido ya dice el número nuevo', al.mensaje);

    //  El contrato: copia firmada, se avisa que hay que generarlo otra vez.
    await x.goto(`${BASE}/ventas/pedidos/${pedB}/contrato`, { waitUntil: 'networkidle' });
    const avisoCtr = x.locator('[data-aviso="contrato-numero-viejo"]');
    ok(await avisoCtr.count() === 1 && (await avisoCtr.innerText()).includes(`era ${numPropuestoB}`), 'la página del contrato avisa que se generó con el número anterior',
      (await avisoCtr.innerText().catch(() => '')).slice(0, 120));
    await captura(x, '04b-contrato-aviso');
    await x.context().close();
  }

  /* ======================================================================
     5 · DOCUMENTOS Y BÚSQUEDAS CON EL NÚMERO VIGENTE
     ====================================================================== */
  console.log(SEC(5, 'Documentos y búsquedas leen el número vigente'));
  {
    const pdf = await g.request.get(`${BASE}/api/documentos/proforma/${pedB}?formato=pdf`);
    ok(pdf.ok() && (pdf.headers()['content-disposition'] ?? '').includes(NUM_B), 'el PDF de la proforma sale con el número nuevo', pdf.headers()['content-disposition']);
    const xls = await g.request.get(`${BASE}/api/documentos/proforma/${pedB}?formato=excel`);
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(await xls.body());
    let enExcel = false;
    libro.eachSheet((h) => h.eachRow((f) => f.eachCell((x) => { if (String(x.value ?? '').includes(NUM_B)) enExcel = true; })));
    ok(xls.ok() && enExcel && (xls.headers()['content-disposition'] ?? '').includes(NUM_B), 'el Excel de la proforma, también (nombre y contenido)');
    const rep = await g.request.get(`${BASE}/api/reportes/pedidos?formato=excel`);
    const lr = new ExcelJS.Workbook();
    await lr.xlsx.load(await rep.body());
    let enReporte = false, viejo = false;
    lr.eachSheet((h) => h.eachRow((f) => f.eachCell((x) => { const v = String(x.value ?? ''); if (v === NUM_B) enReporte = true; if (v === numPropuestoB) viejo = true; })));
    ok(rep.ok() && enReporte && !viejo, 'el reporte «Pedidos y su avance» lo lista con el número nuevo, no el viejo');
    await g.goto(`${BASE}/trazabilidad?q=${encodeURIComponent(NUM_B)}`, { waitUntil: 'networkidle' });
    ok((await g.locator('main').innerText()).includes(NUM_B), 'el buscador universal lo encuentra por el número nuevo');
    await g.goto(`${BASE}/ventas/pedidos?buscar=${encodeURIComponent(NUM_B)}`, { waitUntil: 'networkidle' });
    ok((await g.locator('main').innerText()).includes(NUM_B), 'el listado de pedidos lo encuentra');
    await g.goto(`${BASE}/ventas/cotizaciones/${cotA.id}`, { waitUntil: 'networkidle' });
    ok((await g.locator('main').innerText()).includes(NUM_B), 'la cotización de origen enlaza el pedido con el número nuevo');
  }

  /* ======================================================================
     6 · CON COMPROBANTE EMITIDO YA NO SE CAMBIA; ALMACÉN NO LO VE
     ====================================================================== */
  console.log(SEC(6, 'Comprobante emitido y roles'));
  {
    const idA = mios.ped[0];
    //  La regla en la base, en una transacción que se deshace.
    const eFac = await intentar(`begin; set local session_replication_role = replica;
      insert into facturas (numero, pedido_id, cliente_id, moneda, tipo_cambio, subtotal, igv, total, fecha_emision, fecha_vencimiento, estado, creado_por, tipo_comprobante)
      values ('PRB-F-${SELLO}', ${idA}, ${mios.cli}, 'USD', 3.45, 1, 0, 1, current_date, current_date, 'emitida', '${usuarios.gerencia.id}', 'factura');
      set local session_replication_role = origin;
      update pedidos set numero_proforma = 'PRB-NP-${SELLO}-Z' where id = ${idA}; rollback;`);
    ok(new RegExp(`ya tiene emitido el comprobante PRB-F-${SELLO}`).test(eFac ?? ''), 'la base no deja cambiar el número con un comprobante vigente', (eFac ?? '').slice(60, 170));
    const eAnul = await intentar(`begin; set local session_replication_role = replica;
      insert into facturas (numero, pedido_id, cliente_id, moneda, tipo_cambio, subtotal, igv, total, fecha_emision, fecha_vencimiento, estado, creado_por, tipo_comprobante)
      values ('PRB-F-${SELLO}', ${idA}, ${mios.cli}, 'USD', 3.45, 1, 0, 1, current_date, current_date, 'anulada', '${usuarios.gerencia.id}', 'factura');
      set local session_replication_role = origin;
      update pedidos set numero_proforma = 'PRB-NP-${SELLO}-Z' where id = ${idA}; rollback;`);
    ok(eAnul === null, 'con el comprobante anulado, sí');

    //  La pantalla: un comprobante de mentira, sin disparadores (no deja rastro), un momento.
    await consultar(`begin; set local session_replication_role = replica;
      insert into facturas (numero, pedido_id, cliente_id, moneda, tipo_cambio, subtotal, igv, total, fecha_emision, fecha_vencimiento, estado, creado_por, tipo_comprobante)
      values ('PRB-F-${SELLO}', ${idA}, ${mios.cli}, 'USD', 3.45, 1, 0, 1, current_date, current_date, 'emitida', '${usuarios.gerencia.id}', 'factura'); commit;`);
    mios.fac.push(`PRB-F-${SELLO}`);
    await c.goto(`${BASE}/ventas/pedidos/${idA}`, { waitUntil: 'networkidle' });
    const b = c.locator('[data-accion="cambiar-numero"]');
    ok(await b.isDisabled() && /comprobante PRB-F-\d+: el número ya no se cambia/.test(await c.locator('[data-bloque="cambiar-numero"]').innerText()),
      'con comprobante, «Cambiar número» se ve apagado y dice por qué');
    await captura(c, '06-con-comprobante');
    await consultar(`begin; set local session_replication_role = replica; delete from facturas where numero = 'PRB-F-${SELLO}' and pedido_id = ${idA}; commit;`);
    mios.fac = [];

    const a = await sesion('almacen');
    await a.goto(`${BASE}/ventas/pedidos/${idA}`, { waitUntil: 'networkidle' });
    ok(await a.locator('[data-numero-proforma]').count() === 1 && await a.locator('[data-accion="cambiar-numero"]').count() === 0, 'Almacén ve el número pero no «Cambiar número»');
    await a.context().close();
    const filas = await comoFilas(usuarios.almacen.id, `with u as (update pedidos set numero_proforma = 'PRB-NP-${SELLO}-Y' where id = ${idA} returning id) select count(*)::int n from u`);
    ok(Array.isArray(filas) && filas.at(-1)?.n === 0, 'y la base no le deja (0 filas)');
  }

  /* ======================================================================
     7 · LISTADO DE COTIZACIONES Y «CONTRATO» DE LA COTIZACIÓN
     ====================================================================== */
  console.log(SEC(7, 'Convertir desde el listado y desde «Contrato» de la cotización'));
  {
    await c.goto(`${BASE}/ventas/cotizaciones?buscar=${encodeURIComponent(cotB.numero)}`, { waitUntil: 'networkidle' });
    const fila = c.locator('tr', { hasText: cotB.numero });
    const boton = fila.locator('[data-accion="convertir"]');
    if (await boton.count()) {
      await boton.click();
      await c.waitForFunction((n) => [...document.querySelectorAll('tr')].find((t) => t.textContent.includes(n))?.querySelector('[data-campo="numero-proforma"]')?.value, cotB.numero, { timeout: 20000 });
      ok(await fila.locator('[data-campo="numero-proforma"]').inputValue() === await propuestaBD(), 'en el listado, «¿Convertir?» trae el N.º de proforma propuesto');
      await captura(c, '07-convertir-listado');
      await fila.locator('button', { hasText: 'No' }).click();
    } else ok(false, 'la cotización de prueba aparece en el listado con su botón Convertir');

    await c.goto(`${BASE}/ventas/cotizaciones/${cotB.id}/contrato`, { waitUntil: 'networkidle' });
    const campo = c.locator('[data-campo="numero-proforma"]');
    await c.waitForFunction(() => document.querySelector('[data-campo="numero-proforma"]')?.value, null, { timeout: 20000 });
    ok(await campo.inputValue() === await propuestaBD(), '«Generar la proforma y preparar el contrato» trae el campo con el propuesto');
    await campo.fill(NUM_C.toLowerCase());
    await c.click('[data-accion="proforma-y-contrato"]');
    await c.waitForURL(/\/ventas\/pedidos\/\d+\/contrato$/, { timeout: 30000 });
    const id = Number(c.url().match(/pedidos\/(\d+)\//)[1]);
    mios.ped.push(id);
    const [pd] = await consultar(`select numero_proforma n from pedidos where id = ${id}`);
    ok(pd.n === NUM_C, 'el número escrito a mano se respeta (normalizado)', pd.n);
    ok(await ultimoBD() === nSerie(numPropuestoB), 'y no mueve el contador');
  }

  /* ======================================================================
     8 · LAS REGLAS EN LA BASE (transacciones que se deshacen)
     ====================================================================== */
  console.log(SEC(8, 'Reglas del contador en la base'));
  {
    const u = await ultimoBD();
    const ins = (num) => `insert into pedidos (numero_proforma, cliente_id, tipo_cambio, ciclo, creado_por, tipo_despacho) values ('${num}', ${mios.cli}, 3.7, 'borrador', '${usuarios.gerencia.id}', 'exportacion')`;
    const r1 = await comoFilas(usuarios.gerencia.id, `${ins(serie(u + 40))}; select (select ultimo from correlativos where serie='SM' and anio=${anio}) u, proponer_numero_proforma() p`);
    ok(r1.at(-1)?.u === u + 40 && r1.at(-1)?.p === serie(u + 41), 'un número de la serie mayor, escrito a mano, hace saltar el contador (no se repetirá)', JSON.stringify(r1.at(-1)));
    const r2 = await comoFilas(usuarios.gerencia.id, `${ins(serie(u + 1))}; ${ins(serie(u + 2))}; reset role; update correlativos set ultimo = ${u} where serie='SM' and anio=${anio}; select (select ultimo from correlativos where serie='SM' and anio=${anio}) u, proponer_numero_proforma() p`);
    ok(r2.at(-1)?.u === u && r2.at(-1)?.p === serie(u + 3), 'si el siguiente ya lo usa un pedido, la propuesta lo salta', JSON.stringify(r2.at(-1)));
    const e3 = await intentar(`begin; ${ins(`SM${AA}-0${u + 7}`)}; ${ins(`sm${AA}-${u + 7}`)}; rollback;`);
    ok(/Ya existe la proforma/.test(e3 ?? ''), `SM${AA}-0${u + 7} y sm${AA}-${u + 7} son el mismo número (ceros, mayúsculas)`);
    const [n4] = await consultar(`select normalizar_numero_proforma(' sm${AA} - 26 ') n`);
    ok(n4.n === `SM${AA}-026`, 'en la serie, tres cifras como mínimo, como las escribe Santa Mónica', n4.n);
    const e5 = await como(usuarios.gerencia.id, `select fijar_proximo_numero_proforma(${nSerie(otro.numero_proforma) || 1})`);
    ok(!nSerie(otro.numero_proforma) || /ya es la proforma de/.test(e5 ?? ''), 'Configuración no acepta como próximo un número ya usado');
    const e6 = await intentar(`begin; ${ins('')}; rollback;`);
    const e7 = await intentar(`begin; ${ins('X'.repeat(31) + '1')}; rollback;`);
    const e8 = await intentar(`begin; ${ins('PROFORMA')}; rollback;`);
    ok(/Escriba el número/.test(e6 ?? '') && /hasta 30 caracteres/.test(e7 ?? '') && /al menos una cifra/.test(e8 ?? ''), 'vacío, largo y sin cifras: rechazados con su motivo');
  }
} catch (e) {
  ok(false, 'la prueba se interrumpió', String(e?.stack ?? e).slice(0, 600));
} finally {
  await limpiar();
  await nav.close();
}

if (errores.length) console.log(`\nErrores de página:\n - ${errores.join('\n - ')}`);
console.log(fallos.length ? `\n${fallos.length} FALLO(S):\n - ${fallos.join('\n - ')}` : '\nTodo correcto');
process.exit(fallos.length ? 1 : 0);

/* ==========================================================================
   LIMPIEZA: solo lo que creó esta prueba (sin tocar la auditoría ni el Kardex)
   ========================================================================== */
async function limpiar() {
  try {
    const cli = mios.cli ?? 0;
    const peds = (await consultar(`select id from pedidos where id > ${prev.ped} and cliente_id = ${cli}`)).map((x) => x.id);
    const cots = (await consultar(`select id from cotizaciones where id > ${prev.cot} and cliente_id = ${cli}`)).map((x) => x.id);
    const arr = (xs) => `array[${xs.join(',') || 0}]::bigint[]`;
    console.log(`\n  limpieza: ${peds.length} pedido(s), ${cots.length} cotización(es), cliente ${cli || '—'}`);
    if (mios.fac.length) {
      await ejecutarSQL(`begin; set local session_replication_role = replica; delete from facturas where numero = any(array['${mios.fac.join("','")}']) and pedido_id = any(${arr(peds)}); commit;`);
    }
    await ejecutarSQL(`
      delete from contratos where pedido_id = any(${arr(peds)}) or cotizacion_id = any(${arr(cots)});
      delete from pedido_cuentas where pedido_id = any(${arr(peds)});
      delete from pedido_lineas where pedido_id = any(${arr(peds)});
      delete from pedidos where id = any(${arr(peds)});
      delete from cotizacion_cuentas where cotizacion_id = any(${arr(cots)});
      delete from cotizacion_lineas where cotizacion_id = any(${arr(cots)});
      delete from cotizaciones where id = any(${arr(cots)});
      ${cli ? `delete from contactos where cliente_id = ${cli}; delete from clientes where id = ${cli};` : ''}
      delete from eventos where id > ${prev.ev} and (
        (entidad = 'pedidos' and entidad_id = any(${arr(peds)}))
        or (entidad = 'cotizaciones' and entidad_id = any(${arr(cots)}))
        or (entidad = 'clientes' and entidad_id = ${cli || 0})
        or (entidad = 'correlativos' and tipo = 'numeracion_proforma_fijada' and usuario_id in ('${usuarios.gerencia.id}', '${usuarios.operaciones.id}')));
      delete from alertas where id > ${prev.al} and (
        (entidad = 'pedidos' and entidad_id = any(${arr(peds)})) or (entidad in ('clientes', 'cliente') and entidad_id = ${cli || 0}));
    `);
    /*
     * El contador, como estaba: lo de antes o, si mientras tanto alguien de
     * verdad guardó un pedido de la serie, hasta ese número.
     */
    if (tocoCorrelativo || mios.ped.length) {
      await ejecutarSQL(`
        update correlativos set
          ultimo = greatest(${Number(corr?.ultimo ?? 0)}, coalesce((
            select max((regexp_match(normalizar_numero_proforma(numero_proforma), '^SM\\d{2}-(\\d{1,6})$'))[1]::int)
              from pedidos where normalizar_numero_proforma(numero_proforma) like 'SM${AA}-%' and id > ${prev.ped}), 0)),
          actualizado_en = ${corr?.actualizado_en ? `'${corr.actualizado_en}'` : 'null'},
          actualizado_por = ${corr?.actualizado_por ? `'${corr.actualizado_por}'` : 'null'}
        where serie = 'SM' and anio = ${anio}`);
    }
    const [{ n }] = await consultar(`select count(*)::int n from pedidos where numero_proforma like 'PRB-NP-${SELLO}%' or cliente_id = ${cli || 0}`);
    const [c2] = await consultar(`select ultimo, actualizado_en::text, actualizado_por::text from correlativos where serie = 'SM' and anio = ${anio}`);
    ok(n === 0 && Number(c2.ultimo) === Number(corr.ultimo) && (c2.actualizado_por ?? null) === (corr.actualizado_por ?? null),
      'limpieza: pedidos, cotizaciones y cliente de la prueba borrados; el contador como estaba', `último ${c2.ultimo}`);
    const [{ au }] = await consultar(`select count(*)::int au from auditoria where id > ${prev.au} and (
      (tabla = 'pedidos' and registro_id = any(array[${peds.map((x) => `'${x}'`).join(',') || "''"}]))
      or (tabla in ('pedido_lineas','cotizaciones','cotizacion_lineas','contratos','clientes') and (datos_despues::text like '%PRUEBA-NP%' or datos_antes::text like '%PRUEBA-NP%' or datos_despues::text like '%PRB-NP-${SELLO}%' or datos_antes::text like '%PRB-NP-${SELLO}%')))`);
    console.log(`  auditoría: quedan ${au} fila(s) de lo que creó y borró la prueba (no se borran: es la bitácora)`);
  } catch (e) {
    ok(false, 'limpieza', String(e.message).slice(0, 300));
  }
}
