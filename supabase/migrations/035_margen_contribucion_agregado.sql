-- ============================================================================
--  035 · EL MARGEN DE CONTRIBUCIÓN, SUMADO
-- ============================================================================
--  `v_margen_contribucion` da el margen línea por línea, que es donde se
--  calcula. Estas dos vistas lo agregan por pedido y por familia de producto,
--  que es como se mira.
--
--  UNA DECISIÓN QUE CONVIENE ENTENDER
--  Las líneas SIN COSTO cargado quedan fuera de los totales, no dentro con un
--  cero. Un cero diría que ese producto se produce gratis y subiría el margen
--  de todo el grupo; dejarlas fuera y decir cuántas son es lo honesto. Por eso
--  cada fila lleva `lineas_sin_costo`: el número que dice hasta qué punto se
--  puede confiar en el resto.
-- ============================================================================


-- ============================================================================
--  1. POR PEDIDO
-- ============================================================================
create or replace view v_margen_contribucion_pedido as
select
  m.pedido_id,
  m.numero_proforma,
  m.cliente_id,
  m.cliente,
  m.fecha_solicitada,
  m.ciclo,

  count(*)                                        as lineas,
  count(*) filter (where m.sin_costo)              as lineas_sin_costo,
  sum(m.cantidad_tm)                               as tm,
  sum(m.cantidad_tm) filter (where not m.sin_costo) as tm_medibles,

  -- Todo lo que se suma excluye las líneas sin costo: mezclarlas daría un
  -- margen inflado sin que se notara.
  sum(m.precio_tm * m.cantidad_tm) filter (where not m.sin_costo)           as venta,
  sum(m.materia_prima_tm * m.cantidad_tm) filter (where not m.sin_costo)    as materia_prima,
  sum(m.conversion_tm * m.cantidad_tm) filter (where not m.sin_costo)       as conversion,
  sum(m.variable_tm * m.cantidad_tm) filter (where not m.sin_costo)         as variable,
  sum(m.costo_produccion_tm * m.cantidad_tm) filter (where not m.sin_costo) as costo_produccion,
  sum(m.margen_linea) filter (where not m.sin_costo)                        as margen,

  case
    when coalesce(sum(m.precio_tm * m.cantidad_tm) filter (where not m.sin_costo), 0) > 0
    then round(100 * sum(m.margen_linea) filter (where not m.sin_costo)
               / sum(m.precio_tm * m.cantidad_tm) filter (where not m.sin_costo), 2)
    else null
  end                                              as margen_pct
from v_margen_contribucion m
group by m.pedido_id, m.numero_proforma, m.cliente_id, m.cliente,
         m.fecha_solicitada, m.ciclo;

comment on view v_margen_contribucion_pedido is
  'Margen de contribución por pedido. Las líneas sin costo cargado NO entran en los totales —un cero inflaría el margen— y se cuentan aparte en `lineas_sin_costo`.';


-- ============================================================================
--  2. POR FAMILIA DE PRODUCTO
--  Es la vista que responde a la pregunta de fondo: qué familia deja margen y
--  cuál se está vendiendo por debajo de lo que cuesta producirla.
-- ============================================================================
create or replace view v_margen_contribucion_familia as
select
  m.familia,
  count(distinct m.sku_id)                         as productos,
  count(*)                                         as lineas,
  count(*) filter (where m.sin_costo)              as lineas_sin_costo,
  sum(m.cantidad_tm) filter (where not m.sin_costo) as tm,

  sum(m.precio_tm * m.cantidad_tm) filter (where not m.sin_costo)           as venta,
  sum(m.materia_prima_tm * m.cantidad_tm) filter (where not m.sin_costo)    as materia_prima,
  sum(m.conversion_tm * m.cantidad_tm) filter (where not m.sin_costo)       as conversion,
  sum(m.variable_tm * m.cantidad_tm) filter (where not m.sin_costo)         as variable,
  sum(m.costo_produccion_tm * m.cantidad_tm) filter (where not m.sin_costo) as costo_produccion,
  sum(m.margen_linea) filter (where not m.sin_costo)                        as margen,

  case
    when coalesce(sum(m.precio_tm * m.cantidad_tm) filter (where not m.sin_costo), 0) > 0
    then round(100 * sum(m.margen_linea) filter (where not m.sin_costo)
               / sum(m.precio_tm * m.cantidad_tm) filter (where not m.sin_costo), 2)
    else null
  end                                              as margen_pct
from v_margen_contribucion m
group by m.familia;

comment on view v_margen_contribucion_familia is
  'Margen de contribución por familia comercial. Responde a qué familia deja margen y cuál se vende por debajo de lo que cuesta producirla.';
