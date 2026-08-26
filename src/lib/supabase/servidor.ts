/**
 * ============================================================================
 *  CLIENTE DE SUPABASE PARA EL SERVIDOR
 * ============================================================================
 *  Se usa en los Server Components y en las Server Actions de Next.js.
 *
 *  Diferencia clave con el cliente del navegador: aquí leemos y escribimos las
 *  cookies de sesión, para que el servidor sepa quién está conectado y las
 *  políticas de seguridad de la base de datos apliquen el rol correcto.
 *
 *  NOTA DE NEXT 16: cookies() es asíncrono. Por eso esta función es async y
 *  siempre hay que esperarla con await.
 * ============================================================================
 */
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function crearClienteServidor() {
  const almacenCookies = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return almacenCookies.getAll();
        },
        setAll(porGuardar) {
          try {
            porGuardar.forEach(({ name, value, options }) =>
              almacenCookies.set(name, value, options)
            );
          } catch {
            // Los Server Components no pueden escribir cookies. No es un error:
            // el proxy (src/proxy.ts) ya se encarga de refrescar la sesión.
          }
        },
      },
    }
  );
}

/**
 * Devuelve el usuario conectado junto con su ficha de negocio (nombre y rol).
 * Si no hay sesión válida, devuelve null.
 */
export async function obtenerUsuarioActual() {
  const supabase = await crearClienteServidor();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: ficha } = await supabase
    .from('usuarios')
    .select('id, nombre, email, rol, almacen_id, activo')
    .eq('id', user.id)
    .single();

  if (!ficha || !ficha.activo) return null;
  return ficha;
}
