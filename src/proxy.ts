/**
 * ============================================================================
 *  PROXY DE AUTENTICACIÓN
 * ============================================================================
 *  Corre ANTES de cada petición y hace dos cosas:
 *
 *   1. Refresca la sesión de Supabase (los tokens caducan; si no se renuevan,
 *      el usuario se desconectaría solo a mitad de una jornada de trabajo).
 *
 *   2. Protege las rutas: si alguien intenta entrar a una pantalla del ERP sin
 *      haber iniciado sesión, lo manda al login.
 *
 *  NOTA DE NEXT 16: lo que antes se llamaba "middleware" ahora se llama
 *  "proxy", y la función exportada debe llamarse `proxy`. El runtime es
 *  Node.js y no es configurable.
 * ============================================================================
 */
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/** Rutas que se pueden visitar sin haber iniciado sesión. */
const RUTAS_PUBLICAS = ['/login', '/auth'];

export async function proxy(request: NextRequest) {
  let respuesta = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(porGuardar) {
          porGuardar.forEach(({ name, value }) => request.cookies.set(name, value));
          respuesta = NextResponse.next({ request });
          porGuardar.forEach(({ name, value, options }) =>
            respuesta.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANTE: getUser() valida el token contra el servidor de Supabase.
  // No usar getSession() aquí: ese solo lee la cookie y se puede falsificar.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const ruta = request.nextUrl.pathname;
  const esPublica = RUTAS_PUBLICAS.some((r) => ruta.startsWith(r));

  // Sin sesión y pidiendo algo protegido
  if (!user && !esPublica) {
    // Las rutas de API deben responder con un error, NO con una redirección.
    // Si redirigiéramos, un programa que consuma la API recibiría la página de
    // login con código 200 y creería que la llamada funcionó.
    if (ruta.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'No autenticado. Inicie sesión para acceder a este recurso.' },
        { status: 401 }
      );
    }

    const destino = request.nextUrl.clone();
    destino.pathname = '/login';
    // Guardamos a dónde quería ir, para devolverlo ahí después de entrar
    destino.searchParams.set('destino', ruta);
    return NextResponse.redirect(destino);
  }

  // Con sesión y entrando al login → directo al panel
  if (user && ruta === '/login') {
    const destino = request.nextUrl.clone();
    destino.pathname = '/panel';
    destino.search = '';
    return NextResponse.redirect(destino);
  }

  return respuesta;
}

export const config = {
  matcher: [
    /*
     * Se aplica a todo MENOS a los archivos estáticos y las imágenes, que no
     * necesitan comprobación de sesión y solo añadirían latencia.
     */
    '/((?!_next/static|_next/image|favicon.ico|logo.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
