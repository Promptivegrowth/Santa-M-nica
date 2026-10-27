'use client';

/**
 * ============================================================================
 *  «MARCAR COMO ATENDIDA»
 * ============================================================================
 *  Un botón por alerta, al lado de la tarjeta (no dentro: la tarjeta entera es
 *  un enlace al registro y un botón dentro de un enlace no se puede pulsar
 *  sin navegar). Pide confirmación con un segundo clic: cerrar una alerta es
 *  decidir que ya no hace falta mirarla.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icono } from '@/components/estructura/Icono';
import { accionSegura } from '@/lib/accionSegura';
import { marcarAtendida } from './acciones';

export function BotonAtender({ id }: { id: number }) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [confirmar, setConfirmar] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  function pulsar() {
    if (!confirmar) { setConfirmar(true); setAviso(null); return; }
    iniciar(async () => {
      const r = await accionSegura(() => marcarAtendida(id));
      setAviso({ ok: r.ok, texto: r.mensaje });
      setConfirmar(false);
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="alerta-atender" data-alerta-atender={id}>
      <button type="button" className={`btn ${confirmar ? 'btn-primario' : 'btn-sutil'} btn-chico`}
              onClick={pulsar} disabled={pendiente || aviso?.ok === true}
              title="Deja constancia de quién la atendió y cuándo. Una alerta de regla no se vuelve a abrir para el mismo registro.">
        <Icono nombre="guardar" tamano={13} />
        {pendiente ? 'Marcando…' : confirmar ? '¿Confirmar?' : 'Marcar como atendida'}
      </button>
      {confirmar && !pendiente && (
        <button type="button" className="btn btn-sutil btn-chico" onClick={() => setConfirmar(false)}>Cancelar</button>
      )}
      {aviso && <small role={aviso.ok ? 'status' : 'alert'} data-ok={aviso.ok ? 'si' : 'no'}>{aviso.texto}</small>}
      <style jsx>{`
        .alerta-atender {
          display: flex; flex-direction: column; align-items: flex-end; justify-content: center;
          gap: .3rem; padding: .6rem .9rem .6rem 0; min-width: 11rem; max-width: 16rem;
        }
        .alerta-atender small { font-size: .7rem; color: var(--tinta-2); text-align: right; line-height: 1.35; }
        .alerta-atender small[data-ok='no'] { color: var(--critico); }
      `}</style>
    </div>
  );
}
