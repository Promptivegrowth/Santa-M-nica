/**
 * Tras iniciar sesión, el cliente SOLO ve este cuadro de búsqueda (BPMN v4,
 * punto 3). Nada de la cuenta se muestra antes de validar los 3 datos.
 */
import { redirect } from 'next/navigation';
import { idiomaPortal, sesionPortal } from '@/lib/portal/servidor';
import { textos } from '@/lib/portal/textos';
import { pedirCaptcha } from './acciones';
import { FormularioBusqueda } from './FormularioBusqueda';

export default async function BusquedaPortal() {
  const [idioma, sesion] = await Promise.all([idiomaPortal(), sesionPortal()]);
  if (!sesion.ok) redirect('/portal/acceso');
  const t = textos(idioma);
  const captcha = await pedirCaptcha();

  return (
    <div className="pt-caja-central pt-caja-busqueda">
      <section className="pt-tarjeta">
        <h1>{t.buscarTitulo}</h1>
        <p className="pt-ayuda">{t.buscarAyuda}</p>
        {sesion.consulta && (
          <p className="pt-aviso pt-aviso-ok"><a href="/portal/consulta">{t.volverProforma} →</a></p>
        )}
        <FormularioBusqueda idioma={idioma} captchaInicial={captcha} bloqueadoHasta={sesion.bloqueada_hasta ?? null} />
      </section>
    </div>
  );
}
