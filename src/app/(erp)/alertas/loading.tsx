/**
 * Esqueleto de carga de esta pantalla.
 * Next.js lo muestra automáticamente mientras el servidor resuelve los datos.
 * Su forma imita la de la pantalla real para que nada salte de sitio al llegar.
 */
import { EsqueletoCabecera, EsqueletoKpi, EsqueletoTabla } from '@/components/ui/Esqueleto';

export default function Cargando() {
  return (
    <>
      <EsqueletoCabecera />
      <EsqueletoKpi cantidad={3} />
      <EsqueletoTabla filas={10} columnas={5} />
      <span className="sr-solo" role="status">Cargando información…</span>
    </>
  );
}
