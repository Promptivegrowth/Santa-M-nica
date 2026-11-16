'use client';

/**
 * ============================================================================
 *  «CERRAR CON PDF DE RESPUESTA»
 * ============================================================================
 *  El PDF sube directo del navegador al almacenamiento (bucket «reclamos»,
 *  carpeta respuestas/<id>/): no pasa por el servidor de la aplicación, que
 *  tiene un límite de tamaño por petición. Luego el servidor cierra el
 *  reclamo y manda el correo. Si el cierre falla, el PDF subido se borra.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { crearClienteNavegador } from '@/lib/supabase/navegador';
import { accionSegura } from '@/lib/accionSegura';
import { cerrarReclamo, descartarRespuesta, type Resultado } from '../acciones';

const MAX_MB = 50;

function nombreSeguro(nombre: string): string {
  const base = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\.pdf$/i, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'respuesta';
  return `${base}.pdf`;
}

export function CerrarReclamo({
  id,
  numero,
  contenedores,
  contenedorReclamo,
  bloqueo,
}: {
  id: number;
  numero: string;
  contenedores: { id: number; referencia: string }[];
  contenedorReclamo: number | null;
  bloqueo: string | null;
}) {
  const router = useRouter();
  const [archivo, setArchivo] = useState<File | null>(null);
  const [alcance, setAlcance] = useState<'proforma' | 'contenedor'>(contenedorReclamo ? 'contenedor' : 'proforma');
  const [packing, setPacking] = useState<number | null>(contenedorReclamo ?? contenedores[0]?.id ?? null);
  const [conclusion, setConclusion] = useState('');
  const [fase, setFase] = useState<'' | 'subiendo' | 'cerrando'>('');
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [, iniciar] = useTransition();
  const ocupado = fase !== '' || !!bloqueo;

  function problema(): string | null {
    if (!archivo) return 'Elija el PDF de respuesta.';
    if (archivo.type !== 'application/pdf' && !/\.pdf$/i.test(archivo.name)) return 'La respuesta tiene que ser un PDF.';
    if (archivo.size > MAX_MB * 1024 * 1024) return `El PDF pesa más de ${MAX_MB} MB.`;
    if (conclusion.trim().length < 10) return 'Escriba la conclusión que recibirá el cliente (al menos 10 caracteres).';
    if (alcance === 'contenedor' && !packing) return 'Elija el contenedor de la respuesta.';
    return null;
  }

  function cerrar(e: React.FormEvent) {
    e.preventDefault();
    const p = problema();
    if (p) { setResultado({ ok: false, mensaje: p }); return; }
    if (!confirm(`¿Cerrar el reclamo ${numero}? El cliente recibirá la conclusión y el PDF por correo, y ya no se podrá editar.`)) return;

    iniciar(async () => {
      setResultado(null);
      setFase('subiendo');
      const f = archivo!;
      const nombre = nombreSeguro(f.name);
      const ruta = `respuestas/${id}/${crypto.randomUUID().slice(0, 8)}-${nombre}`;
      const { error } = await crearClienteNavegador().storage.from('reclamos')
        .upload(ruta, f, { contentType: 'application/pdf', upsert: false });
      if (error) {
        setFase('');
        setResultado({ ok: false, mensaje: `No se pudo subir el PDF: ${error.message}. Revise su conexión e inténtelo de nuevo.` });
        return;
      }
      setFase('cerrando');
      const r = await accionSegura(() => cerrarReclamo(id, {
        ruta, nombre, tamano: f.size, alcance, packing_list_id: alcance === 'contenedor' ? packing : null, conclusion,
      }));
      setFase('');
      if (!r.ok) {
        if (!('sinConexion' in r)) await accionSegura(() => descartarRespuesta(id, ruta));
        setResultado({ ok: false, mensaje: r.mensaje });
        return;
      }
      setResultado(r);
      router.refresh();
    });
  }

  return (
    <form onSubmit={cerrar} data-formulario="cerrar-reclamo">
      {bloqueo && <p className="form-mensaje error" style={{ margin: '1rem 1rem 0' }}>{bloqueo}</p>}
      <div className="form-rejilla">
        <label className="form-campo">
          <span>PDF de respuesta <b className="req">*</b></span>
          <input className="campo" type="file" accept="application/pdf,.pdf" disabled={ocupado}
                 onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); setResultado(null); }} />
          <small>Con la trazabilidad del reclamo. Hasta {MAX_MB} MB.</small>
        </label>
        <label className="form-campo">
          <span>La respuesta es por</span>
          <select className="campo" value={alcance} disabled={ocupado}
                  onChange={(e) => setAlcance(e.target.value as 'proforma' | 'contenedor')}>
            <option value="proforma">Toda la proforma</option>
            <option value="contenedor" disabled={!contenedores.length}>Un contenedor</option>
          </select>
        </label>
        {alcance === 'contenedor' && (
          <label className="form-campo">
            <span>Contenedor</span>
            <select className="campo" value={packing ?? ''} disabled={ocupado} onChange={(e) => setPacking(Number(e.target.value))}>
              {contenedores.map((c) => <option key={c.id} value={c.id}>{c.referencia}</option>)}
            </select>
          </label>
        )}
        <label className="form-campo form-ancho">
          <span>Conclusión para el cliente <b className="req">*</b></span>
          <textarea className="campo" rows={4} value={conclusion} disabled={ocupado} maxLength={4000}
                    onChange={(e) => { setConclusion(e.target.value); setResultado(null); }}
                    placeholder="Lo que se concluyó y qué se hará. Va en el correo de cierre y en el portal." />
        </label>
      </div>
      <div style={{ padding: '0 1rem 1rem' }}>
        <button type="submit" className="btn btn-primario" disabled={ocupado} data-accion="cerrar-reclamo">
          {fase === 'subiendo' ? 'Subiendo el PDF…' : fase === 'cerrando' ? 'Cerrando y enviando el correo…' : 'Cerrar con PDF de respuesta'}
        </button>
        {resultado && (
          <div role={resultado.ok ? 'status' : 'alert'} data-aviso="cerrar-reclamo">
            <p className={`form-mensaje ${resultado.ok ? 'ok' : 'error'}`}>{resultado.mensaje}</p>
            {resultado.correo && (
              <p className={`form-mensaje ${resultado.correo.estado === 'enviado' ? 'ok' : 'error'}`}
                 style={resultado.correo.estado === 'simulado' ? { background: 'var(--atencion-suave)', color: 'var(--atencion)', borderColor: 'transparent' } : undefined}>
                {resultado.correo.mensaje}
              </p>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
