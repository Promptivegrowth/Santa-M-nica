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
  const [{ data: c }, { data: firmas }] = await Promise.all([
    supabase.from('contratos').select('numero, datos').eq('id', Number(id)).maybeSingle(),
    supabase.from('parametros').select('clave, valor').in('clave', ['firmante_firma', 'firmante_firma_contrato']),
  ]);
  if (!c) return NextResponse.json({ error: 'Ese contrato no existe o no tiene acceso.' }, { status: 404 });
  if (!c.datos) return NextResponse.json({ error: 'Es un contrato de la plantilla provisional, sin datos del modelo.' }, { status: 410 });

  const datos = c.datos as DatosContrato;
  /*
   * La firma: el BLOQUE del contrato (trazo + nombre, cargo, empresa y RUC,
   * como en el modelo) si está en Configuración; si no, la firma suelta de la
   * proforma, y entonces el PDF escribe debajo nombre y cargo.
   */
  const bloque = String(firmas?.find((f) => f.clave === 'firmante_firma_contrato')?.valor ?? '') || null;
  const suelta = String(firmas?.find((f) => f.clave === 'firmante_firma')?.valor ?? '') || null;
  const firma = { imagen: bloque ?? suelta, esBloque: !!bloque };
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
