'use client';

/**
 * El botón «Actualizar con la ficha del cliente» de la cotización y del
 * pedido (085). Pide confirmación en el sitio: cambia lo que sale impreso.
 * Apagado con su porqué si la persona no puede o el pedido ya tiene
 * comprobante.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { actualizarDatosCliente } from '@/app/(erp)/ventas/accionesDatosCliente';
import { accionSegura } from '@/lib/accionSegura';

export function ActualizarDatosCliente({
  tipo,
  id,
  bloqueo,
}: {
  tipo: 'cotizacion' | 'pedido';
  id: number;
  /** Por qué no se puede (rol, comprobante emitido…), o null. */
  bloqueo: string | null;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, iniciar] = useTransition();

  function actualizar() {
    setAviso(null);
    iniciar(async () => {
      const r = await accionSegura(() => actualizarDatosCliente(tipo, id));
      setAviso({ ok: r.ok, texto: r.mensaje });
      setConfirmando(false);
      if (r.ok) router.refresh();
    });
  }

  return (
    <span className={confirmando ? 'accion-confirmar' : undefined} data-bloque="actualizar-datos-cliente"
          style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '.4rem', alignItems: 'center' }}>
      {confirmando ? (
        <>
          <span>¿Copiar al {tipo === 'pedido' ? 'pedido' : 'documento'} los datos que tiene hoy la ficha del cliente?</span>
          <button type="button" className="btn btn-primario btn-chico" disabled={pendiente}
                  data-accion="confirmar-actualizar-datos-cliente" onClick={actualizar}>
            {pendiente ? 'Actualizando…' : 'Sí, actualizar'}
          </button>
          <button type="button" className="btn btn-sutil btn-chico" disabled={pendiente} onClick={() => setConfirmando(false)}>
            Cancelar
          </button>
        </>
      ) : (
        <button type="button" className="btn btn-secundario btn-chico" data-accion="actualizar-datos-cliente"
                disabled={!!bloqueo || pendiente} title={bloqueo ?? 'Vuelve a copiar razón social, dirección e identificación fiscal desde la ficha del cliente'}
                onClick={() => { setAviso(null); setConfirmando(true); }}>
          Actualizar con la ficha del cliente
        </button>
      )}
      {bloqueo && !confirmando && <small style={{ color: 'var(--tinta-3)' }}>{bloqueo}</small>}
      {aviso && (
        <small role={aviso.ok ? 'status' : 'alert'} style={{ color: aviso.ok ? 'var(--ok)' : 'var(--critico)' }}>
          {aviso.texto}
        </small>
      )}
    </span>
  );
}
