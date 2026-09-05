-- ============================================================================
--  030 · LOS CONTENEDORES, NUMERADOS DENTRO DE SU PROFORMA
-- ============================================================================
--  De la reunión con Oliver, explicado por él con todo detalle:
--
--    «Si yo tengo un pedido de 135 toneladas, mi control de pedido sería el
--     338 segundo contenedor, 338 tercer contenedor. ¿Se puede hacer eso, o
--     sea dividir básicamente en números de contenedores? [...] Porque
--     básicamente es la misma información que manejan todos, para evitar
--     errores.»
--
--  Hoy el contenedor se llama «PL POT405»: un correlativo global que no dice
--  nada del pedido al que pertenece. Para el almacén y para el cliente, en
--  cambio, la referencia natural es la proforma más el número de contenedor.
--
--  EL CÓDIGO PROPIO DEL CONTENEDOR NO SE TOCA
--  «PL POT405» sigue siendo su identificador y es el que va en los documentos.
--  Lo que se añade es una FORMA DE NOMBRARLO desde el pedido: SM26-338 / 2.
--  Son dos cosas distintas y las dos hacen falta.
--
--  UN CONTENEDOR PUEDE LLEVAR DOS PROFORMAS
--  Cuando un embarque consolida dos pedidos, el mismo contenedor físico es el
--  «1» de una proforma y el «1» de la otra. No es una contradicción: la
--  numeración es relativa al pedido que se está mirando, que es justo como lo
--  planteó Oliver. La vista incluye cuántas proformas lleva dentro para que la
--  pantalla lo pueda advertir.
-- ============================================================================
create or replace view v_pedido_contenedores as
with base as (
  select
    ep.pedido_id,
    p.numero_proforma,
    pk.id                       as packing_list_id,
    pk.codigo                   as packing_codigo,
    pk.contenedor,
    pk.precinto,
    pk.estado                   as estado_packing,
    pk.fecha_carga,
    e.id                        as embarque_id,
    e.numero                    as embarque,
    e.fecha_programada,
    e.estado                    as estado_embarque,
    ds.puerto                   as destino,
    d.id                        as despacho_id,
    d.numero                    as despacho,
    (d.fecha_salida at time zone 'America/Lima')::date as fecha_salida,

    /*
     * El orden dentro de la proforma: por el día previsto de salida y, si dos
     * caen el mismo día, por el identificador. Tiene que ser estable, porque
     * este número acaba impreso y comentado por teléfono: si mañana el
     * «338 / 2» fuera otro contenedor, la numeración no serviría para nada.
     */
    row_number() over (
      partition by ep.pedido_id
      order by e.fecha_programada, pk.id
    )                           as secuencia,
    count(*) over (partition by ep.pedido_id) as total_contenedores,

    -- Cuántas proformas viajan en este mismo contenedor.
    (select count(distinct ep2.pedido_id)
       from embarque_pedidos ep2 where ep2.embarque_id = e.id) as proformas_dentro
  from embarque_pedidos ep
  join pedidos p        on p.id = ep.pedido_id
  join embarques e      on e.id = ep.embarque_id and e.estado <> 'cancelado'
  join packing_lists pk on pk.embarque_id = e.id and pk.estado <> 'anulado'
  left join destinos ds on ds.id = e.destino_id
  left join despachos d on d.packing_list_id = pk.id
)
select
  b.*,
  /*
   * La etiqueta tal como Oliver la escribió: «338-1, 338-2». Se arma aquí y no
   * en cada pantalla para que todas la escriban igual.
   *
   * Se usa GUION y no barra a propósito: la proforma ya puede llevar una barra
   * propia cuando el pedido viene partido —«SM26-147/5»—, y «SM26-147/5 / 2»
   * no hay quien lo lea. Con guion queda «SM26-147/5-2»: la barra es del
   * pedido, el guion final es el contenedor.
   */
  b.numero_proforma || '-' || b.secuencia     as referencia,
  coalesce(c.bultos, 0)                       as bultos,
  coalesce(c.peso_kg, 0) / 1000               as tm,
  coalesce(c.lotes, 0)                        as lotes
from base b
left join lateral (
  select count(*)              as lotes,
         sum(pl.bultos)        as bultos,
         sum(pl.peso_neto_kg)  as peso_kg
    from packing_lineas pl
   where pl.packing_list_id = b.packing_list_id
) c on true;

comment on view v_pedido_contenedores is
  'Los contenedores de cada proforma, numerados dentro de ella: SM26-338 / 1, / 2… El código propio del packing («PL POT405») no cambia. Si un contenedor consolida dos proformas, aparece en las dos con su propia secuencia, y `proformas_dentro` lo indica.';
