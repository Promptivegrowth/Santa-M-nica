'use client';

/**
 * ============================================================================
 *  EDITOR DE UN PARÁMETRO
 * ============================================================================
 *  Campo editable con guardado inmediato y confirmación visible.
 *
 *  Detalles de experiencia que importan en un ERP:
 *   · No se guarda hasta que el usuario sale del campo o pulsa Enter, para no
 *     escribir en la base con cada tecla.
 *   · Si el valor no cambió, no se hace nada.
 *   · El mensaje de error dice qué pasó Y qué hacer al respecto.
 *   · La confirmación desaparece sola a los pocos segundos.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { guardarParametro } from './acciones';

export function EditorParametro({
  clave,
  valorInicial,
  tipo,
  unidad,
  editable,
}: {
  clave: string;
  valorInicial: string;
  tipo: string;
  unidad?: string | null;
  editable: boolean;
}) {
  const [valor, setValor] = useState(valorInicial);
  const [estado, setEstado] = useState<{ ok: boolean; mensaje: string } | null>(null);
  const [pendiente, iniciar] = useTransition();

  function guardar() {
    if (valor.trim() === valorInicial.trim()) return; // nada cambió
    iniciar(async () => {
      const r = await guardarParametro(clave, valor);
      setEstado(r);
      if (r.ok) {
        setTimeout(() => setEstado(null), 3500);
      } else {
        setValor(valorInicial); // se revierte para no dejar un valor falso en pantalla
      }
    });
  }

  if (!editable) {
    return (
      <div className="param-editor">
        <span className="param-solo-lectura">
          {valorInicial}{unidad ? ` ${unidad}` : ''}
        </span>
        <span className="param-nota">Solo Gerencia puede cambiarlo</span>
      </div>
    );
  }

  return (
    <div className="param-editor">
      <div className="param-fila">
        <input
          className="campo param-campo"
          type={tipo === 'numero' ? 'number' : 'text'}
          value={valor}
          disabled={pendiente}
          aria-invalid={estado && !estado.ok ? 'true' : 'false'}
          onChange={(e) => { setValor(e.target.value); if (estado) setEstado(null); }}
          onBlur={guardar}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
        {unidad && <span className="param-unidad">{unidad}</span>}
        {pendiente && <span className="param-nota">Guardando…</span>}
      </div>

      {estado && (
        <p className={estado.ok ? 'param-ok' : 'param-error'} role="status">
          {estado.mensaje}
        </p>
      )}

      <style jsx>{`
        .param-fila { display: flex; align-items: center; gap: 0.4rem; }
        .param-campo { max-width: 9rem; padding: 0.32rem 0.5rem; font-size: 0.84rem; }
        .param-unidad {
          font-family: var(--font-mono);
          font-size: 0.68rem;
          color: var(--tinta-3);
        }
        .param-ok {
          margin: 0.3rem 0 0;
          font-size: 0.74rem;
          color: var(--ok);
        }
        .param-error {
          margin: 0.3rem 0 0;
          font-size: 0.74rem;
          color: var(--critico);
          max-width: 30rem;
          line-height: 1.4;
        }
      `}</style>
    </div>
  );
}
