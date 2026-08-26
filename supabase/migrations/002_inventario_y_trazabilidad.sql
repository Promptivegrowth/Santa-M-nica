-- ============================================================================
--  SANTA MÓNICA ERP · MIGRACIÓN 002 · INVENTARIO Y TRAZABILIDAD
-- ============================================================================
--  Esta es la pieza central del sistema. Explicado en simple:
--
--  · Un LOTE es un paquete de producto que se fabricó un día concreto. Es la
--    unidad que se puede rastrear: si mañana hay un problema sanitario, se
--    persigue el lote.
--
--  · El KARDEX (tabla "movimientos") es el diario del almacén: cada entrada y
--    cada salida queda escrita, y NUNCA se borra ni se corrige. Si hubo un
--    error, se escribe un movimiento contrario. Igual que un libro contable.
--
--  · Las EXISTENCIAS son el saldo actual. No se editan a mano: se calculan
--    solas a partir del Kardex. Si algo no cuadra, se reconstruyen.
--
--  Por qué así: es lo único que permite responder "¿cuánto tengo?" y
--  "¿cómo llegué a tener eso?" con la misma certeza.
-- ============================================================================


-- ============================================================================
--  1. LOTES
-- ============================================================================
create table lotes (
  id                    bigserial primary key,
  -- Código del pallet tal como lo escribe el almacén (ej. "SM 26 02 001")
  codigo_pallet         text not null,
  -- Lote numérico que aparece en el plano de estiba (ej. 102405)
  codigo_lote           text,
  campania              int not null,
  sku_presentacion_id   bigint not null references sku_presentaciones(id),

  -- Origen productivo
  fecha_produccion      date not null,
  juliano               text,
  planta_id             bigint references plantas(id),
  linea_procesadora_id  bigint references lineas_procesadoras(id),
  turno                 turno_operativo not null default 'dia',
  proceso               tipo_proceso not null default 'propia',

  -- Cantidades con las que nació el lote
  bultos_iniciales      int not null check (bultos_iniciales > 0),
  peso_neto_inicial_kg  numeric(14,3) not null check (peso_neto_inicial_kg > 0),

  -- Costo unitario de producción (soles o dólares por kilo, según parámetro)
  costo_unitario        numeric(14,6) not null default 0 check (costo_unitario >= 0),

  observaciones         text,
  creado_en             timestamptz not null default now(),
  creado_por            uuid references usuarios(id),

  -- CLAVE ÚNICA REAL: el Excel repite el código de pallet entre campañas y
  -- bodegas. Aquí la identidad la forman código + campaña + fecha + producto.
  constraint lotes_identidad_unica
    unique (codigo_pallet, campania, fecha_produccion, sku_presentacion_id)
);
comment on table lotes is 'Unidad rastreable de producto. Todo el sistema apunta aquí para la trazabilidad.';

create index idx_lotes_skupres    on lotes(sku_presentacion_id);
create index idx_lotes_fprod      on lotes(fecha_produccion);
create index idx_lotes_campania   on lotes(campania);
create index idx_lotes_pallet     on lotes(codigo_pallet);
create index idx_lotes_codlote    on lotes(codigo_lote) where codigo_lote is not null;


-- ============================================================================
--  2. KARDEX · movimientos (SOLO INSERCIÓN)
-- ============================================================================
create table movimientos (
  id                bigserial primary key,
  fecha             timestamptz not null default now(),
  tipo              tipo_movimiento not null,
  lote_id           bigint not null references lotes(id),
  almacen_id        bigint not null references almacenes(id),
  camara_id         bigint references camaras(id),

  -- Cantidades SIEMPRE positivas; el signo lo define el tipo de movimiento.
  bultos            int not null check (bultos > 0),
  peso_neto_kg      numeric(14,3) not null check (peso_neto_kg > 0),
  costo_unitario    numeric(14,6) not null default 0 check (costo_unitario >= 0),

  motivo_id         bigint references motivos(id),
  -- Documento que respalda el movimiento (guía, packing list, ajuste…)
  documento_tipo    text,
  documento_id      bigint,
  documento_ref     text,

  -- Trazabilidad obligatoria: quién lo hizo y, si aplica, quién lo autorizó
  usuario_id        uuid not null references usuarios(id),
  autorizado_por    uuid references usuarios(id),
  observaciones     text,
  creado_en         timestamptz not null default now()
);
comment on table movimientos is 'KARDEX. Diario inmutable del almacén: se inserta, nunca se modifica ni se borra.';

create index idx_mov_lote      on movimientos(lote_id);
create index idx_mov_almacen   on movimientos(almacen_id);
create index idx_mov_fecha     on movimientos(fecha desc);
create index idx_mov_tipo      on movimientos(tipo);
create index idx_mov_documento on movimientos(documento_tipo, documento_id);

-- --- Signo de cada tipo de movimiento --------------------------------------
create or replace function signo_movimiento(t tipo_movimiento) returns int
language sql immutable as $$
  select case t
    when 'ingreso'           then  1
    when 'traslado_ingreso'  then  1
    when 'ajuste_positivo'   then  1
    when 'ingreso_reproceso' then  1
    else -1
  end;
$$;
comment on function signo_movimiento is 'Convierte el tipo de movimiento en +1 (entra) o -1 (sale).';

-- --- BLINDAJE: el Kardex no se puede modificar ni borrar --------------------
-- Esto es lo que hace la trazabilidad confiable: ni siquiera un error de
-- programación puede alterar el historial.
create or replace function bloquear_modificacion_kardex() returns trigger
language plpgsql as $$
begin
  raise exception
    'El Kardex es inmutable: no se permite % sobre movimientos. Para corregir, registre un movimiento inverso.',
    tg_op
    using errcode = 'check_violation';
end;
$$;

create trigger trg_kardex_no_update
  before update on movimientos
  for each row execute function bloquear_modificacion_kardex();

create trigger trg_kardex_no_delete
  before delete on movimientos
  for each row execute function bloquear_modificacion_kardex();


-- ============================================================================
--  3. EXISTENCIAS · el saldo vivo
--  Se calcula solo desde el Kardex. Nadie la edita a mano.
-- ============================================================================
create table existencias (
  lote_id          bigint not null references lotes(id) on delete cascade,
  almacen_id       bigint not null references almacenes(id),
  camara_id        bigint references camaras(id),
  bultos           int not null default 0,
  peso_neto_kg     numeric(14,3) not null default 0,
  costo_promedio   numeric(14,6) not null default 0,
  actualizado_en   timestamptz not null default now(),
  primary key (lote_id, almacen_id),
  -- El saldo nunca puede ser negativo: eso significaría que despachamos
  -- producto que no existe.
  constraint existencias_no_negativas check (bultos >= 0 and peso_neto_kg >= -0.001)
);
comment on table existencias is 'Saldo actual por lote y almacén. Proyección automática del Kardex.';

create index idx_exist_almacen on existencias(almacen_id);
create index idx_exist_con_saldo on existencias(almacen_id) where bultos > 0;

-- --- Proyección automática Kardex → Existencias -----------------------------
create or replace function proyectar_existencia() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s int := signo_movimiento(new.tipo);
  bultos_prev int;
  peso_prev numeric(14,3);
  costo_prev numeric(14,6);
begin
  -- Leemos el saldo anterior (si existe)
  select bultos, peso_neto_kg, costo_promedio
    into bultos_prev, peso_prev, costo_prev
    from existencias
   where lote_id = new.lote_id and almacen_id = new.almacen_id;

  if not found then
    bultos_prev := 0; peso_prev := 0; costo_prev := 0;
  end if;

  -- COSTO PROMEDIO MÓVIL: solo se recalcula cuando ENTRA producto.
  -- Fórmula: (valor que ya tenía + valor que entra) / (kilos totales)
  if s = 1 and (peso_prev + new.peso_neto_kg) > 0 then
    costo_prev := ( (peso_prev * costo_prev) + (new.peso_neto_kg * new.costo_unitario) )
                  / (peso_prev + new.peso_neto_kg);
  end if;

  insert into existencias as e (lote_id, almacen_id, camara_id, bultos, peso_neto_kg, costo_promedio, actualizado_en)
  values (new.lote_id, new.almacen_id, coalesce(new.camara_id, null),
          s * new.bultos, s * new.peso_neto_kg, costo_prev, now())
  on conflict (lote_id, almacen_id) do update
    set bultos         = e.bultos + (s * new.bultos),
        peso_neto_kg   = e.peso_neto_kg + (s * new.peso_neto_kg),
        camara_id      = coalesce(excluded.camara_id, e.camara_id),
        costo_promedio = costo_prev,
        actualizado_en = now();

  return new;
end;
$$;

create trigger trg_proyectar_existencia
  after insert on movimientos
  for each row execute function proyectar_existencia();


-- ============================================================================
--  4. CALIDAD · dictámenes y bloqueos
--  De la reunión: el producto está "liberado" u "observado", y observado puede
--  ser por motivo normativo, microbiológico, fisicoquímico u organoléptico.
--  Un lote bloqueado NO se puede vender.
-- ============================================================================
create table dictamenes_calidad (
  id             bigserial primary key,
  lote_id        bigint not null references lotes(id) on delete cascade,
  tipo           tipo_dictamen not null,
  estado         estado_dictamen not null default 'espera_resultados',
  motivo_id      bigint references motivos(id),
  motivo_texto   text,
  -- Sustento documental que pidió Oliver ("deberíamos tener un PDF")
  sustento_url   text,
  emitido_por    uuid references usuarios(id),
  emitido_en     timestamptz not null default now(),
  -- Liberación: quién y cuándo levantó la observación
  liberado_por   uuid references usuarios(id),
  liberado_en    timestamptz,
  vigente        boolean not null default true,
  observaciones  text,
  -- Si el dictamen observa o inmoviliza, exige explicación
  constraint dictamen_requiere_motivo
    check (estado = 'liberado' or motivo_id is not null or motivo_texto is not null)
);
comment on table dictamenes_calidad is 'Los cuatro dictámenes sanitarios por lote, con sustento y responsable.';

create index idx_dict_lote on dictamenes_calidad(lote_id);
create index idx_dict_vigente on dictamenes_calidad(lote_id) where vigente;

-- Un lote está bloqueado si tiene algún dictamen vigente que no sea 'liberado'
create or replace function lote_bloqueado(p_lote_id bigint) returns boolean
language sql stable as $$
  select exists (
    select 1 from dictamenes_calidad
     where lote_id = p_lote_id and vigente
       and estado in ('observado','inmovilizado','espera_resultados')
  );
$$;
comment on function lote_bloqueado is 'TRUE si el lote tiene alguna observación sanitaria abierta.';


-- ============================================================================
--  5. TRASLADOS ENTRE ALMACENES · la máquina de tres pasos
--  Requisito explícito de Marco: "cambias de centro, el otro centro tiene que
--  tener un doble paso: y el otro paso de aceptación".
-- ============================================================================
create table traslados (
  id                  bigserial primary key,
  numero              text not null unique,
  almacen_origen_id   bigint not null references almacenes(id),
  almacen_destino_id  bigint not null references almacenes(id),
  estado              estado_traslado not null default 'borrador',

  -- Documento de transporte
  guia_numero         text,
  transportista_id    bigint references transportistas(id),
  vehiculo_id         bigint references vehiculos(id),
  conductor_id        bigint references conductores(id),

  -- LAS TRES FIRMAS: es el corazón de la trazabilidad del traslado
  autorizado_por      uuid references usuarios(id),
  autorizado_en       timestamptz,
  despachado_por      uuid references usuarios(id),
  despachado_en       timestamptz,
  aceptado_por        uuid references usuarios(id),
  aceptado_en         timestamptz,

  fecha_programada    date,
  observaciones       text,
  creado_por          uuid not null references usuarios(id),
  creado_en           timestamptz not null default now(),

  -- No se traslada a la misma bodega de donde sale
  constraint traslado_bodegas_distintas
    check (almacen_origen_id <> almacen_destino_id)
);
comment on table traslados is 'Movimiento de producto entre bodegas con autorización, salida y aceptación separadas.';

create index idx_traslados_estado on traslados(estado);
create index idx_traslados_origen on traslados(almacen_origen_id);
create index idx_traslados_destino on traslados(almacen_destino_id);

create table traslado_lineas (
  id                bigserial primary key,
  traslado_id       bigint not null references traslados(id) on delete cascade,
  lote_id           bigint not null references lotes(id),
  bultos_enviados   int not null check (bultos_enviados > 0),
  peso_enviado_kg   numeric(14,3) not null check (peso_enviado_kg > 0),
  -- Lo que realmente llegó. Si difiere, hay discrepancia y se debe ajustar.
  bultos_aceptados  int check (bultos_aceptados >= 0),
  peso_aceptado_kg  numeric(14,3) check (peso_aceptado_kg >= 0),
  observacion       text,
  unique (traslado_id, lote_id)
);
comment on table traslado_lineas is 'Detalle del traslado. La diferencia entre enviado y aceptado es la discrepancia.';


-- ============================================================================
--  6. TRAZABILIDAD · auditoría y línea de tiempo
--  Dos tablas complementarias:
--   · auditoria → registro técnico: qué fila cambió y cómo (antes / después)
--   · eventos   → registro legible: "Oliver liberó la reserva del pedido X"
-- ============================================================================

create table auditoria (
  id            bigserial primary key,
  tabla         text not null,
  registro_id   text not null,
  accion        text not null check (accion in ('INSERT','UPDATE','DELETE')),
  datos_antes   jsonb,
  datos_despues jsonb,
  -- Solo las columnas que efectivamente cambiaron (facilita la lectura)
  campos_cambiados text[],
  usuario_id    uuid,
  ocurrido_en   timestamptz not null default now()
);
comment on table auditoria is 'Registro técnico de todo cambio en tablas críticas. Lo llena la base, no la aplicación.';

create index idx_audit_tabla    on auditoria(tabla, registro_id);
create index idx_audit_fecha    on auditoria(ocurrido_en desc);
create index idx_audit_usuario  on auditoria(usuario_id);

create table eventos (
  id            bigserial primary key,
  entidad       text not null,        -- 'pedido', 'lote', 'reserva', 'traslado'…
  entidad_id    bigint not null,
  tipo          text not null,        -- 'reserva_liberada', 'traslado_aceptado'…
  descripcion   text not null,        -- texto legible para el usuario
  severidad     severidad_alerta not null default 'info',
  metadatos     jsonb,
  usuario_id    uuid references usuarios(id),
  ocurrido_en   timestamptz not null default now()
);
comment on table eventos is 'Línea de tiempo del negocio, en lenguaje humano. Es lo que ve la pestaña Historial.';

create index idx_eventos_entidad on eventos(entidad, entidad_id, ocurrido_en desc);
create index idx_eventos_fecha   on eventos(ocurrido_en desc);

-- --- Función para registrar un evento desde cualquier parte del sistema -----
create or replace function registrar_evento(
  p_entidad text, p_entidad_id bigint, p_tipo text, p_descripcion text,
  p_severidad severidad_alerta default 'info', p_metadatos jsonb default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  insert into eventos (entidad, entidad_id, tipo, descripcion, severidad, metadatos, usuario_id)
  values (p_entidad, p_entidad_id, p_tipo, p_descripcion, p_severidad, p_metadatos, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- --- Disparador genérico de auditoría ---------------------------------------
-- Se engancha a cualquier tabla y registra automáticamente qué cambió.
create or replace function auditar_cambios() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_antes jsonb;
  v_despues jsonb;
  v_id text;
  v_campos text[];
begin
  if tg_op = 'DELETE' then
    v_antes := to_jsonb(old); v_despues := null; v_id := (to_jsonb(old)->>'id');
  elsif tg_op = 'INSERT' then
    v_antes := null; v_despues := to_jsonb(new); v_id := (to_jsonb(new)->>'id');
  else
    v_antes := to_jsonb(old); v_despues := to_jsonb(new); v_id := (to_jsonb(new)->>'id');
    -- Detecta qué columnas cambiaron realmente
    select array_agg(key) into v_campos
      from jsonb_each(v_despues)
     where v_antes -> key is distinct from v_despues -> key;
    -- Si nada cambió, no ensuciamos la auditoría
    if v_campos is null then return new; end if;
  end if;

  insert into auditoria (tabla, registro_id, accion, datos_antes, datos_despues, campos_cambiados, usuario_id)
  values (tg_table_name, coalesce(v_id,'?'), tg_op, v_antes, v_despues, v_campos, auth.uid());

  return coalesce(new, old);
end;
$$;
comment on function auditar_cambios is 'Disparador reutilizable: se engancha a toda tabla crítica y audita sola.';

-- Enganche de auditoría en las tablas de inventario ya creadas
create trigger audit_lotes      after insert or update or delete on lotes                for each row execute function auditar_cambios();
create trigger audit_dictamenes after insert or update or delete on dictamenes_calidad   for each row execute function auditar_cambios();
create trigger audit_traslados  after insert or update or delete on traslados            for each row execute function auditar_cambios();
create trigger audit_traslinea  after insert or update or delete on traslado_lineas      for each row execute function auditar_cambios();
create trigger audit_almacenes  after insert or update or delete on almacenes            for each row execute function auditar_cambios();
create trigger audit_skus       after insert or update or delete on skus                 for each row execute function auditar_cambios();
create trigger audit_clientes   after insert or update or delete on clientes             for each row execute function auditar_cambios();
create trigger audit_parametros after insert or update or delete on parametros           for each row execute function auditar_cambios();
create trigger audit_usuarios   after insert or update or delete on usuarios             for each row execute function auditar_cambios();
-- El Kardex no necesita auditoría de cambios porque es inmutable por diseño,
-- pero sí auditamos la inserción para saber quién registró cada movimiento.
create trigger audit_movimientos after insert on movimientos                             for each row execute function auditar_cambios();
