'use client';

/**
 * Una casilla del cierre: se escribe y se guarda al salir o con Enter, solo si
 * cambió. Vacía quita el dato. Nunca se bloquea mientras guarda (lo que se
 * teclea en la siguiente no se pierde).
 */
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { guardarDatoCierre } from './acciones';

const aTexto = (v: number | null) => (v === null ? '' : String(Math.round(v * 1000) / 1000));

export function CeldaCierre({
  categoriaId, anio, mes, campo, valor, etiqueta,
}: { categoriaId: number; anio: number; mes: number; campo: string; valor: number | null; etiqueta: string }) {
  const router = useRouter();
  const [texto, setTexto] = useState(aTexto(valor));
  const [error, setError] = useState<string | null>(null);
  const [guardando, iniciar] = useTransition();
  const guardado = useRef(aTexto(valor));

  function guardar() {
    if (texto === guardado.current) return;
    const limpio = texto.trim().replace(/,/g, '');
    const n = limpio === '' ? null : Number(limpio);
    if (n !== null && !Number.isFinite(n)) { setError('No es un número.'); return; }
    setError(null);
    iniciar(async () => {
      const r = await guardarDatoCierre({ categoria_id: categoriaId, anio, mes, campo, valor: n });
      if (!r.ok) setError(r.mensaje); else guardado.current = texto;
      router.refresh();
    });
  }

  return (
    <input
      className="campo mono obj-campo"
      inputMode="decimal"
      value={texto}
      aria-label={etiqueta}
      data-campo={campo}
      data-error={error ? 'si' : undefined}
      data-guardando={guardando ? 'si' : undefined}
      title={error ?? undefined}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={guardar}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      placeholder="—"
    />
  );
}
