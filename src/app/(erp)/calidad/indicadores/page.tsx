/**
 * ============================================================================
 *  INDICADORES DE RECLAMOS (090, M5 · plus de la propuesta)
 * ============================================================================
 *  Reclamos por motivo, por cliente, por estado y por clasificación; tiempo
 *  promedio de cierre; cuántos se cerraron dentro del plazo y cuántos están
 *  vencidos. Todo filtrable por fecha de registro y exportable a Excel.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel, Vacio, RejillaKpi, Kpi, Barra } from '@/components/ui/Pagina';
import { Filtros } from '@/components/ui/Filtros';
import { num, pct } from '@/lib/formato';
import { cargarReclamos, ESTADOS_RECLAMO, type FilaReclamo } from '@/lib/reclamos';

export const metadata: Metadata = { title: 'Indicadores de reclamos' };
export const dynamic = 'force-dynamic';

type Grupo = { clave: string; total: number; abiertos: number; cerrados: number; vencidos: number; diasCierre: number | null };

function agrupar(filas: FilaReclamo[], clave: (r: FilaReclamo) => string): Grupo[] {
  const mapa = new Map<string, FilaReclamo[]>();
  for (const r of filas) {
    const k = clave(r);
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k)!.push(r);
  }
  return [...mapa.entries()].map(([k, lista]) => {
    const cerrados = lista.filter((r) => r.dias_cierre !== null);
    return {
      clave: k,
      total: lista.length,
      abiertos: lista.length - cerrados.length,
      cerrados: cerrados.length,
      vencidos: lista.filter((r) => r.semaforo === 'vencido').length,
      diasCierre: cerrados.length ? cerrados.reduce((s, r) => s + (r.dias_cierre ?? 0), 0) / cerrados.length : null,
    };
  }).sort((a, b) => b.total - a.total);
}

function TablaGrupo({ titulo, grupos, total }: { titulo: string; grupos: Grupo[]; total: number }) {
  return (
    <Panel titulo={titulo} className="mb-espacio">
      {grupos.length === 0 ? <Vacio titulo="Sin datos" /> : (
        <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
          <table className="datos">
            <thead>
              <tr><th>{titulo.replace(/^Por /, '').replace(/^./, (c) => c.toUpperCase())}</th><th className="num">Reclamos</th><th>Participación</th>
                <th className="num">Abiertos</th><th className="num">Vencidos</th><th className="num">Días prom. de cierre</th></tr>
            </thead>
            <tbody>
              {grupos.map((g) => (
                <tr key={g.clave}>
                  <td>{g.clave}</td>
                  <td className="num">{num(g.total)}</td>
                  <td style={{ minWidth: '7rem' }}><Barra porcentaje={total ? (g.total / total) * 100 : 0} /></td>
                  <td className="num">{num(g.abiertos)}</td>
                  <td className="num" style={g.vencidos ? { color: 'var(--critico)', fontWeight: 600 } : undefined}>{num(g.vencidos)}</td>
                  <td className="num">{g.diasCierre === null ? '—' : g.diasCierre.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export default async function IndicadoresReclamos(props: PageProps<'/calidad/indicadores'>) {
  const q = await props.searchParams;
  const desde = typeof q.desde === 'string' ? q.desde : '';
  const hasta = typeof q.hasta === 'string' ? q.hasta : '';

  const supabase = await crearClienteServidor();
  const { filas, error } = await cargarReclamos(supabase, { desde, hasta });

  const total = filas.length;
  const cerrados = filas.filter((r) => r.dias_cierre !== null);
  const conPlazo = cerrados.filter((r) => r.cerrado_en_plazo !== null);
  const enPlazo = conPlazo.filter((r) => r.cerrado_en_plazo).length;
  const vencidos = filas.filter((r) => r.semaforo === 'vencido').length;
  const promedio = cerrados.length ? cerrados.reduce((s, r) => s + (r.dias_cierre ?? 0), 0) / cerrados.length : null;

  const excel = `/api/reclamos/excel?${new URLSearchParams({ ...(desde ? { desde } : {}), ...(hasta ? { hasta } : {}) })}`;

  return (
    <>
      <CabeceraPagina
        titulo="Indicadores de reclamos"
        descripcion="Cuántos reclamos llegan, por qué motivo y de qué clientes, y cuánto tarda Calidad en cerrarlos."
        volver={{ href: '/calidad/reclamos', texto: 'Volver a la bandeja' }}
      >
        <a href={excel} className="btn btn-secundario" data-accion="exportar-reclamos">Exportar a Excel</a>
      </CabeceraPagina>

      <Panel>
        <Filtros campos={[
          { tipo: 'fecha', clave: 'desde', etiqueta: 'Registrados desde' },
          { tipo: 'fecha', clave: 'hasta', etiqueta: 'Hasta' },
        ]} />
      </Panel>

      {error ? (
        <Vacio titulo="Todavía no está activado" mensaje="Los indicadores de reclamos necesitan la migración 090 en la base. Avise a sistemas." />
      ) : (
        <>
          <RejillaKpi>
            <Kpi etiqueta="Reclamos" valor={num(total)} tono="marca" href="/calidad/reclamos" />
            <Kpi etiqueta="Cerrados" valor={num(cerrados.length)} tono="ok" nota={total ? `${pct((cerrados.length / total) * 100, 0)} del total` : undefined} />
            <Kpi etiqueta="Días promedio de cierre" valor={promedio === null ? '—' : promedio.toFixed(1)} tono="neutro" />
            <Kpi etiqueta="Cerrados en plazo" valor={conPlazo.length ? pct((enPlazo / conPlazo.length) * 100, 0) : '—'}
                 tono={conPlazo.length && enPlazo / conPlazo.length < 0.8 ? 'atencion' : 'ok'}
                 nota={`${num(enPlazo)} de ${num(conPlazo.length)} con plazo`} />
            <Kpi etiqueta="Vencidos abiertos" valor={num(vencidos)} tono={vencidos ? 'critico' : 'ok'} href="/calidad/reclamos?estado=abiertos" />
          </RejillaKpi>

          <div>
            <TablaGrupo titulo="Por motivo" grupos={agrupar(filas, (r) => r.motivo)} total={total} />
            <TablaGrupo titulo="Por cliente" grupos={agrupar(filas, (r) => r.cliente)} total={total} />
            <TablaGrupo titulo="Por estado" grupos={agrupar(filas, (r) => ESTADOS_RECLAMO[r.estado] ?? r.estado)} total={total} />
            <TablaGrupo titulo="Por clasificación" grupos={agrupar(filas, (r) => r.clasificacion ?? 'Sin clasificar')} total={total} />
          </div>
          {total === 0 && (
            <p style={{ color: 'var(--tinta-3)', fontSize: '.85rem' }}>
              Aún no hay reclamos en este periodo. Llegan desde el portal de clientes; vea la <Link href="/calidad/reclamos" className="enlace-ficha">bandeja</Link>.
            </p>
          )}
        </>
      )}
    </>
  );
}
