/**
 * Esqueleto de carga de esta pantalla.
 * Su forma imita la de la pantalla real para que nada salte de sitio al llegar.
 */
import { EsqueletoCabecera, EsqueletoKpi, EsqueletoTabla } from '@/components/ui/Esqueleto';

export default function Cargando() {
  return (
    <>
      <EsqueletoCabecera />
      <EsqueletoKpi />
      <EsqueletoTabla filas={16} columnas={11} />
      <span className="sr-solo" role="status">Cargando los movimientos…</span>
    </>
  );
}
