/**
 * ============================================================================
 *  LAS COLUMNAS DE LA PLANTILLA DE INGRESOS
 * ============================================================================
 *  Son los mismos campos que pide el formulario «Registrar ingreso», en el
 *  mismo orden en que se leen, más uno: «Llega el», para los ingresos
 *  programados. Se declaran una vez y las usan la plantilla, la lectura del
 *  archivo y la pantalla de revisión (para nombrar la columna de cada error).
 *
 *  Archivo sin código de servidor: lo importa también la pantalla.
 * ============================================================================
 */
import type { ColumnaPlantilla } from '@/lib/importacionExcel';

export const HOJA_INGRESOS = 'Ingresos';

export const COLUMNAS_INGRESO: ColumnaPlantilla[] = [
  { clave: 'codigo_pallet', titulo: 'Código de pallet', obligatoria: true, ancho: 17, tipo: 'texto',
    alias: ['Pallet', 'Código', 'Codigo pallet'],
    ayuda: 'La matrícula del pallet, p. ej. «SM 26 10 0168». No se puede repetir: ni en el archivo ni con un pallet que ya exista.' },
  { clave: 'producto', titulo: 'Producto', obligatoria: true, ancho: 44, tipo: 'texto',
    ayuda: 'Elíjalo de la lista o copie el texto de la hoja «Listas» (columna Producto). También vale «código SKU · presentación», p. ej. «01 · 4 X 7 KG».' },
  { clave: 'origen', titulo: 'Origen', obligatoria: true, ancho: 12, tipo: 'texto',
    ayuda: 'Producción (lo procesó la planta, propia o maquila) o Compras (producto terminado comprado a un tercero).' },
  { clave: 'proveedor', titulo: 'Proveedor (si es compra)', ancho: 24, tipo: 'texto',
    ayuda: 'Obligatorio si el origen es Compras: razón social de a quién se compró.' },
  { clave: 'bodega', titulo: 'Bodega', obligatoria: true, ancho: 24, tipo: 'texto',
    ayuda: 'A qué bodega entra. La producción solo entra por las bodegas que reciben producción y las compras por las que reciben compras (hoja «Listas»).' },
  { clave: 'camara', titulo: 'Cámara', ancho: 14, tipo: 'texto',
    ayuda: 'Opcional. Tiene que ser una cámara de esa bodega.' },
  { clave: 'bultos', titulo: 'Bultos', obligatoria: true, ancho: 9, tipo: 'numero',
    ayuda: 'Número entero mayor que cero.' },
  { clave: 'peso_kg', titulo: 'Peso neto total (kg)', obligatoria: true, ancho: 13, tipo: 'numero',
    alias: ['Peso neto (kg)', 'Kilos', 'Peso (kg)'],
    ayuda: 'El peso neto de todo el pallet, en kilos. Si lo deja vacío y pone «Kg por bulto», se multiplica.' },
  { clave: 'kg_bulto', titulo: 'Kg por bulto', ancho: 10, tipo: 'numero',
    ayuda: 'Opcional: solo si no escribe el peso total. Se multiplica por los bultos.' },
  { clave: 'fecha_produccion', titulo: 'Fecha de producción', obligatoria: true, ancho: 13, tipo: 'fecha',
    ayuda: 'DD/MM/AAAA. No puede ser futura: con ella se calcula la antigüedad y la vida útil.' },
  { clave: 'turno', titulo: 'Turno', ancho: 8, tipo: 'texto',
    ayuda: 'Día o Noche. Vacío: Día.' },
  { clave: 'proceso', titulo: 'Proceso', ancho: 16, tipo: 'texto',
    ayuda: 'Producción propia o Maquila. Vacío: Producción propia.' },
  { clave: 'planta', titulo: 'Planta', ancho: 16, tipo: 'texto',
    ayuda: 'Opcional. De la lista.' },
  { clave: 'linea', titulo: 'Línea procesadora', ancho: 16, tipo: 'texto',
    ayuda: 'Opcional. De la lista. Sirve para rastrear un problema hasta la línea que lo produjo.' },
  { clave: 'costo', titulo: 'Costo por kg (US$)', ancho: 11, tipo: 'numero',
    ayuda: 'Opcional. Solo cuenta si el producto no tiene costo cargado en Costos de producción: si lo tiene, el pallet toma el que rige hoy.' },
  { clave: 'llega_el', titulo: 'Llega el (si es programado)', ancho: 14, tipo: 'fecha',
    alias: ['Llega el', 'Fecha de llegada'],
    ayuda: 'Solo si el pallet TODAVÍA NO LLEGA: la fecha en que se espera. Queda como ingreso programado y no mueve stock hasta que se confirme su llegada. Vacío o una fecha de hoy o anterior: entra al stock al registrar.' },
  { clave: 'observaciones', titulo: 'Observaciones', ancho: 30, tipo: 'texto',
    ayuda: 'Opcional. Algo fuera de lo normal en este pallet (máximo 200 caracteres).' },
];

export const TITULO_COLUMNA: Record<string, string> = Object.fromEntries(
  COLUMNAS_INGRESO.map((c) => [c.clave, c.titulo])
);

/** De qué campo del ingreso a qué columna del Excel: para poner cada error en su columna. */
export const COLUMNA_DE_CAMPO: Record<string, string> = {
  codigo_pallet: 'codigo_pallet',
  sku_presentacion_id: 'producto',
  origen_ingreso: 'origen',
  proveedor: 'proveedor',
  almacen_id: 'bodega',
  camara_id: 'camara',
  bultos: 'bultos',
  peso_neto_kg: 'peso_kg',
  fecha_produccion: 'fecha_produccion',
  fecha_llegada: 'llega_el',
  costo_unitario: 'costo',
  turno: 'turno',
  proceso: 'proceso',
  planta_id: 'planta',
  linea_procesadora_id: 'linea',
  observaciones: 'observaciones',
};

export type ErrorColumna = { columna: string; mensaje: string };

export type EstadoFila = 'valida' | 'con_error' | 'descartada' | 'procesando' | 'registrada' | 'programada' | 'fallida';

export const TEXTO_ESTADO_FILA: Record<EstadoFila, string> = {
  valida: 'Lista',
  con_error: 'Con error',
  descartada: 'Descartada',
  procesando: 'Registrando…',
  registrada: 'Registrada',
  programada: 'Programada',
  fallida: 'No se registró',
};

export const TEXTO_ESTADO_IMPORTACION: Record<string, string> = {
  revision: 'En revisión',
  lista: 'Lista para validar',
  validada: 'Validada',
};
