/**
 * ============================================================================
 *  LO QUE VE EL CLIENTE · avance de la proforma, contenedores y reclamos
 * ============================================================================
 *  La misma pieza sirve al portal y a «Ver como cliente» del ERP: Comercial
 *  revisa exactamente lo que verá el cliente antes de enviarle los accesos.
 *
 *  Sin despacho, solo existe la proforma: se muestran su avance y productos.
 *  Con contenedores formados, cada uno trae su línea de tiempo y su carga.
 *  Nunca hay importes: los datos vienen de privado.datos_portal, que no lee
 *  ninguna columna de precios.
 * ============================================================================
 */
import './portal.css';
import type { DatosPortal, Hito } from '@/lib/portal/servidor';
import { textos, fechaPortal, type Idioma } from '@/lib/portal/textos';

function numero(n: number, dec: number, idioma: Idioma) {
  return Number(n ?? 0).toLocaleString(idioma === 'en' ? 'en-US' : 'es-PE', {
    minimumFractionDigits: dec, maximumFractionDigits: dec,
  });
}

export function LineaDeTiempo({ hitos, idioma }: { hitos: Hito[]; idioma: Idioma }) {
  const t = textos(idioma);
  return (
    <ol className="pt-linea" style={{ gridTemplateColumns: `repeat(${Math.max(hitos.length, 1)}, 1fr)` }}>
      {hitos.map((h) => (
        <li key={h.clave} className="pt-hito" data-cumplido={h.cumplido ? 'si' : 'no'}>
          <span className="pt-punto" aria-hidden="true" />
          <strong>{h.etiqueta}</strong>
          <small>{h.cumplido ? (fechaPortal(h.fecha, idioma) || '✓') : t.pendiente}</small>
        </li>
      ))}
    </ol>
  );
}

export function VistaPortal({
  datos,
  idioma,
  urlReclamo,
  urlDescarga,
  vistaPrevia = false,
}: {
  datos: DatosPortal;
  idioma: Idioma;
  /** A dónde lleva «Generar reclamo». Sin valor, el botón se muestra apagado. */
  urlReclamo?: string;
  urlDescarga?: (reclamoId: number) => string;
  /** En el ERP: los enlaces del cliente no se activan. */
  vistaPrevia?: boolean;
}) {
  const t = textos(idioma);
  const tieneContenedores = datos.contenedores.length > 0;

  return (
    <div className="pt-vista">
      <section className="pt-tarjeta">
        <div className="pt-cabecera-proforma">
          <div>
            <span className="pt-antetitulo">{t.proforma}</span>
            <h2 className="pt-numero">{datos.numero_proforma}</h2>
            <p className="pt-dato">{datos.cliente} · {datos.cliente_codigo}</p>
          </div>
          <dl className="pt-ficha">
            {datos.destino && <><dt>{t.destino}</dt><dd>{datos.destino}</dd></>}
            {datos.incoterm && <><dt>{t.incoterm}</dt><dd>{datos.incoterm}</dd></>}
            {datos.fecha_comprometida && <><dt>{t.fechaComprometida}</dt><dd>{fechaPortal(datos.fecha_comprometida, idioma)}</dd></>}
          </dl>
        </div>
        {datos.cancelada && <p className="pt-aviso pt-aviso-critico" role="status">{t.cancelada}</p>}

        <div className="pt-subtitulo">
          <h3>{t.avance}</h3>
          {!tieneContenedores && <small>{t.sinContenedores}</small>}
        </div>
        <LineaDeTiempo hitos={datos.hitos} idioma={idioma} />

        {!tieneContenedores && (
          <>
            <h3 className="pt-h3">{t.productos}</h3>
            <div className="pt-tabla-caja">
              <table className="pt-tabla">
                <thead><tr><th>{t.producto}</th><th className="pt-num">{t.cantidad}</th></tr></thead>
                <tbody>
                  {datos.productos.map((p, i) => (
                    <tr key={i}><td>{p.descripcion}</td><td className="pt-num">{numero(p.cantidad_tm, 3, idioma)} TM</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {tieneContenedores && (
        <section className="pt-bloque">
          <h3 className="pt-h3">{t.contenedores}</h3>
          {datos.contenedores.map((c) => (
            <article key={c.id} className="pt-tarjeta pt-contenedor" data-contenedor={c.referencia}>
              <div className="pt-subtitulo">
                <h4>
                  {t.contenedor} {c.referencia}
                  {c.contenedor && <span className="pt-mono"> · {c.contenedor}</span>}
                </h4>
                <small>
                  {c.precinto && <>{t.precinto} {c.precinto} · </>}
                  {numero(c.bultos, 0, idioma)} {t.bultos.toLowerCase()} · {numero(c.tm, 3, idioma)} TM
                  {c.reclamos_pendientes > 0 && <> · <span className="pt-alerta">{t.reclamosPendientes(c.reclamos_pendientes)}</span></>}
                </small>
              </div>
              <LineaDeTiempo hitos={c.hitos} idioma={idioma} />
              {c.productos.length > 0 && (
                <div className="pt-tabla-caja">
                  <table className="pt-tabla">
                    <thead><tr><th>{t.producto}</th><th className="pt-num">{t.bultos}</th><th className="pt-num">kg</th></tr></thead>
                    <tbody>
                      {c.productos.map((p, i) => (
                        <tr key={i}>
                          <td>{p.descripcion}</td>
                          <td className="pt-num">{numero(p.bultos, 0, idioma)}</td>
                          <td className="pt-num">{numero(p.kg, 1, idioma)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </article>
          ))}
          <p className="pt-leyenda">{t.leyenda}</p>
        </section>
      )}

      <section className="pt-tarjeta" id="reclamos">
        <div className="pt-subtitulo">
          <h3>{t.reclamos}</h3>
          {urlReclamo && !vistaPrevia && !datos.cancelada ? (
            <a href={urlReclamo} className="pt-btn pt-btn-primario" data-accion="generar-reclamo">{t.generarReclamo}</a>
          ) : (
            <span className="pt-btn pt-btn-apagado" aria-disabled="true">{t.generarReclamo}</span>
          )}
        </div>
        {datos.reclamos.length === 0 ? (
          <p className="pt-vacio">{t.sinReclamos}</p>
        ) : (
          <ul className="pt-reclamos">
            {datos.reclamos.map((r) => (
              <li key={r.id} className="pt-reclamo" data-reclamo={r.numero}>
                <div className="pt-reclamo-cab">
                  <strong className="pt-mono">{r.numero}</strong>
                  <span className="pt-estado" data-estado={r.estado}>{t.estados[r.estado] ?? r.estado}</span>
                </div>
                <p className="pt-dato">
                  {r.motivo}{r.contenedor && <> · {t.contenedor} {r.contenedor}</>} · {fechaPortal(r.creado_en, idioma)}
                </p>
                <ol className="pt-linea pt-linea-chica" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                  {['pendiente', 'en_revision', 'en_investigacion', 'cerrado'].map((e) => {
                    const paso = r.historial.filter((h) => h.estado === e).pop();
                    const orden = ['pendiente', 'en_revision', 'en_investigacion', 'cerrado'];
                    const cumplido = !!paso || orden.indexOf(e) <= orden.indexOf(r.estado);
                    return (
                      <li key={e} className="pt-hito" data-cumplido={cumplido ? 'si' : 'no'}>
                        <span className="pt-punto" aria-hidden="true" />
                        <strong>{t.estados[e]}</strong>
                        <small>{paso ? fechaPortal(paso.fecha, idioma) : cumplido ? '✓' : t.pendiente}</small>
                      </li>
                    );
                  })}
                </ol>
                {r.conclusion && <p className="pt-conclusion"><strong>{t.conclusion}:</strong> {r.conclusion}</p>}
                {r.estado === 'cerrado' && (
                  r.descargable && urlDescarga && !vistaPrevia
                    ? <a className="pt-btn pt-btn-secundario" href={urlDescarga(r.id)} data-accion="descargar-pdf">{t.descargarPdf}</a>
                    : r.descargable ? <span className="pt-btn pt-btn-apagado">{t.descargarPdf}</span>
                    : <small className="pt-dato">{t.pdfVencido}</small>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
