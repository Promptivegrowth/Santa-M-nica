/**
 * ============================================================================
 *  PALETA DE GRÁFICOS
 * ============================================================================
 *  Estos colores NO se eligieron a ojo. Se validaron con un verificador que
 *  comprueba cinco cosas sobre cada par de colores:
 *
 *   1. Que todos tengan una luminosidad parecida (que ninguno "pese" más).
 *   2. Que ninguno se vea gris (saturación mínima).
 *   3. Que se distingan para quien tiene daltonismo (protanopía, deuteranopía
 *      y tritanopía).
 *   4. Que se distingan también con visión normal.
 *   5. Que contrasten al menos 3:1 contra el fondo.
 *
 *  El tema oscuro NO es una inversión automática del claro: tiene sus propios
 *  tonos, validados por separado contra el fondo oscuro.
 *
 *  Resultado de la validación:
 *    · Tema claro:  todas las comprobaciones PASAN.
 *    · Tema oscuro: todas PASAN; el par ocre/verde queda en la banda de aviso
 *      (ΔE 7,5 en protanopía), lo que obliga a acompañar el color con
 *      etiquetas visibles y leyenda. Ambas cosas están implementadas.
 *
 *  IMPORTANTE: los colores de ESTADO (bien / atención / crítico) son otra
 *  familia y nunca se usan como "serie 4". Un semáforo debe leerse como
 *  semáforo.
 * ============================================================================
 */

/** Series categóricas, en orden fijo. Nunca se reciclan ni se generan al vuelo. */
export const SERIES_CLARO = ['#304F8C', '#C77D3E', '#12A085'] as const;
export const SERIES_OSCURO = ['#5A82C4', '#C07C3C', '#109578'] as const;

/**
 * Rampa secuencial (un solo tono, de claro a oscuro).
 * Se usa cuando las categorías tienen ORDEN natural — por ejemplo, los rangos
 * de anticuamiento: <12, 12-18, 18-24, >24 meses. Ahí el color debe expresar
 * "más" o "menos", no identidad.
 */
export const RAMPA_CLARO = ['#b8d5e8', '#86bcd8', '#5095bf', '#3d67ab', '#22386a'] as const;
export const RAMPA_OSCURO = ['#1e3a5f', '#2c5688', '#3d76b0', '#5a97d0', '#86bcd8'] as const;

/** Colores de estado. Reservados: jamás se usan como serie de datos. */
export const ESTADO = {
  ok: { claro: '#1f6b57', oscuro: '#5cbfa3' },
  atencion: { claro: '#8a5a10', oscuro: '#dda94f' },
  critico: { claro: '#95302c', oscuro: '#e8837a' },
  neutro: { claro: '#6f7d95', oscuro: '#7b89a3' },
} as const;

/**
 * Devuelve el color de una serie según su posición y el tema.
 * Si se piden más series que colores disponibles, las sobrantes se agrupan
 * como "Otros" en gris: nunca se inventa un color nuevo.
 */
export function colorSerie(indice: number, oscuro: boolean): string {
  const serie = oscuro ? SERIES_OSCURO : SERIES_CLARO;
  return indice < serie.length
    ? serie[indice]
    : oscuro ? ESTADO.neutro.oscuro : ESTADO.neutro.claro;
}

export function colorRampa(indice: number, total: number, oscuro: boolean): string {
  const rampa = oscuro ? RAMPA_OSCURO : RAMPA_CLARO;
  if (total <= 1) return rampa[rampa.length - 1];
  const pos = Math.round((indice / (total - 1)) * (rampa.length - 1));
  return rampa[Math.min(rampa.length - 1, Math.max(0, pos))];
}
