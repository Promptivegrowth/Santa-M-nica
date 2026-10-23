'use client';

/**
 * Una casilla del cierre: se escribe y se guarda al salir o con Enter, solo si
 * cambió. Vacía quita el dato. Nunca se bloquea mientras guarda (lo que se
 * teclea en la siguiente no se pierde).
 *
 * LA COMA DECIMAL
 * Antes la casilla borraba las comas: «12,5» se guardaba como 125 y
 * «535,641» como 535 641, sin avisar. Ahora lee coma o punto con la regla
 * única de `leerNumero` (src/lib/numeroEscrito.ts). Cuando lo escrito se
 * puede leer de dos maneras («535,641»: ¿miles o kilos?) NO guarda: pregunta
 * debajo de la casilla, con las dos lecturas en toneladas y kilos, y guarda
 * la que la persona elija.
 */
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { guardarDatoCierre } from './acciones';
import { leerNumero, numeroSinDuda } from '@/lib/numeroEscrito';

const aTexto = (v: number | null) => (v === null ? '' : String(Math.round(v * 1000) / 1000));

/** «535 TM y 641 kg»: la lectura decimal dicha en las unidades del cierre. */
function enToneladasYKilos(n: number) {
  const tm = Math.trunc(n);
  const kg = Math.round((n - tm) * 1000);
  return kg === 0 ? `${numeroSinDuda(tm, 0)} TM` : `${numeroSinDuda(tm, 0)} TM y ${kg} kg`;
}

export function CeldaCierre({
  categoriaId, anio, mes, campo, valor, etiqueta,
}: { categoriaId: number; anio: number; mes: number; campo: string; valor: number | null; etiqueta: string }) {
  const router = useRouter();
  const [texto, setTexto] = useState(aTexto(valor));
  const [error, setError] = useState<string | null>(null);
  const [duda, setDuda] = useState<{ comoDecimal: number; comoMiles: number } | null>(null);
  const [guardando, iniciar] = useTransition();
  const guardado = useRef(aTexto(valor));

  function enviar(n: number | null, textoFinal: string) {
    setError(null);
    setDuda(null);
    iniciar(async () => {
      const r = await guardarDatoCierre({ categoria_id: categoriaId, anio, mes, campo, valor: n });
      if (!r.ok) setError(r.mensaje);
      else { guardado.current = textoFinal; setTexto(textoFinal); }
      router.refresh();
    });
  }

  function guardar() {
    if (texto === guardado.current) { setDuda(null); return; }
    const l = leerNumero(texto);
    if (l.tipo === 'invalido') {
      setDuda(null);
      setError('No es un número. Escriba, por ejemplo, 12,5 o 1.234,5.');
      return;
    }
    if (l.tipo === 'ambiguo') { setError(null); setDuda(l); return; }
    const n = l.tipo === 'vacio' ? null : l.valor;
    //  Lo que queda escrito es el número tal como se guardó, para que no haya
    //  dudas de qué entendió el sistema («12,5» pasa a verse «12.5»).
    enviar(n, n === null ? '' : aTexto(n));
  }

  return (
    <span className="celda-cierre">
      <input
        className="campo mono obj-campo"
        inputMode="decimal"
        value={texto}
        aria-label={etiqueta}
        data-campo={campo}
        data-error={error ? 'si' : undefined}
        data-duda={duda ? 'si' : undefined}
        data-guardando={guardando ? 'si' : undefined}
        title={error ?? undefined}
        onChange={(e) => { setTexto(e.target.value); setDuda(null); }}
        onBlur={guardar}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        placeholder="—"
      />
      {error && <span className="celda-cierre-error" role="alert">{error}</span>}
      {duda && (
        <span className="celda-cierre-duda" role="group" aria-label={`¿Qué quiso decir con «${texto}»?`}>
          <span>«{texto}» se puede leer de dos maneras. ¿Cuál es?</span>
          <button type="button" className="btn btn-secundario" data-lectura="decimal"
                  onClick={() => enviar(duda.comoDecimal, aTexto(duda.comoDecimal))}>
            {enToneladasYKilos(duda.comoDecimal)}
          </button>
          <button type="button" className="btn btn-secundario" data-lectura="miles"
                  onClick={() => enviar(duda.comoMiles, aTexto(duda.comoMiles))}>
            {numeroSinDuda(duda.comoMiles, 0)} TM
          </button>
        </span>
      )}
      <style jsx>{`
        .celda-cierre { display: inline-flex; flex-direction: column; align-items: stretch; gap: .25rem; }
        .celda-cierre-error { color: var(--critico); font-size: .66rem; white-space: normal; max-width: 11rem; }
        .celda-cierre-duda {
          display: flex; flex-direction: column; gap: .25rem;
          font-size: .66rem; white-space: normal; max-width: 11rem; color: var(--tinta-2);
          text-align: left; font-family: var(--font-sans);
          padding: .3rem; border: 1px solid var(--atencion); border-radius: var(--radio); background: var(--atencion-suave);
        }
        .celda-cierre input[data-duda='si'] { outline: 2px solid var(--atencion); }
        .celda-cierre-duda :global(.btn) { font-size: .68rem; padding: .2rem .4rem; }
      `}</style>
    </span>
  );
}
