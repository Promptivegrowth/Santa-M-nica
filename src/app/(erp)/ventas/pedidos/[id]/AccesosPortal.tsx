'use client';

/**
 * ============================================================================
 *  «ENVIAR ACCESOS» Y «REGENERAR LLAVE» · pestaña Portal del cliente (M1)
 * ============================================================================
 *  La vista previa muestra el correo tal como saldrá, pero con la Llave y la
 *  contraseña enmascaradas: las reales solo viajan en el correo al cliente.
 *  Regenerar la llave es de Gerencia y pide el motivo (queda en el historial).
 * ============================================================================
 */
import { useState, useTransition, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Icono } from '@/components/estructura/Icono';
import { accionSegura } from '@/lib/accionSegura';
import { vistaPreviaAccesos, enviarAccesos, regenerarLlave, textoAccesosWhatsapp } from '../../accionesCorreo';
import { VentanaCorreo, AvisoEnvio } from '@/components/ventas/VentanaCorreo';

type Aviso = { ok: boolean; texto: string; estado?: string } | null;

export function EnviarAccesos({
  pedidoId,
  numero,
  destinatarios,
  idiomaSugerido,
  yaEnviado,
}: {
  pedidoId: number;
  numero: string;
  destinatarios: string[];
  idiomaSugerido: 'es' | 'en';
  yaEnviado: boolean;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [para, setPara] = useState(destinatarios.join(', '));
  const [idioma, setIdioma] = useState<'es' | 'en'>(idiomaSugerido);
  const [vista, setVista] = useState<{ asunto: string; texto: string } | null>(null);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [copiado, setCopiado] = useState<{ texto: string; enPortapapeles: boolean } | null>(null);
  const [ocupado, iniciar] = useTransition();
  const cerrar = useCallback(() => { setAbierto(false); setCopiado(null); }, []);

  function previa(i: 'es' | 'en') {
    setIdioma(i);
    iniciar(async () => {
      const r = await accionSegura(() => vistaPreviaAccesos(pedidoId, i));
      if (r.ok && 'asunto' in r) setVista({ asunto: r.asunto, texto: r.texto });
      else setAviso({ ok: false, texto: 'mensaje' in r ? r.mensaje : 'No se pudo preparar el correo.' });
    });
  }

  /** El mensaje con la llave y la contraseña reales, al portapapeles, para WhatsApp. */
  function copiarWhatsapp() {
    setAviso(null);
    setCopiado(null);
    iniciar(async () => {
      const r = await accionSegura(() => textoAccesosWhatsapp(pedidoId, idioma));
      if (!r.ok || !('texto' in r)) {
        setAviso({ ok: false, texto: 'mensaje' in r ? r.mensaje : 'No se pudo preparar el mensaje.' });
        return;
      }
      let enPortapapeles = false;
      try {
        await navigator.clipboard.writeText(r.texto);
        enPortapapeles = true;
      } catch {
        // Sin permiso de portapapeles (o página sin HTTPS): se muestra el texto para copiarlo a mano.
      }
      setCopiado({ texto: r.texto, enPortapapeles });
    });
  }

  function enviar() {
    setAviso(null);
    iniciar(async () => {
      const r = await accionSegura(() => enviarAccesos(pedidoId, para.split(/[,;\s]+/), idioma));
      setAviso({ ok: r.ok, texto: r.mensaje, estado: 'estado' in r ? r.estado : undefined });
      if (r.ok) router.refresh();
    });
  }

  return (
    <>
      <button type="button" className="btn btn-primario" data-accion="enviar-accesos"
              onClick={() => { setAbierto(true); setAviso(null); previa(idioma); }}>
        <Icono nombre="correo" tamano={15} />
        {yaEnviado ? 'Reenviar accesos' : 'Enviar accesos'}
      </button>

      {abierto && (
        <VentanaCorreo titulo={`Accesos al portal · ${numero}`} alCerrar={cerrar}>
          <div className="form-rejilla" style={{ padding: 0 }}>
            <label className="form-campo form-ancho">
              <span>Para (representante del cliente)</span>
              <input className="campo" value={para} onChange={(e) => setPara(e.target.value)}
                     placeholder="representante@cliente.com" data-campo="para-accesos" />
            </label>
            <label className="form-campo">
              <span>Idioma</span>
              <select className="campo" value={idioma} disabled={ocupado}
                      onChange={(e) => previa(e.target.value === 'en' ? 'en' : 'es')}>
                <option value="es">Español</option>
                <option value="en">English</option>
              </select>
            </label>
            <label className="form-campo">
              <span>Remitente</span>
              <input className="campo" value="comex@santamonicafishing.com" readOnly />
            </label>
            <div className="form-campo form-ancho">
              <span>Vista previa</span>
              {vista ? (
                <div style={{ border: '1px solid var(--linea)', borderRadius: 'var(--radio)', padding: '.75rem', background: 'var(--superficie-2)' }}
                     data-bloque="vista-previa-accesos">
                  <strong style={{ display: 'block', marginBottom: '.5rem' }}>{vista.asunto}</strong>
                  <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0, fontSize: '.85rem' }}>{vista.texto}</pre>
                </div>
              ) : (
                <small className="form-nota-cab">{ocupado ? 'Preparando la vista previa…' : ''}</small>
              )}
              <small className="form-nota-cab">
                La llave de seguimiento y la contraseña se ven ocultas aquí y en el registro: completas, solo viajan en el
                correo al cliente o en el mensaje que copie para WhatsApp.
              </small>
            </div>
            {copiado && (
              <div className="form-campo form-ancho" data-bloque="accesos-copiados">
                <span>
                  {copiado.enPortapapeles
                    ? 'Mensaje copiado con la llave y la contraseña completas. Péguelo en el chat del cliente.'
                    : 'El navegador no dejó copiar solo: seleccione el texto (Ctrl+A) y cópielo (Ctrl+C).'}
                </span>
                {!copiado.enPortapapeles && (
                  <textarea className="campo" readOnly rows={8} value={copiado.texto}
                            onFocus={(e) => e.currentTarget.select()} style={{ fontFamily: 'inherit', fontSize: '.85rem' }} />
                )}
                <span style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginTop: '.3rem' }}>
                  <a className="btn btn-sutil" target="_blank" rel="noopener noreferrer"
                     href={`https://wa.me/?text=${encodeURIComponent(copiado.texto)}`} data-accion="abrir-whatsapp">
                    <Icono nombre="mensaje" tamano={15} /> Abrir WhatsApp con el mensaje
                  </a>
                </span>
              </div>
            )}
            <div className="form-ancho">
              <AvisoEnvio aviso={aviso} />
              <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginTop: '.6rem' }}>
                <button type="button" className="btn btn-primario" onClick={enviar} disabled={ocupado || !vista}
                        data-accion="confirmar-accesos">
                  {ocupado ? 'Un momento…' : 'Enviar desde comex@'}
                </button>
                <button type="button" className="btn btn-secundario" onClick={copiarWhatsapp} disabled={ocupado || !vista}
                        data-accion="copiar-accesos">
                  <Icono nombre={copiado?.enPortapapeles ? 'listo' : 'copiar'} tamano={15} />
                  {copiado?.enPortapapeles ? 'Copiado' : 'Copiar para WhatsApp'}
                </button>
                <button type="button" className="btn btn-sutil" onClick={cerrar} disabled={ocupado}>
                  {aviso?.ok ? 'Cerrar' : 'Cancelar'}
                </button>
              </div>
            </div>
          </div>
        </VentanaCorreo>
      )}
    </>
  );
}

export function RegenerarLlave({ pedidoId }: { pedidoId: number }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [aviso, setAviso] = useState<Aviso>(null);
  const [ocupado, iniciar] = useTransition();

  function regenerar() {
    setAviso(null);
    iniciar(async () => {
      const r = await accionSegura(() => regenerarLlave(pedidoId, motivo));
      setAviso({ ok: r.ok, texto: r.mensaje });
      if (r.ok) { setAbierto(false); setMotivo(''); router.refresh(); }
    });
  }

  if (!abierto) {
    return (
      <span>
        <button type="button" className="btn btn-sutil" data-accion="regenerar-llave" onClick={() => setAbierto(true)}>
          Regenerar llave
        </button>
        <AvisoEnvio aviso={aviso} />
      </span>
    );
  }
  return (
    <div className="form-campo" style={{ maxWidth: '32rem' }} data-bloque="regenerar-llave">
      <span>¿Por qué se regenera? La llave actual deja de servir y hay que reenviar los accesos.</span>
      <input className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)}
             placeholder="Se compartió por error con otra empresa" maxLength={200} />
      <AvisoEnvio aviso={aviso} />
      <span style={{ display: 'flex', gap: '.5rem', marginTop: '.4rem' }}>
        <button type="button" className="btn btn-peligro" onClick={regenerar} disabled={ocupado || motivo.trim().length < 5}>
          {ocupado ? 'Regenerando…' : 'Regenerar'}
        </button>
        <button type="button" className="btn btn-sutil" onClick={() => setAbierto(false)} disabled={ocupado}>Cancelar</button>
      </span>
    </div>
  );
}
