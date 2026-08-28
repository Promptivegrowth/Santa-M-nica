/**
 * ============================================================================
 *  PACKING LISTS · la carga real de cada contenedor
 * ============================================================================
 *  El packing list dice exactamente qué lotes van dentro de un contenedor, con
 *  su guía, su precinto, su DAM y los tiempos reales de carga.
 *
 *  Al abrir uno se ve el PLANO DE ESTIBA: el mapa de qué lote va en qué fila.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor } from '@/lib/supabase/servidor';
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { AccionesLista } from '@/components/ui/Acciones';
import { num, fecha, etiquetaEstado } from '@/lib/formato';
import { Filtros } from '@/components/ui/Filtros';
import { hoyEnLima, desplazarDias } from '@/lib/fechas';

export const metadata: Metadata = { title: 'Packing y estiba' };
export const dynamic = 'force-dynamic';

export default async function PaginaPacking(props: PageProps<'/logistica/packing'>) {
  const q = await props.searchParams;
  const estado = (q.estado as string) ?? '';
  const buscar = ((q.buscar as string) ?? '').trim();
  const desde = (q.desde as string) ?? '';
  const hasta = (q.hasta as string) ?? '';
  const supabase = await crearClienteServidor();

  let consulta = supabase
    .from('packing_lists')
    .select('id, codigo, contenedor, guia_remision, dam, fecha_carga, hora_inicio, hora_fin, turno, estado, filas_contenedor, sacos_por_fila, embarques(id, numero, almacenes(nombre), destinos(puerto))')
    .order('fecha_carga', { ascending: false, nullsFirst: true })
    .limit(200);
  if (estado) consulta = consulta.eq('estado', estado);

  /*
   * El rango va sobre la FECHA DE CARGA, que es cuando se llenó el
   * contenedor. Un packing recién creado todavía no la tiene, y por eso el
   * orden pone los nulos primero: lo que se acaba de crear y aún no se cargó
   * es justamente lo que se está buscando.
   */
  if (desde) consulta = consulta.gte('fecha_carga', desde);
  if (hasta) consulta = consulta.lte('fecha_carga', hasta);

  if (buscar) {
    const limpio = buscar.replace(/[%,()]/g, ' ');
    consulta = consulta.or(
      `codigo.ilike.%${limpio}%,contenedor.ilike.%${limpio}%,` +
      `guia_remision.ilike.%${limpio}%,precinto.ilike.%${limpio}%`
    );
  }

  const [{ data: filas }, { data: prod }] = await Promise.all([
    consulta,
    supabase.from('v_productividad_despacho').select('horas_carga, horas_objetivo, tm'),
  ]);

  /** Conserva los filtros al cambiar de pestaña o pulsar un atajo. */
  function enlace(cambios: Record<string, string>) {
    const p = new URLSearchParams();
    if (estado) p.set('estado', estado);
    if (buscar) p.set('buscar', buscar);
    if (desde) p.set('desde', desde);
    if (hasta) p.set('hasta', hasta);
    for (const [k, v] of Object.entries(cambios)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    const t = p.toString();
    return `/logistica/packing${t ? '?' + t : ''}`;
  }

  const hoy = hoyEnLima();

  const horas = (prod ?? []).map((p) => Number(p.horas_carga ?? 0)).filter((h) => h > 0);
  const promedio = horas.length ? horas.reduce((a, b) => a + b, 0) / horas.length : 0;
  const objetivo = Number(prod?.[0]?.horas_objetivo ?? 2);
  const sobreObjetivo = horas.filter((h) => h > objetivo).length;

  return (
    <>
      <CabeceraPagina
        titulo="Packing y plano de estiba"
        descripcion="La carga real de cada contenedor y el mapa de cómo se acomodó dentro. Abra cualquiera para ver su plano."
      />

      <RejillaKpi>
        <Kpi etiqueta="Contenedores cargados" valor={num((filas ?? []).length)} />
        <Kpi etiqueta="Tiempo promedio de carga" valor={num(promedio, 1)} sufijo="h"
             tono={promedio > objetivo ? 'atencion' : 'ok'} nota={`Objetivo: ${num(objetivo, 1)} h`} />
        <Kpi etiqueta="Cargas sobre el objetivo" valor={num(sobreObjetivo)}
             tono={sobreObjetivo > 0 ? 'atencion' : 'ok'} nota="Oportunidad de mejora" />
      </RejillaKpi>

      <Panel titulo={`${(filas ?? []).length} packing lists`}>
        <nav className="pestanas no-imprimir" style={{ padding: '.7rem 1rem 0', margin: 0 }}>
          <Link href={enlace({ estado: '' })} className="pestana" data-activa={!estado ? 'si' : 'no'}>Todos</Link>
          {['abierto', 'en_carga', 'cerrado'].map((e) => (
            <Link key={e} href={enlace({ estado: e })} className="pestana" data-activa={estado === e ? 'si' : 'no'}>
              {etiquetaEstado(e)}
            </Link>
          ))}
        </nav>

        <Filtros
          campos={[
            { tipo: 'texto', clave: 'buscar', etiqueta: 'Packing, contenedor o guía', ancho: '16rem' },
            { tipo: 'fecha', clave: 'desde', etiqueta: 'Cargado desde' },
            { tipo: 'fecha', clave: 'hasta', etiqueta: 'Cargado hasta' },
          ]}
        />

        <div className="atajos-fecha">
          <span>Rápido:</span>
          <Link href={enlace({ estado: 'abierto', desde: '', hasta: '' })}>Sin cargar todavía</Link>
          <Link href={enlace({ desde: hoy, hasta: hoy })}>Cargados hoy</Link>
          <Link href={enlace({ desde: desplazarDias(hoy, -7), hasta: hoy })}>Últimos 7 días</Link>
          {(buscar || desde || hasta) && (
            <Link href={enlace({ buscar: '', desde: '', hasta: '' })} className="atajo-limpiar">
              Quitar filtros
            </Link>
          )}
        </div>

        {(filas ?? []).length === 0 ? (
          <Vacio titulo="Sin packing lists" mensaje="No hay contenedores con este estado." />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0, marginTop: '.7rem' }}>
            <table className="datos">
              <thead>
                <tr>
                  <th>Packing</th><th>Contenedor</th><th>Embarque</th><th>Almacén</th><th>Destino</th>
                  <th className="num">Carga</th><th>Turno</th><th className="num">Horas</th><th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {(filas ?? []).map((p) => {
                  const emb = Array.isArray(p.embarques) ? p.embarques[0] : p.embarques;
                  const alm = emb ? (Array.isArray(emb.almacenes) ? emb.almacenes[0] : emb.almacenes) : null;
                  const dst = emb ? (Array.isArray(emb.destinos) ? emb.destinos[0] : emb.destinos) : null;
                  const ini = p.hora_inicio as string | null;
                  const fin = p.hora_fin as string | null;
                  let hrs = '—';
                  if (ini && fin) {
                    const [h1, m1] = ini.split(':').map(Number);
                    const [h2, m2] = fin.split(':').map(Number);
                    const dif = (h2 * 60 + m2 - (h1 * 60 + m1)) / 60;
                    hrs = dif > 0 ? `${dif.toFixed(1)} h` : '—';
                  }
                  return (
                    <tr key={p.id as number}>
                      <td>
                        <Link href={`/logistica/packing/${p.id}`} className="enlace-dato">{p.codigo as string}</Link>
                      </td>
                      <td className="mono">{(p.contenedor as string) ?? '—'}</td>
                      <td className="mono">{emb?.numero ?? '—'}</td>
                      <td style={{ fontSize: '.78rem' }}>{alm?.nombre ?? '—'}</td>
                      <td style={{ fontSize: '.78rem' }}>{dst?.puerto ?? '—'}</td>
                      <td className="num">{fecha(p.fecha_carga as string)}</td>
                      <td>{p.turno === 'dia' ? 'Día' : 'Noche'}</td>
                      <td className="num">{hrs}</td>
                      <td>
                        <Etiqueta
                          texto={etiquetaEstado(String(p.estado))}
                          tono={p.estado === 'cerrado' ? 'ok' : p.estado === 'en_carga' ? 'atencion' : 'neutro'}
                        />
                      </td>
                      <td>
                        <AccionesLista
                          ver={`/logistica/packing/${p.id}`}
                          verTitulo={`Ver el packing ${p.codigo}`}
                          extras={
                            emb
                              ? [{
                                  href: `/logistica/embarques/${emb.id}`,
                                  icono: 'embarques',
                                  titulo: 'Ver el embarque',
                                }]
                              : []
                          }
                        />
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
