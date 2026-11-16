/**
 * ============================================================================
 *  EL ARCHIVO DE UN DOCUMENTO COMERCIAL · cargar, verificar y generar
 * ============================================================================
 *  Lo comparten la descarga (api/documentos) y el envío por correo desde
 *  comex@ (propuesta del portal, M7): el PDF que recibe el cliente por correo
 *  es EXACTAMENTE el mismo que se descarga, con las mismas verificaciones. Si
 *  los importes no cuadran, no se genera ni se envía.
 * ============================================================================
 */
import { cargarDocumento, nombreArchivo, type Documento, type TipoDocumento } from '@/lib/documentos';
import { generarPdf } from '@/lib/pdf';
import { generarProformaExportacion } from '@/lib/pdfProforma';
import { generarDocumentoExcel } from '@/lib/excelDocumento';

export type ArchivoDocumento =
  | {
      ok: true;
      documento: Documento;
      archivo: Buffer;
      tipoMime: string;
      extension: 'pdf' | 'xlsx';
      nombre: string;
    }
  | {
      ok: false;
      /** El código HTTP que corresponde (404, 422 o 500). */
      estado: number;
      error: string;
      detalles?: string[];
      numero?: string;
    };

export async function generarArchivoDocumento(
  tipo: TipoDocumento,
  id: number,
  formato: 'pdf' | 'excel'
): Promise<ArchivoDocumento> {
  /* ---- Armar y verificar ---- */
  let documento: Documento;
  try {
    documento = await cargarDocumento(tipo, id);
  } catch (e) {
    return { ok: false, estado: 404, error: e instanceof Error ? e.message : 'No se encontró el documento.' };
  }

  if (documento.errores.length) {
    /*
     * 422: la petición es correcta pero el contenido no se puede procesar.
     * Se devuelve la lista entera para que la pantalla diga QUÉ está mal y no
     * un «error al generar» que no ayuda a nadie.
     */
    return {
      ok: false,
      estado: 422,
      error: 'El documento no se puede emitir porque sus datos no cuadran.',
      detalles: documento.errores,
      numero: documento.numero,
    };
  }

  /* ---- Generar ---- */
  try {
    if (formato === 'excel') {
      const archivo = await generarDocumentoExcel(documento);
      return {
        ok: true, documento, archivo, extension: 'xlsx',
        tipoMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        nombre: `${nombreArchivo(documento)}.xlsx`,
      };
    }
    /*
     * La proforma de exportación se dibuja con su propio diseño porque no es
     * el mismo documento: es un CONTRATO DE VENTA internacional, bilingüe, en
     * kilos, con las condiciones del embarque y dos firmas. Se decide por el
     * dato y no por el tipo —una proforma a un cliente peruano sigue saliendo
     * con el formato local— porque lo que cambia la estructura es que la
     * mercadería salga del país, no cómo se llame el documento.
     */
    const archivo = documento.exportacion
      ? await generarProformaExportacion(documento)
      : await generarPdf(documento);
    return {
      ok: true, documento, archivo, extension: 'pdf', tipoMime: 'application/pdf',
      nombre: `${nombreArchivo(documento)}.pdf`,
    };
  } catch (e) {
    return { ok: false, estado: 500, error: e instanceof Error ? e.message : 'No se pudo generar el archivo.' };
  }
}
