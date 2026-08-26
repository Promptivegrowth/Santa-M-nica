'use client';

/**
 * ============================================================================
 *  CABECERA SUPERIOR
 * ============================================================================
 *  Tres cosas que se usan todo el día:
 *   · El buscador universal de trazabilidad.
 *   · El aviso de alertas pendientes.
 *   · El menú del usuario, con sus preferencias y la salida.
 *
 *  NOTA SOBRE LOS ESTILOS
 *  Viven en src/app/estructura.css, no aquí. El contador de alertas cuelga de
 *  un <Link> y styled-jsx no alcanza a los componentes de React: por eso antes
 *  aparecía recortado contra el borde del contenedor.
 * ============================================================================
 */
import { useState, useEffect, useRef } from 'react';
import { usePreferencia, guardarPreferencia, useTemaOscuro } from '@/lib/preferencias';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { crearClienteNavegador } from '@/lib/supabase/navegador';
import { NOMBRE_ROL, type Rol } from '@/lib/navegacion';
import { Icono } from './Icono';

type Tema = 'sistema' | 'claro' | 'oscuro';

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

  // El tema elegido y si eso acaba siendo oscuro son dos cosas distintas:
  // «sistema» no dice nada por si mismo, hay que preguntarle al equipo.
  const tema = (usePreferencia('local', 'tema-sm') as Tema | null) ?? 'sistema';
  const oscuroActivo = useTemaOscuro();

  const [menuAbierto, setMenuAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [saliendo, setSaliendo] = useState(false);
  const refMenu = useRef<HTMLDivElement>(null);

  // Cierra el menú al hacer clic fuera o pulsar Escape
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

  /**
   * Aplica el tema elegido. 'sistema' no guarda nada: deja mandar a la
   * preferencia del equipo, y la ausencia de valor es justo lo que significa.
   *
   * El atributo del <html> se toca directamente porque tiene que aplicarse
   * antes de que React vuelva a dibujar: si esperase al renderizado, el color
   * de fondo cambiaria un instante despues que el resto.
   */
  function elegirTema(nuevo: Tema) {
    if (nuevo === 'sistema') document.documentElement.removeAttribute('data-tema');
    else document.documentElement.setAttribute('data-tema', nuevo);

    guardarPreferencia('local', 'tema-sm', nuevo === 'sistema' ? null : nuevo);
  }

  /** Alterna rápido entre claro y oscuro desde el botón de la cabecera. */
  function alternarTemaRapido() {
    elegirTema(oscuroActivo ? 'claro' : 'oscuro');
  }

  async function salir() {
    setSaliendo(true);
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

  const puedeConfigurar = ['gerencia', 'operaciones'].includes(usuario.rol);

  return (
    <header className="cabecera no-imprimir">
      <button
        type="button"
        className="cabecera-menu"
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
        <Link
          href="/alertas"
          className="cabecera-boton"
          title={`${alertasPendientes} alerta(s) pendiente(s)`}
          aria-label={`Alertas: ${alertasPendientes} pendientes`}
        >
          <Icono nombre="alerta" tamano={17} />
          {alertasPendientes > 0 && (
            <span className="cabecera-contador">
              {alertasPendientes > 99 ? '99+' : alertasPendientes}
            </span>
          )}
        </Link>

        <button
          type="button"
          className="cabecera-boton"
          onClick={alternarTemaRapido}
          aria-label="Cambiar entre tema claro y oscuro"
          title="Cambiar tema"
        >
          <Icono nombre={oscuroActivo ? 'sol' : 'luna'} tamano={16} />
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
            <Icono nombre="expandir" tamano={13} className="cabecera-chevron" />
          </button>

          {menuAbierto && (
            <div className="cabecera-desplegable aparecer" role="menu">
              {/* --- Quién soy --- */}
              <div className="cabecera-desplegable-info">
                <span className="cabecera-iniciales">{iniciales}</span>
                <span className="cabecera-desplegable-datos">
                  <strong>{usuario.nombre}</strong>
                  <span>{usuario.email}</span>
                </span>
              </div>

              {/* --- Preferencias --- */}
              <div className="cabecera-seccion">
                <span className="cabecera-seccion-titulo">Apariencia</span>
                {([
                  { valor: 'sistema', texto: 'Según el sistema', icono: 'configuracion' },
                  { valor: 'claro', texto: 'Tema claro', icono: 'sol' },
                  { valor: 'oscuro', texto: 'Tema oscuro', icono: 'luna' },
                ] as const).map((o) => (
                  <button
                    key={o.valor}
                    type="button"
                    className="cabecera-opcion"
                    role="menuitemradio"
                    aria-checked={tema === o.valor}
                    onClick={() => elegirTema(o.valor)}
                  >
                    <Icono nombre={o.icono} tamano={15} />
                    {o.texto}
                    <span className="cabecera-opcion-valor">{tema === o.valor ? '✓' : ''}</span>
                  </button>
                ))}
              </div>

              {/* --- Cuenta y sistema --- */}
              <div className="cabecera-seccion">
                <span className="cabecera-seccion-titulo">Cuenta</span>
                <div className="cabecera-opcion" style={{ cursor: 'default' }}>
                  <Icono nombre="clientes" tamano={15} />
                  Rol asignado
                  <span className="cabecera-opcion-valor">{NOMBRE_ROL[usuario.rol]}</span>
                </div>
                {puedeConfigurar && (
                  <Link
                    href="/configuracion"
                    className="cabecera-opcion"
                    role="menuitem"
                    onClick={() => setMenuAbierto(false)}
                  >
                    <Icono nombre="configuracion" tamano={15} />
                    Configuración del sistema
                  </Link>
                )}
                <Link
                  href="/alertas"
                  className="cabecera-opcion"
                  role="menuitem"
                  onClick={() => setMenuAbierto(false)}
                >
                  <Icono nombre="alerta" tamano={15} />
                  Mis alertas
                  <span className="cabecera-opcion-valor">{alertasPendientes}</span>
                </Link>
              </div>

              {/* --- Salir --- */}
              <div className="cabecera-seccion">
                <button
                  type="button"
                  className="cabecera-opcion cabecera-opcion-peligro"
                  onClick={salir}
                  role="menuitem"
                  disabled={saliendo}
                >
                  <Icono nombre="salir" tamano={15} />
                  {saliendo ? 'Cerrando sesión…' : 'Cerrar sesión'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
