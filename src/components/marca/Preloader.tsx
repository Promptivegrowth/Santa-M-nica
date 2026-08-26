'use client';

/**
 * ============================================================================
 *  PRELOADER · pantalla de carga inicial
 * ============================================================================
 *  Lo que ve el usuario mientras la aplicación arranca: el símbolo de la marca
 *  trazándose sobre el azul de Santa Mónica, con una barra de progreso.
 *
 *  Detalle importante: el progreso NO es decorativo al azar. Avanza a medida
 *  que el navegador realmente carga (evento `load`) y se completa al montar la
 *  aplicación. Si alguien configuró su sistema para reducir el movimiento, el
 *  símbolo aparece estático y la barra no se anima.
 * ============================================================================
 */
import { useEffect, useState } from 'react';
import { MarcaS } from './Logo';

export function Preloader({ onListo }: { onListo?: () => void }) {
  const [progreso, setProgreso] = useState(8);
  const [saliendo, setSaliendo] = useState(false);

  useEffect(() => {
    // Avance gradual: se acerca al 90 % pero no llega, para no mentir.
    const intervalo = setInterval(() => {
      setProgreso((p) => (p >= 90 ? p : p + Math.max(1, (92 - p) * 0.14)));
    }, 90);

    // Cuando el navegador termina de cargar, completamos y salimos.
    const completar = () => {
      clearInterval(intervalo);
      setProgreso(100);
      setTimeout(() => setSaliendo(true), 180);
      setTimeout(() => onListo?.(), 520);
    };

    if (document.readyState === 'complete') {
      setTimeout(completar, 350);
    } else {
      window.addEventListener('load', completar, { once: true });
    }

    // Salvaguarda: si algo se demora demasiado, no dejamos al usuario colgado.
    const limite = setTimeout(completar, 6000);

    return () => {
      clearInterval(intervalo);
      clearTimeout(limite);
      window.removeEventListener('load', completar);
    };
  }, [onListo]);

  return (
    <div
      className="preloader"
      data-saliendo={saliendo ? 'si' : 'no'}
      role="status"
      aria-live="polite"
      aria-label="Cargando el sistema"
    >
      <div className="preloader-centro">
        <MarcaS tamano={78} animado />
        <div className="preloader-texto">
          <strong>SANTA MÓNICA</strong>
          <span>Ventas · Almacenes · Despachos</span>
        </div>
        <div className="preloader-barra">
          <div className="preloader-avance" style={{ width: `${progreso}%` }} />
        </div>
      </div>

      <style jsx>{`
        .preloader {
          position: fixed;
          inset: 0;
          z-index: 9999;
          display: grid;
          place-items: center;
          background: linear-gradient(160deg, #1b2c52 0%, #304f8c 55%, #3f7ba3 100%);
          transition: opacity 0.42s ease, visibility 0.42s ease;
        }
        .preloader[data-saliendo='si'] {
          opacity: 0;
          visibility: hidden;
        }
        .preloader-centro {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1.15rem;
          padding: 2rem;
        }
        .preloader-texto {
          text-align: center;
          color: #fff;
        }
        .preloader-texto strong {
          display: block;
          font-family: var(--font-titulo);
          font-size: 1.05rem;
          font-weight: 700;
          letter-spacing: 0.22em;
        }
        .preloader-texto span {
          display: block;
          margin-top: 0.3rem;
          font-family: var(--font-mono);
          font-size: 0.62rem;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.62);
        }
        .preloader-barra {
          width: 190px;
          height: 3px;
          border-radius: 2px;
          background: rgba(255, 255, 255, 0.16);
          overflow: hidden;
        }
        .preloader-avance {
          height: 100%;
          background: linear-gradient(90deg, #53a6a6, #86bcd8);
          border-radius: 2px;
          transition: width 0.3s ease;
        }
      `}</style>

      {/* La animación del trazo vive en CSS global porque afecta al SVG hijo */}
      <style jsx global>{`
        .trazo-marca {
          stroke-dasharray: 320;
          stroke-dashoffset: 320;
          animation: trazar 1.5s cubic-bezier(0.65, 0, 0.35, 1) forwards;
        }
        .trazo-2 { animation-delay: 0.28s; }
        .trazo-3 {
          stroke-dasharray: none;
          stroke-dashoffset: 0;
          animation: aparecer 0.5s ease 1.1s both;
        }
        @media (prefers-reduced-motion: reduce) {
          .trazo-marca {
            stroke-dashoffset: 0;
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
