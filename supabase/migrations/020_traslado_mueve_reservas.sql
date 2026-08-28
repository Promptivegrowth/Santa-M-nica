-- ============================================================================
--  020 · AL TRASLADAR, LA RESERVA VIAJA CON LA MERCADERÍA
-- ============================================================================
--  EL AGUJERO
--  `traslado_aceptar` escribía el Kardex y movía las existencias, pero dejaba
--  las RESERVAS apuntando a la bodega de origen. O sea que después de un
--  traslado de stock reservado quedaba esto:
--
--    · La mercadería, físicamente en la bodega destino.
--    · La reserva, diciendo que está apartada en la bodega origen.
--
--  Consecuencia: en el destino el producto figuraba disponible —se le podía
--  prometer a otro cliente— y en el origen figuraba apartado un stock que ya
--  no estaba. Las dos cosas mal a la vez, y en silencio.
--
--  Nadie lo había visto porque hasta ahora no se podían crear traslados desde
--  la pantalla, y los de la carga inicial no movían stock reservado.
--
--  LA REGLA
--  La reserva pertenece al PEDIDO, no a la bodega. Si el pallet se muda, la
--  reserva se muda con él: sigue siendo el mismo apartado para el mismo
--  cliente, solo que ahora en otra cámara.
--
--  SI LLEGÓ MENOS DE LO ENVIADO
--  Se muda solo lo que llegó. El resto se queda apartado en el origen, que es
--  la verdad: esos kilos no están en el destino. La discrepancia ya queda
--  registrada por su lado con su alerta.
-- ============================================================================

create or replace function traslado_aceptar(p_traslado_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  t traslados%rowtype;
  ln record;
  rv record;
  v_difs int := 0;
  v_por_mudar numeric(14,3);
  v_mudado numeric(14,3);
begin
  select * into t from traslados where id = p_traslado_id for update;
  if not found then raise exception 'Traslado % no existe', p_traslado_id; end if;
  if t.estado <> 'en_transito' then
    raise exception 'Solo se puede aceptar un traslado en tránsito (estado actual: %)', t.estado;
  end if;

  for ln in select * from traslado_lineas where traslado_id = p_traslado_id loop
    -- Si nadie declaró lo recibido, se asume que llegó todo
    if ln.bultos_aceptados is null then
      update traslado_lineas
         set bultos_aceptados = ln.bultos_enviados,
             peso_aceptado_kg = ln.peso_enviado_kg
       where id = ln.id;
      ln.bultos_aceptados := ln.bultos_enviados;
      ln.peso_aceptado_kg := ln.peso_enviado_kg;
    end if;

    -- Kardex: ingreso en destino por lo REALMENTE aceptado
    if ln.bultos_aceptados > 0 then
      insert into movimientos (tipo, lote_id, almacen_id, bultos, peso_neto_kg,
                               costo_unitario, documento_tipo, documento_id, documento_ref, usuario_id)
      select 'traslado_ingreso', ln.lote_id, t.almacen_destino_id, ln.bultos_aceptados, ln.peso_aceptado_kg,
             coalesce(e.costo_promedio, 0), 'traslado', p_traslado_id, t.guia_numero, auth.uid()
        from existencias e
       where e.lote_id = ln.lote_id and e.almacen_id = t.almacen_origen_id
       limit 1;
    end if;

    -- ══════════════════════════════════════════════════════════════════════
    --  LAS RESERVAS SE MUDAN CON EL PALLET
    -- ══════════════════════════════════════════════════════════════════════
    -- Se recorren las reservas vivas de ese lote en el origen, de la más
    -- antigua a la más nueva, mudando hasta agotar lo que llegó. El orden
    -- importa: si no alcanza para todas, la que se queda esperando es la que
    -- se apartó después, no una cualquiera.
    v_por_mudar := coalesce(ln.peso_aceptado_kg, 0);

    for rv in
      select * from reservas
       where lote_id = ln.lote_id
         and almacen_id = t.almacen_origen_id
         and estado in ('activa', 'en_preparacion')
       order by creado_en asc
    loop
      exit when v_por_mudar <= 0;

      if rv.peso_neto_kg <= v_por_mudar then
        -- Cabe entera: se muda tal cual.
        update reservas set almacen_id = t.almacen_destino_id where id = rv.id;
        v_por_mudar := v_por_mudar - rv.peso_neto_kg;
      else
        /*
         * No cabe entera. Se parte en dos: la porción que llegó se muda al
         * destino y el resto se queda apartado en el origen. Partirla es más
         * honesto que mudarla completa —diría que hay stock donde no lo hay—
         * o que dejarla entera en el origen —perdería el apartado de lo que
         * sí viajó—.
         */
        v_mudado := v_por_mudar;

        insert into reservas (pedido_linea_id, lote_id, almacen_id, bultos, peso_neto_kg,
                              estado, vence_el, creado_por, reasignada_desde, observaciones)
        values (rv.pedido_linea_id, rv.lote_id, t.almacen_destino_id,
                greatest(1, round(rv.bultos * (v_mudado / rv.peso_neto_kg))::int),
                v_mudado, rv.estado, rv.vence_el, rv.creado_por, rv.id,
                format('Porción trasladada desde %s por el traslado %s', t.almacen_origen_id, t.numero));

        update reservas
           set peso_neto_kg = peso_neto_kg - v_mudado,
               bultos = greatest(1, bultos - greatest(1, round(bultos * (v_mudado / peso_neto_kg))::int)),
               observaciones = format('Quedó en origen tras el traslado %s', t.numero)
         where id = rv.id;

        v_por_mudar := 0;
      end if;
    end loop;

    -- Discrepancia: llegó menos de lo enviado
    if ln.peso_aceptado_kg < ln.peso_enviado_kg then
      v_difs := v_difs + 1;
      perform registrar_evento('traslado', p_traslado_id, 'discrepancia_traslado',
        format('Discrepancia en lote %s: enviados %s kg, aceptados %s kg. Requiere ajuste autorizado.',
               ln.lote_id, ln.peso_enviado_kg, ln.peso_aceptado_kg), 'critica',
        jsonb_build_object('lote_id', ln.lote_id,
                           'enviado', ln.peso_enviado_kg,
                           'aceptado', ln.peso_aceptado_kg));
    end if;
  end loop;

  update traslados
     set estado = 'aceptado', aceptado_por = auth.uid(), aceptado_en = now()
   where id = p_traslado_id;

  perform registrar_evento('traslado', p_traslado_id, 'traslado_aceptado',
    format('Traslado %s aceptado en destino%s', t.numero,
           case when v_difs > 0 then format(' con %s discrepancia(s)', v_difs) else '' end),
    case when v_difs > 0 then 'advertencia' else 'info' end);
end;
$$;

comment on function traslado_aceptar is
  'Acepta un traslado en destino: escribe el Kardex, muda las reservas con la mercadería y deja registrada cualquier discrepancia.';
