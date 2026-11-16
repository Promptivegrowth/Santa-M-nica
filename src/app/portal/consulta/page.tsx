/**
 * El resultado de la búsqueda: la proforma validada por sus 3 datos. Se lee
 * de la sesión del portal (no de la dirección web): cambiar un número en la
 * barra del navegador no lleva a la proforma de nadie más.
 */
import { redirect } from 'next/navigation';
import { idiomaPortal, sesionPortal, consultaPortal } from '@/lib/portal/servidor';
import { textos } from '@/lib/portal/textos';
import { VistaPortal } from '@/components/portal/VistaPortal';
import { otraConsulta } from '../acciones';

export default async function ConsultaPortal() {
  const [idioma, sesion] = await Promise.all([idiomaPortal(), sesionPortal()]);
  if (!sesion.ok) redirect('/portal/acceso');
  const datos = await consultaPortal();
  if (!datos) redirect('/portal');
  const t = textos(idioma);

  return (
    <>
      <form action={otraConsulta} className="pt-no-imprimir" style={{ marginBottom: '1rem' }}>
        <button type="submit" className="pt-btn pt-btn-secundario">← {t.otraConsulta}</button>
      </form>
      <VistaPortal
        datos={datos}
        idioma={idioma}
        urlReclamo="/portal/reclamo"
        urlDescarga={(id) => `/portal/descargar/${id}`}
      />
    </>
  );
}
