/**
 * «Generar reclamo», con el N.° de proforma ya cargado (viene de la consulta
 * validada). Funciona antes y después del despacho: el contenedor es opcional.
 */
import { redirect } from 'next/navigation';
import { idiomaPortal, sesionPortal, consultaPortal } from '@/lib/portal/servidor';
import { textos } from '@/lib/portal/textos';
import { FormularioReclamo } from './FormularioReclamo';

/** 50 MB: el límite de cada archivo en el plan gratuito de Supabase (punto por confirmar en el kick off). */
const MAX_MB = 50;

export default async function ReclamoPortal() {
  const [idioma, sesion] = await Promise.all([idiomaPortal(), sesionPortal()]);
  if (!sesion.ok) redirect('/portal/acceso');
  const datos = await consultaPortal();
  if (!datos) redirect('/portal');
  if (datos.cancelada) redirect('/portal/consulta');
  const t = textos(idioma);

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <a href="/portal/consulta" className="pt-btn pt-btn-secundario pt-no-imprimir" style={{ marginBottom: '1rem' }}>
        ← {t.volverProforma}
      </a>
      <FormularioReclamo
        idioma={idioma}
        numeroProforma={datos.numero_proforma}
        motivos={datos.motivos}
        contenedores={datos.contenedores.map((c) => ({ id: c.id, referencia: c.referencia, contenedor: c.contenedor }))}
        maxMb={MAX_MB}
        supabaseUrl={process.env.NEXT_PUBLIC_SUPABASE_URL!}
        supabaseAnon={process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}
      />
    </div>
  );
}
