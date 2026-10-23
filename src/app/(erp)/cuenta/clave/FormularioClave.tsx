'use client';

/**
 * El formulario de cambio de contraseña. Comprueba al escribir lo mismo que
 * después exige la base (cambiar_mi_clave, 070), para no hacer esperar un
 * rechazo evidente.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cambiarMiClave } from '@/app/(erp)/configuracion/accionesUsuarios';

export function FormularioClave({ temporal }: { temporal: boolean }) {
  const router = useRouter();
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [guardando, iniciar] = useTransition();

  const problema =
    nueva && nueva.length < 8 ? 'Al menos 8 caracteres.'
    : nueva && (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(nueva) || !/[0-9]/.test(nueva)) ? 'Combine letras y números.'
    : repetida && repetida !== nueva ? 'La repetición no coincide.'
    : null;

  function guardar(e: React.FormEvent) {
    e.preventDefault();
    setAviso(null);
    iniciar(async () => {
      const r = await cambiarMiClave(actual, nueva, repetida);
      setAviso({ ok: r.ok, texto: r.mensaje });
      if (r.ok) {
        setActual(''); setNueva(''); setRepetida('');
        // Con la temporal cambiada ya puede ir a donde quería: el panel.
        if (temporal) router.replace('/panel');
        router.refresh();
      }
    });
  }

  return (
    <form className="form-rejilla" onSubmit={guardar} data-bloque="cambiar-clave">
      <label className="form-campo">
        <span className="etiqueta">{temporal ? 'Contraseña temporal (la que le dio Gerencia)' : 'Contraseña actual'}</span>
        <input className="campo" type="password" name="actual" autoComplete="current-password"
               value={actual} onChange={(e) => setActual(e.target.value)} required autoFocus />
      </label>
      <label className="form-campo">
        <span className="etiqueta">Contraseña nueva</span>
        <input className="campo" type="password" name="nueva" autoComplete="new-password" minLength={8}
               value={nueva} onChange={(e) => setNueva(e.target.value)} required />
      </label>
      <label className="form-campo">
        <span className="etiqueta">Repita la contraseña nueva</span>
        <input className="campo" type="password" name="repetida" autoComplete="new-password"
               value={repetida} onChange={(e) => setRepetida(e.target.value)} required
               aria-invalid={repetida && repetida !== nueva ? 'true' : 'false'} />
      </label>
      <div className="form-campo form-ancho">
        {problema && <span className="form-aviso-campo">{problema}</span>}
        <div className="acciones-fila">
          <button type="submit" className="btn btn-primario" disabled={guardando || !!problema}
                  data-accion="guardar-clave">
            {guardando ? 'Guardando…' : 'Cambiar contraseña'}
          </button>
        </div>
        {aviso && (
          <div className={`ficha-aviso ${aviso.ok ? 'ficha-aviso-ok' : 'ficha-aviso-critico'} documento-mensaje`}
               role={aviso.ok ? 'status' : 'alert'}>
            <span>{aviso.texto}</span>
          </div>
        )}
      </div>
    </form>
  );
}
