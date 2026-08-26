-- ============================================================================
--  MIGRACIÓN 012 · ORIGEN DEL PEDIDO Y CONVERSIÓN DE COTIZACIONES
-- ============================================================================
--  Un pedido puede nacer por dos caminos y ambos son legítimos:
--    · Desde una cotización aceptada (hubo negociación previa).
--    · Directo (el cliente habitual pide sin negociar).
--
--  La diferencia se guarda en la columna cotizacion_id: si tiene valor, vino
--  de una oferta; si es NULL, fue directo.
--
--  Eso es lo que permite que el indicador de CONVERSIÓN mida algo real. Si el
--  sistema obligara a crear una cotización para cada pedido, la conversión
--  sería siempre 100 % y no diría nada. Al permitir los dos caminos, el
--  número refleja de verdad cuántas ofertas se cierran.
-- ============================================================================

create or replace view v_conversion_comercial as
with cot as (
  select count(*) as total,
         count(*) filter (where estado = 'aceptada')  as aceptadas,
         count(*) filter (where estado = 'rechazada') as rechazadas,
         count(*) filter (where estado = 'vencida')   as vencidas,
         count(*) filter (where estado = 'enviada')   as en_espera
    from cotizaciones
),
ped as (
  select count(*)                                        as total,
         count(*) filter (where cotizacion_id is not null) as desde_cotizacion,
         count(*) filter (where cotizacion_id is null)     as directos
    from pedidos
)
select
  cot.total                                   as cotizaciones_emitidas,
  cot.aceptadas                               as cotizaciones_aceptadas,
  cot.rechazadas                              as cotizaciones_rechazadas,
  cot.vencidas                                as cotizaciones_vencidas,
  cot.en_espera                               as cotizaciones_en_espera,
  ped.total                                   as pedidos_totales,
  ped.desde_cotizacion                        as pedidos_desde_cotizacion,
  ped.directos                                as pedidos_directos,
  -- Conversión: de las ofertas que se hicieron, cuántas terminaron en pedido
  case when cot.total > 0
       then round(ped.desde_cotizacion::numeric / cot.total * 100, 1)
       else 0 end                             as conversion_pct,
  -- Qué proporción del negocio pasa por negociación previa
  case when ped.total > 0
       then round(ped.desde_cotizacion::numeric / ped.total * 100, 1)
       else 0 end                             as pedidos_negociados_pct
from cot, ped;

comment on view v_conversion_comercial is
  'Conversión de cotizaciones a pedidos. Solo tiene sentido porque el sistema permite crear pedidos directos: si obligara a cotizar siempre, la conversión sería 100 % y no mediría nada.';
