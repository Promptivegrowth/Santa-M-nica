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
      <EsqueletoKpi cantidad={4} />
      <div className="mb-espacio"><EsqueletoFicha lineas={6} /></div>
      <EsqueletoTabla filas={9} columnas={10} conFiltros={false} />
      <span className="sr-solo" role="status">Cargando información…</span>
    </>
  );
}
