-- ============================================================================
--  053 · COBERTURA DE STOCK POR FAMILIA
-- ============================================================================
--  Documento de mejoras, punto 1.1:
--
--    «Incluir los días de cobertura por familia de producto: Filetes, Alas,
--     Nucas, Tentáculos, Recortes, etc.
--     Cobertura = Stock actual × 26 días / Despacho del mes anterior»
--
--  Y en el cuadro resumen: «por familia, no por SKU».
--
--  QUÉ ES UNA «FAMILIA»
--  Las que nombra —Filetes, Alas, Nucas, Tentáculos, Recortes— son nuestros
--  FORMATOS, no la clasificación comercial (que parte el filete en «fresco CP»
--  y «Daruma»). Es además como ya las leyó Oliver en la reunión: «filete 300
--  toneladas, aleta 200».
--
--  Se agrupa por especie Y formato. El formato ya pertenece a una especie —hay
--  un FILETE de pota y otro de merluza—, y mezclarlos daría una cobertura que
--  no sirve para nada: si falta filete de pota, el de merluza no lo cubre.
--
--  LO QUE DICE LA FÓRMULA
--  Stock × 26 / despachado el mes pasado = cuántos días hábiles alcanza lo que
--  hay, si se sigue despachando al mismo ritmo. Los 26 son días hábiles del
--  mes y van a parámetros: la fórmula es del cliente, el número también.
--
--  LOS DOS CASOS QUE LA FÓRMULA NO RESUELVE
--   · Sin despachos el mes pasado: dividir por cero. No es «cobertura
--     infinita» —es que no hay ritmo con el que medir—, y se dice así.
--   · Sin stock pero con despachos el mes pasado: cobertura CERO. Es el caso
--     más grave de todos —se estuvo vendiendo y ya no queda—, y por eso la
--     vista junta stock y despachos con un FULL JOIN: con un join normal, las
--     familias que se agotaron desaparecerían justo cuando más importan.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
--  1 · LOS DOS NÚMEROS QUE MANDA EL CLIENTE
-- ────────────────────────────────────────────────────────────────────────────
insert into parametros (clave, valor, tipo_dato, grupo, etiqueta, editable_por, descripcion, unidad) values
  ('cobertura_dias_mes', '26', 'numero', 'inventario', 'Días hábiles del mes (cobertura)', 'gerencia',
   'Los días con los que se calcula la cobertura: stock × estos días / despachado el mes anterior. El documento de mejoras fija 26.', 'días'),
  ('cobertura_minima_dias', '15', 'numero', 'inventario', 'Cobertura mínima antes de avisar', 'gerencia',
   'Por debajo de estos días de cobertura, la familia salta como «baja cobertura» en Alertas. El documento no fija el umbral: se propone 15 y se ajusta aquí.', 'días')
on conflict (clave) do nothing;


-- ────────────────────────────────────────────────────────────────────────────
--  2 · LA COBERTURA, FAMILIA POR FAMILIA
-- ────────────────────────────────────────────────────────────────────────────
create or replace view v_cobertura_familia as
with stock as (
  select especie, formato,
         sum(fisico_kg)     as stock_kg,
         sum(disponible_kg) as disponible_kg,
         count(*)           as lotes
    from v_anticuamiento
   where fisico_kg > 0
   group by especie, formato
),
despachado as (
  --  Lo que salió el MES CALENDARIO anterior, no «los últimos 30 días»: el
  --  documento dice «despacho del mes anterior», y un mes calendario es lo que
  --  se compara contra el reporte de despachos que ya manejan.
  select e.nombre as especie, f.nombre as formato,
         sum(pl.peso_neto_kg) as despachado_kg
    from despachos d
    join packing_lineas pl       on pl.packing_list_id = d.packing_list_id
    join lotes l                 on l.id = pl.lote_id
    join sku_presentaciones sp   on sp.id = l.sku_presentacion_id
    join skus s                  on s.id = sp.sku_id
    join formatos f              on f.id = s.formato_id
    join especies e              on e.id = s.especie_id
   where (d.fecha_salida at time zone 'America/Lima')::date
           >= (date_trunc('month', (now() at time zone 'America/Lima')) - interval '1 month')::date
     and (d.fecha_salida at time zone 'America/Lima')::date
           <  date_trunc('month', (now() at time zone 'America/Lima'))::date
   group by e.nombre, f.nombre
),
junto as (
  --  FULL JOIN: una familia agotada que se vendió el mes pasado tiene que
  --  aparecer, y con un join normal desaparecería.
  select coalesce(s.especie, d.especie)   as especie,
         coalesce(s.formato, d.formato)   as formato,
         coalesce(s.stock_kg, 0)          as stock_kg,
         coalesce(s.disponible_kg, 0)     as disponible_kg,
         coalesce(s.lotes, 0)             as lotes,
         coalesce(d.despachado_kg, 0)     as despachado_mes_anterior_kg
    from stock s
    full join despachado d on d.especie = s.especie and d.formato = s.formato
),
parametros_cobertura as (
  select param_num('cobertura_dias_mes', 26)   as dias_mes,
         param_num('cobertura_minima_dias', 15) as minimo
)
select
  j.especie,
  j.formato,
  --  Cómo se llama en pantalla: el formato solo, salvo que no sea pota —que
  --  es el 98 % del negocio y no hace falta repetirlo—.
  case when j.especie = 'POTA' then j.formato
       else j.formato || ' (' || lower(j.especie) || ')' end as familia,
  j.stock_kg,
  j.disponible_kg,
  j.lotes,
  j.despachado_mes_anterior_kg,
  --  La fórmula del cliente. Sin despachos no hay ritmo: nulo, no infinito.
  case when j.despachado_mes_anterior_kg > 0
       then round(j.stock_kg * pc.dias_mes / j.despachado_mes_anterior_kg, 1)
  end                                                        as cobertura_dias,
  case
    when j.stock_kg <= 0 and j.despachado_mes_anterior_kg > 0 then 'agotada'
    when j.despachado_mes_anterior_kg <= 0                    then 'sin_movimiento'
    when j.stock_kg * pc.dias_mes / j.despachado_mes_anterior_kg < pc.minimo then 'baja'
    else 'normal'
  end                                                        as situacion,
  pc.dias_mes,
  pc.minimo                                                  as minimo_dias
from junto j
cross join parametros_cobertura pc;

comment on view v_cobertura_familia is
  'Los días de cobertura por familia (especie y formato) con la fórmula del cliente: stock actual × días hábiles / despachado el mes calendario anterior. Una familia agotada que se vendió el mes pasado aparece con cobertura cero —es el caso más grave—; una sin despachos queda sin cobertura calculada, porque no hay ritmo con el que medirla.';


-- ────────────────────────────────────────────────────────────────────────────
--  3 · EL AVISO DE BAJA COBERTURA
-- ────────────────────────────────────────────────────────────────────────────
--  Un solo aviso de resumen, que se refresca en vez de duplicarse: es la misma
--  pieza que se usa para el stock por vencer (migración 043).
create or replace function cobertura_avisar_baja()
returns int language plpgsql security definer set search_path = public as $$
declare v_n int; v_lista text;
begin
  select count(*),
         string_agg(
           familia || ' ' ||
             case when situacion = 'agotada' then 'agotada'
                  else coalesce(cobertura_dias::text, '?') || ' días' end,
           ', ' order by coalesce(cobertura_dias, 0))
    into v_n, v_lista
    from v_cobertura_familia
   where situacion in ('baja', 'agotada');

  if v_n = 0 then
    update alertas set atendida = true
     where titulo = 'Familias con baja cobertura' and not atendida;
    return 0;
  end if;

  perform alerta_resumen('inventario', 'Familias con baja cobertura', 'advertencia',
    format('%s familia(s) por debajo del mínimo de cobertura: %s.', v_n, v_lista));
  return v_n;
end $$;

comment on function cobertura_avisar_baja is
  'Deja abierto un único aviso con las familias cuya cobertura está por debajo del mínimo configurado, o agotadas. Se cierra solo cuando ninguna lo está.';

--  Cada mañana, junto a los demás avisos programados.
select cron.unschedule('avisar_baja_cobertura')
 where exists (select 1 from cron.job where jobname = 'avisar_baja_cobertura');
select cron.schedule('avisar_baja_cobertura', '20 11 * * *', $$select cobertura_avisar_baja()$$);
