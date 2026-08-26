/**
 * ============================================================================
 *  AYUDANTES PARA RELACIONES ANIDADAS
 * ============================================================================
 *  Cuando se pide un dato relacionado (por ejemplo, el cliente de un pedido),
 *  Supabase a veces lo devuelve como objeto y a veces como lista de un solo
 *  elemento, según cómo interprete la relación. TypeScript, al no poder saber
 *  cuál será, se queja.
 *
 *  Estas dos funciones normalizan el resultado para que el código de las
 *  pantallas quede limpio y sin conversiones de tipo repartidas por todas
 *  partes.
 * ============================================================================
 */

/** Devuelve el primer elemento si vino como lista, o el objeto tal cual. */
export function uno<T = Record<string, unknown>>(relacion: unknown): T | undefined {
  if (relacion === null || relacion === undefined) return undefined;
  const valor = Array.isArray(relacion) ? relacion[0] : relacion;
  return (valor ?? undefined) as T | undefined;
}

/** Lee un campo de texto de una relación anidada, con valor por defecto. */
export function campo(relacion: unknown, nombre: string, defecto = '—'): string {
  const obj = uno<Record<string, unknown>>(relacion);
  const v = obj?.[nombre];
  return v === null || v === undefined || v === '' ? defecto : String(v);
}
