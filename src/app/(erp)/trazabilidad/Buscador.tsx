'use client';

/**
 * ============================================================================
 *  CAJA DE BÚSQUEDA DE TRAZABILIDAD
 * ============================================================================
 *  Componente pequeño y con un solo trabajo: recoger lo que escribe el usuario
 *  y llevarlo a la dirección web, para que el servidor haga la búsqueda contra
 *  la base de datos.
 *
 *  Se validan dos cosas antes de buscar:
 *   · Que haya al menos 2 caracteres (con uno solo, la búsqueda devolvería
 *     medio sistema y sería inútil).
 *   · Que no sea solo espacios en blanco.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icono } from '@/components/estructura/Icono';

export function BuscadorTrazabilidad({ valorInicial = '' }: { valorInicial?: string }) {
  const router = useRouter();
  const [texto, setTexto] = useState(valorInicial);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  function buscar(e: React.FormEvent) {
    e.preventDefault();
    const q = texto.trim();

    if (q.length === 0) {
      setAviso('Escriba un código para buscar: un pallet, una proforma, un contenedor, una guía o un cliente.');
      return;
    }
    if (q.length < 2) {
      setAviso('Necesita al menos 2 caracteres. Con uno solo la búsqueda devolvería demasiados resultados.');
      return;
    }

    setAviso(null);
    iniciar(() => router.push(`/trazabilidad?q=${encodeURIComponent(q)}`));
  }

  return (
    <form className="buscador-traza panel" onSubmit={buscar} role="search">
      <div className="buscador-traza-fila">
        <Icono nombre="buscar" tamano={18} className="buscador-traza-lupa" />
        <input
          type="search"
          className="buscador-traza-input"
          value={texto}
          onChange={(e) => { setTexto(e.target.value); if (aviso) setAviso(null); }}
          placeholder="Pallet, proforma, contenedor, guía, factura o cliente…"
          aria-label="Buscar en todo el sistema"
          aria-invalid={aviso ? 'true' : 'false'}
          autoFocus={!valorInicial}
        />
        <button type="submit" className="btn btn-primario" disabled={pendiente}>
          {pendiente ? 'Buscando…' : 'Buscar'}
        </button>
      </div>

      {aviso && <p className="buscador-traza-aviso" role="alert">{aviso}</p>}

      <style jsx>{`
        .buscador-traza {
          padding: 0.85rem 1rem;
          margin-bottom: 0.85rem;
        }
        .buscador-traza-fila {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          position: relative;
        }
        .buscador-traza-fila :global(.buscador-traza-lupa) {
          position: absolute;
          inset-inline-start: 0.7rem;
          color: var(--tinta-3);
          pointer-events: none;
        }
        .buscador-traza-input {
          flex: 1;
          min-width: 0;
          background: var(--superficie-2);
          border: 1px solid var(--linea);
          border-radius: var(--radio);
          padding: 0.55rem 0.75rem 0.55rem 2.25rem;
          font-size: 0.92rem;
          font-family: var(--font-mono);
          color: var(--tinta);
        }
        .buscador-traza-input:focus {
          outline: none;
          background: var(--superficie);
          border-color: var(--acento-2);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--acento-2) 16%, transparent);
        }
        .buscador-traza-input[aria-invalid='true'] {
          border-color: var(--critico);
        }
        .buscador-traza-aviso {
          margin: 0.55rem 0 0;
          font-size: 0.8rem;
          color: var(--critico);
        }
      `}</style>
    </form>
  );
}
