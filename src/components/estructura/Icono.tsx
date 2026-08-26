/**
 * ============================================================================
 *  ICONOS
 * ============================================================================
 *  Dibujados a mano en SVG, sin librerías externas. Dos razones:
 *   · No añaden peso de descarga (una librería de iconos son cientos de kB).
 *   · Heredan el color del texto, así funcionan igual en tema claro y oscuro.
 *
 *  Trazo de 1,6 px y esquinas redondeadas, para que combinen con la tipografía.
 * ============================================================================
 */

const TRAZOS: Record<string, React.ReactNode> = {
  // --- Navegación ---
  panel: <><rect x="3" y="3" width="7" height="9" rx="1.2" /><rect x="14" y="3" width="7" height="5" rx="1.2" /><rect x="14" y="12" width="7" height="9" rx="1.2" /><rect x="3" y="16" width="7" height="5" rx="1.2" /></>,
  ventas: <><path d="M3 6h2l2.6 9.4a1.5 1.5 0 0 0 1.45 1.1h7.9a1.5 1.5 0 0 0 1.45-1.1L21 8H6" /><circle cx="10" cy="20" r="1.2" /><circle cx="17" cy="20" r="1.2" /></>,
  almacen: <><path d="M3 9.5 12 4l9 5.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" /><path d="M8 21v-7h8v7" /></>,
  logistica: <><rect x="1.5" y="6.5" width="12" height="9" rx="1" /><path d="M13.5 10h4l3 3v2.5h-7z" /><circle cx="6" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" /></>,
  finanzas: <><rect x="2.5" y="5" width="19" height="14" rx="1.5" /><path d="M2.5 10h19" /><path d="M6.5 15h3" /></>,
  trazabilidad: <><circle cx="10.5" cy="10.5" r="6.2" /><path d="m15.3 15.3 5.2 5.2" /><path d="M10.5 7.6v5.8M7.6 10.5h5.8" /></>,
  sistema: <><circle cx="12" cy="12" r="3.2" /><path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3" /></>,

  // --- Acciones ---
  contraer: <><path d="m14 6-6 6 6 6" /></>,
  expandir: <><path d="m10 6 6 6-6 6" /></>,
  menu: <><path d="M3 6h18M3 12h18M3 18h18" /></>,
  cerrar: <><path d="m6 6 12 12M18 6 6 18" /></>,
  buscar: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  descargar: <><path d="M12 3.5v11" /><path d="m7.5 10 4.5 4.5 4.5-4.5" /><path d="M4 19h16" /></>,
  filtro: <><path d="M3.5 5.5h17l-6.5 7.5V19l-4 2v-8z" /></>,
  salir: <><path d="M15 4h3.5a1.5 1.5 0 0 1 1.5 1.5v13a1.5 1.5 0 0 1-1.5 1.5H15" /><path d="M10 8.5 6.5 12l3.5 3.5" /><path d="M6.5 12H16" /></>,
  sol: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2.5M12 19.5V22M22 12h-2.5M4.5 12H2M19 5l-1.8 1.8M6.8 17.2 5 19M19 19l-1.8-1.8M6.8 6.8 5 5" /></>,
  luna: <><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" /></>,
  alerta: <><path d="M12 4 2.8 20h18.4z" /><path d="M12 10v4.5M12 17.4v.2" /></>,
  reloj: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  volver: <><path d="M19 12H5" /><path d="m11 6-6 6 6 6" /></>,
};

export function Icono({
  nombre,
  tamano = 17,
  className = '',
}: {
  nombre: string;
  tamano?: number;
  className?: string;
}) {
  const trazo = TRAZOS[nombre] ?? TRAZOS.panel;
  return (
    <svg
      width={tamano}
      height={tamano}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      style={{ flex: 'none' }}
    >
      {trazo}
    </svg>
  );
}
