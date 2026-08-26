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
      <div className="panel mb-espacio">
        <div className="panel-cabecera"><Bloque ancho="7rem" alto=".7rem" /></div>
        <div className="rejilla-reportes">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="tarjeta-reporte">
              <div className="tarjeta-reporte-texto">
                <Bloque ancho="9rem" alto=".85rem" />
                <Bloque ancho="100%" alto=".7rem" />
              </div>
              <Bloque ancho="5rem" alto="1.9rem" />
            </div>
          ))}
        </div>
      </div>
      <EsqueletoTabla filas={7} columnas={1} conFiltros={false} />
      <span className="sr-solo" role="status">Cargando información…</span>
    </>
  );
}
