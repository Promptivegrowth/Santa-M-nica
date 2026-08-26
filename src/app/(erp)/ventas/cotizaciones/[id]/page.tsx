/**
 * ============================================================================
 *  FICHA DE LA COTIZACIÓN
 * ============================================================================
 *  El detalle completo de una oferta: qué se ofreció, a qué precio, con qué
 *  descuento, y qué pasó después.
 *
 *  Lo importante de esta pantalla es que está CONECTADA: desde aquí se llega
 *  al cliente, al pedido que generó (si lo generó) y a la trazabilidad de cada
 *  producto ofertado. Un documento suelto no sirve de nada; lo que sirve es
 *  poder seguir el hilo.
 * ============================================================================
 */
import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { Historial } from '@/components/ui/Historial';
import { EsqueletoTabla, EsqueletoFicha } from '@/components/ui/Esqueleto';
import { AccionesFicha } from './AccionesFicha';
import { Icono } from '@/components/estructura/Icono';
import { fecha, num, dinero, pct, etiquetaEstado, diasDesdeHoy } from '@/lib/formato';
import { veCostos, puedeVender, type Rol } from '@/lib/navegacion';
import { uno, campo } from '@/lib/relaciones';

export const dynamic = 'force-dynamic';

export async function generateMetadata(
  props: PageProps<'/ventas/cotizaciones/[id]'>
): Promise<Metadata> {
  const { id } = await props.params;
  const supabase = await crearClienteServidor();
  const { data } = await supabase
    .from('cotizaciones').select('numero').eq('id', Number(id)).single();
  return { title: data?.numero ?? 'Cotización' };
}

const TONO: Record<string, 'ok' | 'atencion' | 'critico' | 'info' | 'neutro'> = {
  aceptada: 'ok', enviada: 'info', borrador: 'neutro',
  rechazada: 'critico', vencida: 'atencion',
};

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
export default async function FichaCotizacion(props: PageProps<'/ventas/cotizaciones/[id]'>) {
  const { id } = await props.params;
  const cotId = Number(id);

  const supabase = await crearClienteServidor();
  const usuario = await obtenerUsuarioActual();
  const puedeOperar = puedeVender((usuario?.rol ?? 'consulta') as Rol);

  /*
   * El pedido se consulta aquí, junto a la cotización, porque la botonera de
   * la cabecera necesita saber si ya se convirtió: es lo que decide si los
   * botones de editar y eliminar salen activos o apagados. Son dos consultas
   * ligeras, ambas por clave.
   */
  const [{ data: cot }, { data: pedido }] = await Promise.all([
    supabase
      .from('cotizaciones')
      .select('*, clientes(id, razon_social, pais, moneda, bloqueado), vendedores(nombre), destinos(puerto, pais), listas_precio(nombre), usuarios!cotizaciones_creado_por_fkey(nombre)')
      .eq('id', cotId)
      .single(),
    supabase
      .from('pedidos')
      .select('id, numero_proforma, ciclo')
      .eq('cotizacion_id', cotId)
      .maybeSingle(),
  ]);

  if (!cot) notFound();

  const estado = cot.estado as string;

  return (
    <>
      <CabeceraPagina
        titulo={cot.numero as string}
        descripcion={`${campo(cot.clientes, 'razon_social')} · ${campo(cot.destinos, 'puerto')}`}
        volver={{ href: '/ventas/cotizaciones', texto: 'Volver a cotizaciones' }}
      >
        <Etiqueta texto={etiquetaEstado(estado)} tono={TONO[estado] ?? 'neutro'} />
        {puedeOperar && (
          <AccionesFicha
            cotizacionId={cotId}
            numero={cot.numero as string}
            estado={estado}
            yaConvertida={!!pedido}
          />
        )}
      </CabeceraPagina>

      <Suspense fallback={<CargandoCuerpo />}>
        <CuerpoCotizacion cotId={cotId} cot={cot} pedido={pedido} />
      </Suspense>
    </>
  );
}

function CargandoCuerpo() {
  return (
    <>
      <EsqueletoFicha lineas={3} />
      <EsqueletoTabla filas={5} columnas={8} conFiltros={false} />
      <div className="rejilla-2">
        <EsqueletoFicha lineas={7} />
        <EsqueletoFicha lineas={5} />
      </div>
      <span className="sr-solo" role="status">Cargando la cotización…</span>
    </>
  );
}

/** El detalle: líneas, totales, avisos e historial. */
async function CuerpoCotizacion({
  cotId,
  cot,
  pedido,
}: {
  cotId: number;
  cot: Record<string, unknown>;
  pedido: { id: number; numero_proforma: string; ciclo: string } | null;
}) {
  const supabase = await crearClienteServidor();
  const usuario = await obtenerUsuarioActual();
  const puedeVerImportes = veCostos((usuario?.rol ?? 'consulta') as Rol);

  const { data: lineas } = await supabase
    .from('cotizacion_lineas')
    .select('id, cantidad_tm, precio_lista_tm, precio_tm, descuento_pct, orden, sku_presentaciones(id, skus(codigo, corte, especies(nombre), formatos(nombre)), presentaciones(descripcion))')
    .eq('cotizacion_id', cotId)
    .order('orden');

  const cliente = uno<Record<string, unknown>>(cot.clientes);
  const moneda = cot.moneda as 'USD' | 'PEN';
  const estado = cot.estado as string;

  /* ---- Totales ---- */
  const filas = lineas ?? [];
  const subtotal = filas.reduce(
    (s, l) => s + Number(l.cantidad_tm) * Number(l.precio_tm) * (1 - Number(l.descuento_pct) / 100),
    0
  );
  const toneladas = filas.reduce((s, l) => s + Number(l.cantidad_tm ?? 0), 0);
  const bruto = filas.reduce((s, l) => s + Number(l.cantidad_tm) * Number(l.precio_lista_tm), 0);
  const descuentoTotal = bruto - subtotal;

  /* ---- Vigencia ---- */
  const diasValidez = Number(cot.validez_dias ?? 15);
  const vence = new Date(new Date(cot.fecha as string).getTime() + diasValidez * 86400000);
  const diasRestantes = diasDesdeHoy(vence);
  const vencida = diasRestantes < 0 && !['aceptada', 'rechazada'].includes(estado);

  return (
    <>
      {/* ---- Avisos de situación ---- */}
      {pedido && (
        <div className="ficha-aviso ficha-aviso-ok">
          <Icono nombre="pedido" tamano={17} />
          <span>
            <strong>Esta oferta se cerró.</strong> Generó el pedido{' '}
            <Link href={`/ventas/pedidos/${pedido.id}`}>{pedido.numero_proforma as string}</Link>, que
            está en estado <em>{etiquetaEstado(pedido.ciclo as string)}</em>. Por eso ya no se puede
            modificar ni eliminar: los precios de una venta cerrada no se cambian.
          </span>
        </div>
      )}

      {!pedido && vencida && (
        <div className="ficha-aviso ficha-aviso-atencion">
          <Icono nombre="reloj" tamano={17} />
          <span>
            <strong>La validez expiró</strong> hace {Math.abs(diasRestantes)} días
            ({fecha(vence)}). Si el cliente todavía está interesado, conviene rehacer la oferta con
            los precios vigentes.
          </span>
        </div>
      )}

      {cliente?.bloqueado === true && (
        <div className="ficha-aviso ficha-aviso-critico">
          <Icono nombre="alerta" tamano={17} />
          <span>
            <strong>El cliente tiene el crédito bloqueado.</strong> Esta cotización no se podrá
            convertir en pedido hasta regularizar su situación.
          </span>
        </div>
      )}

      {/* ---- Resumen ---- */}
      <dl className="ficha-resumen">
        <div><dt>Fecha</dt><dd>{fecha(cot.fecha as string)}</dd></div>
        <div><dt>Validez</dt><dd>{diasValidez} días · vence {fecha(vence)}</dd></div>
        <div><dt>Incoterm</dt><dd>{cot.incoterm as string}</dd></div>
        <div><dt>Moneda</dt><dd>{moneda} · TC {num(Number(cot.tipo_cambio), 2)}</dd></div>
        <div><dt>Líneas</dt><dd>{num(filas.length)}</dd></div>
        <div><dt>Toneladas</dt><dd>{num(toneladas, 3)} TM</dd></div>
        {puedeVerImportes && (
          <div><dt>Valor de la oferta</dt><dd>{dinero(subtotal, moneda, 2)}</dd></div>
        )}
      </dl>

      {/* ---- Navegación a entidades relacionadas ---- */}
      <Panel titulo="Ir a" className="mb-espacio">
        <div className="ficha-enlaces">
          {cliente?.id ? (
            <Link href={`/ventas/clientes/${cliente.id}`} className="ficha-enlace">
              <Icono nombre="clientes" tamano={15} />
              <span>
                <strong>{String(cliente.razon_social)}</strong>
                <br /><small>Ficha del cliente</small>
              </span>
            </Link>
          ) : null}

          {pedido && (
            <Link href={`/ventas/pedidos/${pedido.id}`} className="ficha-enlace">
              <Icono nombre="pedido" tamano={15} />
              <span>
                <strong>{pedido.numero_proforma as string}</strong>
                <br /><small>Pedido generado</small>
              </span>
            </Link>
          )}

          <Link href="/ventas/disponibilidad" className="ficha-enlace">
            <Icono nombre="disponibilidad" tamano={15} />
            <span>
              <strong>Disponibilidad</strong>
              <br /><small>Ver stock de estos productos</small>
            </span>
          </Link>
        </div>
      </Panel>

      {/* ---- Líneas ---- */}
      <Panel titulo={`Productos ofertados · ${filas.length}`} className="mb-espacio">
        {filas.length === 0 ? (
          <Vacio titulo="Sin productos" mensaje="Esta cotización no tiene líneas registradas." />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Producto</th>
                  <th>Presentación</th>
                  <th className="num">Cantidad</th>
                  {puedeVerImportes && (
                    <>
                      <th className="num">Precio lista</th>
                      <th className="num">Desc.</th>
                      <th className="num">Precio final</th>
                      <th className="num">Importe</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {filas.map((l) => {
                  const sp = uno<Record<string, unknown>>(l.sku_presentaciones);
                  const sku = uno<Record<string, unknown>>(sp?.skus);
                  const importe =
                    Number(l.cantidad_tm) * Number(l.precio_tm) * (1 - Number(l.descuento_pct) / 100);
                  return (
                    <tr key={l.id as number}>
                      <td className="mono">{campo(sku, 'codigo')}</td>
                      <td>
                        {campo(sku?.especies, 'nombre')} · {campo(sku?.formatos, 'nombre')}
                        <br />
                        <span style={{ color: 'var(--tinta-3)', fontSize: '.74rem' }}>
                          {campo(sku, 'corte')}
                        </span>
                      </td>
                      <td className="mono">{campo(sp?.presentaciones, 'descripcion')}</td>
                      <td className="num">{num(l.cantidad_tm, 3)} TM</td>
                      {puedeVerImportes && (
                        <>
                          <td className="num">{num(l.precio_lista_tm, 2)}</td>
                          <td className="num">
                            {Number(l.descuento_pct) > 0 ? (
                              <span style={{ color: 'var(--atencion)' }}>{pct(l.descuento_pct)}</span>
                            ) : '—'}
                          </td>
                          <td className="num">{num(l.precio_tm, 2)}</td>
                          <td className="num"><strong>{dinero(importe, moneda, 2)}</strong></td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              {puedeVerImportes && (
                <tfoot>
                  <tr style={{ background: 'var(--superficie-2)', fontWeight: 600 }}>
                    <td colSpan={3}>Total</td>
                    <td className="num">{num(toneladas, 3)} TM</td>
                    <td className="num"></td>
                    <td className="num">
                      {descuentoTotal > 0 ? (
                        <span style={{ color: 'var(--atencion)' }}>
                          −{dinero(descuentoTotal, moneda, 0)}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="num"></td>
                    <td className="num">
                      <strong style={{ color: 'var(--acento)' }}>{dinero(subtotal, moneda, 2)}</strong>
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </Panel>

      {/* ---- Datos administrativos ---- */}
      <div className="rejilla-2 mb-espacio">
        <Panel titulo="Datos de la oferta">
          <dl className="ficha">
            <div><dt>Cliente</dt><dd>{campo(cot.clientes, 'razon_social')}</dd></div>
            <div><dt>País</dt><dd>{campo(cot.clientes, 'pais')}</dd></div>
            <div><dt>Vendedor</dt><dd>{campo(cot.vendedores, 'nombre', 'Venta directa')}</dd></div>
            <div><dt>Destino</dt><dd>{campo(cot.destinos, 'puerto')}</dd></div>
            <div><dt>Lista de precio</dt><dd>{campo(cot.listas_precio, 'nombre')}</dd></div>
            <div><dt>Creada por</dt><dd>{campo(cot.usuarios, 'nombre')}</dd></div>
            {cot.observaciones ? (
              <div><dt>Observaciones</dt><dd>{cot.observaciones as string}</dd></div>
            ) : null}
          </dl>
        </Panel>

        <Panel titulo="Historial de esta cotización">
          <Historial entidad="cotizaciones" entidadId={cotId} />
        </Panel>
      </div>
    </>
  );
}
