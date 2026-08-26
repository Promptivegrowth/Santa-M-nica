/**
 * Esqueleto de carga de esta pantalla.
 * Next.js lo muestra automáticamente mientras el servidor resuelve los datos.
 * Su forma imita la de la pantalla real para que nada salte de sitio al llegar.
 */
import {
  EsqueletoCabecera, EsqueletoKpi, EsqueletoTabla,
  EsqueletoGrafico, EsqueletoPestanas, Bloque,
} from '@/components/ui/Esqueleto';

export default function Cargando() {
  return (
    <>
      <EsqueletoCabecera />
      <EsqueletoPestanas cantidad={8} />
      <EsqueletoTabla filas={10} columnas={4} />
      <span className="sr-solo" role="status">Cargando información…</span>
    </>
  );
}
