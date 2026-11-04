'use client';

/**
 * LA NUMERACIÓN DE PACKING («Observaciones ERP 4», punto 13).
 *
 * Dice qué N.º de packing se propondrá al programar el próximo embarque y,
 * a Gerencia y Operaciones, les deja fijarlo: la primera vez, para que el
 * sistema siga la numeración real (después de PL POT1123 viene la 1124). La
 * base comprueba el rol y que el número no lo use nadie.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { accionSegura } from '@/lib/accionSegura';
import { cifraNumeroPacking } from '@/lib/numeroPacking';
import { fijarProximoNumeroPacking } from '../acciones';

export function NumeracionPacking({
  propuesto, mayorUsado, fijadoPor, fijadoEn, puede,
}: {
  propuesto: string;
  mayorUsado: number | null;
  fijadoPor: string | null;
  fijadoEn: string | null;
  puede: boolean;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [valor, setValor] = useState(String(cifraNumeroPacking(propuesto) ?? ''));
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [guardando, iniciar] = useTransition();

  function fijar() {
    setAviso(null);
    iniciar(async () => {
      const r = await accionSegura(() => fijarProximoNumeroPacking(Number(valor)));
      setAviso({ ok: r.ok, texto: r.mensaje });
      if (r.ok) { setAbierto(false); router.refresh(); }
    });
  }

  return (
    <span className="prog-numeracion" data-bloque="numeracion-packing">
      <span>
        Próximo N.º de packing: <strong className="mono" data-propuesto>{propuesto}</strong>
        {fijadoEn && (
          <small data-fijado style={{ color: 'var(--tinta-3)' }}>
            {' '}(fijado por {fijadoPor ?? '—'} el {fijadoEn.slice(8, 10)}/{fijadoEn.slice(5, 7)}/{fijadoEn.slice(0, 4)})
          </small>
        )}
      </span>
      {puede && !abierto && (
        <button type="button" className="enlace-boton" data-accion="abrir-numeracion" onClick={() => setAbierto(true)}>
          Cambiar
        </button>
      )}
      {puede && abierto && (
        <>
          <label>
            <span className="sr-solo">Próximo número de la serie PL POT</span>
            PL POT <input className="campo mono" name="proximo_numero_packing" inputMode="numeric" value={valor}
                          onChange={(e) => setValor(e.target.value.replace(/\D/g, ''))} />
          </label>
          <button type="button" className="btn btn-primario btn-chico" data-accion="fijar-numeracion-packing"
                  disabled={guardando || !valor} onClick={fijar}>
            {guardando ? 'Guardando…' : 'Fijar'}
          </button>
          <button type="button" className="btn btn-sutil btn-chico" onClick={() => setAbierto(false)}>Cancelar</button>
          <small style={{ color: 'var(--tinta-3)' }}>
            {mayorUsado ? `El mayor usado en el sistema es PL POT${String(mayorUsado).padStart(3, '0')}. ` : ''}
            Escribir a mano un número mayor de la serie también mueve la numeración.
          </small>
        </>
      )}
      {aviso && <span role={aviso.ok ? 'status' : 'alert'} data-aviso="numeracion-packing"
                      style={{ color: aviso.ok ? 'var(--ok)' : 'var(--critico)' }}>{aviso.texto}</span>}
    </span>
  );
}
