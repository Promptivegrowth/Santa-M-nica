/**
 * ============================================================================
 *  TRAZABILIDAD · el buscador universal
 * ============================================================================
 *  Una sola caja acepta cualquier identificador del negocio: el código de un
 *  pallet, un número de proforma, un contenedor, una guía de remisión, una
 *  factura o el nombre de un cliente.
 *
 *  A partir de ahí se puede recorrer la cadena en las dos direcciones:
 *
 *   HACIA ATRÁS  ¿de dónde salió esto?
 *     factura → pedido → embarque → packing list → plano → lote → producción
 *
 *   HACIA ADELANTE  ¿a dónde fue esto?
 *     lote → movimientos → traslados → reservas → despachos → cliente
 *
 *  Esta segunda es la consulta que salva la empresa el día que SANIPES
 *  inmoviliza un producto: en una pantalla salen todos los contenedores y
 *  clientes que lo recibieron.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { BuscadorTrazabilidad } from './Buscador';
import { tm, num, fecha, fechaHora } from '@/lib/formato';

export const metadata: Metadata = { title: 'Trazabilidad' };
export const dynamic = 'force-dynamic';

const TONO_TIPO: Record<string, 'info' | 'ok' | 'atencion' | 'neutro'> = {
  Lote: 'ok',
  Pedido: 'info',
  'Packing List': 'atencion',
  Embarque: 'atencion',
  Cliente: 'neutro',
  Factura: 'info',
  Traslado: 'neutro',
  Producto: 'neutro',
};

export default async function PaginaTrazabilidad(props: PageProps<'/trazabilidad'>) {
  const q = await props.searchParams;
  const texto = ((q.q as string) ?? '').trim();
  const loteId = q.lote ? Number(q.lote) : null;

  const supabase = await crearClienteServidor();

  /* ---- Búsqueda universal ---- */
  const { data: resultados } = texto.length >= 2
    ? await supabase.rpc('buscar_universal', { p_texto: texto })
    : { data: null };

  /* ---- Recorrido de un lote concreto ---- */
  const [{ data: recorrido }, { data: lote }] = loteId
    ? await Promise.all([
        supabase.rpc('trazar_lote_adelante', { p_lote_id: loteId }),
        supabase
          .from('lotes')
          .select('id, codigo_pallet, codigo_lote, fecha_produccion, campania, juliano, turno, proceso, bultos_iniciales, peso_neto_inicial_kg, lineas_procesadoras(nombre), plantas(nombre), sku_presentaciones(skus(codigo, corte, especies(nombre), formatos(nombre)), presentaciones(descripcion))')
          .eq('id', loteId)
          .single(),
      ])
    : [{ data: null }, { data: null }];

  return (
    <>
      <CabeceraPagina
        titulo="Trazabilidad"
        descripcion="Busque cualquier código del negocio y recorra su historia completa, hacia atrás hasta el día de producción y hacia adelante hasta el cliente que lo recibió."
      >
        <Link href="/trazabilidad/retiro" className="btn btn-secundario">Retiro sanitario</Link>
      </CabeceraPagina>

      <BuscadorTrazabilidad valorInicial={texto} />

      {/* ══════ Resultados de la búsqueda ══════ */}
      {texto.length >= 2 && (
        <Panel titulo={`${(resultados ?? []).length} coincidencias para "${texto}"`} className="mb-espacio">
          {(resultados ?? []).length === 0 ? (
            <Vacio
              titulo="Sin coincidencias"
              mensaje="Pruebe con un código de pallet (SM 26 02 0001), un número de proforma (SM26-101), un contenedor, una guía o el nombre de un cliente."
            />
          ) : (
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos">
                <thead>
                  <tr><th>Tipo</th><th>Identificador</th><th>Detalle</th><th className="num">Registrado</th><th></th></tr>
                </thead>
                <tbody>
                  {(resultados ?? []).map((r: Record<string, unknown>, i: number) => (
                    <tr key={i}>
                      <td><Etiqueta texto={String(r.tipo)} tono={TONO_TIPO[String(r.tipo)] ?? 'neutro'} /></td>
                      <td className="mono"><strong>{String(r.titulo)}</strong></td>
                      <td style={{ fontSize: '.8rem', color: 'var(--tinta-2)' }}>{String(r.subtitulo ?? '')}</td>
                      <td className="num">{fecha(r.fecha as string)}</td>
                      <td>
                        {r.tipo === 'Lote' ? (
                          <Link href={`/trazabilidad?q=${encodeURIComponent(texto)}&lote=${r.id}`} className="btn btn-secundario">
                            Ver recorrido
                          </Link>
                        ) : (
                          <Link href={String(r.ruta)} className="btn btn-sutil">Abrir</Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {/* ══════ Ficha del lote ══════ */}
      {lote && (
        <div className="rejilla-2 mb-espacio">
          <Panel titulo="Origen del lote · hacia atrás">
            <dl className="ficha">
              <div><dt>Código de pallet</dt><dd className="mono">{lote.codigo_pallet as string}</dd></div>
              <div><dt>Lote</dt><dd className="mono">{(lote.codigo_lote as string) ?? '—'}</dd></div>
              <div><dt>Fecha de producción</dt><dd><strong>{fecha(lote.fecha_produccion as string)}</strong></dd></div>
              <div><dt>Campaña / juliano</dt><dd>{lote.campania as number} · día {(lote.juliano as string) ?? '—'}</dd></div>
              <div><dt>Turno</dt><dd>{lote.turno === 'dia' ? 'Día' : 'Noche'}</dd></div>
              <div><dt>Tipo de proceso</dt><dd>{lote.proceso === 'propia' ? 'Producción propia' : 'Maquila'}</dd></div>
              <div><dt>Cantidad inicial</dt><dd>{num(lote.bultos_iniciales)} bultos · {tm(lote.peso_neto_inicial_kg)} TM</dd></div>
            </dl>
          </Panel>

          <Panel titulo="Qué se produjo">
            <div className="ficha-producto">
              <span className="ficha-producto-etiqueta">Producto</span>
              <strong className="ficha-producto-nombre">
                {(() => {
                  const sp = Array.isArray(lote.sku_presentaciones) ? lote.sku_presentaciones[0] : lote.sku_presentaciones;
                  const sku = Array.isArray(sp?.skus) ? sp.skus[0] : sp?.skus;
                  const esp = Array.isArray(sku?.especies) ? sku.especies[0] : sku?.especies;
                  const fmt = Array.isArray(sku?.formatos) ? sku.formatos[0] : sku?.formatos;
                  const pres = Array.isArray(sp?.presentaciones) ? sp.presentaciones[0] : sp?.presentaciones;
                  return `${esp?.nombre ?? ''} · ${fmt?.nombre ?? ''} · ${sku?.corte ?? ''} · ${pres?.descripcion ?? ''}`;
                })()}
              </strong>
            </div>
            <p className="pie-explicativo" style={{ padding: '0 1rem 1rem' }}>
              Desde aquí se llega a la <strong>línea procesadora</strong> y al <strong>turno</strong> que
              lo produjo. Si un cliente reclama por un contenedor, esta es la evidencia documental.
            </p>
          </Panel>
        </div>
      )}

      {/* ══════ Recorrido hacia adelante ══════ */}
      {recorrido && (
        <Panel titulo={`Recorrido completo del lote · ${(recorrido as unknown[]).length} eventos`}>
          {(recorrido as unknown[]).length === 0 ? (
            <Vacio titulo="Sin movimientos" mensaje="Este lote todavía no registra movimientos." />
          ) : (
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos">
                <thead>
                  <tr>
                    <th>Etapa</th><th>Documento</th><th className="num">Fecha</th>
                    <th>Almacén</th><th>Cliente</th><th>Destino</th><th>Contenedor</th>
                    <th className="num">Bultos</th><th className="num">Peso</th>
                  </tr>
                </thead>
                <tbody>
                  {(recorrido as Record<string, unknown>[]).map((e, i) => (
                    <tr key={i}>
                      <td><Etiqueta texto={String(e.etapa)} tono={String(e.etapa).startsWith('Despacho') ? 'ok' : 'neutro'} /></td>
                      <td className="mono">{String(e.documento ?? '—')}</td>
                      <td className="num" style={{ whiteSpace: 'nowrap' }}>{fechaHora(e.fecha as string)}</td>
                      <td style={{ fontSize: '.78rem' }}>{String(e.almacen ?? '—')}</td>
                      <td style={{ fontSize: '.78rem' }}>{String(e.cliente ?? '—')}</td>
                      <td style={{ fontSize: '.78rem' }}>{String(e.destino ?? '—')}</td>
                      <td className="mono">{String(e.contenedor ?? '—')}</td>
                      <td className="num">{num(e.bultos as number)}</td>
                      <td className="num">{tm(e.peso_kg as number)} TM</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {/* ══════ Ayuda inicial ══════ */}
      {!texto && !lote && (
        <Panel titulo="Qué se puede buscar aquí">
          <div className="ayuda-trazabilidad">
            <div>
              <strong>Código de pallet</strong>
              <span>El identificador físico del producto en cámara. Ejemplo: <code>SM 26 02 0001</code></span>
            </div>
            <div>
              <strong>Número de proforma</strong>
              <span>El pedido del cliente. Ejemplo: <code>SM26-101</code></span>
            </div>
            <div>
              <strong>Contenedor o guía</strong>
              <span>Para rastrear un embarque concreto. Ejemplo: <code>TEMU1234567</code></span>
            </div>
            <div>
              <strong>Número de factura</strong>
              <span>Para ir del documento al producto que respalda. Ejemplo: <code>F001-000001</code></span>
            </div>
            <div>
              <strong>Nombre del cliente</strong>
              <span>Para ver todo lo que se le ha vendido.</span>
            </div>
            <div>
              <strong>Código o corte del producto</strong>
              <span>Para encontrar el SKU en el catálogo.</span>
            </div>
          </div>
        </Panel>
      )}
    </>
  );
}
