'use client';

/**
 * ============================================================================
 *  DESCARGAR EL REPORTE · Excel y PDF, con los filtros que hay en pantalla
 * ============================================================================
 *  LA IDEA CLAVE: lo que se descarga es lo que se está viendo.
 *
 *  Los filtros de estas pantallas viven en la dirección web. Este botón los
 *  lee de ahí y se los pasa tal cual a la API. Así, si el usuario acotó a una
 *  bodega y a marzo, el archivo trae esa bodega y ese marzo, y además lo dice
 *  impreso en la cabecera.
 *
 *  Un botón «Exportar» que baja siempre el universo entero es peor que no
 *  tener botón: el usuario cree que descargó lo que veía, abre el archivo en
 *  otra reunión y las cifras no coinciden con las que enseñó.
 *
 *  POR QUÉ NO ES UN `<a href download>`
 *  Porque cuando el servidor responde con un error (sin permiso para ver
 *  costos, por ejemplo), un enlace se descargaría el mensaje de error como si
 *  fuera un archivo. Aquí se mira la respuesta y se enseña el motivo.
 * ============================================================================
 */
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Icono } from '@/components/estructura/Icono';

type Formato = 'excel' | 'pdf';

export function BotonesReporte({
  tipo,
  etiqueta,
  /** Filtros que no están en la URL pero deben ir al archivo igualmente. */
  extra,
}: {
  tipo: string;
  etiqueta?: string;
  extra?: Record<string, string>;
}) {
  const params = useSearchParams();
  const [bajando, setBajando] = useState<Formato | null>(null);
  const [problema, setProblema] = useState<string | null>(null);
  const [vacio, setVacio] = useState(false);

  async function descargar(formato: Formato) {
    setBajando(formato);
    setProblema(null);
    setVacio(false);

    try {
      /*
       * Se copian los parámetros de la pantalla, salvo los que solo tienen
       * sentido en la navegación: la página en la que está el usuario no debe
       * recortar el archivo, que va completo.
       */
      const p = new URLSearchParams(params.toString());
      p.delete('pagina');
      p.delete('t');
      Object.entries(extra ?? {}).forEach(([k, v]) => { if (v) p.set(k, v); });
      p.set('formato', formato);

      const r = await fetch(`/api/reportes/${tipo}?${p.toString()}`);

      if (!r.ok) {
        const cuerpo = await r.json().catch(() => ({}));
        setProblema(cuerpo.error ?? `No se pudo generar el reporte (HTTP ${r.status}).`);
        return;
      }

      if (Number(r.headers.get('x-filas') ?? 1) === 0) {
        setVacio(true);
        return;
      }

      const disposicion = r.headers.get('content-disposition') ?? '';
      const nombre =
        /filename="([^"]+)"/.exec(disposicion)?.[1] ??
        `${tipo}.${formato === 'excel' ? 'xlsx' : 'pdf'}`;

      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = nombre;
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setProblema(
        e instanceof Error
          ? `No se pudo contactar con el servidor: ${e.message}`
          : 'No se pudo contactar con el servidor.'
      );
    } finally {
      setBajando(null);
    }
  }

  const cuantosFiltros = [...new URLSearchParams(params.toString()).keys()]
    .filter((k) => k !== 'pagina' && k !== 't').length;

  return (
    <>
      <button
        type="button"
        className="btn btn-secundario"
        onClick={() => descargar('excel')}
        disabled={bajando !== null}
        title={
          cuantosFiltros > 0
            ? `Descargar en Excel lo que se ve ahora (${cuantosFiltros} filtro${cuantosFiltros === 1 ? '' : 's'} aplicado${cuantosFiltros === 1 ? '' : 's'})`
            : 'Descargar en Excel'
        }
      >
        <Icono nombre="descargar" tamano={15} />
        {bajando === 'excel' ? 'Generando…' : `Excel${etiqueta ? ' · ' + etiqueta : ''}`}
      </button>

      <button
        type="button"
        className="btn btn-secundario"
        onClick={() => descargar('pdf')}
        disabled={bajando !== null}
        title={
          cuantosFiltros > 0
            ? `Descargar en PDF lo que se ve ahora (${cuantosFiltros} filtro${cuantosFiltros === 1 ? '' : 's'} aplicado${cuantosFiltros === 1 ? '' : 's'})`
            : 'Descargar en PDF, listo para imprimir'
        }
      >
        <Icono nombre="facturas" tamano={15} />
        {bajando === 'pdf' ? 'Generando…' : 'PDF'}
      </button>

      {problema && (
        <div className="ficha-aviso ficha-aviso-critico documento-mensaje" role="alert">
          <Icono nombre="alerta" tamano={17} />
          <span>{problema}</span>
        </div>
      )}

      {vacio && (
        <div className="ficha-aviso ficha-aviso-atencion documento-mensaje" role="status">
          <Icono nombre="alerta" tamano={17} />
          <span>
            <strong>No se generó el archivo porque no hay ni una fila que exportar.</strong> Con los
            filtros puestos ahora mismo el reporte saldría vacío. Amplíe el rango de fechas o quite
            algún filtro.
          </span>
        </div>
      )}
    </>
  );
}
