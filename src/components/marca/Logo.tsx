/**
 * ============================================================================
 *  IDENTIDAD VISUAL · Santa Mónica Fishing
 * ============================================================================
 *  Dos piezas:
 *   · <Logotipo>  → el logo completo (imagen), para el login y las cabeceras.
 *   · <MarcaS>    → solo el símbolo de la "S", dibujado en SVG.
 *
 *  ¿Por qué el símbolo va en SVG y no como imagen?
 *  Porque así se puede animar (el preloader lo traza), cambia de color con el
 *  tema y se ve nítido en cualquier tamaño sin pesar nada.
 * ============================================================================
 */
import Image from 'next/image';

/* --------------------------------------------------------------------------
   Logotipo completo
   -------------------------------------------------------------------------- */
export function Logotipo({
  alto = 34,
  className = '',
}: {
  alto?: number;
  className?: string;
}) {
  return (
    <Image
      src="/logo.png"
      alt="Santa Mónica Fishing"
      width={Math.round(alto * 3.86)} /* proporción real del archivo */
      height={alto}
      priority
      className={className}
      style={{ height: alto, width: 'auto' }}
    />
  );
}

/* --------------------------------------------------------------------------
   Símbolo "S" — tres arcos concéntricos, como en el logotipo
   -------------------------------------------------------------------------- */
export function MarcaS({
  tamano = 32,
  animado = false,
  className = '',
}: {
  tamano?: number;
  animado?: boolean;
  className?: string;
}) {
  return (
    <svg
      width={tamano}
      height={tamano}
      viewBox="0 0 100 100"
      fill="none"
      className={className}
      role="img"
      aria-label="Santa Mónica Fishing"
    >
      <defs>
        <linearGradient id="degradadoMarca" x1="10" y1="10" x2="90" y2="90" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#53A6A6" />
          <stop offset="55%" stopColor="#5095BF" />
          <stop offset="100%" stopColor="#304F8C" />
        </linearGradient>
      </defs>

      {/* Arco exterior */}
      <path
        d="M74 26c-6-9-16-14-27-14C33 12 22 23 22 37c0 13 9 20 22 24 14 4 24 11 24 24 0 14-11 25-25 25-11 0-21-5-27-14"
        stroke="url(#degradadoMarca)"
        strokeWidth="7"
        strokeLinecap="round"
        className={animado ? 'trazo-marca trazo-1' : ''}
      />
      {/* Arco intermedio */}
      <path
        d="M63 38c-3-4-8-7-14-7-7 0-13 6-13 13 0 7 5 10 12 12 8 2 13 6 13 13 0 7-6 13-13 13-6 0-11-3-14-7"
        stroke="url(#degradadoMarca)"
        strokeWidth="5"
        strokeLinecap="round"
        opacity="0.75"
        className={animado ? 'trazo-marca trazo-2' : ''}
      />
      {/* Punto de anclaje interior */}
      <circle
        cx="50" cy="50" r="4"
        fill="#53A6A6"
        opacity="0.9"
        className={animado ? 'trazo-marca trazo-3' : ''}
      />
    </svg>
  );
}
