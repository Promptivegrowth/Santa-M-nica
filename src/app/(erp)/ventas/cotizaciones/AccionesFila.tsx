'use client';

/**
 * ============================================================================
 *  ACCIONES SOBRE UNA COTIZACIÓN
 * ============================================================================
 *  El botón que convierte una cotización en pedido. Es la materialización del
 *  principio de reuso: no se vuelve a teclear nada, el pedido hereda cliente,
 *  moneda, incoterm, destino y todas las líneas con sus precios.
 *
 *  Detalles de experiencia:
 *   · Pide confirmación, porque crea un documento en firme.
 *   · Si funciona, lleva directamente al pedido recién creado.
 *   · Si falla, explica por qué y qué hacer (cliente bloqueado, ya convertida…).
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { convertirEnPedido } from './acciones';
import { Icono } from '@/components/estructura/Icono';

export function AccionesFila({
  cotizacionId,
  numero,
  estado,
  yaConvertida,
}: {
  cotizacionId: number;
  numero: string;
  estado: string;
  yaConvertida: boolean;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  if (yaConvertida) {
    return <span className="pill pill-ok">Ya es pedido</span>;
  }

  if (estado === 'rechazada' || estado === 'vencida') {
    return <span style={{ color: 'var(--tinta-3)', fontSize: '.76rem' }}>—</span>;
  }

  function convertir() {
    setError(null);
    iniciar(async () => {
      const r = await convertirEnPedido(cotizacionId);
      if (r.ok) {
        router.push(`/ventas/pedidos/${r.id}`);
      } else {
        setError(r.mensaje);
        setConfirmando(false);
      }
    });
  }

  return (
    <div className="acc-fila">
      {!confirmando ? (
        <button
          type="button"
          className="btn btn-secundario acc-btn"
          onClick={() => setConfirmando(true)}
          title={`Convertir ${numero} en pedido`}
        >
          <Icono nombre="pedido" tamano={14} />
          Convertir
        </button>
      ) : (
        <span className="acc-confirma">
          <button type="button" className="btn btn-primario acc-btn" onClick={convertir} disabled={pendiente}>
            {pendiente ? 'Creando…' : 'Confirmar'}
          </button>
          <button type="button" className="btn btn-sutil acc-btn" onClick={() => setConfirmando(false)} disabled={pendiente}>
            No
          </button>
        </span>
      )}

      {error && <span className="acc-error">{error}</span>}

      <style jsx>{`
        .acc-fila { display: flex; flex-direction: column; gap: 0.3rem; align-items: flex-start; }
        .acc-confirma { display: flex; gap: 0.25rem; align-items: center; }
        .acc-btn { padding: 0.25rem 0.55rem; font-size: 0.75rem; }
        .acc-error {
          font-size: 0.72rem;
          color: var(--critico);
          max-width: 22rem;
          line-height: 1.4;
        }
      `}</style>
    </div>
  );
}
