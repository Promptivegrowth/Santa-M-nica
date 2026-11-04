/**
 * ============================================================================
 *  PRUEBA · «OBSERVACIONES ERP 4», ÁREA A · DOCUMENTOS (migración 083)
 * ============================================================================
 *  Puntos 02, 03, 04 y 05 de Oliver y la firma por aprobador, contra la
 *  proforma y el contrato SM26-384 de KULALIA que dejó como modelo.
 *
 *   A · SOLO LECTURA sobre el pedido real SM26-623 (id 569): se descargan su
 *       proforma (PDF y Excel) y se abre su página de contrato. No se guarda
 *       nada en él (las descargas dejan su evento «documento descargado»,
 *       que esta prueba borra al final: son suyos).
 *   B · Con datos de PRUEBA (cotización y pedido «PRB083-…», copia de los de
 *       SM26-623): el certificado de captura de la cotización llega al pedido,
 *       a la proforma y al contrato; la firma de quien aprobó; «Mi firma»;
 *       permisos y corte de red. Todo lo creado se borra al final (salvo la
 *       bitácora `auditoria`, que no se toca nunca).
 *
 *      BASE_URL=http://localhost:3010 node scripts/probar-documentos-obs4.mjs [carpeta-para-guardar]
 * ============================================================================
 */
import { chromium } from 'playwright';
import JSZip from 'jszip';
import { PDFExtract } from 'pdf.js-extract';
import { inflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { ejecutarSQL } from './db.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const GUARDAR = process.argv[2] ?? null;
if (GUARDAR) mkdirSync(GUARDAR, { recursive: true });
const guardar = (nombre, datos) => { if (GUARDAR) writeFileSync(join(GUARDAR, nombre), datos); };
const consultar = async (sql) => { const r = await ejecutarSQL(sql); return Array.isArray(r) ? r : []; };
const SEC = (n, t) => `\n${'─'.repeat(3)} ${n} · ${t} ${'─'.repeat(3)}`;
const fallos = [];
const ok = (cond, texto, detalle = '') => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${texto}${detalle ? ' · ' + detalle : ''}`);
  if (!cond) fallos.push(texto);
};
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** El texto de un PDF, página por página, y cuántas tiene. */
async function textoPdf(buffer) {
  const datos = await new PDFExtract().extractBuffer(buffer, {});
  const paginas = datos.pages.map((p) => {
    //  Se ordena por renglón (y) y luego por columna (x), para leerlo como se ve.
    const piezas = [...p.content].sort((a, b) => (Math.abs(a.y - b.y) < 2 ? a.x - b.x : a.y - b.y));
    const lineas = [];
    let actual = null;
    for (const c of piezas) {
      if (!actual || Math.abs(c.y - actual.y) >= 2) { actual = { y: c.y, t: [] }; lineas.push(actual); }
      actual.t.push(c.str);
    }
    return lineas.map((l) => l.t.join(' ').replace(/\s+/g, ' ').trim()).join('\n');
  });
  return { paginas: paginas.length, texto: paginas.join('\n') };
}

/**
 * Los colores de relleno y de trazo que usa el PDF (operadores rg/RG y scn/SCN de
 * sus flujos de contenido). «Todas las letras en negro» = solo 0 0 0.
 */
function coloresPdf(buffer) {
  const crudo = buffer.toString('latin1');
  const colores = new Set();
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(crudo))) {
    const inicio = m.index + m[0].length;
    const fin = crudo.indexOf('endstream', inicio);
    if (fin < 0) break;
    try {
      const flujo = inflateSync(buffer.subarray(inicio, fin)).toString('latin1');
      if (!/\bBT\b/.test(flujo)) continue;
      for (const c of flujo.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) (rg|RG|scn|SCN)\b/g)) colores.add(`${Number(c[1])} ${Number(c[2])} ${Number(c[3])}`);
    } catch { /* una imagen u otro flujo que no es contenido */ }
  }
  return [...colores];
}

const [{ ahora: INICIO }] = await consultar(`select now()::text as ahora`);
const [ped569] = await consultar(`select id, numero_proforma, cotizacion_id from pedidos where id = 569`);
const usuarios = Object.fromEntries((await consultar(`
  select email, id::text, nombre from usuarios
   where email in ('gerencia@santamonica.pe','comercial@santamonica.pe','comex@santamonica.pe')`)).map((u) => [u.email, u]));
const GER = usuarios['gerencia@santamonica.pe'];
const COM = usuarios['comercial@santamonica.pe'];
const [firmaComAntes] = await consultar(`select firma, cargo from firmas_usuario where usuario_id = ${q(COM.id)}`);
const MARCA = `PRB083-${Date.now().toString().slice(-7)}`;
let cotPrb = null;
let pedPrb = null;

const nav = await chromium.launch({ channel: 'chrome', headless: true });
const ctxGer = await nav.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
const ctxCom = await nav.newContext({ viewport: { width: 1400, height: 1000 } });
const p = await ctxGer.newPage();
const pc = await ctxCom.newPage();
const entrar = async (pagina, email) => {
  await pagina.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await pagina.fill('input[type="email"]', email);
  await pagina.fill('input[type="password"]', process.env.CLAVE_DEMO ?? '');
  await pagina.click('button[type="submit"]');
  await pagina.waitForURL(/\/panel/, { timeout: 60000 });
};
const bajar = async (pagina, url) => {
  const r = await pagina.request.get(`${BASE}${url}`, { timeout: 180000 });
  return { estado: r.status(), cabeceras: r.headers(), cuerpo: Buffer.from(await r.body()) };
};
const captura = async (pagina, nombre) => { if (GUARDAR) await pagina.screenshot({ path: join(GUARDAR, nombre), fullPage: true }); };

try {
  await entrar(p, 'gerencia@santamonica.pe');

  /* ════════════════ A · SM26-623, SOLO LECTURA ════════════════ */
  console.log(SEC('A1', 'Proforma SM26-623 como la SM26-384 del modelo (puntos 02, 03, 04)'));
  const prof = await bajar(p, `/api/documentos/proforma/${ped569.id}?formato=pdf`);
  ok(prof.estado === 200, 'la proforma de SM26-623 se descarga', String(prof.estado));
  guardar('SM26-623-proforma.pdf', prof.cuerpo);
  const { paginas, texto } = await textoPdf(prof.cuerpo);
  ok(paginas === 1, 'cabe en una hoja, como el modelo', `${paginas} página(s)`);
  for (const [buscado, que] of [
    ['DOSIDICUS GIGAS', 'nombre científico'],
    ['FROZEN GIANT SQUID SEXUAL TENTACLES, WITH TIP', 'reproductores con punta: nombre en inglés del modelo'],
    ['REPRODUCTORES DE POTA CONGELADOS, C/PUNTA', '… y en castellano'],
    ['FROZEN GIANT SQUID SEXUAL TENTACLES, WITHOUT TIP', 'reproductores sin punta, en inglés'],
    ['REPRODUCTORES DE POTA CONGELADOS, S/PUNTA', '… y en castellano'],
    ['4,050 BAGS X 20 KG - PACKING: 02 BLOCKS x 10 KG, SIZE: 50CM-UP', 'línea 1: sacos, empaque y talla (la talla del SKU 173 sale del corte)'],
    ['633 BAGS X 30 KG - PACKING: 04 BLOCKS x 7.5 KG, SIZE: 50CM-UP', 'línea 2: 633 sacos (no 634) y bloques de 7.5 kg (no «8»)'],
    ['200 BAGS X 20 KG - PACKING: 02 BLOCKS x 10 KG, SIZE: 10-30CM', 'línea 3 con su talla en cm'],
    ['133 BAGS X 30 KG - PACKING: 04 BLOCKS x 7.5 KG, SIZE: 30-50CM', 'línea 4 con su talla en cm'],
    ['*BAGS OF 30 KG AND/OR 20 KG', 'resumen del empaque por grupo, como el modelo'],
    ['CFR USD/KGS', 'rótulo «UNIT PRICE / CFR USD/KGS»'],
    ['CFR VIGO, SPAIN', 'incoterm con el destino en inglés'],
    ["04 FCL REEFER 40' HC", 'contenedores (estimados por sacos: 4, como el modelo)'],
    ['10% +/-', 'tolerancia (la de Configuración)'],
    ['NOVEMBER, 2026', 'mes de embarque'],
    ['VIGO, SPAIN', 'puerto de descarga en inglés'],
    ['265,950.00', 'TOTAL = suma de las 4 líneas (el modelo decía 255 950,00 por error)'],
    ['November 03, 2026', 'fecha en inglés, como el modelo'],
    ['CATCH CERTIFICATE', 'certificado de captura (pedido anterior a la 083, destino UE: se propone)'],
    ['SIGNED AND STAMPED', 'raya del comprador'],
  ]) ok(texto.includes(buscado), que, buscado);
  ok(texto.indexOf('WITH TIP') < texto.indexOf('WITHOUT TIP'), 'el orden del modelo: con punta y después sin punta');
  ok(!/SAY|SON\b|DÓLARES|DOLARES/.test(texto), 'sin total en letras («solo el número»)');
  ok(!/OBSERVACIONES|VERIFICACI/.test(texto), 'sin el recuadro de observaciones automáticas');
  ok(/Walter Andrés Martínez Bravo/.test(texto) && /Gerente General/.test(texto),
     'firma de Gerencia: quien aprobó (Oliver Tello Ojeda) no subió firma');
  const colores = coloresPdf(prof.cuerpo);
  ok(colores.length > 0 && colores.every((c) => c === '0 0 0'), 'todas las letras y rayas en negro', colores.join(' | '));
  const detalle = JSON.parse(decodeURIComponent(prof.cabeceras['x-avisos-detalle'] ?? '%5B%5D'));
  ok(Number(prof.cabeceras['x-avisos']) === detalle.length, 'las observaciones viajan a la pantalla en la cabecera', `${detalle.length}`);

  console.log(SEC('A2', 'Excel de la proforma SM26-623'));
  const xls = await bajar(p, `/api/documentos/proforma/${ped569.id}?formato=excel`);
  ok(xls.estado === 200, 'el Excel se descarga');
  const hoja = await (await JSZip.loadAsync(xls.cuerpo)).file('xl/sharedStrings.xml')?.async('string') ?? '';
  ok(hoja.includes('FROZEN GIANT SQUID SEXUAL TENTACLES, WITH TIP, SIZE: 50CM-UP'), 'el Excel nombra el producto igual que el PDF');
  ok(!/OBSERVACIONES DE LA VERIFICACI/.test(hoja) && !/DÓLARES AMERICANOS/.test(hoja), 'sin observaciones ni total en letras');

  console.log(SEC('A3', 'Contrato de SM26-623: ítems, precios y documento F (sin generar)'));
  await p.goto(`${BASE}/ventas/pedidos/${ped569.id}/contrato`, { waitUntil: 'networkidle' });
  const v = async (pg, n) => pg.locator(`[name="${n}"]`).inputValue();
  const prodEn = await v(p, 'producto.en');
  const prodEs = await v(p, 'producto.es');
  ok(prodEn === [
    '(1) FROZEN GIANT SQUID SEXUAL TENTACLES, WITH TIP, SIZE: 50CM-UP',
    '(2) FROZEN GIANT SQUID SEXUAL TENTACLES, WITHOUT TIP, SIZE: 10-30CM',
    '(3) FROZEN GIANT SQUID SEXUAL TENTACLES, WITHOUT TIP, SIZE: 30-50CM'].join('\n'), 'ítems (1)(2)(3) en inglés, como el contrato del modelo', prodEn.replace(/\n/g, ' | '));
  ok(prodEs.split('\n')[0] === '(1) REPRODUCTORES DE POTA CONGELADOS, C/PUNTA, TALLAS: 50CM-UP', 'y en castellano', prodEs.replace(/\n/g, ' | '));
  const precio = await v(p, 'precio');
  ok(precio.split('\n').length === 4 && precio.includes('(1) 2.450 USD/KG CFR VIGO, SPAIN - BAGS X 20 KG')
     && precio.includes('(1) 2.500 USD/KG CFR VIGO, SPAIN - BAGS X 30 KG') && precio.includes('(3) 2.500 USD/KG CFR VIGO, SPAIN'),
     'precio por ítem, con tres decimales y el destino en inglés (punto 03)', precio.replace(/\n/g, ' | '));
  ok(await v(p, 'cantidad') === '108,000.00 KG (+/- 10%)', 'cantidad con tolerancia, como el modelo', await v(p, 'cantidad'));
  ok(await v(p, 'empaque') === 'BAGS OF 30 KG AND/OR 20 KG FOR SEXUAL TENTACLES', 'empaque como el modelo', await v(p, 'empaque'));
  ok(await v(p, 'puertoDescarga') === 'VIGO, SPAIN' && await v(p, 'puertoDescargaEs') === 'VIGO, ESPAÑA', 'puerto de descarga en inglés y en castellano');
  ok(await v(p, 'documentoF.en') === 'Catch Certificate', 'documento F: certificado de captura (pedido sin decidir, destino UE)');
  const firmaTexto = await p.locator('[data-firmante]').innerText();
  ok(await p.locator('[data-firmante]').getAttribute('data-firmante') === 'gerencia' && /Oliver Tello Ojeda aprobó la cotización COT-2026-0196/.test(firmaTexto),
     'explica quién firma: aprobó Oliver, sin firma → Gerencia', firmaTexto.slice(0, 140));
  ok(await p.locator('[data-bloque="certificado-captura"] input[type="checkbox"]').isChecked(), 'la casilla del certificado refleja lo que sale');
  await captura(p, 'A3-contrato-569.png');

  console.log(SEC('A4', 'Las observaciones se ven en pantalla al descargar, no en el PDF'));
  await p.goto(`${BASE}/ventas/pedidos/${ped569.id}`, { waitUntil: 'networkidle' });
  await p.locator(`button[title="Descargar ${ped569.numero_proforma} en PDF"]`).click();
  const avisoPantalla = p.locator('[data-aviso="observaciones-documento"]');
  await avisoPantalla.waitFor({ timeout: 90000 }).catch(() => {});
  ok(detalle.length === 0 || (await avisoPantalla.count()) === 1, 'aviso en pantalla con las observaciones');
  if (detalle.length) ok(await avisoPantalla.locator('li').count() === detalle.length, 'con cada observación en la lista', (await avisoPantalla.innerText()).slice(0, 160));
  await captura(p, 'A4-aviso-pantalla.png');

  /* ════════════════ B · DATOS DE PRUEBA ════════════════ */
  console.log(SEC('B1', 'La casilla está en la cotización y en el pedido (sin guardar)'));
  await p.goto(`${BASE}/ventas/cotizaciones/nueva`, { waitUntil: 'networkidle' });
  const casilla = p.locator('[data-bloque="certificado-captura"] input[name="certificado_captura"]');
  ok(await casilla.count() === 1 && !(await casilla.isChecked()), 'cotización nueva: «Incluye certificado de captura», desmarcada');
  await p.locator('[data-bloque="certificado-captura"]').scrollIntoViewIfNeeded();
  if (GUARDAR) await p.locator('[data-bloque="certificado-captura"]').screenshot({ path: join(GUARDAR, 'B1-casilla-cotizacion.png') });
  await p.goto(`${BASE}/ventas/pedidos/nuevo`, { waitUntil: 'networkidle' });
  ok(await p.locator('[data-bloque="certificado-captura"] input[name="certificado_captura"]').count() === 1, 'pedido directo nuevo: la misma casilla');

  console.log(SEC('B2', 'La cotización decide y el pedido lo hereda (base)'));
  const colsCot = (await consultar(`select string_agg(column_name, ', ' order by ordinal_position) c from information_schema.columns
     where table_schema='public' and table_name='cotizaciones' and is_generated = 'NEVER' and column_name not in ('id','numero','aprobada_por','creado_por','certificado_captura','creado_en')`))[0].c;
  [cotPrb] = await consultar(`insert into cotizaciones (${colsCot}, numero, aprobada_por, creado_por, certificado_captura)
     select ${colsCot}, ${q(MARCA + '-COT')}, ${q(COM.id)}, ${q(GER.id)}, false from cotizaciones where id = ${ped569.cotizacion_id} returning id, numero`);
  await consultar(`insert into cotizacion_lineas (cotizacion_id, sku_presentacion_id, cantidad_tm, precio_lista_tm, precio_tm, descuento_pct, orden)
     select ${cotPrb.id}, sku_presentacion_id, cantidad_tm, precio_lista_tm, precio_tm, descuento_pct, orden from cotizacion_lineas where cotizacion_id = ${ped569.cotizacion_id}`);
  const colsPed = (await consultar(`select string_agg(column_name, ', ' order by ordinal_position) c from information_schema.columns
     where table_schema='public' and table_name='pedidos' and is_generated = 'NEVER' and column_name not in ('id','numero_proforma','cotizacion_id','creado_por','certificado_captura','creado_en','actualizado_en','observaciones')`))[0].c;
  [pedPrb] = await consultar(`insert into pedidos (${colsPed}, numero_proforma, cotizacion_id, creado_por, observaciones)
     select ${colsPed}, ${q(MARCA)}, ${cotPrb.id}, ${q(GER.id)}, 'PRUEBA-083 · se borra al terminar' from pedidos where id = ${ped569.id}
     returning id, numero_proforma, certificado_captura`);
  await consultar(`insert into pedido_lineas (pedido_id, sku_presentacion_id, cantidad_tm, precio_lista_tm, precio_tm, descuento_pct, costo_estimado_tm, orden)
     select ${pedPrb.id}, sku_presentacion_id, cantidad_tm, precio_lista_tm, precio_tm, descuento_pct, costo_estimado_tm, orden from pedido_lineas where pedido_id = ${ped569.id}`);
  await consultar(`insert into pedido_cuentas (pedido_id, cuenta_id) select ${pedPrb.id}, cuenta_id from pedido_cuentas where pedido_id = ${ped569.id}`);
  ok(pedPrb.certificado_captura === false, 'el pedido nace con el «no» de su cotización (disparador)', String(pedPrb.certificado_captura));

  //  Si se corrige en la cotización, el pedido la sigue… salvo que se haya decidido aparte en el pedido.
  await consultar(`update cotizaciones set certificado_captura = true where id = ${cotPrb.id}`);
  let [estadoPed] = await consultar(`select certificado_captura from pedidos where id = ${pedPrb.id}`);
  ok(estadoPed.certificado_captura === true, 'corregido en la cotización, el pedido lo sigue');
  await consultar(`update pedidos set certificado_captura = false where id = ${pedPrb.id}`);
  await consultar(`update cotizaciones set certificado_captura = null where id = ${cotPrb.id}`);
  [estadoPed] = await consultar(`select certificado_captura from pedidos where id = ${pedPrb.id}`);
  ok(estadoPed.certificado_captura === false, 'decidido aparte en el pedido, la cotización ya no lo pisa');
  await consultar(`update cotizaciones set certificado_captura = false where id = ${cotPrb.id}`);

  console.log(SEC('B3', '«Mi firma»: cada uno sube la suya (navegador)'));
  await entrar(pc, 'comercial@santamonica.pe');
  await pc.locator('.cabecera-avatar').click();
  await pc.locator('a[data-accion="mi-firma"]').waitFor({ timeout: 10000 }).catch(() => {});
  ok(await pc.locator('a[data-accion="mi-firma"]').count() === 1, 'Comercial ve «Mi firma» en su menú');
  await pc.goto(`${BASE}/cuenta/firma`, { waitUntil: 'networkidle' });
  //  Una firma de prueba dibujada en el navegador, grande (2400 px), para ver que se reduce.
  const png = await pc.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 2400; c.height = 800;
    const x = c.getContext('2d'); x.lineWidth = 28; x.lineCap = 'round'; x.strokeStyle = '#111';
    x.beginPath(); x.moveTo(150, 600); x.bezierCurveTo(500, 50, 800, 750, 1100, 300); x.bezierCurveTo(1400, 0, 1700, 700, 2250, 250); x.stroke();
    return c.toDataURL('image/png').split(',')[1];
  });
  const rutaPng = join(GUARDAR ?? process.env.TEMP ?? '.', `${MARCA}-firma.png`);
  writeFileSync(rutaPng, Buffer.from(png, 'base64'));
  const bloqueMio = pc.locator(`[data-firma-usuario="${COM.id}"]`);
  await bloqueMio.locator('input[name="cargo"]').fill('Jefe Comercial PRB');
  await bloqueMio.locator('input[type="file"]').setInputFiles(rutaPng);
  await bloqueMio.locator('.form-mensaje').waitFor({ timeout: 30000 });
  ok(/quedó guardada/.test(await bloqueMio.locator('.form-mensaje').innerText()), 'la firma se sube', await bloqueMio.locator('.form-mensaje').innerText());
  const [fila] = await consultar(`select left(firma, 22) ini, length(firma) largo, cargo from firmas_usuario where usuario_id = ${q(COM.id)}`);
  ok(fila?.ini === 'data:image/png;base64,' && fila.largo < 900000 && fila.cargo === 'Jefe Comercial PRB',
     'en la base: PNG reducido a 1600 px y el cargo', `${fila?.largo} caracteres`);
  ok(await bloqueMio.locator('img').count() === 1, 'y se muestra');
  await captura(pc, 'B3-mi-firma.png');

  //  Corte de red: el mensaje queda en el formulario, sin perder lo escrito.
  await pc.route('**/cuenta/firma', (r) => (r.request().method() === 'POST' ? r.abort() : r.continue()));
  await bloqueMio.locator('input[name="cargo"]').fill('Cargo que no llega');
  await bloqueMio.locator('button[type="submit"]').click();
  await pc.waitForTimeout(2500);
  ok(/Se perdió la conexión/.test(await bloqueMio.locator('.form-mensaje').innerText()) &&
     await bloqueMio.locator('input[name="cargo"]').inputValue() === 'Cargo que no llega', 'corte de red: aviso sin perder lo escrito');
  await pc.unroute('**/cuenta/firma');

  //  La base no deja subir la firma de otro a quien no es Gerencia.
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  await sb.auth.signInWithPassword({ email: 'comercial@santamonica.pe', password: process.env.CLAVE_DEMO ?? '' });
  const { error: errAjena } = await sb.rpc('guardar_firma_usuario', { p_usuario: GER.id, p_firma: null, p_cargo: 'X' });
  ok(/Cada usuario sube su propia firma/.test(errAjena?.message ?? ''), 'la base rechaza la firma de otro (no Gerencia), en castellano', errAjena?.message);
  const { error: errFormato } = await sb.rpc('guardar_firma_usuario', { p_usuario: COM.id, p_firma: 'data:image/svg+xml;base64,AAAA', p_cargo: null });
  ok(/PNG o JPG/.test(errFormato?.message ?? ''), 'y una imagen que el PDF no sabe dibujar', errFormato?.message);
  const { error: errEscritura, data: filasDirectas } = await sb.from('firmas_usuario').update({ cargo: 'directo' }).eq('usuario_id', COM.id).select('usuario_id');
  ok(!!errEscritura || (filasDirectas ?? []).length === 0, 'nadie escribe la tabla directo (solo por la función)');
  await sb.auth.signOut();

  //  Gerencia ve y puede cambiar las firmas del equipo.
  await p.goto(`${BASE}/cuenta/firma`, { waitUntil: 'networkidle' });
  ok(await p.locator(`[data-bloque="firmas-equipo"] [data-firma-usuario="${COM.id}"] img`).count() === 1, 'Gerencia ve la firma de Comercial en «Firmas del equipo»');

  console.log(SEC('B4', 'La proforma lleva la firma de quien aprobó y el certificado según la cotización'));
  let profPrb = await bajar(p, `/api/documentos/proforma/${pedPrb.id}?formato=pdf`);
  let t = (await textoPdf(profPrb.cuerpo)).texto;
  guardar('PRB-proforma-sin-captura.pdf', profPrb.cuerpo);
  ok(profPrb.estado === 200 && t.includes(COM.nombre) && t.includes('Jefe Comercial PRB'), 'firma quien aprobó la cotización, con su nombre y cargo', COM.nombre);
  ok(!t.includes('CATCH CERTIFICATE') && t.includes('CERTIFICATE OF ORIGIN'), 'sin certificado de captura (la cotización dijo que no); los demás, sí');
  ok(t.includes('265,950.00'), 'mismo total que SM26-623');

  console.log(SEC('B5', 'Contrato del pedido de prueba: casilla, generar, PDF y Word'));
  await p.goto(`${BASE}/ventas/pedidos/${pedPrb.id}/contrato`, { waitUntil: 'networkidle' });
  ok(await v(p, 'documentoF.en') === '', 'documento F vacío: la cotización no lo negoció');
  ok(await p.locator('[data-firmante]').getAttribute('data-firmante') === 'aprobador', 'firma la persona que aprobó', await p.locator('[data-firmante]').innerText());
  await p.locator('[data-bloque="certificado-captura"] input[type="checkbox"]').check();
  await p.locator('[data-bloque="certificado-captura"] .form-mensaje').waitFor({ timeout: 30000 });
  await p.waitForFunction(() => (document.querySelector('[name="documentoF.en"]'))?.value === 'Catch Certificate', null, { timeout: 30000 }).catch(() => {});
  [estadoPed] = await consultar(`select certificado_captura from pedidos where id = ${pedPrb.id}`);
  ok(estadoPed.certificado_captura === true && await v(p, 'documentoF.en') === 'Catch Certificate',
     'al marcar la casilla del pedido, el contrato propone el documento F');
  await captura(p, 'B5-contrato-prb.png');
  await p.locator('[data-accion="generar-contrato"]').click();
  await p.locator('table[data-cuadro="contratos"] tr[data-contrato]').first().waitFor({ timeout: 60000 });
  const [ctr] = await consultar(`select id, numero, datos->'firmante'->>'usuarioId' firma_de, datos->>'puertoDescargaEs' es from contratos where pedido_id = ${pedPrb.id}`);
  ok(!!ctr && ctr.firma_de === COM.id && ctr.es === 'VIGO, ESPAÑA', 'el contrato guarda quién firma y el puerto en castellano', ctr?.numero);
  const cpdf = await bajar(p, `/api/contratos/${ctr.id}?formato=pdf`);
  guardar('PRB-contrato.pdf', cpdf.cuerpo);
  t = (await textoPdf(cpdf.cuerpo)).texto;
  const iEn = t.indexOf('(1) FROZEN GIANT SQUID SEXUAL TENTACLES, WITH TIP, SIZE: 50CM-UP');
  const iEs = t.indexOf('(1) REPRODUCTORES DE POTA CONGELADOS, C/PUNTA, TALLAS: 50CM-UP');
  const i2 = t.indexOf('(2) FROZEN GIANT SQUID SEXUAL TENTACLES, WITHOUT TIP, SIZE: 10-30CM');
  ok(iEn >= 0 && iEs > iEn && i2 > iEs, 'PDF: (1) inglés, (1) castellano, (2)… intercalados como el modelo');
  ok(t.includes('VIGO, ESPAÑA') && t.includes('Catch Certificate') && t.includes('108,000.00 KG (+/- 10%)'), 'PDF: puerto en castellano, certificado F y cantidad');
  ok(t.includes(COM.nombre) && t.includes('Jefe Comercial PRB'), 'PDF: firma y cargo de quien aprobó');
  const word = await bajar(p, `/api/contratos/${ctr.id}?formato=word`);
  guardar('PRB-contrato.docx', word.cuerpo);
  const xml = await (await JSZip.loadAsync(word.cuerpo)).file('word/document.xml').async('string');
  ok(xml.includes('(1) REPRODUCTORES DE POTA CONGELADOS, C/PUNTA, TALLAS: 50CM-UP') && !xml.includes('{{'), 'Word: ítems intercalados, sin marcadores');
  ok(!/w:highlight/.test(xml), 'Word: sin resaltado amarillo');
  ok(xml.includes('VIGO, ESPAÑA') && xml.includes('Catch Certificate') && xml.includes(COM.nombre), 'Word: puerto en castellano, documento F y nombre de quien firma');
  profPrb = await bajar(p, `/api/documentos/proforma/${pedPrb.id}?formato=pdf`);
  ok((await textoPdf(profPrb.cuerpo)).texto.includes('CATCH CERTIFICATE'), 'y la proforma ahora lo lista (punto 05)');

  console.log(SEC('B6', 'Si quien aprobó quita su firma, sale la de Gerencia'));
  await consultar(`update firmas_usuario set firma = null where usuario_id = ${q(COM.id)}`);
  t = (await textoPdf((await bajar(p, `/api/contratos/${ctr.id}?formato=pdf`)).cuerpo)).texto;
  ok(!t.includes(COM.nombre), 'el contrato ya generado no pone su nombre bajo otra firma');
  t = (await textoPdf((await bajar(p, `/api/documentos/proforma/${pedPrb.id}?formato=pdf`)).cuerpo)).texto;
  ok(t.includes('Walter Andrés Martínez Bravo') && !t.includes(COM.nombre), 'la proforma sale con la firma de Gerencia');

  console.log(SEC('B7', 'Cotización en PDF: sin total en letras ni recuadro'));
  const cpdfCot = await bajar(p, `/api/documentos/cotizacion/${cotPrb.id}?formato=pdf`);
  t = (await textoPdf(cpdfCot.cuerpo)).texto;
  ok(cpdfCot.estado === 200 && !/^SON\b/m.test(t) && !/OBSERVACIONES DE LA VERIFICACI/.test(t), 'la cotización tampoco los lleva');
} catch (e) {
  console.error(e);
  fallos.push(`excepción: ${e.message}`);
} finally {
  /* ---- Limpieza: solo lo de esta prueba. `auditoria` no se toca. ---- */
  try {
    if (pedPrb) {
      await consultar(`delete from contratos where pedido_id = ${pedPrb.id}`);
      await consultar(`delete from alertas where entidad = 'pedidos' and entidad_id = ${pedPrb.id}`);
      await consultar(`delete from eventos where entidad = 'pedidos' and entidad_id = ${pedPrb.id}`);
      await consultar(`delete from pedido_cuentas where pedido_id = ${pedPrb.id}`);
      await consultar(`delete from pedido_lineas where pedido_id = ${pedPrb.id}`);
      await consultar(`delete from pedidos where id = ${pedPrb.id}`);
    }
    if (cotPrb) {
      await consultar(`delete from alertas where entidad = 'cotizaciones' and entidad_id = ${cotPrb.id}`);
      await consultar(`delete from eventos where entidad = 'cotizaciones' and entidad_id = ${cotPrb.id}`);
      await consultar(`delete from cotizacion_cuentas where cotizacion_id = ${cotPrb.id}`);
      await consultar(`delete from cotizacion_lineas where cotizacion_id = ${cotPrb.id}`);
      await consultar(`delete from cotizaciones where id = ${cotPrb.id}`);
    }
    //  Las descargas de SM26-623 de esta prueba (su evento «documento descargado»).
    await consultar(`delete from eventos where entidad = 'pedidos' and entidad_id = ${ped569.id}
                       and tipo = 'documento_descargado' and ocurrido_en >= ${q(INICIO)}::timestamptz
                       and usuario_id = ${q(GER.id)}`);
    //  La firma de Comercial vuelve a como estaba.
    if (firmaComAntes) {
      await consultar(`update firmas_usuario set firma = ${firmaComAntes.firma === null ? 'null' : q(firmaComAntes.firma)},
                         cargo = ${firmaComAntes.cargo === null ? 'null' : q(firmaComAntes.cargo)} where usuario_id = ${q(COM.id)}`);
    } else {
      await consultar(`delete from firmas_usuario where usuario_id = ${q(COM.id)}`);
    }
    const [resto] = await consultar(`select (select count(*) from pedidos where numero_proforma like 'PRB083-%')::int ped,
                                            (select count(*) from cotizaciones where numero like 'PRB083-%')::int cot`);
    console.log(`\nLimpieza: quedan ${resto.ped} pedidos y ${resto.cot} cotizaciones PRB083.`);
  } catch (e) {
    console.error('No se pudo limpiar del todo:', e.message);
  }
  await nav.close();
}

console.log(fallos.length ? `\n✗ ${fallos.length} falla(s):\n · ${fallos.join('\n · ')}` : '\n✓ Todo en orden.');
process.exit(fallos.length ? 1 : 0);
