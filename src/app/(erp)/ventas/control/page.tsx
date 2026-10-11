/**
 * ============================================================================
 *  CONTROL DE PEDIDOS · las seis tarjetas
 * ============================================================================
 *  Del documento de mejoras del cliente:
 *
 *    «Dejar únicamente 6 tarjetas: Pedidos por atender – Pedidos completos –
 *     Pedidos pendientes – Backorder – Pedidos cancelados – Pedidos
 *     retrasados.»
 *
 *  Antes había ocho —incompletos, en riesgo, sin movimiento, bloqueados…—
 *  pensadas desde el riesgo. Estas seis están pensadas desde la OPERACIÓN:
 *  qué tengo que atender, qué puedo despachar ya, qué me falta fabricar.
 *
 *  LAS DEFINICIONES, TAL COMO LAS DIO EL CLIENTE
 *   · Pendientes: «pedidos que aún no se atienden, pero sí existe stock
 *     disponible».
 *   · Backorder: «cantidad pendiente de atender por falta de stock».
 *   · Completos: «pedidos atendidos totalmente. Permitir filtrar hasta una
 *     semana determinada».
 *   · Retrasados: medido contra la salida programada del planificador, que es
 *     lo que respondió Oliver al preguntarle contra qué fecha.
 *
 *  PENDIENTES Y BACKORDER NO SON EXCLUYENTES, y la pantalla lo dice. El
 *  backorder es una CANTIDAD: un pedido con la mitad en cámara tiene la mitad
 *  lista y la mitad por fabricar, y aparece en las dos tarjetas. Si fueran
 *  excluyentes, los pedidos a medio cubrir desaparecerían de «pendientes» y
 *  Operaciones no vería que tiene carga lista para salir.
 *
 *  Cada tarjeta se pulsa y abre su detalle. En Backorder el detalle va por
 *  PRODUCTO, porque es lo que pidió el documento: «mostrar los pedidos,
 *  clientes, productos y cantidades que generan ese valor».
 *
 *  EL ORDEN (observaciones de octubre, punto 2): del pedido MÁS RECIENTE al
 *  más antiguo, siempre —al entrar y al actualizar—. Lo decide el servidor,
 *  así que no depende de lo que el navegador recuerde.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor } from '@/lib/supabase/servidor';
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { AccionesLista } from '@/components/ui/Acciones';
import { num, fecha, dinero } from '@/lib/formato';
import { uno } from '@/lib/relaciones';
import { traerTodo } from '@/lib/traerTodo';

export const metadata: Metadata = { title: 'Control de pedidos' };
export const dynamic = 'force-dynamic';

type Vista = 'por_atender' | 'completos' | 'pendientes' | 'backorder' | 'cancelados' | 'retrasados';

/** Las seis tarjetas, en el orden en que las pidió el cliente. */
const VISTAS: Record<Vista, { titulo: string; descripcion: string }> = {
  por_atender: {
    titulo: 'Pedidos por atender',
    descripcion: 'Confirmados y todavía sin despachar entero. Es el total de trabajo abierto.',
  },
  completos: {
    titulo: 'Pedidos completos',
    descripcion: 'Atendidos totalmente. Se pueden ver hasta una semana determinada.',
  },
  pendientes: {
    titulo: 'Pedidos pendientes',
    descripcion: 'Aún no atendidos, pero con stock en cámara para despachar al menos una parte. Es lo que se puede cargar ya.',
  },
  backorder: {
    titulo: 'Backorder',
    descripcion: 'Lo que no se puede atender por falta de stock, producto por producto. Es lo que falta fabricar.',
  },
  cancelados: {
    titulo: 'Pedidos cancelados',
    descripcion: 'Anulados. Se conservan para poder consultar por qué se cayó una venta.',
  },
  retrasados: {
    titulo: 'Pedidos retrasados',
    descripcion: 'Abiertos y con la salida programada ya vencida. Si todavía no están en el planificador, se mide contra la fecha comprometida con el cliente.',
  },
};

type FilaControl = {
  id: number;
  numero_proforma: string;
  cliente: string;
  destino: string | null;
  prioridad: string;
  ciclo: string;
  fecha_comprometida: string | null;
  fecha_salida_programada: string | null;
  fecha_referencia: string | null;
  fecha_completado: string | null;
  tm_pedidas: number;
  tm_pendientes: number;
  tm_con_stock: number;
  tm_backorder: number;
  venta_usd: number;
  situacion_control: string;
  tiene_stock: boolean;
  en_backorder: boolean;
  retrasado: boolean;
};

/* ==========================================================================
   LAS SEMANAS, PARA EL FILTRO DE COMPLETOS
   ========================================================================== */
/** El lunes de la semana ISO de una fecha. */
function lunesDe(d: Date) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dia = x.getUTCDay() || 7;          // domingo = 7
  x.setUTCDate(x.getUTCDate() - dia + 1);
  return x;
}
/** El número de semana ISO: la que usa el negocio cuando dice «semana 39». */
function numeroSemana(d: Date) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() + 4 - (x.getUTCDay() || 7));
  const inicioAnio = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return Math.ceil(((x.getTime() - inicioAnio.getTime()) / 86400000 + 1) / 7);
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const corta = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

export default async function PaginaControl(props: PageProps<'/ventas/control'>) {
  const q = await props.searchParams;
  const vista: Vista = (Object.keys(VISTAS) as Vista[]).includes(q.vista as Vista)
    ? (q.vista as Vista) : 'por_atender';
  /* Lunes de la semana hasta la que se quieren ver los completos. */
  const hasta = typeof q.hasta === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.hasta) ? q.hasta : '';

  const supabase = await crearClienteServidor();

  /*
   * Se trae todo y se cuenta aquí: son cientos de pedidos, no decenas de
   * miles. Pero se trae PAGINADO: la API corta en mil filas sin avisar, y un
   * día habrá más de mil pedidos y las tarjetas empezarían a mentir en
   * silencio.
   */
  const [pedidosSinOrden, creados] = await Promise.all([
    traerTodo<FilaControl>((d, h) =>
      supabase.from('v_control_pedidos').select('*').order('id').range(d, h)),
    /*
     * La fecha de creación de cada pedido, para ordenar del más reciente al
     * más antiguo (punto 2). La vista no la trae y es más barato pedirla que
     * rehacer la vista.
     */
    traerTodo<{ id: number; creado_en: string }>((d, h) =>
      supabase.from('pedidos').select('id, creado_en').order('id').range(d, h)),
  ]);
  const creadoDe = new Map(creados.map((p) => [Number(p.id), String(p.creado_en)]));
  const masReciente = (a: number, b: number) =>
    (creadoDe.get(b) ?? '').localeCompare(creadoDe.get(a) ?? '') || b - a;
  const pedidos = [...pedidosSinOrden].sort((a, b) => masReciente(a.id, b.id));

  const abiertos = pedidos.filter((p) => p.situacion_control === 'por_atender');
  const completosTodos = pedidos.filter((p) => p.situacion_control === 'completo');

  /* ---- Las semanas en que hay pedidos completados, para el desplegable ---- */
  const semanas = [...new Set(
    completosTodos.filter((p) => p.fecha_completado)
      .map((p) => iso(lunesDe(new Date(p.fecha_completado as string))))
  )].sort().reverse().slice(0, 20);

  /*
   * «Hasta una semana determinada»: los completados hasta el DOMINGO de esa
   * semana. Un pedido que se completó sin fecha de salida registrada —pasa
   * con los cerrados a mano— no se puede ubicar en ninguna semana, así que
   * con el filtro puesto no aparece; sin filtro, sí.
   */
  const finDeSemana = hasta
    ? (() => { const d = new Date(hasta + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 6); return iso(d); })()
    : '';
  const completos = hasta
    ? completosTodos.filter((p) => p.fecha_completado && p.fecha_completado <= finDeSemana)
    : completosTodos;

  const grupos: Record<Vista, FilaControl[]> = {
    por_atender: abiertos,
    completos,
    pendientes: abiertos.filter((p) => p.tiene_stock),
    backorder: abiertos.filter((p) => p.en_backorder),
    cancelados: pedidos.filter((p) => p.situacion_control === 'cancelado'),
    retrasados: abiertos.filter((p) => p.retrasado),
  };

  const tmListas = grupos.pendientes.reduce((t, p) => t + Number(p.tm_con_stock), 0);
  const tmBackorder = grupos.backorder.reduce((t, p) => t + Number(p.tm_backorder), 0);

  /* ---- El detalle de backorder, por producto ---- */
  let lineasBackorder: {
    pedido_id: number; proforma: string; cliente: string;
    producto: string; pedido_tm: number; con_stock_tm: number; backorder_tm: number;
  }[] = [];
  if (vista === 'backorder') {
    const lineas = await traerTodo<Record<string, unknown>>((d, h) =>
      supabase.from('v_pedido_linea_cobertura')
        .select('pedido_id, pedido_kg, con_stock_kg, backorder_kg, sku_presentacion_id')
        .gt('backorder_kg', 0.5)
        .order('linea_id')
        .range(d, h)
    );
    //  También aquí, el pedido más reciente primero (punto 2).
    lineas.sort((a, b) => masReciente(Number(a.pedido_id), Number(b.pedido_id)));
    const idsProd = [...new Set(lineas.map((l) => Number(l.sku_presentacion_id)))];
    const { data: prods } = idsProd.length
      ? await supabase.from('sku_presentaciones')
          .select('id, skus(codigo, corte), presentaciones(descripcion)')
          .in('id', idsProd)
      : { data: [] };
    const nombreProd = new Map((prods ?? []).map((sp) => {
      const s = uno<Record<string, unknown>>(sp.skus);
      const pr = uno<Record<string, unknown>>(sp.presentaciones);
      return [Number(sp.id), `${s?.codigo ?? ''} · ${s?.corte ?? ''} · ${pr?.descripcion ?? ''}`];
    }));
    const pedidoDe = new Map(pedidos.map((p) => [p.id, p]));
    lineasBackorder = lineas.map((l) => {
      const p = pedidoDe.get(Number(l.pedido_id));
      return {
        pedido_id: Number(l.pedido_id),
        proforma: p?.numero_proforma ?? '—',
        cliente: p?.cliente ?? '—',
        producto: nombreProd.get(Number(l.sku_presentacion_id)) ?? '—',
        pedido_tm: Number(l.pedido_kg) / 1000,
        con_stock_tm: Number(l.con_stock_kg) / 1000,
        backorder_tm: Number(l.backorder_kg) / 1000,
      };
    });
  }

  const filas = grupos[vista];
  const enlace = (v: Vista) => `/ventas/control?vista=${v}`;

  /*
   * EL PRODUCTO DE CADA PEDIDO.
   * Se pidió en la reunión con Oliver: «aquí querían que salga el producto por
   * cliente». Sin él esta pantalla dice que hay un problema pero no con qué, y
   * para saber si falta filete o anillas había que abrir el pedido uno por uno.
   * Se muestra el de MÁS toneladas, que es el que identifica al pedido, y
   * cuántos más lleva.
   */
  const idsVisibles = filas.slice(0, 200).map((p) => p.id);
  const { data: lineasProd } = idsVisibles.length
    ? await supabase
        .from('pedido_lineas')
        .select('pedido_id, cantidad_tm, sku_presentaciones(skus(codigo, corte))')
        .in('pedido_id', idsVisibles)
        .order('cantidad_tm', { ascending: false })
    : { data: [] };
  const productoDe = new Map<number, { texto: string; cuantos: number }>();
  for (const l of lineasProd ?? []) {
    const sku = uno<Record<string, unknown>>(uno<Record<string, unknown>>(l.sku_presentaciones)?.skus);
    const id = Number(l.pedido_id);
    const previo = productoDe.get(id);
    if (previo) { previo.cuantos += 1; continue; }
    productoDe.set(id, { texto: `${sku?.codigo ?? ''} · ${sku?.corte ?? ''}`, cuantos: 1 });
  }

  return (
    <>
      <CabeceraPagina
        titulo="Control de pedidos"
        descripcion="Qué hay que atender, qué se puede despachar ya y qué falta fabricar. Pulse una tarjeta para ver su detalle."
      />

      <RejillaKpi>
        <Kpi etiqueta="Pedidos por atender" valor={num(grupos.por_atender.length)}
             nota={`${num(abiertos.reduce((t, p) => t + Number(p.tm_pendientes), 0), 1)} TM pendientes`}
             href={enlace('por_atender')} />
        <Kpi etiqueta="Pedidos completos" valor={num(completos.length)} tono="ok"
             nota={hasta ? `Hasta la semana ${numeroSemana(new Date(hasta + 'T00:00:00Z'))}` : 'Atendidos totalmente'}
             href={enlace('completos') + (hasta ? `&hasta=${hasta}` : '')} />
        <Kpi etiqueta="Pedidos pendientes" valor={num(grupos.pendientes.length)} tono="atencion"
             nota={`${num(tmListas, 1)} TM listas para despachar`}
             href={enlace('pendientes')} />
        <Kpi etiqueta="Backorder" valor={num(tmBackorder, 1)} sufijo="TM" tono="critico"
             nota={`${num(grupos.backorder.length)} pedidos · falta de stock`}
             href={enlace('backorder')} />
        <Kpi etiqueta="Pedidos cancelados" valor={num(grupos.cancelados.length)}
             href={enlace('cancelados')} />
        <Kpi etiqueta="Pedidos retrasados" valor={num(grupos.retrasados.length)}
             tono={grupos.retrasados.length > 0 ? 'critico' : 'ok'}
             nota="Contra la salida programada"
             href={enlace('retrasados')} />
      </RejillaKpi>

      <Panel titulo={`${VISTAS[vista].titulo} · ${vista === 'backorder' ? `${num(lineasBackorder.length)} líneas` : num(filas.length)}`}>
        <p className="pie-explicativo" style={{ padding: '.7rem 1rem 0' }}>
          {VISTAS[vista].descripcion}
        </p>

        {/* Pendientes y backorder se solapan: se dice, para que nadie crea que
            las tarjetas no cuadran. */}
        {(vista === 'pendientes' || vista === 'backorder') && (
          <p className="pie-explicativo" style={{ padding: '.3rem 1rem 0' }}>
            Un pedido con parte en cámara y parte por fabricar aparece en las dos tarjetas:
            su parte lista cuenta en Pendientes y su parte faltante en Backorder.
          </p>
        )}

        {/* ---- El filtro de semana, solo en completos ---- */}
        {vista === 'completos' && (
          <form className="control-semana" method="get">
            <input type="hidden" name="vista" value="completos" />
            <label>
              <span>Completados hasta la semana</span>
              <select name="hasta" defaultValue={hasta}>
                <option value="">Todas</option>
                {semanas.map((s) => {
                  const d = new Date(s + 'T00:00:00Z');
                  const fin = new Date(d); fin.setUTCDate(fin.getUTCDate() + 6);
                  return (
                    <option key={s} value={s}>
                      Semana {numeroSemana(d)} · {corta(d)} al {corta(fin)}
                    </option>
                  );
                })}
              </select>
            </label>
            <button type="submit" className="btn btn-secundario">Aplicar</button>
          </form>
        )}

        {/* ---- Backorder: el detalle por producto ---- */}
        {vista === 'backorder' ? (
          lineasBackorder.length === 0 ? (
            <Vacio titulo="Sin backorder" mensaje="Todos los pedidos abiertos tienen stock para atenderse." />
          ) : (
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0, marginTop: '.7rem' }}>
              <table className="datos">
                <thead>
                  <tr>
                    <th>Proforma</th><th>Cliente</th><th>Producto</th>
                    <th className="num">Pedido</th><th className="num">Con stock</th>
                    <th className="num">Backorder</th><th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {lineasBackorder.slice(0, 200).map((l, i) => (
                    <tr key={`${l.pedido_id}-${i}`}>
                      <td><Link href={`/ventas/pedidos/${l.pedido_id}`} className="enlace-dato">{l.proforma}</Link></td>
                      <td title={l.cliente}>{l.cliente.length > 26 ? l.cliente.slice(0, 25) + '…' : l.cliente}</td>
                      <td style={{ fontSize: '.76rem' }}>{l.producto}</td>
                      <td className="num">{num(l.pedido_tm, 1)} TM</td>
                      <td className="num">{l.con_stock_tm > 0.0005 ? `${num(l.con_stock_tm, 1)} TM` : '—'}</td>
                      <td className="num" style={{ color: 'var(--critico)', fontWeight: 600 }}>{num(l.backorder_tm, 1)} TM</td>
                      <td><AccionesLista ver={`/ventas/pedidos/${l.pedido_id}`} verTitulo={`Ver el pedido ${l.proforma}`} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : filas.length === 0 ? (
          <Vacio titulo="Nada que reportar" mensaje="No hay pedidos en esta situación." />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0, marginTop: '.7rem' }}>
            <table className="datos">
              <thead>
                <tr>
                  <th>Proforma</th><th>Cliente</th><th>Producto</th><th>Destino</th>
                  <th className="num">Pedido</th>
                  {vista !== 'completos' && vista !== 'cancelados' && (
                    <><th className="num">Listo</th><th className="num">Falta</th></>
                  )}
                  <th className="num">Venta US$</th>
                  <th className="num">{vista === 'completos' ? 'Completado' : 'Salida prog.'}</th>
                  <th>Prioridad</th><th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filas.slice(0, 200).map((p) => (
                  <tr key={p.id}>
                    <td><Link href={`/ventas/pedidos/${p.id}`} className="enlace-dato">{p.numero_proforma}</Link></td>
                    <td title={p.cliente}>{p.cliente.length > 24 ? p.cliente.slice(0, 23) + '…' : p.cliente}</td>
                    <td style={{ fontSize: '.76rem' }}>
                      {(() => {
                        const prod = productoDe.get(p.id);
                        if (!prod) return <span style={{ color: 'var(--tinta-3)' }}>—</span>;
                        return (
                          <>
                            {prod.texto.length > 26 ? prod.texto.slice(0, 25) + '…' : prod.texto}
                            {prod.cuantos > 1 && (
                              <><br /><span style={{ color: 'var(--tinta-3)', fontSize: '.68rem' }}>
                                y {prod.cuantos - 1} más</span></>
                            )}
                          </>
                        );
                      })()}
                    </td>
                    <td>{p.destino ?? '—'}</td>
                    <td className="num">{num(p.tm_pedidas, 1)} TM</td>
                    {vista !== 'completos' && vista !== 'cancelados' && (
                      <>
                        <td className="num">{Number(p.tm_con_stock) > 0.0005 ? `${num(p.tm_con_stock, 1)} TM` : '—'}</td>
                        <td className="num" style={{ color: Number(p.tm_backorder) > 0 ? 'var(--critico)' : undefined }}>
                          {Number(p.tm_backorder) > 0.0005 ? `${num(p.tm_backorder, 1)} TM` : '—'}
                        </td>
                      </>
                    )}
                    <td className="num">{dinero(p.venta_usd, 'USD', 0)}</td>
                    <td className="num" style={{ color: p.retrasado ? 'var(--critico)' : undefined }}>
                      {vista === 'completos'
                        ? fecha(p.fecha_completado)
                        : fecha(p.fecha_referencia)}
                      {vista !== 'completos' && !p.fecha_salida_programada && p.fecha_referencia && (
                        <><br /><small style={{ color: 'var(--tinta-3)' }}>sin programar</small></>
                      )}
                    </td>
                    <td>
                      <Etiqueta texto={p.prioridad}
                        tono={p.prioridad === 'urgente' ? 'critico' : p.prioridad === 'alta' ? 'atencion' : 'neutro'} />
                    </td>
                    <td><AccionesLista ver={`/ventas/pedidos/${p.id}`} verTitulo={`Ver el pedido ${p.numero_proforma}`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
