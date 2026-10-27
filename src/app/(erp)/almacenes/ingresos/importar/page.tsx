/**
 * ============================================================================
 *  IMPORTAR INGRESOS DESDE EXCEL
 * ============================================================================
 *  Pedido de Oliver Tello: que su equipo no tenga que volver a teclear,
 *  formulario por formulario, lo que ya tiene en Excel. Tres pasos:
 *  descargar la plantilla, pegar los datos, subirla. Después, la revisión
 *  fila por fila (en su propia pantalla) y la validación de Gerencia u
 *  Operaciones.
 *
 *  Abajo, las importaciones anteriores: cada una se puede volver a abrir para
 *  ver qué pasó con cada fila.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { Icono } from '@/components/estructura/Icono';
import { fechaHora, num } from '@/lib/formato';
import { traerTodo } from '@/lib/traerTodo';
import { PUEDEN_INGRESAR, PUEDEN_VALIDAR_IMPORTACION } from '../tipos';
import { TEXTO_ESTADO_IMPORTACION } from './columnas';
import { SubirArchivo } from './SubirArchivo';
import { subirImportacionIngresos } from './acciones';

export const metadata: Metadata = { title: 'Importar ingresos' };
export const dynamic = 'force-dynamic';

const TONO_ESTADO: Record<string, 'neutro' | 'atencion' | 'ok'> = { revision: 'neutro', lista: 'atencion', validada: 'ok' };

export default async function PaginaImportarIngresos() {
  const usuario = await obtenerUsuarioActual();
  if (!(PUEDEN_INGRESAR as readonly string[]).includes(usuario?.rol ?? '')) redirect('/almacenes/ingresos');
  const valida = (PUEDEN_VALIDAR_IMPORTACION as readonly string[]).includes(usuario?.rol ?? '');

  const supabase = await crearClienteServidor();
  const { data: importaciones } = await supabase
    .from('importaciones_excel')
    .select('id, archivo, estado, creado_en, procesado_en, autor:usuarios!importaciones_excel_creado_por_fkey(nombre), validador:usuarios!importaciones_excel_procesado_por_fkey(nombre)')
    .eq('tipo', 'ingresos')
    .order('creado_en', { ascending: false })
    .limit(40);

  const ids = (importaciones ?? []).map((i) => Number(i.id));
  const filas = ids.length
    ? await traerTodo<{ importacion_id: number; estado: string }>((d, h) =>
        supabase.from('importaciones_excel_filas').select('importacion_id, estado').in('importacion_id', ids).order('id').range(d, h))
    : [];
  const cuenta = (id: number, ...estados: string[]) =>
    filas.filter((f) => Number(f.importacion_id) === id && estados.includes(f.estado)).length;
  const nombre = (x: unknown) => String((Array.isArray(x) ? x[0] : x as { nombre?: string } | null)?.nombre ?? '—');

  return (
    <>
      <CabeceraPagina
        titulo="Importar ingresos desde Excel"
        descripcion="Descargue la plantilla, pegue sus pallets y súbala. El sistema revisa cada fila con las mismas reglas del formulario y le dice qué está bien, qué no y por qué."
        volver={{ href: '/almacenes/ingresos', texto: 'Volver a ingresos' }}
      >
        <Link href="/almacenes/ingresos/programados" className="btn btn-secundario">
          <Icono nombre="reloj" tamano={15} /> Ingresos programados
        </Link>
      </CabeceraPagina>

      <div className="rejilla-2 mb-espacio">
        <Panel titulo="1 · Descargue la plantilla">
          <div style={{ padding: '1rem' }}>
            <p style={{ marginTop: 0 }}>
              Trae los encabezados correctos, una fila de ejemplo, listas desplegables (producto, origen, bodega, cámara,
              turno…) y las listas válidas de hoy: productos con su código, qué bodegas reciben producción y cuáles compras,
              y las cámaras de cada una.
            </p>
            <a href="/almacenes/ingresos/importar/plantilla" className="btn btn-secundario" data-accion="descargar-plantilla" download>
              <Icono nombre="descargar" tamano={15} /> Descargar plantilla
            </a>
          </div>
        </Panel>
        <Panel titulo="2 · Suba el archivo lleno">
          <div style={{ padding: '1rem' }}>
            <SubirArchivo accion={subirImportacionIngresos} rutaRevision="/almacenes/ingresos/importar" />
            <p className="form-pista" style={{ marginBottom: 0 }}>
              {valida
                ? 'Después de revisar, usted mismo puede pulsar «Validar y registrar»: su rol valida ingresos.'
                : 'Después de revisar, déjela «Lista para validar»: el stock entra cuando Gerencia u Operaciones la valida.'}
            </p>
          </div>
        </Panel>
      </div>

      <Panel titulo={`Importaciones anteriores · ${num((importaciones ?? []).length)}`}>
        {(importaciones ?? []).length === 0 ? (
          <Vacio titulo="Todavía no hay importaciones" mensaje="Cuando suba la primera plantilla aparecerá aquí, con lo que pasó en cada fila." />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos" data-tabla="importaciones">
              <thead>
                <tr>
                  <th>Subida</th><th>Archivo</th><th>Subió</th><th>Estado</th>
                  <th className="num">Filas</th><th className="num">Listas</th><th className="num">Con error</th>
                  <th className="num">Registradas</th><th className="num">Programadas</th><th>Validó</th><th></th>
                </tr>
              </thead>
              <tbody>
                {(importaciones ?? []).map((i) => {
                  const id = Number(i.id);
                  const total = filas.filter((f) => Number(f.importacion_id) === id).length;
                  return (
                    <tr key={id} data-importacion={id}>
                      <td>{fechaHora(i.creado_en as string)}</td>
                      <td>{String(i.archivo)}</td>
                      <td>{nombre(i.autor)}</td>
                      <td><Etiqueta texto={TEXTO_ESTADO_IMPORTACION[String(i.estado)] ?? String(i.estado)} tono={TONO_ESTADO[String(i.estado)] ?? 'neutro'} /></td>
                      <td className="num">{num(total)}</td>
                      <td className="num">{num(cuenta(id, 'valida'))}</td>
                      <td className="num">{num(cuenta(id, 'con_error', 'fallida'))}</td>
                      <td className="num">{num(cuenta(id, 'registrada'))}</td>
                      <td className="num">{num(cuenta(id, 'programada'))}</td>
                      <td>{i.procesado_en ? `${nombre(i.validador)} · ${fechaHora(i.procesado_en as string)}` : '—'}</td>
                      <td>
                        <Link href={`/almacenes/ingresos/importar/${id}`} className="accion-btn" title="Ver la importación">
                          <Icono nombre="ver" tamano={15} />
                        </Link>
                      </td>
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
