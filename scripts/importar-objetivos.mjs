/**
 * ============================================================================
 *  IMPORTADOR DEL EXCEL «Objetivos 2026» DE OLIVER
 * ============================================================================
 *  Carga los valores reales de enero a agosto de 2026 en Objetivos mensuales.
 *
 *  Qué se trae y cómo:
 *    · Cada fila del Excel va al indicador que le corresponde (MAPA).
 *    · Se lee el RESULTADO de cada celda, no la fórmula: «=755.65+31.2» entra
 *      como 786,85, que es lo que Oliver ve.
 *    · Lo que en el ERP es automático (producción, embarques, inventario…)
 *      entra como AJUSTE: son meses en que el ERP no existía y manda el dato
 *      de Oliver.
 *    · Los viajes a almacén externo estaban escritos DENTRO de la fórmula
 *      del costo por viaje (÷26, ÷49…): se sacan de ahí. En enero y febrero
 *      el costo por viaje venía tecleado sin viajes, así que entra como
 *      ajuste del costo por viaje.
 *    · No se trae: los restos de plantilla (harina, camarón, «Volumen 130 103
 *      Ton», la hoja «Mejoras»), las filas ocultas con fórmulas rotas, los
 *      #DIV/0! y los totales, que ahora calcula el sistema.
 *
 *      node scripts/importar-objetivos.mjs                 → simula
 *      node scripts/importar-objetivos.mjs --aplicar       → escribe
 * ============================================================================
 */
import ExcelJS from 'exceljs';
import path from 'node:path';
import { ejecutarSQL } from './db.mjs';

const APLICAR = process.argv.includes('--aplicar');
const ARCHIVO = process.argv.find((a) => a.endsWith('.xlsx')) ?? '../Objetivos_2026_2 (1).xlsx';
const ANIO = 2026;
const COLUMNAS_MES = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']; // enero … agosto

/** Fila del Excel → código del indicador. */
const MAPA = [
  [9, 'mp_pota'], [10, 'mp_bonito'], [11, 'mp_merluza'],
  [13, 'pt_stm_pota'], [14, 'pt_stm_bonito'], [15, 'pt_stm_merluza'],
  [17, 'pt_maq_pota'], [18, 'pt_maq_bonito'], [19, 'pt_maq_merluza'],
  [21, 'fact_maq_pota'], [22, 'fact_maq_bonito'],
  [23, 'costo_maquila'], [24, 'tarifa_frescos'], [25, 'tarifa_precocido'], [26, 'tarifa_bonito'],
  [30, 'inv_stm'], [31, 'inv_freeko'], [32, 'inv_otros'],
  [33, 'servicios_fletes'],
  [35, 'flete_chimbote_paita'], [36, 'flete_entre_externos'], [37, 'flete_planta_externo'], [38, 'sobrecosto_flete'],
  [41, 'tn_embarcadas'], [42, 'contenedores'],
  [44, 'estiba_terceros'], [45, 'tn_terceros'], [47, 'personal_emb'], [48, 'tn_movidas_emb'],
  [50, 'costo_manipuleo'], [51, 'tn_movidas_ext'], [53, 'personal_recep'],
  [57, 'energia_kwh_tn'], [58, 'precio_kwh'],
  [59, 'costo_alm_ext'], [60, 'tn_alm_ext'],
  [69, 'gas_m3'], [70, 'precio_gas'], [71, 'tn_precocido'],
  [80, 'alimentacion'], [82, 'transporte'],
];

/** El número que Oliver ve en la celda, o null si no hay dato utilizable. */
function numero(celda) {
  let v = celda.value;
  if (v && typeof v === 'object') {
    if ('error' in v) return null;
    if ('result' in v) v = v.result;
    if (v && typeof v === 'object' && 'error' in v) return null;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return null;
}
const formulaDe = (celda) => {
  const v = celda.value;
  return v && typeof v === 'object' && typeof v.formula === 'string' ? v.formula : null;
};

const libro = new ExcelJS.Workbook();
await libro.xlsx.readFile(path.resolve(ARCHIVO));
const hoja = libro.getWorksheet('ID 2026');
if (!hoja) {
  console.error('El archivo no tiene la hoja «ID 2026». ¿Es el Excel de Objetivos?');
  process.exit(1);
}

const indicadores = await ejecutarSQL(`select id, codigo, tipo from objetivos_indicadores`);
const porCodigo = new Map(indicadores.map((i) => [i.codigo, i]));
const filas = [];   // { codigo, mes, valor, como }

for (const [fila, codigo] of MAPA) {
  const ind = porCodigo.get(codigo);
  if (!ind) throw new Error(`No existe el indicador ${codigo}`);
  COLUMNAS_MES.forEach((col, k) => {
    const v = numero(hoja.getCell(`${col}${fila}`));
    if (v === null) return;
    filas.push({ codigo, id: ind.id, mes: k + 1, valor: v, como: ind.tipo === 'manual' ? 'dato' : 'ajuste' });
  });
}

/* ---- Los viajes, sacados de la fórmula del costo por viaje (fila 39) ---- */
const viajes = porCodigo.get('viajes_externo');
const costoViaje = porCodigo.get('costo_viaje');
COLUMNAS_MES.forEach((col, k) => {
  const celda = hoja.getCell(`${col}39`);
  const f = formulaDe(celda);
  const m = f ? /\/\s*(\d+(?:\.\d+)?)\s*\)?\s*$/.exec(f) : null;
  if (m) {
    filas.push({ codigo: 'viajes_externo', id: viajes.id, mes: k + 1, valor: Number(m[1]), como: 'dato (de la fórmula)' });
  } else {
    const v = numero(celda);
    if (v !== null) filas.push({ codigo: 'costo_viaje', id: costoViaje.id, mes: k + 1, valor: v, como: 'ajuste (sin viajes)' });
  }
});

/* ---- Informe ---- */
const porComo = filas.reduce((m, f) => m.set(f.como, (m.get(f.como) ?? 0) + 1), new Map());
console.log(`\n  ${path.basename(ARCHIVO)} · hoja «ID 2026» · ${ANIO}, enero a agosto`);
console.log(`  ${filas.length} valores de ${new Set(filas.map((f) => f.codigo)).size} indicadores`);
for (const [c, n] of porComo) console.log(`    ${c.padEnd(24)} ${n}`);
const muestra = (codigo) => filas.filter((f) => f.codigo === codigo).map((f) => `${f.mes}:${Math.round(f.valor * 100) / 100}`).join(' ');
console.log(`  viajes a almacén externo  ${muestra('viajes_externo')}`);
console.log(`  costo por viaje (ajuste)  ${muestra('costo_viaje')}`);
console.log(`  MP pota                   ${muestra('mp_pota')}`);

if (!APLICAR) {
  console.log('\n  Simulación: no se escribió nada. Para cargarlo: --aplicar\n');
  process.exit(0);
}

/* ---- Escritura: a nombre de Oliver, que es quien los digitaba ---- */
const [oliver] = await ejecutarSQL(`select id from usuarios where email = 'operaciones@santamonica.pe'`);
const valores = filas.map((f) =>
  `(${f.id}, ${ANIO}, ${f.mes}, ${f.valor}, 'Importado de Objetivos_2026_2.xlsx', ${oliver ? `'${oliver.id}'` : 'null'})`).join(',\n');
await ejecutarSQL(`
  insert into objetivos_valores (indicador_id, anio, mes, valor, observacion, registrado_por)
  values ${valores}
  on conflict (indicador_id, anio, mes) do update
     set valor = excluded.valor, observacion = excluded.observacion,
         registrado_por = excluded.registrado_por, actualizado_en = now()`);
const [n] = await ejecutarSQL(`select count(*) as n from objetivos_valores where anio = ${ANIO}`);
console.log(`\n  Cargado: ${n.n} valores de ${ANIO} en la base.\n`);
