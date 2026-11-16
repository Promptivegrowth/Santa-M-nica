/**
 * ============================================================================
 *  DETALLE DEL RECLAMO · lo que hace Aseguramiento de Calidad (090, M5)
 * ============================================================================
 *  Lo que escribió el cliente y su evidencia; la atención (estado,
 *  clasificación y plazo, causa, acciones correctivas); el cierre con el PDF
 *  de respuesta; el historial de cada cambio con fecha y usuario, y los
 *  correos que salieron de este reclamo.
 *
 *  Las evidencias se ven con enlaces firmados de 1 hora, creados con la
 *  sesión del usuario: la política del almacenamiento decide quién las abre.
 * ============================================================================
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { fecha, fechaHora, num } from '@/lib/formato';
import { rolNoPuede } from '@/lib/mensajesBase';
import { ESTADOS_RECLAMO, SEMAFORO, ROLES_ATIENDEN_RECLAMOS, semaforoReclamo } from '@/lib/reclamos';
import { uno } from '@/lib/relaciones';
import { AtenderReclamo } from './AtenderReclamo';
import { CerrarReclamo } from './CerrarReclamo';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: PageProps<'/calidad/reclamos/[id]'>): Promise<Metadata> {
  const { id } = await props.params;
  const supabase = await crearClienteServidor();
  const { data } = await supabase.from('reclamos').select('numero').eq('id', Number(id)).maybeSingle();
  return { title: data?.numero ?? 'Reclamo' };
}

function tamano(bytes: number | null | undefined): string {
  const b = Number(bytes ?? 0);
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(b / 1024))} KB`;
}

export default async function DetalleReclamo(props: PageProps<'/calidad/reclamos/[id]'>) {
  const { id } = await props.params;
  const reclamoId = Number(id);
  if (!Number.isInteger(reclamoId) || reclamoId <= 0) notFound();

  const supabase = await crearClienteServidor();
  const [{ data: r }, usuario] = await Promise.all([
    supabase.from('reclamos')
      .select('*, clientes(razon_social, codigo), pedidos(numero_proforma), reclamo_motivos(nombre_es), reclamo_clasificaciones(nombre, plazo_dias), usuarios!reclamos_responsable_id_fkey(nombre)')
      .eq('id', reclamoId).maybeSingle(),
    obtenerUsuarioActual(),
  ]);
  if (!r) notFound();

  const [{ data: evidencias }, { data: historial }, { data: clasificaciones }, { data: contenedores }, { data: correos }] = await Promise.all([
    supabase.from('reclamo_evidencias').select('id, ruta, nombre, tipo_mime, tamano_bytes').eq('reclamo_id', reclamoId).order('id'),
    supabase.from('reclamo_historial').select('id, estado_anterior, estado_nuevo, nota, usuario_nombre, creado_en').eq('reclamo_id', reclamoId).order('creado_en'),
    supabase.from('reclamo_clasificaciones').select('id, nombre, plazo_dias, activo').order('orden'),
    supabase.from('v_pedido_contenedores').select('packing_list_id, referencia, contenedor').eq('pedido_id', r.pedido_id).order('secuencia'),
    supabase.from('correos_salida').select('id, tipo, para, asunto, estado, error, creado_en, enviado_por_nombre')
      .eq('entidad', 'reclamos').eq('entidad_id', reclamoId).order('creado_en', { ascending: false }),
  ]);

  /* Enlaces firmados de 1 hora para ver la evidencia y la respuesta. */
  const almacen = supabase.storage.from('reclamos');
  const rutas = (evidencias ?? []).map((e) => String(e.ruta));
  const { data: firmadas } = rutas.length ? await almacen.createSignedUrls(rutas, 3600) : { data: [] };
  const urlDe = new Map((firmadas ?? []).map((f) => [f.path, f.signedUrl]));
  const { data: respuesta } = r.respuesta_ruta
    ? await almacen.createSignedUrl(String(r.respuesta_ruta), 3600, { download: String(r.respuesta_nombre ?? 'respuesta.pdf') })
    : { data: null };

  const cliente = uno<Record<string, unknown>>(r.clientes);
  const proforma = String(uno<Record<string, unknown>>(r.pedidos)?.numero_proforma ?? '—');
  const motivo = String(uno<Record<string, unknown>>(r.reclamo_motivos)?.nombre_es ?? '—');
  const clasif = uno<Record<string, unknown>>(r.reclamo_clasificaciones);
  const responsable = uno<Record<string, unknown>>(r.usuarios)?.nombre as string | undefined;
  const conts = (contenedores ?? []).map((c) => ({ id: Number(c.packing_list_id), referencia: `${c.referencia}${c.contenedor ? ` · ${c.contenedor}` : ''}` }));
  const contReclamo = r.packing_list_id ? conts.find((c) => c.id === Number(r.packing_list_id)) : null;
  const contRespuesta = r.respuesta_packing_list_id ? conts.find((c) => c.id === Number(r.respuesta_packing_list_id)) : null;
  const sem = semaforoReclamo({ estado: r.estado, fecha_limite: r.fecha_limite });
  const cerrado = r.estado === 'cerrado';

  const puedeAtender = ROLES_ATIENDEN_RECLAMOS.includes(usuario?.rol ?? '');
  const bloqueo = cerrado
    ? 'El reclamo ya está cerrado: no se puede editar.'
    : puedeAtender ? null : rolNoPuede(usuario?.rol ?? 'consulta', 'atender reclamos', ROLES_ATIENDEN_RECLAMOS);

  return (
    <>
      <CabeceraPagina
        titulo={`Reclamo ${r.numero}`}
        descripcion={`${cliente?.razon_social ?? '—'} · proforma ${proforma} · ${motivo}`}
        volver={{ href: '/calidad/reclamos', texto: 'Volver a la bandeja' }}
      >
        <Etiqueta texto={ESTADOS_RECLAMO[r.estado] ?? r.estado} tono={cerrado ? 'ok' : 'info'} />
        {!cerrado && <Etiqueta texto={SEMAFORO[sem].texto} tono={SEMAFORO[sem].tono} />}
      </CabeceraPagina>

      <div className="rejilla-2">
        <Panel titulo="Lo que reportó el cliente">
          <dl className="ficha-resumen">
            <div><dt>Registrado</dt><dd>{fechaHora(r.creado_en)}</dd></div>
            <div><dt>Cliente</dt><dd>{String(cliente?.razon_social ?? '—')} <span className="mono">{String(cliente?.codigo ?? '')}</span></dd></div>
            <div><dt>Proforma</dt><dd className="mono"><Link href={`/ventas/pedidos/${r.pedido_id}`} className="enlace-ficha">{proforma}</Link></dd></div>
            <div><dt>Contenedor</dt><dd className="mono">{contReclamo?.referencia ?? 'Toda la proforma'}</dd></div>
            <div><dt>Motivo</dt><dd>{motivo}</dd></div>
            <div><dt>Contacto</dt><dd>{r.contacto_nombre} · <a href={`mailto:${r.contacto_correo}`}>{r.contacto_correo}</a> <small>(verificado)</small></dd></div>
            <div><dt>Idioma</dt><dd>{r.idioma === 'en' ? 'Inglés' : 'Español'}</dd></div>
          </dl>
          <div className="texto-reclamo">
            <strong>Descripción</strong>
            <p>{r.descripcion}</p>
            {r.observaciones && (
              <>
                <strong>Observaciones</strong>
                <p>{r.observaciones}</p>
              </>
            )}
          </div>
        </Panel>

        <Panel titulo="Atención de Calidad">
          <dl className="ficha-resumen">
            <div><dt>Clasificación</dt><dd>{clasif ? `${clasif.nombre} · ${clasif.plazo_dias} días` : 'Sin clasificar'}</dd></div>
            <div><dt>Fecha límite</dt><dd>{r.fecha_limite ? fecha(r.fecha_limite) : '—'}</dd></div>
            <div><dt>Responsable</dt><dd>{responsable ?? '—'}</dd></div>
            {cerrado && <div><dt>Cerrado</dt><dd>{fechaHora(r.cerrado_en)}</dd></div>}
          </dl>
          {cerrado && (
            <div className="texto-reclamo">
              <strong>Causa</strong>
              <p>{r.causa ?? '—'}</p>
              <strong>Acciones correctivas</strong>
              <p>{r.acciones_correctivas ?? '—'}</p>
              <strong>Conclusión enviada al cliente</strong>
              <p>{r.conclusion}</p>
              <p style={{ margin: 0 }}>
                PDF de respuesta ({r.respuesta_alcance === 'contenedor' ? `contenedor ${contRespuesta?.referencia ?? ''}` : 'toda la proforma'}):{' '}
                {respuesta?.signedUrl
                  ? <a href={respuesta.signedUrl} className="enlace-ficha">{r.respuesta_nombre}</a>
                  : r.respuesta_nombre}{' '}
                <small style={{ color: 'var(--tinta-3)' }}>· {tamano(r.respuesta_tamano)} · el cliente lo descarga del portal durante 3 meses</small>
              </p>
            </div>
          )}
        </Panel>
      </div>

      <Panel titulo={`Evidencia · ${num((evidencias ?? []).length)} archivo${(evidencias ?? []).length === 1 ? '' : 's'}`} className="mb-espacio">
        {(evidencias ?? []).length === 0 ? (
          <Vacio titulo="Sin evidencia" />
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.8rem', padding: '1rem' }} data-bloque="evidencias">
            {(evidencias ?? []).map((e) => {
              const url = urlDe.get(String(e.ruta));
              const esImagen = String(e.tipo_mime ?? '').startsWith('image/');
              const esVideo = String(e.tipo_mime ?? '').startsWith('video/');
              return (
                <figure key={e.id} style={{ margin: 0, width: '12rem', border: '1px solid var(--linea)', borderRadius: 'var(--radio)', padding: '.4rem', background: 'var(--superficie)' }}>
                  {url && esImagen ? (
                    <a href={url} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element -- enlace firmado temporal del almacenamiento */}
                      <img src={url} alt={String(e.nombre)} style={{ width: '100%', height: '8rem', objectFit: 'cover', display: 'block' }} />
                    </a>
                  ) : url && esVideo ? (
                    <video src={url} controls preload="metadata" style={{ width: '100%', height: '8rem', background: '#000' }} />
                  ) : (
                    <div style={{ height: '8rem', display: 'grid', placeItems: 'center', background: 'var(--superficie-2)', fontSize: '.8rem' }}>
                      {String(e.tipo_mime ?? '').includes('pdf') ? 'PDF' : 'Archivo'}
                    </div>
                  )}
                  <figcaption style={{ fontSize: '.74rem', marginTop: '.3rem', wordBreak: 'break-all' }}>
                    {url ? <a href={url} target="_blank" rel="noreferrer" className="enlace-ficha">{String(e.nombre)}</a> : String(e.nombre)}
                    <br /><small style={{ color: 'var(--tinta-3)' }}>{tamano(e.tamano_bytes)}</small>
                  </figcaption>
                </figure>
              );
            })}
          </div>
        )}
      </Panel>

      {!cerrado && (
        <div className="rejilla-2">
          <Panel titulo="Atender: revisión, clasificación y causa">
            <AtenderReclamo
              id={reclamoId}
              bloqueo={bloqueo}
              clasificaciones={(clasificaciones ?? []).filter((c) => c.activo || c.id === r.clasificacion_id)
                .map((c) => ({ id: Number(c.id), nombre: String(c.nombre), plazo_dias: Number(c.plazo_dias) }))}
              inicial={{
                estado: r.estado as 'pendiente' | 'en_revision' | 'en_investigacion',
                clasificacion_id: r.clasificacion_id == null ? null : Number(r.clasificacion_id),
                causa: r.causa ?? '', acciones: r.acciones_correctivas ?? '', nota: '',
              }}
            />
          </Panel>
          <Panel titulo="Cerrar con PDF de respuesta">
            <CerrarReclamo id={reclamoId} numero={String(r.numero)} contenedores={conts}
                           contenedorReclamo={r.packing_list_id == null ? null : Number(r.packing_list_id)} bloqueo={bloqueo} />
          </Panel>
        </div>
      )}

      <div className="rejilla-2">
        <Panel titulo="Historial">
          {(historial ?? []).length === 0 ? <Vacio titulo="Sin movimientos" /> : (
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos" data-cuadro="historial-reclamo">
                <thead><tr><th>Fecha</th><th>Cambio</th><th>Usuario</th></tr></thead>
                <tbody>
                  {(historial ?? []).map((h) => (
                    <tr key={h.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{fechaHora(h.creado_en)}</td>
                      <td>
                        {h.estado_nuevo && <strong>{h.estado_anterior ? `${ESTADOS_RECLAMO[h.estado_anterior] ?? h.estado_anterior} → ` : ''}{ESTADOS_RECLAMO[h.estado_nuevo] ?? h.estado_nuevo}</strong>}
                        {h.estado_nuevo && h.nota && <br />}
                        {h.nota}
                      </td>
                      <td>{h.usuario_nombre}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel titulo="Correos de este reclamo" acciones={<Link href="/correos" className="enlace-ficha">Todos los correos</Link>}>
          {(correos ?? []).length === 0 ? <Vacio titulo="Sin correos" mensaje="Los avisos al cliente y a Calidad aparecen aquí." /> : (
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos" data-cuadro="correos-reclamo">
                <thead><tr><th>Fecha</th><th>Correo</th><th>Estado</th></tr></thead>
                <tbody>
                  {(correos ?? []).map((c) => (
                    <tr key={c.id}>
                      <td className="mono" style={{ whiteSpace: 'nowrap', fontSize: '.8rem' }}>{fechaHora(c.creado_en)}</td>
                      <td style={{ minWidth: '16rem' }}>
                        {c.asunto}
                        <br /><small style={{ color: 'var(--tinta-3)', overflowWrap: 'anywhere' }}>Para: {(c.para as string[]).join(', ')}</small>
                      </td>
                      <td>
                        <Etiqueta texto={c.estado === 'enviado' ? 'Enviado' : c.estado === 'simulado' ? 'Simulado' : 'Error'}
                                  tono={c.estado === 'enviado' ? 'ok' : c.estado === 'simulado' ? 'atencion' : 'critico'} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
