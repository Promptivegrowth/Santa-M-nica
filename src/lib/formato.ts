/**
 * ============================================================================
 *  FORMATEO DE DATOS
 * ============================================================================
 *  Un ERP se lee de un vistazo. Si los números aparecen con distinta cantidad
 *  de decimales o las fechas en formatos mezclados, el usuario tiene que
 *  detenerse a interpretar en vez de decidir. Todo el formato vive aquí.
 *
 *  Convención peruana: punto para miles, coma para decimales.
 * ============================================================================
 */

const LOCALE = 'es-PE';

/** Toneladas con un decimal: 1.234,5 */
export function tm(kg: number | string | null | undefined, decimales = 1): string {
  const n = Number(kg ?? 0) / 1000;
  return n.toLocaleString(LOCALE, {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
}

/** Kilos enteros con separador de miles. */
export function kg(valor: number | string | null | undefined): string {
  return Number(valor ?? 0).toLocaleString(LOCALE, { maximumFractionDigits: 0 });
}

/** Número genérico. */
export function num(
  valor: number | string | null | undefined,
  decimales = 0
): string {
  return Number(valor ?? 0).toLocaleString(LOCALE, {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
}

/** Importe con símbolo de moneda: US$ 12.450,00 */
export function dinero(
  valor: number | string | null | undefined,
  moneda: 'USD' | 'PEN' = 'USD',
  decimales = 2
): string {
  const simbolo = moneda === 'PEN' ? 'S/' : 'US$';
  return `${simbolo} ${Number(valor ?? 0).toLocaleString(LOCALE, {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  })}`;
}

/** Porcentaje: 12,4 % */
export function pct(valor: number | string | null | undefined, decimales = 1): string {
  return `${Number(valor ?? 0).toLocaleString(LOCALE, {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  })} %`;
}

/** Fecha corta: 25/08/2026 */
export function fecha(valor: string | Date | null | undefined): string {
  if (!valor) return '—';
  const d = typeof valor === 'string' ? new Date(valor) : valor;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(LOCALE, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/Lima',
  });
}

/** Fecha y hora: 25/08/2026 14:32 */
export function fechaHora(valor: string | Date | null | undefined): string {
  if (!valor) return '—';
  const d = typeof valor === 'string' ? new Date(valor) : valor;
  if (Number.isNaN(d.getTime())) return '—';
  return `${fecha(d)} ${d.toLocaleTimeString(LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Lima',
  })}`;
}

/** Fecha larga legible: 25 de agosto de 2026 */
export function fechaLarga(valor: string | Date | null | undefined): string {
  if (!valor) return '—';
  const d = typeof valor === 'string' ? new Date(valor) : valor;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(LOCALE, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Lima',
  });
}

/** "hace 3 días", "en 2 semanas" — útil en las líneas de tiempo. */
export function haceTiempo(valor: string | Date | null | undefined): string {
  if (!valor) return '—';
  const d = typeof valor === 'string' ? new Date(valor) : valor;
  if (Number.isNaN(d.getTime())) return '—';

  const segundos = Math.round((d.getTime() - Date.now()) / 1000);
  const rel = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });
  const escalas: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, 'second'],
    [3600, 'minute'],
    [86400, 'hour'],
    [604800, 'day'],
    [2629800, 'week'],
    [31557600, 'month'],
    [Infinity, 'year'],
  ];
  let anterior = 1;
  for (const [limite, unidad] of escalas) {
    if (Math.abs(segundos) < limite) {
      return rel.format(Math.round(segundos / anterior), unidad);
    }
    anterior = limite;
  }
  return fecha(d);
}

/** Diferencia en días entre una fecha y hoy (negativo = pasado). */
export function diasDesdeHoy(valor: string | Date | null | undefined): number {
  if (!valor) return 0;
  const d = typeof valor === 'string' ? new Date(valor) : valor;
  return Math.round((d.getTime() - Date.now()) / 86400000);
}

/** Convierte 'en_transito' → 'En tránsito' para mostrar enums en pantalla. */
export function etiquetaEstado(valor: string | null | undefined): string {
  if (!valor) return '—';
  const texto = valor.replace(/_/g, ' ');
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Une clases CSS ignorando las vacías. */
export function clases(...partes: (string | false | null | undefined)[]): string {
  return partes.filter(Boolean).join(' ');
}
