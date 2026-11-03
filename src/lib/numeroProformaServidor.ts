/**
 * ============================================================================
 *  EL NÚMERO DE PROFORMA EN EL SERVIDOR (082)
 * ============================================================================
 *  Lo comparten los dos caminos por los que nace un pedido —directo y
 *  «Convertir en pedido»— y el «Cambiar número» de la ficha.
 *
 *  EL NÚMERO PROPUESTO Y LAS CARRERAS
 *  El formulario muestra el número que propone la base (el siguiente de la
 *  numeración, sin consumirlo). Si la persona NO lo tocó y, mientras llenaba
 *  el formulario, otro pedido se llevó ese número, no tiene sentido rechazarle
 *  el guardado: se le da el siguiente libre y se le dice. Si lo escribió ella,
 *  sí se le rechaza: eligió ese número a propósito y tiene que saber que ya
 *  existe.
 * ============================================================================
 */
import type { crearClienteServidor } from '@/lib/supabase/servidor';
import { normalizarNumeroProforma, problemaNumeroProforma } from '@/lib/numeroProforma';

type Cliente = Awaited<ReturnType<typeof crearClienteServidor>>;

/** El próximo número automático (no lo consume), o null si la base no responde. */
export async function proponerNumeroProforma(supabase: Cliente): Promise<string | null> {
  const { data, error } = await supabase.rpc('proponer_numero_proforma');
  if (error || !data) return null;
  return String(data);
}

export type EleccionNumero =
  | { ok: true; numero: string; automatico: boolean }
  | { ok: false; mensaje: string; campo: 'numero_proforma' };

/**
 * Qué número se va a usar.
 *   escrito === undefined → nadie lo eligió (llamada antigua): el propuesto.
 *   escrito igual al propuesto → «automático»: si lo toman entretanto, el siguiente.
 *   escrito distinto → el de la persona, que tiene que estar libre.
 */
export async function elegirNumeroProforma(
  supabase: Cliente,
  escrito: string | null | undefined,
  propuesto: string | null | undefined,
): Promise<EleccionNumero> {
  if (escrito === undefined || escrito === null) {
    const p = await proponerNumeroProforma(supabase);
    return p
      ? { ok: true, numero: p, automatico: true }
      : { ok: false, mensaje: 'No se pudo calcular el número de proforma. Vuelva a intentarlo.', campo: 'numero_proforma' };
  }

  const numero = normalizarNumeroProforma(escrito);
  const forma = problemaNumeroProforma(numero);
  if (forma) return { ok: false, mensaje: forma, campo: 'numero_proforma' };

  const automatico = !!propuesto && numero === normalizarNumeroProforma(propuesto);

  //  ¿Está libre? La base responde con el mismo texto que usaría al guardar.
  const { data: problema } = await supabase.rpc('problema_numero_proforma', { p_numero: numero });
  if (problema) {
    if (automatico) {
      const p = await proponerNumeroProforma(supabase);
      if (p) return { ok: true, numero: p, automatico: true };
    }
    return { ok: false, mensaje: String(problema), campo: 'numero_proforma' };
  }
  return { ok: true, numero, automatico };
}

/**
 * Inserta la cabecera del pedido con el número elegido. Si el número era el
 * propuesto y otro pedido lo guardó en el mismo instante (el índice único lo
 * rechaza), se prueba con el siguiente libre: hasta tres veces, que en una
 * empresa de este tamaño ya es más que suficiente.
 */
export async function insertarConNumero(
  supabase: Cliente,
  eleccion: { numero: string; automatico: boolean },
  fila: (numero: string) => Record<string, unknown>,
): Promise<{ data: { id: number; numero_proforma: string } | null; error: { code?: string; message?: string } | null; numero: string }> {
  let numero = eleccion.numero;
  for (let intento = 0; ; intento++) {
    const { data, error } = await supabase.from('pedidos').insert(fila(numero)).select('id, numero_proforma').single();
    if (!error || !eleccion.automatico || !esNumeroRepetido(error) || intento >= 3) {
      return { data: data as { id: number; numero_proforma: string } | null, error, numero: String(data?.numero_proforma ?? numero) };
    }
    const siguiente = await proponerNumeroProforma(supabase);
    if (!siguiente || siguiente === numero) return { data: null, error, numero };
    numero = siguiente;
  }
}

/** « (SM26-624 lo tomó otro pedido mientras tanto: quedó con SM26-625.)», o nada. */
export function avisoNumeroTomado(automatico: boolean, propuesto: string | null | undefined, final: string): string {
  if (!automatico || !propuesto) return '';
  const p = normalizarNumeroProforma(propuesto);
  return p && p !== final ? ` ${p} lo tomó otro pedido mientras usted llenaba el formulario: quedó con ${final}.` : '';
}

/** ¿El error es el del índice único del número (dos guardando a la vez)? */
export function esNumeroRepetido(error: { code?: string; message?: string } | null | undefined): boolean {
  return !!error && error.code === '23505' && /numero_proforma/i.test(error.message ?? '');
}

/**
 * Los rechazos que escribe la base para el número (P0001) ya están en
 * castellano y dicen qué hacer: se muestran tal cual. Devuelve null si el
 * error es otro.
 */
export function mensajeDelNumero(error: { code?: string; message?: string } | null | undefined): string | null {
  if (!error) return null;
  if (error.code === 'P0001' && /proforma/i.test(error.message ?? '')) return String(error.message);
  if (esNumeroRepetido(error)) return 'Ese número de proforma lo acaba de tomar otro pedido. Elija otro número.';
  return null;
}
