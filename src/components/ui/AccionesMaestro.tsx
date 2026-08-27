'use client';

/**
 * ============================================================================
 *  ACCIONES DE UN REGISTRO MAESTRO · desactivar, reactivar y borrar
 * ============================================================================
 *  Sirve igual para un cliente y para un producto: se le pasan las funciones
 *  que tiene que llamar.
 *
 *  POR QUÉ BORRAR PIDE ESCRIBIR EL NOMBRE
 *  Porque un «¿está seguro?» no protege de nada: se contesta que sí por
 *  reflejo, sin leer. Escribir el código del registro obliga a mirarlo, y
 *  mirarlo es exactamente lo que evita borrar el que no era.
 *
 *  Y aun así, borrar casi nunca procede: si el registro tiene documentos, el
 *  servidor lo rechaza y explica cuántos son. La confirmación no reemplaza esa
 *  comprobación, la acompaña.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icono } from '@/components/estructura/Icono';

type Resultado = { ok: true; mensaje: string } | { ok: false; mensaje: string };

export function AccionesMaestro({
  id,
  nombre,
  codigo,
  activo,
  puedeEditar,
  puedeBorrar,
  queEs,
  cambiarEstado,
  eliminar,
  volverA,
}: {
  id: number;
  /** El nombre legible, para los mensajes. */
  nombre: string;
  /** Lo que hay que escribir para confirmar el borrado. */
  codigo: string;
  activo: boolean;
  puedeEditar: boolean;
  puedeBorrar: boolean;
  /** «cliente» o «producto». Se usa en los textos. */
  queEs: 'cliente' | 'producto';
  cambiarEstado: (id: number, activo: boolean) => Promise<Resultado>;
  eliminar: (id: number) => Promise<Resultado>;
  /** A dónde ir después de borrar. */
  volverA: string;
}) {
  const router = useRouter();
  const [trabajando, iniciar] = useTransition();
  const [confirmando, setConfirmando] = useState(false);
  const [escrito, setEscrito] = useState('');
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'mal'; texto: string } | null>(null);

  function alternar() {
    setAviso(null);
    iniciar(async () => {
      const r = await cambiarEstado(id, !activo);
      setAviso({ tipo: r.ok ? 'ok' : 'mal', texto: r.mensaje });
      if (r.ok) router.refresh();
    });
  }

  function borrar() {
    setAviso(null);
    iniciar(async () => {
      const r = await eliminar(id);
      if (r.ok) { router.push(volverA); router.refresh(); return; }
      // El servidor explica por qué no se puede: casi siempre, documentos.
      setAviso({ tipo: 'mal', texto: r.mensaje });
      setConfirmando(false);
      setEscrito('');
    });
  }

  if (!puedeEditar && !puedeBorrar) return null;

  return (
    <>
      {puedeEditar && (
        <button type="button" className="btn btn-secundario" onClick={alternar} disabled={trabajando}>
          <Icono nombre={activo ? 'reservas' : 'ver'} tamano={15} />
          {trabajando ? 'Un momento…' : activo ? 'Desactivar' : 'Reactivar'}
        </button>
      )}

      {puedeBorrar && !confirmando && (
        <button type="button" className="btn btn-sutil" onClick={() => { setConfirmando(true); setAviso(null); }}>
          <Icono nombre="alerta" tamano={15} />
          Borrar
        </button>
      )}

      {aviso && (
        <div
          className={`ficha-aviso ${aviso.tipo === 'ok' ? 'ficha-aviso-info' : 'ficha-aviso-critico'} documento-mensaje`}
          role={aviso.tipo === 'ok' ? 'status' : 'alert'}
        >
          <Icono nombre="alerta" tamano={17} />
          <span>{aviso.texto}</span>
        </div>
      )}

      {confirmando && (
        <div className="zona-peligro documento-mensaje">
          <h4>Borrar {nombre} definitivamente</h4>
          <p>
            Esto no se puede deshacer. Si este {queEs} tiene documentos emitidos, el sistema no lo
            va a permitir y le dirá cuántos son — en ese caso lo que corresponde es{' '}
            <b>desactivarlo</b>, que conserva todo el historial.
          </p>
          <p>
            Para confirmar, escriba <b className="mono">{codigo}</b>:
          </p>
          <input
            className="campo mono"
            value={escrito}
            onChange={(e) => setEscrito(e.target.value)}
            placeholder={codigo}
            style={{ maxWidth: '16rem', marginBottom: '.7rem' }}
            autoFocus
          />
          <div className="acciones-fila">
            <button
              type="button"
              className="btn btn-primario"
              onClick={borrar}
              disabled={trabajando || escrito.trim() !== codigo}
            >
              {trabajando ? 'Borrando…' : 'Sí, borrar'}
            </button>
            <button
              type="button"
              className="btn btn-sutil"
              onClick={() => { setConfirmando(false); setEscrito(''); }}
              disabled={trabajando}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </>
  );
}
