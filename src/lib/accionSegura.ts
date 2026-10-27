/**
 * ============================================================================
 *  LLAMAR A UNA ACCIÓN DEL SERVIDOR SIN QUE UN CORTE DE RED ROMPA LA PANTALLA
 * ============================================================================
 *  Una acción del servidor que no llega (se cortó el internet, el servidor
 *  tardó demasiado) no devuelve { ok: false }: LANZA un error. Dentro de un
 *  startTransition ese error sube hasta la frontera de error y el usuario ve
 *  «No se pudo cargar esta pantalla», pierde lo que estaba llenando y no sabe
 *  si se guardó o no. Pasó en vivo al programar un embarque.
 *
 *  Con esto el fallo de red vuelve como un resultado más, con un mensaje que
 *  se muestra en el mismo formulario y deja los datos donde estaban:
 *
 *      const r = await accionSegura(() => crearEmbarque(datos));
 *      if (!r.ok) { setProblema({ mensaje: r.mensaje }); return; }
 *
 *  No se puede saber si el servidor alcanzó a guardar antes de que se cortara
 *  la respuesta, así que el mensaje no promete que «no se guardó nada»: pide
 *  recargar y mirar antes de repetir, para no duplicar un registro.
 * ============================================================================
 */

export const MENSAJE_SIN_CONEXION =
  'Se perdió la conexión con el sistema antes de recibir la respuesta. Revise su internet y ' +
  'recargue la pantalla (F5) para ver si se guardó antes de volver a intentarlo.';

export type FalloConexion = { ok: false; mensaje: string; sinConexion: true };

export async function accionSegura<T>(accion: () => Promise<T>): Promise<T | FalloConexion> {
  try {
    return await accion();
  } catch (e) {
    //  Una redirección o un «no encontrado» del propio Next no son fallos de red: se dejan pasar.
    const digest = (e as { digest?: string })?.digest ?? '';
    if (digest.startsWith('NEXT_REDIRECT') || digest.startsWith('NEXT_NOT_FOUND')) throw e;
    console.error('La acción no llegó al servidor:', e);
    return { ok: false, mensaje: MENSAJE_SIN_CONEXION, sinConexion: true };
  }
}
