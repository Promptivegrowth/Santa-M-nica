/**
 * ============================================================================
 *  CÓMO SE NOMBRA UN PRODUCTO EN LA PROFORMA Y EN EL CONTRATO
 * ============================================================================
 *  «Observaciones ERP 4» de Oliver, puntos 02 y 03, con la proforma y el
 *  contrato SM26-384 de KULALIA como modelo:
 *
 *   · Cada línea dice descripción, talla, empaque y condición con/sin punta.
 *     El pedido tenía cuatro productos y el sistema los juntó bajo un solo
 *     nombre («FROZEN GIANT SQUID TENTACLES»): el del FORMATO, que es el mismo
 *     para rejos y reproductores.
 *   · Los REPRODUCTORES (tentáculos sexuales) se venden con otro nombre:
 *     «FROZEN GIANT SQUID SEXUAL TENTACLES, WITH TIP / WITHOUT TIP» y
 *     «REPRODUCTORES DE POTA CONGELADOS, C/PUNTA / S/PUNTA». Solo ellos: el
 *     filete, las alas o los rejos siguen con el nombre normal de su formato.
 *   · Su talla va en CENTÍMETROS: «50CM-UP», «10-30CM».
 *
 *  Se resuelve aquí, en un solo sitio, porque la proforma (PDF y Excel), el
 *  contrato (PDF y Word) y la cotización tienen que llamar al producto IGUAL:
 *  es lo que asegura que las líneas de la proforma y los ítems del contrato
 *  se correspondan (punto 03).
 *
 *  POR QUÉ SE DEDUCE DEL CORTE Y NO SE ESCRIBE EN EL MAESTRO
 *  El maestro de productos que cargó Santa Mónica ya dice qué es cada SKU en
 *  su corte: «REPRODUCTOR C/PUNTA-50UP», «REPRODUCTOR S/PUNTA 10-30». Leerlo
 *  de ahí hace que un reproductor nuevo salga bien sin que nadie tenga que
 *  acordarse de escribirle el nombre en inglés. («C/REPRODUCTOR 0-100» es un
 *  TENTÁCULO con reproductor, no un reproductor: por eso se mira que el corte
 *  EMPIECE por «REPRODUCTOR».)
 * ============================================================================
 */

/** ¿Es un reproductor (tentáculo sexual)? Lo dice el corte, si empieza así. */
export function esReproductor(corte: string | null | undefined): boolean {
  return /^\s*REPRODUCTOR(ES)?\b/i.test(String(corte ?? ''));
}

/** Con punta, sin punta o no se sabe. */
function punta(corte: string): 'con' | 'sin' | null {
  if (/\bS\s*\/\s*PUNTA\b|\bSIN\s+PUNTA\b/i.test(corte)) return 'sin';
  if (/\bC\s*\/\s*PUNTA\b|\bCON\s+PUNTA\b/i.test(corte)) return 'con';
  return null;
}

/**
 * La talla tal como se imprime.
 *
 * La del maestro manda. Si falta —el SKU 173, «REPRODUCTOR C/PUNTA-50UP», no
 * la tiene— se lee del corte, que la trae al final («-50UP», «10-30»). En los
 * reproductores lleva la unidad, como el modelo: «50CM-UP», «10-30CM». En el
 * resto se deja como está, porque su unidad cambia según el producto (gramos
 * en el filete, kilos en la pota entera) y adivinarla sería peor que callarla.
 */
export function tallaImpresa(talla: string | null | undefined, corte: string | null | undefined): string | null {
  const reproductor = esReproductor(corte);
  let t = String(talla ?? '').trim().toUpperCase();
  if (!t) {
    const m = /(\d+\s*-\s*\d+|\d+\s*-?\s*UP)\s*$/i.exec(String(corte ?? '').trim());
    t = m ? m[1].toUpperCase() : '';
  }
  t = t.replace(/\s+/g, '');
  if (!t) return null;
  if (!reproductor || /CM/.test(t)) return t;
  //  «50UP» / «50-UP» → «50CM-UP»; «10-30» → «10-30CM».
  const arriba = /^(\d+)-?UP$/.exec(t);
  if (arriba) return `${arriba[1]}CM-UP`;
  if (/^\d+-\d+$/.test(t)) return `${t}CM`;
  return t;
}

/**
 * El nombre comercial en inglés y en castellano.
 *
 * Por defecto, el del formato tal como está escrito en el maestro (042):
 * «FROZEN GIANT SQUID FILLET» / «FILETE DE POTA CONGELADO». Los reproductores,
 * con el suyo y su condición de punta.
 */
export function nombreComercial(p: {
  corte: string | null | undefined;
  formatoEn: string | null | undefined;
  formatoEs: string | null | undefined;
}): { en: string; es: string; reproductor: boolean } {
  const corte = String(p.corte ?? '');
  if (esReproductor(corte)) {
    const cual = punta(corte);
    return {
      en: `FROZEN GIANT SQUID SEXUAL TENTACLES${cual === 'con' ? ', WITH TIP' : cual === 'sin' ? ', WITHOUT TIP' : ''}`,
      es: `REPRODUCTORES DE POTA CONGELADOS${cual === 'con' ? ', C/PUNTA' : cual === 'sin' ? ', S/PUNTA' : ''}`,
      reproductor: true,
    };
  }
  return {
    en: String(p.formatoEn ?? '').trim().toUpperCase(),
    es: String(p.formatoEs ?? '').trim().toUpperCase(),
    reproductor: false,
  };
}

/**
 * Cuántos sacos (bultos) son unos kilos.
 *
 * Al entero MÁS CERCANO, como el modelo: 19 000 kg en sacos de 30 son 633
 * sacos (18 990 kg), no 634. Antes se redondeaba hacia arriba y la proforma
 * decía 634 donde Santa Mónica escribe 633: el peso neto que se pacta es el
 * de la columna NET WEIGHT, y la tolerancia (±10 %) absorbe la fracción.
 */
export function bultosDe(kg: number, pesoBultoKg: number): number {
  return pesoBultoKg > 0 ? Math.round(kg / pesoBultoKg) : 0;
}

/** Un peso de saco o de bloque sin ceros que sobran: 20 → «20», 7,5 → «7.5». */
export function pesoCorto(kg: number): string {
  return String(Number(Number(kg ?? 0).toFixed(3)));
}

/**
 * El país del puerto de descarga, en inglés.
 *
 * El maestro de destinos los tiene en castellano («España»), y la proforma y
 * el contrato los dicen en inglés: «CFR VIGO, SPAIN». La línea en castellano
 * del contrato sigue diciendo «VIGO, ESPAÑA». Si el país no está en la lista
 * (un destino nuevo escrito a mano), se deja como está, en mayúsculas.
 */
const PAISES_EN: Record<string, string> = {
  ALEMANIA: 'GERMANY', ARGENTINA: 'ARGENTINA', AUSTRALIA: 'AUSTRALIA', BELGICA: 'BELGIUM', BRASIL: 'BRAZIL',
  BULGARIA: 'BULGARIA', CAMERUN: 'CAMEROON', CANADA: 'CANADA', CHILE: 'CHILE', CHINA: 'CHINA', CHIPRE: 'CYPRUS',
  COLOMBIA: 'COLOMBIA', 'COREA DEL SUR': 'SOUTH KOREA', COREA: 'SOUTH KOREA', 'COSTA DE MARFIL': 'IVORY COAST',
  'COSTA RICA': 'COSTA RICA', CROACIA: 'CROATIA', DINAMARCA: 'DENMARK', ECUADOR: 'ECUADOR', EGIPTO: 'EGYPT',
  'EMIRATOS ARABES UNIDOS': 'UNITED ARAB EMIRATES', ESLOVENIA: 'SLOVENIA', ESPANA: 'SPAIN',
  'ESTADOS UNIDOS': 'UNITED STATES', EEUU: 'UNITED STATES', ESTONIA: 'ESTONIA', FILIPINAS: 'PHILIPPINES',
  FINLANDIA: 'FINLAND', FRANCIA: 'FRANCE', GHANA: 'GHANA', GRECIA: 'GREECE', GUATEMALA: 'GUATEMALA',
  HOLANDA: 'NETHERLANDS', 'PAISES BAJOS': 'NETHERLANDS', 'HONG KONG': 'HONG KONG', INDIA: 'INDIA',
  INDONESIA: 'INDONESIA', IRLANDA: 'IRELAND', ISRAEL: 'ISRAEL', ITALIA: 'ITALY', JAPON: 'JAPAN', LETONIA: 'LATVIA',
  LIBERIA: 'LIBERIA', LITUANIA: 'LITHUANIA', MALASIA: 'MALAYSIA', MALTA: 'MALTA', MARRUECOS: 'MOROCCO',
  MEXICO: 'MEXICO', NIGERIA: 'NIGERIA', NORUEGA: 'NORWAY', 'NUEVA ZELANDA': 'NEW ZEALAND', PANAMA: 'PANAMA',
  PERU: 'PERU', POLONIA: 'POLAND', PORTUGAL: 'PORTUGAL', 'PUERTO RICO': 'PUERTO RICO', 'REINO UNIDO': 'UNITED KINGDOM',
  'REPUBLICA DOMINICANA': 'DOMINICAN REPUBLIC', 'REPUBLICA CHECA': 'CZECH REPUBLIC', RUMANIA: 'ROMANIA', RUSIA: 'RUSSIA',
  SENEGAL: 'SENEGAL', SINGAPUR: 'SINGAPORE', SUDAFRICA: 'SOUTH AFRICA', SUECIA: 'SWEDEN', TAILANDIA: 'THAILAND',
  TAIWAN: 'TAIWAN', TURQUIA: 'TURKEY', UCRANIA: 'UKRAINE', URUGUAY: 'URUGUAY', VIETNAM: 'VIETNAM',
};

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

export function paisEnIngles(pais: string | null | undefined): string {
  const limpio = sinTildes(String(pais ?? ''));
  return PAISES_EN[limpio] ?? String(pais ?? '').trim().toUpperCase();
}

/** «Vigo» + «España» → «VIGO, SPAIN» (inglés) o «VIGO, ESPAÑA» (castellano). */
export function puertoDestino(puerto: unknown, pais: unknown, idioma: 'en' | 'es'): string {
  const p = String(puerto ?? '').trim();
  const pa = String(pais ?? '').trim();
  return [p, idioma === 'en' ? paisEnIngles(pa) : pa].filter(Boolean).join(', ').toUpperCase();
}

/** Los países de la Unión Europea, que exige certificado de captura (Reglamento CE 1005/2008). */
const UNION_EUROPEA = ['ALEMANIA', 'AUSTRIA', 'BELGICA', 'BULGARIA', 'CHIPRE', 'CROACIA', 'DINAMARCA', 'ESLOVAQUIA',
  'ESLOVENIA', 'ESPANA', 'ESTONIA', 'FINLANDIA', 'FRANCIA', 'GRECIA', 'HUNGRIA', 'IRLANDA', 'ITALIA', 'LETONIA',
  'LITUANIA', 'LUXEMBURGO', 'MALTA', 'PAISES BAJOS', 'HOLANDA', 'POLONIA', 'PORTUGAL', 'REPUBLICA CHECA', 'RUMANIA',
  'SUECIA'];

/**
 * ¿Lleva certificado de captura? (punto 05)
 *
 * Lo decide la cotización (y el pedido, que lo hereda). Solo cuando nadie lo
 * decidió —registros anteriores a la 083— se propone para la Unión Europea,
 * que es la regla que había: así lo ya emitido no cambia por debajo.
 */
export function llevaCertificadoCaptura(decidido: boolean | null | undefined, paisDestino: string | null | undefined): boolean {
  if (decidido === true || decidido === false) return decidido;
  return UNION_EUROPEA.includes(sinTildes(String(paisDestino ?? '')));
}

const MESES_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December'];

/**
 * «2026-11-03» → «November 03, 2026», como la proforma del modelo. Se lee el
 * texto de la fecha tal cual (sin `new Date`), para no correr de día por el
 * huso horario. Un instante (con hora) se pasa antes a la fecha de Lima.
 */
export function fechaEnIngles(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  if (!m) return '';
  return `${MESES_EN[Number(m[2]) - 1]} ${m[3]}, ${m[1]}`;
}
