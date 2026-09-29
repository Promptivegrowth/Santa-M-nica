-- ============================================================================
--  058 · NECESIDADES DE PRODUCCIÓN = BACKORDER
-- ============================================================================
--  Documento de mejoras, punto 5:
--
--    «Mostrar las cantidades que faltan producir para completar los pedidos,
--     considerando los pedidos existentes y el stock disponible. Los productos
--     que se encuentren en Backorder por falta de stock deberán reflejarse
--     también como necesidad de producción.»
--
--  EL PROBLEMA QUE HABÍA
--  Existían dos cifras de «lo que falta» y no coincidían:
--
--    · v_necesidades (010) restaba al pedido COMPLETO el disponible del
--      producto. Pero del pedido ya puede haber salido una parte, o estar
--      reservada; y lo reservado para ese mismo pedido no cuenta como
--      disponible. Contaba dos veces lo que ya estaba resuelto.
--    · v_pedido_linea_cobertura (052) reparte el stock libre línea por línea,
--      por prioridad, y lo que queda sin cubrir es el backorder que se ve en
--      Control de pedidos.
--
--  Con la data de demostración: 21 438,6 TM una, 21 306,0 TM la otra. El
--  documento dice que el backorder ES la necesidad de producción, así que la
--  cifra buena es la segunda y ahora las dos pantallas enseñan la misma.
-- ============================================================================


-- ============================================================================
--  1. EL DETALLE: cada línea de pedido que espera producción
-- ============================================================================
--  En orden de dependencia: v_necesidades se apoya en la de producto, y esta
--  en la de línea. Así la migración se puede volver a aplicar.
drop view if exists v_necesidades;
drop view if exists v_produccion_necesidades;
drop view if exists v_produccion_necesidad_linea;

create view v_produccion_necesidad_linea as
select
  c.linea_id,
  c.pedido_id,
  p.numero_proforma,
  p.cliente_id,
  coalesce(cl.nombre_corto, cl.razon_social)                         as cliente,
  p.fecha_comprometida,
  c.prioridad,
  c.sku_presentacion_id,
  s.id                                                               as sku_id,
  s.codigo                                                           as sku_codigo,
  esp.nombre                                                         as especie,
  f.nombre                                                           as formato,
  s.corte,
  pr.descripcion                                                     as presentacion,
  --  La familia como la cuentan la cobertura y las alertas de stock.
  case when esp.nombre = 'POTA' then f.nombre
       else f.nombre || ' (' || lower(esp.nombre) || ')' end         as familia,
  c.pedido_kg,
  c.despachado_kg,
  c.reservado_kg,
  c.pendiente_kg,
  c.con_stock_kg,
  c.backorder_kg                                                     as producir_kg
from v_pedido_linea_cobertura c
join pedidos p             on p.id = c.pedido_id
join clientes cl           on cl.id = p.cliente_id
join sku_presentaciones sp on sp.id = c.sku_presentacion_id
join skus s                on s.id = sp.sku_id
join especies esp          on esp.id = s.especie_id
join formatos f            on f.id = s.formato_id
join presentaciones pr     on pr.id = sp.presentacion_id
where c.backorder_kg > 0;

comment on view v_produccion_necesidad_linea is
  'Cada línea de pedido confirmado con backorder: lo que falta producir para completarla después de repartir el stock libre por prioridad (v_pedido_linea_cobertura).';


-- ============================================================================
--  2. POR PRODUCTO
--  Con una columna más que el documento no pide pero que Producción va a
--  preguntar: cuánto de ese producto hay retenido por Calidad. Antes de
--  producir, conviene saber si hay pallets que podrían liberarse.
-- ============================================================================
create view v_produccion_necesidades as
with lineas as (
  select sku_presentacion_id, sku_id, sku_codigo, especie, formato, corte, presentacion, familia,
         sum(pendiente_kg)                 as pendiente_kg,
         sum(con_stock_kg)                 as cubierto_kg,
         sum(producir_kg)                  as producir_kg,
         count(distinct pedido_id)         as pedidos,
         count(distinct cliente_id)        as clientes,
         min(fecha_comprometida)           as fecha_mas_proxima
    from v_produccion_necesidad_linea
   group by sku_presentacion_id, sku_id, sku_codigo, especie, formato, corte, presentacion, familia
),
retenido as (
  select sku_presentacion_id, sum(bloqueado_kg) as retenido_kg
    from v_stock_lote
   group by sku_presentacion_id
)
select l.*, coalesce(r.retenido_kg, 0) as retenido_kg
from lineas l
left join retenido r on r.sku_presentacion_id = l.sku_presentacion_id;

comment on view v_produccion_necesidades is
  'Lo que falta producir por producto (= su backorder), cuántos pedidos y clientes esperan, la fecha comprometida más próxima y el stock del mismo producto retenido por Calidad.';


-- ============================================================================
--  3. v_necesidades, CON LA MISMA CIFRA
--  Mismas columnas que antes, para no romper la pantalla vieja ni el reporte
--  en Excel; ahora salen del reparto por prioridad.
--    tm_pedidas     → lo que falta entregar (ni despachado ni reservado)
--    tm_disponibles → la parte de eso que el stock libre sí cubre
--    tm_faltantes   → el backorder: lo que hay que producir
-- ============================================================================
drop view if exists v_necesidades;
create view v_necesidades as
select
  n.sku_presentacion_id,
  n.sku_codigo,
  n.especie,
  n.formato,
  n.corte,
  n.presentacion,
  --  Sin redondear: redondear cada producto a gramos desviaba el total unos
  --  kilos respecto del backorder. Redondea quien lo enseña.
  n.pendiente_kg / 1000            as tm_pedidas,
  n.cubierto_kg / 1000             as tm_disponibles,
  n.producir_kg / 1000             as tm_faltantes,
  n.pedidos,
  n.fecha_mas_proxima
from v_produccion_necesidades n;

comment on view v_necesidades is
  'Compatibilidad: lo mismo que v_produccion_necesidades en toneladas. tm_faltantes es el backorder del producto, la misma cifra que Control de pedidos.';
