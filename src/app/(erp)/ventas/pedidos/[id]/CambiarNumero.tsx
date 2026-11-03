'use client';

/**
 * ============================================================================
 *  «CAMBIAR NÚMERO» DE LA PROFORMA (082)
 * ============================================================================
 *  Oliver: «poder modificar el número de Proforma». Junto al número, en la
 *  ficha del pedido. Lo usan los mismos que crean pedidos (Gerencia,
 *  Operaciones, Comercial, Comercio Exterior); a los demás no se les muestra.
 *
 *  Hasta cuándo: mientras el pedido no tenga un comprobante emitido y vigente.
 *  Con comprobante, el botón se ve apagado y dice por qué (la factura lleva
 *  el número impreso). El servidor y la base lo vuelven a comprobar.
 *
 *  Si falla (número repetido, corte de red…), el campo sigue abierto con lo
 *  escrito y el aviso dice qué pasó.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cambiarNumeroProforma } from '../acciones';
import { CampoNumeroProforma } from '@/components/ventas/CampoNumeroProforma';
import { problemaNumeroProforma, normalizarNumeroProforma } from '@/lib/numeroProforma';
import { accionSegura } from '@/lib/accionSegura';

export function CambiarNumero({
  pedidoId,
  numero,
  bloqueo,
  tieneContrato = false,
}: {
  pedidoId: number;
  numero: string;
  /** Por qué ya no se puede cambiar (comprobante emitido), o null. */
  bloqueo: string | null;
  /** Si ya hay contratos generados: se avisa antes de cambiar. */
  tieneContrato?: boolean;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [valor, setValor] = useState(numero);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, iniciar] = useTransition();

  const igual = normalizarNumeroProforma(valor) === normalizarNumeroProforma(numero);

  function guardar() {
    setAviso(null);
    iniciar(async () => {
      const r = await accionSegura(() => cambiarNumeroProforma(pedidoId, valor));
      setAviso({ ok: r.ok, texto: r.mensaje });
      if (r.ok) { setAbierto(false); router.refresh(); }
    });
  }

  if (!abierto) {
    return (
      <span className="cambiar-numero" data-bloque="cambiar-numero">
        <button
          type="button"
          className="enlace-boton"
          data-accion="cambiar-numero"
          disabled={!!bloqueo}
          title={bloqueo ?? 'Corrige el número de proforma (por ejemplo, para poner el de la numeración de Santa Mónica)'}
          onClick={() => { setValor(numero); setAviso(null); setAbierto(true); }}
          style={{ marginLeft: '.5rem', fontSize: '.78rem' }}
        >
          Cambiar número
        </button>
        {bloqueo && <small className="cambiar-numero-motivo" style={{ display: 'block', color: 'var(--tinta-3)' }}>{bloqueo}</small>}
        {aviso && (
          <span role={aviso.ok ? 'status' : 'alert'} data-aviso="cambiar-numero"
                style={{ display: 'block', fontSize: '.78rem', color: aviso.ok ? 'var(--ok)' : 'var(--critico)', maxWidth: '32rem' }}>
            {aviso.texto}
          </span>
        )}
      </span>
    );
  }

  return (
    <span className="cambiar-numero" data-bloque="cambiar-numero" style={{ display: 'block', marginTop: '.35rem' }}>
      <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '.4rem' }}>
        <CampoNumeroProforma compacto valor={valor} onChange={(v) => { setValor(v); if (aviso) setAviso(null); }}
                             propuesto={null} disabled={pendiente} />
        <button type="button" className="btn btn-primario" style={{ padding: '.2rem .55rem', fontSize: '.75rem' }}
                data-accion="guardar-numero"
                disabled={pendiente || igual || !!problemaNumeroProforma(valor)}
                onClick={guardar}>
          {pendiente ? 'Guardando…' : 'Guardar número'}
        </button>
        <button type="button" className="btn btn-sutil" style={{ padding: '.2rem .55rem', fontSize: '.75rem' }}
                disabled={pendiente} onClick={() => { setAbierto(false); setAviso(null); }}>
          Cancelar
        </button>
      </span>
      <small style={{ display: 'block', color: 'var(--tinta-3)', marginTop: '.25rem', maxWidth: '32rem' }}>
        Se guarda en mayúsculas y sin espacios; tiene que ser único. Queda en el historial (de cuál a cuál, quién y cuándo).
        {tieneContrato && ' Este pedido ya tiene contrato: después de cambiar el número, genérelo otra vez para que lo lleve.'}
      </small>
      {aviso && (
        <span role={aviso.ok ? 'status' : 'alert'} data-aviso="cambiar-numero"
              style={{ display: 'block', fontSize: '.78rem', color: aviso.ok ? 'var(--ok)' : 'var(--critico)', maxWidth: '32rem' }}>
          {aviso.texto}
        </span>
      )}
    </span>
  );
}
