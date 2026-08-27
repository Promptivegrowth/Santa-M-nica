/**
 * ============================================================================
 *  EL CONTACTO DE UN DOCUMENTO
 * ============================================================================
 *  Vive en su propio archivo y no junto a las acciones de la cotización por
 *  una razón técnica concreta: un módulo marcado con 'use server' solo puede
 *  exportar funciones asíncronas. Un tipo y un ayudante síncrono no caben ahí,
 *  y el compilador lo rechaza.
 *
 *  Además lo usan tres sitios —la cotización, el pedido y el generador de
 *  documentos—, así que tenerlo aparte evita que uno importe del otro solo
 *  para tomar prestada una conversión de cuatro líneas.
 * ============================================================================
 */

/**
 * El contacto al que va dirigido el documento.
 *
 * Se guarda por partida doble —la referencia al maestro y una copia de sus
 * datos— para que el documento no cambie si esa persona deja la empresa, y
 * para poder escribir un contacto suelto sin darlo de alta en ninguna parte.
 *
 * TODO es opcional: se pidió expresamente que esta sección no bloquee nada.
 */
export type ContactoDocumento = {
  /** Apunta al maestro cuando se eligió de la lista; null si se escribió. */
  id: number | null;
  nombre: string;
  cargo: string;
  telefono: string;
  email: string;
};

/**
 * Convierte lo que llega del formulario en las columnas de la tabla.
 *
 * Los campos vacíos se guardan como NULL y no como cadena vacía: en la base de
 * datos «no hay teléfono» y «el teléfono es una cadena de cero caracteres» son
 * cosas distintas, y solo la primera es verdad.
 */
export function columnasContacto(c?: ContactoDocumento) {
  const limpio = (v?: string) => v?.trim() || null;
  return {
    contacto_id: c?.id ?? null,
    contacto_nombre: limpio(c?.nombre),
    contacto_cargo: limpio(c?.cargo),
    contacto_telefono: limpio(c?.telefono),
    contacto_email: limpio(c?.email),
  };
}
