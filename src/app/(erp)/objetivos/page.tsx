/**
 * ============================================================================
 *  OBJETIVOS MENSUALES · «Compromisos para el éxito»
 * ============================================================================
 *  El Excel «Objetivos 2026» de Oliver, dentro del sistema:
 *    · lo que el ERP ya sabe lo pone el ERP (producción, embarques,
 *      inventario…); Oliver digita el resto, como hacía;
 *    · cada mes y el año tienen meta esperada y máxima, con semáforo;
 *    · los ratios se calculan solos y bien —los del Excel tenían totales mal
 *      armados—;
 *    · todo cambio queda en el historial;
 *    · se exporta a Excel con los mismos filtros de la pantalla.
 *
 *  Lo ven Marco y Oliver y nadie más: permiso personal, impuesto en la base
 *  (migración 060). Esta pantalla redirige a cualquier otro.
 * ============================================================================
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio } from '@/components/ui/Pagina';
import { Filtros } from '@/components/ui/Filtros';
import { Icono } from '@/components/estructura/Icono';
import { hoyEnLima } from '@/lib/fechas';
import { num, fechaHora } from '@/lib/formato';
import { NOMBRE_MES, TEXTO_ESTADO, type Celda, type FilaTablero } from '@/lib/objetivos';
import { cargarTablero, filtrar, leerFiltros, mesDeReferencia, aConsulta } from '@/lib/objetivosDatos';
import { uno } from '@/lib/relaciones';
import { CeldaValor, CeldaMeta } from './Celdas';

export const metadata: Metadata = { title: 'Objetivos mensuales' };
export const dynamic = 'force-dynamic';

const MES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];
const TIPO: Record<string, string> = { manual: 'se digita', erp: 'del ERP', calculado: 'calculado' };
const SENTIDO: Record<string, string> = { menor: '↓ menos es mejor', mayor: '↑ más es mejor', informativo: 'sin semáforo' };

/** El número con los decimales de su indicador. */
const cifra = (v: number | null, dec: number) => (v === null ? '—' : num(v, dec));
const lineaMeta = (c: Celda, dec: number) =>
  c.esperado === null && c.maximo === null ? null
    : `esp. ${cifra(c.esperado, dec)} · máx. ${cifra(c.maximo, dec)}${c.metaDelAnio ? ' (año)' : ''}`;

export default async function PaginaObjetivos(props: PageProps<'/objetivos'>) {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) redirect('/login');
  if (usuario.ve_objetivos !== true) redirect(`/panel?sinacceso=${encodeURIComponent('/objetivos')}`);

  const q = await props.searchParams;
  const hoy = hoyEnLima();
  const anioActual = Number(hoy.slice(0, 4));
  /*
   * El año va siempre en la dirección: los filtros solo conservan sus propios
   * campos, y un selector de año que dijera «Todos» mientras enseña 2026
   * confundiría.
   */
  if (!q.anio) {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => typeof v === 'string') as [string, string][]);
    p.set('anio', String(anioActual));
    redirect(`/objetivos?${p.toString()}`);
  }
  const f = leerFiltros(q, anioActual);
  const historialDe = Number(q.historial ?? 0) || null;

  const supabase = await crearClienteServidor();
  let consultaHist = supabase.from('objetivos_historial')
    .select('id, que, indicador_id, anio, mes, antes, despues, usuario_nombre, registrado_en, objetivos_indicadores(nombre)')
    .order('registrado_en', { ascending: false }).order('id', { ascending: false });
  consultaHist = historialDe ? consultaHist.eq('indicador_id', historialDe).limit(200) : consultaHist.limit(30);

  const [{ filas, tipoCambio, erpDesde }, { data: historial }] = await Promise.all([
    cargarTablero(supabase, f.anio),
    consultaHist,
  ]);

  const visibles = filtrar(filas, f);
  const bloques = [...new Set(filas.map((x) => x.indicador.bloque))];
  const meses = Array.from({ length: f.hasta - f.desde + 1 }, (_, k) => f.desde + k);

  /* ---- Las tarjetas: el último mes con datos del rango ---- */
  const ref = mesDeReferencia(filas, f);
  const alcance = filtrar(filas, { ...f, estado: '' });
  const enRef = (fila: FilaTablero) => (ref ? fila.meses[ref - 1] : null);
  const contar = (pred: (c: Celda) => boolean) => alcance.filter((x) => { const c = enRef(x); return !!c && pred(c); }).length;
  const cumplen = contar((c) => c.estado === 'cumple' || c.estado === 'supera');
  const alertas = contar((c) => c.estado === 'alerta');
  const fallan = contar((c) => c.estado === 'no_cumple');
  const sinMeta = alcance.filter((x) => x.indicador.sentido !== 'informativo' && (() => {
    const c = enRef(x); return !!c && c.esperado === null && c.maximo === null;
  })()).length;
  const enlaceRef = (estado: string) => `/objetivos?${aConsulta(f, { estado, desde: ref ?? f.desde, hasta: ref ?? f.hasta })}#tabla`;

  const anios = Array.from({ length: anioActual - 2026 + 2 }, (_, k) => 2026 + k);

  return (
    <>
      <CabeceraPagina
        titulo="Objetivos mensuales"
        descripcion="Compromisos para el éxito: los indicadores de la operación mes a mes, contra su meta esperada y máxima. Solo lo ven las personas autorizadas."
      >
        <a href={`/api/objetivos/excel?${aConsulta(f)}`} className="btn btn-secundario" data-accion="exportar">
          <Icono nombre="descargar" tamano={15} />
          Exportar a Excel
        </a>
      </CabeceraPagina>

      <RejillaKpi>
        <Kpi etiqueta="Cumplen" valor={num(cumplen)} tono={cumplen > 0 ? 'ok' : 'neutro'}
             nota={ref ? `en ${MES_LARGO[ref - 1]}` : 'sin datos en el rango'} href={enlaceRef('cumple')} />
        <Kpi etiqueta="En alerta" valor={num(alertas)} tono={alertas > 0 ? 'atencion' : 'ok'}
             nota="entre el esperado y el máximo" href={enlaceRef('alerta')} />
        <Kpi etiqueta="No cumplen" valor={num(fallan)} tono={fallan > 0 ? 'critico' : 'ok'}
             nota={ref ? `en ${MES_LARGO[ref - 1]}` : '—'} href={enlaceRef('no_cumple')} />
        <Kpi etiqueta="Sin meta" valor={num(sinMeta)} tono={sinMeta > 0 ? 'atencion' : 'ok'}
             nota="indicadores con semáforo y sin meta" href={`/objetivos?${aConsulta(f, { estado: 'sin_meta', vista: 'metas' })}#tabla`} />
      </RejillaKpi>

      <Panel titulo="Filtrar" className="mb-espacio">
        <Filtros
          campos={[
            { tipo: 'select', clave: 'anio', etiqueta: 'Año', opciones: anios.map((a) => ({ valor: String(a), texto: String(a) })) },
            { tipo: 'select', clave: 'bloque', etiqueta: 'Bloque', opciones: bloques.map((b) => ({ valor: b, texto: b })) },
            { tipo: 'texto', clave: 'buscar', etiqueta: 'Indicador', ancho: '12rem' },
            {
              tipo: 'select', clave: 'estado', etiqueta: 'Semáforo',
              opciones: [
                { valor: 'cumple', texto: 'Cumple o supera' },
                { valor: 'alerta', texto: 'En alerta' },
                { valor: 'no_cumple', texto: 'No cumple' },
                { valor: 'sin_meta', texto: 'Sin meta' },
              ],
            },
            { tipo: 'select', clave: 'desde', etiqueta: 'Desde', opciones: NOMBRE_MES.map((m, k) => ({ valor: String(k + 1), texto: m })) },
            { tipo: 'select', clave: 'hasta', etiqueta: 'Hasta', opciones: NOMBRE_MES.map((m, k) => ({ valor: String(k + 1), texto: m })) },
            {
              tipo: 'select', clave: 'vista', etiqueta: 'Ver',
              opciones: [
                { valor: 'metas', texto: 'Metas (editar)' },
                { valor: 'completo', texto: 'Real y metas' },
              ],
            },
          ]}
        />
      </Panel>

      <Panel id="tabla" titulo={`${num(visibles.length)} indicadores · ${f.anio} · ${NOMBRE_MES[f.desde - 1]} a ${NOMBRE_MES[f.hasta - 1]}${f.vista === 'metas' ? ' · editando metas' : ''}`} className="mb-espacio">
        {visibles.length === 0 ? (
          <Vacio titulo="Ningún indicador" mensaje="No hay indicadores con estos filtros." />
        ) : (
          <div className="tabla-envoltorio obj-tabla" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos" data-cuadro="objetivos">
              <thead>
                <tr>
                  <th className="obj-nombre">Indicador</th>
                  <th>Und.</th>
                  {meses.map((m) => <th key={m} className="num">{NOMBRE_MES[m - 1]}</th>)}
                  <th className="num">Año {f.anio}</th>
                </tr>
              </thead>
              <tbody>
                {bloques.filter((b) => visibles.some((x) => x.indicador.bloque === b)).map((b) => (
                  <FilasBloque key={b} bloque={b} filas={visibles.filter((x) => x.indicador.bloque === b)}
                               meses={meses} f={f} columnas={meses.length + 3} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="obj-leyenda" style={{ padding: '.7rem 1rem' }}>
          <span><i data-estado="supera" /> Supera el máximo</span>
          <span><i data-estado="cumple" /> Cumple</span>
          <span><i data-estado="alerta" /> Entre esperado y máximo</span>
          <span><i data-estado="no_cumple" /> No cumple</span>
          <span><b className="obj-origen">ERP</b> lo pone el sistema</span>
          <span><b className="obj-origen" data-origen="ajuste">EXCEL</b> dato del Excel que manda sobre el cálculo</span>
        </div>
        <p className="pie-explicativo" style={{ padding: '0 1rem .8rem' }}>
          En los costos, cumplir es quedar <strong>por debajo</strong> del esperado; pasar el máximo es no
          cumplir. En los volúmenes es al revés. Un mes sin meta propia usa la del año si el indicador es un
          ratio, un precio o un saldo; los que se suman (toneladas, soles) necesitan su meta del mes. Los
          ratios del año se calculan sobre las sumas del año, no promediando meses. Soles a dólares con el
          tipo de cambio fijo de {num(tipoCambio, 2)} (Configuración → Parámetros). El ERP alimenta sus
          indicadores desde {erpDesde || '—'}; antes, manda el histórico del Excel.
        </p>
      </Panel>

      <Panel id="historial" titulo={historialDe ? 'Historial del indicador' : 'Últimos cambios'} className="mb-espacio">
        {historialDe && (
          <div className="atajos-fecha" style={{ margin: '.5rem 1rem' }}>
            <Link href={`/objetivos?${aConsulta(f)}#historial`} className="atajo-limpiar">Ver todos los cambios</Link>
          </div>
        )}
        {(historial ?? []).length === 0 ? (
          <Vacio titulo="Sin cambios" mensaje="Todavía no se ha registrado nada." />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos" data-cuadro="historial">
              <thead>
                <tr><th>Fecha</th><th>Usuario</th><th>Indicador</th><th>Qué</th><th className="num">Mes</th><th>Antes</th><th>Después</th></tr>
              </thead>
              <tbody>
                {(historial ?? []).map((h) => (
                  <tr key={h.id as number}>
                    <td style={{ fontSize: '.74rem', whiteSpace: 'nowrap' }}>{fechaHora(h.registrado_en as string)}</td>
                    <td>{(h.usuario_nombre as string) ?? '—'}</td>
                    <td>
                      <Link href={`/objetivos?${aConsulta(f)}&historial=${h.indicador_id}#historial`} className="enlace-ficha">
                        {String(uno<Record<string, unknown>>(h.objetivos_indicadores)?.nombre ?? h.indicador_id)}
                      </Link>
                    </td>
                    <td>{h.que === 'meta' ? 'Meta' : 'Valor'}</td>
                    <td className="num">{h.mes ? `${NOMBRE_MES[(h.mes as number) - 1]} ${h.anio}` : `Año ${h.anio}`}</td>
                    <td className="mono" style={{ fontSize: '.74rem' }}>{(h.antes as string) ?? '—'}</td>
                    <td className="mono" style={{ fontSize: '.74rem' }}>{(h.despues as string) ?? 'quitado'}</td>
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

/* ==========================================================================
   UN BLOQUE DE LA TABLA
   ========================================================================== */
function FilasBloque({
  bloque, filas, meses, f, columnas,
}: {
  bloque: string; filas: FilaTablero[]; meses: number[];
  f: ReturnType<typeof leerFiltros>; columnas: number;
}) {
  return (
    <>
      <tr className="obj-bloque"><td colSpan={columnas}>{bloque}</td></tr>
      {filas.map(({ indicador: i, meses: celdas, anio }) => {
        const conSemaforo = i.sentido !== 'informativo';
        return (
          <tr key={i.id} data-codigo={i.codigo}>
            <td className="obj-nombre">
              <Link href={`/objetivos?${aConsulta(f)}&historial=${i.id}#historial`} className="enlace-ficha"
                    title="Ver el historial de este indicador">
                {i.nombre}
              </Link>
              <small>{TIPO[i.tipo]} · {SENTIDO[i.sentido]}</small>
            </td>
            <td style={{ fontSize: '.72rem', color: 'var(--tinta-3)' }}>{i.unidad}</td>
            {meses.map((m) => {
              const c = celdas[m - 1];
              return (
                <td key={m} className="obj-mes" data-estado={f.vista === 'metas' ? undefined : c.estado ?? undefined}
                    data-mes={m} title={c.estado ? `${TEXTO_ESTADO[c.estado]} · ${lineaMeta(c, i.decimales)}` : undefined}>
                  {f.vista === 'metas' ? (
                    conSemaforo
                      ? <CeldaMeta indicadorId={i.id} anio={f.anio} mes={m} nombre={i.nombre}
                                   esperado={c.metaDelAnio ? null : c.esperado} maximo={c.metaDelAnio ? null : c.maximo} />
                      : <span style={{ color: 'var(--tinta-3)' }}>—</span>
                  ) : i.tipo === 'manual' && f.vista === 'real' ? (
                    <CeldaValor indicadorId={i.id} anio={f.anio} mes={m} valor={c.valor} nombre={i.nombre} />
                  ) : (
                    <>
                      <span data-valor={c.valor ?? ''}>{cifra(c.valor, i.decimales)}</span>
                      {c.origen === 'erp' && <b className="obj-origen" data-origen="erp">ERP</b>}
                      {c.origen === 'ajuste' && <b className="obj-origen" data-origen="ajuste">EXCEL</b>}
                      {f.vista === 'completo' && lineaMeta(c, i.decimales) && (
                        <span className="obj-meta-linea">{lineaMeta(c, i.decimales)}</span>
                      )}
                    </>
                  )}
                </td>
              );
            })}
            <td className="obj-anio" data-estado={f.vista === 'metas' ? undefined : anio.estado ?? undefined}
                data-anio={anio.valor ?? ''}>
              {f.vista === 'metas' ? (
                conSemaforo
                  ? <CeldaMeta indicadorId={i.id} anio={f.anio} mes={null} nombre={i.nombre}
                               esperado={anio.esperado} maximo={anio.maximo} />
                  : <span style={{ color: 'var(--tinta-3)' }}>—</span>
              ) : (
                <>
                  {cifra(anio.valor, i.decimales)}
                  {f.vista === 'completo' && lineaMeta(anio, i.decimales) && (
                    <span className="obj-meta-linea">{lineaMeta(anio, i.decimales)}</span>
                  )}
                </>
              )}
            </td>
          </tr>
        );
      })}
    </>
  );
}
