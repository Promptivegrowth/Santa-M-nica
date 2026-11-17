/**
 * ============================================================================
 *  PORTAL DE CLIENTES · clientes.santamonicafishing.com
 * ============================================================================
 *  Misma aplicación que el ERP, otra entrada. Este layout NO cuelga del de
 *  (erp): no hay menú, no hay sesión de empleados, no hay nada del ERP. Solo
 *  la marca, el cambio de idioma y cerrar sesión.
 * ============================================================================
 */
import type { Metadata } from 'next';
import Image from 'next/image';
import '@/components/portal/portal.css';
import { idiomaPortal, sesionPortal } from '@/lib/portal/servidor';
import { textos } from '@/lib/portal/textos';
import { BarraIdioma } from './BarraIdioma';
import { cerrarSesion } from './acciones';

export const metadata: Metadata = {
  title: { absolute: 'Portal de seguimiento · Santa Mónica Fishing' },
  description: 'Seguimiento de proformas, contenedores y reclamos de los clientes de Santa Mónica Fishing.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function LayoutPortal({ children }: { children: React.ReactNode }) {
  const [idioma, sesion] = await Promise.all([idiomaPortal(), sesionPortal()]);
  const t = textos(idioma);

  return (
    <div className="pt-cuerpo" lang={idioma} data-sesion={sesion.ok ? 'si' : 'no'}>
      {/* Sin sesión (pantalla de ingreso) la marca va centrada en la tarjeta: la barra solo lleva el idioma. */}
      <header className="pt-barra">
        <div className="pt-barra-dentro">
          {sesion.ok ? (
            <>
              <Image src="/logo.png" alt="Santa Mónica" width={113} height={34} priority />
              <div className="pt-barra-titulo">
                <strong>{t.marca.toUpperCase()}</strong>
                <small>{t.portal}</small>
              </div>
            </>
          ) : <span className="pt-barra-titulo" />}
          <BarraIdioma idioma={idioma} texto={t.idiomaOtro} />
          {sesion.ok && (
            <form action={cerrarSesion}>
              <button type="submit" data-accion="salir-portal">{t.salir}</button>
            </form>
          )}
        </div>
      </header>
      <main className="pt-principal">{children}</main>
      <footer className="pt-pie">{t.pie}</footer>
    </div>
  );
}
