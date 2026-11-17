'use client';

/**
 * ============================================================================
 *  «ATENDER» UN RECLAMO · revisión, clasificación, plazo, causa y acciones
 * ============================================================================
 *  Al elegir la clasificación se ve el plazo que fija (Crítico 5 días…); la
 *  fecha límite la calcula la base desde el día del reclamo. Quien no es de
 *  Calidad ni Gerencia lo ve apagado y con el motivo.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { accionSegura } from '@/lib/accionSegura';
import { actualizarReclamo, type DatosAtencion } from '../acciones';

export function AtenderReclamo({
  id,
  inicial,
  clasificaciones,
  responsables,
  bloqueo,
}: {
  id: number;
  inicial: DatosAtencion;
  clasificaciones: { id: number; nombre: string; plazo_dias: number }[];
  /** Usuarios activos de Calidad y Gerencia: los que pueden atender el reclamo. */
  responsables: { id: string; nombre: string; rol: string }[];
  /** Por qué no puede editar, o null. */
  bloqueo: string | null;
}) {
  const router = useRouter();
  const [d, setD] = useState<DatosAtencion>(inicial);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, iniciar] = useTransition();
  const apagado = !!bloqueo || pendiente;
  const cambiar = <K extends keyof DatosAtencion>(k: K, v: DatosAtencion[K]) => { setD({ ...d, [k]: v }); setAviso(null); };

  function guardar(e: React.FormEvent) {
    e.preventDefault();
    iniciar(async () => {
      const r = await accionSegura(() => actualizarReclamo(id, d));
      setAviso({ ok: r.ok, texto: r.mensaje });
      if (r.ok) { setD({ ...d, nota: '' }); router.refresh(); }
    });
  }

  return (
    <form onSubmit={guardar} data-formulario="atender-reclamo">
      {bloqueo && <p className="form-mensaje error" style={{ margin: '1rem 1rem 0' }}>{bloqueo}</p>}
      <div className="form-rejilla">
        <label className="form-campo">
          <span>Estado</span>
          <select className="campo" value={d.estado} disabled={apagado}
                  onChange={(e) => cambiar('estado', e.target.value as DatosAtencion['estado'])}>
            <option value="pendiente">Pendiente</option>
            <option value="en_revision">En revisión</option>
            <option value="en_investigacion">En investigación</option>
          </select>
          <small>Para cerrarlo, use «Cerrar con PDF de respuesta».</small>
        </label>
        <label className="form-campo">
          <span>Clasificación y plazo</span>
          <select className="campo" value={d.clasificacion_id ?? ''} disabled={apagado}
                  onChange={(e) => cambiar('clasificacion_id', e.target.value ? Number(e.target.value) : null)}>
            <option value="">Sin clasificar</option>
            {clasificaciones.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre} · {c.plazo_dias} día{c.plazo_dias === 1 ? '' : 's'}</option>
            ))}
          </select>
          <small>La fecha límite se cuenta desde el día en que se registró el reclamo.</small>
        </label>
        <label className="form-campo">
          <span>Responsable</span>
          <select className="campo" value={d.responsable_id ?? ''} disabled={apagado} data-campo="responsable"
                  onChange={(e) => cambiar('responsable_id', e.target.value || null)}>
            <option value="">Sin asignar (queda quien guarde)</option>
            {responsables.map((u) => (
              <option key={u.id} value={u.id}>{u.nombre} · {u.rol === 'gerencia' ? 'Gerencia' : 'Calidad'}</option>
            ))}
          </select>
          <small>Quién investiga y responde al cliente.</small>
        </label>
        <label className="form-campo form-ancho">
          <span>Causa</span>
          <textarea className="campo" rows={3} value={d.causa} disabled={apagado}
                    onChange={(e) => cambiar('causa', e.target.value)} placeholder="Qué originó el problema, según la investigación" />
        </label>
        <label className="form-campo form-ancho">
          <span>Acciones correctivas</span>
          <textarea className="campo" rows={3} value={d.acciones} disabled={apagado}
                    onChange={(e) => cambiar('acciones', e.target.value)} placeholder="Qué se hará para corregirlo y que no se repita" />
        </label>
        <label className="form-campo form-ancho">
          <span>Nota para el historial (opcional)</span>
          <input className="campo" value={d.nota} disabled={apagado} maxLength={500}
                 onChange={(e) => cambiar('nota', e.target.value)} />
        </label>
      </div>
      <div style={{ padding: '0 1rem 1rem', display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="submit" className="btn btn-primario" disabled={apagado} data-accion="guardar-atencion">
          {pendiente ? 'Guardando…' : 'Guardar atención'}
        </button>
        {aviso && (
          <span role={aviso.ok ? 'status' : 'alert'} style={{ fontSize: '.85rem', color: aviso.ok ? 'var(--ok)' : 'var(--critico)' }}>
            {aviso.texto}
          </span>
        )}
      </div>
    </form>
  );
}
