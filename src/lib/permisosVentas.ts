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
import { puedeVender, rolPuedeVerRuta, type Rol } from '@/lib/navegacion';

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
