-- ============================================================================
--  059 · LAS SEIS ALERTAS PRINCIPALES
-- ============================================================================
--  Documento de mejoras, punto 6:
--
--    «Concentrar principalmente las siguientes alertas:
--       · Productos próximos a vencer.
--       · Stock observado, inmovilizado o condicionado.
--       · Familias con baja cobertura.
--       · Pedidos pendientes que sí tienen stock.
--       · Backorder por falta de stock.
--       · Pedidos/despachos fuera de los tiempos establecidos.»
--
--  Cuatro ya tenían su aviso diario (036/043, 055, 053 y 054). Faltaban los
--  dos de pedidos. Y hacía falta un sitio que dijera, EN VIVO, cómo está cada
--  una: el aviso se genera una vez por la mañana, pero si a mediodía se
--  despacha el pedido, la pantalla tiene que reflejarlo ya.
-- ============================================================================


-- ============================================================================
--  1. LOS DOS AVISOS QUE FALTABAN
--  Cuentan lo mismo que las tarjetas de Control de pedidos: los pedidos por
--  atender que tienen stock para cargar al menos una parte, y los que tienen
--  líneas sin stock.
-- ============================================================================
create or replace function pedidos_avisar_con_stock()
returns int language plpgsql security definer set search_path = public as $$
declare v_n int; v_tm numeric;
begin
  select count(*), coalesce(sum(tm_con_stock), 0) into v_n, v_tm
    from v_control_pedidos
   where situacion_control = 'por_atender' and tiene_stock;

  if v_n = 0 then
    update alertas set atendida = true, atendida_en = now()
     where titulo = 'Pedidos pendientes con stock' and not atendida;
    return 0;
  end if;

  perform alerta_resumen('pedido', 'Pedidos pendientes con stock', 'advertencia',
    format('%s pedidos tienen %s TM en cámara listas para despachar y todavía no salieron.',
           v_n, to_char(v_tm, 'FM999G999G990D0')));
  return v_n;
end $$;

comment on function pedidos_avisar_con_stock is
  'Aviso diario de los pedidos por atender que sí tienen stock: es venta que se puede cargar ya. Uno solo, que se actualiza.';

create or replace function pedidos_avisar_backorder()
returns int language plpgsql security definer set search_path = public as $$
declare v_n int; v_tm numeric; v_productos int;
begin
  select count(*), coalesce(sum(tm_backorder), 0) into v_n, v_tm
    from v_control_pedidos
   where situacion_control = 'por_atender' and en_backorder;
  select count(*) into v_productos from v_produccion_necesidades;

  if v_n = 0 then
    update alertas set atendida = true, atendida_en = now()
     where titulo = 'Backorder por falta de stock' and not atendida;
    return 0;
  end if;

  perform alerta_resumen('pedido', 'Backorder por falta de stock', 'advertencia',
    format('%s TM de %s pedidos no se pueden atender por falta de stock (%s productos). Es lo que falta producir.',
           to_char(v_tm, 'FM999G999G990D0'), v_n, v_productos));
  return v_n;
end $$;

comment on function pedidos_avisar_backorder is
  'Aviso diario del backorder: lo pedido que no tiene stock, que es la necesidad de producción. Uno solo, que se actualiza.';

select pedidos_avisar_con_stock();
select pedidos_avisar_backorder();

do $$
begin
  perform cron.unschedule('avisar_pedidos_con_stock')
    where exists (select 1 from cron.job where jobname = 'avisar_pedidos_con_stock');
  perform cron.schedule('avisar_pedidos_con_stock', '40 11 * * *', 'select pedidos_avisar_con_stock()');
  perform cron.unschedule('avisar_backorder')
    where exists (select 1 from cron.job where jobname = 'avisar_backorder');
  perform cron.schedule('avisar_backorder', '45 11 * * *', 'select pedidos_avisar_backorder()');
end $$;


-- ============================================================================
--  2. LAS SEIS, EN VIVO
--  Una fila por alerta, en el orden del documento, con la cifra de ahora
--  mismo, su gravedad, a dónde lleva para ver el detalle y el título del
--  aviso diario que le corresponde.
--
--  La gravedad sigue una sola regla para las seis: «critica» si hay algo que
--  ya se perdió o se incumplió, «advertencia» si hay algo que atender, «ok»
--  si no hay nada.
-- ============================================================================
drop view if exists v_alertas_principales;
create view v_alertas_principales as
with
venc as (
  select count(*) filter (where situacion = 'por_vencer')                       as por_vencer,
         count(*) filter (where situacion = 'vencido')                          as vencidos,
         coalesce(sum(fisico_kg) filter (where situacion = 'por_vencer'), 0)    as kg
    from v_stock_por_vencer),
cond as (
  select count(*) as n, coalesce(sum(fisico_kg), 0) as kg,
         count(*) filter (where condicion = 'condicionado') as nacional
    from v_stock_condicion),
cob as (
  select count(*) filter (where situacion = 'agotada') as agotadas,
         count(*) filter (where situacion = 'baja')    as bajas
    from v_cobertura_familia),
ped as (
  select count(*) filter (where tiene_stock)                   as con_stock,
         coalesce(sum(tm_con_stock) filter (where tiene_stock), 0) as tm_con_stock,
         count(*) filter (where en_backorder)                  as en_backorder,
         coalesce(sum(tm_backorder) filter (where en_backorder), 0) as tm_backorder
    from v_control_pedidos where situacion_control = 'por_atender'),
dem as (
  select count(*) filter (where incumple_programacion) as sin_programar,
         count(*) filter (where incumple_despacho)     as sin_salir,
         count(*) filter (where incumple_programacion or incumple_despacho) as n
    from v_demora_pedidos)
select 1 as orden, 'por_vencer' as clave, 'Productos próximos a vencer' as titulo,
       case when venc.vencidos > 0 then 'critica' when venc.por_vencer > 0 then 'advertencia' else 'ok' end as severidad,
       venc.por_vencer::numeric as cifra, 'pallets' as unidad,
       format('%s TM en los próximos %s días · %s ya vencidos',
              to_char(venc.kg / 1000, 'FM999G990D0'), param_num('vencimiento_aviso_dias', 90)::int, venc.vencidos) as detalle,
       '/almacenes/alertas#por-vencer' as ruta, 'Stock por vencer' as aviso
  from venc
union all
select 2, 'condicion', 'Stock observado, inmovilizado o condicionado',
       case when cond.n > 0 then 'advertencia' else 'ok' end,
       cond.n, 'pallets',
       format('%s TM retenidas · %s solo para mercado nacional', to_char(cond.kg / 1000, 'FM999G990D0'), cond.nacional),
       '/almacenes/alertas#condicion', 'Stock observado, inmovilizado o condicionado'
  from cond
union all
select 3, 'cobertura', 'Familias con baja cobertura',
       case when cob.agotadas > 0 then 'critica' when cob.bajas > 0 then 'advertencia' else 'ok' end,
       (cob.agotadas + cob.bajas), 'familias',
       format('%s agotadas · %s por debajo de %s días', cob.agotadas, cob.bajas, param_num('cobertura_minima_dias', 15)::int),
       '/almacenes/existencias#cobertura', 'Familias con baja cobertura'
  from cob
union all
select 4, 'pendientes_con_stock', 'Pedidos pendientes que sí tienen stock',
       case when ped.con_stock > 0 then 'advertencia' else 'ok' end,
       ped.con_stock, 'pedidos',
       format('%s TM en cámara listas para despachar', to_char(ped.tm_con_stock, 'FM999G999G990D0')),
       '/ventas/control?vista=pendientes', 'Pedidos pendientes con stock'
  from ped
union all
select 5, 'backorder', 'Backorder por falta de stock',
       case when ped.en_backorder > 0 then 'advertencia' else 'ok' end,
       round(ped.tm_backorder, 1), 'TM',
       format('%s pedidos esperan producción', ped.en_backorder),
       '/produccion', 'Backorder por falta de stock'
  from ped
union all
select 6, 'fuera_de_tiempo', 'Pedidos y despachos fuera de tiempo',
       case when dem.n > 0 then 'critica' else 'ok' end,
       dem.n, 'pedidos',
       format('%s sin programar a tiempo · %s programados sin salir', dem.sin_programar, dem.sin_salir),
       '/ventas/tiempos?completos=incumplen', 'Pedidos fuera de los tiempos establecidos'
  from dem;

comment on view v_alertas_principales is
  'Las seis alertas que el documento de mejoras pide concentrar, con su cifra en vivo, su gravedad, la pantalla de detalle y el título del aviso diario correspondiente.';


-- ============================================================================
--  3. PERMISOS
--  Como las demás funciones de avisos (057): solo usuarios con sesión.
-- ============================================================================
do $$
declare f text;
begin
  foreach f in array array['pedidos_avisar_con_stock()', 'pedidos_avisar_backorder()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
