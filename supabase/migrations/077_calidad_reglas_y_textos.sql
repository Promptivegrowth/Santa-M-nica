-- ============================================================================
--  077 · CALIDAD, REGLAS Y TEXTOS COMUNES
-- ============================================================================
--  Fallas que encontraron los redactores al recorrer la app con cada rol:
--
--   1. DICTAMEN ATÓMICO. Al registrar un dictamen, la pantalla marcaba primero
--      como no vigente el anterior del mismo tipo y DESPUÉS insertaba el nuevo,
--      en dos llamadas separadas. Si el nuevo fallaba (p. ej. «Solo mercado
--      nacional» sobre un pallet apartado para exportación), el anterior ya
--      había quedado no vigente: un pallet bloqueado quedaba libre sin que
--      nadie lo liberara. Ahora todo pasa en una sola función de la base
--      (dictamen_registrar), en una transacción: o se hace todo o nada.
--      De paso: Operaciones podía abrir el formulario (así lo dice la guía)
--      pero la política de la tabla solo dejaba escribir a Gerencia y Calidad.
--      La política se alinea con la pantalla.
--
--   2. CLAVES EN PANTALLA. «RESERVA EN_PREPARACION» en la traza del lote y
--      «Dictamen de producto_terminado: espera_resultados» en el historial.
--      etiqueta_estado() es el diccionario del lado de la base (el de la
--      pantalla está en src/lib/etiquetas.ts y dice lo mismo).
--
--   3. «SISTEMA» EN LA AUDITORÍA. Investigado: dentro de una petición del
--      usuario auth.uid() SÍ llega a los disparadores y a las funciones
--      SECURITY DEFINER (se probó: las filas de la aplicación tienen usuario).
--      Las filas sin usuario vienen de dos sitios sin sesión: las tareas
--      programadas de cada mañana (pg_cron: vencer reservas, estado de
--      facturas, alertas) y los scripts de mantenimiento y pruebas que se
--      conectan por la API de administración. No hay usuario que poner, pero
--      sí se puede decir CUÁL de los dos fue: columna «origen» en auditoria y
--      en eventos, que se llena sola (origen_actual()).
--
--   4. LAS REGLAS LEEN SU PARÁMETRO. «Margen mínimo aceptable» (8 %) y
--      «Alerta de anticuamiento» (12 meses) se podían cambiar en Parámetros,
--      pero las reglas seguían con su número fijo en la condición. Ahora la
--      condición puede nombrar un parámetro (condicion->>'parametro') y el
--      umbral sale de ahí: un solo número, en un solo sitio.
--
--   5. PARÁMETROS: nombres distintos para los dos «Aviso previo al
--      vencimiento», y los marcados «comercial» (que no entra a
--      Configuración) pasan a «operaciones»: los cambian Gerencia y
--      Operaciones, que es lo que la pantalla ya permitía en la base.
--
--  Re-ejecutable.
-- ============================================================================


-- ============================================================================
--  1. EL DICCIONARIO DE LA BASE
-- ============================================================================
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
    when 'dia'                  then 'Día'
    when 'critica'              then 'Crítica'
    else upper(left(replace(coalesce(p, ''), '_', ' '), 1)) || substr(replace(coalesce(p, ''), '_', ' '), 2)
  end;
$$;
comment on function etiqueta_estado is
  'Clave interna → texto para el usuario, con tildes. El mismo diccionario que src/lib/etiquetas.ts.';


-- ============================================================================
--  2. EL DICTAMEN, EN UNA SOLA TRANSACCIÓN
-- ============================================================================
drop policy if exists escritura_dictamenes on dictamenes_calidad;
create policy escritura_dictamenes on dictamenes_calidad
  for all using (puede('gerencia', 'operaciones', 'calidad'))
  with check (puede('gerencia', 'operaciones', 'calidad'));

create or replace function dictamen_registrar(
  p_lote_id       bigint,
  p_tipo          tipo_dictamen,
  p_estado        estado_dictamen,
  p_motivo_id     bigint default null,
  p_motivo_texto  text   default null,
  p_sustento_url  text   default null,
  p_observaciones text   default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_pallet     text;
  v_motivo     motivos%rowtype;
  v_condiciona boolean := false;
  v_bloquea    boolean := p_estado <> 'liberado';
  v_id         bigint;
  v_texto      text := nullif(trim(coalesce(p_motivo_texto, '')), '');
  v_razon      text;
  v_sigue      boolean;
begin
  if auth.uid() is null or not puede('gerencia', 'operaciones', 'calidad') then
    raise exception 'Solo Calidad, Operaciones y Gerencia emiten dictámenes de calidad. Pídale a Calidad que lo registre.'
      using errcode = 'insufficient_privilege';
  end if;

  --  El pallet se bloquea mientras dura esto: dos dictámenes a la vez sobre
  --  el mismo pallet no pueden dejar dos vigentes del mismo tipo.
  select codigo_pallet into v_pallet from lotes where id = p_lote_id for update;
  if not found then raise exception 'Ese pallet ya no existe.'; end if;

  if p_motivo_id is not null then
    select * into v_motivo from motivos where id = p_motivo_id;
    if not found then raise exception 'Elija un motivo de la lista.'; end if;
    v_condiciona := coalesce(v_motivo.condiciona_venta, false);
  end if;

  if v_bloquea and p_motivo_id is null and v_texto is null then
    raise exception 'Un dictamen «%» necesita motivo: quien lo vea después tiene que saber por qué.',
      lower(etiqueta_estado(p_estado::text));
  end if;

  --  El anterior del mismo tipo deja de estar vigente, pero se conserva. Si
  --  el nuevo libera, se anota en el viejo quién y cuándo lo levantó.
  update dictamenes_calidad
     set vigente      = false,
         liberado_por = case when p_estado = 'liberado' then auth.uid() else liberado_por end,
         liberado_en  = case when p_estado = 'liberado' then now() else liberado_en end
   where lote_id = p_lote_id and tipo = p_tipo and vigente;

  --  Si este insert falla (el disparador de «Solo mercado nacional», por
  --  ejemplo), el update de arriba se deshace con él: el anterior sigue
  --  vigente y el pallet sigue como estaba.
  insert into dictamenes_calidad (lote_id, tipo, estado, motivo_id, motivo_texto, sustento_url,
                                  observaciones, emitido_por, vigente, liberado_por, liberado_en)
  values (p_lote_id, p_tipo, p_estado, p_motivo_id, v_texto,
          nullif(trim(coalesce(p_sustento_url, '')), ''), nullif(trim(coalesce(p_observaciones, '')), ''),
          auth.uid(), true,
          case when p_estado = 'liberado' then auth.uid() end,
          case when p_estado = 'liberado' then now() end)
  returning id into v_id;

  v_razon := concat_ws(' · ', v_motivo.nombre, v_texto);
  v_sigue := lote_bloqueado(p_lote_id);

  perform registrar_evento('lotes', p_lote_id,
    case when not v_bloquea then 'lote_liberado'
         when v_condiciona then 'lote_condicionado'
         else 'lote_bloqueado' end,
    format('Dictamen de %s para %s: %s%s',
           lower(etiqueta_estado(p_tipo::text)), v_pallet, lower(etiqueta_estado(p_estado::text)),
           case when v_razon <> '' then ' · ' || v_razon else '' end),
    (case when p_estado = 'inmovilizado' then 'critica'
          when v_bloquea and not v_condiciona then 'advertencia'
          else 'info' end)::severidad_alerta,
    jsonb_build_object('pallet', v_pallet, 'tipo', p_tipo, 'estado', p_estado, 'dictamen_id', v_id));

  return jsonb_build_object(
    'id', v_id,
    'pallet', v_pallet,
    'bloquea', v_bloquea,
    'condiciona', v_bloquea and v_condiciona,
    'sigue_bloqueado', v_sigue,
    'solo_nacional', lote_solo_nacional(p_lote_id));
end $$;
revoke all on function dictamen_registrar(bigint, tipo_dictamen, estado_dictamen, bigint, text, text, text) from public, anon;
grant execute on function dictamen_registrar(bigint, tipo_dictamen, estado_dictamen, bigint, text, text, text) to authenticated;


-- ============================================================================
--  3. LA TRAZA DEL LOTE, SIN CLAVES
--  Misma firma y mismas columnas que antes; solo cambian dos textos.
-- ============================================================================
create or replace function trazar_lote_adelante(p_lote_id bigint)
returns table(etapa text, documento text, fecha timestamptz, almacen text, cliente text, destino text,
              contenedor text, bultos integer, peso_kg numeric, referencia_tipo text, referencia_id bigint)
language sql stable security definer set search_path = public as $$
  -- Movimientos del Kardex: toda entrada y salida del lote
  select
    'Movimiento'::text,
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
$$;


-- ============================================================================
--  4. DE DÓNDE VINO UN CAMBIO SIN USUARIO
-- ============================================================================
--    usuario           una persona con sesión (auth.uid() presente)
--    tarea_programada  los trabajos de cada mañana (pg_cron)
--    servicio          una llamada con la llave de servicio (sin persona)
--    mantenimiento     scripts de mantenimiento, migraciones y pruebas
create or replace function origen_actual() returns text
language sql stable as $$
  select case
    when auth.uid() is not null then 'usuario'
    when coalesce(current_setting('application_name', true), '') = 'pg_cron' then 'tarea_programada'
    when coalesce(current_setting('request.jwt.claims', true), '') like '%"service_role"%' then 'servicio'
    else 'mantenimiento'
  end;
$$;

--  Sin valor por defecto al crearla (las filas viejas quedan en blanco: no se
--  sabe de dónde vinieron) y con él después, para las nuevas.
alter table auditoria add column if not exists origen text;
alter table auditoria alter column origen set default origen_actual();
alter table eventos   add column if not exists origen text;
alter table eventos   alter column origen set default origen_actual();

create or replace function nombre_origen(p_usuario text, p_origen text) returns text
language sql immutable as $$
  select coalesce(p_usuario, case p_origen
    when 'tarea_programada' then 'Tarea automática diaria'
    when 'servicio'         then 'Proceso del sistema'
    when 'mantenimiento'    then 'Mantenimiento técnico'
    else 'Sistema' end);
$$;

--  El historial de las fichas: misma firma y columnas; solo cambia el nombre
--  que se muestra cuando no hubo usuario.
create or replace function historial_entidad(p_entidad text, p_entidad_id bigint)
returns table(origen text, tipo text, descripcion text, severidad text, usuario text,
              ocurrido_en timestamptz, detalle jsonb)
language sql stable security definer set search_path = public as $$
  -- Eventos de negocio (lenguaje humano)
  select 'evento'::text, ev.tipo, ev.descripcion, ev.severidad::text,
         nombre_origen(u.nombre, ev.origen), ev.ocurrido_en, ev.metadatos
    from eventos ev
    left join usuarios u on u.id = ev.usuario_id
   where ev.entidad = p_entidad and ev.entidad_id = p_entidad_id

  union all

  -- Cambios de datos (qué campo cambió y de qué a qué). La pantalla traduce
  -- los nombres de campo con el diccionario de src/lib/etiquetas.ts.
  select 'auditoria'::text, au.accion,
         case
           when au.accion = 'INSERT' then 'Registro creado'
           when au.accion = 'DELETE' then 'Registro eliminado'
           else 'Modificado: ' || array_to_string(au.campos_cambiados, ', ')
         end,
         'info'::text,
         nombre_origen(u.nombre, au.origen), au.ocurrido_en,
         jsonb_build_object('antes', au.datos_antes, 'despues', au.datos_despues,
                            'campos', to_jsonb(au.campos_cambiados))
    from auditoria au
    left join usuarios u on u.id = au.usuario_id
   where au.tabla = p_entidad and au.registro_id = p_entidad_id::text

  order by 6 desc
  limit 200;
$$;


-- ============================================================================
--  5. PARÁMETROS: NOMBRES CLAROS Y QUIÉN LOS CAMBIA
-- ============================================================================
update parametros
   set etiqueta = 'Aviso previo al vencimiento de la reserva',
       descripcion = 'Con cuántos días de anticipación se avisa que una RESERVA está por vencer (y soltarse sola). Es el umbral de la regla «Reserva próxima a vencer».'
 where clave = 'reserva_aviso_previo_dias';

update parametros
   set etiqueta = 'Aviso previo al vencimiento del producto',
       descripcion = 'Con cuántos días de antelación se marca un pallet como «por vencer» (fin de su vida útil) y se avisa a Comercial. En un producto de dos años de vida, avisar con un mes no da tiempo a vender un contenedor.'
 where clave = 'vencimiento_aviso_dias';

update parametros
   set descripcion = 'Por debajo de este margen el pedido se marca como «margen bajo» y requiere revisión. Es el umbral de la regla «Pedido con margen bajo».'
 where clave = 'margen_minimo_alerta';

update parametros
   set descripcion = 'A partir de cuántos meses en cámara el sistema empieza a avisar. Es el umbral de la regla «Producto con anticuamiento». Hoy Oliver lo controla a mano a los 12 meses.'
 where clave = 'anticuamiento_alerta_meses';

update parametros
   set descripcion = 'Meses que el producto se considera apto desde su fecha de producción. La pota maneja 2 años. Es también el umbral de la regla «Producto que superó la vida útil».'
 where clave = 'vida_util_meses';

--  «comercial» no entra a Configuración: los cambian Gerencia y Operaciones.
update parametros set editable_por = 'operaciones' where editable_por = 'comercial';


-- ============================================================================
--  6. LAS REGLAS LEEN SU UMBRAL DEL PARÁMETRO
-- ============================================================================
--  Si la condición nombra un parámetro, el umbral es ese parámetro; si no, el
--  número de la propia condición. «valor» se conserva como respaldo.
create or replace function regla_umbral(p_condicion jsonb) returns numeric
language sql stable as $$
  select case
    when coalesce(p_condicion->>'parametro', '') <> ''
     and exists (select 1 from parametros where clave = p_condicion->>'parametro')
      then param_num(p_condicion->>'parametro', nullif(p_condicion->>'valor', '')::numeric)
    else nullif(p_condicion->>'valor', '')::numeric
  end;
$$;

update reglas set condicion = condicion || '{"parametro": "anticuamiento_alerta_meses"}'::jsonb,
                  nombre = 'Producto con anticuamiento',
                  descripcion = 'El caso que Oliver controla hoy a mano: avisar cuando un lote lleva en cámara los meses del parámetro «Alerta de anticuamiento».'
 where condicion->>'campo' = 'meses_almacenado' and entidad = 'lote' and nombre = 'Producto con más de 12 meses en cámara';
update reglas set condicion = condicion || '{"parametro": "vida_util_meses"}'::jsonb,
                  descripcion = 'Producto que pasó su vida útil (parámetro «Vida útil del producto») y ya no es comercializable.'
 where condicion->>'campo' = 'meses_almacenado' and entidad = 'lote' and nombre = 'Producto que superó la vida útil';
update reglas set condicion = condicion || '{"parametro": "reserva_aviso_previo_dias"}'::jsonb,
                  descripcion = 'Avisa antes de que una reserva se caiga sola y libere el producto, con la anticipación del parámetro «Aviso previo al vencimiento de la reserva».'
 where condicion->>'campo' = 'dias_para_vencer' and entidad = 'reserva';
update reglas set condicion = condicion || '{"parametro": "margen_minimo_alerta"}'::jsonb,
                  descripcion = 'Venta por debajo del parámetro «Margen mínimo aceptable» que define Gerencia.'
 where condicion->>'campo' = 'margen_pct' and entidad = 'pedido';

-- ============================================================================
--  6b. EL EVALUADOR, CON EL UMBRAL DE regla_umbral() (resto igual que 070b)
-- ============================================================================
create or replace function reglas_evaluar(p_regla_id bigint default null)
returns table (regla_id bigint, medible boolean, abiertas int, nuevas int, cerradas int)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  r        reglas%rowtype;
  v_hoy    date := (now() at time zone 'America/Lima')::date;
  v_clave  text;
  v_umbral numeric;
  v_op     text;
  v_medible boolean;
  v_nuevas int;
  v_cerradas int;
  v_abiertas int;
begin
  if auth.uid() is not null and not puede('gerencia', 'operaciones') then
    raise exception 'Solo Gerencia y Operaciones pueden evaluar las reglas.' using errcode = 'insufficient_privilege';
  end if;

  create temp table if not exists _regla_cand (
    entidad_id bigint primary key, valor numeric, datos jsonb
  ) on commit drop;

  /*
   * Al tocar una regla se evalúan también las que miden lo mismo (misma
   * entidad y campo): apagar «vida útil» hace que «12 meses» recupere esos
   * pallets, y encenderla hace que los suelte.
   */
  for r in
    select x.* from reglas x
     where p_regla_id is null
        or x.id = p_regla_id
        or exists (select 1 from reglas y
                    where y.id = p_regla_id and y.entidad = x.entidad
                      and y.condicion->>'campo' = x.condicion->>'campo')
     order by x.id
  loop
    truncate _regla_cand;
    v_clave  := r.entidad || ':' || coalesce(r.condicion->>'campo', '');
    v_umbral := regla_umbral(r.condicion);   -- 077: del parámetro, si lo nombra
    v_op     := r.condicion->>'operador';
    v_medible := true;

    if r.activa then
      if v_clave = 'lote:meses_almacenado' then
        insert into _regla_cand
        select a.lote_id, max(a.meses_almacenado),
               jsonb_build_object('codigo_pallet', min(a.codigo_pallet),
                                  'meses_almacenado', to_char(max(a.meses_almacenado), 'FM990D0'))
          from v_anticuamiento a
         where a.fisico_kg > 0
         group by a.lote_id;

      elsif v_clave = 'reserva:dias_para_vencer' then
        insert into _regla_cand
        select rs.id, ((rs.vence_el at time zone 'America/Lima')::date - v_hoy),
               jsonb_build_object('numero_proforma', pe.numero_proforma,
                                  'dias_para_vencer', ((rs.vence_el at time zone 'America/Lima')::date - v_hoy))
          from reservas rs
          join pedido_lineas pl on pl.id = rs.pedido_linea_id
          join pedidos pe on pe.id = pl.pedido_id
         where rs.estado in ('solicitada', 'activa', 'en_preparacion')
           and rs.vence_el is not null;

      elsif v_clave = 'pedido:dias_sin_movimiento' then
        insert into _regla_cand
        select pe.id, (v_hoy - (greatest(pe.actualizado_en, pe.creado_en, ev.ultimo) at time zone 'America/Lima')::date),
               jsonb_build_object('numero_proforma', pe.numero_proforma,
                                  'dias_sin_movimiento', (v_hoy - (greatest(pe.actualizado_en, pe.creado_en, ev.ultimo) at time zone 'America/Lima')::date))
          from pedidos pe
          left join lateral (
            select max(e.ocurrido_en) as ultimo from eventos e
             where e.entidad = 'pedidos' and e.entidad_id = pe.id
          ) ev on true
         where pe.ciclo = 'confirmado';

      elsif v_clave = 'pedido:margen_pct' then
        insert into _regla_cand
        select rp.pedido_id, rp.margen_pct,
               jsonb_build_object('numero_proforma', rp.numero_proforma,
                                  'margen_pct', to_char(rp.margen_pct, 'FM990D0'))
          from v_rentabilidad_pedido rp
         where rp.ciclo in ('pendiente_validacion', 'confirmado')
           and rp.margen_pct is not null
           and coalesce(rp.costo_estimado, 0) > 0;

      elsif v_clave = 'factura:dias_vencida' then
        insert into _regla_cand
        select cc.id, cc.dias_vencida,
               jsonb_build_object('numero', cc.numero, 'dias_vencida', cc.dias_vencida, 'cliente', cc.cliente)
          from v_cuentas_cobrar cc
         where cc.saldo > 0.01;

      elsif v_clave = 'traslado:dias_en_transito' then
        insert into _regla_cand
        select t.id, (v_hoy - (coalesce(t.despachado_en, t.creado_en) at time zone 'America/Lima')::date),
               jsonb_build_object('numero', t.numero,
                                  'dias_en_transito', (v_hoy - (coalesce(t.despachado_en, t.creado_en) at time zone 'America/Lima')::date))
          from traslados t
         where t.estado = 'en_transito';

      else
        v_medible := false;
      end if;

      delete from _regla_cand c where not regla_cumple(c.valor, v_op, v_umbral);

      /* La regla más grave gana: fuera lo que ya cubre otra activa, sobre lo
         mismo, de mayor severidad (o igual severidad y umbral más exigente). */
      delete from _regla_cand c
       where exists (
         select 1 from reglas o
          where o.id <> r.id and o.activa
            and o.entidad = r.entidad
            and o.condicion->>'campo' = r.condicion->>'campo'
            and (regla_rango(o.severidad) > regla_rango(r.severidad)
                 or (regla_rango(o.severidad) = regla_rango(r.severidad) and o.id < r.id))
            and regla_cumple(c.valor, o.condicion->>'operador', regla_umbral(o.condicion))
       );
    end if;

    update alertas a
       set atendida = true,
           atendida_en = now(),
           datos = coalesce(a.datos, '{}'::jsonb)
                   || jsonb_build_object('cerrada_por', case when r.activa then 'condicion_resuelta' else 'regla_desactivada' end)
     where a.regla_id = r.id and not a.atendida
       and (not r.activa or not v_medible
            or not exists (select 1 from _regla_cand c where c.entidad_id = a.entidad_id));
    get diagnostics v_cerradas = row_count;

    update alertas a
       set mensaje = regla_mensaje(r.mensaje, c.datos),
           titulo = r.nombre,
           severidad = r.severidad,
           entidad = r.entidad,
           datos = c.datos
      from _regla_cand c
     where a.regla_id = r.id and not a.atendida and a.entidad_id = c.entidad_id;

    insert into alertas (regla_id, entidad, entidad_id, severidad, titulo, mensaje, datos)
    select r.id, r.entidad, c.entidad_id, r.severidad, r.nombre, regla_mensaje(r.mensaje, c.datos), c.datos
      from _regla_cand c
     where not exists (
       select 1 from alertas a
        where a.regla_id = r.id and a.entidad_id = c.entidad_id
          and (not a.atendida or a.atendida_por is not null)
     );
    get diagnostics v_nuevas = row_count;

    select count(*) into v_abiertas from alertas a where a.regla_id = r.id and not a.atendida;

    insert into reglas_evaluacion as re (regla_id, evaluada_en, abiertas, nuevas, cerradas, medible)
    values (r.id, now(), v_abiertas, v_nuevas, v_cerradas, v_medible)
    on conflict on constraint reglas_evaluacion_pkey do update
      set evaluada_en = excluded.evaluada_en, abiertas = excluded.abiertas,
          nuevas = excluded.nuevas, cerradas = excluded.cerradas, medible = excluded.medible;

    regla_id := r.id; medible := v_medible; abiertas := v_abiertas; nuevas := v_nuevas; cerradas := v_cerradas;
    return next;
  end loop;
end $$;
revoke all on function reglas_evaluar(bigint) from public, anon;
grant execute on function reglas_evaluar(bigint) to authenticated;


-- ============================================================================
--  7. PRIMERA PASADA (lo mismo que hace la tarea de cada mañana): las
--     alertas abiertas toman el nombre nuevo de la regla.
-- ============================================================================
select count(*) from reglas_evaluar(null);
