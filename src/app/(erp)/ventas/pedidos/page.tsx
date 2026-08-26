/**
 * ============================================================================
 *  PEDIDOS · la entidad central del sistema
 * ============================================================================
 *  Un "pedido" es lo que en Santa Mónica se llama PROFORMA: el compromiso de
 *  entregar cierta cantidad de producto a un cliente.
 *
 *  La especificación del cliente pedía 15 vistas distintas (pedidos de hoy,
 *  abiertos, bloqueados, atrasados, urgentes…). En lugar de 15 pantallas casi
 *  iguales, aquí hay UNA pantalla con vistas guardadas: cada pestaña aplica un
 *  filtro sobre la misma tabla. Menos código, mismo resultado, y el usuario
 *  puede además combinarlas con los filtros de abajo.
 *
 *  El semáforo de cinco colores lo calcula la base de datos comparando lo
 *  pedido contra lo realmente reservado y despachado.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel, Vacio, Etiqueta, Semaforo, Barra } from '@/components/ui/Pagina';
import { Filtros, Paginacion } from '@/components/ui/Filtros';
import { tm, num, fecha, dinero, etiquetaEstado } from '@/lib/formato';
import { veCostos, type Rol } from '@/lib/navegacion';

export const metadata: Metadata = { title: 'Pedidos' };
export const dynamic = 'force-dynamic';

const POR_PAGINA = 30;

/**
 * Las vistas guardadas que pedía la especificación.
 * Cada una es un filtro con nombre sobre la misma consulta.
 */
const VISTAS = [
  { clave: '',             titulo: 'Todos' },
  { clave: 'hoy',          titulo: 'De hoy' },
  { clave: 'abiertos',     titulo: 'Abiertos' },
  { clave: 'por_aprobar',  titulo: 'Por aprobar' },
  { clave: 'completos',    titulo: 'Completos' },
  { clave: 'incompletos',  titulo: 'Incompletos' },
  { clave: 'riesgo',       titulo: 'En riesgo' },
  { clave: 'atrasados',    titulo: 'Atrasados' },
  { clave: 'bloqueados',   titulo: 'Bloqueados' },
  { clave: 'urgentes',     titulo: 'Urgentes' },
  { clave: 'despachados',  titulo: 'Despachados' },
  { clave: 'cancelados',   titulo: 'Cancelados' },
];

export default async function PaginaPedidos(props: PageProps<'/ventas/pedidos'>) {
  const q = await props.searchParams;
  const supabase = await crearClienteServidor();
  const usuario = await obtenerUsuarioActual();
  const puedeVerCostos = veCostos((usuario?.rol ?? 'consulta') as Rol);

  const pagina = Math.max(1, Number(q.pagina ?? 1));
  const vista = (q.vista as string) ?? '';
  const buscar = (q.buscar as string) ?? '';
  const prioridad = (q.prioridad as string) ?? '';

  let consulta = supabase.from('v_pedidos_tablero').select('*', { count: 'exact' });

  /* ---- Vistas guardadas ---- */
  const hoy = new Date().toISOString().slice(0, 10);
  switch (vista) {
    case 'hoy':         consulta = consulta.eq('fecha_solicitada', hoy); break;
    case 'abiertos':    consulta = consulta.eq('ciclo', 'confirmado'); break;
    case 'por_aprobar': consulta = consulta.eq('ciclo', 'pendiente_validacion'); break;
    case 'completos':   consulta = consulta.eq('semaforo', 'completo'); break;
    case 'incompletos': consulta = consulta.eq('semaforo', 'parcial'); break;
    case 'riesgo':      consulta = consulta.eq('semaforo', 'riesgo'); break;
    case 'atrasados':   consulta = consulta.eq('atrasado', true); break;
    case 'bloqueados':  consulta = consulta.eq('semaforo', 'bloqueado'); break;
    case 'urgentes':    consulta = consulta.eq('prioridad', 'urgente'); break;
    case 'despachados': consulta = consulta.in('ciclo', ['despachado', 'cerrado']); break;
    case 'cancelados':  consulta = consulta.eq('ciclo', 'cancelado'); break;
  }

  if (buscar) {
    consulta = consulta.or(`numero_proforma.ilike.%${buscar}%,cliente.ilike.%${buscar}%`);
  }
  if (prioridad) consulta = consulta.eq('prioridad', prioridad);

  const { data: filas, count } = await consulta
    .order('fecha_solicitada', { ascending: false })
    .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);

  /** Conserva los filtros al cambiar de vista. */
  function urlVista(clave: string) {
    const p = new URLSearchParams();
    if (clave) p.set('vista', clave);
    if (buscar) p.set('buscar', buscar);
    if (prioridad) p.set('prioridad', prioridad);
    const s = p.toString();
    return `/ventas/pedidos${s ? '?' + s : ''}`;
  }

  return (
    <>
      <CabeceraPagina
        titulo="Pedidos"
        descripcion="Las proformas y su avance real. El color de cada fila resume si el pedido está cubierto, en riesgo o bloqueado."
      />

      {/* --- Vistas guardadas --- */}
      <nav className="pestanas no-imprimir" aria-label="Vistas de pedidos">
        {VISTAS.map((v) => (
          <Link
            key={v.clave || 'todos'}
            href={urlVista(v.clave)}
            className="pestana"
            data-activa={vista === v.clave ? 'si' : 'no'}
          >
            {v.titulo}
          </Link>
        ))}
      </nav>

      <Panel titulo={`${num(count ?? 0)} pedidos`}>
        <Filtros
          campos={[
            { tipo: 'texto', clave: 'buscar', etiqueta: 'Proforma o cliente', ancho: '13rem' },
            {
              tipo: 'select', clave: 'prioridad', etiqueta: 'Prioridad',
              opciones: [
                { valor: 'urgente', texto: 'Urgente' },
                { valor: 'alta', texto: 'Alta' },
                { valor: 'normal', texto: 'Normal' },
                { valor: 'baja', texto: 'Baja' },
              ],
            },
          ]}
        />

        {(filas ?? []).length === 0 ? (
          <Vacio titulo="Sin pedidos" mensaje="No hay pedidos que coincidan con esta vista y estos filtros." />
        ) : (
          <>
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos">
                <thead>
                  <tr>
                    <th>Estado</th>
                    <th>Proforma</th>
                    <th>Cliente</th>
                    <th>Destino</th>
                    <th className="num">Pedido</th>
                    <th className="num">Avance</th>
                    <th className="num">Falta</th>
                    {puedeVerCostos && <th className="num">Venta</th>}
                    <th className="num">Compromiso</th>
                    <th>Prioridad</th>
                  </tr>
                </thead>
                <tbody>
                  {(filas ?? []).map((p) => {
                    const avance = Number(p.avance_pct ?? 0);
                    return (
                      <tr key={p.id as number}>
                        <td><Semaforo estado={p.semaforo as never} /></td>
                        <td>
                          <Link href={`/ventas/pedidos/${p.id}`} className="enlace-dato">
                            {p.numero_proforma}
                          </Link>
                        </td>
                        <td title={p.cliente as string}>
                          {(p.cliente as string).length > 28
                            ? (p.cliente as string).slice(0, 27) + '…'
                            : p.cliente}
                          {p.cliente_bloqueado && (
                            <> <Etiqueta texto="Crédito bloqueado" tono="critico" /></>
                          )}
                        </td>
                        <td style={{ fontSize: '.78rem' }}>{(p.destino as string) ?? '—'}</td>
                        <td className="num">{num(p.tm_pedidas, 1)} TM</td>
                        <td className="num" style={{ minWidth: '5.5rem' }}>
                          <Barra
                            porcentaje={avance}
                            tono={avance >= 100 ? 'ok' : avance > 0 ? 'atencion' : 'critico'}
                          />
                          <span style={{ fontSize: '.68rem', color: 'var(--tinta-3)' }}>
                            {avance.toFixed(0)} %
                          </span>
                        </td>
                        <td className="num">
                          {Number(p.tm_faltantes) > 0 ? (
                            <strong style={{ color: 'var(--atencion)' }}>{num(p.tm_faltantes, 1)} TM</strong>
                          ) : '—'}
                        </td>
                        {puedeVerCostos && (
                          <td className="num">{dinero(p.venta, p.moneda as 'USD' | 'PEN', 0)}</td>
                        )}
                        <td className="num" style={{ color: p.atrasado ? 'var(--critico)' : undefined }}>
                          {fecha(p.fecha_comprometida as string)}
                        </td>
                        <td>
                          <Etiqueta
                            texto={etiquetaEstado(p.prioridad as string)}
                            tono={
                              p.prioridad === 'urgente' ? 'critico'
                              : p.prioridad === 'alta' ? 'atencion'
                              : 'neutro'
                            }
                          />
                        </td>
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
        <strong>Cómo leer el semáforo:</strong> verde = cubierto con stock reservado ·
        ámbar = parcialmente cubierto · naranja = pasó su fecha comprometida ·
        rojo = bloqueado por crédito · azul = ya despachado.
      </p>
    </>
  );
}
