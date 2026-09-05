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
                  <th>Estado</th><th>Proforma</th><th>Cliente</th>
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
                      {(p.cliente as string).length > 26 ? (p.cliente as string).slice(0, 25) + '…' : p.cliente as string}
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
