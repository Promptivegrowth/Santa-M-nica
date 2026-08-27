/**
 * ============================================================================
 *  TEXTO SEGURO PARA PDF · lo comparten los comprobantes y los reportes
 * ============================================================================
 *  pdfkit dibuja con las fuentes que trae incorporadas (Helvetica, Courier).
 *  Esas fuentes usan la codificación WinAnsi, que NO tiene todo Unicode. Si se
 *  le pasa un carácter que no conoce, no falla: dibuja otro. Así fue como un
 *  signo menos matemático (U+2212) salió impreso como una comilla en una
 *  factura.
 *
 *  Por eso todo texto que va a un PDF pasa antes por aquí. Se hace UNA vez,
 *  sobre el objeto entero, y no en cada llamada a `.text()`: así no hay forma
 *  de olvidarse de un campo nuevo.
 * ============================================================================
 */

/** Colores de marca. Los mismos que la aplicación y que los Excel. */
export const MARCA_PDF = {
  azulProfundo: '#304F8C',
  azulMedio: '#5095BF',
  verdeAzulado: '#53A6A6',
  tinta: '#1F2937',
  tintaSuave: '#6B7280',
  linea: '#D9DFE8',
  grisSuave: '#F3F5F9',
  critico: '#B3261E',
  atencion: '#8A5A00',
  ok: '#1F6F52',
  blanco: '#FFFFFF',
};

/** Lo que se cambia por un equivalente que sí se puede dibujar. */
const EQUIVALENTES = new Map<number, string>([
  [0x2212, '-'],    // signo menos matematico
  [0x2192, '->'],   // flecha derecha
  [0x2190, '<-'],   // flecha izquierda
  [0x2248, '~'],    // aproximadamente
  [0x2264, '<='],
  [0x2265, '>='],
  [0x00a0, ' '],    // espacio duro
]);

/**
 * Los caracteres de WinAnsi que en Unicode viven fuera del rango 0x20-0xFF.
 * Son los que ocupan las posiciones 0x80-0x9F de la codificacion: comillas
 * tipograficas, rayas, puntos suspensivos y el simbolo del euro.
 */
const EXTRA_WINANSI = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

/** Deja el texto en caracteres que la fuente pueda dibujar. */
export function seguro(texto: string): string {
  let salida = '';
  for (const caracter of texto) {
    const codigo = caracter.codePointAt(0) ?? 0;

    const sustituto = EQUIVALENTES.get(codigo);
    if (sustituto !== undefined) {
      salida += sustituto;
      continue;
    }

    if ((codigo >= 0x20 && codigo <= 0xff) || EXTRA_WINANSI.has(codigo)) {
      salida += caracter;
    }
    // Lo demas se descarta: mejor un hueco que un simbolo equivocado en un
    // documento que sale de la empresa.
  }
  return salida;
}

/** Recorre una estructura entera limpiando cada texto que encuentra. */
export function limpiarDocumento<T>(valor: T): T {
  if (typeof valor === 'string') return seguro(valor) as unknown as T;
  if (Array.isArray(valor)) return valor.map(limpiarDocumento) as unknown as T;
  /*
   * Una fecha es un objeto, pero no uno que se pueda recorrer campo a campo:
   * al hacerlo se convertía en `{}` y acababa imprimiéndose como
   * «[object Object]» en la cabecera del reporte. Se devuelve intacta, igual
   * que cualquier otro objeto con identidad propia.
   */
  if (valor instanceof Date) return valor;
  if (valor && typeof valor === 'object') {
    const salida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor)) salida[k] = limpiarDocumento(v);
    return salida as T;
  }
  return valor;
}

/** Cifra con separador de miles, en el formato que se lee en Perú. */
export function cifra(n: number, decimales = 2): string {
  return n.toLocaleString('es-PE', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
}
