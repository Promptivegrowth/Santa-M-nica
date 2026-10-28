/**
 * ============================================================================
 *  QUIÉN PUEDE QUÉ EN COTIZACIONES Y PEDIDOS
 * ============================================================================
 *  Reglas de permiso que necesitan a la vez la pantalla (para mostrar o
 *  apagar un botón) y el servidor (para que el control sea de verdad). Si
 *  cada lado escribe su propia lista, tarde o temprano dejan de coincidir:
 *  eso pasó con la restricción de peso, que la pantalla ofrecía a Almacén y
 *  el servidor le rechazaba, mientras a Comercio Exterior —que sí podía— no
 *  le aparecía el botón. Lo encontró la revisión de la Guía de uso.
 *
 *  Este archivo NO es 'use server' a propósito: un archivo de acciones solo
 *  puede exportar funciones asíncronas, y aquí hay listas que se importan
 *  desde los dos lados.
 * ============================================================================
 */
import { puedeVender, rolPuedeVerRuta, NOMBRE_ROL, type Rol } from '@/lib/navegacion';

/**
 * ¿Puede este rol crear (y modificar) cotizaciones?
 *
 * Hace falta vender (`puedeVender`) Y tener la entrada de Cotizaciones en el
 * menú. Comercio Exterior registra pedidos directos pero no entra a
 * Cotizaciones; Almacén, Calidad y Consulta no venden. Ofrecerles un botón
 * «Cotizar» los mandaba a una pantalla que les cierra la puerta.
 */
export function puedeCotizar(rol: Rol | string | null | undefined): boolean {
  const r = (rol ?? 'consulta') as Rol;
  return puedeVender(r) && rolPuedeVerRuta(r, '/ventas/cotizaciones');
}

/**
 * Quién anota la restricción de peso que el cliente le pone al pedido.
 *
 * Es lo que ya decía la base (`fijar_restriccion_pedido`, migración 047):
 * Gerencia, Operaciones, Comercial y Comercio Exterior. El 90 % de esas
 * indicaciones el cliente se las da a Comercial, y Comex las recibe de la
 * naviera. Almacén las LEE en el planificador, pero no las fija.
 */
export const ROLES_RESTRICCION_PESO: readonly Rol[] = ['gerencia', 'operaciones', 'comercial', 'comex'];

export function puedeFijarRestriccionPeso(rol: Rol | string | null | undefined): boolean {
  return ROLES_RESTRICCION_PESO.includes((rol ?? '') as Rol);
}

/**
 * Quién marca una cotización como rechazada (el cliente dijo que no).
 * Los mismos que la trabajan: Gerencia, Operaciones y Comercial.
 */
export const ROLES_RECHAZAN_COTIZACION: readonly Rol[] = ['gerencia', 'operaciones', 'comercial'];

/* ==========================================================================
   NOMBRES DE ROL PARA LOS MENSAJES (ronda de Oliver, 076)
   --------------------------------------------------------------------------
   «Su rol (comex) no puede…» enseñaba la clave interna. Los mensajes dicen
   el nombre que la persona ve en el menú y, además, QUIÉN sí puede.
   ========================================================================== */

/** «Comercio Exterior», no «comex». */
export function nombreRol(rol: Rol | string | null | undefined): string {
  return NOMBRE_ROL[(rol ?? 'consulta') as Rol] ?? String(rol ?? '');
}

/** «Gerencia, Operaciones o Comercial». */
export function listaDeRoles(roles: readonly Rol[]): string {
  const nombres = roles.map((r) => NOMBRE_ROL[r]);
  if (nombres.length <= 1) return nombres.join('');
  return `${nombres.slice(0, -1).join(', ')} o ${nombres.at(-1)}`;
}

/* ==========================================================================
   APARTAR Y LIBERAR STOCK (076)
   --------------------------------------------------------------------------
   Una sola lista para la pantalla, el servidor y la base (política de la
   tabla reservas, migración 076). Antes cada lado tenía la suya: la pantalla
   y el servidor dejaban a Almacén, la base no, y Almacén veía el botón y
   recibía «violates row-level security policy». La base, a la vez, dejaba a
   Comercio Exterior, al que ni la pantalla ni el servidor dejaban.

   Quedan: Gerencia, Operaciones, Comercial y Almacén. Almacén atiende las
   reservas de los pedidos (elige el pallet que conviene sacar). Comercio
   Exterior no aparta: programa embarques y lee lo que está apartado.
   ========================================================================== */
export const ROLES_APARTAN_STOCK: readonly Rol[] = ['gerencia', 'operaciones', 'comercial', 'almacen'];

export function puedeApartarStock(rol: Rol | string | null | undefined): boolean {
  return ROLES_APARTAN_STOCK.includes((rol ?? '') as Rol);
}

/** Liberan cualquier reserva, también la que apartó otra persona (lo exige la base). */
export const ROLES_LIBERAN_CUALQUIER_RESERVA: readonly Rol[] = ['gerencia', 'operaciones'];

/**
 * ¿Puede esta persona liberar esta reserva? Devuelve null si puede, o el
 * porqué si no, para el título del botón apagado y para el servidor.
 *
 * Es la regla de reserva_liberar (base): quien la apartó puede soltarla;
 * una ajena, solo Gerencia u Operaciones.
 */
export function motivoNoLiberar(
  rol: Rol | string | null | undefined,
  usuarioId: string | null | undefined,
  creadoPor: string | null | undefined
): string | null {
  const r = (rol ?? 'consulta') as Rol;
  if (ROLES_LIBERAN_CUALQUIER_RESERVA.includes(r)) return null;
  if (!ROLES_APARTAN_STOCK.includes(r)) {
    return `${nombreRol(r)} no libera reservas: lo hacen ${listaDeRoles(ROLES_APARTAN_STOCK)}.`;
  }
  if (!creadoPor || creadoPor !== usuarioId) {
    return 'Esta reserva la apartó otra persona: solo Gerencia u Operaciones pueden liberarla. ' +
      'Pídaselo a ellos o a quien la apartó.';
  }
  return null;
}

/* ==========================================================================
   COTIZACIONES: ELIMINAR Y APROBAR (076)
   ========================================================================== */

/** Eliminan una cotización que ya no es borrador (enviada, aprobada, vencida, rechazada). */
export const ROLES_ELIMINAN_COTIZACION_CON_HISTORIA: readonly Rol[] = ['gerencia', 'operaciones'];

/** Cómo se dice cada estado dentro de una frase. */
const ESTADO_EN_FRASE: Record<string, string> = {
  aprobada: 'ya está aprobada',
  enviada: 'ya fue enviada al cliente',
  vencida: 'está vencida',
  rechazada: 'está rechazada',
  aceptada: 'ya fue aceptada',
};

/**
 * ¿Se puede eliminar? null si sí; si no, la causa REAL. Antes el servidor
 * decía «ya fue enviada al cliente» de una vencida que nunca salió, y la
 * papelera estaba encendida para Comercial. Lo usan la papelera y el servidor.
 */
export function motivoNoEliminarCotizacion(
  rol: Rol | string | null | undefined,
  estado: string,
  numero: string,
  yaConvertida: boolean
): string | null {
  const r = (rol ?? 'consulta') as Rol;
  if (!puedeVender(r)) return `${nombreRol(r)} no elimina cotizaciones.`;
  if (yaConvertida) return `No se puede eliminar: ${numero} generó un pedido. Si quiere anularla, márquela como rechazada.`;
  if (estado === 'borrador' || ROLES_ELIMINAN_COTIZACION_CON_HISTORIA.includes(r)) return null;
  const como = ESTADO_EN_FRASE[estado] ?? `está ${estado}`;
  return `${numero} ${como}: ya no es un borrador y queda como historia. ` +
    `Solo ${listaDeRoles(ROLES_ELIMINAN_COTIZACION_CON_HISTORIA)} pueden eliminarla` +
    (['aprobada', 'enviada'].includes(estado) ? '; usted puede marcarla como rechazada.' : '.');
}

/**
 * ¿Venció la validez? Se compara la fecha «vence_el» (AAAA-MM-DD) con hoy en
 * Lima. El día del vencimiento todavía vale.
 */
export function validezVencida(venceEl: string | null | undefined, hoy: string): boolean {
  return !!venceEl && String(venceEl).slice(0, 10) < hoy;
}

/**
 * El aviso de validez vencida, con la fecha en dd/mm/aaaa y dicho a QUIEN LO LEE.
 *
 * Antes era uno solo («pídale a Comercial que la actualice antes de aprobar»)
 * y lo leía también el propio vendedor, que es justamente Comercial: se le
 * pedía que se pidiera algo a sí mismo. Ahora depende de lo que puede hacer
 * la persona con esta cotización:
 *   · la edita y no aprueba (Comercial, Comex…): que la actualice con Editar
 *     antes de pedir la aprobación;
 *   · la aprueba y no la edita: que se lo pida a Comercial;
 *   · las dos cosas (Gerencia): que la actualice y después la apruebe;
 *   · ninguna (Consulta, Almacén…): solo se le informa quién debe hacerlo.
 */
export function mensajeValidezVencida(
  venceEl: string,
  quien: { edita: boolean; aprueba: boolean } = { edita: false, aprueba: true }
): string {
  const [a, m, d] = String(venceEl).slice(0, 10).split('-');
  const inicio = `La validez venció el ${d}/${m}/${a}: `;
  if (quien.edita && quien.aprueba) return `${inicio}actualice la validez con Editar y después apruébela.`;
  if (quien.edita) return `${inicio}actualice la validez con Editar antes de pedir la aprobación.`;
  if (quien.aprueba) return `${inicio}pídale a Comercial que la actualice antes de aprobar.`;
  return `${inicio}Comercial debe actualizarla antes de que se apruebe.`;
}
