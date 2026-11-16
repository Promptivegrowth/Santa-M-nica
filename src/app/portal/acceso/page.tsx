import { redirect } from 'next/navigation';
import { idiomaPortal, sesionPortal, portalConfigurado } from '@/lib/portal/servidor';
import { textos } from '@/lib/portal/textos';
import { FormularioIngreso } from './FormularioIngreso';

/** Login de la cuenta de seguimiento. Con sesión abierta, directo a la búsqueda. */
export default async function AccesoPortal() {
  const [idioma, sesion] = await Promise.all([idiomaPortal(), sesionPortal()]);
  if (sesion.ok) redirect('/portal');
  const t = textos(idioma);

  return (
    <div className="pt-caja-central">
      <section className="pt-tarjeta">
        <h1>{t.accesoTitulo}</h1>
        <p className="pt-ayuda">{t.accesoAyuda}</p>
        {portalConfigurado()
          ? <FormularioIngreso idioma={idioma} />
          : <p className="pt-aviso pt-aviso-atencion" role="status">{t.noConfigurado}</p>}
      </section>
    </div>
  );
}
