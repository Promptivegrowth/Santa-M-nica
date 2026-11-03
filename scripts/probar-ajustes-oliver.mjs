/**
 * ============================================================================
 *  PRUEBA · AJUSTES DE OLIVER TRAS REVISAR LA DATA DE INICIO (migración 081)
 * ============================================================================
 *  En el navegador y comprobado en la base:
 *
 *    1. Plantilla de ingresos: «Tipo de congelamiento» al final (después de
 *       Observaciones), con lista Placas/Túnel, en las instrucciones; al
 *       importar, resuelve la presentación (misma en placas y túnel) y la
 *       revisión la muestra.
 *    2. Exalmar y Peruvian son de tránsito: sin capacidad, fuera de
 *       v_ocupabilidad y de «Ocupabilidad por almacén» del panel; el maestro
 *       lo dice.
 *    3. Orden de los almacenes: campo editable en el maestro; panel y
 *       desplegables en el orden C1, C2, C3, Freeko, Depsa, Perufrost, resto.
 *    4. Sin «Cliente anotado en la base anterior» en los lotes de la carga.
 *    5. Todo en dólares: clientes y listas en USD; cliente nuevo y cotización
 *       nueva en USD.
 *    6. Línea de crédito: vacía en todos; permiso personal «Línea de crédito»
 *       (solo Cathy Lee); campo apagado con su porqué; la base lo exige;
 *       el bloqueo sigue siendo de Gerencia y Operaciones.
 *
 *  La base es la de producción: la prueba crea SUS cosas (cliente «PRUEBA-AO»,
 *  pallets «PRB AO …» que no llegan a registrarse, una importación) y las
 *  borra en `finally`, con sus eventos, avisos y auditoría. El permiso que se
 *  presta un momento a comercial@ (para probar la pantalla con permiso) se
 *  devuelve en `finally`.
 *
 *      BASE_URL=http://localhost:3010 node scripts/probar-ajustes-oliver.mjs
 * ============================================================================
 */
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ejecutarSQL } from './db.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3010';
const CLAVE = process.env.CLAVE_DEMO ?? (() => {
  try { return (/^CLAVE_DEMO=(.*)$/m.exec(readFileSync('.env.local', 'utf8'))?.[1] ?? '').trim(); } catch { return ''; }
})();
const consultar = async (sql) => { const r = await ejecutarSQL(sql); return Array.isArray(r) ? r : []; };
const intentar = async (sql) => { try { await ejecutarSQL(sql); return null; } catch (e) { return String(e.message); } };
const SEC = (n, t) => `\n${'─'.repeat(3)} ${n} · ${t} ${'─'.repeat(3)}`;
const fallos = [];
const ok = (cond, texto, detalle = '') => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${texto}${detalle ? ' · ' + detalle : ''}`);
  if (!cond) fallos.push(texto);
};
const CARPETA = process.env.CAPTURAS ?? join(tmpdir(), 'probar-ajustes-oliver');
mkdirSync(CARPETA, { recursive: true });
const captura = async (p, nombre) => { if (process.env.CAPTURAS) await p.screenshot({ path: join(CARPETA, `${nombre}.png`), fullPage: true }); };

const [{ hoy }] = await consultar(`select (now() at time zone 'America/Lima')::date::text hoy`);
const enDias = (n) => { const d = new Date(`${hoy}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dma = (iso) => iso.split('-').reverse().join('/');
const SELLO = String(Date.now()).slice(-5);
const COD = (n) => `PRB AO ${SELLO} ${String(n).padStart(2, '0')}`;
const RAZON = `PRUEBA-AO ${SELLO} SAC`;

const ORDEN_ESPERADO = ['Santa Mónica · Cámara 01', 'Santa Mónica · Cámara 02', 'Santa Mónica · Cámara 03', 'Freeko', 'Depsa', 'Perufrost'];

/* ---- Lo que hay antes, para devolverlo todo ---- */
const [prev] = await consultar(`
  select (select coalesce(max(id),0) from eventos) ev, (select coalesce(max(id),0) from auditoria) au,
         (select coalesce(max(id),0) from alertas) al, (select coalesce(max(id),0) from importaciones_excel) imp,
         (select coalesce(max(id),0) from clientes) cli`);
const [comercial] = await consultar(`select id, fija_credito from usuarios where email = 'comercial@santamonica.pe'`);
const [cathy] = await consultar(`select id, fija_credito, rol::text from usuarios where lower(email) = 'clee@santamonicafishing.com'`);
const [gerente] = await consultar(`select id from usuarios where email = 'gerencia@santamonica.pe'`);
const [oper] = await consultar(`select id from usuarios where email = 'operaciones@santamonica.pe'`);
const como = (u, sql) => intentar(`begin; select set_config('request.jwt.claims', '{"sub":"${u}","role":"authenticated"}', true); set local role authenticated; ${sql}; rollback;`);

const nav = await chromium.launch({ channel: 'chrome', headless: true });
const errores = [];
async function sesion(correo) {
  const ctx = await nav.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errores.push(`${correo}: ${e.message}`));
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', `${correo}@santamonica.pe`);
  await p.fill('input[type="password"]', CLAVE);
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/panel/, { timeout: 60000 });
  return p;
}
/** Las opciones del primer desplegable de la página que ofrece la Cámara 01. */
const opcionesAlmacen = (p) => p.evaluate(() => {
  const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.text === 'Santa Mónica · Cámara 01'));
  return s ? [...s.options].map((o) => o.text).filter((t) => t && !/^(Todos|Elija|Sin )/.test(t)) : [];
});
const empiezaCon = (lista, prefijo) => prefijo.every((x, i) => lista[i] === x);

const mias = { imp: [], cli: [] };
let prestado = false;

try {
  const g = await sesion('gerencia');
  const c = await sesion('comercial');

  /* ======================================================================
     1 · PLANTILLA DE INGRESOS: TIPO DE CONGELAMIENTO
     ====================================================================== */
  console.log(SEC(1, 'Plantilla de ingresos: «Tipo de congelamiento» al final'));
  {
    await g.goto(`${BASE}/almacenes/ingresos/importar`, { waitUntil: 'networkidle' });
    const [descarga] = await Promise.all([g.waitForEvent('download', { timeout: 90000 }), g.click('[data-accion="descargar-plantilla"]')]);
    const ruta = join(CARPETA, `${SELLO}-${descarga.suggestedFilename()}`);
    await descarga.saveAs(ruta);
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.readFile(ruta);
    const hi = libro.getWorksheet('Ingresos');
    const enc = [];
    hi.getRow(4).eachCell({ includeEmpty: true }, (x) => enc.push(x.value === null ? '' : String(x.value)));
    ok(enc.length === 18 && enc[16] === 'Observaciones' && enc[17] === 'Tipo de congelamiento' && enc[0] === 'Origen *' && enc[3] === 'Producto *',
      'la columna «Tipo de congelamiento» va al final, después de Observaciones, sin mover las demás', enc.slice(14).join(' | '));
    const dv = hi.getCell(6, 18).dataValidation;
    const letra = /Listas!\$([A-Z])\$/.exec(dv?.formulae?.[0] ?? '')?.[1];
    const listas = libro.getWorksheet('Listas');
    const k = letra ? letra.charCodeAt(0) - 64 : 0;
    const valores = k ? [listas.getCell(2, k).value, listas.getCell(3, k).value, listas.getCell(4, k).value] : [];
    ok(dv?.type === 'list' && listas.getCell(1, k).value === 'Tipo de congelamiento' && valores[0] === 'Placas' && valores[1] === 'Túnel' && !valores[2],
      'tiene lista desplegable Placas / Túnel', JSON.stringify(valores));
    const inst = [];
    libro.getWorksheet('Instrucciones').eachRow((f) => inst.push(`${f.getCell(1).value ?? ''} ${f.getCell(2).value ?? ''}`));
    const texto = inst.join('\n');
    ok(/«Tipo de congelamiento» \(Placas o Túnel, con lista desplegable\), es opcional/.test(texto) && /^Tipo de congelamiento Opcional\. Placas o Túnel/m.test(texto),
      'las instrucciones la explican (paso y tabla de columnas)');
    const bodegas = [];
    libro.getWorksheet('Bodegas').eachRow((f, r) => { if (r > 2) bodegas.push(String(f.getCell(1).value)); });
    ok(empiezaCon(bodegas, ORDEN_ESPERADO), 'la hoja «Bodegas» sale en el orden del maestro', bodegas.slice(0, 7).join(', '));

    /* Importar: el mismo nombre de su base en placas y en túnel; con la columna, se resuelve. */
    const productos = await consultar(`
      select sp.id, s.codigo, p.descripcion pres, f.nombre formato, s.corte, p.peso_bulto_kg::float kg, p.congelamiento::text cong
        from sku_presentaciones sp join skus s on s.id = sp.sku_id join presentaciones p on p.id = sp.presentacion_id
        join formatos f on f.id = s.formato_id where sp.activo and s.activo`);
    const nombreBase = (p) => `${p.formato}-${p.corte} X ${Math.round(p.kg * 1000) / 1000} KG`;
    const grupos = new Map();
    for (const p of productos) {
      const kx = nombreBase(p).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s/g, '');
      grupos.set(kx, [...(grupos.get(kx) ?? []), p]);
    }
    const par = [...grupos.values()].find((x) => x.length === 2 && x[0].codigo === x[1].codigo && x[0].pres === x[1].pres && x[0].cong !== x[1].cong);
    const tunel = par.find((x) => x.cong === 'tunel');
    const fila = (n, cong) => ['Producción', dma(enDias(-1)), COD(n), nombreBase(tunel), 'Freeko', '', '', 10, 10 * tunel.kg, '', '', '', '', '', '', '', 'PRUEBA-AO', cong];
    hi.getRow(5).values = fila(1, 'Túnel');
    hi.getRow(6).values = fila(2, '');
    const subida = join(CARPETA, `ingresos-congelamiento-${SELLO}.xlsx`);
    await libro.xlsx.writeFile(subida);
    await g.goto(`${BASE}/almacenes/ingresos/importar`, { waitUntil: 'networkidle' });
    await g.setInputFiles('input[type="file"][name="archivo"]', subida);
    await g.click('[data-accion="subir-archivo"]');
    await g.waitForURL(/\/almacenes\/ingresos\/importar\/\d+/, { timeout: 90000 });
    await g.locator('[data-bloque="filas-importacion"]').waitFor();
    const imp = Number(g.url().match(/importar\/(\d+)/)[1]);
    mias.imp.push(imp);
    const filas = await consultar(`select fila, estado, datos->>'congelamiento' cong, errores::text e from importaciones_excel_filas where importacion_id = ${imp} order by fila`);
    ok(filas[0]?.estado === 'valida' && filas[0].cong === 'Túnel',
      `«${nombreBase(tunel)}» con «Túnel» en la columna nueva: la fila queda lista (elige la presentación en túnel)`, JSON.stringify(filas[0]));
    ok(filas[1]?.estado === 'con_error' && /elija Placas o Túnel en la columna «Tipo de congelamiento»/.test(filas[1].e),
      'sin congelamiento, el error propone las opciones y nombra la columna', (filas[1]?.e ?? '').slice(0, 200));
    //  La revisión abre en «Con error»: la fila lista está en «Todas».
    await g.locator('button:has-text("Todas"), a:has-text("Todas")').first().click();
    await g.locator('[data-campo="congelamiento"]').first().waitFor({ timeout: 15000 }).catch(() => {});
    const enPantalla = await g.locator('[data-campo="congelamiento"]').allInnerTexts();
    ok(enPantalla.some((t) => /Congelamiento: Túnel/.test(t)), 'la revisión muestra el congelamiento bajo el producto', enPantalla.join(' | '));
    await captura(g, '01-revision-congelamiento');
  }

  /* ======================================================================
     2 y 3 · ALMACENES: DE TRÁNSITO Y ORDEN
     ====================================================================== */
  console.log(SEC('2-3', 'Exalmar y Peruvian de tránsito; orden de los almacenes'));
  {
    const al = await consultar(`select codigo, nombre, es_transito t, capacidad_tm, orden from almacenes`);
    const de = Object.fromEntries(al.map((x) => [x.codigo, x]));
    ok(de.EXALMAR.t && de.PERUVIAN.t && de.EXALMAR.capacidad_tm === null && de.PERUVIAN.capacidad_tm === null && al.filter((x) => x.t).length === 2,
      'Exalmar y Peruvian (y nadie más) son de tránsito y no tienen capacidad');
    const e1 = await intentar(`begin; update almacenes set capacidad_tm = 100 where codigo = 'EXALMAR'; rollback;`);
    ok(/almacenes_transito_sin_capacidad/.test(e1 ?? ''), 'la base no deja ponerle capacidad a un almacén de tránsito');
    const ocu = await consultar(`select almacen from v_ocupabilidad order by orden, almacen`);
    ok(!ocu.some((x) => /Exalmar|Peruvian/.test(x.almacen)), 'v_ocupabilidad (panel y reporte) no los incluye', ocu.map((x) => x.almacen).join(', '));
    ok(empiezaCon(ocu.map((x) => x.almacen), ORDEN_ESPERADO), 'y sale en el orden C1, C2, C3, Freeko, Depsa, Perufrost, resto');

    await g.goto(`${BASE}/panel`, { waitUntil: 'networkidle' });
    const medidores = await g.locator('.panel-medidores .medidor-etiqueta').allInnerTexts();
    ok(medidores.length > 0 && !medidores.some((t) => /Exalmar|Peruvian/.test(t)), 'el panel: «Ocupabilidad por almacén» sin Exalmar ni Peruvian (ni como 0 %)', medidores.join(', '));
    ok(empiezaCon(medidores, ORDEN_ESPERADO), 'el panel: en el orden pedido', medidores.slice(0, 6).join(', '));
    await captura(g, '02-panel-ocupabilidad');

    await g.goto(`${BASE}/configuracion?t=maestros&m=almacenes`, { waitUntil: 'networkidle' });
    const filasM = await g.locator('[data-bloque="almacenes"] tbody tr[data-almacen]').evaluateAll((trs) => trs.map((t) => t.getAttribute('data-almacen')));
    ok(filasM.slice(0, 6).join(',') === 'STM-C1,STM-C2,STM-C3,FREEKO,DEPSA,PERUFR', 'el maestro de Almacenes lista por su orden', filasM.join(','));
    const capEx = await g.locator('tr[data-almacen="EXALMAR"] [data-campo="capacidad"]').innerText();
    ok(/De tránsito/i.test(capEx), 'el maestro dice «De tránsito» en la capacidad de Exalmar', capEx);
    await g.locator('tr[data-almacen="PERUVIAN"] [data-accion="editar-almacen"]').click();
    const form = g.locator('[data-bloque="formulario-almacen"]');
    ok(await form.locator('input[name="es_transito"]').isChecked() && await form.locator('input[name="capacidad_tm"]').isDisabled()
      && await form.locator('input[name="orden"]').inputValue() === '100',
      'al editar: «De tránsito» marcado, la capacidad apagada y el campo «Orden en las listas»');
    await captura(g, '03-maestro-almacenes');
    await form.locator('button:has-text("Cancelar")').click();

    /* Desplegables de almacenes en otras pantallas. */
    await g.goto(`${BASE}/almacenes/existencias`, { waitUntil: 'networkidle' });
    const ex = await opcionesAlmacen(g);
    ok(empiezaCon(ex, ORDEN_ESPERADO), 'Existencias: el filtro de almacén en ese orden', ex.slice(0, 7).join(', '));
    await g.goto(`${BASE}/almacenes/traslados/nuevo`, { waitUntil: 'networkidle' });
    const tr = await opcionesAlmacen(g);
    ok(empiezaCon(tr, ORDEN_ESPERADO), 'Nuevo traslado: el desplegable de almacén en ese orden', tr.slice(0, 7).join(', '));
    await g.goto(`${BASE}/almacenes/ingresos/nuevo`, { waitUntil: 'networkidle' });
    const ing = await g.locator('select[name="almacen_id"] option').allInnerTexts();
    ok(empiezaCon(ing.filter((t) => !/^Elija/.test(t)), ORDEN_ESPERADO.slice(0, 4)), 'Registrar ingreso: bodegas de producción en ese orden', ing.join(', '));
  }

  /* ======================================================================
     4 · EL CLIENTE ANOTADO EN LOS SALDOS
     ====================================================================== */
  console.log(SEC(4, 'Sin el cliente anotado en los lotes de la carga inicial'));
  {
    const [r] = await consultar(`select count(*) filter (where observaciones like '%Cliente anotado%')::int con,
                                        count(*) filter (where observaciones like 'Inventario inicial desde DATA 2025%')::int carga,
                                        count(*) filter (where observaciones like '%Motivo de ingreso en la base anterior:%')::int motivo
                                   from lotes`);
    ok(r.con === 0, 'ningún lote conserva «Cliente anotado en la base anterior»', `${r.carga} lotes de la carga`);
    ok(r.motivo === r.carga, 'el resto del texto de los lotes sigue (motivo de ingreso en todos)', `${r.motivo} de ${r.carga}`);
    const [l] = await consultar(`select id, observaciones from lotes where observaciones like '%(fila 16870)%' limit 1`);
    if (l) {
      await g.goto(`${BASE}/almacenes/lotes/${l.id}`, { waitUntil: 'networkidle' });
      const txt = await g.locator('main').innerText();
      ok(/Motivo de ingreso en la base anterior: PRIMER PROCESO/.test(txt) && !/KULALIA/.test(txt), 'la ficha de un lote que lo tenía (Kulalia) ya no lo menciona');
    }
  }

  /* ======================================================================
     5 · TODO EN DÓLARES
     ====================================================================== */
  console.log(SEC(5, 'Todo en dólares'));
  {
    const [m] = await consultar(`select (select count(*) from clientes where moneda <> 'USD')::int cli, (select count(*) from listas_precio where moneda <> 'USD')::int lis,
                                        (select valor from parametros where clave = 'moneda_defecto') def,
                                        (select column_default from information_schema.columns where table_name = 'clientes' and column_name = 'moneda') dcli`);
    ok(m.cli === 0 && m.lis === 0 && m.def === 'USD' && /USD/.test(m.dcli), 'todos los clientes y listas de precio en USD; moneda por defecto USD');
    const [bf] = await consultar(`select id, moneda::text, pais from clientes where razon_social ilike 'BUENO FOOD%' limit 1`);
    ok(!bf || bf.moneda === 'USD', 'BUENO FOOD CORPORATION LIMITED está en USD');

    await c.goto(`${BASE}/ventas/clientes/nuevo`, { waitUntil: 'networkidle' });
    const monedaNuevo = await c.locator('label:has(span:text-is("Moneda")) select').inputValue();
    ok(monedaNuevo === 'USD', 'cliente nuevo: la moneda propuesta es USD aunque el país sea Perú', monedaNuevo);

    const [peru] = await consultar(`select id from clientes where activo and not bloqueado and pais = 'Perú' order by id limit 1`);
    if (peru) {
      await c.goto(`${BASE}/ventas/cotizaciones/nueva?cliente=${peru.id}`, { waitUntil: 'networkidle' });
      const mon = await c.locator('label:has(span:text-is("Moneda")) select').inputValue();
      const inc = await c.locator('label:has(span:text-is("Incoterm")) select').inputValue().catch(() => '');
      ok(mon === 'USD' && inc === 'EXW', 'cotización nueva para un cliente peruano: USD (e incoterm EXW por ser nacional)', `${mon} · ${inc}`);
    }
  }

  /* ======================================================================
     6 · LÍNEA DE CRÉDITO
     ====================================================================== */
  console.log(SEC(6, 'Línea de crédito: sin definir y solo con el permiso'));
  {
    const [r] = await consultar(`select (select count(*) from clientes where linea_credito is not null)::int con,
                                        (select string_agg(email, ',') from usuarios where fija_credito) quien`);
    ok(r.con === 0, 'ningún cliente tiene línea de crédito (todas «sin definir»)');
    ok(r.quien === 'clee@santamonicafishing.com', 'el permiso «Línea de crédito» lo tiene solo Cathy Lee', r.quien);

    /* La base. */
    const [cli0] = await consultar(`select id from clientes where activo order by id limit 1`);
    const eCom = await como(comercial.id, `update clientes set linea_credito = 1000 where id = ${cli0.id}`);
    const eGer = await como(gerente.id, `update clientes set linea_credito = 1000 where id = ${cli0.id}`);
    const eCat = await como(cathy.id, `update clientes set linea_credito = 1000 where id = ${cli0.id}`);
    const eCatBloq = await como(cathy.id, `update clientes set bloqueado = true, motivo_bloqueo = 'x' where id = ${cli0.id}`);
    const eOpBloq = await como(oper.id, `update clientes set bloqueado = true, motivo_bloqueo = 'x' where id = ${cli0.id}`);
    ok(/permiso «Línea de crédito»/.test(eCom ?? '') && /permiso «Línea de crédito»/.test(eGer ?? ''),
      'la base: sin el permiso no se cambia la línea (ni Comercial ni Gerencia)', (eCom ?? '').slice(0, 120));
    ok(eCat === null, 'la base: Cathy Lee (con el permiso) sí la cambia', eCat ?? '');
    ok(/Gerencia u Operaciones/.test(eCatBloq ?? '') && eOpBloq === null, 'la base: bloquear sigue siendo de Gerencia y Operaciones (Cathy no; Operaciones sí)');
    const ePerm = await como(oper.id, `update usuarios set fija_credito = true where id = '${oper.id}'`);
    ok(/Solo Gerencia/.test(ePerm ?? ''), 'la base: el permiso solo lo da Gerencia', (ePerm ?? '').slice(0, 100));
    const eIns = await como(comercial.id, `insert into clientes (codigo, razon_social, pais, linea_credito) values ('PRB-${SELLO}', '${RAZON}', 'Perú', 5000)`);
    ok(/permiso «Línea de crédito»/.test(eIns ?? ''), 'la base: un cliente nuevo nace con la línea sin definir (salvo quien tiene el permiso)');

    /* La pantalla, sin el permiso (comercial@). */
    await c.goto(`${BASE}/ventas/clientes/nuevo`, { waitUntil: 'networkidle' });
    const campo = c.locator('input[name="linea_credito"]');
    const aviso = await c.locator('[data-aviso="linea-credito"]').innerText();
    ok(await campo.isDisabled() && await campo.inputValue() === '' && /^La línea de crédito la fija quien tiene el permiso «Línea de crédito»/.test(aviso),
      'Comercial sin el permiso: el campo se ve apagado, vacío («Sin definir») y dice quién la fija', aviso);
    ok(await c.locator('input[name="bloqueado"]').isDisabled(), 'y el bloqueo, apagado (es de Gerencia u Operaciones)');
    await c.locator('label:has-text("Razón social") input').fill(RAZON);
    await c.locator('label:has-text("País") input').fill('Perú');
    await captura(c, '04-cliente-nuevo-sin-permiso');
    await c.click('button[type="submit"]');
    await c.waitForURL(/\/ventas\/clientes\/\d+$/, { timeout: 60000 });
    const nuevoId = Number(c.url().match(/clientes\/(\d+)$/)[1]);
    mias.cli.push(nuevoId);
    const [nc] = await consultar(`select moneda::text, linea_credito from clientes where id = ${nuevoId}`);
    ok(nc.moneda === 'USD' && nc.linea_credito === null, 'el cliente nuevo queda en USD y con la línea sin definir', JSON.stringify(nc));
    const ficha = await c.locator('[data-campo="linea-credito"]').innerText();
    ok(/Sin definir/.test(ficha), 'la ficha dice «Sin definir» y no enseña alertas ni bloqueo por crédito', ficha.replace(/\s+/g, ' '));
    const avisosCredito = await consultar(`select count(*)::int n from alertas where id > ${prev.al} and entidad in ('cliente','clientes') and entidad_id = ${nuevoId}`);
    ok(avisosCredito[0].n === 0, 'sin línea no se genera ningún aviso');

    /* La pantalla, con el permiso (se le presta a comercial@ un momento). */
    await ejecutarSQL(`update usuarios set fija_credito = true where id = '${comercial.id}'`);
    prestado = true;
    await c.goto(`${BASE}/ventas/clientes/${nuevoId}/editar`, { waitUntil: 'networkidle' });
    ok(!(await c.locator('input[name="linea_credito"]').isDisabled()), 'con el permiso, el campo se enciende');
    ok(await c.locator('input[name="bloqueado"]').isDisabled(), 'pero el bloqueo sigue apagado para Comercial');
    await c.locator('input[name="linea_credito"]').fill('50000');
    await c.click('button[type="submit"]');
    await c.waitForURL(/\/ventas\/clientes\/\d+$/, { timeout: 60000 });
    const [lc] = await consultar(`select linea_credito::float l from clientes where id = ${nuevoId}`);
    ok(lc.l === 50000, 'y guarda la línea (50 000)', JSON.stringify(lc));
    const [ev] = await consultar(`select descripcion from eventos where entidad = 'clientes' and entidad_id = ${nuevoId} and tipo = 'cliente_modificado' order by id desc limit 1`);
    ok(/línea de crédito: sin definir → 50000/.test(ev?.descripcion ?? ''), 'el historial cuenta el cambio («sin definir → 50000»)', ev?.descripcion);
    await ejecutarSQL(`update usuarios set fija_credito = false where id = '${comercial.id}'`);
    prestado = false;

    /* Gerencia, sin el permiso: tampoco cambia la línea, pero sí bloquea. */
    await g.goto(`${BASE}/ventas/clientes/${nuevoId}/editar`, { waitUntil: 'networkidle' });
    ok(await g.locator('input[name="linea_credito"]').isDisabled() && !(await g.locator('input[name="bloqueado"]').isDisabled()),
      'Gerencia (sin el permiso): la línea apagada, el bloqueo encendido');

    /* Configuración › Usuarios y roles. */
    await g.goto(`${BASE}/configuracion?t=usuarios`, { waitUntil: 'networkidle' });
    const cab = await g.locator('table.datos thead').first().innerText();
    const marcadas = await g.locator('input[data-credito]:checked').evaluateAll((xs) => xs.map((x) => x.getAttribute('data-credito')));
    ok(/Línea de crédito/i.test(cab) && marcadas.length === 1 && marcadas[0] === cathy.id,
      'Usuarios y roles: columna «Línea de crédito» con el interruptor; marcada solo Cathy Lee', `${marcadas.length} marcadas · ${marcadas[0]} · ${cab.replace(/\s+/g, ' ').slice(0, 160)}`);
    await captura(g, '05-usuarios-linea-credito');
    await c.goto(`${BASE}/configuracion?t=usuarios`, { waitUntil: 'networkidle' });
    ok(await c.locator('input[data-credito]').count() === 0, 'los demás roles no ven el interruptor (solo el valor)');
  }
} finally {
  await limpiar();
  await nav.close();
}

if (errores.length) console.log(`\nErrores de página:\n - ${errores.join('\n - ')}`);
console.log(fallos.length ? `\n${fallos.length} FALLO(S):\n - ${fallos.join('\n - ')}` : '\nTodo correcto');
process.exit(fallos.length ? 1 : 0);

/* ==========================================================================
   LIMPIEZA: solo lo que creó esta prueba
   ========================================================================== */
async function limpiar() {
  try {
    if (prestado || comercial.fija_credito === false) await ejecutarSQL(`update usuarios set fija_credito = false where id = '${comercial.id}' and fija_credito`);
    const misCli = (await consultar(`select id from clientes where id > ${prev.cli} and razon_social = '${RAZON}'`)).map((x) => x.id);
    const misImp = (await consultar(`select id from importaciones_excel where id > ${prev.imp}`)).map((x) => x.id).filter((id) => mias.imp.includes(id));
    const arr = (xs) => `array[${xs.join(',') || 0}]::bigint[]`;
    const lista = (xs) => xs.map((x) => `'${x}'`).join(',') || "''";
    console.log(`\n  limpieza: ${misCli.length} cliente(s), ${misImp.length} importación(es)`);
    await ejecutarSQL(`
      ${misImp.length ? `delete from importaciones_excel where id in (${misImp});` : ''}
      ${misCli.length ? `delete from contactos where cliente_id in (${misCli}); delete from clientes where id in (${misCli});` : ''}
      delete from eventos where id > ${prev.ev} and (
        (entidad = 'clientes' and entidad_id = any(${arr(misCli)}))
        or (entidad in ('importacion','importaciones_excel') and entidad_id = any(${arr(misImp)})));
      delete from alertas where id > ${prev.al} and (
        (entidad = 'importacion' and entidad_id = any(${arr(misImp)}))
        or (entidad in ('cliente','clientes') and entidad_id = any(${arr(misCli)})));
      delete from auditoria where id > ${prev.au} and (
        (tabla = 'clientes' and registro_id = any(array[${lista(misCli)}]))
        or (tabla = 'importaciones_excel' and registro_id = any(array[${lista(misImp)}]))
        or (tabla = 'usuarios' and registro_id = '${comercial.id}' and campos_cambiados::text like '%fija_credito%'));
    `);
    const [{ n }] = await consultar(`select count(*)::int n from clientes where razon_social = '${RAZON}'`);
    const [{ q }] = await consultar(`select string_agg(email, ',') q from usuarios where fija_credito`);
    ok(n === 0 && q === 'clee@santamonicafishing.com', 'limpieza: cliente e importación de la prueba borrados; el permiso, otra vez solo de Cathy Lee');
  } catch (e) {
    ok(false, 'limpieza', String(e.message).slice(0, 300));
  }
}
