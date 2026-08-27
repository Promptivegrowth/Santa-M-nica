/**
 * ============================================================================
 *  EL IMPORTE EN LETRAS
 * ============================================================================
 *  La SUNAT exige que todo comprobante escriba su total con palabras además de
 *  con cifras. La razón es vieja y sigue siendo buena: un «1» se convierte en
 *  «7» con un trazo, pero «MIL» no se convierte en «SIETE MIL» sin que se note.
 *
 *  Vive en su propio archivo porque lo usan el PDF y el Excel, y si cada uno
 *  tuviera su copia acabarían diciendo cosas distintas del mismo número —que
 *  es exactamente lo que esta línea del comprobante existe para evitar—.
 * ============================================================================
 */

const UNIDADES = [
  '', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE',
  'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE',
  'DIECIOCHO', 'DIECINUEVE', 'VEINTE',
];

const DECENAS = [
  '', '', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA',
  'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA',
];

const CENTENAS = [
  '', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS',
  'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS',
];

/** Escribe con palabras un número de 1 a 999. */
function hasta999(x: number): string {
  if (x === 0) return '';
  if (x === 100) return 'CIEN';

  const centenas = Math.floor(x / 100);
  const resto = x % 100;
  const partes: string[] = [];

  if (centenas) partes.push(CENTENAS[centenas]);

  if (resto <= 20) {
    if (resto) partes.push(UNIDADES[resto]);
  } else {
    const d = Math.floor(resto / 10);
    const u = resto % 10;
    // Del 21 al 29 se escribe junto —VEINTIUNO—; del 31 en adelante, con «y».
    if (d === 2) partes.push(u ? `VEINTI${UNIDADES[u]}` : 'VEINTE');
    else partes.push(u ? `${DECENAS[d]} Y ${UNIDADES[u]}` : DECENAS[d]);
  }

  return partes.join(' ');
}

/**
 * Devuelve, por ejemplo:
 *   94182.88, 'USD'  →  «NOVENTA Y CUATRO MIL CIENTO OCHENTA Y DOS CON 88/100 DÓLARES AMERICANOS»
 *
 * Los céntimos van en cifras sobre cien, como se acostumbra en los
 * comprobantes peruanos, y no en letras.
 */
export function importeEnLetras(n: number, moneda: string): string {
  const entero = Math.floor(Math.abs(n));
  const centimos = Math.round((Math.abs(n) - entero) * 100);

  let texto: string;
  if (entero === 0) {
    texto = 'CERO';
  } else {
    const millones = Math.floor(entero / 1_000_000);
    const miles = Math.floor((entero % 1_000_000) / 1000);
    const resto = entero % 1000;

    const partes: string[] = [];
    if (millones) partes.push(millones === 1 ? 'UN MILLÓN' : `${hasta999(millones)} MILLONES`);
    if (miles) partes.push(miles === 1 ? 'MIL' : `${hasta999(miles)} MIL`);
    if (resto) partes.push(hasta999(resto));
    texto = partes.join(' ');
  }

  const nombre = moneda === 'PEN' ? 'SOLES' : 'DÓLARES AMERICANOS';
  return `${texto} CON ${String(centimos).padStart(2, '0')}/100 ${nombre}`;
}
