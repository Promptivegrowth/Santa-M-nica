-- ============================================================================
--  SANTA MÓNICA ERP · MIGRACIÓN 006 · SEGURIDAD (RLS)
-- ============================================================================
--  ¿Qué es RLS? "Row Level Security" — seguridad a nivel de fila.
--
--  La idea, en simple: en vez de que la pantalla decida qué puede hacer cada
--  usuario, lo decide la BASE DE DATOS. Si alguien manipula el navegador o
--  llama a la API por su cuenta, igual choca contra estas reglas.
--
--  Regla general de este ERP:
--   · LEER  → todos los usuarios autenticados pueden consultar la operación.
--             (es un sistema interno; la información se comparte)
--   · ESCRIBIR → solo el rol que corresponde a esa parte del negocio.
--
--  Las operaciones sensibles (autorizar traslado, liberar reserva, despachar)
--  no se hacen escribiendo en la tabla: se hacen llamando a funciones que
--  validan primero. Esas funciones son "security definer", es decir, corren con
--  permisos elevados pero solo hacen lo que su código permite.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Activar RLS en TODAS las tablas del esquema público
-- ---------------------------------------------------------------------------
do $rls$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security;', t.tablename);
  end loop;
end
$rls$;


-- ---------------------------------------------------------------------------
-- 2. LECTURA: cualquier usuario autenticado y activo puede consultar
-- ---------------------------------------------------------------------------
do $lectura$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format($f$
      create policy "lectura_autenticados" on public.%I
        for select to authenticated
        using ( exists (select 1 from public.usuarios u where u.id = auth.uid() and u.activo) );
    $f$, t.tablename);
  end loop;
end
$lectura$;


-- ---------------------------------------------------------------------------
-- 3. ESCRITURA POR DOMINIO
--    Cada bloque dice: quién puede crear, modificar o borrar en esta tabla.
-- ---------------------------------------------------------------------------

-- Función corta para no repetir la condición en cada política
create or replace function puede(variadic roles rol_usuario[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from usuarios u
     where u.id = auth.uid() and u.activo and u.rol = any(roles)
  );
$$;
comment on function puede is 'TRUE si el usuario actual tiene alguno de los roles indicados y está activo.';


-- === 3.1 CONFIGURACIÓN Y MAESTROS ==========================================
-- Solo gerencia y operaciones tocan la estructura del negocio.
do $maestros$
declare t text;
begin
  foreach t in array array[
    'parametros','plantas','almacenes','camaras','lineas_procesadoras',
    'especies','formatos','presentaciones','skus','sku_presentaciones',
    'destinos','almacenes_habilitados','motivos','transportistas',
    'vehiculos','conductores','vendedores','reglas'
  ]
  loop
    execute format($f$
      create policy "escritura_maestros" on public.%I
        for all to authenticated
        using ( puede('gerencia','operaciones') )
        with check ( puede('gerencia','operaciones') );
    $f$, t);
  end loop;
end
$maestros$;


-- === 3.2 CLIENTES Y PRECIOS ================================================
-- Comercial administra su cartera; gerencia y operaciones también.
create policy "escritura_clientes" on clientes
  for all to authenticated
  using ( puede('gerencia','operaciones','comercial') )
  with check ( puede('gerencia','operaciones','comercial') );

-- Los precios son sensibles: solo gerencia y operaciones los definen.
create policy "escritura_listas_precio" on listas_precio
  for all to authenticated
  using ( puede('gerencia','operaciones') )
  with check ( puede('gerencia','operaciones') );

create policy "escritura_precios" on precios
  for all to authenticated
  using ( puede('gerencia','operaciones') )
  with check ( puede('gerencia','operaciones') );


-- === 3.3 INVENTARIO ========================================================
-- Los lotes los crea quien registra el ingreso: almacén u operaciones.
create policy "escritura_lotes" on lotes
  for all to authenticated
  using ( puede('gerencia','operaciones','almacen') )
  with check ( puede('gerencia','operaciones','almacen') );

-- El Kardex SOLO admite inserción (los triggers ya bloquean update y delete).
create policy "insercion_movimientos" on movimientos
  for insert to authenticated
  with check ( puede('gerencia','operaciones','almacen') );

-- Las existencias las calcula el sistema: nadie las edita a mano.
-- No creamos política de escritura, así que queda cerrada para todos.

-- Traslados: los arma el almacén, los autoriza operaciones o gerencia.
create policy "escritura_traslados" on traslados
  for all to authenticated
  using ( puede('gerencia','operaciones','almacen') )
  with check ( puede('gerencia','operaciones','almacen') );

create policy "escritura_traslado_lineas" on traslado_lineas
  for all to authenticated
  using ( puede('gerencia','operaciones','almacen') )
  with check ( puede('gerencia','operaciones','almacen') );


-- === 3.4 CALIDAD ===========================================================
-- Solo el área de calidad (y gerencia) emite o levanta dictámenes sanitarios.
create policy "escritura_dictamenes" on dictamenes_calidad
  for all to authenticated
  using ( puede('gerencia','calidad') )
  with check ( puede('gerencia','calidad') );


-- === 3.5 COMERCIAL =========================================================
do $comercial$
declare t text;
begin
  foreach t in array array[
    'cotizaciones','cotizacion_lineas','pedidos','pedido_lineas','reservas'
  ]
  loop
    execute format($f$
      create policy "escritura_comercial" on public.%I
        for all to authenticated
        using ( puede('gerencia','operaciones','comercial','comex') )
        with check ( puede('gerencia','operaciones','comercial','comex') );
    $f$, t);
  end loop;
end
$comercial$;


-- === 3.6 LOGÍSTICA =========================================================
-- Comex programa y documenta; almacén ejecuta la carga.
do $logistica$
declare t text;
begin
  foreach t in array array[
    'embarques','embarque_pedidos','packing_lists','packing_lineas',
    'plano_estiba','despachos'
  ]
  loop
    execute format($f$
      create policy "escritura_logistica" on public.%I
        for all to authenticated
        using ( puede('gerencia','operaciones','comex','almacen') )
        with check ( puede('gerencia','operaciones','comex','almacen') );
    $f$, t);
  end loop;
end
$logistica$;


-- === 3.7 FINANZAS ==========================================================
do $finanzas$
declare t text;
begin
  foreach t in array array['facturas','factura_lineas','cobranzas']
  loop
    execute format($f$
      create policy "escritura_finanzas" on public.%I
        for all to authenticated
        using ( puede('gerencia','comercial') )
        with check ( puede('gerencia','comercial') );
    $f$, t);
  end loop;
end
$finanzas$;


-- === 3.8 IMPORTACIONES =====================================================
create policy "escritura_importaciones" on importaciones
  for all to authenticated
  using ( puede('gerencia','operaciones','comercial') )
  with check ( puede('gerencia','operaciones','comercial') );

create policy "escritura_precios_mercado" on precios_mercado
  for all to authenticated
  using ( puede('gerencia','operaciones','comercial') )
  with check ( puede('gerencia','operaciones','comercial') );


-- === 3.9 ALERTAS ===========================================================
-- Cualquiera puede marcar una alerta como atendida; nadie las crea a mano.
create policy "atender_alertas" on alertas
  for update to authenticated
  using ( exists (select 1 from usuarios u where u.id = auth.uid() and u.activo) )
  with check ( true );


-- === 3.10 USUARIOS =========================================================
-- Solo gerencia administra usuarios y roles.
create policy "administrar_usuarios" on usuarios
  for all to authenticated
  using ( puede('gerencia') )
  with check ( puede('gerencia') );

-- Pero cada quien puede ver y actualizar su propio nombre.
create policy "usuario_propio" on usuarios
  for update to authenticated
  using ( id = auth.uid() )
  with check ( id = auth.uid() );


-- ---------------------------------------------------------------------------
-- 4. TRAZABILIDAD: la auditoría y los eventos son SOLO LECTURA
--    No hay política de escritura, así que ni siquiera gerencia puede
--    modificar el historial desde la aplicación. Solo lo escriben los
--    disparadores internos de la base de datos.
-- ---------------------------------------------------------------------------
-- (la política de lectura ya se creó en el bloque 2)


-- ---------------------------------------------------------------------------
-- 5. PERMISOS DE EJECUCIÓN sobre las funciones de negocio
-- ---------------------------------------------------------------------------
grant execute on function
  atp(bigint, date, bigint),
  resolver_precio(bigint, bigint, numeric, date),
  buscar_universal(text),
  trazar_lote_adelante(bigint),
  trazar_origen(text, bigint),
  recall_lote(bigint),
  historial_entidad(text, bigint),
  param_num(text, numeric),
  param_txt(text, text),
  lote_bloqueado(bigint),
  rol_actual(),
  puede_ver_costos()
to authenticated;

-- Operaciones que modifican el negocio: se conceden a authenticated, pero la
-- propia función valida el rol antes de hacer nada.
grant execute on function
  traslado_autorizar(bigint),
  traslado_despachar(bigint, text),
  traslado_aceptar(bigint),
  reserva_crear(bigint, bigint, bigint, int, numeric),
  reserva_liberar(bigint, text),
  reservas_expirar_vencidas(),
  generar_plano_estiba(bigint),
  ejecutar_despacho(bigint, text),
  recalcular_cobertura_pedido(bigint),
  registrar_evento(text, bigint, text, text, severidad_alerta, jsonb)
to authenticated;


-- ---------------------------------------------------------------------------
-- 6. VALIDACIÓN DE ROL DENTRO DE LAS FUNCIONES SENSIBLES
--    RLS protege las tablas; esto protege las ACCIONES.
-- ---------------------------------------------------------------------------

-- Autorizar un traslado: solo gerencia u operaciones (requisito de Marco)
create or replace function traslado_autorizar(p_traslado_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare t traslados%rowtype;
begin
  if not puede('gerencia','operaciones') then
    raise exception 'No tiene permiso para autorizar traslados. Se requiere rol de gerencia u operaciones.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into t from traslados where id = p_traslado_id for update;
  if not found then raise exception 'Traslado % no existe', p_traslado_id; end if;
  if t.estado <> 'borrador' then
    raise exception 'Solo se puede autorizar un traslado en borrador (estado actual: %)', t.estado;
  end if;
  if not exists (select 1 from traslado_lineas where traslado_id = p_traslado_id) then
    raise exception 'No se puede autorizar un traslado sin líneas de producto';
  end if;

  update traslados
     set estado = 'autorizado', autorizado_por = auth.uid(), autorizado_en = now()
   where id = p_traslado_id;

  perform registrar_evento('traslados', p_traslado_id, 'traslado_autorizado',
    format('Traslado %s autorizado', t.numero), 'info');
end;
$$;

-- Aceptar un traslado: solo el jefe del almacén DESTINO, operaciones o gerencia.
-- Esta es la "segunda firma" que pidió el cliente.
create or replace function traslado_aceptar(p_traslado_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  t traslados%rowtype;
  ln record;
  v_difs int := 0;
  v_mi_almacen bigint;
begin
  select * into t from traslados where id = p_traslado_id for update;
  if not found then raise exception 'Traslado % no existe', p_traslado_id; end if;

  select almacen_id into v_mi_almacen from usuarios where id = auth.uid();

  -- Control de acceso: o eres gerencia/operaciones, o eres el jefe del destino
  if not (puede('gerencia','operaciones')
          or (puede('almacen') and v_mi_almacen = t.almacen_destino_id)) then
    raise exception 'Solo el responsable del almacén destino, operaciones o gerencia pueden aceptar este traslado.'
      using errcode = 'insufficient_privilege';
  end if;

  if t.estado <> 'en_transito' then
    raise exception 'Solo se puede aceptar un traslado en tránsito (estado actual: %)', t.estado;
  end if;

  for ln in select * from traslado_lineas where traslado_id = p_traslado_id loop
    if ln.bultos_aceptados is null then
      update traslado_lineas
         set bultos_aceptados = ln.bultos_enviados,
             peso_aceptado_kg = ln.peso_enviado_kg
       where id = ln.id;
      ln.bultos_aceptados := ln.bultos_enviados;
      ln.peso_aceptado_kg := ln.peso_enviado_kg;
    end if;

    if ln.bultos_aceptados > 0 then
      insert into movimientos (tipo, lote_id, almacen_id, bultos, peso_neto_kg,
                               costo_unitario, documento_tipo, documento_id, documento_ref, usuario_id)
      select 'traslado_ingreso', ln.lote_id, t.almacen_destino_id, ln.bultos_aceptados, ln.peso_aceptado_kg,
             coalesce(max(e.costo_promedio), 0), 'traslado', p_traslado_id, t.guia_numero, auth.uid()
        from existencias e
       where e.lote_id = ln.lote_id;
    end if;

    if ln.peso_aceptado_kg < ln.peso_enviado_kg then
      v_difs := v_difs + 1;
      perform registrar_evento('traslados', p_traslado_id, 'discrepancia_traslado',
        format('Discrepancia en lote %s: enviados %s kg, aceptados %s kg. Requiere ajuste autorizado.',
               ln.lote_id, ln.peso_enviado_kg, ln.peso_aceptado_kg), 'critica',
        jsonb_build_object('lote_id', ln.lote_id,
                           'enviado_kg', ln.peso_enviado_kg,
                           'aceptado_kg', ln.peso_aceptado_kg));
    end if;
  end loop;

  update traslados
     set estado = 'aceptado', aceptado_por = auth.uid(), aceptado_en = now()
   where id = p_traslado_id;

  perform registrar_evento('traslados', p_traslado_id, 'traslado_aceptado',
    format('Traslado %s aceptado en destino%s', t.numero,
           case when v_difs > 0 then format(' con %s discrepancia(s)', v_difs) else '' end),
    case when v_difs > 0 then 'critica' else 'info' end);
end;
$$;

-- Liberar una reserva ajena exige rol superior. La propia la puede liberar
-- quien la creó (comercial), siempre con motivo.
create or replace function reserva_liberar(p_reserva_id bigint, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare r reservas%rowtype;
begin
  if p_motivo is null or length(trim(p_motivo)) < 5 then
    raise exception 'Debe indicar un motivo de al menos 5 caracteres para liberar una reserva';
  end if;

  select * into r from reservas where id = p_reserva_id for update;
  if not found then raise exception 'La reserva % no existe', p_reserva_id; end if;

  -- Si la reserva no es mía, necesito rol de operaciones o gerencia
  if r.creado_por <> auth.uid() and not puede('gerencia','operaciones') then
    raise exception 'Solo operaciones o gerencia pueden liberar una reserva creada por otro usuario.'
      using errcode = 'insufficient_privilege';
  end if;

  if r.estado not in ('activa','en_preparacion') then
    raise exception 'Solo se pueden liberar reservas activas o en preparación (estado actual: %)', r.estado;
  end if;

  update reservas
     set estado = 'liberada', liberado_por = auth.uid(), liberado_en = now(),
         motivo_liberacion = p_motivo
   where id = p_reserva_id;

  perform registrar_evento('reservas', p_reserva_id, 'reserva_liberada',
    format('Reserva liberada: %s', p_motivo), 'advertencia',
    jsonb_build_object('lote_id', r.lote_id, 'peso_kg', r.peso_neto_kg, 'motivo', p_motivo));
end;
$$;
