/**
 * ============================================================================
 *  PRUEBA DE NECESIDADES DE PRODUCCIÓN
 * ============================================================================
 *  Documento de mejoras, punto 5: lo que falta producir para completar los
 *  pedidos, considerando pedidos y stock disponible; el backorder es
 *  necesidad de producción.
 *
 *  Lo esencial: que sea UNA sola cifra. La de Producción, la de Control de
 *  pedidos y la de la vista vieja tienen que coincidir.
 *
 *  Un escenario libera un momento el dictamen de un pallet retenido y lo
 *  devuelve en el `finally`.
 *
 *      node scripts/probar-produccion.mjs
 * ============================================================================
 */
import { chromium } from 'playwright';
import { ejecutarSQL } from './db.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const consultar = async (sql) => {
  const r = await ejecutarSQL(sql);
  return Array.isArray(r) ? r : [];
};
const SEC = (n, t) => `\n${'─'.repeat(3)} ${n} · ${t} ${'─'.repeat(3)}`;
const fallos = [];
const ok = (cond, texto, detalle = '') => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${texto}${detalle ? ' · ' + detalle : ''}`);
  if (!cond) fallos.push(texto);
};
const numero = (t) => Number(String(t).replace(/[^\d.-]/g, ''));

let liberados = [];

const nav = await chromium.launch({ channel: 'chrome', headless: true });
const p = await (await nav.newContext({ viewport: { width: 1600, height: 1100 } })).newPage();

try {
  console.log(SEC(1, 'Una sola cifra de lo que falta'));
  {
    const [r] = await consultar(`
      select (select coalesce(sum(backorder_kg), 0) from v_pedido_linea_cobertura)        as backorder,
             (select coalesce(sum(producir_kg), 0) from v_produccion_necesidades)          as produccion,
             (select coalesce(sum(producir_kg), 0) from v_produccion_necesidad_linea)      as lineas,
             (select coalesce(sum(tm_faltantes), 0) * 1000 from v_necesidades)             as vieja`);
    ok(Math.abs(Number(r.backorder) - Number(r.produccion)) < 1,
       'por producir = backorder de Control de pedidos', `${(Number(r.produccion) / 1000).toFixed(1)} TM`);
    ok(Math.abs(Number(r.lineas) - Number(r.produccion)) < 1, 'el detalle por pedido suma lo mismo');
    ok(Math.abs(Number(r.vieja) - Number(r.produccion)) < 0.01,
       'y la vista vieja (Excel, pantalla antigua) da la misma cifra', `${(Number(r.vieja) / 1000).toFixed(1)} TM`);
  }

  console.log(SEC(2, 'Considera los pedidos y el stock'));
  {
    const [r] = await consultar(`
      select count(*) filter (where abs(pendiente_kg - (con_stock_kg + producir_kg)) > 0.01) as descuadre,
             count(*) filter (where producir_kg <= 0) as sin_falta,
             count(*) as n
        from v_produccion_necesidad_linea`);
    ok(Number(r.descuadre) === 0, 'por línea: falta entregar = lo que cubre el stock + lo que hay que producir', `${r.n} líneas`);
    ok(Number(r.sin_falta) === 0, 'solo aparecen las líneas a las que de verdad les falta');

    const [c] = await consultar(`
      select count(*) as n from v_produccion_necesidad_linea l join pedidos p on p.id = l.pedido_id
       where p.ciclo <> 'confirmado'`);
    ok(Number(c.n) === 0, 'solo pedidos confirmados: ni borradores ni cancelados piden producción');

    //  Lo ya despachado o reservado para el pedido no se vuelve a pedir.
    const [d] = await consultar(`
      select count(*) filter (where producir_kg > pedido_kg - despachado_kg - reservado_kg + 0.01) as de_mas
        from v_produccion_necesidad_linea`);
    ok(Number(d.de_mas) === 0, 'lo que ya salió o está reservado no se vuelve a producir');

    const [t] = await consultar(`
      select count(*) as mal from v_produccion_necesidades n
       where abs(n.retenido_kg - coalesce((select sum(bloqueado_kg) from v_stock_lote s
                                            where s.sku_presentacion_id = n.sku_presentacion_id), 0)) > 0.01`);
    ok(Number(t.mal) === 0, 'el retenido por Calidad es el stock bloqueado de ese mismo producto');
  }

  console.log(SEC(3, 'Escenario: Calidad libera un pallet de un producto que falta'));
  {
    /*
     * El pallet retenido no cuenta como disponible. Al liberarlo pasa a stock
     * libre, se reparte a los pedidos que lo esperan y lo que hay que producir
     * baja exactamente eso —o hasta cero, si sobra—.
     */
    const [caso] = await consultar(`
      select n.sku_presentacion_id, n.producir_kg, s.lote_id, s.bloqueado_kg
        from v_produccion_necesidades n
        join v_stock_lote s on s.sku_presentacion_id = n.sku_presentacion_id and s.bloqueado_kg > 0
        where s.reservado_kg = 0 and s.preparacion_kg = 0
       order by s.bloqueado_kg desc limit 1`);
    ok(Boolean(caso), 'hay un producto con backorder y un pallet suyo retenido');
    liberados = (await consultar(`
      update dictamenes_calidad set vigente = false
       where lote_id = ${caso.lote_id} and vigente and estado <> 'liberado' returning id`)).map((x) => x.id);
    const [tras] = await consultar(`
      select coalesce((select producir_kg from v_produccion_necesidades
                        where sku_presentacion_id = ${caso.sku_presentacion_id}), 0) as producir`);
    const esperado = Math.max(Number(caso.producir_kg) - Number(caso.bloqueado_kg), 0);
    ok(Math.abs(Number(tras.producir) - esperado) < 0.5,
       'lo que hay que producir baja lo que se liberó',
       `${(Number(caso.producir_kg) / 1000).toFixed(2)} → ${(Number(tras.producir) / 1000).toFixed(2)} TM (liberados ${(Number(caso.bloqueado_kg) / 1000).toFixed(2)})`);
    await consultar(`update dictamenes_calidad set vigente = true where id in (${liberados.join(',')})`);
    liberados = [];
    const [vuelta] = await consultar(`
      select producir_kg from v_produccion_necesidades where sku_presentacion_id = ${caso.sku_presentacion_id}`);
    ok(Math.abs(Number(vuelta.producir_kg) - Number(caso.producir_kg)) < 0.5, 'y al volver a retenerlo, vuelve a ser necesidad');
  }

  console.log(SEC(4, 'La pantalla'));
  {
    await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await p.fill('input[type="email"]', 'gerencia@santamonica.pe');
    await p.fill('input[type="password"]', 'SantaMonica2026');
    await p.click('button[type="submit"]');
    await p.waitForURL(/\/panel/, { timeout: 30000 });

    ok(await p.locator('aside a[href="/produccion"], nav a[href="/produccion"]').count() > 0,
       'Producción es un módulo propio en el menú');

    await p.goto(`${BASE}/ventas/necesidades`, { waitUntil: 'networkidle' });
    ok(/\/produccion$/.test(new URL(p.url()).pathname), 'la dirección vieja lleva a la nueva');
    await p.waitForTimeout(1500);

    const kpi = async (etiqueta) => {
      const k = p.locator('.kpi').filter({ has: p.locator('.kpi-etiqueta', { hasText: new RegExp(`^${etiqueta}$`, 'i') }) }).first();
      return numero(await k.locator('.kpi-valor').innerText());
    };
    const [t] = await consultar(`
      select round(sum(producir_kg) / 1000, 1) as tm, count(*) as productos from v_produccion_necesidades`);
    const porProducir = await kpi('Por producir');
    ok(Math.abs(porProducir - Number(t.tm)) < 0.05, 'tarjeta «Por producir»', `${t.tm} TM`);
    ok(await kpi('Productos') === Number(t.productos), 'tarjeta «Productos»', `${t.productos}`);

    //  La misma cifra en Control de pedidos.
    await p.goto(`${BASE}/ventas/control`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(2000);
    const backorder = await kpi('Backorder');
    ok(Math.abs(backorder - porProducir) < 0.05, 'y es la misma cifra que la tarjeta Backorder de Control de pedidos',
       `${backorder} = ${porProducir}`);

    //  Familia → productos → pedidos.
    await p.goto(`${BASE}/produccion`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1500);
    const primera = p.locator('table[data-cuadro="familias"] tbody tr').first();
    const familia = await primera.getAttribute('data-familia');
    await primera.locator('a').click();
    await p.waitForURL(/familia=/, { timeout: 30000 });
    await p.waitForTimeout(1500);
    const [nf] = await consultar(`select count(*) as n from v_produccion_necesidades where familia = '${familia.replace(/'/g, "''")}'`);
    ok(await p.locator('table[data-cuadro="productos"] tbody tr').count() === Number(nf.n),
       `pulsar una familia deja sus productos («${familia}»)`, `${nf.n}`);

    const fila = p.locator('table[data-cuadro="productos"] tbody tr').first();
    const sku = Number(await fila.getAttribute('data-sku'));
    await fila.locator('a').first().click();
    await p.waitForURL(/sku=/, { timeout: 30000 });
    await p.waitForTimeout(1500);
    const [nl] = await consultar(`select count(*) as n from v_produccion_necesidad_linea where sku_presentacion_id = ${sku}`);
    ok(await p.locator('table[data-cuadro="detalle"] tbody tr').count() === Number(nl.n),
       'pulsar un producto enseña los pedidos que lo esperan', `${nl.n}`);
    await p.locator('table[data-cuadro="detalle"] tbody tr a').first().click();
    const llego = await p.waitForURL(/\/ventas\/pedidos\/\d+/, { timeout: 30000 }).then(() => true, () => false);
    ok(llego, 'y cada pedido lleva a su ficha');
  }
} finally {
  if (liberados.length) await consultar(`update dictamenes_calidad set vigente = true where id in (${liberados.join(',')})`);
  await nav.close();
}

console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo correcto');
process.exit(fallos.length ? 1 : 0);
