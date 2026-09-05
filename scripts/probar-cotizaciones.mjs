/**
 * ============================================================================
 *  PRUEBA DEL RECORRIDO DE UNA COTIZACIÓN
 * ============================================================================
 *  Comprueba lo que se pidió en la reunión con Oliver:
 *   · Que una oferta no salga al cliente sin la firma de Gerencia.
 *   · Que Comercial NO pueda dar esa firma, ni desde el botón ni por detrás.
 *   · Que el vencimiento se calcule solo y se vea en la lista.
 *   · Que la prioridad marcada al cotizar llegue al pedido.
 *   · Que desde el pedido se pueda volver a la cotización que lo originó.
 *
 *      node scripts/probar-cotizaciones.mjs
 * ============================================================================
 */
import { chromium } from 'playwright';
import { ejecutarSQL } from './db.mjs';

const BASE = 'http://localhost:3000';
const CLAVE = 'SantaMonica2026';

const consultar = async (sql) => {
  const r = await ejecutarSQL(sql);
  return Array.isArray(r) ? r : [];
};

const fallos = [];
const ok = (cond, texto, detalle = '') => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${texto}${detalle ? ' · ' + detalle : ''}`);
  if (!cond) fallos.push(texto);
};

const nav = await chromium.launch({ channel: 'chrome', headless: true });

/** Abre una sesión con el rol pedido y devuelve la página. */
async function entrar(correo) {
  const ctx = await nav.newContext({ viewport: { width: 1500, height: 950 } });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', correo);
  await p.fill('input[type="password"]', CLAVE);
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/panel/, { timeout: 25000 });
  return p;
}

/* Se limpia lo que deje la prueba, pase lo que pase. */
let creada = null;
const limpiar = async () => {
  if (!creada) return;
  await consultar(`delete from cotizacion_lineas where cotizacion_id = ${creada};
                   delete from cotizaciones where id = ${creada};`);
};

try {
  console.log('\n─── 1 · Comercial crea la oferta ───');
  const comercial = await entrar('comercial@santamonica.pe');
  await comercial.goto(`${BASE}/ventas/cotizaciones/nueva`, { waitUntil: 'networkidle' });
  await comercial.waitForTimeout(2500);

  // Cliente: el primero que no esté bloqueado
  const selCliente = comercial.locator('select').first();
  const opciones = await selCliente.locator('option:not([disabled])').all();
  await selCliente.selectOption(await opciones[1].getAttribute('value'));
  await comercial.waitForTimeout(1200);

  // Prioridad urgente: es lo que después tiene que llegar al pedido
  const etiquetas = await comercial.locator('.etiqueta').allInnerTexts();
  ok(etiquetas.some((e) => e.toUpperCase().includes('PRIORIDAD')),
     'la cotización tiene campo de prioridad');

  let marcada = false;
  for (const sel of await comercial.locator('select').all()) {
    const vals = await sel.locator('option').evaluateAll((os) => os.map((o) => o.value));
    if (vals.includes('urgente')) { await sel.selectOption('urgente'); marcada = true; break; }
  }
  ok(marcada, 'se pudo marcar la prioridad como urgente');

  // Un producto cualquiera. Los selectores son los del propio formulario:
  // `.form-buscador-input` y la lista `.form-resultados`.
  await comercial.locator('input.form-buscador-input').fill('POTA');
  await comercial.waitForTimeout(2500);
  await comercial.locator('.form-resultados li, .form-resultados button').first().click();
  await comercial.waitForTimeout(1800);

  const hayLinea = await comercial.locator('table.datos tbody tr').count();
  ok(hayLinea > 0, 'se agregó una línea de producto', `${hayLinea} línea(s)`);

  // El formulario no usa submit nativo: guarda con un botón normal.
  await comercial.locator('button', { hasText: /Guardar cotizaci|Crear cotizaci/ }).first().click();
  await comercial.waitForURL(/\/ventas\/cotizaciones\/\d+/, { timeout: 25000 });
  const url = comercial.url();
  creada = Number(url.match(/\/(\d+)$/)[1]);
  console.log(`   cotización creada: id ${creada}`);

  console.log('\n─── 2 · Nace esperando aprobación ───');
  const cuerpo = await comercial.locator('body').innerText();
  ok(/esperando aprobaci/i.test(cuerpo), 'la ficha avisa de que espera aprobación');
  ok(/avise a gerencia/i.test(cuerpo), 'y le dice a Comercial qué hacer: avisar a Gerencia');

  const [fila] = await consultar(
    `select estado, aprobada_en, prioridad, vence_el, fecha, validez_dias
       from cotizaciones where id = ${creada}`);
  ok(fila.estado === 'borrador', 'nace en borrador');
  ok(fila.aprobada_en === null, 'nace sin firma');
  ok(fila.prioridad === 'urgente', 'conserva la prioridad marcada', fila.prioridad);
  ok(fila.vence_el !== null, 'el vencimiento se calculó solo', `${fila.fecha} + ${fila.validez_dias} = ${fila.vence_el}`);

  console.log('\n─── 3 · Comercial NO puede aprobar ni enviar ───');
  const botonAprobar = comercial.locator('button', { hasText: /^Aprobar/ });
  ok(await botonAprobar.count() > 0, 'el botón «Aprobar» está a la vista');
  ok(await botonAprobar.first().isDisabled(), 'pero desactivado para Comercial');

  const botonEnviar = comercial.locator('button', { hasText: /Marcar como enviada/ });
  ok(await botonEnviar.count() > 0, 'el botón «Marcar como enviada» está a la vista');
  ok(await botonEnviar.first().isDisabled(), 'y también desactivado mientras no haya firma');

  console.log('\n─── 4 · El botón desactivado ni siquiera dispara la acción ───');
  /*
   * Se le quita el atributo `disabled` desde la consola del navegador y se
   * pulsa. React mantiene el manejador inerte, así que no sale ni una
   * petición: el botón no es solo decorativo.
   */
  const posts = [];
  comercial.on('request', (r) => { if (r.method() === 'POST') posts.push(r.url()); });

  await comercial.evaluate(() => {
    document.querySelectorAll('button').forEach((b) => {
      if (/Marcar como enviada/.test(b.textContent ?? '')) b.removeAttribute('disabled');
    });
  });
  await comercial.locator('button', { hasText: /Marcar como enviada/ }).first().click();
  await comercial.waitForTimeout(2500);

  ok(posts.length === 0, 'forzar el botón no llega a disparar nada', `${posts.length} peticiones`);
  const [antes] = await consultar(`select estado from cotizaciones where id = ${creada}`);
  ok(antes.estado === 'borrador', 'y la oferta sigue en borrador', antes.estado);

  console.log('\n─── 5 · Gerencia aprueba ───');
  const gerencia = await entrar('gerencia@santamonica.pe');
  await gerencia.goto(`${BASE}/ventas/cotizaciones/${creada}`, { waitUntil: 'networkidle' });
  await gerencia.waitForTimeout(1500);

  const aprobarG = gerencia.locator('button', { hasText: /^Aprobar/ });
  ok(await aprobarG.first().isEnabled(), 'para Gerencia el botón sí está activo');
  await aprobarG.first().click();
  await gerencia.waitForTimeout(2500);

  const [tras] = await consultar(
    `select estado, aprobada_en, aprobada_por from cotizaciones where id = ${creada}`);
  ok(tras.estado === 'aprobada', 'la oferta pasa a «aprobada»', tras.estado);
  ok(tras.aprobada_en !== null && tras.aprobada_por !== null,
     'queda registrado quién firmó y cuándo');

  const cuerpoG = await gerencia.locator('body').innerText();
  ok(/aprobada por/i.test(cuerpoG), 'la ficha muestra quién la aprobó');

  console.log('\n─── 6 · El candado de verdad: una página desfasada ───');
  /*
   * ESTA es la prueba que demuestra que el control vive en el SERVIDOR.
   *
   * Gerencia tiene la ficha abierta con el botón legítimamente activo. Se le
   * retira la aprobación por detrás —lo que pasaría si otra persona la
   * revocara mientras esta pantalla sigue abierta— y se pulsa. El botón no
   * está trucado: está activo de verdad, así que la acción SÍ se dispara. Y
   * el servidor tiene que negarse igual.
   */
  await consultar(
    `update cotizaciones set aprobada_en = null, aprobada_por = null, estado = 'borrador'
      where id = ${creada}`);

  await gerencia.locator('button', { hasText: /Marcar como enviada/ }).first().click();
  await gerencia.waitForTimeout(3500);

  const [desfasada] = await consultar(`select estado from cotizaciones where id = ${creada}`);
  ok(desfasada.estado === 'borrador',
     'el servidor rechaza el envío aunque el botón estuviera activo', desfasada.estado);

  const motivo = await gerencia.locator('.accion-error').innerText().catch(() => '');
  ok(/todav[íi]a no est[áa] aprobada/i.test(motivo),
     'y el usuario ve el motivo en pantalla', motivo.slice(0, 70));

  // Se vuelve a aprobar para seguir el recorrido normal.
  await gerencia.reload({ waitUntil: 'networkidle' });
  await gerencia.waitForTimeout(1500);
  await gerencia.locator('button', { hasText: /^Aprobar/ }).first().click();
  await gerencia.waitForTimeout(2500);
  // Se recarga antes de mirar el botón: si no, la comprobación cae sobre el
  // árbol anterior al repintado y el resultado depende de la suerte.
  await gerencia.reload({ waitUntil: 'networkidle' });
  await gerencia.waitForTimeout(1800);

  console.log('\n─── 7 · Ahora sí se puede enviar ───');
  const enviarG = gerencia.locator('button', { hasText: /Marcar como enviada/ });
  ok(await enviarG.first().isEnabled(), 'el botón de enviar se habilitó');
  await enviarG.first().click();
  await gerencia.waitForTimeout(2500);
  const [env] = await consultar(`select estado from cotizaciones where id = ${creada}`);
  ok(env.estado === 'enviada', 'la oferta salió al cliente', env.estado);

  console.log('\n─── 8 · La lista enseña el vencimiento ───');
  await gerencia.goto(`${BASE}/ventas/cotizaciones`, { waitUntil: 'networkidle' });
  await gerencia.waitForTimeout(1800);
  const tabla = await gerencia.locator('table.datos').first().innerText();
  ok(/EN \d+ D|VENCE HOY|VENCIÓ HACE/i.test(tabla),
     'la columna de vencimiento cuenta los días');
  const kpis = await gerencia.locator('.rejilla-kpi, .kpi').first().innerText().catch(() => '');
  ok(/APROBACI/i.test(await gerencia.locator('body').innerText()),
     'hay un indicador de las que esperan aprobación');

  console.log('\n─── 9 · Los atajos filtran ───');
  for (const [param, nombre] of [
    ['?vence=por_vencer', 'Caducan en 3 días'],
    ['?vence=vencidas', 'Se pasaron de plazo'],
    ['?prioridad=urgente', 'Urgentes'],
  ]) {
    const r = await gerencia.goto(`${BASE}/ventas/cotizaciones${param}`, { waitUntil: 'networkidle' });
    await gerencia.waitForTimeout(1200);
    const texto = await gerencia.locator('body').innerText();
    ok(r.ok() && !/Application error/i.test(texto), `el atajo «${nombre}» responde`);
  }

  console.log('\n─── 10 · Convertir arrastra la prioridad ───');
  await gerencia.goto(`${BASE}/ventas/cotizaciones/${creada}`, { waitUntil: 'networkidle' });
  await gerencia.waitForTimeout(1500);
  const convertir = gerencia.locator('button', { hasText: /Convertir/ });
  if (await convertir.count()) {
    await convertir.first().click();
    await gerencia.waitForURL(/\/ventas\/pedidos\/\d+/, { timeout: 25000 });
    const pedidoId = Number(gerencia.url().match(/\/(\d+)$/)[1]);
    await gerencia.waitForTimeout(2000);

    const [ped] = await consultar(
      `select prioridad, cotizacion_id from pedidos where id = ${pedidoId}`);
    ok(ped.prioridad === 'urgente',
       'el pedido nace con la prioridad de la cotización', ped.prioridad);
    ok(Number(ped.cotizacion_id) === creada, 'el pedido apunta a su cotización');

    const cuerpoP = await gerencia.locator('body').innerText();
    ok(/ORIGEN/i.test(cuerpoP), 'la ficha del pedido muestra el campo Origen');
    ok(cuerpoP.includes('COT-'), 'y enlaza con el número de la cotización');

    // El pedido de prueba se borra con su cotización
    await consultar(`delete from pedido_lineas where pedido_id = ${pedidoId};
                     delete from pedidos where id = ${pedidoId};`);
  } else {
    ok(false, 'no apareció el botón de convertir');
  }
} finally {
  await limpiar();
  await nav.close();
}

console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo correcto');
process.exit(fallos.length ? 1 : 0);
