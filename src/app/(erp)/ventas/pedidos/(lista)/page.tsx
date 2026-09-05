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
import {
  CabeceraPagina, Panel, Vacio, Etiqueta, Semaforo, Barra, RejillaKpi, Kpi,
} from '@/components/ui/Pagina';
import { Filtros, Paginacion } from '@/components/ui/Filtros';
import { num, fecha, dinero, etiquetaEstado } from '@/lib/formato';
import { veCostos, puedeVender, type Rol } from '@/lib/navegacion';
import { AccionesLista } from '@/components/ui/Acciones';
import { Icono } from '@/components/estructura/Icono';
import { uno } from '@/lib/relaciones';

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
  const orden = (q.orden as string) ?? '';
  const porCliente = q.agrupar === 'cliente';

  /*
   * La fecha de hoy en el huso de LIMA, no en UTC.
   *
   * Con `toISOString()` la pestaña «De hoy» empezaba a mostrar los pedidos de
   * mañana a partir de las siete de la tarde, que es cuando en Lima ya es el
   * día siguiente en UTC. Justo la hora en que se revisa el cierre del día.
   */
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });

  /*
   * El rango de fechas se aplica sobre la columna que se elija. No es lo
   * mismo preguntar «qué pedí esta semana» que «qué me toca entregar esta
   * semana»: la primera mira la fecha de solicitud y la segunda la
   * comprometida. Comercial usa una y despacho la otra.
   */
  const COLUMNAS_FECHA = ['fecha_solicitada', 'fecha_comprometida', 'fecha_salida_programada'];
  const columna = COLUMNAS_FECHA.includes(campoFecha) ? campoFecha : 'fecha_solicitada';

  /*
   * TODOS LOS FILTROS, EN UN SOLO SITIO.
   *
   * Los usan dos consultas: la de la página que se ve y la de los totales, que
   * recorre el conjunto entero. Si cada una los aplicara por su cuenta,
   * bastaría con olvidarse de uno para que las tarjetas de arriba dijeran algo
   * distinto de la tabla de abajo — y nadie lo notaría.
   */
  type Consulta = ReturnType<ReturnType<typeof supabase.from>['select']>;

  function aplicarFiltros<T>(consulta: T): T {
    let c = consulta as Consulta;

    switch (vista) {
      case 'hoy':         c = c.eq('fecha_solicitada', hoy); break;
      case 'abiertos':    c = c.eq('ciclo', 'confirmado'); break;
      case 'por_aprobar': c = c.eq('ciclo', 'pendiente_validacion'); break;
      case 'completos':   c = c.eq('semaforo', 'completo'); break;
      case 'incompletos': c = c.eq('semaforo', 'parcial'); break;
      case 'riesgo':      c = c.eq('semaforo', 'riesgo'); break;
      case 'atrasados':   c = c.eq('atrasado', true); break;
      case 'bloqueados':  c = c.eq('semaforo', 'bloqueado'); break;
      case 'urgentes':    c = c.eq('prioridad', 'urgente'); break;
      case 'despachados': c = c.in('ciclo', ['despachado', 'cerrado']); break;
      case 'cancelados':  c = c.eq('ciclo', 'cancelado'); break;
    }

    if (buscar) c = c.or(`numero_proforma.ilike.%${buscar}%,cliente.ilike.%${buscar}%`);
    if (prioridad) c = c.eq('prioridad', prioridad);
    if (desde) c = c.gte(columna, desde);
    if (hasta) c = c.lte(columna, hasta);

    return c as unknown as T;
  }

  let consulta = aplicarFiltros(
    supabase.from('v_pedidos_tablero').select('*', { count: 'exact' })
  );

  /*
   * EL ORDEN
   * Se pidió que los urgentes salgan primero. Los estados de prioridad son un
   * tipo enumerado, y PostgreSQL los ordena por el orden en que se declararon
   * —baja, normal, alta, urgente—, así que descendente deja los urgentes
   * arriba sin necesidad de inventar una tabla de pesos.
   *
   * Dentro de la misma prioridad manda la fecha comprometida: entre dos
   * urgentes, primero el que se entrega antes.
   */
  switch (orden) {
    case 'prioridad':
      consulta = consulta
        .order('prioridad', { ascending: false })
        .order('fecha_comprometida', { ascending: true, nullsFirst: false });
      break;
    case 'valor':
      consulta = consulta.order('venta_usd', { ascending: false, nullsFirst: false });
      break;
    case 'compromiso':
      consulta = consulta.order('fecha_comprometida', { ascending: true, nullsFirst: false });
      break;
    default:
      consulta = consulta.order('fecha_solicitada', { ascending: false });
  }

  /*
   * Los totales se calculan sobre TODO lo que cumple el filtro, no sobre la
   * página que se está viendo. Si dijeran «la página», el número cambiaría al
   * pasar de hoja y no significaría nada.
   *
   * Va en una segunda consulta con los mismos filtros pero trayendo solo tres
   * columnas: son 443 pedidos en total, así que cabe de sobra.
   */
  let paraTotales = supabase
    .from('v_pedidos_tablero')
    .select('cliente, cliente_id, tm_pedidas, venta_usd, semaforo');
  paraTotales = aplicarFiltros(paraTotales);

  const [{ data: filas, count }, { data: todos }] = await Promise.all([
    consulta.range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1),
    paraTotales.limit(3000),
  ]);

  const universo = (todos ?? []) as Record<string, unknown>[];
  const totales = {
    pedidos: universo.length,
    tm: universo.reduce((t, p) => t + Number(p.tm_pedidas ?? 0), 0),
    venta: universo.reduce((t, p) => t + Number(p.venta_usd ?? 0), 0),
    enRiesgo: universo.filter((p) => p.semaforo === 'riesgo' || p.semaforo === 'bloqueado').length,
  };

  /*
   * EL ACUMULADO POR CLIENTE
   * Lo pidió Oliver: poder ver, del conjunto filtrado, cuánto lleva cada
   * cliente. Se agrupa aquí y no en la base porque el universo ya está en
   * memoria y agruparlo cuesta nada.
   */
  const porClienteLista = [...universo.reduce((mapa, p) => {
    const id = Number(p.cliente_id);
    const previo = mapa.get(id) ?? { cliente: String(p.cliente), pedidos: 0, tm: 0, venta: 0 };
    previo.pedidos += 1;
    previo.tm += Number(p.tm_pedidas ?? 0);
    previo.venta += Number(p.venta_usd ?? 0);
    mapa.set(id, previo);
    return mapa;
  }, new Map<number, { cliente: string; pedidos: number; tm: number; venta: number }>())]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.venta - a.venta);

  /*
   * LOS PRODUCTOS DE CADA PEDIDO
   * Se pidió verlos en la lista. La vista del tablero no los trae —es un
   * resumen por pedido— así que se consultan aparte, y solo para las treinta
   * filas que se están mostrando.
   */
  const idsPagina = (filas ?? []).map((p) => Number(p.id));
  const { data: lineasPagina } = idsPagina.length
    ? await supabase
        .from('pedido_lineas')
        .select('pedido_id, cantidad_tm, sku_presentaciones(skus(codigo, corte))')
        .in('pedido_id', idsPagina)
        .order('orden')
    : { data: [] };

  const productosPorPedido = new Map<number, { texto: string; cuantos: number }>();
  for (const l of lineasPagina ?? []) {
    const sp = uno<Record<string, unknown>>(l.sku_presentaciones);
    const sku = uno<Record<string, unknown>>(sp?.skus);
    const nombre = `${sku?.codigo ?? ''} · ${sku?.corte ?? ''}`.trim();
    const id = Number(l.pedido_id);
    const previo = productosPorPedido.get(id);
    if (previo) previo.cuantos += 1;
    else productosPorPedido.set(id, { texto: nombre, cuantos: 1 });
  }

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
    if (orden) p.set('orden', orden);
    if (porCliente) p.set('agrupar', 'cliente');

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

  /*
   * El mes pasado, de su día 1 a su último día. Se calcula restando un día al
   * primero de este mes: así no hay que saber cuántos días tiene febrero ni
   * acordarse de los años bisiestos.
   */
  const primeroDeEsteMes = hoy.slice(0, 8) + '01';
  const finMesPasado = desplazar(primeroDeEsteMes, -1);
  const inicioMesPasado = finMesPasado.slice(0, 8) + '01';

  const hayFiltro = Boolean(vista || buscar || prioridad || desde || hasta);

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

      {/*
        LAS TARJETAS DE RESULTADOS
        Se pidieron en la reunión: cuántos pedidos, cuánto peso y cuánto valor,
        pudiendo acotar por mes. Se calculan sobre TODO lo que cumple el filtro
        —no sobre la página que se ve—, porque si cambiaran al pasar de hoja no
        significarían nada.
      */}
      <RejillaKpi>
        <Kpi
          etiqueta="Pedidos"
          valor={num(totales.pedidos)}
          nota={hayFiltro ? 'con los filtros puestos' : 'en total'}
        />
        <Kpi etiqueta="Toneladas" valor={num(totales.tm, 1)} sufijo="TM" tono="marca" />
        {puedeVerCostos && (
          <Kpi etiqueta="Valor de la venta" valor={dinero(totales.venta, 'USD', 0)} tono="marca" />
        )}
        <Kpi
          etiqueta="Necesitan decisión"
          valor={num(totales.enRiesgo)}
          tono={totales.enRiesgo > 0 ? 'atencion' : 'ok'}
          nota="en riesgo o bloqueados"
          href={enlaceVista('riesgo')}
        />
        <Kpi
          etiqueta="Clientes distintos"
          valor={num(porClienteLista.length)}
          nota={porCliente ? 'viendo el acumulado' : 'ver acumulado por cliente'}
          href={enlaceVista(vista, { agrupar: porCliente ? '' : 'cliente' })}
        />
      </RejillaKpi>

      <Panel titulo={porCliente ? `${num(porClienteLista.length)} clientes` : `${num(count ?? 0)} pedidos`}>
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
                { valor: 'fecha_salida_programada', texto: 'Salida programada' },
              ],
            },
            { tipo: 'fecha', clave: 'desde', etiqueta: 'Desde' },
            { tipo: 'fecha', clave: 'hasta', etiqueta: 'Hasta' },
            {
              tipo: 'select', clave: 'orden', etiqueta: 'Ordenar por',
              opciones: [
                { valor: 'prioridad', texto: 'Prioridad: urgentes primero' },
                { valor: 'compromiso', texto: 'Fecha comprometida' },
                { valor: 'valor', texto: 'Valor de la venta' },
              ],
            },
          ]}
        />

        {/* Rangos de uso diario, para no tener que escribir dos fechas */}
        <div className="atajos-fecha">
          <span>Rápido:</span>
          <Link href={enlaceVista(vista, { desde: hoy, hasta: hoy })}>Hoy</Link>
          <Link href={enlaceVista(vista, { desde: haceDias(7), hasta: hoy })}>Últimos 7 días</Link>
          <Link href={enlaceVista(vista, { desde: haceDias(30), hasta: hoy })}>Últimos 30 días</Link>
          <Link href={enlaceVista(vista, { desde: hoy.slice(0, 8) + '01', hasta: hoy })}>Este mes</Link>
          <Link href={enlaceVista(vista, { desde: inicioMesPasado, hasta: finMesPasado })}>Mes pasado</Link>
          <Link href={enlaceVista(vista, { orden: 'prioridad' })}>Urgentes primero</Link>
          <Link href={enlaceVista(vista, { agrupar: porCliente ? '' : 'cliente' })}>
            {porCliente ? 'Ver pedido a pedido' : 'Acumulado por cliente'}
          </Link>
          <Link href={enlaceVista(vista, {
            campo_fecha: 'fecha_comprometida', desde: hoy, hasta: enDias(7),
          })}>Entregas de la semana</Link>
          {(desde || hasta) && (
            <Link href={enlaceVista(vista, { desde: '', hasta: '' })} className="atajo-limpiar">
              Quitar fechas
            </Link>
          )}
        </div>

        {/* ══════ ACUMULADO POR CLIENTE ══════
          La misma información filtrada, sumada por cliente. Es lo que se pidió
          para responder «cuánto lleva este cliente» sin abrir sus pedidos uno
          por uno. Se ordena por valor, que es como se mira una cartera.
        */}
        {porCliente ? (
          porClienteLista.length === 0 ? (
            <Vacio titulo="Sin pedidos" mensaje="No hay pedidos que coincidan con esta vista y estos filtros." />
          ) : (
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th className="num">Pedidos</th>
                    <th className="num">Toneladas</th>
                    {puedeVerCostos && <th className="num">Valor US$</th>}
                    {puedeVerCostos && <th className="num">Participación</th>}
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {porClienteLista.map((c) => {
                    const parte = totales.venta > 0 ? (c.venta / totales.venta) * 100 : 0;
                    return (
                      <tr key={c.id}>
                        <td>
                          <Link href={`/ventas/clientes/${c.id}`} className="enlace-ficha">
                            {c.cliente.length > 38 ? c.cliente.slice(0, 37) + '…' : c.cliente}
                          </Link>
                        </td>
                        <td className="num">{num(c.pedidos)}</td>
                        <td className="num">{num(c.tm, 1)} TM</td>
                        {puedeVerCostos && (
                          <td className="num"><strong>{dinero(c.venta, 'USD', 0)}</strong></td>
                        )}
                        {puedeVerCostos && (
                          <td className="num" style={{ minWidth: '6rem' }}>
                            <Barra porcentaje={parte} tono="marca" />
                            <span style={{ fontSize: '.68rem', color: 'var(--tinta-3)' }}>
                              {parte.toFixed(1)} %
                            </span>
                          </td>
                        )}
                        <td>
                          {/* Lleva a los pedidos de ESE cliente, con los mismos
                              filtros que están puestos ahora. */}
                          <Link
                            href={enlaceVista(vista, { agrupar: '', buscar: c.cliente })}
                            className="btn btn-sutil btn-chico"
                          >
                            Ver sus pedidos
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : (filas ?? []).length === 0 ? (
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
                    {/* Entra el producto y se va «Origen», que se pidió
                        retirar. De dónde vino el pedido sigue estando en su
                        ficha, que es donde se consulta. */}
                    <th>Producto</th>
                    <th>Destino</th>
                    <th className="num">Pedido</th>
                    <th className="num">Avance</th>
                    <th className="num">Falta</th>
                    {puedeVerCostos && <th className="num">Venta US$</th>}
                    <th className="num">Compromiso</th>
                    <th className="num">Salida prog.</th>
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
                        <td title={p.cliente as string}>
                          {(p.cliente as string).length > 26
                            ? (p.cliente as string).slice(0, 25) + '…'
                            : p.cliente}
                          {p.cliente_bloqueado && (
                            <> <Etiqueta texto="Crédito bloqueado" tono="critico" /></>
                          )}
                        </td>
                        {/*
                          El producto del pedido. Si lleva varios se enseña el
                          primero y cuántos más: la lista es para reconocer el
                          pedido de un vistazo, no para detallarlo — para eso
                          está su ficha.
                        */}
                        <td style={{ fontSize: '.76rem' }}>
                          {(() => {
                            const prod = productosPorPedido.get(p.id as number);
                            if (!prod) return <span style={{ color: 'var(--tinta-3)' }}>—</span>;
                            return (
                              <>
                                {prod.texto.length > 30 ? prod.texto.slice(0, 29) + '…' : prod.texto}
                                {prod.cuantos > 1 && (
                                  <>
                                    <br />
                                    <span style={{ color: 'var(--tinta-3)', fontSize: '.68rem' }}>
                                      y {prod.cuantos - 1} producto{prod.cuantos > 2 ? 's' : ''} más
                                    </span>
                                  </>
                                )}
                              </>
                            );
                          })()}
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
                        {/*
                          DOS FECHAS DISTINTAS, Y HAY QUE VER LAS DOS.
                          «Compromiso» es lo que se le prometió al cliente.
                          «Salida prog.» es el día que Logística puso en el
                          calendario. Deberían coincidir; cuando no coinciden,
                          eso es justamente lo que hay que ver, y a tiempo.
                        */}
                        <td className="num" style={{ color: p.atrasado ? 'var(--critico)' : undefined }}>
                          {fecha(p.fecha_comprometida as string)}
                        </td>
                        <td className="num" style={{ fontSize: '.76rem' }}>
                          {p.fecha_salida_programada ? (
                            <>
                              {fecha(p.fecha_salida_programada as string)}
                              {Number(p.desfase_programacion) > 0 && (
                                <>
                                  <br />
                                  <span style={{ color: 'var(--critico)', fontSize: '.68rem' }}>
                                    {num(Number(p.desfase_programacion))} d tarde
                                  </span>
                                </>
                              )}
                            </>
                          ) : (
                            <span style={{ color: 'var(--tinta-3)' }}>sin programar</span>
                          )}
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
