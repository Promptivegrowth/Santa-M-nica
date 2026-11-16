'use client';

/**
 * ============================================================================
 *  «ENVIAR POR CORREO» · la proforma o la cotización desde comex@ (M7)
 * ============================================================================
 *  Destinatarios tomados de los contactos del cliente, copia al vendedor y
 *  un mensaje que se puede corregir antes de enviar. Adjunta el mismo PDF que
 *  se descarga: si sus importes no cuadran, no sale (y se dice por qué).
 * ============================================================================
 */
import { useState, useTransition, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Icono } from '@/components/estructura/Icono';
import { accionSegura } from '@/lib/accionSegura';
import { prepararEnvioDocumento, enviarDocumentoPorCorreo, type BorradorEnvio } from '@/app/(erp)/ventas/accionesCorreo';
import { VentanaCorreo, AvisoEnvio } from './VentanaCorreo';

type Aviso = { ok: boolean; texto: string; estado?: string } | null;

export function EnviarPorCorreo({
  tipo,
  id,
  numero,
}: {
  tipo: 'proforma' | 'cotizacion';
  id: number;
  numero: string;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [borrador, setBorrador] = useState<BorradorEnvio | null>(null);
  const [para, setPara] = useState('');
  const [cc, setCc] = useState('');
  const [asunto, setAsunto] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [aviso, setAviso] = useState<Aviso>(null);
  const [ocupado, iniciar] = useTransition();
  const cerrar = useCallback(() => setAbierto(false), []);

  function cargar(idioma?: string) {
    setAviso(null);
    iniciar(async () => {
      const r = await accionSegura(() => prepararEnvioDocumento(tipo, id, idioma));
      if (!r.ok) { setAviso({ ok: false, texto: 'mensaje' in r ? r.mensaje : 'No se pudo preparar el correo.' }); return; }
      const b = r.borrador;
      setBorrador(b);
      //  Al cambiar de idioma se respeta lo que ya se escribió en los destinatarios.
      if (!idioma) { setPara(b.para.join(', ')); setCc(b.cc.join(', ')); }
      setAsunto(b.asunto);
      setMensaje(b.mensaje);
    });
  }

  function enviar() {
    setAviso(null);
    iniciar(async () => {
      const r = await accionSegura(() => enviarDocumentoPorCorreo(tipo, id, { para, cc, asunto, mensaje }));
      setAviso({ ok: r.ok, texto: r.mensaje, estado: 'estado' in r ? r.estado : undefined });
      if (r.ok) router.refresh();
    });
  }

  const nombreDoc = tipo === 'proforma' ? 'la proforma' : 'la cotización';

  return (
    <>
      <button
        type="button"
        className="btn btn-secundario"
        data-accion={`enviar-${tipo}`}
        title={`Enviar ${nombreDoc} en PDF por correo, desde comex@`}
        onClick={() => { setAbierto(true); setBorrador(null); cargar(); }}
      >
        <Icono nombre="correo" tamano={15} />
        Enviar por correo
      </button>

      {abierto && (
        <VentanaCorreo titulo={`Enviar ${nombreDoc} ${numero} por correo`} alCerrar={cerrar}>
          {!borrador ? (
            <>
              <p style={{ color: 'var(--tinta-3)', margin: 0 }}>{ocupado ? 'Preparando el correo…' : ''}</p>
              <AvisoEnvio aviso={aviso} />
            </>
          ) : (
            <div className="form-rejilla" style={{ padding: 0 }}>
              <label className="form-campo form-ancho">
                <span>Para</span>
                <input className="campo" value={para} onChange={(e) => setPara(e.target.value)}
                       placeholder="correo@cliente.com, otro@cliente.com" data-campo="para" />
                {borrador.sugeridos.length > 0 && (
                  <small className="form-nota-cab">Contactos del cliente: {borrador.sugeridos.join(' · ')}</small>
                )}
              </label>
              <label className="form-campo form-ancho">
                <span>Copia (vendedor)</span>
                <input className="campo" value={cc} onChange={(e) => setCc(e.target.value)} data-campo="cc" />
              </label>
              <label className="form-campo">
                <span>Idioma del mensaje</span>
                <select className="campo" value={borrador.idioma} disabled={ocupado}
                        onChange={(e) => cargar(e.target.value)}>
                  <option value="es">Español</option>
                  <option value="en">English</option>
                </select>
              </label>
              <label className="form-campo">
                <span>Remitente</span>
                <input className="campo" value="comex@santamonicafishing.com" readOnly />
              </label>
              <label className="form-campo form-ancho">
                <span>Asunto</span>
                <input className="campo" value={asunto} onChange={(e) => setAsunto(e.target.value)} data-campo="asunto" />
              </label>
              <label className="form-campo form-ancho">
                <span>Mensaje</span>
                <textarea className="campo" rows={8} value={mensaje} onChange={(e) => setMensaje(e.target.value)} data-campo="mensaje" />
                <small className="form-nota-cab">Se adjunta el PDF de {nombreDoc} {numero}, el mismo que se descarga.</small>
              </label>
              <div className="form-ancho">
                <AvisoEnvio aviso={aviso} />
                <div style={{ display: 'flex', gap: '.5rem', marginTop: '.6rem' }}>
                  <button type="button" className="btn btn-primario" onClick={enviar} disabled={ocupado} data-accion="confirmar-envio">
                    {ocupado ? 'Enviando…' : 'Enviar'}
                  </button>
                  <button type="button" className="btn btn-sutil" onClick={cerrar} disabled={ocupado}>
                    {aviso?.ok ? 'Cerrar' : 'Cancelar'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </VentanaCorreo>
      )}
    </>
  );
}
