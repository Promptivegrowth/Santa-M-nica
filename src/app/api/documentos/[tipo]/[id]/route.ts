/**
 * ============================================================================
 *  API DE DOCUMENTOS · descarga la cotización, proforma, factura o boleta
 * ============================================================================
 *  Una sola dirección para los cuatro documentos y los dos formatos:
 *
 *    /api/documentos/cotizacion/12?formato=pdf
 *    /api/documentos/factura/340?formato=excel
 *
 *  TRES COSAS QUE PASAN AQUÍ Y NO SE VEN
 *
 *  1. La consulta usa la SESIÓN del usuario, no una clave de servicio. Así las
 *     políticas de la base se aplican también a las descargas: nadie puede
 *     bajarse en PDF lo que no podría abrir en pantalla.
 *
 *  2. Antes de generar nada se verifica el documento. Si sus importes no
 *     cuadran con lo guardado, NO se emite: se devuelve el detalle de qué no
 *     cuadra. Un archivo defectuoso, en cuanto existe, alguien lo manda.
 *
 *  3. Queda registrado quién descargó qué y cuándo. Una factura que sale de la
 *     empresa es un hecho del negocio, no una consulta.
 * ============================================================================
 */
import { NextResponse, type NextRequest } from 'next/server';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { cargarDocumento, nombreArchivo, type TipoDocumento } from '@/lib/documentos';
import { generarPdf } from '@/lib/pdf';
import { generarDocumentoExcel } from '@/lib/excelDocumento';

const TIPOS: TipoDocumento[] = ['cotizacion', 'proforma', 'factura', 'boleta'];

/**
 * Quién puede descargar un documento comercial.
 *
 * Es una lista propia y no `veCostos()` porque Comercio Exterior necesita la
 * proforma invoice para la aduana aunque no vea márgenes. Almacén y Calidad
 * quedan fuera: su trabajo no requiere ver precios, y un PDF con precios que
 * sale por correo ya no se controla.
 */
const PUEDEN_DESCARGAR = ['gerencia', 'operaciones', 'comercial', 'comex'];

export async function GET(
  peticion: NextRequest,
  contexto: RouteContext<'/api/documentos/[tipo]/[id]'>
) {
  const { tipo, id } = await contexto.params;
  const formato = peticion.nextUrl.searchParams.get('formato') === 'excel' ? 'excel' : 'pdf';

  /* ---- 1. Sesión y permiso ---- */
  const usuario = await obtenerUsuarioActual();
  if (!usuario) {
    return NextResponse.json({ error: 'No autenticado. Vuelva a iniciar sesión.' }, { status: 401 });
  }
  if (!PUEDEN_DESCARGAR.includes(usuario.rol)) {
    return NextResponse.json(
      { error: `Su rol (${usuario.rol}) no puede descargar documentos comerciales.` },
      { status: 403 }
    );
  }

  /* ---- 2. Qué se pidió ---- */
  if (!TIPOS.includes(tipo as TipoDocumento)) {
    return NextResponse.json(
      { error: `Tipo de documento desconocido: «${tipo}». Los válidos son: ${TIPOS.join(', ')}.` },
      { status: 400 }
    );
  }

  const numeroId = Number(id);
  if (!Number.isInteger(numeroId) || numeroId <= 0) {
    return NextResponse.json({ error: 'Identificador inválido.' }, { status: 400 });
  }

  /* ---- 3. Armar y verificar ---- */
  let documento;
  try {
    documento = await cargarDocumento(tipo as TipoDocumento, numeroId);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'No se encontró el documento.' },
      { status: 404 }
    );
  }

  if (documento.errores.length) {
    /*
     * 422: la petición es correcta pero el contenido no se puede procesar.
     * Se devuelve la lista entera para que la pantalla diga QUÉ está mal y no
     * un «error al generar» que no ayuda a nadie.
     */
    return NextResponse.json(
      {
        error: 'El documento no se puede emitir porque sus datos no cuadran.',
        detalles: documento.errores,
        numero: documento.numero,
      },
      { status: 422 }
    );
  }

  /* ---- 4. Generar ---- */
  let archivo: Buffer;
  let tipoMime: string;
  let extension: string;

  try {
    if (formato === 'excel') {
      archivo = await generarDocumentoExcel(documento);
      tipoMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      extension = 'xlsx';
    } else {
      archivo = await generarPdf(documento);
      tipoMime = 'application/pdf';
      extension = 'pdf';
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'No se pudo generar el archivo.' },
      { status: 500 }
    );
  }

  /* ---- 5. Dejar constancia ---- */
  try {
    const supabase = await crearClienteServidor();
    await supabase.rpc('registrar_evento', {
      p_entidad: tipo === 'proforma' ? 'pedidos' : tipo === 'cotizacion' ? 'cotizaciones' : 'facturas',
      p_entidad_id: numeroId,
      p_tipo: 'documento_descargado',
      p_descripcion: `${documento.titulo} ${documento.numero} descargada en ${formato.toUpperCase()} por ${usuario.nombre}`,
      p_severidad: 'info',
      p_metadatos: { formato, avisos: documento.avisos.length },
    });
  } catch {
    /*
     * Si la bitácora falla, el documento se entrega igual. Perder la traza de
     * una descarga es molesto; negarle la factura al cliente porque no se pudo
     * anotar, es peor.
     */
  }

  const nombre = `${nombreArchivo(documento)}.${extension}`;

  return new NextResponse(new Uint8Array(archivo), {
    headers: {
      'Content-Type': tipoMime,
      'Content-Disposition': `attachment; filename="${nombre}"`,
      'Content-Length': String(archivo.length),
      // Un comprobante no se cachea: si se corrige y se vuelve a bajar, tiene
      // que llegar el corregido.
      'Cache-Control': 'no-store, must-revalidate',
      // Cuántas observaciones trae, para que la pantalla pueda avisar sin
      // tener que abrir el archivo.
      'X-Avisos': String(documento.avisos.length),
    },
  });
}
