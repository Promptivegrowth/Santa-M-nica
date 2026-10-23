'use client';

/**
 * ============================================================================
 *  ADMINISTRAR USUARIOS · alta, rol, estado y contraseña temporal
 * ============================================================================
 *  Solo Gerencia cambia algo; Operaciones ve la pestaña con los controles
 *  apagados y el motivo escrito, para que sepa a quién pedirlo.
 *
 *  La contraseña temporal se GENERA aquí (o se escribe) y se muestra una sola
 *  vez, para que Gerencia la comunique en persona. No se guarda en ningún
 *  lado legible: la base solo conserva su versión cifrada.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icono } from '@/components/estructura/Icono';
import { NOMBRE_ROL, type Rol } from '@/lib/navegacion';
import {
  crearUsuario, cambiarRolUsuario, cambiarEstadoUsuario, restablecerClaveUsuario,
} from './accionesUsuarios';

type Aviso = { ok: boolean; texto: string } | null;
type Almacen = { id: number; nombre: string };

const ROLES = Object.keys(NOMBRE_ROL) as Rol[];

/** Una contraseña temporal legible: sin letras que se confunden (l, 1, O, 0). */
function generarClave(): string {
  const letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const cifras = '23456789';
  const azar = new Uint32Array(10);
  crypto.getRandomValues(azar);
  const parte = (de: string, desde: number, n: number) =>
    Array.from({ length: n }, (_, i) => de[azar[desde + i] % de.length]).join('');
  return `${parte(letras, 0, 4)}-${parte(cifras, 4, 4)}-${parte(letras, 8, 2)}`;
}

function MensajeAviso({ aviso }: { aviso: Aviso }) {
  if (!aviso) return null;
  return (
    <div className={`ficha-aviso ${aviso.ok ? 'ficha-aviso-ok' : 'ficha-aviso-critico'} documento-mensaje`}
         role={aviso.ok ? 'status' : 'alert'}>
      <Icono nombre={aviso.ok ? 'calidad' : 'alerta'} tamano={17} />
      <span>{aviso.texto}</span>
    </div>
  );
}

/* ==========================================================================
   NUEVO USUARIO
   ========================================================================== */
export function NuevoUsuario({ editable, almacenes }: { editable: boolean; almacenes: Almacen[] }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [rol, setRol] = useState<Rol>('consulta');
  const [almacen, setAlmacen] = useState('');
  const [clave, setClave] = useState('');
  const [aviso, setAviso] = useState<Aviso>(null);
  const [creada, setCreada] = useState<{ email: string; clave: string } | null>(null);
  const [guardando, iniciar] = useTransition();

  function abrir() {
    setAviso(null); setCreada(null);
    setNombre(''); setEmail(''); setRol('consulta'); setAlmacen('');
    setClave(generarClave());
    setAbierto(true);
  }

  function guardar(e: React.FormEvent) {
    e.preventDefault();
    setAviso(null);
    iniciar(async () => {
      const r = await crearUsuario({
        nombre, email, rol, clave, almacenId: rol === 'almacen' && almacen ? Number(almacen) : null,
      });
      setAviso({ ok: r.ok, texto: r.mensaje });
      if (r.ok) {
        setCreada({ email: email.trim().toLowerCase(), clave });
        setAbierto(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="usuarios-alta" data-bloque="nuevo-usuario">
      {!abierto && (
        <div className="usuarios-barra">
          <button type="button" className="btn btn-primario btn-chico" data-accion="nuevo-usuario"
                  disabled={!editable} onClick={abrir}
                  title={editable ? 'Dar de alta a una persona con una contraseña temporal' : 'Solo Gerencia da de alta usuarios.'}>
            <Icono nombre="mas" tamano={14} />
            Nuevo usuario
          </button>
          {!editable && <span className="usuarios-motivo">Solo Gerencia da de alta usuarios, cambia roles y desactiva cuentas.</span>}
        </div>
      )}

      {creada && (
        <div className="ficha-aviso ficha-aviso-info documento-mensaje" role="status" data-bloque="clave-temporal">
          <Icono nombre="alerta" tamano={17} />
          <span>
            <strong>Contraseña temporal de {creada.email}:</strong>{' '}
            <code className="usuarios-clave" data-clave-temporal>{creada.clave}</code>
            <br />
            Anótela y entréguesela en persona: esta es la única vez que se muestra. Al entrar, el
            sistema le pedirá cambiarla.
          </span>
        </div>
      )}
      {!abierto && aviso && !aviso.ok && <MensajeAviso aviso={aviso} />}

      {abierto && (
        <form className="usuarios-form" onSubmit={guardar}>
          <div className="usuarios-rejilla">
            <label className="form-campo">
              <span className="etiqueta">Nombre completo</span>
              <input className="campo" name="nombre" value={nombre} required minLength={3} maxLength={80}
                     onChange={(e) => setNombre(e.target.value)} autoFocus />
            </label>
            <label className="form-campo">
              <span className="etiqueta">Correo (será su usuario)</span>
              <input className="campo" type="email" name="email" value={email} required maxLength={120}
                     onChange={(e) => setEmail(e.target.value)} placeholder="nombre@santamonica.pe" />
            </label>
            <label className="form-campo">
              <span className="etiqueta">Rol</span>
              <select className="campo" name="rol" value={rol} onChange={(e) => setRol(e.target.value as Rol)}>
                {ROLES.map((r) => <option key={r} value={r}>{NOMBRE_ROL[r]}</option>)}
              </select>
            </label>
            {rol === 'almacen' && (
              <label className="form-campo">
                <span className="etiqueta">Almacén a su cargo</span>
                <select className="campo" name="almacen" value={almacen} onChange={(e) => setAlmacen(e.target.value)}>
                  <option value="">Sin almacén fijo</option>
                  {almacenes.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                </select>
              </label>
            )}
            <label className="form-campo">
              <span className="etiqueta">Contraseña temporal</span>
              <input className="campo mono" name="clave" value={clave} required minLength={8}
                     onChange={(e) => setClave(e.target.value)} autoComplete="off" />
              <button type="button" className="usuarios-generar" onClick={() => setClave(generarClave())}>
                Generar otra
              </button>
            </label>
          </div>
          <p className="usuarios-nota">
            Mínimo 8 caracteres, con letras y números. La persona la usará una sola vez: al entrar,
            el sistema le obliga a elegir la suya.
          </p>
          <div className="acciones-fila">
            <button type="submit" className="btn btn-primario btn-chico" disabled={guardando}
                    data-accion="crear-usuario">
              {guardando ? 'Creando…' : 'Crear usuario'}
            </button>
            <button type="button" className="btn btn-sutil btn-chico" disabled={guardando}
                    onClick={() => { setAbierto(false); setAviso(null); }}>
              Cancelar
            </button>
          </div>
          <MensajeAviso aviso={aviso && !aviso.ok ? aviso : null} />
        </form>
      )}

      <style jsx>{`
        .usuarios-alta { padding: 0.75rem 1rem; border-bottom: 1px solid var(--linea); display: flex; flex-direction: column; gap: 0.6rem; }
        .usuarios-barra { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
        .usuarios-motivo { font-size: 0.76rem; color: var(--tinta-3); }
        .usuarios-form { display: flex; flex-direction: column; gap: 0.6rem; }
        .usuarios-rejilla { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: 0.7rem; }
        .usuarios-nota { margin: 0; font-size: 0.74rem; color: var(--tinta-3); }
        .usuarios-generar { align-self: flex-start; background: none; border: none; padding: 0; font-size: 0.72rem; color: var(--acento-2); cursor: pointer; text-decoration: underline; }
        .usuarios-clave { font-size: 0.9rem; padding: 0.05rem 0.35rem; background: var(--superficie); border: 1px solid var(--linea); border-radius: 4px; }
      `}</style>
    </div>
  );
}

/* ==========================================================================
   ROL DE UNA PERSONA
   ========================================================================== */
export function SelectorRol({
  id, nombre, rol, almacenId, almacenes, editable, esUnoMismo,
}: {
  id: string;
  nombre: string;
  rol: Rol;
  almacenId: number | null;
  almacenes: Almacen[];
  editable: boolean;
  esUnoMismo: boolean;
}) {
  const router = useRouter();
  const [valor, setValor] = useState<Rol>(rol);
  const [almacen, setAlmacen] = useState(almacenId ? String(almacenId) : '');
  const [aviso, setAviso] = useState<Aviso>(null);
  const [guardando, iniciar] = useTransition();

  const motivo = !editable ? 'Solo Gerencia cambia roles.'
    : esUnoMismo ? 'No puede quitarse a sí mismo el rol Gerencia.' : null;

  function guardar(nuevoRol: Rol, nuevoAlmacen: string) {
    setAviso(null);
    iniciar(async () => {
      const r = await cambiarRolUsuario(id, nuevoRol, nuevoRol === 'almacen' && nuevoAlmacen ? Number(nuevoAlmacen) : null);
      setAviso({ ok: r.ok, texto: r.mensaje });
      if (!r.ok) { setValor(rol); setAlmacen(almacenId ? String(almacenId) : ''); }
      else router.refresh();
    });
  }

  return (
    <div className="rol-caja">
      <select className="campo campo-chico" aria-label={`Rol de ${nombre}`} data-control="rol"
              value={valor} disabled={!!motivo || guardando} title={motivo ?? `Cambiar el rol de ${nombre}`}
              onChange={(e) => {
                const nuevo = e.target.value as Rol;
                if (nuevo === 'gerencia' && !confirm(`${nombre} tendrá el rol Gerencia: podrá administrar usuarios, costos y toda la configuración. ¿Continuar?`)) return;
                setValor(nuevo);
                guardar(nuevo, almacen);
              }}>
        {ROLES.map((r) => <option key={r} value={r}>{NOMBRE_ROL[r]}</option>)}
      </select>
      {valor === 'almacen' && (
        <select className="campo campo-chico" aria-label={`Almacén de ${nombre}`} data-control="almacen"
                value={almacen} disabled={!!motivo || guardando}
                onChange={(e) => { setAlmacen(e.target.value); guardar('almacen', e.target.value); }}>
          <option value="">Sin almacén fijo</option>
          {almacenes.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
        </select>
      )}
      {aviso && <span className={aviso.ok ? 'rol-ok' : 'rol-mal'} role={aviso.ok ? 'status' : 'alert'}>{aviso.texto}</span>}
      <style jsx>{`
        .rol-caja { display: flex; flex-direction: column; gap: 0.25rem; min-width: 9rem; }
        .rol-caja :global(.campo-chico) { padding: 0.2rem 0.35rem; font-size: 0.76rem; }
        .rol-ok { font-size: 0.7rem; color: var(--ok); line-height: 1.35; }
        .rol-mal { font-size: 0.7rem; color: var(--critico); line-height: 1.35; }
      `}</style>
    </div>
  );
}

/* ==========================================================================
   ACTIVAR / DESACTIVAR Y CONTRASEÑA TEMPORAL
   ========================================================================== */
export function AccesoUsuario({
  id, nombre, activo, debeCambiar, editable, esUnoMismo,
}: {
  id: string;
  nombre: string;
  activo: boolean;
  debeCambiar: boolean;
  editable: boolean;
  esUnoMismo: boolean;
}) {
  const router = useRouter();
  const [aviso, setAviso] = useState<Aviso>(null);
  const [clave, setClave] = useState<string | null>(null);
  const [guardando, iniciar] = useTransition();

  const motivoEstado = !editable ? 'Solo Gerencia activa o desactiva cuentas.'
    : esUnoMismo ? 'No puede desactivar su propia cuenta.' : null;
  const motivoClave = !editable ? 'Solo Gerencia restablece contraseñas.'
    : esUnoMismo ? 'Su propia contraseña se cambia en «Cambiar mi contraseña».'
    : !activo ? 'Reactive la cuenta antes de darle una contraseña nueva.' : null;

  function alternar() {
    const mensaje = activo
      ? `${nombre} no podrá entrar al sistema y se cerrarán sus sesiones abiertas. Sus registros se conservan. ¿Desactivar?`
      : `${nombre} volverá a entrar con su contraseña de siempre. ¿Reactivar?`;
    if (!confirm(mensaje)) return;
    setAviso(null); setClave(null);
    iniciar(async () => {
      const r = await cambiarEstadoUsuario(id, !activo);
      setAviso({ ok: r.ok, texto: r.mensaje });
      if (r.ok) router.refresh();
    });
  }

  function restablecer() {
    if (!confirm(`Se pondrá una contraseña temporal nueva a ${nombre} y se cerrarán sus sesiones. ¿Continuar?`)) return;
    const nueva = generarClave();
    setAviso(null); setClave(null);
    iniciar(async () => {
      const r = await restablecerClaveUsuario(id, nueva);
      setAviso({ ok: r.ok, texto: r.mensaje });
      if (r.ok) { setClave(nueva); router.refresh(); }
    });
  }

  return (
    <div className="acceso-caja">
      <div className="acciones-fila">
        <button type="button" className={`btn btn-chico ${activo ? 'btn-peligro-borde' : 'btn-secundario'}`}
                data-accion={activo ? 'desactivar-usuario' : 'reactivar-usuario'}
                disabled={!!motivoEstado || guardando} title={motivoEstado ?? undefined} onClick={alternar}>
          {activo ? 'Desactivar' : 'Reactivar'}
        </button>
        <button type="button" className="btn btn-sutil btn-chico" data-accion="restablecer-clave"
                disabled={!!motivoClave || guardando} title={motivoClave ?? undefined} onClick={restablecer}>
          Restablecer contraseña
        </button>
      </div>
      {debeCambiar && activo && <span className="acceso-nota">Tiene una contraseña temporal sin cambiar.</span>}
      {clave && (
        <span className="acceso-ok" role="status">
          Contraseña temporal: <code data-clave-temporal>{clave}</code> (entréguela en persona; no se vuelve a mostrar).
        </span>
      )}
      {aviso && !clave && <span className={aviso.ok ? 'acceso-ok' : 'acceso-mal'} role={aviso.ok ? 'status' : 'alert'}>{aviso.texto}</span>}
      <style jsx>{`
        .acceso-caja { display: flex; flex-direction: column; gap: 0.25rem; min-width: 12rem; }
        .acceso-nota { font-size: 0.7rem; color: var(--atencion); }
        .acceso-ok { font-size: 0.72rem; color: var(--ok); line-height: 1.35; }
        .acceso-mal { font-size: 0.72rem; color: var(--critico); line-height: 1.35; }
        .acceso-caja code { font-size: 0.8rem; }
      `}</style>
    </div>
  );
}
