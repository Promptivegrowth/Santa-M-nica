/**
 * ============================================================================
 *  FICHA DEL LOTE · la pantalla más importante del sistema
 * ============================================================================
 *  Un lote es una tarima concreta de producto: se produjo un día, en una
 *  planta, en un turno, y desde entonces se ha movido, se ha reservado, se ha
 *  trasladado y quizá se ha despachado.
 *
 *  Esta ficha responde de una sola vez las cuatro preguntas que en Santa Mónica
 *  hoy se contestan llamando por teléfono:
 *
 *    ¿DÓNDE ESTÁ?        existencias por almacén y cámara
 *    ¿CUÁNTO HAY LIBRE?  físico menos lo reservado
 *    ¿QUÉ LE PASÓ?       la traza completa hacia adelante
 *    ¿SE PUEDE VENDER?   dictámenes de calidad y antigüedad
 *
 *  El bloque de reservas es la respuesta directa al problema que describió
 *  Oliver: «el producto está, pero figura asignado a un cliente que nunca lo
 *  llevó». Aquí se ve el nombre de ese cliente, desde cuándo, y cuándo expira.
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
import { fecha, fechaHora, num, dinero, tm, etiquetaEstado, diasDesdeHoy } from '@/lib/formato';
import { veCostos, type Rol } from '@/lib/navegacion';
import { uno, campo } from '@/lib/relaciones';
import { FormularioDictamen } from '@/components/almacenes/Dictamen';
import { motivosCalidad } from '@/app/(erp)/almacenes/calidad/acciones';

export const dynamic = 'force-dynamic';

export async function generateMetadata(
  props: PageProps<'/almacenes/lotes/[id]'>
): Promise<Metadata> {
  const { id } = await props.params;
  const supabase = await crearClienteServidor();
  const { data } = await supabase.from('lotes').select('codigo_pallet').eq('id', Number(id)).single();
  return { title: data?.codigo_pallet ?? 'Lote' };
}

/**
 * ----------------------------------------------------------------------------
 *  EL CASCARÓN
 * ----------------------------------------------------------------------------
 *  Hace UNA sola consulta —la que dice si este lote existe— y dibuja la
 *  cabecera. Todo lo demás se cuelga de un <Suspense> y llega después.
 *
 *  El reparto no es estético, es lo que hace que un identificador inventado
 *  responda 404 de verdad. Next.js empieza a enviar la respuesta en cuanto
 *  encuentra el primer <Suspense>, y una vez enviada la cabecera HTTP ya no se
 *  puede cambiar el código de estado. Con un loading.tsx —que envuelve la
 *  página entera— eso ocurre ANTES de que nadie haya mirado la base, así que
 *  el notFound() llegaba tarde: el navegador veía la pantalla correcta, pero
 *  con un 200 en la cabecera.
 *
 *  De regalo, la cabecera con el código del pallet aparece al instante en vez
 *  de esperar a las seis consultas.
 * ----------------------------------------------------------------------------
 */
export default async function FichaLote(props: PageProps<'/almacenes/lotes/[id]'>) {
  const { id } = await props.params;
  const loteId = Number(id);

  const supabase = await crearClienteServidor();
  const [{ data: lote }, usuarioActual, motivos] = await Promise.all([
    supabase
      .from('lotes')
      .select('*, plantas(nombre, codigo), sku_presentaciones(id, skus(codigo, corte, especies(nombre), formatos(nombre)), presentaciones(descripcion, peso_bulto_kg))')
      .eq('id', loteId)
      .single(),
    obtenerUsuarioActual(),
    motivosCalidad(),
  ]);

  if (!lote) notFound();

  const puedeDictaminar = ['gerencia', 'operaciones', 'calidad'].includes(usuarioActual?.rol ?? '');
  /* Ajustes, mermas y muestras (069). Cada rol ve en el formulario solo lo que
     puede registrar; Comercial, Comercio Exterior y Consulta no lo ven. */
  const puedeAjustar = ['gerencia', 'operaciones', 'almacen', 'calidad'].includes(usuarioActual?.rol ?? '');

  const sp = uno<Record<string, unknown>>(lote.sku_presentaciones);
  const sku = uno<Record<string, unknown>>(sp?.skus);

  return (
    <>
      <CabeceraPagina
        titulo={lote.codigo_pallet as string}
        descripcion={`${campo(sku?.especies, 'nombre')} · ${campo(sku?.formatos, 'nombre')} · ${campo(sku, 'corte')}`}
        volver={{ href: '/almacenes/existencias', texto: 'Volver a existencias' }}
      >
        <Link href={`/trazabilidad?lote=${loteId}`} className="btn btn-secundario">
          <Icono nombre="trazabilidad" tamano={15} />
          Trazabilidad completa
        </Link>
        <Link href={`/trazabilidad/retiro?lote=${loteId}`} className="btn btn-peligro-borde">
          <Icono nombre="retiro" tamano={15} />
          Simular retiro
        </Link>
        {puedeAjustar && (
          <Link href={`/almacenes/ajustes/nuevo?lote=${loteId}`} className="btn btn-secundario" data-accion="ajustar-stock">
            <Icono nombre="ajustes" tamano={15} />
            Ajustar stock
          </Link>
        )}
        <FormularioDictamen
          loteId={loteId}
          pallet={lote.codigo_pallet as string}
          motivos={motivos}
          puede={puedeDictaminar}
          compacto
        />
      </CabeceraPagina>

      <Suspense fallback={<CargandoCuerpo />}>
        <CuerpoLote loteId={loteId} lote={lote} />
      </Suspense>
    </>
  );
}

/** El esqueleto de lo que está por llegar: mismas alturas, mismas columnas. */
function CargandoCuerpo() {
  return (
    <>
      <EsqueletoKpi cantidad={5} />
      <div className="rejilla-2">
        <EsqueletoFicha lineas={10} />
        <EsqueletoTabla filas={3} columnas={5} conFiltros={false} />
      </div>
      <EsqueletoTabla filas={4} columnas={7} conFiltros={false} />
      <EsqueletoTabla filas={6} columnas={9} conFiltros={false} />
      <span className="sr-solo" role="status">Cargando la información del lote…</span>
    </>
  );
}

/**
 * ----------------------------------------------------------------------------
 *  EL CUERPO
 * ----------------------------------------------------------------------------
 *  Las cinco consultas pesadas. Se lanzan a la vez, no en fila: la más lenta
 *  marca el tiempo total en lugar de sumarse a las demás.
 * ----------------------------------------------------------------------------
 */
async function CuerpoLote({
  loteId,
  lote,
}: {
  loteId: number;
  /** Ya viene resuelto del cascarón: no se vuelve a consultar. */
  lote: Record<string, unknown>;
}) {
  const supabase = await crearClienteServidor();
  const usuario = await obtenerUsuarioActual();
  const puedeVerCostos = veCostos((usuario?.rol ?? 'consulta') as Rol);

  // Se vuelven a desanidar aquí porque la ficha de identidad los necesita.
  const sp = uno<Record<string, unknown>>(lote.sku_presentaciones);
  const sku = uno<Record<string, unknown>>(sp?.skus);

  const [
    { data: existencias },
    { data: dictamenes },
    { data: reservas },
    { data: traza },
    { data: antiguedad },
    { data: stock },
  ] = await Promise.all([
    supabase
      .from('existencias')
      .select('bultos, peso_neto_kg, costo_promedio, actualizado_en, almacenes(id, nombre, tipo), camaras(nombre)')
      .eq('lote_id', loteId),
    supabase
      .from('dictamenes_calidad')
      .select('id, tipo, estado, motivo_texto, emitido_en, vigente, observaciones, motivos(nombre, condiciona_venta)')
      .eq('lote_id', loteId)
      .order('emitido_en', { ascending: false }),
    /* Activas Y en preparación: las dos tienen el stock apartado para un
       pedido (es lo mismo que descuenta el disponible en la base). */
    supabase
      .from('reservas')
      .select('id, bultos, peso_neto_kg, estado, vence_el, creado_en, observaciones, pedido_lineas(pedido_id, pedidos(numero_proforma, ciclo, clientes(id, razon_social)))')
      .eq('lote_id', loteId)
      .in('estado', ['activa', 'en_preparacion']),
    supabase.rpc('trazar_lote_adelante', { p_lote_id: loteId }),
    supabase.from('v_anticuamiento').select('meses_almacenado, rango, en_alerta, vencido').eq('lote_id', loteId).limit(1),
    /* Lo libre lo calcula la base (v_stock_lote), con la misma regla que usan
       Existencias, Disponibilidad y las reservas: físico − bloqueado por
       Calidad − reservado − en preparación. Calcularlo aquí aparte es como
       llegó a decir «libre» un pallet inmovilizado. */
    supabase
      .from('v_stock_lote')
      .select('almacen_id, fisico_kg, bloqueado_kg, reservado_kg, preparacion_kg, disponible_kg, solo_nacional_kg')
      .eq('lote_id', loteId),
  ]);

  /* ---- Cuánto hay, cuánto está comprometido, cuánto queda libre ---- */
  const fisicoKg = (existencias ?? []).reduce((s, e) => s + Number(e.peso_neto_kg ?? 0), 0);
  const bultos = (existencias ?? []).reduce((s, e) => s + Number(e.bultos ?? 0), 0);
  const reservadoKg = (reservas ?? []).reduce((s, r) => s + Number(r.peso_neto_kg ?? 0), 0);
  const bloqueadoKg = (stock ?? []).reduce((s, v) => s + Number(v.bloqueado_kg ?? 0), 0);
  const libreKg = (stock ?? []).reduce((s, v) => s + Number(v.disponible_kg ?? 0), 0);
  const soloNacionalKg = (stock ?? []).reduce((s, v) => s + Number(v.solo_nacional_kg ?? 0), 0);
  const costoProm = (existencias ?? [])[0]?.costo_promedio ?? lote.costo_unitario;
  const valor = fisicoKg * Number(costoProm ?? 0);

  /*
   * ---- ¿Está bloqueado por calidad? ----
   * Los dictámenes reales son liberado, observado, inmovilizado y en espera de
   * resultados (enum estado_dictamen). Bloquea cualquier dictamen VIGENTE que
   * no esté liberado, salvo que su motivo solo condicione la venta («Solo
   * mercado nacional»): ese no bloquea, limita a quién se vende. Es la misma
   * regla que lote_bloqueado() en la base (061).
   */
  const GRAVEDAD: Record<string, number> = { inmovilizado: 3, observado: 2, espera_resultados: 1 };
  const abiertos = (dictamenes ?? []).filter((d) => d.vigente === true && d.estado !== 'liberado');
  const condicionaVenta = (d: (typeof abiertos)[number]) =>
    Boolean(uno<Record<string, unknown>>(d.motivos)?.condiciona_venta);
  const bloqueantes = abiertos
    .filter((d) => !condicionaVenta(d))
    .sort((a, b) => (GRAVEDAD[b.estado as string] ?? 0) - (GRAVEDAD[a.estado as string] ?? 0));
  const bloqueoVigente = bloqueantes[0];
  const condicionVigente = abiertos.find((d) => condicionaVenta(d));
  const TEXTO_BLOQUEO: Record<string, string> = {
    inmovilizado: 'inmovilizado',
    observado: 'observado',
    espera_resultados: 'en espera de resultados',
  };

  const edad = (antiguedad ?? [])[0];
  const meses = Number(edad?.meses_almacenado ?? 0);

  return (
    <>
      {/* ---- Avisos que condicionan si este lote se puede vender ---- */}
      {bloqueoVigente && (
        <div className="ficha-aviso ficha-aviso-critico" data-aviso="bloqueo-calidad">
          <Icono nombre="calidad" tamano={17} />
          <span>
            <strong>
              Pallet {TEXTO_BLOQUEO[bloqueoVigente.estado as string] ?? etiquetaEstado(bloqueoVigente.estado as string)} por
              Calidad
            </strong>{' '}
            ({etiquetaEstado(bloqueoVigente.tipo as string)}:{' '}
            {campo(bloqueoVigente.motivos, 'nombre', (bloqueoVigente.motivo_texto as string) ?? 'sin motivo')})
            {bloqueantes.length > 1 && ` y ${bloqueantes.length - 1} dictamen${bloqueantes.length > 2 ? 'es' : ''} abierto${bloqueantes.length > 2 ? 's' : ''} más`}.
            Sus {tm(bloqueadoKg)} TM no se pueden reservar, trasladar ni despachar hasta que Calidad libere
            {bloqueantes.length > 1 ? ' todos los dictámenes abiertos' : ' el dictamen'}.
          </span>
        </div>
      )}

      {!bloqueoVigente && condicionVigente && (
        <div className="ficha-aviso ficha-aviso-atencion" data-aviso="solo-nacional">
          <Icono nombre="calidad" tamano={17} />
          <span>
            <strong>Solo mercado nacional.</strong>{' '}
            {campo(condicionVigente.motivos, 'nombre')}: el pallet está libre, pero solo puede
            reservarse o despacharse para pedidos de mercado nacional
            {soloNacionalKg > 0 ? ` (${tm(soloNacionalKg)} TM de lo libre)` : ''}. No se puede exportar.
          </span>
        </div>
      )}

      {edad?.vencido === true && (
        <div className="ficha-aviso ficha-aviso-critico">
          <Icono nombre="anticuamiento" tamano={17} />
          <span>
            <strong>Producto vencido.</strong> Lleva {num(meses, 1)} meses almacenado y superó la
            vida útil configurada. Revise si corresponde castigar su valor o darle salida prioritaria.
          </span>
        </div>
      )}

      {edad?.en_alerta === true && edad?.vencido !== true && (
        <div className="ficha-aviso ficha-aviso-atencion">
          <Icono nombre="reloj" tamano={17} />
          <span>
            <strong>Antigüedad en alerta:</strong> {num(meses, 1)} meses en cámara (rango{' '}
            {edad.rango as string}). Conviene priorizar su salida antes que lotes más nuevos.
          </span>
        </div>
      )}

      {reservadoKg > 0 && (
        <div className="ficha-aviso ficha-aviso-info">
          <Icono nombre="control" tamano={17} />
          <span>
            <strong>{tm(reservadoKg)} de este lote están apartados</strong> para{' '}
            {(reservas ?? []).length} pedido{(reservas ?? []).length === 1 ? '' : 's'}. Ese peso no
            aparece como disponible para vender. Si alguna reserva ya no corresponde, libérela desde
            el pedido y el stock vuelve al instante.
          </span>
        </div>
      )}

      <RejillaKpi>
        <Kpi etiqueta="Físico en almacén" valor={tm(fisicoKg)} nota={`${num(bultos)} bultos`} href="#ubicacion" />
        <Kpi
          etiqueta="Apartado"
          valor={tm(reservadoKg)}
          tono={reservadoKg > 0 ? 'atencion' : 'ok'}
          nota="Reservas activas y en preparación"
          href="#reservas"
        />
        <Kpi
          etiqueta="Libre para vender"
          valor={tm(libreKg)}
          tono={libreKg > 0 ? 'ok' : 'critico'}
          nota={bloqueadoKg > 0
            ? `${tm(bloqueadoKg)} TM bloqueadas por Calidad`
            : 'Físico − bloqueado − apartado'}
          href={bloqueadoKg > 0 ? '#calidad' : '#ubicacion'}
        />
        <Kpi etiqueta="Antigüedad" valor={`${num(meses, 1)} m`} nota={(edad?.rango as string) ?? '—'} href="/almacenes/anticuamiento" />
        {puedeVerCostos && (
          <Kpi etiqueta="Valor en libros" valor={dinero(valor, 'USD', 0)} nota="Costo promedio móvil" href="/almacenes/valorizado" />
        )}
      </RejillaKpi>

      {/* ---- Identidad del lote ---- */}
      <div className="rejilla-2 mb-espacio">
        <Panel titulo="Identidad y origen">
          <dl className="ficha">
            <div><dt>Código de pallet</dt><dd className="mono">{lote.codigo_pallet as string}</dd></div>
            <div><dt>Código de lote</dt><dd className="mono">{(lote.codigo_lote as string) ?? '—'}</dd></div>
            <div><dt>Campaña</dt><dd>{lote.campania as number}</dd></div>
            <div><dt>Producido el</dt><dd>{fecha(lote.fecha_produccion as string)} · juliano {lote.juliano as string}</dd></div>
            <div><dt>Planta</dt><dd>{campo(lote.plantas, 'nombre')}</dd></div>
            <div><dt>Turno / proceso</dt><dd>{String(lote.turno)} · {String(lote.proceso)}</dd></div>
            <div><dt>SKU</dt><dd className="mono">{campo(sku, 'codigo')}</dd></div>
            <div><dt>Presentación</dt><dd>{campo(sp?.presentaciones, 'descripcion')}</dd></div>
            <div><dt>Producción inicial</dt><dd>{num(Number(lote.bultos_iniciales))} bultos · {tm(Number(lote.peso_neto_inicial_kg))}</dd></div>
            {puedeVerCostos && (
              <div><dt>Costo unitario de origen</dt><dd>{dinero(Number(lote.costo_unitario), 'USD', 4)}/kg</dd></div>
            )}
            {lote.observaciones ? (
              <div><dt>Observaciones</dt><dd>{lote.observaciones as string}</dd></div>
            ) : null}
          </dl>
        </Panel>

        <Panel id="ubicacion" titulo="Ubicación física">
          {(existencias ?? []).length === 0 ? (
            <Vacio
              titulo="Sin existencias"
              mensaje="Este lote ya salió por completo del almacén. Su historial de movimientos se conserva íntegro más abajo."
            />
          ) : (
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos">
                <thead>
                  <tr>
                    <th>Almacén</th><th>Cámara</th>
                    <th className="num">Bultos</th><th className="num">Peso</th>
                    <th className="num">Actualizado</th>
                  </tr>
                </thead>
                <tbody>
                  {(existencias ?? []).map((e, i) => (
                    <tr key={i}>
                      <td>{campo(e.almacenes, 'nombre')}</td>
                      <td>{campo(e.camaras, 'nombre', 'Sin cámara')}</td>
                      <td className="num">{num(e.bultos)}</td>
                      <td className="num">{tm(Number(e.peso_neto_kg))}</td>
                      <td className="num" style={{ fontSize: '.72rem' }}>
                        {fecha(e.actualizado_en as string)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {/* ---- Reservas: el corazón del problema del cliente ---- */}
      <Panel id="reservas"
        titulo={`Reservas vigentes · ${(reservas ?? []).length}`}
        className="mb-espacio"
        acciones={
          <Link href="/almacenes/reservas" className="btn btn-sutil">Ver todas las reservas</Link>
        }
      >
        {(reservas ?? []).length === 0 ? (
          <Vacio
            titulo="Nada apartado"
            mensaje={bloqueadoKg > 0
              ? 'Ningún pedido lo tiene apartado, pero está bloqueado por Calidad: no se puede vender hasta que lo liberen.'
              : 'Ningún pedido tiene apartado este pallet.'}
          />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos">
              <thead>
                <tr>
                  <th>Pedido</th><th>Cliente</th>
                  <th className="num">Bultos</th><th className="num">Peso</th>
                  <th className="num">Reservado</th><th className="num">Vence</th>
                  <th>Estado</th><th></th>
                </tr>
              </thead>
              <tbody>
                {(reservas ?? []).map((r) => {
                  const pl = uno<Record<string, unknown>>(r.pedido_lineas);
                  const ped = uno<Record<string, unknown>>(pl?.pedidos);
                  const cli = uno<Record<string, unknown>>(ped?.clientes);
                  const dias = diasDesdeHoy(r.vence_el as string);
                  return (
                    <tr key={r.id as number}>
                      <td className="mono">
                        {pl?.pedido_id ? (
                          <Link href={`/ventas/pedidos/${pl.pedido_id}`} className="enlace-ficha">
                            {String(ped?.numero_proforma ?? '—')}
                          </Link>
                        ) : '—'}
                      </td>
                      <td>{String(cli?.razon_social ?? '—')}</td>
                      <td className="num">{num(r.bultos)}</td>
                      <td className="num">{tm(Number(r.peso_neto_kg))}</td>
                      <td className="num" style={{ fontSize: '.72rem' }}>{fecha(r.creado_en as string)}</td>
                      <td className="num">
                        {dias < 0 ? (
                          <Etiqueta texto={`Vencida hace ${Math.abs(dias)} d`} tono="critico" />
                        ) : dias <= 3 ? (
                          <Etiqueta texto={`En ${dias} d`} tono="atencion" />
                        ) : (
                          <span style={{ fontSize: '.75rem' }}>{fecha(r.vence_el as string)}</span>
                        )}
                      </td>
                      <td>
                        <Etiqueta texto={etiquetaEstado(r.estado as string)}
                                  tono={r.estado === 'en_preparacion' ? 'atencion' : 'info'} />
                      </td>
                      <td>
                        {pl?.pedido_id ? (
                          <Link href={`/ventas/pedidos/${pl.pedido_id}`} className="accion-btn" title="Abrir el pedido para liberar">
                            <Icono nombre="expandir" tamano={14} />
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* ---- Calidad ---- */}
      <Panel id="calidad" titulo={`Dictámenes de calidad · ${(dictamenes ?? []).length}`} className="mb-espacio">
        {(dictamenes ?? []).length === 0 ? (
          <Vacio
            titulo="Sin dictámenes"
            mensaje="Nunca se retuvo ni observó este lote. Está apto para vender."
          />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos">
              <thead>
                <tr>
                  <th className="num">Fecha</th><th>Tipo</th><th>Estado</th>
                  <th>Motivo</th><th>Vigente</th>
                </tr>
              </thead>
              <tbody>
                {(dictamenes ?? []).map((d) => (
                  <tr key={d.id as number}>
                    <td className="num" style={{ fontSize: '.75rem' }}>{fecha(d.emitido_en as string)}</td>
                    <td>{etiquetaEstado(d.tipo as string)}</td>
                    <td>
                      <Etiqueta
                        texto={etiquetaEstado(d.estado as string)}
                        tono={
                          d.estado === 'liberado' ? 'ok'
                          : d.estado === 'inmovilizado' ? 'critico'
                          : 'atencion'
                        }
                      />
                    </td>
                    <td style={{ fontSize: '.78rem' }}>
                      {campo(d.motivos, 'nombre', (d.motivo_texto as string) ?? '—')}
                    </td>
                    <td>{d.vigente ? 'Sí' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* ---- Traza hacia adelante ---- */}
      <Panel
        titulo={`Todo lo que le pasó a este lote · ${(traza ?? []).length} hechos`}
        className="mb-espacio"
      >
        {(traza ?? []).length === 0 ? (
          <Vacio titulo="Sin movimientos" mensaje="El lote se creó pero todavía no registró ingreso." />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos">
              <thead>
                <tr>
                  <th className="num">Fecha</th><th>Etapa</th><th>Documento</th>
                  <th>Almacén</th><th>Cliente</th><th>Destino</th>
                  <th className="num">Bultos</th><th className="num">Peso</th><th></th>
                </tr>
              </thead>
              <tbody>
                {((traza ?? []) as Record<string, unknown>[]).map((t, i) => {
                  // Cada hecho de la traza sabe a qué registro pertenece: se
                  // convierte en un enlace para poder seguir tirando del hilo.
                  const destino =
                    t.referencia_tipo === 'traslado' ? `/almacenes/traslados/${t.referencia_id}`
                    : t.referencia_tipo === 'pedido' ? `/ventas/pedidos/${t.referencia_id}`
                    : t.referencia_tipo === 'packing_list' ? `/logistica/packing/${t.referencia_id}`
                    : null;
                  return (
                    <tr key={i}>
                      <td className="num" style={{ fontSize: '.74rem' }}>{fechaHora(t.fecha as string)}</td>
                      <td><Etiqueta texto={t.etapa as string} tono="neutro" /></td>
                      <td className="mono" style={{ fontSize: '.75rem' }}>{(t.documento as string) ?? '—'}</td>
                      <td style={{ fontSize: '.78rem' }}>{(t.almacen as string) ?? '—'}</td>
                      <td style={{ fontSize: '.78rem' }}>{(t.cliente as string) ?? '—'}</td>
                      <td style={{ fontSize: '.78rem' }}>{(t.destino as string) ?? '—'}</td>
                      <td className="num">{t.bultos != null ? num(t.bultos as number) : '—'}</td>
                      <td className="num">{t.peso_kg != null ? tm(Number(t.peso_kg)) : '—'}</td>
                      <td>
                        {destino && (
                          <Link href={destino} className="accion-btn" title="Abrir el documento">
                            <Icono nombre="expandir" tamano={14} />
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel titulo="Historial de cambios sobre la ficha">
        <Historial entidad="lotes" entidadId={loteId} />
      </Panel>

      <p className="pie-explicativo">
        Todo movimiento de este lote quedó escrito en el Kardex, que es de solo lectura: la base de
        datos rechaza cualquier intento de modificar o borrar un movimiento ya registrado. Si hubo un
        error, o se perdió o salió producto como merma o muestra, se registra con <strong>Ajustar
        stock</strong>: un movimiento nuevo que también queda a la vista.
      </p>
    </>
  );
}
