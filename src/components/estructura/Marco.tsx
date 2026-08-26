'use client';

/**
 * ============================================================================
 *  MARCO DE LA APLICACIÓN
 * ============================================================================
 *  Junta la barra lateral, la cabecera y el contenido de cada pantalla.
 *  También muestra el preloader la primera vez que se entra en la sesión.
 *
 *  Es un componente de cliente porque necesita estado: si el menú móvil está
 *  abierto, si el preloader ya terminó, etc.
 * ============================================================================
 */
import { useState, useEffect } from 'react';
import type { Grupo, Rol } from '@/lib/navegacion';
import { BarraLateral } from './BarraLateral';
import { Cabecera } from './Cabecera';
import { Preloader } from '@/components/marca/Preloader';

export function Marco({
  usuario,
  grupos,
  alertasPendientes,
  children,
}: {
  usuario: { nombre: string; email: string; rol: Rol };
  grupos: Grupo[];
  alertasPendientes: number;
  children: React.ReactNode;
}) {
  const [menuAbierto, setMenuAbierto] = useState(false);
  // El preloader solo se muestra una vez por sesión del navegador, para no
  // hacer esperar al usuario cada vez que cambia de pantalla.
  const [mostrarCarga, setMostrarCarga] = useState(false);

  useEffect(() => {
    try {
      if (!sessionStorage.getItem('carga-vista')) {
        setMostrarCarga(true);
      }
    } catch {
      /* sin sessionStorage (modo privado): simplemente no mostramos el preloader */
    }
  }, []);

  function cargaTerminada() {
    try { sessionStorage.setItem('carga-vista', 'si'); } catch {}
    setMostrarCarga(false);
  }

  return (
    <>
      {mostrarCarga && <Preloader onListo={cargaTerminada} />}

      <div className="marco">
        <BarraLateral
          grupos={grupos}
          abierta={menuAbierto}
          onCerrar={() => setMenuAbierto(false)}
        />

        <div className="marco-columna">
          <Cabecera
            usuario={usuario}
            onAbrirMenu={() => setMenuAbierto(true)}
            alertasPendientes={alertasPendientes}
          />
          <main className="marco-contenido">{children}</main>
        </div>
      </div>

      <style jsx>{`
        .marco {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          min-height: 100dvh;
        }
        @media (min-width: 1024px) {
          .marco { grid-template-columns: auto minmax(0, 1fr); align-items: start; }
        }
        .marco-columna { display: flex; flex-direction: column; min-width: 0; min-height: 100dvh; }
        .marco-contenido {
          flex: 1;
          padding: 1.15rem clamp(0.85rem, 2.4vw, 1.75rem) 3rem;
          min-width: 0;
        }
      `}</style>
    </>
  );
}
