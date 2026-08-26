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
      <div className="panel mb-espacio" style={{ padding: '.85rem 1rem' }}>
        <Bloque ancho="100%" alto="2.3rem" />
      </div>
      <EsqueletoKpi cantidad={4} />
      <EsqueletoTabla filas={8} columnas={7} />
      <span className="sr-solo" role="status">Cargando información…</span>
    </>
  );
}
