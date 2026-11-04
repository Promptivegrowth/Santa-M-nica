/**
 * ============================================================================
 *  LA PROGRAMACIÓN DE EMBARQUES EN EXCEL Y EN PDF («Observaciones ERP 4», 10)
 * ============================================================================
 *  «Generar programación en lista descargable y legible». Baja LO QUE SE VE:
 *  el mismo rango de fechas, los mismos filtros de columna y el mismo orden
 *  que la lista de la pantalla, porque los tres salen de la dirección web y
 *  se resuelven con las mismas funciones (src/lib/programacion*.ts).
 *
 *     /api/logistica/programacion?formato=excel&f_naviera=COSCO
 *     /api/logistica/programacion?formato=pdf&vista=lista&mes=2026-11
 *
 *  Se consulta con la sesión del usuario: nadie descarga lo que no podría
 *  ver. La descarga es de quien puede abrir el Planificador.
 * ============================================================================
 */
import { NextResponse, type NextRequest } from 'next/server';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { generarReporte, type ColumnaExcel } from '@/lib/excel';
import { generarPdfReporte, type ColumnaPdf } from '@/lib/pdfReporte';
import { rolPuedeVerRuta, NOMBRE_ROL, type Rol } from '@/lib/navegacion';
import { hoyEnLima } from '@/lib/fechas';
import { cargarProgramacion, rangoDeParametros } from '@/lib/programacionDatos';
import {
  COLUMNAS_PROGRAMACION, describirFiltros, filtrarProgramacion, filtrosDeParametros, ordenarProgramacion, valorTexto,
} from '@/lib/programacion';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return NextResponse.json({ error: 'Su sesión expiró. Vuelva a entrar.' }, { status: 401 });
  if (!rolPuedeVerRuta(usuario.rol as Rol, '/logistica/planificador')) {
    return NextResponse.json({
      error: `${NOMBRE_ROL[usuario.rol as Rol] ?? 'Su usuario'} no puede descargar la programación de embarques: la descargan quienes ven el Planificador.`,
    }, { status: 403 });
  }

  const p = req.nextUrl.searchParams;
  const formato = p.get('formato') === 'pdf' ? 'pdf' : 'excel';
  const rango = rangoDeParametros(p, hoyEnLima());
  const filtros = filtrosDeParametros(p);
  const dir = p.get('dir') === 'desc' ? 'desc' : 'asc';

  const supabase = await crearClienteServidor();
  const todas = await cargarProgramacion(supabase, { desde: rango.desde, hasta: rango.hasta });
  const filas = ordenarProgramacion(filtrarProgramacion(todas, filtros), p.get('orden'), dir);

  //  Las celdas, ya como texto legible (fechas dd/mm/aaaa, estado en palabras…), salvo semana y TM.
  const planas = filas.map((f) => {
    const o: Record<string, unknown> = {};
    for (const c of COLUMNAS_PROGRAMACION) {
      o[c.clave] = c.clave === 'tm' ? f.tm : c.clave === 'semana' ? f.semana : valorTexto(f, c.clave);
    }
    return o;
  });
  const filtrosTexto = { 'Rango': rango.descripcion, ...describirFiltros(filtros) };
  const titulo = 'Programación de embarques';
  const subtitulo = `${filas.length} de ${todas.length} embarque(s) · ${rango.descripcion}`;
  const sello = hoyEnLima().replace(/-/g, '');

  if (formato === 'excel') {
    const columnas: ColumnaExcel[] = COLUMNAS_PROGRAMACION.map((c) => ({
      titulo: c.titulo, clave: c.clave, ancho: c.anchoExcel,
      ...(c.clave === 'tm' ? { formato: '#,##0.000' } : c.clave === 'semana' ? { formato: '0', alineacion: 'center' as const } : {}),
    }));
    const buffer = await generarReporte({
      titulo, subtitulo, hoja: 'Programación', columnas, filas: planas,
      filtros: filtrosTexto, usuario: usuario.nombre as string, totalizar: ['tm'],
    });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="SantaMonica_Programacion_embarques_${sello}.xlsx"`,
        'Cache-Control': 'no-store',
        'x-filas': String(filas.length),
      },
    });
  }

  /*
   * EL PDF va apaisado y con 15 columnas (las de peso > 0 en programacion.ts):
   * con las 20, no se leía ninguna. El Excel las lleva todas.
   */
  const columnasPdf: ColumnaPdf[] = COLUMNAS_PROGRAMACION.filter((c) => c.pesoPdf > 0).map((c) => ({
    titulo: c.corto ?? c.titulo, clave: c.clave, peso: c.pesoPdf,
    ...(c.clave === 'tm' ? { tipo: 'numero' as const, alineado: 'right' as const }
      : c.clave === 'semana' ? { tipo: 'entero' as const, alineado: 'center' as const } : {}),
  }));
  const tmTotal = filas.reduce((t, f) => t + f.tm, 0);
  //  En el PDF las fechas van cortas (05/11/26): con el año entero no cabían en su columna.
  const corta = (v: unknown) => String(v ?? '').replace(/^(\d{2}\/\d{2}\/)\d{2}(\d{2})$/, '$1$2');
  const filasPdf = planas.map((f) => ({ ...f, fecha_despacho: corta(f.fecha_despacho), fecha_zarpe: corta(f.fecha_zarpe) }));
  const pdf = await generarPdfReporte({
    titulo, subtitulo, columnas: columnasPdf, filas: filasPdf, totalizar: ['tm'], filtros: filtrosTexto,
    resumen: [
      { etiqueta: 'Embarques', valor: String(filas.length) },
      { etiqueta: 'TM', valor: tmTotal.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
      { etiqueta: 'Sin N.º de packing', valor: String(filas.filter((f) => !f.pl).length) },
      { etiqueta: 'Sin zarpe', valor: String(filas.filter((f) => !f.fecha_zarpe).length) },
    ],
    usuario: usuario.nombre as string,
    generadoEn: new Date(),
  });
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="SantaMonica_Programacion_embarques_${sello}.pdf"`,
      'Cache-Control': 'no-store',
      'x-filas': String(filas.length),
    },
  });
}
