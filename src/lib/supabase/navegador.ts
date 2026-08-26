/**
 * ============================================================================
 *  CLIENTE DE SUPABASE PARA EL NAVEGADOR
 * ============================================================================
 *  Este cliente corre en el navegador del usuario y usa la "clave anónima".
 *
 *  ¿Es seguro que esa clave sea pública? Sí. La clave anónima por sí sola no
 *  permite hacer nada: todo lo que se puede leer o escribir lo deciden las
 *  políticas de seguridad (RLS) que viven dentro de PostgreSQL. Es decir, la
 *  base de datos es la que manda, no el navegador.
 * ============================================================================
 */
import { createBrowserClient } from '@supabase/ssr';

export function crearClienteNavegador() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
