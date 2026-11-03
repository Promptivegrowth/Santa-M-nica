/**
 * ============================================================================
 *  LAS COLUMNAS DE LA PLANTILLA DE TRASLADOS
 * ============================================================================
 *  Lo que pide «Nuevo traslado» de cada pallet: cuál, de dónde a dónde, y
 *  cuánto si no va entero. Más la fecha, la guía y las observaciones.
 *
 *  079 · Lo que se importa son traslados YA HECHOS (con su guía y su fecha),
 *  no pedidos de traslado: «Fecha programada» pasó a «Fecha de traslado»
 *  (obligatoria, de hoy hacia atrás) y se agregó «N.º de guía».
 *
 *  Archivo sin código de servidor: lo usa también la pantalla de revisión.
 * ============================================================================
 */
import type { ColumnaPlantilla } from '@/lib/importacionExcel';

export const HOJA_TRASLADOS = 'Traslados';

export const COLUMNAS_TRASLADO: ColumnaPlantilla[] = [
  { clave: 'codigo_pallet', titulo: 'Código de pallet', obligatoria: true, ancho: 18, tipo: 'texto', alias: ['Pallet', 'Código'],
    ayuda: 'El pallet que se traslada. Cópielo de la hoja «Pallets disponibles». Cada pallet va una sola vez.' },
  { clave: 'origen', titulo: 'Bodega de origen', obligatoria: true, ancho: 26, tipo: 'texto', alias: ['Origen'],
    ayuda: 'Dónde está hoy el pallet (de la lista).' },
  { clave: 'destino', titulo: 'Bodega de destino', obligatoria: true, ancho: 26, tipo: 'texto', alias: ['Destino'],
    ayuda: 'A dónde va (de la lista). No puede ser la misma que el origen.' },
  { clave: 'bultos', titulo: 'Bultos (si es parcial)', ancho: 12, tipo: 'numero', alias: ['Bultos'],
    ayuda: 'Vacío: va todo lo disponible del pallet. Si solo va una parte, cuántos bultos.' },
  { clave: 'kilos', titulo: 'Kilos (si es parcial)', ancho: 12, tipo: 'numero', alias: ['Kilos', 'Kg'],
    ayuda: 'Vacío: se calculan con los kilos por bulto reales del pallet. No puede pasar de lo disponible.' },
  { clave: 'fecha', titulo: 'Fecha de traslado', obligatoria: true, ancho: 13, tipo: 'fecha',
    alias: ['Fecha del traslado', 'Fecha'],
    ayuda: 'DD/MM/AAAA: el día en que salió el camión. De hoy hacia atrás (el traslado ya ocurrió), y no antes de la fecha de producción del pallet.' },
  { clave: 'guia', titulo: 'N.º de guía', ancho: 16, tipo: 'texto',
    alias: ['N° de guía', 'Nº de guía', 'No. de guía', 'Nro. de guía', 'Número de guía', 'Guía', 'Guía de remisión'],
    ayuda: 'La guía de remisión con que viajó. Los pallets con el mismo origen, destino, fecha y guía forman un mismo traslado.' },
  { clave: 'observaciones', titulo: 'Observaciones', ancho: 34, tipo: 'texto',
    ayuda: 'Por qué se traslada (liberar espacio, acercarlo a la planta…).' },
];

export const TITULO_COLUMNA_TRASLADO: Record<string, string> = Object.fromEntries(
  COLUMNAS_TRASLADO.map((c) => [c.clave, c.titulo])
);
