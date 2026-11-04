/**
 * ============================================================================
 *  EL N.º DE PACKING (PL) · cómo se escribe y qué lo hace inválido (084)
 * ============================================================================
 *  «Observaciones ERP 4», punto 13: «permitir modificar el número de despacho,
 *  ya que actualmente ya tenemos un correlativo». Ese correlativo es la columna
 *  «OPERACIÓN DESPACHOS (PL)» de su base anterior —PL POT1111, PL POT1123…—,
 *  el número con que Santa Mónica llama a cada contenedor que sale.
 *
 *  Estas funciones no tocan la base: sirven en la pantalla (avisar al
 *  escribir) y en el servidor (comprobar antes de guardar). La última palabra
 *  la tiene la base, con los MISMOS textos (problema_numero_packing, 084).
 *
 *  LAS REGLAS
 *   · Mayúsculas, sin espacios a los lados y uno solo entre palabras.
 *   · En la serie de la casa («PL POT» + número) con tres cifras como mínimo;
 *     «PLPOT1124» se entiende como «PL POT1124».
 *   · No vacío, hasta 30 caracteres, letras/números/espacio/guion/punto/guion
 *     bajo y al menos una cifra.
 *   · Único entre embarques vivos y contenedores (eso solo lo dice la base).
 * ============================================================================
 */

export const LARGO_MAX_PACKING = 30;

/** Como se guarda: «pl  pot1124 » → «PL POT1124». Vacío → ''. */
export function normalizarNumeroPacking(texto: string | null | undefined): string {
  const v = String(texto ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
  const m = /^PLPOT(\d+)$/.exec(v.replace(/ /g, ''));
  if (!m) return v;
  const cifras = m[1].replace(/^0+/, '') || '0';
  return `PL POT${cifras.padStart(3, '0')}`;
}

/** Qué le pasa al número, o null si su forma está bien (no sabe si está repetido). */
export function problemaNumeroPacking(texto: string | null | undefined): string | null {
  const v = normalizarNumeroPacking(texto);
  if (!v) return 'Escriba el N.º de packing (por ejemplo PL POT1124).';
  if (v.length > LARGO_MAX_PACKING) {
    return `El N.º de packing puede tener hasta ${LARGO_MAX_PACKING} caracteres (este tiene ${v.length}).`;
  }
  if (!/^[A-Z0-9][A-Z0-9 ._-]*$/.test(v)) {
    return 'El N.º de packing solo puede llevar letras sin tilde, números, espacios, guion (-), punto (.) o guion bajo (_). Ejemplo: PL POT1124.';
  }
  if (!/[0-9]/.test(v)) return 'El N.º de packing tiene que llevar al menos una cifra (por ejemplo PL POT1124).';
  return null;
}

/** El número de la serie PL POT, o null si no es de la serie. */
export function cifraNumeroPacking(texto: string | null | undefined): number | null {
  const m = /^PLPOT(\d{1,7})$/.exec(normalizarNumeroPacking(texto).replace(/ /g, ''));
  return m ? Number(m[1]) : null;
}

/**
 * Si lo escrito es de la serie y va POR ENCIMA del propuesto, la numeración
 * automática seguirá desde ahí al guardar. Se avisa antes: un dedo de más
 * (PL POT11240) movería la numeración de todos.
 */
export function avisoSaltoPacking(escrito: string, propuesto: string | null | undefined): string | null {
  const e = cifraNumeroPacking(escrito);
  const p = cifraNumeroPacking(propuesto);
  if (e === null || p === null || e <= p) return null;
  return `Es mayor que el próximo automático (${normalizarNumeroPacking(propuesto)}): al guardar, la numeración ` +
    `seguirá desde PL POT${String(e + 1).padStart(3, '0')}. Si no es el número real, corríjalo antes de guardar.`;
}

/**
 * La semana ISO de una fecha 'AAAA-MM-DD' (la misma que calcula la base con
 * `extract(week from …)`): la semana va de lunes a domingo y la semana 1 es
 * la que tiene el primer jueves del año.
 */
export function semanaIso(fechaIso: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fechaIso ?? ''));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const dia = d.getUTCDay() || 7;            // lunes = 1 … domingo = 7
  d.setUTCDate(d.getUTCDate() + 4 - dia);    // el jueves de esa semana
  const inicio = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - inicio.getTime()) / 86400000 + 1) / 7);
}
