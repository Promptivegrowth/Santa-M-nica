'use client';

/**
 * ============================================================================
 *  ALGO FALLÓ AL CARGAR ESTA PANTALLA
 * ============================================================================
 *  Frontera de error del ERP. Si una pantalla revienta —se cayó la conexión a
 *  la base, una consulta devolvió algo inesperado— el usuario ve esto en lugar
 *  de una página en blanco o un volcado técnico en inglés.
 *
 *  Dos cosas importan aquí:
 *
 *   1. QUE HAYA UNA SALIDA. El botón «Reintentar» vuelve a montar la pantalla
 *      sin recargar toda la aplicación; la mayoría de fallos de red se
 *      resuelven a la primera.
 *
 *   2. QUE SE PUEDA REPORTAR. Se muestra el identificador técnico del error
 *      (el «digest»), que es lo que permite encontrarlo en los registros del
 *      servidor. Sin ese dato, un aviso a soporte es «no funciona».
 * ============================================================================
 */
import { useEffect } from 'react';
import Link from 'next/link';
import { Icono } from '@/components/estructura/Icono';

export default function ErrorPantalla({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Queda en la consola del navegador para quien esté depurando; el detalle
    // completo vive en los registros del servidor, asociado al mismo digest.
    console.error('Fallo al renderizar la pantalla:', error);
  }, [error]);

  return (
    <div className="pagina-estado">
      <span className="pagina-estado-icono" data-tono="critico" aria-hidden>
        <Icono nombre="alerta" tamano={30} />
      </span>

      <h1>No se pudo cargar esta pantalla</h1>

      <p>
        Fue un fallo al recuperar la información, no un dato perdido: nada de lo que estaba
        guardado se ha alterado. Lo más probable es que se cortara la conexión con la base de datos
        un instante.
      </p>

      <div className="pagina-estado-acciones">
        <button type="button" className="btn btn-primario" onClick={reset}>
          <Icono nombre="traslados" tamano={15} />
          Reintentar
        </button>
        <Link href="/panel" className="btn btn-secundario">
          <Icono nombre="panel" tamano={15} />
          Ir al panel
        </Link>
      </div>

      {error.digest && (
        <p className="pagina-estado-pie">
          Si vuelve a ocurrir, avise a soporte con este código:{' '}
          <code className="mono">{error.digest}</code>
        </p>
      )}
    </div>
  );
}
