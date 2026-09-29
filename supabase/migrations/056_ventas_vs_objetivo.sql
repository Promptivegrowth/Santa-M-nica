-- ============================================================================
--  056 · VENTAS VS. OBJETIVO, EN CONTENEDORES
-- ============================================================================
--  Documento de mejoras, punto 2.1:
--
--    «Mostrar el avance mensual de ventas en función al número de
--     contenedores: Contenedores planificados / Contenedores despachados /
--     Pendientes / % de cumplimiento.»
--
--  Y Oliver, sobre qué es el plan y qué es lo real:
--
--    «La idea es que se considere como plan el que se subirá en el módulo
--     Planificador, ese sería nuestra base, y el real solo los que se les dé
--     salida en el transcurso [del periodo].»
--
--  CÓMO SE CUENTA
--  · Un embarque del planificador es UN contenedor: nunca lleva más de un
--    packing list (comprobado en los datos).
--  · PLANIFICADOS del mes: los embarques no cancelados con fecha programada en
--    el mes.
--  · DESPACHADOS del mes: de esos, los que tienen salida registrada ANTES de
--    que termine el mes. Si salió antes de lo previsto, cuenta: el contenedor
--    se vendió. Si salió el mes siguiente, no: el mes no cumplió.
--  · PENDIENTES = planificados − despachados. Así las cuatro cifras cuadran
--    siempre, que es lo primero que se comprueba cuando alguien las mira.
--  · % DE CUMPLIMIENTO = despachados ÷ planificados.
--  · Lo que sale en el mes pero estaba planificado para un mes ANTERIOR no es
--    del plan de este mes: se muestra aparte, como «arrastre», para no inflar
--    el cumplimiento con atrasos del mes pasado.
--
--  La salida es la del despacho registrado, en hora de Lima, como en Fill Rate
--  y OTIF (054). El estado del embarque no basta: un «despachado» sin fecha de
--  salida no se puede asignar a ningún mes.
-- ============================================================================

drop view if exists v_ventas_objetivo_mensual;
drop view if exists v_objetivo_contenedores;

-- ============================================================================
--  1. EL DETALLE: un contenedor por fila
--  Es lo que se ve al pulsar cualquiera de las cuatro tarjetas.
-- ============================================================================
create view v_objetivo_contenedores as
with salida as (
  --  Un embarque tiene como mucho un packing list vivo, y un packing list como
  --  mucho un despacho. El min() es solo por seguridad.
  select pk.embarque_id,
         min(pk.id)                                                    as packing_list_id,
         min(pk.contenedor)                                            as contenedor,
         min((d.fecha_salida at time zone 'America/Lima')::date)       as fecha_salida
    from packing_lists pk
    left join despachos d on d.packing_list_id = pk.id
   where pk.estado <> 'anulado'
   group by pk.embarque_id
),
pedidos_de as (
  select ep.embarque_id,
         string_agg(distinct p.numero_proforma, ', ')                  as proformas,
         string_agg(distinct coalesce(c.nombre_corto, c.razon_social), ', ') as clientes,
         --  Para enlazar: si el contenedor es de un solo pedido, se va directo.
         case when count(distinct p.id) = 1 then min(p.id) end         as pedido_id,
         count(distinct p.id)                                          as pedidos
    from embarque_pedidos ep
    join pedidos p  on p.id = ep.pedido_id
    join clientes c on c.id = p.cliente_id
   group by ep.embarque_id
)
select
  e.id                                                                 as embarque_id,
  e.numero                                                             as embarque,
  e.fecha_programada,
  date_trunc('month', e.fecha_programada)::date                        as mes_plan,
  s.packing_list_id,
  s.contenedor,
  s.fecha_salida,
  date_trunc('month', s.fecha_salida)::date                            as mes_salida,
  --  Despachado DENTRO de su mes: antes de que empiece el siguiente.
  (s.fecha_salida is not null
   and s.fecha_salida < (date_trunc('month', e.fecha_programada) + interval '1 month')::date)
                                                                       as cumple_mes,
  case
    when s.fecha_salida is null then 'pendiente'
    when s.fecha_salida < (date_trunc('month', e.fecha_programada) + interval '1 month')::date
      then 'despachado'
    else 'salio_tarde'
  end                                                                  as situacion,
  pd.proformas,
  pd.clientes,
  pd.pedido_id,
  pd.pedidos,
  ds.puerto                                                            as destino,
  e.estado                                                             as estado_embarque
from embarques e
left join salida s      on s.embarque_id = e.id
left join pedidos_de pd on pd.embarque_id = e.id
left join destinos ds   on ds.id = e.destino_id
where e.estado <> 'cancelado';

comment on view v_objetivo_contenedores is
  'Cada contenedor del planificador con su mes de plan y su salida real (hora de Lima). situacion: despachado dentro de su mes, salio_tarde (el mes siguiente o después) o pendiente.';


-- ============================================================================
--  2. EL RESUMEN POR MES
-- ============================================================================
create view v_ventas_objetivo_mensual as
with meses as (
  select mes_plan as mes from v_objetivo_contenedores
  union
  select mes_salida from v_objetivo_contenedores where mes_salida is not null
),
plan as (
  select mes_plan as mes,
         count(*)                                   as planificados,
         count(*) filter (where cumple_mes)         as despachados
    from v_objetivo_contenedores
   group by mes_plan
),
arrastre as (
  select mes_salida as mes, count(*) as arrastre
    from v_objetivo_contenedores
   where mes_salida is not null and mes_salida > mes_plan
   group by mes_salida
)
select
  m.mes,
  to_char(m.mes, 'YYYY-MM')                                            as clave,
  coalesce(p.planificados, 0)                                          as planificados,
  coalesce(p.despachados, 0)                                           as despachados,
  coalesce(p.planificados, 0) - coalesce(p.despachados, 0)             as pendientes,
  case when coalesce(p.planificados, 0) > 0
       then round(p.despachados::numeric / p.planificados * 100, 1) end as cumplimiento,
  coalesce(a.arrastre, 0)                                              as arrastre,
  --  El mes en curso todavía puede cumplir: sus pendientes no son fallos aún.
  (m.mes = date_trunc('month', now() at time zone 'America/Lima')::date) as mes_abierto
from meses m
left join plan p     on p.mes = m.mes
left join arrastre a on a.mes = m.mes;

comment on view v_ventas_objetivo_mensual is
  'Ventas vs. objetivo por mes, en contenedores: planificados en el planificador, despachados dentro del mes, pendientes (= planificados − despachados) y % de cumplimiento. arrastre = salidas del mes que estaban planificadas para un mes anterior.';
