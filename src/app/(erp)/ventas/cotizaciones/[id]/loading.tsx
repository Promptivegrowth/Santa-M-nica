/**
 * Esqueleto de carga de la cotización.
 *
 * Dibuja la MISMA estructura que tendrá la pantalla real: mismas alturas,
 * mismas columnas, mismo número de bloques. Así el contenido no salta cuando
 * llegan los datos, que es lo que hace que una carga se perciba lenta aunque
 * dure lo mismo.
 */
import { EsqueletoCabecera, EsqueletoKpi, EsqueletoTabla, EsqueletoFicha } from '@/components/ui/Esqueleto';

export default function Cargando() {
  return (
    <>
      <EsqueletoCabecera />
      <EsqueletoFicha lineas={3} />
      <EsqueletoTabla filas={5} columnas={8} />
      <div className="rejilla-2">
        <EsqueletoFicha lineas={7} />
        <EsqueletoFicha lineas={5} />
      </div>
      <span className="sr-solo" role="status">Cargando información…</span>
    </>
  );
}
