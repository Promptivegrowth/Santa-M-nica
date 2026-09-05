-- ============================================================================
--  029 · EL PEDIDO SABE CUÁNDO ESTÁ PROGRAMADA SU SALIDA
-- ============================================================================
--  De la reunión con Oliver:
--
--    «Entiendo que el compromiso que tienes actual es el que se pacta con el
--     cliente [...] la idea sería que en ventas salga el compromiso, pero el
--     compromiso desde que ya se pone en el planificador.»
--
--  Son DOS fechas distintas y hasta ahora solo existía una:
--
--    · fecha_comprometida        → lo que se le prometió al CLIENTE.
--    · fecha_salida_programada   → el día que Logística puso en el calendario.
--
--  Deberían coincidir, y cuando no coinciden es exactamente el dato que hay
--  que ver: significa que la operación va a llegar tarde a una promesa que ya
--  está hecha, y todavía hay tiempo de avisar al cliente.
--
--  Se añaden al final de la vista para no alterar el orden de las columnas
--  que ya existen: `create or replace view` no admite reordenarlas.
-- ============================================================================
create or replace view v_pedidos_tablero as
select
  p.id, p.numero_proforma, p.cliente_id, c.razon_social as cliente, c.pais,
  p.vendedor_id, p.moneda, p.tipo_cambio, p.incoterm, p.prioridad,
  p.fecha_solicitada, p.fecha_comprometida,
  p.ciclo, p.cobertura, p.situacion,
  d.puerto as destino, d.pais as destino_pais,
  coalesce(t.tm, 0)      as tm_pedidas,
  coalesce(t.venta, 0)   as venta,
  coalesce(r.reservado_kg, 0) / 1000    as tm_reservadas,
  coalesce(r.consumido_kg, 0) / 1000    as tm_despachadas,
  case when coalesce(t.tm,0) > 0
       then least(100, (coalesce(r.reservado_kg,0) + coalesce(r.consumido_kg,0)) / 10 / coalesce(t.tm,1))
       else 0 end        as avance_pct,
  greatest(coalesce(t.tm,0) - (coalesce(r.reservado_kg,0) + coalesce(r.consumido_kg,0)) / 1000, 0) as tm_faltantes,
  (p.fecha_comprometida < current_date and p.ciclo = 'confirmado') as atrasado,
  c.bloqueado                                                     as cliente_bloqueado,
  case
    when p.ciclo in ('despachado','cerrado')                            then 'despachado'
    when c.bloqueado or p.situacion = 'bloqueado_credito'               then 'bloqueado'
    when p.fecha_comprometida < current_date and p.ciclo = 'confirmado' then 'riesgo'
    when p.cobertura in ('reservado','preparado','en_preparacion','programado','completo') then 'completo'
    else 'parcial'
  end as semaforo,
  a_dolares(coalesce(t.venta, 0), p.moneda, p.tipo_cambio)        as venta_usd,

  /* ---- Lo nuevo ---- */

  -- El día que Logística puso en el calendario. Si el pedido va en varios
  -- embarques, el primero: es cuando empieza a salir.
  emb.primera_salida                                              as fecha_salida_programada,
  emb.cuantos                                                     as embarques,

  /*
   * Diferencia entre lo prometido al cliente y lo programado por Logística.
   * Positivo = el calendario va POR DETRÁS de la promesa; es un retraso que
   * todavía no ha ocurrido y que aún se puede avisar o corregir.
   */
  (emb.primera_salida - p.fecha_comprometida)                     as desfase_programacion,

  -- De dónde vino el pedido. Antes había que consultarlo aparte con una
  -- segunda query en cada pantalla que lo necesitara.
  p.cotizacion_id
from pedidos p
join clientes c on c.id = p.cliente_id
left join destinos d on d.id = p.destino_id
left join lateral (
  select sum(pl.cantidad_tm) as tm,
         sum(pl.cantidad_tm * pl.precio_tm * (1 - pl.descuento_pct/100)) as venta
    from pedido_lineas pl where pl.pedido_id = p.id
) t on true
left join lateral (
  select sum(case when rv.estado in ('activa','en_preparacion') then rv.peso_neto_kg else 0 end) as reservado_kg,
         sum(case when rv.estado = 'consumida' then rv.peso_neto_kg else 0 end) as consumido_kg
    from reservas rv
    join pedido_lineas pl2 on pl2.id = rv.pedido_linea_id
   where pl2.pedido_id = p.id
) r on true
left join lateral (
  select min(e.fecha_programada) as primera_salida,
         count(*)                as cuantos
    from embarque_pedidos ep
    join embarques e on e.id = ep.embarque_id
   where ep.pedido_id = p.id
     and e.estado <> 'cancelado'
) emb on true;

comment on view v_pedidos_tablero is
  'Pedidos con su semáforo. `venta` va en la moneda de la proforma y `venta_usd` en dólares. `fecha_comprometida` es lo prometido al cliente; `fecha_salida_programada` es lo que Logística puso en el calendario, y `desfase_programacion` la diferencia entre ambas.';
