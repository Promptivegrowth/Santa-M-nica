'use client';

/**
 * Confirmar o cancelar el pedido, desde su cabecera. Confirmar lo hace contar
 * en el Control de pedidos y en las necesidades de producción; cancelar pide
 * un motivo y suelta lo apartado. Solo Gerencia y Operaciones.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { confirmarPedido, cancelarPedido } from '../acciones';

export function CicloPedido({ pedidoId, ciclo, puede }: { pedidoId: number; ciclo: string; puede: boolean }) {
  const router = useRouter();
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, iniciar] = useTransition();

  if (!puede) return null;
  const confirmable = ['borrador', 'pendiente_validacion'].includes(ciclo);
  const cancelable = !['despachado', 'cerrado', 'cancelado'].includes(ciclo);
  if (!confirmable && !cancelable) return null;

  const hacer = (accion: () => Promise<{ ok: boolean; mensaje: string }>) => iniciar(async () => {
    setAviso(null);
    const r = await accion();
    setAviso({ ok: r.ok, texto: r.mensaje });
    if (r.ok) { setCancelando(false); setMotivo(''); router.refresh(); }
  });

  return (
    <div className="ciclo-pedido" data-bloque="ciclo-pedido">
      {confirmable && !cancelando && (
        <button type="button" className="btn btn-primario" disabled={pendiente} data-accion="confirmar-pedido"
                onClick={() => hacer(() => confirmarPedido(pedidoId))}>
          {pendiente ? 'Confirmando…' : 'Confirmar pedido'}
        </button>
      )}
      {cancelable && !cancelando && (
        <button type="button" className="btn btn-sutil" disabled={pendiente} data-accion="cancelar-pedido"
                onClick={() => { setCancelando(true); setAviso(null); }}>
          Cancelar pedido
        </button>
      )}
      {cancelando && (
        <span className="ciclo-cancelar">
          <input className="campo" name="motivo_cancelacion" placeholder="¿Por qué se cancela?" autoFocus
                 value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} />
          <button type="button" className="btn btn-peligro" disabled={pendiente} data-accion="confirmar-cancelacion"
                  onClick={() => hacer(() => cancelarPedido(pedidoId, motivo))}>
            {pendiente ? 'Cancelando…' : 'Sí, cancelar'}
          </button>
          <button type="button" className="btn btn-sutil" disabled={pendiente} onClick={() => setCancelando(false)}>Volver</button>
        </span>
      )}
      {aviso && (
        <span role={aviso.ok ? 'status' : 'alert'} className="ciclo-aviso" style={{ color: aviso.ok ? 'var(--ok)' : 'var(--critico)' }}>
          {aviso.texto}
        </span>
      )}
    </div>
  );
}
