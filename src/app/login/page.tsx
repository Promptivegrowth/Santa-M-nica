/**
 * Pantalla de acceso al sistema.
 * El formulario va en un componente aparte porque necesita interactividad
 * (estado del formulario, clics del acceso rápido) y por tanto corre en el
 * navegador; esta página en cambio se renderiza en el servidor.
 */
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { FormularioAcceso } from './FormularioAcceso';

export const metadata: Metadata = { title: 'Acceso' };

export default function PaginaLogin() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100dvh' }} />}>
      <FormularioAcceso />
    </Suspense>
  );
}
