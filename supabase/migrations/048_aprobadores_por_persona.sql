-- ============================================================================
--  048 · QUIÉN APRUEBA COTIZACIONES ES UNA PERSONA, NO UN ROL
-- ============================================================================
--  LO QUE PREGUNTAMOS Y LO QUE RESPONDIÓ
--  En la reunión Oliver dijo «es comercial, los Walter, prácticamente el
--  dueño», y acto seguido «y Marco también». Yo lo implementé como permiso del
--  rol GERENCIA, con este razonamiento en el código: si quien redacta la
--  oferta es también quien la autoriza, el control no sirve de nada.
--
--  Se lo volvimos a preguntar y contestó:
--
--    «Aprueba Gerente, Cathy Lee y Marco León.»
--
--  Tres personas con nombre y apellido. Y Cathy Lee es Jefe Comercial y
--  Exportaciones —firma las proformas—, o sea que SÍ aprueba alguien de
--  Comercial.
--
--  POR QUÉ NO BASTA CON ABRIR EL ROL
--  Si le doy el permiso al rol «comercial» entero, cualquier vendedor podría
--  aprobar sus propias cotizaciones y el control desaparece, que es justo lo
--  que argumenté para dejarlo en Gerencia. Pero dejarlo solo en Gerencia
--  tampoco es lo que él pidió.
--
--  La respuesta es que esto no es un permiso de ROL: es una FACULTAD DE
--  PERSONA. En una empresa real, aprobar una oferta es algo que se delega en
--  alguien concreto, no en un cargo. Que Cathy Lee pueda aprobar no significa
--  que pueda hacerlo todo el que trabaje en Comercial.
--
--  Por eso va como una marca en el usuario, y se administra desde la pantalla
--  de usuarios: cuando Cathy Lee deje el puesto, se le quita a ella y se le da
--  a quien la reemplace, sin tocar código ni cambiarle el rol a nadie.
-- ============================================================================
alter table usuarios
  add column if not exists aprueba_cotizaciones boolean not null default false;

comment on column usuarios.aprueba_cotizaciones is
  'Si esta persona puede aprobar cotizaciones. Es una facultad personal, no del rol: Oliver nombró a tres personas concretas —Gerente, Cathy Lee y Marco León—, y abrir el permiso a todo el rol Comercial dejaría que cualquier vendedor aprobara sus propias ofertas.';

--  Gerencia la tiene por defecto: es el cargo que responde por el precio.
--  Los demás se marcan uno a uno desde la pantalla de usuarios.
update usuarios set aprueba_cotizaciones = true where rol = 'gerencia';

--  Y una función para que las políticas y las pantallas pregunten lo mismo.
create or replace function puede_aprobar_cotizaciones()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select aprueba_cotizaciones from usuarios where id = auth.uid()),
    false
  );
$$;

comment on function puede_aprobar_cotizaciones is
  'Si quien está conectado puede aprobar cotizaciones. Existe para que la pantalla, la acción del servidor y las políticas de la base respondan exactamente a la misma pregunta.';
