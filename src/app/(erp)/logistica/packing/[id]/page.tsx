/**
 * ============================================================================
 *  PLANO DE ESTIBA · el mapa de la carga del contenedor
 * ============================================================================
 *  ¿Qué es un plano de estiba? Un contenedor no se llena de cualquier manera:
 *  se carga por FILAS, una detrás de otra, desde el fondo hacia la puerta.
 *  El plano dice exactamente cuántos sacos de cada lote van en cada fila.
 *
 *  ¿Para qué sirve?
 *   · El estibador sabe qué bajar de la cámara y en qué orden.
 *   · El cliente recibe el documento y puede ubicar cualquier lote dentro del
 *     contenedor sin descargarlo entero.
 *   · Si aparece un problema sanitario, se sabe en qué fila estaba el lote.
 *
 *  Hoy este documento se arma a mano en Excel al momento de cargar. Aquí lo
 *  genera el sistema con criterio FIFO: el lote más antiguo se carga primero,
 *  para que el producto viejo salga antes que el nuevo.
 *
 *  El plano reproduce exactamente el formato del archivo PLANO_POT_761 que
 *  entregó el cliente: 22 filas de 61 sacos, y el saldo por fila debe cerrar
 *  en cero.
 * ============================================================================
 */
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { crearClienteServidor } from '@/lib/supabase/servidor';
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { EsqueletoKpi, EsqueletoTabla } from '@/components/ui/Esqueleto';
import { Historial } from '@/components/ui/Historial';
import { tm, num, fecha } from '@/lib/formato';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: PageProps<'/logistica/packing/[id]'>): Promise<Metadata> {
  const { id } = await props.params;
  const supabase = await crearClienteServidor();
  const { data } = await supabase.from('packing_lists').select('codigo').eq('id', Number(id)).single();
  return { title: data?.codigo ?? 'Packing list' };
}

/**
 * ----------------------------------------------------------------------------
 *  EL CASCARÓN
 * ----------------------------------------------------------------------------
 *  Una sola consulta —la que dice si el registro existe— y la cabecera. El
 *  resto se cuelga de un <Suspense>.
 *
 *  El reparto decide el código HTTP: Next.js empieza a enviar la respuesta al
 *  encontrar el primer <Suspense>, y una cabecera ya enviada no se puede
 *  cambiar. Si toda la página estuviera dentro de un loading.tsx, el
 *  notFound() llegaría tarde y un identificador inventado respondería 200.
 * ----------------------------------------------------------------------------
 */
export default async function PaginaPlano(props: PageProps<'/logistica/packing/[id]'>) {
  const { id } = await props.params;
  const packingId = Number(id);
  const supabase = await crearClienteServidor();

  const { data: pk } = await supabase
    .from('packing_lists')
    .select('*, embarques(numero, booking, naviera, fecha_programada, almacenes(nombre), destinos(puerto, pais)), usuarios!packing_lists_supervisor_id_fkey(nombre)')
    .eq('id', packingId)
    .single();

  if (!pk) notFound();

  const embCab = Array.isArray(pk.embarques) ? pk.embarques[0] : pk.embarques;
  const almCab = embCab ? (Array.isArray(embCab.almacenes) ? embCab.almacenes[0] : embCab.almacenes) : null;
  const dstCab = embCab ? (Array.isArray(embCab.destinos) ? embCab.destinos[0] : embCab.destinos) : null;

  return (
    <>
      <CabeceraPagina
        titulo={pk.codigo as string}
        descripcion={`Contenedor ${pk.contenedor ?? 's/n'} · ${almCab?.nombre ?? ''} → ${dstCab?.puerto ?? ''}${dstCab?.pais ? ', ' + dstCab.pais : ''}`}
        volver={{ href: '/logistica/packing', texto: 'Volver a packing lists' }}
      >
        <Etiqueta
          texto={String(pk.estado).replace('_', ' ')}
          tono={pk.estado === 'cerrado' ? 'ok' : 'atencion'}
        />
      </CabeceraPagina>

      <Suspense fallback={<CargandoCuerpo />}>
        <CuerpoPlano packingId={packingId} pk={pk} />
      </Suspense>
    </>
  );
}

function CargandoCuerpo() {
  return (
    <>
      <EsqueletoKpi cantidad={4} />
      <EsqueletoTabla filas={8} columnas={10} conFiltros={false} />
      <span className="sr-solo" role="status">Cargando el plano de estiba…</span>
    </>
  );
}

/** La matriz lote x fila, que es lo que cuesta calcular. */
async function CuerpoPlano({ packingId, pk }: { packingId: number; pk: Record<string, unknown> }) {
  const supabase = await crearClienteServidor();

  const [{ data: lineas }, { data: celdas }] = await Promise.all([
    supabase
      .from('packing_lineas')
      .select('lote_id, bultos, peso_neto_kg, lotes(codigo_pallet, codigo_lote, fecha_produccion, sku_presentaciones(skus(codigo, corte, especies(nombre), formatos(nombre)), presentaciones(descripcion, peso_bulto_kg)))')
      .eq('packing_list_id', packingId),
    supabase
      .from('plano_estiba')
      .select('lote_id, fila, sacos')
      .eq('packing_list_id', packingId)
      .order('fila'),
  ]);

  const emb = Array.isArray(pk.embarques) ? pk.embarques[0] : pk.embarques;
  const sup = Array.isArray(pk.usuarios) ? pk.usuarios[0] : pk.usuarios;

  const filasContenedor = Number(pk.filas_contenedor ?? 22);
  const sacosPorFila = Number(pk.sacos_por_fila ?? 61);

  /* ---- Construimos la matriz lote × fila ---- */
  const lotes = (lineas ?? []).map((l) => {
    const lote = Array.isArray(l.lotes) ? l.lotes[0] : l.lotes;
    const sp = lote ? (Array.isArray(lote.sku_presentaciones) ? lote.sku_presentaciones[0] : lote.sku_presentaciones) : null;
    const sku = sp ? (Array.isArray(sp.skus) ? sp.skus[0] : sp.skus) : null;
    const esp = sku ? (Array.isArray(sku.especies) ? sku.especies[0] : sku.especies) : null;
    const fmt = sku ? (Array.isArray(sku.formatos) ? sku.formatos[0] : sku.formatos) : null;
    const pres = sp ? (Array.isArray(sp.presentaciones) ? sp.presentaciones[0] : sp.presentaciones) : null;
    return {
      loteId: l.lote_id as number,
      pallet: (lote?.codigo_pallet as string) ?? '—',
      codigoLote: (lote?.codigo_lote as string) ?? '',
      fechaProduccion: lote?.fecha_produccion as string,
      especie: (esp?.nombre as string) ?? '',
      formato: (fmt?.nombre as string) ?? '',
      corte: (sku?.corte as string) ?? '',
      presentacion: (pres?.descripcion as string) ?? '',
      pesoBulto: Number(pres?.peso_bulto_kg ?? 0),
      bultos: Number(l.bultos ?? 0),
      peso: Number(l.peso_neto_kg ?? 0),
    };
  }).sort((a, b) => (a.fechaProduccion ?? '').localeCompare(b.fechaProduccion ?? ''));

  // Índice rápido: cuántos sacos del lote X van en la fila Y
  const mapa = new Map<string, number>();
  for (const c of celdas ?? []) {
    mapa.set(`${c.lote_id}:${c.fila}`, Number(c.sacos ?? 0));
  }

  // ¿Hasta qué fila llegó la carga?
  const filaMax = Math.max(1, ...(celdas ?? []).map((c) => Number(c.fila ?? 0)));
  const columnas = Array.from({ length: filaMax }, (_, i) => i + 1);

  // Totales por fila y comprobación de que el saldo cierra en cero
  const totalPorFila = columnas.map((f) =>
    (celdas ?? []).filter((c) => Number(c.fila) === f).reduce((s, c) => s + Number(c.sacos ?? 0), 0)
  );
  const saldoPorFila = totalPorFila.map((t) => sacosPorFila - t);
  const totalBultos = lotes.reduce((s, l) => s + l.bultos, 0);
  const totalPeso = lotes.reduce((s, l) => s + l.peso, 0);
  const cierraEnCero = saldoPorFila.slice(0, -1).every((s) => s === 0);

  return (
    <>
      <RejillaKpi>
        <Kpi etiqueta="Total de bultos" valor={num(totalBultos)} nota={`${lotes.length} lotes distintos`} />
        <Kpi etiqueta="Peso neto" valor={tm(totalPeso)} sufijo="TM" />
        <Kpi etiqueta="Filas utilizadas" valor={`${filaMax} / ${filasContenedor}`} tono="marca"
             nota={`${sacosPorFila} sacos por fila`} />
        <Kpi
          etiqueta="Saldo por fila"
          valor={cierraEnCero ? 'Cierra' : 'Revisar'}
          tono={cierraEnCero ? 'ok' : 'critico'}
          nota={cierraEnCero ? 'Todas las filas completas' : 'Hay filas incompletas'}
        />
      </RejillaKpi>

      {/* ---- Título del documento, como en el formato original ---- */}
      <Panel titulo="Datos del embarque" className="mb-espacio">
        <dl className="ficha ficha-columnas">
          <div><dt>N.° packing list</dt><dd className="mono">{pk.codigo as string}</dd></div>
          <div><dt>N.° contenedor</dt><dd className="mono">{(pk.contenedor as string) ?? '—'}</dd></div>
          <div><dt>Precinto</dt><dd className="mono">{(pk.precinto as string) ?? '—'}</dd></div>
          <div><dt>Guía de remisión</dt><dd className="mono">{(pk.guia_remision as string) ?? '—'}</dd></div>
          <div><dt>DAM</dt><dd className="mono">{(pk.dam as string) ?? '—'}</dd></div>
          <div><dt>Booking</dt><dd className="mono">{(emb?.booking as string) ?? '—'}</dd></div>
          <div><dt>Naviera</dt><dd>{(emb?.naviera as string) ?? '—'}</dd></div>
          <div><dt>Supervisor</dt><dd>{(sup?.nombre as string) ?? '—'}</dd></div>
          <div><dt>Turno</dt><dd>{pk.turno === 'dia' ? 'Día' : 'Noche'}</dd></div>
          <div><dt>Fecha de carga</dt><dd>{fecha(pk.fecha_carga as string)}</dd></div>
          <div><dt>Hora inicio</dt><dd className="mono">{(pk.hora_inicio as string) ?? '—'}</dd></div>
          <div><dt>Hora fin</dt><dd className="mono">{(pk.hora_fin as string) ?? '—'}</dd></div>
        </dl>
      </Panel>

      {/* ══════ EL PLANO ══════ */}
      <Panel titulo={`Plano de estiba · ${filaMax} filas`}>
        {(celdas ?? []).length === 0 ? (
          <Vacio
            titulo="Sin plano generado"
            mensaje="Este packing list todavía no tiene su plano de estiba calculado."
          />
        ) : (
          <>
            <div className="tabla-envoltorio plano-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos plano">
                <thead>
                  <tr>
                    <th className="plano-fijo">Producto</th>
                    <th className="plano-fijo2">Lote</th>
                    <th className="num">Bultos</th>
                    {columnas.map((f) => (
                      <th key={f} className="num plano-col">{f}</th>
                    ))}
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {lotes.map((l) => {
                    const total = columnas.reduce((s, f) => s + (mapa.get(`${l.loteId}:${f}`) ?? 0), 0);
                    return (
                      <tr key={l.loteId}>
                        <td className="plano-fijo">
                          <strong style={{ fontWeight: 600, fontSize: '.78rem' }}>
                            {l.especie} · {l.formato}
                          </strong>
                          <br />
                          <span style={{ color: 'var(--tinta-3)', fontSize: '.71rem' }}>
                            {l.corte} · {l.presentacion}
                          </span>
                        </td>
                        <td className="plano-fijo2 mono">
                          {l.codigoLote || l.pallet}
                          <br />
                          <span style={{ color: 'var(--tinta-3)', fontSize: '.68rem' }}>
                            {fecha(l.fechaProduccion)}
                          </span>
                        </td>
                        <td className="num">{num(l.bultos)}</td>
                        {columnas.map((f) => {
                          const v = mapa.get(`${l.loteId}:${f}`) ?? 0;
                          return (
                            <td key={f} className="num plano-celda" data-lleno={v > 0 ? 'si' : 'no'}>
                              {v > 0 ? v : ''}
                            </td>
                          );
                        })}
                        <td className="num"><strong>{num(total)}</strong></td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="plano-total">
                    <td className="plano-fijo" colSpan={2}>Total de sacos por fila</td>
                    <td className="num">{num(totalBultos)}</td>
                    {totalPorFila.map((t, i) => (
                      <td key={i} className="num">{t}</td>
                    ))}
                    <td className="num"><strong>{num(totalBultos)}</strong></td>
                  </tr>
                  <tr className="plano-saldo">
                    <td className="plano-fijo" colSpan={2}>Saldo por fila</td>
                    <td className="num"></td>
                    {saldoPorFila.map((s, i) => (
                      <td key={i} className="num" data-saldo={s === 0 ? 'cero' : 'resto'}>{s}</td>
                    ))}
                    <td className="num"></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <p className="pie-explicativo" style={{ padding: '.9rem 1rem 1rem' }}>
              <strong>Cómo leerlo:</strong> cada columna numerada es una fila del contenedor, de la
              primera (al fondo) a la última (junto a la puerta). Cada celda dice cuántos sacos de
              ese lote se colocaron en esa fila. Un lote puede repartirse entre varias filas
              contiguas. La fila de <strong>saldo</strong> debe dar cero en todas las filas menos la
              última: si no, la carga quedó incompleta.
              <br /><br />
              El orden lo determina la <strong>fecha de producción</strong>: el lote más antiguo se
              carga primero. Así el producto viejo sale antes que el nuevo.
            </p>
          </>
        )}
      </Panel>

      <Panel titulo="Historial de este contenedor" className="mb-espacio" >
        <Historial entidad="packing_lists" entidadId={packingId} />
      </Panel>

      <p className="pie-explicativo no-imprimir">
        Este documento se puede imprimir directamente desde el navegador para acompañar la entrega
        al cliente: los menús y botones no aparecen en la impresión.
      </p>
    </>
  );
}
