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
import { generarPdfReporte, type ColumnaPdf } from '@/lib/pdfReporte';
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
  /**
   * Condición fija de «mayor que». Se usa para excluir las posiciones a cero
   * del inventario: la vista las conserva porque son historia, pero un
   * reporte de existencias con mil filas a cero kilos no lo lee nadie, y
   * además no coincidiría con lo que enseña la pantalla.
   */
  mayorQue?: { columna: string; valor: number };
  /**
   * Qué se puede filtrar desde la dirección web.
   *
   * Se declara por reporte y no de forma genérica a propósito: cada vista
   * tiene sus propias columnas, y aceptar «filtra por lo que quieras» sería
   * dejar que cualquiera consulte columnas que ni siquiera existen, con el
   * error de base de datos saliendo a la cara del usuario.
   */
  filtrable?: {
    /** Columna de fecha sobre la que operan «desde» y «hasta». */
    fecha?: string;
    /** Columnas de texto donde busca el parámetro «buscar». */
    texto?: string[];
    /** Filtros de igualdad: nombre del parámetro → columna de la vista. */
    exactos?: Record<string, {
      columna: string;
      etiqueta: string;
      numerico?: boolean;
      /**
       * De dónde sacar el nombre legible del valor.
       *
       * Sin esto, la cabecera del reporte imprime «Almacén: 2», que es el
       * identificador interno y no le dice nada a quien recibe la impresión.
       * Con esto imprime «Almacén: Santa Mónica · Cámara 02».
       */
      catalogo?: { tabla: string; columna: string };
    }>;
  };
};

/* --------------------------------------------------------------------------
   Del Excel al PDF sin duplicar la definición.

   Las columnas se declaran UNA vez, en formato Excel. El PDF las deriva: el
   ancho de Excel se convierte en peso relativo y el formato numérico dice de
   qué tipo es el dato. Así no puede ocurrir que alguien añada una columna al
   Excel y el PDF salga sin ella.
   -------------------------------------------------------------------------- */
function tipoPdf(formato?: string): ColumnaPdf['tipo'] {
  if (!formato) return 'texto';
  if (formato === FORMATO.fecha) return 'fecha';
  if (formato.includes('US$') || formato.includes('S/')) return 'dinero';
  if (formato === FORMATO.entero || formato === FORMATO.kilos) return 'entero';
  return 'numero';
}

function aColumnasPdf(columnas: ColumnaExcel[]): ColumnaPdf[] {
  return columnas.map((c) => ({
    titulo: c.tituloPdf ?? c.titulo,
    clave: c.clave,
    peso: c.ancho ?? 14,
    alineado: c.alineacion,
    tipo: c.tipoPdf ?? tipoPdf(c.formato),
    mapa: c.mapa,
  }));
}

/**
 * Los tipos de movimiento en cristiano.
 *
 * Es la misma tabla que usa la pantalla de Movimientos. Se repite aquí porque
 * los reportes son un módulo aparte que no debe depender de una pantalla,
 * pero si un día se añade un tipo hay que tocarla en los dos sitios; por eso
 * el mapa cae de vuelta al valor original cuando no reconoce la clave, y un
 * tipo nuevo sale feo pero sale, nunca vacío.
 */
const NOMBRE_MOVIMIENTO: Record<string, string> = {
  ingreso: 'Ingreso de producción',
  traslado_ingreso: 'Entrada por traslado',
  ingreso_reproceso: 'Vuelta de reproceso',
  ajuste_positivo: 'Ajuste que suma',
  salida_despacho: 'Salida por despacho',
  traslado_salida: 'Salida por traslado',
  salida_reproceso: 'Salida a reproceso',
  salida_muestra: 'Muestra de calidad',
  ajuste_negativo: 'Ajuste que resta',
  salida_merma: 'Merma',
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
    mayorQue: { columna: 'fisico_kg', valor: 0 },
    filtrable: {
      fecha: 'fecha_produccion',
      texto: ['codigo_pallet', 'sku_codigo', 'corte', 'especie'],
      exactos: {
        almacen: {
          columna: 'almacen_id', etiqueta: 'Almacén', numerico: true,
          catalogo: { tabla: 'almacenes', columna: 'nombre' },
        },
        rango: { columna: 'rango', etiqueta: 'Antigüedad' },
      },
    },
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
    mayorQue: { columna: 'fisico_kg', valor: 0 },
    filtrable: {
      // Sobre el inventario, «desde/hasta» acota la FECHA DE PRODUCCIÓN: es la
      // pregunta real de almacén («cuánto vale lo producido en marzo»), no la
      // fecha de hoy, que para una foto de stock no significaría nada.
      fecha: 'fecha_produccion',
      texto: ['codigo_pallet', 'sku_codigo', 'corte', 'especie'],
      exactos: {
        almacen: {
          columna: 'almacen_id', etiqueta: 'Almacén', numerico: true,
          catalogo: { tabla: 'almacenes', columna: 'nombre' },
        },
        rango: { columna: 'rango', etiqueta: 'Antigüedad' },
        especie: { columna: 'especie', etiqueta: 'Especie' },
      },
    },
  },

  /**
   * MOVIMIENTOS · el detalle fino de qué entró y qué salió.
   *
   * Es el reporte que pide almacén cuando algo no cuadra: cada movimiento con
   * su hora, su lote, su documento de respaldo, su motivo y quién lo registró.
   * Se filtra por rango de fechas y por tipo.
   */
  movimientos: {
    titulo: 'Movimientos de almacén',
    subtitulo: 'Cada entrada y cada salida, con su documento de respaldo y quién la registró',
    vista: 'v_kardex',
    orden: 'fecha',
    columnas: [
      { titulo: 'Fecha y hora', clave: 'fecha', ancho: 16, tipoPdf: 'fechaHora' },
      { titulo: 'Movimiento', clave: 'tipo', ancho: 21, mapa: NOMBRE_MOVIMIENTO },
      { titulo: 'Pallet', clave: 'codigo_pallet', ancho: 16 },
      { titulo: 'SKU', clave: 'sku_codigo', ancho: 8 },
      { titulo: 'Especie', clave: 'especie', ancho: 12 },
      { titulo: 'Corte', clave: 'corte', ancho: 20 },
      { titulo: 'Presentación', clave: 'presentacion', ancho: 12, tituloPdf: 'Present.' },
      // El nombre completo de una bodega es «Santa Mónica · Cámara 03»: si no
      // se le da ancho, la columna solo enseña la parte que comparten todas.
      { titulo: 'Almacén', clave: 'almacen', ancho: 26 },
      { titulo: 'Entrada (bultos)', clave: 'entrada_bultos', ancho: 11, formato: FORMATO.entero, tituloPdf: 'Ent. bult.' },
      { titulo: 'Entrada (kg)', clave: 'entrada_kg', ancho: 12, formato: FORMATO.kilos, tituloPdf: 'Ent. kg' },
      { titulo: 'Salida (bultos)', clave: 'salida_bultos', ancho: 11, formato: FORMATO.entero, tituloPdf: 'Sal. bult.' },
      { titulo: 'Salida (kg)', clave: 'salida_kg', ancho: 12, formato: FORMATO.kilos, tituloPdf: 'Sal. kg' },
      { titulo: 'Documento', clave: 'documento_ref', ancho: 16 },
      { titulo: 'Motivo', clave: 'motivo', ancho: 15 },
      { titulo: 'Registró', clave: 'usuario', ancho: 15 },
      { titulo: 'Autorizó', clave: 'autorizado_por', ancho: 13 },
    ],
    totalizar: ['entrada_bultos', 'entrada_kg', 'salida_bultos', 'salida_kg'],
    ascendente: false,
    filtrable: {
      fecha: 'fecha',
      texto: ['codigo_pallet', 'sku_codigo', 'documento_ref', 'corte'],
      exactos: {
        tipo: { columna: 'tipo', etiqueta: 'Tipo de movimiento' },
        almacen: {
          columna: 'almacen_id', etiqueta: 'Almacén', numerico: true,
          catalogo: { tabla: 'almacenes', columna: 'nombre' },
        },
      },
    },
  },

  kardex: {
    titulo: 'Kardex valorizado',
    subtitulo: 'Todas las entradas y salidas del almacén, en orden cronológico',
    vista: 'v_kardex',
    orden: 'fecha',
    columnas: [
      { titulo: 'Fecha', clave: 'fecha', ancho: 16, tipoPdf: 'fechaHora' },
      { titulo: 'Movimiento', clave: 'tipo', ancho: 21, mapa: NOMBRE_MOVIMIENTO },
      { titulo: 'Pallet', clave: 'codigo_pallet', ancho: 18 },
      { titulo: 'SKU', clave: 'sku_codigo', ancho: 8 },
      { titulo: 'Producto', clave: 'formato', ancho: 16 },
      { titulo: 'Corte', clave: 'corte', ancho: 22 },
      { titulo: 'Almacén', clave: 'almacen', ancho: 26 },
      { titulo: 'Entrada (kg)', clave: 'entrada_kg', ancho: 14, formato: FORMATO.kilos, tituloPdf: 'Ent. kg' },
      { titulo: 'Salida (kg)', clave: 'salida_kg', ancho: 14, formato: FORMATO.kilos, tituloPdf: 'Sal. kg' },
      { titulo: 'Documento', clave: 'documento_ref', ancho: 18 },
      { titulo: 'Registró', clave: 'usuario', ancho: 18 },
    ],
    totalizar: ['entrada_kg', 'salida_kg'],
    filtrable: {
      fecha: 'fecha',
      texto: ['codigo_pallet', 'sku_codigo', 'documento_ref'],
      exactos: {
        tipo: { columna: 'tipo', etiqueta: 'Tipo de movimiento' },
        almacen: {
          columna: 'almacen_id', etiqueta: 'Almacén', numerico: true,
          catalogo: { tabla: 'almacenes', columna: 'nombre' },
        },
      },
    },
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
    mayorQue: { columna: 'fisico_kg', valor: 0 },
    filtrable: {
      fecha: 'fecha_produccion',
      texto: ['codigo_pallet', 'sku_codigo', 'corte', 'especie'],
      exactos: {
        almacen: {
          columna: 'almacen_id', etiqueta: 'Almacén', numerico: true,
          catalogo: { tabla: 'almacenes', columna: 'nombre' },
        },
        rango: { columna: 'rango', etiqueta: 'Antigüedad' },
      },
    },
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
  if (def.mayorQue) consulta = consulta.gt(def.mayorQue.columna, def.mayorQue.valor);

  /* ------------------------------------------------------------------------
     Filtros.

     Se dejan anotados en `filtrosUsados` porque acaban IMPRESOS en el archivo.
     Un Excel de existencias filtrado por una bodega y otro sin filtrar son dos
     archivos con el mismo nombre y cifras distintas; si el papel no dice qué
     filtro llevaba, la discusión no la gana nadie.
     ------------------------------------------------------------------------ */
  const p = request.nextUrl.searchParams;
  const filtrosUsados: Record<string, string> = {};
  const f = def.filtrable;

  if (f?.fecha) {
    const desde = p.get('desde');
    const hasta = p.get('hasta');
    if (desde) {
      consulta = consulta.gte(f.fecha, desde);
      filtrosUsados['Desde'] = desde;
    }
    if (hasta) {
      /*
       * En una columna con hora, `lte('2026-08-27')` compara contra la
       * medianoche y deja fuera todo lo del propio día. Se empuja al final
       * del día para que «hasta el 27» incluya el 27 entero, que es lo que
       * cualquiera espera al escribirlo.
       */
      consulta = consulta.lte(f.fecha, hasta.length === 10 ? `${hasta}T23:59:59.999` : hasta);
      filtrosUsados['Hasta'] = hasta;
    }
  }

  for (const [param, def2] of Object.entries(f?.exactos ?? {})) {
    const valor = p.get(param);
    if (!valor) continue;
    consulta = consulta.eq(def2.columna, def2.numerico ? Number(valor) : valor);

    // El filtro se aplica con el identificador, pero se ANOTA con el nombre:
    // el archivo lo va a leer una persona, no la base de datos.
    let etiqueta = valor;
    if (def2.catalogo) {
      const { data: fila } = await supabase
        .from(def2.catalogo.tabla)
        .select(def2.catalogo.columna)
        .eq('id', def2.numerico ? Number(valor) : valor)
        .maybeSingle();
      const nombre = (fila as Record<string, unknown> | null)?.[def2.catalogo.columna];
      if (typeof nombre === 'string') etiqueta = nombre;
    }
    filtrosUsados[def2.etiqueta] = etiqueta;
  }

  const buscar = p.get('buscar')?.trim();
  if (buscar && f?.texto?.length) {
    // `or` con varias columnas: es el equivalente a la caja de búsqueda de la
    // pantalla, para que el archivo salga con lo mismo que el usuario ve.
    const limpio = buscar.replace(/[%,()]/g, ' ');
    consulta = consulta.or(f.texto.map((c) => `${c}.ilike.%${limpio}%`).join(','));
    filtrosUsados['Búsqueda'] = buscar;
  }

  // Tope de seguridad: un archivo de más de 50.000 filas no lo abre nadie
  const TOPE = 50000;
  const { data, error } = await consulta
    .order(def.orden, { ascending: def.ascendente ?? false })
    .limit(TOPE);

  if (error) {
    return NextResponse.json(
      { error: `No se pudieron obtener los datos: ${error.message}` },
      { status: 500 }
    );
  }

  const filas = (data ?? []) as Record<string, unknown>[];
  const formato = p.get('formato') === 'pdf' ? 'pdf' : 'excel';
  const marcaTiempo = new Date().toISOString().slice(0, 10);

  /* ---- Se deja constancia de la descarga en la bitácora ----
     Una exportación saca datos de la empresa fuera del sistema. Quién sacó
     qué, y cuándo, tiene que poder consultarse después. */
  try {
    await supabase.rpc('registrar_evento', {
      p_entidad: 'reportes',
      p_entidad_id: null,
      p_tipo: 'reporte_exportado',
      p_descripcion:
        `${def.titulo} exportado en ${formato.toUpperCase()} por ${usuario.nombre}` +
        ` (${filas.length} filas)`,
      p_severidad: 'info',
      p_metadatos: { reporte: tipo, formato, filas: filas.length, filtros: filtrosUsados },
    });
  } catch {
    // Que la bitácora falle no puede impedir que el usuario baje su reporte.
  }

  /* ---- Generación del archivo ---- */
  if (formato === 'pdf') {
    const pdf = await generarPdfReporte({
      titulo: def.titulo,
      subtitulo: def.subtitulo,
      columnas: aColumnasPdf(def.columnas),
      filas,
      totalizar: def.totalizar,
      filtros: filtrosUsados,
      usuario: usuario.nombre,
      generadoEn: new Date(),
      truncadoEn: TOPE,
    });

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="SantaMonica_${tipo}_${marcaTiempo}.pdf"`,
        'Cache-Control': 'no-store',
        'X-Filas': String(filas.length),
      },
    });
  }

  const buffer = await generarReporte({
    titulo: def.titulo,
    subtitulo: def.subtitulo,
    hoja: def.titulo.slice(0, 30),
    columnas: def.columnas,
    filas,
    filtros: filtrosUsados,
    usuario: usuario.nombre,
    totalizar: def.totalizar,
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="SantaMonica_${tipo}_${marcaTiempo}.xlsx"`,
      'Cache-Control': 'no-store',
      'X-Filas': String(filas.length),
    },
  });
}
