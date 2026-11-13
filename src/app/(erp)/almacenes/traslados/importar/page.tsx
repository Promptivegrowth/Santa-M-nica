/**
 * ============================================================================
 *  IMPORTAR TRASLADOS DESDE EXCEL
 * ============================================================================
 *  Igual que los ingresos: plantilla, pegar, subir, revisar, validar. La
 *  plantilla trae los pallets que hoy se pueden mover, bodega por bodega,
 *  para copiar su código. Son traslados YA HECHOS (079): al validarlos entran
 *  despachados y recibidos, con su fecha y su guía, moviendo el stock.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { Icono } from '@/components/estructura/Icono';
import { fechaHora, num } from '@/lib/formato';
import { resultadoCarga } from '@/lib/falloCarga';
import { traerTodo } from '@/lib/traerTodo';
import { PUEDEN_SOLICITAR } from '../registro';
import { SubirArchivo } from '../../ingresos/importar/SubirArchivo';
import { subirImportacionTraslados } from './acciones';

export const metadata: Metadata = { title: 'Importar traslados' };
export const dynamic = 'force-dynamic';

export default async function PaginaImportarTraslados() {
  const usuario = await obtenerUsuarioActual();
  if (!(PUEDEN_SOLICITAR as readonly string[]).includes(usuario?.rol ?? '')) redirect('/almacenes/traslados');

  const supabase = await crearClienteServidor();
  const { data: importaciones } = await supabase
    .from('importaciones_excel')
    .select('id, archivo, estado, creado_en, procesado_en, autor:usuarios!importaciones_excel_creado_por_fkey(nombre)')
    .eq('tipo', 'traslados').order('creado_en', { ascending: false }).limit(40);
  const ids = (importaciones ?? []).map((i) => Number(i.id));
  const filas = ids.length
    ? await traerTodo<{ importacion_id: number; estado: string; traslado_id: number | null }>((d, h) =>
        supabase.from('importaciones_excel_filas').select('importacion_id, estado, traslado_id').in('importacion_id', ids).order('id').range(d, h))
    : [];
  const nombre = (x: unknown) => String((Array.isArray(x) ? x[0] : x as { nombre?: string } | null)?.nombre ?? '—');

  return (
    <>
      <CabeceraPagina
        titulo="Importar traslados desde Excel"
        descripcion="Para registrar traslados que ya ocurrieron. Descargue la plantilla (trae los pallets disponibles de cada bodega), pegue los que se movieron con su fecha y su guía, y súbala. Al validarla, cada traslado entra ya recibido en destino."
        volver={{ href: '/almacenes/traslados', texto: 'Volver a traslados' }}
      />
      <div className="rejilla-2 mb-espacio">
        <Panel titulo="1 · Descargue la plantilla">
          <div style={{ padding: '1rem' }}>
            <p style={{ marginTop: 0 }}>
              Con los campos de un traslado ya hecho (pallet, bodega de origen y de destino, bultos y kilos si fue una parte,
              fecha de traslado, n.º de guía, observaciones) y una hoja con los <strong>pallets disponibles</strong> de hoy: código,
              producto, bodega, bultos y kilos que se pueden mover.
            </p>
            <a href="/almacenes/traslados/importar/plantilla" className="btn btn-secundario" data-accion="descargar-plantilla-traslados" download>
              <Icono nombre="descargar" tamano={15} /> Descargar plantilla
            </a>
          </div>
        </Panel>
        <Panel titulo="2 · Suba el archivo lleno">
          <div style={{ padding: '1rem' }}>
            <SubirArchivo
              accion={subirImportacionTraslados}
              rutaRevision="/almacenes/traslados/importar"
              pista="Solo se lee el archivo y se revisa cada fila: no se mueve nada. El stock cambia de bodega cuando Gerencia u Operaciones pulsa «Validar y registrar» (Almacén la deja «Lista para validar»)."
            />
          </div>
        </Panel>
      </div>

      <Panel titulo={`Importaciones anteriores · ${num((importaciones ?? []).length)}`}>
        {(importaciones ?? []).length === 0 ? (
          <Vacio titulo="Todavía no hay importaciones" mensaje="Cuando suba la primera plantilla aparecerá aquí." />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos">
              <thead>
                <tr><th>Subida</th><th>Archivo</th><th>Subió</th><th>Estado</th><th>Resultado</th><th className="num">Filas</th>
                  <th className="num">Registradas</th><th className="num">Traslados registrados</th><th></th></tr>
              </thead>
              <tbody>
                {(importaciones ?? []).map((i) => {
                  const id = Number(i.id);
                  const mias = filas.filter((f) => Number(f.importacion_id) === id);
                  const res = resultadoCarga(mias.map((f) => f.estado));
                  return (
                    <tr key={id}>
                      <td>{fechaHora(i.creado_en as string)}</td>
                      <td>{String(i.archivo)}</td>
                      <td>{nombre(i.autor)}</td>
                      <td><Etiqueta texto={i.estado === 'validada' ? 'Validada' : i.estado === 'lista' ? 'Lista para validar' : 'En revisión'}
                                    tono={i.estado === 'validada' ? 'ok' : i.estado === 'lista' ? 'atencion' : 'neutro'} /></td>
                      <td data-resultado={res.texto}><Etiqueta texto={res.texto} tono={res.tono} /></td>
                      <td className="num">{num(mias.length)}</td>
                      <td className="num">{num(mias.filter((f) => f.estado === 'registrada').length)}</td>
                      <td className="num">{num(new Set(mias.map((f) => f.traslado_id).filter(Boolean)).size)}</td>
                      <td><Link href={`/almacenes/traslados/importar/${id}`} className="accion-btn" title="Ver la importación"><Icono nombre="ver" tamano={15} /></Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
