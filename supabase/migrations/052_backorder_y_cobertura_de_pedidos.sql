-- ============================================================================
--  052 · BACKORDER: LO QUE FALTA POR FALTA DE STOCK, PEDIDO A PEDIDO
-- ============================================================================
--  Del documento de mejoras, Control de Pedidos:
--
--    «Pedidos pendientes: pedidos que aún no se atienden, pero sí existe
--     stock disponible.
--     Backorder: cantidad pendiente de atender por falta de stock.
--     Diferenciarla de pedidos pendientes que sí cuentan con existencia.»
--
--  LA DIFICULTAD: EL STOCK SE COMPARTE
--  Si dos pedidos piden el mismo filete y solo hay para uno, los dos no pueden
--  contar como «pendientes con stock». Sumar lo pedido contra lo disponible por
--  producto —que es lo que hace la vista de necesidades— responde cuánto falta
--  EN TOTAL, pero no a QUÉ PEDIDO le falta. Y el backorder se pide pedido a
--  pedido: «al ingresar a Backorder se deberán mostrar los pedidos, clientes,
--  productos y cantidades».
--
--  Así que hay que REPARTIR el stock libre entre los pedidos, en un orden. El
--  orden es el que ya usa el negocio: primero la prioridad —urgente, alta,
--  normal, baja—, y dentro de la misma prioridad, el que tiene la fecha
--  comprometida más próxima. Es el mismo criterio con el que se reserva a
--  mano, así que el sistema asigna lo que asignaría una persona.
--
--  QUÉ CUBRE A UN PEDIDO, EN ESTE ORDEN
--   1. Lo ya DESPACHADO: reservas consumidas. Eso ya no está pendiente.
--   2. Lo RESERVADO para él: reservas activas o en preparación. Ese stock ya
--      tiene dueño y es suyo, pase lo que pase con los demás.
--   3. El STOCK LIBRE del producto, repartido según la prioridad.
--  Lo que quede sin cubrir es BACKORDER.
--
--  No hay doble conteo: el stock libre de `v_disponibilidad` ya descuenta lo
--  reservado, lo bloqueado por calidad y lo que está en preparación.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
--  1 · LÍNEA A LÍNEA
-- ────────────────────────────────────────────────────────────────────────────
create or replace view v_pedido_linea_cobertura as
with lineas as (
  select
    pl.id                         as linea_id,
    pl.pedido_id,
    pl.sku_presentacion_id,
    pl.cantidad_tm * 1000         as pedido_kg,
    coalesce(r.despachado_kg, 0)  as despachado_kg,
    coalesce(r.reservado_kg, 0)   as reservado_kg,
    p.prioridad,
    p.fecha_comprometida,
    --  La prioridad como número, para poder ordenar. Un enum se ordena por su
    --  posición de declaración, y no conviene depender de en qué orden se
    --  escribió en una migración de hace meses.
    case p.prioridad
      when 'urgente' then 1 when 'alta' then 2
      when 'normal'  then 3 when 'baja' then 4 else 5
    end                           as rango_prioridad
  from pedido_lineas pl
  join pedidos p on p.id = pl.pedido_id
  left join lateral (
    select
      sum(rv.peso_neto_kg) filter (where rv.estado = 'consumida')                       as despachado_kg,
      sum(rv.peso_neto_kg) filter (where rv.estado in ('activa', 'en_preparacion'))     as reservado_kg
    from reservas rv
    where rv.pedido_linea_id = pl.id
  ) r on true
  --  Solo lo que está vivo: un borrador no es un compromiso y un pedido
  --  despachado o cancelado ya no espera stock.
  where p.ciclo = 'confirmado'
),
pendiente as (
  select
    l.*,
    greatest(l.pedido_kg - l.despachado_kg, 0)                              as pendiente_kg,
    --  Lo que falta después de lo que ya tiene reservado.
    greatest(l.pedido_kg - l.despachado_kg - l.reservado_kg, 0)             as sin_reservar_kg
  from lineas l
),
repartido as (
  select
    p.*,
    coalesce(libre.kg, 0) as libre_producto_kg,
    --  Cuánto piden ANTES que esta línea los que van por delante en la cola
    --  del mismo producto. Es lo que ya se llevaron del stock libre.
    coalesce(sum(p.sin_reservar_kg) over (
      partition by p.sku_presentacion_id
      order by p.rango_prioridad, p.fecha_comprometida nulls last, p.pedido_id, p.linea_id
      rows between unbounded preceding and 1 preceding
    ), 0) as pedido_antes_kg
  from pendiente p
  left join lateral (
    select sum(d.disponible_kg) as kg
      from v_disponibilidad d
     where d.sku_presentacion_id = p.sku_presentacion_id
  ) libre on true
)
select
  linea_id,
  pedido_id,
  sku_presentacion_id,
  prioridad,
  pedido_kg,
  despachado_kg,
  reservado_kg,
  pendiente_kg,
  --  Del stock libre que queda cuando le llega el turno, lo que puede tomar.
  least(sin_reservar_kg, greatest(libre_producto_kg - pedido_antes_kg, 0))  as cubre_libre_kg,
  --  Todo lo que tiene con qué atenderse: reservado + libre asignado.
  least(pendiente_kg,
        reservado_kg + least(sin_reservar_kg, greatest(libre_producto_kg - pedido_antes_kg, 0)))
                                                                             as con_stock_kg,
  --  Y lo que no: el backorder.
  greatest(sin_reservar_kg - greatest(libre_producto_kg - pedido_antes_kg, 0), 0)
                                                                             as backorder_kg
from repartido;

comment on view v_pedido_linea_cobertura is
  'Cada línea de pedido confirmado, con cuánto tiene cubierto y cuánto está en backorder. El stock libre se reparte entre los pedidos por prioridad y luego por fecha comprometida, que es el mismo criterio con el que se reserva a mano. Sin reparto, dos pedidos que piden el mismo producto contarían los dos con el stock que solo alcanza para uno.';


-- ────────────────────────────────────────────────────────────────────────────
--  2 · PEDIDO A PEDIDO, CON SU SITUACIÓN
-- ────────────────────────────────────────────────────────────────────────────
--  PENDIENTE CON STOCK Y BACKORDER NO SON EXCLUYENTES.
--  La primera versión los hacía excluyentes —«o lo tiene todo o está en
--  backorder»— y el resultado en la base fue: 131 pedidos en backorder y
--  CERO pendientes con stock. Parecía que no había nada que despachar.
--
--  Era falso. 110 de esos 131 pedidos tienen stock para UNA PARTE —1 222 TM
--  entre todos— que podría salir hoy mismo. La regla los escondía porque les
--  faltaba otra parte.
--
--  El documento lo dice bien: el backorder es una CANTIDAD («cantidad
--  pendiente de atender por falta de stock»), no una etiqueta del pedido. Un
--  pedido de 100 toneladas con 60 en cámara tiene 60 listas para despachar y
--  40 en backorder, y tiene que aparecer en las dos tarjetas: Operaciones
--  necesita ver las 60 para cargarlas y Producción las 40 para fabricarlas.
--  Se borra antes de crearla: PostgreSQL no deja insertar columnas en medio
--  de una vista existente con «create or replace», y las dos marcas van junto
--  a la situación, no colgando al final.
drop view if exists v_control_pedidos;

create view v_control_pedidos as
with cobertura as (
  select
    pedido_id,
    sum(pendiente_kg)   as pendiente_kg,
    sum(con_stock_kg)   as con_stock_kg,
    sum(backorder_kg)   as backorder_kg,
    count(*) filter (where backorder_kg > 0.5) as lineas_en_backorder
  from v_pedido_linea_cobertura
  group by pedido_id
),
ultimo_despacho as (
  --  Cuándo se completó: la última salida de sus embarques. Sirve para filtrar
  --  los completos «hasta una semana determinada».
  select ep.pedido_id,
         max((d.fecha_salida at time zone 'America/Lima')::date) as fecha
    from embarque_pedidos ep
    join packing_lists pk on pk.embarque_id = ep.embarque_id and pk.estado <> 'anulado'
    join despachos d on d.packing_list_id = pk.id
   group by ep.pedido_id
)
select
  t.id,
  t.numero_proforma,
  t.cliente_id,
  t.cliente,
  t.destino,
  t.prioridad,
  t.ciclo,
  t.fecha_comprometida,
  t.fecha_salida_programada,
  t.tm_pedidas,
  t.venta_usd,
  coalesce(c.pendiente_kg, 0) / 1000     as tm_pendientes,
  coalesce(c.con_stock_kg, 0) / 1000     as tm_con_stock,
  coalesce(c.backorder_kg, 0) / 1000     as tm_backorder,
  coalesce(c.lineas_en_backorder, 0)     as lineas_en_backorder,
  u.fecha                                as fecha_completado,

  /*
   * LA FECHA CONTRA LA QUE SE MIDE EL RETRASO.
   * Oliver: «considerar la salida programada en el planificador». Si todavía
   * no está en el planificador, se mide contra lo comprometido con el cliente:
   * un pedido sin programar también puede estar llegando tarde, y dejarlo
   * fuera escondería justo a los que nadie ha programado.
   */
  coalesce(t.fecha_salida_programada, t.fecha_comprometida) as fecha_referencia,

  case
    when t.ciclo = 'cancelado'                              then 'cancelado'
    when t.ciclo in ('despachado', 'cerrado')               then 'completo'
    when t.ciclo = 'confirmado'                             then 'por_atender'
    else                                                         'otro'
  end                                                       as situacion_control,

  --  Las dos marcas de los abiertos, independientes entre sí.
  (t.ciclo = 'confirmado' and coalesce(c.con_stock_kg, 0) > 0.5)  as tiene_stock,
  (t.ciclo = 'confirmado' and coalesce(c.backorder_kg, 0) > 0.5)  as en_backorder,

  --  El retraso es un atributo aparte, no una situación: un pedido puede estar
  --  en backorder Y retrasado a la vez, y esconder una cosa detrás de la otra
  --  haría que la tarjeta de retrasados mintiera.
  (t.ciclo = 'confirmado'
   and coalesce(t.fecha_salida_programada, t.fecha_comprometida) < current_date)
                                                            as retrasado
from v_pedidos_tablero t
left join cobertura c on c.pedido_id = t.id
left join ultimo_despacho u on u.pedido_id = t.id;

comment on view v_control_pedidos is
  'Cada pedido con su situación para Control de Pedidos. Los abiertos llevan dos marcas independientes: si tienen stock para despachar algo y si les falta algo (backorder). No son excluyentes porque el backorder es una cantidad: un pedido con la mitad en cámara tiene la mitad lista y la mitad en backorder. El retraso se mide contra la salida programada del planificador —así lo pidió el cliente— y, si aún no la tiene, contra la fecha comprometida.';
