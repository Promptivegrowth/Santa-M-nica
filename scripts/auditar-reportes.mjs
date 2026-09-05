/**
 * ============================================================================
 *  AUDITORÍA DE LOS REPORTES · ¿dicen la verdad?
 * ============================================================================
 *  Las pruebas de descarga comprueban que el archivo baje y tenga forma. Esto
 *  comprueba otra cosa, que es la que importa: que las CIFRAS del Excel sean
 *  las mismas que las de la base, y que las columnas de dinero estén todas en
 *  la misma moneda.
 *
 *  Hay que generar los reportes antes:
 *      node scripts/probar-excel.mjs
 *      node scripts/auditar-reportes.mjs
 * ============================================================================
 */
import ExcelJS from 'exceljs';
import { ejecutarSQL } from './db.mjs';

const consultar = async (sql) => {
  const r = await ejecutarSQL(sql);
  return Array.isArray(r) ? r : [];
};

const fallos = [];
const ok = (cond, texto, detalle = '') => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${texto}${detalle ? ' · ' + detalle : ''}`);
  if (!cond) fallos.push(texto);
};

/** Abre un reporte y devuelve sus cabeceras y sus filas de datos. */
async function abrir(nombre) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(`reportes-prueba/${nombre}.xlsx`);
  const hoja = wb.worksheets[0];

  /*
   * La cabecera es la primera fila con al menos cuatro títulos DISTINTOS.
   * Lo de «distintos» no es un detalle: encima va el título del reporte en una
   * celda fusionada, y una celda fusionada devuelve el mismo texto repetido en
   * cada columna que ocupa. Contando solo celdas llenas, ese título pasaba por
   * cabecera y todas las lecturas salían en cero.
   */
  let filaCab = 0;
  hoja.eachRow((fila, n) => {
    if (filaCab) return;
    const textos = fila.values.filter((v) => typeof v === 'string' && v.trim());
    if (new Set(textos).size >= 4) filaCab = n;
  });

  const cabeceras = hoja.getRow(filaCab).values.map((v) => String(v ?? '').trim());

  /*
   * El reporte cierra con una fila de TOTALES. Hay que dejarla fuera de los
   * datos: sumándola, cada cifra salía exactamente al doble —que es como se
   * detectó este detalle—. Se devuelve aparte, porque comprobar que el total
   * impreso cuadre con las filas es justamente una de las cosas que interesa.
   */
  const filas = [];
  let totales = null;
  for (let n = filaCab + 1; n <= hoja.rowCount; n++) {
    const fila = hoja.getRow(n).values;
    const primera = String(fila.find((v) => typeof v === 'string') ?? '');
    if (/^total/i.test(primera.trim())) { totales = fila; continue; }
    filas.push(fila);
  }
  return { hoja, cabeceras, filas, totales, filaCab };
}

const suma = (filas, indice) =>
  filas.reduce((s, f) => {
    const v = f[indice];
    return typeof v === 'number' ? s + v : s;
  }, 0);

const cerca = (a, b, tol = 1) => Math.abs(a - b) <= tol;

console.log('\n─── Cuentas por cobrar ───');
{
  const { cabeceras, filas, totales } = await abrir('cuentas_cobrar');
  console.log('   columnas:', cabeceras.filter(Boolean).join(' · '));

  ok(cabeceras.some((c) => /Total US\$/i.test(c)), 'la columna de total dice que va en dólares');
  ok(cabeceras.some((c) => /Saldo US\$/i.test(c)), 'la columna de saldo dice que va en dólares');
  ok(cabeceras.some((c) => /^Moneda$/i.test(c)), 'se conserva a la vista la moneda de cada factura');

  const iSaldo = cabeceras.findIndex((c) => /Saldo US\$/i.test(c));
  const delExcel = suma(filas, iSaldo);
  ok(totales !== null && cerca(Number(totales[iSaldo] ?? 0), delExcel, 2),
     'la fila de TOTALES del Excel cuadra con la suma de sus filas');
  const [{ saldo }] = await consultar(
    `select round(sum(saldo_usd)::numeric, 2) as saldo from v_cuentas_cobrar`);
  ok(cerca(delExcel, Number(saldo), Math.max(2, Number(saldo) * 0.0001)),
     'el saldo del Excel coincide con el de la base',
     `Excel ${Math.round(delExcel).toLocaleString('es-PE')} · base ${Math.round(Number(saldo)).toLocaleString('es-PE')}`);
}

console.log('\n─── Pedidos y su avance ───');
{
  const { cabeceras, filas } = await abrir('pedidos');
  ok(cabeceras.some((c) => /Venta US\$/i.test(c)), 'trae el valor de la venta, en dólares');

  const iVenta = cabeceras.findIndex((c) => /Venta US\$/i.test(c));
  const delExcel = suma(filas, iVenta);
  const [{ venta }] = await consultar(
    `select round(sum(venta_usd)::numeric, 2) as venta from v_pedidos_tablero`);
  ok(cerca(delExcel, Number(venta), Math.max(2, Number(venta) * 0.0001)),
     'la venta del Excel coincide con la de la base',
     `Excel ${Math.round(delExcel).toLocaleString('es-PE')} · base ${Math.round(Number(venta)).toLocaleString('es-PE')}`);
}

console.log('\n─── Rentabilidad por pedido ───');
{
  const { cabeceras, filas } = await abrir('rentabilidad');
  console.log('   columnas:', cabeceras.filter(Boolean).join(' · '));
  const iVenta = cabeceras.findIndex((c) => /^Venta$/i.test(c));
  const iMargen = cabeceras.findIndex((c) => /^Margen$/i.test(c));

  const ventaExcel = suma(filas, iVenta);
  /* Sin filtro de ciclo: el REPORTE exporta la vista entera. La pantalla sí
     se queda solo con lo despachado, pero eso es de la pantalla. */
  const [{ venta, margen }] = await consultar(
    `select round(sum(venta)::numeric,2) as venta, round(sum(margen)::numeric,2) as margen
       from v_rentabilidad_pedido`);

  ok(cerca(ventaExcel, Number(venta), Math.max(2, Number(venta) * 0.0001)),
     'la venta del Excel coincide con la de la base',
     `Excel ${Math.round(ventaExcel).toLocaleString('es-PE')} · base ${Math.round(Number(venta)).toLocaleString('es-PE')}`);

  ok(cerca(suma(filas, iMargen), Number(margen), Math.max(2, Math.abs(Number(margen)) * 0.0001)),
     'el margen del Excel coincide con el de la base');
}

console.log('\n─── Inventario valorizado · el costo sigue en dólares ───');
{
  const { cabeceras, filas } = await abrir('valorizado');
  const iValor = cabeceras.findIndex((c) => /valor/i.test(c));
  ok(iValor > 0, 'el reporte trae una columna de valor');
  const total = suma(filas, iValor);
  ok(total > 0 && total < 100_000_000,
     'el valor del inventario está en un orden de magnitud razonable',
     `US$ ${Math.round(total).toLocaleString('es-PE')}`);
}

console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nLos reportes dicen la verdad');
process.exit(fallos.length ? 1 : 0);
