'use client';

/**
 * ============================================================================
 *  BARRA LATERAL · navegación principal
 * ============================================================================
 *  En escritorio es una columna fija que se puede colapsar a solo iconos.
 *  En móvil se convierte en un panel deslizante que se abre desde la cabecera.
 *
 *  NOTA SOBRE LOS ESTILOS
 *  Están en src/app/estructura.css y NO aquí como styled-jsx. La razón: los
 *  enlaces usan <Link>, que es un componente de React, y styled-jsx solo
 *  inyecta su clase de ámbito en elementos DOM. Las reglas nunca llegaban a
 *  aplicarse sobre el <a> y el icono terminaba encima del texto.
 *
 *  Decisiones de diseño:
 *   · Cada entrada tiene SU icono. Uno repetido seis veces no informa nada.
 *   · El icono vive dentro de una pastilla; suelto sobre el fondo se ve
 *     endeble, dentro de un contenedor con color pesa lo mismo que el texto.
 *   · Los grupos se separan con una línea, no con espacio: en un menú de 27
 *     entradas el espacio en blanco se agota enseguida.
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
      {abierta && <div className="barra-velo no-imprimir" onClick={onCerrar} aria-hidden />}

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
              <ul className="barra-lista">
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
                        <Icono nombre={e.icono} tamano={15} />
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
    </>
  );
}
