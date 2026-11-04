'use client';

/**
 * ============================================================================
 *  «ELIMINAR PEDIDO» · solo Gerencia (migración 085)
 * ============================================================================
 *  «Observaciones ERP 4», punto 13: «permitir eliminar proformas». Lo hace
 *  solo Gerencia, con motivo, y solo si no tiene nada posterior (comprobante,
 *  embarque, packing, reservas vigentes): la regla la aplica la base y el
 *  botón sale apagado con el mismo porqué. Quien vende y no es Gerencia lo ve
 *  apagado, con la alternativa: «Cancelar pedido».
 *
 *  Si el pedido nació de una cotización, se puede eliminar también la
 *  cotización (casilla); si no se marca, la cotización vuelve a estar
 *  disponible.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { eliminarPedido } from '../acciones';
import { accionSegura } from '@/lib/accionSegura';
import { Icono } from '@/components/estructura/Icono';

export function EliminarPedido({
  pedidoId,
  numero,
  cotizacion,
  puede,
  bloqueo,
}: {
  pedidoId: number;
  numero: string;
  /** El número de la cotización de origen, si la hay. */
  cotizacion: string | null;
  /** ¿Es Gerencia? */
  puede: boolean;
  /** Por qué no se puede eliminar (problema_eliminar_pedido), o null. */
  bloqueo: string | null;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [conCotizacion, setConCotizacion] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const porque = !puede
    ? 'Eliminar un pedido lo hace solo Gerencia. Para dejarlo sin efecto use «Cancelar pedido» (Gerencia u Operaciones).'
    : bloqueo;

  function eliminar() {
    setError(null);
    iniciar(async () => {
      //  Un corte de red vuelve como aviso aquí, sin perder lo escrito (076).
      const r = await accionSegura(() => eliminarPedido(pedidoId, motivo, conCotizacion));
      if (!r.ok) { setError(r.mensaje); return; }
      //  La ficha deja de existir: se vuelve al listado con el resultado.
      router.push(`/ventas/pedidos?eliminado=${encodeURIComponent(r.mensaje)}`);
    });
  }

  if (!abierto) {
    return (
      <button type="button" className="btn btn-peligro-borde" data-accion="eliminar-pedido"
              disabled={!!porque || pendiente} title={porque ?? `Eliminar ${numero} (pide un motivo)`}
              onClick={() => { setAbierto(true); setError(null); }}>
        <Icono nombre="papelera" tamano={15} />
        Eliminar pedido
      </button>
    );
  }

  return (
    <span className="accion-confirmar" data-confirmar="eliminar-pedido" style={{ flexWrap: 'wrap' }}>
      <span>¿Eliminar {numero}? No se deshace.</span>
      <input className="campo" name="motivo_eliminacion" placeholder="¿Por qué se elimina?" autoFocus
             value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)}
             style={{ minWidth: '14rem', padding: '.2rem .4rem', fontSize: '.78rem' }} />
      {cotizacion && (
        <label style={{ display: 'inline-flex', gap: '.3rem', alignItems: 'center', fontSize: '.75rem' }}>
          <input type="checkbox" name="con_cotizacion" checked={conCotizacion} onChange={(e) => setConCotizacion(e.target.checked)} />
          Eliminar también la cotización {cotizacion}
        </label>
      )}
      <button type="button" className="btn btn-peligro" style={{ padding: '.2rem .5rem', fontSize: '.75rem' }}
              disabled={pendiente || motivo.trim().length < 5} data-accion="confirmar-eliminar-pedido"
              title={motivo.trim().length < 5 ? 'Escriba el motivo (al menos 5 caracteres): queda en el historial' : undefined}
              onClick={eliminar}>
        {pendiente ? 'Eliminando…' : 'Sí, eliminar'}
      </button>
      <button type="button" className="btn btn-sutil" style={{ padding: '.2rem .5rem', fontSize: '.75rem' }}
              disabled={pendiente} onClick={() => setAbierto(false)}>
        Cancelar
      </button>
      {!cotizacion ? null : !conCotizacion && (
        <small style={{ color: 'var(--tinta-3)', flexBasis: '100%' }}>
          Si no la elimina, la cotización {cotizacion} vuelve a estar disponible (aprobada o borrador).
        </small>
      )}
      {error && <span className="accion-error" role="alert">{error}</span>}
    </span>
  );
}
