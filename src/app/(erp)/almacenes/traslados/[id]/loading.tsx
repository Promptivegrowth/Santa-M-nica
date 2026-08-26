/**
 * Esqueleto de carga de el traslado.
 *
 * Dibuja la MISMA estructura que tendrá la pantalla real: mismas alturas,
 * mismas columnas, mismo número de bloques. Así el contenido no salta cuando
 * llegan los datos, que es lo que hace que una carga se perciba lenta aunque
 * dure exactamente lo mismo.
 */
import { EsqueletoCabecera, EsqueletoKpi, EsqueletoTabla, EsqueletoFicha } from '@/components/ui/Esqueleto';

export default function Cargando() {
  return (
    <>
      <EsqueletoCabecera />
      <EsqueletoKpi cantidad={4} />
      <EsqueletoFicha lineas={2} />
      <div className="rejilla-2">
        <EsqueletoFicha lineas={6} />
        <EsqueletoFicha lineas={4} />
      </div>
      <EsqueletoTabla filas={5} columnas={8} />
      <span className="sr-solo" role="status">Cargando información…</span>
    </>
  );
}
