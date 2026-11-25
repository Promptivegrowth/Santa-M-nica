/**
 * ============================================================================
 *  LOS PESOS DE SACO QUE SE DECLARAN EN LA PROFORMA Y EN EL CONTRATO (093)
 * ============================================================================
 *  Cada línea se vende con un peso de saco (20 kg) y puede aceptar otros
 *  (28 kg): «*BAGS OF 20 KG/28 KG». Así Almacén puede despachar con una u
 *  otra presentación, o mezclarlas (20 % de 20 kg y 80 % de 28 kg). Varias
 *  líneas con sacos distintos se siguen uniendo como en el modelo:
 *  «BAGS OF 30 KG AND/OR 20 KG».
 * ============================================================================
 */

const kgTexto = (k: number) => `${Number(k.toFixed(2))} KG`;

/** Lo que viene de la base (numeric[] → texto o número) como lista de kilos válidos. */
export function leerSacosAlternativos(v: unknown): number[] {
  return (Array.isArray(v) ? v : []).map(Number).filter((k) => k > 0);
}

/**
 * «30 KG AND/OR 20 KG/28 KG»: un grupo por peso de saco de la línea (de mayor
 * a menor), y dentro de cada grupo sus alternativos separados por «/».
 */
export function textoPesosSaco(lineas: { kg: number; alternativos?: number[] }[]): string {
  const grupos = new Map<number, Set<number>>();
  for (const l of lineas) {
    if (!(l.kg > 0)) continue;
    const g = grupos.get(l.kg) ?? new Set<number>();
    for (const a of l.alternativos ?? []) if (a > 0 && a !== l.kg) g.add(a);
    grupos.set(l.kg, g);
  }
  return [...grupos.entries()]
    .sort(([a], [b]) => b - a)
    .map(([kg, alt]) => [kg, ...[...alt].sort((a, b) => a - b)].map(kgTexto).join('/'))
    .join(' AND/OR ');
}
