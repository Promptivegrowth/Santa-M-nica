/**
 * ============================================================================
 *  ALERTAS · lo que el sistema detectó y necesita a alguien
 * ============================================================================
 *  Estas alertas NO están escritas en el código: las genera el motor de reglas
 *  a partir de condiciones que el propio cliente define desde Configuración.
 *
 *  Ejemplos de las que vienen activas de fábrica:
 *   · Lote con más de 12 meses en cámara (el umbral es configurable).
 *   · Reserva vencida que sigue bloqueando stock.
 *   · Traslado que salió y nadie confirmó en destino.
 *   · Factura vencida.
 *   · SOAT de un vehículo por caducar.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor } from '@/lib/supabase/servidor';
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { Filtros, Paginacion } from '@/components/ui/Filtros';
import { num, fechaHora, haceTiempo } from '@/lib/formato';

export const metadata: Metadata = { title: 'Alertas' };
export const dynamic = 'force-dynamic';
const POR_PAGINA = 40;

export default async function PaginaAlertas(props: PageProps<'/alertas'>) {
  const q = await props.searchParams;
  const supabase = await crearClienteServidor();

  const pagina = Math.max(1, Number(q.pagina ?? 1));
  const severidad = (q.severidad as string) ?? '';
  const entidad = (q.entidad as string) ?? '';

  let consulta = supabase.from('alertas').select('*', { count: 'exact' }).eq('atendida', false);
  if (severidad) consulta = consulta.eq('severidad', severidad);
  if (entidad) consulta = consulta.eq('entidad', entidad);

  const [{ data: filas, count }, { data: todas }] = await Promise.all([
    consulta.order('severidad', { ascending: false })
            .order('generada_en', { ascending: false })
            .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1),
    supabase.from('alertas').select('severidad, entidad').eq('atendida', false),
  ]);

  const criticas = (todas ?? []).filter((a) => a.severidad === 'critica').length;
  const avisos = (todas ?? []).filter((a) => a.severidad === 'advertencia').length;
  const entidades = [...new Set((todas ?? []).map((a) => a.entidad as string))];

  return (
    <>
      <CabeceraPagina
        titulo="Alertas"
        descripcion="Situaciones que el sistema detectó por sí solo. Cada una nace de una regla configurable, no de código fijo."
      >
        <Link href="/configuracion?t=reglas" className="btn btn-secundario">Configurar reglas</Link>
      </CabeceraPagina>

      <RejillaKpi>
        <Kpi etiqueta="Total pendientes" valor={num((todas ?? []).length)} />
        <Kpi etiqueta="Críticas" valor={num(criticas)} tono={criticas > 0 ? 'critico' : 'ok'} nota="Requieren acción hoy" />
        <Kpi etiqueta="Advertencias" valor={num(avisos)} tono={avisos > 0 ? 'atencion' : 'ok'} nota="Conviene revisarlas" />
      </RejillaKpi>

      <Panel titulo={`${num(count ?? 0)} alertas sin atender`}>
        <Filtros
          campos={[
            { tipo: 'select', clave: 'severidad', etiqueta: 'Severidad',
              opciones: [
                { valor: 'critica', texto: 'Crítica' },
                { valor: 'advertencia', texto: 'Advertencia' },
                { valor: 'info', texto: 'Informativa' },
              ] },
            { tipo: 'select', clave: 'entidad', etiqueta: 'Sobre qué',
              opciones: entidades.map((e) => ({ valor: e, texto: e })) },
          ]}
        />

        {(filas ?? []).length === 0 ? (
          <Vacio titulo="Todo en orden" mensaje="No hay alertas pendientes con estos filtros." />
        ) : (
          <>
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos">
                <thead>
                  <tr><th>Severidad</th><th>Situación</th><th>Detalle</th><th>Sobre</th><th className="num">Detectada</th></tr>
                </thead>
                <tbody>
                  {(filas ?? []).map((a) => (
                    <tr key={a.id as number}>
                      <td>
                        <Etiqueta
                          texto={a.severidad === 'critica' ? 'Crítica' : a.severidad === 'advertencia' ? 'Atención' : 'Info'}
                          tono={a.severidad === 'critica' ? 'critico' : a.severidad === 'advertencia' ? 'atencion' : 'info'}
                        />
                      </td>
                      <td><strong style={{ fontWeight: 600 }}>{a.titulo as string}</strong></td>
                      <td style={{ fontSize: '.8rem', color: 'var(--tinta-2)', maxWidth: '38rem' }}>{a.mensaje as string}</td>
                      <td style={{ fontSize: '.76rem', color: 'var(--tinta-3)' }}>{a.entidad as string}</td>
                      <td className="num" title={fechaHora(a.generada_en as string)}>{haceTiempo(a.generada_en as string)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Paginacion pagina={pagina} porPagina={POR_PAGINA} total={count ?? 0} />
          </>
        )}
      </Panel>
    </>
  );
}
