/**
 * Esqueleto de carga de las reservas.
 *
 * Dibuja la MISMA estructura que tendrá la pantalla real: mismas alturas,
 * mismas columnas, mismo número de bloques. Así el contenido no salta cuando
 * llegan los datos, que es lo que hace que una carga se perciba lenta aunque
 * dure exactamente lo mismo.
 */
import { EsqueletoCabecera, EsqueletoKpi, EsqueletoTabla } from '@/components/ui/Esqueleto';

export default function Cargando() {
  return (
    <>
      <EsqueletoCabecera />
      <EsqueletoKpi cantidad={4} />
      <EsqueletoTabla filas={10} columnas={11} />
      <span className="sr-solo" role="status">Cargando información…</span>
    </>
  );
}
