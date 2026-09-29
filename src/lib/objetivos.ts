/**
 * ============================================================================
 *  OBJETIVOS MENSUALES · el cálculo del tablero
 * ============================================================================
 *  Una sola función, sin base de datos ni pantalla: recibe el catálogo, lo
 *  digitado, lo que da el ERP y las metas, y devuelve el tablero entero —cada
 *  indicador, mes a mes y el año, con su semáforo—. La usan la pantalla y el
 *  Excel, así que las dos dicen siempre lo mismo, y se puede probar suelta.
 *
 *  DE DÓNDE SALE CADA VALOR (en este orden)
 *    1. Lo digitado. En un indicador manual es el dato; en uno del ERP o
 *       calculado es un AJUSTE que manda sobre el cálculo —así entra el
 *       histórico del Excel de los meses en que el ERP no existía—.
 *    2. El ERP, desde el mes configurado («objetivos_erp_desde»).
 *    3. La fórmula: (Σ numerador ÷ Σ denominador) × factor [÷ tipo de cambio].
 *
 *  EL AÑO
 *    · suma      → la suma de los meses
 *    · promedio  → el promedio de los meses con dato
 *    · primero   → el primer mes con dato (saldos iniciales)
 *    · ratio     → la fórmula aplicada a las SUMAS del año. El ratio anual
 *                  no es el promedio de los ratios: un mes de 100 Tn pesa
 *                  más que uno de 10. Era uno de los errores del Excel.
 *
 *  EL SEMÁFORO (metas: esperado y máximo)
 *    · menor es mejor (costos):  ≤ esperado cumple · hasta el máximo alerta
 *                                · por encima del máximo no cumple
 *    · mayor es mejor (volúmenes): ≥ máximo supera · ≥ esperado cumple
 *                                · por debajo del esperado no cumple
 *    Un mes sin meta propia usa la del año, pero solo en indicadores que no
 *    se suman (ratios, precios, saldos): «100 000 Tn al año» no dice cuánto
 *    toca en marzo, y repartirlo en doce sería inventar una meta.
 * ============================================================================
 */

export type Indicador = {
  id: number;
  codigo: string;
  nombre: string;
  bloque: string;
  unidad: string;
  orden: number;
  tipo: 'manual' | 'erp' | 'calculado';
  agregacion: 'suma' | 'promedio' | 'primero' | 'ratio';
  sentido: 'mayor' | 'menor' | 'informativo';
  decimales: number;
  fuente: string | null;
  numerador: string[] | null;
  denominador: string[] | null;
  factor: number;
  dividir_tc: boolean;
  descripcion?: string | null;
};

export type Origen = 'manual' | 'ajuste' | 'erp' | 'calculado';
export type Estado = 'supera' | 'cumple' | 'alerta' | 'no_cumple';

export type Celda = {
  valor: number | null;
  origen: Origen | null;
  esperado: number | null;
  maximo: number | null;
  /** La meta viene de la del año, no de una propia del mes. */
  metaDelAnio: boolean;
  estado: Estado | null;
};

export type FilaTablero = {
  indicador: Indicador;
  /** Índice 0 = enero … 11 = diciembre. */
  meses: Celda[];
  anio: Celda;
};

export type EntradaTablero = {
  indicadores: Indicador[];
  /** Lo digitado: indicador_id, mes (1-12), valor. */
  valores: { indicador_id: number; mes: number; valor: number }[];
  /** Lo del ERP: fuente, mes (1-12), valor. Solo llega hasta el mes en curso. */
  erp: { fuente: string; mes: number; valor: number }[];
  /** mes nulo = meta del año. */
  metas: { indicador_id: number; mes: number | null; esperado: number | null; maximo: number | null }[];
  /** Soles por dólar, fijo (parámetro «objetivos_tipo_cambio»). */
  tipoCambio: number;
  /** Primer mes (1-12) de ESTE año en que manda el ERP; 13 si ninguno. */
  erpDesdeMes: number;
};

const MESES = 12;

/** Semáforo de un valor frente a su meta. */
export function evaluar(
  valor: number | null,
  sentido: Indicador['sentido'],
  esperado: number | null,
  maximo: number | null,
): Estado | null {
  if (valor === null || sentido === 'informativo') return null;
  if (esperado === null && maximo === null) return null;
  if (sentido === 'menor') {
    if (esperado !== null && valor <= esperado) return 'cumple';
    if (maximo !== null && valor <= maximo) return esperado === null ? 'cumple' : 'alerta';
    return 'no_cumple';
  }
  //  mayor es mejor
  if (maximo !== null && valor >= maximo) return 'supera';
  if (esperado !== null && valor >= esperado) return 'cumple';
  if (esperado === null) return 'cumple';
  return 'no_cumple';
}

/**
 * La fórmula de un calculado sobre un conjunto de valores ya resueltos.
 * Nulo si no hay con qué: sin ningún numerador, o denominador nulo o cero.
 */
function aplicarFormula(ind: Indicador, valorDe: (codigo: string) => number | null, tc: number): number | null {
  const sumar = (codigos: string[]) => {
    const xs = codigos.map(valorDe).filter((x): x is number => x !== null);
    return xs.length ? xs.reduce((s, x) => s + x, 0) : null;
  };
  const num = sumar(ind.numerador ?? []);
  if (num === null) return null;
  let v = num;
  if (ind.denominador?.length) {
    const den = sumar(ind.denominador);
    if (den === null || den === 0) return null;
    v = num / den;
  }
  v *= Number(ind.factor ?? 1);
  if (ind.dividir_tc) {
    if (!tc) return null;
    v /= tc;
  }
  return v;
}

export function armarTablero(e: EntradaTablero): FilaTablero[] {
  const porCodigo = new Map(e.indicadores.map((i) => [i.codigo, i]));
  const digitado = new Map(e.valores.map((v) => [`${v.indicador_id}|${v.mes}`, Number(v.valor)]));
  const delErp = new Map(e.erp.map((v) => [`${v.fuente}|${v.mes}`, Number(v.valor)]));
  const metaDe = new Map(e.metas.map((m) => [`${m.indicador_id}|${m.mes ?? 0}`, m]));

  /* ---- 1. El valor de cada indicador en cada mes, resolviendo en cadena ---- */
  const cache = new Map<string, { valor: number | null; origen: Origen | null }>();
  const enCurso = new Set<string>();

  function valorMes(codigo: string, mes: number): { valor: number | null; origen: Origen | null } {
    const clave = `${codigo}|${mes}`;
    const hecho = cache.get(clave);
    if (hecho) return hecho;
    const ind = porCodigo.get(codigo);
    if (!ind) return { valor: null, origen: null };
    //  Una fórmula que se referencia a sí misma no puede resolverse: nulo, no
    //  un bucle infinito.
    if (enCurso.has(clave)) return { valor: null, origen: null };
    enCurso.add(clave);

    let r: { valor: number | null; origen: Origen | null } = { valor: null, origen: null };
    const tecleado = digitado.get(`${ind.id}|${mes}`);
    if (tecleado !== undefined) {
      r = { valor: tecleado, origen: ind.tipo === 'manual' ? 'manual' : 'ajuste' };
    } else if (ind.tipo === 'erp') {
      const v = mes >= e.erpDesdeMes ? delErp.get(`${ind.fuente}|${mes}`) : undefined;
      if (v !== undefined) r = { valor: v, origen: 'erp' };
    } else if (ind.tipo === 'calculado') {
      const v = aplicarFormula(ind, (c) => valorMes(c, mes).valor, e.tipoCambio);
      if (v !== null) r = { valor: v, origen: 'calculado' };
    }

    enCurso.delete(clave);
    cache.set(clave, r);
    return r;
  }

  /* ---- 2. El año ---- */
  function valorAnio(ind: Indicador): number | null {
    const serie = Array.from({ length: MESES }, (_, k) => valorMes(ind.codigo, k + 1).valor);
    const con = serie.filter((x): x is number => x !== null);
    if (ind.agregacion === 'ratio') {
      //  La fórmula sobre las sumas del año de cada componente.
      const sumaAnual = (codigo: string) => {
        const xs = Array.from({ length: MESES }, (_, k) => valorMes(codigo, k + 1).valor)
          .filter((x): x is number => x !== null);
        return xs.length ? xs.reduce((s, x) => s + x, 0) : null;
      };
      return aplicarFormula(ind, sumaAnual, e.tipoCambio);
    }
    if (!con.length) return null;
    if (ind.agregacion === 'suma') return con.reduce((s, x) => s + x, 0);
    if (ind.agregacion === 'promedio') return con.reduce((s, x) => s + x, 0) / con.length;
    return con[0]; // primero
  }

  /* ---- 3. Metas y semáforo ---- */
  const seSuma = (ind: Indicador) => ind.agregacion === 'suma';

  return [...e.indicadores]
    .sort((a, b) => a.orden - b.orden)
    .map((ind) => {
      const anual = metaDe.get(`${ind.id}|0`);
      const meses: Celda[] = Array.from({ length: MESES }, (_, k) => {
        const { valor, origen } = valorMes(ind.codigo, k + 1);
        const propia = metaDe.get(`${ind.id}|${k + 1}`);
        const usarAnual = !propia && !!anual && !seSuma(ind);
        const meta = propia ?? (usarAnual ? anual : undefined);
        const esperado = meta?.esperado ?? null;
        const maximo = meta?.maximo ?? null;
        return {
          valor, origen,
          esperado: esperado === null ? null : Number(esperado),
          maximo: maximo === null ? null : Number(maximo),
          metaDelAnio: usarAnual,
          estado: evaluar(valor, ind.sentido,
            esperado === null ? null : Number(esperado), maximo === null ? null : Number(maximo)),
        };
      });
      const va = valorAnio(ind);
      const ea = anual?.esperado ?? null;
      const ma = anual?.maximo ?? null;
      return {
        indicador: ind,
        meses,
        anio: {
          valor: va,
          origen: ind.tipo === 'calculado' ? 'calculado' : null,
          esperado: ea === null ? null : Number(ea),
          maximo: ma === null ? null : Number(ma),
          metaDelAnio: false,
          estado: evaluar(va, ind.sentido, ea === null ? null : Number(ea), ma === null ? null : Number(ma)),
        },
      };
    });
}

/** «2026-09» y el año 2026 → 9; un año anterior → 1; uno posterior → 13. */
export function mesDesdeParametro(parametro: string | null | undefined, anio: number): number {
  const m = /^(\d{4})-(\d{2})$/.exec(parametro ?? '');
  if (!m) return 13;
  const a = Number(m[1]);
  if (a < anio) return 1;
  if (a > anio) return 13;
  return Math.min(Math.max(Number(m[2]), 1), 12);
}

export const NOMBRE_MES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];

export const TEXTO_ESTADO: Record<Estado, string> = {
  supera: 'Supera',
  cumple: 'Cumple',
  alerta: 'En alerta',
  no_cumple: 'No cumple',
};
