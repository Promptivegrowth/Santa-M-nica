'use client';

/**
 * ============================================================================
 *  SUBIR LA PLANTILLA LLENA
 * ============================================================================
 *  Lo usan las dos importaciones (ingresos y traslados). Se elige el archivo,
 *  se sube, y al terminar se abre la revisión fila por fila. Un corte de red
 *  no rompe la pantalla: vuelve como un mensaje y el archivo sigue elegido.
 *
 *  13/11 · Si no se puede cargar, lo dice como tarjeta (AvisoCarga): el TIPO
 *  de fallo, qué pasó, qué hacer y los datos del intento (archivo, tamaño,
 *  hora y, si fue el servidor, la referencia para soporte).
 * ============================================================================
 */
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icono } from '@/components/estructura/Icono';
import { accionSegura } from '@/lib/accionSegura';
import type { FalloCarga } from '@/lib/falloCarga';
import { AvisoCarga, type IntentoCarga } from '@/components/ui/AvisoCarga';

const MAXIMO_BYTES = 950 * 1024;

const pesoLegible = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

export function SubirArchivo({
  accion,
  rutaRevision,
  textoBoton = 'Subir y revisar',
  pista = 'Solo se lee el archivo y se revisa cada fila: no entra nada al stock hasta registrar.',
}: {
  accion: (f: FormData) => Promise<{ ok: true; id: number; mensaje: string } | FalloCarga>;
  /** Adónde ir al terminar: se le agrega el número de la importación. */
  rutaRevision: string;
  textoBoton?: string;
  /** La nota bajo el botón: cada importación explica lo suyo (ingresos y traslados no siguen el mismo circuito). */
  pista?: string;
}) {
  const router = useRouter();
  const [subiendo, iniciar] = useTransition();
  const [archivo, setArchivo] = useState<File | null>(null);
  const [problema, setProblema] = useState<(FalloCarga & { intento: IntentoCarga }) | null>(null);
  const entrada = useRef<HTMLInputElement>(null);

  const intento = (f: File, referencia?: string): IntentoCarga => ({
    archivo: f.name, bytes: f.size, referencia,
    hora: new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false }),
  });

  function elegir(f: File | undefined) {
    setProblema(null);
    if (!f) { setArchivo(null); return; }
    if (!/\.xlsx$/i.test(f.name)) {
      const ext = /\.([a-z0-9]+)$/i.exec(f.name)?.[1]?.toUpperCase();
      setProblema({ ok: false, tipo: 'archivo', intento: intento(f),
        mensaje: `«${f.name}» no es un libro de Excel .xlsx${ext ? ` (es un archivo ${ext})` : ''}.` });
      setArchivo(null);
      return;
    }
    if (f.size > MAXIMO_BYTES) {
      setProblema({ ok: false, tipo: 'tamano', intento: intento(f),
        mensaje: `El archivo pesa ${pesoLegible(f.size)} y el máximo son ${Math.round(MAXIMO_BYTES / 1024)} KB.` +
          (f.size > 5 * 1024 * 1024 ? ' Por su tamaño parece la base completa, no una carga de ingresos o traslados.' : ' Divídalo en dos.') });
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
      if (!r.ok) { setProblema({ ...r, intento: intento(archivo, r.referencia) }); return; }
      router.push(`${rutaRevision}/${r.id}?subida=1`);
    });
  }

  return (
    <div data-bloque="subir-archivo">
      {problema && <AvisoCarga tipo={problema.tipo} mensaje={problema.mensaje} intento={problema.intento} />}
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
