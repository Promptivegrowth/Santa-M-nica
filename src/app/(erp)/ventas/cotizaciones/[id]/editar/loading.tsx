/**
 * Esqueleto de carga de el formulario de edición.
 *
 * Dibuja la MISMA estructura que tendrá la pantalla real: mismas alturas,
 * mismas columnas, mismo número de bloques. Así el contenido no salta cuando
 * llegan los datos, que es lo que hace que una carga se perciba lenta aunque
 * dure exactamente lo mismo.
 */
import { EsqueletoCabecera, EsqueletoFicha, EsqueletoTabla } from '@/components/ui/Esqueleto';

export default function Cargando() {
  return (
    <>
      <EsqueletoCabecera />
      <EsqueletoFicha lineas={6} />
      <EsqueletoTabla filas={4} columnas={7} />
      <span className="sr-solo" role="status">Cargando información…</span>
    </>
  );
}
