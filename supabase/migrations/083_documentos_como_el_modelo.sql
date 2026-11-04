-- ============================================================================
--  083 · LA PROFORMA Y EL CONTRATO, COMO LOS DE SANTA MÓNICA
-- ============================================================================
--  «Observaciones ERP 4» de Oliver Tello (Operaciones), puntos 02 a 05, y lo
--  que dijo en la reunión del 04/11 con la proforma y el contrato SM26-384 de
--  KULALIA en la mano:
--
--   · 05 · «Hacer opcional el certificado de captura según negociación en la
--     cotización, y que salga reflejado en el contrato.» Todos los documentos
--     de la lista son obligatorios salvo el CERTIFICADO DE CAPTURA, que tiene
--     un costo adicional: se decide en CADA cotización (el mismo cliente puede
--     pedirlo en una proforma y en otra no).
--   · La firma: «si aprueba Walter sale la firma de Walter; si aprueba Cathy,
--     puede salir la firma de Cathy». Cada usuario sube la suya.
--
--  Los puntos 02 a 04 (descripción completa por ítem, letras negras, sin total
--  en letras ni recuadro de observaciones) son de dibujo: viven en
--  src/lib/documentos.ts, pdfProforma.ts, contratoVenta.ts y pdfContrato.ts.
--
--  QUÉ HAY AQUÍ
--   1. cotizaciones.certificado_captura y pedidos.certificado_captura.
--      Tres valores a propósito: TRUE (lo lleva), FALSE (no lo lleva) y NULL
--      (no se decidió: las cotizaciones y pedidos de antes de esta versión).
--      NULL sigue la regla de antes —se propone para destinos de la Unión
--      Europea, que lo exige (Reglamento CE 1005/2008)—, así ningún documento
--      ya emitido cambia por debajo y no hace falta tocar filas existentes.
--   2. El pedido hereda la decisión de su cotización al nacer, y si después se
--      corrige en la cotización, el pedido la sigue mientras no se haya
--      cambiado aparte en el pedido.
--   3. firmas_usuario: la firma escaneada y el cargo de cada usuario. Se guarda
--      aparte de `usuarios` para que las mil consultas que leen la ficha de un
--      usuario no arrastren una imagen de cien kilobytes.
--   4. guardar_firma_usuario(): cada uno sube la suya; Gerencia puede subirla
--      por otro (Walter o Cathy no tienen por qué hacerlo en persona).
--
--  Re-ejecutable.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
--  1 · EL CERTIFICADO DE CAPTURA, DECIDIDO EN LA COTIZACIÓN
-- ────────────────────────────────────────────────────────────────────────────
alter table cotizaciones add column if not exists certificado_captura boolean;
alter table pedidos      add column if not exists certificado_captura boolean;

comment on column cotizaciones.certificado_captura is
  'Si la venta incluye el certificado de captura (Catch Certificate), que tiene costo adicional y se negocia en cada cotización. NULL = no se decidió (registros anteriores a la 083): los documentos lo proponen solo para destinos de la Unión Europea.';
comment on column pedidos.certificado_captura is
  'Si la proforma y el contrato llevan el certificado de captura. Nace con lo que diga la cotización; se puede corregir en la página del contrato. NULL = no se decidió: se propone solo para la Unión Europea.';


-- ────────────────────────────────────────────────────────────────────────────
--  2 · EL PEDIDO HEREDA LA DECISIÓN DE SU COTIZACIÓN
-- ────────────────────────────────────────────────────────────────────────────
--  «Convertir en pedido» copia las columnas una por una en el servidor. En vez
--  de añadir otra más a esa lista (que es de otra área y cambia a menudo), la
--  base la completa sola al insertar: si el pedido viene de una cotización y
--  nadie dijo nada, lleva lo que se negoció en ella.
create or replace function pedido_hereda_certificado_captura()
returns trigger
language plpgsql
security definer
set search_path = public as $$
begin
  if new.certificado_captura is null and new.cotizacion_id is not null then
    select c.certificado_captura into new.certificado_captura
      from cotizaciones c where c.id = new.cotizacion_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_pedidos_certificado_captura on pedidos;
create trigger trg_pedidos_certificado_captura
  before insert on pedidos
  for each row execute function pedido_hereda_certificado_captura();

--  Si se corrige en la cotización ya convertida (con la autorización que pida
--  el área de ventas), el pedido la sigue... salvo que en el pedido se haya
--  decidido otra cosa: lo último que se decidió en el pedido manda.
create or replace function cotizacion_propaga_certificado_captura()
returns trigger
language plpgsql
security definer
set search_path = public as $$
begin
  if new.certificado_captura is distinct from old.certificado_captura then
    update pedidos p
       set certificado_captura = new.certificado_captura
     where p.cotizacion_id = new.id
       and p.certificado_captura is not distinct from old.certificado_captura;
  end if;
  return new;
end $$;

drop trigger if exists trg_cotizaciones_certificado_captura on cotizaciones;
create trigger trg_cotizaciones_certificado_captura
  after update of certificado_captura on cotizaciones
  for each row execute function cotizacion_propaga_certificado_captura();


-- ────────────────────────────────────────────────────────────────────────────
--  3 · LA FIRMA DE CADA USUARIO
-- ────────────────────────────────────────────────────────────────────────────
--  Firma la proforma y el contrato QUIEN APROBÓ la cotización (y si el pedido
--  no vino de una cotización, quien lo registró). Si esa persona no subió su
--  firma, sale la de Gerencia de Configuración → Parámetros, como hasta ahora.
create table if not exists firmas_usuario (
  usuario_id      uuid primary key references usuarios(id) on delete cascade,
  --  La imagen incrustada (data:image/png;base64,…). Vacía = sin firma escaneada.
  firma           text,
  --  El cargo que se imprime debajo: «Jefe Comercial y Exportaciones».
  cargo           text,
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid references usuarios(id)
);

comment on table firmas_usuario is
  'Firma escaneada y cargo de cada usuario para la proforma y el contrato (083). Firma quien aprobó la cotización; si no tiene firma, la de Gerencia de Parámetros.';

alter table firmas_usuario enable row level security;

--  La leen quienes descargan documentos con precios (ellos generan la proforma
--  y el contrato con la firma de otro) y cada uno la suya.
drop policy if exists lectura_firmas on firmas_usuario;
create policy lectura_firmas on firmas_usuario for select
  using (usuario_id = auth.uid() or puede('gerencia', 'operaciones', 'comercial', 'comex'));

--  Nadie escribe directo: solo por la función de abajo, que valida.
drop policy if exists escritura_firmas on firmas_usuario;

revoke insert, update, delete on firmas_usuario from anon, authenticated;
grant select on firmas_usuario to authenticated;


-- ────────────────────────────────────────────────────────────────────────────
--  4 · SUBIR O QUITAR UNA FIRMA
-- ────────────────────────────────────────────────────────────────────────────
--  p_firma: la imagen incrustada; '' la quita; NULL la deja como está (para
--  cambiar solo el cargo). p_cargo: '' lo borra; NULL lo deja.
create or replace function guardar_firma_usuario(p_usuario uuid, p_firma text, p_cargo text)
returns text
language plpgsql
security definer
set search_path = public as $$
declare
  v_yo   uuid := auth.uid();
  v_rol  rol_usuario;
  v_obj  record;
  v_firma text := nullif(btrim(coalesce(p_firma, '')), '');
  v_cargo text := nullif(btrim(coalesce(p_cargo, '')), '');
begin
  select rol into v_rol from usuarios where id = v_yo and activo;
  if v_rol is null then
    raise exception 'Su sesión no corresponde a un usuario activo.' using errcode = '42501';
  end if;
  if p_usuario is distinct from v_yo and v_rol <> 'gerencia' then
    raise exception 'Cada usuario sube su propia firma; la de otra persona solo la sube Gerencia.'
      using errcode = '42501';
  end if;

  select id, nombre, activo into v_obj from usuarios where id = p_usuario;
  if not found then
    raise exception 'Ese usuario no existe.' using errcode = 'P0002';
  end if;

  if v_firma is not null then
    if v_firma !~ '^data:image/(png|jpeg);base64,' then
      raise exception 'La firma debe ser una imagen PNG o JPG: otros formatos se ven en pantalla pero salen en blanco en el PDF.'
        using errcode = '22023';
    end if;
    --  ~1,4 MB de imagen. La pantalla ya la reduce a 1600 px de lado.
    if length(v_firma) > 1900000 then
      raise exception 'La imagen de la firma es demasiado grande. Recórtela dejando solo el trazo.'
        using errcode = '22023';
    end if;
  end if;
  if v_cargo is not null and length(v_cargo) > 120 then
    raise exception 'El cargo puede tener hasta 120 caracteres.' using errcode = '22023';
  end if;

  insert into firmas_usuario as f (usuario_id, firma, cargo, actualizado_en, actualizado_por)
  values (p_usuario, v_firma, v_cargo, now(), v_yo)
  on conflict (usuario_id) do update
     set firma = case when p_firma is null then f.firma else v_firma end,
         cargo = case when p_cargo is null then f.cargo else v_cargo end,
         actualizado_en = now(),
         actualizado_por = v_yo;

  return v_obj.nombre;
end $$;

comment on function guardar_firma_usuario(uuid, text, text) is
  'Guarda la firma escaneada (PNG/JPG incrustado) y el cargo de un usuario. Cada uno la suya; Gerencia la de cualquiera. p_firma = '''' la quita; NULL no la toca.';

revoke execute on function guardar_firma_usuario(uuid, text, text) from public, anon;
grant execute on function guardar_firma_usuario(uuid, text, text) to authenticated;

revoke execute on function pedido_hereda_certificado_captura() from public, anon;
revoke execute on function cotizacion_propaga_certificado_captura() from public, anon;
