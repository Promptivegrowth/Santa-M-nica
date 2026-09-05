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
import { AccionesFila } from '../AccionesFila';
import { Icono } from '@/components/estructura/Icono';
import { fecha, num, dinero, etiquetaEstado, diasDesdeHoy } from '@/lib/formato';
import { hoyEnLima, desplazarDias } from '@/lib/fechas';
import { aDolares } from '@/lib/moneda';
import { puedeVender, veCostos, type Rol } from '@/lib/navegacion';
import { campo } from '@/lib/relaciones';

export const metadata: Metadata = { title: 'Cotizaciones' };
export const dynamic = 'force-dynamic';

const POR_PAGINA = 30;

const TONO: Record<string, 'ok' | 'atencion' | 'critico' | 'info' | 'neutro'> = {
  aceptada: 'ok',
  enviada: 'info',
  aprobada: 'ok',
  borrador: 'neutro',
  rechazada: 'critico',
  vencida: 'atencion',
};

/** Los estados en los que una oferta sigue viva y su plazo corre. */
const VIVAS = ['aprobada', 'enviada'];

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
  const vencimiento = (q.vence as string) ?? '';
  const prioridad = (q.prioridad as string) ?? '';

  const hoy = hoyEnLima();

  let consulta = supabase
    .from('cotizaciones')
    .select(
      'id, numero, estado, moneda, incoterm, validez_dias, fecha, vence_el, prioridad, aprobada_en, tipo_cambio, clientes(razon_social, pais), destinos(puerto), cotizacion_lineas(cantidad_tm, precio_tm, descuento_pct)',
      { count: 'exact' }
    );

  if (buscar) consulta = consulta.ilike('numero', `%${buscar}%`);
  if (estado) consulta = consulta.eq('estado', estado);
  if (prioridad) consulta = consulta.eq('prioridad', prioridad);

  /*
   * El filtro de vencimiento solo tiene sentido sobre las ofertas VIVAS: un
   * borrador todavía no salió y una rechazada ya se cerró, así que su fecha
   * de caducidad no le dice nada a nadie.
   */
  if (vencimiento === 'por_vencer') {
    consulta = consulta.in('estado', VIVAS).gte('vence_el', hoy).lte('vence_el', desplazarDias(hoy, 3));
  } else if (vencimiento === 'vencidas') {
    consulta = consulta.in('estado', VIVAS).lt('vence_el', hoy);
  } else if (vencimiento === 'vigentes') {
    consulta = consulta.in('estado', VIVAS).gt('vence_el', desplazarDias(hoy, 3));
  }

  const [{ data: filas, count }, { data: todas }, { data: convertidas }] = await Promise.all([
    consulta.order('fecha', { ascending: false }).range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1),
    supabase.from('cotizaciones').select('estado, vence_el, aprobada_en'),
    supabase.from('pedidos').select('cotizacion_id').not('cotizacion_id', 'is', null),
  ]);

  const yaConvertidas = new Set((convertidas ?? []).map((p) => Number(p.cotizacion_id)));
  const cuenta = (e: string) => (todas ?? []).filter((c) => c.estado === e).length;

  /* Las dos cifras que de verdad exigen una acción hoy. */
  const porAprobar = (todas ?? []).filter((c) => c.estado === 'borrador' && !c.aprobada_en).length;
  const porVencer = (todas ?? []).filter(
    (c) => VIVAS.includes(String(c.estado)) &&
           String(c.vence_el ?? '') >= hoy &&
           String(c.vence_el ?? '') <= desplazarDias(hoy, 3)
  ).length;

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
        <Kpi
          etiqueta="Esperando aprobación"
          valor={num(porAprobar)}
          tono={porAprobar > 0 ? 'atencion' : 'ok'}
          nota="No pueden salir al cliente"
          href="/ventas/cotizaciones?estado=borrador"
        />
        <Kpi etiqueta="Enviadas" valor={num(cuenta('enviada'))} tono="marca" nota="Esperando respuesta"
             href="/ventas/cotizaciones?estado=enviada" />
        <Kpi
          etiqueta="Caducan en 3 días"
          valor={num(porVencer)}
          tono={porVencer > 0 ? 'critico' : 'ok'}
          nota="Llamar antes de perder el precio"
          href="/ventas/cotizaciones?vence=por_vencer"
        />
        <Kpi etiqueta="Aceptadas" valor={num(cuenta('aceptada'))} tono="ok" nota="Ya son pedido"
             href="/ventas/cotizaciones?estado=aceptada" />
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
            {
              tipo: 'select', clave: 'prioridad', etiqueta: 'Prioridad',
              opciones: [
                { valor: 'urgente', texto: 'Urgente' },
                { valor: 'alta', texto: 'Alta' },
                { valor: 'normal', texto: 'Normal' },
                { valor: 'baja', texto: 'Baja' },
              ],
            },
            {
              tipo: 'select', clave: 'vence', etiqueta: 'Vencimiento',
              opciones: [
                { valor: 'vigentes', texto: 'En plazo' },
                { valor: 'por_vencer', texto: 'Caducan en 3 días' },
                { valor: 'vencidas', texto: 'Ya pasaron su plazo' },
              ],
            },
          ]}
        />

        <div className="atajos-fecha">
          <span>Rápido:</span>
          <Link href="/ventas/cotizaciones?estado=borrador">Esperando aprobación</Link>
          <Link href="/ventas/cotizaciones?vence=por_vencer">Caducan en 3 días</Link>
          <Link href="/ventas/cotizaciones?vence=vencidas">Se pasaron de plazo</Link>
          <Link href="/ventas/cotizaciones?prioridad=urgente">Urgentes</Link>
          {(buscar || estado || vencimiento || prioridad) && (
            <Link href="/ventas/cotizaciones" className="atajo-limpiar">Quitar filtros</Link>
          )}
        </div>

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
                    <th className="num">Vence</th>
                    <th className="num">TM</th>
                    {puedeVerImportes && <th className="num">Valor US$</th>}
                    <th>Prioridad</th>
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
                        {/*
                          El vencimiento solo se cuenta en las ofertas vivas.
                          En un borrador o en una rechazada la fecha existe
                          igual, pero no significa nada: la primera no ha
                          salido y la segunda ya se cerró.
                        */}
                        <td className="num" style={{ fontSize: '.76rem' }}>
                          {VIVAS.includes(c.estado as string) ? (
                            (() => {
                              const dias = diasDesdeHoy(c.vence_el as string);
                              const tono = dias < 0 ? 'var(--critico)'
                                : dias <= 3 ? 'var(--atencion)' : 'var(--ok)';
                              return (
                                <span style={{ color: tono }}>
                                  {dias < 0
                                    ? `venció hace ${Math.abs(dias)} d`
                                    : dias === 0 ? 'vence hoy' : `en ${dias} d`}
                                  <br />
                                  <span style={{ color: 'var(--tinta-3)', fontSize: '.68rem' }}>
                                    {fecha(c.vence_el as string)}
                                  </span>
                                </span>
                              );
                            })()
                          ) : (
                            <span style={{ color: 'var(--tinta-3)' }}>—</span>
                          )}
                        </td>
                        <td className="num">{num(toneladas, 1)}</td>
                        {puedeVerImportes && (
                          <td className="num">
                            {dinero(aDolares(valor, c.moneda as string, c.tipo_cambio as number), 'USD', 0)}
                          </td>
                        )}
                        <td>
                          {c.prioridad === 'normal' ? (
                            <span style={{ color: 'var(--tinta-3)', fontSize: '.76rem' }}>Normal</span>
                          ) : (
                            <Etiqueta
                              texto={etiquetaEstado(c.prioridad as string)}
                              tono={c.prioridad === 'urgente' ? 'critico'
                                : c.prioridad === 'alta' ? 'atencion' : 'neutro'}
                            />
                          )}
                        </td>
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
