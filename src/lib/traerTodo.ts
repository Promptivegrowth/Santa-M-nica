/**
 * ============================================================================
 *  TRAER TODAS LAS FILAS, NO LAS PRIMERAS MIL
 * ============================================================================
 *  LA TRAMPA
 *  La API de Supabase devuelve como mucho MIL FILAS por consulta, y ese tope
 *  NO se puede subir desde el cliente: pedir `.limit(5000)` sigue devolviendo
 *  mil. Tampoco avisa — no hay error, no hay bandera— simplemente llegan menos
 *  filas de las que hay.
 *
 *  Eso convierte cualquier «traigo todo y lo sumo en la pantalla» en una bomba
 *  silenciosa: el total sale, parece razonable y le falta un pedazo. En este
 *  proyecto ya mordió tres veces —las tarjetas de anticuamiento decían 26
 *  pallets vencidos cuando había 47, el gráfico de existencias se pintaba con
 *  dos tercios del inventario, y el valor del inventario valorizado sumaba
 *  1 000 lotes de 1 519—.
 *
 *  CUÁNDO USAR ESTO Y CUÁNDO NO
 *  Si lo que se necesita es un total sobre datos FIJOS, lo correcto es una
 *  vista que agrupe en la base: no hace viajar mil quinientas filas para
 *  pintar cuatro cifras.
 *
 *  Esta función es para el otro caso: cuando el total depende de FILTROS que
 *  elige el usuario y no se puede precalcular. Pagina hasta agotar y devuelve
 *  todo.
 * ============================================================================
 */

/** El tope real de la API. Comprobado, no supuesto: `scripts/auditar-limite-filas.mjs`. */
export const TOPE_FILAS = 1000;

/**
 * Recorre una consulta por páginas hasta traerla entera.
 *
 * `hacerConsulta` recibe el rango y devuelve la consulta ya construida. Se
 * pasa como función y no como objeto porque un constructor de consultas de
 * Supabase no se puede reutilizar: al ejecutarlo se consume.
 *
 * @example
 *   const filas = await traerTodo((desde, hasta) =>
 *     supabase.from('v_anticuamiento').select('valor').gt('fisico_kg', 0).range(desde, hasta)
 *   );
 */
export async function traerTodo<T>(
  hacerConsulta: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  /**
   * Tope de seguridad. Sin él, un error en la consulta podría convertirse en
   * un bucle que se trae la tabla entera una y otra vez.
   */
  maximo = 50_000
): Promise<T[]> {
  const todas: T[] = [];

  for (let desde = 0; desde < maximo; desde += TOPE_FILAS) {
    const { data, error } = await hacerConsulta(desde, desde + TOPE_FILAS - 1);
    if (error || !data) break;

    todas.push(...data);

    // Menos de una página completa significa que ya no hay más.
    if (data.length < TOPE_FILAS) break;
  }

  return todas;
}
