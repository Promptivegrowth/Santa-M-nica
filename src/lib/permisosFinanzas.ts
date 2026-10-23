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
