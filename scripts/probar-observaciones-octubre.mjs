/**
 * ============================================================================
 *  PRUEBA · OBSERVACIONES ERP DE OLIVER (octubre 2026) · parte 1: ventas
 * ============================================================================
 *  Puntos 1, 2, 3, 4, 5, 6, 7, 8 y 16 del documento «Observaciones ERP.docx»,
 *  en el navegador y contra la base. Lo que se crea se borra al final.
 *
 *      BASE_URL=http://localhost:3010 node --experimental-strip-types scripts/probar-observaciones-octubre.mjs
 * ============================================================================
 */
import { chromium } from 'playwright';
import { ejecutarSQL } from './db.mjs';
import { plazoReferencia, calcularAdelanto, totalConImpuesto } from '../src/lib/condicionesVenta.ts';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const consultar = async (sql) => { const r = await ejecutarSQL(sql); return Array.isArray(r) ? r : []; };
const SEC = (n, t) => `\n${'─'.repeat(3)} ${n} · ${t} ${'─'.repeat(3)}`;
const fallos = [];
const ok = (cond, texto, detalle = '') => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${texto}${detalle ? ' · ' + detalle : ''}`);
  if (!cond) fallos.push(texto);
};
const cerca = (a, b, t = 0.011) => Math.abs(Number(a) - Number(b)) <= t;
/** «US$ 72,940.25» o «US$ 72.940,25» → 72940.25: el separador decimal es el último. */
const importe = (txt) => {
  const s = String(txt).replace(/[^\d.,-]/g, '');
  const i = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  return i < 0 ? Number(s) : Number(s.slice(0, i).replace(/[.,]/g, '') + '.' + s.slice(i + 1));
};

const [{ hoy }] = await consultar(`select (now() at time zone 'America/Lima')::date::text as hoy`);
const sumar = (f, d) => { const x = new Date(`${f}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
const [{ valor: objetivosAntes }] = await consultar(`select valor from parametros where clave = 'modulo_objetivos_activo'`);

const nav = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await nav.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const p = await ctx.newPage();
let cotId = null;
let pedidoId = null;

try {
  console.log(SEC('5 y 6', 'Las reglas puras: plazos por prioridad y adelanto'));
  {
    ok(plazoReferencia('urgente', '2026-10-10', null).fecha === '2026-10-17', 'urgente: hasta 1 semana → +7 días');
    ok(plazoReferencia('normal', '2026-10-10', null).fecha === '2026-10-31', 'normal: hasta 3 semanas → +21 días');
    ok(plazoReferencia('baja', '2026-10-10', null).fecha === '2026-11-21', 'baja: más de 3 semanas → referencia +42 días');
    const t = plazoReferencia('urgente', '2026-10-10', '2026-12-01');
    ok(t.fecha === '2026-12-01' && t.origen === 'tentativa', 'la fecha tentativa manda sobre la prioridad');
    const [sql] = await consultar(`select plazo_referencia('urgente', '2026-10-10', null)::text a,
                                          plazo_referencia('baja', '2026-10-10', '2026-12-01')::text b`);
    ok(sql.a === '2026-10-17' && sql.b === '2026-12-01', 'la función de la base da lo mismo que la pantalla');
    const a = calcularAdelanto(10000, 30, 2500);
    ok(a.monto === 3000 && a.diferencia === -500 && a.saldo === 7500, 'adelanto 30 % de 10 000 = 3 000; abonó 2 500 → faltan 500');
    ok(totalConImpuesto(1000, 'Perú', 18) === 1180 && totalConImpuesto(1000, 'China', 18) === 1000,
       'el IGV solo grava la venta nacional');
  }

  /* ---- Entrar como Gerencia ---- */
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', 'gerencia@santamonica.pe');
  await p.fill('input[type="password"]', 'SantaMonica2026');
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/panel/, { timeout: 30000 });

  console.log(SEC(16, 'Objetivos mensuales oculto sin borrar nada'));
  {
    await consultar(`update parametros set valor = 'no' where clave = 'modulo_objetivos_activo'`);
    await p.goto(`${BASE}/panel`, { waitUntil: 'networkidle' });
    ok(await p.locator('nav.barra a[href="/objetivos"]').count() === 0, 'no aparece en el menú');
    await p.goto(`${BASE}/objetivos`, { waitUntil: 'networkidle' });
    ok(/oculto temporalmente/i.test(await p.locator('main').innerText()), 'por enlace directo dice que está oculto, sin error');
    const r = await p.request.get(`${BASE}/api/objetivos/excel`);
    ok(r.status() === 404, 'tampoco se descarga su Excel', String(r.status()));
    const [{ n }] = await consultar(`select count(*)::int n from objetivos_valores`);
    ok(n > 0, 'los datos siguen intactos', `${n} valores guardados`);
    await consultar(`update parametros set valor = 'si' where clave = 'modulo_objetivos_activo'`);
    await p.goto(`${BASE}/panel`, { waitUntil: 'networkidle' });
    ok(await p.locator('nav.barra a[href="/objetivos"]').count() === 1, 'reactivarlo es cambiar el parámetro: vuelve al menú');
    await consultar(`update parametros set valor = 'no' where clave = 'modulo_objetivos_activo'`);
    await p.goto(`${BASE}/configuracion?t=parametros`, { waitUntil: 'networkidle' });
    ok(/modulo_objetivos_activo/.test(await p.locator('main').innerText()), 'el interruptor está en Configuración → Parámetros');
  }

  console.log(SEC(1, 'Resumen de despachos: nombre nuevo y proformas de la más reciente a la más antigua'));
  {
    const [mes] = await consultar(`select clave from v_ventas_objetivo_mensual order by planificados desc limit 1`);
    await p.goto(`${BASE}/ventas/resumen?mes=${mes.clave}&ver=planificados`, { waitUntil: 'networkidle' });
    ok((await p.locator('main h1').innerText()).trim() === 'Resumen de despachos', 'la pantalla se llama «Resumen de despachos»');
    ok(await p.locator('nav.barra a[href="/ventas/resumen"]', { hasText: 'Resumen de despachos' }).count() === 1,
       'y así se llama en el menú (misma dirección, mismo acceso)');
    const fechas = (await p.locator('table[data-cuadro="contenedores"] td[data-creada]').evaluateAll((t) => t.map((x) => x.getAttribute('data-creada'))))
      .filter(Boolean);
    const ordenadas = [...fechas].sort().reverse();
    ok(fechas.length > 1 && JSON.stringify(fechas) === JSON.stringify(ordenadas),
       'las proformas van de la creada más recientemente a la más antigua', `${fechas.length} filas`);
  }

  console.log(SEC(2, 'Control de pedidos: del más reciente al más antiguo, al entrar y al actualizar'));
  {
    const esperado = (await consultar(`
      select p.numero_proforma from v_control_pedidos v join pedidos p on p.id = v.id
       where v.situacion_control = 'por_atender' order by p.creado_en desc, p.id desc limit 15`)).map((x) => x.numero_proforma);
    await p.goto(`${BASE}/ventas/control`, { waitUntil: 'networkidle' });
    const leer = async () => (await p.locator('main table.datos tbody tr td:first-child a').allInnerTexts()).slice(0, 15).map((s) => s.trim());
    ok(JSON.stringify(await leer()) === JSON.stringify(esperado), 'al entrar: el pedido más reciente primero', esperado.slice(0, 3).join(', '));
    await p.reload({ waitUntil: 'networkidle' });
    ok(JSON.stringify(await leer()) === JSON.stringify(esperado), 'al actualizar la página: el mismo orden');
    await p.goto(`${BASE}/ventas/control?vista=retrasados`, { waitUntil: 'networkidle' });
    const ret = (await p.locator('main table.datos tbody tr td:first-child a').allInnerTexts()).map((s) => s.trim());
    const espRet = (await consultar(`
      select p.numero_proforma from v_control_pedidos v join pedidos p on p.id = v.id
       where v.situacion_control = 'por_atender' and v.retrasado order by p.creado_en desc, p.id desc limit 200`)).map((x) => x.numero_proforma);
    ok(JSON.stringify(ret) === JSON.stringify(espRet), 'también en cada tarjeta (retrasados)', `${ret.length} pedidos`);
  }

  console.log(SEC('3 a 6', 'La cotización nueva: tipo de cambio SUNAT, fecha tentativa, plazo y adelanto'));
  {
    await p.goto(`${BASE}/ventas/cotizaciones/nueva`, { waitUntil: 'networkidle' });
    await p.locator('small[data-tc="sunat"]').waitFor({ timeout: 25000 });
    const [tc] = await consultar(`select compra::float c, venta::float v, publicado_el::text f from tipos_cambio_sunat where fecha = '${hoy}'`);
    ok(!!tc, 'el tipo de cambio del día quedó guardado en la base', tc ? `compra ${tc.c} · venta ${tc.v} · publicado ${tc.f}` : '');
    //  Contra SUNAT directamente: lo que dice el sistema es lo que publica SUNAT.
    const sunat = await fetch('https://www.sunat.gob.pe/a/txt/tipoCambio.txt').then((r) => r.text()).catch(() => '');
    const [, compraS, ventaS] = sunat.trim().split('|');
    if (compraS) ok(cerca(tc.c, compraS, 0.0001) && cerca(tc.v, ventaS, 0.0001), 'coincide con lo que publica SUNAT hoy', `SUNAT ${compraS} / ${ventaS}`);
    const valorTc = Number(await p.locator('input[data-fuente]').inputValue());
    ok(cerca(valorTc, tc.v, 0.0001) && await p.locator('input[data-fuente]').getAttribute('data-fuente') === 'sunat',
       'se pone solo, con el valor VENTA (parámetro), sin escribirlo', String(valorTc));
    const ayuda = await p.locator('small[data-tc="sunat"]').innerText();
    ok(/SUNAT · venta/.test(ayuda) && /publicado el/.test(ayuda) && /compra/.test(ayuda), 'muestra el valor, la fecha de referencia y la compra', ayuda);

    //  Cliente: uno extranjero, para comprobar que no se le suma IGV.
    const [cli] = await consultar(`select id, pais from clientes where not bloqueado and activo and pais <> 'Perú' order by id limit 1`);
    await p.locator('select.campo').first().selectOption(String(cli.id));
    await p.waitForTimeout(800);
    for (const sel of await p.locator('select').all()) {
      const vals = await sel.locator('option').evaluateAll((os) => os.map((o) => o.value));
      if (vals.includes('urgente')) { await sel.selectOption('urgente'); break; }
    }
    await p.locator('input.form-buscador-input').fill('POTA');
    await p.waitForTimeout(1500);
    await p.locator('.form-resultados button').first().click();
    await p.waitForTimeout(2500);

    const ayudaPlazo = await p.locator('small[data-plazo]').innerText();
    ok(await p.locator('small[data-plazo]').getAttribute('data-plazo') === 'prioridad'
       && ayudaPlazo.includes(sumar(hoy, 7).split('-').reverse().join('/')),
       'sin fecha tentativa: urgente → referencia a 1 semana', ayudaPlazo);
    const tentativa = sumar(hoy, 25);
    await p.fill('input[name="fecha_tentativa_despacho"]', tentativa);
    ok(await p.locator('small[data-plazo]').getAttribute('data-plazo') === 'tentativa', 'con fecha tentativa, manda ella');

    //  El total sin IGV (cliente extranjero) y el adelanto.
    const totalTxt = await p.locator('.form-totales .destacado strong').innerText();
    const total = importe(totalTxt);
    ok(/no aplica/i.test(await p.locator('.form-totales').innerText()), 'exportación: el IGV no se suma', totalTxt);
    await p.selectOption('select[name="forma_pago"]', 'adelanto_saldo');
    await p.fill('input[name="adelanto_pct"]', '30');
    const montoEsperado = Math.round(total * 0.3 * 100) / 100;
    const montoTxt = await p.locator('[data-adelanto="monto"]').innerText();
    ok(cerca(importe(montoTxt), montoEsperado) && montoEsperado > 1000, 'adelanto calculado = total × 30 %', montoTxt);
    await p.fill('input[name="adelanto_abonado"]', '500');
    const dif = Number(await p.locator('small[data-diferencia]').getAttribute('data-diferencia'));
    ok(cerca(dif, 500 - montoEsperado), 'diferencia = abonado − adelanto, al instante', String(dif));

    await p.fill('input[placeholder^="Condiciones especiales"]', 'Prueba octubre: empaque con doble etiqueta');
    await p.locator('button', { hasText: /Guardar cotizaci/ }).click();
    await p.waitForURL(/\/ventas\/cotizaciones\/\d+$/, { timeout: 30000 });
    cotId = Number(p.url().match(/(\d+)$/)[1]);

    const [c] = await consultar(`select tipo_cambio::float tc, tipo_cambio_fuente f, tipo_cambio_clase k, tipo_cambio_fecha::text tf,
                                        fecha_tentativa_despacho::text ft, forma_pago, adelanto_pct::float pct,
                                        adelanto_abonado::float ab, adelanto_abonado_en::text abe, prioridad::text pr, observaciones
                                   from cotizaciones where id = ${cotId}`);
    ok(c.f === 'sunat' && c.k === 'venta' && cerca(c.tc, tc.v, 0.0001) && c.tf === tc.f, 'se guarda el tipo SUNAT, su clase y su fecha de publicación');
    ok(c.ft === tentativa, 'se guarda la fecha tentativa');
    ok(c.forma_pago === 'adelanto_saldo' && c.pct === 30 && c.ab === 500 && c.abe === hoy, 'se guardan forma de pago, % y lo abonado (con su fecha)');

    //  La ficha lo enseña.
    const bloque = await p.locator('[data-bloque="condiciones"]').innerText();
    ok(/SUNAT · venta/.test(bloque), 'la ficha dice de dónde salió el tipo de cambio');
    ok(await p.locator('[data-plazo="tentativa"]').getAttribute('data-fecha') === tentativa, 'y que el plazo lo pone la fecha tentativa');
    ok(cerca(await p.locator('[data-adelanto="diferencia"]').getAttribute('data-valor'), 500 - montoEsperado), 'y la diferencia del abono');

    //  Registrar el abono exacto desde la ficha (sin editar la cotización).
    await p.locator('[data-accion="registrar-abono"]').click();
    await p.fill('input[name="monto_abonado"]', String(montoEsperado));
    await p.locator('button', { hasText: 'Guardar abono' }).click();
    await p.locator('[data-adelanto="diferencia"]', { hasText: 'Adelanto cubierto' }).waitFor({ timeout: 20000 }).catch(() => {});
    const difTxt = await p.locator('[data-adelanto="diferencia"]').innerText();
    const [abDb] = await consultar(`select adelanto_abonado::float ab from cotizaciones where id = ${cotId}`);
    ok(/Adelanto cubierto/.test(difTxt) && cerca(abDb.ab, montoEsperado), 'registrar el abono desde la ficha: «Adelanto cubierto»', `${difTxt} · base ${abDb.ab} · esperado ${montoEsperado}`);

    //  El tipo escrito a mano queda marcado como manual.
    await p.goto(`${BASE}/ventas/cotizaciones/${cotId}/editar`, { waitUntil: 'networkidle' });
    await p.fill('input[data-fuente]', '3.9');
    ok(await p.locator('input[data-fuente]').getAttribute('data-fuente') === 'manual', 'si se escribe a mano, deja de ser «SUNAT»');
    await p.goto(`${BASE}/ventas/cotizaciones/${cotId}`, { waitUntil: 'networkidle' });
  }

  console.log(SEC(8, 'Contrato al aprobar la cotización'));
  {
    ok(await p.locator('[data-enlace="contrato"]').count() === 0, 'sin aprobar no se ofrece el contrato');
    const r0 = await p.request.get(`${BASE}/ventas/cotizaciones/${cotId}/contrato`);
    ok(/Todavía no está aprobada/.test(await r0.text()), 'y su pantalla lo explica');
    await p.locator('button', { hasText: /^Aprobar/ }).click();
    await p.waitForTimeout(3000);
    await p.reload({ waitUntil: 'networkidle' });
    ok(await p.locator('[data-enlace="contrato"]').count() === 1, 'aprobada: aparece «Contrato»');
    await p.locator('[data-enlace="contrato"]').click();
    await p.waitForURL(/\/contrato$/, { timeout: 20000 });
    const texto = await p.locator('textarea[name="cuerpo_contrato"]').inputValue();
    const [d] = await consultar(`select c.numero, cl.razon_social from cotizaciones c join clientes cl on cl.id = c.cliente_id where c.id = ${cotId}`);
    ok(texto.includes(d.razon_social) && texto.includes(d.numero), 'se completa solo con el cliente y la cotización');
    ok(/TM a US\$ /.test(texto) && /30 % de adelanto/.test(texto) && /Fecha tentativa de despacho/.test(texto),
       'con productos, cantidades, precios, la forma de pago y la entrega');
    ok(texto.includes('Prueba octubre: empaque con doble etiqueta'), 'y las observaciones de la cotización');
    ok(!/\{\{/.test(texto), 'no queda ningún marcador sin llenar');

    //  Un marcador desconocido no se cuela en un contrato que se firma.
    await p.fill('textarea[name="cuerpo_contrato"]', texto + '\n\nPuerto: {{puerto}}');
    await p.locator('[data-accion="generar-contrato"]').click();
    await p.waitForTimeout(1500);
    ok(/Quedan datos sin completar/.test(await p.locator('.form-mensaje.error').innerText()), 'un {{marcador}} sin llenar impide generarlo');
    await p.fill('textarea[name="cuerpo_contrato"]', texto + '\n\nNota revisada en pantalla.');
    await p.locator('[data-accion="generar-contrato"]').click();
    await p.waitForTimeout(3000);
    ok(await p.locator('table[data-cuadro="contratos"] tbody tr').count() === 1, 'generado: aparece en la lista con su número');
    const [ctr] = await consultar(`select id, numero, cuerpo from contratos where cotizacion_id = ${cotId}`);
    ok(/^CTR-\d{4}-\d{4}$/.test(ctr.numero) && ctr.cuerpo.endsWith('Nota revisada en pantalla.'), 'se guarda el texto revisado, con lo corregido', ctr.numero);
    const pdf = await p.request.get(`${BASE}/api/contratos/${ctr.id}`);
    const bytes = await pdf.body();
    ok(pdf.status() === 200 && bytes.slice(0, 4).toString() === '%PDF' && bytes.length > 2000, 'se descarga en PDF', `${bytes.length} bytes`);
    ok(await p.locator('[data-bloque="plantilla-editor"]').count() === 1, 'Gerencia ve y puede cambiar la plantilla institucional');
  }

  console.log(SEC(7, 'Las observaciones de la cotización pasan a la proforma'));
  {
    await p.goto(`${BASE}/ventas/cotizaciones/${cotId}`, { waitUntil: 'networkidle' });
    await p.locator('button', { hasText: 'Convertir en pedido' }).click();
    await p.waitForURL(/\/ventas\/pedidos\/\d+/, { timeout: 30000 });
    pedidoId = Number(p.url().match(/pedidos\/(\d+)/)[1]);
    const [pd] = await consultar(`select observaciones, fecha_comprometida::text fc, fecha_tentativa_despacho::text ft, forma_pago,
                                         pago_adelanto_pct::float pct, adelanto_abonado::float ab, tipo_cambio_fuente tf, condicion_pago
                                    from pedidos where id = ${pedidoId}`);
    ok(pd.observaciones === 'Prueba octubre: empaque con doble etiqueta', 'la proforma lleva las observaciones de la cotización, sin agregados');
    ok(pd.ft === sumar(hoy, 25) && pd.fc === sumar(hoy, 25), 'la fecha tentativa pasa y fija la fecha comprometida');
    ok(pd.forma_pago === 'adelanto_saldo' && pd.pct === 30 && pd.ab > 0 && pd.tf === 'sunat', 'pasan la forma de pago, el adelanto, el abono y el tipo SUNAT', pd.condicion_pago);
    await p.goto(`${BASE}/ventas/pedidos/${pedidoId}`, { waitUntil: 'networkidle' });
    const obs = await p.locator('[data-campo="observaciones"]').innerText();
    ok(obs.includes('Prueba octubre') && /De la cotización COT-/.test(obs), 'y se ven en el pedido, vinculadas a su cotización');
    ok(await p.locator('[data-bloque="condiciones"]').count() === 1, 'el pedido muestra el mismo bloque de entrega y pago');
    const [{ n }] = await consultar(`select count(*)::int n from pedidos where observaciones like 'Generado desde la cotización%'`);
    ok(n === 0, 'ninguna proforma quedó con el texto viejo en lugar de las observaciones');
  }
} catch (e) {
  console.error(e);
  fallos.push(String(e.message ?? e));
} finally {
  /* ---- Se deja todo como estaba ---- */
  if (pedidoId) {
    await consultar(`delete from pedido_cuentas where pedido_id = ${pedidoId};
                     delete from pedido_lineas where pedido_id = ${pedidoId};
                     delete from pedidos where id = ${pedidoId};`).catch((e) => console.error('limpieza pedido', e.message));
  }
  if (cotId) {
    await consultar(`delete from contratos where cotizacion_id = ${cotId};
                     delete from cotizacion_cuentas where cotizacion_id = ${cotId};
                     delete from cotizacion_lineas where cotizacion_id = ${cotId};
                     delete from cotizaciones where id = ${cotId};`).catch((e) => console.error('limpieza cotización', e.message));
  }
  await consultar(`update parametros set valor = '${objetivosAntes}' where clave = 'modulo_objetivos_activo'`);
  await nav.close();
  console.log(fallos.length ? `\n${fallos.length} FALLAS:\n - ${fallos.join('\n - ')}` : '\nTodo correcto');
  process.exit(fallos.length ? 1 : 0);
}
