-- ============================================================================
--  SANTA MÓNICA ERP · MIGRACIÓN 005 · CONSULTAS DE TRAZABILIDAD
-- ============================================================================
--  Explicado en simple: estas funciones responden dos preguntas que hoy
--  tomarían un día entero de trabajo sobre el Excel.
--
--   1. "¿De dónde salió este producto?"
--      Le doy una factura y me devuelve el pedido, el embarque, el contenedor,
--      los lotes exactos y el día en que se produjeron.
--
--   2. "¿A dónde fue este lote?"
--      Le doy un lote y me devuelve todos los clientes, contenedores y destinos
--      que lo recibieron. Esta es la consulta que salva la empresa el día que
--      SANIPES inmoviliza un producto.
-- ============================================================================


-- ============================================================================
--  1. TRAZABILIDAD HACIA ADELANTE · "¿a dónde fue este lote?"
-- ============================================================================
create or replace function trazar_lote_adelante(p_lote_id bigint)
returns table (
  etapa            text,
  documento        text,
  fecha            timestamptz,
  almacen          text,
  cliente          text,
  destino          text,
  contenedor       text,
  bultos           int,
  peso_kg          numeric,
  referencia_tipo  text,
  referencia_id    bigint
)
language sql stable security definer set search_path = public as $$
  -- Movimientos del Kardex: toda entrada y salida del lote
  select
    'Movimiento'::text,
    coalesce(m.documento_ref, m.tipo::text),
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

  -- Reservas: a qué pedido y cliente quedó apartado
  select
    'Reserva ' || r.estado::text,
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
$$;
comment on function trazar_lote_adelante is 'Todo lo que le pasó a un lote: movimientos, traslados, reservas y despachos.';


-- ============================================================================
--  2. TRAZABILIDAD HACIA ATRÁS · "¿de dónde salió esto?"
--  Se entra por una factura, un pedido, un despacho o un packing list y se
--  devuelven los lotes de origen con su fecha de producción.
-- ============================================================================
create or replace function trazar_origen(p_tipo text, p_id bigint)
returns table (
  lote_id           bigint,
  codigo_pallet     text,
  codigo_lote       text,
  sku_codigo        text,
  producto          text,
  fecha_produccion  date,
  campania          int,
  juliano           text,
  linea_procesadora text,
  turno             text,
  proceso           text,
  planta            text,
  bultos            int,
  peso_kg           numeric,
  calidad           text,
  packing           text,
  contenedor        text,
  cliente           text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_packing_ids bigint[];
begin
  -- Según por dónde entremos, ubicamos los packing lists involucrados
  if p_tipo = 'packing_list' then
    v_packing_ids := array[p_id];

  elsif p_tipo = 'despacho' then
    select array_agg(packing_list_id) into v_packing_ids from despachos where id = p_id;

  elsif p_tipo = 'embarque' then
    select array_agg(id) into v_packing_ids from packing_lists where embarque_id = p_id;

  elsif p_tipo = 'factura' then
    select array_agg(pk.id) into v_packing_ids
      from facturas f
      join embarque_pedidos ep on ep.pedido_id = f.pedido_id
      join packing_lists pk on pk.embarque_id = ep.embarque_id
     where f.id = p_id;

  elsif p_tipo = 'pedido' then
    select array_agg(pk.id) into v_packing_ids
      from embarque_pedidos ep
      join packing_lists pk on pk.embarque_id = ep.embarque_id
     where ep.pedido_id = p_id;

  else
    raise exception 'Tipo de origen no soportado: %. Use factura, pedido, embarque, despacho o packing_list.', p_tipo;
  end if;

  return query
  select
    l.id,
    l.codigo_pallet,
    l.codigo_lote,
    s.codigo,
    (esp.nombre || ' · ' || f.nombre || ' · ' || s.corte || ' · ' || pr.descripcion)::text,
    l.fecha_produccion,
    l.campania,
    l.juliano,
    lp.nombre,
    l.turno::text,
    l.proceso::text,
    pl.nombre,
    pkl.bultos,
    pkl.peso_neto_kg,
    -- Estado sanitario actual del lote
    (case when lote_bloqueado(l.id) then 'OBSERVADO' else 'LIBERADO' end)::text,
    pk.codigo,
    pk.contenedor,
    cli.razon_social
  from packing_lineas pkl
  join packing_lists pk  on pk.id = pkl.packing_list_id
  join lotes l           on l.id = pkl.lote_id
  join sku_presentaciones sp on sp.id = l.sku_presentacion_id
  join skus s            on s.id = sp.sku_id
  join especies esp      on esp.id = s.especie_id
  join formatos f        on f.id = s.formato_id
  join presentaciones pr on pr.id = sp.presentacion_id
  left join lineas_procesadoras lp on lp.id = l.linea_procesadora_id
  left join plantas pl   on pl.id = l.planta_id
  left join embarques emb on emb.id = pk.embarque_id
  left join embarque_pedidos ep on ep.embarque_id = emb.id
  left join pedidos ped  on ped.id = ep.pedido_id
  left join clientes cli on cli.id = ped.cliente_id
  where pkl.packing_list_id = any(v_packing_ids)
  order by l.fecha_produccion, l.codigo_pallet;
end;
$$;
comment on function trazar_origen is 'Desde una factura, pedido, embarque o despacho llega a los lotes y su día de producción.';


-- ============================================================================
--  3. RETIRO SANITARIO (RECALL)
--  "SANIPES inmovilizó este lote: ¿a quién se lo vendimos y cuánto queda?"
-- ============================================================================
create or replace function recall_lote(p_lote_id bigint)
returns table (
  categoria     text,
  cliente       text,
  destino       text,
  contenedor    text,
  packing       text,
  guia          text,
  fecha         timestamptz,
  bultos        int,
  peso_kg       numeric,
  almacen       text
)
language sql stable security definer set search_path = public as $$
  -- (A) Lo que YA SALIÓ hacia clientes
  select
    'DESPACHADO'::text,
    coalesce(c.razon_social, 'Sin cliente asignado'),
    coalesce(dest.puerto || ', ' || dest.pais, 'Sin destino'),
    pk.contenedor,
    pk.codigo,
    pk.guia_remision,
    coalesce(d.fecha_salida, pk.creado_en),
    pkl.bultos,
    pkl.peso_neto_kg,
    a.nombre
  from packing_lineas pkl
  join packing_lists pk  on pk.id = pkl.packing_list_id
  join embarques emb     on emb.id = pk.embarque_id
  join almacenes a       on a.id = emb.almacen_id
  left join despachos d  on d.packing_list_id = pk.id
  left join destinos dest on dest.id = emb.destino_id
  left join embarque_pedidos ep on ep.embarque_id = emb.id
  left join pedidos pe   on pe.id = ep.pedido_id
  left join clientes c   on c.id = pe.cliente_id
  where pkl.lote_id = p_lote_id

  union all

  -- (B) Lo que sigue EN BODEGA y hay que inmovilizar ahora mismo
  select
    'EN BODEGA — INMOVILIZAR'::text,
    null, null, null, null, null,
    e.actualizado_en,
    e.bultos,
    e.peso_neto_kg,
    a.nombre
  from existencias e
  join almacenes a on a.id = e.almacen_id
  where e.lote_id = p_lote_id and e.bultos > 0

  union all

  -- (C) Lo que está APARTADO para pedidos que aún no salieron
  select
    'RESERVADO — BLOQUEAR'::text,
    c.razon_social,
    null, null,
    pe.numero_proforma,
    null,
    r.creado_en,
    r.bultos,
    r.peso_neto_kg,
    a.nombre
  from reservas r
  join almacenes a      on a.id = r.almacen_id
  join pedido_lineas pl on pl.id = r.pedido_linea_id
  join pedidos pe       on pe.id = pl.pedido_id
  join clientes c       on c.id = pe.cliente_id
  where r.lote_id = p_lote_id and r.estado in ('activa','en_preparacion')

  order by 1, 7;
$$;
comment on function recall_lote is 'Alcance completo de un retiro sanitario: qué salió, a quién, y qué queda por inmovilizar.';


-- ============================================================================
--  4. BUSCADOR UNIVERSAL
--  Una sola caja acepta cualquier identificador del negocio.
-- ============================================================================
create or replace function buscar_universal(p_texto text)
returns table (
  tipo        text,
  id          bigint,
  titulo      text,
  subtitulo   text,
  fecha       timestamptz,
  ruta        text
)
language sql stable security definer set search_path = public as $$
  with q as (select '%' || upper(trim(p_texto)) || '%' as patron)

  -- Lotes por codigo de pallet o de lote
  select 'Lote'::text, l.id,
         l.codigo_pallet,
         (s.codigo || ' - ' || esp.nombre || ' ' || f.nombre || ' ' || s.corte)::text,
         l.creado_en,
         ('/almacenes/lotes/' || l.id)::text
    from lotes l
    join sku_presentaciones sp on sp.id = l.sku_presentacion_id
    join skus s        on s.id = sp.sku_id
    join especies esp  on esp.id = s.especie_id
    join formatos f    on f.id = s.formato_id
    cross join q
   where upper(l.codigo_pallet) like q.patron
      or upper(coalesce(l.codigo_lote,'')) like q.patron

  union all
  -- Pedidos por numero de proforma u orden de compra del cliente
  select 'Pedido'::text, pe.id, pe.numero_proforma, c.razon_social, pe.creado_en,
         ('/ventas/pedidos/' || pe.id)::text
    from pedidos pe
    join clientes c on c.id = pe.cliente_id
    cross join q
   where upper(pe.numero_proforma) like q.patron
      or upper(coalesce(pe.oc_cliente,'')) like q.patron

  union all
  -- Packing lists por codigo, contenedor, guia o DAM
  select 'Packing List'::text, pk.id,
         pk.codigo,
         (coalesce(pk.contenedor,'sin contenedor') || coalesce(' - ' || pk.guia_remision, ''))::text,
         pk.creado_en,
         ('/logistica/packing/' || pk.id)::text
    from packing_lists pk
    cross join q
   where upper(pk.codigo) like q.patron
      or upper(coalesce(pk.contenedor,'')) like q.patron
      or upper(coalesce(pk.guia_remision,'')) like q.patron
      or upper(coalesce(pk.dam,'')) like q.patron

  union all
  -- Embarques por numero o booking
  select 'Embarque'::text, e.id, e.numero,
         (coalesce(e.booking,'sin booking') || ' - ' || coalesce(d.puerto,'sin destino'))::text,
         e.creado_en, ('/logistica/embarques/' || e.id)::text
    from embarques e
    left join destinos d on d.id = e.destino_id
    cross join q
   where upper(e.numero) like q.patron
      or upper(coalesce(e.booking,'')) like q.patron

  union all
  -- Clientes por razon social, nombre corto o codigo
  select 'Cliente'::text, c.id, c.razon_social,
         (coalesce(c.pais,'') || coalesce(' - ' || c.codigo, ''))::text,
         c.creado_en, ('/ventas/clientes/' || c.id)::text
    from clientes c
    cross join q
   where upper(c.razon_social) like q.patron
      or upper(coalesce(c.nombre_corto,'')) like q.patron
      or upper(c.codigo) like q.patron

  union all
  -- Facturas por numero
  select 'Factura'::text, fa.id, fa.numero, c.razon_social, fa.creado_en,
         ('/finanzas/facturas/' || fa.id)::text
    from facturas fa
    join clientes c on c.id = fa.cliente_id
    cross join q
   where upper(fa.numero) like q.patron

  union all
  -- Traslados por numero o guia
  select 'Traslado'::text, tr.id, tr.numero,
         (ao.nombre || ' -> ' || ad.nombre)::text,
         tr.creado_en, ('/almacenes/traslados/' || tr.id)::text
    from traslados tr
    join almacenes ao on ao.id = tr.almacen_origen_id
    join almacenes ad on ad.id = tr.almacen_destino_id
    cross join q
   where upper(tr.numero) like q.patron
      or upper(coalesce(tr.guia_numero,'')) like q.patron

  union all
  -- Productos por codigo, corte o especie
  select 'Producto'::text, s.id, s.codigo,
         (esp.nombre || ' - ' || f.nombre || ' - ' || s.corte)::text,
         s.creado_en, ('/almacenes/productos/' || s.id)::text
    from skus s
    join especies esp on esp.id = s.especie_id
    join formatos f   on f.id = s.formato_id
    cross join q
   where upper(s.codigo) like q.patron
      or upper(s.corte) like q.patron
      or upper(esp.nombre) like q.patron

  limit 60;
$$;
comment on function buscar_universal is 'Busca en todo el sistema por cualquier identificador: pallet, proforma, contenedor, guía, factura o cliente.';


-- ============================================================================
--  5. HISTORIAL DE UNA ENTIDAD
--  Alimenta la pestaña "Historial" que llevan todas las fichas del sistema.
-- ============================================================================
create or replace function historial_entidad(p_entidad text, p_entidad_id bigint)
returns table (
  origen       text,
  tipo         text,
  descripcion  text,
  severidad    text,
  usuario      text,
  ocurrido_en  timestamptz,
  detalle      jsonb
)
language sql stable security definer set search_path = public as $$
  -- Eventos de negocio (lenguaje humano)
  select 'evento'::text, ev.tipo, ev.descripcion, ev.severidad::text,
         coalesce(u.nombre, 'Sistema'), ev.ocurrido_en, ev.metadatos
    from eventos ev
    left join usuarios u on u.id = ev.usuario_id
   where ev.entidad = p_entidad and ev.entidad_id = p_entidad_id

  union all

  -- Cambios técnicos (qué campo cambió y de qué a qué)
  select 'auditoria'::text, au.accion,
         case
           when au.accion = 'INSERT' then 'Registro creado'
           when au.accion = 'DELETE' then 'Registro eliminado'
           else 'Modificado: ' || array_to_string(au.campos_cambiados, ', ')
         end,
         'info'::text,
         coalesce(u.nombre, 'Sistema'), au.ocurrido_en,
         jsonb_build_object('antes', au.datos_antes, 'despues', au.datos_despues)
    from auditoria au
    left join usuarios u on u.id = au.usuario_id
   where au.tabla = p_entidad and au.registro_id = p_entidad_id::text

  order by 6 desc
  limit 200;
$$;
comment on function historial_entidad is 'Línea de tiempo de cualquier ficha: eventos de negocio + cambios auditados.';


-- ============================================================================
--  6. VISTA DE ANTICUAMIENTO
--  Los cuatro rangos que usa hoy el Excel, pero con el umbral configurable.
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
  v.meses_almacenado >= coalesce(s.vida_util_meses, param_num('vida_util_meses', 24)) as vencido
from v_stock_lote v
join lotes l       on l.id = v.lote_id
join almacenes a   on a.id = v.almacen_id
join sku_presentaciones sp on sp.id = l.sku_presentacion_id
join skus s        on s.id = sp.sku_id
join especies esp  on esp.id = s.especie_id
join formatos f    on f.id = s.formato_id;

comment on view v_anticuamiento is 'Antigüedad del stock por lote, con los rangos y umbrales configurables.';


-- ============================================================================
--  7. KARDEX VALORIZADO
-- ============================================================================
create or replace view v_kardex as
select
  m.id,
  m.fecha,
  m.tipo,
  signo_movimiento(m.tipo)                            as signo,
  m.lote_id,
  l.codigo_pallet,
  l.fecha_produccion,
  m.almacen_id,
  a.nombre                                            as almacen,
  sp.id                                               as sku_presentacion_id,
  s.codigo                                            as sku_codigo,
  esp.nombre                                          as especie,
  fo.nombre                                           as formato,
  s.corte,
  pr.descripcion                                      as presentacion,
  case when signo_movimiento(m.tipo) = 1 then m.bultos else 0 end       as entrada_bultos,
  case when signo_movimiento(m.tipo) = 1 then m.peso_neto_kg else 0 end as entrada_kg,
  case when signo_movimiento(m.tipo) = -1 then m.bultos else 0 end      as salida_bultos,
  case when signo_movimiento(m.tipo) = -1 then m.peso_neto_kg else 0 end as salida_kg,
  m.costo_unitario,
  m.peso_neto_kg * m.costo_unitario                   as valor,
  m.documento_tipo,
  m.documento_id,
  m.documento_ref,
  mo.nombre                                           as motivo,
  u.nombre                                            as usuario,
  ua.nombre                                           as autorizado_por
from movimientos m
join lotes l           on l.id = m.lote_id
join almacenes a       on a.id = m.almacen_id
join sku_presentaciones sp on sp.id = l.sku_presentacion_id
join skus s            on s.id = sp.sku_id
join especies esp      on esp.id = s.especie_id
join formatos fo       on fo.id = s.formato_id
join presentaciones pr on pr.id = sp.presentacion_id
left join motivos mo   on mo.id = m.motivo_id
left join usuarios u   on u.id = m.usuario_id
left join usuarios ua  on ua.id = m.autorizado_por;

comment on view v_kardex is 'El Kardex legible: entradas, salidas y valor, con producto y responsable resueltos.';
