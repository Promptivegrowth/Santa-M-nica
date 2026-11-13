/**
 * ============================================================================
 *  POR QUÉ NO SE PUDO CARGAR UN ARCHIVO · los tipos de fallo, en palabras
 * ============================================================================
 *  13/11 · Pedido de Gerencia: en la pantalla de importación, si el proceso se
 *  cargó o si hubo un error, que lo diga amablemente, con el TIPO de error y
 *  lo demás que haga falta para resolverlo sin llamar a nadie.
 *
 *  Antes cada fallo era una frase suelta en rojo, y uno de red no se distinguía
 *  de uno del servidor. Ahora cada fallo dice:
 *     · de qué tipo es (el título),
 *     · qué pasó (el mensaje de siempre, que ya estaba en palabras),
 *     · qué hacer (un paso concreto),
 *     · y los datos del intento: archivo, tamaño, hora, referencia.
 *
 *  Archivo sin código de servidor: lo usan las acciones y la pantalla.
 * ============================================================================
 */

export type TipoFalloCarga =
  | 'archivo'      // no es un .xlsx o no se puede abrir
  | 'tamano'       // pesa más de lo que se puede subir
  | 'formato'      // es un Excel, pero no tiene los encabezados de la plantilla
  | 'vacio'        // tiene los encabezados, pero ninguna fila con datos
  | 'filas'        // demasiadas filas
  | 'permiso'      // el rol no puede, o la sesión caducó
  | 'base'         // la base rechazó guardar la importación
  | 'conexion'     // la respuesta no llegó
  | 'servidor';    // la respuesta llegó, pero el servidor falló

export type FalloCarga = { ok: false; mensaje: string; tipo?: TipoFalloCarga; referencia?: string };

/**
 * El resultado de una importación en una etiqueta, para la lista de
 * importaciones: sale de sus filas, no del estado («Validada» con filas que no
 * entraron no es «Completa»).
 */
export function resultadoCarga(estados: string[]): { texto: string; tono: 'ok' | 'atencion' | 'critico' | 'info' | 'neutro' } {
  const n = (...e: string[]) => estados.filter((x) => e.includes(x)).length;
  const hechas = n('registrada', 'programada');
  const mal = n('con_error', 'fallida');
  if (!estados.length) return { texto: 'Sin filas', tono: 'neutro' };
  if (n('procesando')) return { texto: 'Cargando…', tono: 'info' };
  if (hechas && mal) return { texto: `Parcial · ${mal} con error`, tono: 'atencion' };
  if (hechas && !n('valida')) return { texto: 'Cargada', tono: 'ok' };
  if (hechas) return { texto: 'Parcial · faltan registrar', tono: 'atencion' };
  if (mal) return { texto: `No cargada · ${mal} con error`, tono: 'critico' };
  if (n('valida')) return { texto: 'Sin errores · falta registrar', tono: 'info' };
  return { texto: 'Descartada', tono: 'neutro' };
}

export const TIPO_FALLO: Record<TipoFalloCarga, { titulo: string; queHacer: string }> = {
  archivo: {
    titulo: 'El archivo no se pudo abrir como Excel',
    queHacer: 'Ábralo en Excel, use «Guardar como» › «Libro de Excel (.xlsx)» y vuelva a subirlo.',
  },
  tamano: {
    titulo: 'El archivo es demasiado grande',
    queHacer: 'Suba solo las filas nuevas en la plantilla. Su base completa (la hoja GENERAL con todo el año) no se sube aquí: copie de ella solo los pallets de este ingreso.',
  },
  formato: {
    titulo: 'El archivo no tiene el formato de la plantilla',
    queHacer: 'Descargue la plantilla (paso 1) y pegue sus filas debajo de los encabezados, sin cambiarles el nombre.',
  },
  vacio: {
    titulo: 'El archivo no trae filas con datos',
    queHacer: 'Pegue sus filas debajo de los encabezados (la fila de ejemplo gris no cuenta) y vuelva a subirlo.',
  },
  filas: {
    titulo: 'El archivo tiene demasiadas filas',
    queHacer: 'Divídalo en varios archivos de hasta mil filas y súbalos por separado.',
  },
  permiso: {
    titulo: 'Su usuario no puede hacer esta carga',
    queHacer: 'Si la sesión caducó, vuelva a entrar. Si no, pídale la carga a uno de los roles que se indican.',
  },
  base: {
    titulo: 'El sistema no pudo guardar la importación',
    queHacer: 'Vuelva a intentarlo en un momento. Si se repite, avise a soporte con la hora y el nombre del archivo.',
  },
  conexion: {
    titulo: 'Se perdió la conexión',
    queHacer: 'Revise su internet y recargue la pantalla (F5): si la importación aparece en la lista de abajo, ya se subió.',
  },
  servidor: {
    titulo: 'El sistema tuvo un problema al procesar el archivo',
    queHacer: 'Recargue la pantalla (F5) y mire la lista de importaciones antes de reintentar. Si se repite, avise a soporte con la referencia.',
  },
};
