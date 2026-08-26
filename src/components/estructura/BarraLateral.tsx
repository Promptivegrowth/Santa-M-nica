'use client';

/**
 * ============================================================================
 *  BARRA LATERAL · navegación principal
 * ============================================================================
 *  En escritorio es una columna fija que se puede colapsar a solo iconos.
 *  En móvil se convierte en un panel deslizante que se abre desde la cabecera.
 *
 *  El menú que recibe ya viene filtrado por rol desde el servidor: al usuario
 *  no se le muestran enlaces que no podría usar.
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
    } catch { /* almacenamiento no disponible: seguimos con el valor por defecto */ }
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
          <Link href="/panel" className="barra-logo" onClick={onCerrar}>
            {colapsada ? <MarcaS tamano={26} /> : <Logotipo alto={26} className="logo-barra" />}
          </Link>
          <button
            type="button"
            className="btn btn-sutil barra-plegar"
            onClick={alternarAncho}
            aria-label={colapsada ? 'Expandir el menú' : 'Contraer el menú'}
            title={colapsada ? 'Expandir el menú' : 'Contraer el menú'}
          >
            <Icono nombre={colapsada ? 'expandir' : 'contraer'} />
          </button>
        </div>

        <div className="barra-menu">
          {grupos.map((g) => (
            <div key={g.grupo} className="barra-grupo">
              <span className="barra-grupo-titulo">{g.grupo}</span>
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
                      <Icono nombre={g.icono} />
                      <span className="barra-texto">{e.titulo}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <footer className="barra-pie">
          <span>Promptive · v1.0</span>
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
          width: 15.5rem;
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
          .barra[data-colapsada='si'] { width: 3.75rem; }
        }

        .barra-cabecera {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
          padding: 0.75rem 0.7rem;
          border-bottom: 1px solid var(--linea);
          min-height: 3.4rem;
        }
        .barra-logo { display: flex; align-items: center; overflow: hidden; }
        .barra-plegar { display: none; padding: 0.25rem; }
        @media (min-width: 1024px) { .barra-plegar { display: inline-flex; } }

        .barra-menu {
          flex: 1;
          overflow-y: auto;
          padding: 0.65rem 0.5rem 1rem;
        }
        .barra-grupo + .barra-grupo { margin-top: 0.85rem; }
        .barra-grupo-titulo {
          display: block;
          font-family: var(--font-mono);
          font-size: 0.56rem;
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--tinta-3);
          padding: 0 0.55rem 0.35rem;
        }
        .barra[data-colapsada='si'] .barra-grupo-titulo {
          text-align: center;
          padding-inline: 0;
          font-size: 0.48rem;
          overflow: hidden;
          white-space: nowrap;
        }
        .barra-grupo ul { list-style: none; margin: 0; padding: 0; }

        .barra-enlace {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          padding: 0.42rem 0.55rem;
          border-radius: var(--radio);
          color: var(--tinta-2);
          text-decoration: none;
          font-size: 0.83rem;
          line-height: 1.3;
          transition: background 0.12s ease, color 0.12s ease;
          position: relative;
        }
        .barra-enlace:hover { background: var(--superficie-2); color: var(--tinta); }
        .barra-enlace[data-activa='si'] {
          background: var(--acento-suave);
          color: var(--acento);
          font-weight: 600;
        }
        .barra-enlace[data-activa='si']::before {
          content: '';
          position: absolute;
          inset-inline-start: 0;
          inset-block: 0.3rem;
          width: 2px;
          border-radius: 2px;
          background: var(--acento);
        }
        .barra-texto { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .barra[data-colapsada='si'] .barra-texto { display: none; }
        .barra[data-colapsada='si'] .barra-enlace { justify-content: center; padding-inline: 0; }

        .barra-pie {
          padding: 0.6rem 0.8rem;
          border-top: 1px solid var(--linea);
          font-family: var(--font-mono);
          font-size: 0.58rem;
          letter-spacing: 0.08em;
          color: var(--tinta-3);
          white-space: nowrap;
          overflow: hidden;
        }
      `}</style>

      <style jsx global>{`
        .logo-barra { max-width: 100%; }
        :root[data-tema='oscuro'] .logo-barra,
        .barra .logo-barra { filter: none; }
        @media (prefers-color-scheme: dark) {
          :root:not([data-tema='claro']) .logo-barra { filter: brightness(0) invert(1); }
        }
        :root[data-tema='oscuro'] .logo-barra { filter: brightness(0) invert(1); }
        :root[data-tema='claro'] .logo-barra { filter: none; }
      `}</style>
    </>
  );
}
