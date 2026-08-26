/**
 * ============================================================================
 *  COTIZACIONES
 * ============================================================================
 *  La cotización es el paso anterior al pedido: se le ofrece un precio al
 *  cliente sin comprometerse todavía a entregar.
 *
 *  Cuando el cliente acepta, se pulsa "Convertir" y la cotización se transforma
 *  en pedido heredando cliente, vendedor, moneda, tipo de cambio, incoterm,
 *  destino y todas las líneas con sus precios y descuentos. Ese es el principio
 *  de reuso que pidió el cliente: nada se teclea dos veces.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { Filtros, Paginacion } from '@/components/ui/Filtros';
import { AccionesFila } from './AccionesFila';
import { Icono } from '@/components/estructura/Icono';
import { fecha, num, dinero, etiquetaEstado } from '@/lib/formato';
import { puedeVender, veCostos, type Rol } from '@/lib/navegacion';
import { campo } from '@/lib/relaciones';

export const metadata: Metadata = { title: 'Cotizaciones' };
export const dynamic = 'force-dynamic';

const POR_PAGINA = 30;

const TONO: Record<string, 'ok' | 'atencion' | 'critico' | 'info' | 'neutro'> = {
  aceptada: 'ok',
  enviada: 'info',
  borrador: 'neutro',
  rechazada: 'critico',
  vencida: 'atencion',
};

export default async function PaginaCotizaciones(props: PageProps<'/ventas/cotizaciones'>) {
  const q = await props.searchParams;
  const supabase = await crearClienteServidor();
  const usuario = await obtenerUsuarioActual();
  const rol = (usuario?.rol ?? 'consulta') as Rol;
  const puedeCrear = puedeVender(rol);
  const puedeVerImportes = veCostos(rol);

  const pagina = Math.max(1, Number(q.pagina ?? 1));
  const buscar = (q.buscar as string) ?? '';
  const estado = (q.estado as string) ?? '';

  let consulta = supabase
    .from('cotizaciones')
    .select(
      'id, numero, estado, moneda, incoterm, validez_dias, fecha, clientes(razon_social, pais), destinos(puerto), cotizacion_lineas(cantidad_tm, precio_tm, descuento_pct)',
      { count: 'exact' }
    );

  if (buscar) consulta = consulta.ilike('numero', `%${buscar}%`);
  if (estado) consulta = consulta.eq('estado', estado);

  const [{ data: filas, count }, { data: todas }, { data: convertidas }] = await Promise.all([
    consulta.order('fecha', { ascending: false }).range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1),
    supabase.from('cotizaciones').select('estado'),
    supabase.from('pedidos').select('cotizacion_id').not('cotizacion_id', 'is', null),
  ]);

  const yaConvertidas = new Set((convertidas ?? []).map((p) => Number(p.cotizacion_id)));
  const cuenta = (e: string) => (todas ?? []).filter((c) => c.estado === e).length;

  return (
    <>
      <CabeceraPagina
        titulo="Cotizaciones"
        descripcion="La OFERTA previa: un precio que se le pasa al cliente sin comprometerse todavía a entregar. Cuando el cliente acepta, se convierte en pedido y recién ahí nace la proforma."
      >
        {puedeCrear && (
          <Link href="/ventas/cotizaciones/nueva" className="btn btn-primario">
            <Icono nombre="mas" tamano={15} />
            Nueva cotización
          </Link>
        )}
      </CabeceraPagina>

      {/* Confirmación de un borrado que se hizo desde la ficha: al volver al
          listado el usuario necesita saber que la acción se completó. */}
      {q.borrada && (
        <div className="ficha-aviso ficha-aviso-ok">
          <Icono nombre="papelera" tamano={17} />
          <span>
            La cotización <strong>{q.borrada as string}</strong> fue eliminada. La acción quedó
            registrada en la auditoría del sistema.
          </span>
        </div>
      )}

      <RejillaKpi>
        <Kpi etiqueta="Total emitidas" valor={num((todas ?? []).length)} />
        <Kpi etiqueta="En borrador" valor={num(cuenta('borrador'))} nota="Aún sin enviar al cliente" />
        <Kpi etiqueta="Enviadas" valor={num(cuenta('enviada'))} tono="marca" nota="Esperando respuesta" />
        <Kpi etiqueta="Aceptadas" valor={num(cuenta('aceptada'))} tono="ok" nota="Ya son pedido" />
        <Kpi etiqueta="Rechazadas o vencidas" valor={num(cuenta('rechazada') + cuenta('vencida'))} tono="atencion" />
      </RejillaKpi>

      <Panel titulo={`${num(count ?? 0)} cotizaciones`}>
        <Filtros
          campos={[
            { tipo: 'texto', clave: 'buscar', etiqueta: 'Número', ancho: '11rem' },
            {
              tipo: 'select',
              clave: 'estado',
              etiqueta: 'Estado',
              opciones: Object.keys(TONO).map((e) => ({ valor: e, texto: etiquetaEstado(e) })),
            },
          ]}
        />

        {(filas ?? []).length === 0 ? (
          <Vacio
            titulo="Sin cotizaciones"
            mensaje={
              puedeCrear
                ? 'No hay cotizaciones con estos filtros. Use el botón «Nueva cotización» para crear la primera.'
                : 'No hay cotizaciones con estos filtros.'
            }
          />
        ) : (
          <>
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos">
                <thead>
                  <tr>
                    <th>Cotización</th>
                    <th>Cliente</th>
                    <th>Destino</th>
                    <th className="num">Fecha</th>
                    <th className="num">Líneas</th>
                    <th className="num">TM</th>
                    {puedeVerImportes && <th className="num">Valor</th>}
                    <th>Incoterm</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {(filas ?? []).map((c) => {
                    const lineas = (c.cotizacion_lineas ?? []) as {
                      cantidad_tm: number; precio_tm: number; descuento_pct: number;
                    }[];
                    const toneladas = lineas.reduce((s, l) => s + Number(l.cantidad_tm ?? 0), 0);
                    const valor = lineas.reduce(
                      (s, l) =>
                        s + Number(l.cantidad_tm ?? 0) * Number(l.precio_tm ?? 0) * (1 - Number(l.descuento_pct ?? 0) / 100),
                      0
                    );
                    return (
                      <tr key={c.id as number}>
                        <td className="mono">
                          {/* El número es el enlace natural a la ficha: es lo
                              primero que el ojo busca en la fila. */}
                          <Link href={`/ventas/cotizaciones/${c.id}`} className="enlace-ficha">
                            <strong>{c.numero as string}</strong>
                          </Link>
                        </td>
                        <td>{campo(c.clientes, 'razon_social')}</td>
                        <td style={{ fontSize: '.78rem' }}>{campo(c.destinos, 'puerto')}</td>
                        <td className="num">{fecha(c.fecha as string)}</td>
                        <td className="num">{num(lineas.length)}</td>
                        <td className="num">{num(toneladas, 1)}</td>
                        {puedeVerImportes && (
                          <td className="num">{dinero(valor, c.moneda as 'USD' | 'PEN', 0)}</td>
                        )}
                        <td className="mono">{c.incoterm as string}</td>
                        <td>
                          <Etiqueta
                            texto={etiquetaEstado(c.estado as string)}
                            tono={TONO[c.estado as string] ?? 'neutro'}
                          />
                        </td>
                        <td>
                          <AccionesFila
                            cotizacionId={c.id as number}
                            numero={c.numero as string}
                            estado={c.estado as string}
                            yaConvertida={yaConvertidas.has(c.id as number)}
                            puedeOperar={puedeCrear}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Paginacion pagina={pagina} porPagina={POR_PAGINA} total={count ?? 0} />
          </>
        )}
      </Panel>

      <p className="pie-explicativo">
        Al pulsar <strong>Convertir</strong>, el sistema crea el pedido heredando todos los datos de
        la cotización y la marca como aceptada. Si el cliente tiene el crédito bloqueado, la
        conversión se rechaza y explica por qué.
      </p>
    </>
  );
}
