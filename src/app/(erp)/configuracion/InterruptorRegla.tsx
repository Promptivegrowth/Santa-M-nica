'use client';

/**
 * Interruptor para activar o desactivar una regla del motor de alertas.
 * El cambio se guarda de inmediato en el servidor.
 */
import { useState, useTransition } from 'react';
import { alternarRegla } from './acciones';

export function InterruptorRegla({ id, activaInicial }: { id: number; activaInicial: boolean }) {
  const [activa, setActiva] = useState(activaInicial);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  function alternar() {
    const nuevo = !activa;
    setActiva(nuevo);
    setError(null);
    iniciar(async () => {
      const r = await alternarRegla(id, nuevo);
      if (!r.ok) {
        setActiva(!nuevo); // se revierte si el servidor la rechazó
        setError(r.mensaje);
      }
    });
  }

  return (
    <div className="interruptor-caja">
      <button
        type="button"
        className="interruptor"
        role="switch"
        aria-checked={activa}
        aria-label={activa ? 'Desactivar la regla' : 'Activar la regla'}
        onClick={alternar}
        disabled={pendiente}
        data-activa={activa ? 'si' : 'no'}
      >
        <span className="interruptor-bolita" />
      </button>
      <span className="interruptor-texto">{activa ? 'Activa' : 'Inactiva'}</span>
      {error && <span className="interruptor-error">{error}</span>}

      <style jsx>{`
        .interruptor-caja { display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap; }
        .interruptor {
          width: 2.1rem; height: 1.15rem; border-radius: 999px;
          border: 1px solid var(--linea-2); background: var(--superficie-3);
          padding: 2px; cursor: pointer; flex: none;
          transition: background 0.15s ease, border-color 0.15s ease;
          display: flex; align-items: center;
        }
        .interruptor[data-activa='si'] {
          background: var(--color-marca-500);
          border-color: var(--color-marca-700);
          justify-content: flex-end;
        }
        .interruptor:disabled { opacity: 0.6; cursor: wait; }
        .interruptor-bolita {
          width: 0.85rem; height: 0.85rem; border-radius: 50%;
          background: #fff; display: block;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
        }
        .interruptor-texto { font-size: 0.76rem; color: var(--tinta-2); }
        .interruptor-error {
          font-size: 0.7rem; color: var(--critico);
          flex-basis: 100%; line-height: 1.35;
        }
      `}</style>
    </div>
  );
}
