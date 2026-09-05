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
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { FilaCobertura } from './Reservar';
import { CabeceraPagina, Panel, Vacio, Etiqueta, Semaforo, Barra, RejillaKpi, Kpi } from '@/components/ui/Pagina';
import { Historial } from '@/components/ui/Historial';
import { BotonesDocumento } from '@/components/ui/BotonesDocumento';
import { EsqueletoKpi, EsqueletoPestanas, EsqueletoFicha } from '@/components/ui/Esqueleto';
import { tm, num, fecha, dinero, pct, etiquetaEstado } from '@/lib/formato';
import { veCostos, type Rol } from '@/lib/navegacion';
import { uno, campo } from '@/lib/relaciones';
import { BotonFacturar } from './Facturar';

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
/**
 * Una fila de v_pedidos_tablero.
 *
 * Todos sus valores son escalares —la vista ya aplanó las relaciones— asi que
 * se pueden pintar directamente y pasar a los formateadores sin ir casteando
 * campo por campo. Se declara aqui porque la fila viaja del cascarón al
 * cuerpo y ambos necesitan saber qué reciben.
 */
type FilaPedido = Record<string, string | number | boolean | null>;

export default async function DetallePedido(props: PageProps<'/ventas/pedidos/[id]'>) {
  const { id } = await props.params;
  const q = await props.searchParams;
  const pedidoId = Number(id);
  const pestana = (q.t as string) ?? 'general';

  const supabase = await crearClienteServidor();
  const [{ data: pedido }, usuarioCab] = await Promise.all([
    supabase.from('v_pedidos_tablero').select('*').eq('id', pedidoId).single(),
    obtenerUsuarioActual(),
  ]);
  if (!pedido) notFound();

  const puedeFacturar = ['gerencia', 'operaciones', 'comercial'].includes(usuarioCab?.rol ?? '');

  return (
    <>
      <CabeceraPagina
        titulo={pedido.numero_proforma as string}
        descripcion={`${pedido.cliente} · ${pedido.destino ?? 'sin destino'}`}
        volver={{ href: '/ventas/pedidos', texto: 'Volver a pedidos' }}
      >
        <Semaforo estado={pedido.semaforo as never} />
        <BotonesDocumento
          tipo="proforma"
          id={pedidoId}
          numero={String(pedido.numero_proforma)}
        />
        <BotonFacturar pedidoId={pedidoId} puede={puedeFacturar} />
      </CabeceraPagina>

      <Suspense fallback={<CargandoCuerpo />}>
        <CuerpoPedido pedidoId={pedidoId} pestana={pestana} pedido={pedido} />
      </Suspense>
    </>
  );
}

function CargandoCuerpo() {
  return (
    <>
      <EsqueletoKpi cantidad={5} />
      <EsqueletoPestanas cantidad={11} />
      <div className="rejilla-2">
        <EsqueletoFicha lineas={7} />
        <EsqueletoFicha lineas={6} />
      </div>
      <span className="sr-solo" role="status">Cargando el pedido…</span>
    </>
  );
}

/** Indicadores, pestañas y el contenido de la pestaña activa. */
async function CuerpoPedido({
  pedidoId,
  pestana,
  pedido,
}: {
  pedidoId: number;
  pestana: string;
  pedido: FilaPedido;
}) {
  const supabase = await crearClienteServidor();
  const usuario = await obtenerUsuarioActual();
  const puedeVerCostos = veCostos((usuario?.rol ?? 'consulta') as Rol);
  const puedeReservar = ['gerencia', 'operaciones', 'comercial', 'almacen'].includes(usuario?.rol ?? '');

  const moneda = pedido.moneda as 'USD' | 'PEN';

  /*
   * El contacto y las cuentas se piden aparte porque el tablero es una VISTA
   * y no los incluye. Son dos consultas diminutas por clave.
   */
  const [{ data: cabecera }, { data: filasCuentas }] = await Promise.all([
    supabase
      .from('pedidos')
      .select('contacto_nombre, contacto_cargo, contacto_telefono, contacto_email')
      .eq('id', pedidoId)
      .single(),
    supabase
      .from('pedido_cuentas')
      .select('cuentas_bancarias(banco, tipo, moneda, numero, cci, swift)')
      .eq('pedido_id', pedidoId),
  ]);

  // `?? {}` deja el tipo en objeto vacío y TypeScript no encuentra los campos;
  // se declara lo que de verdad llega.
  const contacto = (cabecera ?? {}) as Record<string, string | null>;
  const cuentasDoc = (filasCuentas ?? [])
    .map((f) => uno<Record<string, unknown>>(f.cuentas_bancarias))
    .filter(Boolean)
    .map((c) => ({
      banco: String(c!.banco ?? ''),
      tipo: String(c!.tipo ?? ''),
      moneda: String(c!.moneda ?? ''),
      numero: String(c!.numero ?? ''),
      cci: String(c!.cci ?? ''),
      swift: String(c!.swift ?? ''),
    }))
    .sort((a, b) => Number(a.tipo === 'detraccion') - Number(b.tipo === 'detraccion'));

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
      .select('id, pedido_linea_id, bultos, peso_neto_kg, estado, vence_el, creado_en, motivo_liberacion, lotes(codigo_pallet, fecha_produccion), almacenes(nombre), pedido_lineas!inner(pedido_id)')
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
      <RejillaKpi>
        <Kpi etiqueta="Cantidad pedida" valor={num(Number(pedido.tm_pedidas), 1)} sufijo="TM" />
        <Kpi etiqueta="Reservado" valor={num(Number(pedido.tm_reservadas), 1)} sufijo="TM" tono="atencion" />
        <Kpi etiqueta="Despachado" valor={num(Number(pedido.tm_despachadas), 1)} sufijo="TM" tono="ok" />
        <Kpi
          etiqueta="Falta por cubrir"
          valor={num(Number(pedido.tm_faltantes), 1)}
          sufijo="TM"
          tono={Number(pedido.tm_faltantes) > 0 ? 'critico' : 'ok'}
        />
        {puedeVerCostos && (
          <Kpi etiqueta="Valor de la venta" valor={dinero(Number(pedido.venta), moneda, 0)} tono="marca" />
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
              <div><dt>Moneda</dt><dd>{moneda} · TC {num(Number(pedido.tipo_cambio), 2)}</dd></div>
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

          {/* ---- Lo que sale impreso en la proforma ---- */}
          <Panel titulo="Dirigido a">
            {!contacto.contacto_nombre ? (
              <Vacio
                titulo="Sin contacto"
                mensaje="Esta proforma no indica a qué persona del cliente va dirigida. No es obligatorio, pero quien la reciba no sabrá para quién es."
              />
            ) : (
              <dl className="ficha">
                <div><dt>Nombre</dt><dd>{contacto.contacto_nombre as string}</dd></div>
                <div><dt>Cargo</dt><dd>{(contacto.contacto_cargo as string) ?? '—'}</dd></div>
                <div><dt>Teléfono</dt><dd className="mono">{(contacto.contacto_telefono as string) ?? '—'}</dd></div>
                <div><dt>Correo</dt><dd className="mono">{(contacto.contacto_email as string) ?? '—'}</dd></div>
              </dl>
            )}
          </Panel>

          <Panel titulo={`Cuentas de cobro · ${cuentasDoc.length}`}>
            {cuentasDoc.length === 0 ? (
              <Vacio
                titulo="Sin cuentas"
                mensaje="La proforma saldrá sin datos de pago: el cliente tendrá que llamar para preguntar dónde deposita."
              />
            ) : (
              <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
                <table className="datos">
                  <thead>
                    <tr><th>Banco</th><th>Tipo</th><th>Número</th><th>CCI / SWIFT</th></tr>
                  </thead>
                  <tbody>
                    {cuentasDoc.map((c, i) => (
                      <tr key={i}>
                        <td>{c.banco}</td>
                        <td>
                          <Etiqueta
                            texto={c.tipo === 'detraccion' ? 'Detracción' : c.moneda}
                            tono={c.tipo === 'detraccion' ? 'atencion' : 'neutro'}
                          />
                        </td>
                        <td className="mono" style={{ fontSize: '.78rem' }}>{c.numero}</td>
                        <td className="mono" style={{ fontSize: '.7rem', color: 'var(--tinta-3)' }}>
                          {[c.cci, c.swift].filter(Boolean).join(' · ') || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(lineas ?? []).map((l) => {
                  const sp = uno(l.sku_presentaciones);
                  const sku = uno(sp?.skus);
                  /*
                   * Solo las reservas DE ESTA LÍNEA. Antes se sumaban todas las
                   * del pedido en cada fila, así que un pedido de tres líneas
                   * mostraba las tres cubiertas en cuanto se apartaba una.
                   */
                  const reservadoKg = (reservas ?? [])
                    .filter((r) => Number(r.pedido_linea_id) === Number(l.id))
                    .filter((r) => ['activa', 'en_preparacion', 'consumida'].includes(r.estado as string))
                    .reduce((s, r) => s + Number(r.peso_neto_kg ?? 0), 0);
                  const pedidoKg = Number(l.cantidad_tm) * 1000;
                  const cubierto = Math.min(100, (reservadoKg / (pedidoKg || 1)) * 100);
                  const falta = Math.max(0, pedidoKg - reservadoKg) / 1000;
                  if (pestana === 'faltantes' && falta <= 0) return null;
                  /*
                   * Las celdas se arman aquí, en el servidor, y se le pasan a
                   * la fila. La fila es un componente de navegador porque tiene
                   * que abrir y cerrar el panel; los datos, en cambio, no
                   * necesitan viajar al navegador para pintarse.
                   */
                  const celdas = (
                    <>
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
                    </>
                  );

                  return (
                    <FilaCobertura
                      key={l.id as number}
                      pedidoLineaId={l.id as number}
                      producto={`${campo(sku, 'codigo')} · ${campo(sku, 'corte')}`}
                      puede={puedeReservar && falta > 0}
                      columnas={7}
                      celdas={celdas}
                    />
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
            titulo={Number(pedido.tm_despachadas) > 0 ? `${num(Number(pedido.tm_despachadas), 1)} TM despachadas` : 'Sin despachos'}
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
                {/*
                  TODO este bloque va en dólares, incluso si la proforma está en
                  soles. El costo de un lote se registra en dólares al entrar a
                  cámara, así que restarle una venta en soles daría un margen sin
                  sentido. Debajo se indica el importe original.
                */}
                <div><dt>Venta</dt><dd>{dinero(rentabilidad?.venta, 'USD', 2)}</dd></div>
                <div><dt>Costo estimado</dt><dd>{dinero(rentabilidad?.costo_estimado, 'USD', 2)}</dd></div>
                <div><dt>Costo real de los lotes despachados</dt><dd>{dinero(rentabilidad?.costo_real, 'USD', 2)}</dd></div>
                <div><dt>Margen</dt><dd><strong>{dinero(rentabilidad?.margen, 'USD', 2)}</strong></dd></div>
                {moneda !== 'USD' && (
                  <div>
                    <dt>Venta según la proforma</dt>
                    <dd>
                      {dinero(rentabilidad?.venta_documento, moneda, 2)}
                      <br />
                      <small style={{ color: 'var(--tinta-3)' }}>
                        convertida a {dinero(rentabilidad?.venta, 'USD', 2)} con el tipo de cambio
                        del pedido ({num(Number(rentabilidad?.tipo_cambio ?? 0), 3)})
                      </small>
                    </dd>
                  </div>
                )}
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
