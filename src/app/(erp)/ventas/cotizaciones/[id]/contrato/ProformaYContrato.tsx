'use client';

/**
 * Genera la proforma de la cotización aprobada y lleva directo a su contrato.
 * 082 · Con el N.º de proforma propuesto por el sistema, que se puede cambiar.
 */
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { convertirEnPedido } from '../../acciones';
import { CampoNumeroProforma, usePropuestaProforma } from '@/components/ventas/CampoNumeroProforma';
import { problemaNumeroProforma } from '@/lib/numeroProforma';
import { accionSegura } from '@/lib/accionSegura';

export function ProformaYContrato({ cotizacionId }: { cotizacionId: number }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();
  const numero = usePropuestaProforma();
  const { pedir } = numero;
  useEffect(() => { void pedir(); }, [pedir]);

  return (
    <div>
      <div style={{ maxWidth: '22rem', marginBottom: '.6rem' }}>
        <CampoNumeroProforma valor={numero.valor} onChange={numero.setValor} propuesto={numero.propuesto}
                             disabled={pendiente || !numero.propuesto} />
      </div>
      <button type="button" className="btn btn-primario" data-accion="proforma-y-contrato"
              disabled={pendiente || !numero.propuesto || !!problemaNumeroProforma(numero.valor)}
              onClick={() => iniciar(async () => {
                setError(null);
                const r = await accionSegura(() => convertirEnPedido(cotizacionId, numero.valor, numero.propuesto));
                if (r.ok) router.push(`/ventas/pedidos/${r.id}/contrato`);
                else setError(r.mensaje);
              })}>
        {pendiente ? 'Generando la proforma…' : 'Generar la proforma y preparar el contrato'}
      </button>
      {(error || numero.error) && <p role="alert" className="form-mensaje error">{error ?? numero.error}</p>}
    </div>
  );
}
