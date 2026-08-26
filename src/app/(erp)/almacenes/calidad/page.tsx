/**
 * ============================================================================
 *  CALIDAD · producto observado y liberado
 * ============================================================================
 *  De la reunión con Oliver Tello:
 *
 *    "Tenemos dos condiciones: observado y liberado. Pero en observado puede
 *     haber múltiples motivos: normativos, microbiológicos, fisicoquímicos u
 *     organolépticos."
 *
 *  Y sobre el sustento documental:
 *
 *    "Actualmente no se carga nada, pero sí deberíamos tener un PDF."
 *
 *  Aquí cada dictamen lleva su motivo tipificado, su responsable y su sustento.
 *  Un lote observado NO se puede reservar ni despachar: la base de datos lo
 *  impide, no la pantalla.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor } from '@/lib/supabase/servidor';
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { AccionesLista } from '@/components/ui/Acciones';
import { GraficoBarras } from '@/components/graficos/Graficos';
import { num, tm, fechaHora, etiquetaEstado } from '@/lib/formato';

export const metadata: Metadata = { title: 'Calidad' };
export const dynamic = 'force-dynamic';

const TONO: Record<string, 'ok' | 'atencion' | 'critico' | 'neutro'> = {
  liberado: 'ok', observado: 'atencion', inmovilizado: 'critico', espera_resultados: 'neutro',
};

export default async function PaginaCalidad(props: PageProps<'/almacenes/calidad'>) {
  const q = await props.searchParams;
  const estado = (q.estado as string) ?? '';
  const supabase = await crearClienteServidor();

  let consulta = supabase
    .from('dictamenes_calidad')
    .select('id, tipo, estado, motivo_texto, sustento_url, emitido_en, liberado_en, vigente, lotes(id, codigo_pallet, fecha_produccion), usuarios!dictamenes_calidad_emitido_por_fkey(nombre)')
    .eq('vigente', true)
    .order('emitido_en', { ascending: false })
    .limit(150);
  if (estado) consulta = consulta.eq('estado', estado);

  const [{ data: filas }, { data: todos }, { data: bloqueadoTm }] = await Promise.all([
    consulta,
    supabase.from('dictamenes_calidad').select('estado, motivo_texto').eq('vigente', true),
    supabase.from('v_resumen_inventario').select('bloqueado_kg').single(),
  ]);

  const cuenta = (e: string) => (todos ?? []).filter((d) => d.estado === e).length;

  // Motivos más frecuentes de observación
  const porMotivo = new Map<string, number>();
  for (const d of todos ?? []) {
    if (d.estado === 'liberado' || !d.motivo_texto) continue;
    porMotivo.set(d.motivo_texto as string, (porMotivo.get(d.motivo_texto as string) ?? 0) + 1);
  }
  const motivos = [...porMotivo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([etiqueta, valor]) => ({ etiqueta, valor }));

  return (
    <>
      <CabeceraPagina
        titulo="Calidad"
        descripcion="Dictámenes sanitarios por lote. Un lote observado no se puede reservar ni despachar: la restricción está en la base de datos."
      />

      <RejillaKpi>
        <Kpi etiqueta="Toneladas bloqueadas" valor={tm(bloqueadoTm?.bloqueado_kg ?? 0)} sufijo="TM" tono="critico" />
        <Kpi etiqueta="Observados" valor={num(cuenta('observado'))} tono="atencion" href="/almacenes/calidad?estado=observado" />
        <Kpi etiqueta="Inmovilizados" valor={num(cuenta('inmovilizado'))} tono="critico" href="/almacenes/calidad?estado=inmovilizado" />
        <Kpi etiqueta="Esperando resultados" valor={num(cuenta('espera_resultados'))} tono="neutro" href="/almacenes/calidad?estado=espera_resultados" />
        <Kpi etiqueta="Liberados" valor={num(cuenta('liberado'))} tono="ok" href="/almacenes/calidad?estado=liberado" />
      </RejillaKpi>

      {motivos.length > 0 && (
        <Panel titulo="Motivos de observación más frecuentes" className="mb-espacio">
          <GraficoBarras
            datos={motivos}
            formato="entero" sufijo="lotes"
            horizontal
            altura={190}
          />
        </Panel>
      )}

      <Panel titulo={`${(filas ?? []).length} dictámenes vigentes`}>
        {(filas ?? []).length === 0 ? (
          <Vacio titulo="Sin dictámenes" mensaje="No hay dictámenes con este filtro." />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos">
              <thead>
                <tr><th>Estado</th><th>Lote</th><th>Tipo de evaluación</th><th>Motivo</th><th>Sustento</th><th>Emitió</th><th className="num">Fecha</th><th>Acciones</th></tr>
              </thead>
              <tbody>
                {(filas ?? []).map((d) => {
                  const lote = Array.isArray(d.lotes) ? d.lotes[0] : d.lotes;
                  const usr = Array.isArray(d.usuarios) ? d.usuarios[0] : d.usuarios;
                  return (
                    <tr key={d.id as number}>
                      <td><Etiqueta texto={etiquetaEstado(d.estado as string)} tono={TONO[d.estado as string] ?? 'neutro'} /></td>
                      <td className="mono">
                        {lote ? (
                          <Link href={`/almacenes/lotes/${lote.id}`} className="enlace-ficha">
                            {String(lote.codigo_pallet)}
                          </Link>
                        ) : '—'}
                      </td>
                      <td>{etiquetaEstado(d.tipo as string)}</td>
                      <td style={{ fontSize: '.8rem' }}>{(d.motivo_texto as string) ?? '—'}</td>
                      <td>
                        {d.sustento_url
                          ? <Etiqueta texto="PDF adjunto" tono="ok" />
                          : <Etiqueta texto="Sin sustento" tono="atencion" />}
                      </td>
                      <td style={{ fontSize: '.78rem', color: 'var(--tinta-3)' }}>{usr?.nombre ?? '—'}</td>
                      <td className="num" style={{ fontSize: '.72rem' }}>{fechaHora(d.emitido_en as string)}</td>
                      <td>
                        {/* El dictamen no tiene ficha propia: lo que hace falta
                            revisar es el LOTE al que se le puso la observación. */}
                        <AccionesLista
                          ver={lote ? `/almacenes/lotes/${lote.id}` : null}
                          verTitulo="Ver el lote dictaminado"
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
        Los cuatro tipos de evaluación (<strong>calidad</strong>, <strong>microbiología</strong>,{' '}
        <strong>cámara</strong> y <strong>producto terminado</strong>) son independientes, igual que
        en el registro actual. Basta que uno esté abierto para que el lote quede bloqueado.
      </p>
    </>
  );
}
