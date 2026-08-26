/**
 * ============================================================================
 *  API DE REPORTES · genera y descarga el Excel
 * ============================================================================
 *  Cuando el usuario pulsa "Exportar", el navegador llama a esta dirección.
 *  Aquí se consulta la base de datos con la sesión del usuario (así las
 *  políticas de seguridad se aplican también a las exportaciones: nadie puede
 *  descargar lo que no podría ver en pantalla) y se construye el archivo.
 *
 *  Cada tipo de reporte declara qué vista consulta y qué columnas exporta.
 * ============================================================================
 */
import { NextResponse, type NextRequest } from 'next/server';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { generarReporte, FORMATO, type ColumnaExcel } from '@/lib/excel';
import { veCostos, type Rol } from '@/lib/navegacion';

/** Definición de cada reporte disponible. */
type DefinicionReporte = {
  titulo: string;
  subtitulo: string;
  vista: string;
  orden: string;
  ascendente?: boolean;
  columnas: ColumnaExcel[];
  totalizar?: string[];
  /** Solo para roles que pueden ver costos. */
  requiereCostos?: boolean;
  /** Condición fija sobre la vista. */
  fijo?: { columna: string; valor: string | number | boolean };
};

const REPORTES: Record<string, DefinicionReporte> = {
  /* ─────────────── ALMACÉN ─────────────── */
  existencias: {
    titulo: 'Existencias por lote',
    subtitulo: 'Detalle del stock en cámara, lote por lote y bodega por bodega',
    vista: 'v_anticuamiento',
    orden: 'fisico_kg',
    columnas: [
      { titulo: 'Pallet', clave: 'codigo_pallet', ancho: 18 },
      { titulo: 'SKU', clave: 'sku_codigo', ancho: 8 },
      { titulo: 'Especie', clave: 'especie', ancho: 12 },
      { titulo: 'Formato', clave: 'formato', ancho: 14 },
      { titulo: 'Corte', clave: 'corte', ancho: 24 },
      { titulo: 'Almacén', clave: 'almacen', ancho: 20 },
      { titulo: 'Fecha producción', clave: 'fecha_produccion', ancho: 15, formato: FORMATO.fecha },
      { titulo: 'Meses en cámara', clave: 'meses_almacenado', ancho: 13, formato: FORMATO.decimal },
      { titulo: 'Rango', clave: 'rango', ancho: 10, alineacion: 'center' },
      { titulo: 'Físico (kg)', clave: 'fisico_kg', ancho: 14, formato: FORMATO.kilos },
      { titulo: 'Disponible (kg)', clave: 'disponible_kg', ancho: 15, formato: FORMATO.kilos },
    ],
    totalizar: ['fisico_kg', 'disponible_kg'],
  },

  valorizado: {
    titulo: 'Inventario valorizado',
    subtitulo: 'Stock en cámara con su costo promedio móvil y valor total',
    vista: 'v_anticuamiento',
    orden: 'valor',
    requiereCostos: true,
    columnas: [
      { titulo: 'Pallet', clave: 'codigo_pallet', ancho: 18 },
      { titulo: 'SKU', clave: 'sku_codigo', ancho: 8 },
      { titulo: 'Especie', clave: 'especie', ancho: 12 },
      { titulo: 'Formato', clave: 'formato', ancho: 14 },
      { titulo: 'Corte', clave: 'corte', ancho: 24 },
      { titulo: 'Almacén', clave: 'almacen', ancho: 20 },
      { titulo: 'Físico (kg)', clave: 'fisico_kg', ancho: 14, formato: FORMATO.kilos },
      { titulo: 'Costo promedio', clave: 'costo_promedio', ancho: 15, formato: FORMATO.dolares },
      { titulo: 'Valor', clave: 'valor', ancho: 16, formato: FORMATO.dolares },
    ],
    totalizar: ['fisico_kg', 'valor'],
  },

  kardex: {
    titulo: 'Kardex valorizado',
    subtitulo: 'Todas las entradas y salidas del almacén, en orden cronológico',
    vista: 'v_kardex',
    orden: 'fecha',
    columnas: [
      { titulo: 'Fecha', clave: 'fecha', ancho: 18 },
      { titulo: 'Movimiento', clave: 'tipo', ancho: 18 },
      { titulo: 'Pallet', clave: 'codigo_pallet', ancho: 18 },
      { titulo: 'SKU', clave: 'sku_codigo', ancho: 8 },
      { titulo: 'Producto', clave: 'formato', ancho: 16 },
      { titulo: 'Corte', clave: 'corte', ancho: 22 },
      { titulo: 'Almacén', clave: 'almacen', ancho: 20 },
      { titulo: 'Entrada (kg)', clave: 'entrada_kg', ancho: 14, formato: FORMATO.kilos },
      { titulo: 'Salida (kg)', clave: 'salida_kg', ancho: 14, formato: FORMATO.kilos },
      { titulo: 'Documento', clave: 'documento_ref', ancho: 18 },
      { titulo: 'Registró', clave: 'usuario', ancho: 18 },
    ],
    totalizar: ['entrada_kg', 'salida_kg'],
  },

  anticuamiento: {
    titulo: 'Reporte de anticuamiento',
    subtitulo: 'Producto ordenado por el tiempo que lleva almacenado',
    vista: 'v_anticuamiento',
    orden: 'meses_almacenado',
    columnas: [
      { titulo: 'Pallet', clave: 'codigo_pallet', ancho: 18 },
      { titulo: 'SKU', clave: 'sku_codigo', ancho: 8 },
      { titulo: 'Especie', clave: 'especie', ancho: 12 },
      { titulo: 'Corte', clave: 'corte', ancho: 24 },
      { titulo: 'Almacén', clave: 'almacen', ancho: 20 },
      { titulo: 'Fecha producción', clave: 'fecha_produccion', ancho: 15, formato: FORMATO.fecha },
      { titulo: 'Meses', clave: 'meses_almacenado', ancho: 10, formato: FORMATO.decimal },
      { titulo: 'Rango', clave: 'rango', ancho: 10, alineacion: 'center' },
      { titulo: 'Físico (kg)', clave: 'fisico_kg', ancho: 14, formato: FORMATO.kilos },
      { titulo: 'Valor', clave: 'valor', ancho: 16, formato: FORMATO.dolares },
    ],
    totalizar: ['fisico_kg', 'valor'],
  },

  ocupabilidad: {
    titulo: 'Ocupabilidad de almacenes',
    subtitulo: 'Capacidad utilizada por bodega',
    vista: 'v_ocupabilidad',
    orden: 'ocupado_tm',
    columnas: [
      { titulo: 'Código', clave: 'codigo', ancho: 12 },
      { titulo: 'Almacén', clave: 'almacen', ancho: 24 },
      { titulo: 'Tipo', clave: 'tipo', ancho: 12 },
      { titulo: 'Capacidad (TM)', clave: 'capacidad_tm', ancho: 15, formato: FORMATO.decimal },
      { titulo: 'Ocupado (TM)', clave: 'ocupado_tm', ancho: 15, formato: FORMATO.decimal },
      { titulo: 'Disponible (TM)', clave: 'disponible_tm', ancho: 15, formato: FORMATO.decimal },
      { titulo: 'Comprometido (TM)', clave: 'comprometido_tm', ancho: 17, formato: FORMATO.decimal },
      { titulo: 'Ocupabilidad %', clave: 'ocupabilidad_pct', ancho: 15, formato: FORMATO.porcentaje },
      { titulo: 'Lotes', clave: 'lotes', ancho: 10, formato: FORMATO.entero },
    ],
    totalizar: ['capacidad_tm', 'ocupado_tm', 'disponible_tm'],
  },

  /* ─────────────── COMERCIAL ─────────────── */
  disponibilidad: {
    titulo: 'Disponibilidad por producto',
    subtitulo: 'Físico, bloqueado, reservado y disponible por SKU y bodega',
    vista: 'v_disponibilidad',
    orden: 'disponible_kg',
    columnas: [
      { titulo: 'SKU', clave: 'sku_codigo', ancho: 8 },
      { titulo: 'Especie', clave: 'especie', ancho: 12 },
      { titulo: 'Formato', clave: 'formato', ancho: 14 },
      { titulo: 'Corte', clave: 'corte', ancho: 24 },
      { titulo: 'Presentación', clave: 'presentacion', ancho: 14 },
      { titulo: 'Almacén', clave: 'almacen', ancho: 20 },
      { titulo: 'Físico (kg)', clave: 'fisico_kg', ancho: 14, formato: FORMATO.kilos },
      { titulo: 'Bloqueado (kg)', clave: 'bloqueado_kg', ancho: 14, formato: FORMATO.kilos },
      { titulo: 'Reservado (kg)', clave: 'reservado_kg', ancho: 14, formato: FORMATO.kilos },
      { titulo: 'Disponible (kg)', clave: 'disponible_kg', ancho: 15, formato: FORMATO.kilos },
    ],
    totalizar: ['fisico_kg', 'bloqueado_kg', 'reservado_kg', 'disponible_kg'],
  },

  pedidos: {
    titulo: 'Pedidos y su avance',
    subtitulo: 'Estado de cumplimiento de cada proforma',
    vista: 'v_pedidos_tablero',
    orden: 'fecha_solicitada',
    columnas: [
      { titulo: 'Proforma', clave: 'numero_proforma', ancho: 16 },
      { titulo: 'Cliente', clave: 'cliente', ancho: 34 },
      { titulo: 'País', clave: 'pais', ancho: 14 },
      { titulo: 'Destino', clave: 'destino', ancho: 16 },
      { titulo: 'Solicitado', clave: 'fecha_solicitada', ancho: 13, formato: FORMATO.fecha },
      { titulo: 'Comprometido', clave: 'fecha_comprometida', ancho: 14, formato: FORMATO.fecha },
      { titulo: 'TM pedidas', clave: 'tm_pedidas', ancho: 13, formato: FORMATO.toneladas },
      { titulo: 'TM reservadas', clave: 'tm_reservadas', ancho: 14, formato: FORMATO.toneladas },
      { titulo: 'TM faltantes', clave: 'tm_faltantes', ancho: 13, formato: FORMATO.toneladas },
      { titulo: 'Avance %', clave: 'avance_pct', ancho: 11, formato: FORMATO.porcentaje },
      { titulo: 'Estado', clave: 'semaforo', ancho: 13, alineacion: 'center' },
      { titulo: 'Ciclo', clave: 'ciclo', ancho: 16 },
    ],
    totalizar: ['tm_pedidas', 'tm_reservadas', 'tm_faltantes'],
  },

  cuentas_cobrar: {
    titulo: 'Cuentas por cobrar',
    subtitulo: 'Saldos pendientes con su antigüedad',
    vista: 'v_cuentas_cobrar',
    orden: 'dias_vencida',
    requiereCostos: true,
    columnas: [
      { titulo: 'Documento', clave: 'numero', ancho: 16 },
      { titulo: 'Cliente', clave: 'cliente', ancho: 34 },
      { titulo: 'País', clave: 'pais', ancho: 14 },
      { titulo: 'Emisión', clave: 'fecha_emision', ancho: 13, formato: FORMATO.fecha },
      { titulo: 'Vencimiento', clave: 'fecha_vencimiento', ancho: 13, formato: FORMATO.fecha },
      { titulo: 'Días vencida', clave: 'dias_vencida', ancho: 12, formato: FORMATO.entero },
      { titulo: 'Total', clave: 'total', ancho: 15, formato: FORMATO.dolares },
      { titulo: 'Cobrado', clave: 'cobrado', ancho: 15, formato: FORMATO.dolares },
      { titulo: 'Saldo', clave: 'saldo', ancho: 15, formato: FORMATO.dolares },
      { titulo: 'Antigüedad', clave: 'tramo_antiguedad', ancho: 16 },
    ],
    totalizar: ['total', 'cobrado', 'saldo'],
  },

  rentabilidad: {
    titulo: 'Rentabilidad por pedido',
    subtitulo: 'Venta, costo y margen de los pedidos despachados',
    vista: 'v_rentabilidad_pedido',
    orden: 'venta',
    requiereCostos: true,
    columnas: [
      { titulo: 'Proforma', clave: 'numero_proforma', ancho: 16 },
      { titulo: 'Cliente', clave: 'cliente', ancho: 34 },
      { titulo: 'Vendedor', clave: 'vendedor', ancho: 24 },
      { titulo: 'Fecha', clave: 'fecha_solicitada', ancho: 13, formato: FORMATO.fecha },
      { titulo: 'TM', clave: 'tm', ancho: 12, formato: FORMATO.toneladas },
      { titulo: 'Venta', clave: 'venta', ancho: 16, formato: FORMATO.dolares },
      { titulo: 'Costo estimado', clave: 'costo_estimado', ancho: 16, formato: FORMATO.dolares },
      { titulo: 'Margen', clave: 'margen', ancho: 16, formato: FORMATO.dolares },
      { titulo: 'Margen %', clave: 'margen_pct', ancho: 12, formato: FORMATO.porcentaje },
    ],
    totalizar: ['tm', 'venta', 'costo_estimado', 'margen'],
  },

  necesidades: {
    titulo: 'Necesidades de producción',
    subtitulo: 'Lo comprometido a clientes que no está cubierto con stock',
    vista: 'v_necesidades',
    orden: 'tm_faltantes',
    columnas: [
      { titulo: 'SKU', clave: 'sku_codigo', ancho: 8 },
      { titulo: 'Especie', clave: 'especie', ancho: 12 },
      { titulo: 'Formato', clave: 'formato', ancho: 14 },
      { titulo: 'Corte', clave: 'corte', ancho: 24 },
      { titulo: 'Presentación', clave: 'presentacion', ancho: 14 },
      { titulo: 'TM pedidas', clave: 'tm_pedidas', ancho: 13, formato: FORMATO.toneladas },
      { titulo: 'TM disponibles', clave: 'tm_disponibles', ancho: 14, formato: FORMATO.toneladas },
      { titulo: 'TM faltantes', clave: 'tm_faltantes', ancho: 13, formato: FORMATO.toneladas },
      { titulo: 'Pedidos', clave: 'pedidos', ancho: 10, formato: FORMATO.entero },
      { titulo: 'Fecha más próxima', clave: 'fecha_mas_proxima', ancho: 16, formato: FORMATO.fecha },
    ],
    totalizar: ['tm_pedidas', 'tm_disponibles', 'tm_faltantes'],
  },

  despachos: {
    titulo: 'Productividad de despacho',
    subtitulo: 'Tiempos reales de carga por contenedor',
    vista: 'v_productividad_despacho',
    orden: 'fecha_carga',
    columnas: [
      { titulo: 'Packing', clave: 'codigo', ancho: 14 },
      { titulo: 'Contenedor', clave: 'contenedor', ancho: 16 },
      { titulo: 'Almacén', clave: 'almacen', ancho: 22 },
      { titulo: 'Supervisor', clave: 'supervisor', ancho: 20 },
      { titulo: 'Fecha', clave: 'fecha_carga', ancho: 13, formato: FORMATO.fecha },
      { titulo: 'Turno', clave: 'turno', ancho: 10 },
      { titulo: 'Horas de carga', clave: 'horas_carga', ancho: 14, formato: FORMATO.decimal },
      { titulo: 'Objetivo (h)', clave: 'horas_objetivo', ancho: 12, formato: FORMATO.decimal },
      { titulo: 'Bultos', clave: 'bultos', ancho: 12, formato: FORMATO.entero },
      { titulo: 'TM', clave: 'tm', ancho: 12, formato: FORMATO.toneladas },
    ],
    totalizar: ['bultos', 'tm'],
  },
};

export async function GET(
  request: NextRequest,
  context: RouteContext<'/api/reportes/[tipo]'>
) {
  const { tipo } = await context.params;
  const def = REPORTES[tipo];

  if (!def) {
    return NextResponse.json(
      { error: `El reporte "${tipo}" no existe. Reportes disponibles: ${Object.keys(REPORTES).join(', ')}` },
      { status: 404 }
    );
  }

  /* ---- Control de acceso ---- */
  const usuario = await obtenerUsuarioActual();
  if (!usuario) {
    return NextResponse.json({ error: 'Debe iniciar sesión para exportar reportes.' }, { status: 401 });
  }
  if (def.requiereCostos && !veCostos(usuario.rol as Rol)) {
    return NextResponse.json(
      { error: 'Su rol no tiene permiso para exportar reportes con información de costos.' },
      { status: 403 }
    );
  }

  /* ---- Consulta con la sesión del usuario: las políticas RLS también aplican ---- */
  const supabase = await crearClienteServidor();
  let consulta = supabase.from(def.vista).select('*');
  if (def.fijo) consulta = consulta.eq(def.fijo.columna, def.fijo.valor);

  // Filtros opcionales que vienen en la dirección
  const almacen = request.nextUrl.searchParams.get('almacen');
  const desde = request.nextUrl.searchParams.get('desde');
  const filtrosUsados: Record<string, string> = {};

  if (almacen) {
    consulta = consulta.eq('almacen_id', Number(almacen));
    filtrosUsados['Almacén'] = almacen;
  }
  if (desde) {
    consulta = consulta.gte('fecha', desde);
    filtrosUsados['Desde'] = desde;
  }

  // Tope de seguridad: un Excel de más de 50.000 filas no lo abre nadie
  const { data, error } = await consulta
    .order(def.orden, { ascending: def.ascendente ?? false })
    .limit(50000);

  if (error) {
    return NextResponse.json(
      { error: `No se pudieron obtener los datos: ${error.message}` },
      { status: 500 }
    );
  }

  /* ---- Generación del archivo ---- */
  const buffer = await generarReporte({
    titulo: def.titulo,
    subtitulo: def.subtitulo,
    hoja: def.titulo.slice(0, 30),
    columnas: def.columnas,
    filas: (data ?? []) as Record<string, unknown>[],
    filtros: filtrosUsados,
    usuario: usuario.nombre,
    totalizar: def.totalizar,
  });

  const marcaTiempo = new Date().toISOString().slice(0, 10);
  const nombre = `SantaMonica_${tipo}_${marcaTiempo}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${nombre}"`,
      'Cache-Control': 'no-store',
    },
  });
}
