/**
 * Excel de reclamos (indicadores de Calidad, 090): un renglón por reclamo con
 * su cliente, proforma, motivo, clasificación, plazo, estado y días de
 * cierre, para que Calidad arme sus propios cuadros. Se exporta con la sesión
 * del usuario: la política de la base decide qué reclamos ve.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { generarReporte } from '@/lib/excel';
import { cargarReclamos, ESTADOS_RECLAMO, SEMAFORO, ROLES_VEN_RECLAMOS } from '@/lib/reclamos';
import { rolNoPuede } from '@/lib/mensajesBase';

export const dynamic = 'force-dynamic';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return NextResponse.json({ error: 'Inicie sesión.' }, { status: 401 });
  if (!ROLES_VEN_RECLAMOS.includes(usuario.rol)) {
    return NextResponse.json({ error: rolNoPuede(usuario.rol, 'exportar los reclamos', ROLES_VEN_RECLAMOS) }, { status: 403 });
  }

  const desde = req.nextUrl.searchParams.get('desde') ?? '';
  const hasta = req.nextUrl.searchParams.get('hasta') ?? '';
  const supabase = await crearClienteServidor();
  const { filas, error } = await cargarReclamos(supabase, {
    desde: FECHA.test(desde) ? desde : '', hasta: FECHA.test(hasta) ? hasta : '',
  });
  if (error) return NextResponse.json({ error: 'No se pudieron leer los reclamos.' }, { status: 500 });

  const buffer = await generarReporte({
    titulo: 'Reclamos de clientes',
    subtitulo: `${filas.length} reclamo(s) · motivo, cliente, plazo y tiempo de cierre`,
    hoja: 'Reclamos',
    columnas: [
      { titulo: 'N.° reclamo', clave: 'numero', ancho: 15 },
      { titulo: 'Registrado', clave: 'fecha', ancho: 12, formato: 'dd/mm/yyyy' },
      { titulo: 'Cliente', clave: 'cliente', ancho: 30 },
      { titulo: 'Código', clave: 'cliente_codigo', ancho: 10 },
      { titulo: 'Proforma', clave: 'proforma', ancho: 13 },
      { titulo: 'Contenedor', clave: 'contenedor', ancho: 16 },
      { titulo: 'Motivo', clave: 'motivo', ancho: 30 },
      { titulo: 'Clasificación', clave: 'clasificacion', ancho: 14 },
      { titulo: 'Plazo (días)', clave: 'plazo_dias', ancho: 10, formato: '#,##0' },
      { titulo: 'Fecha límite', clave: 'fecha_limite', ancho: 12, formato: 'dd/mm/yyyy' },
      { titulo: 'Estado', clave: 'estado', ancho: 15 },
      { titulo: 'Semáforo', clave: 'semaforo', ancho: 13 },
      { titulo: 'Cerrado', clave: 'cerrado_en', ancho: 12, formato: 'dd/mm/yyyy' },
      { titulo: 'Días de cierre', clave: 'dias_cierre', ancho: 11, formato: '#,##0.0' },
      { titulo: 'En plazo', clave: 'en_plazo', ancho: 9 },
      { titulo: 'Contacto', clave: 'contacto', ancho: 32 },
    ],
    filas: filas.map((r) => ({
      ...r,
      fecha: new Date(`${r.fecha}T12:00:00`),
      fecha_limite: r.fecha_limite ? new Date(`${r.fecha_limite}T12:00:00`) : null,
      cerrado_en: r.cerrado_en ? new Date(r.cerrado_en) : null,
      contenedor: r.contenedor ?? 'Toda la proforma',
      clasificacion: r.clasificacion ?? 'Sin clasificar',
      estado: ESTADOS_RECLAMO[r.estado] ?? r.estado,
      semaforo: SEMAFORO[r.semaforo].texto,
      dias_cierre: r.dias_cierre === null ? null : Math.round(r.dias_cierre * 10) / 10,
      en_plazo: r.cerrado_en_plazo === null ? '' : r.cerrado_en_plazo ? 'Sí' : 'No',
      contacto: `${r.contacto_nombre} <${r.contacto_correo}>`,
    })),
    filtros: { ...(desde ? { Desde: desde } : {}), ...(hasta ? { Hasta: hasta } : {}) },
    usuario: usuario.nombre as string,
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="SantaMonica_Reclamos.xlsx"',
      'Cache-Control': 'no-store',
    },
  });
}
