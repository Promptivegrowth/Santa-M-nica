/**
 * ============================================================================
 *  PRUEBA · PLANTILLAS E IMPORTADORES PARA LA DATA DE INICIO (migración 079)
 * ============================================================================
 *  Lo que pidió Operaciones al entregar «DATA 2025.xlsx», probado en el
 *  navegador y comprobado en la base:
 *
 *    1. Almacenes: Exalmar y Peruvian dados de alta (externos, reciben
 *       compras); Elamar y Perufrost ya no reciben compras; la producción
 *       entra por Santa Mónica (C1, C2, C3), Freeko y Hayduk.
 *    2. Plantilla de ingresos: el orden exacto de columnas que dejó Oliver,
 *       todas las listas desplegables, la fila de ejemplo y las instrucciones
 *       en ese orden; la hoja Productos con «Formato» y «Nombre en su base».
 *    3. Importar ingresos con el nombre de su base («FILETE-"B" 0-500 X 20
 *       KG»): se resuelve por clasificación-corte + peso del bulto; si quedan
 *       varias presentaciones, el error las propone. Un archivo con el orden
 *       antiguo de columnas se lee igual.
 *    4. Plantilla de traslados: «Fecha de traslado *» y «N.º de guía».
 *    5. Traslados importados = ya hechos: Almacén los deja «Lista para
 *       validar» (aviso a Gerencia y Operaciones); al «Validar y registrar»
 *       cada traslado entra autorizado, despachado y recibido en una sola
 *       operación, con su guía y su fecha, moviendo el stock. Si los sube
 *       Gerencia, se registran directo. Validaciones por fila (bloqueado,
 *       otra bodega, fecha futura, sin fecha, antes de producirse, repetido).
 *
 *  La base es la de producción y ya tiene el stock real: la prueba crea SUS
 *  pallets (código «PRB PD …», observaciones «PRUEBA-PD») importándolos, y
 *  traslada solo esos. Todo lo creado se borra en `finally` (Kardex con su
 *  disparador apagado un instante, existencias, dictámenes, traslados,
 *  importaciones, avisos, eventos y auditoría de lo creado).
 *
 *      BASE_URL=http://localhost:3010 node scripts/probar-plantillas-data.mjs
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
const CARPETA = process.env.CAPTURAS ?? join(tmpdir(), 'probar-plantillas-data');
mkdirSync(CARPETA, { recursive: true });
const captura = async (p, nombre) => { if (process.env.CAPTURAS) await p.screenshot({ path: join(CARPETA, `${nombre}.png`), fullPage: true }); };

const [{ hoy }] = await consultar(`select (now() at time zone 'America/Lima')::date::text hoy`);
const enDias = (n) => { const d = new Date(`${hoy}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dma = (iso) => iso.split('-').reverse().join('/');
const SELLO = String(Date.now()).slice(-5);
const COD = (n) => `PRB PD ${SELLO} ${String(n).padStart(2, '0')}`;
const ANIO = Number(hoy.slice(0, 4));

/* 087 · El orden de la hoja GENERAL de Dany (Almacén), con sus títulos. Reemplaza al que dejó
   Oliver en la 079/081: esos títulos siguen aceptándose como alias (lo prueba la sección 3). */
const ORDEN_OLIVER = ['FECHA DE PRODUCCIÓN *', 'N°PALLET *', 'CODIGO', 'OPERACIÓN INGRESO *', 'PRESENTACION', 'TIPO DE CONGELAMIENTO',
  'PESO BULTO', 'TOTAL *', 'PESO NETO *', 'ALMACEN *', 'CAMARA DE ALMACENAMIENTO', 'TURNO', 'LINEA PROCESADORA', 'MOTIVO INGRESO',
  'PLANTA', 'PROVEEDOR (si es compra)', 'COSTO POR KG (US$)', 'LLEGA EL (si es programado)', 'OBSERVACIONES'];

/* ---- Lo que hay antes, para devolverlo todo ---- */
const [prev] = await consultar(`
  select (select coalesce(max(id),0) from movimientos) mov, (select coalesce(max(id),0) from eventos) ev,
         (select coalesce(max(id),0) from auditoria) au, (select coalesce(max(id),0) from alertas) al,
         (select coalesce(max(id),0) from traslados) tr, (select coalesce(max(id),0) from lotes) lot,
         (select coalesce(max(id),0) from importaciones_excel) imp, (select coalesce(max(id),0) from dictamenes_calidad) dic,
         (select ultimo from correlativos where serie = 'TRAS' and anio = ${ANIO}) corr`);
const alm = Object.fromEntries((await consultar(`select id, codigo, nombre from almacenes`)).map((a) => [a.codigo, a]));

/* Productos para las filas: uno cuyo «nombre en su base» basta solo, y uno que da dos presentaciones. */
const productos = await consultar(`
  select sp.id, s.codigo, p.descripcion pres, e.nombre especie, s.corte, f.nombre formato, p.peso_bulto_kg::float kg, p.congelamiento::text cong
    from sku_presentaciones sp join skus s on s.id = sp.sku_id join presentaciones p on p.id = sp.presentacion_id
    join especies e on e.id = s.especie_id join formatos f on f.id = s.formato_id
   where sp.activo and s.activo`);
const nombreBase = (p) => `${p.formato}-${p.corte} X ${Math.round(p.kg * 1000) / 1000} KG`;
const clave = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s/g, '');
const grupos = new Map();
for (const p of productos) grupos.set(clave(nombreBase(p)), [...(grupos.get(clave(nombreBase(p))) ?? []), p]);
const unico = productos.find((p) => grupos.get(clave(nombreBase(p))).length === 1 && p.kg >= 10 && p.kg <= 30);
const ambiguo = [...grupos.values()].find((g) => g.length === 2 && g[0].codigo === g[1].codigo)?.[0];
const etiqueta = (p) => {
  const base = [p.codigo, p.pres, p.especie, p.corte].join(' · ');
  const iguales = productos.filter((x) => [x.codigo, x.pres, x.especie, x.corte].join(' · ') === base);
  return iguales.length > 1 ? `${base} · ${p.cong === 'tunel' ? 'Túnel' : 'Placas'}` : base;
};
const normal = productos.find((p) => p.codigo === '01') ?? productos[0];
console.log(`  productos: único «${nombreBase(unico)}», ambiguo «${nombreBase(ambiguo)}», normal «${etiqueta(normal)}»`);

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
const uid = async (rol) => (await consultar(`select id from usuarios where rol = '${rol}' and activo order by email limit 1`))[0].id;
const como = (u, sql) => intentar(`begin; select set_config('request.jwt.claims', '{"sub":"${u}","role":"authenticated"}', true); set local role authenticated; ${sql}; rollback;`);

async function descargar(p, selector) {
  const [descarga] = await Promise.all([p.waitForEvent('download', { timeout: 90000 }), p.click(selector)]);
  const ruta = join(CARPETA, `${SELLO}-${descarga.suggestedFilename()}`);
  await descarga.saveAs(ruta);
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.readFile(ruta);
  return { libro, nombre: descarga.suggestedFilename() };
}
/** Llena la hoja de datos debajo de la fila de ejemplo (por título de columna) y guarda. */
async function llenar(libro, hojaNombre, filas, nombre) {
  const hoja = libro.getWorksheet(hojaNombre);
  const enc = {};
  hoja.getRow(4).eachCell((c, col) => { enc[String(c.value).replace(' *', '')] = col; });
  filas.forEach((f, i) => {
    for (const [titulo, valor] of Object.entries(f)) {
      if (!enc[titulo]) throw new Error(`No está la columna «${titulo}» en la plantilla`);
      hoja.getCell(6 + i, enc[titulo]).value = valor;
    }
  });
  const ruta = join(CARPETA, nombre);
  await libro.xlsx.writeFile(ruta);
  return ruta;
}
async function subir(p, ruta, patron) {
  await p.setInputFiles('input[type="file"][name="archivo"]', ruta);
  await p.click('[data-accion="subir-archivo"]');
  await p.waitForURL(patron, { timeout: 90000 });
  await p.locator('[data-bloque="filas-importacion"]').waitFor();
  return Number(p.url().match(/importar\/(\d+)/)[1]);
}
const filaDe = (p, n) => p.locator(`[data-bloque="filas-importacion"] tbody[data-fila="${n}"]`);
const esperarFila = (p, n, estado) => p.locator(`[data-bloque="filas-importacion"] tbody[data-fila="${n}"][data-estado="${estado}"]`)
  .waitFor({ timeout: 30000 }).then(() => true, () => false);
const det = async (p, n) => (await filaDe(p, n).locator('[data-detalle="fila"]').innerText()).replace(/\s+/g, ' ');

const mias = { imp: [], lotes: [], tras: [], dic: [] };

try {
  const g = await sesion('gerencia');
  const a = await sesion('almacen');

  /* ======================================================================
     1 · ALMACENES
     ====================================================================== */
  console.log(SEC(1, 'Exalmar y Peruvian; quién recibe qué'));
  {
    const al = await consultar(`select codigo, nombre, tipo::text, activo, recibe_produccion p, recibe_compras c from almacenes`);
    const de = Object.fromEntries(al.map((x) => [x.codigo, x]));
    ok(de.EXALMAR?.nombre === 'Exalmar' && de.EXALMAR.tipo === 'externo' && de.EXALMAR.c && !de.EXALMAR.p && de.EXALMAR.activo, 'Exalmar existe: externo, recibe compras');
    ok(de.PERUVIAN?.nombre === 'Peruvian' && de.PERUVIAN.tipo === 'externo' && de.PERUVIAN.c && !de.PERUVIAN.p, 'Peruvian existe: externo, recibe compras');
    ok(!de.ELAMAR.c && !de.PERUFR.c && !de.ELAMAR.p && !de.PERUFR.p, 'Elamar y Perufrost ya no reciben compras (solo traslados)');
    ok(al.filter((x) => x.c && x.activo).map((x) => x.codigo).sort().join(',') === 'EXALMAR,PERUVIAN', 'las compras entran solo por Exalmar y Peruvian');
    ok(['STM-C1', 'STM-C2', 'STM-C3', 'FREEKO', 'HAYDUK'].every((c) => de[c].p) && al.filter((x) => x.p).length === 5, 'la producción, por Santa Mónica C1-C3, Freeko y Hayduk');

    await a.goto(`${BASE}/almacenes/ingresos/nuevo`, { waitUntil: 'networkidle' });
    await a.locator('input[name="origen_ingreso"][value="compras"]').check();
    const opc = await a.locator('select[name="almacen_id"] option').allInnerTexts();
    ok(opc.length === 2 && opc.includes('Exalmar') && opc.includes('Peruvian'), 'el formulario manual, con Compras, ofrece Exalmar y Peruvian', opc.join(', '));
  }

  /* ======================================================================
     1b · EL INVENTARIO INICIAL NO ES UN INGRESO DEL DÍA (079b)
     ====================================================================== */
  console.log(SEC('1b', 'Inventario inicial en Ingresos y Movimientos del día'));
  {
    const [ini] = await consultar(`select (min(fecha) at time zone 'America/Lima')::date::text dia, count(*)::int n, sum(peso_neto_kg)::float kg
                                     from movimientos where documento_tipo = 'inventario_inicial'`);
    if (!ini?.n) ok(true, 'no hay inventario inicial cargado: nada que revisar');
    else {
      const [{ n: ingDia }] = await consultar(`select count(*)::int n from movimientos where tipo = 'ingreso' and coalesce(documento_tipo, '') <> 'inventario_inicial'
                                                 and (fecha at time zone 'America/Lima')::date = '${ini.dia}'`);
      await g.goto(`${BASE}/almacenes/movimientos?desde=${ini.dia}&hasta=${ini.dia}`, { waitUntil: 'networkidle' });
      const tabla = (await g.locator('#por-tipo').innerText()).replace(/\s+/g, ' ');
      const nIni = Number((/Inventario inicial Saldo de partida ([\d.,]+)/i.exec(tabla)?.[1] ?? '').replace(/[.,]/g, ''));
      const filaIni = nIni === ini.n;
      ok(filaIni, `Movimientos del ${dma(ini.dia)}: los ${ini.n} saldos salen como «Inventario inicial · Saldo de partida»`, tabla.slice(0, 160));
      ok(ingDia === 0 ? !/Ingreso de producción/.test(tabla) : true, '«Ingreso de producción» ya no los cuenta', `${ingDia} ingresos de verdad ese día`);
      const entro = (await g.locator('.kpi:has(.kpi-etiqueta:text-is("Entró"))').innerText()).replace(/\s+/g, ' ');
      ok(/sin contar el inventario inicial/.test(entro), '«Entró» no suma el inventario inicial y lo dice', entro);
      await captura(g, '00-movimientos-inventario-inicial');
      await g.goto(`${BASE}/almacenes/movimientos?desde=${ini.dia}&hasta=${ini.dia}&tipo=ingreso`, { waitUntil: 'networkidle' });
      const titulo = await g.locator('#detalle .panel-titulo').first().innerText().catch(() => '');
      ok(new RegExp(`Detalle · ${ingDia} movimientos`, 'i').test(titulo), 'el filtro «Ingreso de producción» deja fuera el inventario inicial', titulo);
      await g.goto(`${BASE}/almacenes/ingresos?origen=inventario_inicial`, { waitUntil: 'networkidle' });
      const conIni = await g.locator('[data-origen="inventario_inicial"]').count();
      const otros = await g.locator('[data-origen="produccion"], [data-origen="compras"]').count();
      ok(conIni > 0 && otros === 0, 'Stock › Ingresos: el filtro «Inventario inicial» y su etiqueta en la columna Origen', `${conIni} filas`);
      await g.goto(`${BASE}/almacenes/ingresos?origen=produccion`, { waitUntil: 'networkidle' });
      ok(await g.locator('[data-origen="inventario_inicial"]').count() === 0, 'y «Producción» ya no trae los saldos iniciales');
    }
  }

  /* ======================================================================
     2 · PLANTILLA DE INGRESOS
     ====================================================================== */
  console.log(SEC(2, 'Plantilla de ingresos: el orden de Oliver, listas, Productos'));
  let libroIng;
  {
    await a.goto(`${BASE}/almacenes/ingresos/importar`, { waitUntil: 'networkidle' });
    const { libro } = await descargar(a, '[data-accion="descargar-plantilla"]');
    libroIng = libro;
    const hi = libro.getWorksheet('Ingresos');
    const enc = [];
    hi.getRow(4).eachCell({ includeEmpty: true }, (c) => enc.push(c.value === null ? '' : String(c.value)));
    ok(JSON.stringify(enc) === JSON.stringify(ORDEN_OLIVER), 'las columnas van exactamente en el orden de su hoja GENERAL (087), sin huecos', enc.join(' | '));
    ok(String(hi.getCell(5, 2).value).startsWith('EJEMPLO') && hi.getCell(5, 10).value === 'SANTA MONICA' && /^CAMARA N° \d\d$/.test(String(hi.getCell(5, 11).value)),
      'la fila de ejemplo sigue el mismo orden (N°PALLET en la B, ALMACEN y CAMARA como en su base)');
    const col = (t) => enc.findIndex((e) => e.replace(' *', '') === t) + 1;
    const listas = libro.getWorksheet('Listas');
    const tituloLista = {};
    listas.getRow(1).eachCell((c, k) => { tituloLista[String.fromCharCode(64 + k)] = String(c.value); });
    const desplegables = { 'OPERACIÓN INGRESO': 'OPERACIÓN INGRESO', 'PRESENTACION': 'PRESENTACION', 'TIPO DE CONGELAMIENTO': 'TIPO DE CONGELAMIENTO',
      'ALMACEN': 'ALMACEN', 'CAMARA DE ALMACENAMIENTO': 'CAMARA DE ALMACENAMIENTO', 'TURNO': 'TURNO', 'LINEA PROCESADORA': 'LINEA PROCESADORA',
      'MOTIVO INGRESO': 'MOTIVO INGRESO', 'PLANTA': 'PLANTA' };
    const malas = Object.entries(desplegables).filter(([t, lista]) => {
      const dv = hi.getCell(6, col(t)).dataValidation;
      const letra = /Listas!\$([A-Z])\$/.exec(dv?.formulae?.[0] ?? '')?.[1];
      const dv500 = hi.getCell(505, col(t)).dataValidation;
      return dv?.type !== 'list' || tituloLista[letra] !== lista || dv500?.type !== 'list';
    }).map(([t]) => t);
    ok(malas.length === 0, 'las 9 listas desplegables están en su columna y apuntan a su lista (filas 5 a 505)', malas.join(', ') || 'todas');
    const hInst = libro.getWorksheet('Instrucciones');
    const enInst = [];
    hInst.eachRow((f) => { const v = String(f.getCell(1).value ?? ''); if (ORDEN_OLIVER.includes(v)) enInst.push(v); });
    ok(JSON.stringify(enInst) === JSON.stringify(ORDEN_OLIVER), 'las instrucciones explican las columnas en el mismo orden');

    //  087 · La hoja Productos va por su nombre (OPERACIÓN INGRESO) con CODIGO, PRESENTACION y congelamiento.
    const hp = libro.getWorksheet('Productos');
    const encP = [];
    hp.getRow(2).eachCell((c) => encP.push(String(c.value)));
    ok(encP.slice(0, 4).join('|') === 'OPERACIÓN INGRESO|CODIGO|PRESENTACION|TIPO DE CONGELAMIENTO' && encP.includes('Formato'),
      'la hoja Productos empieza por OPERACIÓN INGRESO, CODIGO, PRESENTACION y TIPO DE CONGELAMIENTO', encP.join(' | '));
    const iF = encP.indexOf('Formato') + 1, iT = encP.indexOf('Texto del sistema') + 1;
    let filaUnico = null, filasAmb = 0;
    hp.eachRow((f, r) => {
      if (r < 3) return;
      if (f.getCell(iT).value === etiqueta(unico)) filaUnico = [f.getCell(iF).value, f.getCell(1).value];
      if (f.getCell(1).value === nombreBase(ambiguo)) filasAmb++;
    });
    ok(filaUnico?.[0] === unico.formato && filaUnico?.[1] === nombreBase(unico), 'cada producto con su formato y su nombre en su base', JSON.stringify(filaUnico));
    ok(filasAmb > 1, 'un nombre con varias presentaciones sale una vez por presentación (la elige PRESENTACION)', `${filasAmb} filas`);
    const lProd = [];
    listas.getColumn(Object.keys(tituloLista).find((k) => tituloLista[k] === 'OPERACIÓN INGRESO').charCodeAt(0) - 64).eachCell((c, r) => { if (r > 1) lProd.push(String(c.value)); });
    ok(lProd.includes(nombreBase(unico)) && lProd.includes(nombreBase(ambiguo)) && new Set(lProd).size === lProd.length,
      'la lista desplegable de OPERACIÓN INGRESO trae los nombres de su base, sin repetir', `${lProd.length} opciones`);
    const bod = libro.getWorksheet('Almacenes');
    const qr = {};
    bod.eachRow((f) => { qr[String(f.getCell(3).value)] = [f.getCell(1).value, f.getCell(2).value, f.getCell(4).value, f.getCell(5).value]; });
    ok(qr.Exalmar?.[3] === 'Sí' && qr.Peruvian?.[3] === 'Sí' && qr.Elamar?.[3] === 'No' && qr.Perufrost?.[3] === 'No', 'la hoja Almacenes: Exalmar y Peruvian reciben compras; Elamar y Perufrost no');
    ok(qr['Santa Mónica · Cámara 02']?.[0] === 'SANTA MONICA' && qr['Santa Mónica · Cámara 02']?.[1] === 'CAMARA N° 02',
      'y dice cómo escribirlo: SANTA MONICA + CAMARA N° 02', JSON.stringify(qr['Santa Mónica · Cámara 02']));
  }

  /* ======================================================================
     3 · IMPORTAR INGRESOS CON EL NOMBRE DE SU BASE
     ====================================================================== */
  console.log(SEC(3, 'Importar ingresos: nombre de su base, ambigüedad, bodegas de compra'));
  let impIng;
  {
    const base = { 'Bultos': 20, 'Fecha de producción': dma(enDias(-20)), 'Observaciones': 'PRUEBA-PD' };
    const kgU = 20 * unico.kg;
    const filas = [
      /* 6  P1 */ { ...base, 'Código de pallet': COD(1), 'Origen': 'Producción', 'Bodega': 'Freeko', 'Producto': nombreBase(unico), 'Peso neto total (kg)': kgU },
      /* 7  P2 */ { ...base, 'Código de pallet': COD(2), 'Origen': 'Compras', 'Proveedor (si es compra)': 'Proveedor PRUEBA-PD', 'Bodega': 'Exalmar', 'Producto': etiqueta(normal), 'Peso neto total (kg)': 400 },
      /* 8  P3 */ { ...base, 'Código de pallet': COD(3), 'Origen': 'Producción', 'Bodega': 'Santa Mónica · Cámara 01', 'Cámara': 'Cámara 01', 'Producto': etiqueta(normal), 'Peso neto total (kg)': 400 },
      /* 9  P4 */ { ...base, 'Código de pallet': COD(4), 'Origen': 'Producción', 'Bodega': 'Hayduk', 'Producto': `${normal.codigo} · ${normal.pres}`, 'Peso neto total (kg)': 400 },
      /* 10 P5 */ { ...base, 'Código de pallet': COD(5), 'Origen': 'Compras', 'Proveedor (si es compra)': 'Proveedor PRUEBA-PD', 'Bodega': 'Peruvian', 'Producto': etiqueta(normal), 'Peso neto total (kg)': 400 },
      /* 11 P6 */ { ...base, 'Código de pallet': COD(6), 'Origen': 'Producción', 'Bodega': 'Santa Mónica · Cámara 01', 'Producto': nombreBase(unico).toLowerCase().replace(' x ', '   x  '), 'Peso neto total (kg)': kgU },
      /* 12 P7 */ { ...base, 'Código de pallet': COD(7), 'Origen': 'Producción', 'Bodega': 'Freeko', 'Producto': etiqueta(normal), 'Peso neto total (kg)': 400 },
      /* 13 P8 */ { ...base, 'Código de pallet': COD(8), 'Origen': 'Producción', 'Bodega': 'Freeko', 'Producto': etiqueta(normal), 'Peso neto total (kg)': 400, 'Fecha de producción': dma(enDias(-5)) },
      /* 14 P9 */ { ...base, 'Código de pallet': COD(9), 'Origen': 'Producción', 'Bodega': 'Santa Mónica · Cámara 02', 'Producto': etiqueta(normal), 'Peso neto total (kg)': 400 },
      /* 15 */ { ...base, 'Código de pallet': COD(10), 'Origen': 'Producción', 'Bodega': 'Freeko', 'Producto': nombreBase(ambiguo), 'Peso neto total (kg)': 400 },
      /* 16 */ { ...base, 'Código de pallet': COD(11), 'Origen': 'Producción', 'Bodega': 'Freeko', 'Producto': `${unico.formato}-${unico.corte} X 99 KG`, 'Peso neto total (kg)': 400 },
      /* 17 */ { ...base, 'Código de pallet': COD(12), 'Origen': 'Compras', 'Proveedor (si es compra)': 'Proveedor PRUEBA-PD', 'Bodega': 'Elamar', 'Producto': etiqueta(normal), 'Peso neto total (kg)': 400 },
    ];
    const ruta = await llenar(libroIng, 'Ingresos', filas, `ingresos-pd-${SELLO}.xlsx`);
    impIng = await subir(a, ruta, /\/almacenes\/ingresos\/importar\/\d+/);
    mias.imp.push(impIng);
    await a.click('[data-filtro="todas"]');
    const est = (n) => filaDe(a, n).getAttribute('data-estado');
    const buenas = [6, 7, 8, 9, 10, 11, 12, 13, 14];
    const estados = await Promise.all(buenas.map(est));
    ok(estados.every((e) => e === 'valida'), 'las 9 filas buenas quedan listas (nombre de su base, etiqueta, código · presentación, compras en Exalmar y Peruvian)', estados.join(','));
    const d15 = await det(a, 15);
    ok(/Producto: .*puede ser 2 presentaciones/.test(d15) && d15.includes(etiqueta(grupos.get(clave(nombreBase(ambiguo)))[0])) && d15.includes(etiqueta(grupos.get(clave(nombreBase(ambiguo)))[1])),
      'un nombre con dos presentaciones posibles: el error lo dice y propone las dos', d15.slice(0, 220));
    ok(/no tiene una presentación de 99 kg por bulto: tiene/.test(await det(a, 16)), 'un nombre con un peso de bulto que no existe: dice qué pesos tiene', (await det(a, 16)).slice(0, 160));
    ok(/Elamar no recibe ingresos de Compras\. Los ingresos de Compras entran por: Exalmar, Peruvian/.test(await det(a, 17)), 'una compra en Elamar se rechaza y dice por dónde entran', (await det(a, 17)).slice(0, 140));
    await captura(a, '01-ingresos-nombre-su-base');
    // El editor reconoce el nombre de su base (no lo marca «no reconocido»).
    await filaDe(a, 6).locator('[data-accion="corregir-fila"]').click();
    const opc = await a.locator('[data-bloque="editor-fila"] select[name="producto"] option:checked').innerText();
    ok(opc === nombreBase(unico), 'al corregir una fila, el desplegable reconoce el nombre de su base', opc);
    await a.locator('[data-bloque="editor-fila"] button:has-text("Cancelar")').click();
    // Las malas se descartan y Gerencia valida: nacen los 9 pallets de prueba.
    for (const n of [15, 16, 17]) {
      await filaDe(a, n).locator('[data-accion="descartar-fila"]').click();
      await esperarFila(a, n, 'descartada');
    }
    await g.goto(`${BASE}/almacenes/ingresos/importar/${impIng}`, { waitUntil: 'networkidle' });
    await g.click('[data-accion="validar-registrar"]');
    await g.waitForFunction(() => /Importación validada/.test(document.querySelector('[data-aviso="importacion"]')?.textContent ?? ''), null, { timeout: 180000 });
    const lotes = await consultar(`select l.id, l.codigo_pallet, l.sku_presentacion_id sp, e.almacen_id, e.bultos, e.peso_neto_kg::float kg
                                     from lotes l join existencias e on e.lote_id = l.id
                                    where l.codigo_pallet like 'PRB PD ${SELLO}%' and e.peso_neto_kg > 0 order by l.codigo_pallet`);
    mias.lotes = (await consultar(`select id from lotes where id > ${prev.lot} and codigo_pallet like 'PRB PD ${SELLO}%'`)).map((x) => x.id);
    const P = Object.fromEntries(lotes.map((l) => [Number(l.codigo_pallet.slice(-2)), l]));
    ok(lotes.length === 9, 'Gerencia valida: nacen los 9 pallets de prueba con su stock', lotes.map((l) => l.codigo_pallet.slice(-2)).join(','));
    ok(P[1]?.sp === unico.id && P[6]?.sp === unico.id, 'el nombre de su base quedó como el producto correcto (también en minúsculas y con espacios de más)');
    ok(P[2]?.almacen_id === alm.EXALMAR.id && P[5]?.almacen_id === alm.PERUVIAN.id, 'las compras entraron en Exalmar y Peruvian');
    globalThis.P = P;

    /* El orden antiguo de columnas se sigue leyendo (lo sube Gerencia, no se valida). */
    const viejo = new ExcelJS.Workbook();
    const hv = viejo.addWorksheet('Ingresos');
    hv.getRow(4).values = ['Código de pallet *', 'Producto *', 'Origen *', 'Proveedor (si es compra)', 'Bodega *', 'Cámara', 'Bultos *', 'Peso neto total (kg) *', 'Kg por bulto', 'Fecha de producción *', 'TIPO DE CONGELAMIENTO'];
    hv.getRow(5).values = [COD(20), etiqueta(normal), 'Producción', '', 'Freeko', '', 10, 200, '', dma(enDias(-1))];
    /* Placas y túnel: el nombre solo no basta; con la columna de su base TIPO DE CONGELAMIENTO, sí. */
    const pt = [...grupos.values()].find((x) => x.length === 2 && x[0].codigo === x[1].codigo && x[0].pres === x[1].pres && x[0].cong !== x[1].cong)?.[0];
    hv.getRow(6).values = [COD(21), nombreBase(pt), 'Producción', '', 'Freeko', '', 10, 200, '', dma(enDias(-1)), 'TUNEL'];
    hv.getRow(7).values = [COD(22), nombreBase(pt), 'Producción', '', 'Freeko', '', 10, 200, '', dma(enDias(-1)), ''];
    const rv = join(CARPETA, `ingresos-orden-antiguo-${SELLO}.xlsx`);
    await viejo.xlsx.writeFile(rv);
    await g.goto(`${BASE}/almacenes/ingresos/importar`, { waitUntil: 'networkidle' });
    const impViejo = await subir(g, rv, /\/almacenes\/ingresos\/importar\/\d+/);
    mias.imp.push(impViejo);
    const [fv] = await consultar(`select estado, datos->>'codigo_pallet' c, datos->>'peso_kg' kg from importaciones_excel_filas where importacion_id = ${impViejo} and fila = 5`);
    ok(fv?.estado === 'valida' && fv.c === COD(20) && fv.kg === '200', 'un archivo con el orden antiguo de columnas se lee igual (por el título)', JSON.stringify(fv));
    const [f21, f22] = await consultar(`select estado, errores::text e from importaciones_excel_filas where importacion_id = ${impViejo} and fila in (6, 7) order by fila`);
    ok(f21?.estado === 'valida' && f22?.estado === 'con_error' && /columna «Tipo de congelamiento»/.test(f22.e),
      `misma presentación en placas y túnel («${nombreBase(pt)}»): con su columna TIPO DE CONGELAMIENTO se resuelve; sin ella, el error lo dice`, (f22?.e ?? '').slice(0, 160));
  }
  const P = globalThis.P;

  /* ======================================================================
     4 · PLANTILLA DE TRASLADOS
     ====================================================================== */
  console.log(SEC(4, 'Plantilla de traslados: fecha de traslado y guía'));
  let libroTr;
  {
    await a.goto(`${BASE}/almacenes/traslados/importar`, { waitUntil: 'networkidle' });
    const { libro } = await descargar(a, '[data-accion="descargar-plantilla-traslados"]');
    libroTr = libro;
    const enc = [];
    libro.getWorksheet('Traslados').getRow(4).eachCell((c) => enc.push(String(c.value)));
    ok(enc.join('|') === 'Código de pallet *|Bodega de origen *|Bodega de destino *|Bultos (si es parcial)|Kilos (si es parcial)|Fecha de traslado *|N.º de guía|Observaciones',
      '«Fecha de traslado *» (obligatoria) y «N.º de guía» antes de «Observaciones»', enc.join(' | '));
    let hayP3 = false;
    libro.getWorksheet('Pallets disponibles').eachRow((f) => { if (f.getCell(1).value === COD(3)) hayP3 = true; });
    ok(hayP3, 'la hoja de pallets disponibles ya trae los pallets de prueba');
    const inst = [];
    libro.getWorksheet('Instrucciones').eachRow((f) => inst.push(String(f.getCell(2).value ?? '')));
    ok(inst.some((t) => /YA OCURRIERON/.test(t)) && inst.some((t) => /despachado y recibido/.test(t)), 'las instrucciones dicen que son traslados ya hechos y que entran recibidos');

    // Un archivo con el título viejo «Fecha programada» se rechaza con un mensaje claro.
    const vj = new ExcelJS.Workbook();
    vj.addWorksheet('Traslados').getRow(4).values = ['Código de pallet *', 'Bodega de origen *', 'Bodega de destino *', 'Fecha programada'];
    vj.getWorksheet('Traslados').getRow(5).values = [COD(3), 'Santa Mónica · Cámara 01', 'Freeko', dma(hoy)];
    const rvj = join(CARPETA, `traslados-viejo-${SELLO}.xlsx`);
    await vj.xlsx.writeFile(rvj);
    await a.setInputFiles('input[type="file"][name="archivo"]', rvj);
    await a.click('[data-accion="subir-archivo"]');
    const msj = await a.locator('.ficha-aviso-critico').first().innerText({ timeout: 30000 }).catch(() => '');
    ok(/faltan columnas obligatorias: «Fecha de traslado»/.test(msj), 'la plantilla vieja (sin «Fecha de traslado») se rechaza diciendo qué falta', msj.slice(0, 120));
  }

  /* ======================================================================
     5 · TRASLADOS YA HECHOS: Almacén deja lista, Gerencia valida
     ====================================================================== */
  console.log(SEC(5, 'Traslados importados: lista para validar → validar y registrar (ejecutados)'));
  {
    // Un pallet de prueba bloqueado por Calidad.
    const [dc] = await consultar(`insert into dictamenes_calidad (lote_id, tipo, estado, motivo_texto, vigente)
      values (${P[7].id}, 'calidad', 'inmovilizado', 'PRUEBA-PD bloqueo', true) returning id`);
    mias.dic.push(dc.id);
    const C1 = 'Santa Mónica · Cámara 01';
    const obs = 'PRUEBA-PD traslado';
    const ruta = await llenar(libroTr, 'Traslados', [
      /* 6  */ { 'Código de pallet': COD(3), 'Bodega de origen': C1, 'Bodega de destino': 'Freeko', 'Fecha de traslado': dma(enDias(-2)), 'N.º de guía': `T001-${SELLO}1`, 'Observaciones': obs },
      /* 7  */ { 'Código de pallet': COD(6), 'Bodega de origen': C1, 'Bodega de destino': 'Freeko', 'Bultos (si es parcial)': 5, 'Fecha de traslado': dma(enDias(-2)), 'N.º de guía': `T001-${SELLO}1`, 'Observaciones': obs },
      /* 8  */ { 'Código de pallet': COD(1), 'Bodega de origen': 'Freeko', 'Bodega de destino': 'Depsa', 'Fecha de traslado': dma(enDias(-1)), 'N.º de guía': `T001-${SELLO}2`, 'Observaciones': obs },
      /* 9  */ { 'Código de pallet': COD(7), 'Bodega de origen': 'Freeko', 'Bodega de destino': 'Depsa', 'Fecha de traslado': dma(enDias(-1)), 'Observaciones': obs },
      /* 10 */ { 'Código de pallet': COD(4), 'Bodega de origen': 'Freeko', 'Bodega de destino': 'Depsa', 'Fecha de traslado': dma(enDias(-1)), 'Observaciones': obs },
      /* 11 */ { 'Código de pallet': COD(2), 'Bodega de origen': 'Exalmar', 'Bodega de destino': 'Santa Mónica · Cámara 02', 'Fecha de traslado': dma(enDias(2)), 'Observaciones': obs },
      /* 12 */ { 'Código de pallet': COD(5), 'Bodega de origen': 'Peruvian', 'Bodega de destino': 'Freeko', 'Observaciones': obs },
      /* 13 */ { 'Código de pallet': COD(3), 'Bodega de origen': C1, 'Bodega de destino': 'Depsa', 'Fecha de traslado': dma(enDias(-1)), 'Observaciones': obs },
      /* 14 */ { 'Código de pallet': COD(8), 'Bodega de origen': 'Freeko', 'Bodega de destino': 'Depsa', 'Fecha de traslado': dma(enDias(-10)), 'Observaciones': obs },
    ], `traslados-pd-${SELLO}.xlsx`);
    await a.goto(`${BASE}/almacenes/traslados/importar`, { waitUntil: 'networkidle' });
    const impTr = await subir(a, ruta, /\/almacenes\/traslados\/importar\/\d+/);
    mias.imp.push(impTr);
    const est = (n) => filaDe(a, n).getAttribute('data-estado');
    ok(await est(6) === 'valida' && await est(7) === 'valida' && await est(8) === 'valida', 'las filas buenas quedan listas (entero, parcial, otra bodega)');
    ok(/bloqueado por Calidad/.test(await det(a, 9)), 'pallet bloqueado por Calidad', (await det(a, 9)).slice(0, 90));
    ok(/no está en Freeko: está en Hayduk/.test(await det(a, 10)), 'pallet que está en otra bodega (dice dónde)', (await det(a, 10)).slice(0, 90));
    ok(/Fecha de traslado: .*es futura/.test(await det(a, 11)), 'fecha de traslado futura', (await det(a, 11)).slice(0, 120));
    ok(/Fecha de traslado: Falta la fecha de traslado/.test(await det(a, 12)), 'sin fecha de traslado', (await det(a, 12)).slice(0, 90));
    ok(/ya aparece en la fila 6/.test(await det(a, 13)), 'pallet repetido en el archivo');
    ok(/se produjo el .*no pudo trasladarse antes/.test(await det(a, 14)), 'fecha anterior a la producción del pallet', (await det(a, 14)).slice(0, 120));
    ok(await a.locator('[data-accion="validar-registrar"]').count() === 0, 'Almacén no ve «Validar y registrar»');
    for (const n of [9, 11, 12, 13, 14]) {
      await filaDe(a, n).locator('[data-accion="descartar-fila"]').click();
      await esperarFila(a, n, 'descartada');
    }
    await a.click('[data-accion="dejar-lista"]');
    await a.waitForFunction(() => /lista para validar/i.test(document.querySelector('[data-aviso="importacion"]')?.textContent ?? ''), null, { timeout: 30000 });
    await captura(a, '02-traslados-lista-para-validar');
    const [imp] = await consultar(`select estado, enviada_por from importaciones_excel where id = ${impTr}`);
    ok(imp.estado === 'lista' && imp.enviada_por === (await uid('almacen')), 'queda «Lista para validar» con quién la envió');
    const [alerta] = await consultar(`select titulo, mensaje, atendida from alertas where entidad = 'importacion' and entidad_id = ${impTr}`);
    ok(alerta?.titulo === 'Importación de traslados por validar' && /3 pallets trasladados/.test(alerta.mensaje) && !alerta.atendida,
      'abre el aviso «Importación de traslados por validar» (Gerencia y Operaciones)', alerta?.mensaje?.slice(0, 100));
    ok(JSON.stringify((await consultar(`select almacen_id from existencias where lote_id = ${P[3].id} and peso_neto_kg > 0`)).map((x) => x.almacen_id)) === JSON.stringify([alm['STM-C1'].id]),
      'dejarla lista no mueve nada');
    // La base sostiene la regla aunque se salte la pantalla.
    const ua = await uid('almacen');
    const e1 = await como(ua, `update importaciones_excel set estado = 'validada' where id = ${impTr}`);
    ok(/las validan Gerencia u Operaciones/.test(e1 ?? ''), 'la base no deja que Almacén la marque validada', (e1 ?? '').slice(0, 80));
    const e2 = await como(ua, `select traslado_registrar_hecho(${alm['STM-C1'].id}, ${alm.FREEKO.id}, '${hoy}', 'X', 'PRUEBA-PD', '[{"lote_id":${P[3].id},"bultos":1,"peso_kg":1}]'::jsonb)`);
    ok(/los registran Gerencia u Operaciones/.test(e2 ?? ''), 'ni registrar un traslado ya hecho directo en la base', (e2 ?? '').slice(0, 80));
    const e3 = await como(await uid('gerencia'), `select traslado_registrar_hecho(${alm['STM-C1'].id}, ${alm.FREEKO.id}, '${enDias(3)}', 'X', 'PRUEBA-PD', '[{"lote_id":${P[3].id},"bultos":1,"peso_kg":1}]'::jsonb)`);
    ok(/es futura/.test(e3 ?? ''), 'y la base tampoco acepta una fecha futura', (e3 ?? '').slice(0, 80));

    // Gerencia: el aviso lleva a la importación de traslados.
    await g.goto(`${BASE}/alertas`, { waitUntil: 'networkidle' });
    ok((await g.locator('body').innerText()).includes('Importación de traslados por validar'), 'Gerencia ve el aviso en Alertas');
    await g.goto(`${BASE}/almacenes/ingresos/importar/${impTr}`, { waitUntil: 'networkidle' });
    ok(new RegExp(`/almacenes/traslados/importar/${impTr}`).test(g.url()), 'el enlace del aviso abre la importación de traslados');
    const boton = g.locator('[data-accion="validar-registrar"]');
    ok(/Validar y registrar 2 traslados \(3 pallets\)/.test(await boton.innerText()), 'Gerencia ve «Validar y registrar 2 traslados (3 pallets)»: uno por viaje (origen, destino, fecha y guía)', await boton.innerText());

    // Corte de red al validar: se avisa y no se pierde nada.
    await g.route(`**/almacenes/traslados/importar/${impTr}`, (r) => (r.request().method() === 'POST' ? r.abort('internetdisconnected') : r.continue()));
    await boton.click();
    await g.locator('[data-aviso="importacion"]').waitFor({ timeout: 30000 });
    ok(/Se perdió la conexión/.test(await g.locator('[data-aviso="importacion"]').innerText()), 'un corte de red al validar se avisa en la pantalla');
    await g.unroute(`**/almacenes/traslados/importar/${impTr}`);
    await g.reload({ waitUntil: 'networkidle' });

    const exAntes = await consultar(`select lote_id, almacen_id, bultos, peso_neto_kg::float kg from existencias where lote_id in (${P[3].id}, ${P[6].id}, ${P[1].id}) and peso_neto_kg > 0 order by 1, 2`);
    await g.click('[data-accion="validar-registrar"]');
    await g.waitForFunction(() => /Importación validada/.test(document.querySelector('[data-aviso="importacion"]')?.textContent ?? ''), null, { timeout: 180000 });
    const fin = await g.locator('[data-aviso="importacion"]').innerText();
    ok(/2 traslados registrados ya recibidos en destino/.test(fin) && /con 3 pallets/.test(fin), 'registra 2 traslados ya recibidos con 3 pallets', fin.slice(0, 140));
    await captura(g, '03-traslados-validados');
    const tras = await consultar(`select t.id, t.numero, t.estado::text, t.almacen_origen_id o, t.almacen_destino_id d, t.guia_numero, t.fecha_traslado::text f,
                                         t.autorizado_por, t.despachado_por, t.aceptado_por,
                                         json_agg(json_build_object('lote', tl.lote_id, 'b', tl.bultos_enviados, 'kg', tl.peso_enviado_kg, 'ba', tl.bultos_aceptados, 'kga', tl.peso_aceptado_kg)) lineas
                                    from traslados t join traslado_lineas tl on tl.traslado_id = t.id
                                   where t.id > ${prev.tr} and t.id in (select traslado_id from importaciones_excel_filas where importacion_id = ${impTr})
                                   group by t.id order by t.id`);
    mias.tras.push(...tras.map((t) => t.id));
    const ug = await uid('gerencia');
    ok(tras.length === 2 && tras.every((t) => t.estado === 'aceptado' && t.autorizado_por === ug && t.despachado_por === ug && t.aceptado_por === ug),
      'en la base: 2 traslados «aceptado» (autorizados, despachados y recibidos por quien validó)', tras.map((t) => `${t.numero} ${t.estado}`).join(', '));
    const tC1 = tras.find((t) => t.o === alm['STM-C1'].id);
    const tFr = tras.find((t) => t.o === alm.FREEKO.id);
    ok(tC1?.guia_numero === `T001-${SELLO}1` && tC1.f === enDias(-2) && tC1.lineas.length === 2, 'el de la Cámara 01 lleva sus 2 pallets, su guía y su fecha');
    ok(tFr?.guia_numero === `T001-${SELLO}2` && tFr.f === enDias(-1) && tFr.d === alm.DEPSA.id, 'el de Freeko → Depsa, con la suya');
    const l6 = tC1?.lineas.find((l) => l.lote === P[6].id);
    ok(l6?.b === 5 && l6.ba === 5 && Math.abs(Number(l6.kga) - Number(l6.kg)) < 0.001, 'el parcial: 5 bultos enviados y recibidos, sin diferencia');
    const exDesp = await consultar(`select lote_id, almacen_id, bultos, peso_neto_kg::float kg from existencias where lote_id in (${P[3].id}, ${P[6].id}, ${P[1].id}) and peso_neto_kg > 0 order by 1, 2`);
    const donde = (id) => exDesp.filter((x) => x.lote_id === id).map((x) => `${x.almacen_id}:${x.bultos}`).join(' ');
    ok(donde(P[3].id) === `${alm.FREEKO.id}:20` && donde(P[1].id) === `${alm.DEPSA.id}:20`, 'el stock se movió: el pallet entero ya está en destino', `${donde(P[3].id)} · ${donde(P[1].id)}`);
    ok(donde(P[6].id) === `${alm['STM-C1'].id}:15 ${alm.FREEKO.id}:5`, 'el parcial quedó repartido: 15 bultos en la Cámara 01 y 5 en Freeko', donde(P[6].id));
    const sum = (xs) => Math.round(xs.reduce((s, x) => s + x.kg, 0) * 1000) / 1000;
    ok(sum(exAntes) === sum(exDesp), 'sin crear ni perder kilos', `${sum(exAntes)} kg`);
    const mov = await consultar(`select tipo::text, count(*)::int n, string_agg(distinct documento_ref, ',') guias from movimientos
                                  where id > ${prev.mov} and documento_tipo = 'traslado' and documento_id in (${tras.map((t) => t.id)}) group by 1 order by 1`);
    ok(mov.length === 2 && mov.every((m) => m.n === 3) && mov[0].guias.includes(`T001-${SELLO}1`), 'el Kardex: 3 salidas y 3 entradas, con la guía como documento', JSON.stringify(mov));
    const ev = await consultar(`select tipo from eventos where id > ${prev.ev} and entidad = 'traslados' and entidad_id = ${tC1.id} order by id`);
    ok(['traslado_autorizado', 'traslado_despachado', 'traslado_aceptado', 'traslado_registrado_hecho'].every((t) => ev.some((e) => e.tipo === t)),
      'el historial del traslado: autorizado, despachado, aceptado y «registrado después»', ev.map((e) => e.tipo).join(', '));
    const filasBd = await consultar(`select fila, estado, traslado_id from importaciones_excel_filas where importacion_id = ${impTr} and estado = 'registrada' order by fila`);
    ok(filasBd.length === 3 && filasBd.every((f) => f.traslado_id), 'cada fila quedó «registrada» con su traslado');
    await g.click('[data-filtro="todas"]');
    ok(await esperarFila(g, 6, 'registrada') && await filaDe(g, 6).locator('[data-enlace="traslado"]').count() === 1, 'y en pantalla enlaza a su traslado');
    const [al2] = await consultar(`select atendida from alertas where entidad = 'importacion' and entidad_id = ${impTr}`);
    ok(al2?.atendida === true, 'el aviso de Alertas se cierra solo');

    await g.goto(`${BASE}/almacenes/traslados/${tC1.id}`, { waitUntil: 'networkidle' });
    const ficha = (await g.locator('body').innerText()).replace(/\s+/g, ' ');
    ok(new RegExp(`Fecha del traslado ${dma(enDias(-2))} \\(registrado después de hecho\\)`, 'i').test(ficha) && ficha.includes(`T001-${SELLO}1`),
      'la ficha del traslado muestra la fecha en que ocurrió y la guía');
    await captura(g, '04-ficha-traslado-hecho');
  }

  /* ======================================================================
     6 · SI LOS SUBE GERENCIA, SE REGISTRAN DIRECTO
     ====================================================================== */
  console.log(SEC(6, 'Gerencia sube y registra en el mismo paso'));
  {
    await g.goto(`${BASE}/almacenes/traslados/importar`, { waitUntil: 'networkidle' });
    const { libro } = await descargar(g, '[data-accion="descargar-plantilla-traslados"]');
    const ruta = await llenar(libro, 'Traslados', [
      { 'Código de pallet': COD(9), 'Bodega de origen': 'Santa Mónica · Cámara 02', 'Bodega de destino': 'Santa Mónica · Cámara 03', 'Fecha de traslado': dma(hoy), 'N.º de guía': `T001-${SELLO}3`, 'Observaciones': 'PRUEBA-PD directo' },
    ], `traslados-pd-g-${SELLO}.xlsx`);
    const impG = await subir(g, ruta, /\/almacenes\/traslados\/importar\/\d+/);
    mias.imp.push(impG);
    ok(await g.locator('[data-accion="dejar-lista"]').count() === 0 && /Validar y registrar 1 traslado \(1 pallet\)/.test(await g.locator('[data-accion="validar-registrar"]').innerText()),
      'Gerencia no tiene que dejarla lista: ve directo «Validar y registrar 1 traslado (1 pallet)»');
    await g.click('[data-accion="validar-registrar"]');
    await g.waitForFunction(() => /Importación validada/.test(document.querySelector('[data-aviso="importacion"]')?.textContent ?? ''), null, { timeout: 120000 });
    const [t] = await consultar(`select t.id, t.estado::text, t.fecha_traslado::text f from traslados t where t.id in (select traslado_id from importaciones_excel_filas where importacion_id = ${impG})`);
    if (t) mias.tras.push(t.id);
    const [e] = await consultar(`select almacen_id from existencias where lote_id = ${P[9].id} and peso_neto_kg > 0`);
    ok(t?.estado === 'aceptado' && t.f === hoy && e?.almacen_id === alm['STM-C3'].id, 'registrado y recibido: el pallet ya está en la Cámara 03', JSON.stringify({ t, e }));
    const [al] = await consultar(`select count(*)::int n from alertas where entidad = 'importacion' and entidad_id = ${impG}`);
    ok(al.n === 0, 'sin aviso de «por validar» (no hizo falta)');
  }
} catch (e) {
  ok(false, 'la prueba se interrumpió', String(e.stack ?? e).slice(0, 600));
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
    const misLotes = (await consultar(`select id from lotes where id > ${prev.lot} and codigo_pallet like 'PRB PD ${SELLO}%'`)).map((x) => x.id);
    const misImp = (await consultar(`select id from importaciones_excel where id > ${prev.imp}`)).map((x) => x.id).filter((id) => mias.imp.includes(id));
    const misTras = misImp.length
      ? (await consultar(`select distinct traslado_id id from importaciones_excel_filas where importacion_id in (${misImp}) and traslado_id is not null`)).map((x) => x.id)
      : [];
    const misMov = misLotes.length ? (await consultar(`select id from movimientos where lote_id in (${misLotes})`)).map((x) => x.id) : [];
    const misDic = misLotes.length ? (await consultar(`select id from dictamenes_calidad where lote_id in (${misLotes})`)).map((x) => x.id) : [];
    const lista = (xs) => xs.map((x) => `'${x}'`).join(',') || "''";
    const arr = (xs) => `array[${xs.join(',') || 0}]::bigint[]`;
    console.log(`  limpieza: ${misLotes.length} pallets, ${misMov.length} movimientos, ${misTras.length} traslados, ${misDic.length} dictámenes, ${misImp.length} importaciones`);
    await ejecutarSQL(`
      ${misTras.length ? `delete from traslado_lineas where traslado_id in (${misTras}); delete from traslados where id in (${misTras});` : ''}
      ${misDic.length ? `delete from dictamenes_calidad where id in (${misDic});` : ''}
      alter table movimientos disable trigger trg_kardex_no_delete;
      ${misMov.length ? `delete from movimientos where id in (${misMov});` : ''}
      alter table movimientos enable trigger trg_kardex_no_delete;
      ${misLotes.length ? `delete from existencias where lote_id in (${misLotes});` : ''}
      ${misImp.length ? `delete from importaciones_excel where id in (${misImp});` : ''}
      ${misLotes.length ? `delete from lotes where id in (${misLotes});` : ''}
      delete from eventos where id > ${prev.ev} and (
        (entidad in ('lotes','lote') and entidad_id = any(${arr(misLotes)}))
        or (entidad in ('traslados','traslado') and entidad_id = any(${arr(misTras)}))
        or (entidad = 'dictamenes_calidad' and entidad_id = any(${arr(misDic)})));
      delete from alertas where id > ${prev.al} and (
        (entidad = 'importacion' and entidad_id = any(${arr(misImp)}))
        or (entidad in ('lote','lotes') and entidad_id = any(${arr(misLotes)}))
        or (entidad in ('traslado','traslados') and entidad_id = any(${arr(misTras)})));
      delete from auditoria where id > ${prev.au} and (
        (tabla = 'lotes' and registro_id = any(array[${lista(misLotes)}]))
        or (tabla = 'movimientos' and registro_id = any(array[${lista(misMov)}]))
        or (tabla = 'importaciones_excel' and registro_id = any(array[${lista(misImp)}]))
        or (tabla = 'dictamenes_calidad' and registro_id = any(array[${lista(misDic)}]))
        or (tabla = 'traslados' and registro_id = any(array[${lista(misTras)}]))
        or (tabla = 'traslado_lineas' and (datos_despues->>'traslado_id' = any(array[${lista(misTras)}]) or datos_antes->>'traslado_id' = any(array[${lista(misTras)}]))));
      ${misTras.length && prev.corr !== null ? `update correlativos set ultimo = ${prev.corr} where serie = 'TRAS' and anio = ${ANIO} and ultimo = ${Number(prev.corr) + misTras.length};` : ''}
    `);
    const [{ n }] = await consultar(`select count(*)::int n from lotes where codigo_pallet like 'PRB PD ${SELLO}%'`);
    const [{ t }] = await consultar(`select count(*)::int t from traslados where id = any(${arr(misTras)})`);
    ok(n === 0 && t === 0, 'limpieza: pallets, traslados, Kardex, existencias, dictámenes, importaciones, avisos e historial de la prueba borrados');
  } catch (e) {
    ok(false, 'limpieza', String(e.message).slice(0, 300));
    await intentar('alter table movimientos enable trigger trg_kardex_no_delete;');
  }
}
