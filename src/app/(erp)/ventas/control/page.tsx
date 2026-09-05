/**
 * ============================================================================
 *  CONTROL DE PEDIDOS · las ocho vistas de riesgo
 * ============================================================================
 *  Esta pantalla responde a la segunda de las tres preguntas del negocio:
 *  ¿QUÉ PROBLEMA TENGO?
 *
 *  No lista todos los pedidos: lista solo los que necesitan una decisión.
 *  Cada tarjeta de arriba es una situación distinta y lleva directo a la lista
 *  filtrada correspondiente.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor } from '@/lib/supabase/servidor';
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio, Etiqueta, Semaforo, Barra } from '@/components/ui/Pagina';
import { AccionesLista } from '@/components/ui/Acciones';
import { num, fecha, dinero } from '@/lib/formato';
import { uno } from '@/lib/relaciones';

export const metadata: Metadata = { title: 'Control de pedidos' };
export const dynamic = 'force-dynamic';

/** Las ocho vistas de riesgo que pedía la especificación. */
const VISTAS: Record<string, { titulo: string; descripcion: string }> = {
  incompletos:   { titulo: 'Pedidos incompletos',        descripcion: 'Confirmados pero sin stock suficiente reservado.' },
  riesgo:        { titulo: 'Pedidos en riesgo',          descripcion: 'Pasaron su fecha comprometida y siguen abiertos.' },
  atrasados:     { titulo: 'Pedidos atrasados',          descripcion: 'La fecha comprometida ya venció.' },
  sin_movimiento:{ titulo: 'Pedidos sin movimiento',     descripcion: 'Confirmados hace tiempo y sin reservas.' },
  bloqueados:    { titulo: 'Bloqueados por crédito',     descripcion: 'El cliente tiene el crédito bloqueado.' },
  completos:     { titulo: 'Completos sin embarque',     descripcion: 'Cubiertos con stock pero aún sin programar.' },
  urgentes:      { titulo: 'Pedidos urgentes',           descripcion: 'Marcados con prioridad urgente.' },
  todos:         { titulo: 'Todos los pedidos abiertos', descripcion: 'Confirmados y aún no despachados.' },
};

export default async function PaginaControl(props: PageProps<'/ventas/control'>) {
  const q = await props.searchParams;
  const vista = (q.vista as string) ?? 'riesgo';
  const supabase = await crearClienteServidor();

  const { data: todos } = await supabase
    .from('v_pedidos_tablero')
    .select('*')
    .in('ciclo', ['confirmado', 'pendiente_validacion']);

  const lista = todos ?? [];

  /*
   * QUÉ PRODUCTO ES CADA PEDIDO.
   *
   * Se pidió en la reunión: «aquí querían que salga el producto por cliente».
   * Sin él, esta pantalla dice que hay un problema pero no con qué: para saber
   * si el faltante es de filete o de anillas había que abrir el pedido uno por
   * uno, que es justo lo que esta pantalla existe para evitar.
   *
   * La vista del tablero es un resumen por pedido y no los trae, así que se
   * consultan aparte para los que están abiertos.
   */
  const ids = lista.map((p) => Number(p.id));
  const { data: lineas } = ids.length
    ? await supabase
        .from('pedido_lineas')
        .select('pedido_id, cantidad_tm, sku_presentaciones(skus(codigo, corte, especies(nombre)))')
        .in('pedido_id', ids)
        .order('cantidad_tm', { ascending: false })
    : { data: [] };

  const productoDe = new Map<number, { texto: string; cuantos: number }>();
  for (const l of lineas ?? []) {
    const sp = uno<Record<string, unknown>>(l.sku_presentaciones);
    const sku = uno<Record<string, unknown>>(sp?.skus);
    const id = Number(l.pedido_id);
    const previo = productoDe.get(id);
    if (previo) { previo.cuantos += 1; continue; }
    // El primero es el de MÁS toneladas: si el pedido lleva varios, ese es el
    // que lo identifica.
    productoDe.set(id, {
      texto: `${sku?.codigo ?? ''} · ${sku?.corte ?? ''}`.trim(),
      cuantos: 1,
    });
  }

  /** Aplica el criterio de cada vista sobre los pedidos abiertos. */
  function filtrar(v: string) {
    switch (v) {
      case 'incompletos':    return lista.filter((p) => p.semaforo === 'parcial');
      case 'riesgo':         return lista.filter((p) => p.semaforo === 'riesgo');
      case 'atrasados':      return lista.filter((p) => p.atrasado);
      case 'sin_movimiento': return lista.filter((p) => Number(p.tm_reservadas) === 0 && p.ciclo === 'confirmado');
      case 'bloqueados':     return lista.filter((p) => p.semaforo === 'bloqueado');
      case 'completos':      return lista.filter((p) => p.semaforo === 'completo');
      case 'urgentes':       return lista.filter((p) => p.prioridad === 'urgente');
      default:               return lista;
    }
  }

  const filas = filtrar(vista);
  const conteos = Object.fromEntries(Object.keys(VISTAS).map((v) => [v, filtrar(v).length]));

  return (
    <>
      <CabeceraPagina
        titulo="Control de pedidos"
        descripcion="Solo los pedidos que necesitan una decisión. Cada tarjeta es una situación distinta."
      />

      <RejillaKpi>
        {Object.entries(VISTAS).map(([clave, v]) => (
          <Kpi
            key={clave}
            etiqueta={v.titulo}
            valor={num(conteos[clave] ?? 0)}
            tono={
              clave === 'bloqueados' || clave === 'atrasados' ? 'critico'
              : clave === 'riesgo' || clave === 'incompletos' || clave === 'sin_movimiento' ? 'atencion'
              : clave === 'completos' ? 'ok' : 'neutro'
            }
            href={`/ventas/control?vista=${clave}`}
          />
        ))}
      </RejillaKpi>

      <Panel titulo={`${VISTAS[vista]?.titulo ?? 'Pedidos'} · ${filas.length}`}>
        <p className="pie-explicativo" style={{ padding: '.7rem 1rem 0' }}>
          {VISTAS[vista]?.descripcion}
        </p>

        {filas.length === 0 ? (
          <Vacio titulo="Nada que reportar" mensaje="No hay pedidos en esta situación." />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0, marginTop: '.7rem' }}>
            <table className="datos">
              <thead>
                <tr>
                  <th>Estado</th><th>Proforma</th><th>Cliente</th><th>Producto</th>
                  <th className="num">Pedido</th><th className="num">Avance</th><th className="num">Falta</th>
                  <th className="num">Venta US$</th><th className="num">Compromiso</th><th>Prioridad</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filas.slice(0, 100).map((p) => (
                  <tr key={p.id as number}>
                    <td><Semaforo estado={p.semaforo as never} /></td>
                    <td>
                      <Link href={`/ventas/pedidos/${p.id}`} className="enlace-dato">{p.numero_proforma as string}</Link>
                    </td>
                    <td title={p.cliente as string}>
                      {(p.cliente as string).length > 24 ? (p.cliente as string).slice(0, 23) + '…' : p.cliente as string}
                    </td>
                    <td style={{ fontSize: '.76rem' }}>
                      {(() => {
                        const prod = productoDe.get(p.id as number);
                        if (!prod) return <span style={{ color: 'var(--tinta-3)' }}>—</span>;
                        return (
                          <>
                            {prod.texto.length > 28 ? prod.texto.slice(0, 27) + '…' : prod.texto}
                            {prod.cuantos > 1 && (
                              <>
                                <br />
                                <span style={{ color: 'var(--tinta-3)', fontSize: '.68rem' }}>
                                  y {prod.cuantos - 1} más
                                </span>
                              </>
                            )}
                          </>
                        );
                      })()}
                    </td>
                    <td className="num">{num(p.tm_pedidas, 1)} TM</td>
                    <td className="num" style={{ minWidth: '5rem' }}>
                      <Barra porcentaje={Number(p.avance_pct)} tono={Number(p.avance_pct) >= 100 ? 'ok' : 'atencion'} />
                    </td>
                    <td className="num">{Number(p.tm_faltantes) > 0 ? `${num(p.tm_faltantes, 1)} TM` : '—'}</td>
                    {/* En dólares: esta columna se compara entre pedidos de
                        distinta moneda, así que tiene que estar en una sola. */}
                    <td className="num">{dinero(p.venta_usd, 'USD', 0)}</td>
                    <td className="num" style={{ color: p.atrasado ? 'var(--critico)' : undefined }}>
                      {fecha(p.fecha_comprometida as string)}
                    </td>
                    <td>
                      <Etiqueta
                        texto={p.prioridad as string}
                        tono={p.prioridad === 'urgente' ? 'critico' : p.prioridad === 'alta' ? 'atencion' : 'neutro'}
                      />
                    </td>
                    <td>
                      <AccionesLista
                        ver={`/ventas/pedidos/${p.id}`}
                        verTitulo={`Ver el pedido ${p.numero_proforma}`}
                      />
                    </td>
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
