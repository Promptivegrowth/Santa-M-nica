'use client';

/** Genera la proforma de la cotización aprobada y lleva directo a su contrato. */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { convertirEnPedido } from '../../acciones';

export function ProformaYContrato({ cotizacionId }: { cotizacionId: number }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();
  return (
    <div>
      <button type="button" className="btn btn-primario" disabled={pendiente} data-accion="proforma-y-contrato"
              onClick={() => iniciar(async () => {
                setError(null);
                const r = await convertirEnPedido(cotizacionId);
                if (r.ok) router.push(`/ventas/pedidos/${r.id}/contrato`);
                else setError(r.mensaje);
              })}>
        {pendiente ? 'Generando la proforma…' : 'Generar la proforma y preparar el contrato'}
      </button>
      {error && <p role="alert" className="form-mensaje error">{error}</p>}
    </div>
  );
}
