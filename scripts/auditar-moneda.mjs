/**
 * ============================================================================
 *  AUDITORÍA DEL TIPO DE CAMBIO Y DE LOS IMPORTES
 * ============================================================================
 *  Comprueba, contra la base de verdad, lo que una prueba de pantalla no
 *  alcanza a ver: que el candado exista y funcione, que las vistas conviertan,
 *  que la función de PostgreSQL y su gemela de TypeScript den el mismo número,
 *  y que no quede ningún importe mezclando monedas.
 *
 *      node scripts/auditar-moneda.mjs
 * ============================================================================
 */
import { ejecutarSQL } from './db.mjs';
import { aDolares, TIPO_CAMBIO_MINIMO } from '../src/lib/moneda.ts';

/* Se importa el .ts directamente para comparar la función real de la
   aplicación contra la de PostgreSQL, no una copia que podría divergir.
   Hace falta arrancar con:  node --experimental-strip-types  */
const consultar = async (sql) => {
  const r = await ejecutarSQL(sql);
  return Array.isArray(r) ? r : [];
};

const fallos = [];
const ok = (cond, texto, detalle = '') => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${texto}${detalle ? ' · ' + detalle : ''}`);
  if (!cond) fallos.push(texto);
};

const uno = async (sql) => (await consultar(sql))[0];

console.log('\n─── 1 · El dato, normalizado ───');
for (const tabla of ['cotizaciones', 'pedidos', 'facturas']) {
  const r = await uno(`select count(*) as malos, min(tipo_cambio) as minimo, max(tipo_cambio) as maximo
                         from ${tabla} where tipo_cambio < ${TIPO_CAMBIO_MINIMO}`);
  const rango = await uno(`select min(tipo_cambio) as lo, max(tipo_cambio) as hi from ${tabla}`);
  ok(Number(r.malos) === 0, `${tabla}: ningún tipo de cambio imposible`,
     `rango ${rango.lo} – ${rango.hi}`);
}

console.log('\n─── 2 · El candado de la base ───');
for (const tabla of ['cotizaciones', 'pedidos', 'facturas']) {
  const r = await uno(`select count(*) as n from information_schema.check_constraints cc
                        join information_schema.constraint_column_usage u
                          on u.constraint_name = cc.constraint_name
                       where u.table_name = '${tabla}' and u.column_name = 'tipo_cambio'`);
  ok(Number(r.n) > 0, `${tabla}: tiene CHECK sobre tipo_cambio`);

  const d = await uno(`select column_default as def, is_nullable as nulo
                         from information_schema.columns
                        where table_name='${tabla}' and column_name='tipo_cambio'`);
  ok(d.def === null, `${tabla}: sin DEFAULT silencioso`);
}

// Que el candado de verdad rechace. Se intenta y se espera el error.
{
  let rechazado = false;
  try {
    await consultar(`do $$ begin
      update pedidos set tipo_cambio = 1 where id = (select min(id) from pedidos);
    end $$;`);
  } catch { rechazado = true; }
  ok(rechazado, 'guardar un tipo de cambio de 1 es rechazado por la base');
}

console.log('\n─── 3 · La función y su gemela en TypeScript ───');
{
  const muestra = await consultar(`
    select p.moneda, p.tipo_cambio, pl.precio_tm,
           round(a_dolares(pl.precio_tm, p.moneda, p.tipo_cambio), 6) as sql_usd
      from pedidos p join pedido_lineas pl on pl.pedido_id = p.id
     order by p.id limit 200`);
  const distintos = muestra.filter((r) => {
    const ts = aDolares(Number(r.precio_tm), r.moneda, Number(r.tipo_cambio));
    return Math.abs(ts - Number(r.sql_usd)) > 0.00001;
  });
  ok(distintos.length === 0,
     'a_dolares() de PostgreSQL y aDolares() de TypeScript coinciden',
     `${muestra.length} filas comparadas`);
}

console.log('\n─── 4 · Las vistas convierten ───');
{
  const vistas = await consultar(`
    select table_name as vista, (view_definition ilike '%a_dolares%') as convierte
      from information_schema.views
     where table_schema='public'
       and (view_definition ilike '%precio_tm%' or view_definition ilike '%f.total%'
         or view_definition ilike '%subtotal%' or view_definition ilike '%cobranzas%')
     order by 1`);
  for (const v of vistas) {
    ok(v.convierte === true, `${v.vista}: convierte a dólares`);
  }
}

console.log('\n─── 5 · Los números cuadran ───');
{
  // La venta en dólares de la vista contra el mismo cálculo hecho aparte
  const r = await uno(`
    with propio as (
      select p.id,
             a_dolares(sum(pl.cantidad_tm * pl.precio_tm * (1 - pl.descuento_pct/100)),
                       p.moneda, p.tipo_cambio) as usd
        from pedidos p join pedido_lineas pl on pl.pedido_id = p.id
       group by p.id
    )
    select count(*) as desviados
      from propio join v_pedidos_tablero v on v.id = propio.id
     where abs(coalesce(v.venta_usd,0) - coalesce(propio.usd,0)) > 0.01`);
  ok(Number(r.desviados) === 0, 'v_pedidos_tablero.venta_usd cuadra con el cálculo directo');

  const c = await uno(`
    select count(*) as desviados from v_cuentas_cobrar
     where abs(total_usd - case when moneda='USD' then total else total/tipo_cambio end) > 0.01`);
  ok(Number(c.desviados) === 0, 'v_cuentas_cobrar: total_usd es la conversión correcta');

  const m = await uno(`
    select count(*) as desviados from v_rentabilidad_pedido
     where abs(margen - (venta - costo_estimado)) > 0.01`);
  ok(Number(m.desviados) === 0, 'v_rentabilidad_pedido: margen = venta − costo, ambos en dólares');
}

console.log('\n─── 6 · Los importes en soles son soles ───');
{
  // Convertidos a dólares, los precios de los documentos en soles tienen que
  // caer en la misma banda que los de los documentos en dólares. Si no, es que
  // se guardaron con magnitud de dólares en un campo de soles.
  const r = await uno(`
    select round(avg(a_dolares(pl.precio_tm, p.moneda, p.tipo_cambio)) filter (where p.moneda='PEN')) as pen_usd,
           round(avg(a_dolares(pl.precio_tm, p.moneda, p.tipo_cambio)) filter (where p.moneda='USD')) as usd_usd
      from pedidos p join pedido_lineas pl on pl.pedido_id = p.id`);
  const pen = Number(r.pen_usd), usd = Number(r.usd_usd);
  const razon = pen / usd;
  ok(razon > 0.5 && razon < 2,
     'los precios en soles, convertidos, están en la banda de los de dólares',
     `PEN→US$ ${pen} vs US$ ${usd}`);

  /*
   * LA PRUEBA QUE DE VERDAD DEMUESTRA QUE LA MONEDA ESTÁ BIEN
   *
   * No es «que no haya márgenes negativos» —los hay, y por otro motivo: el
   * sembrado genera el precio y el costo estimado de forma independiente, así
   * que a uno de cada nueve pedidos le toca un costo por encima del precio, y
   * eso pasa igual en dólares que en soles—.
   *
   * Lo que prueba que la conversión es correcta es que las DOS MONEDAS SE
   * COMPORTEN IGUAL. Si los soles estuvieran mal convertidos, su margen medio
   * se hundiría respecto al de los dólares. Mientras las dos medias se
   * parezcan, la conversión está haciendo su trabajo.
   */
  const dist = await consultar(`
    select moneda,
           round(avg(margen_pct),1) as medio,
           round(100.0 * count(*) filter (where margen_pct < 0) / count(*), 1) as pct_negativos
      from v_rentabilidad_pedido group by moneda order by moneda`);
  const mPen = dist.find((d) => d.moneda === 'PEN');
  const mUsd = dist.find((d) => d.moneda === 'USD');
  const brecha = Math.abs(Number(mPen.medio) - Number(mUsd.medio));
  ok(brecha < 10,
     'el margen medio en soles y en dólares se parece — la conversión funciona',
     `PEN ${mPen.medio} % vs USD ${mUsd.medio} %, brecha ${brecha.toFixed(1)} puntos`);
  ok(Math.abs(Number(mPen.pct_negativos) - Number(mUsd.pct_negativos)) < 15,
     'la proporción de márgenes negativos es parecida en las dos monedas',
     `PEN ${mPen.pct_negativos} % vs USD ${mUsd.pct_negativos} %`);
}

console.log('\n─── 7 · El costo sigue siendo dólares y nadie lo tocó ───');
{
  const r = await uno(`
    select round(min(costo_unitario),2) as lo, round(max(costo_unitario),2) as hi,
           round(avg(costo_unitario),2) as med from lotes where costo_unitario > 0`);
  ok(Number(r.hi) < 20,
     'el costo por kilo sigue en dólares (no se multiplicó por el tipo de cambio)',
     `US$ ${r.lo} – ${r.hi}, medio ${r.med}`);
}

console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nAuditoría limpia');
process.exit(fallos.length ? 1 : 0);
