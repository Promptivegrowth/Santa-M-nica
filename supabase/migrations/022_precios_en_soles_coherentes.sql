-- ============================================================================
--  022 · LOS DOCUMENTOS EN SOLES, CON IMPORTES DE VERDAD EN SOLES
-- ============================================================================
--  POR QUÉ HACE FALTA ESTO
--  Al definir bien el tipo de cambio (migración 021) salió a la luz un
--  problema de los datos de demostración: el sembrado generó los precios con
--  el mismo rango numérico para las dos monedas —entre 1 800 y 4 200— sin
--  mirar si el documento estaba en soles o en dólares.
--
--  Mientras nadie convertía, eso no se notaba. En cuanto la conversión es
--  correcta, un pedido en soles de S/ 3 036 por tonelada pasa a valer US$ 810,
--  y como el costo sí estaba en dólares —US$ 2 118— el margen de la mitad de
--  la cartera se vuelve negativo. No es un error del cálculo: es que esos
--  «soles» nunca fueron soles.
--
--  QUÉ HACE
--  Multiplica por el tipo de cambio los importes de los documentos en soles,
--  que es exactamente lo que les faltaba para serlo. Después, convertirlos de
--  vuelta a dólares devuelve la cifra original y los márgenes vuelven a tener
--  sentido.
--
--  QUÉ NO TOCA
--  · Los documentos en dólares. Ya estaban bien.
--  · `costo_estimado_tm` y `costo_promedio`. El costo se carga en dólares al
--    registrar el ingreso a cámara, así que no depende de la moneda de venta.
--
--  TODOS LOS DATOS DE ESTE SISTEMA SON FICTICIOS. Esta corrección es sobre
--  datos de demostración; no hay información real que se pueda alterar.
-- ============================================================================

do $$
declare
  v_cot int; v_ped int; v_fac int; v_flin int; v_cob int;
begin
  -- --- Cotizaciones en soles ---
  update cotizacion_lineas cl
     set precio_tm       = cl.precio_tm * c.tipo_cambio,
         precio_lista_tm = cl.precio_lista_tm * c.tipo_cambio
    from cotizaciones c
   where c.id = cl.cotizacion_id
     and c.moneda = 'PEN';
  get diagnostics v_cot = row_count;

  -- --- Pedidos en soles. El costo estimado NO se toca: ya está en dólares ---
  update pedido_lineas pl
     set precio_tm       = pl.precio_tm * p.tipo_cambio,
         precio_lista_tm = pl.precio_lista_tm * p.tipo_cambio
    from pedidos p
   where p.id = pl.pedido_id
     and p.moneda = 'PEN';
  get diagnostics v_ped = row_count;

  -- --- Líneas de factura en soles ---
  update factura_lineas fl
     set precio_tm = fl.precio_tm * f.tipo_cambio,
         importe   = fl.importe * f.tipo_cambio
    from facturas f
   where f.id = fl.factura_id
     and f.moneda = 'PEN';
  get diagnostics v_flin = row_count;

  -- --- Cabecera de las facturas en soles ---
  update facturas
     set subtotal = subtotal * tipo_cambio,
         igv      = igv      * tipo_cambio,
         total    = total    * tipo_cambio
   where moneda = 'PEN';
  get diagnostics v_fac = row_count;

  -- --- Los cobros aplicados a esas facturas ---
  update cobranzas cb
     set monto = cb.monto * f.tipo_cambio
    from facturas f
   where f.id = cb.factura_id
     and f.moneda = 'PEN';
  get diagnostics v_cob = row_count;

  raise notice 'Importes en soles corregidos — cotización: % líneas, pedido: %, factura: % líneas y % cabeceras, cobranzas: %',
    v_cot, v_ped, v_flin, v_fac, v_cob;
end $$;
