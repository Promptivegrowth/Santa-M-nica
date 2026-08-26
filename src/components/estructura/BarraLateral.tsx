'use client';

/**
 * ============================================================================
 *  BARRA LATERAL · navegación principal
 * ============================================================================
 *  En escritorio es una columna fija que se puede colapsar a solo iconos.
 *  En móvil se convierte en un panel deslizante que se abre desde la cabecera.
 *
 *  Decisiones de diseño:
 *   · Cada entrada tiene SU icono, no uno por grupo. Un icono repetido seis
 *     veces no informa: el usuario debe reconocer la pantalla por su forma.
 *   · Los iconos van atenuados y solo toman color al pasar el cursor o cuando
 *     la entrada está activa. Así el ojo va primero al texto, que es lo que se
 *     lee, y el icono ayuda sin competir.
 *   · Los grupos se separan con una línea sutil, no con espacio en blanco: en
 *     un menú de 27 entradas el espacio se agota rápido.
 *
 *  El menú que recibe ya viene filtrado por rol desde el servidor.
 * ============================================================================
 */
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Grupo } from '@/lib/navegacion';
import { MarcaS, Logotipo } from '@/components/marca/Logo';
import { Icono } from './Icono';

export function BarraLateral({
  grupos,
  abierta,
  onCerrar,
}: {
  grupos: Grupo[];
  abierta: boolean;
  onCerrar: () => void;
}) {
  const ruta = usePathname();
  const [colapsada, setColapsada] = useState(false);

  // Recordamos si el usuario prefiere la barra angosta
  useEffect(() => {
    try {
      setColapsada(localStorage.getItem('barra-colapsada') === 'si');
    } catch {
      /* almacenamiento no disponible: seguimos con el valor por defecto */
    }
  }, []);

  function alternarAncho() {
    setColapsada((c) => {
      const nuevo = !c;
      try { localStorage.setItem('barra-colapsada', nuevo ? 'si' : 'no'); } catch {}
      return nuevo;
    });
  }

  /** ¿Esta entrada corresponde a la pantalla actual? */
  function activa(destino: string) {
    if (destino === '/panel') return ruta === '/panel';
    if (destino === '/trazabilidad') return ruta === '/trazabilidad';
    return ruta === destino || ruta.startsWith(destino + '/');
  }

  return (
    <>
      {/* Velo oscuro en móvil, para cerrar tocando fuera */}
      {abierta && <div className="velo no-imprimir" onClick={onCerrar} aria-hidden />}

      <nav
        className="barra no-imprimir"
        data-abierta={abierta ? 'si' : 'no'}
        data-colapsada={colapsada ? 'si' : 'no'}
        aria-label="Navegación principal"
      >
        <div className="barra-cabecera">
          <Link href="/panel" className="barra-logo" onClick={onCerrar} aria-label="Ir al panel">
            {colapsada ? <MarcaS tamano={28} /> : <Logotipo alto={30} className="logo-barra" />}
          </Link>
          <button
            type="button"
            className="barra-plegar"
            onClick={alternarAncho}
            aria-label={colapsada ? 'Expandir el menú' : 'Contraer el menú'}
            title={colapsada ? 'Expandir el menú' : 'Contraer el menú'}
          >
            <Icono nombre={colapsada ? 'expandir' : 'contraer'} tamano={16} />
          </button>
        </div>

        <div className="barra-menu">
          {grupos.map((g) => (
            <div key={g.grupo} className="barra-grupo">
              <span className="barra-grupo-titulo" aria-hidden>{g.grupo}</span>
              <ul>
                {g.entradas.map((e) => (
                  <li key={e.ruta}>
                    <Link
                      href={e.ruta}
                      className="barra-enlace"
                      data-activa={activa(e.ruta) ? 'si' : 'no'}
                      onClick={onCerrar}
                      title={colapsada ? e.titulo : e.ayuda}
                    >
                      <span className="barra-icono">
                        <Icono nombre={e.icono} tamano={16} />
                      </span>
                      <span className="barra-texto">{e.titulo}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <footer className="barra-pie">
          <span className="barra-pie-marca">Promptive</span>
          <span className="barra-pie-version">v1.0</span>
        </footer>
      </nav>

      <style jsx>{`
        .velo {
          position: fixed;
          inset: 0;
          background: rgba(10, 17, 32, 0.55);
          z-index: 40;
          backdrop-filter: blur(2px);
        }
        @media (min-width: 1024px) { .velo { display: none; } }

        .barra {
          position: fixed;
          inset-block: 0;
          inset-inline-start: 0;
          z-index: 50;
          width: 15rem;
          display: flex;
          flex-direction: column;
          background: var(--superficie);
          border-inline-end: 1px solid var(--linea);
          transform: translateX(-100%);
          transition: transform 0.22s ease, width 0.18s ease;
        }
        .barra[data-abierta='si'] { transform: none; }
        @media (min-width: 1024px) {
          .barra { position: sticky; transform: none; height: 100dvh; }
          .barra[data-colapsada='si'] { width: 3.6rem; }
        }

        /* ---------- Cabecera con el logotipo ---------- */
        .barra-cabecera {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
          padding: 0.9rem 0.85rem;
          border-bottom: 1px solid var(--linea);
          min-height: 3.6rem;
        }
        .barra-logo {
          display: flex;
          align-items: center;
          overflow: hidden;
          min-width: 0;
          border-radius: 3px;
        }
        .barra-plegar {
          display: none;
          padding: 0.28rem;
          background: transparent;
          border: 1px solid transparent;
          border-radius: 3px;
          color: var(--tinta-3);
          cursor: pointer;
          transition: background 0.12s ease, color 0.12s ease;
        }
        .barra-plegar:hover { background: var(--superficie-2); color: var(--tinta); }
        @media (min-width: 1024px) { .barra-plegar { display: inline-flex; } }
        .barra[data-colapsada='si'] .barra-cabecera {
          flex-direction: column;
          gap: 0.55rem;
          padding-inline: 0.4rem;
        }

        /* ---------- Menú ---------- */
        .barra-menu {
          flex: 1;
          overflow-y: auto;
          overflow-x: hidden;
          padding: 0.35rem 0.45rem 1rem;
        }
        .barra-grupo + .barra-grupo {
          margin-top: 0.5rem;
          padding-top: 0.5rem;
          border-top: 1px solid var(--linea);
        }
        .barra-grupo-titulo {
          display: block;
          font-family: var(--font-mono);
          font-size: 0.55rem;
          font-weight: 600;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--tinta-3);
          padding: 0.4rem 0.55rem 0.3rem;
          opacity: 0.85;
        }
        .barra[data-colapsada='si'] .barra-grupo-titulo {
          height: 0.4rem;
          padding: 0;
          margin-bottom: 0.3rem;
          overflow: hidden;
          text-indent: -999px;
        }
        .barra-grupo ul { list-style: none; margin: 0; padding: 0; }

        .barra-enlace {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          padding: 0.4rem 0.55rem;
          border-radius: 4px;
          color: var(--tinta-2);
          text-decoration: none;
          font-size: 0.84rem;
          line-height: 1.35;
          transition: background 0.12s ease, color 0.12s ease;
          position: relative;
        }
        .barra-icono {
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--tinta-3);
          transition: color 0.12s ease;
          flex: none;
        }
        .barra-enlace:hover {
          background: var(--superficie-2);
          color: var(--tinta);
        }
        .barra-enlace:hover .barra-icono { color: var(--acento-2); }

        .barra-enlace[data-activa='si'] {
          background: var(--acento-suave);
          color: var(--acento);
          font-weight: 600;
        }
        .barra-enlace[data-activa='si'] .barra-icono { color: var(--acento); }
        .barra-enlace[data-activa='si']::before {
          content: '';
          position: absolute;
          inset-inline-start: -0.45rem;
          inset-block: 0.32rem;
          width: 2.5px;
          border-radius: 0 2px 2px 0;
          background: var(--acento);
        }

        .barra-texto {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .barra[data-colapsada='si'] .barra-texto { display: none; }
        .barra[data-colapsada='si'] .barra-enlace {
          justify-content: center;
          padding-inline: 0;
        }
        .barra[data-colapsada='si'] .barra-enlace[data-activa='si']::before {
          inset-inline-start: -0.45rem;
        }

        /* ---------- Pie ---------- */
        .barra-pie {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 0.4rem;
          padding: 0.6rem 0.85rem;
          border-top: 1px solid var(--linea);
          font-family: var(--font-mono);
          font-size: 0.58rem;
          letter-spacing: 0.08em;
          color: var(--tinta-3);
          white-space: nowrap;
          overflow: hidden;
        }
        .barra[data-colapsada='si'] .barra-pie-marca { display: none; }
        .barra[data-colapsada='si'] .barra-pie { justify-content: center; }
      `}</style>

      <style jsx global>{`
        /*
          El logotipo es azul oscuro sobre fondo blanco. En tema oscuro hay que
          invertirlo para que se lea; en tema claro se deja tal cual.
        */
        .logo-barra { max-width: 100%; height: auto; }
        @media (prefers-color-scheme: dark) {
          :root:not([data-tema='claro']) .logo-barra { filter: brightness(0) invert(1); }
        }
        :root[data-tema='oscuro'] .logo-barra { filter: brightness(0) invert(1); }
        :root[data-tema='claro'] .logo-barra { filter: none; }
      `}</style>
    </>
  );
}
