-- ============================================================================
--  062 · LA BASE ES LA TONELADA, Y LOS COSTOS LOS CARGAN MARCO Y OLIVER
-- ============================================================================
--  Dos pedidos de Oliver:
--
--    «La base principal de producto es toneladas: en vez de pallets debe
--     considerarse toneladas.»
--
--    «No me queda claro dónde se pueden actualizar los costos» → los cargan
--     los dos, Marco y él, y el costo lo conocen por producto.
--
--  Hasta ahora escribir costos era cosa del ROL Gerencia, así que Oliver
--  (Operaciones) veía la pantalla en solo lectura y nunca encontró dónde
--  cargarlos. Pasa a ser un permiso de PERSONA, como aprobar cotizaciones.
-- ============================================================================


-- ============================================================================
--  1. QUIÉN CARGA COSTOS
-- ============================================================================
alter table usuarios add column if not exists carga_costos boolean not null default false;
comment on column usuarios.carga_costos is
  'Puede cargar y actualizar los costos de producción. Por persona: hoy Marco y Oliver. Lo da o lo quita Gerencia.';

update usuarios set carga_costos = true
 where email in ('gerencia@santamonica.pe', 'operaciones@santamonica.pe') and not carga_costos;

create or replace function puede_cargar_costos() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select carga_costos and activo from usuarios where id = auth.uid()), false);
$$;
revoke all on function puede_cargar_costos() from anon;

drop policy if exists "escritura_costos" on costos_mensuales;
create policy "escritura_costos" on costos_mensuales
  for all to authenticated
  using ( puede_cargar_costos() )
  with check ( puede_cargar_costos() );

--  El permiso se protege como los demás (060): solo Gerencia lo da o lo quita.
create or replace function usuarios_proteger_permisos()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_quien uuid := auth.uid();
  v_rol   rol_usuario;
begin
  if v_quien is null then
    return new;
  end if;
  select rol into v_rol from usuarios where id = v_quien;

  if (new.rol, new.activo, new.almacen_id, new.aprueba_cotizaciones, new.carga_costos)
     is distinct from (old.rol, old.activo, old.almacen_id, old.aprueba_cotizaciones, old.carga_costos)
     and v_rol is distinct from 'gerencia' then
    raise exception 'Solo Gerencia puede cambiar el rol, el estado, el almacén o los permisos de aprobar y de cargar costos de un usuario.';
  end if;

  if new.ve_objetivos is distinct from old.ve_objetivos
     and not coalesce((select ve_objetivos from usuarios where id = v_quien), false) then
    raise exception 'Solo quien ya tiene acceso a Objetivos mensuales puede darlo o quitarlo.';
  end if;

  return new;
end $$;


-- ============================================================================
--  2. LAS ALERTAS PRINCIPALES, EN TONELADAS
--  Misma vista que 059; cambian las dos que contaban pallets.
-- ============================================================================
drop view if exists v_alertas_principales;
create view v_alertas_principales as
with
venc as (
  select count(*) filter (where situacion = 'por_vencer')                       as por_vencer,
         coalesce(sum(fisico_kg) filter (where situacion = 'por_vencer'), 0)    as kg,
         count(*) filter (where situacion = 'vencido')                          as vencidos,
         coalesce(sum(fisico_kg) filter (where situacion = 'vencido'), 0)       as kg_vencido
    from v_stock_por_vencer),
cond as (
  select count(*) as n, coalesce(sum(fisico_kg), 0) as kg,
         coalesce(sum(fisico_kg) filter (where condicion = 'condicionado'), 0) as kg_nacional
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
       round(venc.kg / 1000, 1) as cifra, 'TM' as unidad,
       format('%s pallets en los próximos %s días · %s TM ya vencidas',
              venc.por_vencer, param_num('vencimiento_aviso_dias', 90)::int, to_char(venc.kg_vencido / 1000, 'FM999G990D0')) as detalle,
       '/almacenes/alertas#por-vencer' as ruta, 'Stock por vencer' as aviso
  from venc
union all
select 2, 'condicion', 'Stock observado, inmovilizado o condicionado',
       case when cond.n > 0 then 'advertencia' else 'ok' end,
       round(cond.kg / 1000, 1), 'TM',
       format('%s pallets · %s TM disponibles solo para mercado nacional', cond.n, to_char(cond.kg_nacional / 1000, 'FM999G990D0')),
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
  'Las seis alertas que el documento de mejoras pide concentrar. El producto se cuenta en toneladas; los pedidos, en pedidos.';


-- ============================================================================
--  3. EL AVISO DE STOCK POR VENCER, EMPEZANDO POR LAS TONELADAS
-- ============================================================================
create or replace function stock_avisar_por_vencer()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_lotes int; v_kg numeric; v_valor numeric; v_dias int;
begin
  v_dias := param_num('vencimiento_aviso_dias', 90)::int;

  select count(*), coalesce(sum(fisico_kg), 0), coalesce(sum(valor), 0)
    into v_lotes, v_kg, v_valor
    from v_anticuamiento
   where situacion_vida_util = 'por_vencer' and fisico_kg > 0;

  if v_lotes = 0 then
    update alertas set atendida = true
     where entidad = 'lote' and titulo = 'Stock por vencer' and not atendida;
    return 0;
  end if;

  perform alerta_resumen('lote', 'Stock por vencer', 'advertencia',
    format('%s TM vencen en los próximos %s días (%s pallets, US$ %s). Conviene colocarlas antes de que haya que rematarlas.',
           to_char(v_kg / 1000, 'FM999G990D0'), v_dias, v_lotes, to_char(round(v_valor), 'FM999G999G990')));
  return v_lotes;
end $$;

select stock_avisar_por_vencer();
