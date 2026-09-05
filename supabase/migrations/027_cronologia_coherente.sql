-- ============================================================================
--  027 · QUE LA CADENA OCURRA EN ORDEN
-- ============================================================================
--  Al construir la pantalla de tiempos salió a la luz que 38 de los 92 pedidos
--  despachados aparecían saliendo ANTES de haberse pedido. El peor, 178 días
--  antes.
--
--  No era un error de cálculo. El sembrado generaba la fecha de cada embarque
--  al azar —entre 25 días en el futuro y 200 en el pasado— y después repartía
--  los pedidos entre los embarques en rueda, sin mirar sus fechas. Mientras
--  nadie restaba fechas, no se notaba.
--
--  Aquí se empuja cada hito para que sea posterior al anterior:
--
--      pedido → embarque → despacho → factura → cobro
--
--  Se EMPUJA hacia adelante en lugar de recular el pedido, porque el pedido es
--  el origen de la cadena y hay documentos comerciales colgando de su fecha.
--
--  TODOS LOS DATOS DE ESTE SISTEMA SON FICTICIOS.
-- ============================================================================
/*
 * Los `::int` no son adorno: los identificadores son bigint, y PostgreSQL no
 * sabe sumar un bigint a una fecha. Sin el casteo, la migración falla entera.
 */
do $$
declare v_emb int; v_desp int; v_fac int; v_cob int; v_malos int;
begin
  /* ---- 1 · El embarque, después del último pedido que carga ---- */
  with necesario as (
    select ep.embarque_id,
           max(p.fecha_solicitada) as ultimo_pedido
      from embarque_pedidos ep
      join pedidos p on p.id = ep.pedido_id
     group by ep.embarque_id
  )
  update embarques e
     -- Entre 5 y 25 días después del último pedido: el plazo de preparación.
     set fecha_programada = n.ultimo_pedido + (5 + (e.id % 21))::int
    from necesario n
   where n.embarque_id = e.id
     and e.fecha_programada < n.ultimo_pedido + 5;
  get diagnostics v_emb = row_count;

  /* ---- 2 · La carga del contenedor, el día de la salida ---- */
  update packing_lists pk
     set fecha_carga = e.fecha_programada
    from embarques e
   where e.id = pk.embarque_id
     and (pk.fecha_carga is null or pk.fecha_carga < e.fecha_programada);

  /* ---- 3 · El despacho, el día programado o hasta tres después ----
     La hora se conserva: es la que alimenta el KPI de productividad de carga. */
  update despachos d
     set fecha_salida = (e.fecha_programada + (d.id % 4)::int)
                        + (d.fecha_salida::time)
    from packing_lists pk
    join embarques e on e.id = pk.embarque_id
   where pk.id = d.packing_list_id
     and (d.fecha_salida at time zone 'America/Lima')::date < e.fecha_programada;
  get diagnostics v_desp = row_count;

  /* ---- 4 · La factura, del día del despacho en adelante ---- */
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

  /* ---- 5 · El cobro, después de la factura ---- */
  update cobranzas cb
     set fecha = f.fecha_emision + (cb.id % 45)::int
    from facturas f
   where f.id = cb.factura_id
     and cb.fecha < f.fecha_emision;
  get diagnostics v_cob = row_count;

  select count(*) into v_malos from v_tiempos_flujo where not cronologia_valida;

  raise notice 'Cronología corregida — embarques: %, despachos: %, facturas: %, cobros: %. Quedan % pedidos incoherentes.',
    v_emb, v_desp, v_fac, v_cob, v_malos;
end $$;
