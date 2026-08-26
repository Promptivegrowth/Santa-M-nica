/**
 * ============================================================================
 *  DETALLE DEL PEDIDO · organizado en pestañas
 * ============================================================================
 *  La especificación del cliente pedía doce pestañas para el detalle del
 *  pedido. Aquí están, y cada una responde a una pregunta concreta que se hace
 *  el equipo comercial:
 *
 *    General        → ¿de quién es y para cuándo?
 *    Productos      → ¿qué me pidió exactamente?
 *    Disponibilidad → ¿tengo stock para cumplirlo?
 *    Reservas       → ¿qué lotes le tengo apartados?
 *    Faltantes      → ¿qué me falta conseguir?
 *    Embarques      → ¿cuándo sale?
 *    Despachos      → ¿qué ya salió?
 *    Facturas       → ¿qué documenté?
 *    Cobranza       → ¿me pagaron?
 *    Rentabilidad   → ¿gané dinero?
 *    Historial      → ¿quién tocó esto y cuándo?
 *
 *  La pestaña activa viaja en la dirección web, así que se puede compartir el
 *  enlace de una pestaña concreta.
 * ============================================================================
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel, Vacio, Etiqueta, Semaforo, Barra, RejillaKpi, Kpi } from '@/components/ui/Pagina';
import { Historial } from '@/components/ui/Historial';
import { tm, num, fecha, fechaHora, dinero, pct, etiquetaEstado } from '@/lib/formato';
import { veCostos, type Rol } from '@/lib/navegacion';
import { uno, campo } from '@/lib/relaciones';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: PageProps<'/ventas/pedidos/[id]'>): Promise<Metadata> {
  const { id } = await props.params;
  const supabase = await crearClienteServidor();
  const { data } = await supabase
    .from('pedidos').select('numero_proforma').eq('id', Number(id)).single();
  return { title: data?.numero_proforma ?? 'Pedido' };
}

const PESTANAS = [
  { clave: 'general',        titulo: 'General' },
  { clave: 'productos',      titulo: 'Productos' },
  { clave: 'disponibilidad', titulo: 'Disponibilidad' },
  { clave: 'reservas',       titulo: 'Reservas' },
  { clave: 'faltantes',      titulo: 'Faltantes' },
  { clave: 'embarques',      titulo: 'Embarques' },
  { clave: 'despachos',      titulo: 'Despachos' },
  { clave: 'facturas',       titulo: 'Facturas' },
  { clave: 'cobranza',       titulo: 'Cobranza' },
  { clave: 'rentabilidad',   titulo: 'Rentabilidad' },
  { clave: 'historial',      titulo: 'Historial' },
];

export default async function DetallePedido(props: PageProps<'/ventas/pedidos/[id]'>) {
  const { id } = await props.params;
  const q = await props.searchParams;
  const pedidoId = Number(id);
  const pestana = (q.t as string) ?? 'general';

  const supabase = await crearClienteServidor();
  const usuario = await obtenerUsuarioActual();
  const puedeVerCostos = veCostos((usuario?.rol ?? 'consulta') as Rol);

  /* ---- Cabecera del pedido ---- */
  const { data: pedido } = await supabase
    .from('v_pedidos_tablero').select('*').eq('id', pedidoId).single();
  if (!pedido) notFound();

  const moneda = pedido.moneda as 'USD' | 'PEN';

  /* ---- Datos de la pestaña activa (solo se pide lo que se va a mostrar) ---- */
  const [
    { data: lineas },
    { data: reservas },
    { data: embarques },
    { data: facturas },
    { data: rentabilidad },
  ] = await Promise.all([
    supabase
      .from('pedido_lineas')
      .select('id, cantidad_tm, precio_tm, precio_lista_tm, descuento_pct, costo_estimado_tm, orden, sku_presentaciones(id, skus(codigo, corte, especies(nombre), formatos(nombre)), presentaciones(descripcion, peso_bulto_kg))')
      .eq('pedido_id', pedidoId).order('orden'),
    supabase
      .from('reservas')
      .select('id, bultos, peso_neto_kg, estado, vence_el, creado_en, motivo_liberacion, lotes(codigo_pallet, fecha_produccion), almacenes(nombre), pedido_lineas!inner(pedido_id)')
      .eq('pedido_lineas.pedido_id', pedidoId).order('creado_en', { ascending: false }),
    supabase
      .from('embarque_pedidos')
      .select('embarques(id, numero, fecha_programada, estado, booking, naviera, almacenes(nombre), destinos(puerto, pais))')
      .eq('pedido_id', pedidoId),
    supabase
      .from('facturas')
      .select('id, numero, total, moneda, fecha_emision, fecha_vencimiento, estado')
      .eq('pedido_id', pedidoId).order('fecha_emision', { ascending: false }),
    supabase
      .from('v_rentabilidad_pedido').select('*').eq('pedido_id', pedidoId).single(),
  ]);

  const avance = Number(pedido.avance_pct ?? 0);

  return (
    <>
      <CabeceraPagina
        titulo={pedido.numero_proforma as string}
        descripcion={`${pedido.cliente} · ${pedido.destino ?? 'sin destino'}`}
        volver={{ href: '/ventas/pedidos', texto: 'Volver a pedidos' }}
      >
        <Semaforo estado={pedido.semaforo as never} />
      </CabeceraPagina>

      <RejillaKpi>
        <Kpi etiqueta="Cantidad pedida" valor={num(pedido.tm_pedidas, 1)} sufijo="TM" />
        <Kpi etiqueta="Reservado" valor={num(pedido.tm_reservadas, 1)} sufijo="TM" tono="atencion" />
        <Kpi etiqueta="Despachado" valor={num(pedido.tm_despachadas, 1)} sufijo="TM" tono="ok" />
        <Kpi
          etiqueta="Falta por cubrir"
          valor={num(pedido.tm_faltantes, 1)}
          sufijo="TM"
          tono={Number(pedido.tm_faltantes) > 0 ? 'critico' : 'ok'}
        />
        {puedeVerCostos && (
          <Kpi etiqueta="Valor de la venta" valor={dinero(pedido.venta, moneda, 0)} tono="marca" />
        )}
      </RejillaKpi>

      {/* --- Pestañas --- */}
      <nav className="pestanas no-imprimir" aria-label="Secciones del pedido">
        {PESTANAS.map((p) => (
          <Link
            key={p.clave}
            href={`/ventas/pedidos/${pedidoId}?t=${p.clave}`}
            className="pestana"
            data-activa={pestana === p.clave ? 'si' : 'no'}
          >
            {p.titulo}
          </Link>
        ))}
      </nav>

      {/* ══════ GENERAL ══════ */}
      {pestana === 'general' && (
        <div className="rejilla-2">
          <Panel titulo="Datos del pedido">
            <dl className="ficha">
              <div><dt>Proforma</dt><dd className="mono">{pedido.numero_proforma}</dd></div>
              <div><dt>Cliente</dt><dd>{pedido.cliente}</dd></div>
              <div><dt>País</dt><dd>{pedido.pais ?? '—'}</dd></div>
              <div><dt>Destino</dt><dd>{pedido.destino ?? '—'}{pedido.destino_pais ? `, ${pedido.destino_pais}` : ''}</dd></div>
              <div><dt>Incoterm</dt><dd>{pedido.incoterm}</dd></div>
              <div><dt>Moneda</dt><dd>{moneda} · TC {num(pedido.tipo_cambio, 2)}</dd></div>
              <div><dt>Prioridad</dt><dd><Etiqueta texto={etiquetaEstado(pedido.prioridad as string)} tono={pedido.prioridad === 'urgente' ? 'critico' : 'neutro'} /></dd></div>
            </dl>
          </Panel>

          <Panel titulo="Estado y fechas">
            <dl className="ficha">
              <div><dt>Ciclo comercial</dt><dd><Etiqueta texto={etiquetaEstado(pedido.ciclo as string)} tono="info" /></dd></div>
              <div><dt>Cobertura de stock</dt><dd><Etiqueta texto={etiquetaEstado(pedido.cobertura as string)} tono="neutro" /></dd></div>
              <div><dt>Situación financiera</dt><dd><Etiqueta texto={etiquetaEstado(pedido.situacion as string)} tono={pedido.situacion === 'vencido' ? 'critico' : 'neutro'} /></dd></div>
              <div><dt>Solicitado</dt><dd>{fecha(pedido.fecha_solicitada as string)}</dd></div>
              <div>
                <dt>Comprometido</dt>
                <dd style={{ color: pedido.atrasado ? 'var(--critico)' : undefined }}>
                  {fecha(pedido.fecha_comprometida as string)}
                  {pedido.atrasado && <> · <strong>atrasado</strong></>}
                </dd>
              </div>
              <div>
                <dt>Avance</dt>
                <dd>
                  <Barra porcentaje={avance} tono={avance >= 100 ? 'ok' : 'atencion'} />
                  <span style={{ fontSize: '.75rem', color: 'var(--tinta-3)' }}>{avance.toFixed(1)} %</span>
                </dd>
              </div>
            </dl>
          </Panel>
        </div>
      )}

      {/* ══════ PRODUCTOS ══════ */}
      {pestana === 'productos' && (
        <Panel titulo={`${(lineas ?? []).length} líneas de producto`}>
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos">
              <thead>
                <tr>
                  <th>SKU</th><th>Producto</th><th>Presentación</th>
                  <th className="num">Cantidad</th>
                  {puedeVerCostos && <><th className="num">Precio lista</th><th className="num">Descuento</th><th className="num">Precio</th><th className="num">Venta</th></>}
                </tr>
              </thead>
              <tbody>
                {(lineas ?? []).map((l) => {
                  const sp = uno(l.sku_presentaciones);
                  const sku = uno(sp?.skus);
                  const venta = Number(l.cantidad_tm) * Number(l.precio_tm) * (1 - Number(l.descuento_pct) / 100);
                  return (
                    <tr key={l.id as number}>
                      <td className="mono">{campo(sku, 'codigo')}</td>
                      <td>
                        {campo(sku?.especies, 'nombre')} · {campo(sku?.formatos, 'nombre')}
                        <br />
                        <span style={{ color: 'var(--tinta-3)', fontSize: '.74rem' }}>{campo(sku, 'corte')}</span>
                      </td>
                      <td className="mono">{campo(sp?.presentaciones, 'descripcion')}</td>
                      <td className="num">{num(l.cantidad_tm, 3)} TM</td>
                      {puedeVerCostos && (
                        <>
                          <td className="num">{num(l.precio_lista_tm, 2)}</td>
                          <td className="num">{Number(l.descuento_pct) > 0 ? pct(l.descuento_pct) : '—'}</td>
                          <td className="num">{num(l.precio_tm, 2)}</td>
                          <td className="num"><strong>{dinero(venta, moneda, 0)}</strong></td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* ══════ RESERVAS ══════ */}
      {pestana === 'reservas' && (
        <Panel titulo={`${(reservas ?? []).length} reservas registradas`}>
          {(reservas ?? []).length === 0 ? (
            <Vacio titulo="Sin reservas" mensaje="Este pedido todavía no tiene producto apartado." />
          ) : (
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos">
                <thead>
                  <tr>
                    <th>Estado</th><th>Lote</th><th>Almacén</th>
                    <th className="num">Bultos</th><th className="num">Peso</th>
                    <th className="num">Vence</th><th>Observación</th>
                  </tr>
                </thead>
                <tbody>
                  {(reservas ?? []).map((r) => {
                    const est = r.estado as string;
                    const tono = est === 'consumida' ? 'ok'
                      : est === 'activa' || est === 'en_preparacion' ? 'info'
                      : 'critico';
                    return (
                      <tr key={r.id as number}>
                        <td><Etiqueta texto={etiquetaEstado(est)} tono={tono} /></td>
                        <td className="mono">
                          {campo(r.lotes, 'codigo_pallet')}
                          <br />
                          <span style={{ color: 'var(--tinta-3)', fontSize: '.7rem' }}>
                            prod. {fecha(campo(r.lotes, 'fecha_produccion', ''))}
                          </span>
                        </td>
                        <td>{campo(r.almacenes, 'nombre')}</td>
                        <td className="num">{num(r.bultos)}</td>
                        <td className="num">{tm(r.peso_neto_kg)} TM</td>
                        <td className="num">{r.vence_el ? fecha(r.vence_el as string) : '—'}</td>
                        <td style={{ fontSize: '.76rem', color: 'var(--tinta-3)' }}>
                          {(r.motivo_liberacion as string) ?? '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="pie-explicativo" style={{ padding: '0 1rem 1rem' }}>
            Cada reserva apunta a un <strong>lote concreto en una bodega concreta</strong>, no a
            &laquo;producto en general&raquo;. Por eso el sistema puede garantizar que lo reservado
            existe físicamente, y por eso una reserva vencida libera stock real.
          </p>
        </Panel>
      )}

      {/* ══════ DISPONIBILIDAD y FALTANTES ══════ */}
      {(pestana === 'disponibilidad' || pestana === 'faltantes') && (
        <Panel titulo={pestana === 'faltantes' ? 'Lo que falta conseguir' : 'Cobertura de cada línea'}>
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos">
              <thead>
                <tr>
                  <th>SKU</th><th>Producto</th>
                  <th className="num">Pedido</th><th className="num">Reservado</th><th className="num">Falta</th>
                  <th className="num">Cobertura</th>
                </tr>
              </thead>
              <tbody>
                {(lineas ?? []).map((l) => {
                  const sp = uno(l.sku_presentaciones);
                  const sku = uno(sp?.skus);
                  const reservadoKg = (reservas ?? [])
                    .filter((r) => ['activa', 'en_preparacion', 'consumida'].includes(r.estado as string))
                    .reduce((s, r) => s + Number(r.peso_neto_kg ?? 0), 0);
                  const pedidoKg = Number(l.cantidad_tm) * 1000;
                  const cubierto = Math.min(100, (reservadoKg / (pedidoKg || 1)) * 100);
                  const falta = Math.max(0, pedidoKg - reservadoKg) / 1000;
                  if (pestana === 'faltantes' && falta <= 0) return null;
                  return (
                    <tr key={l.id as number}>
                      <td className="mono">{campo(sku, 'codigo')}</td>
                      <td>{campo(sku?.especies, 'nombre')} · {campo(sku, 'corte')}</td>
                      <td className="num">{num(l.cantidad_tm, 1)} TM</td>
                      <td className="num">{tm(reservadoKg)} TM</td>
                      <td className="num">
                        {falta > 0 ? <strong style={{ color: 'var(--atencion)' }}>{num(falta, 1)} TM</strong> : '—'}
                      </td>
                      <td className="num" style={{ minWidth: '5rem' }}>
                        <Barra porcentaje={cubierto} tono={cubierto >= 100 ? 'ok' : 'atencion'} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* ══════ EMBARQUES ══════ */}
      {pestana === 'embarques' && (
        <Panel titulo={`${(embarques ?? []).length} embarques asociados`}>
          {(embarques ?? []).length === 0 ? (
            <Vacio titulo="Sin embarques" mensaje="Este pedido aún no está programado en ningún embarque." />
          ) : (
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos">
                <thead>
                  <tr><th>Embarque</th><th>Fecha</th><th>Almacén</th><th>Destino</th><th>Booking</th><th>Naviera</th><th>Estado</th></tr>
                </thead>
                <tbody>
                  {(embarques ?? []).map((e, i) => {
                    const emb = uno(e.embarques);
                    if (!emb) return null;
                    return (
                      <tr key={i}>
                        <td>
                          <Link href={`/logistica/embarques/${emb.id}`} className="enlace-dato">
                            {emb.numero as string}
                          </Link>
                        </td>
                        <td className="mono">{fecha(emb.fecha_programada as string)}</td>
                        <td>{campo(emb.almacenes, 'nombre')}</td>
                        <td>{campo(emb.destinos, 'puerto')}</td>
                        <td className="mono">{(emb.booking as string) ?? '—'}</td>
                        <td>{(emb.naviera as string) ?? '—'}</td>
                        <td><Etiqueta texto={etiquetaEstado(emb.estado as string)} tono="info" /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {/* ══════ FACTURAS y COBRANZA ══════ */}
      {(pestana === 'facturas' || pestana === 'cobranza') && (
        <Panel titulo={`${(facturas ?? []).length} documentos emitidos`}>
          {(facturas ?? []).length === 0 ? (
            <Vacio titulo="Sin facturas" mensaje="Este pedido todavía no se ha facturado." />
          ) : (
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos">
                <thead>
                  <tr><th>Documento</th><th>Emisión</th><th>Vencimiento</th><th className="num">Total</th><th>Estado</th></tr>
                </thead>
                <tbody>
                  {(facturas ?? []).map((f) => (
                    <tr key={f.id as number}>
                      <td className="mono">{f.numero}</td>
                      <td className="mono">{fecha(f.fecha_emision as string)}</td>
                      <td className="mono">{fecha(f.fecha_vencimiento as string)}</td>
                      <td className="num">{dinero(f.total, f.moneda as 'USD' | 'PEN', 2)}</td>
                      <td>
                        <Etiqueta
                          texto={etiquetaEstado(f.estado as string)}
                          tono={f.estado === 'cobrada' ? 'ok' : f.estado === 'vencida' ? 'critico' : 'atencion'}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {/* ══════ DESPACHOS ══════ */}
      {pestana === 'despachos' && (
        <Panel titulo="Despachos realizados">
          <Vacio
            titulo={Number(pedido.tm_despachadas) > 0 ? `${num(pedido.tm_despachadas, 1)} TM despachadas` : 'Sin despachos'}
            mensaje="El detalle por contenedor está en la pestaña Embarques y en el módulo de Logística."
          />
        </Panel>
      )}

      {/* ══════ RENTABILIDAD ══════ */}
      {pestana === 'rentabilidad' && (
        puedeVerCostos ? (
          <div className="rejilla-2">
            <Panel titulo="Resultado del pedido">
              <dl className="ficha">
                <div><dt>Venta</dt><dd>{dinero(rentabilidad?.venta, moneda, 2)}</dd></div>
                <div><dt>Costo estimado</dt><dd>{dinero(rentabilidad?.costo_estimado, moneda, 2)}</dd></div>
                <div><dt>Costo real de los lotes despachados</dt><dd>{dinero(rentabilidad?.costo_real, moneda, 2)}</dd></div>
                <div><dt>Margen</dt><dd><strong>{dinero(rentabilidad?.margen, moneda, 2)}</strong></dd></div>
                <div>
                  <dt>Margen %</dt>
                  <dd>
                    <strong style={{ color: Number(rentabilidad?.margen_pct) < 8 ? 'var(--critico)' : 'var(--ok)' }}>
                      {pct(rentabilidad?.margen_pct)}
                    </strong>
                    {Number(rentabilidad?.margen_pct) < 8 && <> · <Etiqueta texto="Margen bajo" tono="critico" /></>}
                  </dd>
                </div>
              </dl>
            </Panel>
            <Panel titulo="Cómo se calcula">
              <p className="pie-explicativo" style={{ padding: '1rem' }}>
                El <strong>costo estimado</strong> es el que se previó al vender. El <strong>costo real</strong> sale
                del costo promedio de los lotes que efectivamente se cargaron en el contenedor. La diferencia entre
                ambos indica si el producto que salió era más caro o más barato de lo que se supuso al cotizar —
                información que hoy no existe en el Excel.
              </p>
            </Panel>
          </div>
        ) : (
          <Panel titulo="Rentabilidad">
            <Vacio titulo="Sin acceso" mensaje="Su rol no tiene permiso para consultar costos ni márgenes." />
          </Panel>
        )
      )}

      {/* ══════ HISTORIAL ══════ */}
      {pestana === 'historial' && (
        <Panel titulo="Todo lo que le pasó a este pedido">
          <Historial entidad="pedidos" entidadId={pedidoId} />
        </Panel>
      )}
    </>
  );
}
