/**
 * Esqueleto de carga del detalle.
 * Imita la estructura real: cabecera, indicadores, pestañas y contenido.
 */
import {
  EsqueletoCabecera, EsqueletoKpi, EsqueletoTabla,
  EsqueletoPestanas, EsqueletoFicha,
} from '@/components/ui/Esqueleto';

export default function Cargando() {
  return (
    <>
      <EsqueletoCabecera />
      <EsqueletoKpi cantidad={5} />
      <EsqueletoPestanas cantidad={11} />
      <div className="rejilla-2">
        <EsqueletoFicha lineas={7} />
        <EsqueletoFicha lineas={6} />
      </div>
      <span className="sr-solo" role="status">Cargando información…</span>
    </>
  );
}
