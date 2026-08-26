/**
 * ============================================================================
 *  DISPONIBILIDAD · la pantalla que resuelve el problema central del negocio
 * ============================================================================
 *  El problema, en palabras de Oliver Tello en la reunión:
 *
 *     "Tenemos producto que sí está disponible, pero que ya está asignado a un
 *      cliente que en realidad no debería, porque se asignó y no se despachó."
 *
 *  Consecuencia: Ventas le dice que no a clientes reales mientras hay producto
 *  parado, y cuando alguien libera la reserva "aparece producto de la nada".
 *
 *  Esta pantalla acaba con eso. Muestra, para cada producto y cada bodega, las
 *  cinco cantidades por separado:
 *
 *     FÍSICO       lo que hay en la cámara
 *   − BLOQUEADO    lo que Calidad no deja mover
 *   − RESERVADO    lo que ya tiene dueño
 *   − PREPARACIÓN  lo que ya está en un contenedor armándose
 *   = DISPONIBLE   lo único que se le puede prometer a un cliente nuevo
 * ============================================================================
 */
import type { Metadata } from 'next';
import { crearClienteServidor } from '@/lib/supabase/servidor';
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { Filtros, Paginacion } from '@/components/ui/Filtros';
import { GraficoComposicion } from '@/components/graficos/Graficos';
import { tm, num } from '@/lib/formato';

export const metadata: Metadata = { title: 'Disponibilidad' };
export const dynamic = 'force-dynamic';

const POR_PAGINA = 40;

export default async function PaginaDisponibilidad(props: PageProps<'/ventas/disponibilidad'>) {
  const q = await props.searchParams;
  const supabase = await crearClienteServidor();

  const pagina = Math.max(1, Number(q.pagina ?? 1));
  const buscar = (q.buscar as string) ?? '';
  const almacenId = (q.almacen as string) ?? '';
  const especie = (q.especie as string) ?? '';
  const soloDisponible = (q.disponible as string) === 'si';

  /* ---- Catálogos para los desplegables de filtro ---- */
  const [{ data: almacenes }, { data: especies }, { data: resumen }] = await Promise.all([
    supabase.from('almacenes').select('id, nombre').eq('activo', true).order('nombre'),
    supabase.from('especies').select('id, nombre').order('nombre'),
    supabase.from('v_resumen_inventario').select('*').single(),
  ]);

  /* ---- Consulta principal con filtros y paginación en el servidor ---- */
  let consulta = supabase
    .from('v_disponibilidad')
    .select('*', { count: 'exact' });

  if (buscar) {
    // Busca por código de SKU o por el nombre del corte
    consulta = consulta.or(`sku_codigo.ilike.%${buscar}%,corte.ilike.%${buscar}%,formato.ilike.%${buscar}%`);
  }
  if (almacenId) consulta = consulta.eq('almacen_id', Number(almacenId));
  if (especie) consulta = consulta.eq('especie', especie);
  if (soloDisponible) consulta = consulta.gt('disponible_kg', 0);

  const { data: filas, count } = await consulta
    .order('disponible_kg', { ascending: false })
    .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);

  const inv = resumen ?? { fisico_kg: 0, disponible_kg: 0, reservado_kg: 0, preparacion_kg: 0, bloqueado_kg: 0 };

  return (
    <>
      <CabeceraPagina
        titulo="Disponibilidad"
        descripcion="Cuánto se puede prometer de verdad. El disponible ya descuenta lo bloqueado por calidad, lo reservado para otros pedidos y lo que está en preparación."
      />

      <RejillaKpi>
        <Kpi etiqueta="Stock físico" valor={tm(inv.fisico_kg)} sufijo="TM" nota="Todo lo que hay en cámara" />
        <Kpi etiqueta="Bloqueado" valor={tm(inv.bloqueado_kg)} sufijo="TM" tono="critico" nota="Observado por Calidad" />
        <Kpi etiqueta="Reservado" valor={tm(inv.reservado_kg)} sufijo="TM" tono="atencion" nota="Apartado para pedidos" />
        <Kpi etiqueta="En preparación" valor={tm(inv.preparacion_kg)} sufijo="TM" tono="atencion" nota="Ya en un contenedor" />
        <Kpi etiqueta="Disponible" valor={tm(inv.disponible_kg)} sufijo="TM" tono="ok" nota="Lo que se puede vender hoy" />
      </RejillaKpi>

      <Panel titulo="Cómo se descompone el stock" className="mb-espacio">
        <GraficoComposicion
          partes={[
            { nombre: 'Disponible para vender', valor: Number(inv.disponible_kg) },
            { nombre: 'Reservado y en preparación', valor: Number(inv.reservado_kg) + Number(inv.preparacion_kg) },
            { nombre: 'Bloqueado por calidad', valor: Number(inv.bloqueado_kg) },
          ]}
          formato="kg_a_tm"
        />
      </Panel>

      <Panel titulo={`Disponibilidad por producto y bodega · ${num(count ?? 0)} combinaciones`}>
        <Filtros
          campos={[
            { tipo: 'texto', clave: 'buscar', etiqueta: 'Producto o corte', ancho: '12rem' },
            { tipo: 'select', clave: 'especie', etiqueta: 'Especie',
              opciones: (especies ?? []).map((e) => ({ valor: e.nombre as string, texto: e.nombre as string })) },
            { tipo: 'select', clave: 'almacen', etiqueta: 'Almacén',
              opciones: (almacenes ?? []).map((a) => ({ valor: String(a.id), texto: a.nombre as string })) },
            { tipo: 'select', clave: 'disponible', etiqueta: 'Mostrar',
              opciones: [{ valor: 'si', texto: 'Solo con disponible' }] },
          ]}
        />

        {(filas ?? []).length === 0 ? (
          <Vacio
            titulo="Sin resultados"
            mensaje="Pruebe quitando algún filtro o busque por el código del producto."
          />
        ) : (
          <>
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Producto</th>
                    <th>Presentación</th>
                    <th>Almacén</th>
                    <th className="num">Físico</th>
                    <th className="num">Bloqueado</th>
                    <th className="num">Reservado</th>
                    <th className="num">Preparación</th>
                    <th className="num">Disponible</th>
                    <th className="num">Lotes</th>
                  </tr>
                </thead>
                <tbody>
                  {(filas ?? []).map((f) => {
                    const disponible = Number(f.disponible_kg ?? 0);
                    const fisico = Number(f.fisico_kg ?? 0);
                    return (
                      <tr key={`${f.sku_presentacion_id}-${f.almacen_id}`}>
                        <td className="mono">{f.sku_codigo}</td>
                        <td>
                          <strong style={{ fontWeight: 600 }}>{f.especie} · {f.formato}</strong>
                          <br />
                          <span style={{ color: 'var(--tinta-3)', fontSize: '.74rem' }}>{f.corte}</span>
                        </td>
                        <td className="mono">{f.presentacion}</td>
                        <td>{f.almacen}</td>
                        <td className="num">{tm(fisico)}</td>
                        <td className="num" style={{ color: Number(f.bloqueado_kg) > 0 ? 'var(--critico)' : undefined }}>
                          {Number(f.bloqueado_kg) > 0 ? tm(f.bloqueado_kg) : '—'}
                        </td>
                        <td className="num">{Number(f.reservado_kg) > 0 ? tm(f.reservado_kg) : '—'}</td>
                        <td className="num">{Number(f.preparacion_kg) > 0 ? tm(f.preparacion_kg) : '—'}</td>
                        <td className="num">
                          <strong style={{ color: disponible > 0 ? 'var(--ok)' : 'var(--tinta-3)' }}>
                            {tm(disponible)}
                          </strong>
                          {disponible === 0 && fisico > 0 && (
                            <>
                              {' '}
                              <Etiqueta texto="Comprometido" tono="atencion" />
                            </>
                          )}
                        </td>
                        <td className="num">{f.lotes}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Paginacion pagina={pagina} porPagina={POR_PAGINA} total={count ?? 0} />
          </>
        )}
      </Panel>

      <p className="pie-explicativo">
        Las cantidades se muestran en toneladas. <strong>Disponible</strong> = Físico − Bloqueado −
        Reservado − En preparación. Si un producto tiene stock físico pero cero disponible, es que
        está completamente comprometido: revise las reservas antes de prometerlo.
      </p>
    </>
  );
}
