/**
 * ============================================================================
 *  PRUEBA · DETALLES QUE ENCONTRARON LOS REDACTORES DEL MANUAL (migración 078)
 * ============================================================================
 *  Un punto por falla, en el navegador (con el rol que la vio) y en la base:
 *
 *    1. El vencimiento de la cotización es el de la base (COT-2026-0130:
 *       26/05/2026), en la ficha, en el aviso y en el Excel del documento.
 *    2. El aviso de validez vencida según quién lo lee.
 *    3. Sin nombres de personas en los textos (pantallas y base).
 *    4. Enlaces a pantallas que el rol no tiene: texto sin enlace.
 *    5. Sin «Venta US$» para Consulta en Control; Rentabilidad con el rol.
 *    6. «Por despachar en pedidos» = lo pedido − lo despachado (de la base).
 *    7. «Kardex» (sin Valor) para quien no ve precios; «Kardex valorizado»
 *       con Valor para quien sí.
 *    8. Calidad: el motivo no se repite; texto sin «base de datos».
 *    9. Importar traslados: su propio texto.
 *   10. Auditoría: un «toque» de la fecha de actualización ya no se anota, y
 *       la pantalla no muestra los viejos.
 *   11. Alertas: la etiqueta «Costos de producción», no «COSTOS_MENSUALES».
 *   12. Parámetros sin la clave técnica a la vista.
 *   13. Recordatorio de SUNAT en Facturación, en la ficha y en la vista previa.
 *
 *  La base es la de producción: la prueba solo abre pantallas y descargas.
 *  Lo único que escribe son los eventos de descarga del documento (se borran
 *  al final, filtrados por registro y hora de inicio) y una actualización
 *  dentro de un bloque que se deshace siempre.
 *
 *      BASE_URL=http://localhost:3010 node scripts/probar-detalles-ronda.mjs
 * ============================================================================
 */
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
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

const [{ inicio, hoy }] = await consultar(`select now()::text as inicio, (now() at time zone 'America/Lima')::date::text as hoy`);

const nav = await chromium.launch({ channel: 'chrome', headless: true });
const paginas = {};
async function como(rol) {
  if (paginas[rol]) return paginas[rol];
  const ctx = await nav.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', `${rol}@santamonica.pe`);
  await p.fill('input[type="password"]', CLAVE);
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/panel/, { timeout: 45000 });
  paginas[rol] = p;
  return p;
}
const ir = async (p, ruta) => { await p.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle', timeout: 90000 }); };
const texto = async (p, sel = 'main') => (await p.locator(sel).first().textContent()) ?? '';
const captura = async (p, nombre) => { if (CAPTURAS) await p.screenshot({ path: `${CAPTURAS}/${nombre}.png`, fullPage: false }); };
async function excel(p, ruta) {
  const r = await p.request.get(`${BASE}${ruta}`);
  if (!r.ok()) return { status: r.status(), filas: [], hojas: [] };
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(await r.body());
  const filas = [];
  libro.worksheets[0].eachRow((row) => filas.push(row.values.slice(1).map((v) => (v && typeof v === 'object' && 'richText' in v) ? v.richText.map((t) => t.text).join('') : v)));
  return { status: r.status(), filas, hojas: libro.worksheets.map((h) => h.name) };
}

try {
  /* ════════════════════ 1 · VENCIMIENTO DE LA COTIZACIÓN ════════════════════ */
  console.log(SEC(1, 'Vencimiento de la cotización: el de la base'));
  const [cot] = await consultar(`select id, numero, fecha::text, validez_dias, vence_el::text, estado from cotizaciones where numero = 'COT-2026-0130'`);
  ok(cot && cot.vence_el === '2026-05-26', 'la base: COT-2026-0130 vence el 26/05/2026', cot?.vence_el);
  const pg = await como('gerencia');
  await ir(pg, `/ventas/cotizaciones/${cot.id}`);
  const tFicha = await texto(pg);
  ok(tFicha.includes('15 días · vence 26/05/2026'), 'ficha: «15 días · vence 26/05/2026»');
  ok(!tFicha.includes('25/05/2026'), 'ficha: ya no dice 25/05/2026 en ningún sitio');
  const diasEsperados = Math.round((Date.parse(`${hoy}T12:00:00Z`) - Date.parse('2026-05-26T12:00:00Z')) / 86400000);
  ok(tFicha.includes(`La validez expiró hace ${diasEsperados} días (26/05/2026)`), `aviso: «La validez expiró hace ${diasEsperados} días (26/05/2026)»`);
  await captura(pg, '078-cotizacion-vence');
  //  El documento (Excel de la cotización) dice la misma fecha.
  const doc = await excel(pg, `/api/documentos/cotizacion/${cot.id}?formato=excel`);
  const plano = doc.filas.flat().map((v) => String(v ?? '')).join(' | ');
  ok(doc.status === 200 && /hasta 26\/05\/2026/.test(plano) && !/25\/05\/2026/.test(plano), 'documento: «Validez 15 días · hasta 26/05/2026»');
  //  En la lista, la misma fecha.
  await ir(pg, `/ventas/cotizaciones?buscar=COT-2026-0130`);
  ok(!(await texto(pg)).includes('25/05/2026'), 'lista: sin 25/05/2026');

  /* ════════════════════ 2 · AVISO SEGÚN QUIÉN LO LEE ════════════════════ */
  console.log(SEC(2, 'Aviso de validez vencida, según quién lo lee'));
  {
    const ap = pg.locator('button[data-accion="aprobar"]');
    await ir(pg, `/ventas/cotizaciones/${cot.id}`);
    const esperadoG = 'La validez venció el 26/05/2026: actualice la validez con Editar y después apruébela.';
    if (await ap.count()) {
      ok(await ap.isDisabled() && (await ap.getAttribute('title')) === esperadoG, 'Gerencia (edita y aprueba): «Aprobar» apagado con «actualice la validez con Editar y después apruébela»');
    }
    const avisoG = pg.locator('[data-aviso="validez-vencida"]');
    if (await avisoG.count()) ok((await avisoG.innerText()).includes(esperadoG), 'y el aviso de la ficha dice lo mismo');
    const pc = await como('comercial');
    await ir(pc, `/ventas/cotizaciones/${cot.id}`);
    const avisoC = pc.locator('[data-aviso="validez-vencida"]');
    const tC = (await avisoC.count()) ? await avisoC.innerText() : '';
    ok(tC.includes('La validez venció el 26/05/2026: actualice la validez con Editar antes de pedir la aprobación.'), 'Comercial (edita, no aprueba): «Actualice la validez con Editar antes de pedir la aprobación»', tC);
    ok(!/pídale a Comercial/.test(await texto(pc)), 'a Comercial ya no se le dice «pídale a Comercial»');
    await captura(pc, '078-cotizacion-vencida-comercial');
    const pq = await como('consulta');
    await ir(pq, `/ventas/cotizaciones/${cot.id}`);
    const avisoQ = pq.locator('[data-aviso="validez-vencida"]');
    const tQ = (await avisoQ.count()) ? await avisoQ.innerText() : '';
    ok(tQ.includes('Comercial debe actualizarla antes de que se apruebe.'), 'Consulta (ni edita ni aprueba): «Comercial debe actualizarla antes de que se apruebe»', tQ);
    //  El texto para quien solo aprueba sigue existiendo en el código.
    const fuente = readFileSync('src/lib/permisosVentas.ts', 'utf8');
    ok(fuente.includes('pídale a Comercial que la actualice antes de aprobar.'), 'quien solo aprueba: «pídale a Comercial que la actualice antes de aprobar»');
  }

  /* ════════════════════ 3 · NOMBRES DE PERSONAS ════════════════════ */
  console.log(SEC(3, 'Sin nombres de personas en los textos'));
  {
    const NOMBRES = /\b(Walter|Marco|Oliver|Arom|Miguel|Tello|Cathy)\b/;
    const [{ n: enParam }] = await consultar(`select count(*)::int n from parametros where descripcion ~ '\\m(Walter|Marco|Oliver|Arom|Miguel|Tello|Cathy)\\M'`);
    const [{ n: enReglas }] = await consultar(`select count(*)::int n from reglas where descripcion ~ '\\m(Walter|Marco|Oliver|Arom|Miguel|Tello|Cathy)\\M' or mensaje ~ '\\m(Walter|Marco|Oliver|Arom|Miguel|Tello|Cathy)\\M'`);
    ok(enParam === 0 && enReglas === 0, 'la base: ni parámetros ni reglas nombran personas', `${enParam} / ${enReglas}`);
    const [antic] = await consultar(`select descripcion from parametros where clave = 'anticuamiento_alerta_meses'`);
    ok(/Antes se controlaba a mano a los 12 meses/.test(antic?.descripcion ?? ''), 'Alerta de anticuamiento: «Antes se controlaba a mano a los 12 meses»');
    await ir(pg, '/configuracion?t=parametros');
    ok(!NOMBRES.test(await texto(pg)), 'Configuración › Parámetros sin nombres de personas');
    await ir(pg, '/configuracion?t=reglas');
    ok(!NOMBRES.test(await texto(pg)), 'Configuración › Motor de reglas sin nombres de personas');
    const pc = await como('comercial');
    await ir(pc, '/finanzas/costos');
    const tCostos = await texto(pc);
    ok(!/Marco y Oliver/.test(tCostos), 'Costos (Comercial, solo lectura): sin «hoy Marco y Oliver»');
    const rev = readFileSync('src/app/(erp)/almacenes/ingresos/importar/[id]/RevisionIngresos.tsx', 'utf8');
    ok(!/Walter, Marco u Oliver/.test(rev) && rev.includes('falta que Gerencia u Operaciones pulse «Validar y registrar»'), 'revisión de importación de ingresos: «falta que Gerencia u Operaciones pulse…» (sin nombres)');
    const cierre = readFileSync('src/app/(erp)/produccion/cierre/page.tsx', 'utf8');
    //  Solo el código que se muestra: los comentarios de cabecera cuentan la historia y no salen en pantalla.
    const visible = cierre.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
    ok(!/Lo ven Marco y Oliver|Marco ingresa|Oliver ingresa/.test(visible), 'Cierre semanal: sin «Marco ingresa / Oliver ingresa / Lo ven Marco y Oliver»');
  }

  /* ════════════════════ 4 · ENLACES A PANTALLAS QUE EL ROL NO TIENE ════════════════════ */
  console.log(SEC(4, 'Enlaces a pantallas que el rol no tiene'));
  {
    const [desp] = await consultar(`select d.id, pk.embarque_id, pk.codigo from despachos d join packing_lists pk on pk.id = d.packing_list_id where pk.embarque_id is not null order by d.id desc limit 1`);
    const pcal = await como('calidad');
    await ir(pcal, `/logistica/despachos/${desp.id}`);
    const bloque = pcal.locator('main');
    ok(await bloque.locator('a[href^="/logistica/embarques"]').count() === 0 && await bloque.locator('a[href^="/logistica/packing"]').count() === 0,
      'Calidad, ficha del despacho: embarque y packing sin enlace');
    ok((await texto(pcal)).includes(String(desp.codigo)), 'pero el número de packing se lee', desp.codigo);
    await captura(pcal, '078-despacho-calidad');
    await ir(pg, `/logistica/despachos/${desp.id}`);
    ok(await pg.locator('main a[href^="/logistica/embarques"]').count() > 0 && await pg.locator('main a[href^="/logistica/packing"]').count() > 0, 'Gerencia sí los tiene enlazados');
    await ir(pcal, '/logistica/despachos');
    ok(await pcal.locator('main a[href^="/logistica/embarques"]').count() === 0, 'Calidad, lista de despachos: embarque sin enlace');

    const [pc1] = await consultar(`select pedido_id, packing_codigo from v_pedido_contenedores order by pedido_id desc limit 1`);
    await ir(pcal, `/ventas/pedidos/${pc1.pedido_id}?t=embarques`);
    ok(await pcal.locator('main a[href^="/logistica/packing"]').count() === 0 && await pcal.locator('main a[href^="/logistica/embarques"]').count() === 0,
      'Calidad, pedido › Embarques: packing y embarque sin enlace');
    ok((await texto(pcal)).includes(String(pc1.packing_codigo)), 'con el número del packing a la vista', pc1.packing_codigo);
    await ir(pg, `/ventas/pedidos/${pc1.pedido_id}?t=embarques`);
    ok(await pg.locator('main a[href^="/logistica/packing"]').count() > 0, 'Gerencia: el packing enlazado');
    const [conCot] = await consultar(`select id from pedidos where cotizacion_id is not null order by id desc limit 1`);
    if (conCot) {
      await ir(pcal, `/ventas/pedidos/${conCot.id}`);
      ok(await pcal.locator('main a[href^="/ventas/cotizaciones"]').count() === 0, 'Calidad, pedido: la cotización de origen sin enlace');
    }

    const pal = await como('almacen');
    await ir(pal, '/produccion');
    ok(await pal.locator('main a[href^="/ventas/control"]').count() === 0, 'Almacén, Necesidades: «Pedidos que esperan» y «Ya comprometidos» sin enlace a Control');
    ok((await texto(pal)).includes('Pedidos que esperan'), 'las tarjetas siguen ahí');
    await ir(pg, '/produccion');
    ok(await pg.locator('main a[href^="/ventas/control"]').count() >= 2, 'Gerencia: las dos tarjetas llevan a Control');
    await captura(pal, '078-produccion-almacen');

    await ir(pcal, '/ventas/disponibilidad');
    ok(await pcal.locator('main a[href="/logistica/packing"]').count() === 0, 'Calidad, Disponibilidad: «En preparación» sin enlace a Packing');
    await ir(pal, '/almacenes/reservas');
    ok(await pal.locator('main a[href^="/ventas/clientes"]').count() === 0 && await pal.locator('main a[href^="/configuracion"]').count() === 0, 'Almacén, Reservas: clientes y Configuración sin enlace');
    const [emb] = await consultar(`select ep.embarque_id from embarque_pedidos ep join embarques e on e.id = ep.embarque_id where e.estado <> 'cancelado' order by ep.embarque_id desc limit 1`);
    await ir(pal, `/logistica/embarques/${emb.embarque_id}`);
    ok(await pal.locator('main a[href^="/ventas/clientes"]').count() === 0, 'Almacén, ficha del embarque: cliente sin enlace');
    await ir(pcal, '/alertas');
    const hrefs = await pcal.locator('main a.alerta-fila').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    ok(!hrefs.some((h) => /^\/(finanzas|ventas\/cotizaciones|ventas\/clientes|logistica\/(packing|embarques)|configuracion)/.test(h ?? '')), 'Calidad, Alertas: ninguna alerta lleva a una pantalla que no tiene', `${hrefs.length} enlaces`);
    await ir(pcal, '/almacenes/alertas');
    ok(await pcal.locator('main a[href^="/configuracion"]').count() === 0, 'Calidad, Alertas de stock: Configuración sin enlace');
  }

  /* ════════════════════ 5 · IMPORTES ════════════════════ */
  console.log(SEC(5, 'Importes: Control de pedidos y Rentabilidad'));
  {
    const pq = await como('consulta');
    await ir(pq, '/ventas/control');
    const tq = await texto(pq);
    ok(!/Venta US\$/.test(tq) && !/US\$\s?\d/.test(tq), 'Consulta, Control de pedidos: sin «Venta US$» ni importes');
    await ir(pg, '/ventas/control');
    ok(/Venta US\$/.test(await texto(pg)), 'Gerencia sí ve «Venta US$»');
    const pcal = await como('calidad');
    const [pp] = await consultar(`select id from pedidos where ciclo = 'confirmado' order by id limit 1`);
    await ir(pcal, `/ventas/pedidos/${pp.id}?t=rentabilidad`);
    const tr = await texto(pcal);
    ok(tr.includes('Calidad no consulta costos ni márgenes. Solo Gerencia, Operaciones o Comercial pueden verlos.'), 'Rentabilidad (Calidad): «Calidad no consulta costos ni márgenes. Solo Gerencia, Operaciones o Comercial pueden verlos.»');
  }

  /* ════════════════════ 6 · POR DESPACHAR EN PEDIDOS ════════════════════ */
  console.log(SEC(6, 'Panel: por despachar y en riesgo, de la base'));
  {
    const [b] = await consultar(`select round(sum(greatest(tm_pedidas - tm_despachadas, 0)), 1)::text por_despachar,
                                        round(sum(tm_faltantes) filter (where cobertura in ('pendiente_stock','parcialmente_disponible')), 1)::text riesgo,
                                        round(sum(tm_pedidas), 1)::text pedidas, count(*)::int n
                                   from v_pedidos_tablero where ciclo = 'confirmado'`);
    const pal = await como('almacen');
    await ir(pal, '/panel');
    const kpis = (await pal.locator('.rejilla-kpi').first().textContent()) ?? '';
    const nivel2 = (await pal.locator('.rejilla-3').first().textContent()) ?? '';
    //  es-PE: coma de miles y punto decimal («12,395.4»).
    const cifra = (s) => Number(String(s).replace(/[,\s]/g, ''));
    //  El valor va ANTES de la etiqueta en la tarjeta: se lee la casilla del valor.
    const valorKpi = async (etq) => (await pal.locator(`.kpi:has(.kpi-etiqueta:text-is("${etq}")) .kpi-valor`).first().textContent())?.replace('TM', '') ?? '';
    const m = [null, await valorKpi('Por despachar en pedidos')];
    ok(!!m && Math.abs(cifra(m[1]) - Number(b.por_despachar)) < 0.2, `«Por despachar en pedidos» = ${b.por_despachar} TM (base)`, m?.[1] ?? kpis.slice(kpis.indexOf('Por despachar'), kpis.indexOf('Por despachar') + 90));
    ok(kpis.includes(`pedidos confirmados`) && kpis.includes('Lo pedido menos lo ya despachado'), 'la nota explica qué suma');
    const r = /([\d\s.,]+)\s*TM aún sin stock reservado/.exec(nivel2);
    ok(!!r && Math.abs(cifra(r[1]) - Number(b.riesgo)) < 0.2, `«Pedidos en riesgo»: ${b.riesgo} TM aún sin stock reservado`, r?.[1]);
    console.log(`        (datos: ${b.n} pedidos confirmados, ${b.pedidas} TM pedidas, ${b.por_despachar} por despachar, ${b.riesgo} en riesgo sin reservar)`);
    await captura(pal, '078-panel-almacen');
  }

  /* ════════════════════ 7 · KARDEX ════════════════════ */
  console.log(SEC(7, 'Reporte Kardex: nombre según lo que trae'));
  {
    const pal = await como('almacen');
    await ir(pal, '/reportes');
    const tarjeta = pal.locator('[data-reporte="kardex"]');
    const tk = await tarjeta.innerText();
    ok(/^Kardex\b/.test(tk.trim()) && !/valorizado/i.test(tk) && /en kilos/.test(tk), 'Almacén ve «Kardex» (en kilos), no «Kardex valorizado»', tk.split('\n')[0]);
    const xa = await excel(pal, '/api/reportes/kardex?formato=excel&desde=' + hoy);
    const plano = xa.filas.flat().map((v) => String(v ?? '')).join(' | ');
    ok(xa.status === 200 && xa.hojas[0] === 'Kardex' && !/Kardex valorizado/.test(plano) && !xa.filas.some((f) => f.includes('Valor')), 'su Excel: hoja «Kardex», sin «valorizado» ni columna Valor', xa.hojas[0]);
    await ir(pg, '/reportes');
    ok(/Kardex valorizado/.test(await pg.locator('[data-reporte="kardex"]').innerText()), 'Gerencia ve «Kardex valorizado»');
    const xg = await excel(pg, '/api/reportes/kardex?formato=excel&desde=' + hoy);
    ok(xg.status === 200 && xg.hojas[0] === 'Kardex valorizado' && xg.filas.some((f) => f.includes('Valor')), 'y su Excel trae la columna Valor');
  }

  /* ════════════════════ 8 · CALIDAD ════════════════════ */
  console.log(SEC(8, 'Calidad: motivo sin repetir y texto de negocio'));
  {
    const pcal = await como('calidad');
    await ir(pcal, '/almacenes/calidad');
    const t = await texto(pcal);
    ok(!/en la base de datos/.test(t) && t.includes('El sistema aplica estas reglas por sí solo'), '«El sistema aplica estas reglas por sí solo: ninguna pantalla permite saltárselas.»');
    const celdas = await pcal.locator('[data-celda="motivo"]').allInnerTexts();
    const repetidas = celdas.filter((c) => { const l = c.split('\n').map((x) => x.trim()).filter(Boolean); return l.length === 2 && l[0].toLowerCase() === l[1].toLowerCase(); });
    ok(celdas.length > 0 && repetidas.length === 0, `ningún motivo sale dos veces (${celdas.length} filas)`, repetidas[0] ?? '');
    await captura(pcal, '078-calidad');
  }

  /* ════════════════════ 9 · IMPORTAR TRASLADOS ════════════════════ */
  console.log(SEC(9, 'Importar traslados: su propio texto'));
  {
    const pal = await como('almacen');
    await ir(pal, '/almacenes/traslados/importar');
    const t = await texto(pal);
    ok(t.includes('los traslados nacen en borrador: ningún pallet se mueve de bodega hasta que se despachen') && !t.includes('no entra nada al stock'), 'pista propia: «…nacen en borrador: ningún pallet se mueve de bodega hasta que se despachen.»');
    await ir(pal, '/almacenes/ingresos/importar');
    ok((await texto(pal)).includes('no entra nada al stock hasta registrar'), 'la de ingresos sigue igual');
  }

  /* ════════════════════ 10 · AUDITORÍA ════════════════════ */
  console.log(SEC(10, 'Auditoría: sin «toques» de la fecha de actualización'));
  {
    //  Dentro de un bloque que SIEMPRE falla al final (y se deshace): se toca la
    //  fecha de un pedido y se cuenta cuántas filas de auditoría salieron.
    const contar = async (cambio) => {
      try {
        await ejecutarSQL(`do $$ declare n int; begin
            ${cambio};
            select count(*) into n from auditoria where tabla = 'pedidos' and registro_id = '5' and ocurrido_en >= now();
            raise exception 'CUENTA=%', n;
          end $$;`);
        return null;
      } catch (e) { const m = /CUENTA=(\d+)/.exec(String(e.message)); return m ? Number(m[1]) : null; }
    };
    ok(await contar(`update pedidos set actualizado_en = now() where id = 5`) === 0, 'tocar solo «actualizado_en» ya no escribe auditoría');
    ok(await contar(`update pedidos set actualizado_en = now(), observaciones = coalesce(observaciones, '') || ' PRUEBA-078' where id = 5`) === 1, 'un cambio de verdad sí (1 fila)');
    const [{ n: noVisibles }] = await consultar(`select count(*)::int n from auditoria where campos_cambiados <@ array['actualizado_en','actualizado_por']`);
    const [{ n: total }] = await consultar(`select count(*)::int n from auditoria`);
    await ir(pg, '/trazabilidad/auditoria');
    const kpi = (await pg.locator('.rejilla-kpi').first().textContent()) ?? '';
    void kpi;
    const vistos = Number(((await pg.locator('.kpi:has(.kpi-etiqueta:text-is("Registros de auditoría")) .kpi-valor').first().textContent()) ?? '').replace(/[.,\s]/g, ''));
    ok(Math.abs(vistos - (total - noVisibles)) <= 5, `la pantalla cuenta ${vistos} (total ${total} − ${noVisibles} toques)`);
    const soloFecha = await pg.locator('main table tbody tr').evaluateAll((trs) => trs.filter((tr) => /^\s*Fecha de actualización\s*$/i.test(tr.children[3]?.textContent ?? '')).length);
    ok(soloFecha === 0, 'ninguna fila cuyo único cambio sea «Fecha de actualización»');
  }

  /* ════════════════════ 11 · ALERTAS ════════════════════ */
  console.log(SEC(11, 'Alertas: etiquetas legibles'));
  {
    await ir(pg, '/alertas?entidad=costos_mensuales');
    const t = (await pg.locator('main').textContent()) ?? '';
    ok(!/costos_mensuales|COSTOS_MENSUALES/i.test(t.replace(/entidad=costos_mensuales/g, '')), 'sin «COSTOS_MENSUALES» en pantalla');
    const [{ n }] = await consultar(`select count(*)::int n from alertas where entidad = 'costos_mensuales' and not atendida`);
    if (n > 0) ok(t.includes('Costos de producción'), 'la etiqueta dice «Costos de producción»');
    await ir(pg, '/alertas');
    const opciones = await pg.locator('select').evaluateAll((ss) => ss.flatMap((s) => [...s.options].map((o) => o.textContent)));
    ok(!opciones.some((o) => /_/.test(o ?? '')), 'el filtro «Sobre qué» sin claves con guion bajo', opciones.filter((o) => /_/.test(o ?? '')).join(', '));
  }

  /* ════════════════════ 12 · PARÁMETROS ════════════════════ */
  console.log(SEC(12, 'Parámetros sin la clave técnica a la vista'));
  {
    await ir(pg, '/configuracion?t=parametros');
    const t = await texto(pg);
    ok(!t.includes('cotizacion_aviso_vencimiento_dias') && await pg.locator('main code').count() === 0, 'no se ve «cotizacion_aviso_vencimiento_dias» ni ninguna clave');
    ok(await pg.locator('[data-clave="cotizacion_aviso_vencimiento_dias"]').getAttribute('title') === 'cotizacion_aviso_vencimiento_dias', 'queda solo como ayuda al pasar el ratón (title)');
    await captura(pg, '078-parametros');
  }

  /* ════════════════════ 13 · RECORDATORIO DE SUNAT ════════════════════ */
  console.log(SEC(13, 'Recordatorio de SUNAT en Facturación'));
  {
    const AVISO = 'Recordatorio: los comprobantes todavía no se envían ni se sincronizan con SUNAT. Esa conexión llegará en una actualización posterior.';
    await ir(pg, '/finanzas/facturas');
    const a1 = pg.locator('[data-aviso="sunat"]');
    ok(await a1.count() === 1 && (await a1.innerText()).replace(/\s+/g, ' ').includes(AVISO) && (await a1.getAttribute('class')).includes('ficha-aviso-info'), 'lista de Facturación: recordatorio informativo');
    await captura(pg, '078-facturacion-sunat');
    const [fac] = await consultar(`select id from facturas order by id desc limit 1`);
    await ir(pg, `/finanzas/facturas/${fac.id}`);
    ok(await pg.locator('[data-aviso="sunat"]').count() === 1, 'ficha del comprobante: recordatorio');
    const [ped] = await consultar(`select p.id from pedidos p where p.ciclo = 'confirmado' and not exists (select 1 from facturas f where f.pedido_id = p.id and f.estado <> 'anulada') order by p.id limit 1`);
    await ir(pg, `/ventas/pedidos/${ped.id}?t=facturas`);
    const boton = pg.locator('button[data-accion="emitir-comprobante"]');
    await boton.click();          // solo abre la vista previa: no emite nada
    await pg.locator('.facturar [data-aviso="sunat"]').waitFor({ timeout: 30000 }).catch(() => {});
    ok(await pg.locator('.facturar [data-aviso="sunat"]').count() === 1, 'vista previa de «Emitir comprobante»: recordatorio');
    await captura(pg, '078-emitir-sunat');
    const [{ n: emitidas }] = await consultar(`select count(*)::int n from facturas where pedido_id = ${ped.id} and creado_en >= '${inicio}'`).catch(() => [{ n: 0 }]);
    ok(emitidas === 0, 'y no se emitió ningún comprobante');
  }
} catch (e) {
  ok(false, 'la prueba se interrumpió', String(e?.message ?? e).slice(0, 300));
} finally {
  /* Limpieza: solo lo que esta prueba escribió (eventos de descarga del documento). */
  await ejecutarSQL(`delete from eventos where entidad = 'cotizaciones' and entidad_id = (select id from cotizaciones where numero = 'COT-2026-0130')
                       and ocurrido_en >= '${inicio}' and tipo like 'documento%'`).catch(() => {});
  await ejecutarSQL(`delete from eventos where entidad = 'reportes' and ocurrido_en >= '${inicio}'
                       and metadatos->>'reporte' = 'kardex' and descripcion like 'Kardex%'`).catch(() => {});
  await nav.close();
  console.log(`\n${aciertos} ok · ${fallos.length} fallas`);
  if (fallos.length) { console.log('Fallas:\n - ' + fallos.join('\n - ')); process.exitCode = 1; }
}
