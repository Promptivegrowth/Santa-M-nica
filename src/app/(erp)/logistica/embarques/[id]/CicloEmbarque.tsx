'use client';

/**
 * ============================================================================
 *  CONFIRMAR O CANCELAR EL EMBARQUE, desde su cabecera
 * ============================================================================
 *  · Confirmar: planificado → confirmado. En exportación exige el booking.
 *  · Cancelar: con motivo; no si ya salió algún contenedor. Anula los
 *    contenedores abiertos y deja los pedidos libres, sin soltar lo apartado.
 *
 *  Las deciden Gerencia, Operaciones y Comercio Exterior. Almacén ve los
 *  botones apagados con el porqué; el resto de roles no los ve. Cuando el
 *  embarque no admite la acción, el botón se apaga y dice por qué en vez de
 *  desaparecer: así se entiende qué falta. El servidor lo vuelve a comprobar.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { confirmarEmbarque, cancelarEmbarque } from '../acciones';

export function CicloEmbarque({
  embarqueId,
  estado,
  puede,
  noPuedeConfirmar,
  noPuedeCancelar,
}: {
  embarqueId: number;
  estado: string;
  /** El rol puede decidir (Gerencia, Operaciones, Comercio Exterior). */
  puede: boolean;
  /** Si no se puede confirmar todavía, por qué (falta el booking, no hay pedidos…). */
  noPuedeConfirmar: string | null;
  /** Si no se puede cancelar, por qué (ya tiene un contenedor despachado). */
  noPuedeCancelar: string | null;
}) {
  const router = useRouter();
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, iniciar] = useTransition();

  const confirmable = estado === 'planificado';
  const cancelable = estado !== 'despachado' && estado !== 'cancelado';
  if (!confirmable && !cancelable) return null;

  const porRol = puede ? null : 'Lo deciden Gerencia, Operaciones o Comercio Exterior.';
  const motivoConfirmar = porRol ?? noPuedeConfirmar;
  const motivoCancelar = porRol ?? noPuedeCancelar;

  const hacer = (accion: () => Promise<{ ok: boolean; mensaje: string }>) => iniciar(async () => {
    setAviso(null);
    const r = await accion();
    setAviso({ ok: r.ok, texto: r.mensaje });
    if (r.ok) { setCancelando(false); setMotivo(''); router.refresh(); }
  });

  /*
   * Los botones van sueltos en la botonera de la cabecera, junto a los demás;
   * lo que ocupa más (el motivo, los avisos) baja a una fila entera.
   */
  return (
    <span data-bloque="ciclo-embarque" style={{ display: 'contents' }}>
      {confirmable && !cancelando && (
        <button type="button" className="btn btn-primario" data-accion="confirmar-embarque"
                disabled={pendiente || !!motivoConfirmar} title={motivoConfirmar ?? 'Pasa el embarque a «Confirmado»'}
                onClick={() => hacer(() => confirmarEmbarque(embarqueId))}>
          {pendiente ? 'Confirmando…' : 'Confirmar embarque'}
        </button>
      )}
      {cancelable && !cancelando && (
        <button type="button" className="btn btn-sutil" data-accion="cancelar-embarque"
                disabled={pendiente || !!motivoCancelar} title={motivoCancelar ?? 'Pide el motivo antes de cancelar'}
                onClick={() => { setCancelando(true); setAviso(null); }}>
          Cancelar embarque
        </button>
      )}
      {/* El porqué, también a la vista (el «title» no se ve en una pantalla táctil). */}
      {!cancelando && confirmable && motivoConfirmar && puede && (
        <small className="documento-mensaje" style={{ textAlign: 'right', color: 'var(--tinta-3)', marginTop: 0 }} data-motivo="confirmar">
          Para confirmar: {motivoConfirmar}
        </small>
      )}
      {!cancelando && cancelable && motivoCancelar && puede && (
        <small className="documento-mensaje" style={{ textAlign: 'right', color: 'var(--tinta-3)', marginTop: 0 }} data-motivo="cancelar">
          {motivoCancelar}
        </small>
      )}
      {cancelando && (
        <span className="documento-mensaje" style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', alignItems: 'center', justifyContent: 'flex-end' }}>
          <input className="campo" name="motivo_cancelacion_embarque" placeholder="¿Por qué se cancela?" autoFocus
                 value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} style={{ minWidth: '18rem' }} />
          <button type="button" className="btn btn-peligro" disabled={pendiente} data-accion="confirmar-cancelacion-embarque"
                  onClick={() => hacer(() => cancelarEmbarque(embarqueId, motivo))}>
            {pendiente ? 'Cancelando…' : 'Sí, cancelar el embarque'}
          </button>
          <button type="button" className="btn btn-sutil" disabled={pendiente} onClick={() => setCancelando(false)}>Volver</button>
          <small style={{ flexBasis: '100%', textAlign: 'right', color: 'var(--tinta-3)' }}>
            Se anulan sus contenedores abiertos y sus pedidos quedan libres para otro embarque. Lo apartado sigue apartado.
          </small>
        </span>
      )}
      {aviso && (
        <span role={aviso.ok ? 'status' : 'alert'} className="documento-mensaje"
              style={{ textAlign: 'right', fontSize: '.82rem', color: aviso.ok ? 'var(--ok)' : 'var(--critico)' }}>
          {aviso.texto}
        </span>
      )}
    </span>
  );
}
