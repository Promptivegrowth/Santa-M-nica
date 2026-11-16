'use client';

/**
 * ============================================================================
 *  EDITORES DE «PORTAL Y RECLAMOS»
 * ============================================================================
 *  Una fila = un registro, con su propio botón Guardar y su propio aviso:
 *  cambiar el plazo de una clasificación no obliga a tocar las demás. Quien
 *  no tiene permiso ve los campos apagados (la base lo vuelve a impedir).
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { accionSegura } from '@/lib/accionSegura';
import {
  guardarMotivo, guardarClasificacion, guardarPlantilla, guardarHito, cambiarClavePortal,
  type Motivo, type Clasificacion, type Resultado,
} from './acciones';

function useGuardar() {
  const router = useRouter();
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, iniciar] = useTransition();
  const guardar = (accion: () => Promise<Resultado>, alGuardar?: () => void) => {
    setAviso(null);
    iniciar(async () => {
      const r = await accionSegura(accion);
      setAviso({ ok: r.ok, texto: r.mensaje });
      if (r.ok) { alGuardar?.(); router.refresh(); }
    });
  };
  return { aviso, setAviso, pendiente, guardar };
}

function Aviso({ aviso }: { aviso: { ok: boolean; texto: string } | null }) {
  if (!aviso) return null;
  return (
    <small role={aviso.ok ? 'status' : 'alert'} style={{ display: 'block', color: aviso.ok ? 'var(--ok)' : 'var(--critico)', marginTop: '.25rem' }}>
      {aviso.texto}
    </small>
  );
}

/* ─────────── Motivos ─────────── */
function FilaMotivo({ inicial, puede }: { inicial: Motivo; puede: boolean }) {
  const [m, setM] = useState(inicial);
  const { aviso, pendiente, guardar } = useGuardar();
  const nuevo = inicial.id === null;
  const apagado = !puede || pendiente;
  return (
    <tr>
      <td><input className="campo" value={m.nombre_es} disabled={apagado} placeholder={nuevo ? 'Nuevo motivo' : ''}
                 onChange={(e) => setM({ ...m, nombre_es: e.target.value })} /></td>
      <td><input className="campo" value={m.nombre_en} disabled={apagado} placeholder={nuevo ? 'In English' : ''}
                 onChange={(e) => setM({ ...m, nombre_en: e.target.value })} /></td>
      <td style={{ width: '5rem' }}><input className="campo mono" type="number" value={m.orden} disabled={apagado}
                 onChange={(e) => setM({ ...m, orden: Number(e.target.value) })} /></td>
      <td style={{ textAlign: 'center' }}><input type="checkbox" checked={m.activo} disabled={apagado}
                 onChange={(e) => setM({ ...m, activo: e.target.checked })} aria-label="Activo" /></td>
      <td>
        <button type="button" className="btn btn-secundario" disabled={apagado}
                onClick={() => guardar(() => guardarMotivo(m), nuevo ? () => setM(inicial) : undefined)}>
          {pendiente ? 'Guardando…' : nuevo ? 'Agregar' : 'Guardar'}
        </button>
        <Aviso aviso={aviso} />
      </td>
    </tr>
  );
}

export function EditorMotivos({ motivos, puede }: { motivos: Motivo[]; puede: boolean }) {
  return (
    <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
      <table className="datos" data-cuadro="motivos-reclamo">
        <thead><tr><th>Motivo (español)</th><th>Motivo (inglés)</th><th>Orden</th><th>Activo</th><th /></tr></thead>
        <tbody>
          {motivos.map((m) => <FilaMotivo key={m.id} inicial={m} puede={puede} />)}
          {puede && <FilaMotivo key={`nuevo-${motivos.length}`} inicial={{ id: null, nombre_es: '', nombre_en: '', activo: true, orden: motivos.length + 1 }} puede={puede} />}
        </tbody>
      </table>
    </div>
  );
}

/* ─────────── Clasificaciones ─────────── */
function FilaClasificacion({ inicial, puede }: { inicial: Clasificacion; puede: boolean }) {
  const [c, setC] = useState(inicial);
  const { aviso, pendiente, guardar } = useGuardar();
  const nuevo = inicial.id === null;
  const apagado = !puede || pendiente;
  return (
    <tr>
      <td><input className="campo" value={c.nombre} disabled={apagado} placeholder={nuevo ? 'Nueva clasificación' : ''}
                 onChange={(e) => setC({ ...c, nombre: e.target.value })} /></td>
      <td style={{ width: '7rem' }}><input className="campo mono" type="number" min={1} max={365} value={c.plazo_dias} disabled={apagado}
                 onChange={(e) => setC({ ...c, plazo_dias: Number(e.target.value) })} /></td>
      <td style={{ width: '5rem' }}><input className="campo mono" type="number" value={c.orden} disabled={apagado}
                 onChange={(e) => setC({ ...c, orden: Number(e.target.value) })} /></td>
      <td style={{ textAlign: 'center' }}><input type="checkbox" checked={c.activo} disabled={apagado}
                 onChange={(e) => setC({ ...c, activo: e.target.checked })} aria-label="Activa" /></td>
      <td>
        <button type="button" className="btn btn-secundario" disabled={apagado}
                onClick={() => guardar(() => guardarClasificacion(c), nuevo ? () => setC(inicial) : undefined)}>
          {pendiente ? 'Guardando…' : nuevo ? 'Agregar' : 'Guardar'}
        </button>
        <Aviso aviso={aviso} />
      </td>
    </tr>
  );
}

export function EditorClasificaciones({ clasificaciones, puede }: { clasificaciones: Clasificacion[]; puede: boolean }) {
  return (
    <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
      <table className="datos" data-cuadro="clasificaciones-reclamo">
        <thead><tr><th>Clasificación</th><th>Plazo (días)</th><th>Orden</th><th>Activa</th><th /></tr></thead>
        <tbody>
          {clasificaciones.map((c) => <FilaClasificacion key={c.id} inicial={c} puede={puede} />)}
          {puede && <FilaClasificacion key={`nueva-${clasificaciones.length}`} inicial={{ id: null, nombre: '', plazo_dias: 10, activo: true, orden: clasificaciones.length + 1 }} puede={puede} />}
        </tbody>
      </table>
    </div>
  );
}

/* ─────────── Plantillas de correo ─────────── */
export type Plantilla = { clave: string; idioma: string; nombre: string; asunto: string; cuerpo: string; puede: boolean; variables: string[] };

function EditorPlantilla({ p }: { p: Plantilla }) {
  const [asunto, setAsunto] = useState(p.asunto);
  const [cuerpo, setCuerpo] = useState(p.cuerpo);
  const { aviso, pendiente, guardar } = useGuardar();
  const apagado = !p.puede || pendiente;
  return (
    <details style={{ borderTop: '1px solid var(--linea)', padding: '.6rem 1rem' }} data-plantilla={`${p.clave}-${p.idioma}`}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
        {p.nombre} <small style={{ color: 'var(--tinta-3)', fontWeight: 400 }}>· {p.idioma === 'en' ? 'inglés' : 'español'}{!p.puede && ' · solo lectura'}</small>
      </summary>
      <div className="form-rejilla" style={{ padding: '.6rem 0 0' }}>
        <label className="form-campo form-ancho">
          <span>Asunto</span>
          <input className="campo" value={asunto} disabled={apagado} onChange={(e) => setAsunto(e.target.value)} />
        </label>
        <label className="form-campo form-ancho">
          <span>Texto del correo</span>
          <textarea className="campo" rows={10} value={cuerpo} disabled={apagado} onChange={(e) => setCuerpo(e.target.value)}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: '.8rem' }} />
          <small>
            Variables: {p.variables.map((v) => <code key={v} style={{ marginRight: '.4rem' }}>{`{{${v}}}`}</code>)}
            · Se envía con la cabecera y el pie de la marca.
          </small>
        </label>
      </div>
      {p.puede && (
        <button type="button" className="btn btn-secundario" disabled={apagado}
                onClick={() => guardar(() => guardarPlantilla({ clave: p.clave, idioma: p.idioma, asunto, cuerpo }))}>
          {pendiente ? 'Guardando…' : 'Guardar plantilla'}
        </button>
      )}
      <Aviso aviso={aviso} />
    </details>
  );
}

export function EditorPlantillas({ plantillas }: { plantillas: Plantilla[] }) {
  return <div>{plantillas.map((p) => <EditorPlantilla key={`${p.clave}-${p.idioma}`} p={p} />)}</div>;
}

/* ─────────── Hitos del portal ─────────── */
export type Hito = { clave: string; vista: string; etiqueta_es: string; etiqueta_en: string; origen: string; orden: number; visible: boolean };

function FilaHito({ inicial, puede }: { inicial: Hito; puede: boolean }) {
  const [h, setH] = useState(inicial);
  const { aviso, pendiente, guardar } = useGuardar();
  const apagado = !puede || pendiente;
  return (
    <tr>
      <td>{h.vista === 'proforma' ? 'Proforma' : 'Contenedor'}</td>
      <td><input className="campo" value={h.etiqueta_es} disabled={apagado} onChange={(e) => setH({ ...h, etiqueta_es: e.target.value })} /></td>
      <td><input className="campo" value={h.etiqueta_en} disabled={apagado} onChange={(e) => setH({ ...h, etiqueta_en: e.target.value })} /></td>
      <td style={{ fontSize: '.76rem', color: 'var(--tinta-2)', maxWidth: '16rem' }}>{h.origen}</td>
      <td style={{ width: '5rem' }}><input className="campo mono" type="number" value={h.orden} disabled={apagado}
                 onChange={(e) => setH({ ...h, orden: Number(e.target.value) })} /></td>
      <td style={{ textAlign: 'center' }}><input type="checkbox" checked={h.visible} disabled={apagado}
                 onChange={(e) => setH({ ...h, visible: e.target.checked })} aria-label="Visible" /></td>
      <td>
        {puede && (
          <button type="button" className="btn btn-secundario" disabled={apagado} onClick={() => guardar(() => guardarHito(h))}>
            {pendiente ? 'Guardando…' : 'Guardar'}
          </button>
        )}
        <Aviso aviso={aviso} />
      </td>
    </tr>
  );
}

export function EditorHitos({ hitos, puede }: { hitos: Hito[]; puede: boolean }) {
  return (
    <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
      <table className="datos" data-cuadro="hitos-portal">
        <thead><tr><th>Vista</th><th>Nombre (español)</th><th>Nombre (inglés)</th><th>De dónde sale la fecha</th><th>Orden</th><th>Visible</th><th /></tr></thead>
        <tbody>{hitos.map((h) => <FilaHito key={h.clave} inicial={h} puede={puede} />)}</tbody>
      </table>
    </div>
  );
}

/* ─────────── Contraseña de la cuenta de seguimiento ─────────── */
export function CambiarClavePortal() {
  const [clave, setClave] = useState('');
  const [ver, setVer] = useState(false);
  const { aviso, pendiente, guardar } = useGuardar();
  return (
    <div style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <label className="form-campo" style={{ minWidth: '16rem' }}>
        <span>Nueva contraseña</span>
        <input className="campo mono" type={ver ? 'text' : 'password'} value={clave} autoComplete="new-password"
               onChange={(e) => setClave(e.target.value)} disabled={pendiente} />
        <small>Al menos 10 caracteres, con letras y números.</small>
      </label>
      <label style={{ fontSize: '.8rem', display: 'flex', gap: '.3rem', alignItems: 'center', marginBottom: '1.3rem' }}>
        <input type="checkbox" checked={ver} onChange={(e) => setVer(e.target.checked)} /> Ver
      </label>
      <button type="button" className="btn btn-primario" style={{ marginBottom: '1.1rem' }} disabled={pendiente || clave.length < 10}
              onClick={() => {
                if (!confirm('¿Cambiar la contraseña de la cuenta de seguimiento? Se cerrarán las sesiones abiertas del portal.')) return;
                guardar(() => cambiarClavePortal(clave), () => setClave(''));
              }}>
        {pendiente ? 'Cambiando…' : 'Cambiar contraseña'}
      </button>
      <div style={{ flexBasis: '100%' }}><Aviso aviso={aviso} /></div>
    </div>
  );
}
