/**
 * ============================================================================
 *  FICHA DEL EMBARQUE
 * ============================================================================
 *  Un embarque agrupa varios pedidos que salen juntos en la misma fecha, hacia
 *  el mismo destino, normalmente en el mismo contenedor.
 *
 *  Es el punto donde Comercio Exterior y Almacén tienen que estar de acuerdo:
 *  Comex sabe qué booking hay reservado, Almacén sabe qué se puede sacar de
 *  cámara. Esta pantalla junta las dos mitades y avisa cuando no cuadran —por
 *  ejemplo, un pedido incluido en el embarque que todavía no tiene su
 *  mercadería apartada.
 * ============================================================================
 */
import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel, Vacio, Etiqueta, RejillaKpi, Kpi } from '@/components/ui/Pagina';
import { Historial } from '@/components/ui/Historial';
import { EsqueletoKpi, EsqueletoTabla, EsqueletoFicha } from '@/components/ui/Esqueleto';
import { Icono } from '@/components/estructura/Icono';
import { fecha, num, dinero, tm, etiquetaEstado, diasDesdeHoy } from '@/lib/formato';
import { veCostos, type Rol } from '@/lib/navegacion';
import { uno, campo } from '@/lib/relaciones';
import { NuevoPacking } from './NuevoPacking';

export const dynamic = 'force-dynamic';

export async function generateMetadata(
  props: PageProps<'/logistica/embarques/[id]'>
): Promise<Metadata> {
  const { id } = await props.params;
  const supabase = await crearClienteServidor();
  const { data } = await supabase.from('embarques').select('numero').eq('id', Number(id)).single();
  return { title: data?.numero ?? 'Embarque' };
}

/* Los estados reales del embarque, tal como los define el enum de la base. */
const TONO: Record<string, 'ok' | 'atencion' | 'critico' | 'info' | 'neutro'> = {
  planificado: 'neutro', confirmado: 'info', en_preparacion: 'atencion',
  despachado: 'ok', cancelado: 'critico',
};

/* Y los del ciclo del pedido, que se muestran en la tabla de abajo. */
const TONO_CICLO: Record<string, 'ok' | 'atencion' | 'critico' | 'info' | 'neutro'> = {
  borrador: 'neutro', pendiente_validacion: 'atencion', confirmado: 'info',
  despachado: 'ok', cerrado: 'ok', cancelado: 'critico',
};

/* Cobertura = cuánto del pedido tiene ya mercadería apartada. */
const TONO_COBERTURA: Record<string, 'ok' | 'atencion' | 'critico' | 'info' | 'neutro'> = {
  pendiente_stock: 'critico', parcialmente_disponible: 'atencion', completo: 'info',
  reservado: 'ok', programado: 'ok', en_preparacion: 'ok', preparado: 'ok',
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
export default async function FichaEmbarque(props: PageProps<'/logistica/embarques/[id]'>) {
  const { id } = await props.params;
  const embId = Number(id);

  const supabase = await crearClienteServidor();
  const [{ data: e }, usuarioCab, { data: supervisores }] = await Promise.all([
    supabase
      .from('embarques')
      .select('*, almacenes(id, nombre), destinos(puerto, pais), transportistas(razon_social), vehiculos(placa), conductores(nombre)')
      .eq('id', embId)
      .single(),
    obtenerUsuarioActual(),
    supabase.from('usuarios').select('id, nombre').eq('activo', true).order('nombre'),
  ]);

  if (!e) notFound();

  const estadoCab = e.estado as string;
  const puedeArmar =
    ['gerencia', 'operaciones', 'comex', 'almacen'].includes(usuarioCab?.rol ?? '') &&
    estadoCab !== 'despachado' && estadoCab !== 'cancelado';

  return (
    <>
      <CabeceraPagina
        titulo={e.numero as string}
        descripcion={`${campo(e.almacenes, 'nombre')} → ${campo(e.destinos, 'puerto')}, ${campo(e.destinos, 'pais')}`}
        volver={{ href: '/logistica/embarques', texto: 'Volver a embarques' }}
      >
        <Etiqueta texto={etiquetaEstado(estadoCab)} tono={TONO[estadoCab] ?? 'neutro'} />
        <Link href={`/logistica/planificador?embarque=${embId}`} className="btn btn-secundario">
          <Icono nombre="planificador" tamano={15} />
          Ver en el calendario
        </Link>
        <NuevoPacking
          embarqueId={embId}
          supervisores={(supervisores ?? []).map((u) => ({
            id: String(u.id), nombre: u.nombre as string,
          }))}
          puede={puedeArmar}
        />
      </CabeceraPagina>

      <Suspense fallback={<CargandoCuerpo />}>
        <CuerpoEmbarque embId={embId} e={e} />
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
        <EsqueletoFicha lineas={3} />
      </div>
      <EsqueletoTabla filas={5} columnas={8} conFiltros={false} />
      <span className="sr-solo" role="status">Cargando el embarque…</span>
    </>
  );
}

/** El detalle: los pedidos que van dentro y sus packing lists. */
async function CuerpoEmbarque({ embId, e }: { embId: number; e: Record<string, unknown> }) {
  const supabase = await crearClienteServidor();
  const usuario = await obtenerUsuarioActual();
  const puedeVerImportes = veCostos((usuario?.rol ?? 'consulta') as Rol);

  const [{ data: vinculos }, { data: packings }] = await Promise.all([
    supabase
      .from('embarque_pedidos')
      .select('pedidos(id, numero_proforma, ciclo, cobertura, situacion, moneda, fecha_comprometida, clientes(id, razon_social, pais), pedido_lineas(cantidad_tm, precio_tm, descuento_pct))')
      .eq('embarque_id', embId),
    supabase
      .from('packing_lists')
      .select('id, codigo, estado, contenedor, precinto')
      .eq('embarque_id', embId),
  ]);

  const estado = e.estado as string;
  const pedidos = (vinculos ?? [])
    .map((v) => uno<Record<string, unknown>>(v.pedidos))
    .filter(Boolean) as Record<string, unknown>[];

  const totalTm = pedidos.reduce(
    (s, p) => s + ((p.pedido_lineas ?? []) as { cantidad_tm: number }[]).reduce((x, l) => x + Number(l.cantidad_tm ?? 0), 0),
    0
  );
  const valorTotal = pedidos.reduce(
    (s, p) => s + ((p.pedido_lineas ?? []) as { cantidad_tm: number; precio_tm: number; descuento_pct: number }[])
      .reduce((x, l) => x + Number(l.cantidad_tm) * Number(l.precio_tm) * (1 - Number(l.descuento_pct) / 100), 0),
    0
  );

  // Pedidos que van en este embarque pero todavía no tienen stock apartado.
  const sinCobertura = pedidos.filter(
    (p) => p.cobertura === 'pendiente_stock' || p.cobertura === 'parcialmente_disponible'
  );
  const dias = e.fecha_programada ? diasDesdeHoy(e.fecha_programada as string) : null;

  return (
    <>
      {sinCobertura.length > 0 && !['despachado', 'cancelado'].includes(estado) && (
        <div className="ficha-aviso ficha-aviso-critico">
          <Icono nombre="alerta" tamano={17} />
          <span>
            <strong>
              {sinCobertura.length} de {pedidos.length} pedidos de este embarque no tienen toda su
              mercadería apartada.
            </strong>{' '}
            Si sale así, hay que decidir qué se deja en tierra a última hora. Revise la cobertura de{' '}
            {sinCobertura.map((p, i) => (
              <span key={p.id as number}>
                {i > 0 ? ', ' : ''}
                <Link href={`/ventas/pedidos/${p.id}`}>{String(p.numero_proforma)}</Link>
              </span>
            ))}
            .
          </span>
        </div>
      )}

      {dias !== null && dias >= 0 && dias <= 3 && !['despachado', 'cancelado'].includes(estado) && (
        <div className="ficha-aviso ficha-aviso-atencion">
          <Icono nombre="reloj" tamano={17} />
          <span>
            <strong>Sale {dias === 0 ? 'hoy' : `en ${dias} días`}.</strong> Confirme que el packing
            list está cerrado y el contenedor asignado antes de la fecha de corte.
          </span>
        </div>
      )}

      <RejillaKpi>
        <Kpi etiqueta="Pedidos" valor={num(pedidos.length)} tono="marca" />
        <Kpi etiqueta="Volumen" valor={tm(totalTm * 1000)} />
        {puedeVerImportes && <Kpi etiqueta="Valor embarcado" valor={dinero(valorTotal, 'USD', 0)} />}
        <Kpi
          etiqueta="Packing lists"
          valor={num((packings ?? []).length)}
          nota={(packings ?? []).length === 0 ? 'Sin preparar' : 'Preparados'}
          tono={(packings ?? []).length === 0 ? 'atencion' : 'ok'}
        />
        <Kpi
          etiqueta="Salida"
          valor={e.fecha_programada ? fecha(e.fecha_programada as string) : '—'}
          nota={dias === null ? '' : dias < 0 ? `Hace ${Math.abs(dias)} d` : `En ${dias} d`}
        />
      </RejillaKpi>

      <div className="rejilla-2 mb-espacio">
        <Panel titulo="Datos del embarque">
          <dl className="ficha">
            <div><dt>Número</dt><dd className="mono">{e.numero as string}</dd></div>
            <div><dt>Almacén de salida</dt><dd>{campo(e.almacenes, 'nombre')}</dd></div>
            <div><dt>Destino</dt><dd>{campo(e.destinos, 'puerto')} · {campo(e.destinos, 'pais')}</dd></div>
            <div><dt>Tipo de despacho</dt><dd>{etiquetaEstado(String(e.tipo_despacho))}</dd></div>
            <div><dt>Booking</dt><dd className="mono">{(e.booking as string) ?? 'Sin booking'}</dd></div>
            <div><dt>Naviera</dt><dd>{(e.naviera as string) ?? '—'}</dd></div>
            <div><dt>Fecha programada</dt><dd>{e.fecha_programada ? fecha(e.fecha_programada as string) : '—'}</dd></div>
            {e.observaciones ? <div><dt>Observaciones</dt><dd>{e.observaciones as string}</dd></div> : null}
          </dl>
        </Panel>

        <Panel titulo="Transporte terrestre">
          <dl className="ficha">
            <div><dt>Transportista</dt><dd>{campo(e.transportistas, 'razon_social', 'Sin asignar')}</dd></div>
            <div><dt>Vehículo</dt><dd className="mono">{campo(e.vehiculos, 'placa', 'Sin asignar')}</dd></div>
            <div><dt>Conductor</dt><dd>{campo(e.conductores, 'nombre', 'Sin asignar')}</dd></div>
          </dl>

          <div className="ficha-enlaces">
            {(packings ?? []).length === 0 ? (
              <Link href="/logistica/packing" className="ficha-enlace">
                <Icono nombre="packing" tamano={15} />
                <span><strong>Preparar packing</strong><br /><small>Todavía no hay ninguno</small></span>
              </Link>
            ) : (
              (packings ?? []).map((p) => (
                <Link key={p.id as number} href={`/logistica/packing/${p.id}`} className="ficha-enlace">
                  <Icono nombre="packing" tamano={15} />
                  <span>
                    <strong>{p.codigo as string}</strong>
                    <br />
                    <small>
                      {(p.contenedor as string) ?? 'sin contenedor'} · {etiquetaEstado(p.estado as string)}
                    </small>
                  </span>
                </Link>
              ))
            )}
          </div>
        </Panel>
      </div>

      <Panel titulo={`Pedidos en este embarque · ${pedidos.length}`} className="mb-espacio">
        {pedidos.length === 0 ? (
          <Vacio
            titulo="Embarque vacío"
            mensaje="Todavía no se le asignó ningún pedido. Se hace desde el planificador arrastrando el pedido a la fecha."
          />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos">
              <thead>
                <tr>
                  <th>Proforma</th><th>Cliente</th><th className="num">TM</th>
                  {puedeVerImportes && <th className="num">Valor</th>}
                  <th className="num">Compromiso</th><th>Ciclo</th><th>Cobertura</th><th></th>
                </tr>
              </thead>
              <tbody>
                {pedidos.map((p) => {
                  const ls = (p.pedido_lineas ?? []) as { cantidad_tm: number; precio_tm: number; descuento_pct: number }[];
                  const t = ls.reduce((s, l) => s + Number(l.cantidad_tm ?? 0), 0);
                  const v = ls.reduce((s, l) => s + Number(l.cantidad_tm) * Number(l.precio_tm) * (1 - Number(l.descuento_pct) / 100), 0);
                  const cli = uno<Record<string, unknown>>(p.clientes);
                  return (
                    <tr key={p.id as number}>
                      <td className="mono">
                        <Link href={`/ventas/pedidos/${p.id}`} className="enlace-ficha">
                          {String(p.numero_proforma)}
                        </Link>
                      </td>
                      <td>
                        {cli?.id ? (
                          <Link href={`/ventas/clientes/${cli.id}`} className="enlace-ficha">
                            {String(cli.razon_social)}
                          </Link>
                        ) : '—'}
                      </td>
                      <td className="num">{num(t, 1)}</td>
                      {puedeVerImportes && (
                        <td className="num">{dinero(v, String(p.moneda) as 'USD' | 'PEN', 0)}</td>
                      )}
                      <td className="num" style={{ fontSize: '.75rem' }}>
                        {fecha(p.fecha_comprometida as string)}
                      </td>
                      <td>
                        <Etiqueta
                          texto={etiquetaEstado(String(p.ciclo))}
                          tono={TONO_CICLO[String(p.ciclo)] ?? 'neutro'}
                        />
                      </td>
                      <td>
                        <Etiqueta
                          texto={etiquetaEstado(String(p.cobertura))}
                          tono={TONO_COBERTURA[String(p.cobertura)] ?? 'neutro'}
                        />
                      </td>
                      <td>
                        <Link href={`/ventas/pedidos/${p.id}`} className="accion-btn" title="Ver el pedido">
                          <Icono nombre="ver" tamano={15} />
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

      <Panel titulo="Historial del embarque">
        <Historial entidad="embarques" entidadId={embId} />
      </Panel>
    </>
  );
}
