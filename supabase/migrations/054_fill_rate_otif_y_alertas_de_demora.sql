-- ============================================================================
--  054 · FILL RATE, OTIF Y ALERTAS POR DEMORA
-- ============================================================================
--  Documento de mejoras, punto 4:
--
--    «Agregar los indicadores Fill Rate y OTIF con seguimiento semanal.
--     Fill Rate = Cantidad atendida / Cantidad programada × 100
--     OTIF = Pedidos completos y atendidos a tiempo / Total de pedidos
--            programados × 100
--     Además, generar alertas por despacho cuando:
--       Programado → Despachado > 6 días
--       Pedido → Salida programada > 12 días»
--
--  Y dos respuestas de Oliver que fijan cómo se miden:
--   · «el plan es el que se sube en el módulo Planificador; el real, solo los
--     que se les dé salida en el transcurso de la semana».
--   · «a tiempo» se mide contra la SALIDA PROGRAMADA del planificador.
--
--  DÓNDE SE MIDE, Y POR QUÉ AHÍ
--  La unidad es el CONTENEDOR (el packing list), no la línea de pedido. Se
--  comprobó antes de decidirlo: a nivel de contenedor lo cargado y lo
--  despachado son coherentes entre sí, y el Fill Rate de las semanas cerradas
--  sale entre el 82 % y el 99 %. A nivel de pedido, la data de demostración
--  tiene pedidos marcados «despachado» con un 3 % de su cantidad despachada:
--  medir ahí habría dado un Fill Rate del 4 % que no dice nada del negocio.
--
--  Y es lo que Oliver describió: el plan es lo que está en el planificador,
--  que es donde viven los contenedores.
--
--  LO QUE NO SE PUEDE MEDIR, SE DICE
--  Un embarque programado sin carga asignada todavía no tiene cantidad que
--  medir. No se esconde: se cuenta aparte, para que quien mire sepa que existe.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
--  1 · LOS DOS UMBRALES DEL DOCUMENTO
-- ────────────────────────────────────────────────────────────────────────────
insert into parametros (clave, valor, tipo_dato, grupo, etiqueta, editable_por, descripcion, unidad) values
  ('alerta_programado_despacho_dias', '6', 'numero', 'logistica',
   'Máximo de Programado → Despachado', 'gerencia',
   'Si un pedido tarda más que esto entre su salida programada y la salida real, salta la alerta de demora. El documento de mejoras fija 6 días.', 'días'),
  ('alerta_pedido_programacion_dias', '12', 'numero', 'logistica',
   'Máximo de Pedido → Salida programada', 'gerencia',
   'Si un pedido tarda más que esto en entrar al planificador desde que se pidió, salta la alerta de demora. El documento de mejoras fija 12 días.', 'días')
on conflict (clave) do nothing;


-- ────────────────────────────────────────────────────────────────────────────
--  2 · CADA CONTENEDOR, CON SU SEMANA Y SU RESULTADO
-- ────────────────────────────────────────────────────────────────────────────
create or replace view v_contenedor_cumplimiento as
select
  pk.id                                                     as packing_list_id,
  e.id                                                      as embarque_id,
  e.numero                                                  as embarque,
  e.fecha_programada,
  --  La semana ISO: lunes a domingo, que es como cuenta el negocio.
  date_trunc('week', e.fecha_programada)::date              as semana,
  coalesce(c.kg, 0)                                         as programado_kg,
  d.fecha_salida,
  (d.fecha_salida is not null)                              as despachado,
  --  A tiempo: salió en o antes de la fecha que tenía en el planificador.
  (d.fecha_salida is not null and d.fecha_salida <= e.fecha_programada) as a_tiempo
from packing_lists pk
join embarques e on e.id = pk.embarque_id and e.estado <> 'cancelado'
left join lateral (
  select sum(pl.peso_neto_kg) as kg from packing_lineas pl where pl.packing_list_id = pk.id
) c on true
left join lateral (
  --  La primera salida del contenedor, en hora de Lima.
  select min((dp.fecha_salida at time zone 'America/Lima')::date) as fecha_salida
    from despachos dp where dp.packing_list_id = pk.id
) d on true
where pk.estado <> 'anulado';

comment on view v_contenedor_cumplimiento is
  'Cada contenedor programado, con su semana, lo cargado y si salió y a tiempo contra su fecha del planificador. Es la base del Fill Rate y del OTIF: se mide por contenedor porque es donde lo planificado y lo despachado son coherentes.';


-- ────────────────────────────────────────────────────────────────────────────
--  3 · FILL RATE Y OTIF, SEMANA A SEMANA
-- ────────────────────────────────────────────────────────────────────────────
create or replace view v_cumplimiento_semanal as
with fill as (
  --  Toneladas: se suman CONTENEDORES distintos. Un contenedor puede llevar dos
  --  proformas —pasa en 68 de 140—, y sumar por pedido lo contaría dos veces.
  select semana,
         count(*)                                             as contenedores,
         count(*) filter (where despachado)                   as contenedores_despachados,
         sum(programado_kg)                                   as programado_kg,
         sum(programado_kg) filter (where despachado)         as atendido_kg
    from v_contenedor_cumplimiento
   group by semana
),
por_pedido as (
  --  OTIF cuenta PEDIDOS, como pide el documento. Un pedido es completo y a
  --  tiempo en una semana si TODOS sus contenedores de esa semana salieron, y
  --  todos en fecha. Basta uno que falte o se retrase para que no lo sea.
  select date_trunc('week', pc.fecha_programada)::date        as semana,
         pc.pedido_id,
         bool_and(cc.despachado)                              as completo,
         bool_and(cc.a_tiempo)                                as a_tiempo
    from v_pedido_contenedores pc
    join v_contenedor_cumplimiento cc on cc.packing_list_id = pc.packing_list_id
   group by 1, 2
),
otif as (
  select semana,
         count(*)                                             as pedidos_programados,
         count(*) filter (where completo and a_tiempo)        as pedidos_otif,
         count(*) filter (where completo and not a_tiempo)    as pedidos_tarde,
         count(*) filter (where not completo)                 as pedidos_incompletos
    from por_pedido
   group by semana
),
sin_carga as (
  --  Programados en el planificador pero todavía sin ningún contenedor: no
  --  tienen cantidad que medir. Se cuentan para no esconderlos.
  select date_trunc('week', e.fecha_programada)::date as semana, count(*) as embarques
    from embarques e
   where e.estado <> 'cancelado'
     and not exists (select 1 from packing_lists pk
                      where pk.embarque_id = e.id and pk.estado <> 'anulado')
   group by 1
)
select
  f.semana,
  --  El número de semana como lo dice el negocio: «semana 39».
  extract(week from f.semana)::int                             as numero_semana,
  f.contenedores,
  f.contenedores_despachados,
  f.programado_kg,
  coalesce(f.atendido_kg, 0)                                   as atendido_kg,
  case when f.programado_kg > 0
       then round(coalesce(f.atendido_kg, 0) / f.programado_kg * 100, 1) end as fill_rate,
  coalesce(o.pedidos_programados, 0)                           as pedidos_programados,
  coalesce(o.pedidos_otif, 0)                                  as pedidos_otif,
  coalesce(o.pedidos_tarde, 0)                                 as pedidos_tarde,
  coalesce(o.pedidos_incompletos, 0)                           as pedidos_incompletos,
  case when coalesce(o.pedidos_programados, 0) > 0
       then round(o.pedidos_otif::numeric / o.pedidos_programados * 100, 1) end as otif,
  coalesce(s.embarques, 0)                                     as embarques_sin_carga,
  --  Una semana que todavía no terminó no se puede juzgar: lo que no salió
  --  aún puede salir. Se marca para que la pantalla no la presente como un
  --  resultado cerrado.
  (f.semana + 6 >= (now() at time zone 'America/Lima')::date)  as semana_abierta
from fill f
left join otif o      on o.semana = f.semana
left join sin_carga s on s.semana = f.semana;

comment on view v_cumplimiento_semanal is
  'Fill Rate y OTIF por semana de programación. Fill Rate = toneladas despachadas ÷ programadas en el planificador, sobre contenedores distintos. OTIF = pedidos cuyos contenedores de la semana salieron todos y en fecha ÷ pedidos programados. La semana en curso se marca abierta: lo que no salió todavía puede salir.';


-- ────────────────────────────────────────────────────────────────────────────
--  4 · LA DEMORA DE CADA PEDIDO CONTRA LOS DOS UMBRALES
-- ────────────────────────────────────────────────────────────────────────────
--  Se mide también lo que TODAVÍA NO ocurrió. Un pedido programado hace diez
--  días que aún no salió ya incumple «programado → despachado > 6», aunque no
--  tenga fecha de salida: esperar a que salga para avisar es avisar tarde.
create or replace view v_demora_pedidos as
with umbral as (
  select param_num('alerta_programado_despacho_dias', 6)  as prog_desp,
         param_num('alerta_pedido_programacion_dias', 12) as ped_prog
),
base as (
  select t.pedido_id, t.numero_proforma, t.cliente, t.destino, t.ciclo, t.prioridad,
         t.f_pedido, t.f_programada, t.f_despacho,
         (now() at time zone 'America/Lima')::date as hoy
    from v_tiempos_flujo t
   where t.ciclo <> 'cancelado'
)
select
  b.*,
  --  Pedido → Salida programada: hasta que entra al planificador, o hasta hoy.
  case when b.f_pedido is not null
       then coalesce(b.f_programada, b.hoy) - b.f_pedido end   as dias_a_programar,
  --  Programado → Despachado: hasta que sale, o hasta hoy si ya debió salir.
  case when b.f_programada is not null
       then coalesce(b.f_despacho, b.hoy) - b.f_programada end as dias_a_despachar,
  u.prog_desp as umbral_programado_despacho,
  u.ped_prog  as umbral_pedido_programacion,
  (b.f_pedido is not null
   and coalesce(b.f_programada, b.hoy) - b.f_pedido > u.ped_prog)       as incumple_programacion,
  (b.f_programada is not null
   and coalesce(b.f_despacho, b.hoy) - b.f_programada > u.prog_desp)    as incumple_despacho,
  --  Si el incumplimiento ya ocurrió y se cerró, o sigue abierto ahora.
  (b.f_despacho is null)                                                 as sigue_abierto
from base b
cross join umbral u;

comment on view v_demora_pedidos is
  'Cada pedido contra los dos umbrales del documento: Pedido → Salida programada (12 días) y Programado → Despachado (6 días). Se mide también lo que aún no ocurrió: un pedido programado hace diez días que no salió ya incumple, aunque no tenga fecha de salida.';


-- ────────────────────────────────────────────────────────────────────────────
--  5 · EL AVISO
-- ────────────────────────────────────────────────────────────────────────────
--  Solo avisa de los que SIGUEN ABIERTOS: los que ya salieron tarde no tienen
--  arreglo, y llenar Alertas de hechos consumados tapa los que todavía se
--  pueden salvar. El histórico se ve marcado en Tiempos del flujo.
create or replace function demora_avisar()
returns int language plpgsql security definer set search_path = public as $$
declare v_prog int; v_desp int;
begin
  select count(*) filter (where incumple_programacion and f_programada is null),
         count(*) filter (where incumple_despacho and sigue_abierto)
    into v_prog, v_desp
    from v_demora_pedidos
   where ciclo not in ('despachado', 'cerrado');

  if coalesce(v_prog, 0) + coalesce(v_desp, 0) = 0 then
    update alertas set atendida = true
     where titulo = 'Pedidos fuera de los tiempos establecidos' and not atendida;
    return 0;
  end if;

  perform alerta_resumen('pedido', 'Pedidos fuera de los tiempos establecidos', 'advertencia',
    format('%s pedido(s) llevan más de %s días sin programar y %s llevan más de %s días programados sin salir.',
           v_prog, param_num('alerta_pedido_programacion_dias', 12),
           v_desp, param_num('alerta_programado_despacho_dias', 6)));
  return v_prog + v_desp;
end $$;

comment on function demora_avisar is
  'Deja abierto un único aviso con los pedidos que hoy incumplen los tiempos del documento. Solo cuenta los que siguen abiertos: los que ya salieron tarde no tienen arreglo y se ven en Tiempos del flujo.';

select cron.unschedule('avisar_demora_pedidos')
 where exists (select 1 from cron.job where jobname = 'avisar_demora_pedidos');
select cron.schedule('avisar_demora_pedidos', '25 11 * * *', $$select demora_avisar()$$);
