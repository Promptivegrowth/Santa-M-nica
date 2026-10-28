'use client';

/**
 * ============================================================================
 *  SUBIR LA PLANTILLA LLENA
 * ============================================================================
 *  Lo usan las dos importaciones (ingresos y traslados). Se elige el archivo,
 *  se sube, y al terminar se abre la revisión fila por fila. Un corte de red
 *  no rompe la pantalla: vuelve como un mensaje y el archivo sigue elegido.
 * ============================================================================
 */
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icono } from '@/components/estructura/Icono';
import { accionSegura } from '@/lib/accionSegura';

const MAXIMO_BYTES = 950 * 1024;

export function SubirArchivo({
  accion,
  rutaRevision,
  textoBoton = 'Subir y revisar',
  pista = 'Solo se lee el archivo y se revisa cada fila: no entra nada al stock hasta registrar.',
}: {
  accion: (f: FormData) => Promise<{ ok: true; id: number; mensaje: string } | { ok: false; mensaje: string }>;
  /** Adónde ir al terminar: se le agrega el número de la importación. */
  rutaRevision: string;
  textoBoton?: string;
  /** La nota bajo el botón: cada importación explica lo suyo (ingresos y traslados no siguen el mismo circuito). */
  pista?: string;
}) {
  const router = useRouter();
  const [subiendo, iniciar] = useTransition();
  const [archivo, setArchivo] = useState<File | null>(null);
  const [problema, setProblema] = useState<string | null>(null);
  const entrada = useRef<HTMLInputElement>(null);

  function elegir(f: File | undefined) {
    setProblema(null);
    if (!f) { setArchivo(null); return; }
    if (!/\.xlsx$/i.test(f.name)) {
      setProblema(`«${f.name}» no es un libro de Excel .xlsx. Guárdelo como «Libro de Excel (.xlsx)» y vuelva a elegirlo.`);
      setArchivo(null);
      return;
    }
    if (f.size > MAXIMO_BYTES) {
      setProblema(`El archivo pesa ${Math.round(f.size / 1024)} KB y el máximo son ${Math.round(MAXIMO_BYTES / 1024)} KB. Divídalo en dos.`);
      setArchivo(null);
      return;
    }
    setArchivo(f);
  }

  function subir() {
    if (!archivo) return;
    setProblema(null);
    iniciar(async () => {
      const datos = new FormData();
      datos.set('archivo', archivo);
      const r = await accionSegura(() => accion(datos));
      if (!r.ok) { setProblema(r.mensaje); return; }
      router.push(`${rutaRevision}/${r.id}?subida=1`);
    });
  }

  return (
    <div data-bloque="subir-archivo">
      {problema && (
        <div className="ficha-aviso ficha-aviso-critico" role="alert" style={{ marginBottom: '.8rem' }}>
          <Icono nombre="alerta" tamano={17} />
          <span>{problema}</span>
        </div>
      )}
      <div style={{ display: 'flex', gap: '.7rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <input ref={entrada} type="file" name="archivo" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
               className="campo" style={{ maxWidth: '26rem' }}
               onChange={(e) => elegir(e.target.files?.[0])} />
        <button type="button" className="btn btn-primario" disabled={!archivo || subiendo} data-accion="subir-archivo" onClick={subir}>
          <Icono nombre="ingresos" tamano={15} />
          {subiendo ? 'Leyendo el archivo…' : textoBoton}
        </button>
      </div>
      <p className="form-pista" style={{ marginTop: '.5rem' }}>
        {pista}
      </p>
    </div>
  );
}
