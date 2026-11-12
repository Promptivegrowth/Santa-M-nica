-- ============================================================================
--  088 · DIVIDIR UN PALLET (reunión con Dany, Almacén, 10/11)
-- ============================================================================
--  Correr DESPUÉS de la 088a (agrega los tipos de movimiento que esta usa).
--
--  Cómo trabaja hoy Almacén, en sus palabras: «de esos 30 pallets solo se van
--  20 sacos… esos 20 sacos los paletizo, les genero otro número de pallet, y
--  el despacho sale con ese número; los sacos que quedan son saldo» y, si no
--  hay otro embarque de esa presentación, el saldo «se completa con la
--  producción que va ingresando». Siempre FIFO: los sacos salen del pallet más
--  antiguo.
--
--  El packing ya deja cargar solo una parte de un pallet (lo que queda sigue
--  en cámara con el mismo código, como SALDO). Lo que faltaba es el paso
--  físico de Almacén: partir el pallet en dos, con un código NUEVO para la
--  parte que se separa. Eso hace pallet_dividir():
--
--   · El pallet nuevo nace como HIJO del original (lotes.lote_origen_id) con
--     su misma trazabilidad: producto, fecha de producción, campaña, planta,
--     línea, turno, proceso y costo. Un retiro sanitario o una búsqueda por
--     lote lo encuentran igual que al original.
--   · El Kardex no se edita: se escriben DOS movimientos con el mismo
--     documento (DIV-000123): «Salida por división» del original y «Ingreso
--     por división» del nuevo, en la misma bodega y cámara. El stock total no
--     cambia, y no cuenta como producción ni como ajuste (tipos propios, 088a).
--   · Se separa primero lo LIBRE; si los sacos que salen están apartados
--     para un pedido, esa parte de la reserva pasa con ellos al pallet nuevo
--     (reunión del 12/11: Dany divide en pleno despacho). No se divide un
--     pallet que está en un packing o un traslado abierto, ni uno que Calidad
--     tiene observado o inmovilizado (el hijo nacería sin su dictamen).
--   · El original tiene que quedar con algo: separarlo entero es cambiarle el
--     código, no dividirlo.
--
--  Quién: Gerencia, Operaciones y Almacén (es un movimiento físico de cámara).
--
--  Re-ejecutable: «if not exists» y «create or replace».
-- ============================================================================


-- ============================================================================
--  1. DE QUÉ PALLET SALIÓ
-- ============================================================================
alter table lotes add column if not exists lote_origen_id bigint references lotes(id);
comment on column lotes.lote_origen_id is
  'Si el pallet nació al dividir otro (088), cuál. Hereda su trazabilidad: producto, fecha, planta, línea, turno, proceso y costo.';
create index if not exists idx_lotes_origen on lotes(lote_origen_id) where lote_origen_id is not null;


-- ============================================================================
--  2. EL SIGNO Y EL NOMBRE DE LOS TIPOS NUEVOS
-- ============================================================================
create or replace function signo_movimiento(t tipo_movimiento) returns int
language sql immutable as $$
  select case t
    when 'ingreso'           then  1
    when 'traslado_ingreso'  then  1
    when 'ajuste_positivo'   then  1
    when 'ingreso_reproceso' then  1
    when 'division_ingreso'  then  1   -- 088
    when 'anulacion_despacho' then 1   -- 089
    else -1
  end;
$$;
comment on function signo_movimiento is 'Convierte el tipo de movimiento en +1 (entra) o -1 (sale).';

--  La de la 077, con los dos tipos de la división.
create or replace function etiqueta_estado(p text) returns text
language sql immutable as $$
  select case p
    when 'pendiente_validacion' then 'Pendiente de validación'
    when 'en_preparacion'       then 'En preparación'
    when 'en_transito'          then 'En tránsito'
    when 'espera_resultados'    then 'En espera de resultados'
    when 'producto_terminado'   then 'Producto terminado'
    when 'microbiologia'        then 'Microbiología'
    when 'camara'               then 'Cámara'
    when 'exportacion'          then 'Exportación'
    when 'mercado_nacional'     then 'Mercado nacional'
    when 'pendiente_stock'      then 'Pendiente de stock'
    when 'parcialmente_disponible' then 'Parcialmente disponible'
    when 'sin_facturar'         then 'Sin facturar'
    when 'bloqueado_credito'    then 'Bloqueado por crédito'
    when 'parcialmente_cobrado' then 'Parcialmente cobrado'
    when 'parcialmente_cobrada' then 'Parcialmente cobrada'
    when 'en_carga'             then 'En carga'
    when 'salida_despacho'      then 'Salida por despacho'
    when 'traslado_salida'      then 'Salida por traslado'
    when 'traslado_ingreso'     then 'Ingreso por traslado'
    when 'ajuste_positivo'      then 'Ajuste que suma'
    when 'ajuste_negativo'      then 'Ajuste que resta'
    when 'salida_reproceso'     then 'Salida a reproceso'
    when 'ingreso_reproceso'    then 'Ingreso de reproceso'
    when 'salida_muestra'       then 'Muestra'
    when 'salida_merma'         then 'Merma'
    when 'division_salida'      then 'Salida por división'
    when 'division_ingreso'     then 'Ingreso por división'
    when 'anulacion_despacho'   then 'Vuelve por despacho eliminado'
    when 'dia'                  then 'Día'
    when 'critica'              then 'Crítica'
    else upper(left(replace(coalesce(p, ''), '_', ' '), 1)) || substr(replace(coalesce(p, ''), '_', ' '), 2)
  end;
$$;
comment on function etiqueta_estado is
  'Clave interna → texto para el usuario, con tildes. El mismo diccionario que src/lib/etiquetas.ts.';


-- ============================================================================
--  3. LA DIVISIÓN
-- ============================================================================
create or replace function pallet_dividir(
  p_lote_id      bigint,
  p_almacen_id   bigint,
  p_bultos       int,
  p_peso_kg      numeric,
  p_codigo_nuevo text,
  p_detalle      text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l           lotes%rowtype;
  e           existencias%rowtype;
  v_almacen   text;
  v_codigo    text := upper(btrim(regexp_replace(coalesce(p_codigo_nuevo, ''), '\s+', ' ', 'g')));
  v_reservado numeric(14,3);
  v_libre     numeric(14,3);
  v_pedidos   text;
  v_donde     text;
  v_nuevo_id  bigint;
  v_mov_id    bigint;
  v_doc       text;
  v_costo     numeric(14,6);
  v_detalle   text := nullif(btrim(coalesce(p_detalle, '')), '');
  v_mover     numeric(14,3);               -- kilos reservados que pasan al pallet nuevo
  v_n         numeric(14,3);
  v_b         int;
  r           record;
begin
  /* ---- Quién ---- */
  if auth.uid() is null or not puede('gerencia','operaciones','almacen') then
    raise exception 'Su rol no puede dividir pallets: lo hacen Almacén, Operaciones o Gerencia.'
      using errcode = 'insufficient_privilege';
  end if;

  /* ---- Qué pallet y dónde ---- */
  select * into l from lotes where id = p_lote_id;
  if not found then raise exception 'Ese pallet no existe.'; end if;

  select nombre into v_almacen from almacenes where id = p_almacen_id and activo;
  if v_almacen is null then raise exception 'Elija una bodega activa.'; end if;

  select * into e from existencias where lote_id = p_lote_id and almacen_id = p_almacen_id for update;
  if not found or e.bultos <= 0 then
    raise exception 'El pallet % no tiene stock en %.', l.codigo_pallet, v_almacen;
  end if;

  /* ---- Cuánto ---- */
  if p_bultos is null or p_bultos <= 0 then
    raise exception 'Indique cuántos bultos pasan al pallet nuevo (más de cero).';
  end if;
  if p_peso_kg is null or p_peso_kg <= 0 then
    raise exception 'Indique cuántos kilos pasan al pallet nuevo (más de cero).';
  end if;
  if p_bultos >= e.bultos or p_peso_kg >= e.peso_neto_kg - 0.001 then
    raise exception 'El pallet % tiene % · % kg en %: al dividirlo tiene que quedarle algo. Para separar el pallet entero no hace falta dividirlo.',
      l.codigo_pallet, texto_bultos(e.bultos), texto_kg(e.peso_neto_kg), v_almacen;
  end if;

  /* ---- Lo que no se puede tocar ---- */
  if lote_bloqueado(p_lote_id) then
    raise exception 'El pallet % está observado o inmovilizado por Calidad. Divídalo cuando Calidad lo libere: el pallet nuevo nacería sin su dictamen.',
      l.codigo_pallet;
  end if;

  select string_agg(distinct pk.codigo, ', ') into v_donde
    from packing_lineas pl join packing_lists pk on pk.id = pl.packing_list_id
   where pl.lote_id = p_lote_id and pk.estado in ('abierto','en_carga');
  if v_donde is not null then
    raise exception 'El pallet % está cargado en el packing %. Quítelo del packing o cargue solo los bultos que salen: lo que queda sigue en cámara como saldo.',
      l.codigo_pallet, v_donde;
  end if;

  select string_agg(distinct t.numero, ', ') into v_donde
    from traslado_lineas tl join traslados t on t.id = tl.traslado_id
   where tl.lote_id = p_lote_id and t.estado in ('borrador','autorizado','en_transito');
  if v_donde is not null then
    raise exception 'El pallet % está en el traslado %, que no ha terminado. Divídalo cuando el traslado se cierre o se anule.',
      l.codigo_pallet, v_donde;
  end if;

  select coalesce(sum(r.peso_neto_kg), 0),
         string_agg(distinct coalesce(p.numero_proforma, '(sin número)'), ', ')
    into v_reservado, v_pedidos
    from reservas r
    left join pedido_lineas pli on pli.id = r.pedido_linea_id
    left join pedidos p on p.id = pli.pedido_id
   where r.lote_id = p_lote_id and r.almacen_id = p_almacen_id
     and r.estado in ('activa','en_preparacion');
  v_libre := e.peso_neto_kg - v_reservado;
  /*  Reunión del 12/11: Dany divide «en pleno despacho», y el pallet suele
      estar apartado para el pedido que sale. Se separa primero lo libre; si
      hace falta más, la reserva viaja con los sacos al pallet nuevo (sigue
      siendo del mismo pedido). Ver «La reserva sigue a los sacos», abajo. */
  v_mover := greatest(round(p_peso_kg - greatest(v_libre, 0), 3), 0);

  /* ---- El código nuevo ---- */
  if length(v_codigo) < 3 then
    raise exception 'Escriba el N° de pallet del pallet nuevo, p. ej. «%-A».', l.codigo_pallet;
  end if;
  if exists (select 1 from lotes x where upper(btrim(regexp_replace(x.codigo_pallet, '\s+', ' ', 'g'))) = v_codigo) then
    raise exception 'Ya existe un pallet %: el pallet nuevo necesita un número que no se haya usado.', v_codigo;
  end if;

  /* ---- El pallet nuevo: hijo del original, con su misma trazabilidad ----
     Hereda el costo del original. El disparador de costos le pondría el de
     hoy; se le avisa que esta alta no es un ingreso nuevo (057). */
  v_costo := case when coalesce(e.costo_promedio, 0) > 0 then e.costo_promedio else l.costo_unitario end;
  perform set_config('app.costos_carga_historica', 'si', true);
  insert into lotes (codigo_pallet, codigo_lote, campania, sku_presentacion_id, fecha_produccion, juliano,
                     planta_id, linea_procesadora_id, turno, proceso, bultos_iniciales, peso_neto_inicial_kg,
                     costo_unitario, costo_origen, costo_vigencia_id, observaciones, creado_por, lote_origen_id)
  values (v_codigo, l.codigo_lote, l.campania, l.sku_presentacion_id, l.fecha_produccion, l.juliano,
          l.planta_id, l.linea_procesadora_id, l.turno, l.proceso, p_bultos, p_peso_kg,
          v_costo, l.costo_origen, l.costo_vigencia_id,
          concat_ws(' · ', format('Dividido del pallet %s', l.codigo_pallet), v_detalle), auth.uid(), l.id)
  returning id into v_nuevo_id;
  perform set_config('app.costos_carga_historica', '', true);

  /* ---- El Kardex: sale de uno y entra al otro, con el mismo documento ---- */
  v_mov_id := nextval(pg_get_serial_sequence('movimientos', 'id'));
  v_doc := 'DIV-' || lpad(v_mov_id::text, 6, '0');

  insert into movimientos (id, tipo, lote_id, almacen_id, camara_id, bultos, peso_neto_kg, costo_unitario,
                           documento_tipo, documento_id, documento_ref, usuario_id, observaciones)
  values (v_mov_id, 'division_salida', l.id, p_almacen_id, e.camara_id, p_bultos, p_peso_kg, v_costo,
          'division', v_mov_id, v_doc, auth.uid(),
          concat_ws(' · ', format('Pasan al pallet nuevo %s', v_codigo), v_detalle));

  insert into movimientos (tipo, lote_id, almacen_id, camara_id, bultos, peso_neto_kg, costo_unitario,
                           documento_tipo, documento_id, documento_ref, usuario_id, observaciones)
  values ('division_ingreso', v_nuevo_id, p_almacen_id, e.camara_id, p_bultos, p_peso_kg, v_costo,
          'division', v_mov_id, v_doc, auth.uid(),
          concat_ws(' · ', format('Vienen del pallet %s', l.codigo_pallet), v_detalle));

  /* ---- La reserva sigue a los sacos (12/11) ----
     Lo que no alcanzó con lo libre sale de lo apartado: esa parte de la
     reserva pasa al pallet nuevo, para el mismo pedido. Una reserva que pasa
     entera cambia de pallet; una que pasa en parte se parte en dos. */
  for r in
    select * from reservas
     where lote_id = p_lote_id and almacen_id = p_almacen_id
       and estado in ('activa', 'en_preparacion')
     order by id
     for update
  loop
    exit when v_mover <= 0.0005;
    v_n := least(r.peso_neto_kg, v_mover);
    if r.peso_neto_kg - v_n <= 0.0005 then
      update reservas
         set lote_id = v_nuevo_id,
             observaciones = concat_ws(' · ', observaciones, format('Pasa al pallet %s al dividir %s (%s)', v_codigo, l.codigo_pallet, v_doc))
       where id = r.id;
    else
      v_b := least(greatest(1, round(r.bultos * v_n / r.peso_neto_kg)::int), p_bultos);
      update reservas
         set peso_neto_kg = r.peso_neto_kg - v_n, bultos = greatest(1, r.bultos - v_b)
       where id = r.id;
      insert into reservas (pedido_linea_id, lote_id, almacen_id, bultos, peso_neto_kg, estado,
                            vence_el, creado_por, observaciones)
      values (r.pedido_linea_id, v_nuevo_id, p_almacen_id, v_b, v_n, r.estado, r.vence_el, auth.uid(),
              format('Parte de la reserva del pallet %s que pasó al dividirlo (%s)', l.codigo_pallet, v_doc));
    end if;
    v_mover := v_mover - v_n;
  end loop;

  /* ---- Historial de los dos pallets, en cristiano ---- */
  perform registrar_evento('lotes', l.id, 'pallet_dividido',
    format('%s: se separaron %s · %s kg al pallet nuevo %s, en %s. Quedan %s · %s kg.%s',
           v_doc, texto_bultos(p_bultos), texto_kg(p_peso_kg), v_codigo, v_almacen,
           texto_bultos(e.bultos - p_bultos), texto_kg(e.peso_neto_kg - p_peso_kg),
           coalesce(' ' || v_detalle, '')),
    'info',
    jsonb_build_object('documento', v_doc, 'lote_nuevo_id', v_nuevo_id, 'almacen_id', p_almacen_id,
                       'bultos', p_bultos, 'kg', p_peso_kg));
  perform registrar_evento('lotes', v_nuevo_id, 'pallet_dividido',
    format('%s: nace al dividir el pallet %s, con %s · %s kg en %s.%s',
           v_doc, l.codigo_pallet, texto_bultos(p_bultos), texto_kg(p_peso_kg), v_almacen,
           coalesce(' ' || v_detalle, '')),
    'info',
    jsonb_build_object('documento', v_doc, 'lote_origen_id', l.id, 'almacen_id', p_almacen_id,
                       'bultos', p_bultos, 'kg', p_peso_kg));

  return jsonb_build_object(
    'documento', v_doc, 'lote_nuevo_id', v_nuevo_id, 'codigo_nuevo', v_codigo,
    'pallet', l.codigo_pallet, 'almacen', v_almacen,
    'bultos_quedan', e.bultos - p_bultos, 'kg_quedan', e.peso_neto_kg - p_peso_kg);
end;
$$;
comment on function pallet_dividir is
  'Parte un pallet en dos dentro de la misma bodega (088): el nuevo nace hijo del original, con su trazabilidad y su costo; el Kardex registra la salida y el ingreso por división con un mismo documento DIV-.';

revoke execute on function pallet_dividir(bigint, bigint, int, numeric, text, text) from public, anon;
grant  execute on function pallet_dividir(bigint, bigint, int, numeric, text, text) to authenticated;
