-- ============================================================================
--  014 · CUADRAR LOS COMPROBANTES CON SUS LÍNEAS
-- ============================================================================
--  LO QUE ESTABA MAL
--  La verificación de documentos, al intentar imprimir la primera factura,
--  se negó: las líneas sumaban 183 123,09 y la cabecera decía que el subtotal
--  era 155 189,06.
--
--  El motivo era que los datos de demostración se generaron tratando el precio
--  de la línea como si YA incluyera el IGV: escribían el importe completo en
--  la línea y luego deducían el subtotal dividiendo entre 1,18. Así, la suma
--  de las líneas daba el TOTAL y no el subtotal, y ningún comprobante cuadraba.
--
--  Además, todas las facturas llevaban IGV del 18 %, incluidas las emitidas a
--  clientes de China, Estados Unidos o los Emiratos. La exportación de bienes
--  no grava IGV en Perú: esas facturas cobraban un impuesto que no existe.
--
--  LO QUE MANDA
--  La línea. El precio por tonelada es lo que se negoció con el cliente y es
--  neto; la cabecera se deduce de las líneas y no al revés. Cualquier otra
--  cosa haría que la factura impresa dijera algo distinto del pedido.
-- ============================================================================

-- ----------------------------------------------------------------------------
--  1. Subtotal, IGV y total, recalculados desde las líneas
-- ----------------------------------------------------------------------------
with calculado as (
  select
    f.id,
    round(sum(fl.importe), 2) as subtotal,
    -- Solo grava lo que se queda en el país. La exportación es inafecta.
    case
      when cl.pais = 'Perú' then round(sum(fl.importe) * 0.18, 2)
      else 0
    end as igv
  from facturas f
  join factura_lineas fl on fl.factura_id = f.id
  join clientes cl on cl.id = f.cliente_id
  group by f.id, cl.pais
)
update facturas f
   set subtotal = c.subtotal,
       igv      = c.igv,
       total    = c.subtotal + c.igv
  from calculado c
 where c.id = f.id;

-- ----------------------------------------------------------------------------
--  2. Cobranzas que se pasaban del nuevo total
--
--  Tres facturas quedaron con más cobrado que facturado, porque su total bajó
--  al quitarle el IGV de exportación. No se borra el cobro —eso perdería la
--  trazabilidad del pago— sino que se ajusta el último a lo que quedaba
--  pendiente, que es lo que habría ocurrido en la realidad.
-- ----------------------------------------------------------------------------
with pagado as (
  select cb.factura_id, sum(cb.monto) as total_pagado, max(cb.id) as ultimo
  from cobranzas cb
  group by cb.factura_id
),
exceso as (
  select p.ultimo, p.total_pagado - f.total as sobra
  from pagado p
  join facturas f on f.id = p.factura_id
  where p.total_pagado > f.total + 0.01
)
update cobranzas c
   set monto = greatest(0, c.monto - e.sobra),
       observaciones = coalesce(c.observaciones || ' · ', '') ||
                       'Ajustado al recalcular el comprobante sin IGV de exportación'
  from exceso e
 where c.id = e.ultimo;

-- ----------------------------------------------------------------------------
--  3. El estado de cobro, coherente con los nuevos importes
-- ----------------------------------------------------------------------------
with saldo as (
  select f.id,
         f.total - coalesce((select sum(monto) from cobranzas where factura_id = f.id), 0) as pendiente
  from facturas f
  where f.estado <> 'anulada'
)
update facturas f
   set estado = case
                  when s.pendiente <= 0.01 then 'cobrada'::estado_factura
                  when s.pendiente < f.total then 'parcialmente_cobrada'::estado_factura
                  when f.fecha_vencimiento < current_date then 'vencida'::estado_factura
                  else 'emitida'::estado_factura
                end
  from saldo s
 where s.id = f.id;
