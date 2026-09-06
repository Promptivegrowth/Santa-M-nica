'use client';

/**
 * ============================================================================
 *  LA FIRMA ESCANEADA DE QUIEN FIRMA LAS PROFORMAS
 * ============================================================================
 *  Un contrato de venta lleva la firma de la persona que se obliga en nombre
 *  de la empresa. Esta pantalla la sube, la enseña y la quita.
 *
 *  POR QUÉ SE CONVIERTE AQUÍ Y NO SE SUBE EL ARCHIVO
 *  Porque montar almacenamiento de archivos —un bucket, sus permisos, sus
 *  copias de seguridad— para guardar UNA imagen de treinta kilobytes es
 *  desproporcionado. La firma se convierte en el navegador a texto incrustado
 *  y se guarda como un parámetro más, con las mismas reglas: la cambia quien
 *  puede cambiar los datos de la empresa, y viaja en la copia de seguridad de
 *  la base.
 *
 *  LO QUE SE COMPRUEBA ANTES DE GUARDAR
 *   · Que sea una imagen, y de un formato que el generador de PDF sepa dibujar
 *     —PNG o JPEG—. El SVG y el WebP se ven bien en pantalla y salen en blanco
 *     en el documento, que es la peor forma de fallar.
 *   · Que no pese demasiado. Un parámetro es un campo de texto, no un archivo:
 *     una foto de móvil de cuatro megas no tiene nada que hacer ahí, y además
 *     una firma no necesita esa resolución.
 * ============================================================================
 */
import { useRef, useState, useTransition } from 'react';
import { guardarParametro } from './acciones';

/**
 * Tope de tamaño del archivo original. Una firma recortada y en blanco y negro
 * pesa entre veinte y cien kilobytes; medio mega es holgado y deja fuera la
 * foto de móvil sin recortar.
 */
const MAXIMO_BYTES = 512 * 1024;

/** Lo que pdfkit sabe dibujar. Ni SVG ni WebP: saldrían en blanco en el PDF. */
const FORMATOS = ['image/png', 'image/jpeg'];

export function SubirFirma({
  valorInicial,
  editable,
}: {
  valorInicial: string;
  editable: boolean;
}) {
  const [firma, setFirma] = useState(valorInicial);
  const [estado, setEstado] = useState<{ ok: boolean; mensaje: string } | null>(null);
  const [pendiente, iniciar] = useTransition();
  const entrada = useRef<HTMLInputElement>(null);

  const avisar = (ok: boolean, mensaje: string) => {
    setEstado({ ok, mensaje });
    if (ok) setTimeout(() => setEstado(null), 4000);
  };

  function elegir(archivo: File | undefined) {
    if (!archivo) return;

    if (!FORMATOS.includes(archivo.type)) {
      avisar(false, `«${archivo.type || 'ese formato'}» no sirve para el PDF. Guarde la firma como PNG o JPG y vuelva a intentarlo.`);
      return;
    }
    if (archivo.size > MAXIMO_BYTES) {
      const pesa = Math.round(archivo.size / 1024);
      avisar(false, `La imagen pesa ${pesa} KB y el máximo son ${MAXIMO_BYTES / 1024} KB. Recorte la firma dejando solo el trazo: no hace falta más resolución.`);
      return;
    }

    const lector = new FileReader();
    lector.onerror = () => avisar(false, 'No se pudo leer el archivo. Pruebe con otro.');
    lector.onload = () => {
      const dato = String(lector.result ?? '');
      if (!dato.startsWith('data:image/')) {
        avisar(false, 'El archivo no parece una imagen.');
        return;
      }
      iniciar(async () => {
        const r = await guardarParametro('firmante_firma', dato);
        if (r.ok) setFirma(dato);
        avisar(r.ok, r.ok ? 'Firma guardada. Las próximas proformas saldrán con ella.' : r.mensaje);
      });
    };
    lector.readAsDataURL(archivo);
  }

  function quitar() {
    iniciar(async () => {
      const r = await guardarParametro('firmante_firma', '');
      if (r.ok) setFirma('');
      avisar(r.ok, r.ok ? 'Firma quitada. La proforma saldrá con la raya para firmar a mano.' : r.mensaje);
    });
  }

  return (
    <div className="subir-firma">
      {firma ? (
        <div className="subir-firma-muestra">
          {/*
            Se usa <img> y no el componente de imágenes de Next porque el
            optimizador no sabe qué hacer con una imagen incrustada: no tiene
            URL que optimizar ni tamaño que deducir.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={firma} alt="Firma de quien firma las proformas" />
        </div>
      ) : (
        <p className="subir-firma-vacio">
          Sin firma escaneada. La proforma sale con la raya para firmarla a mano,
          que es igual de válido.
        </p>
      )}

      {editable && (
        <div className="subir-firma-acciones">
          <input
            ref={entrada}
            type="file"
            accept={FORMATOS.join(',')}
            hidden
            onChange={(e) => {
              elegir(e.target.files?.[0]);
              // Se limpia para que volver a elegir el MISMO archivo dispare el
              // evento: si no, corregir y reintentar no hace nada y parece roto.
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="btn btn-secundario"
            disabled={pendiente}
            onClick={() => entrada.current?.click()}
          >
            {pendiente ? 'Guardando…' : firma ? 'Cambiar firma' : 'Subir firma'}
          </button>
          {firma && (
            <button type="button" className="btn btn-sutil" disabled={pendiente} onClick={quitar}>
              Quitar
            </button>
          )}
        </div>
      )}

      {estado && (
        <p className={estado.ok ? 'subir-firma-ok' : 'subir-firma-error'}>{estado.mensaje}</p>
      )}

      <style jsx>{`
        .subir-firma { display: flex; flex-direction: column; gap: 0.45rem; }
        .subir-firma-muestra {
          /* Cuadros: una firma es un trazo oscuro sobre fondo transparente y
             sin un fondo claro detrás no se vería en el tema oscuro. */
          background:
            linear-gradient(45deg, #eee 25%, transparent 25%, transparent 75%, #eee 75%),
            linear-gradient(45deg, #eee 25%, #fff 25%, #fff 75%, #eee 75%);
          background-size: 12px 12px;
          background-position: 0 0, 6px 6px;
          border: 1px solid var(--linea);
          border-radius: 4px;
          padding: 0.35rem;
          width: fit-content;
        }
        .subir-firma-muestra :global(img) { display: block; max-height: 60px; width: auto; }
        .subir-firma-vacio { margin: 0; font-size: 0.74rem; color: var(--tinta-3); max-width: 34rem; }
        .subir-firma-acciones { display: flex; gap: 0.4rem; }
        .subir-firma-ok { margin: 0; font-size: 0.72rem; color: var(--ok); }
        .subir-firma-error { margin: 0; font-size: 0.72rem; color: var(--critico); max-width: 34rem; }
      `}</style>
    </div>
  );
}
