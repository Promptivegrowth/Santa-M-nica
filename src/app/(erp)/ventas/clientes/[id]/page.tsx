/**
 * ============================================================================
 *  FICHA DEL CLIENTE
 * ============================================================================
 *  Todo lo que hace falta saber antes de aceptarle un pedido:
 *
 *    ¿CUÁNTO NOS COMPRA?    volumen y facturación históricos
 *    ¿CUÁNTO NOS DEBE?      saldo vencido y por vencer
 *    ¿LE QUEDA CRÉDITO?     línea aprobada menos deuda viva
 *    ¿QUÉ TIENE EN CURSO?   pedidos abiertos y cotizaciones vivas
 *
 *  La barra de crédito es lo primero que se ve porque es lo que decide si el
 *  siguiente pedido se puede aceptar. En la reunión quedó claro que hoy esa
 *  información está repartida entre Comercial y Finanzas y nadie la ve junta.
 * ============================================================================
 */
import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel, Vacio, Etiqueta, RejillaKpi, Kpi, Barra } from '@/components/ui/Pagina';
import { Historial } from '@/components/ui/Historial';
import { EsqueletoKpi, EsqueletoTabla, EsqueletoFicha } from '@/components/ui/Esqueleto';
import { Icono } from '@/components/estructura/Icono';
import { fecha, num, dinero, tm, etiquetaEstado, diasDesdeHoy } from '@/lib/formato';
import { veCostos, type Rol } from '@/lib/navegacion';
import { campo } from '@/lib/relaciones';

export const dynamic = 'force-dynamic';

export async function generateMetadata(
  props: PageProps<'/ventas/clientes/[id]'>
): Promise<Metadata> {
  const { id } = await props.params;
  const supabase = await crearClienteServidor();
  const { data } = await supabase.from('clientes').select('razon_social').eq('id', Number(id)).single();
  return { title: data?.razon_social ?? 'Cliente' };
}

/* Los seis estados del ciclo del pedido, tal como los define el enum. */
const TONO_CICLO: Record<string, 'ok' | 'atencion' | 'critico' | 'info' | 'neutro'> = {
  borrador: 'neutro', pendiente_validacion: 'atencion', confirmado: 'info',
  despachado: 'ok', cerrado: 'ok', cancelado: 'critico',
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
export default async function FichaCliente(props: PageProps<'/ventas/clientes/[id]'>) {
  const { id } = await props.params;
  const cliId = Number(id);

  const supabase = await crearClienteServidor();
  const { data: c } = await supabase
    .from('clientes')
    .select('*, vendedores(id, nombre, email)')
    .eq('id', cliId)
    .single();

  if (!c) notFound();

  return (
    <>
      <CabeceraPagina
        titulo={c.razon_social as string}
        descripcion={`${c.pais as string} · ${(c.tipo as string) ?? 'cliente'} · ${(c.ruc_tax_id as string) ?? 'sin identificación fiscal'}`}
        volver={{ href: '/ventas/clientes', texto: 'Volver a clientes' }}
      >
        <Link href={`/ventas/cotizaciones/nueva?cliente=${cliId}`} className="btn btn-secundario">
          <Icono nombre="cotizacion" tamano={15} />
          Cotizar
        </Link>
        <Link href={`/ventas/pedidos/nuevo?cliente=${cliId}`} className="btn btn-primario">
          <Icono nombre="mas" tamano={15} />
          Nuevo pedido
        </Link>
      </CabeceraPagina>

      <Suspense fallback={<CargandoCuerpo />}>
        <CuerpoCliente cliId={cliId} c={c} />
      </Suspense>
    </>
  );
}

function CargandoCuerpo() {
  return (
    <>
      <EsqueletoKpi cantidad={5} />
      <div className="rejilla-2">
        <EsqueletoFicha lineas={10} />
        <EsqueletoFicha lineas={5} />
      </div>
      <EsqueletoTabla filas={5} columnas={8} conFiltros={false} />
      <EsqueletoTabla filas={4} columnas={6} conFiltros={false} />
      <span className="sr-solo" role="status">Cargando la información del cliente…</span>
    </>
  );
}

/** Su cartera: crédito, pedidos, cotizaciones y facturas. */
async function CuerpoCliente({ cliId, c }: { cliId: number; c: Record<string, unknown> }) {
  const supabase = await crearClienteServidor();
  const usuario = await obtenerUsuarioActual();
  const puedeVerImportes = veCostos((usuario?.rol ?? 'consulta') as Rol);

  const [{ data: pedidos }, { data: cotizaciones }, { data: facturas }] =
    await Promise.all([
      supabase
        .from('pedidos')
        .select('id, numero_proforma, fecha_comprometida, ciclo, cobertura, situacion, moneda, prioridad, pedido_lineas(cantidad_tm, precio_tm, descuento_pct)')
        .eq('cliente_id', cliId)
        .order('creado_en', { ascending: false })
        .limit(25),
      supabase
        .from('cotizaciones')
        .select('id, numero, fecha, estado, moneda, cotizacion_lineas(cantidad_tm, precio_tm, descuento_pct)')
        .eq('cliente_id', cliId)
        .order('fecha', { ascending: false })
        .limit(15),
      supabase
        .from('facturas')
        .select('id, numero, fecha_emision, fecha_vencimiento, total, moneda, estado, cobranzas(monto)')
        .eq('cliente_id', cliId)
        .order('fecha_emision', { ascending: false })
        .limit(25),
    ]);

  /* ---- Deuda viva: lo facturado menos lo cobrado, sin contar anuladas ---- */
  const vivas = (facturas ?? []).filter((f) => f.estado !== 'anulada');
  const saldoDe = (f: (typeof vivas)[number]) =>
    Number(f.total ?? 0) - ((f.cobranzas ?? []) as { monto: number }[]).reduce((s, x) => s + Number(x.monto ?? 0), 0);

  const deuda = vivas.reduce((s, f) => s + Math.max(0, saldoDe(f)), 0);
  const vencido = vivas
    .filter((f) => saldoDe(f) > 0.01 && diasDesdeHoy(f.fecha_vencimiento as string) < 0)
    .reduce((s, f) => s + saldoDe(f), 0);

  const linea = Number(c.linea_credito ?? 0);
  const disponible = Math.max(0, linea - deuda);
  const usoPct = linea > 0 ? Math.min(100, (deuda / linea) * 100) : 0;

  /* ---- Volumen histórico ---- */
  const tmTotal = (pedidos ?? []).reduce(
    (s, p) => s + ((p.pedido_lineas ?? []) as { cantidad_tm: number }[]).reduce((x, l) => x + Number(l.cantidad_tm ?? 0), 0),
    0
  );
  const facturadoTotal = vivas.reduce((s, f) => s + Number(f.total ?? 0), 0);
  const abiertos = (pedidos ?? []).filter((p) => !['cerrado', 'cancelado'].includes(p.ciclo as string));

  return (
    <>
      {c.bloqueado === true && (
        <div className="ficha-aviso ficha-aviso-critico">
          <Icono nombre="alerta" tamano={17} />
          <span>
            <strong>Cliente bloqueado.</strong>{' '}
            {(c.motivo_bloqueo as string) ?? 'Sin motivo registrado.'} No se le pueden confirmar
            pedidos nuevos hasta que Gerencia lo desbloquee desde el maestro de clientes.
          </span>
        </div>
      )}

      {c.activo === false && (
        <div className="ficha-aviso ficha-aviso-atencion">
          <Icono nombre="reloj" tamano={17} />
          <span><strong>Cliente inactivo.</strong> No aparece en los buscadores de venta.</span>
        </div>
      )}

      {puedeVerImportes && vencido > 0 && (
        <div className="ficha-aviso ficha-aviso-atencion">
          <Icono nombre="cobrar" tamano={17} />
          <span>
            <strong>Tiene {dinero(vencido, c.moneda as 'USD' | 'PEN', 0)} vencidos.</strong> Conviene
            revisar la cobranza antes de comprometer más mercadería.{' '}
            <Link href={`/finanzas/cobrar?cliente=${cliId}`}>Ver cuentas por cobrar</Link>.
          </span>
        </div>
      )}

      <RejillaKpi>
        <Kpi etiqueta="Pedidos abiertos" valor={num(abiertos.length)} tono={abiertos.length ? 'marca' : 'neutro'} />
        <Kpi etiqueta="Volumen histórico" valor={tm(tmTotal * 1000)} nota="Suma de sus pedidos" />
        {puedeVerImportes && (
          <>
            <Kpi etiqueta="Facturado" valor={dinero(facturadoTotal, c.moneda as 'USD' | 'PEN', 0)} />
            <Kpi
              etiqueta="Deuda viva"
              valor={dinero(deuda, c.moneda as 'USD' | 'PEN', 0)}
              tono={vencido > 0 ? 'critico' : deuda > 0 ? 'atencion' : 'ok'}
              nota={vencido > 0 ? `${dinero(vencido, c.moneda as 'USD' | 'PEN', 0)} vencidos` : 'Al día'}
            />
            <Kpi
              etiqueta="Crédito disponible"
              valor={linea > 0 ? dinero(disponible, c.moneda as 'USD' | 'PEN', 0) : 'Sin línea'}
              tono={linea > 0 && disponible <= 0 ? 'critico' : 'ok'}
            />
          </>
        )}
      </RejillaKpi>

      <div className="rejilla-2 mb-espacio">
        <Panel titulo="Datos del cliente">
          <dl className="ficha">
            <div><dt>Código</dt><dd className="mono">{c.codigo as string}</dd></div>
            <div><dt>Razón social</dt><dd>{c.razon_social as string}</dd></div>
            <div><dt>Nombre corto</dt><dd>{(c.nombre_corto as string) ?? '—'}</dd></div>
            <div><dt>País</dt><dd>{c.pais as string}</dd></div>
            <div><dt>Identificación fiscal</dt><dd className="mono">{(c.ruc_tax_id as string) ?? '—'}</dd></div>
            <div><dt>Contacto</dt><dd>{(c.contacto as string) ?? '—'}</dd></div>
            <div><dt>Correo</dt><dd>{(c.email as string) ?? '—'}</dd></div>
            <div><dt>Teléfono</dt><dd>{(c.telefono as string) ?? '—'}</dd></div>
            <div><dt>Vendedor asignado</dt><dd>{campo(c.vendedores, 'nombre', 'Venta directa')}</dd></div>
            <div><dt>Alta</dt><dd>{fecha(c.creado_en as string)}</dd></div>
          </dl>
        </Panel>

        <Panel titulo="Condiciones comerciales">
          <dl className="ficha">
            <div><dt>Moneda</dt><dd>{c.moneda as string}</dd></div>
            <div><dt>Días de crédito</dt><dd>{num(Number(c.dias_credito))} días</dd></div>
            <div>
              <dt>Línea de crédito</dt>
              <dd>{linea > 0 ? dinero(linea, c.moneda as 'USD' | 'PEN', 0) : 'Sin línea asignada'}</dd>
            </div>
            <div><dt>Estado</dt>
              <dd>
                <Etiqueta
                  texto={c.bloqueado ? 'Bloqueado' : c.activo ? 'Activo' : 'Inactivo'}
                  tono={c.bloqueado ? 'critico' : c.activo ? 'ok' : 'neutro'}
                />
              </dd>
            </div>
          </dl>

          {puedeVerImportes && linea > 0 && (
            <div style={{ padding: '0 1rem 1rem' }}>
              <div style={{ fontSize: '.7rem', color: 'var(--tinta-3)', marginBottom: '.3rem' }}>
                USO DE LA LÍNEA · {num(usoPct, 0)} %
              </div>
              <Barra
                porcentaje={usoPct}
                tono={usoPct >= 100 ? 'critico' : usoPct >= 80 ? 'atencion' : 'ok'}
              />
              <p style={{ fontSize: '.75rem', color: 'var(--tinta-2)', marginTop: '.35rem' }}>
                Debe {dinero(deuda, c.moneda as 'USD' | 'PEN', 0)} de una línea de{' '}
                {dinero(linea, c.moneda as 'USD' | 'PEN', 0)}. Le quedan{' '}
                <strong>{dinero(disponible, c.moneda as 'USD' | 'PEN', 0)}</strong>.
              </p>
            </div>
          )}
        </Panel>
      </div>

      {/* ---- Pedidos ---- */}
      <Panel
        titulo={`Pedidos · ${(pedidos ?? []).length} más recientes`}
        className="mb-espacio"
        acciones={<Link href={`/ventas/pedidos?cliente=${cliId}`} className="btn btn-sutil">Ver todos</Link>}
      >
        {(pedidos ?? []).length === 0 ? (
          <Vacio titulo="Sin pedidos" mensaje="Este cliente todavía no ha comprado." />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos">
              <thead>
                <tr>
                  <th>Proforma</th><th className="num">Compromiso</th>
                  <th className="num">TM</th>
                  {puedeVerImportes && <th className="num">Valor</th>}
                  <th>Ciclo</th><th>Cobertura</th><th>Financiero</th><th></th>
                </tr>
              </thead>
              <tbody>
                {(pedidos ?? []).map((p) => {
                  const ls = (p.pedido_lineas ?? []) as { cantidad_tm: number; precio_tm: number; descuento_pct: number }[];
                  const t = ls.reduce((s, l) => s + Number(l.cantidad_tm ?? 0), 0);
                  const v = ls.reduce((s, l) => s + Number(l.cantidad_tm) * Number(l.precio_tm) * (1 - Number(l.descuento_pct) / 100), 0);
                  return (
                    <tr key={p.id as number}>
                      <td className="mono">
                        <Link href={`/ventas/pedidos/${p.id}`} className="enlace-ficha">
                          {p.numero_proforma as string}
                        </Link>
                      </td>
                      <td className="num" style={{ fontSize: '.75rem' }}>{fecha(p.fecha_comprometida as string)}</td>
                      <td className="num">{num(t, 1)}</td>
                      {puedeVerImportes && <td className="num">{dinero(v, p.moneda as 'USD' | 'PEN', 0)}</td>}
                      <td><Etiqueta texto={etiquetaEstado(p.ciclo as string)} tono={TONO_CICLO[p.ciclo as string] ?? 'neutro'} /></td>
                      <td style={{ fontSize: '.75rem' }}>{etiquetaEstado(p.cobertura as string)}</td>
                      <td style={{ fontSize: '.75rem' }}>{etiquetaEstado(p.situacion as string)}</td>
                      <td>
                        <Link href={`/ventas/pedidos/${p.id}`} className="accion-btn" title="Ver el pedido">
                          <Icono nombre="buscar" tamano={14} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* ---- Cotizaciones ---- */}
      <Panel
        titulo={`Cotizaciones · ${(cotizaciones ?? []).length}`}
        className="mb-espacio"
        acciones={<Link href="/ventas/cotizaciones" className="btn btn-sutil">Ver todas</Link>}
      >
        {(cotizaciones ?? []).length === 0 ? (
          <Vacio titulo="Sin cotizaciones" mensaje="A este cliente nunca se le pasó una oferta por el sistema." />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos">
              <thead>
                <tr>
                  <th>Cotización</th><th className="num">Fecha</th><th className="num">TM</th>
                  {puedeVerImportes && <th className="num">Valor</th>}
                  <th>Estado</th><th></th>
                </tr>
              </thead>
              <tbody>
                {(cotizaciones ?? []).map((q) => {
                  const ls = (q.cotizacion_lineas ?? []) as { cantidad_tm: number; precio_tm: number; descuento_pct: number }[];
                  const t = ls.reduce((s, l) => s + Number(l.cantidad_tm ?? 0), 0);
                  const v = ls.reduce((s, l) => s + Number(l.cantidad_tm) * Number(l.precio_tm) * (1 - Number(l.descuento_pct) / 100), 0);
                  return (
                    <tr key={q.id as number}>
                      <td className="mono">
                        <Link href={`/ventas/cotizaciones/${q.id}`} className="enlace-ficha">
                          {q.numero as string}
                        </Link>
                      </td>
                      <td className="num" style={{ fontSize: '.75rem' }}>{fecha(q.fecha as string)}</td>
                      <td className="num">{num(t, 1)}</td>
                      {puedeVerImportes && <td className="num">{dinero(v, q.moneda as 'USD' | 'PEN', 0)}</td>}
                      <td>
                        <Etiqueta
                          texto={etiquetaEstado(q.estado as string)}
                          tono={q.estado === 'aceptada' ? 'ok' : q.estado === 'rechazada' ? 'critico' : 'neutro'}
                        />
                      </td>
                      <td>
                        <Link href={`/ventas/cotizaciones/${q.id}`} className="accion-btn" title="Ver la cotización">
                          <Icono nombre="buscar" tamano={14} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* ---- Facturas ---- */}
      {puedeVerImportes && (
        <Panel titulo={`Facturas · ${(facturas ?? []).length} más recientes`} className="mb-espacio">
          {(facturas ?? []).length === 0 ? (
            <Vacio titulo="Sin facturas" mensaje="No se le ha emitido ningún comprobante." />
          ) : (
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos">
                <thead>
                  <tr>
                    <th>Factura</th><th className="num">Emisión</th><th className="num">Vence</th>
                    <th className="num">Total</th><th className="num">Saldo</th><th>Estado</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {(facturas ?? []).map((f) => {
                    const saldo = saldoDe(f);
                    const dias = diasDesdeHoy(f.fecha_vencimiento as string);
                    return (
                      <tr key={f.id as number}>
                        <td className="mono">
                          <Link href={`/finanzas/facturas/${f.id}`} className="enlace-ficha">
                            {f.numero as string}
                          </Link>
                        </td>
                        <td className="num" style={{ fontSize: '.75rem' }}>{fecha(f.fecha_emision as string)}</td>
                        <td className="num" style={{ fontSize: '.75rem' }}>
                          {saldo > 0.01 && dias < 0
                            ? <span style={{ color: 'var(--critico)' }}>{fecha(f.fecha_vencimiento as string)}</span>
                            : fecha(f.fecha_vencimiento as string)}
                        </td>
                        <td className="num">{dinero(Number(f.total), f.moneda as 'USD' | 'PEN', 0)}</td>
                        <td className="num">
                          {saldo <= 0.01
                            ? <span style={{ color: 'var(--ok)' }}>Cobrada</span>
                            : dinero(saldo, f.moneda as 'USD' | 'PEN', 0)}
                        </td>
                        <td><Etiqueta texto={etiquetaEstado(f.estado as string)} tono={f.estado === 'anulada' ? 'critico' : 'neutro'} /></td>
                        <td>
                          <Link href={`/finanzas/facturas/${f.id}`} className="accion-btn" title="Ver la factura">
                            <Icono nombre="buscar" tamano={14} />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      <Panel titulo="Historial del cliente">
        <Historial entidad="clientes" entidadId={cliId} />
      </Panel>
    </>
  );
}
