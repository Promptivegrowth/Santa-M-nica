-- ============================================================================
--  066 · EL DESPACHO CONSUME SOLO LO QUE SE CARGÓ
-- ============================================================================
--  Lo encontró la revisión hecha para la Guía de uso, al recorrer el flujo de
--  logística pantalla por pantalla:
--
--   1. ejecutar_despacho consumía TODAS las reservas activas del pallet en esa
--      bodega, se cargara el pallet entero o solo una parte. Con el despacho
--      parcial (064, punto 13) eso daba por despachados kilos que seguían en
--      cámara, y soltaba reservas de otros pedidos del mismo pallet.
--      Ahora se consume exactamente lo cargado: primero la reserva de la línea
--      del pedido a la que va el pallet, después las de los pedidos del mismo
--      embarque. Si una reserva es mayor que lo cargado, se parte en dos: lo
--      que salió queda «consumida» y el resto sigue apartado.
--
--   2. Al despachar un contenedor, el embarque entero quedaba «despachado»
--      aunque tuviera otros contenedores abiertos (y ya no admitía nuevos).
--      Ahora queda despachado cuando no le queda ninguno abierto.
--
--   3. Un pallet «Solo mercado nacional» cargado sin línea de pedido se
--      rechazaba siempre, también en un embarque nacional. Ahora, sin línea,
--      manda el tipo del embarque.
-- ============================================================================

create or replace function ejecutar_despacho(p_packing_list_id bigint, p_numero text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  pk  packing_lists%rowtype;
  emb embarques%rowtype;
  ln  record;
  r   record;
  v_despacho_id bigint;
  v_queda numeric;
  v_parte numeric;
  v_bultos int;
begin
  select * into pk from packing_lists where id = p_packing_list_id for update;
  if not found then raise exception 'Packing list % no existe', p_packing_list_id; end if;
  if pk.estado = 'cerrado' then raise exception 'El packing list ya fue despachado'; end if;

  select * into emb from embarques where id = pk.embarque_id;

  -- Validación: tiene que existir el plano de estiba
  if not exists (select 1 from plano_estiba where packing_list_id = p_packing_list_id) then
    raise exception 'No se puede despachar sin plano de estiba generado';
  end if;

  insert into despachos (packing_list_id, numero, almacen_id, encargado_id, creado_por)
  values (p_packing_list_id, p_numero, emb.almacen_id, pk.supervisor_id, auth.uid())
  returning id into v_despacho_id;

  for ln in select * from packing_lineas where packing_list_id = p_packing_list_id loop
    -- Kardex: la salida de lo que se cargó
    insert into movimientos (tipo, lote_id, almacen_id, bultos, peso_neto_kg, costo_unitario,
                             documento_tipo, documento_id, documento_ref, usuario_id)
    select 'salida_despacho', ln.lote_id, emb.almacen_id, ln.bultos, ln.peso_neto_kg,
           coalesce(e.costo_promedio, 0), 'despacho', v_despacho_id, p_numero, auth.uid()
      from existencias e
     where e.lote_id = ln.lote_id and e.almacen_id = emb.almacen_id;

    /*
     * Las reservas: se consume lo cargado, ni más ni menos. Primero la de la
     * línea del pedido a la que va el pallet; luego las de los pedidos de este
     * embarque. Las de pedidos de OTROS embarques no se tocan.
     */
    v_queda := ln.peso_neto_kg;
    for r in
      select rv.*
        from reservas rv
        join pedido_lineas pl on pl.id = rv.pedido_linea_id
       where rv.lote_id = ln.lote_id
         and rv.almacen_id = emb.almacen_id
         and rv.estado in ('activa', 'en_preparacion')
         and (rv.pedido_linea_id = ln.pedido_linea_id
              or pl.pedido_id in (select pedido_id from embarque_pedidos where embarque_id = pk.embarque_id))
       order by (rv.pedido_linea_id = ln.pedido_linea_id) desc nulls last, rv.id
       for update of rv
    loop
      exit when v_queda <= 0.0005;
      if r.peso_neto_kg <= v_queda + 0.0005 then
        update reservas set estado = 'consumida' where id = r.id;
        v_queda := v_queda - r.peso_neto_kg;
      else
        -- Se parte: lo que salió, consumido; el resto sigue apartado.
        v_parte  := v_queda;
        v_bultos := greatest(1, round(r.bultos * v_parte / r.peso_neto_kg)::int);
        update reservas
           set peso_neto_kg = r.peso_neto_kg - v_parte,
               bultos = greatest(1, r.bultos - v_bultos)
         where id = r.id;
        insert into reservas (pedido_linea_id, lote_id, almacen_id, bultos, peso_neto_kg, estado,
                              vence_el, creado_por, observaciones)
        values (r.pedido_linea_id, r.lote_id, r.almacen_id, v_bultos, v_parte, 'consumida',
                r.vence_el, auth.uid(), format('Parte despachada en %s', p_numero));
        v_queda := 0;
      end if;
    end loop;
  end loop;

  update packing_lists set estado = 'cerrado' where id = p_packing_list_id;
  -- El embarque, despachado solo si ya no le queda ningún contenedor abierto.
  update embarques set estado = case
           when exists (select 1 from packing_lists
                         where embarque_id = pk.embarque_id and id <> p_packing_list_id
                           and estado in ('abierto', 'en_carga'))
           then 'en_preparacion'::estado_embarque else 'despachado'::estado_embarque end
   where id = pk.embarque_id;

  perform registrar_evento('despacho', v_despacho_id, 'despacho_ejecutado',
    format('Despacho %s ejecutado desde packing %s', p_numero, pk.codigo), 'info');

  return v_despacho_id;
end;
$$;
revoke execute on function ejecutar_despacho(bigint, text) from public, anon;
grant execute on function ejecutar_despacho(bigint, text) to authenticated;


/* ---- 3. Solo mercado nacional: sin línea de pedido, manda el embarque ---- */
create or replace function validar_condicion_de_venta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipo   tipo_despacho;
  v_pf     text;
  v_pallet text;
begin
  --  Anidado a propósito: PL/pgSQL no garantiza cortocircuito en «and», y
  --  packing_lineas no tiene «estado».
  if tg_table_name = 'reservas' then
    if new.estado not in ('activa', 'en_preparacion') then
      return new;
    end if;
  end if;
  if not lote_solo_nacional(new.lote_id) then
    return new;
  end if;
  select p.tipo_despacho, p.numero_proforma into v_tipo, v_pf
    from pedido_lineas pl join pedidos p on p.id = pl.pedido_id
   where pl.id = new.pedido_linea_id;
  --  Un pallet cargado al contenedor sin línea de pedido: vale el tipo del embarque.
  if v_tipo is null and tg_table_name = 'packing_lineas' then
    select e.tipo_despacho, e.numero into v_tipo, v_pf
      from packing_lists pk join embarques e on e.id = pk.embarque_id
     where pk.id = new.packing_list_id;
  end if;
  if v_tipo is distinct from 'mercado_nacional' then
    select codigo_pallet into v_pallet from lotes where id = new.lote_id;
    raise exception 'El pallet % es «Solo mercado nacional» y el pedido % no es de mercado nacional: no se puede reservar ni cargar para exportación.',
      v_pallet, coalesce(v_pf, '(sin número)');
  end if;
  return new;
end $$;
