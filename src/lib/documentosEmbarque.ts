/**
 * ============================================================================
 *  DOCUMENTOS DEL EMBARQUE · qué clases hay, qué formato y quién (084)
 * ============================================================================
 *  Lo comparten la pantalla (botones, aviso al elegir el archivo) y el
 *  servidor (documentos.ts), para que digan lo mismo. La última palabra es
 *  de la base: políticas de embarque_archivos y del repositorio «despachos».
 * ============================================================================
 */
import type { Rol } from './navegacion';

export type TipoDocumentoEmbarque = 'etiqueta' | 'packing_declarado' | 'packing_real' | 'otro';

/** Suben documentos y comentan: la etiqueta es de Comercial, el packing de Comex/Almacén. */
export const PUEDEN_DOCUMENTOS_EMBARQUE: Rol[] = ['gerencia', 'operaciones', 'comercial', 'comex', 'almacen'];
/** Quitan el documento de otra persona (cada uno puede quitar los suyos). */
export const PUEDEN_QUITAR_CUALQUIERA: Rol[] = ['gerencia', 'operaciones'];

export const MAXIMO_DOCUMENTO = 15 * 1024 * 1024;

const PDF = 'application/pdf';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLS = 'application/vnd.ms-excel';
const IMAGENES = ['image/jpeg', 'image/png'];

export const FORMATOS_DOCUMENTO: Record<TipoDocumentoEmbarque, { mimes: string[]; accept: string; texto: string }> = {
  etiqueta:          { mimes: [PDF, ...IMAGENES],     accept: '.pdf,.jpg,.jpeg,.png',  texto: 'tiene que ser PDF, JPG o PNG' },
  packing_declarado: { mimes: [PDF, XLSX, XLS],       accept: '.pdf,.xlsx,.xls',       texto: 'tiene que ser PDF o Excel' },
  packing_real:      { mimes: [PDF, XLSX, XLS],       accept: '.pdf,.xlsx,.xls',       texto: 'tiene que ser PDF o Excel' },
  otro:              { mimes: [PDF, XLSX, XLS, ...IMAGENES], accept: '.pdf,.xlsx,.xls,.jpg,.jpeg,.png', texto: 'tiene que ser PDF, Excel, JPG o PNG' },
};

export const NOMBRE_DOCUMENTO: Record<TipoDocumentoEmbarque, string> = {
  etiqueta: 'Modelo de etiqueta',
  packing_declarado: 'Packing declarado (cliente / SANIPES)',
  packing_real: 'Packing real (interno)',
  otro: 'Otro documento',
};

/** Cómo se nombra dentro de una frase («subió el modelo de etiqueta …»). */
export const EN_FRASE_DOCUMENTO: Record<TipoDocumentoEmbarque, string> = {
  etiqueta: 'el modelo de etiqueta',
  packing_declarado: 'el packing declarado (cliente / SANIPES)',
  packing_real: 'el packing real (interno)',
  otro: 'un documento',
};

/** Lo que explica cada clase, debajo de su título. */
export const AYUDA_DOCUMENTO: Record<TipoDocumentoEmbarque, string> = {
  etiqueta: 'El modelo que aprueba el cliente. Lo sube Comercial.',
  packing_declarado: 'El que se envía al cliente y a SANIPES antes del despacho.',
  packing_real: 'El interno, con lo que de verdad sube (incluida la sobreproducción).',
  otro: 'Instrucciones, correos, lo que convenga tener a mano.',
};

export const ORDEN_DOCUMENTOS: TipoDocumentoEmbarque[] = ['etiqueta', 'packing_declarado', 'packing_real', 'otro'];

/**
 * El tipo de un archivo. Algunos Windows no informan el tipo de un Excel
 * (llega vacío): se deduce de la extensión, que es lo que ve el usuario.
 */
export function tipoMimeDe(nombre: string, tipo: string): string {
  if (tipo) return tipo;
  const ext = nombre.toLowerCase().split('.').pop() ?? '';
  return ({ pdf: PDF, xlsx: XLSX, xls: XLS, jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' } as Record<string, string>)[ext] ?? '';
}
