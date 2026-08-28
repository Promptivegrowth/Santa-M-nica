/**
 * ============================================================================
 *  LA FECHA DE HOY, EN LIMA
 * ============================================================================
 *  EL ERROR QUE ESTE ARCHIVO VIENE A EVITAR
 *
 *  `new Date().toISOString().slice(0, 10)` NO devuelve la fecha de hoy:
 *  devuelve la fecha de hoy en UTC. Lima va cinco horas por detrás, así que a
 *  partir de las siete de la tarde las dos fechas dejan de coincidir.
 *
 *  Eso ya había provocado tres cosas distintas, todas silenciosas:
 *
 *    · La pestaña «Pedidos de hoy» empezaba a mostrar los de mañana a las
 *      siete de la tarde, justo cuando se revisa el cierre del día.
 *    · Una factura emitida a las siete de la tarde salía fechada al día
 *      siguiente. Eso no es una molestia: es un problema fiscal, porque el
 *      comprobante cae en otro período.
 *    · Un pedido creado de noche nacía con fecha de mañana, y aparecía como
 *      «futuro» en los reportes del propio día en que se creó.
 *
 *  El servidor puede estar en cualquier huso —Vercel corre en Estados Unidos—
 *  así que tampoco sirve confiar en la hora local de la máquina. Se pide la
 *  fecha explícitamente en el huso de la operación, que es donde está la
 *  cámara y donde se factura.
 *
 *  CUÁNDO NO HACE FALTA
 *  Para marcas de tiempo completas —`creado_en`, `liberado_en`, `anulada_en`—
 *  UTC es lo correcto y `toISOString()` está bien: son instantes, no fechas de
 *  calendario. El problema aparece solo al recortar a «AAAA-MM-DD».
 * ============================================================================
 */

/** El huso donde opera la empresa. */
export const HUSO_OPERACION = 'America/Lima';

/**
 * La fecha de hoy en Lima, como «AAAA-MM-DD».
 *
 * Se usa el formato `en-CA` porque es el único que da el orden año-mes-día
 * con ceros, que es justo el que entienden PostgreSQL y los campos de fecha
 * del navegador.
 */
export function hoyEnLima(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: HUSO_OPERACION });
}

/**
 * Suma o resta días a una fecha «AAAA-MM-DD».
 *
 * La aritmética va en UTC y a mediodía a propósito: sumar 86 400 000
 * milisegundos sobre una fecha local puede caer en el día anterior o el
 * siguiente cuando hay cambio de horario, y aquí lo que se quiere es «la
 * misma casilla del calendario, siete más allá».
 *
 * Es pura: no mira el reloj, solo transforma la fecha que se le da.
 */
export function desplazarDias(fechaISO: string, dias: number): string {
  const base = new Date(`${fechaISO}T12:00:00Z`);
  return new Date(base.getTime() + dias * 86400000).toISOString().slice(0, 10);
}

/** La hora de Lima en formato de 24 horas, para las marcas de pantalla. */
export function horaEnLima(): string {
  return new Date().toLocaleTimeString('es-PE', {
    timeZone: HUSO_OPERACION,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
