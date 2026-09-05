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
  /**
   * Icono PROPIO de esta entrada. No se comparte con el grupo: un icono
   * repetido seis veces seguidas no informa nada y solo añade ruido visual.
   * El objetivo es que se reconozca la pantalla por su forma antes de leerla.
   */
  icono: string;
  /** Descripción corta que se muestra como ayuda contextual. */
  ayuda?: string;
  roles: Rol[] | 'todos';
};

export type Grupo = {
  grupo: string;
  entradas: Entrada[];
};

const TODOS = 'todos' as const;

export const NAVEGACION: Grupo[] = [
  {
    grupo: 'Panel',
    entradas: [
      { titulo: 'Control Tower', ruta: '/panel',   icono: 'panel',  ayuda: 'Los indicadores del día', roles: TODOS },
      { titulo: 'Alertas',       ruta: '/alertas', icono: 'alerta', ayuda: 'Lo que necesita atención', roles: TODOS },
    ],
  },
  {
    grupo: 'Ventas',
    entradas: [
      { titulo: 'Clientes',           ruta: '/ventas/clientes',       icono: 'clientes',       ayuda: 'Cartera, crédito e historial', roles: ['gerencia', 'operaciones', 'comercial', 'comex', 'consulta'] },
      { titulo: 'Productos',          ruta: '/ventas/productos',      icono: 'productos',      ayuda: 'El maestro de lo que se vende', roles: TODOS },
      { titulo: 'Cotizaciones',       ruta: '/ventas/cotizaciones',   icono: 'cotizacion',     ayuda: 'Precios ofrecidos al cliente', roles: ['gerencia', 'operaciones', 'comercial', 'consulta'] },
      { titulo: 'Pedidos',            ruta: '/ventas/pedidos',        icono: 'pedido',         ayuda: 'Las proformas y su avance', roles: TODOS },
      { titulo: 'Disponibilidad',     ruta: '/ventas/disponibilidad', icono: 'disponibilidad', ayuda: 'Cuánto se puede vender de verdad', roles: TODOS },
      { titulo: 'Control de pedidos', ruta: '/ventas/control',        icono: 'control',        ayuda: 'Los que están en riesgo', roles: ['gerencia', 'operaciones', 'comercial', 'comex', 'consulta'] },
      { titulo: 'Necesidades',        ruta: '/ventas/necesidades',    icono: 'necesidades',    ayuda: 'Qué falta producir o comprar', roles: ['gerencia', 'operaciones', 'comercial', 'consulta'] },
      { titulo: 'Tiempos del flujo',  ruta: '/ventas/tiempos',        icono: 'planificador',   ayuda: 'Cuánto tarda cada paso, de la oferta al cobro', roles: ['gerencia', 'operaciones', 'comercial', 'comex', 'consulta'] },
    ],
  },
  {
    grupo: 'Almacenes',
    entradas: [
      { titulo: 'Existencias',           ruta: '/almacenes/existencias',   icono: 'existencias',   ayuda: 'Físico, reservado y disponible', roles: TODOS },
      { titulo: 'Reservas',              ruta: '/almacenes/reservas',      icono: 'reservas',       ayuda: 'Qué stock está apartado y por qué', roles: TODOS },
      { titulo: 'Movimientos del día',   ruta: '/almacenes/movimientos',   icono: 'movimientos',   ayuda: 'El parte diario: qué entró y qué salió', roles: TODOS },
      { titulo: 'Kardex',                ruta: '/almacenes/kardex',        icono: 'kardex',        ayuda: 'El diario del almacén', roles: TODOS },
      { titulo: 'Ingresos',              ruta: '/almacenes/ingresos',      icono: 'ingresos',      ayuda: 'Lo que entró a cámara', roles: ['gerencia', 'operaciones', 'almacen', 'consulta'] },
      { titulo: 'Traslados',             ruta: '/almacenes/traslados',     icono: 'traslados',     ayuda: 'Movimientos entre bodegas', roles: ['gerencia', 'operaciones', 'almacen', 'comex', 'consulta'] },
      { titulo: 'Calidad',               ruta: '/almacenes/calidad',       icono: 'calidad',       ayuda: 'Producto observado y liberado', roles: TODOS },
      { titulo: 'Anticuamiento',         ruta: '/almacenes/anticuamiento', icono: 'anticuamiento', ayuda: 'Producto que lleva mucho tiempo', roles: TODOS },
      { titulo: 'Inventario valorizado', ruta: '/almacenes/valorizado',    icono: 'valorizado',    ayuda: 'Cuánto vale lo que hay', roles: ['gerencia', 'operaciones', 'comercial'] },
    ],
  },
  {
    grupo: 'Logística',
    entradas: [
      /*
       * COMERCIAL entra aquí, y no por comodidad: se pidió que sea Comercial
       * quien deje el peso máximo que admite el contenedor y la nota para
       * Almacén, y el sitio acordado es esta pantalla. Sin acceso, la persona
       * que tiene el dato no podría escribirlo.
       */
      { titulo: 'Planificador',     ruta: '/logistica/planificador', icono: 'planificador', ayuda: 'Calendario de embarques', roles: ['gerencia', 'operaciones', 'comercial', 'comex', 'almacen', 'consulta'] },
      { titulo: 'Embarques',        ruta: '/logistica/embarques',    icono: 'embarques',    ayuda: 'Programación de salidas', roles: ['gerencia', 'operaciones', 'comex', 'almacen', 'consulta'] },
      { titulo: 'Packing y estiba', ruta: '/logistica/packing',      icono: 'packing',      ayuda: 'La carga del contenedor', roles: ['gerencia', 'operaciones', 'comex', 'almacen', 'consulta'] },
      { titulo: 'Despachos',        ruta: '/logistica/despachos',    icono: 'despachos',    ayuda: 'Lo que ya salió', roles: TODOS },
      { titulo: 'Flota',            ruta: '/logistica/flota',        icono: 'flota',        ayuda: 'Vehículos, conductores y sus documentos', roles: ['gerencia', 'operaciones', 'comex', 'almacen', 'consulta'] },
    ],
  },
  {
    grupo: 'Finanzas',
    entradas: [
      { titulo: 'Facturación',        ruta: '/finanzas/facturas',     icono: 'facturas',     ayuda: 'Comprobantes emitidos', roles: ['gerencia', 'comercial', 'comex', 'consulta'] },
      { titulo: 'Cuentas por cobrar', ruta: '/finanzas/cobrar',       icono: 'cobrar',       ayuda: 'Quién debe y desde cuándo', roles: ['gerencia', 'comercial', 'consulta'] },
      { titulo: 'Rentabilidad',       ruta: '/finanzas/rentabilidad', icono: 'rentabilidad', ayuda: 'Margen por pedido y cliente', roles: ['gerencia', 'operaciones', 'comercial'] },
    ],
  },
  {
    grupo: 'Trazabilidad',
    entradas: [
      { titulo: 'Buscador universal', ruta: '/trazabilidad',           icono: 'trazabilidad', ayuda: 'Busque cualquier código del negocio', roles: TODOS },
      { titulo: 'Retiro sanitario',   ruta: '/trazabilidad/retiro',    icono: 'retiro',       ayuda: 'Alcance de un lote observado', roles: ['gerencia', 'operaciones', 'calidad', 'comex'] },
      { titulo: 'Auditoría',          ruta: '/trazabilidad/auditoria', icono: 'auditoria',    ayuda: 'Quién cambió qué y cuándo', roles: ['gerencia', 'operaciones'] },
    ],
  },
  {
    grupo: 'Sistema',
    entradas: [
      { titulo: 'Reportes',      ruta: '/reportes',      icono: 'reportes',      ayuda: 'Exportar a Excel con la marca', roles: TODOS },
      { titulo: 'Configuración', ruta: '/configuracion', icono: 'configuracion', ayuda: 'Parámetros, maestros y reglas', roles: ['gerencia', 'operaciones'] },
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

/** ¿Este rol puede crear cotizaciones y pedidos? */
export function puedeVender(rol: Rol): boolean {
  return ['gerencia', 'operaciones', 'comercial', 'comex'].includes(rol);
}

/**
 * ¿Puede este rol abrir esta ruta?
 * Se usa en el proxy para cortar el acceso ANTES de renderizar nada, en lugar
 * de dejar que la pantalla se empiece a dibujar y luego rebote. Así el usuario
 * no ve un esqueleto que desaparece, y la respuesta es una redirección real.
 */
export function rolPuedeVerRuta(rol: Rol, ruta: string): boolean {
  // Se busca la entrada más específica que coincida con la ruta pedida
  let mejor: Entrada | null = null;
  for (const g of NAVEGACION) {
    for (const e of g.entradas) {
      const coincide = ruta === e.ruta || ruta.startsWith(e.ruta + '/');
      if (coincide && (!mejor || e.ruta.length > mejor.ruta.length)) {
        mejor = e;
      }
    }
  }
  // Si la ruta no está en el menú (por ejemplo, un formulario de alta), se
  // permite: la propia pantalla y las políticas de la base la protegen.
  if (!mejor) return true;
  return mejor.roles === 'todos' || (mejor.roles as Rol[]).includes(rol);
}
