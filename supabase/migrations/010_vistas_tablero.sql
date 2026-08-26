-- ============================================================================
--  SANTA MÓNICA ERP · MIGRACIÓN 010 · VISTAS DE TABLERO E INDICADORES
-- ============================================================================
--  Las pantallas de tablero necesitan datos ya resumidos. Calcular esos
--  resúmenes en la base de datos —y no en el navegador— hace que la pantalla
--  abra rápido y que el navegador reciba unas pocas filas en lugar de miles.
--
--  Aquí viven los indicadores que pide la especificación del cliente:
--  los 11 KPI de ventas y los 10 de almacenes.
-- ============================================================================


-- ============================================================================
--  1. RESUMEN GENERAL DE INVENTARIO
-- ============================================================================
create or replace view v_resumen_inventario as
select
  coalesce(sum(fisico_kg), 0)      as fisico_kg,
  coalesce(sum(bloqueado_kg), 0)   as bloqueado_kg,
  coalesce(sum(reservado_kg), 0)   as reservado_kg,
  coalesce(sum(preparacion_kg), 0) as preparacion_kg,
  coalesce(sum(disponible_kg), 0)  as disponible_kg,
  coalesce(sum(fisico_kg * costo_promedio), 0) as valor_total,
  count(distinct lote_id)          as lotes,
  count(distinct almacen_id)       as almacenes
from v_stock_lote;


-- ============================================================================
--  2. OCUPABILIDAD POR ALMACÉN
--  Uno de los indicadores que ya sigue el cliente en su Power BI.
-- ============================================================================
create or replace view v_ocupabilidad as
select
  a.id            as almacen_id,
  a.codigo,
  a.nombre        as almacen,
  a.tipo,
  a.capacidad_tm,
  coalesce(sum(v.fisico_kg), 0) / 1000            as ocupado_tm,
  coalesce(sum(v.disponible_kg), 0) / 1000        as disponible_tm,
  coalesce(sum(v.reservado_kg + v.preparacion_kg), 0) / 1000 as comprometido_tm,
  coalesce(sum(v.bloqueado_kg), 0) / 1000         as bloqueado_tm,
  case when a.capacidad_tm > 0
       then least(999, (coalesce(sum(v.fisico_kg), 0) / 1000) / a.capacidad_tm * 100)
       else null end                              as ocupabilidad_pct,
  count(distinct v.lote_id)                       as lotes
from almacenes a
left join v_stock_lote v on v.almacen_id = a.id
where a.activo
group by a.id, a.codigo, a.nombre, a.tipo, a.capacidad_tm;


-- ============================================================================
--  3. MOVIMIENTO MENSUAL: lo que entra frente a lo que sale
-- ============================================================================
create or replace view v_movimiento_mensual as
select
  to_char(date_trunc('month', fecha), 'YYYY-MM')  as periodo,
  date_trunc('month', fecha)                      as mes,
  sum(case when tipo = 'ingreso'         then peso_neto_kg else 0 end) / 1000 as ingresos_tm,
  sum(case when tipo = 'salida_despacho' then peso_neto_kg else 0 end) / 1000 as despachos_tm,
  sum(case when tipo in ('traslado_salida') then peso_neto_kg else 0 end) / 1000 as traslados_tm
from movimientos
where fecha >= now() - interval '14 months'
group by 1, 2
order by 2;


-- ============================================================================
--  4. INDICADORES COMERCIALES
--  Las fórmulas son las de la lámina "KPI CLAVES — VENTAS" del cliente.
-- ============================================================================
create or replace view v_kpi_ventas as
with
-- Valor de cada pedido (cantidad × precio con descuento aplicado)
valor_pedidos as (
  select
    p.id, p.ciclo, p.cobertura, p.situacion, p.moneda, p.fecha_solicitada,
    p.fecha_comprometida, p.cliente_id, p.prioridad,
    sum(pl.cantidad_tm * pl.precio_tm * (1 - pl.descuento_pct / 100)) as venta,
    sum(pl.cantidad_tm * pl.costo_estimado_tm)                        as costo,
    sum(pl.cantidad_tm)                                               as tm
  from pedidos p
  join pedido_lineas pl on pl.pedido_id = p.id
  group by p.id
)
select
  -- Venta comprometida: pedidos confirmados que todavía no salieron
  coalesce(sum(case when ciclo = 'confirmado' then venta else 0 end), 0)        as venta_comprometida,
  -- Venta despachada del mes en curso
  coalesce(sum(case when ciclo in ('despachado','cerrado')
                     and fecha_solicitada >= date_trunc('month', current_date)
                    then venta else 0 end), 0)                                  as venta_mes,
  coalesce(sum(case when ciclo in ('despachado','cerrado') then venta else 0 end), 0) as venta_acumulada,
  -- Backlog: lo pendiente de atender
  coalesce(sum(case when ciclo in ('confirmado','pendiente_validacion') then venta else 0 end), 0) as backlog,
  -- Pedidos en riesgo: comprometidos, sin stock cubierto y con fecha encima
  count(*) filter (where ciclo = 'confirmado'
                     and cobertura in ('pendiente_stock','parcialmente_disponible'))  as pedidos_en_riesgo,
  coalesce(sum(venta) filter (where ciclo = 'confirmado'
                     and cobertura in ('pendiente_stock','parcialmente_disponible')), 0) as venta_en_riesgo,
  count(*) filter (where ciclo = 'confirmado')                                   as pedidos_abiertos,
  count(*) filter (where situacion = 'bloqueado_credito')                        as pedidos_bloqueados,
  count(*) filter (where ciclo = 'confirmado' and fecha_comprometida < current_date) as pedidos_atrasados,
  count(*) filter (where prioridad = 'urgente' and ciclo not in ('cerrado','cancelado')) as pedidos_urgentes,
  -- Margen promedio
  case when coalesce(sum(venta), 0) > 0
       then (coalesce(sum(venta),0) - coalesce(sum(costo),0)) / coalesce(sum(venta),0) * 100
       else 0 end                                                                as margen_pct,
  coalesce(sum(tm) filter (where ciclo = 'confirmado'), 0)                       as tm_comprometidas
from valor_pedidos;


-- ============================================================================
--  5. CUENTAS POR COBRAR
-- ============================================================================
create or replace view v_cuentas_cobrar as
select
  f.id, f.numero, f.cliente_id, c.razon_social as cliente, c.pais,
  f.moneda, f.total, f.fecha_emision, f.fecha_vencimiento, f.estado,
  coalesce((select sum(monto) from cobranzas cb where cb.factura_id = f.id), 0) as cobrado,
  f.total - coalesce((select sum(monto) from cobranzas cb where cb.factura_id = f.id), 0) as saldo,
  (current_date - f.fecha_vencimiento)                                          as dias_vencida,
  case
    when f.estado = 'cobrada' then 'Al día'
    when f.fecha_vencimiento >= current_date then 'Vigente'
    when current_date - f.fecha_vencimiento <= 30 then '1 a 30 días'
    when current_date - f.fecha_vencimiento <= 60 then '31 a 60 días'
    when current_date - f.fecha_vencimiento <= 90 then '61 a 90 días'
    else 'Más de 90 días'
  end                                                                           as tramo_antiguedad
from facturas f
join clientes c on c.id = f.cliente_id
where f.estado <> 'anulada';


-- ============================================================================
--  6. RENTABILIDAD POR PEDIDO
--  El costo real sale de los lotes efectivamente despachados; el estimado, de
--  lo que se previó al vender. La diferencia entre ambos es información valiosa.
-- ============================================================================
create or replace view v_rentabilidad_pedido as
select
  p.id                     as pedido_id,
  p.numero_proforma,
  p.cliente_id,
  c.razon_social           as cliente,
  p.vendedor_id,
  vd.nombre                as vendedor,
  p.moneda,
  p.ciclo,
  p.fecha_solicitada,
  sum(pl.cantidad_tm)                                                   as tm,
  sum(pl.cantidad_tm * pl.precio_tm * (1 - pl.descuento_pct / 100))     as venta,
  sum(pl.cantidad_tm * pl.costo_estimado_tm)                            as costo_estimado,
  -- Costo real: promedio ponderado de los lotes que efectivamente salieron
  coalesce((
    select sum(pkl.peso_neto_kg / 1000 * e.costo_promedio * 1000)
      from packing_lineas pkl
      join packing_lists pk on pk.id = pkl.packing_list_id
      join embarque_pedidos ep on ep.embarque_id = pk.embarque_id
      join existencias e on e.lote_id = pkl.lote_id
     where ep.pedido_id = p.id
  ), 0)                                                                 as costo_real,
  sum(pl.cantidad_tm * pl.precio_tm * (1 - pl.descuento_pct / 100))
    - sum(pl.cantidad_tm * pl.costo_estimado_tm)                        as margen,
  case when sum(pl.cantidad_tm * pl.precio_tm * (1 - pl.descuento_pct / 100)) > 0
       then (sum(pl.cantidad_tm * pl.precio_tm * (1 - pl.descuento_pct / 100))
             - sum(pl.cantidad_tm * pl.costo_estimado_tm))
            / sum(pl.cantidad_tm * pl.precio_tm * (1 - pl.descuento_pct / 100)) * 100
       else 0 end                                                       as margen_pct
from pedidos p
join pedido_lineas pl on pl.pedido_id = p.id
join clientes c on c.id = p.cliente_id
left join vendedores vd on vd.id = p.vendedor_id
group by p.id, p.numero_proforma, p.cliente_id, c.razon_social,
         p.vendedor_id, vd.nombre, p.moneda, p.ciclo, p.fecha_solicitada;


-- ============================================================================
--  7. PEDIDOS CON SU SEMÁFORO
--  Los cinco colores que pide la especificación, calculados a partir del
--  avance real de las reservas y los despachos.
-- ============================================================================
create or replace view v_pedidos_tablero as
select
  p.id, p.numero_proforma, p.cliente_id, c.razon_social as cliente, c.pais,
  p.vendedor_id, p.moneda, p.tipo_cambio, p.incoterm, p.prioridad,
  p.fecha_solicitada, p.fecha_comprometida,
  p.ciclo, p.cobertura, p.situacion,
  d.puerto as destino, d.pais as destino_pais,
  coalesce(t.tm, 0)      as tm_pedidas,
  coalesce(t.venta, 0)   as venta,
  coalesce(r.reservado_kg, 0) / 1000    as tm_reservadas,
  coalesce(r.consumido_kg, 0) / 1000    as tm_despachadas,
  case when coalesce(t.tm,0) > 0
       then least(100, (coalesce(r.reservado_kg,0) + coalesce(r.consumido_kg,0)) / 10 / coalesce(t.tm,1))
       else 0 end        as avance_pct,
  greatest(coalesce(t.tm,0) - (coalesce(r.reservado_kg,0) + coalesce(r.consumido_kg,0)) / 1000, 0) as tm_faltantes,
  (p.fecha_comprometida < current_date and p.ciclo = 'confirmado') as atrasado,
  c.bloqueado                                                     as cliente_bloqueado,
  -- El semáforo: cinco estados, en orden de gravedad
  case
    when p.ciclo in ('despachado','cerrado')                            then 'despachado'
    when c.bloqueado or p.situacion = 'bloqueado_credito'               then 'bloqueado'
    when p.fecha_comprometida < current_date and p.ciclo = 'confirmado' then 'riesgo'
    when p.cobertura in ('reservado','preparado','en_preparacion','programado','completo') then 'completo'
    else 'parcial'
  end as semaforo
from pedidos p
join clientes c on c.id = p.cliente_id
left join destinos d on d.id = p.destino_id
left join lateral (
  select sum(pl.cantidad_tm) as tm,
         sum(pl.cantidad_tm * pl.precio_tm * (1 - pl.descuento_pct/100)) as venta
    from pedido_lineas pl where pl.pedido_id = p.id
) t on true
left join lateral (
  select sum(case when rv.estado in ('activa','en_preparacion') then rv.peso_neto_kg else 0 end) as reservado_kg,
         sum(case when rv.estado = 'consumida' then rv.peso_neto_kg else 0 end) as consumido_kg
    from reservas rv
    join pedido_lineas pl2 on pl2.id = rv.pedido_linea_id
   where pl2.pedido_id = p.id
) r on true;


-- ============================================================================
--  8. NECESIDADES
--  Qué falta para cumplir los pedidos confirmados: la diferencia entre lo
--  prometido y lo que hay disponible.
-- ============================================================================
create or replace view v_necesidades as
select
  pl.sku_presentacion_id,
  s.codigo                 as sku_codigo,
  esp.nombre               as especie,
  fo.nombre                as formato,
  s.corte,
  pr.descripcion           as presentacion,
  sum(pl.cantidad_tm)      as tm_pedidas,
  coalesce(max(disp.disponible_tm), 0) as tm_disponibles,
  greatest(sum(pl.cantidad_tm) - coalesce(max(disp.disponible_tm), 0), 0) as tm_faltantes,
  count(distinct p.id)     as pedidos,
  min(p.fecha_comprometida) as fecha_mas_proxima
from pedido_lineas pl
join pedidos p on p.id = pl.pedido_id
join sku_presentaciones sp on sp.id = pl.sku_presentacion_id
join skus s on s.id = sp.sku_id
join especies esp on esp.id = s.especie_id
join formatos fo on fo.id = s.formato_id
join presentaciones pr on pr.id = sp.presentacion_id
left join lateral (
  select sum(d.disponible_kg) / 1000 as disponible_tm
    from v_disponibilidad d where d.sku_presentacion_id = pl.sku_presentacion_id
) disp on true
where p.ciclo = 'confirmado'
group by pl.sku_presentacion_id, s.codigo, esp.nombre, fo.nombre, s.corte, pr.descripcion
having greatest(sum(pl.cantidad_tm) - coalesce(max(disp.disponible_tm), 0), 0) > 0;


-- ============================================================================
--  9. PRODUCTIVIDAD DE DESPACHO
--  Tiempo real de carga frente al objetivo. El cliente hoy promedia 4,9 horas
--  contra un plan de 2 horas: este indicador lo hace visible.
-- ============================================================================
create or replace view v_productividad_despacho as
select
  pk.id, pk.codigo, pk.contenedor, pk.fecha_carga, pk.turno,
  a.nombre as almacen,
  u.nombre as supervisor,
  extract(epoch from (pk.hora_fin - pk.hora_inicio)) / 3600 as horas_carga,
  param_num('tiempo_carga_objetivo_horas', 2)               as horas_objetivo,
  (select coalesce(sum(bultos),0) from packing_lineas where packing_list_id = pk.id) as bultos,
  (select coalesce(sum(peso_neto_kg),0)/1000 from packing_lineas where packing_list_id = pk.id) as tm
from packing_lists pk
join embarques e on e.id = pk.embarque_id
join almacenes a on a.id = e.almacen_id
left join usuarios u on u.id = pk.supervisor_id
where pk.hora_inicio is not null and pk.hora_fin is not null;


-- ============================================================================
--  10. ROTACIÓN Y PRODUCTO SIN MOVIMIENTO
-- ============================================================================
create or replace view v_rotacion_sku as
select
  sp.id                  as sku_presentacion_id,
  s.codigo               as sku_codigo,
  esp.nombre             as especie,
  fo.nombre              as formato,
  s.corte,
  pr.descripcion         as presentacion,
  coalesce(st.fisico_kg, 0) / 1000        as stock_tm,
  coalesce(sal.salidas_kg, 0) / 1000      as salidas_12m_tm,
  case when coalesce(st.fisico_kg, 0) > 0
       then coalesce(sal.salidas_kg, 0) / st.fisico_kg
       else 0 end                          as rotacion,
  coalesce(st.dias_sin_movimiento, 9999)  as dias_sin_movimiento,
  coalesce(st.fisico_kg, 0) * coalesce(st.costo, 0) as valor
from sku_presentaciones sp
join skus s on s.id = sp.sku_id
join especies esp on esp.id = s.especie_id
join formatos fo on fo.id = s.formato_id
join presentaciones pr on pr.id = sp.presentacion_id
left join lateral (
  select sum(v.fisico_kg) as fisico_kg,
         avg(v.costo_promedio) as costo,
         min(extract(day from now() - l.fecha_produccion::timestamptz))::int as dias_sin_movimiento
    from v_stock_lote v join lotes l on l.id = v.lote_id
   where l.sku_presentacion_id = sp.id
) st on true
left join lateral (
  select sum(m.peso_neto_kg) as salidas_kg
    from movimientos m join lotes l on l.id = m.lote_id
   where l.sku_presentacion_id = sp.id
     and m.tipo = 'salida_despacho'
     and m.fecha >= now() - interval '12 months'
) sal on true
where coalesce(st.fisico_kg, 0) > 0 or coalesce(sal.salidas_kg, 0) > 0;
