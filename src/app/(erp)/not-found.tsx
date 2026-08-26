/**
 * ============================================================================
 *  REGISTRO NO ENCONTRADO
 * ============================================================================
 *  Se llega aquí cuando se pide un identificador que no existe: un enlace
 *  antiguo, un número tecleado a mano, o un registro que alguien anuló.
 *
 *  La pantalla de error por defecto de Next.js dice «This page could not be
 *  found» sobre fondo blanco, en inglés y sin salida. Dentro de un ERP eso es
 *  un callejón sin salida. Esta versión mantiene la barra lateral, explica en
 *  castellano qué pasó y ofrece dónde seguir buscando.
 * ============================================================================
 */
import Link from 'next/link';
import { Icono } from '@/components/estructura/Icono';

export default function NoEncontrado() {
  return (
    <div className="pagina-estado">
      <span className="pagina-estado-icono" aria-hidden>
        <Icono nombre="buscar" tamano={30} />
      </span>

      <h1>No encontramos ese registro</h1>

      <p>
        El número que buscaba no existe o dejó de existir. Suele pasar con enlaces guardados de
        registros que después se anularon, o cuando se teclea un identificador a mano.
      </p>

      <div className="pagina-estado-acciones">
        <Link href="/trazabilidad" className="btn btn-primario">
          <Icono nombre="trazabilidad" tamano={15} />
          Buscarlo por su código
        </Link>
        <Link href="/panel" className="btn btn-secundario">
          <Icono nombre="panel" tamano={15} />
          Ir al panel
        </Link>
      </div>

      <p className="pagina-estado-pie">
        El buscador universal encuentra por código de pallet, lote, proforma, factura, contenedor o
        cliente. Si tiene cualquiera de esos datos, por ahí llegará.
      </p>
    </div>
  );
}
