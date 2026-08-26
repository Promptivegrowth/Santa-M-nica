/**
 * ============================================================================
 *  PLANIFICADOR DE EMBARQUES · el calendario de salidas
 * ============================================================================
 *  Muestra qué sale cada día, desde qué bodega y hacia qué destino.
 *
 *  Dos reglas del negocio quedan visibles aquí:
 *   · Se opera de lunes a sábado. El domingo se puede despachar, pero tiene un
 *     sobrecosto (ambas cosas son parámetros configurables).
 *   · Hay un tope de almacenes despachando en simultáneo. Oliver indicó que
 *     cuatro ya es el límite práctico; el sistema avisa cuando se supera.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor } from '@/lib/supabase/servidor';
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { num, fecha } from '@/lib/formato';

export const metadata: Metadata = { title: 'Planificador' };
export const dynamic = 'force-dynamic';

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export default async function PaginaPlanificador(props: PageProps<'/logistica/planificador'>) {
  const q = await props.searchParams;
  const supabase = await crearClienteServidor();

  // Ventana por defecto: desde hace una semana y hacia adelante un mes
  const hoy = new Date();
  const desde = (q.desde as string) ?? new Date(hoy.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const hasta = (q.hasta as string) ?? new Date(hoy.getTime() + 30 * 86400000).toISOString().slice(0, 10);

  const [{ data: embarques }, { data: params }] = await Promise.all([
    supabase
      .from('embarques')
      .select('id, numero, fecha_programada, estado, booking, naviera, almacenes(nombre), destinos(puerto, pais)')
      .gte('fecha_programada', desde).lte('fecha_programada', hasta)
      .order('fecha_programada'),
    supabase.from('parametros').select('clave, valor')
      .in('clave', ['despachos_simultaneos_max', 'recargo_domingo_pct']),
  ]);

  const topeSimultaneo = Number(params?.find((p) => p.clave === 'despachos_simultaneos_max')?.valor ?? 4);
  const recargoDomingo = Number(params?.find((p) => p.clave === 'recargo_domingo_pct')?.valor ?? 35);

  /* ---- Agrupamos por día ---- */
  const porDia = new Map<string, typeof embarques>();
  for (const e of embarques ?? []) {
    const d = e.fecha_programada as string;
    if (!porDia.has(d)) porDia.set(d, []);
    porDia.get(d)!.push(e);
  }
  const dias = [...porDia.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const totalEmbarques = (embarques ?? []).length;
  const diasConSobrecarga = dias.filter(([, lista]) => {
    const bodegas = new Set(lista!.map((e) => {
      const a = Array.isArray(e.almacenes) ? e.almacenes[0] : e.almacenes;
      return a?.nombre;
    }));
    return bodegas.size > topeSimultaneo;
  }).length;
  const domingos = dias.filter(([d]) => new Date(d + 'T12:00:00').getDay() === 0).length;

  return (
    <>
      <CabeceraPagina
        titulo="Planificador de embarques"
        descripcion={`Agenda de salidas. El tope de bodegas despachando a la vez está en ${topeSimultaneo}; despachar en domingo tiene un recargo de ${recargoDomingo} %.`}
      >
        <Link href="/logistica/embarques" className="btn btn-secundario">Ver lista completa</Link>
      </CabeceraPagina>

      <RejillaKpi>
        <Kpi etiqueta="Embarques en la ventana" valor={num(totalEmbarques)} nota={`${fecha(desde)} a ${fecha(hasta)}`} />
        <Kpi etiqueta="Días programados" valor={num(dias.length)} />
        <Kpi etiqueta="Días sobre el tope simultáneo" valor={num(diasConSobrecarga)}
             tono={diasConSobrecarga > 0 ? 'atencion' : 'ok'} nota={`Más de ${topeSimultaneo} bodegas a la vez`} />
        <Kpi etiqueta="Salidas en domingo" valor={num(domingos)}
             tono={domingos > 0 ? 'atencion' : 'ok'} nota="Con sobrecosto" />
      </RejillaKpi>

      <Panel titulo="Agenda">
        {dias.length === 0 ? (
          <Vacio titulo="Sin embarques programados" mensaje="No hay salidas en el rango de fechas seleccionado." />
        ) : (
          <div className="agenda">
            {dias.map(([dia, lista]) => {
              const fechaDia = new Date(dia + 'T12:00:00');
              const esDomingo = fechaDia.getDay() === 0;
              const bodegas = new Set(lista!.map((e) => {
                const a = Array.isArray(e.almacenes) ? e.almacenes[0] : e.almacenes;
                return a?.nombre;
              }));
              const sobrecarga = bodegas.size > topeSimultaneo;
              return (
                <div key={dia} className="agenda-dia" data-domingo={esDomingo ? 'si' : 'no'}>
                  <div className="agenda-cabecera">
                    <div>
                      <strong>{DIAS[fechaDia.getDay()]}</strong>
                      <span className="mono">{fecha(dia)}</span>
                    </div>
                    <div className="agenda-marcas">
                      {esDomingo && <Etiqueta texto={`Domingo · +${recargoDomingo}%`} tono="atencion" />}
                      {sobrecarga && <Etiqueta texto={`${bodegas.size} bodegas a la vez`} tono="critico" />}
                      <span className="agenda-conteo">{lista!.length} embarque{lista!.length === 1 ? '' : 's'}</span>
                    </div>
                  </div>
                  <ul className="agenda-lista">
                    {lista!.map((e) => {
                      const alm = Array.isArray(e.almacenes) ? e.almacenes[0] : e.almacenes;
                      const dst = Array.isArray(e.destinos) ? e.destinos[0] : e.destinos;
                      return (
                        <li key={e.id as number}>
                          <Link href={`/logistica/embarques?buscar=${e.numero}`} className="enlace-dato">
                            {e.numero as string}
                          </Link>
                          <span className="agenda-ruta">
                            {alm?.nombre ?? '—'} → {dst?.puerto ?? '—'}{dst?.pais ? `, ${dst.pais}` : ''}
                          </span>
                          <Etiqueta
                            texto={String(e.estado).replace('_', ' ')}
                            tono={e.estado === 'despachado' ? 'ok' : e.estado === 'planificado' ? 'neutro' : 'info'}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </>
  );
}
