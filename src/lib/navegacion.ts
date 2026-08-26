/**
 * ============================================================================
 *  MAPA DE NAVEGACIÓN DEL ERP
 * ============================================================================
 *  Un solo lugar define el menú completo. Cada entrada declara qué roles la
 *  pueden ver; la barra lateral simplemente filtra por el rol del usuario.
 *
 *  Ojo: esto es comodidad visual, NO seguridad. La seguridad de verdad está en
 *  las políticas de PostgreSQL. Aquí solo evitamos mostrarle a alguien enlaces
 *  que de todos modos no podría usar.
 * ============================================================================
 */

export type Rol =
  | 'gerencia' | 'operaciones' | 'comercial'
  | 'comex' | 'almacen' | 'calidad' | 'consulta';

export type Entrada = {
  titulo: string;
  ruta: string;
  /** Descripción corta que se muestra como ayuda contextual. */
  ayuda?: string;
  roles: Rol[] | 'todos';
};

export type Grupo = {
  grupo: string;
  /** Identificador corto para el icono. */
  icono: string;
  entradas: Entrada[];
};

const TODOS: 'todos' = 'todos';

export const NAVEGACION: Grupo[] = [
  {
    grupo: 'Panel',
    icono: 'panel',
    entradas: [
      { titulo: 'Control Tower', ruta: '/panel', ayuda: 'Los indicadores del día', roles: TODOS },
      { titulo: 'Alertas', ruta: '/alertas', ayuda: 'Lo que necesita atención', roles: TODOS },
    ],
  },
  {
    grupo: 'Ventas',
    icono: 'ventas',
    entradas: [
      { titulo: 'Clientes',            ruta: '/ventas/clientes',      ayuda: 'Cartera, crédito e historial', roles: ['gerencia','operaciones','comercial','comex','consulta'] },
      { titulo: 'Cotizaciones',        ruta: '/ventas/cotizaciones',  ayuda: 'Precios ofrecidos al cliente', roles: ['gerencia','operaciones','comercial','consulta'] },
      { titulo: 'Pedidos',             ruta: '/ventas/pedidos',       ayuda: 'Las proformas y su avance', roles: TODOS },
      { titulo: 'Disponibilidad',      ruta: '/ventas/disponibilidad',ayuda: 'Cuánto se puede vender de verdad', roles: TODOS },
      { titulo: 'Control de pedidos',  ruta: '/ventas/control',       ayuda: 'Los que están en riesgo', roles: ['gerencia','operaciones','comercial','comex','consulta'] },
      { titulo: 'Necesidades',         ruta: '/ventas/necesidades',   ayuda: 'Qué falta producir o comprar', roles: ['gerencia','operaciones','comercial','consulta'] },
    ],
  },
  {
    grupo: 'Almacenes',
    icono: 'almacen',
    entradas: [
      { titulo: 'Existencias',          ruta: '/almacenes/existencias',  ayuda: 'Físico, reservado y disponible', roles: TODOS },
      { titulo: 'Kardex',               ruta: '/almacenes/kardex',       ayuda: 'El diario del almacén', roles: TODOS },
      { titulo: 'Ingresos',             ruta: '/almacenes/ingresos',     ayuda: 'Lo que entró a cámara', roles: ['gerencia','operaciones','almacen','consulta'] },
      { titulo: 'Traslados',            ruta: '/almacenes/traslados',    ayuda: 'Movimientos entre bodegas', roles: ['gerencia','operaciones','almacen','comex','consulta'] },
      { titulo: 'Calidad',              ruta: '/almacenes/calidad',      ayuda: 'Producto observado y liberado', roles: TODOS },
      { titulo: 'Anticuamiento',        ruta: '/almacenes/anticuamiento',ayuda: 'Producto que lleva mucho tiempo', roles: TODOS },
      { titulo: 'Inventario valorizado',ruta: '/almacenes/valorizado',   ayuda: 'Cuánto vale lo que hay', roles: ['gerencia','operaciones','comercial'] },
    ],
  },
  {
    grupo: 'Logística',
    icono: 'logistica',
    entradas: [
      { titulo: 'Planificador',   ruta: '/logistica/planificador', ayuda: 'Calendario de embarques', roles: ['gerencia','operaciones','comex','almacen','consulta'] },
      { titulo: 'Embarques',      ruta: '/logistica/embarques',    ayuda: 'Programación de salidas', roles: ['gerencia','operaciones','comex','almacen','consulta'] },
      { titulo: 'Packing y estiba',ruta: '/logistica/packing',     ayuda: 'La carga del contenedor', roles: ['gerencia','operaciones','comex','almacen','consulta'] },
      { titulo: 'Despachos',      ruta: '/logistica/despachos',    ayuda: 'Lo que ya salió', roles: TODOS },
    ],
  },
  {
    grupo: 'Finanzas',
    icono: 'finanzas',
    entradas: [
      { titulo: 'Facturación',        ruta: '/finanzas/facturas',    ayuda: 'Comprobantes emitidos', roles: ['gerencia','comercial','comex','consulta'] },
      { titulo: 'Cuentas por cobrar', ruta: '/finanzas/cobrar',      ayuda: 'Quién debe y desde cuándo', roles: ['gerencia','comercial','consulta'] },
      { titulo: 'Rentabilidad',       ruta: '/finanzas/rentabilidad',ayuda: 'Margen por pedido y cliente', roles: ['gerencia','operaciones','comercial'] },
    ],
  },
  {
    grupo: 'Trazabilidad',
    icono: 'trazabilidad',
    entradas: [
      { titulo: 'Buscador universal', ruta: '/trazabilidad',            ayuda: 'Busque cualquier código del negocio', roles: TODOS },
      { titulo: 'Retiro sanitario',   ruta: '/trazabilidad/retiro',     ayuda: 'Alcance de un lote observado', roles: ['gerencia','operaciones','calidad','comex'] },
      { titulo: 'Auditoría',          ruta: '/trazabilidad/auditoria',  ayuda: 'Quién cambió qué y cuándo', roles: ['gerencia','operaciones'] },
    ],
  },
  {
    grupo: 'Sistema',
    icono: 'sistema',
    entradas: [
      { titulo: 'Reportes',      ruta: '/reportes',      ayuda: 'Exportar a Excel con la marca', roles: TODOS },
      { titulo: 'Configuración', ruta: '/configuracion', ayuda: 'Parámetros, maestros y reglas', roles: ['gerencia','operaciones'] },
    ],
  },
];

/** Filtra el menú según el rol del usuario conectado. */
export function navegacionPara(rol: Rol): Grupo[] {
  return NAVEGACION
    .map((g) => ({
      ...g,
      entradas: g.entradas.filter(
        (e) => e.roles === 'todos' || (e.roles as Rol[]).includes(rol)
      ),
    }))
    .filter((g) => g.entradas.length > 0);
}

/** Nombre legible de cada rol, para mostrarlo en pantalla. */
export const NOMBRE_ROL: Record<Rol, string> = {
  gerencia: 'Gerencia',
  operaciones: 'Operaciones',
  comercial: 'Comercial',
  comex: 'Comercio Exterior',
  almacen: 'Almacén',
  calidad: 'Calidad',
  consulta: 'Consulta',
};

/** ¿Este rol puede ver costos y márgenes? */
export function veCostos(rol: Rol): boolean {
  return ['gerencia', 'operaciones', 'comercial'].includes(rol);
}
