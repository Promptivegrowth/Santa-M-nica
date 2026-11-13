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

/**
 * 13/11 · No todo lo que lanza una acción es la red. Si el servidor se cayó a
 * mitad (un archivo que no se pudo procesar, el tiempo máximo de la petición),
 * decir «revise su internet» manda a buscar el problema donde no está. Se
 * distinguen las dos cosas, y el fallo del servidor lleva su referencia
 * (el «digest» de Next) para poder encontrarlo en los registros.
 */
export const MENSAJE_FALLO_SERVIDOR =
  'El sistema tuvo un problema al procesar el pedido y no pudo terminar. Recargue la pantalla (F5) ' +
  'para ver si se guardó algo antes de volver a intentarlo; si se repite, avise a soporte con la referencia.';

export type FalloConexion = {
  ok: false; mensaje: string; sinConexion: true;
  /** «conexion»: no llegó la respuesta; «servidor»: llegó, pero el servidor falló. */
  tipo: 'conexion' | 'servidor';
  referencia?: string;
};

export async function accionSegura<T>(accion: () => Promise<T>): Promise<T | FalloConexion> {
  try {
    return await accion();
  } catch (e) {
    //  Una redirección o un «no encontrado» del propio Next no son fallos de red: se dejan pasar.
    const digest = (e as { digest?: string })?.digest ?? '';
    if (digest.startsWith('NEXT_REDIRECT') || digest.startsWith('NEXT_NOT_FOUND')) throw e;
    const sinRed = (typeof navigator !== 'undefined' && navigator.onLine === false) ||
      (e instanceof TypeError && /fetch|network|load failed/i.test(e.message));
    console.error(sinRed ? 'La acción no llegó al servidor:' : 'La acción falló en el servidor:', e);
    return sinRed || !digest
      ? { ok: false, mensaje: MENSAJE_SIN_CONEXION, sinConexion: true, tipo: 'conexion' }
      : { ok: false, mensaje: MENSAJE_FALLO_SERVIDOR, sinConexion: true, tipo: 'servidor', referencia: digest };
  }
}
