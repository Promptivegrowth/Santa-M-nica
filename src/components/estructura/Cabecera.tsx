'use client';

/**
 * ============================================================================
 *  CABECERA SUPERIOR
 * ============================================================================
 *  Contiene tres cosas que se usan todo el día:
 *   · El buscador universal de trazabilidad (acepta cualquier código: pallet,
 *     proforma, contenedor, guía, factura o cliente).
 *   · El cambio de tema claro/oscuro.
 *   · El menú del usuario, con su rol visible y la salida.
 * ============================================================================
 */
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { crearClienteNavegador } from '@/lib/supabase/navegador';
import { NOMBRE_ROL, type Rol } from '@/lib/navegacion';
import { Icono } from './Icono';

export function Cabecera({
  usuario,
  onAbrirMenu,
  alertasPendientes,
}: {
  usuario: { nombre: string; email: string; rol: Rol };
  onAbrirMenu: () => void;
  alertasPendientes: number;
}) {
  const router = useRouter();
  const [tema, setTema] = useState<'claro' | 'oscuro' | null>(null);
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const refMenu = useRef<HTMLDivElement>(null);

  // Lee el tema guardado al montar
  useEffect(() => {
    try {
      const guardado = localStorage.getItem('tema-sm') as 'claro' | 'oscuro' | null;
      setTema(guardado);
    } catch { /* sin almacenamiento: se usa la preferencia del sistema */ }
  }, []);

  // Cierra el menú del usuario al hacer clic fuera o pulsar Escape
  useEffect(() => {
    if (!menuAbierto) return;
    function fuera(e: MouseEvent) {
      if (refMenu.current && !refMenu.current.contains(e.target as Node)) setMenuAbierto(false);
    }
    function escape(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuAbierto(false);
    }
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('keydown', escape);
    };
  }, [menuAbierto]);

  function alternarTema() {
    const oscuroAhora =
      tema === 'oscuro' ||
      (tema === null && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const nuevo = oscuroAhora ? 'claro' : 'oscuro';
    document.documentElement.setAttribute('data-tema', nuevo);
    try { localStorage.setItem('tema-sm', nuevo); } catch {}
    setTema(nuevo);
  }

  async function salir() {
    const supabase = crearClienteNavegador();
    await supabase.auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  function buscar(e: React.FormEvent) {
    e.preventDefault();
    const q = busqueda.trim();
    if (q.length < 2) return;
    router.push(`/trazabilidad?q=${encodeURIComponent(q)}`);
  }

  const iniciales = usuario.nombre
    .split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

  return (
    <header className="cabecera no-imprimir">
      <button
        type="button"
        className="btn btn-sutil cabecera-menu"
        onClick={onAbrirMenu}
        aria-label="Abrir el menú"
      >
        <Icono nombre="menu" tamano={19} />
      </button>

      {/* --- Buscador universal de trazabilidad --- */}
      <form className="cabecera-buscador" onSubmit={buscar} role="search">
        <Icono nombre="buscar" tamano={15} className="cabecera-lupa" />
        <input
          type="search"
          className="cabecera-input"
          placeholder="Buscar pallet, proforma, contenedor, guía, factura o cliente…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          aria-label="Buscador universal de trazabilidad"
        />
      </form>

      <div className="cabecera-acciones">
        <Link href="/alertas" className="cabecera-alertas" title="Alertas pendientes">
          <Icono nombre="alerta" tamano={17} />
          {alertasPendientes > 0 && (
            <span className="cabecera-contador">
              {alertasPendientes > 99 ? '99+' : alertasPendientes}
            </span>
          )}
        </Link>

        <button
          type="button"
          className="btn btn-sutil"
          onClick={alternarTema}
          aria-label="Cambiar entre tema claro y oscuro"
          title="Cambiar tema"
        >
          <Icono nombre={tema === 'oscuro' ? 'sol' : 'luna'} tamano={16} />
        </button>

        <div className="cabecera-usuario" ref={refMenu}>
          <button
            type="button"
            className="cabecera-avatar"
            onClick={() => setMenuAbierto((a) => !a)}
            aria-expanded={menuAbierto}
            aria-haspopup="menu"
          >
            <span className="cabecera-iniciales">{iniciales}</span>
            <span className="cabecera-datos">
              <strong>{usuario.nombre}</strong>
              <small>{NOMBRE_ROL[usuario.rol]}</small>
            </span>
          </button>

          {menuAbierto && (
            <div className="cabecera-desplegable aparecer" role="menu">
              <div className="cabecera-desplegable-info">
                <strong>{usuario.nombre}</strong>
                <span>{usuario.email}</span>
                <span className="pill pill-info" style={{ marginTop: '.4rem' }}>
                  {NOMBRE_ROL[usuario.rol]}
                </span>
              </div>
              <button type="button" className="cabecera-desplegable-opcion" onClick={salir} role="menuitem">
                <Icono nombre="salir" tamano={15} />
                Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .cabecera {
          position: sticky;
          top: 0;
          z-index: 30;
          display: flex;
          align-items: center;
          gap: 0.6rem;
          padding: 0.55rem 0.85rem;
          min-height: 3.4rem;
          background: color-mix(in srgb, var(--superficie) 88%, transparent);
          backdrop-filter: blur(8px);
          border-bottom: 1px solid var(--linea);
        }
        .cabecera-menu { padding: 0.35rem; }
        @media (min-width: 1024px) { .cabecera-menu { display: none; } }

        .cabecera-buscador {
          position: relative;
          flex: 1;
          max-width: 34rem;
          display: flex;
          align-items: center;
        }
        .cabecera-buscador :global(.cabecera-lupa) {
          position: absolute;
          inset-inline-start: 0.6rem;
          color: var(--tinta-3);
          pointer-events: none;
        }
        .cabecera-input {
          width: 100%;
          background: var(--superficie-2);
          border: 1px solid transparent;
          border-radius: var(--radio);
          padding: 0.42rem 0.65rem 0.42rem 2rem;
          font-size: 0.82rem;
          color: var(--tinta);
          font-family: var(--font-sans);
        }
        .cabecera-input::placeholder { color: var(--tinta-3); }
        .cabecera-input:focus {
          outline: none;
          background: var(--superficie);
          border-color: var(--acento-2);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--acento-2) 16%, transparent);
        }

        .cabecera-acciones {
          display: flex;
          align-items: center;
          gap: 0.3rem;
          margin-inline-start: auto;
        }

        .cabecera-alertas {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0.4rem;
          border-radius: var(--radio);
          color: var(--tinta-2);
        }
        .cabecera-alertas:hover { background: var(--superficie-2); color: var(--tinta); }
        .cabecera-contador {
          position: absolute;
          top: 0.05rem;
          inset-inline-end: 0.05rem;
          min-width: 1rem;
          height: 1rem;
          padding: 0 0.2rem;
          border-radius: 999px;
          background: var(--critico);
          color: #fff;
          font-family: var(--font-mono);
          font-size: 0.55rem;
          font-weight: 600;
          display: grid;
          place-items: center;
        }

        .cabecera-usuario { position: relative; }
        .cabecera-avatar {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          background: transparent;
          border: 1px solid transparent;
          border-radius: var(--radio);
          padding: 0.25rem 0.45rem 0.25rem 0.25rem;
          cursor: pointer;
          color: var(--tinta);
        }
        .cabecera-avatar:hover { background: var(--superficie-2); }
        .cabecera-iniciales {
          width: 1.85rem;
          height: 1.85rem;
          border-radius: var(--radio);
          background: var(--color-marca-700);
          color: #fff;
          display: grid;
          place-items: center;
          font-family: var(--font-mono);
          font-size: 0.66rem;
          font-weight: 600;
          flex: none;
        }
        .cabecera-datos { display: none; flex-direction: column; text-align: left; line-height: 1.2; }
        @media (min-width: 640px) { .cabecera-datos { display: flex; } }
        .cabecera-datos strong { font-size: 0.78rem; font-weight: 600; }
        .cabecera-datos small { font-size: 0.66rem; color: var(--tinta-3); }

        .cabecera-desplegable {
          position: absolute;
          inset-inline-end: 0;
          top: calc(100% + 0.4rem);
          min-width: 14rem;
          background: var(--superficie);
          border: 1px solid var(--linea);
          border-radius: var(--radio);
          box-shadow: var(--sombra);
          overflow: hidden;
          z-index: 40;
        }
        .cabecera-desplegable-info {
          display: flex;
          flex-direction: column;
          padding: 0.7rem 0.85rem;
          border-bottom: 1px solid var(--linea);
        }
        .cabecera-desplegable-info strong { font-size: 0.84rem; }
        .cabecera-desplegable-info span { font-size: 0.72rem; color: var(--tinta-3); }
        .cabecera-desplegable-opcion {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          width: 100%;
          padding: 0.6rem 0.85rem;
          background: transparent;
          border: none;
          cursor: pointer;
          font-size: 0.82rem;
          color: var(--tinta-2);
          font-family: var(--font-sans);
        }
        .cabecera-desplegable-opcion:hover { background: var(--superficie-2); color: var(--critico); }
      `}</style>
    </header>
  );
}
