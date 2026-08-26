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
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel, Vacio, Etiqueta, RejillaKpi, Kpi } from '@/components/ui/Pagina';
import { Historial } from '@/components/ui/Historial';
import { Icono } from '@/components/estructura/Icono';
import { fecha, fechaHora, num, dinero, tm, etiquetaEstado, diasDesdeHoy } from '@/lib/formato';
import { veCostos, type Rol } from '@/lib/navegacion';
import { uno, campo } from '@/lib/relaciones';

export const dynamic = 'force-dynamic';

export async function generateMetadata(
  props: PageProps<'/almacenes/lotes/[id]'>
): Promise<Metadata> {
  const { id } = await props.params;
  const supabase = await crearClienteServidor();
  const { data } = await supabase.from('lotes').select('codigo_pallet').eq('id', Number(id)).single();
  return { title: data?.codigo_pallet ?? 'Lote' };
}

export default async function FichaLote(props: PageProps<'/almacenes/lotes/[id]'>) {
  const { id } = await props.params;
  const loteId = Number(id);

  const supabase = await crearClienteServidor();
  const usuario = await obtenerUsuarioActual();
  const puedeVerCostos = veCostos((usuario?.rol ?? 'consulta') as Rol);

  const [
    { data: lote },
    { data: existencias },
    { data: dictamenes },
    { data: reservas },
    { data: traza },
    { data: antiguedad },
  ] = await Promise.all([
    supabase
      .from('lotes')
      .select('*, plantas(nombre, codigo), sku_presentaciones(id, skus(codigo, corte, especies(nombre), formatos(nombre)), presentaciones(descripcion, peso_bulto_kg))')
      .eq('id', loteId)
      .single(),
    supabase
      .from('existencias')
      .select('bultos, peso_neto_kg, costo_promedio, actualizado_en, almacenes(id, nombre, tipo), camaras(nombre)')
      .eq('lote_id', loteId),
    supabase
      .from('dictamenes_calidad')
      .select('id, tipo, estado, motivo_texto, emitido_en, vigente, observaciones, motivos(nombre)')
      .eq('lote_id', loteId)
      .order('emitido_en', { ascending: false }),
    supabase
      .from('reservas')
      .select('id, bultos, peso_neto_kg, estado, vence_el, creado_en, observaciones, pedido_lineas(pedido_id, pedidos(numero_proforma, ciclo, clientes(id, razon_social)))')
      .eq('lote_id', loteId)
      .eq('estado', 'activa'),
    supabase.rpc('trazar_lote_adelante', { p_lote_id: loteId }),
    supabase.from('v_anticuamiento').select('meses_almacenado, rango, en_alerta, vencido').eq('lote_id', loteId).limit(1),
  ]);

  if (!lote) notFound();

  const sp = uno<Record<string, unknown>>(lote.sku_presentaciones);
  const sku = uno<Record<string, unknown>>(sp?.skus);

  /* ---- Cuánto hay, cuánto está comprometido, cuánto queda libre ---- */
  const fisicoKg = (existencias ?? []).reduce((s, e) => s + Number(e.peso_neto_kg ?? 0), 0);
  const bultos = (existencias ?? []).reduce((s, e) => s + Number(e.bultos ?? 0), 0);
  const reservadoKg = (reservas ?? []).reduce((s, r) => s + Number(r.peso_neto_kg ?? 0), 0);
  const libreKg = fisicoKg - reservadoKg;
  const costoProm = (existencias ?? [])[0]?.costo_promedio ?? lote.costo_unitario;
  const valor = fisicoKg * Number(costoProm ?? 0);

  /* ---- ¿Está bloqueado por calidad? ---- */
  const bloqueoVigente = (dictamenes ?? []).find(
    (d) => d.vigente === true && ['retenido', 'rechazado'].includes(d.estado as string)
  );

  const edad = (antiguedad ?? [])[0];
  const meses = Number(edad?.meses_almacenado ?? 0);

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
      </CabeceraPagina>

      {/* ---- Avisos que condicionan si este lote se puede vender ---- */}
      {bloqueoVigente && (
        <div className="ficha-aviso ficha-aviso-critico">
          <Icono nombre="calidad" tamano={17} />
          <span>
            <strong>Lote {etiquetaEstado(bloqueoVigente.estado as string)} por calidad.</strong>{' '}
            {campo(bloqueoVigente.motivos, 'nombre', bloqueoVigente.motivo_texto as string)}. No
            puede reservarse ni despacharse hasta que Calidad lo libere.
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
        <Kpi etiqueta="Físico en almacén" valor={tm(fisicoKg)} nota={`${num(bultos)} bultos`} />
        <Kpi
          etiqueta="Apartado"
          valor={tm(reservadoKg)}
          tono={reservadoKg > 0 ? 'atencion' : 'ok'}
          nota="Reservas activas"
        />
        <Kpi
          etiqueta="Libre para vender"
          valor={tm(libreKg)}
          tono={libreKg > 0 ? 'ok' : 'critico'}
          nota="Físico menos apartado"
        />
        <Kpi etiqueta="Antigüedad" valor={`${num(meses, 1)} m`} nota={(edad?.rango as string) ?? '—'} />
        {puedeVerCostos && (
          <Kpi etiqueta="Valor en libros" valor={dinero(valor, 'USD', 0)} nota="Costo promedio móvil" />
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
            <div><dt>Producción inicial</dt><dd>{num(lote.bultos_iniciales)} bultos · {tm(Number(lote.peso_neto_inicial_kg))}</dd></div>
            {puedeVerCostos && (
              <div><dt>Costo unitario de origen</dt><dd>{dinero(Number(lote.costo_unitario), 'USD', 4)}/kg</dd></div>
            )}
            {lote.observaciones ? (
              <div><dt>Observaciones</dt><dd>{lote.observaciones as string}</dd></div>
            ) : null}
          </dl>
        </Panel>

        <Panel titulo="Ubicación física">
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
      <Panel
        titulo={`Reservas activas · ${(reservas ?? []).length}`}
        className="mb-espacio"
        acciones={
          <Link href="/almacenes/reservas" className="btn btn-sutil">Ver todas las reservas</Link>
        }
      >
        {(reservas ?? []).length === 0 ? (
          <Vacio
            titulo="Nada apartado"
            mensaje="Todo el peso físico de este lote está libre para vender."
          />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos">
              <thead>
                <tr>
                  <th>Pedido</th><th>Cliente</th>
                  <th className="num">Bultos</th><th className="num">Peso</th>
                  <th className="num">Reservado</th><th className="num">Vence</th>
                  <th></th>
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
      <Panel titulo={`Dictámenes de calidad · ${(dictamenes ?? []).length}`} className="mb-espacio">
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
                          : d.estado === 'rechazado' ? 'critico'
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
        error, se corrige con un movimiento de ajuste que también queda a la vista.
      </p>
    </>
  );
}
