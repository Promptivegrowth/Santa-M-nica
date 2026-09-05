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
import { num, fecha, dinero, etiquetaEstado } from '@/lib/formato';
import { veCostos, puedeVender, type Rol } from '@/lib/navegacion';
import { AccionesLista } from '@/components/ui/Acciones';
import { Icono } from '@/components/estructura/Icono';

export const metadata: Metadata = { title: 'Pedidos' };
export const dynamic = 'force-dynamic';

const POR_PAGINA = 30;

/**
 * Suma o resta días a una fecha «AAAA-MM-DD», devolviendo otra igual.
 *
 * Se hace la aritmética en UTC y a mediodía: sumar 86 400 000 milisegundos a
 * una fecha local puede caer en el día anterior o el siguiente cuando hay
 * cambio de horario, y aquí lo que se quiere es «el mismo día, siete casillas
 * más atrás en el calendario».
 *
 * Es una función pura y por eso vive fuera del componente: no mira el reloj,
 * solo transforma la fecha que se le da.
 */
function desplazar(fechaISO: string, dias: number): string {
  const base = new Date(`${fechaISO}T12:00:00Z`);
  return new Date(base.getTime() + dias * 86400000).toISOString().slice(0, 10);
}

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
  const rol = (usuario?.rol ?? 'consulta') as Rol;
  const puedeVerCostos = veCostos(rol);
  const puedeCrear = puedeVender(rol);

  const pagina = Math.max(1, Number(q.pagina ?? 1));
  const vista = (q.vista as string) ?? '';
  const buscar = (q.buscar as string) ?? '';
  const prioridad = (q.prioridad as string) ?? '';
  const desde = (q.desde as string) ?? '';
  const hasta = (q.hasta as string) ?? '';
  const campoFecha = (q.campo_fecha as string) || 'fecha_solicitada';

  let consulta = supabase.from('v_pedidos_tablero').select('*', { count: 'exact' });


  /* ---- Vistas guardadas ---- */
  /*
   * La fecha de hoy en el huso de LIMA, no en UTC.
   *
   * Con `toISOString()` la pestaña «De hoy» empezaba a mostrar los pedidos de
   * mañana a partir de las siete de la tarde, que es cuando en Lima ya es el
   * día siguiente en UTC. Justo la hora en que se revisa el cierre del día.
   */
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
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

  /*
   * El rango de fechas se aplica sobre la columna que se elija. No es lo
   * mismo preguntar «qué pedí esta semana» que «qué me toca entregar esta
   * semana»: la primera mira la fecha de solicitud y la segunda la
   * comprometida. Comercial usa una y despacho la otra.
   */
  const COLUMNAS_FECHA = ['fecha_solicitada', 'fecha_comprometida'];
  const columna = COLUMNAS_FECHA.includes(campoFecha) ? campoFecha : 'fecha_solicitada';
  if (desde) consulta = consulta.gte(columna, desde);
  if (hasta) consulta = consulta.lte(columna, hasta);

  const [{ data: filas, count }, { data: conCotizacion }] = await Promise.all([
    consulta
      .order('fecha_solicitada', { ascending: false })
      .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1),
    // Qué pedidos nacieron de una oferta previa. La columna cotizacion_id es
    // lo único que distingue un camino del otro.
    supabase.from('pedidos').select('id').not('cotizacion_id', 'is', null),
  ]);

  const origenes = new Set((conCotizacion ?? []).map((p) => Number(p.id)));

  /**
   * Arma la dirección conservando lo que ya está puesto.
   *
   * Cambiar de vista o pulsar un atajo de fecha no debería perder la búsqueda
   * ni la prioridad: quien filtró por «urgente» y salta a «De hoy» quiere los
   * urgentes de hoy, no todos los de hoy.
   */
  function enlaceVista(clave: string, cambios: Record<string, string> = {}) {
    const p = new URLSearchParams();
    if (clave) p.set('vista', clave);
    if (buscar) p.set('buscar', buscar);
    if (prioridad) p.set('prioridad', prioridad);
    if (campoFecha && campoFecha !== 'fecha_solicitada') p.set('campo_fecha', campoFecha);
    if (desde) p.set('desde', desde);
    if (hasta) p.set('hasta', hasta);

    // Lo que llega en `cambios` manda; una cadena vacía quita el parámetro.
    for (const [k, v] of Object.entries(cambios)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }

    const s = p.toString();
    return `/ventas/pedidos${s ? '?' + s : ''}`;
  }

  /** El mismo nombre de antes, para no tocar las pestañas. */
  const urlVista = (clave: string) => enlaceVista(clave);

  /** Fechas relativas a hoy, calculadas sobre la fecha ya resuelta. */
  const haceDias = (n: number) => desplazar(hoy, -n);
  const enDias = (n: number) => desplazar(hoy, n);

  return (
    <>
      <CabeceraPagina
        titulo="Pedidos"
        descripcion="El COMPROMISO en firme. Cada pedido tiene su número de proforma (SM26-…), que es como Santa Mónica lo identifica en toda la operación. El color resume si está cubierto, en riesgo o bloqueado."
      >
        {puedeCrear && (
          <Link href="/ventas/pedidos/nuevo" className="btn btn-primario">
            <Icono nombre="mas" tamano={15} />
            Nuevo pedido
          </Link>
        )}
      </CabeceraPagina>

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
            {
              tipo: 'select', clave: 'campo_fecha', etiqueta: 'Filtrar por',
              opciones: [
                { valor: 'fecha_solicitada', texto: 'Fecha de solicitud' },
                { valor: 'fecha_comprometida', texto: 'Fecha comprometida' },
              ],
            },
            { tipo: 'fecha', clave: 'desde', etiqueta: 'Desde' },
            { tipo: 'fecha', clave: 'hasta', etiqueta: 'Hasta' },
          ]}
        />

        {/* Rangos de uso diario, para no tener que escribir dos fechas */}
        <div className="atajos-fecha">
          <span>Rápido:</span>
          <Link href={enlaceVista(vista, { desde: hoy, hasta: hoy })}>Hoy</Link>
          <Link href={enlaceVista(vista, { desde: haceDias(7), hasta: hoy })}>Últimos 7 días</Link>
          <Link href={enlaceVista(vista, { desde: haceDias(30), hasta: hoy })}>Últimos 30 días</Link>
          <Link href={enlaceVista(vista, { desde: hoy.slice(0, 8) + '01', hasta: hoy })}>Este mes</Link>
          <Link href={enlaceVista(vista, {
            campo_fecha: 'fecha_comprometida', desde: hoy, hasta: enDias(7),
          })}>Entregas de la semana</Link>
          {(desde || hasta) && (
            <Link href={enlaceVista(vista, { desde: '', hasta: '' })} className="atajo-limpiar">
              Quitar fechas
            </Link>
          )}
        </div>

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
                    <th>Origen</th>
                    <th>Cliente</th>
                    <th>Destino</th>
                    <th className="num">Pedido</th>
                    <th className="num">Avance</th>
                    <th className="num">Falta</th>
                    {puedeVerCostos && <th className="num">Venta US$</th>}
                    <th className="num">Compromiso</th>
                    <th>Prioridad</th>
                    <th>Acciones</th>
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
                        <td>
                          {/* De dónde vino: de una oferta negociada o directo del cliente */}
                          <Etiqueta
                            texto={origenes.has(p.id as number) ? 'Cotizado' : 'Directo'}
                            tono={origenes.has(p.id as number) ? 'info' : 'neutro'}
                          />
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
                        {/* En dólares, porque esta columna se compara y se suma
                            entre pedidos de distinta moneda. El importe en la
                            moneda de la proforma está en su ficha. */}
                        {puedeVerCostos && (
                          <td className="num">{dinero(p.venta_usd, 'USD', 0)}</td>
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
                        <td>
                          <AccionesLista
                            ver={`/ventas/pedidos/${p.id}`}
                            verTitulo={`Ver el pedido ${p.numero_proforma}`}
                            extras={
                              p.cliente_id
                                ? [{
                                    href: `/ventas/clientes/${p.cliente_id}`,
                                    icono: 'clientes',
                                    titulo: 'Ver la ficha del cliente',
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
