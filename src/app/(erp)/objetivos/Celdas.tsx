'use client';

/**
 * ============================================================================
 *  LAS CELDAS EDITABLES DE OBJETIVOS
 * ============================================================================
 *  Como en el Excel de Oliver: se escribe en la propia tabla y se guarda al
 *  salir de la casilla o con Enter, solo si cambió. Dejarla vacía quita el
 *  dato. Un error se enseña en la misma celda, con el motivo en la ayuda.
 *
 *  Las casillas NUNCA se bloquean mientras se guarda: si se bloquearan, lo
 *  que se teclea en la casilla siguiente durante ese medio segundo se
 *  perdería (pasó en la prueba con la meta: el «máximo» no llegaba).
 * ============================================================================
 */
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { guardarValor, guardarMeta } from './acciones';

const aTexto = (v: number | null) => (v === null ? '' : String(Math.round(v * 1e6) / 1e6));
const aNumero = (t: string): number | null | 'mal' => {
  const limpio = t.trim().replace(/,/g, '');
  if (limpio === '') return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : 'mal';
};

export function CeldaValor({
  indicadorId, anio, mes, valor, nombre,
}: { indicadorId: number; anio: number; mes: number; valor: number | null; nombre: string }) {
  const router = useRouter();
  const [texto, setTexto] = useState(aTexto(valor));
  const [error, setError] = useState<string | null>(null);
  const [guardando, iniciar] = useTransition();
  //  Lo último guardado: con eso se compara, no con lo que trajo la página.
  const guardado = useRef(aTexto(valor));

  function guardar() {
    if (texto === guardado.current) return;
    const n = aNumero(texto);
    if (n === 'mal') { setError('No es un número.'); return; }
    setError(null);
    iniciar(async () => {
      const r = await guardarValor({ indicador_id: indicadorId, anio, mes, valor: n });
      if (!r.ok) setError(r.mensaje);
      else guardado.current = texto;
      router.refresh();
    });
  }

  return (
    <input
      className="campo mono obj-campo"
      inputMode="decimal"
      value={texto}
      aria-label={`${nombre}, mes ${mes}`}
      data-error={error ? 'si' : undefined}
      title={error ?? undefined}
      data-guardando={guardando ? 'si' : undefined}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={guardar}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      placeholder="—"
    />
  );
}

export function CeldaMeta({
  indicadorId, anio, mes, esperado, maximo, nombre,
}: {
  indicadorId: number; anio: number; mes: number | null;
  esperado: number | null; maximo: number | null; nombre: string;
}) {
  const router = useRouter();
  const [e, setE] = useState(aTexto(esperado));
  const [m, setM] = useState(aTexto(maximo));
  const [error, setError] = useState<string | null>(null);
  const [guardando, iniciar] = useTransition();
  const guardado = useRef(`${aTexto(esperado)}|${aTexto(maximo)}`);

  /*
   * Se guarda cuando el foco sale del PAR de casillas, no de cada una: pasar
   * del esperado al máximo con Tab no es terminar, y guardar a medias dejaría
   * una meta con solo el esperado.
   */
  function guardar() {
    if (`${e}|${m}` === guardado.current) return;
    const ne = aNumero(e);
    const nm = aNumero(m);
    if (ne === 'mal' || nm === 'mal') { setError('No es un número.'); return; }
    setError(null);
    iniciar(async () => {
      const r = await guardarMeta({ indicador_id: indicadorId, anio, mes, esperado: ne, maximo: nm });
      if (!r.ok) setError(r.mensaje);
      else guardado.current = `${e}|${m}`;
      router.refresh();
    });
  }

  const cuando = mes === null ? 'del año' : `del mes ${mes}`;
  return (
    <span className="obj-meta" data-error={error ? 'si' : undefined} title={error ?? undefined}
          data-guardando={guardando ? 'si' : undefined}
          onBlur={(x) => { if (!x.currentTarget.contains(x.relatedTarget as Node | null)) guardar(); }}>
      <input
        className="campo mono obj-campo"
        inputMode="decimal"
        value={e}
        aria-label={`${nombre}, esperado ${cuando}`}
        placeholder="esp."
        onChange={(x) => setE(x.target.value)}
        onKeyDown={(x) => { if (x.key === 'Enter') (x.target as HTMLInputElement).blur(); }}
      />
      <input
        className="campo mono obj-campo"
        inputMode="decimal"
        value={m}
        aria-label={`${nombre}, máximo ${cuando}`}
        placeholder="máx."
        onChange={(x) => setM(x.target.value)}
        onKeyDown={(x) => { if (x.key === 'Enter') (x.target as HTMLInputElement).blur(); }}
      />
    </span>
  );
}
