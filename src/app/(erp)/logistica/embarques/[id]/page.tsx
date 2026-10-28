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
import { aDolares } from '@/lib/moneda';
import { veCostos, rolPuedeVerRuta, type Rol } from '@/lib/navegacion';
import { uno, campo } from '@/lib/relaciones';
import { PUEDEN_CONSOLIDAR, mensajeNoPuede, rolPuede } from '@/lib/permisosLogistica';
import { NuevoPacking } from './NuevoPacking';
import { ObservacionesEmbarque } from './ObservacionesEmbarque';
import { CicloEmbarque } from './CicloEmbarque';
import { EditarEmbarque } from './EditarEmbarque';
import { AgregarPedidos, QuitarPedido } from './PedidosDelEmbarque';

/** Programan, editan y cambian los pedidos (igual que el alta). */
const PUEDEN_ARMAR = ['gerencia', 'operaciones', 'comex', 'almacen'];
/** Confirman y cancelan: la decisión de la salida, no de la carga. */
const PUEDEN_DECIDIR = ['gerencia', 'operaciones', 'comex'];

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
  const [{ data: e }, usuarioCab, { data: supervisores }, { data: packingsCab }, { count: pedidosCab }] = await Promise.all([
    supabase
      .from('embarques')
      .select('*, almacenes(id, nombre), destinos(puerto, pais), transportistas(razon_social), vehiculos(placa), conductores(nombre)')
      .eq('id', embId)
      .single(),
    obtenerUsuarioActual(),
    supabase.from('usuarios').select('id, nombre').eq('activo', true).order('nombre'),
    supabase.from('packing_lists').select('codigo, estado').eq('embarque_id', embId),
    supabase.from('embarque_pedidos').select('pedido_id', { count: 'exact', head: true }).eq('embarque_id', embId),
  ]);

  if (!e) notFound();

  const estadoCab = e.estado as string;
  const rolCab = usuarioCab?.rol ?? '';
  const puedeArmar =
    PUEDEN_ARMAR.includes(rolCab) &&
    estadoCab !== 'despachado' && estadoCab !== 'cancelado';

  /*
   * Por qué no se puede confirmar o cancelar todavía: el botón se apaga y lo
   * dice, en vez de desaparecer. El servidor lo vuelve a comprobar.
   */
  const despachados = (packingsCab ?? []).filter((p) => p.estado === 'cerrado').map((p) => String(p.codigo));
  const noPuedeConfirmar =
    !pedidosCab ? 'agréguele al menos un pedido.'
    : e.tipo_despacho === 'exportacion' && !String(e.booking ?? '').trim()
      ? 'falta el booking de la naviera. Anótelo con «Editar embarque».'
      : null;
  const noPuedeCancelar = despachados.length
    ? `Ya salió el contenedor ${despachados.join(', ')}: un embarque con despacho no se cancela.`
    : null;

  return (
    <>
      <CabeceraPagina
        titulo={e.numero as string}
        descripcion={`${campo(e.almacenes, 'nombre')} → ${campo(e.destinos, 'puerto')}, ${campo(e.destinos, 'pais')}`}
        volver={{ href: '/logistica/embarques', texto: 'Volver a embarques' }}
      >
        <Etiqueta texto={etiquetaEstado(estadoCab)} tono={TONO[estadoCab] ?? 'neutro'} />
        {PUEDEN_ARMAR.includes(rolCab) && (
          <CicloEmbarque
            embarqueId={embId}
            estado={estadoCab}
            puede={PUEDEN_DECIDIR.includes(rolCab)}
            noPuedeConfirmar={noPuedeConfirmar}
            noPuedeCancelar={noPuedeCancelar}
          />
        )}
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

  const puedeEditar = PUEDEN_ARMAR.includes(usuario?.rol ?? '');
  const [{ data: vinculos }, { data: packings }, { data: programadas }, catalogos] = await Promise.all([
    supabase
      .from('embarque_pedidos')
      .select('pedidos(id, numero_proforma, ciclo, cobertura, situacion, moneda, tipo_cambio, fecha_comprometida, clientes(id, razon_social, pais), pedido_lineas(id, cantidad_tm, precio_tm, descuento_pct))')
      .eq('embarque_id', embId),
    supabase
      .from('packing_lists')
      .select('id, codigo, estado, contenedor, precinto')
      .eq('embarque_id', embId),
    //  Qué productos y cuánto sale (octubre, punto 13).
    supabase
      .from('embarque_lineas')
      .select('id, cantidad_kg, kg_no_despachado, pedido_linea_id, sku_presentacion_id, sale:sku_presentaciones(skus(codigo), presentaciones(descripcion)), pedido_lineas(pedido_id, cantidad_tm, sku_presentacion_id, sku_presentaciones(skus(codigo, corte, especies(nombre)), presentaciones(descripcion)), pedidos(numero_proforma))')
      .eq('embarque_id', embId)
      .order('id'),
    //  Los catálogos del formulario de edición, solo para quien puede editar.
    puedeEditar
      ? Promise.all([
          supabase.from('destinos').select('id, puerto, pais').eq('activo', true).order('puerto'),
          supabase.from('transportistas').select('id, razon_social').eq('activo', true).order('razon_social'),
          supabase.from('vehiculos').select('id, placa, soat_vence, revision_vence').eq('activo', true).order('placa'),
          supabase.from('conductores').select('id, nombre').eq('activo', true).order('nombre'),
        ])
      : Promise.resolve(null),
  ]);
  //  El saldo que le queda a cada línea, contando TODOS los embarques vivos.
  const idsLineas = [...new Set((programadas ?? []).map((x) => Number(x.pedido_linea_id)))];
  const { data: saldos } = idsLineas.length
    ? await supabase.from('v_pedido_linea_programacion').select('pedido_linea_id, programado_kg, por_programar_kg').in('pedido_linea_id', idsLineas)
    : { data: [] };
  const saldoDe = new Map((saldos ?? []).map((s) => [Number(s.pedido_linea_id), s]));

  const estado = e.estado as string;
  const pedidos = (vinculos ?? [])
    .map((v) => uno<Record<string, unknown>>(v.pedidos))
    .filter(Boolean) as Record<string, unknown>[];

  /*
   * QUÉ PEDIDO SE PUEDE QUITAR: el que no tiene ningún pallet subido a un
   * contenedor de este embarque (por la línea del pedido que guarda el
   * packing, o por estar apartado para él). Es la misma regla que aplica la
   * base al quitarlo; aquí se calcula para apagar el botón y decir cuál bajar.
   */
  const vivos = (packings ?? []).filter((p) => p.estado !== 'anulado');
  const { data: cargadas } = vivos.length
    ? await supabase.from('packing_lineas').select('lote_id, pedido_linea_id, packing_list_id, lotes(codigo_pallet)')
        .in('packing_list_id', vivos.map((p) => Number(p.id)))
    : { data: [] };
  const lotesCargados = [...new Set((cargadas ?? []).map((c) => Number(c.lote_id)))];
  const { data: apartadosCargados } = lotesCargados.length && pedidos.length
    ? await supabase.from('reservas').select('lote_id, pedido_lineas!inner(pedido_id)')
        .eq('almacen_id', Number(e.almacen_id))
        .in('estado', ['activa', 'en_preparacion', 'consumida'])
        .in('lote_id', lotesCargados)
        .in('pedido_lineas.pedido_id', pedidos.map((p) => Number(p.id)))
    : { data: [] };
  const codigoPk = new Map((packings ?? []).map((p) => [Number(p.id), String(p.codigo)]));
  const cargadoDe = (pedido: Record<string, unknown>) => {
    const lineasPed = new Set(((pedido.pedido_lineas ?? []) as { id: number }[]).map((l) => Number(l.id)));
    const lotesPed = new Set((apartadosCargados ?? [])
      .filter((r) => Number(uno<Record<string, unknown>>(r.pedido_lineas)?.pedido_id) === Number(pedido.id))
      .map((r) => Number(r.lote_id)));
    return (cargadas ?? [])
      .filter((c) => lineasPed.has(Number(c.pedido_linea_id)) || lotesPed.has(Number(c.lote_id)))
      .map((c) => `${campo(c.lotes, 'codigo_pallet')} (${codigoPk.get(Number(c.packing_list_id))})`);
  };
  const cerradoPara = estado === 'despachado' ? 'El embarque ya se despachó.'
    : estado === 'cancelado' ? 'El embarque está cancelado.' : null;
  const [destinosCat, transportistasCat, vehiculosCat, conductoresCat] = catalogos ?? [];

  const totalTm = pedidos.reduce(
    (s, p) => s + ((p.pedido_lineas ?? []) as { cantidad_tm: number }[]).reduce((x, l) => x + Number(l.cantidad_tm ?? 0), 0),
    0
  );
  /*
   * El valor del embarque, en dólares.
   *
   * Un embarque agrupa pedidos que pueden estar en monedas distintas —hoy hay
   * 22 así—, de modo que sumar los importes tal cual y rotular el resultado en
   * dólares daba una cifra que no era ninguna de las dos cosas. Cada pedido se
   * convierte con SU tipo de cambio antes de entrar en la suma.
   */
  const valorTotal = pedidos.reduce((s, p) => {
    const enSuMoneda = ((p.pedido_lineas ?? []) as
      { cantidad_tm: number; precio_tm: number; descuento_pct: number }[])
      .reduce((x, l) => x + Number(l.cantidad_tm) * Number(l.precio_tm) * (1 - Number(l.descuento_pct) / 100), 0);
    return s + aDolares(enSuMoneda, p.moneda as string, p.tipo_cambio as number);
  }, 0);

  /* Si el embarque mezcla monedas, el indicador tiene que decirlo. */
  const monedasDelEmbarque = [...new Set(pedidos.map((p) => String(p.moneda)))];

  // Pedidos que van en este embarque pero todavía no tienen stock apartado.
  const sinCobertura = pedidos.filter(
    (p) => p.cobertura === 'pendiente_stock' || p.cobertura === 'parcialmente_disponible'
  );
  const dias = e.fecha_programada ? diasDesdeHoy(e.fecha_programada as string) : null;

  return (
    <>
      {estado === 'cancelado' && (
        <div className="ficha-aviso ficha-aviso-critico" data-aviso="cancelado">
          <Icono nombre="alerta" tamano={17} />
          <span>
            <strong>Embarque cancelado.</strong>{' '}
            {e.motivo_cancelacion ? <>Motivo: {String(e.motivo_cancelacion)}. </> : null}
            Sus pedidos quedaron libres para programarse en otro embarque, con su mercadería todavía apartada.
          </span>
        </div>
      )}

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
        <Kpi etiqueta="Pedidos" valor={num(pedidos.length)} tono="marca" href="#pedidos" />
        <Kpi etiqueta="Volumen" valor={tm(totalTm * 1000)} href="#pedidos" />
        {puedeVerImportes && (
          <Kpi
            etiqueta="Valor embarcado"
            valor={dinero(valorTotal, 'USD', 0)}
            nota={monedasDelEmbarque.length > 1
              ? `Convertido a dólares · lleva pedidos en ${monedasDelEmbarque.join(' y ')}`
              : undefined}
            href="#pedidos"
          />
        )}
        <Kpi
          etiqueta="Packing lists"
          valor={num((packings ?? []).length)}
          nota={(packings ?? []).length === 0 ? 'Sin preparar' : 'Preparados'}
          tono={(packings ?? []).length === 0 ? 'atencion' : 'ok'}
          href={(packings ?? []).length === 1 ? `/logistica/packing/${(packings ?? [])[0].id}` : `/logistica/packing?buscar=${encodeURIComponent(String(e.numero))}`}
        />
        <Kpi
          etiqueta="Salida"
          valor={e.fecha_programada ? fecha(e.fecha_programada as string) : '—'}
          nota={dias === null ? '' : dias < 0 ? `Hace ${Math.abs(dias)} d` : `En ${dias} d`}
          href={e.fecha_programada ? `/logistica/planificador?mes=${String(e.fecha_programada).slice(0, 7)}` : '/logistica/planificador'}
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
          </dl>
          {/* Editables después de programar (octubre, punto 12). */}
          <div style={{ padding: '.2rem 1rem .9rem' }}>
            <span className="etiqueta" style={{ display: 'block', marginBottom: '.25rem' }}>Observaciones</span>
            <ObservacionesEmbarque id={embId} texto={(e.observaciones as string) ?? null}
                                   puede={puedeEditar && estado !== 'cancelado'} />
          </div>
          {puedeEditar && (
            <EditarEmbarque
              embarqueId={embId}
              tipoDespacho={String(e.tipo_despacho)}
              noPuede={cerradoPara ? `${cerradoPara} Sus datos ya no se cambian.` : null}
              datos={{
                fecha_programada: String(e.fecha_programada ?? ''),
                destino_id: (e.destino_id as number) ?? null,
                booking: (e.booking as string) ?? null,
                naviera: (e.naviera as string) ?? null,
                transportista_id: (e.transportista_id as number) ?? null,
                vehiculo_id: (e.vehiculo_id as number) ?? null,
                conductor_id: (e.conductor_id as number) ?? null,
                observaciones: (e.observaciones as string) ?? null,
              }}
              destinos={(destinosCat?.data ?? []).map((x) => ({ id: Number(x.id), puerto: String(x.puerto), pais: String(x.pais ?? '') }))}
              transportistas={(transportistasCat?.data ?? []).map((t) => ({ id: Number(t.id), nombre: String(t.razon_social) }))}
              vehiculos={(vehiculosCat?.data ?? []).map((v) => ({
                id: Number(v.id), placa: String(v.placa),
                soat: (v.soat_vence as string) ?? null, revision: (v.revision_vence as string) ?? null,
              }))}
              conductores={(conductoresCat?.data ?? []).map((c) => ({ id: Number(c.id), nombre: String(c.nombre) }))}
            />
          )}
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

      <Panel
        id="pedidos"
        titulo={`Pedidos en este embarque · ${pedidos.length}`}
        className="mb-espacio"
      >
        {/* Agregar pedidos después de programar (antes solo se elegían en el alta). */}
        {puedeEditar && (
          <div style={{ padding: '.7rem 1rem 0' }}>
            <AgregarPedidos
              embarqueId={embId}
              almacenId={Number(e.almacen_id)}
              bodega={campo(e.almacenes, 'nombre')}
              noPuede={cerradoPara ? `${cerradoPara} Ya no se le agregan pedidos.` : null}
              /* El traslado lo arman Gerencia, Operaciones o Almacén (regla de
                 almacenes/traslados/acciones.ts); los demás ven el botón apagado
                 y por qué, en vez de un error al pulsarlo. */
              noPuedeTrasladar={rolPuede(usuario?.rol, PUEDEN_CONSOLIDAR)
                ? null
                : mensajeNoPuede(usuario?.rol, 'armar traslados de consolidación', PUEDEN_CONSOLIDAR) + ' Pídales que lo armen.'}
            />
          </div>
        )}
        {pedidos.length === 0 ? (
          <Vacio
            titulo="Embarque vacío"
            mensaje={estado === 'cancelado'
              ? 'No lleva ningún pedido.'
              : 'Todavía no lleva ningún pedido. Agrégueselos con «Agregar pedidos», arriba a la derecha de este cuadro.'}
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
                        {/* Almacén no tiene Clientes: el nombre va sin enlace. */}
                        {cli?.id && rolPuedeVerRuta((usuario?.rol ?? 'consulta') as Rol, '/ventas/clientes') ? (
                          <Link href={`/ventas/clientes/${cli.id}`} className="enlace-ficha">
                            {String(cli.razon_social)}
                          </Link>
                        ) : cli?.id ? String(cli.razon_social) : '—'}
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
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <Link href={`/ventas/pedidos/${p.id}`} className="accion-btn" title="Ver el pedido">
                          <Icono nombre="ver" tamano={15} />
                        </Link>
                        {puedeEditar && estado !== 'cancelado' && (() => {
                          const enContenedor = cargadoDe(p);
                          return (
                            <QuitarPedido
                              embarqueId={embId}
                              pedidoId={Number(p.id)}
                              proforma={String(p.numero_proforma)}
                              noPuede={cerradoPara
                                ?? (enContenedor.length
                                  ? `Tiene pallets en un contenedor: ${enContenedor.slice(0, 3).join(', ')}${enContenedor.length > 3 ? '…' : ''}. Bájelos del packing primero.`
                                  : null)}
                            />
                          );
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* ══════ QUÉ SALE EN ESTE EMBARQUE (octubre, punto 13) ══════ */}
      <Panel id="productos" titulo={`Productos programados · ${(programadas ?? []).length}`} className="mb-espacio">
        {(programadas ?? []).length === 0 ? (
          <Vacio
            titulo="Sin detalle por producto"
            mensaje="Este embarque lleva sus pedidos enteros: se programó antes de poder elegir producto por producto, o desde el calendario."
          />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos" data-cuadro="embarque-lineas">
              <thead>
                <tr>
                  <th>Proforma</th><th>Producto pedido</th><th>SKU que sale</th>
                  <th className="num">Pedido</th><th className="num">Sale en este</th>
                  <th className="num">Programado en total</th><th className="num">Pendiente</th>
                </tr>
              </thead>
              <tbody>
                {(programadas ?? []).map((x) => {
                  const pl = uno<Record<string, unknown>>(x.pedido_lineas);
                  const sp = uno<Record<string, unknown>>(pl?.sku_presentaciones);
                  const sku = uno<Record<string, unknown>>(sp?.skus);
                  const sale = uno<Record<string, unknown>>(x.sale);
                  const s = saldoDe.get(Number(x.pedido_linea_id));
                  const equivalente = Number(x.sku_presentacion_id) !== Number(pl?.sku_presentacion_id);
                  return (
                    <tr key={x.id as number} data-linea={x.pedido_linea_id as number}>
                      <td className="mono">
                        <Link href={`/ventas/pedidos/${pl?.pedido_id}`} className="enlace-ficha">
                          {String(uno<Record<string, unknown>>(pl?.pedidos)?.numero_proforma ?? '—')}
                        </Link>
                      </td>
                      <td style={{ fontSize: '.76rem' }}>
                        {String(sku?.codigo ?? '')} · {campo(sku?.especies, 'nombre')} {String(sku?.corte ?? '')} · {campo(sp?.presentaciones, 'descripcion')}
                      </td>
                      <td style={{ fontSize: '.76rem' }}>
                        {campo(sale?.skus, 'codigo')} · {campo(sale?.presentaciones, 'descripcion')}
                        {equivalente && <> <Etiqueta texto="Equivalente" tono="atencion" /></>}
                      </td>
                      <td className="num">{num(Number(pl?.cantidad_tm ?? 0), 3)} TM</td>
                      <td className="num">
                        <strong>{tm(Number(x.cantidad_kg), 3)} TM</strong>
                        {/* Lo que estaba en el contenedor y no salió (075): muestreo, merma, no entró. */}
                        {Number(x.kg_no_despachado ?? 0) > 0.0005 && (
                          <small style={{ display: 'block', color: 'var(--atencion)' }} data-no-salio={Number(x.kg_no_despachado).toFixed(3)}>
                            No salieron {tm(Number(x.kg_no_despachado), 3)} TM
                            {estado === 'despachado' ? ': vuelven a «por programar»' : ': pueden ir en otro contenedor'}
                          </small>
                        )}
                      </td>
                      <td className="num">{tm(Number(s?.programado_kg ?? 0), 3)} TM</td>
                      <td className="num" data-pendiente={Number(s?.por_programar_kg ?? 0).toFixed(3)}
                          style={{ color: Number(s?.por_programar_kg ?? 0) > 0.5 ? 'var(--atencion)' : 'var(--ok)' }}>
                        {Number(s?.por_programar_kg ?? 0) > 0.5 ? `${tm(Number(s?.por_programar_kg), 3)} TM` : 'Completo'}
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
