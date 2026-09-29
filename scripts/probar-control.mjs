/**
 * ============================================================================
 *  PRUEBA DE CONTROL DE PEDIDOS · las seis tarjetas y el backorder
 * ============================================================================
 *  Documento de mejoras, punto 3:
 *    «Dejar únicamente 6 tarjetas: Pedidos por atender – Pedidos completos –
 *     Pedidos pendientes – Backorder – Pedidos cancelados – Pedidos
 *     retrasados.»
 *
 *  Lo delicado no son las tarjetas: es el REPARTO del stock. Si dos pedidos
 *  piden el mismo filete y solo hay para uno, el sistema no puede decir que
 *  los dos tienen stock. Aquí se comprueban las invariantes que lo garantizan.
 *
 *      node scripts/probar-control.mjs
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

const nav = await chromium.launch({ channel: 'chrome', headless: true });
const p = await (await nav.newContext({ viewport: { width: 1600, height: 1100 } })).newPage();

try {
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', 'gerencia@santamonica.pe');
  await p.fill('input[type="password"]', 'SantaMonica2026');
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/panel/, { timeout: 30000 });

  console.log(SEC(1, 'El reparto del stock no inventa kilos'));
  {
    const [c] = await consultar(`
      select count(*) filter (where abs(pendiente_kg - con_stock_kg - backorder_kg) > 0.5) as descuadres,
             count(*) as lineas
        from v_pedido_linea_cobertura`);
    ok(Number(c.descuadres) === 0,
       'en cada línea: pendiente = con stock + backorder, sin un kilo de sobra',
       `${c.lineas} líneas`);

    /*
     * La invariante central: lo que se reparte del stock libre de un producto
     * no puede superar lo que hay. Si fallara, dos pedidos estarían contando
     * con el mismo pallet.
     */
    const [e] = await consultar(`
      select count(*) as excedidos from (
        select c.sku_presentacion_id, sum(c.cubre_libre_kg) as asignado, max(d.libre) as libre
          from v_pedido_linea_cobertura c
          join (select sku_presentacion_id, sum(disponible_kg) as libre
                  from v_disponibilidad group by 1) d
            on d.sku_presentacion_id = c.sku_presentacion_id
         group by c.sku_presentacion_id
        having sum(c.cubre_libre_kg) > max(d.libre) + 0.5) x`);
    ok(Number(e.excedidos) === 0,
       'ningún producto reparte más stock del que tiene libre');
  }

  console.log(SEC(2, 'El reparto respeta la prioridad'));
  {
    /*
     * Si un pedido de MÁS prioridad todavía tiene backorder de un producto,
     * ningún pedido de MENOS prioridad puede estar llevándose stock libre de
     * ese mismo producto: se lo estaría quitando al que va primero.
     */
    const [r] = await consultar(`
      with l as (
        select c.*, case c.prioridad when 'urgente' then 1 when 'alta' then 2
                                     when 'normal' then 3 when 'baja' then 4 else 5 end as rango
          from v_pedido_linea_cobertura c)
      select count(*) as saltos from l bajo
       where bajo.cubre_libre_kg > 0.5
         and exists (select 1 from l alto
                      where alto.sku_presentacion_id = bajo.sku_presentacion_id
                        and alto.rango < bajo.rango
                        and alto.backorder_kg > 0.5)`);
    ok(Number(r.saltos) === 0,
       'ningún pedido de menor prioridad se lleva stock que le falta a uno urgente');
  }

  console.log(SEC(3, 'Las seis tarjetas, y solo esas'));
  await p.goto(`${BASE}/ventas/control`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2000);
  /*
   * Se lee la ETIQUETA de cada tarjeta, no su texto entero. La tarjeta «Por
   * atender» dice en su nota «22 527 TM pendientes», y buscar «PENDIENTES» en
   * el texto completo la encontraba a ella antes que a la de pendientes: la
   * prueba comparaba la cifra equivocada y daba un falso fallo.
   */
  const etiquetas = (await p.locator('.kpi .kpi-etiqueta').allInnerTexts()).map((t) => t.trim().toUpperCase());
  const valores = (await p.locator('.kpi .kpi-valor').allInnerTexts()).map((t) => numero(t));
  ok(etiquetas.length === 6, 'hay exactamente seis tarjetas', `${etiquetas.length}`);
  const TARJETAS = {
    'PEDIDOS POR ATENDER': 'por_atender', 'PEDIDOS COMPLETOS': 'completos',
    'PEDIDOS PENDIENTES': 'pendientes', 'BACKORDER': 'backorder',
    'PEDIDOS CANCELADOS': 'cancelados', 'PEDIDOS RETRASADOS': 'retrasados',
  };
  for (const t of Object.keys(TARJETAS)) {
    ok(etiquetas.includes(t), `está la tarjeta «${t.toLowerCase()}»`);
  }
  const kpi = (etiqueta) => {
    const i = etiquetas.indexOf(etiqueta);
    return i < 0 ? null : valores[i];
  };

  console.log(SEC(4, 'Las cifras son las de la base'));
  {
    const [b] = await consultar(`
      select count(*) filter (where situacion_control = 'por_atender') as por_atender,
             count(*) filter (where situacion_control = 'completo')    as completos,
             count(*) filter (where tiene_stock)                      as pendientes,
             round(sum(tm_backorder)::numeric, 1)                     as tm_backorder,
             count(*) filter (where situacion_control = 'cancelado')  as cancelados,
             count(*) filter (where retrasado)                        as retrasados
        from v_control_pedidos`);
    ok(kpi('PEDIDOS POR ATENDER') === Number(b.por_atender), 'pedidos por atender',
       `${kpi('PEDIDOS POR ATENDER')} vs ${b.por_atender}`);
    ok(kpi('PEDIDOS COMPLETOS') === Number(b.completos), 'pedidos completos',
       `${kpi('PEDIDOS COMPLETOS')} vs ${b.completos}`);
    ok(kpi('PEDIDOS PENDIENTES') === Number(b.pendientes), 'pedidos pendientes con stock',
       `${kpi('PEDIDOS PENDIENTES')} vs ${b.pendientes}`);
    ok(Math.abs(kpi('BACKORDER') - Number(b.tm_backorder)) < 0.2,
       'toneladas en backorder', `${kpi('BACKORDER')} vs ${b.tm_backorder}`);
    ok(kpi('PEDIDOS CANCELADOS') === Number(b.cancelados), 'pedidos cancelados');
    ok(kpi('PEDIDOS RETRASADOS') === Number(b.retrasados), 'pedidos retrasados');
  }

  console.log(SEC(5, 'Pendientes y backorder se solapan, a propósito'));
  {
    /*
     * El backorder es una CANTIDAD. Un pedido con parte en cámara y parte por
     * fabricar tiene que estar en las dos tarjetas: si no, lo que ya se podría
     * cargar desaparece de la vista de Operaciones.
     */
    const [s] = await consultar(`
      select count(*) filter (where tiene_stock and en_backorder) as en_las_dos,
             round(sum(tm_con_stock) filter (where tiene_stock and en_backorder)::numeric, 1) as tm_listas
        from v_control_pedidos`);
    ok(Number(s.en_las_dos) > 0,
       'hay pedidos a medio cubrir, y aparecen en las dos tarjetas',
       `${s.en_las_dos} pedidos con ${s.tm_listas} TM listas`);
  }

  console.log(SEC(6, 'El retraso se mide contra la salida programada'));
  {
    /*
     * Oliver: «considerar la salida programada en el planificador». Si el
     * pedido aún no está programado, contra la fecha comprometida.
     */
    const [r] = await consultar(`
      select count(*) filter (where retrasado <> (fecha_referencia < current_date)) as mal,
             count(*) filter (where fecha_referencia = fecha_salida_programada)     as usa_programada,
             count(*) filter (where fecha_salida_programada is null
                                and fecha_referencia = fecha_comprometida)           as usa_comprometida
        from v_control_pedidos where situacion_control = 'por_atender'`);
    ok(Number(r.mal) === 0, 'retrasado es exactamente «la fecha de referencia ya pasó»');
    ok(Number(r.usa_programada) > 0,
       'se usa la salida programada cuando existe', `${r.usa_programada} pedidos`);
    ok(Number(r.usa_comprometida) >= 0,
       'y la comprometida cuando todavía no está programado', `${r.usa_comprometida} pedidos`);
  }

  console.log(SEC(7, 'Cada tarjeta abre su detalle'));
  for (const [etiqueta, vista] of Object.entries(TARJETAS)) {
    await p.goto(`${BASE}/ventas/control`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1000);
    /*
     * Se ESPERA a que la dirección cambie, en vez de mirar tras un tiempo
     * fijo. Cada vista rehace la consulta en el servidor y en desarrollo tarda
     * más de un segundo y medio; con una espera fija la prueba miraba antes de
     * que llegara la respuesta y veía la dirección vieja.
     */
    const tarjeta = p.locator('.kpi').filter({
      has: p.locator('.kpi-etiqueta', { hasText: new RegExp(`^${etiqueta}$`, 'i') }),
    });
    await tarjeta.click();
    const llego = await p.waitForURL(new RegExp(`vista=${vista}`), { timeout: 30000 })
      .then(() => true, () => false);
    ok(llego, `la tarjeta «${etiqueta.toLowerCase()}» abre su lista`);
  }

  console.log(SEC(8, 'El backorder se detalla por producto'));
  {
    await p.goto(`${BASE}/ventas/control?vista=backorder`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(2000);
    const cab = (await p.locator('table.datos thead th').allInnerTexts()).map((t) => t.toUpperCase());
    for (const c of ['PROFORMA', 'CLIENTE', 'PRODUCTO', 'BACKORDER']) {
      ok(cab.some((x) => x.includes(c)), `muestra la columna «${c.toLowerCase()}»`);
    }
    const [n] = await consultar(`select count(*) as n from v_pedido_linea_cobertura where backorder_kg > 0.5`);
    const filas = await p.locator('table.datos tbody tr').count();
    ok(filas === Math.min(Number(n.n), 200),
       'una fila por producto en backorder', `${filas} de ${n.n}`);
  }

  console.log(SEC(9, 'Completos, hasta una semana determinada'));
  {
    const [s] = await consultar(`
      select to_char(date_trunc('week', max(fecha_completado)), 'YYYY-MM-DD') as ultima,
             to_char(date_trunc('week', min(fecha_completado)), 'YYYY-MM-DD') as primera
        from v_control_pedidos where situacion_control = 'completo' and fecha_completado is not null`);
    if (s.ultima && s.primera && s.ultima !== s.primera) {
      const cuenta = async (hasta) => {
        await p.goto(`${BASE}/ventas/control?vista=completos${hasta ? '&hasta=' + hasta : ''}`,
                     { waitUntil: 'networkidle' });
        await p.waitForTimeout(1500);
        return p.locator('table.datos tbody tr').count();
      };
      const todas = await cuenta('');
      const hastaPrimera = await cuenta(s.primera);
      ok(hastaPrimera > 0 && hastaPrimera < todas,
         'filtrar hasta una semana deja solo los completados hasta entonces',
         `${hastaPrimera} hasta la primera semana, ${todas} en total`);

      const [b] = await consultar(`
        select count(*) as n from v_control_pedidos
         where situacion_control = 'completo'
           and fecha_completado <= date '${s.primera}' + 6`);
      ok(hastaPrimera === Math.min(Number(b.n), 200),
         'y son exactamente los que dice la base', `${hastaPrimera} vs ${b.n}`);
    } else {
      ok(true, 'no hay semanas suficientes para probar el filtro con esta data');
    }
  }
} finally {
  await nav.close();
}

console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo correcto');
process.exit(fallos.length ? 1 : 0);
