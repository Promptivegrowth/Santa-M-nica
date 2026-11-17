import Image from 'next/image';
import { redirect } from 'next/navigation';
import { idiomaPortal, sesionPortal, portalConfigurado } from '@/lib/portal/servidor';
import { textos } from '@/lib/portal/textos';
import { Icono } from '@/components/estructura/Icono';
import { BarraIdioma } from '../BarraIdioma';
import { FormularioIngreso } from './FormularioIngreso';

/**
 * Login de la cuenta de seguimiento, a pantalla completa: a la izquierda la
 * marca y cómo funciona el portal; a la derecha el formulario. En el celular
 * la marca queda arriba, compacta. Con sesión abierta, directo a la búsqueda.
 */
export default async function AccesoPortal() {
  const [idioma, sesion] = await Promise.all([idiomaPortal(), sesionPortal()]);
  if (sesion.ok) redirect('/portal');
  const t = textos(idioma);

  return (
    <div className="pt-ingreso">
      <aside className="pt-ingreso-marca">
        {/* Anillos concéntricos, como las franjas del logo, casi transparentes en la esquina. */}
        <svg className="pt-ingreso-ondas" viewBox="0 0 400 400" aria-hidden="true">
          {[50, 90, 130, 170, 210, 250, 290].map((r) => <circle key={r} cx="400" cy="400" r={r} />)}
        </svg>
        <div className="pt-ingreso-logo">
          <Image src="/logo.png" alt="Santa Mónica Fishing" width={180} height={54} priority />
        </div>
        <div className="pt-ingreso-mensaje">
          <span className="pt-ingreso-etiqueta">{t.portal}</span>
          <h2>{t.ingresoLema}</h2>
          <p>{t.ingresoBajada}</p>
          <ol className="pt-ingreso-pasos">
            {t.ingresoPasos.map(([titulo, detalle], i) => (
              <li key={titulo}>
                <span className="pt-ingreso-num">{i + 1}</span>
                <span><strong>{titulo}</strong> {detalle}</span>
              </li>
            ))}
          </ol>
        </div>
        <small className="pt-ingreso-empresa">Industrial Pesquera Santa Mónica S.A.</small>
      </aside>

      <main className="pt-ingreso-lado">
        <div className="pt-ingreso-idioma">
          <BarraIdioma idioma={idioma} texto={t.idiomaOtro} />
        </div>
        <section className="pt-ingreso-form">
          <h1>{t.accesoTitulo}</h1>
          <p className="pt-ayuda">{t.accesoAyuda}</p>
          {portalConfigurado()
            ? <FormularioIngreso idioma={idioma} />
            : <p className="pt-aviso pt-aviso-atencion" role="status">{t.noConfigurado}</p>}
          <p className="pt-ingreso-ayuda">
            {t.accesoProblemas}{' '}
            <a href="mailto:comex@santamonicafishing.com">comex@santamonicafishing.com</a>
          </p>
          <p className="pt-ingreso-seguro">
            <Icono nombre="reservas" tamano={14} />
            {t.ingresoSeguro}
          </p>
        </section>
      </main>
    </div>
  );
}
