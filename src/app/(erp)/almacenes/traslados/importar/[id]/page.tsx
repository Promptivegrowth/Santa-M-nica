/**
 * ============================================================================
 *  REVISIÓN DE UNA IMPORTACIÓN DE TRASLADOS
 * ============================================================================
 *  Cada fila con su motivo si no se puede mover (no está en esa bodega,
 *  apartado, bloqueado, repetido…), corrección en pantalla, y al final
 *  «Crear N traslados en borrador», agrupados por origen → destino.
 * ============================================================================
 */
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina } from '@/components/ui/Pagina';
import { fechaHora } from '@/lib/formato';
import { PUEDEN_SOLICITAR } from '../../registro';
import type { ErrorColumna, EstadoFila } from '../../../ingresos/importar/columnas';
import { RevisionTraslados, type FilaRevisionT } from './RevisionTraslados';

export const metadata: Metadata = { title: 'Revisar importación de traslados' };
export const dynamic = 'force-dynamic';

export default async function PaginaRevisionTraslados(props: PageProps<'/almacenes/traslados/importar/[id]'>) {
  const { id } = await props.params;
  const q = await props.searchParams;
  const usuario = await obtenerUsuarioActual();
  if (!(PUEDEN_SOLICITAR as readonly string[]).includes(usuario?.rol ?? '')) redirect('/almacenes/traslados');

  const supabase = await crearClienteServidor();
  const [{ data: imp }, { data: filas }, { data: bodegas }] = await Promise.all([
    supabase.from('importaciones_excel')
      .select('id, tipo, archivo, estado, creado_en, procesado_en, autor:usuarios!importaciones_excel_creado_por_fkey(nombre), validador:usuarios!importaciones_excel_procesado_por_fkey(nombre)')
      .eq('id', Number(id)).maybeSingle(),
    supabase.from('importaciones_excel_filas')
      .select('id, fila, datos, errores, estado, resultado, traslado_id, traslados(numero, estado)')
      .eq('importacion_id', Number(id)).order('fila').limit(2000),
    supabase.from('almacenes').select('nombre').eq('activo', true).order('nombre'),
  ]);
  if (!imp || imp.tipo !== 'traslados') notFound();
  const nombre = (x: unknown) => String((Array.isArray(x) ? x[0] : x as { nombre?: string } | null)?.nombre ?? '—');

  const lista: FilaRevisionT[] = (filas ?? []).map((f) => {
    const t = (Array.isArray(f.traslados) ? f.traslados[0] : f.traslados) as { numero?: string; estado?: string } | null;
    return {
      id: Number(f.id), fila: Number(f.fila), datos: (f.datos ?? {}) as Record<string, string>,
      errores: (f.errores ?? []) as ErrorColumna[], estado: f.estado as EstadoFila, resultado: (f.resultado as string) ?? null,
      traslado_id: (f.traslado_id as number) ?? null, traslado: t?.numero ?? null,
    };
  });

  return (
    <>
      <CabeceraPagina
        titulo={`Importación de traslados · ${String(imp.archivo)}`}
        descripcion={`Subida por ${nombre(imp.autor)} el ${fechaHora(imp.creado_en as string)}.` +
          (imp.procesado_en ? ` Traslados creados por ${nombre(imp.validador)} el ${fechaHora(imp.procesado_en as string)}.` : '')}
        volver={{ href: '/almacenes/traslados/importar', texto: 'Volver a importaciones' }}
      />
      <RevisionTraslados
        importacionId={Number(imp.id)}
        filas={lista}
        bodegas={(bodegas ?? []).map((b) => String(b.nombre))}
        recienSubida={q.subida === '1'}
      />
    </>
  );
}
