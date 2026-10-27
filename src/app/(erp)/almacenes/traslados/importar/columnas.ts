/**
 * ============================================================================
 *  LAS COLUMNAS DE LA PLANTILLA DE TRASLADOS
 * ============================================================================
 *  Lo que pide «Nuevo traslado» de cada pallet: cuál, de dónde a dónde, y
 *  cuánto si no va entero. Más la fecha y las observaciones del traslado.
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
  { clave: 'fecha', titulo: 'Fecha programada', ancho: 13, tipo: 'fecha',
    ayuda: 'Opcional. DD/MM/AAAA, de hoy en adelante. Los pallets con el mismo origen, destino y fecha van en un mismo traslado.' },
  { clave: 'observaciones', titulo: 'Observaciones', ancho: 34, tipo: 'texto',
    ayuda: 'Opcional. Por qué se traslada (liberar espacio, acercarlo a la planta…).' },
];

export const TITULO_COLUMNA_TRASLADO: Record<string, string> = Object.fromEntries(
  COLUMNAS_TRASLADO.map((c) => [c.clave, c.titulo])
);
