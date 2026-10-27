/**
 * ============================================================================
 *  PRUEBA · IMPORTADORES DESDE EXCEL Y ALMACENES QUE RECIBEN (migración 074)
 * ============================================================================
 *  Los pedidos de Oliver Tello (jefe de Operaciones), probados en el
 *  navegador y comprobados en la base:
 *
 *    1. Qué almacén recibe producción y qué almacén recibe compras: valores
 *       iniciales, el formulario manual filtra la bodega por el origen, el
 *       servidor y la base rechazan lo que no cuadra; Configuración › Maestros
 *       › Almacenes lo edita (y da de alta un almacén) con auditoría.
 *    2. Importar ingresos: la plantilla (hojas, listas desplegables), subir
 *       un Excel con filas buenas y malas, cada mensaje, corregir en pantalla,
 *       descartar, «Lista para validar» (Almacén) con su aviso en Alertas,
 *       «Validar y registrar» (Gerencia), el resultado por fila.
 *    3. Ingresos programados: una fila con «Llega el» futuro queda
 *       programada sin mover stock; «Confirmar llegada» con bultos y kilos
 *       corregidos; «Anular».
 *    4. Importar traslados: plantilla con los pallets disponibles, filas
 *       buena / apartada / bloqueada / de otra bodega / repetida, borradores
 *       agrupados por origen→destino.
 *    5. Fallas: el peso de la ficha del traslado con su unidad, el historial
 *       sin «en_transito», los mensajes de rol con nombre legible y el corte
 *       de red en los formularios.
 *
 *  Base compartida con producción: todo lo que se crea lleva «PRB IMP» o
 *  «PRUEBA-IMP» y se borra en `finally` (Kardex con su disparador apagado un
 *  instante, existencias, eventos, auditoría y avisos de lo creado).
 *
 *      BASE_URL=http://localhost:3010 node scripts/probar-importadores.mjs
 * ============================================================================
 */
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ejecutarSQL } from './db.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const CLAVE = process.env.CLAVE_DEMO ?? '';
const consultar = async (sql) => { const r = await ejecutarSQL(sql); return Array.isArray(r) ? r : []; };
const intentar = async (sql) => { try { await ejecutarSQL(sql); return null; } catch (e) { return String(e.message); } };
const SEC = (n, t) => `\n${'─'.repeat(3)} ${n} · ${t} ${'─'.repeat(3)}`;
const fallos = [];
const ok = (cond, texto, detalle = '') => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${texto}${detalle ? ' · ' + detalle : ''}`);
  if (!cond) fallos.push(texto);
};
const CARPETA = process.env.CAPTURAS ?? join(tmpdir(), 'probar-importadores');
mkdirSync(CARPETA, { recursive: true });
const captura = async (p, nombre) => { if (process.env.CAPTURAS) await p.screenshot({ path: join(CARPETA, `${nombre}.png`), fullPage: true }); };

const [{ hoy }] = await consultar(`select (now() at time zone 'America/Lima')::date::text hoy`);
const enDias = (n) => { const d = new Date(`${hoy}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dma = (iso) => iso.split('-').reverse().join('/');
const SELLO = String(Date.now()).slice(-5);
const COD = (n) => `PRB IMP ${SELLO} ${String(n).padStart(2, '0')}`;

/* ---- Lo que hay antes, para devolverlo todo ---- */
const [prev] = await consultar(`
  select (select coalesce(max(id),0) from movimientos) mov, (select coalesce(max(id),0) from eventos) ev,
         (select coalesce(max(id),0) from auditoria) au, (select coalesce(max(id),0) from alertas) al,
         (select coalesce(max(id),0) from traslados) tr, (select coalesce(max(id),0) from lotes) lot,
         (select coalesce(max(id),0) from importaciones_excel) imp, (select coalesce(max(id),0) from almacenes) alm,
         (select coalesce(max(id),0) from ingresos_programados) prog,
         (select ultimo from correlativos where serie = 'TRAS' and anio = 2026) corr`);
const almacenesAntes = await consultar(`select id, recibe_produccion, recibe_compras from almacenes order by id`);
const [prod] = await consultar(`
  select sp.id, s.codigo, p.descripcion pres, e.nombre especie, s.corte
    from sku_presentaciones sp join skus s on s.id = sp.sku_id join presentaciones p on p.id = sp.presentacion_id
    join especies e on e.id = s.especie_id
   where sp.activo and s.activo order by s.codigo, sp.id limit 1`);
const etiquetaProd = [prod.codigo, prod.pres, prod.especie, prod.corte].join(' · ');

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
  await p.waitForURL(/\/panel/, { timeout: 40000 });
  return p;
}
const uid = async (rol) => (await consultar(`select id from usuarios where rol = '${rol}' and activo limit 1`))[0].id;
const como = (u, sql) => intentar(`begin; select set_config('request.jwt.claims', '{"sub":"${u}","role":"authenticated"}', true); set local role authenticated; ${sql}; rollback;`);

/** Descarga una plantilla pulsando el botón, y la devuelve abierta. */
async function descargar(p, selector) {
  const [descarga] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), p.click(selector)]);
  const ruta = join(CARPETA, descarga.suggestedFilename());
  await descarga.saveAs(ruta);
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.readFile(ruta);
  return { libro, nombre: descarga.suggestedFilename() };
}
/** Llena la hoja de datos debajo de la fila de ejemplo y guarda el archivo. */
async function llenar(libro, hojaNombre, filas, nombre) {
  const hoja = libro.getWorksheet(hojaNombre);
  const enc = {};
  hoja.getRow(4).eachCell((c, col) => { enc[String(c.value).replace(' *', '')] = col; });
  filas.forEach((f, i) => {
    for (const [titulo, valor] of Object.entries(f)) {
      if (!enc[titulo]) throw new Error(`No está la columna «${titulo}» en la plantilla`);
      hoja.getCell(6 + i, enc[titulo]).value = valor;
    }
  });
  const ruta = join(CARPETA, nombre);
  await libro.xlsx.writeFile(ruta);
  return ruta;
}
const filaDe = (p, n) => p.locator(`[data-bloque="filas-importacion"] tbody[data-fila="${n}"]`);
const esperarFila = (p, n, estado) => p.locator(`[data-bloque="filas-importacion"] tbody[data-fila="${n}"][data-estado="${estado}"]`).waitFor({ timeout: 30000 }).then(() => true, () => false);

let impIngresos = null;
let impTraslados = null;
let almacenNuevo = null;

try {
  const g = await sesion('gerencia');
  const a = await sesion('almacen');

  /* ======================================================================
     1 · QUÉ ALMACÉN RECIBE QUÉ
     ====================================================================== */
  console.log(SEC(1, 'Almacenes que reciben producción y compras'));
  {
    const al = await consultar(`select codigo, recibe_produccion p, recibe_compras c from almacenes order by id`);
    const de = Object.fromEntries(al.map((x) => [x.codigo, x]));
    ok(['STM-C1', 'STM-C2', 'STM-C3', 'FREEKO', 'HAYDUK'].every((c) => de[c]?.p) && !de.ELAMAR.p && !de.DEPSA.p,
      'producción: las tres cámaras de Santa Mónica, Freeko y Hayduk');
    ok(de.ELAMAR.c && de.PERUFR.c && ['STM-C1', 'FREEKO', 'DEPSA', 'COINRE', 'EMERG', 'HAYDUK'].every((c) => !de[c].c),
      'compras: solo Elamar y Perufrost');

    // La base rechaza un ingreso de producción en Depsa (almacenamiento externo).
    const [l] = await consultar(`select id from lotes order by id limit 1`);
    const ge = await uid('gerencia');
    const e1 = await intentar(`begin; insert into movimientos (tipo, lote_id, almacen_id, bultos, peso_neto_kg, costo_unitario, usuario_id, origen_ingreso)
      values ('ingreso', ${l.id}, 7, 1, 1, 0, '${ge}', 'produccion'); rollback;`);
    ok(/Depsa no recibe ingresos de Producción/.test(e1 ?? ''), 'la base rechaza un ingreso de Producción en Depsa', (e1 ?? '').slice(0, 120));
    const e2 = await intentar(`begin; insert into movimientos (tipo, lote_id, almacen_id, bultos, peso_neto_kg, costo_unitario, usuario_id, origen_ingreso)
      values ('ingreso', ${l.id}, 5, 1, 1, 0, '${ge}', 'compras'); rollback;`);
    ok(e2 === null, 'y acepta una compra en Elamar');

    // El formulario manual filtra la bodega según el origen.
    await a.goto(`${BASE}/almacenes/ingresos/nuevo`, { waitUntil: 'networkidle' });
    await a.locator('input[name="origen_ingreso"][value="compras"]').check();
    const opcCompras = await a.locator('select[name="almacen_id"] option').allInnerTexts();
    ok(opcCompras.length === 2 && opcCompras.includes('Elamar') && opcCompras.includes('Perufrost'), 'con Compras, el desplegable de bodega solo ofrece Elamar y Perufrost', opcCompras.join(', '));
    await a.locator('input[name="origen_ingreso"][value="produccion"]').check();
    const opcProd = await a.locator('select[name="almacen_id"] option').allInnerTexts();
    ok(opcProd.length === 5 && !opcProd.includes('Depsa') && opcProd.includes('Freeko'), 'con Producción, las cinco que reciben producción', opcProd.join(', '));
    await captura(a, '01-ingreso-bodegas-por-origen');

    // El servidor rechaza aunque se fuerce la bodega desde el navegador.
    await a.getByLabel(/Código de pallet/).fill(COD(90));
    await a.getByLabel(/^Producto/).selectOption(String(prod.id));
    await a.getByLabel(/^Bultos/).fill('10');
    await a.getByLabel(/Peso neto total/).fill('200');
    await a.locator('select[name="almacen_id"]').evaluate((s) => { const o = document.createElement('option'); o.value = '7'; o.text = 'Depsa'; s.appendChild(o); });
    await a.selectOption('select[name="almacen_id"]', '7');
    await a.locator('button', { hasText: 'Registrar ingreso' }).click();
    await a.locator('.ficha-aviso-critico').waitFor({ timeout: 20000 });
    const msj = await a.locator('.ficha-aviso-critico').innerText();
    ok(/Depsa no recibe ingresos de Producción.*entran por/.test(msj), 'el servidor lo rechaza con un mensaje claro', msj.slice(0, 110));

    // Corte de red en el formulario: mensaje en el aviso, sin perder lo escrito.
    await a.selectOption('select[name="almacen_id"]', '4');
    await a.route('**/almacenes/ingresos/nuevo', (r) => (r.request().method() === 'POST' ? r.abort('internetdisconnected') : r.continue()));
    await a.locator('button', { hasText: 'Registrar ingreso' }).click();
    await a.waitForTimeout(2500);
    const sinRed = await a.locator('.ficha-aviso-critico').innerText().catch(() => '');
    ok(/Se perdió la conexión/.test(sinRed) && (await a.getByLabel(/Código de pallet/).inputValue()) === COD(90),
      'un corte de red se avisa en el formulario y no borra lo escrito', sinRed.slice(0, 60));
    await a.unroute('**/almacenes/ingresos/nuevo');
    ok((await consultar(`select 1 from lotes where codigo_pallet = '${COD(90)}'`)).length === 0, 'y no se registró nada');
  }

  /* ======================================================================
     2 · IMPORTAR INGRESOS
     ====================================================================== */
  console.log(SEC(2, 'Importar ingresos desde Excel'));
  {
    await a.goto(`${BASE}/almacenes/ingresos`, { waitUntil: 'networkidle' });
    ok(await a.locator('[data-accion="importar-ingresos"]').count() === 1, 'Ingresos ofrece «Importar desde Excel» a Almacén');
    await a.click('[data-accion="importar-ingresos"]');
    await a.waitForURL(/\/almacenes\/ingresos\/importar$/, { timeout: 90000 });
    const { libro, nombre } = await descargar(a, '[data-accion="descargar-plantilla"]');
    ok(/Plantilla_Ingresos/.test(nombre), 'descarga la plantilla', nombre);
    const hojas = libro.worksheets.map((h) => h.name);
    ok(['Ingresos', 'Listas', 'Productos', 'Bodegas', 'Cámaras', 'Instrucciones'].every((h) => hojas.includes(h)), 'trae las hojas Ingresos, Listas, Productos, Bodegas, Cámaras e Instrucciones', hojas.join(', '));
    const hi = libro.getWorksheet('Ingresos');
    const encabezados = [];
    hi.getRow(4).eachCell((c) => encabezados.push(String(c.value)));
    ok(encabezados.includes('Código de pallet *') && encabezados.includes('Llega el (si es programado)') && encabezados.includes('Origen *'),
      'con los encabezados del formulario (obligatorios con *) y «Llega el»', `${encabezados.length} columnas`);
    ok(String(hi.getCell(5, 1).value).startsWith('EJEMPLO'), 'y una fila de ejemplo');
    const colDe = (t) => encabezados.findIndex((e) => e.replace(' *', '') === t) + 1;
    const dv = (t) => hi.getCell(6, colDe(t)).dataValidation;
    ok(['Origen', 'Bodega', 'Cámara', 'Turno', 'Producto'].every((t) => dv(t)?.type === 'list' && /Listas!/.test(dv(t).formulae?.[0] ?? '')),
      'origen, bodega, cámara, turno y producto con lista desplegable', dv('Bodega')?.formulae?.[0]);
    const listas = libro.getWorksheet('Listas');
    const colBod = [];
    listas.getRow(1).eachCell((c, k) => { if (c.value === 'Bodega') listas.getColumn(k).eachCell((x, r) => { if (r > 1 && x.value) colBod.push(String(x.value)); }); });
    ok(colBod.length === 7 && !colBod.includes('Depsa'), 'la lista de bodegas trae solo las que reciben algo', colBod.join(', '));
    const bod = libro.getWorksheet('Bodegas');
    let elamar = null;
    bod.eachRow((f) => { if (f.getCell(1).value === 'Elamar') elamar = [f.getCell(3).value, f.getCell(4).value]; });
    ok(elamar?.[0] === 'No' && elamar?.[1] === 'Sí', 'la hoja Bodegas dice qué recibe cada una (Elamar: compras)');
    let hayProd = false;
    libro.getWorksheet('Productos').eachRow((f) => { if (f.getCell(1).value === etiquetaProd && f.getCell(2).value === prod.codigo) hayProd = true; });
    ok(hayProd, 'la hoja Productos trae cada producto con su código', etiquetaProd);

    /* Filas buenas y malas */
    const base = { 'Producto': etiquetaProd, 'Bultos': 20, 'Peso neto total (kg)': 400, 'Fecha de producción': dma(hoy), 'Observaciones': 'PRUEBA-IMP' };
    const ruta = await llenar(libro, 'Ingresos', [
      /* 6 */ { ...base, 'Código de pallet': COD(1), 'Origen': 'Producción', 'Bodega': 'Santa Mónica · Cámara 01', 'Cámara': 'Cámara 01', 'Turno': 'Noche' },
      /* 7 */ { ...base, 'Código de pallet': COD(2), 'Origen': 'Compras', 'Proveedor (si es compra)': 'Proveedor PRUEBA-IMP', 'Bodega': 'Elamar' },
      /* 8 */ { ...base, 'Código de pallet': COD(1), 'Origen': 'Producción', 'Bodega': 'Freeko' },
      /* 9 */ { ...base, 'Código de pallet': COD(4), 'Origen': 'Compras', 'Proveedor (si es compra)': 'X', 'Bodega': 'Freeko' },
      /* 10 */ { ...base, 'Código de pallet': COD(5), 'Origen': 'Producción', 'Bodega': 'Freeko', 'Producto': 'ZZ-NO-EXISTE · 9 X 9 KG' },
      /* 11 */ { ...base, 'Código de pallet': COD(6), 'Origen': 'Producción', 'Bodega': 'Freeko', 'Cámara': 'Cámara 02' },
      /* 12 */ { ...base, 'Código de pallet': COD(7), 'Origen': 'Compras', 'Proveedor (si es compra)': 'Proveedor PRUEBA-IMP', 'Bodega': 'Perufrost', 'Llega el (si es programado)': dma(enDias(3)) },
      /* 13 */ { ...base, 'Código de pallet': COD(8), 'Origen': 'Producción', 'Bodega': 'Freeko', 'Bultos': 0, 'Fecha de producción': dma(enDias(5)) },
      /* 14 */ { ...base, 'Código de pallet': COD(9), 'Origen': 'Producción', 'Bodega': 'Depsa' },
      /* 15 */ { ...base, 'Código de pallet': COD(10), 'Origen': 'Producción', 'Bodega': 'Hayduk', 'Peso neto total (kg)': null, 'Kg por bulto': 20 },
    ], `ingresos-${SELLO}.xlsx`);

    await a.setInputFiles('input[type="file"][name="archivo"]', ruta);
    await a.click('[data-accion="subir-archivo"]');
    await a.waitForURL(/\/almacenes\/ingresos\/importar\/\d+/, { timeout: 60000 });
    impIngresos = Number(a.url().match(/importar\/(\d+)/)[1]);
    await a.locator('[data-bloque="revision-importacion"]').waitFor();
    await a.click('[data-filtro="todas"]');
    await captura(a, '02-revision-importacion');

    const detalle = async (n) => (await filaDe(a, n).locator('[data-detalle="fila"]').innerText()).replace(/\s+/g, ' ');
    const estadoFila = async (n) => filaDe(a, n).getAttribute('data-estado');
    ok(await estadoFila(6) === 'valida' && await estadoFila(7) === 'valida', 'las filas buenas quedan listas (producción y compra)');
    ok(/ya aparece en la fila 6/.test(await detalle(8)), 'pallet repetido dentro del archivo', await detalle(8));
    ok(/Código de pallet:/.test(await detalle(8)), 'cada error dice su columna');
    ok(/Bodega: La bodega Freeko no recibe ingresos de Compras\. Los ingresos de Compras entran por: Elamar, Perufrost/.test(await detalle(9)), 'bodega que no admite el origen', (await detalle(9)).slice(0, 110));
    ok(/Producto: No existe el producto «ZZ-NO-EXISTE/.test(await detalle(10)), 'producto inexistente', (await detalle(10)).slice(0, 90));
    ok(/Cámara: La Cámara 02 es de la bodega Santa Mónica · Cámara 02, no de la elegida/.test(await detalle(11)), 'cámara de otra bodega', (await detalle(11)).slice(0, 100));
    ok(await estadoFila(12) === 'valida' && /Quedará como ingreso programado/.test(await detalle(12)), 'una fila con «Llega el» futuro queda para programar');
    ok(/Bultos: Los bultos tienen que ser más de cero/.test(await detalle(13)) && /no puede ser futura/.test(await detalle(13)), 'cantidades en cero y fecha futura: los dos errores de la fila');
    ok(/Depsa no recibe ingresos de Producción/.test(await detalle(14)), 'producción en un almacén externo (Depsa)');
    ok(await estadoFila(15) === 'valida', 'el peso total se calcula de «Kg por bulto»');

    const [bd] = await consultar(`select count(*)::int n, count(*) filter (where estado = 'valida')::int v from importaciones_excel_filas where importacion_id = ${impIngresos}`);
    ok(bd.n === 10 && bd.v === 4, 'la base guarda las 10 filas con su estado (4 listas)', `${bd.v}/${bd.n}`);
    ok((await consultar(`select 1 from lotes where codigo_pallet like 'PRB IMP ${SELLO}%'`)).length === 0, 'subir no registra nada todavía');

    /* Corregir en pantalla: la fila 14 (Depsa) pasa a Freeko */
    await filaDe(a, 14).locator('[data-accion="corregir-fila"]').click();
    const ed = a.locator('[data-bloque="editor-fila"]');
    ok((await ed.locator('[data-error-columna="bodega"]').innerText()).includes('Depsa'), 'el editor marca la columna con error y su motivo');
    await ed.locator('select[name="bodega"]').selectOption('Freeko');
    await ed.locator('[data-accion="guardar-fila"]').click();
    await a.locator('[data-aviso="importacion"]').waitFor({ timeout: 30000 });
    ok(/Fila 14 corregida/.test(await a.locator('[data-aviso="importacion"]').innerText()), 'corregida en pantalla, vuelve a revisarse y queda lista');
    ok(await esperarFila(a, 14, 'valida'), 'la fila 14 ahora está lista');

    /* Descartar la fila 13 */
    await filaDe(a, 13).locator('[data-accion="descartar-fila"]').click();
    ok(await esperarFila(a, 13, 'descartada'), 'una fila se puede descartar');

    /* Almacén no valida: deja lista para validar */
    ok(await a.locator('[data-accion="validar-registrar"]').count() === 0, 'Almacén no ve «Validar y registrar»');
    await a.click('[data-accion="dejar-lista"]');
    await a.waitForFunction(() => /lista para validar/i.test(document.querySelector('[data-aviso="importacion"]')?.textContent ?? ''), null, { timeout: 30000 });
    const [imp] = await consultar(`select estado, enviada_por from importaciones_excel where id = ${impIngresos}`);
    ok(imp.estado === 'lista' && imp.enviada_por === (await uid('almacen')), 'queda «Lista para validar» con quién la envió');
    const [alerta] = await consultar(`select titulo, mensaje, atendida from alertas where entidad = 'importacion' and entidad_id = ${impIngresos}`);
    ok(alerta && !alerta.atendida && /5 ingresos/.test(alerta.mensaje), 'y abre un aviso en Alertas para Gerencia y Operaciones', alerta?.mensaje?.slice(0, 90));
    // La base no deja a Almacén validarla aunque se salte la pantalla.
    const e3 = await como(await uid('almacen'), `update importaciones_excel set estado = 'validada' where id = ${impIngresos}`);
    ok(/las validan Gerencia u Operaciones/.test(e3 ?? ''), 'la base no deja que Almacén la marque validada', (e3 ?? '').slice(0, 80));

    await g.goto(`${BASE}/panel`, { waitUntil: 'networkidle' });
    ok((await g.locator('body').innerText()).includes('Importación de ingresos por validar'), 'el panel de Gerencia muestra la importación por validar');
    await g.goto(`${BASE}/alertas`, { waitUntil: 'networkidle' });
    ok((await g.locator('body').innerText()).includes('Importación de ingresos por validar'), 'y Alertas también');

    /* Gerencia valida y registra */
    await g.goto(`${BASE}/almacenes/ingresos/importar/${impIngresos}`, { waitUntil: 'networkidle' });
    const boton = g.locator('[data-accion="validar-registrar"]');
    ok(/Validar y registrar 4 ingresos y programar 1/.test(await boton.innerText()), 'Gerencia ve «Validar y registrar 4 ingresos y programar 1»', await boton.innerText());
    await boton.click();
    await g.waitForFunction(() => /Importación validada/.test(document.querySelector('[data-aviso="importacion"]')?.textContent ?? ''), null, { timeout: 120000 });
    const fin = await g.locator('[data-aviso="importacion"]').innerText();
    ok(/4 ingresos registrados y 1 programado/.test(fin), 'registra los válidos y programa el que no llega', fin.slice(0, 90));
    await g.click('[data-filtro="todas"]');
    ok(await esperarFila(g, 6, 'registrada') && await filaDe(g, 6).locator('[data-enlace="pallet"]').count() === 1, 'cada fila registrada enlaza a su pallet');
    ok(await esperarFila(g, 12, 'programada') && await filaDe(g, 12).locator('[data-enlace="programado"]').count() === 1, 'y la programada, a Ingresos programados');
    await captura(g, '03-importacion-validada');
    const lotes = await consultar(`select l.codigo_pallet, l.turno::text, m.almacen_id, m.camara_id, m.origen_ingreso, m.proveedor, m.peso_neto_kg::numeric kg
                                     from lotes l join movimientos m on m.lote_id = l.id and m.tipo = 'ingreso'
                                    where l.codigo_pallet like 'PRB IMP ${SELLO}%' order by 1`);
    const porCod = Object.fromEntries(lotes.map((l) => [l.codigo_pallet, l]));
    ok(lotes.length === 4, 'nacen 4 pallets con su ingreso en el Kardex', lotes.map((l) => l.codigo_pallet.slice(-2)).join(','));
    ok(porCod[COD(1)]?.camara_id === 1 && porCod[COD(1)]?.turno === 'noche', 'con su cámara y turno');
    ok(porCod[COD(2)]?.origen_ingreso === 'compras' && porCod[COD(2)]?.proveedor === 'Proveedor PRUEBA-IMP' && porCod[COD(2)]?.almacen_id === 5, 'la compra en Elamar con su proveedor');
    ok(Number(porCod[COD(10)]?.kg) === 400, 'el peso por bulto multiplicado (20 × 20 kg)');
    const [imp2] = await consultar(`select estado, procesado_por from importaciones_excel where id = ${impIngresos}`);
    ok(imp2.estado === 'validada' && imp2.procesado_por === (await uid('gerencia')), 'la importación queda validada, con quién la validó');
    const [al2] = await consultar(`select atendida from alertas where entidad = 'importacion' and entidad_id = ${impIngresos}`);
    ok(al2?.atendida === true, 'y el aviso de Alertas se cierra solo');
    ok((await consultar(`select 1 from lotes where codigo_pallet = '${COD(7)}'`)).length === 0, 'el programado no crea pallet ni mueve stock');
  }

  /* ======================================================================
     3 · INGRESOS PROGRAMADOS
     ====================================================================== */
  console.log(SEC(3, 'Ingresos programados'));
  {
    const [p] = await consultar(`select id, estado, bultos, fecha_llegada::text f from ingresos_programados where codigo_pallet = '${COD(7)}'`);
    ok(p?.estado === 'programado' && p.f === enDias(3), 'queda programado para su fecha de llegada');
    await a.goto(`${BASE}/almacenes/ingresos`, { waitUntil: 'networkidle' });
    await a.click('[data-accion="ingresos-programados"]');
    await a.waitForURL(/programados/);
    const fila = a.locator(`tr[data-pallet="${COD(7)}"]`);
    ok(await fila.waitFor({ timeout: 20000 }).then(() => true, () => false), 'aparece en «Ingresos programados»');
    await fila.locator(`input[name="bultos_${p.id}"]`).fill('19');
    await fila.locator(`input[name="kg_${p.id}"]`).fill('381.5');
    ok(/Se anunciaron 20/.test(await fila.innerText()), 'al corregir bultos dice lo anunciado');
    await captura(a, '04-programados');
    await fila.locator('[data-accion="confirmar-llegada"]').click();
    await a.locator('[data-aviso="programados"]').waitFor({ timeout: 30000 });
    ok(/1 llegada confirmada/.test(await a.locator('[data-aviso="programados"]').innerText()), 'Almacén confirma la llegada', await a.locator('[data-aviso="programados"]').innerText());
    const [l] = await consultar(`select l.id, l.bultos_iniciales b, m.peso_neto_kg::numeric kg, m.almacen_id, m.origen_ingreso
                                   from lotes l join movimientos m on m.lote_id = l.id where l.codigo_pallet = '${COD(7)}'`);
    ok(l && l.b === 19 && Number(l.kg) === 381.5 && l.almacen_id === 6 && l.origen_ingreso === 'compras', 'nace el pallet con lo que de verdad llegó, en Perufrost');
    const [p2] = await consultar(`select estado, lote_id, confirmado_por from ingresos_programados where id = ${p.id}`);
    ok(p2.estado === 'confirmado' && p2.lote_id === l.id && p2.confirmado_por === (await uid('almacen')), 'el programado queda confirmado con su pallet y quién lo confirmó');

    // Anular: uno programado directo en la base, como lo dejaría otra importación.
    await ejecutarSQL(`insert into ingresos_programados (codigo_pallet, sku_presentacion_id, almacen_id, fecha_llegada, fecha_produccion, bultos, peso_neto_kg, origen_ingreso, proveedor, observaciones, creado_por)
      values ('${COD(11)}', ${prod.id}, 5, '${enDias(4)}', '${hoy}', 5, 100, 'compras', 'Proveedor PRUEBA-IMP', 'PRUEBA-IMP', '${await uid('gerencia')}')`);
    const eProg = await intentar(`insert into ingresos_programados (codigo_pallet, sku_presentacion_id, almacen_id, fecha_llegada, fecha_produccion, bultos, peso_neto_kg, origen_ingreso, creado_por)
      values ('${COD(12)}', ${prod.id}, 7, '${enDias(4)}', '${hoy}', 5, 100, 'produccion', '${await uid('gerencia')}')`);
    ok(/Depsa no recibe ingresos de Producción/.test(eProg ?? ''), 'la base tampoco deja programar en una bodega que no recibe ese origen');
    await a.reload({ waitUntil: 'networkidle' });
    const f2 = a.locator(`tr[data-pallet="${COD(11)}"]`);
    await f2.locator('[data-accion="anular-programado"]').click();
    await f2.locator('input[name="motivo_anulacion"]').fill('PRUEBA-IMP el proveedor no despachó');
    await f2.locator('[data-accion="confirmar-anular"]').click();
    await a.waitForFunction(() => /anulado/.test(document.querySelector('[data-aviso="programados"]')?.textContent ?? ''), null, { timeout: 30000 });
    const [p3] = await consultar(`select estado, motivo_anulacion from ingresos_programados where codigo_pallet = '${COD(11)}'`);
    ok(p3.estado === 'anulado' && /no despachó/.test(p3.motivo_anulacion), 'se puede anular con motivo, sin mover stock');
  }

  /* TRASLADOS, ALMACENES Y FALLAS: abajo */
  await seccionesRestantes({ g, a });
} catch (e) {
  ok(false, 'la prueba se interrumpió', String(e.stack ?? e).slice(0, 500));
} finally {
  await limpiar();
  await nav.close();
}

if (errores.length) console.log(`\nErrores de página:\n - ${errores.join('\n - ')}`);
console.log(fallos.length ? `\n${fallos.length} FALLO(S):\n - ${fallos.join('\n - ')}` : '\nTodo correcto');
process.exit(fallos.length ? 1 : 0);

/* ==========================================================================
   TRASLADOS, CONFIGURACIÓN Y FALLAS
   ========================================================================== */
async function seccionesRestantes({ g, a }) {
  /* ======================================================================
     4 · IMPORTAR TRASLADOS
     ====================================================================== */
  console.log(SEC(4, 'Importar traslados desde Excel'));
  const libre = (alm, n, extra = '') => consultar(`
    select v.lote_id, v.codigo_pallet, v.fisico_bultos b, v.fisico_kg::numeric kg, v.disponible_kg::numeric disp from v_stock_lote v
     where v.almacen_id = ${alm} ${extra}
       and (select count(*) from lotes l2 where l2.codigo_pallet = v.codigo_pallet) = 1
       and (select count(*) from v_stock_lote v2 where v2.lote_id = v.lote_id) = 1
       and not exists (select 1 from traslado_lineas tl join traslados t on t.id = tl.traslado_id
                        where tl.lote_id = v.lote_id and t.estado in ('borrador','autorizado','en_transito'))
     order by v.lote_id desc offset 3 limit ${n}`);
  const LIBRE = `and v.bloqueado_kg = 0 and v.reservado_kg = 0 and v.preparacion_kg = 0 and v.fisico_bultos between 10 and 200`;
  const [A, B] = await libre(2, 2, LIBRE);
  const [C] = await libre(3, 1, LIBRE);
  const [D] = await libre(5, 1, LIBRE);
  const [AP] = await libre(2, 1, 'and v.disponible_kg <= 0.001 and v.bloqueado_kg = 0 and v.fisico_kg > 0');
  const [BQ] = await libre(2, 1, 'and v.bloqueado_kg > 0');
  console.log(`  pallets: A ${A.codigo_pallet}, B ${B.codigo_pallet}, C ${C.codigo_pallet}, otra bodega ${D.codigo_pallet}, apartado ${AP?.codigo_pallet}, bloqueado ${BQ?.codigo_pallet}`);
  const existAntes = await consultar(`select lote_id, almacen_id, bultos, peso_neto_kg from existencias where lote_id in (${[A, B, C].map((x) => x.lote_id)}) order by 1, 2`);

  await a.goto(`${BASE}/almacenes/traslados`, { waitUntil: 'networkidle' });
  await a.click('[data-accion="importar-traslados"]');
  await a.waitForURL(/\/almacenes\/traslados\/importar$/, { timeout: 90000 });
  const { libro } = await descargar(a, '[data-accion="descargar-plantilla-traslados"]');
  const hojas = libro.worksheets.map((h) => h.name);
  ok(['Traslados', 'Listas', 'Pallets disponibles', 'Instrucciones'].every((h) => hojas.includes(h)), 'la plantilla de traslados trae Traslados, Listas, Pallets disponibles e Instrucciones', hojas.join(', '));
  const enc = [];
  libro.getWorksheet('Traslados').getRow(4).eachCell((c) => enc.push(String(c.value)));
  ok(['Código de pallet *', 'Bodega de origen *', 'Bodega de destino *', 'Bultos (si es parcial)', 'Kilos (si es parcial)', 'Fecha programada', 'Observaciones'].every((t) => enc.includes(t)),
    'con los campos de un traslado', enc.join(' | '));
  const pd = libro.getWorksheet('Pallets disponibles');
  const encPd = [];
  pd.getRow(2).eachCell((c) => encPd.push(String(c.value)));
  let filaA = null, hayBloq = false, hayAp = false;
  pd.eachRow((f, r) => {
    if (r < 3) return;
    if (f.getCell(1).value === A.codigo_pallet) filaA = [f.getCell(3).value, f.getCell(4).value, f.getCell(5).value];
    if (BQ && f.getCell(1).value === BQ.codigo_pallet) hayBloq = true;
    if (AP && f.getCell(1).value === AP.codigo_pallet) hayAp = true;
  });
  ok(encPd.join('|') === 'Código de pallet|Producto|Bodega|Bultos disponibles|Kilos disponibles|Meses en cámara', 'la hoja de pallets disponibles: código, producto, bodega, bultos y kilos', encPd.join('|'));
  ok(filaA && filaA[0] === 'Santa Mónica · Cámara 02' && filaA[1] === A.b && Math.abs(filaA[2] - Number(A.kg)) < 0.1, 'trae cada pallet libre con su bodega y lo disponible', JSON.stringify(filaA));
  ok(!hayBloq && !hayAp, 'y no trae los bloqueados ni los apartados enteros');
  ok(libro.getWorksheet('Traslados').getCell(6, 2).dataValidation?.type === 'list', 'las bodegas con lista desplegable');

  const ORI = 'Santa Mónica · Cámara 02';
  const obs = 'PRUEBA-IMP traslado';
  const ruta = await llenar(libro, 'Traslados', [
    /* 6 */ { 'Código de pallet': A.codigo_pallet, 'Bodega de origen': ORI, 'Bodega de destino': 'Freeko', 'Observaciones': obs },
    /* 7 */ { 'Código de pallet': B.codigo_pallet, 'Bodega de origen': ORI, 'Bodega de destino': 'Freeko', 'Bultos (si es parcial)': 5, 'Observaciones': obs },
    /* 8 */ { 'Código de pallet': C.codigo_pallet, 'Bodega de origen': 'Santa Mónica · Cámara 03', 'Bodega de destino': 'Freeko', 'Observaciones': obs },
    /* 9 */ { 'Código de pallet': AP.codigo_pallet, 'Bodega de origen': ORI, 'Bodega de destino': 'Freeko', 'Observaciones': obs },
    /* 10 */ { 'Código de pallet': BQ.codigo_pallet, 'Bodega de origen': ORI, 'Bodega de destino': 'Freeko', 'Observaciones': obs },
    /* 11 */ { 'Código de pallet': D.codigo_pallet, 'Bodega de origen': ORI, 'Bodega de destino': 'Freeko', 'Observaciones': obs },
    /* 12 */ { 'Código de pallet': A.codigo_pallet, 'Bodega de origen': ORI, 'Bodega de destino': 'Depsa', 'Observaciones': obs },
    /* 13 */ { 'Código de pallet': B.codigo_pallet + 'X', 'Bodega de origen': ORI, 'Bodega de destino': ORI, 'Observaciones': obs },
  ], `traslados-${SELLO}.xlsx`);
  await a.setInputFiles('input[type="file"][name="archivo"]', ruta);
  await a.click('[data-accion="subir-archivo"]');
  await a.waitForURL(/\/almacenes\/traslados\/importar\/\d+/, { timeout: 60000 });
  impTraslados = Number(a.url().match(/importar\/(\d+)/)[1]);
  await a.locator('[data-bloque="filas-importacion"]').waitFor();
  await captura(a, '05-revision-traslados');
  const det = async (n) => (await filaDe(a, n).locator('[data-detalle="fila"]').innerText()).replace(/\s+/g, ' ');
  const est = (n) => filaDe(a, n).getAttribute('data-estado');
  ok(await est(6) === 'valida' && await est(7) === 'valida' && await est(8) === 'valida', 'las filas buenas quedan listas (entera, parcial y de otra cámara)');
  ok(/apartado entero para pedidos/.test(await det(9)), 'pallet apartado', (await det(9)).slice(0, 100));
  ok(/bloqueado por Calidad/.test(await det(10)), 'pallet bloqueado por Calidad', (await det(10)).slice(0, 100));
  ok(new RegExp(`no está en ${ORI}: está en Elamar`).test(await det(11)), 'pallet de otra bodega (dice dónde está)', (await det(11)).slice(0, 100));
  ok(/ya aparece en la fila 6/.test(await det(12)), 'pallet repetido en el archivo');
  ok(/No existe ningún pallet/.test(await det(13)) && /misma bodega/.test(await det(13)), 'pallet inexistente y origen igual al destino', (await det(13)).slice(0, 140));
  const boton = a.locator('[data-accion="crear-traslados"]');
  ok(/Crear 2 traslados en borrador \(3 pallets\)/.test(await boton.innerText()), 'agrupa por origen → destino: «Crear 2 traslados en borrador (3 pallets)»', await boton.innerText());

  // Corregir en pantalla la fila 11: su origen real es Elamar.
  await filaDe(a, 11).locator('[data-accion="corregir-fila"]').click();
  await a.locator('[data-bloque="editor-fila"] select[name="origen"]').selectOption('Elamar');
  await a.locator('[data-bloque="editor-fila"] [data-accion="guardar-fila"]').click();
  ok(await esperarFila(a, 11, 'valida'), 'se corrige la bodega de origen en pantalla y la fila queda lista');
  await filaDe(a, 13).locator('[data-accion="descartar-fila"]').click();
  ok(await esperarFila(a, 13, 'descartada'), 'y se descarta la del pallet inexistente');

  await a.locator('[data-accion="crear-traslados"]:has-text("Crear 3 traslados")').waitFor({ timeout: 20000 });
  await a.click('[data-accion="crear-traslados"]');
  await a.waitForFunction(() => /creado/.test(document.querySelector('[data-aviso="importacion"]')?.textContent ?? ''), null, { timeout: 60000 });
  ok(/3 traslados creados en borrador/.test(await a.locator('[data-aviso="importacion"]').innerText()), 'crea 3 traslados en borrador', (await a.locator('[data-aviso="importacion"]').innerText()).slice(0, 100));
  const tras = await consultar(`select t.id, t.numero, t.estado::text, t.almacen_origen_id o, t.almacen_destino_id d, t.observaciones,
                                       json_agg(json_build_object('lote', tl.lote_id, 'b', tl.bultos_enviados, 'kg', tl.peso_enviado_kg)) lineas
                                  from traslados t join traslado_lineas tl on tl.traslado_id = t.id
                                 where t.id > ${prev.tr} and t.observaciones like 'PRUEBA-IMP%' group by t.id order by t.id`);
  ok(tras.length === 3 && tras.every((t) => t.estado === 'borrador' && t.d === 4), 'en la base: 3 traslados en borrador hacia Freeko', tras.map((t) => t.numero).join(', '));
  const t2 = tras.find((t) => t.o === 2);
  ok(t2?.lineas?.length === 2, 'los dos pallets de la Cámara 02 van en un mismo traslado');
  const lb = t2?.lineas?.find((l) => l.lote === B.lote_id);
  ok(lb?.b === 5 && Math.abs(Number(lb.kg) - 5 * Number(B.kg) / B.b) < 0.01, 'el parcial lleva 5 bultos con sus kilos reales');
  const la = t2?.lineas?.find((l) => l.lote === A.lote_id);
  ok(la?.b === A.b && Math.abs(Number(la.kg) - Number(A.kg)) < 0.01, 'el entero lleva todo lo disponible');
  ok(await esperarFila(a, 6, 'registrada') && await filaDe(a, 6).locator('[data-enlace="traslado"]').count() === 1, 'cada fila enlaza a su traslado');
  const existDespues = await consultar(`select lote_id, almacen_id, bultos, peso_neto_kg from existencias where lote_id in (${[A, B, C].map((x) => x.lote_id)}) order by 1, 2`);
  ok(JSON.stringify(existAntes) === JSON.stringify(existDespues), 'el borrador no mueve stock');

  /* ======================================================================
     5 · FALLAS: ficha del traslado, historial, mensajes, red
     ====================================================================== */
  console.log(SEC(5, 'Ficha del traslado, historial, mensajes de rol y cortes de red'));
  await g.goto(`${BASE}/almacenes/traslados/${t2.id}`, { waitUntil: 'networkidle' });
  const kpi = (await g.locator('.kpi:has(.kpi-etiqueta:text-is("Peso enviado"))').innerText()).replace(/\s+/g, ' ');
  ok(/TM/.test(kpi) && /kg/.test(kpi), '«Peso enviado» con su unidad (TM y kg)', kpi);
  await captura(g, '06-ficha-traslado');
  const [viejo] = await consultar(`select entidad_id from eventos where entidad = 'traslados' and tipo = 'traslado_en_transito' order by id limit 1`);
  if (viejo) {
    await g.goto(`${BASE}/almacenes/traslados/${viejo.entidad_id}`, { waitUntil: 'networkidle' });
    const hist = await g.locator('.linea-tiempo').innerText().catch(() => '');
    ok(!/en_transito|en estado/.test(hist) && /despachado: en tránsito/.test(hist), 'el historial ya no dice «en estado en_transito»');
  }
  // Mensajes de rol con nombre legible y quién sí puede (Comercio Exterior ve Traslados; Consulta, Ingresos).
  const cx = await sesion('comex');
  const r1 = await cx.request.get(`${BASE}/almacenes/traslados/importar/plantilla`, { maxRedirects: 0 });
  const j1 = await r1.json().catch(() => ({}));
  ok(r1.status() === 403 && /^Comercio Exterior no puede importar traslados: lo hacen Gerencia, Operaciones y Almacén\.$/.test(j1.error ?? ''),
    'Comercio Exterior recibe «Comercio Exterior no puede… lo hacen Gerencia, Operaciones y Almacén»', j1.error);
  await cx.goto(`${BASE}/almacenes/traslados`, { waitUntil: 'networkidle' });
  ok(await cx.locator('[data-accion="importar-traslados"]').count() === 0, 'y no ve «Importar desde Excel» en Traslados');
  await cx.context().close();
  const cs = await sesion('consulta');
  const r2 = await cs.request.get(`${BASE}/almacenes/ingresos/importar/plantilla`, { maxRedirects: 0 });
  const j2 = await r2.json().catch(() => ({}));
  ok(r2.status() === 403 && /^Consulta no puede importar ingresos a cámara: lo hacen Gerencia, Operaciones y Almacén\.$/.test(j2.error ?? ''), 'Consulta: «Consulta no puede importar ingresos a cámara…»', j2.error);
  await cs.goto(`${BASE}/almacenes/ingresos`, { waitUntil: 'networkidle' });
  ok(await cs.locator('[data-accion="importar-ingresos"]').count() === 0, 'y no ve los botones de importar ni de programados');
  await cs.context().close();

  // Corte de red al crear un traslado a mano.
  await a.goto(`${BASE}/almacenes/traslados/nuevo`, { waitUntil: 'networkidle' });
  await a.selectOption('select[name="origen"]', '2');
  await a.locator('.traslado-pallets input[type="checkbox"]').first().waitFor({ timeout: 30000 });
  await a.locator('.traslado-pallets input[type="checkbox"]').first().check();
  await a.selectOption('select[name="destino"]', '4');
  await a.route('**/almacenes/traslados/nuevo', (r) => (r.request().method() === 'POST' ? r.abort('internetdisconnected') : r.continue()));
  await a.click('[data-accion="crear-traslado"]');
  await a.waitForTimeout(2500);
  const aviso = await a.locator('[data-formulario="traslado"] .ficha-aviso-critico').innerText().catch(() => '');
  ok(/Se perdió la conexión/.test(aviso) && await a.locator('.traslado-pallets input[type="checkbox"]:checked').count() === 1,
    'un corte de red al crear un traslado se avisa en el formulario sin perder lo elegido');
  await a.unroute('**/almacenes/traslados/nuevo');

  /* ======================================================================
     6 · CONFIGURACIÓN › MAESTROS › ALMACENES
     ====================================================================== */
  console.log(SEC(6, 'Configuración › Maestros › Almacenes'));
  const op = await sesion('operaciones');
  await op.goto(`${BASE}/configuracion?t=maestros&m=almacenes`, { waitUntil: 'networkidle' });
  await op.locator('[data-bloque="almacenes"]').waitFor();
  ok((await op.locator('tr[data-almacen="ELAMAR"] [data-recibe="compras"]').innerText()).toLowerCase().includes('sí'), 'el catálogo dice qué recibe cada almacén (Elamar: compras)');
  await captura(op, '07-maestro-almacenes');
  // Editar uno existente: Coinrefri también recibe compras.
  await op.locator('tr[data-almacen="COINRE"] [data-accion="editar-almacen"]').click();
  await op.locator('[data-bloque="formulario-almacen"] input[name="recibe_compras"]').check();
  await op.locator('[data-bloque="formulario-almacen"] [data-accion="guardar-almacen"]').click();
  await op.locator('[data-aviso="almacenes"]').waitFor({ timeout: 30000 });
  const [co] = await consultar(`select id, recibe_compras from almacenes where codigo = 'COINRE'`);
  const [au] = await consultar(`select usuario_id, campos_cambiados from auditoria where tabla = 'almacenes' and registro_id = '${co.id}' and id > ${prev.au} order by id desc limit 1`);
  ok(co.recibe_compras === true && au?.usuario_id === (await uid('operaciones')) && au.campos_cambiados.includes('recibe_compras'), 'Operaciones lo cambia y queda en Auditoría con su usuario');
  await a.goto(`${BASE}/almacenes/ingresos/nuevo`, { waitUntil: 'networkidle' });
  await a.locator('input[name="origen_ingreso"][value="compras"]').check();
  ok((await a.locator('select[name="almacen_id"] option').allInnerTexts()).includes('Coinrefri'), 'y el formulario de ingreso ya la ofrece para compras');

  // Freeko tiene stock: no se puede desactivar.
  await op.reload({ waitUntil: 'networkidle' });
  await op.locator('tr[data-almacen="FREEKO"] [data-accion="editar-almacen"]').click();
  ok(await op.locator('[data-bloque="formulario-almacen"] input[name="activo"]').isDisabled(), 'un almacén con stock no se puede desactivar (la casilla se apaga y explica)');
  await op.locator('[data-bloque="formulario-almacen"] button:has-text("Cancelar")').click();
  ok(await op.locator('tr[data-almacen="FREEKO"] [data-accion="borrar-almacen"]').isDisabled(), 'ni borrar (tiene historia)');

  // Alta de un almacén nuevo.
  await op.click('[data-accion="nuevo-almacen"]');
  const f = op.locator('[data-bloque="formulario-almacen"]');
  await f.locator('input[name="nombre"]').fill(`PRUEBA-IMP Frío ${SELLO}`);
  await f.locator('select[name="tipo"]').selectOption('externo');
  await f.locator('input[name="ciudad"]').fill('Paita');
  await f.locator('input[name="capacidad_tm"]').fill('120');
  await f.locator('[data-accion="guardar-almacen"]').click();
  await op.locator('[data-aviso="almacenes"]').waitFor({ timeout: 30000 });
  const [nv] = await consultar(`select id, codigo, tipo::text, recibe_compras, recibe_produccion, activo from almacenes where nombre = 'PRUEBA-IMP Frío ${SELLO}'`);
  almacenNuevo = nv?.id ?? null;
  ok(nv && nv.tipo === 'externo' && nv.recibe_compras && !nv.recibe_produccion && nv.activo, 'se da de alta un almacén nuevo (externo, recibe compras)', `${nv?.codigo}`);
  const [au2] = await consultar(`select accion from auditoria where tabla = 'almacenes' and registro_id = '${nv?.id}'`);
  ok(au2?.accion === 'INSERT', 'con su alta en Auditoría');
  await op.reload({ waitUntil: 'networkidle' });
  await op.locator(`tr[data-almacen="${nv.codigo}"] [data-accion="borrar-almacen"]`).click();
  await op.click('[data-accion="confirmar-borrar-almacen"]');
  await op.waitForFunction(() => /borrado/.test(document.querySelector('[data-aviso="almacenes"]')?.textContent ?? ''), null, { timeout: 30000 });
  ok((await consultar(`select 1 from almacenes where id = ${nv.id}`)).length === 0, 'uno recién creado y sin uso se puede borrar');
  // El rol Almacén no puede cambiarlos: la base lo rechaza.
  const e4 = await como(await uid('almacen'), `update almacenes set recibe_compras = true where codigo = 'DEPSA' returning id`);
  const [dep] = await consultar(`select recibe_compras from almacenes where codigo = 'DEPSA'`);
  ok(dep.recibe_compras === false, 'el rol Almacén no puede cambiarlos ni saltándose la pantalla', e4 ?? 'sin filas');
  await op.context().close();
}

/* ==========================================================================
   LIMPIEZA
   ========================================================================== */
async function limpiar() {
  try {
    const misLotes = (await consultar(`select id from lotes where id > ${prev.lot} and codigo_pallet like 'PRB IMP ${SELLO}%'`)).map((x) => x.id);
    const misMov = misLotes.length ? (await consultar(`select id from movimientos where lote_id in (${misLotes})`)).map((x) => x.id) : [];
    const misImp = (await consultar(`select id from importaciones_excel where id > ${prev.imp}`)).map((x) => x.id)
      .filter((id) => [impIngresos, impTraslados].includes(id));
    const misProg = (await consultar(`select id from ingresos_programados where id > ${prev.prog} and codigo_pallet like 'PRB IMP ${SELLO}%'`)).map((x) => x.id);
    const misTras = impTraslados
      ? (await consultar(`select distinct traslado_id id from importaciones_excel_filas where importacion_id = ${impTraslados} and traslado_id is not null`)).map((x) => x.id)
      : [];
    const lista = (xs) => xs.map((x) => `'${x}'`).join(',') || "''";
    console.log(`  limpieza: ${misLotes.length} pallets, ${misMov.length} movimientos, ${misImp.length} importaciones, ${misProg.length} programados, ${misTras.length} traslados (correlativo ${prev.corr})`);
    await ejecutarSQL(`
      ${misTras.length ? `delete from traslados where id in (${misTras});` : ''}
      alter table movimientos disable trigger trg_kardex_no_delete;
      ${misMov.length ? `delete from movimientos where id in (${misMov});` : ''}
      alter table movimientos enable trigger trg_kardex_no_delete;
      ${misLotes.length ? `delete from existencias where lote_id in (${misLotes});` : ''}
      ${misImp.length ? `delete from importaciones_excel where id in (${misImp});` : ''}
      ${misProg.length ? `delete from ingresos_programados where id in (${misProg});` : ''}
      ${misLotes.length ? `delete from lotes where id in (${misLotes});` : ''}
      delete from eventos where id > ${prev.ev} and (
        (entidad = 'lotes' and entidad_id = any(array[${misLotes.join(',') || 0}]::bigint[]))
        or (entidad = 'ingresos_programados' and entidad_id = any(array[${misProg.join(',') || 0}]::bigint[]))
        or (entidad in ('traslados','traslado') and entidad_id = any(array[${misTras.join(',') || 0}]::bigint[])));
      delete from alertas where id > ${prev.al} and entidad = 'importacion' and entidad_id = any(array[${misImp.join(',') || 0}]::bigint[]);
      delete from auditoria where id > ${prev.au} and (
        (tabla = 'lotes' and registro_id = any(array[${lista(misLotes)}]))
        or (tabla = 'movimientos' and registro_id = any(array[${lista(misMov)}]))
        or (tabla = 'importaciones_excel' and registro_id = any(array[${lista(misImp)}]))
        or (tabla = 'ingresos_programados' and registro_id = any(array[${lista(misProg)}]))
        or (tabla = 'traslados' and registro_id = any(array[${lista(misTras)}]))
        or (tabla = 'traslado_lineas' and (datos_despues->>'traslado_id' = any(array[${lista(misTras)}]) or datos_antes->>'traslado_id' = any(array[${lista(misTras)}])))
        or (tabla = 'almacenes' and registro_id = any(array[${lista(almacenNuevo ? [almacenNuevo] : [])}])));
      ${almacenNuevo ? `delete from almacenes where id = ${almacenNuevo};` : ''}
      ${misTras.length ? `update correlativos set ultimo = ${prev.corr} where serie = 'TRAS' and anio = 2026 and ultimo = ${Number(prev.corr) + misTras.length};` : ''}
    `);
    // Las casillas de los almacenes, como estaban (y su huella de la prueba).
    const ahora = await consultar(`select id, recibe_produccion, recibe_compras from almacenes order by id`);
    const distintos = almacenesAntes.filter((x) => {
      const y = ahora.find((z) => z.id === x.id);
      return y && (y.recibe_produccion !== x.recibe_produccion || y.recibe_compras !== x.recibe_compras);
    });
    for (const x of distintos) {
      await ejecutarSQL(`update almacenes set recibe_produccion = ${x.recibe_produccion}, recibe_compras = ${x.recibe_compras} where id = ${x.id};
        delete from auditoria where id > ${prev.au} and tabla = 'almacenes' and registro_id = '${x.id}';`);
    }
    const [{ n }] = await consultar(`select count(*)::int n from lotes where codigo_pallet like 'PRB IMP ${SELLO}%'`);
    const [{ m }] = await consultar(`select count(*)::int m from ingresos_programados where codigo_pallet like 'PRB IMP ${SELLO}%'`);
    ok(n === 0 && m === 0, 'limpieza: pallets, Kardex, existencias, importaciones, programados, avisos e historial como estaban');
  } catch (e) {
    ok(false, 'limpieza', String(e.message).slice(0, 300));
    await intentar('alter table movimientos enable trigger trg_kardex_no_delete;');
  }
}
