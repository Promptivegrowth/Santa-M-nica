-- ============================================================================
--  061 · «SOLO MERCADO NACIONAL»: LIBRE, PERO CON CONDICIÓN DE VENTA
-- ============================================================================
--  Oliver: «Debería estar libre, sin embargo con la condición de venta para
--  mercado nacional».
--
--  En 055 ese producto se modeló como observado, y un observado no se puede
--  reservar ni despachar. Ahora:
--
--    · deja de estar bloqueado: vuelve al disponible;
--    · pero solo puede ir a pedidos cuyo TIPO DE DESPACHO es «mercado
--      nacional» (campo que el pedido ya tenía). Lo impone la base: reservar
--      o cargar un pallet así en un pedido de exportación se rechaza;
--    · las cifras lo separan: el disponible trae aparte cuánto es solo
--      nacional, y el reparto del stock entre pedidos (Control de pedidos,
--      Producción) no deja que ese stock cubra pedidos de exportación.
-- ============================================================================


-- ============================================================================
--  1. QUÉ BLOQUEA Y QUÉ CONDICIONA
-- ============================================================================
--  Un dictamen abierto bloquea... salvo que su motivo solo condicione la venta.
create or replace function lote_bloqueado(p_lote_id bigint) returns boolean
language sql stable as $$
  select exists (
    select 1 from dictamenes_calidad d
      left join motivos m on m.id = d.motivo_id
     where d.lote_id = p_lote_id and d.vigente
       and d.estado in ('observado','inmovilizado','espera_resultados')
       and not coalesce(m.condiciona_venta, false)
  );
$$;
comment on function lote_bloqueado is
  'TRUE si el lote tiene alguna observación sanitaria abierta que impida venderlo. Un motivo que solo condiciona la venta (mercado nacional) no bloquea: ver lote_solo_nacional.';

create or replace function lote_solo_nacional(p_lote_id bigint) returns boolean
language sql stable as $$
  select not lote_bloqueado(p_lote_id) and exists (
    select 1 from dictamenes_calidad d
      join motivos m on m.id = d.motivo_id
     where d.lote_id = p_lote_id and d.vigente and d.estado <> 'liberado'
       and m.condiciona_venta
  );
$$;
comment on function lote_solo_nacional is
  'TRUE si el lote está libre pero solo puede venderse a pedidos de mercado nacional.';


-- ============================================================================
--  2. EL DISPONIBLE, CON LO NACIONAL APARTE
--  Se añade una columna AL FINAL (create or replace no admite otra cosa). El
--  disponible sigue siendo todo lo libre; «solo_nacional_kg» dice cuánto de
--  eso no se puede exportar.
-- ============================================================================
create or replace view v_stock_lote as
select
  e.lote_id,
  e.almacen_id,
  e.camara_id,
  l.sku_presentacion_id,
  l.fecha_produccion,
  l.campania,
  l.codigo_pallet,
  l.codigo_lote,
  e.peso_neto_kg                                   as fisico_kg,
  e.bultos                                         as fisico_bultos,
  e.costo_promedio,
  case when lote_bloqueado(e.lote_id) then e.peso_neto_kg else 0 end as bloqueado_kg,
  coalesce(r.reservado_kg, 0)                      as reservado_kg,
  coalesce(r.preparacion_kg, 0)                    as preparacion_kg,
  greatest(
    e.peso_neto_kg
      - (case when lote_bloqueado(e.lote_id) then e.peso_neto_kg else 0 end)
      - coalesce(r.reservado_kg, 0)
      - coalesce(r.preparacion_kg, 0)
  , 0)                                             as disponible_kg,
  (extract(epoch from (now() - l.fecha_produccion::timestamptz)) / 2629800)::numeric(8,2) as meses_almacenado,
  --  Nuevo: la parte del disponible que solo puede ir a mercado nacional.
  case when lote_solo_nacional(e.lote_id)
       then greatest(e.peso_neto_kg - coalesce(r.reservado_kg, 0) - coalesce(r.preparacion_kg, 0), 0)
       else 0 end                                  as solo_nacional_kg
from existencias e
join lotes l on l.id = e.lote_id
left join lateral (
  select
    sum(case when rv.estado = 'activa'          then rv.peso_neto_kg else 0 end) as reservado_kg,
    sum(case when rv.estado = 'en_preparacion'  then rv.peso_neto_kg else 0 end) as preparacion_kg
  from reservas rv
  where rv.lote_id = e.lote_id
    and rv.almacen_id = e.almacen_id
    and rv.estado in ('activa','en_preparacion')
) r on true
where e.bultos > 0;

create or replace view v_disponibilidad as
select
  sp.id                              as sku_presentacion_id,
  sp.sku_id,
  s.codigo                           as sku_codigo,
  esp.nombre                         as especie,
  f.nombre                           as formato,
  s.corte,
  p.descripcion                      as presentacion,
  p.peso_bulto_kg,
  a.id                               as almacen_id,
  a.nombre                           as almacen,
  a.tipo                             as almacen_tipo,
  coalesce(sum(v.fisico_kg), 0)      as fisico_kg,
  coalesce(sum(v.bloqueado_kg), 0)   as bloqueado_kg,
  coalesce(sum(v.reservado_kg), 0)   as reservado_kg,
  coalesce(sum(v.preparacion_kg), 0) as preparacion_kg,
  coalesce(sum(v.disponible_kg), 0)  as disponible_kg,
  coalesce(sum(v.fisico_bultos), 0)  as fisico_bultos,
  case when coalesce(sum(v.fisico_kg),0) > 0
       then sum(v.fisico_kg * v.costo_promedio) / sum(v.fisico_kg)
       else 0 end                    as costo_promedio,
  count(distinct v.lote_id)          as lotes,
  coalesce(sum(v.solo_nacional_kg), 0) as solo_nacional_kg
from sku_presentaciones sp
join skus s        on s.id = sp.sku_id
join especies esp  on esp.id = s.especie_id
join formatos f    on f.id = s.formato_id
join presentaciones p on p.id = sp.presentacion_id
cross join almacenes a
left join v_stock_lote v
       on v.sku_presentacion_id = sp.id and v.almacen_id = a.id
where a.activo
group by sp.id, sp.sku_id, s.codigo, esp.nombre, f.nombre, s.corte,
         p.descripcion, p.peso_bulto_kg, a.id, a.nombre, a.tipo
having coalesce(sum(v.fisico_kg), 0) > 0;


-- ============================================================================
--  3. EL REPARTO DEL STOCK ENTRE PEDIDOS, EN DOS BOLSAS
--  Por producto hay dos bolsas de stock libre:
--    · la general, que sirve a cualquier pedido;
--    · la «solo nacional», que solo sirve a pedidos de mercado nacional.
--  Primero los pedidos nacionales toman de su bolsa, por prioridad; lo que
--  les falte, y todo lo de exportación, se reparte de la general por
--  prioridad. Así el stock nacional no cubre nunca un pedido de exportación y
--  el backorder de exportación no sale más bajo de lo real.
--  Mismas columnas que antes (052).
-- ============================================================================
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
    (p.tipo_despacho = 'mercado_nacional') as nacional,
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
  where p.ciclo = 'confirmado'
),
pendiente as (
  select
    l.*,
    greatest(l.pedido_kg - l.despachado_kg, 0)                  as pendiente_kg,
    greatest(l.pedido_kg - l.despachado_kg - l.reservado_kg, 0) as sin_reservar_kg
  from lineas l
),
bolsas as (
  select p.*,
         coalesce(b.general_kg, 0)  as general_kg,
         coalesce(b.nacional_kg, 0) as nacional_kg
    from pendiente p
    left join lateral (
      select sum(d.disponible_kg - d.solo_nacional_kg) as general_kg,
             sum(d.solo_nacional_kg)                   as nacional_kg
        from v_disponibilidad d
       where d.sku_presentacion_id = p.sku_presentacion_id
    ) b on true
),
paso1 as (
  --  Los nacionales, de su bolsa, por prioridad.
  select b.*,
         case when b.nacional then
           least(b.sin_reservar_kg, greatest(b.nacional_kg - coalesce(sum(case when b.nacional then b.sin_reservar_kg else 0 end) over (
             partition by b.sku_presentacion_id
             order by b.rango_prioridad, b.fecha_comprometida nulls last, b.pedido_id, b.linea_id
             rows between unbounded preceding and 1 preceding), 0), 0))
         else 0 end as cubre_nacional_kg
    from bolsas b
),
paso2 as (
  --  Lo que falta, de la general, por prioridad.
  select p.*,
         least(p.sin_reservar_kg - p.cubre_nacional_kg,
               greatest(p.general_kg - coalesce(sum(p.sin_reservar_kg - p.cubre_nacional_kg) over (
                 partition by p.sku_presentacion_id
                 order by p.rango_prioridad, p.fecha_comprometida nulls last, p.pedido_id, p.linea_id
                 rows between unbounded preceding and 1 preceding), 0), 0)) as cubre_general_kg
    from paso1 p
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
  cubre_nacional_kg + cubre_general_kg                                   as cubre_libre_kg,
  least(pendiente_kg, reservado_kg + cubre_nacional_kg + cubre_general_kg) as con_stock_kg,
  greatest(sin_reservar_kg - cubre_nacional_kg - cubre_general_kg, 0)    as backorder_kg
from paso2;

comment on view v_pedido_linea_cobertura is
  'Reparto del stock libre entre las líneas de pedidos confirmados, por prioridad y fecha. El stock «solo mercado nacional» solo cubre pedidos de mercado nacional.';


-- ============================================================================
--  4. LA REGLA, EN LA BASE
-- ============================================================================
create or replace function validar_condicion_de_venta()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_tipo   tipo_despacho;
  v_pf     text;
  v_pallet text;
begin
  --  Anidado a propósito: PL/pgSQL no garantiza cortocircuito en «and», y
  --  packing_lineas no tiene «estado». Con un solo if, TODA carga de pallets
  --  a un packing fallaba (lo detectó la prueba).
  if tg_table_name = 'reservas' then
    if new.estado not in ('activa', 'en_preparacion') then
      return new;
    end if;
  end if;
  if not lote_solo_nacional(new.lote_id) then
    return new;
  end if;
  select p.tipo_despacho, p.numero_proforma into v_tipo, v_pf
    from pedido_lineas pl join pedidos p on p.id = pl.pedido_id
   where pl.id = new.pedido_linea_id;
  if v_tipo is distinct from 'mercado_nacional' then
    select codigo_pallet into v_pallet from lotes where id = new.lote_id;
    raise exception 'El pallet % es «Solo mercado nacional» y el pedido % no es de mercado nacional: no se puede reservar ni cargar para exportación.',
      v_pallet, coalesce(v_pf, '(sin número)');
  end if;
  return new;
end $$;

drop trigger if exists trg_reservas_condicion_venta on reservas;
create trigger trg_reservas_condicion_venta
  before insert or update of lote_id, pedido_linea_id, estado on reservas
  for each row execute function validar_condicion_de_venta();

drop trigger if exists trg_packing_condicion_venta on packing_lineas;
create trigger trg_packing_condicion_venta
  before insert or update of lote_id, pedido_linea_id on packing_lineas
  for each row execute function validar_condicion_de_venta();

--  Y al revés: no se puede condicionar un pallet que ya está apartado para
--  exportación sin antes liberar esa reserva. Si no, quedaría una reserva que
--  la regla de arriba nunca habría permitido.
create or replace function validar_dictamen_condiciona()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_pf text;
begin
  if not new.vigente or new.estado = 'liberado'
     or not exists (select 1 from motivos where id = new.motivo_id and condiciona_venta) then
    return new;
  end if;
  select p.numero_proforma into v_pf
    from reservas r
    join pedido_lineas pl on pl.id = r.pedido_linea_id
    join pedidos p on p.id = pl.pedido_id
   where r.lote_id = new.lote_id and r.estado in ('activa', 'en_preparacion')
     and p.tipo_despacho is distinct from 'mercado_nacional'
   limit 1;
  if v_pf is not null then
    raise exception 'Este pallet está apartado para el pedido % de exportación. Libere esa reserva antes de marcarlo «Solo mercado nacional».', v_pf;
  end if;
  return new;
end $$;

drop trigger if exists trg_dictamen_condiciona on dictamenes_calidad;
create trigger trg_dictamen_condiciona
  before insert or update on dictamenes_calidad
  for each row execute function validar_dictamen_condiciona();


-- ============================================================================
--  5. EL AVISO DIARIO, CON LO NACIONAL COMO DISPONIBLE CONDICIONADO
-- ============================================================================
create or replace function stock_avisar_condicion()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_lotes int; v_tm numeric;
  v_inm numeric; v_nac numeric; v_obs numeric; v_esp numeric;
begin
  select count(*), coalesce(sum(fisico_kg), 0) / 1000,
         coalesce(sum(fisico_kg) filter (where condicion = 'inmovilizado'), 0) / 1000,
         coalesce(sum(fisico_kg) filter (where condicion = 'condicionado'), 0) / 1000,
         coalesce(sum(fisico_kg) filter (where condicion = 'observado'), 0) / 1000,
         coalesce(sum(fisico_kg) filter (where condicion = 'en_espera'), 0) / 1000
    into v_lotes, v_tm, v_inm, v_nac, v_obs, v_esp
    from v_stock_condicion;

  if v_lotes = 0 then
    update alertas set atendida = true, atendida_en = now()
     where entidad = 'lote' and titulo = 'Stock observado, inmovilizado o condicionado' and not atendida;
    return 0;
  end if;

  perform alerta_resumen('lote', 'Stock observado, inmovilizado o condicionado', 'advertencia',
    format('%s TM no se pueden exportar (%s pallets): %s TM inmovilizadas, %s TM observadas, %s TM en espera de resultados y %s TM disponibles solo para mercado nacional.',
           to_char(v_tm, 'FM999G990D0'), v_lotes, to_char(v_inm, 'FM999G990D0'), to_char(v_obs, 'FM999G990D0'),
           to_char(v_esp, 'FM999G990D0'), to_char(v_nac, 'FM999G990D0')));
  return v_lotes;
end $$;

select stock_avisar_condicion();
