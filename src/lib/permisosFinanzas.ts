/**
 * ============================================================================
 *  QUIÉN HACE QUÉ EN FINANZAS
 * ============================================================================
 *  Un solo sitio para las tres decisiones de Finanzas, para que el botón, la
 *  acción del servidor y el menú no vuelvan a contradecirse (antes Operaciones
 *  tenía el botón de emitir pero no veía Facturación en el menú, y la política
 *  de la base dejaba cobrar a Comercial mientras la pantalla se lo negaba).
 *
 *  La base de datos impone lo mismo por su cuenta (migración 070): esto es lo
 *  que la pantalla usa para habilitar o explicar cada botón.
 * ============================================================================
 */
import type { Rol } from './navegacion';

/** Emiten el comprobante desde el pedido. */
export const PUEDEN_FACTURAR: Rol[] = ['gerencia', 'operaciones', 'comercial'];

/** Registran cobros y anulan comprobantes. */
export const PUEDEN_COBRAR: Rol[] = ['gerencia', 'operaciones'];

/**
 * Descargan el PDF / Excel del comprobante. Es la lista de la API de
 * documentos (api/documentos/[tipo]/[id]): Almacén, Calidad y Consulta ven la
 * ficha pero no se llevan un documento con precios.
 */
export const PUEDEN_DESCARGAR_DOCUMENTOS: Rol[] = ['gerencia', 'operaciones', 'comercial', 'comex'];

/** Medios de pago que acepta la base (registrar_cobranza). */
export const MEDIOS_DE_PAGO = ['Transferencia', 'Depósito', 'Carta de crédito', 'Cheque', 'Efectivo'] as const;

/** Largo mínimo del motivo de anulación (lo exige la base). */
export const MOTIVO_MINIMO = 10;

/** Colores de cada estado del comprobante, iguales en todas las pantallas. */
export const TONO_ESTADO_FACTURA: Record<string, 'ok' | 'atencion' | 'critico' | 'info' | 'neutro'> = {
  cobrada: 'ok',
  parcialmente_cobrada: 'atencion',
  vencida: 'critico',
  emitida: 'info',
  anulada: 'neutro',
};

/**
 * Bloquean o desbloquean un cliente y cambian su línea de crédito (076).
 * Es control financiero, no comercial: Comercial vende, pero no decide
 * cuánto se le fía al cliente ni lo destraba. La base lo exige también
 * (disparador clientes_proteger_credito).
 */
export const PUEDEN_GESTIONAR_CREDITO: Rol[] = ['gerencia', 'operaciones'];

/**
 * Los ciclos del pedido desde los que se emite el comprobante (076). Un
 * pedido en borrador o «pendiente de validación» todavía no lo confirmó
 * Gerencia u Operaciones; uno cancelado no se factura. La base lo exige
 * también (disparador facturas_exigir_pedido_confirmado).
 */
export const CICLOS_FACTURABLES = ['confirmado', 'despachado', 'cerrado'] as const;

/** Por qué no se puede emitir desde un pedido en este ciclo, o null si se puede. */
export function motivoNoFacturarCiclo(ciclo: string | null | undefined): string | null {
  const c = String(ciclo ?? '');
  if ((CICLOS_FACTURABLES as readonly string[]).includes(c)) return null;
  if (c === 'cancelado') return 'El pedido está cancelado: no se le emite comprobante.';
  return 'Primero Gerencia u Operaciones debe confirmar el pedido: ' +
    (c === 'borrador' ? 'todavía es un borrador.' : 'está pendiente de validación.');
}
