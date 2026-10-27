/**
 * ============================================================================
 *  QUIÉN HACE QUÉ EN LOGÍSTICA (embarques, packing, despachos)
 * ============================================================================
 *  Las listas de roles vivían repetidas en cada acción y en cada pantalla, y
 *  los mensajes decían la clave interna del rol: «Su rol (comex) no puede…».
 *  Aquí quedan juntas, y el mensaje dice el nombre que ve el usuario y quién
 *  SÍ puede hacerlo, para que sepa a quién pedírselo:
 *
 *      «Comercio Exterior no puede armar traslados de consolidación: lo hacen
 *       Gerencia, Operaciones o Almacén.»
 *
 *  Esto es la regla de la pantalla y de la acción del servidor. La base de
 *  datos tiene la suya (RLS y puede() en las funciones), que es la que manda.
 * ============================================================================
 */
import { NOMBRE_ROL, type Rol } from './navegacion';

/** Programan y editan embarques, y les arman contenedores. */
export const PUEDEN_EMBARQUES: Rol[] = ['gerencia', 'operaciones', 'comex', 'almacen'];
/** Confirman y cancelan la salida (booking, cliente, flete). */
export const PUEDEN_DECIDIR_EMBARQUE: Rol[] = ['gerencia', 'operaciones', 'comex'];
/** Cargan pallets, arman el plano y completan los datos del contenedor. */
export const PUEDEN_PACKING: Rol[] = ['gerencia', 'operaciones', 'almacen', 'comex'];
/** Sacan la mercadería de cámara y adjuntan la guía y las fotos. */
export const PUEDEN_DESPACHAR: Rol[] = ['gerencia', 'operaciones', 'almacen', 'comex'];
/**
 * Arman el traslado de consolidación («Armar el traslado de … TM»).
 * ESPEJO de PUEDEN_SOLICITAR en `almacenes/traslados/acciones.ts`, que es la
 * regla de verdad (otra área): si cambia allí, hay que cambiarla aquí.
 */
export const PUEDEN_CONSOLIDAR: Rol[] = ['gerencia', 'operaciones', 'almacen'];

/** «Gerencia, Operaciones o Almacén». */
export function listaRoles(roles: readonly string[]): string {
  const nombres = roles.map((r) => NOMBRE_ROL[r as Rol] ?? r);
  if (nombres.length <= 1) return nombres.join('');
  return `${nombres.slice(0, -1).join(', ')} o ${nombres[nombres.length - 1]}`;
}

/** El nombre del rol para el usuario («Comercio Exterior»), o «Su usuario» si no se conoce. */
export function nombreRol(rol: string | null | undefined): string {
  return (rol && NOMBRE_ROL[rol as Rol]) || 'Su usuario';
}

/**
 * «Comercio Exterior no puede despachar mercadería: lo hacen Gerencia,
 * Operaciones o Almacén.» `que` va en infinitivo y en minúscula.
 */
export function mensajeNoPuede(rol: string | null | undefined, que: string, permitidos: readonly string[]): string {
  return `${nombreRol(rol)} no puede ${que}: lo hacen ${listaRoles(permitidos)}.`;
}

/**
 * El error de la base, dicho para el usuario.
 *
 * Las funciones y disparadores de Logística lanzan sus excepciones en
 * castellano («El pallet … está bloqueado por Calidad…»): esas se pasan tal
 * cual. Lo que viene del motor —una restricción, un permiso de RLS, un nombre
 * de columna— no le sirve a nadie en el muelle: se cambia por una frase que
 * dice qué no se pudo hacer y qué hacer ahora.
 */
export function mensajeDeBase(error: { message?: string; code?: string } | null | undefined, queNoSePudo: string): string {
  const texto = String(error?.message ?? '');
  const tecnico =
    !texto ||
    /violates|constraint|permission denied|row-level security|duplicate key|syntax error|does not exist|invalid input|null value|relation "|column "|function .*\(/i.test(texto);
  if (error?.code === '42501' || /row-level security|permission denied/i.test(texto)) {
    return `${queNoSePudo}: su usuario no tiene permiso para esta operación. Pídasela a Gerencia u Operaciones.`;
  }
  return tecnico
    ? `${queNoSePudo}: la base de datos rechazó la operación. Recargue la pantalla y vuelva a intentarlo; si se repite, avise a Sistemas.`
    : `${queNoSePudo}: ${texto}`;
}

/** Si el rol está entre los permitidos. */
export function rolPuede(rol: string | null | undefined, permitidos: readonly string[]): boolean {
  return !!rol && permitidos.includes(rol);
}
