-- ============================================================================
--  090 · PORTAL DE CLIENTES: SEGUIMIENTO Y RECLAMOS  (COT-2026-11-253)
-- ============================================================================
--  Propuesta «Portal de Clientes: Seguimiento y Reclamos» sobre la
--  especificación BPMN v4 del 05/11/2026. Ocho módulos:
--
--   M1  Llave de seguimiento por proforma (única, aleatoria, cifrada, sin
--       caducidad) y registro de cada envío de accesos.
--   M2  Portal: cuenta de seguimiento, búsqueda con 3 datos, 5 fallos =
--       bloqueo de 1 minuto, límite por IP y por Código Cliente, CAPTCHA.
--   M3  Avance de la proforma y línea de tiempo por contenedor, leídos de
--       pedidos, embarques, packing y despachos. Hitos configurables.
--   M4  Reclamos con evidencia (bucket «reclamos») y correo verificado.
--   M5  Bandeja de Calidad: clasificación, plazo, causa, acciones, PDF.
--   M6  Plantillas de correo editables.
--   M7  Registro de envíos de proformas y cotizaciones.
--   M8  Separación estricta: el portal NO es un usuario de Supabase.
--
--  CÓMO SE SEPARA EL PORTAL DEL ERP
--  La cuenta de seguimiento no vive en auth.users: vive en portal_cuentas.
--  Quien entra al portal no recibe nunca un token de la base; el navegador
--  solo guarda una cookie opaca. El servidor de la aplicación habla con la
--  base como «anon» y solo puede llamar a las funciones portal_*, que exigen
--  además el secreto del servidor (privado.claves → PORTAL_SECRETO en Vercel).
--  El rol anon no tiene permiso sobre ninguna tabla ni vista (072), así que
--  aunque alguien copie la clave pública, no hay nada que leer.
--
--  Re-ejecutable.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  0. Esquema privado: claves que nunca salen de la base
-- ---------------------------------------------------------------------------
create schema if not exists privado;
revoke all on schema privado from public, anon, authenticated;

create table if not exists privado.claves (
  nombre    text primary key,
  valor     text not null,
  creado_en timestamptz not null default now()
);
revoke all on privado.claves from public, anon, authenticated;

insert into privado.claves (nombre, valor)
values ('llaves', encode(extensions.gen_random_bytes(32), 'hex')),
       ('portal_servidor', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (nombre) do nothing;

create or replace function privado.clave(p_nombre text)
returns text language sql stable security definer set search_path = privado
as $$ select valor from privado.claves where nombre = p_nombre $$;

/* ¿La llamada viene del servidor de la aplicación? */
create or replace function privado.servidor_valido(p_secreto text)
returns boolean language sql stable security definer set search_path = privado
as $$
  select coalesce(p_secreto, '') <> ''
     and p_secreto = (select valor from privado.claves where nombre = 'portal_servidor')
$$;

/* Normaliza lo que escribe el cliente: sin guiones ni espacios, en mayúsculas. */
create or replace function privado.normalizar(p text)
returns text language sql immutable
as $$ select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) $$;

create or replace function privado.hash_llave(p_llave text)
returns text language sql stable security definer set search_path = privado, extensions
as $$
  select encode(extensions.hmac(privado.normalizar(p_llave), privado.clave('llaves'), 'sha256'), 'hex')
$$;

create or replace function privado.hash_token(p_token text)
returns text language sql immutable set search_path = extensions
as $$ select encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') $$;

create or replace function privado.cifrar(p text)
returns bytea language sql stable security definer set search_path = privado, extensions
as $$ select extensions.pgp_sym_encrypt(p, privado.clave('llaves')) $$;

create or replace function privado.descifrar(p bytea)
returns text language sql stable security definer set search_path = privado, extensions
as $$ select extensions.pgp_sym_decrypt(p, privado.clave('llaves')) $$;

/*
 * La llave: 12 caracteres de un alfabeto sin letras que se confunden
 * (sin 0/O, 1/I/L): 32 símbolos → 60 bits de azar. 256 es múltiplo de 32, así
 * que el módulo no sesga. Se muestra en bloques: K7M2-9QXP-4TWD.
 */
create or replace function privado.generar_llave()
returns text language plpgsql volatile set search_path = extensions
as $$
declare
  alfabeto constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  b bytea := extensions.gen_random_bytes(12);
  s text := '';
begin
  for i in 0..11 loop
    s := s || substr(alfabeto, (get_byte(b, i) % 32) + 1, 1);
  end loop;
  return substr(s, 1, 4) || '-' || substr(s, 5, 4) || '-' || substr(s, 9, 4);
end $$;

revoke all on all functions in schema privado from public, anon, authenticated;

-- ---------------------------------------------------------------------------
--  1. M1 · Llave de seguimiento por proforma
-- ---------------------------------------------------------------------------
create table if not exists public.pedido_llaves (
  pedido_id        bigint primary key references public.pedidos(id) on delete cascade,
  llave_hash       text not null unique,
  llave_cifrada    bytea not null,
  sufijo           text not null,
  generada_en      timestamptz not null default now(),
  generada_por     uuid,
  regenerada_veces int not null default 0
);
alter table public.pedido_llaves enable row level security;
-- Sin políticas: nadie la lee por la API. Solo las funciones de abajo.
revoke all on public.pedido_llaves from anon, authenticated;

create or replace function privado.asignar_llave(p_pedido_id bigint, p_regenerar boolean default false)
returns text language plpgsql security definer set search_path = public, privado
as $$
declare
  v_llave text;
  v_intentos int := 0;
begin
  loop
    v_llave := privado.generar_llave();
    v_intentos := v_intentos + 1;
    exit when not exists (select 1 from pedido_llaves where llave_hash = privado.hash_llave(v_llave));
    if v_intentos > 5 then raise exception 'No se pudo generar una llave única.'; end if;
  end loop;

  insert into pedido_llaves (pedido_id, llave_hash, llave_cifrada, sufijo, generada_por)
  values (p_pedido_id, privado.hash_llave(v_llave), privado.cifrar(v_llave), right(v_llave, 4), auth.uid())
  on conflict (pedido_id) do update
     set llave_hash = excluded.llave_hash,
         llave_cifrada = excluded.llave_cifrada,
         sufijo = excluded.sufijo,
         generada_en = now(),
         generada_por = auth.uid(),
         regenerada_veces = pedido_llaves.regenerada_veces + 1
   where p_regenerar;
  return v_llave;
end $$;

create or replace function public.trg_pedido_llave()
returns trigger language plpgsql security definer set search_path = public, privado
as $$
begin
  perform privado.asignar_llave(new.id, false);
  return new;
end $$;

drop trigger if exists trg_pedidos_llave on public.pedidos;
create trigger trg_pedidos_llave after insert on public.pedidos
  for each row execute function public.trg_pedido_llave();

-- Las proformas que ya existen también reciben la suya
select privado.asignar_llave(p.id, false)
  from public.pedidos p
 where not exists (select 1 from public.pedido_llaves l where l.pedido_id = p.id);

/* Lo que se puede mostrar en el ERP: solo los 4 últimos caracteres. */
create or replace function public.pedido_llave_info(p_pedido_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare r record;
begin
  if not es_usuario_activo() then raise exception 'Sin acceso.' using errcode = 'insufficient_privilege'; end if;
  select * into r from pedido_llaves where pedido_id = p_pedido_id;
  if not found then return null; end if;
  return jsonb_build_object(
    'mascara', '••••-••••-' || r.sufijo,
    'generada_en', r.generada_en,
    'regenerada_veces', r.regenerada_veces,
    'envios', (select count(*) from correos_salida c
                where c.entidad = 'pedidos' and c.entidad_id = p_pedido_id and c.tipo = 'accesos'),
    'ultimo_envio', (select max(creado_en) from correos_salida c
                where c.entidad = 'pedidos' and c.entidad_id = p_pedido_id and c.tipo = 'accesos')
  );
end $$;

/*
 * La llave completa: solo para armar el correo de accesos, y solo quien lo
 * envía (Comercial, Comercio Exterior, Gerencia, Operaciones). Queda en la
 * bitácora QUE se leyó, nunca el valor.
 */
create or replace function public.pedido_llave_revelar(p_pedido_id bigint)
returns text language plpgsql volatile security definer set search_path = public, privado
as $$
declare v text;
begin
  if not puede('gerencia', 'operaciones', 'comercial', 'comex') then
    raise exception 'Enviar los accesos al portal lo hacen Comercial, Comercio Exterior y Gerencia.'
      using errcode = 'insufficient_privilege';
  end if;
  select privado.descifrar(llave_cifrada) into v from pedido_llaves where pedido_id = p_pedido_id;
  if v is null then v := privado.asignar_llave(p_pedido_id, false); end if;
  return v;
end $$;

/* Regenerar: solo Gerencia (el «administrador» de la propuesta). */
create or replace function public.pedido_llave_regenerar(p_pedido_id bigint, p_motivo text)
returns jsonb language plpgsql volatile security definer set search_path = public, privado
as $$
declare v text;
begin
  if not puede('gerencia') then
    raise exception 'Solo Gerencia puede regenerar la llave de seguimiento.' using errcode = 'insufficient_privilege';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Escriba por qué se regenera la llave (por ejemplo, «se compartió por error»).';
  end if;
  if not exists (select 1 from pedidos where id = p_pedido_id) then raise exception 'El pedido no existe.'; end if;
  v := privado.asignar_llave(p_pedido_id, true);
  -- Quien estaba consultando con la llave anterior deja de ver la proforma
  update portal_sesiones set consulta_pedido_id = null, consulta_expira = null
   where consulta_pedido_id = p_pedido_id;
  perform registrar_evento('pedidos', p_pedido_id, 'llave_regenerada',
    'Llave de seguimiento regenerada: ' || trim(p_motivo), 'advertencia', null);
  return jsonb_build_object('mascara', '••••-••••-' || right(v, 4));
end $$;

-- ---------------------------------------------------------------------------
--  2. M2 · Cuenta de seguimiento, sesiones, intentos y CAPTCHA
-- ---------------------------------------------------------------------------
create table if not exists public.portal_cuentas (
  id              bigint generated always as identity primary key,
  email           text not null unique,
  nombre          text not null default 'Cuenta de seguimiento',
  clave_hash      text not null,
  clave_cifrada   bytea not null,
  activo          boolean not null default true,
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid
);
alter table public.portal_cuentas enable row level security;
revoke all on public.portal_cuentas from anon, authenticated;

/* La cuenta inicial, con una contraseña al azar que Gerencia puede cambiar. */
do $$
declare v_clave text;
begin
  if not exists (select 1 from public.portal_cuentas) then
    v_clave := 'Smf-' || substr(replace(privado.generar_llave(), '-', ''), 1, 8);
    insert into public.portal_cuentas (email, clave_hash, clave_cifrada)
    values ('clientes_seguimiento@santamonicafishing.com',
            extensions.crypt(v_clave, extensions.gen_salt('bf', 10)),
            privado.cifrar(v_clave));
  end if;
end $$;

create table if not exists public.portal_sesiones (
  token_hash          text primary key,
  cuenta_id           bigint not null references public.portal_cuentas(id) on delete cascade,
  creada_en           timestamptz not null default now(),
  ultima_actividad    timestamptz not null default now(),
  expira_en           timestamptz not null default now() + interval '8 hours',
  ip                  text,
  agente              text,
  idioma              text not null default 'es' check (idioma in ('es', 'en')),
  fallos_seguidos     int not null default 0,
  bloqueada_hasta     timestamptz,
  consulta_pedido_id  bigint references public.pedidos(id) on delete set null,
  consulta_expira     timestamptz,
  cerrada             boolean not null default false
);
alter table public.portal_sesiones enable row level security;
revoke all on public.portal_sesiones from anon, authenticated;

/* Auditoría de accesos: búsquedas y entradas, exitosas y fallidas. Nunca la llave. */
create table if not exists public.portal_intentos (
  id              bigint generated always as identity primary key,
  creado_en       timestamptz not null default now(),
  tipo            text not null check (tipo in ('login', 'busqueda', 'captcha')),
  sesion_hash     text,
  ip              text,
  codigo_cliente  text,
  numero_proforma text,
  exito           boolean not null,
  motivo          text,
  pedido_id       bigint
);
create index if not exists portal_intentos_ip on public.portal_intentos (ip, creado_en);
create index if not exists portal_intentos_codigo on public.portal_intentos (codigo_cliente, creado_en);
alter table public.portal_intentos enable row level security;
revoke all on public.portal_intentos from anon;
drop policy if exists portal_intentos_lectura on public.portal_intentos;
create policy portal_intentos_lectura on public.portal_intentos
  for select to authenticated using (puede('gerencia', 'operaciones'));

create table if not exists public.portal_captchas (
  id             uuid primary key default gen_random_uuid(),
  sesion_hash    text not null,
  respuesta_hash text not null,
  creado_en      timestamptz not null default now(),
  usado          boolean not null default false
);
alter table public.portal_captchas enable row level security;
revoke all on public.portal_captchas from anon, authenticated;

/* Sesión vigente a partir del token de la cookie (o nada). */
create or replace function privado.sesion(p_token text)
returns public.portal_sesiones language sql stable security definer set search_path = public, privado
as $$
  select s.* from portal_sesiones s
    join portal_cuentas c on c.id = s.cuenta_id and c.activo
   where s.token_hash = privado.hash_token(p_token)
     and not s.cerrada and s.expira_en > now()
$$;

create or replace function public.portal_iniciar_sesion(
  p_secreto text, p_email text, p_clave text, p_ip text, p_agente text, p_idioma text default 'es')
returns jsonb language plpgsql volatile security definer set search_path = public, privado, extensions
as $$
declare
  c portal_cuentas;
  v_token text;
  v_fallos int;
begin
  if not privado.servidor_valido(p_secreto) then raise exception 'Llamada no autorizada.' using errcode = 'insufficient_privilege'; end if;

  select count(*) into v_fallos from portal_intentos
   where tipo = 'login' and not exito and ip = p_ip and creado_en > now() - interval '15 minutes';
  if v_fallos >= 10 then
    insert into portal_intentos (tipo, ip, exito, motivo) values ('login', p_ip, false, 'limite_ip');
    return jsonb_build_object('ok', false, 'motivo', 'limite');
  end if;

  select * into c from portal_cuentas
   where lower(email) = lower(trim(coalesce(p_email, ''))) and activo;
  if not found or c.clave_hash <> extensions.crypt(coalesce(p_clave, ''), c.clave_hash) then
    insert into portal_intentos (tipo, ip, exito, motivo) values ('login', p_ip, false, 'credenciales');
    return jsonb_build_object('ok', false, 'motivo', 'credenciales');
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into portal_sesiones (token_hash, cuenta_id, ip, agente, idioma)
  values (privado.hash_token(v_token), c.id, p_ip, left(p_agente, 300),
          case when p_idioma = 'en' then 'en' else 'es' end);
  insert into portal_intentos (tipo, sesion_hash, ip, exito) values ('login', privado.hash_token(v_token), p_ip, true);
  -- Limpieza: sesiones vencidas y captchas viejos
  delete from portal_sesiones where expira_en < now() - interval '1 day';
  delete from portal_captchas where creado_en < now() - interval '1 hour';
  return jsonb_build_object('ok', true, 'token', v_token);
end $$;

create or replace function public.portal_sesion(p_secreto text, p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public, privado
as $$
declare s portal_sesiones;
begin
  if not privado.servidor_valido(p_secreto) then raise exception 'Llamada no autorizada.' using errcode = 'insufficient_privilege'; end if;
  s := privado.sesion(p_token);
  if s.token_hash is null then return jsonb_build_object('ok', false); end if;
  update portal_sesiones set ultima_actividad = now() where token_hash = s.token_hash;
  return jsonb_build_object(
    'ok', true, 'idioma', s.idioma,
    'bloqueada_hasta', case when s.bloqueada_hasta > now() then s.bloqueada_hasta end,
    'consulta', s.consulta_pedido_id is not null and s.consulta_expira > now());
end $$;

create or replace function public.portal_cerrar_sesion(p_secreto text, p_token text)
returns void language plpgsql volatile security definer set search_path = public, privado
as $$
begin
  if not privado.servidor_valido(p_secreto) then raise exception 'Llamada no autorizada.' using errcode = 'insufficient_privilege'; end if;
  update portal_sesiones set cerrada = true where token_hash = privado.hash_token(p_token);
end $$;

create or replace function public.portal_idioma(p_secreto text, p_token text, p_idioma text)
returns void language plpgsql volatile security definer set search_path = public, privado
as $$
begin
  if not privado.servidor_valido(p_secreto) then raise exception 'Llamada no autorizada.' using errcode = 'insufficient_privilege'; end if;
  update portal_sesiones set idioma = case when p_idioma = 'en' then 'en' else 'es' end
   where token_hash = privado.hash_token(p_token);
end $$;

/* El servidor dibuja el CAPTCHA; aquí solo se guarda el hash de la respuesta. */
create or replace function public.portal_captcha_registrar(p_secreto text, p_token text, p_respuesta text)
returns uuid language plpgsql volatile security definer set search_path = public, privado
as $$
declare s portal_sesiones; v uuid;
begin
  if not privado.servidor_valido(p_secreto) then raise exception 'Llamada no autorizada.' using errcode = 'insufficient_privilege'; end if;
  s := privado.sesion(p_token);
  if s.token_hash is null then return null; end if;
  insert into portal_captchas (sesion_hash, respuesta_hash)
  values (s.token_hash, privado.hash_token(privado.normalizar(p_respuesta)))
  returning id into v;
  return v;
end $$;

/*
 * LA BÚSQUEDA · reglas del documento, todas en el servidor
 *   · Los 3 datos coinciden → muestra la proforma y reinicia el contador.
 *   · No coinciden → +1 intento y error genérico (no dice qué dato falló).
 *   · 5 fallos → bloqueo de 1 minuto y el contador vuelve a 0.
 *   · Límite adicional por IP (20 fallos / 15 min) y por Código Cliente
 *     (10 fallos / 15 min), más CAPTCHA en cada búsqueda.
 */
create or replace function public.portal_buscar(
  p_secreto text, p_token text, p_codigo text, p_numero text, p_llave text,
  p_captcha_id uuid, p_captcha text, p_ip text)
returns jsonb language plpgsql volatile security definer set search_path = public, privado
as $$
declare
  s portal_sesiones;
  v_codigo text := upper(trim(coalesce(p_codigo, '')));
  v_numero text := upper(regexp_replace(coalesce(p_numero, ''), '\s', '', 'g'));
  v_pedido record;
  v_fallos int;
  v_cap portal_captchas;
begin
  if not privado.servidor_valido(p_secreto) then raise exception 'Llamada no autorizada.' using errcode = 'insufficient_privilege'; end if;
  s := privado.sesion(p_token);
  if s.token_hash is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;

  if s.bloqueada_hasta > now() then
    return jsonb_build_object('ok', false, 'motivo', 'bloqueado', 'hasta', s.bloqueada_hasta);
  end if;

  select count(*) into v_fallos from portal_intentos
   where tipo = 'busqueda' and not exito and ip = p_ip and creado_en > now() - interval '15 minutes';
  if v_fallos >= 20 then
    insert into portal_intentos (tipo, sesion_hash, ip, codigo_cliente, numero_proforma, exito, motivo)
    values ('busqueda', s.token_hash, p_ip, v_codigo, v_numero, false, 'limite_ip');
    return jsonb_build_object('ok', false, 'motivo', 'limite');
  end if;
  select count(*) into v_fallos from portal_intentos
   where tipo = 'busqueda' and not exito and codigo_cliente = v_codigo and creado_en > now() - interval '15 minutes';
  if v_fallos >= 10 then
    insert into portal_intentos (tipo, sesion_hash, ip, codigo_cliente, numero_proforma, exito, motivo)
    values ('busqueda', s.token_hash, p_ip, v_codigo, v_numero, false, 'limite_codigo');
    return jsonb_build_object('ok', false, 'motivo', 'limite');
  end if;

  -- CAPTCHA: de esta sesión, sin usar, de menos de 10 minutos. Se gasta siempre.
  update portal_captchas set usado = true
   where id = p_captcha_id and sesion_hash = s.token_hash and not usado
     and creado_en > now() - interval '10 minutes'
  returning * into v_cap;
  if v_cap.id is null or v_cap.respuesta_hash <> privado.hash_token(privado.normalizar(p_captcha)) then
    insert into portal_intentos (tipo, sesion_hash, ip, codigo_cliente, numero_proforma, exito, motivo)
    values ('captcha', s.token_hash, p_ip, v_codigo, v_numero, false, 'captcha');
    return jsonb_build_object('ok', false, 'motivo', 'captcha');
  end if;

  select p.id, p.cliente_id into v_pedido
    from pedidos p
    join clientes c on c.id = p.cliente_id
    join pedido_llaves l on l.pedido_id = p.id
   where upper(c.codigo) = v_codigo
     and upper(regexp_replace(p.numero_proforma, '\s', '', 'g')) = v_numero
     and l.llave_hash = privado.hash_llave(p_llave)
     and p.ciclo <> 'borrador';

  if v_pedido.id is null then
    update portal_sesiones
       set fallos_seguidos = case when fallos_seguidos + 1 >= 5 then 0 else fallos_seguidos + 1 end,
           bloqueada_hasta = case when fallos_seguidos + 1 >= 5 then now() + interval '1 minute' else bloqueada_hasta end
     where token_hash = s.token_hash
    returning * into s;
    insert into portal_intentos (tipo, sesion_hash, ip, codigo_cliente, numero_proforma, exito, motivo)
    values ('busqueda', s.token_hash, p_ip, v_codigo, v_numero, false,
            case when s.bloqueada_hasta > now() then 'bloqueo' else 'no_coincide' end);
    if s.bloqueada_hasta > now() then
      return jsonb_build_object('ok', false, 'motivo', 'bloqueado', 'hasta', s.bloqueada_hasta);
    end if;
    return jsonb_build_object('ok', false, 'motivo', 'no_coincide', 'restantes', 5 - s.fallos_seguidos);
  end if;

  update portal_sesiones
     set fallos_seguidos = 0, bloqueada_hasta = null,
         consulta_pedido_id = v_pedido.id,
         consulta_expira = least(expira_en, now() + interval '2 hours')
   where token_hash = s.token_hash;
  insert into portal_intentos (tipo, sesion_hash, ip, codigo_cliente, numero_proforma, exito, pedido_id)
  values ('busqueda', s.token_hash, p_ip, v_codigo, v_numero, true, v_pedido.id);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
--  3. M3 · Hitos configurables y lo que ve el cliente
-- ---------------------------------------------------------------------------
create table if not exists public.portal_hitos (
  clave       text primary key,
  vista       text not null check (vista in ('proforma', 'contenedor')),
  etiqueta_es text not null,
  etiqueta_en text not null,
  origen      text not null,
  orden       int not null,
  visible     boolean not null default true
);
alter table public.portal_hitos enable row level security;
drop policy if exists portal_hitos_lectura on public.portal_hitos;
create policy portal_hitos_lectura on public.portal_hitos for select to authenticated using (es_usuario_activo());
drop policy if exists portal_hitos_edicion on public.portal_hitos;
create policy portal_hitos_edicion on public.portal_hitos for update to authenticated
  using (puede('gerencia', 'operaciones')) with check (puede('gerencia', 'operaciones'));

insert into public.portal_hitos (clave, vista, etiqueta_es, etiqueta_en, origen, orden) values
  ('aprobada',    'proforma',   'Aprobada',             'Approved',          'El pedido está confirmado (fecha de confirmación).', 1),
  ('en_proceso',  'proforma',   'En proceso',           'In progress',       'Tiene stock apartado o un embarque programado.', 2),
  ('lista',       'proforma',   'Lista para despacho',  'Ready to ship',     'Cobertura «preparado» o primer contenedor cargado.', 3),
  ('programado',  'contenedor', 'Programado',           'Scheduled',         'Embarque planificado con fecha, al que se asignó el contenedor.', 1),
  ('cargado',     'contenedor', 'Cargado',              'Loaded',            'Packing del contenedor cerrado (fecha de carga).', 2),
  ('despachado',  'contenedor', 'Despachado',           'Dispatched',        'Despacho registrado del contenedor (fecha de salida).', 3),
  ('en_transito', 'contenedor', 'En tránsito',          'In transit',        'Fecha de zarpe que registra Operaciones en el embarque.', 4),
  ('entregado',   'contenedor', 'Entregado',            'Delivered',         'Fecha de entrega que registra Operaciones en el embarque.', 5)
on conflict (clave) do nothing;

/* Operaciones registra la entrega en el embarque (el zarpe ya existía). */
alter table public.embarques add column if not exists fecha_entrega date;

/* Descripción operativa del producto, sin precios. */
create or replace function privado.producto(p_sku_presentacion_id bigint, p_idioma text)
returns text language sql stable security definer set search_path = public
as $$
  select trim(concat_ws(' ',
           case when p_idioma = 'en' then coalesce(nullif(f.descripcion_en, ''), nullif(f.nombre_ingles, ''), f.nombre)
                else coalesce(nullif(f.descripcion_es, ''), f.nombre) end,
           nullif(s.corte, ''),
           case when s.corte ilike '%' || s.talla || '%' then null else nullif(s.talla, '') end,
           '· ' || coalesce(nullif(pr.descripcion, ''), pr.codigo)))
    from sku_presentaciones sp
    join skus s on s.id = sp.sku_id
    left join formatos f on f.id = s.formato_id
    left join presentaciones pr on pr.id = sp.presentacion_id
   where sp.id = p_sku_presentacion_id
$$;

/*
 * TODO LO QUE VE EL CLIENTE, en un solo JSON. Esta función es «la vista
 * exclusiva» de la propuesta: solo arma campos operativos. No hay forma de
 * que devuelva un precio, porque no lee ninguna columna de importes.
 */
create or replace function privado.datos_portal(p_pedido_id bigint, p_idioma text)
returns jsonb language plpgsql stable security definer set search_path = public, privado
as $$
declare
  p record;
  v_confirmado timestamptz;
  v_proceso timestamptz;
  v_lista timestamptz;
  v_hitos jsonb;
  v_conts jsonb;
  en boolean := p_idioma = 'en';
begin
  select pe.*, c.codigo as cliente_codigo,
         coalesce(pe.cliente_razon_social, c.razon_social) as cliente_nombre,
         d.puerto as destino_puerto, d.pais as destino_pais
    into p
    from pedidos pe
    join clientes c on c.id = pe.cliente_id
    left join destinos d on d.id = pe.destino_id
   where pe.id = p_pedido_id;
  if p.id is null then return null; end if;

  -- Fecha de confirmación: la del historial; si no hay, la del pedido.
  select min(a.ocurrido_en) into v_confirmado from auditoria a
   where a.tabla = 'pedidos' and a.registro_id = p.id::text
     and a.datos_despues->>'ciclo' in ('confirmado', 'despachado', 'cerrado');
  if p.ciclo in ('confirmado', 'despachado', 'cerrado') then
    v_confirmado := coalesce(v_confirmado, p.creado_en);
  else
    v_confirmado := null;
  end if;

  select least(
           (select min(r.creado_en) from reservas r join pedido_lineas pl on pl.id = r.pedido_linea_id where pl.pedido_id = p.id),
           (select min(e.creado_en) from embarque_pedidos ep join embarques e on e.id = ep.embarque_id
             where ep.pedido_id = p.id and e.estado <> 'cancelado'))
    into v_proceso;
  if v_proceso is null and p.cobertura in ('reservado', 'programado', 'en_preparacion', 'preparado') then
    v_proceso := p.actualizado_en;
  end if;

  select min(vc.fecha_carga)::timestamptz into v_lista from v_pedido_contenedores vc
   where vc.pedido_id = p.id and vc.estado_packing = 'cerrado';
  if v_lista is null and (p.cobertura = 'preparado' or p.ciclo in ('despachado', 'cerrado')) then
    v_lista := p.actualizado_en;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'clave', h.clave,
           'etiqueta', case when en then h.etiqueta_en else h.etiqueta_es end,
           'fecha', case h.clave when 'aprobada' then v_confirmado::date
                                 when 'en_proceso' then v_proceso::date
                                 when 'lista' then v_lista::date end,
           'cumplido', case h.clave when 'aprobada' then v_confirmado is not null
                                    when 'en_proceso' then v_proceso is not null
                                    when 'lista' then v_lista is not null end)
           order by h.orden), '[]'::jsonb)
    into v_hitos
    from portal_hitos h where h.vista = 'proforma' and h.visible;

  select coalesce(jsonb_agg(x.j order by x.sec), '[]'::jsonb) into v_conts
    from (
      select vc.secuencia as sec, jsonb_build_object(
        'id', vc.packing_list_id,
        'referencia', vc.referencia,
        'contenedor', vc.contenedor,
        'precinto', vc.precinto,
        'destino', vc.destino,
        'bultos', vc.bultos,
        'tm', round(vc.tm, 3),
        'hitos', (
          select coalesce(jsonb_agg(jsonb_build_object(
                   'clave', h.clave,
                   'etiqueta', case when en then h.etiqueta_en else h.etiqueta_es end,
                   'fecha', case h.clave
                              when 'programado' then vc.fecha_programada
                              when 'cargado' then case when vc.estado_packing = 'cerrado' or vc.despacho_id is not null then vc.fecha_carga end
                              when 'despachado' then vc.fecha_salida
                              when 'en_transito' then case when e.fecha_zarpe <= current_date then e.fecha_zarpe end
                              when 'entregado' then case when e.fecha_entrega <= current_date then e.fecha_entrega end end,
                   'cumplido', case h.clave
                              when 'programado' then vc.fecha_programada is not null
                              when 'cargado' then vc.estado_packing = 'cerrado' or vc.despacho_id is not null
                              when 'despachado' then vc.despacho_id is not null
                              when 'en_transito' then coalesce(e.fecha_zarpe <= current_date, false)
                              when 'entregado' then coalesce(e.fecha_entrega <= current_date, false) end)
                   order by h.orden), '[]'::jsonb)
            from portal_hitos h where h.vista = 'contenedor' and h.visible),
        'productos', (
          select coalesce(jsonb_agg(jsonb_build_object(
                   'descripcion', privado.producto(z.sku, p_idioma),
                   'bultos', z.bultos,
                   'kg', round(z.kg, 1)) order by z.sku), '[]'::jsonb)
            from (select lo.sku_presentacion_id as sku,
                         sum(coalesce(pl.bultos_cargados, pl.bultos)) as bultos,
                         sum(coalesce(pl.kg_cargados, pl.peso_neto_kg)) as kg
                    from packing_lineas pl join lotes lo on lo.id = pl.lote_id
                   where pl.packing_list_id = vc.packing_list_id
                   group by lo.sku_presentacion_id) z),
        'reclamos_pendientes', (select count(*) from reclamos r
                                 where r.packing_list_id = vc.packing_list_id and r.estado <> 'cerrado')
      ) as j
      from v_pedido_contenedores vc
      join embarques e on e.id = vc.embarque_id
     where vc.pedido_id = p.id
    ) x;

  return jsonb_build_object(
    'pedido_id', p.id,
    'numero_proforma', p.numero_proforma,
    'cliente_codigo', p.cliente_codigo,
    'cliente', p.cliente_nombre,
    'destino', nullif(concat_ws(', ', p.destino_puerto, p.destino_pais), ''),
    'incoterm', p.incoterm,
    'mes_embarque', p.mes_embarque,
    'fecha_comprometida', p.fecha_comprometida,
    'cancelada', p.ciclo = 'cancelado',
    'contenedores_previstos', p.contenedores,
    'hitos', v_hitos,
    'productos', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'descripcion', privado.producto(pl.sku_presentacion_id, p_idioma),
               'cantidad_tm', pl.cantidad_tm) order by pl.orden, pl.id), '[]'::jsonb)
        from pedido_lineas pl where pl.pedido_id = p.id),
    'contenedores', v_conts,
    'reclamos', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', r.id, 'numero', r.numero,
               'motivo', case when en then m.nombre_en else m.nombre_es end,
               'estado', r.estado,
               'contenedor', vc2.referencia,
               'creado_en', r.creado_en,
               'cerrado_en', r.cerrado_en,
               'conclusion', case when r.estado = 'cerrado' then r.conclusion end,
               'descargable', r.estado = 'cerrado' and r.respuesta_url is not null
                              and r.cerrado_en > now() - interval '3 months',
               'historial', (select coalesce(jsonb_agg(jsonb_build_object('estado', hh.estado_nuevo, 'fecha', hh.creado_en)
                                     order by hh.creado_en), '[]'::jsonb)
                               from reclamo_historial hh where hh.reclamo_id = r.id and hh.estado_nuevo is not null))
               order by r.creado_en desc), '[]'::jsonb)
        from reclamos r
        join reclamo_motivos m on m.id = r.motivo_id
        left join (select distinct packing_list_id, referencia from v_pedido_contenedores where pedido_id = p_pedido_id) vc2
               on vc2.packing_list_id = r.packing_list_id
       where r.pedido_id = p.id),
    'motivos', (
      select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'nombre', case when en then m.nombre_en else m.nombre_es end)
               order by m.orden, m.id), '[]'::jsonb)
        from reclamo_motivos m where m.activo)
  );
end $$;

-- ---------------------------------------------------------------------------
--  4. M4–M5 · Reclamos
-- ---------------------------------------------------------------------------
create table if not exists public.reclamo_motivos (
  id        bigint generated always as identity primary key,
  nombre_es text not null,
  nombre_en text not null,
  activo    boolean not null default true,
  orden     int not null default 0
);
create table if not exists public.reclamo_clasificaciones (
  id         bigint generated always as identity primary key,
  nombre     text not null,
  plazo_dias int not null check (plazo_dias between 1 and 365),
  activo     boolean not null default true,
  orden      int not null default 0
);

insert into public.reclamo_motivos (nombre_es, nombre_en, orden)
select * from (values
  ('Producto fuera de especificación', 'Product out of specification', 1),
  ('Diferencia de cantidad o peso', 'Quantity or weight difference', 2),
  ('Daño en el empaque o en el contenedor', 'Damaged packaging or container', 3),
  ('Documentación del embarque', 'Shipping documents', 4),
  ('Etiquetado o rotulado', 'Labeling', 5),
  ('Otro (con descripción)', 'Other (please describe)', 6)) v(a, b, c)
where not exists (select 1 from public.reclamo_motivos);

insert into public.reclamo_clasificaciones (nombre, plazo_dias, orden)
select * from (values ('Crítico', 5, 1), ('Mayor', 10, 2), ('Menor', 15, 3)) v(a, b, c)
where not exists (select 1 from public.reclamo_clasificaciones);

create table if not exists public.reclamos (
  id                        bigint generated always as identity primary key,
  numero                    text not null unique,
  pedido_id                 bigint not null references public.pedidos(id),
  cliente_id                bigint not null references public.clientes(id),
  packing_list_id           bigint references public.packing_lists(id),
  motivo_id                 bigint not null references public.reclamo_motivos(id),
  descripcion               text not null,
  observaciones             text,
  contacto_nombre           text not null,
  contacto_correo           text not null,
  idioma                    text not null default 'es' check (idioma in ('es', 'en')),
  estado                    text not null default 'pendiente'
                            check (estado in ('pendiente', 'en_revision', 'en_investigacion', 'cerrado')),
  clasificacion_id          bigint references public.reclamo_clasificaciones(id),
  fecha_limite              date,
  causa                     text,
  acciones_correctivas      text,
  conclusion                text,
  responsable_id            uuid references public.usuarios(id),
  respuesta_ruta            text,
  respuesta_nombre          text,
  respuesta_tamano          bigint,
  respuesta_url             text,
  respuesta_alcance         text check (respuesta_alcance in ('proforma', 'contenedor')),
  respuesta_packing_list_id bigint references public.packing_lists(id),
  creado_en                 timestamptz not null default now(),
  actualizado_en            timestamptz not null default now(),
  cerrado_en                timestamptz,
  cerrado_por               uuid
);
create index if not exists reclamos_pedido on public.reclamos (pedido_id);
create index if not exists reclamos_estado on public.reclamos (estado, creado_en);

create table if not exists public.reclamo_evidencias (
  id           bigint generated always as identity primary key,
  reclamo_id   bigint not null references public.reclamos(id) on delete cascade,
  ruta         text not null,
  nombre       text not null,
  tipo_mime    text,
  tamano_bytes bigint,
  subido_en    timestamptz not null default now()
);
create table if not exists public.reclamo_historial (
  id             bigint generated always as identity primary key,
  reclamo_id     bigint not null references public.reclamos(id) on delete cascade,
  estado_anterior text,
  estado_nuevo   text,
  nota           text,
  usuario_id     uuid,
  usuario_nombre text not null,
  creado_en      timestamptz not null default now()
);
create table if not exists public.reclamo_verificaciones (
  id           uuid primary key default gen_random_uuid(),
  sesion_hash  text not null,
  pedido_id    bigint not null,
  correo       text not null,
  nombre       text not null,
  codigo_hash  text not null,
  expira_en    timestamptz not null default now() + interval '15 minutes',
  intentos     int not null default 0,
  verificado_en timestamptz,
  ticket       uuid unique,
  usado        boolean not null default false,
  creado_en    timestamptz not null default now()
);

alter table public.reclamo_motivos enable row level security;
alter table public.reclamo_clasificaciones enable row level security;
alter table public.reclamos enable row level security;
alter table public.reclamo_evidencias enable row level security;
alter table public.reclamo_historial enable row level security;
alter table public.reclamo_verificaciones enable row level security;
revoke all on public.reclamo_verificaciones from anon, authenticated;
revoke all on public.reclamo_motivos, public.reclamo_clasificaciones, public.reclamos,
              public.reclamo_evidencias, public.reclamo_historial from anon;

drop policy if exists motivos_lectura on public.reclamo_motivos;
create policy motivos_lectura on public.reclamo_motivos for select to authenticated using (es_usuario_activo());
drop policy if exists motivos_escritura on public.reclamo_motivos;
create policy motivos_escritura on public.reclamo_motivos for all to authenticated
  using (puede('gerencia', 'calidad')) with check (puede('gerencia', 'calidad'));
drop policy if exists clasif_lectura on public.reclamo_clasificaciones;
create policy clasif_lectura on public.reclamo_clasificaciones for select to authenticated using (es_usuario_activo());
drop policy if exists clasif_escritura on public.reclamo_clasificaciones;
create policy clasif_escritura on public.reclamo_clasificaciones for all to authenticated
  using (puede('gerencia', 'calidad')) with check (puede('gerencia', 'calidad'));

-- Consultar reclamos: Comercial, Calidad, Gerencia (y Operaciones y Comercio Exterior, que atienden al cliente)
drop policy if exists reclamos_lectura on public.reclamos;
create policy reclamos_lectura on public.reclamos for select to authenticated
  using (puede('gerencia', 'operaciones', 'comercial', 'comex', 'calidad'));
drop policy if exists reclamo_evid_lectura on public.reclamo_evidencias;
create policy reclamo_evid_lectura on public.reclamo_evidencias for select to authenticated
  using (puede('gerencia', 'operaciones', 'comercial', 'comex', 'calidad'));
drop policy if exists reclamo_hist_lectura on public.reclamo_historial;
create policy reclamo_hist_lectura on public.reclamo_historial for select to authenticated
  using (puede('gerencia', 'operaciones', 'comercial', 'comex', 'calidad'));

/* El almacenamiento: evidencias (las sube el cliente) y respuestas (Calidad). */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reclamos', 'reclamos', false, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif',
              'video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp', 'application/pdf'])
on conflict (id) do update
   set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types, public = false;

/*
 * ¿Puede el navegador del cliente subir este archivo? Solo dentro de la
 * carpeta de un ticket que se entregó tras verificar el correo, vigente, y
 * hasta 10 archivos por reclamo.
 */
create or replace function public.reclamo_subida_permitida(p_nombre text)
returns boolean language plpgsql stable security definer set search_path = public, storage
as $$
declare v_ticket text := split_part(p_nombre, '/', 2);
begin
  if split_part(p_nombre, '/', 1) <> 'evidencias'
     or v_ticket !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or split_part(p_nombre, '/', 3) = '' or split_part(p_nombre, '/', 4) <> '' then
    return false;
  end if;
  if not exists (select 1 from reclamo_verificaciones v
                  where v.ticket = v_ticket::uuid and v.verificado_en is not null and not v.usado
                    and v.verificado_en > now() - interval '2 hours') then
    return false;
  end if;
  return (select count(*) from storage.objects o
           where o.bucket_id = 'reclamos' and o.name like 'evidencias/' || v_ticket || '/%') < 10;
end $$;
revoke all on function public.reclamo_subida_permitida(text) from public;
grant execute on function public.reclamo_subida_permitida(text) to anon, authenticated;

drop policy if exists reclamos_evidencia_subir on storage.objects;
create policy reclamos_evidencia_subir on storage.objects for insert to anon
  with check (bucket_id = 'reclamos' and public.reclamo_subida_permitida(name));
drop policy if exists reclamos_leer on storage.objects;
create policy reclamos_leer on storage.objects for select to authenticated
  using (bucket_id = 'reclamos' and puede('gerencia', 'operaciones', 'comercial', 'comex', 'calidad'));
drop policy if exists reclamos_respuesta_subir on storage.objects;
create policy reclamos_respuesta_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'reclamos' and name like 'respuestas/%' and puede('gerencia', 'calidad'));
drop policy if exists reclamos_respuesta_borrar on storage.objects;
create policy reclamos_respuesta_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'reclamos' and name like 'respuestas/%' and puede('gerencia', 'calidad'));

/* --- Del lado del cliente (portal): código, verificación y registro --- */
create or replace function public.portal_consulta(p_secreto text, p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public, privado
as $$
declare s portal_sesiones;
begin
  if not privado.servidor_valido(p_secreto) then raise exception 'Llamada no autorizada.' using errcode = 'insufficient_privilege'; end if;
  s := privado.sesion(p_token);
  if s.token_hash is null or s.consulta_pedido_id is null or s.consulta_expira < now() then return null; end if;
  update portal_sesiones set ultima_actividad = now() where token_hash = s.token_hash;
  return privado.datos_portal(s.consulta_pedido_id, s.idioma);
end $$;

create or replace function public.portal_salir_consulta(p_secreto text, p_token text)
returns void language plpgsql volatile security definer set search_path = public, privado
as $$
begin
  if not privado.servidor_valido(p_secreto) then raise exception 'Llamada no autorizada.' using errcode = 'insufficient_privilege'; end if;
  update portal_sesiones set consulta_pedido_id = null, consulta_expira = null
   where token_hash = privado.hash_token(p_token);
end $$;

/* El código de 6 cifras: se devuelve SOLO al servidor, que lo manda por correo. */
create or replace function public.portal_reclamo_codigo(p_secreto text, p_token text, p_correo text, p_nombre text)
returns jsonb language plpgsql volatile security definer set search_path = public, privado, extensions
as $$
declare
  s portal_sesiones;
  v_azar bytea := extensions.gen_random_bytes(4);
  v_codigo text := lpad(((get_byte(v_azar, 0)::bigint * 65536 + get_byte(v_azar, 1) * 256 + get_byte(v_azar, 2)) % 1000000)::text, 6, '0');
  v_id uuid;
  v_correo text := lower(trim(coalesce(p_correo, '')));
begin
  if not privado.servidor_valido(p_secreto) then raise exception 'Llamada no autorizada.' using errcode = 'insufficient_privilege'; end if;
  s := privado.sesion(p_token);
  if s.token_hash is null or s.consulta_pedido_id is null or s.consulta_expira < now() then
    return jsonb_build_object('ok', false, 'motivo', 'sesion');
  end if;
  if v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(trim(coalesce(p_nombre, ''))) < 3 then
    return jsonb_build_object('ok', false, 'motivo', 'datos');
  end if;
  if (select count(*) from reclamo_verificaciones where sesion_hash = s.token_hash
        and creado_en > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('ok', false, 'motivo', 'limite');
  end if;
  insert into reclamo_verificaciones (sesion_hash, pedido_id, correo, nombre, codigo_hash)
  values (s.token_hash, s.consulta_pedido_id, v_correo, trim(p_nombre), privado.hash_token(v_codigo))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'verificacion_id', v_id, 'codigo', v_codigo, 'correo', v_correo);
end $$;

create or replace function public.portal_reclamo_verificar(p_secreto text, p_token text, p_verificacion uuid, p_codigo text)
returns jsonb language plpgsql volatile security definer set search_path = public, privado
as $$
declare s portal_sesiones; v reclamo_verificaciones;
begin
  if not privado.servidor_valido(p_secreto) then raise exception 'Llamada no autorizada.' using errcode = 'insufficient_privilege'; end if;
  s := privado.sesion(p_token);
  if s.token_hash is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  select * into v from reclamo_verificaciones where id = p_verificacion and sesion_hash = s.token_hash;
  if v.id is null or v.expira_en < now() or v.intentos >= 5 then
    return jsonb_build_object('ok', false, 'motivo', 'vencido');
  end if;
  if v.codigo_hash <> privado.hash_token(regexp_replace(coalesce(p_codigo, ''), '\D', '', 'g')) then
    update reclamo_verificaciones set intentos = intentos + 1 where id = v.id;
    return jsonb_build_object('ok', false, 'motivo', 'codigo', 'restantes', 4 - v.intentos);
  end if;
  update reclamo_verificaciones set verificado_en = now(), ticket = coalesce(ticket, gen_random_uuid())
   where id = v.id returning * into v;
  return jsonb_build_object('ok', true, 'ticket', v.ticket);
end $$;

create or replace function public.portal_reclamo_registrar(
  p_secreto text, p_token text, p_verificacion uuid, p_motivo_id bigint, p_descripcion text,
  p_packing_list_id bigint, p_observaciones text)
returns jsonb language plpgsql volatile security definer set search_path = public, privado, storage
as $$
declare
  s portal_sesiones;
  v reclamo_verificaciones;
  v_id bigint;
  v_numero text;
  v_evid int;
  v_pedido record;
begin
  if not privado.servidor_valido(p_secreto) then raise exception 'Llamada no autorizada.' using errcode = 'insufficient_privilege'; end if;
  s := privado.sesion(p_token);
  if s.token_hash is null or s.consulta_pedido_id is null or s.consulta_expira < now() then
    return jsonb_build_object('ok', false, 'motivo', 'sesion');
  end if;
  select * into v from reclamo_verificaciones
   where id = p_verificacion and sesion_hash = s.token_hash and verificado_en is not null and not usado
     and pedido_id = s.consulta_pedido_id;
  if v.id is null then return jsonb_build_object('ok', false, 'motivo', 'verificacion'); end if;
  if not exists (select 1 from reclamo_motivos where id = p_motivo_id and activo) then
    return jsonb_build_object('ok', false, 'motivo', 'motivo');
  end if;
  if length(trim(coalesce(p_descripcion, ''))) < 10 then
    return jsonb_build_object('ok', false, 'motivo', 'descripcion');
  end if;
  if p_packing_list_id is not null and not exists (
       select 1 from v_pedido_contenedores where pedido_id = s.consulta_pedido_id and packing_list_id = p_packing_list_id) then
    return jsonb_build_object('ok', false, 'motivo', 'contenedor');
  end if;
  select count(*) into v_evid from storage.objects
   where bucket_id = 'reclamos' and name like 'evidencias/' || v.ticket || '/%';
  if v_evid = 0 then return jsonb_build_object('ok', false, 'motivo', 'evidencia'); end if;

  select p.id, p.cliente_id, p.numero_proforma, c.razon_social, c.codigo into v_pedido
    from pedidos p join clientes c on c.id = p.cliente_id where p.id = s.consulta_pedido_id;

  v_numero := 'RC-' || extract(year from now())::int || '-' ||
              lpad(siguiente_correlativo('RC', extract(year from now())::int)::text, 4, '0');
  insert into reclamos (numero, pedido_id, cliente_id, packing_list_id, motivo_id, descripcion, observaciones,
                        contacto_nombre, contacto_correo, idioma)
  values (v_numero, v_pedido.id, v_pedido.cliente_id, p_packing_list_id, p_motivo_id, trim(p_descripcion),
          nullif(trim(coalesce(p_observaciones, '')), ''), v.nombre, v.correo, s.idioma)
  returning id into v_id;

  insert into reclamo_evidencias (reclamo_id, ruta, nombre, tipo_mime, tamano_bytes)
  select v_id, o.name, regexp_replace(split_part(o.name, '/', 3), '^\d+-', ''),
         o.metadata->>'mimetype', nullif(o.metadata->>'size', '')::bigint
    from storage.objects o
   where o.bucket_id = 'reclamos' and o.name like 'evidencias/' || v.ticket || '/%';

  update reclamo_verificaciones set usado = true where id = v.id;
  insert into reclamo_historial (reclamo_id, estado_nuevo, nota, usuario_nombre)
  values (v_id, 'pendiente', 'Registrado por el cliente desde el portal', v.nombre || ' (cliente)');

  insert into alertas (entidad, entidad_id, severidad, titulo, mensaje, datos)
  values ('reclamos', v_id, 'advertencia', 'Nuevo reclamo ' || v_numero,
          v_pedido.razon_social || ' · proforma ' || v_pedido.numero_proforma,
          jsonb_build_object('enlace', '/calidad/reclamos/' || v_id));

  return jsonb_build_object('ok', true, 'id', v_id, 'numero', v_numero,
    'numero_proforma', v_pedido.numero_proforma, 'cliente', v_pedido.razon_social,
    'correo', v.correo, 'nombre', v.nombre, 'idioma', s.idioma,
    'motivo', (select case when s.idioma = 'en' then nombre_en else nombre_es end from reclamo_motivos where id = p_motivo_id),
    'jefe_calidad', (select valor from parametros where clave = 'correo_jefe_calidad'),
    'erp_url', (select valor from parametros where clave = 'erp_url'));
end $$;

/* El PDF de respuesta: solo de un reclamo cerrado de la proforma validada, durante 3 meses. */
create or replace function public.portal_descarga(p_secreto text, p_token text, p_reclamo_id bigint)
returns text language plpgsql volatile security definer set search_path = public, privado
as $$
declare s portal_sesiones; v text;
begin
  if not privado.servidor_valido(p_secreto) then raise exception 'Llamada no autorizada.' using errcode = 'insufficient_privilege'; end if;
  s := privado.sesion(p_token);
  if s.token_hash is null or s.consulta_pedido_id is null or s.consulta_expira < now() then return null; end if;
  select respuesta_url into v from reclamos
   where id = p_reclamo_id and pedido_id = s.consulta_pedido_id and estado = 'cerrado'
     and cerrado_en > now() - interval '3 months';
  return v;
end $$;

/* --- Del lado de Calidad (ERP) --- */
create or replace function public.reclamo_actualizar(
  p_id bigint, p_estado text, p_clasificacion_id bigint, p_causa text, p_acciones text,
  p_nota text, p_responsable_id uuid default null)
returns void language plpgsql volatile security definer set search_path = public
as $$
declare r reclamos; v_plazo int; v_nombre text;
begin
  if not puede('gerencia', 'calidad') then
    raise exception 'Clasificar y atender reclamos lo hacen Calidad y Gerencia.' using errcode = 'insufficient_privilege';
  end if;
  select * into r from reclamos where id = p_id for update;
  if r.id is null then raise exception 'El reclamo no existe.'; end if;
  if r.estado = 'cerrado' then raise exception 'El reclamo % ya está cerrado.', r.numero; end if;
  if p_estado not in ('pendiente', 'en_revision', 'en_investigacion') then
    raise exception 'Para cerrar el reclamo use «Cerrar con PDF de respuesta».';
  end if;
  if p_clasificacion_id is not null then
    select plazo_dias into v_plazo from reclamo_clasificaciones where id = p_clasificacion_id;
    if v_plazo is null then raise exception 'Esa clasificación no existe.'; end if;
  end if;
  select nombre into v_nombre from usuarios where id = auth.uid();

  update reclamos set
    estado = p_estado,
    clasificacion_id = p_clasificacion_id,
    fecha_limite = case when p_clasificacion_id is distinct from r.clasificacion_id or r.fecha_limite is null
                        then case when v_plazo is not null then (r.creado_en at time zone 'America/Lima')::date + v_plazo end
                        else r.fecha_limite end,
    causa = nullif(trim(coalesce(p_causa, '')), ''),
    acciones_correctivas = nullif(trim(coalesce(p_acciones, '')), ''),
    responsable_id = coalesce(p_responsable_id, r.responsable_id, auth.uid()),
    actualizado_en = now()
  where id = p_id;

  if p_estado <> r.estado or nullif(trim(coalesce(p_nota, '')), '') is not null
     or p_clasificacion_id is distinct from r.clasificacion_id then
    insert into reclamo_historial (reclamo_id, estado_anterior, estado_nuevo, nota, usuario_id, usuario_nombre)
    values (p_id, r.estado, case when p_estado <> r.estado then p_estado end,
            concat_ws(' · ',
              case when p_clasificacion_id is distinct from r.clasificacion_id then
                'Clasificación: ' || coalesce((select nombre from reclamo_clasificaciones where id = p_clasificacion_id), '—') end,
              nullif(trim(coalesce(p_nota, '')), '')),
            auth.uid(), coalesce(v_nombre, 'Usuario'));
  end if;
end $$;

create or replace function public.reclamo_cerrar(
  p_id bigint, p_conclusion text, p_ruta text, p_nombre text, p_tamano bigint,
  p_alcance text, p_packing_list_id bigint, p_url text)
returns jsonb language plpgsql volatile security definer set search_path = public, storage
as $$
declare r reclamos; v_nombre text;
begin
  if not puede('gerencia', 'calidad') then
    raise exception 'Cerrar reclamos lo hacen Calidad y Gerencia.' using errcode = 'insufficient_privilege';
  end if;
  select * into r from reclamos where id = p_id for update;
  if r.id is null then raise exception 'El reclamo no existe.'; end if;
  if r.estado = 'cerrado' then raise exception 'El reclamo % ya está cerrado.', r.numero; end if;
  if length(trim(coalesce(p_conclusion, ''))) < 10 then raise exception 'Escriba la conclusión que recibirá el cliente.'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'reclamos' and name = p_ruta and p_ruta like 'respuestas/%') then
    raise exception 'Primero suba el PDF de respuesta.';
  end if;
  if p_alcance not in ('proforma', 'contenedor') then raise exception 'Indique si la respuesta es por proforma o por contenedor.'; end if;
  if p_alcance = 'contenedor' and not exists (
       select 1 from v_pedido_contenedores where pedido_id = r.pedido_id and packing_list_id = p_packing_list_id) then
    raise exception 'Elija el contenedor de la respuesta.';
  end if;
  select nombre into v_nombre from usuarios where id = auth.uid();

  update reclamos set estado = 'cerrado', conclusion = trim(p_conclusion),
         respuesta_ruta = p_ruta, respuesta_nombre = p_nombre, respuesta_tamano = p_tamano, respuesta_url = p_url,
         respuesta_alcance = p_alcance,
         respuesta_packing_list_id = case when p_alcance = 'contenedor' then p_packing_list_id end,
         cerrado_en = now(), cerrado_por = auth.uid(), actualizado_en = now()
   where id = p_id;
  insert into reclamo_historial (reclamo_id, estado_anterior, estado_nuevo, nota, usuario_id, usuario_nombre)
  values (p_id, r.estado, 'cerrado', 'Cerrado con PDF de respuesta', auth.uid(), coalesce(v_nombre, 'Usuario'));
  update alertas set atendida = true, atendida_por = auth.uid(), atendida_en = now()
   where entidad = 'reclamos' and entidad_id = p_id and not atendida;

  return jsonb_build_object('numero', r.numero, 'correo', r.contacto_correo, 'nombre', r.contacto_nombre,
    'idioma', r.idioma, 'numero_proforma', (select numero_proforma from pedidos where id = r.pedido_id));
end $$;

/* «Ver como cliente»: lo mismo que verá el cliente, para quien atiende la proforma. */
create or replace function public.portal_vista_empleado(p_pedido_id bigint, p_idioma text default 'es')
returns jsonb language plpgsql stable security definer set search_path = public, privado
as $$
begin
  if not puede('gerencia', 'operaciones', 'comercial', 'comex', 'calidad') then
    raise exception 'Sin acceso a la vista del cliente.' using errcode = 'insufficient_privilege';
  end if;
  return privado.datos_portal(p_pedido_id, case when p_idioma = 'en' then 'en' else 'es' end);
end $$;

-- ---------------------------------------------------------------------------
--  5. M6–M7 · Correos: plantillas editables y registro de cada envío
-- ---------------------------------------------------------------------------
create table if not exists public.plantillas_correo (
  clave           text not null,
  idioma          text not null check (idioma in ('es', 'en')),
  nombre          text not null,
  asunto          text not null,
  cuerpo          text not null,
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid,
  primary key (clave, idioma)
);
alter table public.plantillas_correo enable row level security;
revoke all on public.plantillas_correo from anon;
drop policy if exists plantillas_correo_lectura on public.plantillas_correo;
create policy plantillas_correo_lectura on public.plantillas_correo for select to authenticated using (es_usuario_activo());
drop policy if exists plantillas_correo_edicion on public.plantillas_correo;
create policy plantillas_correo_edicion on public.plantillas_correo for update to authenticated
  using (puede('gerencia') or (puede('calidad') and clave like 'reclamo%'))
  with check (puede('gerencia') or (puede('calidad') and clave like 'reclamo%'));

insert into public.plantillas_correo (clave, idioma, nombre, asunto, cuerpo) values
('accesos', 'es', 'Datos de acceso al portal', 'Sus datos de acceso al portal de seguimiento · {{numero_proforma}}',
 E'Estimado(a) {{contacto}}:\n\nPuede consultar el avance de su proforma y la línea de tiempo de cada contenedor en nuestro portal de seguimiento, a cualquier hora.\n\nCódigo Cliente: {{codigo_cliente}}\nN.° de proforma: {{numero_proforma}}\nLlave de seguimiento: {{llave}}\nCorreo de acceso: {{correo_acceso}}\nContraseña: {{clave_acceso}}\nPortal: {{portal_url}}\n\nGuarde este correo: la llave de seguimiento no se envía por ningún otro medio.\n\nAtentamente,\nComercio Exterior · Santa Mónica Fishing'),
('accesos', 'en', 'Portal access details', 'Your tracking portal access details · {{numero_proforma}}',
 E'Dear {{contacto}},\n\nYou can check the progress of your proforma and the timeline of each container on our tracking portal, at any time.\n\nCustomer code: {{codigo_cliente}}\nProforma No.: {{numero_proforma}}\nTracking key: {{llave}}\nAccess e-mail: {{correo_acceso}}\nPassword: {{clave_acceso}}\nPortal: {{portal_url}}\n\nPlease keep this e-mail: the tracking key is not sent through any other channel.\n\nBest regards,\nForeign Trade · Santa Mónica Fishing'),
('proforma', 'es', 'Envío de proforma', 'Proforma {{numero}} · Santa Mónica Fishing',
 E'Estimado(a) {{contacto}}:\n\nAdjuntamos la proforma {{numero}}.\n\nQuedamos atentos a sus comentarios.\n\nAtentamente,\n{{vendedor}}\nSanta Mónica Fishing'),
('proforma', 'en', 'Proforma e-mail', 'Proforma {{numero}} · Santa Mónica Fishing',
 E'Dear {{contacto}},\n\nPlease find attached proforma {{numero}}.\n\nWe look forward to your comments.\n\nBest regards,\n{{vendedor}}\nSanta Mónica Fishing'),
('cotizacion', 'es', 'Envío de cotización', 'Cotización {{numero}} · Santa Mónica Fishing',
 E'Estimado(a) {{contacto}}:\n\nAdjuntamos la cotización {{numero}}.\n\nQuedamos atentos a sus comentarios.\n\nAtentamente,\n{{vendedor}}\nSanta Mónica Fishing'),
('cotizacion', 'en', 'Quotation e-mail', 'Quotation {{numero}} · Santa Mónica Fishing',
 E'Dear {{contacto}},\n\nPlease find attached quotation {{numero}}.\n\nWe look forward to your comments.\n\nBest regards,\n{{vendedor}}\nSanta Mónica Fishing'),
('reclamo_codigo', 'es', 'Código de verificación', 'Su código de verificación: {{codigo}}',
 E'Hola {{nombre}}:\n\nSu código para registrar un reclamo de la proforma {{numero_proforma}} es:\n\n{{codigo}}\n\nVence en 15 minutos. Si usted no lo pidió, ignore este correo.\n\nAseguramiento de Calidad · Santa Mónica Fishing'),
('reclamo_codigo', 'en', 'Verification code', 'Your verification code: {{codigo}}',
 E'Hello {{nombre}},\n\nYour code to file a claim for proforma {{numero_proforma}} is:\n\n{{codigo}}\n\nIt expires in 15 minutes. If you did not request it, please ignore this e-mail.\n\nQuality Assurance · Santa Mónica Fishing'),
('reclamo_registrado', 'es', 'Reclamo registrado', 'Reclamo {{numero}} registrado',
 E'Hola {{nombre}}:\n\nRegistramos su reclamo {{numero}} de la proforma {{numero_proforma}} (motivo: {{motivo}}). Su estado actual es «Pendiente».\n\nPuede seguir su avance en el portal de seguimiento. Le escribiremos cuando Aseguramiento de Calidad lo cierre.\n\nAseguramiento de Calidad · Santa Mónica Fishing'),
('reclamo_registrado', 'en', 'Claim registered', 'Claim {{numero}} registered',
 E'Hello {{nombre}},\n\nWe have registered your claim {{numero}} for proforma {{numero_proforma}} (reason: {{motivo}}). Its current status is "Pending".\n\nYou can follow its progress on the tracking portal. We will write to you when Quality Assurance closes it.\n\nQuality Assurance · Santa Mónica Fishing'),
('reclamo_nuevo', 'es', 'Aviso de nuevo reclamo (a Calidad)', 'Nuevo reclamo {{numero}} · {{cliente}}',
 E'Se registró el reclamo {{numero}} desde el portal de clientes.\n\nCliente: {{cliente}}\nProforma: {{numero_proforma}}\nMotivo: {{motivo}}\nContacto: {{nombre}} <{{correo}}>\n\nÁbralo en el ERP: {{enlace}}'),
('reclamo_nuevo', 'en', 'New claim notice (to Quality)', 'Nuevo reclamo {{numero}} · {{cliente}}',
 E'Se registró el reclamo {{numero}} desde el portal de clientes.\n\nCliente: {{cliente}}\nProforma: {{numero_proforma}}\nMotivo: {{motivo}}\nContacto: {{nombre}} <{{correo}}>\n\nÁbralo en el ERP: {{enlace}}'),
('reclamo_cierre', 'es', 'Cierre del reclamo', 'Reclamo {{numero}} cerrado · respuesta de Calidad',
 E'Hola {{nombre}}:\n\nAseguramiento de Calidad cerró su reclamo {{numero}} de la proforma {{numero_proforma}}.\n\nConclusión:\n{{conclusion}}\n\n{{nota_pdf}}\n\nAseguramiento de Calidad · Santa Mónica Fishing'),
('reclamo_cierre', 'en', 'Claim closed', 'Claim {{numero}} closed · Quality response',
 E'Hello {{nombre}},\n\nQuality Assurance has closed your claim {{numero}} for proforma {{numero_proforma}}.\n\nConclusion:\n{{conclusion}}\n\n{{nota_pdf}}\n\nQuality Assurance · Santa Mónica Fishing')
on conflict (clave, idioma) do nothing;

create table if not exists public.correos_salida (
  id                 bigint generated always as identity primary key,
  tipo               text not null,
  remitente          text not null,
  para               text[] not null,
  cc                 text[] not null default '{}',
  asunto             text not null,
  cuerpo             text not null,
  adjuntos           jsonb not null default '[]',
  estado             text not null check (estado in ('enviado', 'simulado', 'error')),
  error              text,
  proveedor_id       text,
  entidad            text,
  entidad_id         bigint,
  enviado_por        uuid,
  enviado_por_nombre text not null,
  creado_en          timestamptz not null default now()
);
create index if not exists correos_salida_entidad on public.correos_salida (entidad, entidad_id);
alter table public.correos_salida enable row level security;
revoke all on public.correos_salida from anon;
drop policy if exists correos_lectura on public.correos_salida;
create policy correos_lectura on public.correos_salida for select to authenticated using (
  puede('gerencia', 'operaciones')
  or enviado_por = auth.uid()
  or (tipo like 'reclamo%' and puede('calidad'))
  or (tipo in ('accesos', 'proforma', 'cotizacion') and puede('comercial', 'comex')));

/*
 * Registrar un correo. Lo llama el servidor de la aplicación DESPUÉS de
 * intentar enviarlo. El cuerpo que se guarda nunca lleva la llave ni la
 * contraseña: el servidor las enmascara antes.
 */
create or replace function public.correo_registrar(p_secreto text, p_correo jsonb)
returns bigint language plpgsql volatile security definer set search_path = public, privado
as $$
declare v_id bigint; v_nombre text;
begin
  if not (es_usuario_activo() or privado.servidor_valido(p_secreto)) then
    raise exception 'Llamada no autorizada.' using errcode = 'insufficient_privilege';
  end if;
  select nombre into v_nombre from usuarios where id = auth.uid();
  insert into correos_salida (tipo, remitente, para, cc, asunto, cuerpo, adjuntos, estado, error, proveedor_id,
                              entidad, entidad_id, enviado_por, enviado_por_nombre)
  values (p_correo->>'tipo', p_correo->>'remitente',
          array(select jsonb_array_elements_text(coalesce(p_correo->'para', '[]'))),
          array(select jsonb_array_elements_text(coalesce(p_correo->'cc', '[]'))),
          p_correo->>'asunto', p_correo->>'cuerpo', coalesce(p_correo->'adjuntos', '[]'),
          p_correo->>'estado', p_correo->>'error', p_correo->>'proveedor_id',
          p_correo->>'entidad', nullif(p_correo->>'entidad_id', '')::bigint,
          auth.uid(), coalesce(v_nombre, p_correo->>'enviado_por_nombre', 'Portal de clientes'))
  returning id into v_id;
  return v_id;
end $$;

/* Plantilla para el servidor del portal (que no tiene sesión del ERP). */
create or replace function public.plantilla_correo(p_secreto text, p_clave text, p_idioma text)
returns jsonb language plpgsql stable security definer set search_path = public, privado
as $$
begin
  if not (es_usuario_activo() or privado.servidor_valido(p_secreto)) then
    raise exception 'Llamada no autorizada.' using errcode = 'insufficient_privilege';
  end if;
  return (select jsonb_build_object('asunto', asunto, 'cuerpo', cuerpo) from plantillas_correo
           where clave = p_clave and idioma = case when p_idioma = 'en' then 'en' else 'es' end);
end $$;

/* La cuenta de seguimiento, para el correo de accesos y para Configuración. */
create or replace function public.portal_cuenta_acceso()
returns jsonb language plpgsql stable security definer set search_path = public, privado
as $$
declare c portal_cuentas;
begin
  if not puede('gerencia', 'operaciones', 'comercial', 'comex') then
    raise exception 'Sin acceso.' using errcode = 'insufficient_privilege';
  end if;
  select * into c from portal_cuentas where activo order by id limit 1;
  if c.id is null then return null; end if;
  return jsonb_build_object('email', c.email, 'clave', privado.descifrar(c.clave_cifrada), 'actualizado_en', c.actualizado_en);
end $$;

create or replace function public.portal_cuenta_cambiar_clave(p_clave text)
returns void language plpgsql volatile security definer set search_path = public, privado, extensions
as $$
begin
  if not puede('gerencia') then
    raise exception 'Solo Gerencia cambia la contraseña de la cuenta de seguimiento.' using errcode = 'insufficient_privilege';
  end if;
  if length(coalesce(p_clave, '')) < 10 or p_clave !~ '[0-9]' or p_clave !~ '[A-Za-z]' then
    raise exception 'La contraseña debe tener al menos 10 caracteres, con letras y números.';
  end if;
  update portal_cuentas set clave_hash = extensions.crypt(p_clave, extensions.gen_salt('bf', 10)),
         clave_cifrada = privado.cifrar(p_clave), actualizado_en = now(), actualizado_por = auth.uid()
   where id = (select id from portal_cuentas order by id limit 1);
  -- Las sesiones abiertas con la contraseña anterior se cierran
  update portal_sesiones set cerrada = true where not cerrada;
  perform registrar_evento('portal_cuentas', 1, 'clave_portal_cambiada',
    'Se cambió la contraseña de la cuenta de seguimiento del portal', 'advertencia', null);
end $$;

-- ---------------------------------------------------------------------------
--  6. Parámetros nuevos (aparecen solos en Configuración, grupo «portal»)
-- ---------------------------------------------------------------------------
insert into public.parametros (clave, valor, tipo_dato, grupo, etiqueta, descripcion, unidad, editable_por) values
  ('correo_jefe_calidad', 'calidad@santamonicafishing.com', 'texto', 'portal', 'Correo del Jefe de Aseguramiento de Calidad',
   'Recibe el aviso de cada reclamo nuevo, con el enlace al reclamo en el ERP.', null, 'gerencia'),
  ('portal_url', 'https://clientes.santamonicafishing.com', 'texto', 'portal', 'Dirección del portal de clientes',
   'Va en el correo de accesos. Mientras TI no cree el subdominio, use la dirección de pruebas (…/portal).', null, 'gerencia'),
  ('erp_url', 'https://erp.santamonicafishing.com', 'texto', 'portal', 'Dirección del ERP',
   'Para el enlace al reclamo en el aviso a Calidad.', null, 'gerencia'),
  ('correo_adjunto_max_mb', '10', 'numero', 'portal', 'Tamaño máximo del PDF adjunto en el correo de cierre',
   'Si el PDF de respuesta pesa más, el correo lleva el aviso para descargarlo del portal.', 'MB', 'gerencia')
on conflict (clave) do nothing;

-- ---------------------------------------------------------------------------
--  7. Permisos de ejecución
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  -- Las del portal: anon (el servidor del portal no tiene sesión) — todas piden el secreto
  foreach f in array array[
    'portal_iniciar_sesion(text,text,text,text,text,text)', 'portal_sesion(text,text)',
    'portal_cerrar_sesion(text,text)', 'portal_idioma(text,text,text)',
    'portal_captcha_registrar(text,text,text)',
    'portal_buscar(text,text,text,text,text,uuid,text,text)', 'portal_consulta(text,text)',
    'portal_salir_consulta(text,text)', 'portal_reclamo_codigo(text,text,text,text)',
    'portal_reclamo_verificar(text,text,uuid,text)',
    'portal_reclamo_registrar(text,text,uuid,bigint,text,bigint,text)',
    'portal_descarga(text,text,bigint)', 'correo_registrar(text,jsonb)', 'plantilla_correo(text,text,text)']
  loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
  -- Las del ERP: solo con sesión
  foreach f in array array[
    'pedido_llave_info(bigint)', 'pedido_llave_revelar(bigint)', 'pedido_llave_regenerar(bigint,text)',
    'portal_vista_empleado(bigint,text)', 'reclamo_actualizar(bigint,text,bigint,text,text,text,uuid)',
    'reclamo_cerrar(bigint,text,text,text,bigint,text,bigint,text)',
    'portal_cuenta_acceso()', 'portal_cuenta_cambiar_clave(text)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  execute 'revoke all on function public.trg_pedido_llave() from public, anon, authenticated';
end $$;

revoke all on all functions in schema privado from public, anon, authenticated;

notify pgrst, 'reload schema';
