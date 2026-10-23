-- ============================================================================
--  072 · NADIE LEE NI EJECUTA NADA SIN INICIAR SESIÓN
-- ============================================================================
--  La clave «anónima» de Supabase no es secreta: viaja en el navegador de
--  cualquiera que abra la pantalla de acceso. Supabase, por defecto, le da a
--  ese rol (anon) permiso de lectura sobre todo lo que se crea en «public», y
--  la seguridad queda a cargo de las políticas RLS de cada TABLA.
--
--  El problema: las VISTAS corren con los permisos de su dueño, no con los de
--  quien consulta, así que no pasan por esas políticas. Con la clave anónima,
--  y sin iniciar sesión, se podían leer 48 vistas (cuentas por cobrar,
--  clientes, márgenes…) y ejecutar funciones como el buscador universal o la
--  trazabilidad de lotes. Lo encontró la revisión hecha para la Guía de uso.
--
--  El ERP no tiene ninguna pantalla pública: la de acceso solo usa el inicio
--  de sesión de Supabase (que no pasa por estos permisos). Por eso se le quita
--  al rol anónimo TODO permiso sobre tablas, vistas, secuencias y funciones del
--  esquema, y también los permisos por defecto de lo que se cree en adelante.
--
--  Las funciones que hoy ejecuta un usuario con sesión (rol authenticated)
--  siguen pudiendo ejecutarse: antes de quitarle el permiso a PUBLIC se le da
--  explícitamente a authenticated, solo a las que ya lo tenían. Las que eran
--  solo para procesos programados siguen igual de cerradas.
--
--  Re-ejecutable: conviene volver a aplicarla después de cualquier migración
--  que cree vistas o funciones nuevas.
-- ============================================================================

do $$
declare
  r record;
begin
  /* ---- Tablas, vistas, vistas materializadas y tablas foráneas ---- */
  for r in
    select c.oid::regclass as objeto
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'v', 'm', 'p', 'f')
  loop
    execute format('revoke all on %s from anon', r.objeto);
  end loop;

  /* ---- Secuencias ---- */
  for r in
    select c.oid::regclass as objeto
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'S'
  loop
    execute format('revoke all on sequence %s from anon', r.objeto);
  end loop;

  /*
   * ---- Funciones ----
   * Por defecto PostgreSQL da EXECUTE a PUBLIC (todos los roles, anon
   * incluido). Se conserva el acceso de authenticated donde ya existía y se
   * retira el de PUBLIC y anon.
   */
  for r in
    select p.oid::regprocedure as firma,
           has_function_privilege('authenticated', p.oid, 'execute') as con_sesion
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind in ('f', 'p')
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')  -- no las de extensiones
  loop
    if r.con_sesion then
      execute format('grant execute on function %s to authenticated', r.firma);
    end if;
    execute format('grant execute on function %s to service_role', r.firma);
    execute format('revoke execute on function %s from public, anon', r.firma);
  end loop;
end $$;

/* ---- Lo que se cree de aquí en adelante tampoco nace abierto a anon ---- */
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;
alter default privileges for role postgres in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema public grant execute on functions to authenticated, service_role;
