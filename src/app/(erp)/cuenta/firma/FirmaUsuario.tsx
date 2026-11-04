'use client';

/**
 * ============================================================================
 *  SUBIR MI FIRMA (o la de otra persona, si es Gerencia) · 083
 * ============================================================================
 *  La firma escaneada y el cargo que salen en la proforma y en el contrato de
 *  las cotizaciones que esa persona apruebe.
 *
 *  ALTA RESOLUCIÓN, PERO QUE QUEPA
 *  Oliver pidió recomendar alta resolución: una firma pixelada en un contrato
 *  se ve mal impresa. Pero una foto de móvil de cuatro megas no hace falta (en
 *  el PDF la firma ocupa unos cinco centímetros) y no cabe en el envío al
 *  servidor. Por eso se acepta la imagen grande y aquí, en el navegador, se
 *  reduce a 1600 píxeles de lado como máximo y se guarda en PNG, que conserva
 *  el fondo transparente. 1600 px en cinco centímetros son unos 800 ppp: más
 *  que suficiente para imprimir.
 * ============================================================================
 */
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { accionSegura } from '@/lib/accionSegura';
import { guardarFirmaUsuario } from './acciones';

/** Lo que pdfkit sabe dibujar. Ni SVG ni WebP: saldrían en blanco en el PDF. */
const FORMATOS = ['image/png', 'image/jpeg'];
/** El archivo original puede ser grande (alta resolución): se reduce aquí. */
const MAXIMO_ORIGINAL = 12 * 1024 * 1024;
/** Lo que viaja al servidor: el envío admite poco menos de 1 MB. */
const MAXIMO_ENVIO = 900_000;

/** Reduce la imagen a `lado` píxeles como máximo y la devuelve en PNG incrustado. */
function reducir(imagen: HTMLImageElement, lado: number): string {
  const escala = Math.min(1, lado / Math.max(imagen.naturalWidth, imagen.naturalHeight));
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.max(1, Math.round(imagen.naturalWidth * escala));
  lienzo.height = Math.max(1, Math.round(imagen.naturalHeight * escala));
  const ctx = lienzo.getContext('2d');
  if (!ctx) return '';
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
  return lienzo.toDataURL('image/png');
}

export function FirmaUsuario({
  usuarioId, nombre, firmaInicial, cargoInicial, propia,
}: {
  usuarioId: string;
  nombre: string;
  firmaInicial: string;
  cargoInicial: string;
  /** true = la del usuario que está en la sesión. */
  propia: boolean;
}) {
  const router = useRouter();
  const [firma, setFirma] = useState(firmaInicial);
  const [cargo, setCargo] = useState(cargoInicial);
  const [estado, setEstado] = useState<{ ok: boolean; mensaje: string } | null>(null);
  const [pendiente, iniciar] = useTransition();
  const entrada = useRef<HTMLInputElement>(null);

  const guardar = (nuevaFirma: string | null, nuevoCargo: string | null) => iniciar(async () => {
    const r = await accionSegura(() => guardarFirmaUsuario(usuarioId, nuevaFirma, nuevoCargo));
    setEstado({ ok: r.ok, mensaje: r.mensaje });
    if (r.ok) {
      if (nuevaFirma !== null) setFirma(nuevaFirma);
      router.refresh();
    }
  });

  function elegir(archivo: File | undefined) {
    if (!archivo) return;
    setEstado(null);
    if (!FORMATOS.includes(archivo.type)) {
      setEstado({ ok: false, mensaje: `«${archivo.type || 'ese formato'}» no sirve para el PDF. Guarde la firma como PNG o JPG y vuelva a intentarlo.` });
      return;
    }
    if (archivo.size > MAXIMO_ORIGINAL) {
      setEstado({ ok: false, mensaje: `La imagen pesa ${Math.round(archivo.size / 1024 / 1024)} MB. Recorte la firma dejando solo el trazo (hasta 12 MB).` });
      return;
    }
    const url = URL.createObjectURL(archivo);
    const imagen = new Image();
    imagen.onerror = () => { URL.revokeObjectURL(url); setEstado({ ok: false, mensaje: 'No se pudo leer la imagen. Pruebe con otro archivo.' }); };
    imagen.onload = () => {
      URL.revokeObjectURL(url);
      //  De mayor a menor resolución hasta que quepa en el envío.
      let dato = '';
      for (const lado of [1600, 1200, 900, 600]) {
        dato = reducir(imagen, lado);
        if (dato && dato.length <= MAXIMO_ENVIO) break;
      }
      if (!dato.startsWith('data:image/png') || dato.length > MAXIMO_ENVIO) {
        setEstado({ ok: false, mensaje: 'La imagen es demasiado compleja para guardarla como firma. Recorte solo el trazo, sobre fondo blanco.' });
        return;
      }
      guardar(dato, cargo);
    };
    imagen.src = url;
  }

  return (
    <div className="firma-usuario" data-firma-usuario={usuarioId}>
      <div className="firma-usuario-fila">
        {firma ? (
          <div className="firma-usuario-muestra">
            {/* Imagen incrustada: el optimizador de Next no tiene URL que optimizar. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={firma} alt={`Firma de ${nombre}`} />
          </div>
        ) : (
          <p className="firma-usuario-vacio">
            Sin firma. {propia ? 'Las proformas que usted apruebe' : `Las proformas que apruebe ${nombre}`} salen
            con la firma de Gerencia (Configuración → Parámetros).
          </p>
        )}
        <div className="firma-usuario-acciones">
          <input
            ref={entrada} type="file" accept={FORMATOS.join(',')} hidden name="firma"
            onChange={(e) => { elegir(e.target.files?.[0]); e.target.value = ''; }}
          />
          <button type="button" className="btn btn-secundario" disabled={pendiente}
                  data-accion="subir-firma" onClick={() => entrada.current?.click()}>
            {pendiente ? 'Guardando…' : firma ? 'Cambiar firma' : 'Subir firma'}
          </button>
          {firma && (
            <button type="button" className="btn btn-sutil" disabled={pendiente} data-accion="quitar-firma"
                    onClick={() => guardar('', null)}>
              Quitar
            </button>
          )}
        </div>
      </div>

      <form className="firma-usuario-cargo" onSubmit={(e) => { e.preventDefault(); guardar(null, cargo); }}>
        <label className="form-campo" style={{ flex: 1 }}>
          <span className="etiqueta">Cargo que se imprime debajo del nombre</span>
          <input className="campo" name="cargo" maxLength={120} value={cargo}
                 placeholder="Por ejemplo: Jefe Comercial y Exportaciones"
                 onChange={(e) => setCargo(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-secundario" disabled={pendiente || cargo.trim() === cargoInicial.trim()}
                title={cargo.trim() === cargoInicial.trim() ? 'No hay cambios en el cargo' : undefined}>
          Guardar cargo
        </button>
      </form>

      {estado && (
        <p role={estado.ok ? 'status' : 'alert'} className={estado.ok ? 'form-mensaje ok' : 'form-mensaje error'}>
          {estado.mensaje}
        </p>
      )}

      <style jsx>{`
        .firma-usuario { display: flex; flex-direction: column; gap: .7rem; }
        .firma-usuario-fila { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
        .firma-usuario-muestra {
          /* Cuadros: la firma es un trazo oscuro sobre fondo transparente y en
             el tema oscuro no se vería sin un fondo claro detrás. */
          background:
            linear-gradient(45deg, #eee 25%, transparent 25%, transparent 75%, #eee 75%),
            linear-gradient(45deg, #eee 25%, #fff 25%, #fff 75%, #eee 75%);
          background-size: 12px 12px;
          background-position: 0 0, 6px 6px;
          border: 1px solid var(--linea);
          border-radius: 4px;
          padding: .4rem;
        }
        .firma-usuario-muestra :global(img) { display: block; max-height: 80px; max-width: 260px; width: auto; }
        .firma-usuario-vacio { margin: 0; font-size: .8rem; color: var(--tinta-3); max-width: 30rem; }
        .firma-usuario-acciones { display: flex; gap: .4rem; }
        .firma-usuario-cargo { display: flex; gap: .6rem; align-items: flex-end; flex-wrap: wrap; max-width: 40rem; }
      `}</style>
    </div>
  );
}
