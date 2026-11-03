/**
 * ============================================================================
 *  EL NÚMERO DE PROFORMA · cómo se escribe y qué lo hace inválido (082)
 * ============================================================================
 *  Oliver pidió «poder modificar el número de Proforma»: Santa Mónica tiene su
 *  propia numeración (SM26-144, SM26-026…) y el sistema tiene que poder seguirla.
 *
 *  Estas funciones no tocan la base: sirven igual en la pantalla (avisar al
 *  escribir) y en el servidor (comprobar antes de guardar). La última palabra
 *  la tiene la base, con los MISMOS textos (problema_numero_proforma, migración
 *  082), así que el usuario lee lo mismo lo detecte quien lo detecte.
 *
 *  LAS REGLAS
 *   · Se guarda en mayúsculas y sin espacios («sm26 - 390» → SM26-390).
 *   · En la serie del sistema (SM + año + guion + número), con tres cifras como
 *     mínimo, que es como lo escribe Santa Mónica: SM26-26 → SM26-026.
 *   · No vacío, hasta 30 caracteres, letras/números/guion/punto/guion bajo, al
 *     menos una cifra, y sin barra: la barra separa el contenedor (SM26-225/3).
 *   · Único (eso solo lo puede decir la base).
 * ============================================================================
 */

/** Largo máximo de un número de proforma, ya normalizado. */
export const LARGO_MAX_PROFORMA = 30;

/** Como se guarda: en mayúsculas, sin espacios y, en la serie SMaa-n, con tres cifras. */
export function normalizarNumeroProforma(texto: string | null | undefined): string {
  const v = String(texto ?? '').replace(/\s+/g, '').toUpperCase();
  const m = /^SM(\d{2})-(\d+)$/.exec(v);
  if (!m) return v;
  const cifras = m[2].replace(/^0+/, '') || '0';
  return `SM${m[1]}-${cifras.padStart(3, '0')}`;
}

/**
 * Qué le pasa al número (ya normalizado o no), o null si su forma está bien.
 * No sabe si está repetido: eso lo dice el servidor.
 */
export function problemaNumeroProforma(texto: string | null | undefined): string | null {
  const v = normalizarNumeroProforma(texto);
  if (!v) return 'Escriba el número de proforma.';
  if (v.length > LARGO_MAX_PROFORMA) {
    return `El número de proforma puede tener hasta ${LARGO_MAX_PROFORMA} caracteres (este tiene ${v.length}).`;
  }
  if (v.includes('/')) {
    return 'El número de proforma no lleva barra «/»: la barra separa el contenedor dentro de la proforma (SM26-225/3). Use guion, por ejemplo SM26-225-1.';
  }
  if (!/^[A-Z0-9][A-Z0-9._-]*$/.test(v)) {
    return 'El número de proforma solo puede llevar letras sin tilde, números, guion (-), punto (.) o guion bajo (_). Ejemplo: SM26-390.';
  }
  if (!/[0-9]/.test(v)) {
    return 'El número de proforma tiene que llevar al menos una cifra (por ejemplo SM26-390).';
  }
  return null;
}

/** El año (dos cifras) y el correlativo de un número de la serie del sistema, o null. */
export function partesDeSerie(texto: string | null | undefined): { anio: string; n: number } | null {
  const m = /^SM(\d{2})-(\d{1,6})$/.exec(normalizarNumeroProforma(texto));
  return m ? { anio: m[1], n: Number(m[2]) } : null;
}

/** SM26-624 para el año 26 y el número 624 (tres cifras como mínimo). */
export function numeroDeSerie(anio: string, n: number): string {
  return `SM${anio}-${String(n).padStart(3, '0')}`;
}

/**
 * Si lo escrito es de la serie y va POR ENCIMA del propuesto, la numeración
 * automática va a seguir desde ahí al guardar (082: el contador salta para no
 * volver a proponer un número repetido). Se avisa ANTES de guardar, porque un
 * dedo de más (SM26-6240) movería la numeración de todos.
 */
export function avisoSaltoNumeracion(escrito: string, propuesto: string | null | undefined): string | null {
  const e = partesDeSerie(escrito);
  const p = partesDeSerie(propuesto);
  if (!e || !p || e.anio !== p.anio || e.n <= p.n) return null;
  return `Es mayor que el próximo automático (${normalizarNumeroProforma(propuesto)}): al guardar, la numeración ` +
    `automática seguirá desde ${numeroDeSerie(e.anio, e.n + 1)}. Si no es el número real, corríjalo antes de guardar.`;
}

/**
 * Por qué ya no se puede cambiar el número de un pedido, o null. La regla es
 * la de la base (pedidos_numero_proforma_antes): mientras no tenga un
 * comprobante emitido y vigente, porque el comprobante lo lleva impreso.
 */
export function motivoNoCambiarNumero(comprobanteVigente: string | null | undefined): string | null {
  if (!comprobanteVigente) return null;
  return `Ya tiene emitido el comprobante ${comprobanteVigente}: el número ya no se cambia, porque el comprobante ` +
    'lo lleva impreso y ya salió al cliente. Si de verdad hay que corregirlo, primero tiene que anularse ese comprobante en Facturación.';
}
