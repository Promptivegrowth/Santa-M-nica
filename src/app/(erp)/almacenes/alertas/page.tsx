/**
 * ============================================================================
 *  ALERTAS DE STOCK · lo que hay en cámara y no se puede vender como siempre
 * ============================================================================
 *  Documento de mejoras, cuadro resumen, filas 2 y 3 — «Stock → Inventarios →
 *  Alertas»:
 *
 *    «Inventario próximo a vencer: generar alertas automáticas mostrando
 *     producto, familia, lote, cantidad, fecha de vencimiento y días
 *     restantes.»
 *
 *    «Debe existir cuadro específico de stock con condición»: observado,
 *     inmovilizado o con condición especial de venta, «especialmente el
 *     destinado normalmente a mercado nacional».
 *
 *  Los dos cuadros vienen de vistas de la base (migración 055), que además
 *  generan un aviso resumen cada mañana. Esta pantalla es el detalle al que
 *  lleva ese aviso: qué pallets son, dónde están y por qué.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor } from '@/lib/supabase/servidor';
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { Filtros } from '@/components/ui/Filtros';
import { traerTodo } from '@/lib/traerTodo';
import { tm, num, fecha } from '@/lib/formato';

export const metadata: Metadata = { title: 'Alertas de stock' };
export const dynamic = 'force-dynamic';

type Tono = 'ok' | 'atencion' | 'critico' | 'info' | 'neutro';

/*
 * Las cuatro condiciones, en el orden en que pesan. El texto es el que se usa
 * en planta; «condicionado» a secas no le dice nada a nadie, «solo mercado
 * nacional» sí.
 */
const CONDICION: Record<string, { texto: string; tono: Tono; nota: string }> = {
  inmovilizado: { texto: 'Inmovilizado',          tono: 'critico',  nota: 'No se puede mover ni vender' },
  condicionado: { texto: 'Solo mercado nacional', tono: 'info',     nota: 'Se vende, pero no se exporta' },
  observado:    { texto: 'Observado',             tono: 'atencion', nota: 'En revisión de Calidad' },
  en_espera:    { texto: 'En espera',             tono: 'neutro',   nota: 'Esperando resultados' },
};
const ORDEN_CONDICION = Object.keys(CONDICION);

type FilaVencer = {
  lote_id: number; almacen_id: number; almacen: string; codigo_pallet: string; codigo_lote: string | null;
  sku_codigo: string; especie: string; formato: string; corte: string | null; familia: string | null;
  fisico_kg: number; fecha_vencimiento: string; dias_restantes: number;
  situacion: 'vencido' | 'por_vencer'; condicion: string | null;
};
type FilaCondicion = {
  lote_id: number; almacen_id: number; almacen: string; codigo_pallet: string; codigo_lote: string | null;
  sku_codigo: string; especie: string; formato: string; corte: string | null; familia: string | null;
  fisico_kg: number; fecha_vencimiento: string; condicion: string; condicion_venta: string | null;
  motivos: string | null; dictamenes: number; desde: string; dias_en_condicion: number;
};

export default async function PaginaAlertasStock(props: PageProps<'/almacenes/alertas'>) {
  const q = await props.searchParams;
  const supabase = await crearClienteServidor();

  const familia = (q.familia as string) ?? '';
  const venc = (q.venc as string) ?? '';
  const cond = (q.cond as string) ?? '';

  /*
   * Se traen ENTEROS y se filtra aquí. Son pocos —lo retenido y lo que vence
   * pronto es una fracción del inventario— y así las tarjetas cuentan siempre
   * el total, no la página. Con traerTodo por si un día pasan de mil: la API
   * corta en silencio (ver src/lib/traerTodo.ts).
   */
  const [vencer, condicion, { data: aviso }] = await Promise.all([
    traerTodo<FilaVencer>((d, h) =>
      supabase.from('v_stock_por_vencer').select('*')
        .order('dias_restantes', { ascending: true }).order('lote_id').range(d, h)),
    traerTodo<FilaCondicion>((d, h) =>
      supabase.from('v_stock_condicion').select('*')
        .order('fisico_kg', { ascending: false }).order('lote_id').range(d, h)),
    supabase.from('parametros').select('valor').eq('clave', 'vencimiento_aviso_dias').single(),
  ]);
  const diasAviso = Number(aviso?.valor ?? 90);

  /* ---- Las tarjetas: siempre sobre el total, sin filtros ---- */
  const suma = <T extends { fisico_kg: number }>(xs: T[]) => xs.reduce((s, x) => s + Number(x.fisico_kg), 0);
  const vencidos = vencer.filter((f) => f.situacion === 'vencido');
  const porVencer = vencer.filter((f) => f.situacion === 'por_vencer');
  const deCondicion = (c: string) => condicion.filter((f) => f.condicion === c);

  /* ---- Los cuadros: con los filtros ---- */
  const deFamilia = (f: { familia: string | null }) => !familia || f.familia === familia;
  const filasVencer = vencer.filter((f) => deFamilia(f) && (!venc || f.situacion === venc));
  const filasCondicion = condicion
    .filter((f) => deFamilia(f) && (!cond || f.condicion === cond))
    //  Lo más grave arriba; dentro de cada condición, lo que más pesa.
    .sort((a, b) =>
      ORDEN_CONDICION.indexOf(a.condicion) - ORDEN_CONDICION.indexOf(b.condicion)
      || Number(b.fisico_kg) - Number(a.fisico_kg));

  const familias = [...new Set([...vencer, ...condicion].map((f) => f.familia).filter(Boolean) as string[])].sort();
  const hayFiltros = Boolean(familia || venc || cond);

  return (
    <>
      <CabeceraPagina
        titulo="Alertas de stock"
        descripcion={`Pallets vencidos o que vencen en los próximos ${diasAviso} días, y el stock que Calidad retiene o que solo puede ir al mercado nacional.`}
      />

      {/* ---------------- Vencimiento ---------------- */}
      <RejillaKpi>
        <Kpi
          etiqueta="Ya vencido"
          valor={num(vencidos.length)}
          sufijo="pallets"
          tono={vencidos.length > 0 ? 'critico' : 'ok'}
          nota={`${tm(suma(vencidos))} TM · requieren disposición`}
          href="/almacenes/alertas?venc=vencido#por-vencer"
        />
        <Kpi
          etiqueta="Próximos a vencer"
          valor={num(porVencer.length)}
          sufijo="pallets"
          tono={porVencer.length > 0 ? 'atencion' : 'ok'}
          nota={`${tm(suma(porVencer))} TM en ${diasAviso} días · todavía se colocan`}
          href="/almacenes/alertas?venc=por_vencer#por-vencer"
        />
        <Kpi
          etiqueta="Con condición"
          valor={num(condicion.length)}
          sufijo="pallets"
          tono={condicion.length > 0 ? 'atencion' : 'ok'}
          nota={`${tm(suma(condicion))} TM que no se pueden exportar`}
          href="/almacenes/alertas#condicion"
        />
      </RejillaKpi>

      {/* ---------------- Condición ---------------- */}
      <RejillaKpi>
        {ORDEN_CONDICION.map((c) => {
          const xs = deCondicion(c);
          return (
            <Kpi
              key={c}
              etiqueta={CONDICION[c].texto}
              valor={tm(suma(xs))}
              sufijo="TM"
              tono={xs.length === 0 ? 'ok' : c === 'inmovilizado' ? 'critico' : c === 'en_espera' ? 'neutro' : 'atencion'}
              nota={`${num(xs.length)} pallets · ${CONDICION[c].nota.toLowerCase()}`}
              href={`/almacenes/alertas?cond=${c}#condicion`}
            />
          );
        })}
      </RejillaKpi>

      <Panel titulo="Filtrar" className="mb-espacio">
        <Filtros
          campos={[
            {
              tipo: 'select', clave: 'familia', etiqueta: 'Familia',
              opciones: familias.map((f) => ({ valor: f, texto: f })),
            },
            {
              tipo: 'select', clave: 'venc', etiqueta: 'Vencimiento',
              opciones: [
                { valor: 'vencido', texto: 'Ya vencido' },
                { valor: 'por_vencer', texto: 'Próximo a vencer' },
              ],
            },
            {
              tipo: 'select', clave: 'cond', etiqueta: 'Condición',
              opciones: ORDEN_CONDICION.map((c) => ({ valor: c, texto: CONDICION[c].texto })),
            },
          ]}
        />
        {hayFiltros && (
          <div className="atajos-fecha" style={{ marginTop: '.4rem' }}>
            <Link href="/almacenes/alertas" className="atajo-limpiar">Quitar filtros</Link>
          </div>
        )}
      </Panel>

      {/* ============ CUADRO 1 · PRÓXIMOS A VENCER ============ */}
      <div id="por-vencer">
        <Panel
          titulo={`Próximos a vencer · ${num(filasVencer.length)} pallets · ${tm(suma(filasVencer))} TM`}
          className="mb-espacio"
        >
          {filasVencer.length === 0 ? (
            <Vacio titulo="Nada por vencer" mensaje="Ningún pallet con estos filtros vence en el plazo de aviso." />
          ) : (
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos" data-cuadro="por-vencer">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Familia</th>
                    <th>Lote</th>
                    <th>Almacén</th>
                    <th className="num">Cantidad</th>
                    <th className="num">Vence</th>
                    <th className="num">Días restantes</th>
                    <th>Calidad</th>
                  </tr>
                </thead>
                <tbody>
                  {filasVencer.map((f) => {
                    const d = Number(f.dias_restantes);
                    return (
                      <tr key={`${f.lote_id}-${f.almacen_id}`}>
                        <td>
                          <span className="mono" style={{ color: 'var(--tinta-3)' }}>{f.sku_codigo}</span>{' '}
                          {f.especie} · {f.formato}
                          {f.corte && (
                            <><br /><span style={{ color: 'var(--tinta-3)', fontSize: '.74rem' }}>{f.corte}</span></>
                          )}
                        </td>
                        <td>{f.familia ?? '—'}</td>
                        <td className="mono">
                          <Link href={`/almacenes/lotes/${f.lote_id}`} className="enlace-ficha">{f.codigo_pallet}</Link>
                          {f.codigo_lote && (
                            <><br /><span style={{ color: 'var(--tinta-3)', fontSize: '.72rem' }}>lote {f.codigo_lote}</span></>
                          )}
                        </td>
                        <td>{f.almacen}</td>
                        <td className="num">{tm(f.fisico_kg)} TM</td>
                        <td className="num">{fecha(f.fecha_vencimiento)}</td>
                        {/*
                          El signo importa: «venció hace 40 días» y «quedan 40
                          días» piden cosas opuestas —darlo de baja o venderlo
                          ya— y tienen que leerse distinto de un vistazo.
                        */}
                        <td className="num" data-dias={d} style={{
                          fontWeight: 600,
                          color: d < 0 ? 'var(--critico)' : d <= 30 ? 'var(--critico)' : 'var(--atencion)',
                        }}>
                          {d < 0 ? `venció hace ${num(-d)} d` : d === 0 ? 'vence hoy' : `${num(d)} d`}
                        </td>
                        <td>
                          {/*
                            Un pallet por vencer que Calidad retiene no se puede
                            ofrecer por mucha prisa que haya: se avisa aquí para
                            que nadie lo prometa.
                          */}
                          {f.condicion
                            ? <Etiqueta texto={CONDICION[f.condicion]?.texto ?? f.condicion} tono={CONDICION[f.condicion]?.tono ?? 'neutro'} />
                            : <Etiqueta texto="Liberado" tono="ok" />}
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

      {/* ============ CUADRO 2 · STOCK CON CONDICIÓN ============ */}
      <div id="condicion">
        <Panel
          titulo={`Stock con condición · ${num(filasCondicion.length)} pallets · ${tm(suma(filasCondicion))} TM`}
          className="mb-espacio"
        >
          {filasCondicion.length === 0 ? (
            <Vacio titulo="Sin stock retenido" mensaje="Ningún pallet con estos filtros tiene una observación abierta." />
          ) : (
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos" data-cuadro="condicion">
                <thead>
                  <tr>
                    <th>Condición</th>
                    <th>Producto</th>
                    <th>Familia</th>
                    <th>Lote</th>
                    <th>Almacén</th>
                    <th className="num">Cantidad</th>
                    <th>Motivo</th>
                    <th className="num">Desde</th>
                  </tr>
                </thead>
                <tbody>
                  {filasCondicion.map((f) => (
                    <tr key={`${f.lote_id}-${f.almacen_id}`} data-condicion={f.condicion}>
                      <td>
                        <Etiqueta texto={CONDICION[f.condicion]?.texto ?? f.condicion} tono={CONDICION[f.condicion]?.tono ?? 'neutro'} />
                      </td>
                      <td>
                        <span className="mono" style={{ color: 'var(--tinta-3)' }}>{f.sku_codigo}</span>{' '}
                        {f.especie} · {f.formato}
                        {f.corte && (
                          <><br /><span style={{ color: 'var(--tinta-3)', fontSize: '.74rem' }}>{f.corte}</span></>
                        )}
                      </td>
                      <td>{f.familia ?? '—'}</td>
                      <td className="mono">
                        <Link href={`/almacenes/lotes/${f.lote_id}`} className="enlace-ficha">{f.codigo_pallet}</Link>
                        {f.codigo_lote && (
                          <><br /><span style={{ color: 'var(--tinta-3)', fontSize: '.72rem' }}>lote {f.codigo_lote}</span></>
                        )}
                      </td>
                      <td>{f.almacen}</td>
                      <td className="num">{tm(f.fisico_kg)} TM</td>
                      <td style={{ fontSize: '.78rem', maxWidth: '22rem' }}>
                        {f.motivos ?? '—'}
                        {Number(f.dictamenes) > 1 && (
                          <span style={{ color: 'var(--tinta-3)' }}> · {num(f.dictamenes)} dictámenes abiertos</span>
                        )}
                      </td>
                      <td className="num" style={{ fontSize: '.76rem' }}>
                        {fecha(f.desde)}
                        <br />
                        <span style={{ color: 'var(--tinta-3)', fontSize: '.68rem' }}>
                          hace {num(f.dias_en_condicion)} d
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <p className="pie-explicativo">
        El aviso de vencimiento se da {diasAviso} días antes, y se cambia en{' '}
        <Link href="/configuracion">Configuración → Parámetros</Link>. Las condiciones salen de los
        dictámenes de <Link href="/almacenes/calidad">Calidad</Link>: al liberar un lote desaparece de
        este cuadro. «Solo mercado nacional» es un motivo de observación más, y como tal saca el pallet
        del disponible para exportar.
      </p>
    </>
  );
}
