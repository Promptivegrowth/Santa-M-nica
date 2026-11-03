-- ============================================================================
--  079 · PLANTILLAS E IMPORTADORES PARA LA DATA DE INICIO
-- ============================================================================
--  Re-ejecutable: `if not exists`, `on conflict do nothing`, `create or replace`
--  y bloques DO que solo actúan la primera vez.
--
--  Contexto: Operaciones entregó «DATA 2025.xlsx», la base que usan hoy, como
--  data de inicio del ERP. Al revisarla salieron tres cosas que tocan la base:
--
--   1. ALMACENES DE COMPRA. En sus catálogos aparecen EXALMAR y PERUVIAN, que
--      no existían en el sistema. Operaciones: «compro solo a dos almacenes:
--      Exalmar y Peruvian». Se dan de alta como externos que reciben compras.
--      Elamar y Perufrost dejan de recibir compras (quedan solo por traslado):
--      en DATA no hay ningún ingreso de compra a esas bodegas (todo lo que
--      entró allí fue «TRASLADO ALM TERCERO» o «REIMPORTACIÓN»). La producción
--      sigue entrando por Santa Mónica (cámaras 01, 02 y 03), Freeko y Hayduk.
--      Como Gerencia u Operaciones pueden cambiar estas marcas en
--      Configuración › Maestros › Almacenes, el ajuste se hace UNA sola vez
--      (cuando se crean Exalmar y Peruvian): volver a correr la migración no
--      pisa lo que ellos decidan después.
--
--   2. TRASLADOS IMPORTADOS = TRASLADOS YA HECHOS. Lo que el equipo lleva en
--      Excel son traslados que YA ocurrieron (con su guía y su fecha), no
--      pedidos de traslado. Hasta ahora la importación creaba borradores que
--      había que autorizar, despachar y recibir uno por uno. Ahora:
--        · Si los sube Almacén, la importación queda «Lista para validar»
--          (mismo patrón que los ingresos) y se avisa a Gerencia y Operaciones.
--        · Al «Validar y registrar» (Gerencia u Operaciones), cada traslado se
--          registra ya despachado y recibido, en UNA sola operación:
--          traslado_registrar_hecho() crea el traslado y sus líneas y lo pasa
--          por las MISMAS funciones del circuito (autorizar → despachar →
--          aceptar). Así el Kardex, el stock y las reservas se mueven igual que
--          en un traslado normal, y si una línea falla no queda nada a medias.
--        · Si los sube Gerencia u Operaciones, se registran en el mismo paso.
--      El traslado guarda la fecha en que ocurrió (traslados.fecha_traslado).
--
--   3. EL AVISO Y LA REGLA DE QUIÉN VALIDA, también para las importaciones de
--      traslados (antes solo eran de ingresos).
-- ============================================================================


-- ============================================================================
--  1. EXALMAR Y PERUVIAN
-- ============================================================================
do $$
declare
  v_nuevos int;
begin
  insert into almacenes (codigo, nombre, tipo, operador, recibe_produccion, recibe_compras)
  values ('EXALMAR',  'Exalmar',  'externo', 'Exalmar',  false, true),
         ('PERUVIAN', 'Peruvian', 'externo', 'Peruvian', false, true)
  on conflict (codigo) do nothing;
  get diagnostics v_nuevos = row_count;

  --  Solo la primera vez (cuando se acaban de crear): Elamar y Perufrost ya no
  --  reciben compras. Si luego Gerencia lo cambia, no se vuelve a pisar.
  if v_nuevos > 0 then
    update almacenes set recibe_compras = false where codigo in ('ELAMAR', 'PERUFR');
    update almacenes set recibe_produccion = true
     where codigo in ('STM-C1', 'STM-C2', 'STM-C3', 'FREEKO', 'HAYDUK');
  end if;
end $$;


-- ============================================================================
--  2. LA FECHA EN QUE OCURRIÓ UN TRASLADO REGISTRADO DESPUÉS
-- ============================================================================
alter table traslados add column if not exists fecha_traslado date;
comment on column traslados.fecha_traslado is
  'Fecha en que el traslado ocurrió de verdad, cuando se registró después de hecho (importado desde Excel, 079). '
  'Los movimientos del Kardex llevan la hora en que se registró; esta es la fecha física del traslado.';


-- ============================================================================
--  3. REGISTRAR UN TRASLADO YA HECHO, EN UNA SOLA OPERACIÓN
-- ----------------------------------------------------------------------------
--  Crea el traslado con sus líneas y lo pasa por autorizar → despachar →
--  aceptar, todo en la misma transacción: o queda aceptado con su stock en el
--  destino, o no queda nada. Las reglas son las de siempre (las aplican las
--  funciones del circuito y el disparador de las líneas, 069): saldo en el
--  origen, sin bloqueo de Calidad, lo apartado para otros pedidos se queda.
--
--  Lo usan Gerencia y Operaciones (validan la importación). Almacén deja la
--  importación «Lista para validar».
--
--  p_lineas: [{"lote_id": 1, "bultos": 40, "peso_kg": 800.5}, …]
--  p_filas:  las filas de la importación que van en este traslado; se marcan
--            «registrada» con su traslado en la misma operación.
-- ============================================================================
create or replace function traslado_registrar_hecho(
  p_origen          bigint,
  p_destino         bigint,
  p_fecha           date,
  p_guia            text,
  p_observaciones   text,
  p_lineas          jsonb,
  p_importacion_id  bigint default null,
  p_filas           bigint[] default null
)
returns table (id_traslado bigint, numero_traslado text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoy     date := (now() at time zone 'America/Lima')::date;
  v_anio    int  := extract(year from v_hoy)::int;
  v_id      bigint;
  v_numero  text;
  v_origen  text;
  v_destino text;
  v_archivo text;
  v_n       int;
begin
  if not puede('gerencia'::rol_usuario, 'operaciones'::rol_usuario) then
    raise exception 'Los traslados ya hechos los registran Gerencia u Operaciones. Almacén deja la importación «Lista para validar» y se les avisa.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_fecha is null then
    raise exception 'Falta la fecha del traslado: el día en que salió el camión.';
  end if;
  if p_fecha > v_hoy then
    raise exception 'La fecha del traslado (%) es futura. Aquí se registran traslados que ya ocurrieron: ponga la fecha de hoy o una anterior.',
      to_char(p_fecha, 'DD/MM/YYYY');
  end if;
  if p_origen = p_destino then
    raise exception 'El origen y el destino no pueden ser la misma bodega.';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'El traslado no lleva ningún pallet.';
  end if;

  select nombre into v_origen  from almacenes where id = p_origen  and activo;
  select nombre into v_destino from almacenes where id = p_destino and activo;
  if v_origen is null or v_destino is null then
    raise exception 'La bodega de origen o la de destino no existe o está desactivada.';
  end if;
  if p_importacion_id is not null then
    select archivo into v_archivo from importaciones_excel where id = p_importacion_id;
  end if;

  /* ---- Cabecera y líneas, en borrador (como cualquier traslado) ---- */
  v_numero := format('TRAS-%s-%s', v_anio, lpad(siguiente_correlativo('TRAS', v_anio)::text, 4, '0'));
  insert into traslados (numero, almacen_origen_id, almacen_destino_id, estado, guia_numero,
                         fecha_traslado, observaciones, creado_por)
  values (v_numero, p_origen, p_destino, 'borrador', nullif(btrim(p_guia), ''),
          p_fecha, nullif(btrim(p_observaciones), ''), auth.uid())
  returning id into v_id;

  insert into traslado_lineas (traslado_id, lote_id, bultos_enviados, peso_enviado_kg)
  select v_id, x.lote_id, x.bultos, x.peso_kg
    from jsonb_to_recordset(p_lineas) as x(lote_id bigint, bultos int, peso_kg numeric);
  get diagnostics v_n = row_count;

  /* ---- El circuito de siempre, de una vez ---- */
  perform traslado_autorizar(v_id);
  perform traslado_despachar(v_id, nullif(btrim(p_guia), ''));
  perform traslado_aceptar(v_id);

  perform registrar_evento('traslados', v_id, 'traslado_registrado_hecho',
    format('Traslado ya hecho el %s (%s → %s, %s pallet%s%s), registrado después%s. Se autorizó, despachó y recibió en el mismo paso.',
           to_char(p_fecha, 'DD/MM/YYYY'), v_origen, v_destino, v_n, case when v_n = 1 then '' else 's' end,
           case when nullif(btrim(p_guia), '') is not null then ', guía ' || btrim(p_guia) else ', sin guía' end,
           case when v_archivo is not null then format(' desde la importación «%s»', v_archivo) else '' end),
    'info', jsonb_build_object('fecha_traslado', p_fecha, 'importacion_id', p_importacion_id));

  /* ---- Las filas de la importación, marcadas en la misma operación ---- */
  if p_importacion_id is not null and p_filas is not null then
    update importaciones_excel_filas
       set estado = 'registrada', traslado_id = v_id, actualizado_en = now(),
           resultado = format('Registrado en el traslado %s (%s → %s), ya recibido en destino.', v_numero, v_origen, v_destino)
     where importacion_id = p_importacion_id and id = any(p_filas);
  end if;

  return query select v_id, v_numero;
end $$;

revoke execute on function traslado_registrar_hecho(bigint, bigint, date, text, text, jsonb, bigint, bigint[]) from public, anon;
grant execute on function traslado_registrar_hecho(bigint, bigint, date, text, text, jsonb, bigint, bigint[]) to authenticated;


-- ============================================================================
--  4. QUIÉN VALIDA Y EL AVISO: también para las importaciones de traslados
-- ============================================================================
create or replace function importaciones_excel_estado_y_aviso()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_filas   integer;
  v_quien   text;
  v_que     text := case new.tipo when 'traslados' then 'traslado' else 'ingreso' end;
begin
  if new.estado = 'validada'
     and (tg_op = 'INSERT' or old.estado <> 'validada')
     and not puede('gerencia'::rol_usuario, 'operaciones'::rol_usuario) then
    raise exception 'Las importaciones de %s las validan Gerencia u Operaciones. Déjela «Lista para validar» y avíseles.',
      case new.tipo when 'traslados' then 'traslados' else 'ingresos' end;
  end if;

  if tg_op = 'UPDATE' and new.estado is distinct from old.estado then
    --  Al salir de «lista» (se validó o volvió a revisión) el aviso se cierra.
    if old.estado = 'lista' then
      update alertas
         set atendida = true, atendida_por = auth.uid(), atendida_en = now()
       where entidad = 'importacion' and entidad_id = new.id and not atendida;
    end if;
    --  Al quedar «lista», se avisa a Gerencia y Operaciones.
    if new.estado = 'lista' then
      select count(*) into v_filas from importaciones_excel_filas where importacion_id = new.id and estado = 'valida';
      select nombre into v_quien from usuarios where id = coalesce(new.enviada_por, auth.uid());
      insert into alertas (entidad, entidad_id, severidad, titulo, mensaje, datos)
      values ('importacion', new.id, 'advertencia',
              case new.tipo when 'traslados' then 'Importación de traslados por validar' else 'Importación de ingresos por validar' end,
              case new.tipo
                when 'traslados' then
                  format('%s dejó lista para validar la importación «%s» con %s pallet%s trasladado%s. Los traslados se registran (ya recibidos, moviendo el stock) cuando Gerencia u Operaciones pulse «Validar y registrar».',
                         coalesce(v_quien, 'Almacén'), new.archivo, v_filas,
                         case when v_filas = 1 then '' else 's' end, case when v_filas = 1 then '' else 's' end)
                else
                  format('%s dejó lista para validar la importación «%s» con %s %s%s. Entran al stock cuando Gerencia u Operaciones pulse «Validar y registrar».',
                         coalesce(v_quien, 'Almacén'), new.archivo, v_filas, v_que, case when v_filas = 1 then '' else 's' end)
              end,
              jsonb_build_object('importacion_id', new.id, 'filas', v_filas, 'tipo', new.tipo));
    end if;
  end if;
  return new;
end $$;

revoke execute on function importaciones_excel_estado_y_aviso() from public, anon;
