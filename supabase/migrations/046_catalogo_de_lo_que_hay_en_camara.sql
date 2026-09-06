-- ============================================================================
--  046 · QUÉ ESPECIES, FORMATOS Y CORTES HAY HOY EN CÁMARA
-- ============================================================================
--  PARA QUÉ
--  Oliver pidió filtros de formato y de corte en Existencias. Para ofrecerlos
--  hay que saber qué valores existen, y hay dos formas de averiguarlo:
--
--   · Leer el maestro de productos entero. Ofrecería los 191 SKU y sus 126
--     cortes, incluidos los que no tienen ni un kilo en cámara. Filtrar por uno
--     de esos devuelve una pantalla vacía, y el usuario no sabe si es que no
--     hay stock o si el filtro está roto.
--
--   · Leer lo que REALMENTE hay. Es lo que hace esta vista.
--
--  POR QUÉ UNA VISTA Y NO UN «SELECT DISTINCT» DESDE LA PANTALLA
--  Porque para sacar los valores distintos habría que traerse los 1 519 lotes,
--  y la API de Supabase corta en mil filas sin avisar. Los cortes que
--  estuvieran solo en los lotes 1 001 en adelante desaparecerían del
--  desplegable —sin error, sin aviso— y nadie lo notaría hasta que alguien
--  buscara un producto que sí está y no lo encontrara.
--
--  Agrupar en la base devuelve doscientas filas en vez de mil quinientas y no
--  se le puede escapar ninguna.
-- ============================================================================
--  Lleva también el almacén y el rango de antigüedad porque el gráfico de
--  distribución tiene que responder a los MISMOS filtros que la tabla. Antes no
--  lo hacía: se filtraba por «Cámara 01» y el gráfico seguía pintando todo el
--  inventario, que es peor que no tener gráfico —enseña una cifra que no es la
--  que se está mirando—.
--  Se BORRA y se vuelve a crear en vez de usar «create or replace»: PostgreSQL
--  no deja insertar columnas en medio de una vista existente, solo añadirlas al
--  final. Aquí el almacén y el rango tienen que ir junto a los otros campos que
--  describen el grupo, no colgando detrás de los totales.
drop view if exists v_stock_catalogo;

create view v_stock_catalogo as
select
  especie,
  formato,
  corte,
  familia,
  almacen_id,
  rango,
  count(*)                      as lotes,
  coalesce(sum(fisico_kg), 0)   as fisico_kg,
  coalesce(sum(valor), 0)       as valor
from v_anticuamiento
where fisico_kg > 0
group by especie, formato, corte, familia, almacen_id, rango;

comment on view v_stock_catalogo is
  'Las combinaciones de especie, formato, corte, almacén y antigüedad que tienen stock ahora mismo, con sus kilos. Alimenta los desplegables de Existencias —se ofrecen solo los valores que devolverán algo— y el gráfico de distribución, que así responde a los mismos filtros que la tabla. Son unas mil filas en vez de mil quinientos lotes, y la pantalla las pagina porque la API corta en mil.';
