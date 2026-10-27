/**
 * ============================================================================
 *  REVISIÓN DE UNA IMPORTACIÓN DE INGRESOS
 * ============================================================================
 *  Lo que pidió Oliver, en una pantalla: qué filas cargaron bien, cuáles no y
 *  por qué, y poder corregirlas aquí mismo. Cada error dice su columna y su
 *  motivo en palabras; una fila se corrige y se vuelve a revisar, o se
 *  descarta. Cuando todo está bien, Gerencia u Operaciones la valida y se
 *  registra; Almacén la deja «Lista para validar».
 *
 *  La pantalla sirve también después: queda como constancia de qué entró de
 *  ese archivo, con el enlace a cada pallet registrado.
 * ============================================================================
 */
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina } from '@/components/ui/Pagina';
import { fechaHora } from '@/lib/formato';
import { hoyEnLima } from '@/lib/fechas';
import { leerFecha } from '@/lib/importacionExcel';
import { PUEDEN_INGRESAR, PUEDEN_VALIDAR_IMPORTACION } from '../../tipos';
import { cargarCatalogoIngresos } from '../revision';
import type { ErrorColumna, EstadoFila } from '../columnas';
import { RevisionIngresos, type FilaRevision } from './RevisionIngresos';

export const metadata: Metadata = { title: 'Revisar importación de ingresos' };
export const dynamic = 'force-dynamic';

export default async function PaginaRevisionIngresos(props: PageProps<'/almacenes/ingresos/importar/[id]'>) {
  const { id } = await props.params;
  const q = await props.searchParams;
  const usuario = await obtenerUsuarioActual();
  const rol = usuario?.rol ?? '';
  if (!(PUEDEN_INGRESAR as readonly string[]).includes(rol)) redirect('/almacenes/ingresos');

  const supabase = await crearClienteServidor();
  const [{ data: imp }, { data: filas }, cat] = await Promise.all([
    supabase
      .from('importaciones_excel')
      .select('id, tipo, archivo, estado, creado_en, enviada_en, procesado_en, autor:usuarios!importaciones_excel_creado_por_fkey(nombre), enviador:usuarios!importaciones_excel_enviada_por_fkey(nombre), validador:usuarios!importaciones_excel_procesado_por_fkey(nombre)')
      .eq('id', Number(id))
      .maybeSingle(),
    supabase
      .from('importaciones_excel_filas')
      .select('id, fila, datos, errores, estado, resultado, lote_id, ingreso_programado_id')
      .eq('importacion_id', Number(id))
      .order('fila')
      .limit(2000),
    cargarCatalogoIngresos(supabase),
  ]);
  if (!imp || imp.tipo !== 'ingresos') notFound();

  const hoy = hoyEnLima();
  const nombre = (x: unknown) => String((Array.isArray(x) ? x[0] : x as { nombre?: string } | null)?.nombre ?? '—');
  const nombreBodega = new Map(cat.bodegas.map((b) => [b.id, b.nombre]));

  const lista: FilaRevision[] = (filas ?? []).map((f) => {
    const datos = (f.datos ?? {}) as Record<string, string>;
    const llega = leerFecha(datos.llega_el ?? '');
    return {
      id: Number(f.id),
      fila: Number(f.fila),
      datos,
      errores: (f.errores ?? []) as ErrorColumna[],
      estado: f.estado as EstadoFila,
      resultado: (f.resultado as string) ?? null,
      lote_id: (f.lote_id as number) ?? null,
      programado_id: (f.ingreso_programado_id as number) ?? null,
      programar: Boolean(llega && llega > hoy),
    };
  });

  return (
    <>
      <CabeceraPagina
        titulo={`Importación · ${String(imp.archivo)}`}
        descripcion={`Subida por ${nombre(imp.autor)} el ${fechaHora(imp.creado_en as string)}.` +
          (imp.enviada_en ? ` Dejada lista para validar por ${nombre(imp.enviador)} el ${fechaHora(imp.enviada_en as string)}.` : '') +
          (imp.procesado_en ? ` Validada por ${nombre(imp.validador)} el ${fechaHora(imp.procesado_en as string)}.` : '')}
        volver={{ href: '/almacenes/ingresos/importar', texto: 'Volver a importaciones' }}
      />
      <RevisionIngresos
        importacionId={Number(imp.id)}
        estado={String(imp.estado)}
        filas={lista}
        recienSubida={q.subida === '1'}
        puedeValidar={(PUEDEN_VALIDAR_IMPORTACION as readonly string[]).includes(rol)}
        opciones={{
          productos: cat.productos.map((p) => p.etiqueta),
          bodegas: cat.bodegas.filter((b) => b.activo).map((b) => ({
            nombre: b.nombre, produccion: b.recibe_produccion, compras: b.recibe_compras,
          })),
          camaras: cat.camaras.map((c) => ({ nombre: c.nombre, bodega: nombreBodega.get(c.almacen_id) ?? '' })),
          plantas: cat.plantas.map((p) => p.nombre),
          lineas: cat.lineas.map((l) => l.nombre),
        }}
      />
    </>
  );
}
