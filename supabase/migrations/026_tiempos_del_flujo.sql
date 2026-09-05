-- ============================================================================
--  026 · CUÁNTO TARDA CADA PASO
-- ============================================================================
--  Lo pidió Oliver en la reunión: «para ver cuál es el tiempo promedio que nos
--  lleva desde cotizar hasta despachar [...] desde que se cotiza hasta que se
--  programa el despacho, y otro desde que se programa hasta que se despacha».
--
--  POR QUÉ SE MIDE CON FECHAS DE NEGOCIO Y NO CON `creado_en`
--  Lo natural sería restar los `creado_en` de cada tabla: son marcas de tiempo
--  reales y precisas. Pero en los datos actuales todas caen en los tres días
--  del sembrado, así que darían cero. Y aunque en producción sí servirían,
--  hay una razón mejor para no usarlos: al cliente no le interesa cuándo se
--  TECLEÓ un documento, le interesa cuándo OCURRIÓ el hecho. Un embarque se
--  programa para el día 15 aunque se registre el día 3.
--
--  Por eso cada hito es la fecha del negocio:
--    · cotizaciones.fecha         → el día que se ofertó
--    · pedidos.fecha_solicitada   → el día que el cliente comprometió
--    · embarques.fecha_programada → el día previsto de salida
--    · despachos.fecha_salida     → el día que salió de verdad
--    · facturas.fecha_emision     → el día que se emitió
--    · cobranzas.fecha            → el día que se cobró
--
--  QUÉ NO SE PUEDE MEDIR TODAVÍA
--  El paso «pedido → reserva de stock» se queda fuera: la reserva solo tiene
--  `creado_en`, sin fecha de negocio. Se prefiere no mostrar un dato antes que
--  mostrar uno que no significa lo que parece.
--
--  UN PEDIDO PARTIDO EN VARIOS EMBARQUES
--  Se toma el PRIMERO de cada hito. Lo que se está midiendo es cuánto tarda la
--  cadena en arrancar y en llegar al muelle, no cuánto tarda el último saco.
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
    /*
     * La salida es timestamptz. Se lleva a la fecha de Lima y no a la del
     * servidor: un despacho de las ocho de la noche caía, en UTC, en el día
     * siguiente, y eso corría un día todos los plazos.
     */
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
  /*
   * Las toneladas y el importe se calculan aparte y se unen por LATERAL. Si se
   * sumaran en el mismo SELECT, cada línea del pedido se multiplicaría por
   * cada embarque, cada packing y cada factura: el clásico producto cartesiano
   * que infla los totales sin que se note.
   */
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

  /* ---- Cada tramo, en días ---- */

  -- Cuánto tardó el cliente en aceptar la oferta.
  (f_pedido - f_cotizacion)                     as dias_negociacion,

  -- Del compromiso a la fecha prevista de salida: el plazo de entrega real
  -- que la empresa se da a sí misma.
  (f_programada - f_pedido)                     as dias_a_programar,

  -- Puntualidad: positivo es retraso sobre lo programado, negativo es que
  -- salió antes. Es el único tramo donde el signo importa.
  (f_despacho - f_programada)                   as dias_puntualidad,

  -- Lo que preguntó Oliver: de la oferta al muelle. Si el pedido fue directo
  -- —sin cotización— se cuenta desde el pedido, que es cuando empezó.
  (f_despacho - coalesce(f_cotizacion, f_pedido)) as dias_total,

  (f_factura - f_despacho)                      as dias_a_facturar,
  (f_cobro - f_factura)                         as dias_a_cobrar,

  -- Contra lo prometido al cliente. Es la promesa, no la programación
  -- interna: son dos cosas distintas y conviene poder compararlas.
  (f_despacho - fecha_comprometida)             as dias_vs_compromiso,

  /*
   * ¿LOS HITOS ESTÁN EN ORDEN?
   *
   * Un pedido no puede despacharse antes de existir. Cuando eso aparece, no es
   * una entrega rapidísima: es un dato mal grabado, y meterlo en un promedio
   * lo envenena —basta un −178 para que la media deje de significar nada—.
   *
   * Se marca aquí en lugar de descartarlo en silencio: la pantalla los aparta
   * del cálculo Y los enseña, porque un dato imposible es algo que alguien
   * tiene que ir a corregir.
   */
  (
    coalesce(f_cotizacion <= f_pedido, true)
    and coalesce(f_pedido <= f_programada, true)
    and coalesce(f_programada <= f_despacho, true)
    and coalesce(f_despacho <= f_factura, true)
    and coalesce(f_factura <= f_cobro, true)
  )                                             as cronologia_valida
from hitos h;

comment on view v_tiempos_flujo is
  'Cuánto tarda cada paso de la cadena, por pedido. Se mide con fechas de negocio, no con la hora en que se tecleó el documento. `dias_puntualidad` y `dias_vs_compromiso` pueden ser negativos: significa que se salió antes de lo previsto.';
