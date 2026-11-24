-- ============================================================================
--  092 · COMPLETAR UN PALLET QUE ENTRÓ COMO SALDO (Dany, Almacén, 24/11)
-- ============================================================================
--  En sus palabras: «tengo un temita con la última ubicación de cámara que se
--  le da a un pallet cuando inicialmente se le da una ubicación porque en
--  dicha fecha solo ingresó un saldo, y luego se le da otra ubicación cuando
--  se completa el pallet; con esa última queda con su ubicación final». Y por
--  teléfono: «si el pallet está formado por 48, que sume todo el total, y que
--  sume en la última fecha que se ponga, en la última cámara».
--
--  Es decir: un pallet se arma en más de un día. El primer día entra un saldo
--  (p. ej. 18 sacos) y se deja en una cámara; otro día se completa (30 sacos
--  más) y el pallet entero termina en otra cámara. Hasta hoy el ERP no podía
--  registrarlo: el formulario rechaza el N° de pallet porque ya existe, y la
--  carga desde el Excel lo dejaba partido entre las dos cámaras.
--
--  pallet_completar() hace, en una sola operación:
--
--   · Suma los sacos y kilos nuevos al MISMO pallet (no nace otro lote): en el
--     Kardex es un «ingreso» más de ese pallet, con documento COMP-000123.
--   · El saldo que estaba en otra cámara de la planta pasa a la cámara donde
--     quedó el pallet completo (salida e ingreso por traslado con el mismo
--     documento). Si tenía reservas, se van con él. Un saldo que está en otra
--     bodega (Freeko, Depsa…) no se mueve: eso sería un traslado de verdad.
--   · El pallet queda con la ÚLTIMA fecha de producción (la más reciente
--     entre la que tenía y la del complemento), y sus bultos y kilos
--     iniciales pasan a ser el total. La fecha anterior queda en el historial.
--
--  Quién: Gerencia, Operaciones y Almacén (los mismos que registran ingresos).
--
--  Re-ejecutable: «create or replace».
-- ============================================================================

create or replace function pallet_completar(
  p_lote_id    bigint,
  p_almacen_id bigint,
  p_camara_id  bigint,
  p_bultos     int,
  p_peso_kg    numeric,
  p_fecha      date,
  p_origen     text default 'produccion',
  p_detalle    text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l           lotes%rowtype;
  e           record;
  v_hoy       date := (now() at time zone 'America/Lima')::date;
  v_almacen   text;
  v_camara    bigint := p_camara_id;
  v_motivo    text;
  v_donde     text;
  v_mov_id    bigint;
  v_doc       text;
  v_fecha     date;
  v_detalle   text := nullif(btrim(coalesce(p_detalle, '')), '');
  v_movidos   text[] := '{}';
  v_otros     text[] := '{}';
  v_b_total   int;
  v_kg_total  numeric(14,3);
begin
  /* ---- Quién ---- */
  if auth.uid() is null or not puede('gerencia','operaciones','almacen') then
    raise exception 'Su rol no puede registrar ingresos a cámara: lo hacen Almacén, Operaciones o Gerencia.'
      using errcode = 'insufficient_privilege';
  end if;

  /* ---- Qué pallet y a dónde ---- */
  select * into l from lotes where id = p_lote_id for update;
  if not found then raise exception 'Ese pallet no existe.'; end if;

  select nombre into v_almacen from almacenes where id = p_almacen_id and activo;
  if v_almacen is null then raise exception 'Elija una bodega activa.'; end if;

  v_motivo := almacen_rechaza_ingreso(p_almacen_id, coalesce(nullif(p_origen, ''), 'produccion'));
  if v_motivo is not null then raise exception '%', v_motivo; end if;

  if v_camara is null then
    --  Las cámaras de la planta son una bodega con una sola cámara cada una.
    select c.id into v_camara from camaras c where c.almacen_id = p_almacen_id and c.activo order by c.id limit 1;
  elsif not exists (select 1 from camaras c where c.id = v_camara and c.almacen_id = p_almacen_id) then
    raise exception 'Esa cámara no pertenece a la bodega %.', v_almacen;
  end if;

  /* ---- Cuánto y cuándo ---- */
  if p_bultos is null or p_bultos <= 0 then raise exception 'Los bultos que completan el pallet tienen que ser más de cero.'; end if;
  if p_peso_kg is null or p_peso_kg <= 0 then raise exception 'El peso que completa el pallet tiene que ser mayor que cero.'; end if;
  if p_fecha is null then raise exception 'Falta la fecha de producción del complemento.'; end if;
  if p_fecha > v_hoy then
    raise exception 'La fecha de producción no puede ser futura: hoy es %.', to_char(v_hoy, 'DD/MM/YYYY');
  end if;

  /* ---- Lo que no se puede tocar ---- */
  if lote_bloqueado(p_lote_id) then
    raise exception 'El pallet % está observado o inmovilizado por Calidad. Complételo cuando Calidad lo libere.', l.codigo_pallet;
  end if;
  select string_agg(distinct pk.codigo, ', ') into v_donde
    from packing_lineas pl join packing_lists pk on pk.id = pl.packing_list_id
   where pl.lote_id = p_lote_id and pk.estado in ('abierto','en_carga');
  if v_donde is not null then
    raise exception 'El pallet % está cargado en el packing %. Bájelo del packing antes de completarlo.', l.codigo_pallet, v_donde;
  end if;
  select string_agg(distinct t.numero, ', ') into v_donde
    from traslado_lineas tl join traslados t on t.id = tl.traslado_id
   where tl.lote_id = p_lote_id and t.estado in ('borrador','autorizado','en_transito');
  if v_donde is not null then
    raise exception 'El pallet % está en el traslado %, que no ha terminado. Complételo cuando el traslado se cierre o se anule.',
      l.codigo_pallet, v_donde;
  end if;

  v_mov_id := nextval(pg_get_serial_sequence('movimientos', 'id'));
  v_doc := 'COMP-' || lpad(v_mov_id::text, 6, '0');

  /* ---- 1. El saldo que está en otra cámara de la planta pasa a la última ---- */
  for e in
    select x.*, a.nombre
      from existencias x join almacenes a on a.id = x.almacen_id
     where x.lote_id = p_lote_id and x.almacen_id <> p_almacen_id and x.bultos > 0
     order by x.almacen_id
     for update of x
  loop
    if exists (select 1 from camaras c where c.almacen_id = e.almacen_id)
       and exists (select 1 from camaras c where c.almacen_id = p_almacen_id) then
      insert into movimientos (tipo, lote_id, almacen_id, camara_id, bultos, peso_neto_kg, costo_unitario,
                               documento_tipo, documento_id, documento_ref, usuario_id, observaciones)
      values ('traslado_salida', l.id, e.almacen_id, e.camara_id, e.bultos, e.peso_neto_kg, e.costo_promedio,
              'completar_pallet', v_mov_id, v_doc, auth.uid(),
              format('Pallet completado: el saldo pasa a %s, donde quedó el pallet entero', v_almacen));
      insert into movimientos (tipo, lote_id, almacen_id, camara_id, bultos, peso_neto_kg, costo_unitario,
                               documento_tipo, documento_id, documento_ref, usuario_id, observaciones)
      values ('traslado_ingreso', l.id, p_almacen_id, v_camara, e.bultos, e.peso_neto_kg, e.costo_promedio,
              'completar_pallet', v_mov_id, v_doc, auth.uid(),
              format('Pallet completado: viene el saldo de %s', e.nombre));
      --  Las reservas van con los sacos (igual que en un traslado).
      update reservas
         set almacen_id = p_almacen_id,
             observaciones = concat_ws(' · ', observaciones, format('Pasa a %s al completar el pallet (%s)', v_almacen, v_doc))
       where lote_id = p_lote_id and almacen_id = e.almacen_id and estado in ('activa', 'en_preparacion');
      v_movidos := v_movidos || format('%s · %s kg de %s', texto_bultos(e.bultos), texto_kg(e.peso_neto_kg), e.nombre);
    else
      v_otros := v_otros || format('%s · %s kg en %s', texto_bultos(e.bultos), texto_kg(e.peso_neto_kg), e.nombre);
    end if;
  end loop;

  /* ---- 2. Lo que completa el pallet: un ingreso más de ESE pallet ---- */
  insert into movimientos (id, tipo, lote_id, almacen_id, camara_id, bultos, peso_neto_kg, costo_unitario,
                           documento_tipo, documento_id, documento_ref, usuario_id, observaciones, origen_ingreso)
  values (v_mov_id, 'ingreso', l.id, p_almacen_id, v_camara, p_bultos, p_peso_kg, l.costo_unitario,
          'completar_pallet', v_mov_id, v_doc, auth.uid(),
          concat_ws(' · ', format('Completa el pallet %s (producción del %s)', l.codigo_pallet, to_char(p_fecha, 'DD/MM/YYYY')), v_detalle),
          coalesce(nullif(p_origen, ''), 'produccion'));

  /* ---- 3. El pallet: total sumado y la última fecha ---- */
  v_fecha := greatest(l.fecha_produccion, p_fecha);
  update lotes
     set bultos_iniciales     = bultos_iniciales + p_bultos,
         peso_neto_inicial_kg = peso_neto_inicial_kg + p_peso_kg,
         fecha_produccion     = v_fecha
   where id = l.id;

  select coalesce(sum(bultos), 0), coalesce(sum(peso_neto_kg), 0) into v_b_total, v_kg_total
    from existencias where lote_id = l.id and almacen_id = p_almacen_id;

  perform registrar_evento('lotes', l.id, 'pallet_completado',
    format('%s: se completó con %s · %s kg (producción del %s) en %s.%s Queda con %s · %s kg en %s.%s%s%s',
           v_doc, texto_bultos(p_bultos), texto_kg(p_peso_kg), to_char(p_fecha, 'DD/MM/YYYY'), v_almacen,
           case when cardinality(v_movidos) > 0 then ' Pasó el saldo: ' || array_to_string(v_movidos, '; ') || '.' else '' end,
           texto_bultos(v_b_total), texto_kg(v_kg_total), v_almacen,
           case when v_fecha <> l.fecha_produccion
                then format(' Fecha de producción: del %s pasa al %s (la última).', to_char(l.fecha_produccion, 'DD/MM/YYYY'), to_char(v_fecha, 'DD/MM/YYYY'))
                else '' end,
           case when cardinality(v_otros) > 0 then ' Sigue aparte (otra bodega): ' || array_to_string(v_otros, '; ') || '.' else '' end,
           coalesce(' ' || v_detalle, '')),
    'info',
    jsonb_build_object('documento', v_doc, 'almacen_id', p_almacen_id, 'bultos', p_bultos, 'kg', p_peso_kg,
                       'fecha_anterior', l.fecha_produccion, 'fecha', v_fecha));

  return jsonb_build_object(
    'documento', v_doc, 'pallet', l.codigo_pallet, 'almacen', v_almacen,
    'bultos_total', v_b_total, 'kg_total', v_kg_total, 'fecha', v_fecha,
    'saldo_movido', to_jsonb(v_movidos), 'aparte', to_jsonb(v_otros));
end;
$$;
comment on function pallet_completar is
  'Completa un pallet que entró como saldo (092): suma el complemento al mismo lote, junta el saldo de otra cámara de la planta en la cámara final y deja la última fecha de producción.';

revoke execute on function pallet_completar(bigint, bigint, bigint, int, numeric, date, text, text) from public, anon;
grant  execute on function pallet_completar(bigint, bigint, bigint, int, numeric, date, text, text) to authenticated;
