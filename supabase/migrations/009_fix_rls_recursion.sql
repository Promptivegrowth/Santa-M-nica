-- ============================================================================
--  SANTA MÓNICA ERP · MIGRACIÓN 009 · CORRECCIÓN DE RECURSIÓN EN RLS
-- ============================================================================
--  Problema detectado en las pruebas:
--
--  La política de lectura decía, en esencia:
--     "puedes leer esta tabla SI existes en la tabla usuarios y estás activo"
--
--  Pero la tabla `usuarios` también tiene seguridad a nivel de fila. Entonces,
--  para comprobar si puedes leer `pedidos`, PostgreSQL necesitaba leer
--  `usuarios`… y para leer `usuarios` necesitaba volver a leer `usuarios`.
--  Recursión. Resultado: el rol Consulta no podía leer absolutamente nada.
--
--  Solución: la comprobación se hace mediante una función SECURITY DEFINER.
--  Ese tipo de función corre con los permisos de quien la creó y por tanto NO
--  vuelve a pasar por las políticas, cortando el círculo.
--
--  Es exactamente el mismo motivo por el que `puede()` ya funcionaba bien: era
--  SECURITY DEFINER desde el principio. A las políticas de lectura les faltaba
--  ese mismo tratamiento.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Función de comprobación, a prueba de recursión
-- ---------------------------------------------------------------------------
create or replace function es_usuario_activo() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from usuarios u where u.id = auth.uid() and u.activo
  );
$$;
comment on function es_usuario_activo is
  'TRUE si quien consulta tiene una cuenta activa. SECURITY DEFINER para evitar la recursión de RLS sobre la tabla usuarios.';

grant execute on function es_usuario_activo() to authenticated;


-- ---------------------------------------------------------------------------
-- 2. Reemplazar la política de lectura en TODAS las tablas
-- ---------------------------------------------------------------------------
do $lectura$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('drop policy if exists "lectura_autenticados" on public.%I;', t.tablename);
    execute format($f$
      create policy "lectura_autenticados" on public.%I
        for select to authenticated
        using ( es_usuario_activo() );
    $f$, t.tablename);
  end loop;
end
$lectura$;


-- ---------------------------------------------------------------------------
-- 3. La tabla usuarios necesita un trato especial
--    Cada persona debe poder leer SIEMPRE su propia ficha, incluso antes de
--    que cualquier otra comprobación se resuelva. Si no, no podría ni saber
--    cuál es su propio rol al entrar al sistema.
-- ---------------------------------------------------------------------------
drop policy if exists "lectura_autenticados" on usuarios;

create policy "usuario_lee_su_ficha" on usuarios
  for select to authenticated
  using ( id = auth.uid() );

create policy "usuario_lee_el_equipo" on usuarios
  for select to authenticated
  using ( es_usuario_activo() );


-- ---------------------------------------------------------------------------
-- 4. Verificación rápida: contamos las políticas de lectura creadas
-- ---------------------------------------------------------------------------
do $verificar$
declare n int;
begin
  select count(*) into n
    from pg_policies
   where schemaname = 'public' and cmd = 'SELECT';
  raise notice 'Políticas de lectura activas: %', n;
end
$verificar$;
