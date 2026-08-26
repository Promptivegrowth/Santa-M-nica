/**
 * ============================================================================
 *  TRASLADOS ENTRE BODEGAS · la máquina de tres pasos
 * ============================================================================
 *  Requisito directo de Marco León en la reunión:
 *
 *    "Cuando tú haces un traslado hay un proceso de aceptación al siguiente
 *     almacén. Es en dos pasos... cambias de centro, el otro centro tiene que
 *     haber un doble paso: y el otro paso de aceptación."
 *
 *  Hoy el traslado se hace cambiando el nombre del almacén en una celda del
 *  Excel: el producto "viaja" instantáneo y nadie confirma que llegó. De ahí
 *  vienen los descuadres entre bodegas.
 *
 *  Aquí el traslado recorre TRES firmas obligatorias:
 *
 *    1. AUTORIZAR  → jefatura da el visto bueno       (rol operaciones/gerencia)
 *    2. DESPACHAR  → sale del origen y emite la guía  (rol almacén)
 *    3. ACEPTAR    → el destino confirma la recepción (jefe del almacén destino)
 *
 *  Entre el paso 2 y el 3 el producto está EN TRÁNSITO: no está en ninguna de
 *  las dos bodegas y no se puede vender. Si en destino llega menos de lo que
 *  salió, se abre una discrepancia que exige un ajuste autorizado.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { AccionesLista } from '@/components/ui/Acciones';
import { num, fecha, fechaHora, tm } from '@/lib/formato';

export const metadata: Metadata = { title: 'Traslados' };
export const dynamic = 'force-dynamic';

const PASOS: Record<string, { texto: string; tono: 'neutro' | 'info' | 'atencion' | 'ok'; paso: number }> = {
  borrador:    { texto: 'Borrador',    tono: 'neutro',   paso: 0 },
  autorizado:  { texto: 'Autorizado',  tono: 'info',     paso: 1 },
  en_transito: { texto: 'En tránsito', tono: 'atencion', paso: 2 },
  aceptado:    { texto: 'Aceptado',    tono: 'ok',       paso: 3 },
  anulado:     { texto: 'Anulado',     tono: 'neutro',   paso: -1 },
};

export default async function PaginaTraslados(props: PageProps<'/almacenes/traslados'>) {
  const q = await props.searchParams;
  const estado = (q.estado as string) ?? '';
  const supabase = await crearClienteServidor();
  await obtenerUsuarioActual();

  let consulta = supabase
    .from('traslados')
    .select('id, numero, estado, guia_numero, fecha_programada, autorizado_en, despachado_en, aceptado_en, origen:almacen_origen_id(nombre), destino:almacen_destino_id(nombre)')
    .order('creado_en', { ascending: false })
    .limit(120);
  if (estado) consulta = consulta.eq('estado', estado);

  const [{ data: filas }, { data: todos }] = await Promise.all([
    consulta,
    supabase.from('traslados').select('estado'),
  ]);

  const cuenta = (e: string) => (todos ?? []).filter((t) => t.estado === e).length;

  return (
    <>
      <CabeceraPagina
        titulo="Traslados entre bodegas"
        descripcion="Cada traslado recorre tres firmas: autorización, salida y aceptación en destino. Entre la salida y la aceptación el producto viaja y no se puede vender."
      />

      <RejillaKpi>
        <Kpi etiqueta="En borrador" valor={num(cuenta('borrador'))} href="/almacenes/traslados?estado=borrador" />
        <Kpi etiqueta="Autorizados · listos para salir" valor={num(cuenta('autorizado'))} tono="marca" href="/almacenes/traslados?estado=autorizado" />
        <Kpi etiqueta="En tránsito" valor={num(cuenta('en_transito'))} tono="atencion"
             nota="Esperan confirmación en destino" href="/almacenes/traslados?estado=en_transito" />
        <Kpi etiqueta="Aceptados" valor={num(cuenta('aceptado'))} tono="ok" href="/almacenes/traslados?estado=aceptado" />
      </RejillaKpi>

      {/* Explicación visual del recorrido */}
      <Panel titulo="Cómo funciona un traslado" className="mb-espacio">
        <ol className="pasos-traslado">
          <li><span className="pasos-num">1</span><div><strong>Autorizar</strong><span>Jefatura de operaciones aprueba el movimiento. Sin esta firma no puede salir nada.</span></div></li>
          <li><span className="pasos-num">2</span><div><strong>Despachar</strong><span>El almacén de origen ejecuta la salida y emite la guía. El stock sale del origen y pasa a tránsito.</span></div></li>
          <li><span className="pasos-num">3</span><div><strong>Aceptar</strong><span>El responsable del almacén destino confirma lo que realmente llegó. Si falta, se abre una discrepancia.</span></div></li>
        </ol>
      </Panel>

      <Panel titulo={`${(filas ?? []).length} traslados`}>
        <nav className="pestanas no-imprimir" style={{ padding: '.7rem 1rem 0', margin: 0 }}>
          <Link href="/almacenes/traslados" className="pestana" data-activa={!estado ? 'si' : 'no'}>Todos</Link>
          {Object.entries(PASOS).filter(([k]) => k !== 'anulado').map(([k, v]) => (
            <Link key={k} href={`/almacenes/traslados?estado=${k}`} className="pestana" data-activa={estado === k ? 'si' : 'no'}>
              {v.texto}
            </Link>
          ))}
        </nav>

        {(filas ?? []).length === 0 ? (
          <Vacio titulo="Sin traslados" mensaje="No hay traslados en este estado." />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0, marginTop: '.7rem' }}>
            <table className="datos">
              <thead>
                <tr>
                  <th>Traslado</th><th>Recorrido</th><th>Guía</th><th>Estado</th>
                  <th>Autorizado</th><th>Despachado</th><th>Aceptado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {(filas ?? []).map((t) => {
                  const p = PASOS[t.estado as string] ?? PASOS.borrador;
                  const org = Array.isArray(t.origen) ? t.origen[0] : t.origen;
                  const dst = Array.isArray(t.destino) ? t.destino[0] : t.destino;
                  return (
                    <tr key={t.id as number}>
                      <td className="mono">
                        <Link href={`/almacenes/traslados/${t.id}`} className="enlace-ficha">
                          {t.numero as string}
                        </Link>
                      </td>
                      <td style={{ fontSize: '.8rem' }}>
                        {org?.nombre ?? '—'} <span style={{ color: 'var(--tinta-3)' }}>→</span> {dst?.nombre ?? '—'}
                      </td>
                      <td className="mono">{(t.guia_numero as string) ?? '—'}</td>
                      <td>
                        <Etiqueta texto={p.texto} tono={p.tono} />
                        <br />
                        <span className="pasos-mini" aria-hidden>
                          {[1, 2, 3].map((n) => (
                            <i key={n} data-hecho={p.paso >= n ? 'si' : 'no'} />
                          ))}
                        </span>
                      </td>
                      <td className="mono" style={{ fontSize: '.72rem' }}>{t.autorizado_en ? fechaHora(t.autorizado_en as string) : '—'}</td>
                      <td className="mono" style={{ fontSize: '.72rem' }}>{t.despachado_en ? fechaHora(t.despachado_en as string) : '—'}</td>
                      <td className="mono" style={{ fontSize: '.72rem' }}>{t.aceptado_en ? fechaHora(t.aceptado_en as string) : '—'}</td>
                      <td>
                        <AccionesLista
                          ver={`/almacenes/traslados/${t.id}`}
                          verTitulo={`Ver el traslado ${t.numero}`}
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

      <p className="pie-explicativo">
        Las tres fechas de la derecha son las <strong>tres firmas</strong>. Un traslado con la
        segunda fecha puesta y la tercera vacía es producto que salió y nadie confirmó: por eso el
        sistema genera una alerta crítica cuando eso lleva demasiados días.
      </p>
    </>
  );
}
