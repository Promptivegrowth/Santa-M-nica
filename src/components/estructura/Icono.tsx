/**
 * ============================================================================
 *  ICONOS
 * ============================================================================
 *  Dibujados a mano en SVG, sin librerías externas. Dos razones:
 *   · No añaden peso de descarga (una librería de iconos son cientos de kB).
 *   · Heredan el color del texto, así funcionan igual en tema claro y oscuro.
 *
 *  REGLA IMPORTANTE: cada entrada del menú tiene su PROPIO icono. Un icono que
 *  se repite en seis filas seguidas no informa nada y solo añade ruido visual;
 *  el objetivo es que el usuario reconozca la pantalla por su forma antes de
 *  leer el texto.
 *
 *  Trazo de 1,6 px y esquinas redondeadas, para que combinen con la tipografía.
 * ============================================================================
 */

const TRAZOS: Record<string, React.ReactNode> = {
  /* ─────────── PANEL ─────────── */
  // Tablero: cuatro paneles de distinto tamaño
  panel: <><rect x="3" y="3" width="7.5" height="8" rx="1.2" /><rect x="13.5" y="3" width="7.5" height="5" rx="1.2" /><rect x="13.5" y="10.5" width="7.5" height="10.5" rx="1.2" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.2" /></>,
  // Campana de aviso
  alerta: <><path d="M18 8.5a6 6 0 0 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5" /><path d="M13.7 19.5a2 2 0 0 1-3.4 0" /></>,

  /* ─────────── VENTAS ─────────── */
  // Clientes: dos personas
  clientes: <><circle cx="9" cy="8" r="3.2" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16.5 5.6a3.2 3.2 0 0 1 0 6.2" /><path d="M18 14.4a6.5 6.5 0 0 1 3.5 5.6" /></>,
  // Cotización: documento con etiqueta de precio
  cotizacion: <><path d="M6 2.5h8l4.5 4.5V21a.5.5 0 0 1-.5.5H6a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z" /><path d="M14 2.5V7h4.5" /><path d="M9 13.5h6M9 17h4" /></>,
  // Pedido: portapapeles con lista
  pedido: <><path d="M9 3.5H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21.5h10a1.5 1.5 0 0 0 1.5-1.5V5A1.5 1.5 0 0 0 17 3.5h-2" /><rect x="9" y="2" width="6" height="3.2" rx="1" /><path d="M9 11h6M9 15h6" /></>,
  // Disponibilidad: caja con visto bueno
  disponibilidad: <><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z" /><path d="m8.5 12 2.4 2.4L16 9.3" /></>,
  // Control: semáforo
  control: <><rect x="8" y="2.5" width="8" height="19" rx="4" /><circle cx="12" cy="7.5" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="12" cy="16.5" r="1.4" /></>,
  // Necesidades: caja con hueco
  necesidades: <><path d="M3.5 8 12 3.5 20.5 8v8L12 20.5 3.5 16z" /><path d="M12 12v8.5M3.5 8 12 12l8.5-4" /><path d="M9.2 16.6h5.6" strokeDasharray="1.6 1.6" /></>,

  /* ─────────── ALMACENES ─────────── */
  // Existencias: cajas apiladas
  existencias: <><rect x="3" y="12.5" width="8" height="8" rx="1" /><rect x="13" y="12.5" width="8" height="8" rx="1" /><rect x="8" y="3.5" width="8" height="8" rx="1" /></>,
  // Reservas: caja con candado — producto que está, pero está apartado
  reservas: <><rect x="3" y="10.5" width="18" height="10.5" rx="1.4" /><path d="M7.5 10.5V7.5a4.5 4.5 0 0 1 9 0v3" /><circle cx="12" cy="15.5" r="1.3" /><path d="M12 16.8v1.7" /></>,
  // Kardex: libro abierto
  kardex: <><path d="M12 6.5C10.5 5 8 4.2 4 4.2v13c4 0 6.5.8 8 2.3 1.5-1.5 4-2.3 8-2.3v-13c-4 0-6.5.8-8 2.3z" /><path d="M12 6.5v13" /></>,
  // Ingresos: flecha entrando a una bandeja
  ingresos: <><path d="M12 3v9" /><path d="m8 8.5 4 4 4-4" /><path d="M3.5 14.5v4A1.5 1.5 0 0 0 5 20h14a1.5 1.5 0 0 0 1.5-1.5v-4" /></>,
  // Traslados: dos flechas opuestas
  traslados: <><path d="M4 8.5h13" /><path d="m14 5.5 3 3-3 3" /><path d="M20 15.5H7" /><path d="m10 12.5-3 3 3 3" /></>,
  // Calidad: escudo con visto
  calidad: <><path d="M12 2.7 4.5 5.8v6c0 4.6 3.1 8.5 7.5 9.5 4.4-1 7.5-4.9 7.5-9.5v-6z" /><path d="m9 11.8 2.2 2.2L15.2 10" /></>,
  // Anticuamiento: reloj de arena
  anticuamiento: <><path d="M7 3h10M7 21h10" /><path d="M8 3v3.5c0 2 4 3.7 4 5.5s-4 3.5-4 5.5V21" /><path d="M16 3v3.5c0 2-4 3.7-4 5.5s4 3.5 4 5.5V21" /></>,
  // Valorizado: moneda con símbolo
  valorizado: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v10" /><path d="M14.6 9.3c-.5-.9-1.5-1.4-2.6-1.4-1.6 0-2.6.9-2.6 2.1 0 2.9 5.5 1.6 5.5 4.4 0 1.3-1.1 2.2-2.9 2.2-1.2 0-2.3-.5-2.8-1.5" /></>,

  /* ─────────── LOGÍSTICA ─────────── */
  // Planificador: calendario
  planificador: <><rect x="3" y="5" width="18" height="16" rx="1.6" /><path d="M3 10h18M8 3v4M16 3v4" /><rect x="7" y="13.5" width="3" height="3" rx=".6" /></>,
  // Embarques: barco de carga
  embarques: <><path d="M3 17.5c1.8 0 1.8 1.5 3.6 1.5s1.8-1.5 3.6-1.5 1.8 1.5 3.6 1.5 1.8-1.5 3.6-1.5 1.8 1.5 3.6 1.5" /><path d="M4.5 14.5 6 9.5h12l1.5 5" /><path d="M9 9.5V6h6v3.5" /><path d="M12 3v3" /></>,
  // Packing: contenedor con estrías
  packing: <><rect x="2.5" y="6.5" width="19" height="11" rx="1.2" /><path d="M7 6.5v11M12 6.5v11M17 6.5v11" /></>,
  // Despachos: camión
  despachos: <><path d="M1.5 6.5h12v9h-12z" /><path d="M13.5 10h4l3 3v2.5h-7z" /><circle cx="6" cy="18" r="1.9" /><circle cx="17" cy="18" r="1.9" /></>,

  /* ─────────── FINANZAS ─────────── */
  // Factura: documento con líneas y sello
  facturas: <><path d="M5.5 2.5h13v19l-2.2-1.6-2.2 1.6-2.1-1.6-2.2 1.6-2.1-1.6-2.2 1.6z" /><path d="M9 8h6M9 12h6" /></>,
  // Cobrar: billete con flecha
  cobrar: <><rect x="2.5" y="6" width="19" height="12" rx="1.5" /><circle cx="12" cy="12" r="2.6" /><path d="M6 12h.01M18 12h.01" /></>,
  // Rentabilidad: gráfico ascendente
  rentabilidad: <><path d="M3.5 20.5h17" /><path d="M6 16.5V13M10.5 16.5V9.5M15 16.5v-5M19.5 16.5V6" /></>,

  /* ─────────── TRAZABILIDAD ─────────── */
  // Buscador
  trazabilidad: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.4 15.4 5 5" /><path d="M8 10.5h5M10.5 8v5" /></>,
  // Retiro sanitario: alerta biológica
  retiro: <><path d="M10.3 3.6 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0z" /><path d="M12 9.5v4.2M12 17.2v.1" /></>,
  // Auditoría: lupa sobre documento
  auditoria: <><path d="M14.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V7.5z" /><path d="M14 3.5v4h4.5" /><circle cx="11.5" cy="13" r="2.6" /><path d="m13.6 15.1 2 2" /></>,

  /* ─────────── SISTEMA ─────────── */
  reportes: <><path d="M12 3v11" /><path d="m7.5 9.5 4.5 4.5 4.5-4.5" /><path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17" /></>,
  configuracion: <><circle cx="12" cy="12" r="3.2" /><path d="M19.5 12a7.6 7.6 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7.4 7.4 0 0 0-2.1-1.2l-.3-2.5h-4l-.3 2.5c-.8.3-1.5.7-2.1 1.2l-2.3-1-2 3.4 2 1.5a7.6 7.6 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1c.6.5 1.3.9 2.1 1.2l.3 2.5h4l.3-2.5c.8-.3 1.5-.7 2.1-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z" /></>,

  /* ─────────── ACCIONES ─────────── */
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
  reloj: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  volver: <><path d="M19 12H5" /><path d="m11 6-6 6 6 6" /></>,
  mas: <><path d="M12 5v14M5 12h14" /></>,
  guardar: <><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" /></>,
  papelera: <><path d="M3.5 6h17M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6" /><path d="M18.5 6v13.5a1.5 1.5 0 0 1-1.5 1.5H7a1.5 1.5 0 0 1-1.5-1.5V6" /></>,
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
