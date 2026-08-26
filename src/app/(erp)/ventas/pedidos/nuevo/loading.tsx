/** Esqueleto de carga del formulario de nuevo pedido. */
import { EsqueletoCabecera, EsqueletoFicha, EsqueletoTabla } from '@/components/ui/Esqueleto';

export default function Cargando() {
  return (
    <>
      <EsqueletoCabecera />
      <div className="mb-espacio"><EsqueletoFicha lineas={5} /></div>
      <EsqueletoTabla filas={3} columnas={8} conFiltros={false} />
      <span className="sr-solo" role="status">Cargando el formulario…</span>
    </>
  );
}
