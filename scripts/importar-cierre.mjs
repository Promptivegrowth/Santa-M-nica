/**
 * ============================================================================
 *  IMPORTADOR DEL «CIERRE SEMANAL DE PRODUCCIÓN» DE MARCO
 * ============================================================================
 *  Carga lo que se INGRESA (no lo que pone el ERP) desde la hoja
 *  «1. RESUMEN T», para el mes de su fecha «Actualizado al»:
 *    · pota y merluza: Plan MP, Real MP, Prod. Plan, Plan Ventas;
 *    · harinas residuales: además Prod. Real y Stock Real (el ERP no las
 *      conoce).
 *  Se lee el RESULTADO de cada celda (la Prod. Plan de las harinas es una
 *  fórmula sobre la MP: entra su valor).
 *
 *      node scripts/importar-cierre.mjs                → simula
 *      node scripts/importar-cierre.mjs --aplicar      → escribe
 * ============================================================================
 */
import ExcelJS from 'exceljs';
import path from 'node:path';
import { ejecutarSQL } from './db.mjs';

const APLICAR = process.argv.includes('--aplicar');
const ARCHIVO = process.argv.find((a) => a.endsWith('.xlsx')) ?? '../Cierre Semanal_Producción-SEPTIEMBRE.xlsx';

const libro = new ExcelJS.Workbook();
await libro.xlsx.readFile(path.resolve(ARCHIVO));
const hoja = libro.getWorksheet('1. RESUMEN T');
if (!hoja) { console.error('No está la hoja «1. RESUMEN T».'); process.exit(1); }

const valor = (ref) => {
  let v = hoja.getCell(ref).value;
  if (v && typeof v === 'object' && 'result' in v) v = v.result;
  return typeof v === 'number' && Number.isFinite(v) ? v : v instanceof Date ? v : null;
};
const fecha = valor('H4');
if (!(fecha instanceof Date)) { console.error('No se pudo leer la fecha «Actualizado al» (H4).'); process.exit(1); }
const anio = fecha.getUTCFullYear();
const mes = fecha.getUTCMonth() + 1;

//  fila del Excel → categoría · columna → campo
const FILAS = { 9: 'pota', 10: 'merluza', 11: 'harina_pota', 12: 'harina_pescado' };
const COLUMNAS = { C: 'plan_mp', D: 'real_mp', G: 'plan_prod', K: 'plan_ventas' };
const SOLO_SIN_ESPECIE = { H: 'real_prod', J: 'stock_inicial', L: 'ventas' };

const cats = await ejecutarSQL(`select id, codigo, especie from cierre_categorias`);
const porCodigo = new Map(cats.map((c) => [c.codigo, c]));
const datos = [];
for (const [fila, codigo] of Object.entries(FILAS)) {
  const c = porCodigo.get(codigo);
  const cols = c.especie ? COLUMNAS : { ...COLUMNAS, ...SOLO_SIN_ESPECIE };
  for (const [col, campo] of Object.entries(cols)) {
    const v = valor(`${col}${fila}`);
    if (typeof v === 'number') datos.push({ id: c.id, codigo, campo, valor: Math.round(v * 1000) / 1000 });
  }
}

console.log(`\n  ${path.basename(ARCHIVO)} · «1. RESUMEN T» · ${String(mes).padStart(2, '0')}/${anio}`);
for (const d of datos) console.log(`    ${d.codigo.padEnd(16)} ${d.campo.padEnd(14)} ${d.valor}`);
if (!APLICAR) { console.log('\n  Simulación: no se escribió nada. Para cargarlo: --aplicar\n'); process.exit(0); }

const [marco] = await ejecutarSQL(`select id from usuarios where email = 'gerencia@santamonica.pe'`);
await ejecutarSQL(`
  insert into cierre_valores (categoria_id, anio, mes, campo, valor, registrado_por)
  values ${datos.map((d) => `(${d.id}, ${anio}, ${mes}, '${d.campo}', ${d.valor}, ${marco ? `'${marco.id}'` : 'null'})`).join(',\n')}
  on conflict (categoria_id, anio, mes, campo) do update set valor = excluded.valor, actualizado_en = now()`);
console.log(`\n  Cargados ${datos.length} datos de ${String(mes).padStart(2, '0')}/${anio}.\n`);
