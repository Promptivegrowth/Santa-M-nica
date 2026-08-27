/**
 * ============================================================================
 *  FICHA DE LA FACTURA
 * ============================================================================
 *  Cierra el círculo del negocio: aquí se ve qué se facturó, contra qué pedido,
 *  con qué mercadería física, cuánto se ha cobrado y cuánto falta.
 *
 *  Lo valioso es el enlace hacia atrás: desde la factura se llega al pedido,
 *  del pedido al despacho, del despacho a los lotes. Si un cliente reclama por
 *  la mercadería de una factura concreta, en tres clics se sabe exactamente qué
 *  pallets recibió y de qué día de producción salieron.
 * ============================================================================
 */
import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { crearClienteServidor } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel, Vacio, Etiqueta, RejillaKpi, Kpi } from '@/components/ui/Pagina';
import { Historial } from '@/components/ui/Historial';
import { BotonesDocumento } from '@/components/ui/BotonesDocumento';
import { EsqueletoKpi, EsqueletoTabla, EsqueletoFicha } from '@/components/ui/Esqueleto';
import { Icono } from '@/components/estructura/Icono';
import { fecha, num, dinero, etiquetaEstado, diasDesdeHoy } from '@/lib/formato';
import { uno, campo } from '@/lib/relaciones';

export const dynamic = 'force-dynamic';

export async function generateMetadata(
  props: PageProps<'/finanzas/facturas/[id]'>
): Promise<Metadata> {
  const { id } = await props.params;
  const supabase = await crearClienteServidor();
  const { data } = await supabase.from('facturas').select('numero').eq('id', Number(id)).single();
  return { title: data?.numero ?? 'Factura' };
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
export default async function FichaFactura(props: PageProps<'/finanzas/facturas/[id]'>) {
  const { id } = await props.params;
  const facId = Number(id);

  const supabase = await crearClienteServidor();
  const { data: f } = await supabase
    .from('facturas')
    .select('*, clientes(id, razon_social, pais, dias_credito), pedidos(id, numero_proforma, ciclo, incoterm, destinos(puerto, pais))')
    .eq('id', facId)
    .single();

  if (!f) notFound();

  /*
   * La etiqueta de estado necesita saber si está cobrada, y eso depende de los
   * cobros. Preguntar solo por la SUMA es una consulta de un renglón: no vale
   * la pena hacer esperar la cabecera por el detalle completo.
   */
  const { data: sumaCobros } = await supabase
    .from('cobranzas').select('monto').eq('factura_id', facId);
  const cobradoCab = (sumaCobros ?? []).reduce((s, c) => s + Number(c.monto ?? 0), 0);
  const saldoCab = Number(f.total ?? 0) - cobradoCab;
  const anuladaCab = f.estado === 'anulada';
  const vencidaCab = !anuladaCab && saldoCab > 0.01 && diasDesdeHoy(f.fecha_vencimiento as string) < 0;

  return (
    <>
      <CabeceraPagina
        titulo={f.numero as string}
        descripcion={`${campo(f.clientes, 'razon_social')} · emitida el ${fecha(f.fecha_emision as string)}`}
        volver={{ href: '/finanzas/facturas', texto: 'Volver a facturación' }}
      >
        <Etiqueta
          texto={etiquetaEstado(f.estado as string)}
          tono={anuladaCab ? 'critico' : saldoCab <= 0.01 ? 'ok' : vencidaCab ? 'critico' : 'info'}
        />
        {/* El tipo decide el título del documento: factura o boleta de venta. */}
        <BotonesDocumento
          tipo={f.tipo_comprobante === 'boleta' ? 'boleta' : 'factura'}
          id={facId}
          numero={f.numero as string}
        />
      </CabeceraPagina>

      <Suspense fallback={<CargandoCuerpo />}>
        <CuerpoFactura facId={facId} f={f} />
      </Suspense>
    </>
  );
}

function CargandoCuerpo() {
  return (
    <>
      <EsqueletoKpi cantidad={5} />
      <div className="rejilla-2">
        <EsqueletoFicha lineas={8} />
        <EsqueletoTabla filas={3} columnas={4} conFiltros={false} />
      </div>
      <EsqueletoTabla filas={4} columnas={6} conFiltros={false} />
      <span className="sr-solo" role="status">Cargando la factura…</span>
    </>
  );
}

/** El detalle: líneas, cobros y los lotes que respaldan el comprobante. */
async function CuerpoFactura({ facId, f }: { facId: number; f: Record<string, unknown> }) {
  const supabase = await crearClienteServidor();

  const [{ data: lineas }, { data: cobros }, { data: origen }] = await Promise.all([
    supabase
      .from('factura_lineas')
      .select('id, cantidad_tm, precio_tm, importe, sku_presentaciones(skus(codigo, corte, especies(nombre), formatos(nombre)), presentaciones(descripcion))')
      .eq('factura_id', facId),
    supabase
      .from('cobranzas')
      .select('id, monto, fecha, medio, referencia, observaciones')
      .eq('factura_id', facId)
      .order('fecha'),
    // Trazabilidad hacia atrás: de la factura a los lotes que la surtieron.
    supabase.rpc('trazar_origen', { p_tipo: 'factura', p_id: facId }),
  ]);

  const moneda = f.moneda as 'USD' | 'PEN';
  const cobrado = (cobros ?? []).reduce((s, c) => s + Number(c.monto ?? 0), 0);
  const saldo = Number(f.total ?? 0) - cobrado;
  const anulada = f.estado === 'anulada';
  const dias = diasDesdeHoy(f.fecha_vencimiento as string);
  const vencida = !anulada && saldo > 0.01 && dias < 0;
  const cliente = uno<Record<string, unknown>>(f.clientes);
  const pedido = uno<Record<string, unknown>>(f.pedidos);

  return (
    <>
      {anulada && (
        <div className="ficha-aviso ficha-aviso-critico">
          <Icono nombre="cerrar" tamano={17} />
          <span>
            <strong>Factura anulada</strong> el {fecha(f.anulada_en as string)}.{' '}
            {(f.motivo_anulacion as string) ?? 'Sin motivo registrado.'} No suma a las cuentas por
            cobrar ni a la facturación del período.
          </span>
        </div>
      )}

      {vencida && (
        <div className="ficha-aviso ficha-aviso-critico">
          <Icono nombre="cobrar" tamano={17} />
          <span>
            <strong>Vencida hace {Math.abs(dias)} días.</strong> Quedan{' '}
            {dinero(saldo, moneda, 2)} por cobrar de esta factura.{' '}
            {cliente?.id ? (
              <Link href={`/ventas/clientes/${cliente.id}`}>Ver la situación completa del cliente</Link>
            ) : null}
            .
          </span>
        </div>
      )}

      {!anulada && saldo <= 0.01 && (
        <div className="ficha-aviso ficha-aviso-ok">
          <Icono nombre="calidad" tamano={17} />
          <span><strong>Factura cobrada por completo.</strong> Sin saldo pendiente.</span>
        </div>
      )}

      <RejillaKpi>
        <Kpi etiqueta="Subtotal" valor={dinero(Number(f.subtotal), moneda, 2)} />
        <Kpi etiqueta="IGV" valor={dinero(Number(f.igv), moneda, 2)} />
        <Kpi etiqueta="Total" valor={dinero(Number(f.total), moneda, 2)} tono="marca" />
        <Kpi etiqueta="Cobrado" valor={dinero(cobrado, moneda, 2)} tono={cobrado > 0 ? 'ok' : 'neutro'} />
        <Kpi
          etiqueta="Saldo"
          valor={dinero(saldo, moneda, 2)}
          tono={anulada ? 'neutro' : saldo <= 0.01 ? 'ok' : vencida ? 'critico' : 'atencion'}
          nota={anulada ? 'Anulada' : saldo <= 0.01 ? 'Cobrada' : dias < 0 ? `Vencida hace ${Math.abs(dias)} d` : `Vence en ${dias} d`}
        />
      </RejillaKpi>

      {/* ---- Navegación ---- */}
      <Panel titulo="Ir a" className="mb-espacio">
        <div className="ficha-enlaces">
          {cliente?.id ? (
            <Link href={`/ventas/clientes/${cliente.id}`} className="ficha-enlace">
              <Icono nombre="clientes" tamano={15} />
              <span><strong>{String(cliente.razon_social)}</strong><br /><small>Ficha del cliente</small></span>
            </Link>
          ) : null}
          {pedido?.id ? (
            <Link href={`/ventas/pedidos/${pedido.id}`} className="ficha-enlace">
              <Icono nombre="pedido" tamano={15} />
              <span><strong>{String(pedido.numero_proforma)}</strong><br /><small>Pedido de origen</small></span>
            </Link>
          ) : null}
          <Link href={`/finanzas/cobrar?factura=${facId}`} className="ficha-enlace">
            <Icono nombre="cobrar" tamano={15} />
            <span><strong>Cobranza</strong><br /><small>Registrar o consultar pagos</small></span>
          </Link>
        </div>
      </Panel>

      <div className="rejilla-2 mb-espacio">
        <Panel titulo="Datos del comprobante">
          <dl className="ficha">
            <div><dt>Número</dt><dd className="mono">{f.numero as string}</dd></div>
            <div><dt>Cliente</dt><dd>{campo(f.clientes, 'razon_social')}</dd></div>
            <div><dt>Emisión</dt><dd>{fecha(f.fecha_emision as string)}</dd></div>
            <div><dt>Vencimiento</dt><dd>{fecha(f.fecha_vencimiento as string)}</dd></div>
            <div><dt>Condición</dt><dd>{num(Number(cliente?.dias_credito ?? 0))} días de crédito</dd></div>
            <div><dt>Moneda</dt><dd>{moneda} · TC {num(Number(f.tipo_cambio), 3)}</dd></div>
            <div><dt>Incoterm</dt><dd>{campo(f.pedidos, 'incoterm', '—')}</dd></div>
            <div><dt>Destino</dt><dd>{campo(pedido?.destinos, 'puerto', '—')}</dd></div>
          </dl>
        </Panel>

        <Panel titulo={`Cobros registrados · ${(cobros ?? []).length}`}>
          {(cobros ?? []).length === 0 ? (
            <Vacio
              titulo="Sin cobros"
              mensaje="Todavía no se ha registrado ningún pago contra esta factura."
            />
          ) : (
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos">
                <thead>
                  <tr><th className="num">Fecha</th><th>Medio</th><th>Referencia</th><th className="num">Monto</th></tr>
                </thead>
                <tbody>
                  {(cobros ?? []).map((c) => (
                    <tr key={c.id as number}>
                      <td className="num" style={{ fontSize: '.75rem' }}>{fecha(c.fecha as string)}</td>
                      <td>{etiquetaEstado(c.medio as string)}</td>
                      <td className="mono" style={{ fontSize: '.74rem' }}>{(c.referencia as string) ?? '—'}</td>
                      <td className="num">{dinero(Number(c.monto), moneda, 2)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--superficie-2)', fontWeight: 600 }}>
                    <td colSpan={3}>Total cobrado</td>
                    <td className="num">{dinero(cobrado, moneda, 2)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <Panel titulo={`Detalle facturado · ${(lineas ?? []).length} líneas`} className="mb-espacio">
        {(lineas ?? []).length === 0 ? (
          <Vacio titulo="Sin líneas" mensaje="Esta factura no tiene detalle cargado." />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos">
              <thead>
                <tr>
                  <th>SKU</th><th>Producto</th><th>Presentación</th>
                  <th className="num">Cantidad</th><th className="num">Precio</th><th className="num">Importe</th>
                </tr>
              </thead>
              <tbody>
                {(lineas ?? []).map((l) => {
                  const sp = uno<Record<string, unknown>>(l.sku_presentaciones);
                  const sku = uno<Record<string, unknown>>(sp?.skus);
                  return (
                    <tr key={l.id as number}>
                      <td className="mono">{campo(sku, 'codigo')}</td>
                      <td style={{ fontSize: '.79rem' }}>
                        {campo(sku?.especies, 'nombre')} · {campo(sku?.formatos, 'nombre')} · {campo(sku, 'corte')}
                      </td>
                      <td className="mono" style={{ fontSize: '.75rem' }}>{campo(sp?.presentaciones, 'descripcion')}</td>
                      <td className="num">{num(l.cantidad_tm, 3)} TM</td>
                      <td className="num">{num(l.precio_tm, 2)}</td>
                      <td className="num"><strong>{dinero(Number(l.importe), moneda, 2)}</strong></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* ---- La trazabilidad hacia atrás: qué mercadería física respalda esta factura ---- */}
      <Panel
        titulo={`Lotes que surtieron esta factura · ${(origen ?? []).length}`}
        className="mb-espacio"
      >
        {(origen ?? []).length === 0 ? (
          <Vacio
            titulo="Sin despacho asociado"
            mensaje="Esta factura todavía no tiene mercadería despachada vinculada, o se emitió por adelantado."
          />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos">
              <thead>
                <tr>
                  <th>Pallet</th><th>Lote</th><th className="num">Producción</th>
                  <th>Producto</th><th>Planta</th><th className="num">Bultos</th>
                  <th className="num">Peso</th><th>Contenedor</th><th></th>
                </tr>
              </thead>
              <tbody>
                {((origen ?? []) as Record<string, unknown>[]).map((o, i) => (
                  <tr key={i}>
                    <td className="mono">
                      <Link href={`/almacenes/lotes/${o.lote_id}`} className="enlace-ficha">
                        {String(o.codigo_pallet)}
                      </Link>
                    </td>
                    <td className="mono" style={{ fontSize: '.75rem' }}>{(o.codigo_lote as string) ?? '—'}</td>
                    <td className="num" style={{ fontSize: '.75rem' }}>
                      {o.fecha_produccion ? fecha(o.fecha_produccion as string) : '—'}
                    </td>
                    <td style={{ fontSize: '.78rem' }}>{(o.producto as string) ?? '—'}</td>
                    <td style={{ fontSize: '.76rem' }}>{(o.planta as string) ?? '—'}</td>
                    <td className="num">{o.bultos != null ? num(o.bultos as number) : '—'}</td>
                    <td className="num">{o.peso_kg != null ? `${num(Number(o.peso_kg), 1)} kg` : '—'}</td>
                    <td className="mono" style={{ fontSize: '.73rem' }}>{(o.contenedor as string) ?? '—'}</td>
                    <td>
                      <Link href={`/almacenes/lotes/${o.lote_id}`} className="accion-btn" title="Ver el lote">
                        <Icono nombre="ver" tamano={15} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel titulo="Historial de la factura">
        <Historial entidad="facturas" entidadId={facId} />
      </Panel>

      <p className="pie-explicativo">
        Una factura emitida no se edita: si hay un error se anula dejando el motivo escrito y se
        emite una nueva. Así el correlativo y la contabilidad quedan siempre cuadrados.
      </p>
    </>
  );
}
