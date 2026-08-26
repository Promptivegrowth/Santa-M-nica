/**
 * Esqueleto de carga de el embarque.
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
      <EsqueletoKpi cantidad={5} />
      <div className="rejilla-2">
        <EsqueletoFicha lineas={8} />
        <EsqueletoFicha lineas={3} />
      </div>
      <EsqueletoTabla filas={5} columnas={8} />
      <span className="sr-solo" role="status">Cargando información…</span>
    </>
  );
}
