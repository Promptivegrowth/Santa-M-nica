-- ============================================================================
--  069 · AJUSTES, MERMAS Y MUESTRAS · TRASLADOS A MANO · DIFERENCIAS CLARAS
-- ============================================================================
--  Lo encontró la Guía de uso, en el capítulo de Stock («Limitaciones
--  conocidas»):
--
--   1. El Kardex tenía desde el principio cuatro tipos de movimiento que nadie
--      podía registrar: ajuste que suma, ajuste que resta, merma y muestra. No
--      había pantalla ni función. Ahora hay una sola puerta, stock_ajustar(),
--      que valida rol, motivo, saldo y reservas y escribe UN movimiento nuevo:
--      el Kardex sigue sin editarse, la corrección queda a la vista.
--
--   2. Los traslados solo nacían desde Logística (consolidar un embarque). Para
--      crearlos a mano ya existía la acción del servidor; faltaba la pantalla
--      y que la BASE comprobara cada línea, no solo la pantalla.
--
--   3. Al recibir un traslado con diferencias, el mensaje decía «se registró
--      como ajuste en el Kardex», y no era verdad: no se escribe ningún ajuste.
--      Lo que pasa de verdad es que el origen registró la salida completa y el
--      destino la entrada de lo recibido. Ahora la diferencia se describe tal
--      cual (faltante o sobrante, en bultos y kilos, y qué pasó con ella), se
--      deja en el historial DEL TRASLADO (antes se anotaba con otro nombre de
--      entidad y la ficha no la veía) y genera un aviso de verdad en Alertas.
--
--  De paso, dos agujeros del mismo flujo:
--   · traslado_despachar y traslado_aceptar no comprobaban el rol (020 reescribió
--     la de aceptar y se perdió el control de 006).
--   · traslado_despachar comparaba contra el DISPONIBLE, que descuenta lo
--     reservado. Un traslado de consolidación —que mueve precisamente stock
--     apartado para ese embarque— no podía salir nunca. Ahora compara contra el
--     FÍSICO no bloqueado menos lo apartado que se queda: lo apartado solo
--     viaja si es de un pedido que el traslado consolida (consolida_pedidos,
--     068). Y al aceptar solo se mudan las reservas que viajaron (regla
--     acordada con Logística; ver la sección 6).
--
--  Re-ejecutable: create or replace, bloques DO e «if not exists».
-- ============================================================================


-- ============================================================================
--  0. UNA AYUDA PARA ESCRIBIR KILOS EN LOS MENSAJES
--  «1,234.5» como en el resto de la aplicación (es-PE): coma de miles y punto
--  decimal. Sin esto los mensajes salían con «1234.500».
-- ============================================================================
create or replace function texto_kg(p numeric)
returns text language sql immutable as $$
  select to_char(round(coalesce(p, 0), 1), 'FM999G999G990D0');
$$;
comment on function texto_kg is 'Kilos con un decimal y separador de miles, para los mensajes al usuario.';

create or replace function texto_bultos(p int)
returns text language sql immutable as $$
  select coalesce(p, 0) || case when coalesce(p, 0) = 1 then ' bulto' else ' bultos' end;
$$;
comment on function texto_bultos is '«1 bulto», «3 bultos»: para los mensajes al usuario.';


-- ============================================================================
--  1. QUÉ MOTIVO SIRVE PARA QUÉ MOVIMIENTO
--  El catálogo de motivos ya traía los de ajuste, merma y muestra (los del
--  Excel), pero sin decir a qué tipo de movimiento corresponde cada uno. Sin
--  eso, nada impedía registrar una «merma» con el motivo «Muestra SGS».
--  Si un motivo nuevo de ámbito «ajuste» no trae la lista, vale para ajustes.
-- ============================================================================
alter table motivos add column if not exists tipos_movimiento tipo_movimiento[];
comment on column motivos.tipos_movimiento is
  'Tipos de movimiento del Kardex que admite este motivo (069). Nulo en un motivo de ámbito «ajuste»: vale para ajustes que suman y que restan.';

update motivos set tipos_movimiento = array['ajuste_positivo','ajuste_negativo']::tipo_movimiento[]
 where ambito = 'ajuste' and codigo in ('CONTEO_FISICO','DISCREPANCIA_TRAS','ERROR_REGISTRO','RECLASIFICACION');

update motivos set tipos_movimiento = array['salida_merma']::tipo_movimiento[]
 where (ambito = 'ajuste' and codigo = 'MERMA_CAMARA')
    or (ambito = 'salida' and codigo in ('MERMADO','VIDA_UTIL','HARINA'));

update motivos set tipos_movimiento = array['salida_muestra']::tipo_movimiento[]
 where ambito = 'salida' and codigo in ('MC_PT','M_INTERTEK','M_SGS');


-- ============================================================================
--  2. UN AJUSTE PUEDE SER SOLO DE PESO
--  El Kardex exigía bultos > 0 en todo movimiento. Para un conteo que encuentra
--  20 kg de menos con los mismos bultos (o una merma por deshidratación) eso
--  obligaba a inventarse un bulto. Ahora, SOLO en ajustes, mermas y muestras,
--  los bultos pueden ser cero; el peso sigue siendo siempre mayor que cero.
-- ============================================================================
do $$
begin
  if exists (select 1 from pg_constraint
              where conrelid = 'movimientos'::regclass and conname = 'movimientos_bultos_check') then
    alter table movimientos drop constraint movimientos_bultos_check;
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'movimientos'::regclass and conname = 'movimientos_bultos_validos') then
    alter table movimientos add constraint movimientos_bultos_validos check (
      bultos > 0
      or (bultos = 0 and tipo in ('ajuste_positivo','ajuste_negativo','salida_merma','salida_muestra'))
    );
  end if;
end $$;


-- ============================================================================
--  3. LA PUERTA ÚNICA DE LOS AJUSTES, MERMAS Y MUESTRAS
-- ============================================================================
--  QUIÉN PUEDE
--   · Ajuste que suma / que resta → Gerencia u Operaciones. Es lo que dice el
--     modelo desde 001 («operaciones autoriza traslados, ajustes y reservas»)
--     y todos los motivos de ajuste piden autorización.
--   · Merma → Gerencia y Operaciones. Almacén también, pero solo con un motivo
--     que NO pida autorización; hoy todos los de merma la piden, así que en la
--     práctica Almacén la avisa y Operaciones la registra. Lo decide el
--     catálogo de motivos (Configuración), no este código.
--   · Muestra → Gerencia, Operaciones, Almacén y Calidad: los motivos de
--     muestra no piden autorización y es Calidad quien las saca.
--   · Quien registra con un motivo que pide autorización y tiene el rol para
--     darla queda como «autorizado por» en el Kardex.
--
--  QUÉ COMPRUEBA
--   · El pallet tiene que tener stock en esa bodega para restar, y no puede
--     quedar en negativo, ni con kilos sin bultos ni con bultos sin kilos.
--   · Si lo que se resta se come kilos RESERVADOS para pedidos, no pasa sin
--     avisar: la primera llamada se rechaza con la pista «tocar_reservas» y el
--     detalle de qué pedidos; solo Gerencia u Operaciones pueden confirmar, y
--     entonces se reducen esas reservas (de la más nueva a la más antigua,
--     primero las activas y después las que están en preparación) en lo justo.
--   · Motivo de la lista, que corresponda al tipo, y una explicación escrita.
--
--  COSTO
--   · El movimiento se valoriza al costo promedio del pallet en esa bodega
--     (o, si no lo tiene, al de origen del lote). Al restar, el promedio no
--     cambia; al sumar al mismo costo, tampoco. El valor del inventario baja o
--     sube exactamente en kilos × costo.
-- ============================================================================
create or replace function stock_ajustar(
  p_lote_id        bigint,
  p_almacen_id     bigint,
  p_tipo           tipo_movimiento,
  p_bultos         int,
  p_peso_kg        numeric,
  p_motivo_id      bigint,
  p_detalle        text,
  p_tocar_reservas boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s            int := signo_movimiento(p_tipo);
  m            motivos%rowtype;
  l            lotes%rowtype;
  e            existencias%rowtype;
  v_hay        boolean;
  v_almacen    text;
  v_b_antes    int;
  v_kg_antes   numeric(14,3);
  v_b_despues  int;
  v_kg_despues numeric(14,3);
  v_reservado  numeric(14,3) := 0;
  v_exceso     numeric(14,3) := 0;
  v_corte      numeric(14,3);
  v_pedidos    text;
  v_reducidas  jsonb := '[]'::jsonb;
  rv           record;
  v_id         bigint;
  v_doc        text;
  v_doc_tipo   text;
  v_costo      numeric(14,6);
  v_autoriza   uuid;
  v_nombre     text;
  v_texto      text;
begin
  /* ---- Quién ---- */
  if auth.uid() is null or not puede('gerencia','operaciones','almacen','calidad') then
    raise exception 'Su rol no puede registrar ajustes, mermas ni muestras.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_tipo not in ('ajuste_positivo','ajuste_negativo','salida_merma','salida_muestra') then
    raise exception 'Aquí solo se registran ajustes, mermas y muestras. Los ingresos, traslados y despachos tienen su propia pantalla.';
  end if;

  if p_tipo in ('ajuste_positivo','ajuste_negativo') and not puede('gerencia','operaciones') then
    raise exception 'Los ajustes de stock los registra y autoriza Gerencia u Operaciones. Avíseles la diferencia que encontró.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_tipo = 'salida_merma' and not puede('gerencia','operaciones','almacen') then
    raise exception 'Las mermas las registran Gerencia, Operaciones o Almacén.'
      using errcode = 'insufficient_privilege';
  end if;

  v_nombre := case p_tipo
    when 'ajuste_positivo' then 'Ajuste que suma'
    when 'ajuste_negativo' then 'Ajuste que resta'
    when 'salida_merma'    then 'Merma'
    else 'Muestra' end;

  /* ---- Cuánto ---- */
  if p_peso_kg is null or p_peso_kg <= 0 then
    raise exception 'Indique los kilos (más de cero). Si solo cambian los bultos, igual hay que decir cuánto pesan.';
  end if;
  if p_bultos is null or p_bultos < 0 then
    raise exception 'Los bultos no pueden ser negativos: el tipo de movimiento ya dice si suma o resta.';
  end if;

  /* ---- Por qué ---- */
  if p_detalle is null or length(trim(p_detalle)) < 10 then
    raise exception 'Explique qué pasó en al menos 10 caracteres: dentro de un mes nadie recordará por qué cambió el stock.';
  end if;

  select * into m from motivos where id = p_motivo_id and activo;
  if not found then
    raise exception 'Elija el motivo de la lista.';
  end if;
  if not (p_tipo = any(coalesce(
            m.tipos_movimiento,
            case when m.ambito = 'ajuste'
                 then array['ajuste_positivo','ajuste_negativo']::tipo_movimiento[]
                 else array[]::tipo_movimiento[] end))) then
    raise exception 'El motivo «%» no corresponde a un movimiento de tipo «%».', m.nombre, v_nombre;
  end if;
  if m.requiere_autorizacion and not puede('gerencia','operaciones') then
    raise exception 'El motivo «%» requiere autorización: lo registra Gerencia u Operaciones.', m.nombre
      using errcode = 'insufficient_privilege';
  end if;

  /* ---- Dónde ---- */
  select * into l from lotes where id = p_lote_id;
  if not found then raise exception 'Ese pallet no existe.'; end if;

  select nombre into v_almacen from almacenes where id = p_almacen_id and activo;
  if v_almacen is null then raise exception 'Elija una bodega activa.'; end if;

  select * into e from existencias where lote_id = p_lote_id and almacen_id = p_almacen_id for update;
  v_hay := found;
  v_b_antes  := coalesce(e.bultos, 0);
  v_kg_antes := coalesce(e.peso_neto_kg, 0);

  if s = -1 and (not v_hay or v_b_antes + v_kg_antes <= 0) then
    raise exception 'El pallet % no tiene stock en %: no hay nada que restar.', l.codigo_pallet, v_almacen;
  end if;

  v_b_despues  := v_b_antes + s * p_bultos;
  v_kg_despues := v_kg_antes + s * p_peso_kg;

  if v_b_despues < 0 or v_kg_despues < -0.001 then
    raise exception 'El pallet % quedaría en negativo: en % tiene % bultos · % kg y se quieren restar % bultos · % kg.',
      l.codigo_pallet, v_almacen, v_b_antes, texto_kg(v_kg_antes), p_bultos, texto_kg(p_peso_kg);
  end if;
  if v_b_despues = 0 and v_kg_despues > 0.001 then
    raise exception 'Quedarían % kg sin ningún bulto. Si sale el pallet entero, reste también todos sus kilos (%); si queda producto, deje al menos un bulto.',
      texto_kg(v_kg_despues), texto_kg(v_kg_antes);
  end if;
  if v_b_despues > 0 and v_kg_despues <= 0.001 then
    raise exception 'Quedarían % bultos sin peso. Reste también los bultos o deje algo de peso.', v_b_despues;
  end if;

  /* ---- Lo reservado ---- */
  if s = -1 then
    select coalesce(sum(peso_neto_kg), 0) into v_reservado
      from reservas
     where lote_id = p_lote_id and almacen_id = p_almacen_id
       and estado in ('activa','en_preparacion');

    v_exceso := v_reservado - greatest(v_kg_despues, 0);

    if v_exceso > 0.001 then
      select string_agg(distinct coalesce(p.numero_proforma, '(sin número)'), ', ')
        into v_pedidos
        from reservas r
        left join pedido_lineas pl on pl.id = r.pedido_linea_id
        left join pedidos p on p.id = pl.pedido_id
       where r.lote_id = p_lote_id and r.almacen_id = p_almacen_id
         and r.estado in ('activa','en_preparacion');

      if not p_tocar_reservas then
        raise exception 'Después de esto quedarían % kg en el pallet y hay % kg reservados para %. Si confirma, esas reservas se reducen en % kg y esos pedidos quedan con menos stock apartado.',
          texto_kg(v_kg_despues), texto_kg(v_reservado), v_pedidos, texto_kg(v_exceso)
          using hint = 'tocar_reservas';
      end if;
      if not puede('gerencia','operaciones') then
        raise exception 'Esto toca % kg reservados para %. Solo Gerencia u Operaciones pueden reducir reservas: pídales que lo registren.',
          texto_kg(v_exceso), v_pedidos
          using errcode = 'insufficient_privilege';
      end if;
    end if;
  end if;

  /* ---- El movimiento ----
     El número de documento sale del propio id del movimiento, que se pide
     antes de insertar: después ya no se puede tocar la fila (el Kardex no
     admite UPDATE). */
  v_costo := case when v_hay and coalesce(e.costo_promedio, 0) > 0 then e.costo_promedio
                  else coalesce(l.costo_unitario, 0) end;
  v_autoriza := case when m.requiere_autorizacion or p_tipo in ('ajuste_positivo','ajuste_negativo')
                     then auth.uid() end;
  v_id := nextval(pg_get_serial_sequence('movimientos', 'id'));
  v_doc_tipo := case p_tipo when 'salida_merma' then 'merma' when 'salida_muestra' then 'muestra' else 'ajuste' end;
  v_doc := case v_doc_tipo when 'merma' then 'MER' when 'muestra' then 'MUE' else 'AJU' end
           || '-' || lpad(v_id::text, 6, '0');

  insert into movimientos (id, tipo, lote_id, almacen_id, camara_id, bultos, peso_neto_kg,
                           costo_unitario, motivo_id, documento_tipo, documento_id, documento_ref,
                           usuario_id, autorizado_por, observaciones)
  values (v_id, p_tipo, p_lote_id, p_almacen_id, e.camara_id, p_bultos, p_peso_kg,
          v_costo, m.id, v_doc_tipo, v_id, v_doc,
          auth.uid(), v_autoriza, trim(p_detalle));

  /* ---- Las reservas que ya no tienen respaldo ---- */
  if v_exceso > 0.001 then
    for rv in
      select r.*, p.numero_proforma
        from reservas r
        left join pedido_lineas pl on pl.id = r.pedido_linea_id
        left join pedidos p on p.id = pl.pedido_id
       where r.lote_id = p_lote_id and r.almacen_id = p_almacen_id
         and r.estado in ('activa','en_preparacion')
       order by (r.estado = 'en_preparacion'), r.creado_en desc
       for update of r
    loop
      exit when v_exceso <= 0.001;
      v_corte := least(rv.peso_neto_kg, v_exceso);

      if rv.peso_neto_kg - v_corte <= 0.001 then
        update reservas
           set estado = 'liberada', liberado_por = auth.uid(), liberado_en = now(),
               motivo_liberacion = format('Liberada al registrar %s %s del pallet %s: ya no hay stock que la respalde.',
                                          lower(v_nombre), v_doc, l.codigo_pallet)
         where id = rv.id;
      else
        update reservas
           set peso_neto_kg = peso_neto_kg - v_corte,
               bultos = greatest(1, round(bultos * ((peso_neto_kg - v_corte) / peso_neto_kg))::int),
               observaciones = concat_ws(' · ', observaciones,
                 format('Reducida en %s kg por %s %s', texto_kg(v_corte), lower(v_nombre), v_doc))
         where id = rv.id;
      end if;

      perform registrar_evento('reservas', rv.id, 'reserva_reducida',
        format('Reserva de %s reducida en %s kg (de %s a %s kg) por %s %s del pallet %s.',
               coalesce(rv.numero_proforma, 'un pedido'), texto_kg(v_corte), texto_kg(rv.peso_neto_kg),
               texto_kg(rv.peso_neto_kg - v_corte), lower(v_nombre), v_doc, l.codigo_pallet),
        'advertencia',
        jsonb_build_object('lote_id', p_lote_id, 'movimiento_id', v_id, 'kg', v_corte));

      v_reducidas := v_reducidas || jsonb_build_object(
        'reserva_id', rv.id, 'pedido', rv.numero_proforma,
        'kg_antes', rv.peso_neto_kg, 'kg_despues', rv.peso_neto_kg - v_corte);
      v_exceso := v_exceso - v_corte;
    end loop;
  end if;

  /* ---- Historial del pallet, en cristiano ---- */
  v_texto := format('%s %s en %s: %s %s · %s kg (motivo: %s). %s Quedan %s · %s kg.',
    v_nombre, v_doc, v_almacen,
    case when s = 1 then 'suma' else 'resta' end,
    texto_bultos(p_bultos), texto_kg(p_peso_kg), m.nombre, trim(p_detalle),
    texto_bultos(v_b_despues), texto_kg(v_kg_despues));
  if jsonb_array_length(v_reducidas) > 0 then
    v_texto := v_texto || format(' Se redujeron %s reserva(s) que ya no tenían stock.', jsonb_array_length(v_reducidas));
  end if;

  perform registrar_evento('lotes', p_lote_id, 'stock_' || v_doc_tipo, v_texto,
    case when s = 1 then 'info' else 'advertencia' end::severidad_alerta,
    jsonb_build_object('movimiento_id', v_id, 'documento', v_doc, 'tipo', p_tipo,
                       'almacen_id', p_almacen_id, 'bultos', p_bultos, 'kg', p_peso_kg,
                       'motivo', m.nombre, 'reservas_reducidas', v_reducidas));

  return jsonb_build_object(
    'movimiento_id', v_id, 'documento', v_doc, 'tipo', p_tipo, 'pallet', l.codigo_pallet,
    'almacen', v_almacen, 'bultos_antes', v_b_antes, 'kg_antes', v_kg_antes,
    'bultos_despues', v_b_despues, 'kg_despues', v_kg_despues,
    'valor', round(p_peso_kg * v_costo, 2), 'reservas_reducidas', v_reducidas);
end;
$$;
comment on function stock_ajustar is
  'Registra un ajuste (+/−), una merma o una muestra como un movimiento NUEVO del Kardex, con rol, motivo, saldo y reservas validados (069).';

revoke execute on function stock_ajustar(bigint, bigint, tipo_movimiento, int, numeric, bigint, text, boolean) from public, anon;
grant  execute on function stock_ajustar(bigint, bigint, tipo_movimiento, int, numeric, bigint, text, boolean) to authenticated;


-- ============================================================================
--  4. LA BASE COMPRUEBA CADA LÍNEA DE UN TRASLADO
--  La pantalla «Nuevo traslado» ya valida, pero la tabla admite inserciones
--  directas de Almacén (RLS). Aquí se exige lo mínimo que no depende de quién
--  arma el traslado: que el pallet esté en la bodega de origen con esos bultos
--  y kilos, que no esté bloqueado por Calidad y que el traslado siga en
--  borrador. Lo reservado NO se descuenta aquí a propósito: la consolidación
--  de un embarque mueve justamente stock reservado (y la reserva viaja).
-- ============================================================================
create or replace function traslado_lineas_validar()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t        traslados%rowtype;
  v        record;
  v_pallet text;
begin
  if tg_op = 'UPDATE'
     and new.lote_id = old.lote_id
     and new.bultos_enviados = old.bultos_enviados
     and new.peso_enviado_kg = old.peso_enviado_kg then
    return new;   -- al recibir solo se anota lo aceptado: no hay nada que validar aquí
  end if;

  select * into t from traslados where id = new.traslado_id;
  if t.estado <> 'borrador' then
    raise exception 'Los pallets de un traslado solo se cambian mientras está en borrador (este está %).',
      replace(t.estado::text, '_', ' ');
  end if;

  select codigo_pallet into v_pallet from lotes where id = new.lote_id;

  select fisico_kg, fisico_bultos into v
    from v_stock_lote where lote_id = new.lote_id and almacen_id = t.almacen_origen_id;
  if not found then
    raise exception 'El pallet % no tiene stock en la bodega de origen.', coalesce(v_pallet, new.lote_id::text);
  end if;
  if new.peso_enviado_kg > v.fisico_kg + 0.001 or new.bultos_enviados > v.fisico_bultos then
    raise exception 'Del pallet % hay % bultos · % kg en la bodega de origen y el traslado lleva % bultos · % kg.',
      v_pallet, v.fisico_bultos, texto_kg(v.fisico_kg), new.bultos_enviados, texto_kg(new.peso_enviado_kg);
  end if;
  if lote_bloqueado(new.lote_id) then
    raise exception 'El pallet % está bloqueado por Calidad y no puede moverse de bodega hasta que lo liberen.', v_pallet;
  end if;
  return new;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_traslado_lineas_validar'
                    and tgrelid = 'traslado_lineas'::regclass) then
    create trigger trg_traslado_lineas_validar
      before insert or update on traslado_lineas
      for each row execute function traslado_lineas_validar();
  end if;
end $$;


-- ============================================================================
--  5. DESPACHAR: CON ROL, SIN PALLETS BLOQUEADOS Y SIN LLEVARSE LO AJENO
-- ============================================================================
--  Cuánto puede salir de cada pallet: el físico MENOS lo apartado que se
--  queda en el origen. Lo apartado solo viaja si es de uno de los pedidos que
--  el traslado consolida (traslados.consolida_pedidos, lo llena «Armar el
--  traslado» de Logística, 068). Un traslado a mano de stock libre no se lleva
--  la reserva de nadie: si después de crearlo alguien apartó parte del pallet,
--  el despacho lo dice y no sale.
-- ============================================================================
create or replace function traslado_despachar(p_traslado_id bigint, p_guia text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  t      traslados%rowtype;
  ln     record;
  v      record;
  v_pallet text;
  v_queda  numeric(14,3);
  v_quien  text;
begin
  if not puede('gerencia','operaciones','almacen') then
    raise exception 'Solo Gerencia, Operaciones o Almacén despachan traslados.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into t from traslados where id = p_traslado_id for update;
  if not found then raise exception 'Traslado % no existe', p_traslado_id; end if;
  if t.estado <> 'autorizado' then
    raise exception 'El traslado debe estar autorizado antes de despacharse (estado actual: %)', t.estado;
  end if;

  /*
   * Cada pallet tiene que seguir FÍSICAMENTE en el origen y sin bloqueo.
   * No se compara contra el disponible: lo reservado sí puede viajar (la
   * reserva se muda con el pallet al aceptar), y un traslado de consolidación
   * lleva precisamente eso.
   */
  for ln in select * from traslado_lineas where traslado_id = p_traslado_id loop
    select codigo_pallet into v_pallet from lotes where id = ln.lote_id;
    select fisico_kg, fisico_bultos into v
      from v_stock_lote where lote_id = ln.lote_id and almacen_id = t.almacen_origen_id;
    if not found or v.fisico_kg + 0.001 < ln.peso_enviado_kg or v.fisico_bultos < ln.bultos_enviados then
      raise exception 'El pallet % ya no tiene en el origen lo que lleva el traslado: hay % bultos · % kg y el traslado lleva % bultos · % kg. Anule el traslado y créelo de nuevo con lo que hay.',
        v_pallet, coalesce(v.fisico_bultos, 0), texto_kg(coalesce(v.fisico_kg, 0)),
        ln.bultos_enviados, texto_kg(ln.peso_enviado_kg);
    end if;
    if lote_bloqueado(ln.lote_id) then
      raise exception 'El pallet % quedó bloqueado por Calidad después de autorizarse el traslado: no puede salir hasta que lo liberen.', v_pallet;
    end if;

    -- Lo apartado para pedidos que NO viajan con este traslado se queda.
    select coalesce(sum(r.peso_neto_kg), 0),
           string_agg(distinct coalesce(p.numero_proforma, '(sin número)'), ', ')
      into v_queda, v_quien
      from reservas r
      left join pedido_lineas pl on pl.id = r.pedido_linea_id
      left join pedidos p on p.id = pl.pedido_id
     where r.lote_id = ln.lote_id and r.almacen_id = t.almacen_origen_id
       and r.estado in ('activa','en_preparacion')
       and (t.consolida_pedidos is null or pl.pedido_id is null
            or not (pl.pedido_id = any(t.consolida_pedidos)));
    if ln.peso_enviado_kg > v.fisico_kg - v_queda + 0.001 then
      raise exception 'Del pallet % hay % kg en el origen, pero % kg están apartados para % y se quedan allí: el traslado lleva % kg y solo pueden salir % kg. Libere esas reservas o anule el traslado y créelo de nuevo con lo libre.',
        v_pallet, texto_kg(v.fisico_kg), texto_kg(v_queda), v_quien,
        texto_kg(ln.peso_enviado_kg), texto_kg(greatest(v.fisico_kg - v_queda, 0));
    end if;
  end loop;

  -- Kardex: salida del origen
  for ln in select * from traslado_lineas where traslado_id = p_traslado_id loop
    insert into movimientos (tipo, lote_id, almacen_id, bultos, peso_neto_kg,
                             costo_unitario, documento_tipo, documento_id, documento_ref, usuario_id)
    values ('traslado_salida', ln.lote_id, t.almacen_origen_id, ln.bultos_enviados, ln.peso_enviado_kg,
            coalesce((select e.costo_promedio from existencias e
                       where e.lote_id = ln.lote_id and e.almacen_id = t.almacen_origen_id),
                     (select costo_unitario from lotes where id = ln.lote_id), 0),
            'traslado', p_traslado_id, coalesce(p_guia, t.guia_numero), auth.uid());
  end loop;

  update traslados
     set estado = 'en_transito', despachado_por = auth.uid(), despachado_en = now(),
         guia_numero = coalesce(p_guia, guia_numero)
   where id = p_traslado_id;

  perform registrar_evento('traslados', p_traslado_id, 'traslado_despachado',
    format('Traslado %s despachado con guía %s', t.numero, coalesce(p_guia, t.guia_numero, 's/g')), 'info');
end;
$$;


-- ============================================================================
--  6. ACEPTAR: CON ROL, Y LA DIFERENCIA DICHA COMO ES
-- ============================================================================
--  Lo que pasa en el Kardex con una diferencia (no cambia, solo se explica):
--    · El origen registró al despachar la salida de TODO lo enviado.
--    · El destino registra ahora la entrada de lo RECIBIDO.
--  Por eso:
--    · FALTANTE: esos kilos ya salieron del inventario; no están en ninguna
--      bodega. No se escribe ningún ajuste. Si aparecen, se registran con un
--      ajuste que suma (motivo «Discrepancia de traslado»).
--    · SOBRANTE: lo que sobra entró en el destino y el inventario subió. Si
--      fue un error de pesaje, se corrige con un ajuste que resta.
--  Cada diferencia queda en el historial del traslado y como aviso en Alertas
--  (crítico si falta, advertencia si sobra o si solo difieren los bultos).
--
--  QUÉ RESERVAS SE MUDAN (regla acordada con Logística, 068)
--    1. Las de los pedidos que el traslado consolida, hasta lo que llegó.
--    2. Además, si lo que quedó en el origen ya no alcanza para las reservas
--       que siguen allí, se mudan solo las que no caben (lo mínimo), y se
--       avisa en el historial.
--    3. Un traslado a mano de stock libre no muda la reserva de nadie.
--  Antes se mudaban de la más antigua a la más nueva sin mirar de quién eran
--  ni si habían viajado.
-- ============================================================================

/*
 * Muda reservas de un pallet del origen al destino, hasta p_kg, de la más
 * antigua a la más nueva; parte la última si no cabe entera. p_pedidos: si
 * viene, solo las de esos pedidos. Devuelve los kilos mudados.
 * (Nombre propio de la 069: la 068 borra su versión de prueba.)
 */
create or replace function traslado_reservas_mudar(
  p_traslado traslados, p_lote_id bigint, p_kg numeric, p_pedidos bigint[]
) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  rv      record;
  v_queda numeric(14,3) := coalesce(p_kg, 0);
  v_parte numeric(14,3);
begin
  for rv in
    select r.* from reservas r
      left join pedido_lineas pl on pl.id = r.pedido_linea_id
     where r.lote_id = p_lote_id
       and r.almacen_id = p_traslado.almacen_origen_id
       and r.estado in ('activa', 'en_preparacion')
       and (p_pedidos is null or pl.pedido_id = any(p_pedidos))
     order by r.creado_en asc, r.id
     for update of r
  loop
    exit when v_queda <= 0.0005;
    if rv.peso_neto_kg <= v_queda + 0.0005 then
      update reservas set almacen_id = p_traslado.almacen_destino_id where id = rv.id;
      v_queda := v_queda - rv.peso_neto_kg;
    else
      /* La porción que viajó se muda; el resto sigue apartado en el origen. */
      v_parte := v_queda;
      insert into reservas (pedido_linea_id, lote_id, almacen_id, bultos, peso_neto_kg,
                            estado, vence_el, creado_por, reasignada_desde, observaciones)
      values (rv.pedido_linea_id, rv.lote_id, p_traslado.almacen_destino_id,
              greatest(1, round(rv.bultos * (v_parte / rv.peso_neto_kg))::int),
              v_parte, rv.estado, rv.vence_el, rv.creado_por, rv.id,
              format('Porción trasladada por el traslado %s', p_traslado.numero));
      update reservas
         set peso_neto_kg = peso_neto_kg - v_parte,
             bultos = greatest(1, bultos - greatest(1, round(bultos * (v_parte / peso_neto_kg))::int)),
             observaciones = format('Quedó en origen tras el traslado %s', p_traslado.numero)
       where id = rv.id;
      v_queda := 0;
    end if;
  end loop;
  return coalesce(p_kg, 0) - v_queda;
end $$;
revoke execute on function traslado_reservas_mudar(traslados, bigint, numeric, bigint[]) from public, anon, authenticated;

create or replace function traslado_aceptar(p_traslado_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  t           traslados%rowtype;
  ln          record;
  v_difs      int := 0;
  v_llego     numeric(14,3);
  v_mudado    numeric(14,3);
  v_extra     numeric(14,3);
  v_pallet    text;
  v_origen    text;
  v_destino   text;
  v_dif_kg    numeric(14,3);
  v_dif_b     int;
  v_texto     text;
  v_sev       severidad_alerta;
  v_res_orig  numeric(14,3);
  v_fis_orig  numeric(14,3);
begin
  if not puede('gerencia','operaciones','almacen') then
    raise exception 'Solo Gerencia, Operaciones o Almacén reciben traslados.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into t from traslados where id = p_traslado_id for update;
  if not found then raise exception 'Traslado % no existe', p_traslado_id; end if;
  if t.estado <> 'en_transito' then
    raise exception 'Solo se puede aceptar un traslado en tránsito (estado actual: %)', t.estado;
  end if;

  select nombre into v_origen  from almacenes where id = t.almacen_origen_id;
  select nombre into v_destino from almacenes where id = t.almacen_destino_id;

  for ln in select * from traslado_lineas where traslado_id = p_traslado_id order by id loop
    select codigo_pallet into v_pallet from lotes where id = ln.lote_id;

    -- Si nadie declaró lo recibido, se asume que llegó todo
    if ln.bultos_aceptados is null then
      update traslado_lineas
         set bultos_aceptados = ln.bultos_enviados,
             peso_aceptado_kg = ln.peso_enviado_kg
       where id = ln.id;
      ln.bultos_aceptados := ln.bultos_enviados;
      ln.peso_aceptado_kg := ln.peso_enviado_kg;
    end if;

    -- Bultos y kilos recibidos tienen que ir juntos: o llegó algo, o no llegó nada.
    if (ln.bultos_aceptados = 0) <> (coalesce(ln.peso_aceptado_kg, 0) <= 0) then
      raise exception 'Pallet %: se anotaron % bultos y % kg recibidos. Si no llegó nada, ponga cero en los dos; si llegó algo, indique bultos y kilos.',
        v_pallet, ln.bultos_aceptados, texto_kg(ln.peso_aceptado_kg);
    end if;

    -- Kardex: ingreso en destino por lo REALMENTE aceptado, al costo del origen
    if ln.bultos_aceptados > 0 then
      insert into movimientos (tipo, lote_id, almacen_id, bultos, peso_neto_kg,
                               costo_unitario, documento_tipo, documento_id, documento_ref, usuario_id)
      values ('traslado_ingreso', ln.lote_id, t.almacen_destino_id, ln.bultos_aceptados, ln.peso_aceptado_kg,
              coalesce((select e.costo_promedio from existencias e
                         where e.lote_id = ln.lote_id and e.almacen_id = t.almacen_origen_id),
                       (select costo_unitario from lotes where id = ln.lote_id), 0),
              'traslado', p_traslado_id, t.guia_numero, auth.uid());
    end if;

    -- ══════════════════════════════════════════════════════════════════════
    --  LAS RESERVAS SE MUDAN CON EL PALLET, SOLO LAS QUE VIAJARON
    -- ══════════════════════════════════════════════════════════════════════
    v_llego := coalesce(ln.peso_aceptado_kg, 0);
    v_mudado := 0;

    -- 1. En una consolidación, lo que viajó ERA lo apartado de esos pedidos.
    if t.consolida_pedidos is not null then
      v_mudado := traslado_reservas_mudar(t, ln.lote_id, v_llego, t.consolida_pedidos);
    end if;

    -- 2. Lo apartado que ya no cabe en lo que quedó en el origen también viajó:
    --    se muda solo eso, sea de quien sea, y se avisa.
    select coalesce(sum(peso_neto_kg), 0) into v_res_orig from reservas
     where lote_id = ln.lote_id and almacen_id = t.almacen_origen_id
       and estado in ('activa','en_preparacion');
    select coalesce(sum(peso_neto_kg), 0) into v_fis_orig from existencias
     where lote_id = ln.lote_id and almacen_id = t.almacen_origen_id;
    v_extra := least(v_res_orig - v_fis_orig, v_llego - v_mudado);
    if v_extra > 0.0005 then
      v_extra := traslado_reservas_mudar(t, ln.lote_id, v_extra, null);
      perform registrar_evento('traslados', p_traslado_id, 'reservas_mudadas',
        format('Pallet %s: en %s quedaban %s kg y había %s kg apartados. Se mudaron a %s %s kg de reservas de otros pedidos, lo que ya no cabía en el origen. Revise esos pedidos: su stock apartado ahora está en %s.',
               v_pallet, v_origen, texto_kg(v_fis_orig), texto_kg(v_res_orig), v_destino,
               texto_kg(v_extra), v_destino),
        'advertencia', jsonb_build_object('lote_id', ln.lote_id, 'kg', v_extra));
    end if;

    -- ══════════════════════════════════════════════════════════════════════
    --  LA DIFERENCIA, DICHA COMO ES
    -- ══════════════════════════════════════════════════════════════════════
    v_dif_kg := coalesce(ln.peso_aceptado_kg, 0) - ln.peso_enviado_kg;
    v_dif_b  := ln.bultos_aceptados - ln.bultos_enviados;

    if abs(v_dif_kg) > 0.005 or v_dif_b <> 0 then
      v_difs := v_difs + 1;

      v_texto := format('Pallet %s: salieron de %s %s · %s kg y se recibieron en %s %s · %s kg. ',
        v_pallet, v_origen, texto_bultos(ln.bultos_enviados), texto_kg(ln.peso_enviado_kg),
        v_destino, texto_bultos(ln.bultos_aceptados), texto_kg(ln.peso_aceptado_kg));

      if v_dif_kg < -0.005 then
        v_sev := 'critica';
        v_texto := v_texto || format(
          'Faltante: %s kg%s. El Kardex registró la salida completa del origen y la entrada solo de lo recibido: esos kilos ya no figuran en ninguna bodega. No se escribió ningún ajuste. Si aparecen, regístrelos con un ajuste que suma en %s (motivo «Discrepancia de traslado»); si no, investíguelo con el transportista.',
          texto_kg(-v_dif_kg),
          case when v_dif_b < 0 then ' y ' || texto_bultos(-v_dif_b)
               when v_dif_b > 0 then format(' (aunque llegaron %s más)', texto_bultos(v_dif_b)) else '' end,
          v_destino);

        -- ¿Quedaron reservas en el origen sin stock que las respalde?
        select coalesce(sum(peso_neto_kg), 0) into v_res_orig from reservas
         where lote_id = ln.lote_id and almacen_id = t.almacen_origen_id
           and estado in ('activa','en_preparacion');
        select coalesce(sum(peso_neto_kg), 0) into v_fis_orig from existencias
         where lote_id = ln.lote_id and almacen_id = t.almacen_origen_id;
        if v_res_orig - v_fis_orig > 0.005 then
          v_texto := v_texto || format(
            ' Además, %s kg de reservas de este pallet quedaron apartados en %s sin stock que los respalde: libérelos o reasígnelos desde el pedido.',
            texto_kg(v_res_orig - v_fis_orig), v_origen);
        end if;
      elsif v_dif_kg > 0.005 then
        v_sev := 'advertencia';
        v_texto := v_texto || format(
          'Sobrante: %s kg%s, que entraron en %s y subieron el inventario. Revise el pesaje: si fue un error, corríjalo con un ajuste que resta en %s (motivo «Discrepancia de traslado»).',
          texto_kg(v_dif_kg),
          case when v_dif_b > 0 then ' y ' || texto_bultos(v_dif_b)
               when v_dif_b < 0 then format(' (aunque llegaron %s menos)', texto_bultos(-v_dif_b)) else '' end,
          v_destino, v_destino);
      else
        v_sev := 'advertencia';
        v_texto := v_texto || format(
          'Mismo peso con %s %s: el inventario en kilos no cambia, pero el conteo de bultos de %s ya no coincide con la guía. Si fue un error de conteo, corríjalo con un ajuste.',
          texto_bultos(abs(v_dif_b)), case when v_dif_b < 0 then 'menos' else 'más' end, v_destino);
      end if;

      if coalesce(trim(ln.observacion), '') <> '' then
        v_texto := v_texto || format(' Observación al recibir: %s', trim(ln.observacion));
      end if;

      perform registrar_evento('traslados', p_traslado_id, 'discrepancia_traslado', v_texto, v_sev,
        jsonb_build_object('lote_id', ln.lote_id, 'pallet', v_pallet,
                           'enviado_bultos', ln.bultos_enviados, 'enviado_kg', ln.peso_enviado_kg,
                           'recibido_bultos', ln.bultos_aceptados, 'recibido_kg', ln.peso_aceptado_kg,
                           'diferencia_kg', v_dif_kg, 'diferencia_bultos', v_dif_b));

      insert into alertas (entidad, entidad_id, severidad, titulo, mensaje, datos)
      values ('traslado', p_traslado_id, v_sev,
              case when v_dif_kg < -0.005 then 'Faltante al recibir un traslado'
                   else 'Diferencia al recibir un traslado' end,
              format('%s · %s', t.numero, v_texto),
              jsonb_build_object('lote_id', ln.lote_id, 'diferencia_kg', v_dif_kg, 'diferencia_bultos', v_dif_b));
    end if;
  end loop;

  update traslados
     set estado = 'aceptado', aceptado_por = auth.uid(), aceptado_en = now()
   where id = p_traslado_id;

  perform registrar_evento('traslados', p_traslado_id, 'traslado_aceptado',
    format('Traslado %s aceptado en %s%s', t.numero, v_destino,
           case when v_difs > 0 then format(' con %s diferencia(s) entre lo enviado y lo recibido', v_difs)
                else ': lo recibido coincide con lo enviado' end),
    (case when v_difs > 0 then 'advertencia' else 'info' end)::severidad_alerta);
end;
$$;

comment on function traslado_aceptar is
  'Acepta un traslado en destino: escribe el Kardex por lo recibido, muda las reservas con la mercadería y describe cada diferencia (faltante o sobrante) en el historial y en Alertas (069).';

revoke execute on function traslado_despachar(bigint, text) from public, anon;
revoke execute on function traslado_aceptar(bigint) from public, anon;
grant  execute on function traslado_despachar(bigint, text) to authenticated;
grant  execute on function traslado_aceptar(bigint) to authenticated;
