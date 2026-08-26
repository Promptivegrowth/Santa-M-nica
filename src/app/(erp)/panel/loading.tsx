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
      <EsqueletoKpi cantidad={6} />
      <EsqueletoKpi cantidad={3} />
      <div className="rejilla-ancha" style={{ marginBottom: '.85rem' }}>
        <EsqueletoGrafico altura="230px" />
        <EsqueletoGrafico altura="180px" />
      </div>
      <EsqueletoGrafico altura="150px" />
      <div className="rejilla-2" style={{ marginTop: '.85rem' }}>
        <EsqueletoTabla filas={6} columnas={3} conFiltros={false} />
        <EsqueletoTabla filas={6} columnas={5} conFiltros={false} />
      </div>
      <span className="sr-solo" role="status">Cargando información…</span>
    </>
  );
}
