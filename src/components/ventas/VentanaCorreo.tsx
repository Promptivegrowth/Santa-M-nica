'use client';

/**
 * ============================================================================
 *  VENTANA FLOTANTE PARA LOS CORREOS DE VENTAS
 * ============================================================================
 *  La cabecera de la ficha ya tiene muchos botones: el formulario del correo
 *  se abre encima, sin mover la pantalla, y se cierra con Esc o «Cancelar».
 * ============================================================================
 */
import { useEffect } from 'react';

export function VentanaCorreo({
  titulo,
  alCerrar,
  children,
}: {
  titulo: string;
  alCerrar: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') alCerrar(); };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [alCerrar]);

  return (
    <div
      role="presentation"
      onClick={alCerrar}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(16, 26, 44, .45)', zIndex: 60,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 1rem', overflowY: 'auto',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        onClick={(e) => e.stopPropagation()}
        className="panel"
        style={{ width: '100%', maxWidth: '44rem', textAlign: 'left' }}
      >
        <div className="panel-cabecera">
          <span className="panel-titulo">{titulo}</span>
          <button type="button" className="btn btn-sutil btn-chico" onClick={alCerrar} aria-label="Cerrar">✕</button>
        </div>
        <div style={{ padding: '1rem' }}>{children}</div>
      </div>
    </div>
  );
}

/** El resultado de un envío, con el tono que corresponde: el simulado no es un éxito pleno. */
export function AvisoEnvio({ aviso }: { aviso: { ok: boolean; texto: string; estado?: string } | null }) {
  if (!aviso) return null;
  const simulado = aviso.estado === 'simulado';
  return (
    <p
      role={aviso.ok ? 'status' : 'alert'}
      data-aviso="correo"
      data-estado={aviso.estado ?? (aviso.ok ? 'ok' : 'error')}
      className={`form-mensaje ${aviso.ok && !simulado ? 'ok' : aviso.ok ? '' : 'error'}`}
      style={simulado ? { background: 'var(--atencion-suave)', color: 'var(--atencion)', border: '1px solid var(--atencion)' } : undefined}
    >
      {aviso.texto}
    </p>
  );
}
