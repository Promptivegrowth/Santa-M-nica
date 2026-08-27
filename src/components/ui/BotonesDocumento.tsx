'use client';

/**
 * ============================================================================
 *  DESCARGAR EL DOCUMENTO · PDF y Excel
 * ============================================================================
 *  Se monta igual en la ficha de la cotización, la del pedido y la del
 *  comprobante. Solo cambia el tipo que se le pasa.
 *
 *  POR QUÉ NO ES UN SIMPLE ENLACE
 *  Un `<a href download>` bajaría el archivo, sí, pero cuando el servidor
 *  responde que los datos no cuadran el navegador se descargaría el mensaje de
 *  error como si fuera un archivo, o abriría una pestaña con un JSON. Aquí se
 *  pide el archivo, se mira la respuesta y:
 *
 *    · si vino bien, se guarda y se avisa de las observaciones que traiga
 *    · si vino mal, se enseña EXACTAMENTE qué no cuadra, en pantalla
 *
 *  La segunda parte es la que importa. «No se pudo generar el documento» no
 *  ayuda a nadie; «el total guardado (63 380,35) no coincide con el de las
 *  líneas (183 123,09)» se puede llevar a contabilidad.
 * ============================================================================
 */
import { useState } from 'react';
import { Icono } from '@/components/estructura/Icono';

type Formato = 'pdf' | 'excel';

export function BotonesDocumento({
  tipo,
  id,
  numero,
}: {
  tipo: 'cotizacion' | 'proforma' | 'factura' | 'boleta';
  id: number;
  /** Solo para los textos: el nombre del archivo lo decide el servidor. */
  numero: string;
}) {
  const [bajando, setBajando] = useState<Formato | null>(null);
  const [problema, setProblema] = useState<{ titulo: string; detalles: string[] } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  async function descargar(formato: Formato) {
    setBajando(formato);
    setProblema(null);
    setAviso(null);

    try {
      const r = await fetch(`/api/documentos/${tipo}/${id}?formato=${formato}`);

      if (!r.ok) {
        const cuerpo = await r.json().catch(() => ({}));
        setProblema({
          titulo: cuerpo.error ?? `No se pudo generar el documento (HTTP ${r.status}).`,
          detalles: Array.isArray(cuerpo.detalles) ? cuerpo.detalles : [],
        });
        return;
      }

      /*
       * El nombre del archivo viene en la cabecera que puso el servidor, para
       * que el PDF y el Excel se llamen igual que el documento y no
       * «descarga(3).pdf».
       */
      const disposicion = r.headers.get('content-disposition') ?? '';
      const nombre =
        /filename="([^"]+)"/.exec(disposicion)?.[1] ??
        `${tipo}-${numero}.${formato === 'excel' ? 'xlsx' : 'pdf'}`;

      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = nombre;
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
      // Sin esto el navegador se queda el archivo en memoria hasta recargar.
      URL.revokeObjectURL(url);

      const cuantosAvisos = Number(r.headers.get('x-avisos') ?? 0);
      if (cuantosAvisos > 0) {
        // Concordancia de género y número: «1 observación anotada» frente a
        // «3 observaciones anotadas».
        const singular = cuantosAvisos === 1;
        setAviso(
          `El documento se descargó, pero la verificación dejó ${cuantosAvisos} ` +
            `${singular ? 'observación anotada' : 'observaciones anotadas'} dentro. ` +
            `${singular ? 'Léala' : 'Léalas'} antes de enviarlo al cliente.`
        );
      }
    } catch (e) {
      setProblema({
        titulo: 'No se pudo contactar con el servidor.',
        detalles: [e instanceof Error ? e.message : 'Compruebe su conexión y vuelva a intentarlo.'],
      });
    } finally {
      setBajando(null);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-secundario"
        onClick={() => descargar('pdf')}
        disabled={bajando !== null}
        title={`Descargar ${numero} en PDF`}
      >
        <Icono nombre="facturas" tamano={15} />
        {bajando === 'pdf' ? 'Generando…' : 'PDF'}
      </button>

      <button
        type="button"
        className="btn btn-secundario"
        onClick={() => descargar('excel')}
        disabled={bajando !== null}
        title={`Descargar ${numero} en Excel`}
      >
        <Icono nombre="descargar" tamano={15} />
        {bajando === 'excel' ? 'Generando…' : 'Excel'}
      </button>

      {/*
        Los mensajes salen debajo de la botonera, ocupando todo el ancho: un
        error de cuadre puede tener cuatro líneas y no cabe en un tooltip.
      */}
      {problema && (
        <div className="ficha-aviso ficha-aviso-critico documento-mensaje" role="alert">
          <Icono nombre="alerta" tamano={17} />
          <span>
            <strong>{problema.titulo}</strong>
            {problema.detalles.length > 0 && (
              <ul className="documento-detalles">
                {problema.detalles.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            )}
            <br />
            <small>
              El documento no se emite a propósito: un comprobante que dice algo distinto de lo que
              dice el sistema causa más problemas de los que resuelve.
            </small>
          </span>
        </div>
      )}

      {aviso && (
        <div className="ficha-aviso ficha-aviso-atencion documento-mensaje" role="status">
          <Icono nombre="alerta" tamano={17} />
          <span>{aviso}</span>
        </div>
      )}
    </>
  );
}
