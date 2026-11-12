-- ============================================================================
--  089 · ELIMINAR UN DESPACHO (reunión con Oliver y Dany, 12/11)
-- ============================================================================
--  Correr DESPUÉS de la 088a (agrega el tipo 'anulacion_despacho') y la 088.
--
--  Lo que pidió Oliver: «un apartado en el que yo pueda eliminar el despacho,
--  solamente las personas autorizadas… y si yo lo elimino que se retorne
--  todo». Para qué: los despachos de prueba, y los que se hagan por error.
--  Se acordó: con validación, con comentario y con un historial de despachos
--  eliminados.
--
--  QUÉ HACE eliminar_despacho(), TODO O NADA:
--   1. El Kardex NO se borra (es inmutable, 002): cada salida del despacho
--      —la venta, la muestra, la merma— vuelve a cámara con un movimiento
--      propio, «Vuelve por despacho eliminado» (ANUL-DESP-…). El stock sube
--      solo, por el mismo disparador de siempre.
--   2. Las reservas que el despacho consumió vuelven a «activa»: el pedido
--      vuelve a tener su mercadería apartada y deja de contarla como
--      despachada.
--   3. El packing vuelve a «en carga» con lo que se había cargado, y el
--      embarque a «en preparación»: se puede corregir y volver a despachar,
--      o quitar los pallets.
--   4. Queda una fila en despachos_eliminados con quién, cuándo, por qué y
--      qué tenía, y un evento en el historial del packing y del embarque.
--
--  Quién: solo Gerencia («únicamente lo autorizado»).
--  No se elimina un despacho con comprobante vigente: primero se anula el
--  comprobante en Finanzas.
--
--  Re-ejecutable: «if not exists» y «create or replace».
-- ============================================================================


-- ============================================================================
--  1. EL HISTORIAL DE DESPACHOS ELIMINADOS
-- ============================================================================
create table if not exists despachos_eliminados (
  id                  bigserial primary key,
  despacho_id         bigint not null,
  numero              text not null,
  packing_list_id     bigint references packing_lists(id) on delete set null,
  packing             text,
  embarque_id         bigint references embarques(id) on delete set null,
  embarque            text,
  almacen             text,
  fecha_salida        timestamptz,
  pallets             int not null default 0,
  bultos              int not null default 0,
  kg                  numeric(14,3) not null default 0,
  proformas           text,
  detalle             jsonb not null default '[]'::jsonb,
  motivo              text not null,
  eliminado_por       uuid references usuarios(id),
  eliminado_por_nombre text,
  eliminado_en        timestamptz not null default now()
);
comment on table despachos_eliminados is
  'Despachos que Gerencia eliminó (089): quién, cuándo, por qué y qué salía. El Kardex conserva la salida y su devolución.';
create index if not exists idx_despachos_eliminados_fecha on despachos_eliminados (eliminado_en desc);

alter table despachos_eliminados enable row level security;
drop policy if exists "despachos_eliminados_lectura" on despachos_eliminados;
create policy "despachos_eliminados_lectura" on despachos_eliminados for select to authenticated using (true);
--  Sin política de escritura: solo la llena eliminar_despacho() (security definer).


-- ============================================================================
--  2. LA ELIMINACIÓN
-- ============================================================================
create or replace function eliminar_despacho(p_despacho_id bigint, p_motivo text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  d         despachos%rowtype;
  pk        packing_lists%rowtype;
  emb       embarques%rowtype;
  m         record;
  ln        record;
  r         record;
  v_motivo  text := btrim(coalesce(p_motivo, ''));
  v_nombre  text;
  v_doc     text;
  v_fact    text;
  v_queda   numeric;
  v_kg      numeric := 0;
  v_bultos  int := 0;
  v_pallets int := 0;
  v_detalle jsonb := '[]'::jsonb;
  v_proformas text;
  v_archivos int;
begin
  /* ---- Quién y por qué ---- */
  if auth.uid() is null or not puede('gerencia') then
    raise exception 'Eliminar un despacho lo hace solo Gerencia.'
      using errcode = 'insufficient_privilege';
  end if;
  if length(v_motivo) < 5 then
    raise exception 'Explique por qué se elimina el despacho (al menos 5 caracteres): queda en el historial de despachos eliminados.';
  end if;

  select * into d from despachos where id = p_despacho_id for update;
  if not found then raise exception 'Ese despacho ya no existe.'; end if;

  select string_agg(numero, ', ') into v_fact
    from facturas where despacho_id = d.id and estado <> 'anulada';
  if v_fact is not null then
    raise exception 'El despacho % tiene el comprobante % vigente. Anúlelo primero en Finanzas y después elimine el despacho.',
      d.numero, v_fact;
  end if;

  select * into pk  from packing_lists where id = d.packing_list_id for update;
  select * into emb from embarques where id = pk.embarque_id for update;
  select nombre into v_nombre from usuarios where id = auth.uid();
  v_doc := 'ANUL-' || d.numero;

  /* ---- Lo que salía, para el historial ---- */
  select string_agg(distinct coalesce(p.numero_proforma, '(sin número)'), ', ') into v_proformas
    from packing_lineas pl
    join pedido_lineas pli on pli.id = pl.pedido_linea_id
    join pedidos p on p.id = pli.pedido_id
   where pl.packing_list_id = pk.id;

  /* ---- 1 · El Kardex: cada salida vuelve a cámara ---- */
  for m in
    select * from movimientos
     where documento_tipo = 'despacho' and documento_id = d.id
       and signo_movimiento(tipo) = -1
     order by id
  loop
    insert into movimientos (tipo, lote_id, almacen_id, camara_id, bultos, peso_neto_kg, costo_unitario,
                             documento_tipo, documento_id, documento_ref, usuario_id, observaciones)
    values ('anulacion_despacho', m.lote_id, m.almacen_id, m.camara_id, m.bultos, m.peso_neto_kg, m.costo_unitario,
            'anulacion_despacho', d.id, v_doc, auth.uid(),
            format('Vuelve a cámara: %s eliminó el despacho %s (%s). Motivo: %s',
                   coalesce(v_nombre, 'Gerencia'), d.numero, lower(etiqueta_estado(m.tipo::text)), v_motivo));
  end loop;

  /* ---- 2 · Las reservas consumidas vuelven a estar apartadas ----
     Las mismas que consumió ejecutar_despacho, en el mismo orden: primero la
     de la línea del pedido del pallet, luego las de los pedidos del embarque;
     las más recientes primero. Lo que salió como muestra o merma no se vuelve
     a apartar: regresa como stock libre. */
  for ln in
    select pl.*, l.codigo_pallet
      from packing_lineas pl join lotes l on l.id = pl.lote_id
     where pl.packing_list_id = pk.id
     order by pl.id
  loop
    v_pallets := v_pallets + 1;
    v_bultos  := v_bultos + ln.bultos;
    v_kg      := v_kg + ln.peso_neto_kg;
    v_detalle := v_detalle || jsonb_build_object(
      'lote_id', ln.lote_id, 'pallet', ln.codigo_pallet, 'bultos', ln.bultos, 'kg', ln.peso_neto_kg,
      'bultos_cargados', ln.bultos_cargados, 'kg_cargados', ln.kg_cargados, 'motivo', ln.motivo_diferencia);

    v_queda := ln.peso_neto_kg;
    for r in
      select rv.*
        from reservas rv
        join pedido_lineas pli on pli.id = rv.pedido_linea_id
       where rv.lote_id = ln.lote_id
         and rv.almacen_id = d.almacen_id
         and rv.estado = 'consumida'
         and (rv.pedido_linea_id = ln.pedido_linea_id
              or pli.pedido_id in (select pedido_id from embarque_pedidos where embarque_id = pk.embarque_id))
       order by (rv.pedido_linea_id = ln.pedido_linea_id) desc nulls last, rv.id desc
       for update of rv
    loop
      exit when v_queda <= 0.0005;
      update reservas
         set estado = 'activa',
             vence_el = case when vence_el is not null and vence_el < now() + interval '3 days'
                             then now() + interval '7 days' else vence_el end,
             observaciones = concat_ws(' · ', observaciones, format('Vuelve a apartarse: se eliminó el despacho %s', d.numero))
       where id = r.id;
      v_queda := v_queda - r.peso_neto_kg;
    end loop;

    /* Lo que no salió deja de restar en el embarque (075). */
    if ln.motivo_diferencia is not null and ln.pedido_linea_id is not null then
      update embarque_lineas el
         set kg_no_despachado = greatest(0, el.kg_no_despachado - (ln.kg_cargados - ln.peso_neto_kg))
       where el.id = (select id from embarque_lineas
                       where embarque_id = pk.embarque_id and pedido_linea_id = ln.pedido_linea_id
                       order by kg_no_despachado desc, id limit 1);
    end if;
  end loop;

  /* ---- 3 · El packing y el embarque vuelven a antes de despachar ----
     Primero el packing deja de estar cerrado: un packing cerrado no deja
     tocar sus líneas (075). */
  update packing_lists set estado = 'en_carga' where id = pk.id;
  update packing_lineas
     set bultos = bultos_cargados, peso_neto_kg = kg_cargados,
         bultos_cargados = null, kg_cargados = null,
         motivo_diferencia = null, detalle_diferencia = null
   where packing_list_id = pk.id and bultos_cargados is not null;
  update embarques set estado = 'en_preparacion' where id = emb.id and estado = 'despachado';

  /* ---- 4 · El historial ---- */
  select count(*) into v_archivos from despacho_archivos where despacho_id = d.id;
  insert into despachos_eliminados (despacho_id, numero, packing_list_id, packing, embarque_id, embarque, almacen,
                                    fecha_salida, pallets, bultos, kg, proformas, detalle, motivo,
                                    eliminado_por, eliminado_por_nombre)
  values (d.id, d.numero, pk.id, pk.codigo, emb.id, emb.numero,
          (select nombre from almacenes where id = d.almacen_id),
          d.fecha_salida, v_pallets, v_bultos, v_kg, v_proformas,
          v_detalle || case when v_archivos > 0
                            then jsonb_build_array(jsonb_build_object('archivos_adjuntos', v_archivos))
                            else '[]'::jsonb end,
          v_motivo, auth.uid(), v_nombre);

  perform registrar_evento('packing_lists', pk.id, 'despacho_eliminado',
    format('%s eliminó el despacho %s: el packing vuelve a «en carga» y lo que salió (%s kg) volvió a cámara. Motivo: %s',
           coalesce(v_nombre, 'Gerencia'), d.numero, texto_kg(v_kg), v_motivo),
    'advertencia', jsonb_build_object('despacho', d.numero, 'motivo', v_motivo));
  if emb.id is not null then
    perform registrar_evento('embarques', emb.id, 'despacho_eliminado',
      format('%s eliminó el despacho %s (packing %s). Motivo: %s', coalesce(v_nombre, 'Gerencia'), d.numero, pk.codigo, v_motivo),
      'advertencia', jsonb_build_object('despacho', d.numero, 'motivo', v_motivo));
  end if;

  /* ---- 5 · Fuera el despacho ---- */
  delete from alertas where entidad = 'despachos' and entidad_id = d.id;
  delete from despacho_archivos where despacho_id = d.id;
  update facturas set despacho_id = null where despacho_id = d.id;   -- solo anuladas, por la regla de arriba
  delete from despachos where id = d.id;

  return format('Despacho %s eliminado. Volvieron a cámara %s · %s kg (%s), las reservas volvieron a apartarse y el packing %s quedó en carga para corregirlo o volver a despacharlo.',
                d.numero, texto_bultos(v_bultos), texto_kg(v_kg), v_doc, pk.codigo);
end;
$$;
comment on function eliminar_despacho(bigint, text) is
  'Elimina un despacho (089): devuelve lo que salió con movimientos inversos, reactiva las reservas, reabre el packing y lo anota en despachos_eliminados. Solo Gerencia.';
revoke execute on function eliminar_despacho(bigint, text) from public, anon;
grant  execute on function eliminar_despacho(bigint, text) to authenticated;
