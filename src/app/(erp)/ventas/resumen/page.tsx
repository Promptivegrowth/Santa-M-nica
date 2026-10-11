/**
 * ============================================================================
 *  RESUMEN DE DESPACHOS · el plan del mes contra lo que salió
 * ============================================================================
 *  Documento de mejoras, punto 2.1 — «Ventas → Dashboard/Resumen de Ventas»:
 *
 *    «Mostrar el avance mensual de ventas en función al número de
 *     contenedores: Contenedores planificados / Contenedores despachados /
 *     Pendientes / % de cumplimiento.»
 *
 *  El plan es el planificador y lo real es lo que tuvo salida, como pidió
 *  Oliver. Las reglas exactas —qué cuenta en qué mes— están en la migración
 *  056; aquí solo se enseñan, y cada tarjeta abre los contenedores que la
 *  forman (punto 7 del documento: «las tarjetas deben permitir hacer clic y
 *  ver el detalle»).
 *
 *  OBSERVACIONES DE OCTUBRE (punto 1)
 *   · Se llama «Resumen de despachos» —antes «Resumen de ventas»—: lo que
 *     mide son contenedores que salen. La dirección no cambia, para no romper
 *     enlaces guardados.
 *   · Las proformas salen de la MÁS RECIENTE a la más antigua, por su fecha
 *     de creación: lo último que se vendió es lo primero que se busca.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor } from '@/lib/supabase/servidor';
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { Filtros } from '@/components/ui/Filtros';
import { traerTodo } from '@/lib/traerTodo';
import { enlaceEntidad } from '@/lib/enlaces';
import { num, pct, fecha } from '@/lib/formato';

export const metadata: Metadata = { title: 'Resumen de despachos' };
export const dynamic = 'force-dynamic';

type Mes = {
  mes: string; clave: string; planificados: number; despachados: number; pendientes: number;
  cumplimiento: number | null; arrastre: number; mes_abierto: boolean;
};
type Contenedor = {
  embarque_id: number; embarque: string; fecha_programada: string; mes_plan: string;
  contenedor: string | null; fecha_salida: string | null; mes_salida: string | null;
  cumple_mes: boolean; situacion: 'despachado' | 'salio_tarde' | 'pendiente';
  proformas: string | null; clientes: string | null; pedido_id: number | null; destino: string | null;
};

/*
 * Qué contenedores abre cada tarjeta. «arrastre» no es una de las cuatro del
 * documento, pero sin ella quien vea salir un contenedor en el almacén no lo
 * encontraría en ninguna: estaba planificado para el mes anterior.
 */
const VISTAS: Record<string, string> = {
  planificados: 'Planificados',
  despachados: 'Despachados',
  pendientes: 'Pendientes',
  arrastre: 'Salidas de meses anteriores',
};

/** «2026-09» → «Setiembre de 2026». Solo la inicial: con CSS saldría «Setiembre De 2026». */
function nombreMes(clave: string): string {
  const t = new Date(`${clave}-01T12:00:00`).toLocaleDateString('es-PE', { month: 'long', year: 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const tonoCumplimiento = (v: number | null) =>
  v === null ? 'neutro' : v >= 95 ? 'ok' : v >= 80 ? 'atencion' : 'critico';

export default async function PaginaResumenVentas(props: PageProps<'/ventas/resumen'>) {
  const q = await props.searchParams;
  const supabase = await crearClienteServidor();

  const { data: mesesDesc } = await supabase
    .from('v_ventas_objetivo_mensual').select('*').order('mes', { ascending: false });
  const meses = (mesesDesc ?? []) as Mes[];

  //  Por defecto, el mes en curso; si todavía no tiene nada, el último que haya.
  const hoy = meses.find((m) => m.mes_abierto) ?? meses[0];
  const clave = (q.mes as string) || hoy?.clave || '';
  const actual = meses.find((m) => m.clave === clave);
  const ver = VISTAS[q.ver as string] ? (q.ver as string) : 'planificados';

  //  Los contenedores del mes elegido: los de su plan y los que salieron en él.
  const inicio = `${clave}-01`;
  const contenedores = clave
    ? await traerTodo<Contenedor>((d, h) =>
        supabase.from('v_objetivo_contenedores').select('*')
          .or(`mes_plan.eq.${inicio},mes_salida.eq.${inicio}`)
          .order('fecha_programada').order('embarque_id').range(d, h))
    : [];

  /*
   * EL ORDEN: la proforma más reciente primero (punto 1). La vista no trae la
   * fecha de creación del pedido, así que se pide aparte, solo para los
   * pedidos de este mes. Un contenedor sin proforma va al final.
   */
  const idsPedidos = [...new Set(contenedores.map((c) => c.pedido_id).filter((x): x is number => !!x))];
  const { data: creados } = idsPedidos.length
    ? await supabase.from('pedidos').select('id, creado_en').in('id', idsPedidos)
    : { data: [] as { id: number; creado_en: string }[] };
  const creadoDe = new Map((creados ?? []).map((p) => [Number(p.id), String(p.creado_en)]));
  const creadoDeContenedor = (c: Contenedor) => (c.pedido_id ? creadoDe.get(c.pedido_id) ?? '' : '');
  contenedores.sort((a, b) =>
    creadoDeContenedor(b).localeCompare(creadoDeContenedor(a)) || b.embarque_id - a.embarque_id);

  const delPlan = contenedores.filter((c) => c.mes_plan === inicio);
  const detalle = {
    planificados: delPlan,
    despachados: delPlan.filter((c) => c.cumple_mes),
    pendientes: delPlan.filter((c) => !c.cumple_mes),
    arrastre: contenedores.filter((c) => c.mes_plan < inicio && c.mes_salida === inicio),
  }[ver] ?? delPlan;

  const enlace = (v: string) => `/ventas/resumen?mes=${clave}&ver=${v}#detalle`;
  const cumplimiento = actual?.cumplimiento === null || actual?.cumplimiento === undefined
    ? null : Number(actual.cumplimiento);

  return (
    <>
      <CabeceraPagina
        titulo="Resumen de despachos"
        descripcion="Contenedores planificados en el Planificador contra los que tuvieron salida dentro del mes. Las proformas van de la más reciente a la más antigua."
      />

      <Panel titulo="Mes" className="mb-espacio">
        <Filtros
          campos={[{
            tipo: 'select', clave: 'mes', etiqueta: 'Mes',
            opciones: meses.map((m) => ({ valor: m.clave, texto: nombreMes(m.clave) })),
          }]}
        />
      </Panel>

      {!actual ? (
        <Vacio titulo="Sin plan" mensaje="No hay contenedores planificados ni despachados en ese mes." />
      ) : (
        <>
          <div id="objetivo">
            <Panel titulo={`Ventas vs. objetivo · ${nombreMes(clave)}${actual.mes_abierto ? ' · en curso' : ''}`} className="mb-espacio">
              <RejillaKpi>
                <Kpi
                  etiqueta="Contenedores planificados"
                  valor={num(actual.planificados)}
                  nota="Lo que está en el Planificador para el mes"
                  href={enlace('planificados')}
                />
                <Kpi
                  etiqueta="Contenedores despachados"
                  valor={num(actual.despachados)}
                  tono="marca"
                  nota="Del plan, con salida dentro del mes"
                  href={enlace('despachados')}
                />
                <Kpi
                  etiqueta="Pendientes"
                  valor={num(actual.pendientes)}
                  tono={actual.pendientes === 0 ? 'ok' : actual.mes_abierto ? 'atencion' : 'critico'}
                  nota={actual.mes_abierto ? 'Todavía pueden salir este mes' : 'No salieron en su mes'}
                  href={enlace('pendientes')}
                />
                <Kpi
                  etiqueta="% de cumplimiento"
                  valor={cumplimiento === null ? '—' : pct(cumplimiento)}
                  tono={tonoCumplimiento(cumplimiento)}
                  nota={`${num(actual.despachados)} de ${num(actual.planificados)} contenedores`}
                  href="#evolucion"
                />
              </RejillaKpi>
              {actual.arrastre > 0 && (
                <p className="pie-explicativo" style={{ marginTop: '.6rem' }}>
                  Además salieron{' '}
                  <Link href={enlace('arrastre')}>
                    {num(actual.arrastre)} contenedor{actual.arrastre === 1 ? '' : 'es'} planificado{actual.arrastre === 1 ? '' : 's'} para meses anteriores
                  </Link>
                  . No suman al cumplimiento de este mes: eran del plan de otro.
                </p>
              )}
            </Panel>
          </div>

          {/* ---------------- El detalle de la tarjeta ---------------- */}
          <div id="detalle">
            <Panel titulo={`${VISTAS[ver]} · ${num(detalle.length)} contenedores`} className="mb-espacio">
              <div className="atajos-fecha" style={{ marginBottom: '.5rem' }}>
                <span>Ver:</span>
                {Object.entries(VISTAS).map(([v, t]) => (
                  <Link key={v} href={enlace(v)} aria-current={v === ver ? 'page' : undefined}
                        style={v === ver ? { fontWeight: 700 } : undefined}>
                    {t}
                  </Link>
                ))}
              </div>
              {detalle.length === 0 ? (
                <Vacio titulo="Ninguno" mensaje="No hay contenedores en esta vista para el mes elegido." />
              ) : (
                <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
                  <table className="datos" data-cuadro="contenedores">
                    <thead>
                      <tr>
                        <th>Embarque</th>
                        <th className="num">Programado</th>
                        <th className="num">Salida</th>
                        <th>Proforma</th>
                        <th className="num">Creada</th>
                        <th>Cliente</th>
                        <th>Destino</th>
                        <th>Situación</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detalle.map((c) => {
                        const aEmbarque = enlaceEntidad('embarque', c.embarque_id);
                        return (
                          <tr key={c.embarque_id} data-situacion={c.situacion}>
                            <td className="mono">
                              {aEmbarque
                                ? <Link href={aEmbarque} className="enlace-ficha">{c.embarque}</Link>
                                : c.embarque}
                              {c.contenedor && (
                                <><br /><span style={{ color: 'var(--tinta-3)', fontSize: '.72rem' }}>{c.contenedor}</span></>
                              )}
                            </td>
                            <td className="num">{fecha(c.fecha_programada)}</td>
                            <td className="num">{c.fecha_salida ? fecha(c.fecha_salida) : '—'}</td>
                            <td className="mono">
                              {c.pedido_id
                                ? <Link href={`/ventas/pedidos/${c.pedido_id}`} className="enlace-ficha">{c.proformas}</Link>
                                : (c.proformas ?? '—')}
                            </td>
                            <td className="num" data-creada={creadoDeContenedor(c)}>
                              {creadoDeContenedor(c) ? fecha(creadoDeContenedor(c)) : '—'}
                            </td>
                            <td>{c.clientes ?? '—'}</td>
                            <td>{c.destino ?? '—'}</td>
                            <td>
                              {c.situacion === 'despachado' ? (
                                <Etiqueta texto="Despachado" tono="ok" />
                              ) : c.situacion === 'salio_tarde' ? (
                                <Etiqueta texto={`Salió en ${nombreMes(String(c.mes_salida).slice(0, 7)).split(' ')[0].toLowerCase()}`} tono="atencion" />
                              ) : actual.mes_abierto ? (
                                <Etiqueta texto="Por salir" tono="neutro" />
                              ) : (
                                <Etiqueta texto="No salió" tono="critico" />
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>
        </>
      )}

      {/* ---------------- La evolución ---------------- */}
      <div id="evolucion">
        <Panel titulo="Evolución mensual" className="mb-espacio">
          {meses.length === 0 ? (
            <Vacio titulo="Sin datos" mensaje="Todavía no hay contenedores en el Planificador." />
          ) : (
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos" data-cuadro="evolucion">
                <thead>
                  <tr>
                    <th>Mes</th>
                    <th className="num">Planificados</th>
                    <th className="num">Despachados</th>
                    <th className="num">Pendientes</th>
                    <th className="num">% de cumplimiento</th>
                    <th className="num">De meses anteriores</th>
                  </tr>
                </thead>
                <tbody>
                  {meses.slice(0, 12).map((m) => {
                    const c = m.cumplimiento === null ? null : Number(m.cumplimiento);
                    return (
                      <tr key={m.clave} data-mes={m.clave}>
                        <td>
                          <Link href={`/ventas/resumen?mes=${m.clave}#objetivo`} className="enlace-ficha">
                            {nombreMes(m.clave)}
                          </Link>
                          {m.mes_abierto && <> <Etiqueta texto="En curso" tono="neutro" /></>}
                        </td>
                        <td className="num">{num(m.planificados)}</td>
                        <td className="num">{num(m.despachados)}</td>
                        <td className="num">{num(m.pendientes)}</td>
                        <td className="num" style={{
                          fontWeight: 600,
                          color: c === null ? undefined
                            : `var(--${tonoCumplimiento(c) === 'atencion' ? 'atencion' : tonoCumplimiento(c) === 'ok' ? 'ok' : 'critico'})`,
                        }}>
                          {c === null ? '—' : pct(c)}
                        </td>
                        <td className="num">{m.arrastre ? num(m.arrastre) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <p className="pie-explicativo">
        Un contenedor cuenta como despachado si sale antes de que termine el mes para el que se
        planificó; si sale después, el mes no cumplió y aparece como pendiente, con la fecha en que
        salió. El plan se arma en el <Link href="/logistica/planificador">Planificador</Link>.
      </p>
    </>
  );
}
