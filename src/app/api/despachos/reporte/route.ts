/**
 * Reporte de carga en PDF (observaciones de octubre, punto 17), de uno o de
 * varios despachos (selector, punto 14). Con `items`, solo esos pallets de
 * los despachos que se eligieron a medias.
 *
 *     /api/despachos/reporte?ids=12
 *     /api/despachos/reporte?ids=12,15&items=301,302
 */
import { NextResponse, type NextRequest } from 'next/server';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { cargarDespachos, idsDeTexto } from '@/lib/despachosDatos';
import { generarReporteCarga, type FotoReporte } from '@/lib/pdfReporteCarga';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return NextResponse.json({ error: 'Inicie sesión.' }, { status: 401 });

  const ids = idsDeTexto(req.nextUrl.searchParams.get('ids')).slice(0, 40);
  if (!ids.length) return NextResponse.json({ error: 'Elija al menos un despacho.' }, { status: 400 });
  const items = new Set(idsDeTexto(req.nextUrl.searchParams.get('items')));

  const supabase = await crearClienteServidor();
  const despachos = await cargarDespachos(supabase, { ids });
  if (!despachos.length) return NextResponse.json({ error: 'No se encontraron esos despachos.' }, { status: 404 });

  /*
   * Un despacho «a medias» es el que tiene algún ítem en `items`: de ese solo
   * van los elegidos. Los demás van enteros.
   */
  const parciales = new Set<number>();
  for (const d of despachos) {
    if (items.size && d.items.some((i) => items.has(i.id))) {
      d.items = d.items.filter((i) => items.has(i.id));
      parciales.add(d.id);
    }
  }

  /* ---- Las fotos, en el orden en que se subieron ---- */
  const { data: archivos } = await supabase
    .from('despacho_archivos').select('despacho_id, ruta, nombre')
    .in('despacho_id', despachos.map((d) => d.id)).eq('tipo', 'foto').order('subido_en');
  const fotos = new Map<number, FotoReporte[]>();
  for (const a of archivos ?? []) {
    const { data } = await supabase.storage.from('despachos').download(String(a.ruta));
    if (!data) continue;
    const lista = fotos.get(Number(a.despacho_id)) ?? [];
    lista.push({ nombre: String(a.nombre), datos: Buffer.from(await data.arrayBuffer()) });
    fotos.set(Number(a.despacho_id), lista);
  }

  const pdf = await generarReporteCarga({ despachos, fotos, parciales, usuario: usuario.nombre as string, generadoEn: new Date() });
  const nombre = despachos.length === 1 ? `Reporte_carga_${despachos[0].numero}` : `Reporte_carga_${despachos.length}_despachos`;
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="SantaMonica_${nombre}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
