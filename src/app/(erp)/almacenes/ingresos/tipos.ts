/**
 * ============================================================================
 *  INGRESOS · los tipos que comparten el formulario, la importación y la base
 * ============================================================================
 *  Archivo sin código de servidor: lo pueden importar tanto las pantallas
 *  como las acciones.
 * ============================================================================
 */

/** Quién puede meter producto a cámara (formulario, importación y confirmar llegadas). */
export const PUEDEN_INGRESAR = ['gerencia', 'operaciones', 'almacen'] as const;

/**
 * Quién VALIDA una importación de ingresos: Walter, Marco y Oliver, que en el
 * sistema son Gerencia y Operaciones. Almacén la prepara y la deja lista.
 */
export const PUEDEN_VALIDAR_IMPORTACION = ['gerencia', 'operaciones'] as const;

export type DatosIngreso = {
  codigo_pallet: string;
  sku_presentacion_id: number;
  almacen_id: number;
  camara_id: number | null;
  fecha_produccion: string;      // AAAA-MM-DD
  turno: 'dia' | 'noche';
  proceso: 'propia' | 'maquila';
  planta_id: number | null;
  linea_procesadora_id: number | null;
  bultos: number;
  peso_neto_kg: number;
  costo_unitario: number;
  observaciones: string | null;
  /**
   * Observaciones de octubre, punto 11: de dónde viene el producto.
   * Producción = planta propia o maquila; Compras = adquirido a un tercero.
   * Se guarda en el MOVIMIENTO y se puede consultar en Ingresos y en el Kardex.
   */
  origen_ingreso: 'produccion' | 'compras' | '';
  proveedor: string | null;
};

/** Una bodega con lo que admite (074). */
export type BodegaIngreso = {
  id: number;
  nombre: string;
  recibe_produccion: boolean;
  recibe_compras: boolean;
};

/** ¿Esta bodega recibe ingresos de este origen? Sin origen elegido, cualquiera que reciba algo. */
export function bodegaAdmite(b: BodegaIngreso, origen: DatosIngreso['origen_ingreso']): boolean {
  if (origen === 'produccion') return b.recibe_produccion;
  if (origen === 'compras') return b.recibe_compras;
  return b.recibe_produccion || b.recibe_compras;
}

export const NOMBRE_ORIGEN: Record<string, string> = { produccion: 'Producción', compras: 'Compras' };
