-- ============================================================================
--  045 · EL CONTENEDOR SE NUMERA CON BARRA, NO CON GUION
-- ============================================================================
--  QUÉ ESTABA MAL Y POR QUÉ
--  En la migración 030 escribí la referencia del contenedor con GUION
--  —«SM26-338-2»— y dejé escrito el motivo: que la proforma podía llevar una
--  barra propia, y «SM26-147/5 / 2» no hay quien lo lea.
--
--  Ese motivo era falso, y lo era por culpa nuestra: la SEMILLA inventaba
--  proformas con una barra dentro. Le añadía «/n» al 30 % de ellas —112 de
--  443— y yo diseñé alrededor de un dato que me había inventado yo mismo.
--
--  LA DATA REAL LO DESMIENTE
--  En el maestro que mandó Oliver, la columna PROFORMA no lleva barra en
--  NINGUNA de sus 20 342 filas. Ni una. La barra es justamente lo que separa
--  el contenedor:
--
--        PROFORMA      SM26-225
--        PROFORMA_FCL  SM26-225/1, SM26-225/2, … SM26-225/17
--
--  Es decir: el «/n» que la semilla pegaba al número de proforma ERA el número
--  de contenedor. Estaba tomando la respuesta por la pregunta.
--
--  Y esto importa más de lo que parece. Oliver pidió esta numeración con una
--  razón concreta: «es la misma información que manejan todos, para evitar
--  errores». Una referencia que se escribe distinto en el sistema y en el
--  correo del cliente no evita errores: los crea.
--
--  QUÉ SE HACE
--   1. Se quita la barra inventada de los números de proforma.
--   2. Se prohíbe que vuelva a entrar.
--   3. Se rehace la referencia con barra, como en la realidad.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
--  1 · UNA COLISIÓN QUE HAY QUE RESOLVER ANTES
-- ────────────────────────────────────────────────────────────────────────────
--  Al quitar el sufijo, «SM26-421/1» pasaría a llamarse «SM26-421», que ya
--  existe. Es un choque y solo uno: el resto de los 112 sufijos son únicos.
--  Se renumera el intruso al final de la serie en lugar de borrarlo, porque
--  detrás hay líneas, reservas y packing que no tienen ninguna culpa.
update pedidos p
   set numero_proforma = 'SM26-' || (
         select max(nullif(regexp_replace(split_part(numero_proforma, '/', 1),
                                          '^SM26-', ''), '')::int) + 1
           from pedidos)
 where p.numero_proforma like '%/%'
   and exists (
     select 1 from pedidos q
      where q.numero_proforma = split_part(p.numero_proforma, '/', 1)
   );


-- ────────────────────────────────────────────────────────────────────────────
--  2 · FUERA LA BARRA INVENTADA
-- ────────────────────────────────────────────────────────────────────────────
update pedidos
   set numero_proforma = split_part(numero_proforma, '/', 1)
 where numero_proforma like '%/%';


-- ────────────────────────────────────────────────────────────────────────────
--  3 · Y QUE NO VUELVA
-- ────────────────────────────────────────────────────────────────────────────
--  La barra queda reservada para separar el contenedor. Si algún día un
--  número de proforma real la lleva dentro, esto fallará en voz alta —que es
--  lo que se quiere— en lugar de producir una referencia que nadie sabe leer.
alter table pedidos drop constraint if exists pedidos_proforma_sin_barra;
alter table pedidos add constraint pedidos_proforma_sin_barra
  check (numero_proforma !~ '/');

comment on constraint pedidos_proforma_sin_barra on pedidos is
  'El número de proforma no lleva barra: la barra separa el contenedor dentro de la proforma (SM26-225/3). Comprobado en las 20 342 filas del maestro del cliente, donde no aparece ni una vez.';


-- ────────────────────────────────────────────────────────────────────────────
--  4 · LA REFERENCIA, COMO LA ESCRIBE EL CLIENTE
-- ────────────────────────────────────────────────────────────────────────────
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
     * «338/2» fuera otro contenedor, la numeración no serviría para nada.
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
   * «SM26-338/1», «SM26-338/2»: exactamente como aparece en la columna
   * PROFORMA_FCL del maestro del cliente. Se arma aquí y no en cada pantalla
   * para que todas la escriban igual.
   */
  b.numero_proforma || '/' || b.secuencia     as referencia,
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
  'Los contenedores de cada proforma, numerados dentro de ella: SM26-338/1, /2… tal como los escribe el cliente en su propio maestro. El código propio del packing («PL POT405») no cambia. Si un contenedor consolida dos proformas, aparece en las dos con su propia secuencia, y `proformas_dentro` lo indica.';
