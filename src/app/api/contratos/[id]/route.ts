/**
 * El contrato generado, en PDF o en Word (?formato=word). Los dos salen de
 * los MISMOS datos guardados al generarlo; el Word, además, sobre la
 * plantilla exacta del modelo de Santa Mónica. Se lee con la sesión del
 * usuario: si la base no le deja ver el contrato, no hay archivo.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { generarPdfContrato } from '@/lib/pdfContrato';
import { generarDocxContrato } from '@/lib/docxContrato';
import type { DatosContrato } from '@/lib/contratoVenta';
import { firmaDeContrato } from '@/lib/firmanteDocumento';
import { PUEDEN_DESCARGAR_DOCUMENTOS } from '@/lib/permisosFinanzas';
import { nombreRol, listaDeRoles } from '@/lib/permisosVentas';
import type { Rol } from '@/lib/navegacion';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: RouteContext<'/api/contratos/[id]'>) {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return NextResponse.json({ error: 'Inicie sesión.' }, { status: 401 });
  /*
   * El contrato lleva precios: lo bajan los mismos que bajan la proforma
   * (076). Antes esta ruta no miraba el rol y cualquiera con el enlace se
   * llevaba el PDF.
   */
  if (!PUEDEN_DESCARGAR_DOCUMENTOS.includes(usuario.rol as Rol)) {
    return NextResponse.json(
      {
        error: `${nombreRol(usuario.rol)} no descarga contratos (llevan precios): ` +
          `lo hacen ${listaDeRoles(PUEDEN_DESCARGAR_DOCUMENTOS)}.`,
      },
      { status: 403 }
    );
  }

  const { id } = await ctx.params;
  const supabase = await crearClienteServidor();
  const { data: c } = await supabase.from('contratos').select('numero, datos').eq('id', Number(id)).maybeSingle();
  if (!c) return NextResponse.json({ error: 'Ese contrato no existe o no tiene acceso.' }, { status: 404 });
  if (!c.datos) return NextResponse.json({ error: 'Es un contrato de la plantilla provisional, sin datos del modelo.' }, { status: 410 });

  const datos = { ...(c.datos as DatosContrato) };
  /*
   * La firma (083): la de quien aprobó la cotización, si el contrato se generó
   * con la suya («Mi firma»), y el PDF escribe debajo su nombre y cargo. Si
   * no —o si después la quitó—, la de Configuración: el BLOQUE del contrato
   * (trazo + nombre, cargo, empresa y RUC, como en el modelo) o la firma
   * suelta de la proforma, con el nombre y el cargo de Gerencia.
   */
  const elegida = await firmaDeContrato(supabase, datos.firmante?.usuarioId ?? null);
  if (elegida.defecto && datos.firmante) {
    datos.firmante = { ...datos.firmante, nombre: elegida.defecto.nombre, cargo: elegida.defecto.cargo };
  }
  const firma = { imagen: elegida.imagen, esBloque: elegida.esBloque };
  const word = req.nextUrl.searchParams.get('formato') === 'word';
  const archivo = word ? await generarDocxContrato(datos, firma) : await generarPdfContrato(datos, firma);
  const nombre = `Contrato_${String(c.numero).replace(/[^A-Za-z0-9-]+/g, '_').replace(/_+$/, '')}`;

  return new NextResponse(new Uint8Array(archivo), {
    headers: {
      'Content-Type': word
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/pdf',
      'Content-Disposition': `attachment; filename="SantaMonica_${nombre}.${word ? 'docx' : 'pdf'}"`,
      'Cache-Control': 'no-store',
    },
  });
}
