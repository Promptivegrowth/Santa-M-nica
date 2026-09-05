/**
 * ============================================================================
 *  MONEDA · una sola definición del tipo de cambio
 * ============================================================================
 *  QUÉ SIGNIFICA `tipo_cambio` EN TODO EL SISTEMA
 *
 *      tipo_cambio = SOLES POR DÓLAR  (PEN/USD)
 *
 *  Siempre, sin importar en qué moneda esté el documento. Es la cotización del
 *  día en que se pactó, y es la convención de SUNAT.
 *
 *      · Documento en USD → importe × tipo_cambio = su equivalente en soles.
 *      · Documento en PEN → importe ÷ tipo_cambio = su equivalente en dólares.
 *
 *  POR QUÉ ESTE ARCHIVO EXISTE
 *  Porque antes no existía. Cada pantalla que necesitaba comparar importes lo
 *  resolvía por su cuenta, y algunas simplemente sumaban soles con dólares y
 *  rotulaban el resultado en dólares. Un pedido de S/ 400 000 entraba en el
 *  panel como si fueran 400 000 dólares.
 *
 *  Esta función es la gemela exacta de `a_dolares()` en PostgreSQL
 *  (migración 021). Si una cambia, la otra también: son la misma regla escrita
 *  dos veces porque hace falta en los dos lados.
 *
 *  DÓNDE SE MUESTRA CADA COSA
 *      · Ficha de un documento (factura, proforma, cotización) → SU moneda.
 *        Es un hecho legal: una factura en soles dice soles.
 *      · Listas, totales, indicadores y comparaciones → dólares. Es lo único
 *        que se puede sumar.
 * ============================================================================
 */

export type Moneda = 'USD' | 'PEN';

/**
 * El suelo por debajo del cual un valor no puede ser una cotización del dólar.
 *
 * El sol nunca ha estado cerca de la paridad, así que 1,5 es generoso y a la
 * vez suficiente para atrapar el error que de verdad ocurría: el «1» que
 * dejaba el valor por defecto de la columna. La base impone este mismo límite
 * con un CHECK, de modo que ya no se puede guardar.
 */
export const TIPO_CAMBIO_MINIMO = 1.5;

/** Tope de cordura, por el otro lado. Nadie va a pactar a 200 soles por dólar. */
export const TIPO_CAMBIO_MAXIMO = 100;

/**
 * Lleva un importe a dólares.
 *
 * Si el tipo de cambio guardado no es creíble no se inventa uno: se devuelve
 * el importe sin convertir. Es preferible un número que se nota raro a uno
 * que parece correcto y no lo es.
 */
export function aDolares(
  importe: number | string | null | undefined,
  moneda: Moneda | string | null | undefined,
  tipoCambio: number | string | null | undefined
): number {
  const valor = Number(importe ?? 0);
  if (!Number.isFinite(valor)) return 0;
  if (moneda !== 'PEN') return valor;

  const tc = Number(tipoCambio ?? 0);
  return tc >= TIPO_CAMBIO_MINIMO ? valor / tc : valor;
}

/** El camino inverso: de dólares a soles. */
export function aSoles(
  importe: number | string | null | undefined,
  moneda: Moneda | string | null | undefined,
  tipoCambio: number | string | null | undefined
): number {
  const valor = Number(importe ?? 0);
  if (!Number.isFinite(valor)) return 0;
  if (moneda === 'PEN') return valor;

  const tc = Number(tipoCambio ?? 0);
  return tc >= TIPO_CAMBIO_MINIMO ? valor * tc : valor;
}

/**
 * Comprueba que un tipo de cambio se pueda guardar, y explica por qué no si
 * no se puede. Devuelve `null` cuando está bien.
 *
 * Se valida en el servidor y no solo en el formulario: la base lo rechazaría
 * igual, pero con un mensaje de PostgreSQL que no le dice nada a un comercial.
 */
export function revisarTipoCambio(valor: number): string | null {
  if (!Number.isFinite(valor) || valor <= 0) {
    return 'Indique el tipo de cambio.';
  }
  if (valor < TIPO_CAMBIO_MINIMO) {
    return (
      `El tipo de cambio son SOLES POR DÓLAR, y ${valor} no puede serlo. ` +
      'Escriba la cotización del día —hoy ronda 3,75— aunque el documento esté en dólares.'
    );
  }
  if (valor > TIPO_CAMBIO_MAXIMO) {
    return `${valor} soles por dólar no es una cotización real. Revise el número.`;
  }
  return null;
}
