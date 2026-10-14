/**
 * ============================================================================
 *  PRUEBA · CONTRATO CON EL MODELO INSTITUCIONAL DE SANTA MÓNICA
 * ============================================================================
 *  Contra el Word que envió Oliver (contrato SM26-378): el número sale de la
 *  proforma, cada campo amarillo se llena con la proforma y el cliente, se
 *  revisa y corrige en pantalla, se genera, se versiona (Rev.) y se descarga
 *  en PDF y en Word. Más el camino desde la cotización aprobada y los
 *  permisos. Lo que se crea se borra al final.
 *
 *      BASE_URL=http://localhost:3010 node scripts/probar-contrato.mjs [carpeta-para-guardar-los-archivos]
 * ============================================================================
 */
import { chromium } from 'playwright';
import JSZip from 'jszip';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ejecutarSQL } from './db.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const GUARDAR = process.argv[2] ?? null;
const consultar = async (sql) => { const r = await ejecutarSQL(sql); return Array.isArray(r) ? r : []; };
const SEC = (n, t) => `\n${'─'.repeat(3)} ${n} · ${t} ${'─'.repeat(3)}`;
const fallos = [];
const ok = (cond, texto, detalle = '') => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${texto}${detalle ? ' · ' + detalle : ''}`);
  if (!cond) fallos.push(texto);
};

const [{ ahora: INICIO }] = await consultar(`select now()::text as ahora`);
const [ctrAntes] = await consultar(`select coalesce(max(id), 0) id from contratos`);
//  Una proforma de exportación con dos productos, adelanto y tolerancia.
const [ped] = await consultar(`
  select p.id, p.numero_proforma, upper(c.razon_social) cliente, c.ruc_tax_id, c.etiqueta_tax_id, p.tolerancia_pct::float tol,
         p.pago_adelanto_pct::float adelanto, p.mes_embarque::text mes, upper(d.puerto) puerto, upper(d.pais) pais, p.incoterm,
         (select round(sum(cantidad_tm) * 1000, 2)::float from pedido_lineas where pedido_id = p.id) kg
    from pedidos p join clientes c on c.id = p.cliente_id join destinos d on d.id = p.destino_id
   where p.numero_proforma = 'SM26-283'`);
let pedidoNuevo = null;
let cotPrueba = null;

const nav = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await nav.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
const p = await ctx.newPage();
const entrar = async (pagina, email) => {
  await pagina.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await pagina.fill('input[type="email"]', email);
  await pagina.fill('input[type="password"]', 'SantaMonica2026');
  await pagina.click('button[type="submit"]');
  await pagina.waitForURL(/\/panel/, { timeout: 30000 });
};

try {
  await entrar(p, 'gerencia@santamonica.pe');

  console.log(SEC(1, 'Se arma solo con la proforma, como el modelo'));
  await p.goto(`${BASE}/ventas/pedidos/${ped.id}`, { waitUntil: 'networkidle' });
  await p.locator('[data-enlace="contrato"]').click();
  await p.waitForURL(/\/contrato$/, { timeout: 20000 });
  const v = async (n) => p.locator(`[name="${n}"]`).inputValue();
  ok(await p.locator('[data-siguiente]').getAttribute('data-siguiente') === 'SM-2026-283',
     'el número sale de la proforma: SM26-283 → SM-2026-283');
  ok(await v('comprador.nombre') === ped.cliente, 'el comprador, de la ficha del cliente', ped.cliente);
  ok((await v('comprador.documento')).includes(String(ped.ruc_tax_id)), 'con su documento tributario', await v('comprador.documento'));
  const kgTexto = ped.kg.toLocaleString('en-US', { minimumFractionDigits: 2 });
  ok(await v('cantidad') === `${kgTexto} KG (+/- ${ped.tol}%)`, 'cantidad en kilos con la tolerancia, como «80,955.00 KG (+/- 10%)»', await v('cantidad'));
  ok((await v('precio')).includes(`USD/KG ${ped.incoterm} ${ped.puerto}, ${ped.pais}`), 'precio por kilo con incoterm y destino', (await v('precio')).split('\n')[0]);
  ok((await v('pago.en')) === `${ped.adelanto}% ADVANCE PAYMENT\n${100 - ped.adelanto}% AGAINST COPY OF DOCUMENTS BY EMAIL`,
     'forma de pago como el modelo: «20% ADVANCE PAYMENT / 80% AGAINST COPY…»');
  ok((await v('pago.es')).startsWith(`${ped.adelanto}% PAGO ADELANTADO`), 'y en castellano');
  ok(/^[A-Z]+, \d{4}$/.test(await v('periodo.en')) && (await v('periodo.en')).startsWith('JULY'),
     'periodo de embarque del pedido («JULY, 2026»), sin correrse de mes', await v('periodo.en'));
  ok(await v('puertoCarga') === 'PAITA, PERU', 'puerto de carga', await v('puertoCarga'));
  ok((await v('banco.swift')).length > 0 && (await v('banco.cuenta')).length > 0, 'banco, SWIFT y cuenta de Configuración');
  ok(/WINGS|SQUID|POTA/i.test(await v('producto.en')) || (await v('producto.en')).length > 5, 'producto en inglés del maestro', await v('producto.en'));

  console.log(SEC(2, 'Se revisa, se corrige y se genera'));
  await p.fill('[name="producto.en"]', `${await v('producto.en')}, GRADE B`);
  await p.locator('[data-accion="generar-contrato"]').click();
  await p.locator('table[data-cuadro="contratos"] tr[data-contrato="SM-2026-283"], .form-mensaje.error').first().waitFor({ timeout: 30000 });
  if (await p.locator('.form-mensaje.error').count()) throw new Error(`No generó: ${await p.locator('.form-mensaje.error').innerText()}`);
  const [c1] = await consultar(`select id, numero, revision, datos from contratos where pedido_id = ${ped.id} order by id`);
  ok(c1 && c1.numero === 'SM-2026-283' && c1.revision === 0, 'primer contrato: SM-2026-283');
  ok(c1.datos.producto.en.endsWith(', GRADE B'), 'guarda lo corregido en pantalla');
  ok(/^[A-Z]+ \d{2}, \d{4} \/ \d{2} DE [A-Z]+ \d{4}$/.test(c1.datos.fecha), 'fecha bilingüe como el modelo', c1.datos.fecha);
  await p.locator('[data-accion="generar-contrato"]').click();
  await p.locator('tr[data-contrato="SM-2026-283 (Rev.)"]').waitFor({ timeout: 30000 });
  ok(true, 'la segunda versión es «SM-2026-283 (Rev.)», como el modelo');
  //  Un campo obligatorio vacío no se genera.
  await p.fill('[name="banco.cuenta"]', '');
  await p.locator('[data-accion="generar-contrato"]').click();
  await p.locator('.form-mensaje.error').waitFor({ timeout: 15000 });
  ok(/cuenta bancaria/.test(await p.locator('.form-mensaje.error').innerText()), 'sin cuenta bancaria no se genera: lo dice');

  console.log(SEC(3, 'PDF y Word'));
  const pdf = await p.request.get(`${BASE}/api/contratos/${c1.id}?formato=pdf`);
  const bPdf = await pdf.body();
  ok(pdf.status() === 200 && bPdf.slice(0, 4).toString() === '%PDF', 'el PDF se descarga', `${bPdf.length} bytes`);
  const paginas = (bPdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
  ok(paginas >= 4, 'con el contrato completo y el Anexo N° 2', `${paginas} páginas`);
  const word = await p.request.get(`${BASE}/api/contratos/${c1.id}?formato=word`);
  const bWord = await word.body();
  ok(word.status() === 200 && /wordprocessingml/.test(word.headers()['content-type']), 'el Word se descarga');
  const zip = await JSZip.loadAsync(bWord);
  const xml = await zip.file('word/document.xml').async('string');
  const texto = xml.replace(/<w:br\/>/g, '\n').replace(/<[^>]+>/g, '');
  ok(!/\{\{|\}\}/.test(xml), 'ningún marcador sin llenar');
  ok(texto.includes('SM-2026-283') && texto.includes('SM26-283') && texto.includes(ped.cliente.replace(/&/g, '&amp;')), 'lleva número, proforma y comprador');
  ok(texto.includes('GRADE B') && texto.includes('ADVANCE PAYMENT') && texto.includes(kgTexto), 'producto corregido, forma de pago y cantidad');
  ok(texto.includes('Anti-Bribery and Corruption Provision') && texto.includes('COMBINED DECLARATIONS'), 'con el texto fijo del modelo (declaraciones y anexo)');
  const rels = await zip.file('word/_rels/document.xml.rels').async('string');
  const destino = rels.match(/<Relationship [^>]*Id="rId11"[^>]*>/)[0].match(/Target="([^"]+)"/)[1];
  const firma = await zip.file(`word/${destino}`).async('nodebuffer');
  ok(firma.length > 1000, 'con la firma del gerente, de Configuración', `${firma.length} bytes`);
  const [{ con_f }] = await consultar(`select (datos->'documentoF'->>'en') <> '' as con_f from contratos where id = ${c1.id}`);
  ok(texto.includes('Catch Certificate') === con_f, 'el documento F va solo si se indicó', con_f ? 'lleva certificado de captura' : 'sin documento F (destino fuera de la UE)');
  if (GUARDAR) {
    writeFileSync(join(GUARDAR, 'prueba-contrato.pdf'), bPdf);
    writeFileSync(join(GUARDAR, 'prueba-contrato.docx'), bWord);
    console.log(`   archivos guardados en ${GUARDAR}`);
  }

  console.log(SEC(4, 'Desde la cotización aprobada'));
  {
    //  Una cotización aprobada sin proforma, copiada de una existente.
    const [base] = await consultar(`select c.id from cotizaciones c where c.aprobada_en is not null
                                      and exists (select 1 from cotizacion_lineas l where l.cotizacion_id = c.id) order by c.id desc limit 1`);
    const [nueva] = await consultar(`
      insert into cotizaciones (numero, cliente_id, vendedor_id, estado, moneda, tipo_cambio, incoterm, destino_id, lista_id, validez_dias, fecha,
                                observaciones, creado_por, prioridad, aprobada_por, aprobada_en, forma_pago, adelanto_pct)
      select 'COT-PRUEBA-CTR', cliente_id, vendedor_id, 'aprobada', moneda, tipo_cambio, incoterm, destino_id, lista_id, validez_dias,
             (now() at time zone 'America/Lima')::date, 'Prueba de contrato', creado_por, prioridad, aprobada_por, now(), 'adelanto_saldo', 30
        from cotizaciones where id = ${base.id} returning id`);
    cotPrueba = nueva.id;
    await consultar(`insert into cotizacion_lineas (cotizacion_id, sku_presentacion_id, cantidad_tm, precio_lista_tm, precio_tm, descuento_pct, orden)
                     select ${cotPrueba}, sku_presentacion_id, cantidad_tm, precio_lista_tm, precio_tm, descuento_pct, orden
                       from cotizacion_lineas where cotizacion_id = ${base.id}`);
    await p.goto(`${BASE}/ventas/cotizaciones/${cotPrueba}`, { waitUntil: 'networkidle' });
    await p.locator('[data-enlace="contrato"]').click();
    await p.waitForURL(/cotizaciones\/\d+\/contrato$/, { timeout: 20000 });
    ok(/falta la proforma/i.test(await p.locator('main').innerText()), 'aprobada sin proforma: explica que el contrato lleva el número de la proforma');
    await p.locator('[data-accion="proforma-y-contrato"]').click();
    await p.waitForURL(/pedidos\/\d+\/contrato$/, { timeout: 30000 });
    pedidoNuevo = Number(p.url().match(/pedidos\/(\d+)/)[1]);
    const [np] = await consultar(`select numero_proforma from pedidos where id = ${pedidoNuevo}`);
    const esperado = np.numero_proforma.replace(/^SM(\d{2})-(\d+)$/, 'SM-20$1-$2');
    ok(await p.locator('[data-siguiente]').getAttribute('data-siguiente') === esperado,
       'en un paso: genera la proforma y abre su contrato', `${np.numero_proforma} → ${esperado}`);
    ok((await v('pago.en')).startsWith('30% ADVANCE PAYMENT'), 'con la forma de pago pactada en la cotización (30 %)');
    await p.goto(`${BASE}/ventas/cotizaciones/${cotPrueba}/contrato`, { waitUntil: 'networkidle' });
    ok(p.url().endsWith(`/ventas/pedidos/${pedidoNuevo}/contrato`), 'con proforma, el contrato de la cotización lleva directo al de la proforma');
  }

  console.log(SEC(5, 'Permisos'));
  {
    const ctx2 = await nav.newContext();
    const al = await ctx2.newPage();
    await entrar(al, 'almacen@santamonica.pe');
    const r = await al.request.get(`${BASE}/api/contratos/${c1.id}?formato=pdf`);
    ok(r.status() === 404, 'Almacén no puede descargar contratos (la base no se lo muestra)', String(r.status()));
    await al.goto(`${BASE}/ventas/pedidos/${ped.id}/contrato`, { waitUntil: 'networkidle' });
    ok(await al.locator('[data-accion="generar-contrato"]').count() === 0, 'ni generarlos');
    await ctx2.close();
  }
} catch (e) {
  console.error(e);
  fallos.push(String(e.message ?? e));
} finally {
  await consultar(`delete from contratos where id > ${ctrAntes.id}`);
  if (pedidoNuevo) {
    await consultar(`delete from pedido_cuentas where pedido_id = ${pedidoNuevo};
                     delete from pedido_lineas where pedido_id = ${pedidoNuevo};
                     delete from pedidos where id = ${pedidoNuevo};`).catch((e) => console.error('limpieza pedido', e.message));
  }
  if (cotPrueba) {
    await consultar(`delete from cotizacion_cuentas where cotizacion_id = ${cotPrueba};
                     delete from cotizacion_lineas where cotizacion_id = ${cotPrueba};
                     delete from cotizaciones where id = ${cotPrueba};`).catch((e) => console.error('limpieza cotización', e.message));
  }
  void INICIO;
  await nav.close();
  console.log(fallos.length ? `\n${fallos.length} FALLAS:\n - ${fallos.join('\n - ')}` : '\nTodo correcto');
  process.exit(fallos.length ? 1 : 0);
}
