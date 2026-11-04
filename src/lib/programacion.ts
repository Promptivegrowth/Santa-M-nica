/**
 * ============================================================================
 *  LA PROGRAMACIÓN DE EMBARQUES · columnas, filtros y orden (084)
 * ============================================================================
 *  «Observaciones ERP 4», puntos 10 y 11: «generar programación en lista
 *  descargable y legible» y «filtros por columna en el Planificador». La
 *  lista es la que Oliver más va a usar —«como su Excel»—, y su pantalla, su
 *  Excel y su PDF tienen que decir EXACTAMENTE lo mismo. Por eso las
 *  columnas, el filtro y el orden se definen UNA vez aquí y los usan las tres
 *  salidas: la tabla en el navegador y la descarga en el servidor.
 *
 *  LOS FILTROS VIVEN EN LA DIRECCIÓN WEB (?f_naviera=COSCO&f_cliente=kul…):
 *  el enlace se puede mandar por correo y abre la misma vista, y el botón de
 *  descarga baja lo que se está viendo, no el universo entero.
 *
 *  Este archivo no toca la base: es puro, para que sirva en los dos lados.
 * ============================================================================
 */

export type FilaProgramacion = {
  id: number;
  /** EMB-2026-0205. */
  numero: string;
  /** Semana de despacho (la escrita o, si no, la de la fecha). */
  semana: number | null;
  /** Fecha de despacho programada (AAAA-MM-DD). */
  fecha_despacho: string;
  fecha_zarpe: string | null;
  /** Cuándo salió de verdad (el primer despacho de sus contenedores). */
  despacho_real: string | null;
  /** N.º de packing: el del embarque y/o los de sus contenedores. */
  pl: string;
  proformas: string;
  clientes: string;
  destino: string;
  productos: string;
  /** TM: lo cargado si hay packing; si no, lo programado. */
  tm: number;
  tm_cargada: boolean;
  contenedores: string;
  booking: string;
  naviera: string;
  operador: string;
  almacen: string;
  tipo: string;
  estado: string;
  /** Situación del packing: «Sin contenedor», «Abierto», «En carga», «Despachado». */
  packing: string;
  /** Cuántas versiones hay de cada documento. */
  docs: { etiqueta: number; declarado: number; real: number; otro: number };
  comentarios: number;
  observaciones: string;
};

export type ColumnaProgramacion = {
  clave: keyof FilaProgramacion | 'documentos';
  titulo: string;
  /** Título corto para el PDF apaisado. */
  corto?: string;
  /** texto: «contiene»; lista: se elige entre los valores que hay; ninguno: sin filtro. */
  filtro: 'texto' | 'lista' | 'ninguno';
  numerica?: boolean;
  /**
   * Peso relativo del ancho en el PDF (0 = no va en el PDF). El PDF lleva 15
   * columnas: con las 20 del Excel, en A4 apaisado las fechas y los números
   * salían cortados («03/11/2…»). Producto, situación del packing, despacho
   * real, documentos y observaciones quedan en el Excel y en la pantalla.
   */
  pesoPdf: number;
  anchoExcel: number;
};

export const ESTADOS_EMBARQUE: Record<string, string> = {
  planificado: 'Planificado', confirmado: 'Confirmado', en_preparacion: 'En preparación',
  despachado: 'Despachado', cancelado: 'Cancelado',
};
export const TIPOS_DESPACHO: Record<string, string> = {
  exportacion: 'Exportación', mercado_nacional: 'Mercado nacional', traslado: 'Traslado',
};

/** El orden de las columnas es el de su Excel: semana, fechas, PL, embarque… */
export const COLUMNAS_PROGRAMACION: ColumnaProgramacion[] = [
  { clave: 'semana',         titulo: 'Semana',              corto: 'Sem.',     filtro: 'lista',   numerica: true, pesoPdf: 3,  anchoExcel: 8 },
  { clave: 'fecha_despacho', titulo: 'Despacho programado', corto: 'Despacho', filtro: 'texto',   pesoPdf: 7,  anchoExcel: 13 },
  { clave: 'fecha_zarpe',    titulo: 'Zarpe',               corto: 'Zarpe',    filtro: 'texto',   pesoPdf: 6,  anchoExcel: 12 },
  { clave: 'pl',             titulo: 'N.º de packing',      corto: 'N.º PL',   filtro: 'texto',   pesoPdf: 9,  anchoExcel: 16 },
  { clave: 'numero',         titulo: 'Embarque',            corto: 'Embarque', filtro: 'texto',   pesoPdf: 10,  anchoExcel: 15 },
  { clave: 'proformas',      titulo: 'Proforma',            corto: 'Proforma', filtro: 'texto',   pesoPdf: 8,  anchoExcel: 14 },
  { clave: 'clientes',       titulo: 'Cliente',             corto: 'Cliente',  filtro: 'texto',   pesoPdf: 14, anchoExcel: 30 },
  { clave: 'destino',        titulo: 'Destino',             corto: 'Destino',  filtro: 'texto',   pesoPdf: 10,  anchoExcel: 20 },
  { clave: 'productos',      titulo: 'Producto',            corto: 'Producto', filtro: 'texto',   pesoPdf: 0,  anchoExcel: 16 },
  { clave: 'tm',             titulo: 'TM',                  corto: 'TM',       filtro: 'ninguno', numerica: true, pesoPdf: 6,  anchoExcel: 9 },
  { clave: 'contenedores',   titulo: 'Contenedor',          corto: 'Contenedor', filtro: 'texto', pesoPdf: 9,  anchoExcel: 15 },
  { clave: 'booking',        titulo: 'Booking',             corto: 'Booking',  filtro: 'texto',   pesoPdf: 8,  anchoExcel: 14 },
  { clave: 'naviera',        titulo: 'Naviera',             corto: 'Naviera',  filtro: 'lista',   pesoPdf: 7,  anchoExcel: 14 },
  { clave: 'operador',       titulo: 'Operador logístico',  corto: 'Operador', filtro: 'lista',   pesoPdf: 9,  anchoExcel: 18 },
  { clave: 'almacen',        titulo: 'Almacén de despacho', corto: 'Almacén',  filtro: 'lista',   pesoPdf: 12,  anchoExcel: 18 },
  { clave: 'estado',         titulo: 'Estado',              corto: 'Estado',   filtro: 'lista',   pesoPdf: 8,  anchoExcel: 14 },
  { clave: 'packing',        titulo: 'Packing',             corto: 'Packing',  filtro: 'lista',   pesoPdf: 0,  anchoExcel: 13 },
  { clave: 'documentos',     titulo: 'Documentos',          filtro: 'lista',   pesoPdf: 0,  anchoExcel: 26 },
  { clave: 'despacho_real',  titulo: 'Despacho real',       corto: 'Salió',    filtro: 'texto',   pesoPdf: 0,  anchoExcel: 16 },
  { clave: 'observaciones',  titulo: 'Observaciones',       filtro: 'texto',   pesoPdf: 0,  anchoExcel: 40 },
];

/** 2026-11-05 → 05/11/2026; un instante → su día en Lima. */
export function fechaTexto(v: string | null | undefined): string {
  if (!v) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** «Etiqueta · Packing declarado (2)». Vacío si no hay ninguno. */
export function textoDocumentos(f: FilaProgramacion): string {
  const partes: string[] = [];
  if (f.docs.etiqueta) partes.push('Etiqueta' + (f.docs.etiqueta > 1 ? ` (${f.docs.etiqueta})` : ''));
  if (f.docs.declarado) partes.push('Packing declarado' + (f.docs.declarado > 1 ? ` (${f.docs.declarado})` : ''));
  if (f.docs.real) partes.push('Packing real' + (f.docs.real > 1 ? ` (${f.docs.real})` : ''));
  if (f.docs.otro) partes.push('Otros' + (f.docs.otro > 1 ? ` (${f.docs.otro})` : ''));
  return partes.join(' · ');
}

/** El valor de una celda como texto: lo que se ve, lo que se filtra y lo que se exporta. */
export function valorTexto(f: FilaProgramacion, clave: ColumnaProgramacion['clave']): string {
  switch (clave) {
    case 'semana': return f.semana == null ? '' : String(f.semana);
    case 'fecha_despacho': case 'fecha_zarpe': case 'despacho_real': return fechaTexto(f[clave]);
    case 'tm': return f.tm.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case 'estado': return ESTADOS_EMBARQUE[f.estado] ?? f.estado;
    case 'documentos': return textoDocumentos(f) || 'Sin documentos';
    case 'docs': return textoDocumentos(f);
    default: return String((f as Record<string, unknown>)[clave] ?? '');
  }
}

/** Sin tildes y en minúsculas, para que «peru» encuentre «PERÚ». */
export function sinTildes(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Los filtros de columna que vienen en la dirección (f_clave=valor). */
export function filtrosDeParametros(p: URLSearchParams | Record<string, string | string[] | undefined>): Record<string, string> {
  const salida: Record<string, string> = {};
  const entradas = p instanceof URLSearchParams ? [...p.entries()] : Object.entries(p);
  for (const [k, v] of entradas) {
    const valor = Array.isArray(v) ? v[0] : v;
    if (!k.startsWith('f_') || typeof valor !== 'string' || !valor.trim()) continue;
    const clave = k.slice(2);
    if (COLUMNAS_PROGRAMACION.some((c) => c.clave === clave && c.filtro !== 'ninguno')) salida[clave] = valor;
  }
  return salida;
}

/** Aplica los filtros de columna. Lista: igual; texto: contiene (sin tildes). */
export function filtrarProgramacion(filas: FilaProgramacion[], filtros: Record<string, string>): FilaProgramacion[] {
  const activos = Object.entries(filtros).filter(([, v]) => v.trim());
  if (!activos.length) return filas;
  return filas.filter((f) => activos.every(([clave, v]) => {
    const col = COLUMNAS_PROGRAMACION.find((c) => c.clave === clave);
    if (!col) return true;
    const celda = valorTexto(f, col.clave);
    if (col.filtro === 'lista') return (celda || '(vacío)') === v;
    return sinTildes(celda).includes(sinTildes(v.trim()));
  }));
}

/** Ordena por una columna. Sin orden: por fecha de despacho y número. */
export function ordenarProgramacion(filas: FilaProgramacion[], clave?: string | null, dir: 'asc' | 'desc' = 'asc'): FilaProgramacion[] {
  const s = dir === 'desc' ? -1 : 1;
  const col = COLUMNAS_PROGRAMACION.find((c) => c.clave === clave);
  const base = (a: FilaProgramacion, b: FilaProgramacion) =>
    a.fecha_despacho.localeCompare(b.fecha_despacho) || a.numero.localeCompare(b.numero);
  if (!col) return [...filas].sort((a, b) => s * base(a, b));
  const valor = (f: FilaProgramacion): string | number => {
    if (col.clave === 'tm') return f.tm;
    if (col.clave === 'semana') return f.semana ?? -1;
    if (col.clave === 'fecha_despacho' || col.clave === 'fecha_zarpe' || col.clave === 'despacho_real') return String(f[col.clave] ?? '');
    return sinTildes(valorTexto(f, col.clave));
  };
  return [...filas].sort((a, b) => {
    const x = valor(a), y = valor(b);
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'es');
    return s * (c || base(a, b));
  });
}

/** Los valores distintos de una columna de lista, para su desplegable. */
export function opcionesDeColumna(filas: FilaProgramacion[], clave: ColumnaProgramacion['clave']): string[] {
  const vistos = new Set(filas.map((f) => valorTexto(f, clave) || '(vacío)'));
  return [...vistos].sort((a, b) => (clave === 'semana' ? Number(a) - Number(b) : a.localeCompare(b, 'es')));
}

/** Lo que dicen los filtros, para imprimirlo en la cabecera del Excel y del PDF. */
export function describirFiltros(filtros: Record<string, string>): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const [clave, v] of Object.entries(filtros)) {
    const col = COLUMNAS_PROGRAMACION.find((c) => c.clave === clave);
    if (col) salida[col.titulo] = col.filtro === 'texto' ? `contiene «${v}»` : v;
  }
  return salida;
}
