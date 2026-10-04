/**
 * ============================================================================
 *  CIERRE SEMANAL DE PRODUCCIÓN · el cálculo de las 14 columnas
 * ============================================================================
 *  Como lo definió Oliver (migración 063). Una función pura: la usan la
 *  pantalla, el Excel y la prueba, que la contrasta con las cifras del propio
 *  Excel de Marco.
 *
 *  Un porcentaje sin base —plan vacío o cero— queda vacío, no en 0 % ni en
 *  infinito: «sin plan» no es «0 % de cumplimiento».
 * ============================================================================
 */

export type Datos = {
  plan_mp: number | null;
  real_mp: number | null;
  plan_prod: number | null;
  real_prod: number | null;
  stock_inicial: number | null;
  plan_ventas: number | null;
  ventas: number | null;
};

export type FilaCierre = Datos & {
  cump_mp: number | null;          //  3 · real MP ÷ plan MP
  dif_mp: number | null;           //  4 · real MP − plan MP
  cump_prod: number | null;        //  7 · prod. real ÷ prod. plan
  proy_prod: number | null;        // 11 · (prod. real ÷ 20) × 26
  cump_proy_prod: number | null;   // 12 · 11 ÷ prod. plan
  proy_ventas: number | null;      // 13 · (ventas ÷ 20) × 26
  cump_ventas: number | null;      // 14 · ventas ÷ plan ventas
};

export type Dias = { proyeccion: number; mes: number };

const div = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : a / b);

export function calcularFila(d: Datos, dias: Dias): FilaCierre {
  const proy = (x: number | null) => (x === null || !dias.proyeccion ? null : (x / dias.proyeccion) * dias.mes);
  const proy_prod = proy(d.real_prod);
  return {
    ...d,
    cump_mp: div(d.real_mp, d.plan_mp),
    dif_mp: d.real_mp === null || d.plan_mp === null ? null : d.real_mp - d.plan_mp,
    cump_prod: div(d.real_prod, d.plan_prod),
    proy_prod,
    cump_proy_prod: div(proy_prod, d.plan_prod),
    proy_ventas: proy(d.ventas),
    cump_ventas: div(d.ventas, d.plan_ventas),
  };
}

/** La fila «Total general»: solo se suman las toneladas, como en el Excel. */
export function totalizar(filas: FilaCierre[]): Partial<FilaCierre> {
  const suma = (k: keyof FilaCierre) => {
    const xs = filas.map((f) => f[k]).filter((x): x is number => typeof x === 'number');
    return xs.length ? xs.reduce((s, x) => s + x, 0) : null;
  };
  return {
    plan_mp: suma('plan_mp'), real_mp: suma('real_mp'),
    plan_prod: suma('plan_prod'), real_prod: suma('real_prod'),
    stock_inicial: suma('stock_inicial'),
    plan_ventas: suma('plan_ventas'), ventas: suma('ventas'),
    proy_prod: suma('proy_prod'), proy_ventas: suma('proy_ventas'),
  };
}

/** Bajo el 90 % se marca, como el formato condicional del Excel. */
export const UMBRAL_ALERTA = 0.9;

/**
 * «Gestión al»: la parte del mes ya transcurrida en días hábiles (lunes a
 * sábado). Como en el Excel de Marco: «Actualizado al» es AYER y cuentan los
 * días hábiles ANTERIORES a esa fecha —el 29/09 da 24 de 26, el 92 %—.
 * Informativo: la proyección usa el 20 y el 26 fijos.
 */
export function gestionDelMes(anio: number, mes: number, corte: string): { transcurridos: number; total: number } {
  let total = 0;
  let transcurridos = 0;
  const dias = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  for (let d = 1; d <= dias; d++) {
    const f = new Date(Date.UTC(anio, mes - 1, d));
    if (f.getUTCDay() === 0) continue; // domingo
    total++;
    if (f.toISOString().slice(0, 10) < corte) transcurridos++;
  }
  return { transcurridos, total };
}
