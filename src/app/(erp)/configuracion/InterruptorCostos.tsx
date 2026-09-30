'use client';

/**
 * ============================================================================
 *  QUIÉN CARGA COSTOS DE PRODUCCIÓN
 * ============================================================================
 *  Permiso de persona (062): hoy Marco y Oliver. Lo cambia solo Gerencia; a
 *  los demás se les enseña el valor, sin casilla.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { alternarCargaCostos } from './acciones';

export function InterruptorCostos({ id, carga, editable }: { id: string; carga: boolean; editable: boolean }) {
  const [valor, setValor] = useState(carga);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  if (!editable) {
    return <span style={{ fontSize: '.74rem', color: 'var(--tinta-3)' }}>{valor ? 'Sí' : '—'}</span>;
  }
  return (
    <>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', fontSize: '.74rem', cursor: 'pointer' }}>
        <input type="checkbox" checked={valor} disabled={pendiente} data-costos={id}
               onChange={() => {
                 setError(null);
                 iniciar(async () => {
                   const r = await alternarCargaCostos(id, !valor);
                   if (r.ok) setValor(!valor); else setError(r.mensaje);
                 });
               }} />
        <span>{valor ? 'Carga costos' : '—'}</span>
      </label>
      {error && <p style={{ margin: '.2rem 0 0', fontSize: '.7rem', color: 'var(--critico)' }}>{error}</p>}
    </>
  );
}
