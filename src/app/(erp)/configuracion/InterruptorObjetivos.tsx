'use client';

/**
 * ============================================================================
 *  QUIÉN VE OBJETIVOS MENSUALES
 * ============================================================================
 *  Oliver: «que solo lo pueda visualizar Marco y mi persona». Es un permiso
 *  de PERSONA, no de rol, y solo lo da o lo quita alguien que ya lo tiene
 *  (la base lo impone: migración 060). Por eso esta columna ni siquiera se
 *  enseña a los demás.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { alternarAccesoObjetivos } from '../objetivos/acciones';

export function InterruptorObjetivos({ id, nombre, ve }: { id: string; nombre: string; ve: boolean }) {
  const [valor, setValor] = useState(ve);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  function alternar() {
    setError(null);
    if (!valor && !window.confirm(`${nombre} podrá ver y cambiar Objetivos mensuales, incluidas sus metas. ¿Continuar?`)) return;
    iniciar(async () => {
      const r = await alternarAccesoObjetivos(id, !valor);
      if (r.ok) setValor(!valor);
      else setError(r.mensaje);
    });
  }

  return (
    <>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', fontSize: '.74rem', cursor: 'pointer' }}>
        <input type="checkbox" checked={valor} disabled={pendiente} onChange={alternar} data-objetivos={id} />
        <span>{valor ? 'Ve objetivos' : '—'}</span>
      </label>
      {error && <p style={{ margin: '.2rem 0 0', fontSize: '.7rem', color: 'var(--critico)' }}>{error}</p>}
    </>
  );
}
