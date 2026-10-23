/**
 * ============================================================================
 *  LEER UN NÚMERO TAL COMO LO ESCRIBE UNA PERSONA
 * ============================================================================
 *  EL PROBLEMA
 *  En el Perú se escribe «12,5» y «12.5» para lo mismo, y los miles se separan
 *  con punto, con coma o con nada. `Number('12,5')` da NaN, y la casilla del
 *  cierre resolvía eso BORRANDO las comas: «12,5» se guardaba como 125 y
 *  «535,641» como 535 641. Sin error, sin aviso.
 *
 *  LA REGLA (una sola, para todas las casillas)
 *    · Con punto Y coma, el separador que va ÚLTIMO es el decimal y el otro
 *      es de miles: «1.234,5» y «1,234.5» son 1234,5.
 *    · Con un solo tipo de separador que se repite, son miles: «1.234.567».
 *    · Con un solo separador, una vez:
 *        - si después NO hay exactamente tres cifras, es el decimal:
 *          «12,5», «12.5», «0,25», «1234,56»;
 *        - si hay exactamente tres cifras y delante entre una y tres que no
 *          empiezan por cero («1,234», «535.641»), NO SE SABE: puede ser
 *          535 mil o 535 con 641 milésimas. Se devuelve `ambiguo` con las dos
 *          lecturas, y quien llama le pregunta a la persona. Adivinar aquí es
 *          justo lo que causaba el error.
 *    · Los grupos de miles tienen que ser de tres cifras: «1.23,5» no es un
 *      número, y se dice.
 *    · Los espacios se ignoran («1 234,5»). Se acepta el signo menos; si el
 *      dato no admite negativos, lo rechaza quien guarda.
 *
 *  Función pura y sin dependencias: la usan componentes de cliente y la
 *  prueba `scripts/probar-analisis-limitaciones.mjs` la ejecuta con casos.
 * ============================================================================
 */

export type LecturaNumero =
  | { tipo: 'vacio' }
  | { tipo: 'numero'; valor: number }
  | { tipo: 'ambiguo'; comoDecimal: number; comoMiles: number }
  | { tipo: 'invalido' };

/** ¿Son grupos de miles bien formados? «1», «12», «123» delante y luego de a tres. */
function gruposDeMiles(partes: string[]): boolean {
  if (partes.length < 2) return true;
  if (!/^\d{1,3}$/.test(partes[0])) return false;
  return partes.slice(1).every((p) => /^\d{3}$/.test(p));
}

export function leerNumero(texto: string): LecturaNumero {
  //  Espacios normales, de no separación y finos: nadie los escribe a
  //  propósito como parte del número.
  const limpio = texto.replace(/[\s  ]/g, '');
  if (limpio === '') return { tipo: 'vacio' };

  const m = /^([+-]?)([\d.,]+)$/.exec(limpio);
  if (!m) return { tipo: 'invalido' };
  const signo = m[1] === '-' ? -1 : 1;
  const cuerpo = m[2];
  if (!/\d/.test(cuerpo)) return { tipo: 'invalido' };

  const final = (entero: string, decimales: string): LecturaNumero => {
    const n = Number(`${entero || '0'}.${decimales || '0'}`);
    return Number.isFinite(n) ? { tipo: 'numero', valor: signo * n } : { tipo: 'invalido' };
  };

  const tienePunto = cuerpo.includes('.');
  const tieneComa = cuerpo.includes(',');

  /* ---- Sin separadores: un entero ---- */
  if (!tienePunto && !tieneComa) return final(cuerpo, '');

  /* ---- Los dos: el último es el decimal ---- */
  if (tienePunto && tieneComa) {
    const ultimo = Math.max(cuerpo.lastIndexOf('.'), cuerpo.lastIndexOf(','));
    const decimal = cuerpo[ultimo];
    const miles = decimal === '.' ? ',' : '.';
    const entera = cuerpo.slice(0, ultimo);
    const decimales = cuerpo.slice(ultimo + 1);
    //  El decimal solo puede aparecer una vez, y nunca antes que un separador de miles.
    if (entera.includes(decimal) || !/^\d*$/.test(decimales)) return { tipo: 'invalido' };
    const grupos = entera.split(miles);
    if (!gruposDeMiles(grupos)) return { tipo: 'invalido' };
    return final(grupos.join(''), decimales);
  }

  /* ---- Un solo tipo de separador ---- */
  const sep = tienePunto ? '.' : ',';
  const partes = cuerpo.split(sep);

  //  Repetido: separador de miles («1.234.567»).
  if (partes.length > 2) {
    return gruposDeMiles(partes) ? final(partes.join(''), '') : { tipo: 'invalido' };
  }

  //  Una sola vez.
  const [entera, decimales] = partes;
  const pareceMiles = decimales.length === 3 && /^[1-9]\d{0,2}$/.test(entera);
  if (pareceMiles) {
    const comoDecimal = final(entera, decimales);
    const comoMiles = final(entera + decimales, '');
    if (comoDecimal.tipo !== 'numero' || comoMiles.tipo !== 'numero') return { tipo: 'invalido' };
    return { tipo: 'ambiguo', comoDecimal: comoDecimal.valor, comoMiles: comoMiles.valor };
  }
  return final(entera, decimales);
}

/**
 * Un número escrito de forma que no se pueda leer de dos maneras: miles con
 * espacio fino y decimales con coma («535 641» / «535,641»). Para preguntarle
 * a la persona qué quiso decir sin volver a crear la misma duda.
 */
export function numeroSinDuda(n: number, decimales = 3): string {
  const [entera, frac] = Math.abs(n).toFixed(decimales).split('.');
  const conMiles = entera.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const fracLimpia = (frac ?? '').replace(/0+$/, '');
  return `${n < 0 ? '−' : ''}${conMiles}${fracLimpia ? `,${fracLimpia}` : ''}`;
}
