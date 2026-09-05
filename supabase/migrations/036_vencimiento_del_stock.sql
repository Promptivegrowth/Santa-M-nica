-- ============================================================================
--  036 · CUÁNDO VENCE CADA PALLET, Y EL AVISO A COMERCIAL
-- ============================================================================
--  Oliver, sobre la pantalla de anticuamiento:
--
--    «Yo reviso y veo que esto está vencido, o sea que debo darle prioridad
--     [...] ¿filtros? Sí, correcto: el que está por vencer y los que ya de
--     repente tienen más tiempo. ¿Y hay forma de que se genere una alerta de
--     todo el producto que está por vencerse? [...] que le llegue la alerta a
--     comercial, para que estén pendientes.»
--
--  QUÉ FALTABA
--  La vista ya sabía si un lote había superado su vida útil, pero no CUÁNDO la
--  supera. Sin la fecha no se puede distinguir «le quedan tres días» de «le
--  quedan ocho meses», que es exactamente la diferencia entre poder colocarlo
--  y tener que rematarlo.
--
--  LA VIDA ÚTIL NO ES LA MISMA PARA TODOS
--  Cada producto puede tener la suya (`skus.vida_util_meses`); si no la tiene,
--  rige el parámetro general, hoy 24 meses. La pota maneja dos años.
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
   )::date - current_date)::int as dias_para_vencer,

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
         )::date < current_date then 'vencido'
    when (l.fecha_produccion
          + (coalesce(s.vida_util_meses, param_num('vida_util_meses', 24))::int || ' months')::interval
         )::date <= current_date + param_num('vencimiento_aviso_dias', 90)::int then 'por_vencer'
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

comment on view v_anticuamiento is
  'Antigüedad del stock por lote, con su fecha de vencimiento real y los días que le quedan. `situacion_vida_util` separa lo vencido de lo que está por vencer y todavía se puede colocar.';


-- ============================================================================
--  CON CUÁNTA ANTELACIÓN SE AVISA
-- ============================================================================
insert into parametros (clave, valor, tipo_dato, grupo, etiqueta, descripcion, unidad, editable_por)
values ('vencimiento_aviso_dias', '90', 'numero', 'inventario',
        'Aviso previo al vencimiento',
        'Con cuántos días de antelación se marca un lote como «por vencer» y se avisa a Comercial. En un producto de dos años de vida, avisar con un mes no da tiempo a vender un contenedor.',
        'días', 'operaciones')
on conflict (clave) do nothing;


-- ============================================================================
--  EL AVISO A COMERCIAL
--  Lo pidió expresamente: «que le llegue la alerta a comercial, para que estén
--  pendientes». Se genera una sola alerta con el resumen y no una por pallet:
--  cuarenta alertas iguales no son cuarenta avisos, son ruido y se dejan de
--  mirar.
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

  if v_lotes = 0 then return 0; end if;

  /*
   * No se repite el aviso si ya hay uno abierto del día. Una alerta que se
   * duplica cada vez que alguien abre una pantalla deja de leerse.
   */
  insert into alertas (entidad, entidad_id, severidad, titulo, mensaje)
  select 'lote', 0, 'advertencia', 'Stock por vencer',
         format('%s pallets (%s TM, US$ %s) vencen en los próximos %s días. Conviene colocarlos antes de que haya que rematarlos.',
                v_lotes,
                round(v_kg / 1000, 1),
                round(v_valor),
                v_dias)
   where not exists (
     select 1 from alertas
      where entidad = 'lote' and titulo = 'Stock por vencer'
        and not atendida and generada_en > now() - interval '20 hours'
   );

  return v_lotes;
end $$;

comment on function stock_avisar_por_vencer is
  'Avisa a Comercial del stock que vence pronto. Una sola alerta con el resumen, no una por pallet: cuarenta alertas iguales son ruido, no cuarenta avisos.';
