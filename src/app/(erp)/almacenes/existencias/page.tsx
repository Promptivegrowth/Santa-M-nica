/**
 * ============================================================================
 *  EXISTENCIAS · el detalle lote por lote
 * ============================================================================
 *  Mientras "Disponibilidad" resume por producto, esta pantalla baja al nivel
 *  del LOTE: qué pallet concreto está en qué cámara, cuánto queda de él, cuánto
 *  está apartado y cuántos meses lleva almacenado.
 *
 *  Es la vista que usa el jefe de almacén cuando tiene que ir físicamente a
 *  buscar el producto.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { Filtros, Paginacion } from '@/components/ui/Filtros';
import { AccionesLista } from '@/components/ui/Acciones';
import { num, fecha, tm } from '@/lib/formato';
import { veCostos, type Rol } from '@/lib/navegacion';

export const metadata: Metadata = { title: 'Existencias' };
export const dynamic = 'force-dynamic';

const POR_PAGINA = 50;

export default async function PaginaExistencias(props: PageProps<'/almacenes/existencias'>) {
  const q = await props.searchParams;
  const supabase = await crearClienteServidor();
  const usuario = await obtenerUsuarioActual();
  const puedeVerCostos = veCostos((usuario?.rol ?? 'consulta') as Rol);

  const pagina = Math.max(1, Number(q.pagina ?? 1));
  const buscar = (q.buscar as string) ?? '';
  const almacenId = (q.almacen as string) ?? '';
  const rango = (q.rango as string) ?? '';

  const { data: almacenes } = await supabase
    .from('almacenes').select('id, nombre').eq('activo', true).order('nombre');

  // v_anticuamiento ya reúne lote + producto + almacén + antigüedad en una vista
  let consulta = supabase.from('v_anticuamiento').select('*', { count: 'exact' }).gt('fisico_kg', 0);

  if (buscar) {
    consulta = consulta.or(
      `codigo_pallet.ilike.%${buscar}%,sku_codigo.ilike.%${buscar}%,corte.ilike.%${buscar}%`
    );
  }
  if (almacenId) consulta = consulta.eq('almacen_id', Number(almacenId));
  if (rango) consulta = consulta.eq('rango', rango);

  const { data: filas, count } = await consulta
    .order('fisico_kg', { ascending: false })
    .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);

  return (
    <>
      <CabeceraPagina
        titulo="Existencias por lote"
        descripcion="Cada fila es un lote concreto en una bodega concreta. Es la vista que se usa para ir a buscar el producto físicamente."
      />

      <Panel titulo={`${num(count ?? 0)} posiciones con saldo`}>
        <Filtros
          campos={[
            { tipo: 'texto', clave: 'buscar', etiqueta: 'Pallet, SKU o corte', ancho: '13rem' },
            {
              tipo: 'select', clave: 'almacen', etiqueta: 'Almacén',
              opciones: (almacenes ?? []).map((a) => ({ valor: String(a.id), texto: a.nombre as string })),
            },
            {
              tipo: 'select', clave: 'rango', etiqueta: 'Antigüedad',
              opciones: [
                { valor: '<12', texto: 'Menos de 12 meses' },
                { valor: '12-18', texto: '12 a 18 meses' },
                { valor: '18-24', texto: '18 a 24 meses' },
                { valor: '>24', texto: 'Más de 24 meses' },
              ],
            },
          ]}
        />

        {(filas ?? []).length === 0 ? (
          <Vacio titulo="Sin existencias" mensaje="No hay lotes que coincidan con los filtros aplicados." />
        ) : (
          <>
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos">
                <thead>
                  <tr>
                    <th>Pallet</th>
                    <th>Producto</th>
                    <th>Almacén</th>
                    <th className="num">Físico</th>
                    <th className="num">Disponible</th>
                    <th className="num">Producción</th>
                    <th className="num">Meses</th>
                    {puedeVerCostos && <th className="num">Valor</th>}
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {(filas ?? []).map((f) => (
                    <tr key={`${f.lote_id}-${f.almacen_id}`}>
                      <td>
                        <Link href={`/almacenes/lotes/${f.lote_id}`} className="enlace-ficha">
                          {f.codigo_pallet as string}
                        </Link>
                      </td>
                      <td>
                        <span className="mono" style={{ color: 'var(--tinta-3)' }}>{f.sku_codigo}</span>{' '}
                        {f.especie} · {f.formato}
                        <br />
                        <span style={{ color: 'var(--tinta-3)', fontSize: '.74rem' }}>{f.corte}</span>
                      </td>
                      <td>{f.almacen}</td>
                      <td className="num">{tm(f.fisico_kg)}</td>
                      <td className="num">
                        <strong style={{ color: Number(f.disponible_kg) > 0 ? 'var(--ok)' : 'var(--tinta-3)' }}>
                          {tm(f.disponible_kg)}
                        </strong>
                      </td>
                      <td className="num">{fecha(f.fecha_produccion as string)}</td>
                      <td className="num">{num(f.meses_almacenado, 1)}</td>
                      {puedeVerCostos && <td className="num">{num(f.valor, 0)}</td>}
                      <td>
                        {f.vencido ? (
                          <Etiqueta texto="Vida útil vencida" tono="critico" />
                        ) : f.en_alerta ? (
                          <Etiqueta texto="Antigüedad alta" tono="atencion" />
                        ) : (
                          <Etiqueta texto="Normal" tono="ok" />
                        )}
                      </td>
                      <td>
                        <AccionesLista
                          ver={`/almacenes/lotes/${f.lote_id}`}
                          verTitulo={`Ver el lote ${f.codigo_pallet}`}
                          extras={[
                            {
                              href: `/trazabilidad?q=${encodeURIComponent(String(f.codigo_pallet))}`,
                              icono: 'trazabilidad',
                              titulo: 'Buscarlo en trazabilidad',
                            },
                          ]}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Paginacion pagina={pagina} porPagina={POR_PAGINA} total={count ?? 0} />
          </>
        )}
      </Panel>

      <p className="pie-explicativo">
        Al hacer clic en el código de pallet se abre la <strong>trazabilidad completa</strong> de ese
        lote: de dónde vino, por qué bodegas pasó y a qué clientes se despachó.
      </p>
    </>
  );
}
