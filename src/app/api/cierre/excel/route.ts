/**
 * Cierre semanal de producción en Excel. Solo para Marco y Oliver (permiso de
 * Objetivos): se comprueba aquí y la base tampoco le daría datos a otro.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { hoyEnLima, desplazarDias } from '@/lib/fechas';
import { fechaLarga } from '@/lib/formato';
import { gestionDelMes } from '@/lib/cierre';
import { cargarCierre } from '@/lib/cierreDatos';
import { generarExcelCierre } from '@/lib/excelCierre';

export const dynamic = 'force-dynamic';
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export async function GET(req: NextRequest) {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return NextResponse.json({ error: 'Inicie sesión.' }, { status: 401 });
  if (usuario.ve_objetivos !== true) {
    return NextResponse.json({ error: 'El cierre de producción es solo para las personas autorizadas.' }, { status: 403 });
  }

  const hoy = hoyEnLima();
  const m = /^(\d{4})-(\d{2})$/.exec(req.nextUrl.searchParams.get('mes') ?? '');
  const anio = m ? Number(m[1]) : Number(hoy.slice(0, 4));
  const mes = m ? Math.min(Math.max(Number(m[2]), 1), 12) : Number(hoy.slice(5, 7));
  const periodo = `${anio}-${String(mes).padStart(2, '0')}`;
  const ultimoDia = `${periodo}-${String(new Date(Date.UTC(anio, mes, 0)).getUTCDate()).padStart(2, '0')}`;
  const actualizado = periodo < hoy.slice(0, 7) ? ultimoDia : desplazarDias(hoy, -1);
  //  Un mes ya cerrado se gestionó entero: 100 %.
  const g0 = gestionDelMes(anio, mes, actualizado);
  const g = periodo < hoy.slice(0, 7) ? { transcurridos: g0.total, total: g0.total } : g0;

  const supabase = await crearClienteServidor();
  const { filas, total, dias } = await cargarCierre(supabase, anio, mes);
  const buffer = await generarExcelCierre({
    filas, total, dias,
    actualizadoTexto: fechaLarga(actualizado),
    gestion: g.transcurridos / g.total,
    mesTexto: `${MESES[mes - 1]} ${anio}`,
    usuario: usuario.nombre as string,
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="SantaMonica_Cierre_Produccion_${periodo}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
