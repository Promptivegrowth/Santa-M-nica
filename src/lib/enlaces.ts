/**
 * ============================================================================
 *  ENLACES ENTRE ENTIDADES
 * ============================================================================
 *  Un ERP se usa navegando: se ve una alerta y se quiere ir al lote que la
 *  provocó; se ve un pedido y se quiere abrir su cliente; se ve un traslado y
 *  se quiere ver su detalle.
 *
 *  Este archivo es el único lugar que sabe dónde vive cada cosa. Si mañana
 *  cambia una ruta, se cambia aquí y cambia en todo el sistema.
 * ============================================================================
 */

/** Nombres de entidad tal como los guardan las tablas alertas y eventos. */
export type Entidad =
  | 'lote' | 'lotes'
  | 'reserva' | 'reservas'
  | 'traslado' | 'traslados'
  | 'pedido' | 'pedidos'
  | 'cotizacion' | 'cotizaciones'
  | 'cliente' | 'clientes'
  | 'factura' | 'facturas'
  | 'embarque' | 'embarques'
  | 'packing_list' | 'packing_lists'
  | 'despacho' | 'despachos'
  | 'vehiculo' | 'vehiculos'
  | 'dictamenes_calidad'
  | string;

/**
 * Devuelve a dónde lleva un registro, o null si esa entidad no tiene ficha
 * propia (por ejemplo, un vehículo: se ve dentro de Configuración).
 */
export function enlaceEntidad(entidad: Entidad, id: number | string | null): string | null {
  if (id === null || id === undefined || Number(id) <= 0) return null;

  switch (entidad) {
    case 'lote':
    case 'lotes':
      return `/almacenes/lotes/${id}`;

    case 'reserva':
    case 'reservas':
      // La reserva no tiene ficha propia: se ve dentro de su pedido.
      // El listado de reservas del almacén filtra por identificador.
      return `/almacenes/reservas?id=${id}`;

    case 'traslado':
    case 'traslados':
      return `/almacenes/traslados/${id}`;

    case 'pedido':
    case 'pedidos':
      return `/ventas/pedidos/${id}`;

    case 'cotizacion':
    case 'cotizaciones':
      return `/ventas/cotizaciones/${id}`;

    case 'cliente':
    case 'clientes':
      return `/ventas/clientes/${id}`;

    case 'factura':
    case 'facturas':
      return `/finanzas/facturas/${id}`;

    case 'embarque':
    case 'embarques':
      return `/logistica/embarques/${id}`;

    case 'packing_list':
    case 'packing_lists':
      return `/logistica/packing/${id}`;

    case 'despacho':
    case 'despachos':
      // El despacho se ve dentro de su packing list
      return `/logistica/despachos?id=${id}`;

    case 'vehiculo':
    case 'vehiculos':
      return `/configuracion?t=maestros`;

    case 'dictamenes_calidad':
      return `/almacenes/calidad`;

    default:
      return null;
  }
}

/** Nombre legible de la entidad, para mostrarlo en pantalla. */
export function nombreEntidad(entidad: Entidad): string {
  const nombres: Record<string, string> = {
    lote: 'Lote', lotes: 'Lote',
    reserva: 'Reserva', reservas: 'Reserva',
    traslado: 'Traslado', traslados: 'Traslado',
    pedido: 'Pedido', pedidos: 'Pedido',
    cotizacion: 'Cotización', cotizaciones: 'Cotización',
    cliente: 'Cliente', clientes: 'Cliente',
    factura: 'Factura', facturas: 'Factura',
    embarque: 'Embarque', embarques: 'Embarque',
    packing_list: 'Packing list', packing_lists: 'Packing list',
    despacho: 'Despacho', despachos: 'Despacho',
    vehiculo: 'Vehículo', vehiculos: 'Vehículo',
    dictamenes_calidad: 'Dictamen de calidad',
  };
  return nombres[entidad] ?? entidad;
}
