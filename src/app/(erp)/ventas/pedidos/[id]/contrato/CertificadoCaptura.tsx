'use client';

/**
 * ============================================================================
 *  ¿LLEVA CERTIFICADO DE CAPTURA? (083, punto 05 de Oliver)
 * ============================================================================
 *  Todos los documentos de la proforma son obligatorios salvo el certificado
 *  de captura, que tiene un costo adicional y se negocia en cada cotización.
 *  El pedido nace con lo que dijo la cotización; aquí se corrige si cambió.
 *  Lo lee la proforma (CATCH CERTIFICATE) y el contrato (documento F).
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { accionSegura } from '@/lib/accionSegura';
import { cambiarCertificadoCaptura } from './acciones';

export function CertificadoCaptura({
  pedidoId, lleva, decidido, origen, puede, motivoNo,
}: {
  pedidoId: number;
  /** Lo que sale hoy en la proforma. */
  lleva: boolean;
  /** false = pedido anterior a la 083, sin decidir: se aplica la regla de la Unión Europea. */
  decidido: boolean;
  /** De dónde viene: «se negoció en la cotización COT-…» o «se registró con el pedido». */
  origen: string;
  puede: boolean;
  motivoNo: string;
}) {
  const router = useRouter();
  const [valor, setValor] = useState(lleva);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [guardando, iniciar] = useTransition();

  return (
    <div data-bloque="certificado-captura">
      <label style={{ display: 'flex', gap: '.55rem', alignItems: 'flex-start', cursor: puede ? 'pointer' : 'not-allowed' }}
             title={puede ? undefined : motivoNo}>
        <input
          type="checkbox" name="certificado_captura" checked={valor} disabled={!puede || guardando}
          style={{ marginTop: '.2rem' }}
          onChange={(e) => {
            const nuevo = e.target.checked;
            setValor(nuevo);
            setAviso(null);
            iniciar(async () => {
              const r = await accionSegura(() => cambiarCertificadoCaptura(pedidoId, nuevo));
              setAviso({ ok: r.ok, texto: r.mensaje });
              if (r.ok) router.refresh();
              else setValor(!nuevo);
            });
          }}
        />
        <span>
          <strong>Incluye certificado de captura (Catch Certificate)</strong>
          <br />
          <small style={{ color: 'var(--tinta-3)' }}>
            {decidido
              ? <>{origen}. Tiene un costo adicional: márquelo solo si se negoció con el cliente.</>
              : <>Este pedido es anterior a esta opción: se propone {lleva ? 'porque el destino es de la Unión Europea' : 'solo para destinos de la Unión Europea'}. Márquelo o desmárquelo para decidirlo.</>}
            {!puede && <> {motivoNo}</>}
          </small>
        </span>
      </label>
      {aviso && (
        <p role={aviso.ok ? 'status' : 'alert'} className={aviso.ok ? 'form-mensaje ok' : 'form-mensaje error'}>
          {aviso.texto} {aviso.ok && 'Si ya generó el contrato, genere una revisión para que lo refleje.'}
        </p>
      )}
    </div>
  );
}
