/**
 * ============================================================================
 *  PRUEBA · LIMITACIONES DE COTIZACIONES Y PEDIDOS (revisión de la Guía de uso)
 * ============================================================================
 *  Al escribir el capítulo B de la Guía aparecieron nueve huecos. Esto prueba,
 *  en el navegador y en la base, que quedaron cerrados:
 *
 *    1. Una cotización APROBADA se puede editar (antes el botón rebotaba).
 *    2. Editar algo comercial de una aprobada/enviada ANULA la aprobación
 *       (vuelve a borrador, queda en el historial); lo no comercial la conserva.
 *    3. Al editar, el tope de descuento se controla en el servidor y se
 *       registra quién lo autorizó (antes solo al crear).
 *    4. El botón «Aprobar» ya no dice «Solo Gerencia».
 *    5. Una aprobada (o enviada) se puede marcar como rechazada, con confirmación.
 *    6. La restricción de peso: la misma lista de roles en pantalla y servidor.
 *    7. El pedido directo guarda de dónde salió el tipo de cambio.
 *    8. Las pestañas Facturas y Cobranza ya no muestran lo mismo.
 *    9. Los botones «Cotizar» no se ofrecen a quien no entra a Cotizaciones.
 *   10. El costo estimado de cada línea sale del costo vigente de Finanzas
 *       (migración 067): al cotizar, al editar (solo líneas nuevas), al
 *       convertir (se hereda) y en el pedido directo, también si lo hace Comex.
 *
 *  Todo lo que se crea o se cambia se devuelve como estaba al final (incluidas
 *  las filas de auditoría y de eventos de lo tocado).
 *
 *      BASE_URL=http://localhost:3010 node scripts/probar-ventas-limitaciones.mjs
 * ============================================================================
 */
import { chromium } from 'playwright';
import { ejecutarSQL } from './db.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const CLAVE = process.env.CLAVE_DEMO ?? 'SantaMonica2026';
const consultar = async (sql) => { const r = await ejecutarSQL(sql); return Array.isArray(r) ? r : []; };
const SEC = (n, t) => `\n${'─'.repeat(3)} ${n} · ${t} ${'─'.repeat(3)}`;
const fallos = [];
const ok = (cond, texto, detalle = '') => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${texto}${detalle ? ' · ' + detalle : ''}`);
  if (!cond) fallos.push(texto);
};
const CAPTURAS = process.env.CAPTURAS ?? null;   // carpeta opcional para mirar las pantallas
const foto = async (pg, nombre) => { if (CAPTURAS) await pg.screenshot({ path: `${CAPTURAS}/${nombre}.png`, fullPage: true }); };

const [{ inicio }] = await consultar(`select now()::text as inicio`);
const nav = await chromium.launch({ channel: 'chrome', headless: true });

/** Una sesión nueva (contexto propio) por usuario. */
const sesiones = {};
async function como(rol) {
  if (sesiones[rol]) return sesiones[rol];
  const ctx = await nav.newContext({ viewport: { width: 1600, height: 1000 } });
  //  El servidor de desarrollo compila cada pantalla la primera vez: se le da margen.
  ctx.setDefaultNavigationTimeout(90000);
  ctx.setDefaultTimeout(45000);
  const pg = await ctx.newPage();
  await pg.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await pg.fill('input[type="email"]', `${rol}@santamonica.pe`);
  await pg.fill('input[type="password"]', CLAVE);
  await pg.click('button[type="submit"]');
  await pg.waitForURL(/\/panel/, { timeout: 30000 });
  sesiones[rol] = pg;
  return pg;
}

/** Guarda el formulario de edición y espera volver a la ficha (o un error). */
async function guardarEdicion(pg, cotId) {
  await pg.locator('button', { hasText: 'Guardar cambios' }).click();
  const msg = pg.locator('.form-mensaje');
  await msg.waitFor({ timeout: 30000 });
  const texto = await msg.innerText();
  if (/form-mensaje ok/.test(await msg.getAttribute('class'))) {
    await pg.waitForURL(new RegExp(`/ventas/cotizaciones/${cotId}$`), { timeout: 30000 });
    await pg.waitForLoadState('networkidle');
  }
  return texto;
}

/* Lo que hay que devolver a su sitio al terminar. */
let cotId = null;
let pedidoNuevo = null;
let pedidoPeso = null;
/* Lo creado en el punto 10. */
const pedidosExtra = [];
let cotB = null;
/** El costo que rige hoy para una presentación, en US$/TM (la regla de 057, vía 067). */
const vigente = async (spId) => {
  const [r] = await consultar(`select costo_estimado_tm_vigente(${spId})::float c`);
  return r?.c ?? null;
};
const cerca = (a, b) => a !== null && b !== null && Math.abs(Number(a) - Number(b)) < 0.01;

try {
  /* ---- Datos de prueba: una cotización APROBADA con dos líneas ---- */
  const [ger] = await consultar(`select id from usuarios where email = 'gerencia@santamonica.pe'`);
  const [cli] = await consultar(`select id from clientes where not bloqueado and activo and pais <> 'Perú' order by id limit 1`);
  const skus = await consultar(`select sp.id from sku_presentaciones sp join skus s on s.id = sp.sku_id
                                 where sp.activo and s.activo order by sp.id limit 2`);
  const [cot] = await consultar(`
    insert into cotizaciones (numero, cliente_id, estado, moneda, tipo_cambio, incoterm, validez_dias, creado_por,
                              aprobada_en, aprobada_por, observaciones, forma_pago, adelanto_pct, tipo_cambio_fuente, tipo_cambio_fecha)
    values ('COT-PRUEBA-067', ${cli.id}, 'aprobada', 'USD', 3.45, 'FOB', 15, '${ger.id}',
            now(), '${ger.id}', 'Prueba 067', 'contado', 0, 'manual', current_date)
    returning id`);
  cotId = cot.id;
  await consultar(`
    insert into cotizacion_lineas (cotizacion_id, sku_presentacion_id, cantidad_tm, precio_lista_tm, precio_tm, descuento_pct, descuento_autorizado_por, orden)
    values (${cotId}, ${skus[0].id}, 10, 3000, 3000, 0, null, 1),
           (${cotId}, ${skus[1].id}, 5, 2500, 2500, 5, '${ger.id}', 2)`);
  const estadoCot = async () => (await consultar(`
    select estado::text estado, aprobada_en is not null aprobada, observaciones from cotizaciones where id = ${cotId}`))[0];

  console.log(SEC(1, 'Una cotización aprobada se puede editar'));
  {
    const pg = await como('comercial');
    await pg.goto(`${BASE}/ventas/cotizaciones/${cotId}`, { waitUntil: 'networkidle' });
    const editar = pg.locator('[data-accion="editar"]');
    ok(await editar.count() === 1, 'la ficha de una aprobada ofrece «Editar»');
    ok(/aprobación se anula/.test(await editar.getAttribute('title') ?? ''), 'y su ayuda avisa que un cambio comercial anula la aprobación');
    await editar.click();
    await pg.waitForURL(new RegExp(`/ventas/cotizaciones/${cotId}/editar$`), { timeout: 90000 });
    await pg.waitForLoadState('networkidle');
    ok(true, 'al pulsarlo se abre el formulario (ya no rebota a la ficha)');
    const aviso = pg.locator('[data-aviso="anula-aprobacion"]');
    ok(await aviso.count() === 1 && /la aprobación se\s+anula/.test(await aviso.innerText()), 'antes de editar, el aviso dice que al guardar se pedirá aprobar de nuevo');
    ok(await pg.locator('table.datos tbody tr').nth(1).locator('.pill-critico').count() === 0,
       'el 5 % que Gerencia ya autorizó no sale marcado «Requiere autorización»');
    await foto(pg, '1-editar-aprobada');
  }

  console.log(SEC('2a', 'Un cambio NO comercial conserva la aprobación'));
  {
    const pg = await como('comercial');
    await pg.fill('input[placeholder^="Condiciones especiales"]', 'Prueba 067: solo cambia la observación');
    const msg = await guardarEdicion(pg, cotId);
    const e = await estadoCot();
    ok(e.estado === 'aprobada' && e.aprobada && e.observaciones.includes('solo cambia'), 'cambiar las observaciones conserva la aprobación', `${e.estado} · ${msg}`);
    const [l2] = await consultar(`select descuento_autorizado_por::text a from cotizacion_lineas where cotizacion_id = ${cotId} and sku_presentacion_id = ${skus[1].id}`);
    ok(l2?.a === ger.id, 'el descuento del 5 % que autorizó Gerencia conserva su autorización al editar (punto 3)');
  }

  console.log(SEC(3, 'Al editar, el tope de descuento se controla en el servidor'));
  {
    const pg = await como('comercial');
    await pg.goto(`${BASE}/ventas/cotizaciones/${cotId}/editar`, { waitUntil: 'networkidle' });
    const desc = pg.locator('table.datos tbody tr').first().locator('input[max="100"]');
    await desc.fill('10');
    ok(await pg.locator('table.datos tbody tr').first().locator('.pill-critico', { hasText: 'Requiere autorización' }).count() === 1, 'la marca «Requiere autorización» aparece en la línea');
    const msg = await guardarEdicion(pg, cotId);
    ok(/permitido sin autorización/.test(msg) && /Gerencia u Operaciones/.test(msg), 'Comercial no puede guardar un 10 %: el servidor lo rechaza', msg);
    const [l1] = await consultar(`select descuento_pct::float d from cotizacion_lineas where cotizacion_id = ${cotId} and sku_presentacion_id = ${skus[0].id}`);
    ok(l1.d === 0, 'y en la base no cambió nada');
    await foto(pg, '3-descuento-rechazado');

    //  Gerencia sí lo autoriza, y queda su nombre en la línea.
    const pgG = await como('gerencia');
    await pgG.goto(`${BASE}/ventas/cotizaciones/${cotId}/editar`, { waitUntil: 'networkidle' });
    await pgG.locator('table.datos tbody tr').first().locator('input[max="100"]').fill('10');
    const msgG = await guardarEdicion(pgG, cotId);
    const [l1g] = await consultar(`select descuento_pct::float d, descuento_autorizado_por::text a from cotizacion_lineas where cotizacion_id = ${cotId} and sku_presentacion_id = ${skus[0].id}`);
    ok(l1g.d === 10 && l1g.a === ger.id, 'Gerencia sí puede, y queda registrado quién autorizó', msgG);

    console.log(SEC('2b', 'Ese cambio comercial anuló la aprobación'));
    const e = await estadoCot();
    ok(e.estado === 'borrador' && !e.aprobada, 'cambiar el descuento devolvió la cotización a borrador, sin aprobación', e.estado);
    ok(/aprobación se anuló/.test(msgG), 'el mensaje al guardar lo dice', msgG);
    const [ev] = await consultar(`select descripcion from eventos where entidad = 'cotizaciones' and entidad_id = ${cotId} and tipo = 'cotizacion_aprobacion_anulada' and ocurrido_en > '${inicio}'`);
    ok(!!ev && /La edición anuló la aprobación: hay que volver a aprobarla/.test(ev.descripcion), 'y queda en el historial', ev?.descripcion);
    await pgG.waitForLoadState('networkidle');
    ok(await pgG.locator('[data-aviso="esperando-aprobacion"]').count() === 1, 'la ficha vuelve a decir «Esperando aprobación»');
    ok(/La edición anuló la aprobación/.test(await pgG.locator('main').innerText()), 'y su historial muestra el aviso');
    await foto(pgG, '2b-aprobacion-anulada');
  }

  console.log(SEC('2c', 'En una ENVIADA, cambiar la cantidad también anula la aprobación'));
  {
    await consultar(`update cotizaciones set estado = 'enviada', aprobada_en = now(), aprobada_por = '${ger.id}' where id = ${cotId}`);
    const pg = await como('comercial');
    await pg.goto(`${BASE}/ventas/cotizaciones/${cotId}/editar`, { waitUntil: 'networkidle' });
    ok(await pg.locator('[data-aviso="anula-aprobacion"]').count() === 1, 'el aviso también aparece en una enviada');
    //  Se cambia la cantidad de la línea 2 (sin descuento por encima del tope en juego).
    const cant = pg.locator('table.datos tbody tr').nth(1).locator('input[min="0.001"]');
    await cant.fill('6');
    const msg = await guardarEdicion(pg, cotId);
    const e = await estadoCot();
    ok(e.estado === 'borrador' && !e.aprobada, 'la enviada con otra cantidad vuelve a borrador', `${e.estado} · ${msg}`);
    const [l1] = await consultar(`select descuento_autorizado_por::text a from cotizacion_lineas where cotizacion_id = ${cotId} and sku_presentacion_id = ${skus[0].id}`);
    ok(l1.a === ger.id, 'el 10 % que autorizó Gerencia sigue autorizado aunque edite Comercial');
  }

  console.log(SEC(4, 'La ayuda de «Aprobar» ya no dice «Solo Gerencia»'));
  {
    const pg = await como('comercial');
    await pg.goto(`${BASE}/ventas/cotizaciones/${cotId}`, { waitUntil: 'networkidle' });
    const aprobar = pg.locator('button', { hasText: /^Aprobar$/ });
    ok(await aprobar.count() === 1 && await aprobar.isDisabled(), 'Comercial (sin la facultad) ve «Aprobar» apagado');
    const t = await aprobar.getAttribute('title');
    ok(/Aprueba cotizaciones/.test(t) && !/Solo Gerencia/.test(t), 'su ayuda habla de la facultad personal, no del cargo', t);
    const aviso = await pg.locator('[data-aviso="esperando-aprobacion"]').innerText();
    ok(!/Gerencia/.test(aviso) && /quien aprueba cotizaciones/.test(aviso), 'el aviso «Esperando aprobación» tampoco nombra a Gerencia', aviso);
    //  Operaciones tampoco tiene la facultad en la demo; Gerencia sí.
    const pgG = await como('gerencia');
    await pgG.goto(`${BASE}/ventas/cotizaciones/${cotId}`, { waitUntil: 'networkidle' });
    ok(!(await pgG.locator('button', { hasText: /^Aprobar$/ }).isDisabled()), 'Gerencia (con la facultad) lo ve activo');
  }

  console.log(SEC(5, 'Una cotización aprobada se puede marcar como rechazada'));
  {
    const pg = await como('comercial');
    ok(await pg.locator('[data-accion="rechazar"]').count() === 0, 'un borrador no ofrece «Marcar rechazada»');
    await consultar(`update cotizaciones set estado = 'aprobada', aprobada_en = now(), aprobada_por = '${ger.id}' where id = ${cotId}`);
    await pg.goto(`${BASE}/ventas/cotizaciones/${cotId}`, { waitUntil: 'networkidle' });
    ok(await pg.locator('[data-accion="rechazar"]').count() === 1, 'una aprobada sí lo ofrece');
    await pg.click('[data-accion="rechazar"]');
    ok(/como rechazada/.test(await pg.locator('[data-confirmar="rechazar"]').innerText()), 'pide confirmación antes de marcarla');
    await foto(pg, '5-confirmar-rechazo');
    await pg.click('[data-accion="confirmar-rechazo"]');
    //  Se espera a que la base lo refleje (el servidor de desarrollo puede tardar).
    let e = await estadoCot();
    for (let i = 0; i < 30 && e.estado !== 'rechazada'; i++) { await pg.waitForTimeout(1000); e = await estadoCot(); }
    await pg.locator('[data-accion="rechazar"]').waitFor({ state: 'detached', timeout: 30000 }).catch(() => {});
    await pg.waitForLoadState('networkidle');
    ok(e.estado === 'rechazada', 'queda rechazada en la base', e.estado);
    const [ev] = await consultar(`select count(*)::int n from eventos where entidad = 'cotizaciones' and entidad_id = ${cotId} and tipo = 'cotizacion_rechazada' and ocurrido_en > '${inicio}'`);
    ok(ev.n === 1, 'y en su historial');
    await pg.reload({ waitUntil: 'networkidle' });
    ok(await pg.locator('[data-accion="editar"]').count() === 0, 'una rechazada ya no se edita');
    //  Y la dirección de edición escrita a mano lo explica en vez de rebotar en silencio.
    await pg.goto(`${BASE}/ventas/cotizaciones/${cotId}/editar`, { waitUntil: 'networkidle' });
    ok(/nohayeditar=rechazada/.test(pg.url()) && await pg.locator('[data-aviso="no-editable"]').count() === 1,
       'abrir «editar» de una rechazada vuelve a la ficha con un aviso claro');
  }

  console.log(SEC(6, 'Restricción de peso: los mismos roles en pantalla y servidor'));
  {
    [pedidoPeso] = await consultar(`
      select id, peso_neto_max_kg, peso_bruto_max_kg, nota_restricciones, restricciones_por::text rp, restricciones_en::text re
        from pedidos where ciclo in ('confirmado', 'pendiente_validacion') and peso_neto_max_kg is null and nota_restricciones is null
       order by id limit 1`);
    for (const [rol, debe] of [['comex', true], ['comercial', true], ['almacen', false], ['calidad', false], ['consulta', false]]) {
      const pg = await como(rol);
      await pg.goto(`${BASE}/ventas/pedidos/${pedidoPeso.id}`, { waitUntil: 'networkidle' });
      const n = await pg.locator('button', { hasText: /Fijar topes de peso|Editar topes y nota/ }).count();
      ok((n === 1) === debe, `${rol} ${debe ? 've' : 'no ve'} «Fijar topes de peso»`);
    }
    //  Comex (antes no le aparecía el botón aunque el servidor sí lo dejaba) la guarda.
    const pg = await como('comex');
    await pg.goto(`${BASE}/ventas/pedidos/${pedidoPeso.id}`, { waitUntil: 'networkidle' });
    await pg.click('button:has-text("Fijar topes de peso")');
    await pg.locator('.cal-topes input[type="number"]').first().fill('26');
    await pg.click('.cal-topes button:has-text("Guardar")');
    let d = { n: null };
    for (let i = 0; i < 30 && d.n !== 26000; i++) {
      await pg.waitForTimeout(1000);
      [d] = await consultar(`select peso_neto_max_kg::float n from pedidos where id = ${pedidoPeso.id}`);
    }
    ok(d.n === 26000, 'Comex guarda la restricción y queda en la base', String(d.n));
  }

  console.log(SEC(7, 'El pedido directo guarda de dónde salió el tipo de cambio'));
  {
    const pg = await como('comercial');
    await pg.goto(`${BASE}/ventas/pedidos/nuevo`, { waitUntil: 'networkidle' });
    await pg.locator('small[data-tc="sunat"], small[data-tc="manual"]').first().waitFor({ timeout: 25000 });
    const fuentePantalla = await pg.locator('input[data-fuente]').getAttribute('data-fuente');
    await pg.locator('select.campo').first().selectOption(String(cli.id));
    await pg.waitForTimeout(800);
    await pg.locator('input.form-buscador-input').fill('POTA');
    await pg.waitForTimeout(1500);
    await pg.locator('.form-resultados button').first().click();
    await pg.waitForTimeout(2000);
    await pg.locator('button', { hasText: 'Registrar pedido' }).click();
    await pg.waitForURL(/\/ventas\/pedidos\/\d+$/, { timeout: 30000 });
    pedidoNuevo = Number(pg.url().match(/(\d+)$/)[1]);
    const [pd] = await consultar(`select tipo_cambio_fuente f, tipo_cambio_clase k, tipo_cambio_fecha::text tf from pedidos where id = ${pedidoNuevo}`);
    ok(pd.f === fuentePantalla && !!pd.tf, 'se guarda el origen que mostraba la pantalla, y su fecha', `${pd.f} · ${pd.k ?? '—'} · ${pd.tf}`);
    ok(pd.f !== 'sunat' || pd.k === 'venta', 'si es SUNAT, también la clase (venta)');
    await pg.waitForLoadState('networkidle');
    const origen = await pg.locator('[data-tc-origen]').innerText();
    ok(pd.f === 'sunat' ? /SUNAT · venta/.test(origen) : /Escrito a mano/.test(origen), 'la ficha del pedido lo muestra junto a la moneda', origen.replace(/\s+/g, ' '));
    const bloque = await pg.locator('[data-bloque="condiciones"] [data-tc-fuente]').getAttribute('data-tc-fuente');
    ok(bloque === pd.f, 'y el bloque «Entrega y pago» ya no dice «Anterior al tipo de cambio automático»', bloque);

    //  Punto 10: la línea del pedido directo lleva el costo vigente, no un 0.
    const [ln] = await consultar(`select sku_presentacion_id sp, costo_estimado_tm::float c from pedido_lineas where pedido_id = ${pedidoNuevo}`);
    const v = await vigente(ln.sp);
    ok(v > 0 && cerca(ln.c, v), 'el pedido directo guarda el costo estimado vigente de Finanzas (punto 10)', `${ln.c} = ${v}`);
    await pg.goto(`${BASE}/ventas/pedidos/${pedidoNuevo}?t=productos`, { waitUntil: 'networkidle' });
    ok(cerca(await pg.locator('[data-costo-estimado]').first().getAttribute('data-costo-estimado'), v), 'y la pestaña Productos lo muestra');
  }

  console.log(SEC(8, 'Facturas y Cobranza ya no muestran lo mismo'));
  {
    const [conPagos] = await consultar(`
      select f.pedido_id id, count(c.*)::int pagos, sum(c.monto)::float cobrado
        from facturas f join cobranzas c on c.factura_id = f.id
       where f.estado <> 'anulada'
       group by f.pedido_id having sum(c.monto) < max(f.total) - 0.01 order by f.pedido_id limit 1`);
    ok(!!conPagos, 'hay un pedido con pagos parciales para mirar', conPagos ? `pedido ${conPagos.id}` : '');
    const pg = await como('gerencia');
    await pg.goto(`${BASE}/ventas/pedidos/${conPagos.id}?t=facturas`, { waitUntil: 'networkidle' });
    ok(await pg.locator('[data-tabla="facturas"]').count() === 1 && await pg.locator('[data-tabla="pagos"]').count() === 0,
       'Facturas: los comprobantes emitidos, sin pagos');
    await pg.goto(`${BASE}/ventas/pedidos/${conPagos.id}?t=cobranza`, { waitUntil: 'networkidle' });
    ok(await pg.locator('[data-tabla="facturas"]').count() === 0, 'Cobranza ya no repite la tabla de Facturas');
    const filas = await pg.locator('[data-tabla="pagos"] tbody tr').count();
    ok(filas === conPagos.pagos, 'Cobranza lista los pagos registrados contra sus comprobantes', `${filas} de ${conPagos.pagos}`);
    const kpis = await pg.locator('[data-bloque="cobranza"]').innerText();
    ok(/Facturado/i.test(kpis) && /Cobrado/i.test(kpis) && /Saldo por cobrar/i.test(kpis) && /Vencido/i.test(kpis) && /Adelanto registrado/i.test(kpis),
       'con facturado, cobrado, saldo, vencido y adelanto');
    ok(await pg.locator('[data-tabla="saldos"] tbody tr').count() >= 1, 'y el saldo de cada comprobante');
    await foto(pg, '8-cobranza');
    //  Un pedido sin facturas ni adelanto lo dice.
    const [sinNada] = await consultar(`
      select p.id from pedidos p where p.adelanto_abonado is null
         and not exists (select 1 from facturas f where f.pedido_id = p.id) order by p.id limit 1`);
    await pg.goto(`${BASE}/ventas/pedidos/${sinNada.id}?t=cobranza`, { waitUntil: 'networkidle' });
    ok(/Sin cobros/.test(await pg.locator('main').innerText()), 'sin comprobantes ni adelanto: «Sin cobros»');
  }

  console.log(SEC(9, '«Cotizar» solo para quien entra a Cotizaciones'));
  {
    const [prod] = await consultar(`select sp.id from sku_presentaciones sp where sp.activo order by sp.id limit 1`);
    const rutas = [`/ventas/clientes/${cli.id}`, '/ventas/productos', `/ventas/productos/${prod.id}`, '/ventas/pedidos/nuevo'];
    for (const [rol, debe] of [['comercial', true], ['operaciones', true], ['comex', false], ['almacen', false], ['calidad', false], ['consulta', false]]) {
      const pg = await como(rol);
      const vistos = [];
      for (const r of rutas) {
        await pg.goto(`${BASE}${r}`, { waitUntil: 'networkidle' });
        if (!pg.url().includes(r.split('?')[0])) continue;   // la ruta no es para este rol
        if (await pg.locator('a[href^="/ventas/cotizaciones/nueva"]').count() > 0) vistos.push(r);
      }
      ok(debe ? vistos.length >= 3 : vistos.length === 0, `${rol} ${debe ? 've' : 'no ve'} los enlaces a cotizar`, vistos.join(', ') || 'ninguno');
    }
  }

  console.log(SEC(10, 'El costo estimado sale del costo vigente (067)'));
  {
    //  La cotización de prueba del principio: sus líneas se insertaron sin costo.
    for (const sp of skus) {
      const [l] = await consultar(`select costo_estimado_tm::float c from cotizacion_lineas where cotizacion_id = ${cotId} and sku_presentacion_id = ${sp.id}`);
      ok(cerca(l.c, await vigente(sp.id)), `la línea de la cotización tomó el costo vigente al crearse (presentación ${sp.id})`, String(l.c));
    }

    //  Una cotización aprobada: una línea con costo propio y otra sin costo.
    const [b] = await consultar(`
      insert into cotizaciones (numero, cliente_id, estado, moneda, tipo_cambio, incoterm, validez_dias, creado_por, aprobada_en, aprobada_por, tipo_cambio_fuente, tipo_cambio_fecha)
      values ('COT-PRUEBA-067B', ${cli.id}, 'aprobada', 'USD', 3.45, 'FOB', 15, '${ger.id}', now(), '${ger.id}', 'manual', current_date) returning id`);
    cotB = b.id;
    await consultar(`insert into cotizacion_lineas (cotizacion_id, sku_presentacion_id, cantidad_tm, precio_lista_tm, precio_tm, descuento_pct, orden, costo_estimado_tm)
                     values (${cotB}, ${skus[0].id}, 4, 3000, 3000, 0, 1, 1111)`);
    await consultar(`insert into cotizacion_lineas (cotizacion_id, sku_presentacion_id, cantidad_tm, precio_lista_tm, precio_tm, descuento_pct, orden)
                     values (${cotB}, ${skus[1].id}, 3, 2500, 2500, 0, 2)`);
    ok((await consultar(`select costo_estimado_tm::float c from cotizacion_lineas where cotizacion_id = ${cotB} and orden = 1`))[0].c === 1111,
       'un costo que ya trae la línea no se pisa');

    //  Editar: se agrega un producto nuevo; las líneas que siguen conservan su costo.
    const pg = await como('gerencia');
    await pg.goto(`${BASE}/ventas/cotizaciones/${cotB}/editar`, { waitUntil: 'networkidle' });
    await pg.locator('input.form-buscador-input').fill('POTA');
    await pg.waitForTimeout(1500);
    const filas = () => pg.locator('table.datos tbody tr').count();
    const antes = await filas();
    const opciones = await pg.locator('.form-resultados button').count();
    for (let i = 0; i < opciones && (await filas()) === antes; i++) {
      await pg.locator('input.form-buscador-input').fill('POTA');
      await pg.waitForTimeout(800);
      await pg.locator('.form-resultados button').nth(i).click();
      await pg.waitForTimeout(1500);
    }
    ok((await filas()) === antes + 1, 'se agregó un producto nuevo a la cotización');
    await pg.locator('button', { hasText: 'Guardar cambios' }).click();
    await pg.waitForURL(new RegExp(`/ventas/cotizaciones/${cotB}$`), { timeout: 60000 });
    const lineasB = await consultar(`select sku_presentacion_id sp, costo_estimado_tm::float c from cotizacion_lineas where cotizacion_id = ${cotB} order by orden`);
    ok(lineasB.length === 3 && lineasB[0].c === 1111, 'al editar, la línea con el mismo producto conserva su costo (no se recalcula)', String(lineasB[0]?.c));
    const nueva = lineasB.find((l) => ![skus[0].id, skus[1].id].map(Number).includes(Number(l.sp)));
    ok(!!nueva && cerca(nueva.c, await vigente(nueva.sp)), 'la línea nueva toma el costo vigente de hoy', `${nueva?.c}`);
    ok(await pg.locator('[data-costo-estimado]').count() === 3, 'la ficha de la cotización muestra el costo estimado de cada línea');

    //  Convertir: el pedido hereda el de la cotización.
    await consultar(`update cotizaciones set estado = 'aprobada', aprobada_en = now(), aprobada_por = '${ger.id}' where id = ${cotB}`);
    await pg.goto(`${BASE}/ventas/cotizaciones/${cotB}`, { waitUntil: 'networkidle' });
    await pg.locator('button', { hasText: 'Convertir en pedido' }).click();
    await pg.waitForURL(/\/ventas\/pedidos\/\d+/, { timeout: 60000 });
    const pedidoB = Number(pg.url().match(/pedidos\/(\d+)/)[1]);
    pedidosExtra.push(pedidoB);
    const lp = await consultar(`select sku_presentacion_id sp, costo_estimado_tm::float c from pedido_lineas where pedido_id = ${pedidoB} order by orden`);
    const herencia = lp.every((l) => cerca(l.c, lineasB.find((x) => Number(x.sp) === Number(l.sp))?.c));
    ok(lp.length === 3 && herencia, 'al convertir, cada línea del pedido hereda el costo de la cotización', lp.map((l) => l.c).join(' · '));

    //  Comex no ve costos, pero su pedido directo igual lleva el costo vigente.
    const pgX = await como('comex');
    await pgX.goto(`${BASE}/ventas/pedidos/nuevo`, { waitUntil: 'networkidle' });
    await pgX.locator('small[data-tc="sunat"], small[data-tc="manual"]').first().waitFor({ timeout: 25000 });
    await pgX.locator('select.campo').first().selectOption(String(cli.id));
    await pgX.waitForTimeout(800);
    await pgX.locator('input.form-buscador-input').fill('POTA');
    await pgX.waitForTimeout(1500);
    await pgX.locator('.form-resultados button').first().click();
    await pgX.waitForTimeout(2000);
    await pgX.locator('button', { hasText: 'Registrar pedido' }).click();
    await pgX.waitForURL(/\/ventas\/pedidos\/\d+$/, { timeout: 60000 });
    const pedidoX = Number(pgX.url().match(/(\d+)$/)[1]);
    pedidosExtra.push(pedidoX);
    const [lx] = await consultar(`select sku_presentacion_id sp, costo_estimado_tm::float c from pedido_lineas where pedido_id = ${pedidoX}`);
    ok(cerca(lx.c, await vigente(lx.sp)) && lx.c > 0, 'el pedido directo de Comex también guarda el costo vigente', String(lx.c));
    ok(await pgX.locator('[data-costo-estimado]').count() === 0, 'y a Comex no se le muestra');

    //  La función del costo no está abierta a la API.
    const [g] = await consultar(`select has_function_privilege('authenticated', 'costo_estimado_tm_vigente(bigint)', 'execute') a,
                                        has_function_privilege('anon', 'costo_estimado_tm_vigente(bigint)', 'execute') b`);
    ok(!g.a && !g.b, 'nadie puede pedir el costo por la API: solo lo usan los disparadores');

    //  Un producto sin costo vigente: la línea queda sin costo y la ficha lo dice.
    const [sinCosto] = await consultar(`select sp.id from sku_presentaciones sp where costo_estimado_tm_vigente(sp.id) is null limit 1`);
    if (sinCosto) {
      await consultar(`insert into cotizacion_lineas (cotizacion_id, sku_presentacion_id, cantidad_tm, precio_lista_tm, precio_tm, descuento_pct, orden)
                       values (${cotId}, ${sinCosto.id}, 1, 100, 100, 0, 9)`);
      const [l] = await consultar(`select costo_estimado_tm c from cotizacion_lineas where cotizacion_id = ${cotId} and orden = 9`);
      ok(l.c === null, 'sin costo vigente, la línea de la cotización queda sin costo (NULL)');
      await pg.goto(`${BASE}/ventas/cotizaciones/${cotId}`, { waitUntil: 'networkidle' });
      ok(await pg.locator('[data-costo-estimado="sin-costo"]').count() === 1 && /Sin costo estimado/i.test(await pg.locator('main').innerText()),
         'y la ficha dice «Sin costo estimado»');
    } else {
      ok(true, 'todos los productos tienen costo vigente: no hay caso «sin costo» que mirar');
    }
  }
} catch (e) {
  console.log(' FALLA', e.message);
  fallos.push(e.message);
} finally {
  /* ---- Todo vuelve a como estaba ---- */
  if (pedidoNuevo) {
    await consultar(`delete from pedido_cuentas where pedido_id = ${pedidoNuevo};
                     delete from pedido_lineas where pedido_id = ${pedidoNuevo};
                     delete from eventos where entidad = 'pedidos' and entidad_id = ${pedidoNuevo};
                     delete from pedidos where id = ${pedidoNuevo};`).catch((e) => console.error('limpieza pedido', e.message));
  }
  if (pedidoPeso) {
    const v = (x) => (x == null ? 'null' : `'${String(x).replace(/'/g, "''")}'`);
    await consultar(`update pedidos set peso_neto_max_kg = ${v(pedidoPeso.peso_neto_max_kg)}, peso_bruto_max_kg = ${v(pedidoPeso.peso_bruto_max_kg)},
                       nota_restricciones = ${v(pedidoPeso.nota_restricciones)}, restricciones_por = ${v(pedidoPeso.rp)}, restricciones_en = ${v(pedidoPeso.re)}
                     where id = ${pedidoPeso.id};
                     delete from eventos where entidad = 'pedidos' and entidad_id = ${pedidoPeso.id} and ocurrido_en > '${inicio}';`);
  }
  for (const pid of pedidosExtra) {
    await consultar(`delete from pedido_cuentas where pedido_id = ${pid};
                     delete from pedido_lineas where pedido_id = ${pid};
                     delete from eventos where entidad = 'pedidos' and entidad_id = ${pid};
                     delete from pedidos where id = ${pid};
                     delete from auditoria where ocurrido_en > '${inicio}' and tabla in ('pedidos', 'pedido_lineas', 'pedido_cuentas')
                       and (registro_id::text = '${pid}' or coalesce(datos_despues, datos_antes)->>'pedido_id' = '${pid}');`).catch((e) => console.error('limpieza pedido', e.message));
  }
  if (cotB) {
    await consultar(`delete from cotizacion_cuentas where cotizacion_id = ${cotB};
                     delete from cotizacion_lineas where cotizacion_id = ${cotB};
                     delete from eventos where entidad = 'cotizaciones' and entidad_id = ${cotB};
                     delete from cotizaciones where id = ${cotB};
                     delete from auditoria where ocurrido_en > '${inicio}' and tabla in ('cotizaciones', 'cotizacion_lineas', 'cotizacion_cuentas')
                       and (registro_id::text = '${cotB}' or coalesce(datos_despues, datos_antes)->>'cotizacion_id' = '${cotB}');`).catch((e) => console.error('limpieza cotización B', e.message));
  }
  if (cotId) {
    await consultar(`delete from cotizacion_cuentas where cotizacion_id = ${cotId};
                     delete from cotizacion_lineas where cotizacion_id = ${cotId};
                     delete from eventos where entidad = 'cotizaciones' and entidad_id = ${cotId};
                     delete from cotizaciones where id = ${cotId};`).catch((e) => console.error('limpieza cotización', e.message));
  }
  const tocados = [
    cotId && `(tabla in ('cotizaciones', 'cotizacion_lineas', 'cotizacion_cuentas') and (registro_id::text = '${cotId}' or coalesce(datos_despues, datos_antes)->>'cotizacion_id' = '${cotId}'))`,
    pedidoNuevo && `(tabla in ('pedidos', 'pedido_lineas', 'pedido_cuentas') and (registro_id::text = '${pedidoNuevo}' or coalesce(datos_despues, datos_antes)->>'pedido_id' = '${pedidoNuevo}'))`,
    pedidoPeso && `(tabla = 'pedidos' and registro_id::text = '${pedidoPeso.id}')`,
  ].filter(Boolean);
  if (tocados.length) await consultar(`delete from auditoria where ocurrido_en > '${inicio}' and (${tocados.join(' or ')})`);
  await nav.close();
}

console.log(fallos.length ? `\n${fallos.length} FALLA(S):\n - ${fallos.join('\n - ')}` : '\nTodo en orden.');
process.exit(fallos.length ? 1 : 0);
