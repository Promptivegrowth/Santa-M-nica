'use client';

/**
 * El contrato armado con los datos de la cotización, para revisarlo y, si
 * hace falta, corregirlo antes de generarlo. Lo que se genera es exactamente
 * lo que se ve aquí.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { generarContrato, guardarPlantillaContrato } from './acciones';

export function EditorContrato({
  cotizacionId, titulo, cuerpo, sinResolver,
}: {
  cotizacionId: number;
  titulo: string;
  cuerpo: string;
  sinResolver: string[];
}) {
  const router = useRouter();
  const [t, setT] = useState(titulo);
  const [c, setC] = useState(cuerpo);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [guardando, iniciar] = useTransition();

  return (
    <div className="contrato-editor" data-bloque="contrato-editor">
      {sinResolver.length > 0 && (
        <p className="form-aviso-campo" role="alert">
          La plantilla usa datos que el sistema no conoce: {sinResolver.map((s) => `{{${s}}}`).join(', ')}.
          Complételos a mano en el texto.
        </p>
      )}
      <label className="form-campo">
        <span className="etiqueta">Título</span>
        <input className="campo" name="titulo_contrato" value={t} onChange={(e) => setT(e.target.value)} />
      </label>
      <label className="form-campo">
        <span className="etiqueta">Texto del contrato · revíselo y corrija lo que haga falta</span>
        <textarea className="campo contrato-texto" name="cuerpo_contrato" rows={26} value={c}
                  onChange={(e) => setC(e.target.value)} />
      </label>
      <div className="acciones-fila">
        <button type="button" className="btn btn-primario" disabled={guardando} data-accion="generar-contrato"
                onClick={() => {
                  setAviso(null);
                  iniciar(async () => {
                    const r = await generarContrato(cotizacionId, t, c);
                    setAviso({ ok: r.ok, texto: r.mensaje });
                    if (r.ok) router.refresh();
                  });
                }}>
          {guardando ? 'Generando…' : 'Generar contrato'}
        </button>
        <button type="button" className="btn btn-sutil" disabled={guardando}
                onClick={() => { setT(titulo); setC(cuerpo); setAviso(null); }}>
          Deshacer cambios
        </button>
      </div>
      {aviso && (
        <p role={aviso.ok ? 'status' : 'alert'} className={aviso.ok ? 'form-mensaje ok' : 'form-mensaje error'}>
          {aviso.texto}
        </p>
      )}
    </div>
  );
}

/** La plantilla institucional, solo para Gerencia. */
export function EditorPlantilla({ titulo, cuerpo }: { titulo: string; cuerpo: string }) {
  const router = useRouter();
  const [t, setT] = useState(titulo);
  const [c, setC] = useState(cuerpo);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [guardando, iniciar] = useTransition();

  return (
    <div className="contrato-editor" data-bloque="plantilla-editor">
      <label className="form-campo">
        <span className="etiqueta">Título de la plantilla</span>
        <input className="campo" name="titulo_plantilla" value={t} onChange={(e) => setT(e.target.value)} />
      </label>
      <label className="form-campo">
        <span className="etiqueta">Texto con marcadores</span>
        <textarea className="campo contrato-texto" name="cuerpo_plantilla" rows={18} value={c}
                  onChange={(e) => setC(e.target.value)} />
      </label>
      <div className="acciones-fila">
        <button type="button" className="btn btn-secundario" disabled={guardando}
                onClick={() => {
                  setAviso(null);
                  iniciar(async () => {
                    const r = await guardarPlantillaContrato(t, c);
                    setAviso({ ok: r.ok, texto: r.mensaje });
                    if (r.ok) router.refresh();
                  });
                }}>
          {guardando ? 'Guardando…' : 'Guardar plantilla'}
        </button>
      </div>
      {aviso && (
        <p role={aviso.ok ? 'status' : 'alert'} className={aviso.ok ? 'form-mensaje ok' : 'form-mensaje error'}>
          {aviso.texto}
        </p>
      )}
    </div>
  );
}
