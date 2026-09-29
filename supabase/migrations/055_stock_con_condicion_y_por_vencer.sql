-- ============================================================================
--  055 · STOCK CON CONDICIÓN Y STOCK PRÓXIMO A VENCER
-- ============================================================================
--  Documento de mejoras, puntos 1.2 y 1.3 (cuadro resumen, filas 2 y 3):
--
--    «Inventario próximo a vencer: generar alertas automáticas mostrando
--     producto, familia, lote, cantidad, fecha de vencimiento y días
--     restantes.»
--
--    «Stock observado, inmovilizado o con condición especial: cuadro para
--     identificar inventario observado, inmovilizado o con condición especial
--     de venta, especialmente el destinado normalmente a mercado nacional.»
--
--  LO QUE YA HABÍA
--  Los dictámenes de calidad (002) ya observan e inmovilizan lotes, y un lote
--  con un dictamen abierto no se puede reservar ni despachar. Lo que faltaba es
--  la TERCERA situación: el producto que sí se puede vender, pero no a
--  cualquiera. En el maestro de Oliver es la columna AT:
--
--      LIBERADO                              2 030 filas
--      INMOVILIZADO SANIPES RECORTES            63
--      MERCADO NACIONAL                         60    ← la condición de venta
--      INMOVILIZADO SANIPES - RETORNO           46
--      CALIDAD                                   6
--
--  Y la regla de Oliver para la columna AU: «OK todo lo disponible, OBS todo lo
--  que está observado». MERCADO NACIONAL va con OBS: no está disponible para
--  exportar. Por eso se modela como un MOTIVO de observación —que ya saca el
--  lote del disponible— marcado como «condiciona la venta», y no como un
--  estado nuevo que obligaría a revisar cada regla de bloqueo del sistema.
-- ============================================================================


-- ============================================================================
--  0. EL VENCIMIENTO SE CUENTA EN HORA DE LIMA
--  v_anticuamiento (036) contaba los días con current_date, que en el servidor
--  es la fecha UTC: de 19:00 a medianoche en Lima ya es «mañana», y un pallet
--  que vence hoy salía como vencido cinco horas antes de tiempo. Se vio al
--  cuadrar esta pantalla con la de anticuamiento: 61 vencidos en una, 60 en la
--  otra, a las 20:00. Misma vista, mismas columnas; solo cambia el «hoy».
-- ============================================================================
create or replace view v_anticuamiento as
select
  v.lote_id,
  v.almacen_id,
  a.nombre                as almacen,
  l.codigo_pallet,
  l.fecha_produccion,
  s.codigo                as sku_codigo,
  esp.nombre              as especie,
  f.nombre                as formato,
  s.corte,
  v.fisico_kg,
  v.disponible_kg,
  v.costo_promedio,
  v.fisico_kg * v.costo_promedio as valor,
  v.meses_almacenado,
  case
    when v.meses_almacenado < 12 then '<12'
    when v.meses_almacenado < 18 then '12-18'
    when v.meses_almacenado < 24 then '18-24'
    else '>24'
  end as rango,
  -- ¿Supera el umbral de alerta configurado por el cliente?
  v.meses_almacenado >= param_num('anticuamiento_alerta_meses', 12) as en_alerta,
  -- ¿Superó la vida útil?
  v.meses_almacenado >= coalesce(s.vida_util_meses, param_num('vida_util_meses', 24)) as vencido,

  /* ---- Lo nuevo: el vencimiento como FECHA ---- */

  -- La vida útil que rige para este producto, en meses.
  coalesce(s.vida_util_meses, param_num('vida_util_meses', 24))::int as vida_util_meses,

  -- El día en que deja de ser apto.
  (l.fecha_produccion
    + (coalesce(s.vida_util_meses, param_num('vida_util_meses', 24))::int || ' months')::interval
  )::date                 as fecha_vencimiento,

  /*
   * Días que le quedan. Negativo significa que ya se pasó, y el signo importa:
   * «−40» y «40» son situaciones opuestas y conviene que se lean distinto de
   * un vistazo.
   */
  ((l.fecha_produccion
    + (coalesce(s.vida_util_meses, param_num('vida_util_meses', 24))::int || ' months')::interval
   )::date - (now() at time zone 'America/Lima')::date)::int as dias_para_vencer,

  /*
   * Tres situaciones, que son las que Oliver describió: lo que ya se pasó, lo
   * que se va a pasar pronto —y todavía se puede colocar— y el resto.
   *
   * «Pronto» son 90 días. En un producto de dos años de vida, avisar con un
   * mes no da tiempo a vender un contenedor; con tres, sí.
   */
  case
    when (l.fecha_produccion
          + (coalesce(s.vida_util_meses, param_num('vida_util_meses', 24))::int || ' months')::interval
         )::date < (now() at time zone 'America/Lima')::date then 'vencido'
    when (l.fecha_produccion
          + (coalesce(s.vida_util_meses, param_num('vida_util_meses', 24))::int || ' months')::interval
         )::date <= (now() at time zone 'America/Lima')::date + param_num('vencimiento_aviso_dias', 90)::int then 'por_vencer'
    else 'vigente'
  end                     as situacion_vida_util,

  /*
   * La familia comercial, para agrupar el stock como se agrupa en los
   * reportes: «filete 300 TM, aletas 200 TM».
   *
   * Va la ÚLTIMA a propósito: `create or replace view` no admite insertar una
   * columna en medio —sería renombrar las que vienen detrás— y solo deja
   * añadir al final.
   */
  s.clasificacion_comercial as familia
from v_stock_lote v
join lotes l       on l.id = v.lote_id
join almacenes a   on a.id = v.almacen_id
join sku_presentaciones sp on sp.id = l.sku_presentacion_id
join skus s        on s.id = sp.sku_id
join especies esp  on esp.id = s.especie_id
join formatos f    on f.id = s.formato_id;


-- ============================================================================
--  1. EL MOTIVO QUE CONDICIONA LA VENTA
-- ============================================================================
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'motivos' and column_name = 'condiciona_venta') then
    alter table motivos add column condiciona_venta boolean not null default false;
  end if;
end $$;

comment on column motivos.condiciona_venta is
  'El producto observado por este motivo no está perdido: se puede vender, pero solo con una condición —hoy, al mercado nacional—. Lo separa de lo observado o inmovilizado a secas en el cuadro de stock con condición.';

insert into motivos (ambito, codigo, nombre, requiere_autorizacion, activo, condiciona_venta)
select 'bloqueo', 'MERCADO_NACIONAL', 'Solo mercado nacional', false, true, true
 where not exists (select 1 from motivos where ambito = 'bloqueo' and codigo = 'MERCADO_NACIONAL');

--  Por si el insert anterior chocó con una fila que ya existía sin la marca.
update motivos set condiciona_venta = true
 where ambito = 'bloqueo' and codigo = 'MERCADO_NACIONAL' and not condiciona_venta;


-- ============================================================================
--  2. DATOS DE DEMOSTRACIÓN
--  La data de prueba no traía ningún caso de mercado nacional, y un cuadro
--  vacío no se puede revisar. Se reclasifican las observaciones que en la
--  planta suelen terminar ahí —bajo peso y quemadura por frío— SOLO si todavía
--  no existe ninguna. Con la data real, que ya trae la columna AT, no toca nada.
-- ============================================================================
do $$
declare v_motivo bigint;
begin
  select id into v_motivo from motivos where ambito = 'bloqueo' and codigo = 'MERCADO_NACIONAL';
  if not exists (select 1 from dictamenes_calidad where motivo_id = v_motivo) then
    update dictamenes_calidad d
       set motivo_id    = v_motivo,
           motivo_texto = case m.codigo
                            when 'BAJO_PESO'      then 'Bajo peso para exportación'
                            when 'QUEMADURA_FRIO' then 'Quemadura por frío leve'
                          end
      from motivos m
     where m.id = d.motivo_id
       and m.codigo in ('BAJO_PESO', 'QUEMADURA_FRIO')
       and d.estado = 'observado'
       and d.vigente;
  end if;
end $$;


-- ============================================================================
--  3. EL CUADRO DE STOCK CON CONDICIÓN
--  Un lote puede tener varios dictámenes abiertos —calidad, micro, cámara—.
--  Se muestra UNA fila por lote y almacén, con la condición más fuerte:
--
--    inmovilizado  no se puede tocar (SANIPES, por ejemplo)
--    condicionado  se puede vender, pero solo con la condición del motivo
--    observado     en revisión; puede liberarse o no
--    en_espera     esperando resultados de laboratorio
--
--  El orden importa: un lote condicionado a mercado nacional que además
--  SANIPES inmoviliza no se puede vender a nadie, así que es inmovilizado.
-- ============================================================================
--  El de por vencer depende de este: se suelta primero para poder rehacerlo.
drop view if exists v_stock_por_vencer;
drop view if exists v_stock_condicion;
create view v_stock_condicion as
with abiertos as (
  select d.lote_id,
         bool_or(d.estado = 'inmovilizado')                           as hay_inmovilizado,
         bool_or(coalesce(m.condiciona_venta, false))                 as hay_condicion,
         bool_or(d.estado = 'observado')                              as hay_observado,
         --  El motivo que se lee en el cuadro: el tipificado y, si lo hay, el
         --  detalle que escribió Calidad.
         string_agg(distinct
           coalesce(m.nombre, 'Sin tipificar')
           || coalesce(' · ' || nullif(trim(d.motivo_texto), ''), ''), ' / ') as motivos,
         string_agg(distinct m.nombre, ' / ')
           filter (where m.condiciona_venta)                          as condicion_venta,
         count(*)                                                     as dictamenes,
         min(d.emitido_en)                                            as desde
    from dictamenes_calidad d
    left join motivos m on m.id = d.motivo_id
   where d.vigente and d.estado <> 'liberado'
   group by d.lote_id
)
select
  a.lote_id,
  a.almacen_id,
  a.almacen,
  a.codigo_pallet,
  l.codigo_lote,
  a.sku_codigo,
  a.especie,
  a.formato,
  a.corte,
  --  La familia como la cuenta la cobertura (053): el formato, y la especie
  --  solo si no es pota. «FILETE», no «FILETE FRESCO CP».
  case when a.especie = 'POTA' then a.formato
       else a.formato || ' (' || lower(a.especie) || ')' end            as familia,
  a.fisico_kg,
  a.valor,
  a.fecha_produccion,
  a.fecha_vencimiento,
  case
    when ab.hay_inmovilizado then 'inmovilizado'
    when ab.hay_condicion    then 'condicionado'
    when ab.hay_observado    then 'observado'
    else 'en_espera'
  end                                                                 as condicion,
  ab.condicion_venta,
  ab.motivos,
  ab.dictamenes,
  ab.desde,
  --  En hora de Lima: a las 20:00 del lunes en Lima ya es martes en UTC.
  ((now() at time zone 'America/Lima')::date
    - (ab.desde at time zone 'America/Lima')::date)::int              as dias_en_condicion
from v_anticuamiento a
join abiertos ab on ab.lote_id = a.lote_id
join lotes l     on l.id = a.lote_id
where a.fisico_kg > 0;

comment on view v_stock_condicion is
  'Stock observado, inmovilizado o con condición especial de venta (mercado nacional), una fila por lote y almacén con la condición más fuerte de sus dictámenes abiertos.';


-- ============================================================================
--  4. EL CUADRO DE PRÓXIMOS A VENCER
--  v_anticuamiento ya calcula el vencimiento, pero cuenta los días con
--  current_date, que en el servidor es UTC: de 19:00 a medianoche en Lima le
--  sobraba un día a todo. Aquí se cuentan en hora de Lima, se agrega el lote
--  y se dice si además está retenido —un pallet por vencer que Calidad tiene
--  observado no se puede ofrecer, por mucha prisa que haya—.
-- ============================================================================
drop view if exists v_stock_por_vencer;
create view v_stock_por_vencer as
select
  a.lote_id,
  a.almacen_id,
  a.almacen,
  a.codigo_pallet,
  l.codigo_lote,
  a.sku_codigo,
  a.especie,
  a.formato,
  a.corte,
  --  La familia como la cuenta la cobertura (053): el formato, y la especie
  --  solo si no es pota. «FILETE», no «FILETE FRESCO CP».
  case when a.especie = 'POTA' then a.formato
       else a.formato || ' (' || lower(a.especie) || ')' end            as familia,
  a.fisico_kg,
  a.disponible_kg,
  a.valor,
  a.fecha_produccion,
  a.vida_util_meses,
  a.fecha_vencimiento,
  (a.fecha_vencimiento - (now() at time zone 'America/Lima')::date)::int as dias_restantes,
  case
    when a.fecha_vencimiento < (now() at time zone 'America/Lima')::date then 'vencido'
    else 'por_vencer'
  end                                                                    as situacion,
  c.condicion
from v_anticuamiento a
join lotes l on l.id = a.lote_id
left join v_stock_condicion c on c.lote_id = a.lote_id and c.almacen_id = a.almacen_id
where a.fisico_kg > 0
  and a.fecha_vencimiento
      <= (now() at time zone 'America/Lima')::date + param_num('vencimiento_aviso_dias', 90)::int;

comment on view v_stock_por_vencer is
  'Lotes con stock vencidos o que vencen dentro del aviso configurado, con los días restantes en hora de Lima y su condición de calidad si la tienen.';


-- ============================================================================
--  5. EL AVISO
--  Uno solo, con el resumen, y que se actualiza en vez de repetirse (043).
-- ============================================================================
create or replace function stock_avisar_condicion()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_lotes int; v_tm numeric;
  v_inm int; v_cond int; v_obs int; v_esp int;
begin
  select count(*), coalesce(sum(fisico_kg), 0) / 1000,
         count(*) filter (where condicion = 'inmovilizado'),
         count(*) filter (where condicion = 'condicionado'),
         count(*) filter (where condicion = 'observado'),
         count(*) filter (where condicion = 'en_espera')
    into v_lotes, v_tm, v_inm, v_cond, v_obs, v_esp
    from v_stock_condicion;

  if v_lotes = 0 then
    update alertas set atendida = true, atendida_en = now()
     where entidad = 'lote' and titulo = 'Stock observado, inmovilizado o condicionado'
       and not atendida;
    return 0;
  end if;

  perform alerta_resumen('lote', 'Stock observado, inmovilizado o condicionado', 'advertencia',
    format('%s pallets (%s TM) no se pueden exportar: %s inmovilizados, %s solo para mercado nacional, %s observados y %s en espera de resultados.',
           v_lotes, to_char(v_tm, 'FM999G990D0'), v_inm, v_cond, v_obs, v_esp));
  return v_lotes;
end $$;

comment on function stock_avisar_condicion is
  'Aviso diario con el resumen del stock retenido por calidad o con condición de venta. Uno solo, que se actualiza.';

select stock_avisar_condicion();

do $$
begin
  perform cron.unschedule('avisar_stock_condicion')
    where exists (select 1 from cron.job where jobname = 'avisar_stock_condicion');
  perform cron.schedule('avisar_stock_condicion', '30 11 * * *', 'select stock_avisar_condicion()');
end $$;
