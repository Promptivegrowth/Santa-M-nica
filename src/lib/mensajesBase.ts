/**
 * ============================================================================
 *  LO QUE DICE LA BASE, DICHO PARA UNA PERSONA
 * ============================================================================
 *  Cuando la base rechaza algo, hay dos clases de mensaje:
 *
 *   · Los que escribimos nosotros en las funciones y disparadores («La bodega
 *     Depsa no recibe ingresos de Producción…»). Están en español, dicen qué
 *     pasó y qué hacer: se muestran tal cual.
 *   · Los de PostgreSQL o de la API («new row violates row-level security
 *     policy for table "lotes"», «duplicate key value violates unique
 *     constraint…»). Nombran tablas y columnas, y no le dicen nada a quien
 *     está registrando un pallet. Esos se traducen.
 *
 *  Y cuando no se puede saber qué pasó, se dice eso, sin inventar.
 * ============================================================================
 */
import { NOMBRE_ROL, type Rol } from './navegacion';

/** «Gerencia, Operaciones y Almacén», a partir de las claves internas. */
export function quienesPueden(roles: readonly string[]): string {
  const nombres = roles.map((r) => NOMBRE_ROL[r as Rol] ?? r);
  if (nombres.length <= 1) return nombres.join('');
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

/**
 * «Comercio Exterior no puede registrar ingresos a cámara: lo hacen Gerencia,
 * Operaciones y Almacén.» Con el nombre del rol, nunca con su clave interna.
 */
export function rolNoPuede(rol: string, que: string, roles: readonly string[]): string {
  const nombre = NOMBRE_ROL[rol as Rol] ?? rol;
  return `${nombre} no puede ${que}: lo ${roles.length === 1 ? 'hace' : 'hacen'} ${quienesPueden(roles)}.`;
}

/** Huellas de un mensaje técnico: si aparece alguna, no se enseña tal cual. */
const TECNICO = /violates|constraint|relation "|column "|syntax|null value|permission denied|row-level security|duplicate key|invalid input|PGRST|JWT|fetch failed|ECONN/i;

/**
 * Traduce el error de una escritura. `quien` completa el mensaje de permisos
 * («lo hacen Gerencia y Operaciones»).
 */
export function traducirErrorBase(
  error: { message?: string; code?: string } | null | undefined,
  contexto: { que: string; quien?: readonly string[] }
): string {
  const m = String(error?.message ?? '').trim();
  if (!m) return `No se pudo ${contexto.que}. Vuelva a intentarlo; si se repite, avise a soporte.`;

  if (/row-level security|permission denied/i.test(m) || error?.code === '42501') {
    return contexto.quien?.length
      ? `Su usuario no tiene permiso para ${contexto.que}: lo ${contexto.quien.length === 1 ? 'hace' : 'hacen'} ${quienesPueden(contexto.quien)}.`
      : `Su usuario no tiene permiso para ${contexto.que}.`;
  }
  if (/duplicate key|unique/i.test(m) || error?.code === '23505') {
    return `No se pudo ${contexto.que}: ya existe un registro con esos mismos datos (otra persona pudo haberlo registrado hace un momento). Recargue y revise.`;
  }
  if (!TECNICO.test(m)) return m;   // es uno de los nuestros: ya está en palabras

  console.error(`Error de la base al ${contexto.que}:`, m);
  return `No se pudo ${contexto.que} por un error del sistema. Vuelva a intentarlo; si se repite, avise a soporte.`;
}
