/**
 * ============================================================================
 *  CUENTAS POR COBRAR · quién debe y desde cuándo
 * ============================================================================
 *  El dato clave no es cuánto deben, sino desde HACE CUÁNTO. Una deuda de un
 *  mes y una de seis meses valen lo mismo en el papel pero no en la realidad.
 *
 *  Por eso el eje principal de esta pantalla es la ANTIGÜEDAD del saldo.
 * ============================================================================
 */
import Link from 'next/link';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { AccionesLista } from '@/components/ui/Acciones';
import { BotonesReporte } from '@/components/ui/BotonesReporte';
import { PUEDEN_COBRAR } from '@/lib/permisosFinanzas';
import type { Rol } from '@/lib/navegacion';
import { GraficoBarras } from '@/components/graficos/Graficos';
import { num, fecha, dinero } from '@/lib/formato';
import { Paginacion } from '@/components/ui/Filtros';
import { traerTodo } from '@/lib/traerTodo';
import { Icono } from '@/components/estructura/Icono';

export const metadata: Metadata = { title: 'Cuentas por cobrar' };
export const dynamic = 'force-dynamic';

const TRAMOS = ['Vigente', '1 a 30 días', '31 a 60 días', '61 a 90 días', 'Más de 90 días'];

/*
 * Los totales van sobre TODA la cartera; la tabla, de 50 en 50. Antes la
 * consulta podía quedarse en las mil filas de la API y la tabla se cortaba en
 * 200 sin avisar: con la cartera real, el total no habría sido el total.
 */
const POR_PAGINA = 50;

export default async function PaginaCobrar(props: PageProps<'/finanzas/cobrar'>) {
  const q = await props.searchParams;
  const pagina = Math.max(1, Number(q.pagina ?? 1));
  /*
   * ?cliente=ID: llega desde «Ver cuentas por cobrar» de la ficha del cliente
   * (076). Antes la dirección lo traía y la pantalla lo ignoraba: se veía la
   * cartera entera. Ahora se filtra y se dice, con un enlace para quitarlo.
   */
  const clienteId = Number(q.cliente ?? 0) > 0 ? Number(q.cliente) : null;
  const supabase = await crearClienteServidor();
  const [filas, usuario, { data: clienteFiltro }] = await Promise.all([
    traerTodo((desde, hasta) => {
      let c = supabase.from('v_cuentas_cobrar').select('*').gt('saldo', 0.01);
      if (clienteId) c = c.eq('cliente_id', clienteId);
      return c.order('dias_vencida', { ascending: false }).order('id').range(desde, hasta);
    }),
    obtenerUsuarioActual(),
    clienteId
      ? supabase.from('clientes').select('id, razon_social').eq('id', clienteId).maybeSingle()
      : Promise.resolve({ data: null as { id: number; razon_social: string } | null }),
  ]);
  // Quien cobra tiene, en cada fila, el atajo al formulario de cobro de la ficha.
  const puedeCobrar = PUEDEN_COBRAR.includes((usuario?.rol ?? 'consulta') as Rol);

  const lista = filas ?? [];

  /*
   * Los totales van SIEMPRE sobre `saldo_usd` y no sobre `saldo`.
   *
   * `saldo` está en la moneda de cada factura, así que sumarlo mezclaría soles
   * con dólares en una sola cifra —que es exactamente lo que hacía esta
   * pantalla antes, mientras rotulaba el resultado en dólares—. La cartera
   * solo se puede totalizar en una moneda.
   */
  const total = lista.reduce((s, f) => s + Number(f.saldo_usd ?? 0), 0);
  const vencido = lista.filter((f) => Number(f.dias_vencida) > 0).reduce((s, f) => s + Number(f.saldo_usd ?? 0), 0);
  const masDe90 = lista.filter((f) => Number(f.dias_vencida) > 90).reduce((s, f) => s + Number(f.saldo_usd ?? 0), 0);

  const porTramo = TRAMOS.map((t) => ({
    etiqueta: t,
    valor: lista.filter((f) => f.tramo_antiguedad === t).reduce((s, f) => s + Number(f.saldo_usd ?? 0), 0),
  })).filter((t) => t.valor > 0);

  return (
    <>
      <CabeceraPagina
        titulo="Cuentas por cobrar"
        descripcion="Saldos pendientes ordenados por antigüedad. Lo que lleva más tiempo vencido está arriba."
      >
        {/* La misma cartera en Excel o PDF: quien ve la pantalla puede llevársela. */}
        <Suspense fallback={null}>
          <BotonesReporte tipo="cuentas_cobrar" />
        </Suspense>
      </CabeceraPagina>

      {clienteId && (
        <div className="ficha-aviso ficha-aviso-info" role="status" data-filtro="cliente">
          <Icono nombre="filtro" tamano={17} />
          <span>
            Solo los documentos de{' '}
            <strong>{clienteFiltro ? String(clienteFiltro.razon_social) : `el cliente ${clienteId}`}</strong>
            {lista.length === 0 ? ': no tiene saldos pendientes.' : '.'}{' '}
            <Link href="/finanzas/cobrar">Ver toda la cartera</Link>
            {clienteFiltro ? <> · <Link href={`/ventas/clientes/${clienteId}`}>Volver a la ficha del cliente</Link></> : null}
          </span>
        </div>
      )}

      <RejillaKpi>
        <Kpi etiqueta="Saldo total pendiente" valor={dinero(total, 'USD', 0)} tono="marca" nota={`${num(lista.length)} documentos`} href="#documentos" />
        <Kpi etiqueta="Saldo vencido" valor={dinero(vencido, 'USD', 0)} tono={vencido > 0 ? 'critico' : 'ok'}
             nota={`${((vencido / (total || 1)) * 100).toFixed(1)} % del total`}
  href="#antiguedad" />
        <Kpi etiqueta="Más de 90 días" valor={dinero(masDe90, 'USD', 0)} tono={masDe90 > 0 ? 'critico' : 'ok'}
             nota="Requiere gestión urgente"
  href="#antiguedad" />
      </RejillaKpi>

      {porTramo.length > 0 && (
        <Panel id="antiguedad" titulo="Antigüedad del saldo" className="mb-espacio">
          {/* Los tramos tienen orden natural: rampa de un solo tono */}
          <GraficoBarras
            datos={porTramo}
            formato="dolares"
            horizontal
            tono="rampa"
            altura={160}
          />
        </Panel>
      )}

      <Panel id="documentos" titulo={`${lista.length} documento${lista.length === 1 ? "" : "s"} con saldo`}>
        {lista.length === 0 ? (
          <Vacio titulo="Nada por cobrar" mensaje="Todos los documentos están cobrados." />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos">
              <thead>
                <tr>
                  <th>Documento</th><th>Cliente</th><th>País</th>
                  <th className="num">Vencimiento</th><th className="num">Días</th>
                  <th className="num">Total US$</th><th className="num">Cobrado US$</th><th className="num">Saldo US$</th>
                  <th>Antigüedad</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {lista.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA).map((f) => {
                  const dias = Number(f.dias_vencida ?? 0);
                  return (
                    <tr key={f.id as number}>
                      <td className="mono">
                        <Link href={`/finanzas/facturas/${f.id}`} className="enlace-ficha">
                          {f.numero as string}
                        </Link>
                      </td>
                      <td title={f.cliente as string}>
                        {String(f.cliente).length > 28 ? String(f.cliente).slice(0, 27) + '…' : String(f.cliente)}
                      </td>
                      <td style={{ fontSize: '.78rem' }}>{(f.pais as string) ?? '—'}</td>
                      <td className="num">{fecha(f.fecha_vencimiento as string)}</td>
                      <td className="num" style={{ color: dias > 0 ? 'var(--critico)' : 'var(--tinta-3)' }}>
                        {dias > 0 ? `+${dias}` : dias}
                      </td>
                      {/*
                        La cifra grande va en dólares, para que la fila se pueda
                        comparar con las demás y cuadre con el total de arriba.
                        Cuando la factura no está en dólares se muestra debajo su
                        importe real: quien llama a cobrar tiene que decir la
                        cifra que figura en el documento, no la convertida.
                      */}
                      <td className="num">{dinero(f.total_usd as number, 'USD', 0)}</td>
                      <td className="num">{dinero(f.cobrado_usd as number, 'USD', 0)}</td>
                      <td className="num">
                        <strong>{dinero(f.saldo_usd as number, 'USD', 0)}</strong>
                        {f.moneda !== 'USD' && (
                          <>
                            <br />
                            <span style={{ color: 'var(--tinta-3)', fontSize: '.68rem' }}>
                              {dinero(f.saldo as number, f.moneda as 'USD' | 'PEN', 0)} en la factura
                            </span>
                          </>
                        )}
                      </td>
                      <td>
                        <Etiqueta
                          texto={String(f.tramo_antiguedad)}
                          tono={
                            f.tramo_antiguedad === 'Vigente' ? 'ok'
                            : f.tramo_antiguedad === 'Más de 90 días' ? 'critico'
                            : 'atencion'
                          }
                        />
                      </td>
                      <td>
                        <AccionesLista
                          ver={`/finanzas/facturas/${f.id}`}
                          verTitulo={`Ver la factura ${f.numero}`}
                          extras={[
                            ...(puedeCobrar
                              ? [{
                                  href: `/finanzas/facturas/${f.id}#cobros`,
                                  icono: 'cobrar',
                                  titulo: `Registrar un cobro de ${f.numero}`,
                                }]
                              : []),
                            ...(f.cliente_id
                              ? [{
                                  href: `/ventas/clientes/${f.cliente_id}`,
                                  icono: 'clientes',
                                  titulo: 'Ver la ficha del cliente',
                                }]
                              : []),
                          ]}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Paginacion pagina={pagina} porPagina={POR_PAGINA} total={lista.length} />
          </div>
        )}
      </Panel>
    </>
  );
}
