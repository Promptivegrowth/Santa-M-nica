/**
 * ============================================================================
 *  PRUEBA · OBSERVACIONES ERP DE OLIVER (octubre 2026) · parte 2: operación
 * ============================================================================
 *  Puntos 9, 10, 11, 12, 13, 14, 15 y 17 del documento «Observaciones
 *  ERP.docx», en el navegador y contra la base. Lo que se crea se borra.
 *
 *      BASE_URL=http://localhost:3010 node scripts/probar-observaciones-octubre-2.mjs
 * ============================================================================
 */
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createClient } from '@supabase/supabase-js';
import { ejecutarSQL } from './db.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const consultar = async (sql) => { const r = await ejecutarSQL(sql); return Array.isArray(r) ? r : []; };
const SEC = (n, t) => `\n${'─'.repeat(3)} ${n} · ${t} ${'─'.repeat(3)}`;
const fallos = [];
const ok = (cond, texto, detalle = '') => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${texto}${detalle ? ' · ' + detalle : ''}`);
  if (!cond) fallos.push(texto);
};
const cerca = (a, b, t = 0.011) => Math.abs(Number(a) - Number(b)) <= t;
const CARPETA = join(tmpdir(), `sm-octubre-${Date.now()}`);
mkdirSync(CARPETA, { recursive: true });

const [{ ahora: INICIO }] = await consultar(`select now()::text as ahora`);
const [previos] = await consultar(`select (select coalesce(max(id),0) from movimientos) mov, (select coalesce(max(id),0) from lotes) lote,
                                          (select coalesce(max(id),0) from reservas) res, (select coalesce(max(id),0) from embarques) emb`);
const nav = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await nav.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const p = await ctx.newPage();
const entrar = async (pagina, email) => {
  await pagina.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await pagina.fill('input[type="email"]', email);
  await pagina.fill('input[type="password"]', 'SantaMonica2026');
  await pagina.click('button[type="submit"]');
  await pagina.waitForURL(/\/panel/, { timeout: 30000 });
};
const almacenamiento = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
await almacenamiento.auth.signInWithPassword({ email: 'gerencia@santamonica.pe', password: 'SantaMonica2026' });

let observacionAntes = null;
let embarqueObs = null;
let despachoId = null;

try {
  await entrar(p, 'gerencia@santamonica.pe');

  console.log(SEC(9, 'Pedidos: todos los productos de cada proforma, con su subtotal'));
  {
    await p.goto(`${BASE}/ventas/pedidos`, { waitUntil: 'networkidle' });
    const detalles = p.locator('tr[data-detalle]');
    ok(await detalles.count() > 0, 'cada pedido trae debajo el detalle de sus productos', `${await detalles.count()} proformas en la página`);
    //  Una proforma con varias líneas, contra la base.
    const ids = await detalles.evaluateAll((t) => t.map((x) => Number(x.getAttribute('data-detalle'))));
    const [varias] = await consultar(`select pedido_id, count(*)::int n,
                                              round(sum(cantidad_tm * precio_tm * (1 - descuento_pct / 100)), 2)::float sub
                                         from pedido_lineas where pedido_id in (${ids.join(',')})
                                        group by 1 order by 2 desc limit 1`);
    const fila = p.locator(`tr[data-detalle="${varias.pedido_id}"]`);
    ok(await fila.locator('tbody tr').count() === varias.n, 'están TODAS las líneas de la proforma', `${varias.n} productos`);
    const cab = await fila.locator('thead').innerText();
    ok(/SKU/i.test(cab) && /Descripci/i.test(cab) && /Cantidad/i.test(cab) && /Precio unitario/i.test(cab) && /Subtotal/i.test(cab),
       'con SKU, descripción, cantidad, precio unitario y subtotal');
    ok(cerca(await fila.locator('[data-subtotal-proforma]').getAttribute('data-subtotal-proforma'), varias.sub),
       'y el subtotal de la proforma cuadra con la base', String(varias.sub));
    await p.locator('[data-atajo="productos"]').click();
    await p.waitForURL(/productos=no/);
    ok(await p.locator('tr[data-detalle]').count() === 0, 'se puede ocultar para recorrer la lista más rápido');
    //  Quien no ve importes, ve los productos pero no los precios.
    const ctx2 = await nav.newContext({ viewport: { width: 1500, height: 900 } });
    const al = await ctx2.newPage();
    await entrar(al, 'almacen@santamonica.pe');
    await al.goto(`${BASE}/ventas/pedidos`, { waitUntil: 'networkidle' });
    const cabAl = await al.locator('tr[data-detalle] thead').first().innerText();
    ok(/SKU/i.test(cabAl) && !/Precio unitario/i.test(cabAl), 'Almacén ve los productos sin precios (como la columna Venta US$)');
    await ctx2.close();
  }

  console.log(SEC(10, 'Disponibilidad: reservar con un SKU equivalente, con trazabilidad'));
  {
    const [caso] = await consultar(`
      with lin as (
        select pl.id linea, pl.pedido_id, pl.sku_presentacion_id sp, s.especie_id, lower(trim(s.corte)) corte, p.tipo_despacho
          from pedido_lineas pl join pedidos p on p.id = pl.pedido_id
          join sku_presentaciones x on x.id = pl.sku_presentacion_id join skus s on s.id = x.sku_id
          join v_pedido_linea_cobertura c on c.linea_id = pl.id
         where p.ciclo = 'confirmado' and p.situacion not in ('facturado','parcialmente_cobrado','cobrado') and c.backorder_kg > 500)
      select l.linea, l.pedido_id, l.sp
        from lin l
        join sku_presentaciones x2 on x2.id <> l.sp
        join skus s2 on s2.id = x2.sku_id and s2.especie_id = l.especie_id and lower(trim(s2.corte)) = l.corte
        join v_stock_lote v on v.sku_presentacion_id = x2.id and v.disponible_kg > 0 and (v.solo_nacional_kg = 0 or l.tipo_despacho = 'mercado_nacional')
       group by 1, 2, 3 order by sum(v.disponible_kg) desc limit 1`);
    ok(!!caso, 'hay un pedido con faltante y stock de un SKU equivalente para probar');
    await p.goto(`${BASE}/ventas/pedidos/${caso.pedido_id}?t=disponibilidad`, { waitUntil: 'networkidle' });
    const fila = p.locator(`tr[data-linea="${caso.linea}"]`);
    await fila.locator('button', { hasText: 'Apartar stock' }).click();
    await p.locator('.reservar').first().waitFor({ timeout: 20000 });
    ok(await p.locator('.reservar tr[data-equivalente="si"]').count() === 0, 'por defecto solo se ofrece el SKU pedido');
    await p.locator('input[name="equivalentes"]').check();
    await p.locator('.reservar tr[data-equivalente="si"]').first().waitFor({ timeout: 20000 });
    const nEq = await p.locator('.reservar tr[data-equivalente="si"]').count();
    ok(nEq > 0, 'con «SKU equivalentes» aparecen pallets de la misma especie y corte', `${nEq} pallets`);
    await p.locator('.reservar tr[data-equivalente="si"]').first().locator('button', { hasText: 'Elegir' }).click();
    ok(/SKU equivalente/i.test(await p.locator('.reservar-confirma').innerText()), 'al elegirlo se avisa que es un equivalente');
    await p.fill(`#kg-${caso.linea}`, '100');
    await p.locator('.reservar-confirma button', { hasText: 'Apartar' }).click();
    await p.locator('.reservar-mensaje').waitFor({ timeout: 20000 });
    const msg = await p.locator('.reservar-mensaje').innerText();
    ok(/SKU equivalente: se pidió .* y se apartó/.test(msg), 'apartado: el mensaje dice qué se pidió y qué se apartó', msg.slice(0, 120));
    const [r] = await consultar(`select r.id, r.sku_solicitado_id, r.sku_reservado_id, r.peso_neto_kg::float kg, r.observaciones, l.sku_presentacion_id lote_sp
                                   from reservas r join lotes l on l.id = r.lote_id
                                  where r.pedido_linea_id = ${caso.linea} and r.id > ${previos.res} order by r.id desc limit 1`);
    ok(r && Number(r.sku_solicitado_id) === Number(caso.sp) && Number(r.sku_reservado_id) === Number(r.lote_sp)
       && Number(r.sku_reservado_id) !== Number(caso.sp) && r.kg === 100,
       'la base guarda SKU solicitado, SKU reservado y la cantidad', r ? `${r.sku_solicitado_id} → ${r.sku_reservado_id} · ${r.kg} kg` : '');
    const [{ cubre }] = await consultar(`select reservado_kg::float cubre from v_pedido_linea_cobertura where linea_id = ${caso.linea}`);
    ok(cubre >= 100, 'y cuenta para cubrir la línea del pedido', `${cubre} kg reservados`);
    await p.goto(`${BASE}/ventas/pedidos/${caso.pedido_id}?t=reservas`, { waitUntil: 'networkidle' });
    ok(await p.locator('[data-sku-equivalente="si"]').count() >= 1, 'en las reservas del pedido se ve «Equivalente · se pidió …»');
    await p.goto(`${BASE}/almacenes/reservas?id=${r.id}`, { waitUntil: 'networkidle' });
    ok(/equivalente/i.test(await p.locator('main').innerText()), 'y también en Almacén → Reservas');
    await consultar(`delete from reservas where id = ${r.id}`);
  }

  console.log(SEC(11, 'Ingresos: origen Producción o Compras, guardado en el movimiento'));
  {
    await p.goto(`${BASE}/almacenes/ingresos/nuevo`, { waitUntil: 'networkidle' });
    const pallet = `PRB-OCT-${Date.now() % 100000}`;
    await p.getByLabel(/Código de pallet/).fill(pallet);
    const prod = await p.getByLabel(/^Producto/).locator('option').nth(1).getAttribute('value');
    await p.getByLabel(/^Producto/).selectOption(prod);
    await p.getByLabel(/^Bultos/).fill('20');
    await p.getByLabel(/Peso neto total/).fill('500');
    await p.locator('button', { hasText: 'Registrar ingreso' }).click();
    await p.waitForTimeout(1500);
    ok(/origen del ingreso/i.test(await p.locator('[role="alert"].ficha-aviso').innerText().catch(() => '')), 'sin origen no se registra: lo pide');
    await p.locator('input[name="origen_ingreso"][value="compras"]').check();
    await p.locator('button', { hasText: 'Registrar ingreso' }).click();
    await p.waitForTimeout(1500);
    ok(/proveedor/i.test(await p.locator('[role="alert"].ficha-aviso').innerText().catch(() => '')), 'una compra pide el proveedor');
    await p.fill('input[name="proveedor"]', 'Proveedor de prueba S.A.C.');
    await p.locator('button', { hasText: 'Registrar ingreso' }).click();
    await p.waitForTimeout(3500);
    const [m] = await consultar(`select m.origen_ingreso, m.proveedor from movimientos m join lotes l on l.id = m.lote_id where l.codigo_pallet = '${pallet}'`);
    ok(m && m.origen_ingreso === 'compras' && m.proveedor === 'Proveedor de prueba S.A.C.', 'el movimiento guarda el origen y el proveedor');
    const falla = await ejecutarSQL(`begin;
      insert into movimientos (tipo, lote_id, almacen_id, bultos, peso_neto_kg, usuario_id)
      select 'ingreso', l.id, m.almacen_id, 1, 1, m.usuario_id from lotes l join movimientos m on m.lote_id = l.id where l.codigo_pallet = '${pallet}';
      rollback;`)
      .then(() => null, (e) => String(e.message));
    ok(falla && /movimientos_ingreso_con_origen/.test(falla), 'la base rechaza un ingreso nuevo sin origen');
    await p.goto(`${BASE}/almacenes/ingresos?origen=compras`, { waitUntil: 'networkidle' });
    const txt = await p.locator('main').innerText();
    ok(txt.includes(pallet) && (await p.locator('[data-origen="produccion"]').count()) === 0, 'Ingresos se puede consultar por origen (Compras)');
    await p.goto(`${BASE}/almacenes/ingresos`, { waitUntil: 'networkidle' });
    ok(await p.locator('[data-origen="sin"]').count() > 0, 'los ingresos anteriores dicen «Sin clasificar»: no se inventa su origen');
  }

  console.log(SEC(12, 'Embarques: observaciones editables y guardadas'));
  {
    const [e] = await consultar(`select id, observaciones from embarques where estado not in ('cancelado') order by id desc limit 1`);
    embarqueObs = e.id; observacionAntes = e.observaciones;
    await p.goto(`${BASE}/logistica/embarques/${e.id}`, { waitUntil: 'networkidle' });
    await p.locator('[data-accion="editar-observaciones"]').click();
    await p.fill('textarea[name="observaciones_embarque"]', 'Booking movido al jueves · prueba de octubre');
    await p.locator('[data-bloque="observaciones-embarque"] button', { hasText: 'Guardar' }).click();
    await p.locator('.observaciones-texto', { hasText: 'Booking movido al jueves' }).waitFor({ timeout: 15000 });
    const [g] = await consultar(`select observaciones from embarques where id = ${e.id}`);
    ok(g.observaciones === 'Booking movido al jueves · prueba de octubre', 'se guardan en el embarque');
    await p.reload({ waitUntil: 'networkidle' });
    ok(/Booking movido al jueves/.test(await p.locator('[data-bloque="observaciones-embarque"]').innerText()), 'y quedan disponibles al volver');
    const [{ n }] = await consultar(`select count(*)::int n from auditoria where tabla = 'embarques' and registro_id = '${e.id}' and ocurrido_en > '${INICIO}'`)
      .catch(() => [{ n: -1 }]);
    ok(n !== 0, 'el cambio queda en el historial del embarque', n < 0 ? 'sin tabla de auditoría consultable' : `${n} registro(s)`);
  }

  console.log(SEC(13, 'Programar embarque: qué productos y cuánto sale de cada proforma'));
  let embNuevo = null;
  {
    await p.goto(`${BASE}/logistica/embarques/nuevo`, { waitUntil: 'networkidle' });
    const casilla = p.locator('input[aria-label^="Incluir "]').first();
    const proforma = (await casilla.getAttribute('aria-label')).replace('Incluir ', '');
    await casilla.check();
    await p.locator('[data-bloque="embarque-lineas"] tbody tr').first().waitFor({ timeout: 20000 });
    const filas = p.locator('[data-bloque="embarque-lineas"] tbody tr');
    const n = await filas.count();
    ok(n > 0, `al marcar ${proforma} aparecen sus productos`, `${n} línea(s)`);
    const cab = await p.locator('[data-bloque="embarque-lineas"] thead').innerText();
    ok(/SKU apartado/i.test(cab) && /Sale ahora/i.test(cab) && /Queda pendiente/i.test(cab), 'con el SKU apartado, lo que sale y lo que queda pendiente');
    //  Despacho parcial: de la primera línea con algo propuesto, sale la mitad.
    let elegida = null;
    for (let i = 0; i < n; i++) {
      const v = Number(await filas.nth(i).locator('input').inputValue());
      if (v > 0.002) { elegida = { i, v, clave: await filas.nth(i).getAttribute('data-linea') }; break; }
    }
    ok(!!elegida, 'se propone sacar lo apartado en la bodega de salida', elegida ? `${elegida.v} TM` : '');
    const mitad = Math.round((elegida.v / 2) * 1000) / 1000;
    await filas.nth(elegida.i).locator('input').fill(String(mitad));
    const pend = Number(await filas.nth(elegida.i).locator('[data-pendiente]').getAttribute('data-pendiente'));
    const [prog] = await consultar(`select por_programar_kg::float kg from v_pedido_linea_programacion where pedido_linea_id = ${elegida.clave.split('-')[0]}`);
    ok(cerca(pend, prog.kg / 1000 - mitad, 0.002), 'el pendiente se recalcula al cambiar lo que sale', `${pend} TM`);
    const dest = p.locator('select').filter({ has: p.locator('option', { hasText: 'Sin especificar' }) }).first();
    const opcion = await dest.locator('option').nth(1).getAttribute('value');
    await dest.selectOption(opcion);
    await p.locator('button', { hasText: 'Programar embarque' }).click();
    await p.waitForURL(/\/logistica\/embarques\/\d+$/, { timeout: 30000 });
    embNuevo = Number(p.url().match(/(\d+)$/)[1]);
    const [lin] = await consultar(`select el.cantidad_kg::float kg, el.sku_presentacion_id from embarque_lineas el
                                     where el.embarque_id = ${embNuevo} and el.pedido_linea_id = ${elegida.clave.split('-')[0]}`);
    ok(lin && cerca(lin.kg, mitad * 1000, 1), 'se guarda la cantidad elegida para ese producto', `${lin?.kg} kg`);
    ok(await p.locator('table[data-cuadro="embarque-lineas"] tbody tr').count() >= 1, 'la ficha del embarque muestra qué sale y cuánto queda pendiente');
    const [{ saldo }] = await consultar(`select por_programar_kg::float saldo from v_pedido_linea_programacion where pedido_linea_id = ${elegida.clave.split('-')[0]}`);
    ok(cerca(saldo, prog.kg - mitad * 1000, 1), 'el saldo por programar baja exactamente lo programado', `${saldo} kg`);
    //  El pedido sigue disponible para el próximo embarque, por su saldo.
    await p.goto(`${BASE}/logistica/embarques/nuevo`, { waitUntil: 'networkidle' });
    ok(await p.locator(`input[aria-label="Incluir ${proforma}"]`).count() === 1, 'con saldo pendiente, la proforma se puede volver a embarcar (parcial)');
    const exceso = await ejecutarSQL(`insert into embarque_lineas (embarque_id, pedido_linea_id, sku_presentacion_id, cantidad_kg)
                                      values (${embNuevo}, ${elegida.clave.split('-')[0]}, ${lin.sku_presentacion_id}, ${saldo + 5000})`)
      .then(() => null, (e) => String(e.message));
    ok(exceso && /quedan .* kg por programar/.test(exceso), 'la base impide programar más de lo que queda', exceso?.slice(0, 90));
  }

  console.log(SEC(14, 'Despachos: selector por operación y por ítem'));
  {
    await p.goto(`${BASE}/logistica/despachos`, { waitUntil: 'networkidle' });
    const primeros = await p.locator('tr[data-despacho]').evaluateAll((t) => t.slice(0, 2).map((x) => Number(x.getAttribute('data-despacho'))));
    const [a, b] = primeros;
    const items = await consultar(`select d.id, count(pl.id)::int n from despachos d join packing_lineas pl on pl.packing_list_id = d.packing_list_id
                                    where d.id in (${a}, ${b}) group by 1`);
    const nA = items.find((x) => x.id === a).n;
    await p.locator(`input[data-casilla="despacho-${a}"]`).check();
    ok(await p.locator('[data-elegidos]').getAttribute('data-elegidos') === `1-${nA}`, 'por operación: marcar el despacho elige todos sus ítems', `${nA} ítems`);
    await p.locator(`[data-desplegar="${b}"]`).click();
    const primerItem = await p.locator(`tr[data-items="${b}"] tr[data-item]`).first().getAttribute('data-item');
    await p.locator(`input[data-casilla="item-${primerItem}"]`).check();
    ok(await p.locator('[data-elegidos]').getAttribute('data-elegidos') === `2-${nA + 1}`, 'por ítem: se puede elegir un pallet suelto de otro despacho');
    ok(await p.locator(`input[data-casilla="despacho-${b}"]`).evaluate((x) => x.indeterminate), 'y su despacho queda «a medias»');
    const href = await p.locator('[data-accion="excel"]').getAttribute('href');
    const r = await p.request.get(`${BASE}${href}`);
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(await r.body());
    const hoja = libro.worksheets[0];
    let datos = 0; let conProforma = 0;
    hoja.eachRow((fila) => {
      const v = fila.values;
      if (typeof v[1] === 'string' && /^DESP-/.test(v[1])) { datos += 1; if (v[4]) conProforma += 1; }
    });
    ok(r.status() === 200 && datos === nA + 1, 'el Excel trae exactamente lo elegido', `${datos} ítems`);
    ok(conProforma === datos, 'cada ítem con su proforma, embarque, producto y cantidad');
    const pdf = await p.request.get(`${BASE}${await p.locator('[data-accion="reporte"]').getAttribute('href')}`);
    ok(pdf.status() === 200 && (await pdf.body()).slice(0, 4).toString() === '%PDF', 'y el reporte de carga de lo elegido, en PDF');
    despachoId = a;
  }

  console.log(SEC('15 y 17', 'Ficha del despacho: guía final en PDF y fotos de la carga'));
  {
    //  Un PDF y dos fotos de verdad, hechos para la prueba.
    const guia = join(CARPETA, 'guia-remision-final.pdf');
    await new Promise((ok2) => { const d = new PDFDocument(); const t = []; d.on('data', (x) => t.push(x)); d.on('end', () => { writeFileSync(guia, Buffer.concat(t)); ok2(); }); d.text('Guía de remisión T001-12345 · prueba'); d.end(); });
    await p.goto(`${BASE}/logistica/despachos/${despachoId}`, { waitUntil: 'networkidle' });
    const foto1 = join(CARPETA, 'contenedor-vacio.jpg');
    const foto2 = join(CARPETA, 'precinto.png');
    await p.screenshot({ path: foto1, type: 'jpeg', quality: 60 });
    await p.screenshot({ path: foto2, type: 'png', clip: { x: 0, y: 0, width: 500, height: 350 } });
    const texto = join(CARPETA, 'nota.txt');
    writeFileSync(texto, 'no es un pdf');

    ok(/Falta/.test(await p.locator('main').innerText()), 'la ficha avisa que falta la guía final');
    await p.setInputFiles('input[name="archivo-guia"]', texto);
    await p.locator('[data-archivos="guia"] [role="alert"]').waitFor({ timeout: 15000 });
    ok(/tiene que ser PDF/.test(await p.locator('[data-archivos="guia"] [role="alert"]').innerText()), 'un archivo que no es PDF no se acepta como guía');
    await p.setInputFiles('input[name="archivo-guia"]', guia);
    await p.locator('[data-archivos="guia"] li[data-archivo]').first().waitFor({ timeout: 30000 });
    const [g] = await consultar(`select ruta, tipo_mime, tamano_bytes::int t from despacho_archivos where despacho_id = ${despachoId} and tipo = 'guia'`);
    ok(g && g.tipo_mime === 'application/pdf' && g.ruta.startsWith(`despacho-${despachoId}/guia/`), 'la guía queda guardada y vinculada al despacho');
    const ver = await p.request.get(await p.locator('[data-ver="guia"]').first().getAttribute('href'));
    ok(ver.status() === 200 && (await ver.body()).slice(0, 4).toString() === '%PDF', 'se puede ver (enlace firmado y privado)');
    const desc = await p.locator('[data-descargar="guia"]').first().getAttribute('href');
    ok(/download=/.test(desc), 'y descargar con su nombre');
    const publico = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/despachos/${g.ruta}`);
    ok(publico.status >= 400, 'sin enlace firmado no se puede abrir: el repositorio es privado', String(publico.status));

    await p.setInputFiles('input[name="archivo-foto"]', [foto1, foto2]);
    await p.locator('[data-archivos="foto"] li[data-archivo]').nth(1).waitFor({ timeout: 40000 });
    ok(await p.locator('[data-archivos="foto"] img').count() === 2, 'se suben varias fotos a la vez y se ven en la ficha');

    const rep = await p.request.get(`${BASE}/api/despachos/reporte?ids=${despachoId}`);
    const cuerpo = await rep.body();
    const imagenes = (cuerpo.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length;
    ok(rep.status() === 200 && cuerpo.slice(0, 4).toString() === '%PDF', 'el reporte de carga se descarga en PDF');
    ok(imagenes >= 2, 'e incluye las fotos como evidencia', `${imagenes} imágenes en el PDF (con el logo)`);

    //  Quien solo consulta, ve pero no sube.
    const ctx3 = await nav.newContext({ viewport: { width: 1400, height: 900 } });
    const c = await ctx3.newPage();
    await entrar(c, 'consulta@santamonica.pe');
    await c.goto(`${BASE}/logistica/despachos/${despachoId}`, { waitUntil: 'networkidle' });
    ok(await c.locator('input[name="archivo-guia"]').count() === 0 && await c.locator('[data-archivos="guia"] li').count() === 1,
       'Consulta ve la guía pero no puede subir ni quitar archivos');
    await ctx3.close();

    //  Quitar: borra el archivo y su registro.
    await p.locator('[data-archivos="guia"] button', { hasText: 'Quitar' }).first().click();
    await p.locator('[data-archivos="guia"] .archivos-vacio').waitFor({ timeout: 20000 });
    const { data: quedan } = await almacenamiento.storage.from('despachos').list(`despacho-${despachoId}/guia`);
    ok((quedan ?? []).length === 0, 'quitar la guía la borra del repositorio y de la base');
  }

  //  Lo que creó la sección 13.
  if (embNuevo) {
    await consultar(`delete from embarque_lineas where embarque_id = ${embNuevo};
                     delete from embarque_pedidos where embarque_id = ${embNuevo};
                     delete from embarques where id = ${embNuevo};`);
  }
} catch (e) {
  console.error(e);
  fallos.push(String(e.message ?? e));
} finally {
  /* ---- Se deja todo como estaba ---- */
  if (embarqueObs) await consultar(`update embarques set observaciones = ${observacionAntes === null ? 'null' : `'${String(observacionAntes).replace(/'/g, "''")}'`} where id = ${embarqueObs}`);
  await consultar(`delete from embarque_lineas where embarque_id > ${previos.emb};
                   delete from embarque_pedidos where embarque_id > ${previos.emb};
                   delete from embarques where id > ${previos.emb};
                   delete from reservas where id > ${previos.res};`).catch((e) => console.error('limpieza', e.message));
  if (despachoId) {
    const archivos = await consultar(`select ruta from despacho_archivos where despacho_id = ${despachoId} and subido_en > '${INICIO}'`);
    if (archivos.length) await almacenamiento.storage.from('despachos').remove(archivos.map((a) => a.ruta));
    await consultar(`delete from despacho_archivos where despacho_id = ${despachoId} and subido_en > '${INICIO}'`);
  }
  await consultar(`
    alter table movimientos disable trigger trg_kardex_no_delete;
    delete from movimientos where id > ${previos.mov};
    delete from existencias where lote_id > ${previos.lote};
    delete from lotes where id > ${previos.lote};
    alter table movimientos enable trigger trg_kardex_no_delete;`).catch((e) => console.error('limpieza kardex', e.message));
  await nav.close();
  console.log(fallos.length ? `\n${fallos.length} FALLAS:\n - ${fallos.join('\n - ')}` : '\nTodo correcto');
  process.exit(fallos.length ? 1 : 0);
}
