/**
 * ============================================================================
 *  PRUEBA DEL CIERRE SEMANAL DE PRODUCCIÓN
 * ============================================================================
 *  Contra el Excel de Marco (hoja «1. RESUMEN T») y contra las definiciones
 *  de Oliver, columna por columna. Más el ERP, los permisos, la pantalla y la
 *  exportación. Lo que se toca se devuelve al final.
 *
 *      node --experimental-strip-types scripts/probar-cierre.mjs
 * ============================================================================
 */
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import { createClient } from '@supabase/supabase-js';
import { ejecutarSQL } from './db.mjs';
import { calcularFila, gestionDelMes } from '../src/lib/cierre.ts';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const consultar = async (sql) => { const r = await ejecutarSQL(sql); return Array.isArray(r) ? r : []; };
const falla = async (sql) => { try { await ejecutarSQL(sql); return null; } catch (e) { return String(e.message); } };
const SEC = (n, t) => `\n${'─'.repeat(3)} ${n} · ${t} ${'─'.repeat(3)}`;
const fallos = [];
const ok = (cond, texto, detalle = '') => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${texto}${detalle ? ' · ' + detalle : ''}`);
  if (!cond) fallos.push(texto);
};
const cerca = (a, b, t = 0.0005) => a !== null && b !== null && Math.abs(a - b) <= t;

const [{ ahora: INICIO }] = await consultar(`select now() as ahora`);
const [potaPlanVentas] = await consultar(`
  select v.valor from cierre_valores v join cierre_categorias c on c.id = v.categoria_id
   where c.codigo = 'pota' and v.anio = 2026 and v.mes = 9 and v.campo = 'plan_ventas'`);
const nav = await chromium.launch({ channel: 'chrome', headless: true });

try {
  console.log(SEC(1, 'Las columnas, como las definió Oliver, con los números del Excel de Marco'));
  {
    const dias = { proyeccion: 20, mes: 26 };
    //  Hoja «1. RESUMEN T», fila POTA y fila MERLUZA, valores y resultados.
    const pota = calcularFila({ plan_mp: 750, real_mp: 535.6405, plan_prod: 568.2, real_prod: 371.793, stock_inicial: 715.441, plan_ventas: 700, ventas: 674.141 }, dias);
    ok(cerca(pota.cump_mp, 0.7141873) && cerca(pota.dif_mp, -214.3595), '3 y 4 · %Cump MP y Ped/Ent (pota: 71 %, −214)');
    ok(cerca(pota.cump_prod, 0.6543347), '7 · %Cump producción (pota: 65 %)');
    ok(cerca(pota.proy_prod, 483.3309) && cerca(pota.cump_proy_prod, 0.8506352), '11 y 12 · (prod ÷ 20) × 26 y su % (483 · 85 %)');
    ok(cerca(pota.proy_ventas, 876.3833) && cerca(pota.cump_ventas, 0.9630586), '13 y 14 · (ventas ÷ 20) × 26 y ventas ÷ plan (876 · 96 %)');
    const merluza = calcularFila({ plan_mp: 264, real_mp: 296.61, plan_prod: 100, real_prod: 106.467, stock_inicial: 95.079, plan_ventas: 110, ventas: 110.412 }, dias);
    ok(cerca(merluza.cump_mp, 1.1235227) && cerca(merluza.proy_prod, 138.4071) && cerca(merluza.cump_ventas, 1.0037455),
       'merluza: 112 % · 138 · 100 %, igual que el Excel');
    const sinPlan = calcularFila({ plan_mp: null, real_mp: 39.885, plan_prod: 10.8, real_prod: 4.3, stock_inicial: 56.25, plan_ventas: null, ventas: null }, dias);
    ok(sinPlan.cump_mp === null && sinPlan.cump_ventas === null, 'sin plan no hay porcentaje: queda vacío, no 0 % ni infinito');
    const g = gestionDelMes(2026, 9, '2026-09-29');
    ok(g.transcurridos === 24 && g.total === 26, '«Gestión al» 29/09: 24 de 26 días hábiles = 92 %, como el Excel');
    const [p] = await consultar(`select valor from parametros where clave = 'cierre_dias_proyeccion'`);
    const [m] = await consultar(`select valor from parametros where clave = 'cierre_dias_mes'`);
    ok(Number(p.valor) === 20 && Number(m.valor) === 26, 'el 20 y el 26, fijos y en Parámetros');
  }

  console.log(SEC(2, 'Lo que pone el ERP'));
  const marco = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  await marco.auth.signInWithPassword({ email: 'gerencia@santamonica.pe', password: 'SantaMonica2026' });
  {
    const { data: erp } = await marco.rpc('cierre_erp', { p_anio: 2026, p_mes: 9 });
    const pota = (erp ?? []).find((x) => x.especie === 'POTA');
    const [r] = await consultar(`
      select
        (select coalesce(sum(m.peso_neto_kg), 0) / 1000 from movimientos m join lotes l on l.id = m.lote_id
           join sku_presentaciones sp on sp.id = l.sku_presentacion_id join skus s on s.id = sp.sku_id
           join especies e on e.id = s.especie_id
          where m.tipo = 'ingreso' and e.nombre = 'POTA'
            and (m.fecha at time zone 'America/Lima')::date between '2026-09-01' and '2026-09-30') as prod,
        (select coalesce(sum(k.entrada_kg - k.salida_kg), 0) / 1000 from v_kardex k
          where k.especie = 'POTA' and (k.fecha at time zone 'America/Lima')::date < '2026-09-01') as stock,
        (select coalesce(sum(pkl.peso_neto_kg), 0) / 1000 from despachos d
           join packing_lists pk on pk.id = d.packing_list_id and pk.estado <> 'anulado'
           join packing_lineas pkl on pkl.packing_list_id = pk.id join lotes l on l.id = pkl.lote_id
           join sku_presentaciones sp on sp.id = l.sku_presentacion_id join skus s on s.id = sp.sku_id
           join especies e on e.id = s.especie_id
          where e.nombre = 'POTA' and (d.fecha_salida at time zone 'America/Lima')::date between '2026-09-01' and '2026-09-30') as ventas`);
    ok(cerca(Number(pota.prod_real), Number(r.prod), 0.001), '6 · producción real = ingresos del mes', `${Number(r.prod).toFixed(3)} TM`);
    ok(cerca(Number(pota.stock_inicial), Number(r.stock), 0.001), '8 · stock real = el del día 1', `${Number(r.stock).toFixed(3)} TM`);
    ok(cerca(Number(pota.ventas), Number(r.ventas), 0.001), '10 · ventas = despachado en el mes', `${Number(r.ventas).toFixed(3)} TM`);

    const e = await falla(`insert into cierre_valores (categoria_id, anio, mes, campo, valor)
      select id, 2030, 1, 'real_prod', 1 from cierre_categorias where codigo = 'pota'`);
    ok(/salen del ERP/.test(e ?? ''), 'la producción de pota no se puede teclear: la pone el ERP');
    const e2 = await falla(`begin; insert into cierre_valores (categoria_id, anio, mes, campo, valor)
      select id, 2030, 1, 'real_prod', 1 from cierre_categorias where codigo = 'harina_pota'; rollback;`);
    ok(e2 === null, 'la de las harinas sí, porque el ERP no las conoce');
  }

  console.log(SEC(3, 'Solo Marco y Oliver'));
  {
    const comercial = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    await comercial.auth.signInWithPassword({ email: 'comercial@santamonica.pe', password: 'SantaMonica2026' });
    const { data: v } = await comercial.from('cierre_valores').select('id');
    const { data: erp } = await comercial.rpc('cierre_erp', { p_anio: 2026, p_mes: 9 });
    ok((v ?? []).length === 0 && (erp ?? []).length === 0, 'Comercial no ve nada, ni pidiéndolo a la API');
    const { data: vm } = await marco.from('cierre_valores').select('id').eq('anio', 2026).eq('mes', 9);
    ok((vm ?? []).length === 16, 'Marco sí: los 16 datos de setiembre del Excel', `${(vm ?? []).length}`);
  }

  console.log(SEC(4, 'La pantalla, como Marco'));
  {
    const ctx = await nav.newContext({ viewport: { width: 1700, height: 1100 }, acceptDownloads: true });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await p.fill('input[type="email"]', 'gerencia@santamonica.pe');
    await p.fill('input[type="password"]', 'SantaMonica2026');
    await p.click('button[type="submit"]');
    await p.waitForURL(/\/panel/, { timeout: 30000 });
    await p.goto(`${BASE}/produccion/cierre?mes=2026-09`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1500);

    ok(await p.locator('nav.barra a[href="/produccion/cierre"][data-activa="si"]').count() === 1
       && await p.locator('nav.barra a[data-activa="si"]').count() === 1,
       'está en Producción, y solo se marca su entrada en el menú');
    const filas = await p.locator('table[data-cuadro="cierre"] tbody tr').evaluateAll((t) => t.map((x) => x.getAttribute('data-categoria')));
    ok(JSON.stringify(filas) === JSON.stringify(['pota', 'merluza', 'harina_pota', 'harina_pescado', 'total']),
       'las filas de la hoja de Marco: pota, merluza, las dos harinas y el total');
    const celda = (cat, col) => p.locator(`tr[data-categoria="${cat}"] td[data-col="${col}"]`);
    ok((await celda('pota', 'cump_mp').innerText()).trim() === '71%' && await celda('pota', 'cump_mp').getAttribute('data-rojo') === 'si',
       'pota: %Cump MP 71 %, en rojo por estar bajo el 90 %');
    ok((await celda('merluza', 'cump_mp').innerText()).trim() === '112%' && await celda('merluza', 'cump_mp').getAttribute('data-rojo') === null,
       'merluza: 112 %, sin rojo');
    ok((await celda('pota', 'dif_mp').innerText()).trim() === '(214)', 'Ped/Ent negativo entre paréntesis: (214)');
    //  Setiembre ya cerró (la prueba corre después): se gestionó entero.
    const hoyLima = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
    const esperado = hoyLima.slice(0, 7) > '2026-09' ? '100%' : null;
    if (esperado) ok((await p.locator('[data-gestion]').innerText()).includes(esperado), 'un mes cerrado: «Gestión al» 100 %');
    //  Y su «Actualizado al» es el último día del mes, sin correrse un día
    //  por el huso horario (pasaba: salía el 29).
    if (esperado) ok(/30 de setiembre de 2026/.test(await p.locator('[data-actualizado]').innerText()),
       'un mes cerrado: «Actualizado al» su último día, el 30');
    //  Y el mes en curso, como el Excel: días hábiles anteriores a ayer.
    await p.goto(`${BASE}/produccion/cierre`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1000);
    const ayer = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
    const ge = gestionDelMes(Number(ayer.slice(0, 4)), Number(ayer.slice(5, 7)), ayer);
    ok((await p.locator('[data-gestion]').innerText()).includes(`${Math.round((ge.transcurridos / ge.total) * 100)}%`),
       'el mes en curso: días hábiles transcurridos ÷ 26', `${ge.transcurridos} de ${ge.total}`);
    await p.goto(`${BASE}/produccion/cierre?mes=2026-09`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1000);

    //  Corregir el plan de ventas de pota: se guarda y queda en el historial.
    const input = p.locator('tr[data-categoria="pota"] input[data-campo="plan_ventas"]');
    await input.fill('720');
    await input.press('Enter');
    await p.waitForTimeout(2500);
    const [g] = await consultar(`select v.valor from cierre_valores v join cierre_categorias c on c.id = v.categoria_id
      where c.codigo = 'pota' and v.anio = 2026 and v.mes = 9 and v.campo = 'plan_ventas'`);
    const [h] = await consultar(`select usuario_nombre, antes, despues from cierre_historial where registrado_en >= '${INICIO}' order by id desc limit 1`);
    ok(Number(g.valor) === 720, 'Marco corrige el plan de ventas en la tabla y se guarda');
    ok(h && Number(h.antes) === 700 && Number(h.despues) === 720 && h.usuario_nombre === 'Marco A. León Linares',
       'y queda en el historial: antes, después y quién');

    const [descarga] = await Promise.all([p.waitForEvent('download'), p.locator('a[data-accion="exportar"]').click()]);
    const x = new ExcelJS.Workbook();
    await x.xlsx.readFile(await descarga.path());
    const hoja = x.getWorksheet('1. RESUMEN T');
    ok(Boolean(hoja), 'el Excel sale con la hoja «1. RESUMEN T»');
    ok(hoja.getCell('A8').value === 'POTA' && Number(hoja.getCell('B8').value) === 750 && Number(hoja.getCell('J8').value) === 720,
       'con los datos de la pantalla', `${hoja.getCell('A8').value} · ${hoja.getCell('B8').value} · ${hoja.getCell('J8').value}`);
    ok(hoja.getCell('D8').fill?.fgColor?.argb === 'FFF4C7C3', 'y el 71 % pintado de rojo');
    ok(/Total general/.test(String(hoja.getCell('A13').value)), 'con el total general');
    await ctx.close();

    const po = await (await nav.newContext()).newPage();
    await po.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await po.fill('input[type="email"]', 'comercial@santamonica.pe');
    await po.fill('input[type="password"]', 'SantaMonica2026');
    await po.click('button[type="submit"]');
    await po.waitForURL(/\/panel/, { timeout: 30000 });
    ok(await po.locator('nav.barra a[href="/produccion/cierre"]').count() === 0, 'Comercial no tiene la entrada');
    await po.goto(`${BASE}/produccion/cierre`, { waitUntil: 'networkidle' });
    ok(!new URL(po.url()).pathname.startsWith('/produccion/cierre'), 'ni entra escribiendo la dirección');
    const r = await po.request.get(`${BASE}/api/cierre/excel?mes=2026-09`);
    ok(r.status() === 403, 'ni descarga el Excel', String(r.status()));
  }
} finally {
  //  El plan de ventas vuelve a lo del Excel, y fuera el rastro de la prueba.
  if (potaPlanVentas) {
    await consultar(`update cierre_valores set valor = ${potaPlanVentas.valor}
      where campo = 'plan_ventas' and anio = 2026 and mes = 9
        and categoria_id = (select id from cierre_categorias where codigo = 'pota')`);
  }
  await consultar(`delete from cierre_historial where registrado_en >= '${INICIO}'`);
  await nav.close();
}

console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo correcto');
process.exit(fallos.length ? 1 : 0);
