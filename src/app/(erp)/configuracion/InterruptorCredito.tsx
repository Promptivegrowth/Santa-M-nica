'use client';

/**
 * ============================================================================
 *  QUIÉN FIJA LA LÍNEA DE CRÉDITO DE LOS CLIENTES
 * ============================================================================
 *  Permiso de persona (081), como «Carga costos»: pedido de Oliver Tello, la
 *  línea de crédito la llena solo Cathy Lee. Lo cambia solo Gerencia; a los
 *  demás se les enseña el valor, sin casilla. La base lo impone también
 *  (usuarios_proteger_permisos y clientes_proteger_credito).
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { alternarFijaCredito } from './acciones';
import { accionSegura } from '@/lib/accionSegura';

export function InterruptorCredito({ id, fija, editable }: { id: string; fija: boolean; editable: boolean }) {
  const [valor, setValor] = useState(fija);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  if (!editable) {
    return (
      <span style={{ fontSize: '.74rem', color: 'var(--tinta-3)' }} title="Solo Gerencia da o quita este permiso.">
        {valor ? 'Sí' : '—'}
      </span>
    );
  }
  return (
    <>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', fontSize: '.74rem', cursor: 'pointer' }}>
        <input type="checkbox" checked={valor} disabled={pendiente} data-credito={id}
               onChange={() => {
                 setError(null);
                 iniciar(async () => {
                   const r = await accionSegura(() => alternarFijaCredito(id, !valor));
                   if (r.ok) setValor(!valor); else setError(r.mensaje);
                 });
               }} />
        <span>{valor ? 'Línea de crédito' : '—'}</span>
      </label>
      {error && <p style={{ margin: '.2rem 0 0', fontSize: '.7rem', color: 'var(--critico)' }}>{error}</p>}
    </>
  );
}
