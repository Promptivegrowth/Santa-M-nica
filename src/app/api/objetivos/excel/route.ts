/**
 * ============================================================================
 *  OBJETIVOS MENSUALES · descarga en Excel
 * ============================================================================
 *  Recibe los mismos filtros que la pantalla (en la dirección) y devuelve el
 *  archivo con exactamente lo que se estaba viendo.
 *
 *  Solo para las personas autorizadas: se comprueba aquí y, además, la base
 *  no le devuelve nada a nadie más (migración 060).
 * ============================================================================
 */
import { NextResponse, type NextRequest } from 'next/server';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { hoyEnLima } from '@/lib/fechas';
import { NOMBRE_MES } from '@/lib/objetivos';
import { cargarTablero, describirFiltros, filtrar, leerFiltros } from '@/lib/objetivosDatos';
import { generarExcelObjetivos } from '@/lib/excelObjetivos';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return NextResponse.json({ error: 'Inicie sesión.' }, { status: 401 });
  if (usuario.ve_objetivos !== true) {
    return NextResponse.json({ error: 'Objetivos mensuales es solo para las personas autorizadas.' }, { status: 403 });
  }

  const q = Object.fromEntries(req.nextUrl.searchParams.entries());
  const f = leerFiltros(q, Number(hoyEnLima().slice(0, 4)));
  const supabase = await crearClienteServidor();
  const { filas: todas, tipoCambio } = await cargarTablero(supabase, f.anio);
  const filas = filtrar(todas, f);

  const buffer = await generarExcelObjetivos({
    filas, todas, filtros: f, filtrosTexto: describirFiltros(f, NOMBRE_MES),
    usuario: usuario.nombre as string, tipoCambio,
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="SantaMonica_Objetivos_${f.anio}_${hoyEnLima()}.xlsx"`,
      'Cache-Control': 'no-store',
      'X-Filas': String(filas.length),
    },
  });
}
