/**
 * ============================================================================
 *  PRUEBA DE OBJETIVOS MENSUALES
 * ============================================================================
 *  Lo que pidió Oliver, punto por punto, y contra SU propio Excel:
 *    · cada ratio calculado da lo mismo que en «Objetivos_2026_2.xlsx» (y
 *      donde no, es porque el Excel tenía un error, que se señala);
 *    · metas mensuales y anuales, esperado y máximo, con semáforo;
 *    · lo del ERP sale del ERP;
 *    · solo Marco y Oliver: nadie más lo ve, ni por la pantalla ni por la
 *      API, y nadie puede darse el permiso ni cambiarse el rol;
 *    · se edita en la tabla, queda en el historial y se exporta a Excel con
 *      los filtros.
 *
 *  Se ejecuta con: node --experimental-strip-types scripts/probar-objetivos.mjs
 *  (importa el motor de cálculo, que está en TypeScript).
 * ============================================================================
 */
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import { createClient } from '@supabase/supabase-js';
import { ejecutarSQL } from './db.mjs';
import { armarTablero, evaluar } from '../src/lib/objetivos.ts';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const EXCEL = '../Objetivos_2026_2 (1).xlsx';
const consultar = async (sql) => { const r = await ejecutarSQL(sql); return Array.isArray(r) ? r : []; };
const falla = async (sql) => { try { await ejecutarSQL(sql); return null; } catch (e) { return String(e.message); } };
const SEC = (n, t) => `\n${'─'.repeat(3)} ${n} · ${t} ${'─'.repeat(3)}`;
const fallos = [];
const ok = (cond, texto, detalle = '') => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${texto}${detalle ? ' · ' + detalle : ''}`);
  if (!cond) fallos.push(texto);
};
const cerca = (a, b, tol = 0.01) => a !== null && b !== null && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

const [{ ahora: INICIO }] = await consultar(`select now() as ahora`);
const cliente = async (email) => {
  const cli = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await cli.auth.signInWithPassword({ email, password: 'SantaMonica2026' });
  if (error) throw error;
  return { cli, id: data.user.id };
};

async function limpiar() {
  await consultar(`delete from objetivos_valores where actualizado_en >= '${INICIO}' and observacion is distinct from 'Importado de Objetivos_2026_2.xlsx'`);
  await consultar(`delete from objetivos_metas where actualizado_en >= '${INICIO}'`);
  await consultar(`delete from objetivos_historial where registrado_en >= '${INICIO}'`);
}

const nav = await chromium.launch({ channel: 'chrome', headless: true });

try {
  /* ---------- Los datos de la base, como los usaría la pantalla ---------- */
  const indicadores = (await consultar(`select * from objetivos_indicadores where activo order by orden`))
    .map((i) => ({ ...i, factor: Number(i.factor), decimales: Number(i.decimales) }));
  const valores = (await consultar(`select indicador_id, mes, valor from objetivos_valores where anio = 2026`))
    .map((v) => ({ indicador_id: Number(v.indicador_id), mes: Number(v.mes), valor: Number(v.valor) }));
  const tablero = (metas = []) => armarTablero({ indicadores, valores, erp: [], metas, tipoCambio: 3.4, erpDesdeMes: 9 });
  const fila = (t, codigo) => t.find((x) => x.indicador.codigo === codigo);
  const mes = (t, codigo, m) => fila(t, codigo).meses[m - 1].valor;

  const libro = new ExcelJS.Workbook();
  await libro.xlsx.readFile(EXCEL);
  const hoja = libro.getWorksheet('ID 2026');
  const col = (m) => String.fromCharCode(67 + m); // 1 → D
  const excel = (filaExcel, m) => {
    let v = hoja.getCell(`${col(m)}${filaExcel}`).value;
    if (v && typeof v === 'object' && 'result' in v) v = v.result;
    return typeof v === 'number' ? v : null;
  };

  console.log(SEC(1, 'El cálculo da lo mismo que el Excel de Oliver'));
  {
    const t = tablero();
    //  [indicador, fila del Excel, factor para comparar (el Excel da % en tanto por uno)]
    const casos = [
      ['mp_total', 8, 1], ['pt_stm', 12, 1], ['pt_maq', 16, 1], ['part_planta', 27, 100], ['part_maquila', 28, 100],
      ['inv_total', 29, 1], ['tn_contenedor', 43, 1], ['estiba_terceros_tn', 46, 1], ['manipuleo_tn', 49, 1],
      ['estiba_propia_tn', 52, 1], ['recepcion_tn', 54, 1], ['costo_atender', 55, 1], ['manipulacion_total', 56, 1],
      ['alm_ext_tn', 61, 1], ['alm_ext_venta', 62, 1], ['alm_ext_prod', 63, 1], ['gas_tn', 72, 1],
      ['alimentacion_tn', 81, 1], ['transporte_tn', 83, 1], ['costo_viaje', 39, 1],
    ];
    let comparados = 0;
    for (const [codigo, filaExcel, k] of casos) {
      const malos = [];
      for (let m = 1; m <= 7; m++) {
        const e = excel(filaExcel, m);
        if (e === null) continue;
        comparados++;
        const v = mes(t, codigo, m);
        if (!cerca(v, e * k, 0.001)) malos.push(`${m}: ${v?.toFixed(3)} ≠ ${(e * k).toFixed(3)}`);
      }
      ok(malos.length === 0, `«${fila(t, codigo).indicador.nombre}» = fila ${filaExcel} del Excel, enero a julio`, malos.slice(0, 2).join(' | '));
    }
    ok(comparados > 100, 'se compararon valores de verdad', `${comparados} celdas`);

    /*
     * Donde NO coincide es porque el Excel mezclaba dos criterios: de enero a
     * mayo el «Movimiento entre almacenes» no sumaba el sobrecosto y en junio
     * y julio sí. Se tomó el de los meses recientes; la diferencia tiene que
     * ser exactamente el sobrecosto.
     */
    const dif = [];
    for (let m = 1; m <= 5; m++) {
      const d = mes(t, 'flete_total', m) - excel(34, m);
      dif.push(Math.abs(d - (excel(38, m) ?? 0)) < 0.01);
    }
    ok(dif.every(Boolean), 'enero–mayo: el total de fletes difiere del Excel exactamente en el sobrecosto que aquel olvidaba');
    ok(cerca(mes(t, 'flete_total', 6), excel(34, 6)) && cerca(mes(t, 'flete_total', 7), excel(34, 7)),
       'junio y julio, con el mismo criterio, coinciden');

    //  El total anual del Excel para «Manipuleo Alm. Externo» sumaba otras filas.
    const anual = fila(t, 'manipuleo_tn').anio.valor;
    const sumas = [96, 97].map(() => 0);
    for (let m = 1; m <= 12; m++) {
      sumas[0] += mes(t, 'costo_manipuleo', m) ?? 0;
      sumas[1] += mes(t, 'tn_movidas_ext', m) ?? 0;
    }
    ok(cerca(anual, sumas[0] / sumas[1]), 'el ratio del año es Σ costo ÷ Σ toneladas',
       `${anual.toFixed(2)} S/Tn (el Excel decía 7,31 por sumar las filas equivocadas)`);
  }

  console.log(SEC(2, 'El semáforo y las metas'));
  {
    ok(evaluar(190, 'menor', 200, 210) === 'cumple', 'costo bajo el esperado: cumple');
    ok(evaluar(205, 'menor', 200, 210) === 'alerta', 'costo entre esperado y máximo: alerta');
    ok(evaluar(215, 'menor', 200, 210) === 'no_cumple', 'costo sobre el máximo: no cumple');
    ok(evaluar(95, 'mayor', 100, 120) === 'no_cumple', 'volumen bajo el esperado: no cumple');
    ok(evaluar(110, 'mayor', 100, 120) === 'cumple', 'volumen sobre el esperado: cumple');
    ok(evaluar(125, 'mayor', 100, 120) === 'supera', 'volumen sobre el máximo: supera');
    ok(evaluar(125, 'informativo', 100, 120) === null, 'un indicador informativo no tiene semáforo');

    const id = (c) => indicadores.find((i) => i.codigo === c).id;
    const t = tablero([
      { indicador_id: id('tarifa_frescos'), mes: null, esperado: 185, maximo: 195 },
      { indicador_id: id('mp_pota'), mes: null, esperado: 50000, maximo: 60000 },
      { indicador_id: id('mp_total'), mes: null, esperado: 50000, maximo: 60000 },
      { indicador_id: id('tarifa_frescos'), mes: 1, esperado: 250, maximo: 260 },
    ]);
    const tf = fila(t, 'tarifa_frescos');
    ok(tf.meses[6].esperado === 185 && tf.meses[6].metaDelAnio, 'un ratio sin meta del mes usa la del año');
    ok(tf.meses[6].estado === 'alerta', 'julio: 190 USD/Tn entre 185 y 195 es alerta');
    ok(tf.meses[0].esperado === 250 && !tf.meses[0].metaDelAnio, 'la meta propia del mes manda sobre la del año');
    ok(fila(t, 'mp_pota').meses[6].esperado === null, 'lo que se suma NO reparte la meta anual en los meses');
    //  31 888 Tn de materia prima en el año, contra un esperado de 50 000.
    ok(fila(t, 'mp_total').anio.estado === 'no_cumple', 'pero el año sí se compara contra su meta anual', String(fila(t, 'mp_total').anio.estado));
  }

  console.log(SEC(3, 'Solo Marco y Oliver, en la base'));
  {
    const marco = await cliente('gerencia@santamonica.pe');
    const oliver = await cliente('operaciones@santamonica.pe');
    const comercial = await cliente('comercial@santamonica.pe');
    const consulta = await cliente('consulta@santamonica.pe');

    for (const [quien, c] of [['Marco', marco], ['Oliver', oliver]]) {
      const { data } = await c.cli.from('objetivos_indicadores').select('id');
      ok((data ?? []).length === indicadores.length, `${quien} ve los ${indicadores.length} indicadores`);
    }
    for (const [quien, c] of [['Comercial', comercial], ['Consulta', consulta]]) {
      const { data } = await c.cli.from('objetivos_valores').select('id');
      const erp = await c.cli.rpc('objetivos_erp', { p_anio: 2026 });
      ok((data ?? []).length === 0 && (erp.data ?? []).length === 0, `${quien} no ve nada, ni pidiéndolo a la API`);
      const w = await c.cli.from('objetivos_valores').insert({ indicador_id: indicadores[0].id, anio: 2030, mes: 1, valor: 1 });
      ok(Boolean(w.error), `${quien} no puede escribir`);
      const d = await c.cli.rpc('fijar_acceso_objetivos', { p_usuario: c.id, p_valor: true });
      ok(Boolean(d.error), `${quien} no puede darse el acceso`);
    }

    //  El agujero cerrado: nadie se cambia el rol a sí mismo.
    const r = await consulta.cli.from('usuarios').update({ rol: 'gerencia' }).eq('id', consulta.id).select('rol');
    const [rol] = await consultar(`select rol from usuarios where id = '${consulta.id}'`);
    ok(Boolean(r.error) && rol.rol === 'consulta', 'un usuario ya no puede cambiarse el rol a sí mismo', r.error?.message?.slice(0, 60));
    const r2 = await comercial.cli.from('usuarios').update({ aprueba_cotizaciones: true }).eq('id', comercial.id);
    ok(Boolean(r2.error), 'ni darse la facultad de aprobar cotizaciones');
    //  Y lo legítimo sigue funcionando: cambiar su propio nombre.
    const [antes] = await consultar(`select nombre from usuarios where id = '${consulta.id}'`);
    const r3 = await consulta.cli.from('usuarios').update({ nombre: antes.nombre + ' ' }).eq('id', consulta.id);
    await consultar(`update usuarios set nombre = '${antes.nombre.replace(/'/g, "''")}' where id = '${consulta.id}'`);
    ok(!r3.error, 'pero sí puede cambiar su propio nombre');

    const quitarse = await oliver.cli.rpc('fijar_acceso_objetivos', { p_usuario: oliver.id, p_valor: false });
    ok(Boolean(quitarse.error), 'nadie puede quitarse el acceso a sí mismo y dejar el módulo sin dueño');

    console.log(SEC(4, 'Lo que alimenta el ERP'));
    const { data: erp } = await oliver.cli.rpc('objetivos_erp', { p_anio: 2026 });
    const de = (f, m) => Number((erp ?? []).find((x) => x.fuente === f && Number(x.mes) === m)?.valor ?? NaN);
    const [ind] = await consultar(`
      select
        (select coalesce(sum(pkl.peso_neto_kg), 0) / 1000 from despachos d
           join packing_lists pk on pk.id = d.packing_list_id and pk.estado <> 'anulado'
           join packing_lineas pkl on pkl.packing_list_id = pk.id
          where (d.fecha_salida at time zone 'America/Lima')::date between '2026-08-01' and '2026-08-31') as tn,
        (select count(*) from despachos d join packing_lists pk on pk.id = d.packing_list_id and pk.estado <> 'anulado'
          where (d.fecha_salida at time zone 'America/Lima')::date between '2026-08-01' and '2026-08-31') as cont,
        (select coalesce(sum(m.peso_neto_kg), 0) / 1000 from movimientos m join lotes l on l.id = m.lote_id
           join sku_presentaciones sp on sp.id = l.sku_presentacion_id join skus s on s.id = sp.sku_id
           join especies e on e.id = s.especie_id
          where m.tipo = 'ingreso' and l.proceso = 'propia' and e.nombre = 'POTA'
            and (m.fecha at time zone 'America/Lima')::date between '2026-08-01' and '2026-08-31') as pota,
        (select coalesce(sum(k.entrada_kg - k.salida_kg), 0) / 1000 from v_kardex k join almacenes a on a.id = k.almacen_id
          where a.tipo = 'propio' and (k.fecha at time zone 'America/Lima')::date < '2026-08-01') as inv`);
    ok(cerca(de('tn_embarcadas', 8), Number(ind.tn), 1e-6), 'toneladas embarcadas de agosto', `${Number(ind.tn).toFixed(2)}`);
    ok(de('contenedores', 8) === Number(ind.cont), 'contenedores de agosto', `${ind.cont}`);
    ok(cerca(de('pt_propia_pota', 8), Number(ind.pota), 1e-6), 'PT propio de pota de agosto', `${Number(ind.pota).toFixed(2)}`);
    ok(cerca(de('inv_stm', 8), Number(ind.inv), 1e-6), 'inventario inicial STM al 1 de agosto', `${Number(ind.inv).toFixed(2)}`);
    const [{ n }] = await consultar(`select count(*) as n from objetivos_indicadores where tipo = 'erp'
      and fuente not in (${[...new Set((erp ?? []).map((x) => `'${x.fuente}'`))].join(',')})`);
    ok(Number(n) === 0, 'todo indicador del ERP tiene su fuente');
  }

  console.log(SEC(5, 'La pantalla, como Oliver'));
  {
    const ctx = await nav.newContext({ viewport: { width: 1700, height: 1100 }, acceptDownloads: true });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await p.fill('input[type="email"]', 'operaciones@santamonica.pe');
    await p.fill('input[type="password"]', 'SantaMonica2026');
    await p.click('button[type="submit"]');
    await p.waitForURL(/\/panel/, { timeout: 30000 });
    ok(await p.locator('nav.barra a[href="/objetivos"]').count() === 1, 'Objetivos está en su menú');

    await p.goto(`${BASE}/objetivos`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1200);
    ok(/anio=\d{4}/.test(p.url()), 'la dirección lleva siempre el año');
    ok(await p.locator('table[data-cuadro="objetivos"] tbody tr[data-codigo]').count() === indicadores.length,
       'la tabla trae todos los indicadores', `${indicadores.length}`);
    const julioMp = await p.locator('tr[data-codigo="mp_total"] td[data-mes="7"]').innerText();
    ok(/5,842\.21/.test(julioMp), 'con los valores del Excel (materia prima de julio: 5 842,21)', julioMp.trim());

    //  Escribir un valor: octubre, para no tocar el histórico.
    const celda = p.locator('tr[data-codigo="mp_pota"] td[data-mes="10"] input');
    await celda.fill('4321');
    await celda.press('Enter');
    await p.waitForTimeout(2500);
    const [v] = await consultar(`select valor from objetivos_valores o join objetivos_indicadores i on i.id = o.indicador_id
      where i.codigo = 'mp_pota' and o.anio = 2026 and o.mes = 10`);
    ok(v && Number(v.valor) === 4321, 'un valor escrito en la tabla se guarda');
    const [h] = await consultar(`select usuario_nombre, despues from objetivos_historial where registrado_en >= '${INICIO}' and que = 'valor' order by id desc limit 1`);
    ok(h && h.usuario_nombre === 'Oliver Tello' && Number(h.despues) === 4321, 'y queda en el historial con su nombre');

    //  Una meta: tarifa de frescos de julio (190) con esperado 185 y máximo 195.
    await p.goto(`${BASE}/objetivos?anio=2026&vista=metas&bloque=Maquila`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1200);
    const metas = p.locator('tr[data-codigo="tarifa_frescos"] td[data-mes="7"] input');
    await metas.nth(0).fill('185');
    await metas.nth(1).fill('195');
    await metas.nth(1).press('Enter');
    await p.waitForTimeout(2500);
    await p.goto(`${BASE}/objetivos?anio=2026&bloque=Maquila`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1200);
    const estado = await p.locator('tr[data-codigo="tarifa_frescos"] td[data-mes="7"]').getAttribute('data-estado');
    ok(estado === 'alerta', 'con la meta puesta, julio se pinta en alerta', String(estado));

    await p.goto(`${BASE}/objetivos?anio=2026&estado=alerta`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1200);
    const codigos = await p.locator('table[data-cuadro="objetivos"] tbody tr[data-codigo]').evaluateAll((trs) => trs.map((t) => t.getAttribute('data-codigo')));
    ok(codigos.length === 1 && codigos[0] === 'tarifa_frescos', 'el filtro «En alerta» trae justo ese indicador', codigos.join(','));

    //  La exportación, con esos mismos filtros.
    const [descarga] = await Promise.all([p.waitForEvent('download'), p.locator('a[data-accion="exportar"]').click()]);
    const ruta = await descarga.path();
    const x = new ExcelJS.Workbook();
    await x.xlsx.readFile(ruta);
    const h1 = x.worksheets[0];
    ok(x.worksheets.length === 2 && x.worksheets[1].name === 'Cómo se calcula', 'el Excel trae el tablero y la hoja de fórmulas');
    ok(h1.getCell('B7').value === 'Tarifa de maquila · frescos' && !h1.getCell('B8').value,
       'y exactamente lo filtrado: un indicador', String(h1.getCell('B7').value));
    const fondo = h1.getCell(7, 5 + 7).fill?.fgColor?.argb;
    ok(Number(h1.getCell(7, 5 + 7).value) === 190 && fondo === 'FFF7ECD9', 'julio con su valor y pintado de alerta', String(fondo));
    ok(/Estado: alerta/.test(String(h1.getCell('A4').value)), 'con los filtros escritos en la cabecera');

    const apiOtro = await (await nav.newContext()).request.get(`${BASE}/api/objetivos/excel?anio=2026`);
    ok(apiOtro.status() === 401, 'sin sesión, la descarga no se entrega', String(apiOtro.status()));
    await ctx.close();
  }

  console.log(SEC(6, 'Nadie más lo ve'));
  {
    const ctx = await nav.newContext({ viewport: { width: 1400, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await p.fill('input[type="email"]', 'comercial@santamonica.pe');
    await p.fill('input[type="password"]', 'SantaMonica2026');
    await p.click('button[type="submit"]');
    await p.waitForURL(/\/panel/, { timeout: 30000 });
    ok(await p.locator('nav.barra a[href="/objetivos"]').count() === 0, 'Comercial no tiene la entrada en el menú');
    await p.goto(`${BASE}/objetivos`, { waitUntil: 'networkidle' });
    ok(!new URL(p.url()).pathname.startsWith('/objetivos'), 'y escribiendo la dirección, se le redirige', new URL(p.url()).pathname);
    const r = await p.request.get(`${BASE}/api/objetivos/excel?anio=2026`);
    ok(r.status() === 403, 'ni puede descargar el Excel', String(r.status()));
    await ctx.close();
  }
} finally {
  await limpiar();
  await nav.close();
}

const [fin] = await consultar(`select count(*) as n from objetivos_valores where actualizado_en >= '${INICIO}' and observacion is distinct from 'Importado de Objetivos_2026_2.xlsx'`);
ok(Number(fin.n) === 0, 'la prueba no deja rastro');
console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo correcto');
process.exit(fallos.length ? 1 : 0);
