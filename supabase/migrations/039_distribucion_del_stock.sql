-- ============================================================================
--  039 · CÓMO SE REPARTE EL STOCK, AGRUPADO EN LA BASE
-- ============================================================================
--  Oliver: «en las existencias, igual una visual, pero por grupo de PT: filete
--  trescientas toneladas, aleta doscientas».
--
--  POR QUÉ UNA VISTA Y NO UNA SUMA EN LA PANTALLA
--  Porque la API de Supabase devuelve como mucho MIL FILAS por consulta, y el
--  tope no se puede subir desde el cliente: pedir `limit(5000)` devuelve mil
--  igual. Con 1 519 lotes en cámara, agrupar en memoria dejaba fuera un tercio
--  del inventario sin dar ningún aviso — el gráfico salía, con cifras
--  razonables, y estaba mal.
--
--  Agrupar donde están los datos no tiene ese problema, y de paso no hace
--  viajar mil quinientas filas para pintar diez barras.
-- ============================================================================
create or replace view v_stock_distribucion as
select
  'formato'::text               as eje,
  formato                       as grupo,
  count(*)                      as lotes,
  coalesce(sum(fisico_kg), 0)   as fisico_kg,
  coalesce(sum(disponible_kg), 0) as disponible_kg,
  coalesce(sum(valor), 0)       as valor
from v_anticuamiento
where fisico_kg > 0
group by formato

union all

select
  'familia', familia, count(*),
  coalesce(sum(fisico_kg), 0), coalesce(sum(disponible_kg), 0), coalesce(sum(valor), 0)
from v_anticuamiento
where fisico_kg > 0
group by familia

union all

select
  'especie', especie, count(*),
  coalesce(sum(fisico_kg), 0), coalesce(sum(disponible_kg), 0), coalesce(sum(valor), 0)
from v_anticuamiento
where fisico_kg > 0
group by especie;

comment on view v_stock_distribucion is
  'El stock en cámara agrupado por formato, familia comercial y especie, los tres ejes en una sola vista. Se agrupa en la base porque la API corta en mil filas y hacerlo en la pantalla dejaba fuera un tercio del inventario sin avisar.';
