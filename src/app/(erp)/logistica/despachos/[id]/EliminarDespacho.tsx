'use client';

/**
 * ============================================================================
 *  «ELIMINAR DESPACHO» · solo Gerencia (migración 089, reunión del 12/11)
 * ============================================================================
 *  Oliver: «que yo pueda eliminar el despacho, solamente las personas
 *  autorizadas… y si yo lo elimino que se retorne todo». Se acordó: con
 *  validación, con comentario y con historial de despachos eliminados.
 *
 *  La validación es doble: el motivo (queda en el historial) y escribir el
 *  número del despacho, para que no se elimine uno por equivocación de
 *  pestaña. Quien no es Gerencia ve el botón apagado con el porqué.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { eliminarDespacho } from '../acciones';
import { accionSegura } from '@/lib/accionSegura';
import { Icono } from '@/components/estructura/Icono';

export function EliminarDespacho({
  despachoId,
  numero,
  puede,
  bloqueo,
}: {
  despachoId: number;
  numero: string;
  /** ¿Es Gerencia? */
  puede: boolean;
  /** Por qué no se puede eliminar (un comprobante vigente), o null. */
  bloqueo: string | null;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [confirma, setConfirma] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const porque = !puede ? 'Eliminar un despacho lo hace solo Gerencia.' : bloqueo;
  const numeroOk = confirma.trim().toUpperCase() === numero.toUpperCase();
  const listo = motivo.trim().length >= 5 && numeroOk;

  function eliminar() {
    setError(null);
    iniciar(async () => {
      const r = await accionSegura(() => eliminarDespacho(despachoId, motivo));
      if (!r.ok) { setError(r.mensaje); return; }
      //  La ficha deja de existir: se vuelve al listado con el resultado.
      router.push(`/logistica/despachos?eliminado=${encodeURIComponent(r.mensaje)}`);
    });
  }

  if (!abierto) {
    return (
      <button type="button" className="btn btn-peligro-borde" data-accion="eliminar-despacho"
              disabled={!!porque || pendiente} title={porque ?? `Eliminar ${numero}: lo que salió vuelve a cámara`}
              onClick={() => { setAbierto(true); setError(null); }}>
        <Icono nombre="papelera" tamano={15} />
        Eliminar despacho
      </button>
    );
  }

  return (
    <div className="ficha-aviso ficha-aviso-critico" data-confirmar="eliminar-despacho"
         style={{ flexDirection: 'column', alignItems: 'stretch', gap: '.5rem' }}>
      <span>
        <strong>¿Eliminar el despacho {numero}?</strong> Lo que salió vuelve a cámara con su propio
        movimiento en el Kardex, las reservas vuelven a apartarse para su pedido y el packing queda
        «en carga» para corregirlo o volver a despacharlo. Queda en el historial de despachos eliminados.
      </span>
      <label className="form-campo">
        <span>¿Por qué se elimina?</span>
        <input className="campo" name="motivo_eliminacion" autoFocus maxLength={300}
               placeholder="Ej.: despacho de prueba / se despachó el contenedor equivocado"
               value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </label>
      <label className="form-campo" style={{ maxWidth: '20rem' }}>
        <span>Para confirmar, escriba <b className="mono">{numero}</b></span>
        <input className="campo mono" name="confirmar_numero" value={confirma}
               onChange={(e) => setConfirma(e.target.value)} autoComplete="off" />
      </label>
      <div className="acciones-fila">
        <button type="button" className="btn btn-peligro" disabled={pendiente || !listo}
                data-accion="confirmar-eliminar-despacho" onClick={eliminar}
                title={!listo ? 'Escriba el motivo (al menos 5 caracteres) y el número del despacho' : undefined}>
          <Icono nombre="papelera" tamano={15} />
          {pendiente ? 'Eliminando…' : 'Sí, eliminar y devolver el stock'}
        </button>
        <button type="button" className="btn btn-sutil" disabled={pendiente}
                onClick={() => { setAbierto(false); setMotivo(''); setConfirma(''); }}>
          Cancelar
        </button>
      </div>
      {error && <span className="accion-error" role="alert">{error}</span>}
    </div>
  );
}
