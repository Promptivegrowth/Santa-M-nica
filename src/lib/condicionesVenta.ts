/**
 * ============================================================================
 *  CONDICIONES DE LA VENTA · forma de pago, adelanto y plazo de entrega
 * ============================================================================
 *  Observaciones ERP (oct. 2026), puntos 4, 5 y 6. Son reglas puras —no leen
 *  la base ni el reloj— para que el formulario, la ficha y el servidor
 *  calculen exactamente lo mismo.
 *
 *  ADELANTO (punto 6)
 *    monto del adelanto  = total del documento × % de adelanto
 *    diferencia          = lo efectivamente abonado − el monto del adelanto
 *  Ninguno de los dos se guarda: si se guardaran, se descuadrarían al cambiar
 *  una línea. Lo único que se guarda es lo que no se puede deducir: el % y lo
 *  que el cliente de verdad depositó.
 *
 *  PLAZO (puntos 4 y 5)
 *  Si hay fecha tentativa de despacho, esa manda. Si no, la prioridad pone el
 *  plazo de referencia, como lo definió Oliver:
 *      Urgente  hasta 1 semana
 *      Normal   más de 1 y hasta 3 semanas
 *      Baja     más de 3 semanas
 *  Los días salen de Configuración (parámetros plazo_dias_*).
 * ============================================================================
 */

export type FormaPago = 'contado' | 'adelanto_saldo' | 'credito' | 'carta_credito' | 'cad';
export type Prioridad = 'baja' | 'normal' | 'alta' | 'urgente';

/** Cómo se dice cada forma de pago en pantalla y en los documentos. */
export const FORMAS_PAGO: Record<FormaPago, string> = {
  contado: 'Contado',
  adelanto_saldo: 'Adelanto y saldo',
  credito: 'Crédito',
  carta_credito: 'Carta de crédito',
  cad: 'Pago contra documentos (CAD)',
};

/** Las que normalmente llevan un adelanto: ahí el % se pide; en las demás es opcional. */
export const PIDE_ADELANTO: FormaPago[] = ['adelanto_saldo'];

const redondear = (n: number) => Math.round(n * 100) / 100;

/** El total que paga el cliente: con IGV solo si la venta es nacional (la exportación no lo grava). */
export function totalConImpuesto(subtotal: number, pais: string | null | undefined, igvPct: number): number {
  const nacional = (pais ?? '').trim() === 'Perú';
  return redondear(subtotal * (1 + (nacional ? igvPct : 0) / 100));
}

export type Adelanto = {
  /** Lo que el cliente debe adelantar: total × %. */
  monto: number;
  /** Lo que de verdad abonó, si ya se registró. */
  abonado: number | null;
  /** abonado − monto. Negativo: le falta abonar; positivo: abonó de más. */
  diferencia: number | null;
  /** Lo que queda por cobrar de la venta después del abono. */
  saldo: number;
};

export function calcularAdelanto(total: number, pct: number, abonado: number | null | undefined): Adelanto {
  const monto = redondear(total * (Number(pct) || 0) / 100);
  const ab = abonado === null || abonado === undefined || Number.isNaN(Number(abonado)) ? null : redondear(Number(abonado));
  return {
    monto,
    abonado: ab,
    diferencia: ab === null ? null : redondear(ab - monto),
    saldo: redondear(total - (ab ?? 0)),
  };
}

/** Texto corto para la condición de pago que imprime la proforma. */
export function textoCondicionPago(forma: FormaPago | null | undefined, pct: number, diasCredito = 0): string {
  if (!forma) return diasCredito > 0 ? `Crédito ${diasCredito} días` : 'Contado';
  if (forma === 'adelanto_saldo') return `${Number(pct) || 0} % de adelanto y saldo`;
  if (forma === 'credito') return diasCredito > 0 ? `Crédito ${diasCredito} días` : 'Crédito';
  return FORMAS_PAGO[forma] + (Number(pct) > 0 ? ` · ${pct} % de adelanto` : '');
}

/* ==========================================================================
   PLAZOS POR PRIORIDAD
   ========================================================================== */

/** Días por defecto si Configuración no dice otra cosa (los mismos que siembra la migración 064). */
export const PLAZO_DIAS_DEFECTO: Record<Prioridad, number> = { urgente: 7, alta: 14, normal: 21, baja: 42 };

/** Lo que significa cada prioridad, con las palabras del documento de Oliver. */
export const PLAZO_TEXTO: Record<Prioridad, string> = {
  urgente: 'hasta 1 semana',
  alta: 'hasta 2 semanas',
  normal: 'más de 1 y hasta 3 semanas',
  baja: 'más de 3 semanas',
};

/** Suma días a una fecha «AAAA-MM-DD» sin pasar por husos horarios. */
function sumarDias(fechaISO: string, dias: number): string {
  const d = new Date(`${fechaISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export type PlazoReferencia = {
  /** La fecha que se usa como límite de referencia. */
  fecha: string;
  /** De dónde salió: la fecha tentativa que se escribió o el plazo de la prioridad. */
  origen: 'tentativa' | 'prioridad';
  /** «Urgente · hasta 1 semana». */
  texto: string;
};

/**
 * La fecha límite de referencia de una venta. Misma regla que la función
 * `plazo_referencia` de la base (064): la tentativa manda; si no la hay, la
 * fecha base más los días de la prioridad.
 */
export function plazoReferencia(
  prioridad: Prioridad,
  desde: string,
  tentativa: string | null | undefined,
  dias: Partial<Record<Prioridad, number>> = {}
): PlazoReferencia {
  const nombre = prioridad.charAt(0).toUpperCase() + prioridad.slice(1);
  const texto = `${nombre} · ${PLAZO_TEXTO[prioridad]}`;
  if (tentativa) return { fecha: tentativa, origen: 'tentativa', texto };
  const n = dias[prioridad] ?? PLAZO_DIAS_DEFECTO[prioridad];
  return { fecha: sumarDias(desde, n), origen: 'prioridad', texto };
}

/** Lee de una lista de parámetros los días de cada prioridad. */
export function diasDePlazos(parametros: { clave: string; valor: unknown }[]): Record<Prioridad, number> {
  const r = { ...PLAZO_DIAS_DEFECTO };
  for (const p of parametros) {
    const m = /^plazo_dias_(urgente|alta|normal|baja)$/.exec(p.clave);
    if (m && Number(p.valor) > 0) r[m[1] as Prioridad] = Number(p.valor);
  }
  return r;
}
