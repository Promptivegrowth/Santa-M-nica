-- ============================================================================
--  080b · EL SALDO INICIAL NO ES PRODUCCIÓN DEL MES
-- ============================================================================
--  Re-ejecutable (`create or replace`; la vista conserva sus columnas).
--
--  La carga inicial (080) entra al Kardex como movimientos «ingreso» con
--  documento «inventario_inicial» y fecha del día de la carga: así el Kardex,
--  las existencias y el costo promedio salen de los movimientos, como siempre.
--  Pero tres cálculos sumaban todo «ingreso» del mes como si fuera lo que se
--  produjo, y habrían mostrado ~2 017 TM producidas en noviembre de 2026:
--
--   · v_movimiento_mensual (gráfico «Ingresos frente a despachos» del panel).
--   · cierre_erp (Cierre de producción): el saldo inicial ahora cuenta como
--     STOCK INICIAL del mes de la carga (y de ahí en adelante), no como
--     producción real.
--   · objetivos_erp (Objetivos mensuales: toneladas de producto terminado).
--
--  Las definiciones son las vigentes (063 y 060/062) con ese único cambio.
-- ============================================================================

create or replace view v_movimiento_mensual as
 select to_char(date_trunc('month', fecha), 'YYYY-MM') as periodo,
        date_trunc('month', fecha) as mes,
        sum(case when tipo = 'ingreso' and documento_tipo is distinct from 'inventario_inicial'
                 then peso_neto_kg else 0 end) / 1000 as ingresos_tm,
        sum(case when tipo = 'salida_despacho' then peso_neto_kg else 0 end) / 1000 as despachos_tm,
        sum(case when tipo = 'traslado_salida' then peso_neto_kg else 0 end) / 1000 as traslados_tm
   from movimientos
  where fecha >= now() - interval '1 year 2 mons'
  group by to_char(date_trunc('month', fecha), 'YYYY-MM'), date_trunc('month', fecha)
  order by date_trunc('month', fecha);

create or replace function cierre_erp(p_anio integer, p_mes integer)
 RETURNS TABLE(especie text, prod_real numeric, stock_inicial numeric, ventas numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_desde date := make_date(p_anio, p_mes, 1);
  v_hasta date := (make_date(p_anio, p_mes, 1) + interval '1 month')::date;
begin
  if not puede_ver_objetivos() then return; end if;
  return query
  with esp as (select distinct c.especie from cierre_categorias c where c.especie is not null and c.activo),
  k as (
    select k.especie as esp, (k.fecha at time zone 'America/Lima')::date as dia, k.tipo,
           coalesce(k.entrada_kg, 0) as entra, coalesce(k.salida_kg, 0) as sale,
           --  080: el saldo con que arrancó el sistema no es producción del mes.
           coalesce(k.documento_tipo = 'inventario_inicial', false) as inicial
      from v_kardex k
     where k.especie in (select e.especie from esp e)
  ),
  vent as (
    select esp_.nombre as esp, coalesce(sum(pkl.peso_neto_kg), 0) as kg
      from despachos d
      join packing_lists pk on pk.id = d.packing_list_id and pk.estado <> 'anulado'
      join packing_lineas pkl on pkl.packing_list_id = pk.id
      join lotes l on l.id = pkl.lote_id
      join sku_presentaciones sp on sp.id = l.sku_presentacion_id
      join skus s on s.id = sp.sku_id
      join especies esp_ on esp_.id = s.especie_id
     where (d.fecha_salida at time zone 'America/Lima')::date >= v_desde
       and (d.fecha_salida at time zone 'America/Lima')::date <  v_hasta
     group by esp_.nombre
  )
  select e.especie,
         round(coalesce((select sum(entra) from k where k.esp = e.especie and k.tipo = 'ingreso' and not k.inicial
                           and k.dia >= v_desde and k.dia < v_hasta), 0) / 1000, 3),
         round(coalesce((select sum(entra - sale) from k where k.esp = e.especie
                           and (k.dia < v_desde or (k.inicial and k.dia < v_hasta))), 0) / 1000, 3),
         round(coalesce((select v.kg from vent v where v.esp = e.especie), 0) / 1000, 3)
    from esp e;
end $function$;

create or replace function objetivos_erp(p_anio integer)
 RETURNS TABLE(fuente text, mes integer, valor numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_hoy date := (now() at time zone 'America/Lima')::date;
begin
  if not puede_ver_objetivos() then
    return;
  end if;

  return query
  with meses as (
    select m, make_date(p_anio, m, 1) as inicio, (make_date(p_anio, m, 1) + interval '1 month')::date as fin
      from generate_series(1, 12) m
     where make_date(p_anio, m, 1) <= v_hoy
  ),
  ingresos as (
    select (k.fecha at time zone 'America/Lima')::date as dia, l.proceso::text as proceso,
           case when k.especie in ('POTA', 'BONITO', 'MERLUZA') then lower(k.especie) else 'otras' end as especie,
           k.formato, k.entrada_kg
      from v_kardex k join lotes l on l.id = k.lote_id
     where k.tipo = 'ingreso'
       and k.documento_tipo is distinct from 'inventario_inicial'   -- 080: el saldo inicial no es producción
       and (k.fecha at time zone 'America/Lima')::date >= make_date(p_anio, 1, 1)
       and (k.fecha at time zone 'America/Lima')::date <  make_date(p_anio + 1, 1, 1)
  ),
  produccion as (
    --  Todas las combinaciones, aunque el mes no tenga ingresos: cero es un dato.
    select 'pt_' || pr.proceso || '_' || es.especie as fuente, ms.m,
           coalesce((select sum(i.entrada_kg) from ingresos i
                      where i.proceso = pr.proceso and i.especie = es.especie
                        and i.dia >= ms.inicio and i.dia < ms.fin), 0) / 1000 as valor
      from meses ms
      cross join (values ('propia'), ('maquila')) pr(proceso)
      cross join (values ('pota'), ('bonito'), ('merluza'), ('otras')) es(especie)
  ),
  precocido as (
    select 'tn_precocido', ms.m,
           coalesce((select sum(i.entrada_kg) from ingresos i
                      where i.proceso = 'propia' and i.formato = 'PRECOCIDOS'
                        and i.dia >= ms.inicio and i.dia < ms.fin), 0) / 1000
      from meses ms
  ),
  despachado as (
    select (d.fecha_salida at time zone 'America/Lima')::date as dia, d.id,
           (select coalesce(sum(pkl.peso_neto_kg), 0) from packing_lineas pkl
             where pkl.packing_list_id = d.packing_list_id) as kg
      from despachos d
      join packing_lists pk on pk.id = d.packing_list_id and pk.estado <> 'anulado'
  ),
  embarques as (
    select 'tn_embarcadas', ms.m,
           coalesce((select sum(kg) from despachado x where x.dia >= ms.inicio and x.dia < ms.fin), 0) / 1000
      from meses ms
    union all
    select 'contenedores', ms.m,
           (select count(*) from despachado x where x.dia >= ms.inicio and x.dia < ms.fin)::numeric
      from meses ms
  ),
  saldos as (
    --  Stock a una fecha = todo lo que entró menos todo lo que salió antes.
    select a.tipo::text as tipo_almacen, a.codigo, (k.fecha at time zone 'America/Lima')::date as dia,
           coalesce(k.entrada_kg, 0) - coalesce(k.salida_kg, 0) as neto
      from v_kardex k join almacenes a on a.id = k.almacen_id
  ),
  inventario as (
    select 'inv_stm', ms.m, coalesce((select sum(neto) from saldos s where s.tipo_almacen = 'propio' and s.dia < ms.inicio), 0) / 1000
      from meses ms
    union all
    select 'inv_freeko', ms.m, coalesce((select sum(neto) from saldos s where s.codigo = 'FREEKO' and s.dia < ms.inicio), 0) / 1000
      from meses ms
    union all
    select 'inv_otros', ms.m, coalesce((select sum(neto) from saldos s where s.tipo_almacen <> 'propio' and s.codigo <> 'FREEKO' and s.dia < ms.inicio), 0) / 1000
      from meses ms
    union all
    --  Al cierre del mes; si el mes está en curso, a hoy.
    select 'tn_alm_ext', ms.m, coalesce((select sum(neto) from saldos s where s.tipo_almacen <> 'propio' and s.dia < ms.fin), 0) / 1000
      from meses ms
  )
  select * from produccion
  union all select * from precocido
  union all select * from embarques
  union all select * from inventario;
end $function$;
