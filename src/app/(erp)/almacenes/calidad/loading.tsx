/**
 * Esqueleto de carga de esta pantalla.
 * Next.js lo muestra automáticamente mientras el servidor resuelve los datos.
 * Su forma imita la de la pantalla real para que nada salte de sitio al llegar.
 */
import { EsqueletoCabecera, EsqueletoKpi, EsqueletoTabla, EsqueletoGrafico } from '@/components/ui/Esqueleto';

export default function Cargando() {
  return (
    <>
      <EsqueletoCabecera />
      <EsqueletoKpi cantidad={5} />
      <div className="mb-espacio"><EsqueletoGrafico altura="170px" /></div>
      <EsqueletoTabla filas={10} columnas={7} />
      <span className="sr-solo" role="status">Cargando información…</span>
    </>
  );
}
