-- ============================================================================
--  071 · LAS FECHAS QUE SÍ SON POSIBLES Y EL MARGEN QUE NO SE INVENTA
-- ============================================================================
--  Dos correcciones de la lista de «Limitaciones conocidas» de la guía.
--
--  1 · TIEMPOS DEL FLUJO: LA REGLA DE «FECHAS IMPOSIBLES» (026)
--      Exigía que los seis hitos fueran en fila —cotización ≤ pedido ≤
--      programado ≤ despacho ≤ factura ≤ cobro— y apartaba de TODOS los
--      promedios al pedido que no cumpliera. Dos de esos pasos no son
--      imposibles, son el negocio:
--
--        · Salir ANTES de la fecha programada. La propia pantalla dice que un
--          Programado → Despachado negativo «es buena noticia»; la regla, en
--          cambio, lo trataba como un dato mal grabado y lo sacaba del
--          cálculo justo cuando la planta lo había hecho mejor.
--        · Facturar ANTES de despachar. Es legal, y el sistema lo permite con
--          un aviso («se facturaría antes de despachar», facturas/acciones).
--
--      Lo que sigue siendo imposible es que un hecho ocurra antes de que
--      exista el pedido del que depende, que la oferta sea posterior al
--      pedido que la aceptó, o que se cobre un comprobante antes de emitirlo:
--
--        · la cotización, después del pedido;
--        · la salida programada, antes del pedido;
--        · el despacho, la factura o el cobro, antes del pedido;
--        · el cobro, antes de su factura. La base ya lo rechaza al registrar
--          el cobro (cobranzas_validar: «Un adelanto se registra en la
--          proforma, no en el comprobante»); si aparece, es un dato viejo o
--          importado que alguien tiene que corregir.
--
--      Las fechas iguales valen (todo con ≤), un pedido directo no tiene
--      cotización que comparar (coalesce a «válido») y la salida se compara
--      en fecha de Lima, no de UTC, como ya hacía 026.
--
--      Además, la vista dice AHORA POR QUÉ: `motivo_cronologia` (al final,
--      para no mover las columnas de 026). La pantalla lo cuenta.
--
--  2 · RENTABILIDAD: LAS LÍNEAS SIN COSTO
--      Una línea sin costo cargado entraba con costo cero, o sea con un
--      margen del 100 %, y subía el margen del mes, del pedido y de la
--      familia. Ahora:
--        · Margen bruto (057): la línea sin costo tiene `margen` NULL, y los
--          totales por pedido y por mes miden el margen y su porcentaje
--          SOLO sobre la venta que tiene costo. La venta sin costo se da
--          aparte (kilos e importe) para avisarla.
--        · Por pedido (021): el costo es el estimado de la línea de pedido,
--          que hoy se graba en cero al crear el pedido. Se añaden al final las
--          columnas «con costo» y «sin costo»; las de siempre (`margen`,
--          `margen_pct`) no cambian, porque otras pantallas las leen.
--
--  Re-ejecutable: todo es `create or replace` y las columnas nuevas van al
--  final de cada vista.
-- ============================================================================


-- ============================================================================
--  1. v_tiempos_flujo
--  Idéntica a la 026 salvo `cronologia_valida` y la columna nueva del final.
-- ============================================================================
create or replace view v_tiempos_flujo as
with hitos as (
  select
    p.id                                        as pedido_id,
    p.numero_proforma,
    p.cliente_id,
    cl.razon_social                             as cliente,
    cl.pais,
    p.vendedor_id,
    vd.nombre                                   as vendedor,
    ds.puerto                                   as destino,
    p.ciclo,
    p.prioridad,
    p.tipo_despacho,
    c.numero                                    as cotizacion,

    -- --- Los hitos, en fechas de negocio ---
    c.fecha                                     as f_cotizacion,
    p.fecha_solicitada                          as f_pedido,
    p.fecha_comprometida,
    min(e.fecha_programada)                     as f_programada,
    /* La salida es timestamptz: se lleva a la fecha de Lima, no a la de UTC.
       Un despacho de las ocho de la noche caía en UTC en el día siguiente. */
    min((dp.fecha_salida at time zone 'America/Lima')::date) as f_despacho,
    min(fa.fecha_emision)                       as f_factura,
    min(cb.fecha)                               as f_cobro,

    sum(distinct_tm.tm)                         as tm,
    a_dolares(sum(distinct_tm.venta), p.moneda, p.tipo_cambio) as venta_usd
  from pedidos p
  join clientes cl              on cl.id = p.cliente_id
  left join vendedores vd       on vd.id = p.vendedor_id
  left join destinos ds         on ds.id = p.destino_id
  left join cotizaciones c      on c.id = p.cotizacion_id
  left join embarque_pedidos ep on ep.pedido_id = p.id
  left join embarques e         on e.id = ep.embarque_id and e.estado <> 'cancelado'
  left join packing_lists pk    on pk.embarque_id = e.id
  left join despachos dp        on dp.packing_list_id = pk.id
  left join facturas fa         on fa.pedido_id = p.id and fa.estado <> 'anulada'
  left join cobranzas cb        on cb.factura_id = fa.id
  /* Toneladas e importe aparte, por LATERAL: sumados en el mismo SELECT se
     multiplicarían por cada embarque, packing y factura. */
  left join lateral (
    select sum(pl.cantidad_tm) as tm,
           sum(pl.cantidad_tm * pl.precio_tm * (1 - pl.descuento_pct / 100)) as venta
      from pedido_lineas pl where pl.pedido_id = p.id
  ) distinct_tm on true
  group by p.id, cl.razon_social, cl.pais, vd.nombre, ds.puerto, c.numero, c.fecha,
           distinct_tm.tm, distinct_tm.venta
)
select
  h.*,

  (f_pedido - f_cotizacion)                     as dias_negociacion,
  (f_programada - f_pedido)                     as dias_a_programar,
  -- Puntualidad: negativo es que salió ANTES de lo programado. Es válido.
  (f_despacho - f_programada)                   as dias_puntualidad,
  (f_despacho - coalesce(f_cotizacion, f_pedido)) as dias_total,
  -- Negativo: se facturó antes de despachar. Es válido.
  (f_factura - f_despacho)                      as dias_a_facturar,
  (f_cobro - f_factura)                         as dias_a_cobrar,
  (f_despacho - fecha_comprometida)             as dias_vs_compromiso,

  /*
   * ¿HAY ALGO QUE NO PUEDE HABER OCURRIDO?
   * Solo lo que contradice el origen de la cadena: nada sale, se programa,
   * se factura ni se cobra antes de que exista el pedido; la oferta no
   * puede ser posterior al pedido que la aceptó, y un comprobante no se
   * cobra antes de emitirse. Con ≤: el mismo día vale.
   */
  (
    coalesce(f_cotizacion <= f_pedido, true)
    and coalesce(f_pedido <= f_programada, true)
    and coalesce(f_pedido <= f_despacho, true)
    and coalesce(f_pedido <= f_factura, true)
    and coalesce(f_pedido <= f_cobro, true)
    and coalesce(f_factura <= f_cobro, true)
  )                                             as cronologia_valida,

  /* El porqué, en palabras, para que la pantalla lo diga y alguien lo corrija.
     NULL si las fechas son posibles. */
  nullif(concat_ws(' · ',
    case when f_cotizacion > f_pedido then 'cotización posterior al pedido' end,
    case when f_programada < f_pedido then 'salida programada antes del pedido' end,
    case when f_despacho   < f_pedido then 'despachado antes del pedido' end,
    case when f_factura    < f_pedido then 'facturado antes del pedido' end,
    case when f_cobro      < f_pedido then 'cobrado antes del pedido' end,
    case when f_cobro      < f_factura then 'cobrado antes de la factura' end
  ), '')                                        as motivo_cronologia
from hitos h;

comment on view v_tiempos_flujo is
  'Cuánto tarda cada paso de la cadena, por pedido, con fechas de negocio. Pueden ser negativos y válidos: dias_puntualidad (salió antes de lo programado), dias_a_facturar (se facturó antes de despachar) y dias_vs_compromiso. cronologia_valida = false solo cuando algo ocurre antes que el propio pedido, la cotización es posterior al pedido o se cobra antes de la factura; motivo_cronologia dice cuál (071).';


-- ============================================================================
--  2. EL MARGEN BRUTO SIN LÍNEAS SIN COSTO
-- ============================================================================
--  2a · La línea: sin costo, sin margen (NULL), en lugar de un 100 % falso.
create or replace view v_margen_bruto_linea as
select
  pkl.id                                                        as packing_linea_id,
  pk.id                                                         as packing_list_id,
  d.id                                                          as despacho_id,
  (d.fecha_salida at time zone 'America/Lima')::date            as fecha_salida,
  date_trunc('month', d.fecha_salida at time zone 'America/Lima')::date as mes,
  p.id                                                          as pedido_id,
  p.numero_proforma,
  p.cliente_id,
  coalesce(c.nombre_corto, c.razon_social)                      as cliente,
  s.id                                                          as sku_id,
  s.codigo                                                      as sku,
  case when esp.nombre = 'POTA' then f.nombre
       else f.nombre || ' (' || lower(esp.nombre) || ')' end    as familia,
  l.id                                                          as lote_id,
  l.codigo_pallet,
  l.costo_origen,
  pkl.peso_neto_kg                                              as kg,
  a_dolares(pl.precio_tm * (1 - pl.descuento_pct / 100), p.moneda, p.tipo_cambio) as precio_tm,
  a_dolares(pl.precio_tm * (1 - pl.descuento_pct / 100), p.moneda, p.tipo_cambio)
    * pkl.peso_neto_kg / 1000                                   as venta,
  l.costo_unitario                                              as costo_kg,
  l.costo_unitario * pkl.peso_neto_kg                           as costo,
  case when l.costo_unitario > 0 then
    a_dolares(pl.precio_tm * (1 - pl.descuento_pct / 100), p.moneda, p.tipo_cambio)
      * pkl.peso_neto_kg / 1000 - l.costo_unitario * pkl.peso_neto_kg
  end                                                           as margen,
  (l.costo_unitario <= 0)                                       as sin_costo
from packing_lineas pkl
join packing_lists pk      on pk.id = pkl.packing_list_id and pk.estado <> 'anulado'
join despachos d           on d.packing_list_id = pk.id
join pedido_lineas pl      on pl.id = pkl.pedido_linea_id
join pedidos p             on p.id = pl.pedido_id
join clientes c            on c.id = p.cliente_id
join lotes l               on l.id = pkl.lote_id
join sku_presentaciones sp on sp.id = l.sku_presentacion_id
join skus s                on s.id = sp.sku_id
join especies esp          on esp.id = s.especie_id
join formatos f            on f.id = s.formato_id;

comment on view v_margen_bruto_linea is
  'Margen bruto por línea despachada: kilos × precio de su línea de pedido (US$) menos kilos × costo del lote del que salieron. Si el lote no tiene costo cargado (sin_costo), margen es NULL: no se le puede calcular (071).';

--  2b · Por pedido: margen y % solo sobre la venta con costo; lo sin costo, aparte.
create or replace view v_margen_bruto_pedido as
select
  pedido_id, numero_proforma, cliente_id, cliente,
  sum(kg)                                                       as kg,
  sum(venta)                                                    as venta,
  sum(costo)                                                    as costo,
  sum(margen)                                                   as margen,
  case when sum(venta) filter (where not sin_costo) > 0
       then round(sum(margen) / sum(venta) filter (where not sin_costo) * 100, 2) end as margen_pct,
  min(fecha_salida)                                             as primera_salida,
  max(fecha_salida)                                             as ultima_salida,
  count(*) filter (where sin_costo)                             as lineas_sin_costo,
  coalesce(sum(kg)    filter (where sin_costo), 0)              as kg_sin_costo,
  coalesce(sum(venta) filter (where sin_costo), 0)              as venta_sin_costo,
  coalesce(sum(venta) filter (where not sin_costo), 0)          as venta_con_costo
from v_margen_bruto_linea
group by pedido_id, numero_proforma, cliente_id, cliente;

--  2c · Por mes, igual.
create or replace view v_margen_bruto_mensual as
select
  mes,
  to_char(mes, 'YYYY-MM')                                       as clave,
  count(distinct pedido_id)                                     as pedidos,
  sum(kg)                                                       as kg,
  sum(venta)                                                    as venta,
  sum(costo)                                                    as costo,
  sum(margen)                                                   as margen,
  case when sum(venta) filter (where not sin_costo) > 0
       then round(sum(margen) / sum(venta) filter (where not sin_costo) * 100, 2) end as margen_pct,
  count(*) filter (where sin_costo)                             as lineas_sin_costo,
  coalesce(sum(kg)    filter (where sin_costo), 0)              as kg_sin_costo,
  coalesce(sum(venta) filter (where sin_costo), 0)              as venta_sin_costo,
  coalesce(sum(venta) filter (where not sin_costo), 0)          as venta_con_costo
from v_margen_bruto_linea
group by mes;

comment on view v_margen_bruto_mensual is
  'Margen bruto por mes de salida, en US$. venta es TODO lo despachado; margen y margen_pct se miden solo sobre la venta con costo (venta_con_costo). kg_sin_costo y venta_sin_costo dicen cuánto quedó fuera por no tener costo cargado (071).';


-- ============================================================================
--  3. v_rentabilidad_pedido: las columnas «con costo» y «sin costo», al final
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
  a_dolares(sum(pl.cantidad_tm * pl.precio_tm * (1 - pl.descuento_pct / 100)),
            p.moneda, p.tipo_cambio)                                    as venta,
  sum(pl.cantidad_tm * pl.costo_estimado_tm)                            as costo_estimado,
  coalesce((
    select sum(pkl.peso_neto_kg / 1000 * e.costo_promedio * 1000)
      from packing_lineas pkl
      join packing_lists pk on pk.id = pkl.packing_list_id
      join embarque_pedidos ep on ep.embarque_id = pk.embarque_id
      join existencias e on e.lote_id = pkl.lote_id
     where ep.pedido_id = p.id
  ), 0)                                                                 as costo_real,
  -- `margen` y `margen_pct` como siempre (021): otras pantallas los leen.
  a_dolares(sum(pl.cantidad_tm * pl.precio_tm * (1 - pl.descuento_pct / 100)),
            p.moneda, p.tipo_cambio)
    - sum(pl.cantidad_tm * pl.costo_estimado_tm)                        as margen,
  case when a_dolares(sum(pl.cantidad_tm * pl.precio_tm * (1 - pl.descuento_pct / 100)),
                      p.moneda, p.tipo_cambio) > 0
       then (a_dolares(sum(pl.cantidad_tm * pl.precio_tm * (1 - pl.descuento_pct / 100)),
                       p.moneda, p.tipo_cambio)
             - sum(pl.cantidad_tm * pl.costo_estimado_tm))
            / a_dolares(sum(pl.cantidad_tm * pl.precio_tm * (1 - pl.descuento_pct / 100)),
                        p.moneda, p.tipo_cambio) * 100
       else 0 end                                                       as margen_pct,
  sum(pl.cantidad_tm * pl.precio_tm * (1 - pl.descuento_pct / 100))     as venta_documento,
  p.tipo_cambio,

  /* ---- 071 · Lo que tiene costo y lo que no ----
     Una línea con costo estimado cero no tiene margen del 100 %: no tiene
     margen. Se mide el margen solo con las que tienen costo y lo demás se
     cuenta aparte, en toneladas y en dólares. */
  count(*) filter (where pl.costo_estimado_tm <= 0)                     as lineas_sin_costo,
  coalesce(sum(pl.cantidad_tm) filter (where pl.costo_estimado_tm <= 0), 0) as tm_sin_costo,
  coalesce(a_dolares(sum(pl.cantidad_tm * pl.precio_tm * (1 - pl.descuento_pct / 100))
                       filter (where pl.costo_estimado_tm <= 0),
                     p.moneda, p.tipo_cambio), 0)                       as venta_sin_costo,
  coalesce(a_dolares(sum(pl.cantidad_tm * pl.precio_tm * (1 - pl.descuento_pct / 100))
                       filter (where pl.costo_estimado_tm > 0),
                     p.moneda, p.tipo_cambio), 0)                       as venta_con_costo,
  -- NULL si ninguna línea tiene costo: no hay margen que medir.
  a_dolares(sum(pl.cantidad_tm * pl.precio_tm * (1 - pl.descuento_pct / 100))
              filter (where pl.costo_estimado_tm > 0),
            p.moneda, p.tipo_cambio)
    - sum(pl.cantidad_tm * pl.costo_estimado_tm) filter (where pl.costo_estimado_tm > 0)
                                                                        as margen_con_costo,
  case when a_dolares(sum(pl.cantidad_tm * pl.precio_tm * (1 - pl.descuento_pct / 100))
                        filter (where pl.costo_estimado_tm > 0),
                      p.moneda, p.tipo_cambio) > 0
       then (a_dolares(sum(pl.cantidad_tm * pl.precio_tm * (1 - pl.descuento_pct / 100))
                         filter (where pl.costo_estimado_tm > 0),
                       p.moneda, p.tipo_cambio)
             - sum(pl.cantidad_tm * pl.costo_estimado_tm) filter (where pl.costo_estimado_tm > 0))
            / a_dolares(sum(pl.cantidad_tm * pl.precio_tm * (1 - pl.descuento_pct / 100))
                          filter (where pl.costo_estimado_tm > 0),
                        p.moneda, p.tipo_cambio) * 100
  end                                                                   as margen_con_costo_pct
from pedidos p
join pedido_lineas pl on pl.pedido_id = p.id
join clientes c on c.id = p.cliente_id
left join vendedores vd on vd.id = p.vendedor_id
group by p.id, p.numero_proforma, p.cliente_id, c.razon_social,
         p.vendedor_id, vd.nombre, p.moneda, p.tipo_cambio, p.ciclo, p.fecha_solicitada;

comment on view v_rentabilidad_pedido is
  'Venta contra costo estimado, en dólares. margen/margen_pct (021) cuentan las líneas sin costo como margen pleno; margen_con_costo/margen_con_costo_pct se miden solo con las líneas que tienen costo, y tm_sin_costo/venta_sin_costo dicen cuánto quedó fuera (071).';
