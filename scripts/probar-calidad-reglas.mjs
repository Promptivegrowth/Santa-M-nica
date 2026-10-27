/**
 * ============================================================================
 *  PRUEBA · CALIDAD, REGLAS Y TEXTOS COMUNES (migración 077)
 * ============================================================================
 *  Las fallas que encontraron los redactores al recorrer la app con cada rol,
 *  y su arreglo, en el navegador y en la base:
 *
 *    1. Dictamen atómico: si el nuevo falla («Solo mercado nacional» sobre un
 *       pallet apartado para exportación), el anterior SIGUE vigente y el
 *       pallet sigue bloqueado. Aviso previo correcto para «Solo mercado
 *       nacional», motivo tipificado en la lista de Calidad, sustento al
 *       liberar, corte de red sin perder lo escrito, Operaciones sí puede.
 *    2. Etiquetas sin claves: estados con tilde, traza del lote, historial
 *       con nombres de campo legibles y «cambio de datos».
 *    3. Parámetros y reglas: nombres distintos, «quién lo cambia», la regla de
 *       margen lee su parámetro, «Marcar como atendida», «Configurar reglas»
 *       solo para quien entra a Configuración, pie de Usuarios sin jerga.
 *    4. Auditoría: filtro legible y origen de los cambios sin usuario.
 *    5. Merma: Almacén ve antes de llenar que toda merma necesita autorización.
 *
 *  Todo lo que se crea (dictámenes, reserva, alerta, cambios del parámetro)
 *  se borra al final, con su historial y su auditoría.
 *
 *      BASE_URL=http://localhost:3010 node scripts/probar-calidad-reglas.mjs
 * ============================================================================
 */
import { chromium } from 'playwright';
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
const MARCA = 'PRUEBA-D2';

/* ---- Lo que hay antes, para devolverlo todo ---- */
const [prev] = await consultar(`
  select (select coalesce(max(id),0) from eventos) ev, (select coalesce(max(id),0) from auditoria) au,
         (select coalesce(max(id),0) from alertas) al, (select coalesce(max(id),0) from reservas) res,
         (select coalesce(max(id),0) from dictamenes_calidad) dic`);

/* Un pallet libre (sin reservas ni dictámenes abiertos) de un producto que
   tiene una línea en un pedido de EXPORTACIÓN confirmado. */
const [L] = await consultar(`
  select v.lote_id, v.almacen_id, v.codigo_pallet, pl.id pl_id, pl.pedido_id
    from v_stock_lote v
    join pedido_lineas pl on pl.sku_presentacion_id = v.sku_presentacion_id
    join pedidos p on p.id = pl.pedido_id and p.ciclo = 'confirmado' and p.tipo_despacho = 'exportacion'
   where v.bloqueado_kg = 0 and v.solo_nacional_kg = 0 and v.disponible_kg > 100 and v.reservado_kg = 0 and v.preparacion_kg = 0
     and not exists (select 1 from reservas r where r.lote_id = v.lote_id and r.estado in ('activa','en_preparacion'))
     and not exists (select 1 from dictamenes_calidad d where d.lote_id = v.lote_id and d.vigente)
     -- Ni pallets de prueba de otros (PRB …, observaciones PRUEBA…), ni demasiado nuevos.
     and v.codigo_pallet not like 'PRB%'
     and exists (select 1 from lotes l where l.id = v.lote_id and coalesce(l.observaciones, '') not ilike '%prueba%'
                 and l.creado_en < now() - interval '2 days')
   order by v.lote_id desc limit 1`);
const [snapPedido] = await consultar(`select id, cobertura::text, actualizado_en from pedidos where id = ${L.pedido_id}`);
const [snapParam] = await consultar(`select valor, actualizado_en, actualizado_por from parametros where clave = 'margen_minimo_alerta'`);
const uid = async (rol) => (await consultar(`select id, nombre from usuarios where email = '${rol}@santamonica.pe'`))[0];
const UCAL = await uid('calidad'), UOPE = await uid('operaciones'), UCOM = await uid('comercial');
const como = (u, sql) => intentar(`begin; select set_config('request.jwt.claims', '{"sub":"${u}","role":"authenticated"}', true); set local role authenticated; ${sql}; rollback;`);

const nav = await chromium.launch({ channel: 'chrome', headless: true });
const errores = [];
async function sesion(correo) {
  const ctx = await nav.newContext({ viewport: { width: 1500, height: 1000 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errores.push(`${correo}: ${e.message}`));
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', `${correo}@santamonica.pe`);
  await p.fill('input[type="password"]', CLAVE);
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/panel/, { timeout: 40000 });
  return p;
}
const captura = async (p, nombre) => {
  if (process.env.CAPTURAS) await p.screenshot({ path: `${process.env.CAPTURAS}/${nombre}.png`, fullPage: true });
};
const textoMain = async (p) => (await p.locator('main').innerText());

let reservaId = null;
let alertaId = null;

try {
  console.log(`Pallet de prueba: ${L.codigo_pallet} (lote ${L.lote_id}); pedido de exportación ${L.pedido_id}`);

  /* Una reserva chica para exportación: es lo que hace fallar «Solo mercado nacional». */
  [{ id: reservaId }] = await consultar(`
    insert into reservas (pedido_linea_id, lote_id, almacen_id, bultos, peso_neto_kg, estado, vence_el, observaciones, creado_por)
    values (${L.pl_id}, ${L.lote_id}, ${L.almacen_id}, 1, 10, 'activa', now() + interval '5 days', '${MARCA}', '${UOPE.id}')
    returning id`);

  /* ======================================================================
     1 · DICTÁMENES
     ====================================================================== */
  console.log(SEC(1, 'Dictamen atómico, avisos y sustento'));
  const c = await sesion('calidad');
  const form = c.locator('form.dictamen');
  const campo = (etiqueta) => form.locator(`label.form-campo:has(> span:text-is("${etiqueta}"))`).locator('select, input').first();
  {
    await c.goto(`${BASE}/almacenes/lotes/${L.lote_id}`, { waitUntil: 'networkidle' });
    await c.getByRole('button', { name: 'Emitir dictamen' }).click();
    await form.waitFor();
    await campo('Resultado').selectOption('observado');
    await campo('Motivo tipificado').selectOption({ label: 'Microbiológico' });
    await campo('Observaciones').fill(`${MARCA} observado`);

    /* a) Corte de red: el aviso sale en el formulario y lo escrito se queda. */
    await c.route('**/almacenes/lotes/**', (r) => (r.request().method() === 'POST' ? r.abort() : r.continue()));
    await form.getByRole('button', { name: 'Registrar dictamen' }).click();
    await form.locator('.ficha-aviso').waitFor({ timeout: 20000 });
    ok(/Se perdió la conexión/.test(await form.locator('.ficha-aviso').innerText()), 'un corte de red avisa en el formulario (no tumba la pantalla)');
    ok(await campo('Observaciones').inputValue() === `${MARCA} observado`, 'y no se pierde lo escrito');
    await c.unroute('**/almacenes/lotes/**');

    /* b) El observado de verdad. */
    await form.getByRole('button', { name: 'Registrar dictamen' }).click();
    await c.locator('.documento-mensaje, form.dictamen .ficha-aviso-info').first().waitFor({ timeout: 20000 });
    const [d1] = await consultar(`select id, estado::text, motivo_id from dictamenes_calidad where lote_id = ${L.lote_id} and vigente and tipo = 'calidad'`);
    const [b1] = await consultar(`select lote_bloqueado(${L.lote_id}) b`);
    ok(d1?.estado === 'observado' && Number(d1.motivo_id) === 191 && b1.b === true, 'el observado queda vigente y bloquea el pallet', `dictamen ${d1?.id}`);

    /* c) La lista de Calidad muestra el motivo TIPIFICADO (no «—»). */
    await c.goto(`${BASE}/almacenes/calidad?estado=observado`, { waitUntil: 'networkidle' });
    const filaCal = c.locator('tr', { hasText: L.codigo_pallet }).first();
    const motivoCelda = await filaCal.locator('[data-celda="motivo"]').innerText();
    ok(/Microbiológico/.test(motivoCelda), 'la lista de Calidad muestra el motivo tipificado', motivoCelda.trim());
    const grafico = await c.locator('main').innerText();
    const htmlGrafico = await c.locator('section.panel', { hasText: 'Motivos de observación más frecuentes' }).first().innerHTML().catch(() => '');
    ok(/Microbiológico/.test(htmlGrafico), 'y el gráfico de motivos lo cuenta');
    ok(!/\bCamara\b|\bMicrobiologia\b|\bExportacion\b/.test(grafico), 'Calidad sin «Camara», «Microbiologia», «Exportacion»');

    /* d) «Solo mercado nacional»: el aviso previo dice lo que de verdad pasa… */
    await c.goto(`${BASE}/almacenes/lotes/${L.lote_id}`, { waitUntil: 'networkidle' });
    await c.getByRole('button', { name: 'Emitir dictamen' }).click();
    await form.waitFor();
    await campo('Resultado').selectOption('observado');
    const avisoObs = await form.locator('.form-consecuencia').innerText();
    await campo('Motivo tipificado').selectOption({ label: 'Solo mercado nacional' });
    const avisoNac = await form.locator('.form-consecuencia').innerText();
    ok(/SALE del inventario vendible/.test(avisoObs) && /SIGUE disponible/.test(avisoNac) && /mercado nacional/.test(avisoNac) && !/SALE del inventario/.test(avisoNac),
       'con «Solo mercado nacional» el aviso previo dice que sigue disponible solo para nacional', avisoNac.slice(0, 90));
    await captura(c, 'd2-dictamen-solo-nacional');

    /* …y como el pallet está apartado para exportación, falla SIN soltar el anterior. */
    await form.getByRole('button', { name: 'Registrar dictamen' }).click();
    await form.locator('.ficha-aviso-critico').waitFor({ timeout: 20000 });
    const err = await form.locator('.ficha-aviso-critico').innerText();
    ok(/apartado para el pedido/.test(err) && !/violates|exception|function/i.test(err), 'la base lo rechaza con un mensaje en castellano', err.slice(0, 100));
    const vig = await consultar(`select id, estado::text from dictamenes_calidad where lote_id = ${L.lote_id} and vigente and tipo = 'calidad'`);
    const [b2] = await consultar(`select lote_bloqueado(${L.lote_id}) b`);
    ok(vig.length === 1 && Number(vig[0].id) === Number(d1.id) && b2.b === true,
       'ATÓMICO: el observado anterior SIGUE vigente y el pallet sigue bloqueado', `${vig.length} vigente(s), id ${vig[0]?.id}`);

    /* e) Liberar con sustento: el campo está también al liberar. */
    await campo('Resultado').selectOption('liberado');
    const sustento = form.locator('input[name="sustento"]');
    ok(await sustento.isVisible(), 'el campo «Sustento» aparece también al liberar');
    await sustento.fill(`https://ejemplo.pe/informe-${MARCA}.pdf`);
    await form.getByRole('button', { name: 'Registrar dictamen' }).click();
    await c.locator('.documento-mensaje').first().waitFor({ timeout: 20000 });
    const msjLib = await c.locator('.documento-mensaje').first().innerText();
    const [d2] = await consultar(`select id, estado::text, sustento_url, motivo_id from dictamenes_calidad where lote_id = ${L.lote_id} and vigente and tipo = 'calidad'`);
    const [viejo] = await consultar(`select vigente, liberado_por from dictamenes_calidad where id = ${d1.id}`);
    ok(d2?.estado === 'liberado' && /informe-PRUEBA-D2/.test(d2.sustento_url ?? '') && d2.motivo_id === null,
       'liberado con su sustento (y sin arrastrar el motivo de bloqueo)', msjLib.slice(0, 80));
    ok(viejo.vigente === false && viejo.liberado_por === UCAL.id, 'el observado queda en la historia con quién lo liberó');

    /* f) El historial del pallet, en castellano. */
    await c.reload({ waitUntil: 'networkidle' });
    const hist = await c.locator('.linea-tiempo').first().innerText();
    ok(/Dictamen de calidad para .*: observado · Microbiológico/.test(hist) && !/producto_terminado|espera_resultados/.test(hist),
       'el historial dice «Dictamen de calidad para … observado · Microbiológico»');
    await c.context().close();

    /* g) Quién puede, en la base. */
    const eOpe = await como(UOPE.id, `select dictamen_registrar(${L.lote_id}, 'camara', 'espera_resultados', 191, '${MARCA}', null, null)`);
    ok(eOpe === null, 'Operaciones puede emitir un dictamen (antes la política de la tabla lo rechazaba)', eOpe ?? '');
    const eCom = await como(UCOM.id, `select dictamen_registrar(${L.lote_id}, 'camara', 'espera_resultados', 191, '${MARCA}', null, null)`);
    ok(/Solo Calidad, Operaciones y Gerencia/.test(eCom ?? ''), 'Comercial no, y el mensaje dice quién sí');
  }

  /* ======================================================================
     2 · ETIQUETAS Y TEXTOS COMUNES
     ====================================================================== */
  console.log(SEC(2, 'Etiquetas, traza e historial sin claves'));
  const g = await sesion('gerencia');
  {
    const [ped] = await consultar(`select id from pedidos where ciclo = 'pendiente_validacion' order by id limit 1`);
    if (ped) {
      await g.goto(`${BASE}/ventas/pedidos/${ped.id}`, { waitUntil: 'networkidle' });
      const t = await textoMain(g);
      ok(/pendiente de validación/i.test(t) && !/pendiente validacion/i.test(t), 'un pedido pendiente dice «Pendiente de validación»');
    }
    const [ev] = await consultar(`select entidad_id from eventos where entidad = 'pedidos' and descripcion like '%· pendiente\\_validacion' limit 1`);
    if (ev) {
      await g.goto(`${BASE}/ventas/pedidos/${ev.entidad_id}?t=historial`, { waitUntil: 'networkidle' });
      const h = await g.locator('.linea-tiempo').first().innerText();
      ok(!/pendiente_validacion/.test(h) && /pendiente de validación/i.test(h), 'un evento viejo «· pendiente_validacion» se lee en castellano');
    }
    const [rp] = await consultar(`select lote_id from reservas where estado = 'en_preparacion' limit 1`);
    if (rp) {
      const etapas = await consultar(`select etapa from trazar_lote_adelante(${rp.lote_id}) where etapa like 'Reserva%'`);
      ok(etapas.some((e) => e.etapa === 'Reserva en preparación') && !etapas.some((e) => /_/.test(e.etapa)),
         'la traza del lote dice «Reserva en preparación»', etapas.map((e) => e.etapa).join(', '));
    }
    const [cli] = await consultar(`select registro_id id from auditoria where tabla = 'clientes' and accion = 'UPDATE' and 'ruc_tax_id' = any(campos_cambiados) order by id desc limit 1`);
    if (cli) {
      await g.goto(`${BASE}/ventas/clientes/${cli.id}`, { waitUntil: 'networkidle' });
      const h = await g.locator('.linea-tiempo').first().innerText();
      ok(/RUC \/ Tax ID/.test(h) && !/ruc_tax_id/.test(h), 'historial del cliente: «RUC / Tax ID», no «ruc_tax_id»');
      ok(/cambio de datos/i.test(h) && !/registro técnico/i.test(h), 'la marca dice «cambio de datos» (no «registro técnico»)');
      await captura(g, 'd2-historial-cliente');
    }
    const [emb] = await consultar(`select registro_id id from auditoria where tabla = 'embarques' and accion = 'UPDATE' and 'fecha_programada' = any(campos_cambiados) order by id desc limit 1`);
    if (emb) {
      await g.goto(`${BASE}/logistica/embarques/${emb.id}`, { waitUntil: 'networkidle' });
      const h = await g.locator('.linea-tiempo').first().innerText();
      ok(/fecha programada/.test(h) && !/fecha_programada|fecha_carga|fecha_salida/.test(h), 'historial del embarque: «fecha programada», sin nombres de columna');
    }
    await g.goto(`${BASE}/almacenes/lotes/${L.lote_id}`, { waitUntil: 'networkidle' });
    const ficha = await textoMain(g);
    ok(!/\bdia · |· maquila\b|· propia\b/.test(ficha), 'la ficha del pallet no dice «dia · maquila»');
  }

  /* ======================================================================
     3 · PARÁMETROS Y REGLAS
     ====================================================================== */
  console.log(SEC(3, 'Parámetros, reglas y alertas'));
  {
    await g.goto(`${BASE}/configuracion?t=parametros`, { waitUntil: 'networkidle' });
    const t = await textoMain(g);
    ok(/Aviso previo al vencimiento de la reserva/.test(t) && /Aviso previo al vencimiento del producto/.test(t),
       'los dos «Aviso previo al vencimiento» tienen nombres distintos');
    ok((await g.locator('[data-quien="tipo_cambio_referencial"]').innerText()) === 'Lo cambian Gerencia y Operaciones' &&
       (await g.locator('[data-quien="cotizacion_validez_dias"]').innerText()) === 'Lo cambian Gerencia y Operaciones',
       'Validez de la cotización y Tipo de cambio: «Lo cambian Gerencia y Operaciones»');

    /* La regla de margen lee el parámetro: se sube el mínimo y se abren las del medio. */
    const [cand] = await consultar(`select min(margen_pct)::numeric m from v_rentabilidad_pedido
       where ciclo in ('pendiente_validacion','confirmado') and margen_pct is not null and coalesce(costo_estimado,0) > 0 and margen_pct >= 8`);
    const nuevo = cand?.m != null ? String(Math.ceil((Number(cand.m) + 0.5) * 10) / 10) : '9';
    const [esperado] = await consultar(`select count(*)::int n from v_rentabilidad_pedido
       where ciclo in ('pendiente_validacion','confirmado') and margen_pct is not null and coalesce(costo_estimado,0) > 0 and margen_pct < ${nuevo}`);
    const fila = g.locator('tr', { has: g.locator('code', { hasText: /^margen_minimo_alerta$/ }) });
    await fila.locator('input.param-campo').fill(nuevo);
    await fila.locator('input.param-campo').press('Enter');
    await fila.locator('.param-ok, .param-error').waitFor({ timeout: 30000 });
    const msj = await fila.locator('.param-ok, .param-error').innerText();
    const [abiertas] = await consultar(`select count(*)::int n from alertas where regla_id = 5 and not atendida`);
    ok(/Pedido con margen bajo» ya usa el valor nuevo/.test(msj), 'al guardar el margen mínimo, la regla se reevalúa en el acto', msj.slice(0, 110));
    ok(abiertas.n === esperado.n, `con ${nuevo} % la regla abre una alerta por pedido bajo ese margen`, `${abiertas.n} = ${esperado.n}`);
    await g.goto(`${BASE}/configuracion?t=reglas`, { waitUntil: 'networkidle' });
    const umbral = await g.locator('[data-umbral-regla="5"]').innerText();
    ok(umbral.includes(`${nuevo} %`) && /Margen mínimo aceptable/.test(umbral), 'el Motor de reglas muestra el umbral del parámetro', umbral);
    ok(/Marcar como atendida/.test(await textoMain(g)), 'el texto del Motor de reglas nombra el botón «Marcar como atendida»');
    await captura(g, 'd2-motor-reglas');
    // Se devuelve a 8 por la pantalla (y la regla vuelve a lo de antes).
    await g.goto(`${BASE}/configuracion?t=parametros`, { waitUntil: 'networkidle' });
    await fila.locator('input.param-campo').fill(String(snapParam.valor));
    await fila.locator('input.param-campo').press('Enter');
    await fila.locator('.param-ok, .param-error').waitFor({ timeout: 30000 });
    const msj8 = await fila.locator('.param-ok, .param-error').innerText();
    /* Se compara contra lo que la regla DEBE tener con el margen de antes (la
       pasada puede abrir también pedidos nuevos de menos de 8 % que la tarea de
       la mañana aún no había visto: esos son correctos). */
    const [esperado8] = await consultar(`select count(*)::int n from v_rentabilidad_pedido
       where ciclo in ('pendiente_validacion','confirmado') and margen_pct is not null and coalesce(costo_estimado,0) > 0 and margen_pct < ${snapParam.valor}`);
    const [abiertas8] = await consultar(`select count(*)::int n from alertas where regla_id = 5 and not atendida`);
    ok(abiertas8.n === esperado8.n && /ya usa el valor nuevo/.test(msj8),
       `al volver a ${snapParam.valor} % la regla vuelve a una alerta por pedido bajo ese margen`, `${abiertas8.n} = ${esperado8.n} · ${msj8.slice(-40)}`);

    await g.goto(`${BASE}/configuracion?t=usuarios`, { waitUntil: 'networkidle' });
    const pie = await textoMain(g);
    ok(!/PostgreSQL|base de datos/.test(pie), 'el pie de Usuarios y roles no habla de PostgreSQL ni de base de datos');

    /* Operaciones edita la validez de la cotización (antes «Solo Gerencia»). */
    const o = await sesion('operaciones');
    await o.goto(`${BASE}/configuracion?t=parametros`, { waitUntil: 'networkidle' });
    const filaVal = o.locator('tr', { has: o.locator('code', { hasText: /^cotizacion_validez_dias$/ }) });
    ok(await filaVal.locator('input.param-campo').count() === 1, 'Operaciones puede cambiar la Validez de la cotización');
    const filaMargen = o.locator('tr', { has: o.locator('code', { hasText: /^margen_minimo_alerta$/ }) });
    ok(/Solo Gerencia puede cambiarlo/.test(await filaMargen.innerText()), 'y ve apagado el margen mínimo, que es de Gerencia');

    /* «Marcar como atendida» sobre una alerta de prueba. */
    [{ id: alertaId }] = await consultar(`insert into alertas (entidad, entidad_id, severidad, titulo, mensaje)
       values ('lote', ${L.lote_id}, 'info', '${MARCA} alerta', 'Alerta de prueba de ${MARCA}') returning id`);
    await o.goto(`${BASE}/alertas?titulo=${encodeURIComponent(`${MARCA} alerta`)}`, { waitUntil: 'networkidle' });
    ok(await o.getByRole('link', { name: 'Configurar reglas' }).count() === 1, 'Operaciones ve «Configurar reglas»');
    const boton = o.locator(`[data-alerta-atender="${alertaId}"] button`).first();
    await boton.click();
    ok((await boton.innerText()).includes('¿Confirmar?'), 'pide confirmar antes de cerrarla');
    await captura(o, 'd2-alerta-atender');
    await boton.click();
    await o.locator(`[data-alerta-atender="${alertaId}"] small`).waitFor({ timeout: 20000 });
    const [al] = await consultar(`select atendida, atendida_por, atendida_en from alertas where id = ${alertaId}`);
    ok(al.atendida === true && al.atendida_por === UOPE.id && al.atendida_en, 'queda atendida, con quién y cuándo');
    await o.goto(`${BASE}/alertas?ver=atendidas&titulo=${encodeURIComponent(`${MARCA} alerta`)}`, { waitUntil: 'networkidle' });
    ok(new RegExp(`Atendida por ${UOPE.nombre}`).test(await textoMain(o)), 'y se ve en «Atendidas a mano» con su nombre');
    await o.context().close();

    for (const rol of ['calidad', 'consulta']) {
      const s = await sesion(rol);
      await s.goto(`${BASE}/alertas`, { waitUntil: 'networkidle' });
      ok(await s.getByRole('link', { name: 'Configurar reglas' }).count() === 0 && await s.locator('[data-alerta-atender]').count() === 0,
         `${rol} no ve «Configurar reglas» ni «Marcar como atendida»`);
      await s.context().close();
    }
  }

  /* ======================================================================
     4 · AUDITORÍA
     ====================================================================== */
  console.log(SEC(4, 'Auditoría legible y con origen'));
  {
    await g.goto(`${BASE}/trazabilidad/auditoria`, { waitUntil: 'networkidle' });
    const opciones = await g.locator('select.campo').first().locator('option').allInnerTexts();
    ok(opciones.includes('Dictámenes de calidad') && !opciones.some((x) => /_/.test(x)), 'el filtro dice «Dictámenes de calidad», sin nombres técnicos', `${opciones.length} opciones`);
    await g.goto(`${BASE}/trazabilidad/auditoria?tabla=dictamenes_calidad`, { waitUntil: 'networkidle' });
    const t = await textoMain(g);
    ok(t.includes(UCAL.nombre) && /Dictámenes de calidad/.test(t), 'los dictámenes de esta prueba salen con el usuario de Calidad');
    const [a] = await consultar(`select origen, usuario_id from auditoria where tabla = 'reservas' and registro_id = '${reservaId}' and accion = 'INSERT'`);
    ok(a?.origen === 'mantenimiento' && a.usuario_id === null, 'un cambio por script queda con origen «mantenimiento»');
    const [au] = await consultar(`select origen from auditoria where tabla = 'dictamenes_calidad' and id > ${prev.au} and usuario_id = '${UCAL.id}' limit 1`);
    ok(au?.origen === 'usuario', 'uno de la pantalla, con origen «usuario»');
    await g.goto(`${BASE}/trazabilidad/auditoria?tabla=reservas`, { waitUntil: 'networkidle' });
    ok(/Mantenimiento técnico/.test(await textoMain(g)), 'y en pantalla dice «Mantenimiento técnico», no «Sistema»');
    await captura(g, 'd2-auditoria');
  }

  /* ======================================================================
     5 · MERMA PARA ALMACÉN
     ====================================================================== */
  console.log(SEC(5, 'Merma: Almacén lo sabe antes de llenar'));
  {
    const a = await sesion('almacen');
    await a.goto(`${BASE}/almacenes/ajustes/nuevo?lote=${L.lote_id}`, { waitUntil: 'networkidle' });
    ok(await a.locator('input[name="tipo_ajuste"][value="salida_merma"]').isDisabled(), 'la merma sale apagada para Almacén');
    const aviso = await a.locator('[data-aviso="autorizacion"]').innerText();
    ok(/Merma: toda necesita autorización de Gerencia u Operaciones/.test(aviso) && /no guarda solicitudes/.test(aviso),
       'y un aviso arriba dice que toda merma necesita autorización', aviso.slice(0, 90));
    ok(!(await a.locator('input[name="tipo_ajuste"][value="salida_muestra"]').isDisabled()), 'la muestra sigue disponible');
    await captura(a, 'd2-merma-almacen');
    await a.context().close();
  }
  await g.context().close();

  ok(errores.length === 0, 'sin errores de JavaScript en las pantallas', errores.slice(0, 3).join(' | '));
} finally {
  /* ---- Todo a su sitio ---- */
  try {
    const misDic = (await consultar(`select id from dictamenes_calidad where id > ${prev.dic} and lote_id = ${L.lote_id}`)).map((d) => d.id);
    await ejecutarSQL(`
      ${alertaId ? `delete from alertas where id = ${alertaId};` : ''}
      delete from alertas where id > ${prev.al} and regla_id = 5;
      ${misDic.length ? `delete from dictamenes_calidad where id in (${misDic});` : ''}
      ${reservaId ? `delete from reservas where id = ${reservaId};` : ''}
      update pedidos set cobertura = '${snapPedido.cobertura}', actualizado_en = '${snapPedido.actualizado_en}' where id = ${L.pedido_id};
      update parametros set valor = '${snapParam.valor}', actualizado_en = ${snapParam.actualizado_en ? `'${snapParam.actualizado_en}'` : 'null'},
             actualizado_por = ${snapParam.actualizado_por ? `'${snapParam.actualizado_por}'` : 'null'}
       where clave = 'margen_minimo_alerta';
      delete from eventos where id > ${prev.ev} and (
        (entidad = 'lotes' and entidad_id = ${L.lote_id})
        or (entidad = 'reservas' and entidad_id = ${reservaId ?? 0}));
      delete from auditoria where id > ${prev.au} and (
        (tabla = 'dictamenes_calidad' and registro_id = any(array[${misDic.map((x) => `'${x}'`).join(',') || "''"}]))
        or (tabla = 'reservas' and registro_id = '${reservaId ?? 0}')
        or (tabla = 'pedidos' and registro_id = '${L.pedido_id}' and usuario_id is null and campos_cambiados <@ array['cobertura','actualizado_en'])
        or (tabla = 'parametros' and coalesce(datos_despues->>'clave', datos_antes->>'clave') = 'margen_minimo_alerta'));
    `);
    //  La regla de margen vuelve a contar lo de antes (sin las borradas).
    await consultar(`select count(*) from reglas_evaluar(5)`);
    const [{ n }] = await consultar(`select count(*)::int n from dictamenes_calidad where lote_id = ${L.lote_id} and id > ${prev.dic}`);
    const [{ r }] = await consultar(`select count(*)::int r from reservas where id = ${reservaId ?? 0}`);
    const [pv] = await consultar(`select valor from parametros where clave = 'margen_minimo_alerta'`);
    ok(n === 0 && r === 0 && pv.valor === snapParam.valor, 'limpieza: dictámenes, reserva, alerta, parámetro, historial y auditoría como estaban');
  } catch (e) {
    ok(false, 'limpieza', String(e.message).slice(0, 300));
  }
  await nav.close();
}

console.log(fallos.length ? `\n${fallos.length} FALLO(S):\n - ${fallos.join('\n - ')}` : '\nTodo correcto');
process.exit(fallos.length ? 1 : 0);
