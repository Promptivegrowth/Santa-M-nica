-- ============================================================================
--  028 · LOS DOS CASOS QUE QUEDARON SUELTOS
-- ============================================================================
--  La migración anterior bajó las incoherencias de 106 a 27. Las que quedan
--  son dos, y las dos tienen una causa concreta:
--
--  1 · VEINTE COTIZACIONES FECHADAS DESPUÉS DE SU PROPIO PEDIDO
--      El sembrado elegía la fecha del pedido y la de la cotización de forma
--      independiente, así que a veces la oferta salía después del pedido que
--      la aceptaba. Se recula la cotización.
--
--  2 · SIETE DESPACHOS UN DÍA ANTES DE SU EMBARQUE
--      Este lo provocó la migración 027, y el motivo merece quedar escrito:
--      al reconstruir la salida se hizo `fecha + hora`, lo que produce un
--      `timestamp` SIN huso. PostgreSQL lo interpreta entonces en el huso de
--      la sesión —UTC— y al leerlo de vuelta en hora de Lima, una salida de
--      madrugada retrocedía al día anterior.
--
--      Es exactamente el mismo error que ya había mordido antes en las fechas
--      de los pedidos y de las facturas: construir un instante sin decir en
--      qué huso está. Aquí se construye diciéndolo.
--
--  TODOS LOS DATOS DE ESTE SISTEMA SON FICTICIOS.
-- ============================================================================
do $$
declare v_cot int; v_desp int; v_fac int; v_malos int;
begin
  /* ---- 1 · La oferta, antes del pedido que la aceptó ---- */
  update cotizaciones c
     -- Entre 5 y 40 días antes: el tiempo que el cliente estuvo decidiendo.
     set fecha = p.fecha_solicitada - (5 + (c.id % 36))::int
    from pedidos p
   where p.cotizacion_id = c.id
     and c.fecha > p.fecha_solicitada;
  get diagnostics v_cot = row_count;

  /* ---- 2 · El despacho, el mismo día del embarque o después ---- */
  update despachos d
     /*
      * El instante se arma DICIENDO en qué huso está. Sin el `at time zone`,
      * el texto se interpreta en UTC y la salida se corre de día.
      */
     set fecha_salida = (
           ((e.fecha_programada + (d.id % 3)::int)::text || ' ' ||
            (d.fecha_salida at time zone 'America/Lima')::time::text)::timestamp
           at time zone 'America/Lima'
         )
    from packing_lists pk
    join embarques e on e.id = pk.embarque_id
   where pk.id = d.packing_list_id
     and (d.fecha_salida at time zone 'America/Lima')::date < e.fecha_programada;
  get diagnostics v_desp = row_count;

  /* ---- 3 · La factura, después de la salida ----
     Se repite el ajuste de la migración anterior porque el paso 2 acaba de
     mover algunos despachos y un par de facturas quedaron por delante. Es
     idempotente: si ya están en orden, no toca nada. */
  update facturas f
     set fecha_emision = s.salida + (f.id % 5)::int,
         fecha_vencimiento = s.salida + (f.id % 5)::int
                             + coalesce((select dias_credito from clientes c where c.id = f.cliente_id), 30)::int
    from (
      select fa.id as factura_id,
             min((d.fecha_salida at time zone 'America/Lima')::date) as salida
        from facturas fa
        join embarque_pedidos ep on ep.pedido_id = fa.pedido_id
        join packing_lists pk    on pk.embarque_id = ep.embarque_id
        join despachos d         on d.packing_list_id = pk.id
       group by fa.id
    ) s
   where s.factura_id = f.id
     and f.fecha_emision < s.salida;
  get diagnostics v_fac = row_count;

  /* Y el cobro detrás de la factura, por la misma razón. */
  update cobranzas cb
     set fecha = f.fecha_emision + (cb.id % 45)::int
    from facturas f
   where f.id = cb.factura_id
     and cb.fecha < f.fecha_emision;

  select count(*) into v_malos from v_tiempos_flujo where not cronologia_valida;
  raise notice 'Cierre — cotizaciones: %, despachos: %, facturas: %. Quedan % incoherentes.',
    v_cot, v_desp, v_fac, v_malos;
end $$;
