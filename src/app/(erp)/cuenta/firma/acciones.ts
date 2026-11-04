'use server';

/**
 * ============================================================================
 *  GUARDAR LA FIRMA DE UN USUARIO (083)
 * ============================================================================
 *  La proforma y el contrato llevan la firma de quien aprobó la cotización
 *  (Oliver: «si aprueba Walter sale la firma de Walter; si aprueba Cathy,
 *  puede salir la de Cathy»). Cada uno sube la suya; Gerencia puede subir la
 *  de otra persona. La regla de verdad está en la base
 *  (guardar_firma_usuario): esto la repite para devolver el mensaje claro.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { nombreRol } from '@/lib/permisosVentas';

type Resultado = { ok: boolean; mensaje: string };

/** ~1,4 MB de imagen: la pantalla ya la reduce a 1600 px de lado. Lo mismo que la base. */
const MAXIMO = 1_900_000;

/**
 * `firma`: la imagen incrustada (PNG/JPG), '' para quitarla o null para no
 * tocarla. `cargo`: el texto que va debajo del nombre, '' para borrarlo o
 * null para no tocarlo.
 */
export async function guardarFirmaUsuario(
  usuarioId: string, firma: string | null, cargo: string | null,
): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró. Vuelva a iniciar sesión.' };
  if (usuarioId !== usuario.id && usuario.rol !== 'gerencia') {
    return {
      ok: false,
      mensaje: `${nombreRol(usuario.rol)} solo puede subir su propia firma: la de otra persona la sube Gerencia.`,
    };
  }

  const f = firma === null ? null : firma.trim();
  if (f) {
    if (!/^data:image\/(png|jpeg);base64,/.test(f)) {
      return { ok: false, mensaje: 'La firma debe ser una imagen PNG o JPG. Otros formatos se ven en pantalla pero salen en blanco en el PDF.' };
    }
    if (f.length > MAXIMO) {
      return { ok: false, mensaje: 'La imagen de la firma es demasiado grande. Recórtela dejando solo el trazo y vuelva a subirla.' };
    }
  }
  const c = cargo === null ? null : cargo.trim().slice(0, 120);

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc('guardar_firma_usuario', {
    p_usuario: usuarioId, p_firma: f, p_cargo: c,
  });
  if (error) {
    //  Los mensajes de la base ya están en castellano (raise exception …).
    const texto = /permission|policy|42501/i.test(`${error.code} ${error.message}`) && !/firma/i.test(error.message)
      ? 'No tiene permiso para cambiar esa firma.'
      : error.message;
    return { ok: false, mensaje: texto };
  }

  revalidatePath('/cuenta/firma');
  const quien = usuarioId === usuario.id ? 'Su firma' : `La firma de ${String(data ?? 'ese usuario')}`;
  if (f === '') return { ok: true, mensaje: `${quien} se quitó. Las proformas que apruebe saldrán con la firma de Gerencia.` };
  if (f) return { ok: true, mensaje: `${quien} quedó guardada. La proforma y el contrato de las cotizaciones que apruebe saldrán con ella.` };
  return { ok: true, mensaje: 'Cargo guardado.' };
}
