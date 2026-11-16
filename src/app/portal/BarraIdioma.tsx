'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cambiarIdioma } from './acciones';
import type { Idioma } from '@/lib/portal/textos';

/** Español ⇄ English. Se recuerda en una cookie y en la sesión del portal. */
export function BarraIdioma({ idioma, texto }: { idioma: Idioma; texto: string }) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  return (
    <button
      type="button"
      data-accion="idioma"
      disabled={pendiente}
      onClick={() => iniciar(async () => { await cambiarIdioma(idioma === 'es' ? 'en' : 'es'); router.refresh(); })}
    >
      {texto}
    </button>
  );
}
