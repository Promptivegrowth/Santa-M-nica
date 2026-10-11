'use client';

/**
 * Las observaciones del embarque, editables desde su ficha (observaciones de
 * octubre, punto 12). Cada versión queda en el historial del embarque.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { guardarObservacionesEmbarque } from '../acciones';

export function ObservacionesEmbarque({ id, texto, puede }: { id: number; texto: string | null; puede: boolean }) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(texto ?? '');
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [guardando, iniciar] = useTransition();

  if (!editando) {
    return (
      <div data-bloque="observaciones-embarque">
        <p className="observaciones-texto" data-vacio={texto ? 'no' : 'si'}>
          {texto || 'Sin observaciones.'}
        </p>
        {puede && (
          <button type="button" className="btn btn-secundario btn-chico" data-accion="editar-observaciones"
                  onClick={() => { setValor(texto ?? ''); setEditando(true); setAviso(null); }}>
            {texto ? 'Editar observaciones' : 'Agregar observaciones'}
          </button>
        )}
        {aviso && <span role="status" style={{ marginLeft: '.6rem', fontSize: '.75rem', color: aviso.ok ? 'var(--ok)' : 'var(--critico)' }}>{aviso.texto}</span>}
      </div>
    );
  }

  return (
    <div data-bloque="observaciones-embarque" style={{ display: 'grid', gap: '.5rem' }}>
      <textarea className="campo" name="observaciones_embarque" rows={4} maxLength={1000} autoFocus
                placeholder="Coordinaciones, cambios de booking, instrucciones para la carga…"
                value={valor} onChange={(e) => setValor(e.target.value)} />
      <div className="acciones-fila">
        <button type="button" className="btn btn-primario btn-chico" disabled={guardando}
                onClick={() => iniciar(async () => {
                  const r = await guardarObservacionesEmbarque(id, valor);
                  setAviso({ ok: r.ok, texto: r.mensaje });
                  if (r.ok) { setEditando(false); router.refresh(); }
                })}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
        <button type="button" className="btn btn-sutil btn-chico" disabled={guardando} onClick={() => setEditando(false)}>
          Cancelar
        </button>
        <small style={{ color: 'var(--tinta-3)' }}>{valor.length}/1000</small>
      </div>
      {aviso && !aviso.ok && <p role="alert" className="form-mensaje error">{aviso.texto}</p>}
    </div>
  );
}
