/**
 * ============================================================================
 *  PRUEBA · LA PROGRAMACIÓN DE EMBARQUES («Observaciones ERP 4», migración 084)
 * ============================================================================
 *  Área B · Logística, puntos 07, 08, 09, 10, 11 y el N.º de packing del 13.
 *  En el navegador y comprobado en la base:
 *
 *    1. En la base (transacciones que se deshacen): cómo se escribe el PL, la
 *       propuesta salta los usados, el contador avanza con uno mayor escrito a
 *       mano, repetidos rechazados (entre embarques y contra el contenedor de
 *       otro embarque), zarpe antes del despacho rechazado, semana 1–53 y
 *       automática, solo Gerencia/Operaciones fijan la numeración, Comercial
 *       no escribe en embarques pero sí sube documentos y comenta.
 *    2. «Programar embarque»: semana (sale sola de la fecha), fecha de zarpe
 *       (no antes del despacho), operador logístico, N.º de packing propuesto
 *       y editable, y la etiqueta y el packing declarado subidos al programar.
 *    3. Ficha: los datos nuevos; «Documentos del embarque» con versiones
 *       (vigente + anteriores), «Ver»/«Descargar», «Quitar»; comentarios (y un
 *       corte de red al comentar no pierde lo escrito); Comercial sube la
 *       etiqueta y comenta pero no edita; Consulta solo mira.
 *    4. «Editar embarque»: PL repetido rechazado, zarpe y operador cambiados,
 *       PL cambiado con su evento en el historial.
 *    5. «Nuevo contenedor»: nace con el PL del embarque; «Cambiar N.º» en el
 *       packing cambia también el del embarque; los dos en el historial.
 *    6. La lista de programación (Embarques y Planificador › Lista): columnas,
 *       filtros por columna (texto y desplegable), orden, filtros en la
 *       dirección; Excel y PDF con lo que se ve; Calidad no descarga.
 *    7. Embarque despachado: «Corregir programación» solo deja semana, zarpe,
 *       operador y PL.
 *
 *  La base es la de PRODUCCIÓN. La prueba crea SUS cosas (cliente
 *  «PRUEBA-OBS4 …», pedido «PRB-OBS4-…», embarques con PL «PRB OBS4 …») y las
 *  borra en `finally` con sus archivos, eventos y alertas. No reserva, no
 *  carga pallets y no despacha (nada toca el stock ni el Kardex) y NO borra
 *  filas de auditoría. La numeración PL vuelve a como estaba.
 *
 *      BASE_URL=http://localhost:3010 node scripts/probar-logistica-obs4.mjs
 *      (CAPTURAS=carpeta para guardar las pantallas)
 * ============================================================================
 */
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createClient } from '@supabase/supabase-js';
import { ejecutarSQL } from './db.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3010';
const CLAVE = process.env.CLAVE_DEMO ?? (() => {
  try { return (/^CLAVE_DEMO=(.*)$/m.exec(readFileSync('.env.local', 'utf8'))?.[1] ?? '').trim(); } catch { return ''; }
})();
const consultar = async (sql) => { const r = await ejecutarSQL(sql); return Array.isArray(r) ? r : []; };
const intentar = async (sql) => { try { await ejecutarSQL(sql); return null; } catch (e) { return String(e.message); } };
const SEC = (n, t) => console.log(`\n${'─'.repeat(3)} ${n} · ${t} ${'─'.repeat(3)}`);
const fallos = [];
const ok = (cond, texto, detalle = '') => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${texto}${detalle ? ' · ' + String(detalle).slice(0, 160) : ''}`);
  if (!cond) fallos.push(texto);
};
const CARPETA = process.env.CAPTURAS ?? join(tmpdir(), 'probar-logistica-obs4');
mkdirSync(CARPETA, { recursive: true });
const captura = async (p, nombre) => { if (process.env.CAPTURAS) await p.screenshot({ path: join(CARPETA, `${nombre}.png`), fullPage: true }); };

const SELLO = String(Date.now()).slice(-5);
const RAZON = `PRUEBA-OBS4 ${SELLO} SAC`;
const PROFORMA = `PRB-OBS4-${SELLO}`;
const PL = (x) => `PRB OBS4 ${SELLO}-${x}`;
const OPERADOR = `PRUEBA OBS4 Operador ${SELLO}`;
const MSJ_SIN_CONEXION = 'Se perdió la conexión con el sistema';

/* ---- Lo que hay antes, para devolverlo todo ---- */
const [prev] = await consultar(`
  select (select coalesce(max(id),0) from eventos) ev, (select coalesce(max(id),0) from auditoria) au,
         (select coalesce(max(id),0) from alertas) al, (select coalesce(max(id),0) from embarques) emb,
         (select coalesce(max(id),0) from pedidos) ped, (select coalesce(max(id),0) from clientes) cli,
         (select coalesce(max(id),0) from packing_lists) pk,
         (select coalesce(max(id),0) from embarque_archivos) arc, (select coalesce(max(id),0) from embarque_comentarios) com`);
const [corrEMB] = await consultar(`select anio, ultimo from correlativos where serie = 'EMB' and anio = extract(year from (now() at time zone 'America/Lima'))::int`);
const [corrPL] = await consultar(`select ultimo, actualizado_en::text, actualizado_por::text from correlativos where serie = 'PL' and anio = 0`);
const [fechas] = await consultar(`
  select ((now() at time zone 'America/Lima')::date + 3)::text despacho, ((now() at time zone 'America/Lima')::date + 7)::text zarpe,
         ((now() at time zone 'America/Lima')::date + 1)::text antes, extract(week from (now() at time zone 'America/Lima')::date + 3)::int semana,
         to_char((now() at time zone 'America/Lima')::date + 3, 'YYYY-MM') mes`);
const usuarios = Object.fromEntries((await consultar(`
  select split_part(email, '@', 1) k, id::text, nombre from usuarios
   where email in ('gerencia@santamonica.pe','operaciones@santamonica.pe','comercial@santamonica.pe','comex@santamonica.pe','almacen@santamonica.pe','consulta@santamonica.pe','calidad@santamonica.pe')`))
  .map((u) => [u.k, u]));
const como = (u, sql) => intentar(`begin; select set_config('request.jwt.claims', '{"sub":"${u}","role":"authenticated"}', true); set local role authenticated; ${sql}; rollback;`);
const enTx = (sql) => intentar(`begin; ${sql}; rollback;`);
const propuestaBD = async () => (await consultar(`select proponer_numero_packing() p`))[0].p;
const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/* ---- Archivos de prueba ---- */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const archivoEtiqueta = join(CARPETA, `etiqueta-prueba-${SELLO}.png`);
writeFileSync(archivoEtiqueta, PNG);
const archivoPdf = join(CARPETA, `packing-declarado-v2-${SELLO}.pdf`);
writeFileSync(archivoPdf, '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const archivoXlsx = join(CARPETA, `packing-declarado-${SELLO}.xlsx`);
{
  const libro = new ExcelJS.Workbook();
  libro.addWorksheet('Packing').addRows([['PALLET', 'BULTOS', 'KG'], ['PRB 001', 48, 960]]);
  writeFileSync(archivoXlsx, Buffer.from(await libro.xlsx.writeBuffer()));
}

const nav = await chromium.launch({ channel: 'chrome', headless: true });
const errores = [];
async function sesion(correo) {
  const ctx = await nav.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errores.push(`${correo}: ${e.message}`));
  //  Los avisos de React (hidratación…) son el «1 Issue» rojo de Next: también cuentan.
  p.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|internetdisconnected|ERR_INTERNET_DISCONNECTED|La acción no llegó al servidor/.test(m.text())) {
      errores.push(`${correo} consola: ${m.text().slice(0, 400)}`);
    }
  });
  p.on('dialog', (d) => { errores.push(`${correo}: diálogo «${d.message().slice(0, 120)}»`); void d.dismiss(); });
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', `${correo}@santamonica.pe`);
  await p.fill('input[type="password"]', CLAVE);
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/panel/, { timeout: 60000 });
  return p;
}
const mios = { cli: null, ped: null, emb: [], pk: [] };
let tocoContador = false;

try {
  /* ---- Lo que la prueba necesita: un cliente y un pedido suyos (sin reservas) ---- */
  const [cli] = await consultar(`insert into clientes (codigo, razon_social, pais, moneda) values ('PRB-OBS4-${SELLO}', '${RAZON}', 'Chile', 'USD') returning id`);
  mios.cli = cli.id;
  const [sp] = await consultar(`select sp.id from sku_presentaciones sp join skus s on s.id = sp.sku_id where sp.activo and s.activo order by sp.id limit 1`);
  const [ped] = await consultar(`insert into pedidos (numero_proforma, cliente_id, tipo_cambio, creado_por, moneda) values ('${PROFORMA}', ${cli.id}, 3.45, '${usuarios.gerencia.id}', 'USD') returning id`);
  mios.ped = ped.id;
  await consultar(`insert into pedido_lineas (pedido_id, sku_presentacion_id, cantidad_tm, precio_tm, orden) values (${ped.id}, ${sp.id}, 2, 2000, 1)`);
  const [alm] = await consultar(`select id, nombre from almacenes where activo order by orden, nombre limit 1`);
  const [dst] = await consultar(`select id, puerto from destinos where activo order by puerto limit 1`);

  /* ======================================================================
     1 · EN LA BASE
     ====================================================================== */
  SEC(1, 'Reglas en la base (transacciones que se deshacen)');
  {
    const [n] = await consultar(`select normalizar_numero_packing('  pl   pot26 ') a, normalizar_numero_packing('plpot1124') b, normalizar_numero_packing('pl bon 497') c,
                                        clave_numero_packing('PL POT 1124') = clave_numero_packing('PLPOT1124') d`);
    ok(n.a === 'PL POT026' && n.b === 'PL POT1124' && n.c === 'PL BON 497' && n.d, 'el PL se normaliza (mayúsculas, un espacio, PL POT con 3 cifras) y «PL POT 1124» = «PLPOT1124»', JSON.stringify(n));
    const p0 = await propuestaBD();
    ok(/^PL POT\d{3,}$/.test(p0), 'la base propone el siguiente de la serie PL POT', p0);
    const nP0 = Number(p0.replace('PL POT', ''));
    // Un embarque con el propuesto: la propuesta salta a la siguiente; uno mayor escrito a mano mueve el contador.
    const r1 = await ejecutarSQL(`begin;
      insert into embarques (numero, fecha_programada, almacen_id, tipo_despacho, estado, creado_por, numero_packing)
      values ('PRB-OBS4-TX1', '${fechas.despacho}', ${alm.id}, 'mercado_nacional', 'planificado', '${usuarios.gerencia.id}', '${p0}');
      select proponer_numero_packing() p; rollback;`).catch((e) => [{ p: 'ERROR ' + e.message }]);
    ok(r1[0]?.p === `PL POT${String(nP0 + 1).padStart(3, '0')}`, 'la propuesta salta el número ya usado', r1[0]?.p);
    const r2 = await ejecutarSQL(`begin;
      insert into embarques (numero, fecha_programada, almacen_id, tipo_despacho, estado, creado_por, numero_packing)
      values ('PRB-OBS4-TX2', '${fechas.despacho}', ${alm.id}, 'mercado_nacional', 'planificado', '${usuarios.gerencia.id}', 'PL POT${nP0 + 500}');
      select proponer_numero_packing() p, (select semana_despacho from embarques where numero = 'PRB-OBS4-TX2') s; rollback;`).catch((e) => [{ p: e.message }]);
    ok(r2[0]?.p === `PL POT${nP0 + 501}`, 'escribir a mano uno mayor de la serie hace seguir la numeración desde ahí', r2[0]?.p);
    ok(Number(r2[0]?.s) === fechas.semana, 'la semana de despacho sale sola de la fecha', `${r2[0]?.s} = ${fechas.semana}`);

    const eZarpe = await enTx(`insert into embarques (numero, fecha_programada, fecha_zarpe, almacen_id, tipo_despacho, estado, creado_por)
      values ('PRB-OBS4-TX3', '${fechas.despacho}', '${fechas.antes}', ${alm.id}, 'mercado_nacional', 'planificado', '${usuarios.gerencia.id}')`);
    ok(/no puede ser antes del despacho programado/.test(eZarpe ?? ''), 'la base rechaza un zarpe antes del despacho, con su motivo', eZarpe?.slice(0, 140));
    const eSemana = await enTx(`insert into embarques (numero, fecha_programada, semana_despacho, almacen_id, tipo_despacho, estado, creado_por)
      values ('PRB-OBS4-TX4', '${fechas.despacho}', 54, ${alm.id}, 'mercado_nacional', 'planificado', '${usuarios.gerencia.id}')`);
    ok(/entre 1 y 53/.test(eSemana ?? ''), 'la base rechaza una semana fuera de 1–53', eSemana?.slice(0, 100));
    const eDup = await enTx(`
      insert into embarques (numero, fecha_programada, almacen_id, tipo_despacho, estado, creado_por, numero_packing)
      values ('PRB-OBS4-TX5', '${fechas.despacho}', ${alm.id}, 'mercado_nacional', 'planificado', '${usuarios.gerencia.id}', '${PL('X')}');
      insert into embarques (numero, fecha_programada, almacen_id, tipo_despacho, estado, creado_por, numero_packing)
      values ('PRB-OBS4-TX6', '${fechas.despacho}', ${alm.id}, 'mercado_nacional', 'planificado', '${usuarios.gerencia.id}', '${PL('X').toLowerCase().replace(' ', '  ')}')`);
    ok(/ya lo tiene el embarque PRB-OBS4-TX5/.test(eDup ?? ''), 'un PL repetido (sin importar mayúsculas ni espacios) se rechaza diciendo qué embarque lo tiene', eDup?.slice(0, 140));
    const eCont = await enTx(`
      insert into embarques (id, numero, fecha_programada, almacen_id, tipo_despacho, estado, creado_por)
      values (-901, 'PRB-OBS4-TX7', '${fechas.despacho}', ${alm.id}, 'mercado_nacional', 'planificado', '${usuarios.gerencia.id}');
      insert into packing_lists (codigo, embarque_id, filas_contenedor, sacos_por_fila, estado, creado_por, turno)
      values ('${PL('Y')}', -901, 22, 61, 'abierto', '${usuarios.gerencia.id}', 'dia');
      insert into embarques (numero, fecha_programada, almacen_id, tipo_despacho, estado, creado_por, numero_packing)
      values ('PRB-OBS4-TX8', '${fechas.despacho}', ${alm.id}, 'mercado_nacional', 'planificado', '${usuarios.gerencia.id}', '${PL('Y')}')`);
    ok(/ya lo lleva un contenedor del embarque PRB-OBS4-TX7/.test(eCont ?? ''), 'el PL del contenedor de OTRO embarque tampoco se puede usar', eCont?.slice(0, 140));
    const eCom = await como(usuarios.comercial.id, `select fijar_proximo_numero_packing(5000)`);
    ok(/corresponde a Gerencia u Operaciones/.test(eCom ?? ''), 'Comercial no puede fijar la numeración de packing', eCom?.slice(0, 120));
    //  Una escritura bloqueada por RLS no da error: cambia 0 filas. Se cuenta dentro de la transacción.
    const eComEmb = await como(usuarios.comercial.id, `do $$ declare n int; begin
      update embarques set operador_logistico = 'x' where id = (select max(id) from embarques);
      get diagnostics n = row_count; if n > 0 then raise exception 'ESCRIBIO %', n; end if; end $$`);
    ok(eComEmb === null, 'Comercial no puede escribir en los embarques (la política dice que no)', eComEmb ?? '0 filas');
  }

  /* ======================================================================
     2 · PROGRAMAR EMBARQUE
     ====================================================================== */
  SEC(2, '«Programar embarque»: semana, zarpe, operador, N.º de packing y documentos');
  const x = await sesion('comex');
  let embA;
  {
    const p0 = await propuestaBD();
    await x.goto(`${BASE}/logistica/embarques/nuevo`, { waitUntil: 'networkidle' });
    const pl = x.locator('input[name="numero_packing"]');
    ok(await pl.inputValue() === p0, 'el N.º de packing viene con el propuesto de la base', p0);
    ok(/Propuesto por el sistema/.test(await x.locator('[data-aviso-pl]').innerText()), 'y dice que es el propuesto');
    await pl.fill(`PL POT${Number(p0.replace('PL POT', '')) + 40}`);
    ok(/la numeración seguirá desde/.test(await x.locator('[data-aviso-pl]').innerText()), 'uno mayor de la serie avisa que la numeración seguirá desde ahí');

    await x.fill('input[name="fecha_programada"]', fechas.despacho);
    ok(Number(await x.locator('input[name="semana_despacho"]').inputValue()) === fechas.semana, 'al poner la fecha, la semana se calcula sola', String(fechas.semana));
    await x.locator('label.form-campo', { hasText: 'Tipo' }).locator('select').first().selectOption('exportacion');
    await x.locator('label.form-campo', { hasText: 'Destino' }).locator('select').selectOption(String(dst.id));
    await x.fill('input[name="fecha_zarpe"]', fechas.antes);
    ok(/No puede ser antes del despacho/.test(await x.locator('label.form-campo', { hasText: 'Fecha de zarpe' }).innerText()), 'un zarpe antes del despacho se avisa al escribirlo');
    await x.fill('input[name="fecha_zarpe"]', fechas.zarpe);
    await x.fill('input[name="operador_logistico"]', OPERADOR);
    await pl.fill(`  ${PL('A').toLowerCase()}  `);
    await pl.blur();
    ok(await pl.inputValue() === PL('A'), 'el PL escrito se normaliza al salir del campo', await pl.inputValue());
    await x.setInputFiles('input[name="documento_etiqueta"]', archivoEtiqueta);
    await x.setInputFiles('input[name="documento_packing_declarado"]', archivoXlsx);
    await x.fill('input[name="comentario_documentos"]', 'PRUEBA etiqueta aprobada');
    await captura(x, '01-programar');
    await x.locator('button[type="submit"]', { hasText: /Programar embarque/ }).click();
    await x.waitForURL(/\/logistica\/embarques\/\d+$/, { timeout: 60000 });
    embA = Number(x.url().match(/(\d+)$/)[1]);
    mios.emb.push(embA);
    const [e] = await consultar(`select numero, numero_packing, semana_despacho, fecha_zarpe::text z, operador_logistico o from embarques where id = ${embA}`);
    ok(e.numero_packing === PL('A') && Number(e.semana_despacho) === fechas.semana && e.z === fechas.zarpe && e.o === OPERADOR,
      'se guardan PL, semana, zarpe y operador', JSON.stringify(e));
    const docs = await consultar(`select tipo, tipo_mime, comentario, subido_por::text u from embarque_archivos where embarque_id = ${embA} order by tipo`);
    ok(docs.length === 2 && docs.some((d) => d.tipo === 'etiqueta' && d.tipo_mime === 'image/png') && docs.some((d) => d.tipo === 'packing_declarado' && /sheet/.test(d.tipo_mime)) && docs.every((d) => d.u === usuarios.comex.id && d.comentario === 'PRUEBA etiqueta aprobada'),
      'la etiqueta (PNG) y el packing declarado (Excel) se subieron al programar, con su comentario', JSON.stringify(docs.map((d) => d.tipo + ':' + d.tipo_mime.slice(0, 22))));
    const [ev] = await consultar(`select count(*)::int n from eventos where id > ${prev.ev} and entidad = 'embarques' and entidad_id = ${embA} and tipo = 'embarque_documento'`);
    ok(ev.n === 2, 'cada documento queda en el historial', String(ev.n));
  }

  /* ======================================================================
     3 · LA FICHA: DATOS, DOCUMENTOS, COMENTARIOS Y QUIÉN PUEDE QUÉ
     ====================================================================== */
  SEC(3, 'Ficha del embarque: datos, documentos con versiones y comentarios');
  {
    await x.waitForLoadState('networkidle');
    ok((await x.locator('[data-numero-packing]').innerText()).trim() === PL('A'), 'la ficha muestra el N.º de packing');
    ok((await x.locator('[data-zarpe]').innerText()).includes(ddmm(fechas.zarpe)) && (await x.locator('[data-semana]').innerText()).trim() === String(fechas.semana),
      'y la fecha de zarpe y la semana de despacho, por separado');
    ok((await x.locator('[data-operador]').innerText()).trim() === OPERADOR, 'y el operador logístico');
    const tarjeta = x.locator('[data-documento="packing_declarado"]');
    ok(await tarjeta.getAttribute('data-versiones') === '1' && (await tarjeta.innerText()).includes(`packing-declarado-${SELLO}.xlsx`), 'la tarjeta del packing declarado tiene su Excel vigente');
    ok(await tarjeta.locator('[data-descargar]').count() === 1 && await tarjeta.locator('[data-ver]').count() === 0, 'un Excel se descarga (no se «ve» en el navegador)');
    ok(await x.locator('[data-documento="etiqueta"] [data-ver]').count() === 1, 'la etiqueta (imagen) se puede ver');
    // Nueva versión del packing declarado, en PDF.
    await tarjeta.locator('input[name="comentario-packing_declarado"]').fill('PRUEBA corregido el peso declarado');
    await tarjeta.locator('input[type="file"]').setInputFiles(archivoPdf);
    await x.locator('[data-aviso="documento-packing_declarado"]').waitFor({ timeout: 30000 });
    const tv = await x.locator('[data-aviso="documento-packing_declarado"]').innerText();
    ok(/versión 2: es la vigente/.test(tv), 'una nueva versión se sube y queda como vigente', tv);
    await x.waitForTimeout(1500);
    await x.reload({ waitUntil: 'networkidle' });
    const t2 = x.locator('[data-documento="packing_declarado"]');
    ok(await t2.getAttribute('data-versiones') === '2' && (await t2.locator('.docs-fila').first().innerText()).includes(`packing-declarado-v2-${SELLO}.pdf`)
      && /Vigente · versión 2/.test(await t2.innerText()), 'arriba la versión 2 (vigente) y la anterior se guarda');
    await t2.locator('.docs-anteriores-boton').click();
    ok((await t2.locator('.docs-anteriores').innerText()).includes(`packing-declarado-${SELLO}.xlsx`), '«Ver 1 versión anterior» muestra la primera');
    const dl = await x.request.get(await t2.locator('[data-descargar]').first().getAttribute('href'));
    ok(dl.ok() && (await dl.body()).toString('latin1').startsWith('%PDF'), '«Descargar» baja el archivo de verdad');

    // Comentario, con un corte de red primero.
    const caja = x.locator('textarea[name="comentario_embarque"]');
    await caja.fill('PRUEBA OBS4: SANIPES pidió corregir el peso declarado');
    let cortes = 0;
    await x.route(`**/logistica/embarques/${embA}*`, async (r) => {
      if (r.request().method() === 'POST' && cortes === 0) { cortes++; await r.abort('internetdisconnected'); } else await r.continue();
    });
    await x.click('[data-accion="comentar"]');
    await x.locator('[data-aviso="comentario"]').filter({ hasText: MSJ_SIN_CONEXION }).waitFor({ timeout: 20000 }).catch(() => null);
    ok(await x.locator('[data-aviso="comentario"]').filter({ hasText: MSJ_SIN_CONEXION }).count() === 1 && (await caja.inputValue()).includes('SANIPES'),
      'un corte de red al comentar avisa y no pierde lo escrito');
    await x.unroute(`**/logistica/embarques/${embA}*`);
    await x.click('[data-accion="comentar"]');
    await x.locator('[data-aviso="comentario"]').filter({ hasText: 'Comentario agregado' }).waitFor({ timeout: 20000 });
    await x.locator('[data-bloque="comentarios-embarque"] .docs-hilo').filter({ hasText: 'SANIPES pidió corregir' }).waitFor({ timeout: 20000 }).catch(() => null);
    const hilo = await x.locator('[data-bloque="comentarios-embarque"]').innerText();
    ok(hilo.includes('SANIPES pidió corregir') && hilo.includes(usuarios.comex.nombre), 'el comentario aparece en la bitácora con su autor', usuarios.comex.nombre);
    await captura(x, '02-ficha-documentos');

    // Comercial: ve la ficha, sube la etiqueta y comenta; no edita.
    const c = await sesion('comercial');
    await c.goto(`${BASE}/logistica/embarques/${embA}`, { waitUntil: 'networkidle' });
    ok(/\/logistica\/embarques\/\d+$/.test(c.url()) && await c.locator('[data-bloque="documentos-embarque"]').count() === 1, 'Comercial entra a la ficha del embarque (Embarques ya está en su menú)');
    ok(await c.locator('[data-accion="editar-embarque"]').count() === 0, 'Comercial no ve «Editar embarque»');
    ok(await c.locator('[data-documento="etiqueta"] button', { hasText: 'Quitar' }).count() === 0, 'Comercial no puede quitar la etiqueta que subió otro');
    await c.locator('[data-documento="etiqueta"] input[type="file"]').setInputFiles(archivoEtiqueta);
    await c.locator('[data-aviso="documento-etiqueta"]').waitFor({ timeout: 30000 });
    const tc = await c.locator('[data-aviso="documento-etiqueta"]').innerText();
    ok(/versión 2/.test(tc), 'Comercial sube una nueva etiqueta (el repositorio se lo permite)', tc);
    await c.waitForTimeout(1200);
    await c.reload({ waitUntil: 'networkidle' });
    ok(await c.locator('[data-documento="etiqueta"] .docs-fila').first().locator('button', { hasText: 'Quitar' }).count() === 1, 'y puede quitar la suya');
    await c.locator('textarea[name="comentario_embarque"]').fill('PRUEBA OBS4 comercial: el cliente aprobó la etiqueta');
    await c.click('[data-accion="comentar"]');
    await c.locator('[data-aviso="comentario"]').filter({ hasText: 'Comentario agregado' }).waitFor({ timeout: 20000 });
    const [nc] = await consultar(`select count(*)::int n from embarque_comentarios where embarque_id = ${embA}`);
    ok(nc.n === 2, 'Comercial comenta', String(nc.n));
    await c.goto(`${BASE}/logistica/embarques`, { waitUntil: 'networkidle' });
    ok(await c.locator('[data-bloque="programacion"]').count() === 1 && await c.locator('a', { hasText: 'Programar embarque' }).count() === 0, 'Comercial ve la programación, sin «Programar embarque»');
    await c.context().close();

    const q = await sesion('consulta');
    await q.goto(`${BASE}/logistica/embarques/${embA}`, { waitUntil: 'networkidle' });
    ok(await q.locator('[data-bloque="documentos-embarque"] input[type="file"]').count() === 0 && await q.locator('textarea[name="comentario_embarque"]').count() === 0
      && /los suben Gerencia, Operaciones, Comercial/.test(await q.locator('[data-bloque="documentos-embarque"]').innerText()),
      'Consulta ve los documentos y comentarios, sin subir ni comentar, y se le dice quién puede');
    const eConsulta = await como(usuarios.consulta.id, `insert into embarque_comentarios (embarque_id, texto, autor_id) values (${embA}, 'x', '${usuarios.consulta.id}')`);
    ok(/row-level security|violates/.test(eConsulta ?? ''), 'y la base no le deja comentar');
    await q.context().close();
  }

  /* ======================================================================
     4 · EDITAR EMBARQUE
     ====================================================================== */
  SEC(4, '«Editar embarque»: zarpe, operador y N.º de packing');
  let embB;
  {
    [{ id: embB }] = await consultar(`insert into embarques (numero, fecha_programada, almacen_id, destino_id, tipo_despacho, estado, creado_por, numero_packing, operador_logistico, booking, naviera)
      values ('PRB-OBS4-${SELLO}B', '${fechas.despacho}', ${alm.id}, ${dst.id}, 'exportacion', 'planificado', '${usuarios.gerencia.id}', '${PL('B')}', 'PRUEBA OBS4 Otro operador', 'PRBBOOK${SELLO}', 'PRUEBA NAVIERA') returning id`);
    mios.emb.push(embB);
    await consultar(`insert into embarque_pedidos (embarque_id, pedido_id) values (${embB}, ${mios.ped})`);

    await x.goto(`${BASE}/logistica/embarques/${embA}`, { waitUntil: 'networkidle' });
    await x.click('[data-accion="editar-embarque"]');
    await x.fill('input[name="numero_packing"]', PL('B'));
    await x.click('[data-accion="guardar-embarque"]');
    await x.locator('[data-aviso="editar-embarque"]').waitFor({ timeout: 20000 });
    const tRep = await x.locator('[data-aviso="editar-embarque"]').innerText();
    ok(new RegExp(`ya lo tiene el embarque PRB-OBS4-${SELLO}B`).test(tRep), 'un PL de otro embarque se rechaza diciendo cuál', tRep);
    await x.fill('input[name="numero_packing"]', PL('C'));
    await x.fill('input[name="fecha_zarpe"]', fechas.despacho);
    await x.fill('input[name="operador_logistico"]', `${OPERADOR} bis`);
    await x.click('[data-accion="guardar-embarque"]');
    await x.locator('[data-aviso="editar-embarque"]').filter({ hasText: 'Cambios guardados' }).waitFor({ timeout: 20000 });
    const tOk = await x.locator('[data-aviso="editar-embarque"]').innerText();
    ok(/fecha de zarpe/.test(tOk) && /operador logístico/.test(tOk) && /N\.º de packing/.test(tOk), 'se guardan y el mensaje dice qué cambió', tOk);
    const [e] = await consultar(`select numero_packing, fecha_zarpe::text z, operador_logistico o from embarques where id = ${embA}`);
    ok(e.numero_packing === PL('C') && e.z === fechas.despacho && e.o === `${OPERADOR} bis`, 'en la base', JSON.stringify(e));
    const [ev] = await consultar(`select descripcion, usuario_id::text u from eventos where id > ${prev.ev} and entidad = 'embarques' and entidad_id = ${embA} and tipo = 'numero_packing_cambiado' order by id desc limit 1`);
    ok(ev && ev.u === usuarios.comex.id && ev.descripcion.includes(`de ${PL('A')} a ${PL('C')}`), 'el cambio de PL queda en el historial (quién, de cuál a cuál)', ev?.descripcion);
  }

  /* ======================================================================
     5 · NUEVO CONTENEDOR Y «CAMBIAR N.º» DEL PACKING
     ====================================================================== */
  SEC(5, '«Nuevo contenedor» nace con el PL; «Cambiar N.º» en el packing');
  {
    await x.goto(`${BASE}/logistica/embarques/${embA}`, { waitUntil: 'networkidle' });
    await x.locator('button', { hasText: 'Nuevo contenedor' }).click();
    ok(await x.locator('input[name="codigo_packing"]').inputValue() === PL('C'), 'el contenedor propone el PL del embarque', PL('C'));
    await x.locator('button', { hasText: 'Crear contenedor' }).click();
    await x.waitForURL(/\/logistica\/packing\/\d+$/, { timeout: 30000 });
    const pkId = Number(x.url().match(/(\d+)$/)[1]);
    mios.pk.push(pkId);
    const [pk] = await consultar(`select codigo, (select count(*)::int from packing_lineas where packing_list_id = ${pkId}) lineas from packing_lists where id = ${pkId}`);
    ok(pk.codigo === PL('C') && pk.lineas === 0, 'el contenedor se crea con ese código y sin pallets (la prueba no carga stock)', JSON.stringify(pk));
    await x.waitForLoadState('networkidle');
    await x.click('[data-accion="cambiar-numero-packing"]');
    await x.fill('input[name="nuevo_numero_packing"]', PL('B'));
    await x.click('[data-accion="guardar-numero-packing"]');
    await x.locator('[data-aviso="numero-packing"]').waitFor({ timeout: 20000 });
    ok(/ya lo tiene el embarque/.test(await x.locator('[data-aviso="numero-packing"]').innerText()), 'el packing tampoco acepta el PL de otro embarque');
    await x.fill('input[name="nuevo_numero_packing"]', PL('D').toLowerCase());
    await x.click('[data-accion="guardar-numero-packing"]');
    await x.locator('[data-aviso="numero-packing"]').filter({ hasText: 'Listo' }).waitFor({ timeout: 20000 });
    const [d] = await consultar(`select (select codigo from packing_lists where id = ${pkId}) pk, (select numero_packing from embarques where id = ${embA}) emb`);
    ok(d.pk === PL('D') && d.emb === PL('D'), 'cambia el del contenedor y también el del embarque (son el mismo packing)', JSON.stringify(d));
    const evs = await consultar(`select entidad, descripcion from eventos where id > ${prev.ev} and tipo = 'numero_packing_cambiado' and ((entidad = 'packing_lists' and entidad_id = ${pkId}) or (entidad = 'embarques' and entidad_id = ${embA})) order by id`);
    ok(evs.some((v) => v.entidad === 'packing_lists' && v.descripcion.includes(`de ${PL('C')} a ${PL('D')}`)) && evs.some((v) => v.entidad === 'embarques' && /desde su contenedor/.test(v.descripcion)),
      'los dos historiales lo cuentan', evs.map((v) => v.entidad).join(', '));
    await captura(x, '03-packing-cambiar-numero');
  }

  /* ======================================================================
     6 · LA LISTA DE PROGRAMACIÓN
     ====================================================================== */
  SEC(6, 'Lista de programación: filtros por columna, orden, Excel y PDF');
  {
    const g = await sesion('gerencia');
    await g.goto(`${BASE}/logistica/embarques`, { waitUntil: 'networkidle' });
    const cab = await g.locator('table[data-cuadro="programacion"] thead tr').first().innerText();
    ok(['Semana', 'Despacho programado', 'Zarpe', 'N.º de packing', 'Booking', 'Naviera', 'Operador logístico', 'Almacén de despacho'].every((t) => cab.toUpperCase().includes(t.toUpperCase())),
      'la lista tiene las columnas de su Excel', cab.replace(/\s+/g, ' ').slice(0, 160));
    ok(await g.locator(`tr[data-embarque="${embA}"]`).count() === 1 && await g.locator(`tr[data-embarque="${embB}"]`).count() === 1, 'los embarques de esta semana en adelante están en la lista');
    ok((await g.locator(`tr[data-embarque="${embA}"] [data-pl]`).innerText()).includes(PL('D')), 'con su N.º de packing');
    ok(await g.locator('[data-bloque="numeracion-packing"] [data-propuesto]').count() === 1, 'Gerencia ve el próximo N.º de packing y puede cambiarlo');

    // Filtro de texto (contiene, sin mayúsculas)
    await g.fill('input[name="f_pl"]', `obs4 ${SELLO}`);
    await g.waitForTimeout(900);
    ok(await g.locator('tbody tr[data-embarque]').count() === 2, 'filtro de texto en «N.º de packing»: quedan los 2 de la prueba', String(await g.locator('tbody tr[data-embarque]').count()));
    ok(new URL(g.url()).searchParams.get('f_pl') === `obs4 ${SELLO}`, 'el filtro queda en la dirección web');
    // Filtro de lista (operador)
    await g.locator('select[name="f_operador"]').selectOption(`${OPERADOR} bis`);
    await g.waitForTimeout(600);
    ok(await g.locator('tbody tr[data-embarque]').count() === 1 && await g.locator(`tr[data-embarque="${embA}"]`).count() === 1, 'desplegable de «Operador logístico»: queda solo el suyo');
    await g.locator('select[name="f_operador"]').selectOption('');
    await g.fill('input[name="f_clientes"]', 'prueba-obs4');
    await g.waitForTimeout(900);
    ok(await g.locator('tbody tr[data-embarque]').count() === 1 && await g.locator(`tr[data-embarque="${embB}"]`).count() === 1, 'filtro por cliente (el embarque con el pedido de prueba)');
    await g.fill('input[name="f_clientes"]', '');
    await g.waitForTimeout(900);
    // Orden por semana desc / por naviera
    await g.locator('thead button.prog-orden', { hasText: 'Naviera' }).click();
    await g.waitForTimeout(800);
    ok(new URL(g.url()).searchParams.get('orden') === 'naviera', 'pulsar un título ordena por esa columna (y queda en la dirección)');
    await captura(g, '04-programacion-lista');

    // Excel con lo que se ve
    const [desc] = await Promise.all([g.waitForEvent('download', { timeout: 60000 }), g.click('[data-descargar="excel"]')]);
    const rutaX = join(CARPETA, `programacion-${SELLO}.xlsx`);
    await desc.saveAs(rutaX);
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.readFile(rutaX);
    const hoja = libro.worksheets[0];
    const textos = [];
    hoja.eachRow((r) => textos.push(r.values.slice(1).map((v) => (v && typeof v === 'object' && 'result' in v ? v.result : v) ?? '').join(' | ')));
    const filasPrueba = textos.filter((t) => t.includes(`OBS4 ${SELLO}`));
    ok(filasPrueba.length === 2 && textos.some((t) => /Operador logístico/.test(t)) && filasPrueba.some((t) => t.includes(OPERADOR) && t.includes(ddmm(fechas.despacho))),
      'el Excel trae lo filtrado (los 2), con columnas y fechas legibles', filasPrueba[0]?.slice(0, 160));
    ok(textos.some((t) => /contiene «obs4/.test(t)), 'y dice qué filtro estaba puesto');
    // PDF
    const rPdf = await g.request.get(`${BASE}/api/logistica/programacion?formato=pdf&f_pl=${encodeURIComponent(`obs4 ${SELLO}`)}`);
    ok(rPdf.ok() && (await rPdf.body()).slice(0, 4).toString() === '%PDF' && rPdf.headers()['x-filas'] === '2', 'el PDF sale con las mismas filas', `x-filas ${rPdf.headers()['x-filas']}`);

    // Planificador › Lista (el mes)
    await g.goto(`${BASE}/logistica/planificador?vista=lista&mes=${fechas.mes}`, { waitUntil: 'networkidle' });
    ok(await g.locator(`tr[data-embarque="${embA}"]`).count() === 1 && await g.locator('[data-vista="lista"][aria-current="page"]').count() === 1, 'el Planificador tiene la pestaña «Lista» con la misma tabla del mes');
    await g.goto(`${BASE}/logistica/planificador?embarque=${embA}`, { waitUntil: 'networkidle' });
    const cal = await g.locator('main').innerText();
    ok(cal.includes(PL('D')) && cal.includes(`${OPERADOR} bis`), 'el calendario muestra el N.º de packing y el operador en la tarjeta del día');
    await captura(g, '05-planificador-calendario');
    await g.context().close();

    const cal2 = await sesion('calidad');
    const r403 = await cal2.request.get(`${BASE}/api/logistica/programacion?formato=excel`);
    ok(r403.status() === 403 && /Calidad no puede descargar/.test((await r403.json()).error ?? ''), 'Calidad no descarga la programación (no ve el Planificador)', String(r403.status()));
    await cal2.context().close();
  }

  /* ======================================================================
     7 · DESPACHADO: SOLO LA PROGRAMACIÓN
     ====================================================================== */
  SEC(7, 'Embarque despachado: «Corregir programación»');
  {
    await consultar(`update embarques set estado = 'despachado' where id = ${embB}`);
    await x.goto(`${BASE}/logistica/embarques/${embB}`, { waitUntil: 'networkidle' });
    const b = x.locator('[data-accion="editar-embarque"]');
    ok((await b.innerText()).includes('Corregir programación') && await b.isEnabled(), 'despachado: el botón dice «Corregir programación»');
    await b.click();
    ok(await x.locator('input[name="booking"]').isDisabled() && await x.locator('input[name="fecha_programada"]').isDisabled() && await x.locator('input[name="fecha_zarpe"]').isEnabled(),
      'booking y fecha de despacho apagados; zarpe, operador y PL encendidos');
    await x.fill('input[name="fecha_zarpe"]', fechas.zarpe);
    await x.click('[data-accion="guardar-embarque"]');
    await x.locator('[data-aviso="editar-embarque"]').filter({ hasText: 'Cambios guardados' }).waitFor({ timeout: 20000 });
    const [e] = await consultar(`select fecha_zarpe::text z, booking from embarques where id = ${embB}`);
    ok(e.z === fechas.zarpe && e.booking === `PRBBOOK${SELLO}`, 'el zarpe se corrige y el booking queda como salió', JSON.stringify(e));
    await captura(x, '06-despachado-corregir');
  }
} catch (e) {
  ok(false, 'la prueba se interrumpió', e.stack?.split('\n').slice(0, 3).join(' | '));
} finally {
  await limpiar();
  await nav.close();
}

if (errores.length) {
  console.log(`\nErrores de página o de consola:\n - ${errores.join('\n - ')}`);
  fallos.push(`${errores.length} error(es) de página o de consola`);
}
console.log(fallos.length ? `\n${fallos.length} FALLO(S):\n - ${fallos.join('\n - ')}` : '\nTodo correcto');
process.exit(fallos.length ? 1 : 0);

/* ==========================================================================
   LIMPIEZA: solo lo que creó esta prueba (sin tocar la auditoría ni el Kardex)
   ========================================================================== */
async function limpiar() {
  try {
    const embs = (await consultar(`select id from embarques where id > ${prev.emb} and (numero like 'PRB-OBS4-%' or numero_packing like 'PRB OBS4 ${SELLO}%' or id = any(array[${mios.emb.join(',') || 0}]::bigint[]))`)).map((x) => x.id);
    const arr = (xs) => `array[${xs.join(',') || 0}]::bigint[]`;
    const rutas = (await consultar(`select ruta from embarque_archivos where embarque_id = any(${arr(embs)})`)).map((x) => x.ruta);
    if (rutas.length) {
      const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
      await sb.auth.signInWithPassword({ email: 'gerencia@santamonica.pe', password: CLAVE });
      const { error } = await sb.storage.from('despachos').remove(rutas);
      if (error) console.log('  limpieza: no se pudieron borrar los archivos del repositorio:', error.message);
    }
    const pks = (await consultar(`select id from packing_lists where embarque_id = any(${arr(embs)})`)).map((x) => x.id);
    console.log(`\n  limpieza: ${embs.length} embarque(s), ${pks.length} contenedor(es), ${rutas.length} archivo(s), pedido ${mios.ped ?? '—'}, cliente ${mios.cli ?? '—'}`);
    await ejecutarSQL(`
      delete from embarque_comentarios where embarque_id = any(${arr(embs)});
      delete from embarque_archivos where embarque_id = any(${arr(embs)});
      delete from plano_estiba where packing_list_id = any(${arr(pks)});
      delete from packing_lineas where packing_list_id = any(${arr(pks)});
      delete from packing_lists where id = any(${arr(pks)});
      delete from embarque_lineas where embarque_id = any(${arr(embs)});
      delete from embarque_pedidos where embarque_id = any(${arr(embs)});
      delete from embarques where id = any(${arr(embs)});
      delete from alertas where id > ${prev.al} and ((entidad = 'embarques' and entidad_id = any(${arr(embs)})) or (entidad = 'packing_lists' and entidad_id = any(${arr(pks)})) or (entidad = 'pedidos' and entidad_id = ${mios.ped ?? 0}));
      delete from eventos where id > ${prev.ev} and ((entidad = 'embarques' and entidad_id = any(${arr(embs)})) or (entidad = 'packing_lists' and entidad_id = any(${arr(pks)})) or (entidad = 'pedidos' and entidad_id = ${mios.ped ?? 0}) or (entidad = 'clientes' and entidad_id = ${mios.cli ?? 0}));
      delete from pedido_lineas where pedido_id = ${mios.ped ?? 0};
      delete from pedidos where id = ${mios.ped ?? 0};
      delete from clientes where id = ${mios.cli ?? 0};`).catch((e) => console.log('  limpieza falló:', e.message));
    //  La numeración PL vuelve a como estaba (si nadie la fijó mientras tanto).
    if (corrPL) {
      await ejecutarSQL(`update correlativos set ultimo = ${corrPL.ultimo}, actualizado_en = ${corrPL.actualizado_en ? `'${corrPL.actualizado_en}'` : 'null'}, actualizado_por = ${corrPL.actualizado_por ? `'${corrPL.actualizado_por}'` : 'null'} where serie = 'PL' and anio = 0`);
    } else {
      await ejecutarSQL(`delete from correlativos where serie = 'PL' and anio = 0 and actualizado_por is null`);
    }
    void tocoContador;
    //  Los EMB-… que consumió el alta desde la pantalla: el contador vuelve atrás si nadie más numeró entretanto.
    if (corrEMB) {
      await ejecutarSQL(`update correlativos c set ultimo = ${corrEMB.ultimo} where serie = 'EMB' and anio = ${corrEMB.anio} and ultimo > ${corrEMB.ultimo}
        and not exists (select 1 from embarques e where e.numero like 'EMB-${corrEMB.anio}-%' and substring(e.numero from 10)::int > ${corrEMB.ultimo})`);
    }
    const [quedan] = await consultar(`select (select count(*)::int from embarques where numero like 'PRB-OBS4-%' or numero_packing like 'PRB OBS4%') e,
      (select count(*)::int from pedidos where numero_proforma like 'PRB-OBS4-%') p, (select count(*)::int from clientes where razon_social like 'PRUEBA-OBS4%') c,
      (select count(*)::int from auditoria where id > ${prev.au}) au`);
    console.log(`  quedan de la prueba: ${quedan.e} embarques, ${quedan.p} pedidos, ${quedan.c} clientes · filas de auditoría que deja (no se borran): ${quedan.au}`);
  } catch (e) {
    console.log('  limpieza falló:', e.message);
  }
}
