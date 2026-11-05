-- ============================================================================
--  086 · RECARGA DE LA CARGA INICIAL CON «3-11 OLIVER» (04/11)
-- ============================================================================
--  Re-ejecutable (`create or replace`, misma firma y mismas columnas).
--
--  Oliver mandó su base al 03/11 («3-11 OLIVER.xlsx», mismo formato que DATA
--  2025) y pidió cargarla como inicial: solo lo ALMACENADO. La recarga la hizo
--  el mismo guion de la 080 (fuera del repositorio: lleva los datos reales),
--  con las mismas reglas y con la marca de carga inicial para vaciar el
--  Kardex. NO necesitó tocar ninguna protección: esta migración no borra ni
--  carga nada.
--
--  Lo único que cambia en la base: en la ficha del lote («Todo lo que le pasó
--  a este lote») y en Trazabilidad, el ingreso del saldo inicial aparecía
--  como «Movimiento» a secas. Ahora dice «Inventario inicial», como ya lo
--  rotulan Ingresos y Movimientos del día. La definición es la vigente (077)
--  con ese único cambio.
-- ============================================================================

create or replace function trazar_lote_adelante(p_lote_id bigint)
 RETURNS TABLE(etapa text, documento text, fecha timestamp with time zone, almacen text, cliente text, destino text, contenedor text, bultos integer, peso_kg numeric, referencia_tipo text, referencia_id bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Movimientos del Kardex: toda entrada y salida del lote
  select
    --  086: el saldo con que arrancó el sistema se rotula como tal, no como
    --  un movimiento cualquiera (lo mismo que Ingresos y Movimientos del día).
    case when m.documento_tipo = 'inventario_inicial' then 'Inventario inicial' else 'Movimiento' end::text,
    coalesce(m.documento_ref, etiqueta_estado(m.tipo::text)),
    m.fecha,
    a.nombre,
    null::text, null::text, null::text,
    m.bultos, m.peso_neto_kg,
    'movimiento'::text, m.id
  from movimientos m
  join almacenes a on a.id = m.almacen_id
  where m.lote_id = p_lote_id

  union all

  -- Traslados entre bodegas
  select
    'Traslado'::text,
    t.numero || coalesce(' · guía ' || t.guia_numero, ''),
    coalesce(t.despachado_en, t.creado_en),
    ao.nombre || ' → ' || ad.nombre,
    null::text, null::text, null::text,
    tl.bultos_enviados, tl.peso_enviado_kg,
    'traslado'::text, t.id
  from traslado_lineas tl
  join traslados t  on t.id = tl.traslado_id
  join almacenes ao on ao.id = t.almacen_origen_id
  join almacenes ad on ad.id = t.almacen_destino_id
  where tl.lote_id = p_lote_id

  union all

  -- Reservas: a qué pedido y cliente quedó apartado («Reserva en preparación»)
  select
    'Reserva ' || lower(etiqueta_estado(r.estado::text)),
    pe.numero_proforma,
    r.creado_en,
    a.nombre,
    c.razon_social,
    null::text, null::text,
    r.bultos, r.peso_neto_kg,
    'reserva'::text, r.id
  from reservas r
  join almacenes a      on a.id = r.almacen_id
  join pedido_lineas pl on pl.id = r.pedido_linea_id
  join pedidos pe       on pe.id = pl.pedido_id
  join clientes c       on c.id = pe.cliente_id
  where r.lote_id = p_lote_id

  union all

  -- Despachos: el destino final del producto
  select
    'Despacho'::text,
    pk.codigo || coalesce(' · guía ' || pk.guia_remision, ''),
    d.fecha_salida,
    a.nombre,
    c.razon_social,
    dest.puerto || ', ' || dest.pais,
    pk.contenedor,
    pkl.bultos, pkl.peso_neto_kg,
    'despacho'::text, d.id
  from packing_lineas pkl
  join packing_lists pk on pk.id = pkl.packing_list_id
  join embarques emb    on emb.id = pk.embarque_id
  join almacenes a      on a.id = emb.almacen_id
  left join despachos d on d.packing_list_id = pk.id
  left join destinos dest on dest.id = emb.destino_id
  left join embarque_pedidos ep on ep.embarque_id = emb.id
  left join pedidos pe  on pe.id = ep.pedido_id
  left join clientes c  on c.id = pe.cliente_id
  where pkl.lote_id = p_lote_id

  order by 3 asc;
$function$;

revoke execute on function trazar_lote_adelante(bigint) from public, anon;
grant execute on function trazar_lote_adelante(bigint) to authenticated;
