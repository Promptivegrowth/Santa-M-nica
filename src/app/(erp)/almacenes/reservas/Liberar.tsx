'use client';

/**
 * ============================================================================
 *  LIBERAR UNA RESERVA
 * ============================================================================
 *  Un botón que abre un campo de motivo dentro de la propia fila. No se usa un
 *  modal a propósito: quien limpia reservas suele soltar varias seguidas, y un
 *  modal obliga a cerrar y reabrir en cada una.
 *
 *  El motivo es obligatorio. Es el dato que hoy falta: nadie sabe por qué el
 *  producto figuraba apartado, y sin esa respuesta el problema se repite.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { liberarReserva, expirarReservasVencidas } from './acciones';
import { Icono } from '@/components/estructura/Icono';

/** Motivos frecuentes, para no obligar a escribir lo mismo cada vez. */
const SUGERENCIAS = [
  'El cliente desistió del pedido',
  'Se reasignó a otro lote más antiguo',
  'Reserva duplicada por error de registro',
  'El pedido se atendió con otro almacén',
  'Venció el plazo y el cliente no confirmó',
];

export function BotonLiberar({
  reservaId,
  etiqueta,
  puedeLiberar,
}: {
  reservaId: number;
  /** Lo que se está soltando, para que la confirmación sea concreta. */
  etiqueta: string;
  puedeLiberar: boolean;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  if (!puedeLiberar) {
    return (
      <button type="button" className="accion-btn" disabled title="Su rol no puede liberar reservas">
        <Icono nombre="ingresos" tamano={14} />
      </button>
    );
  }

  function confirmar() {
    setError(null);
    iniciar(async () => {
      const r = await liberarReserva(reservaId, motivo);
      if (r.ok) {
        setAbierto(false);
        setMotivo('');
        router.refresh();
      } else {
        setError(r.mensaje);
      }
    });
  }

  if (!abierto) {
    return (
      <button
        type="button"
        className="accion-btn"
        onClick={() => setAbierto(true)}
        title={`Liberar ${etiqueta}`}
        aria-label={`Liberar ${etiqueta}`}
      >
        <Icono nombre="ingresos" tamano={14} />
      </button>
    );
  }

  return (
    <div className="liberar-caja">
      <p className="liberar-titulo">
        Liberar <strong>{etiqueta}</strong> — ¿por qué?
      </p>

      <div className="liberar-sugerencias">
        {SUGERENCIAS.map((s) => (
          <button
            key={s}
            type="button"
            className="pill pill-neutro liberar-sugerencia"
            onClick={() => setMotivo(s)}
          >
            {s}
          </button>
        ))}
      </div>

      <textarea
        className="campo"
        rows={2}
        maxLength={300}
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="Escriba el motivo o elija uno de arriba…"
        aria-label="Motivo de la liberación"
      />

      {error && <span className="accion-error">{error}</span>}

      <div className="liberar-botones">
        <button
          type="button"
          className="btn btn-primario"
          onClick={confirmar}
          disabled={pendiente || motivo.trim().length < 5}
        >
          {pendiente ? 'Liberando…' : 'Liberar stock'}
        </button>
        <button
          type="button"
          className="btn btn-sutil"
          onClick={() => { setAbierto(false); setError(null); }}
          disabled={pendiente}
        >
          Cancelar
        </button>
      </div>
      <p className="liberar-nota">
        Queda registrado quién lo hizo, cuándo y por qué, en el historial del lote y del pedido.
      </p>
    </div>
  );
}

/**
 * Botón de limpieza masiva. Solo suelta reservas cuyo plazo YA venció, así que
 * no puede llevarse por delante un apartado legítimo.
 */
export function BotonExpirar({ vencidas, puede }: { vencidas: number; puede: boolean }) {
  const router = useRouter();
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, iniciar] = useTransition();

  return (
    <>
      <button
        type="button"
        className="btn btn-primario"
        disabled={!puede || pendiente || vencidas === 0}
        title={
          !puede ? 'Solo gerencia u operaciones'
          : vencidas === 0 ? 'No hay reservas vencidas'
          : `Liberar las ${vencidas} reservas cuyo plazo ya expiró`
        }
        onClick={() =>
          iniciar(async () => {
            const r = await expirarReservasVencidas();
            setAviso({ ok: r.ok, texto: r.mensaje });
            if (r.ok) router.refresh();
          })
        }
      >
        <Icono nombre="reloj" tamano={15} />
        {pendiente ? 'Liberando…' : `Liberar ${vencidas} vencidas`}
      </button>
      {aviso && (
        <span className={aviso.ok ? 'aviso-ok' : 'accion-error'} role="status">{aviso.texto}</span>
      )}
    </>
  );
}
