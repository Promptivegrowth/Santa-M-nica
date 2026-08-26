/**
 * ============================================================================
 *  ESQUELETOS DE CARGA (skeletons)
 * ============================================================================
 *  ¿Qué es un esqueleto? Es la silueta gris de la pantalla que se muestra
 *  mientras los datos viajan desde la base de datos.
 *
 *  ¿Por qué no una ruedita girando?
 *  Porque una ruedita solo dice "espere". El esqueleto, además, muestra la
 *  FORMA de lo que viene: el usuario ya sabe que habrá cuatro indicadores
 *  arriba y una tabla abajo, y su ojo se ubica antes de que lleguen los datos.
 *  La pantalla se siente más rápida aunque tarde lo mismo.
 *
 *  Regla de oro: el esqueleto debe parecerse a la pantalla real. Si no, cuando
 *  lleguen los datos todo salta de sitio y se siente peor que sin esqueleto.
 * ============================================================================
 */

/** Bloque gris básico. Todo lo demás se compone a partir de él. */
export function Bloque({
  ancho = '100%',
  alto = '1rem',
  redondez = '3px',
  className = '',
}: {
  ancho?: string;
  alto?: string;
  redondez?: string;
  className?: string;
}) {
  return (
    <span
      className={`esq-bloque ${className}`}
      style={{ width: ancho, height: alto, borderRadius: redondez }}
      aria-hidden="true"
    />
  );
}

/** Cabecera de pantalla: título y descripción. */
export function EsqueletoCabecera() {
  return (
    <div className="esq-cabecera">
      <Bloque ancho="14rem" alto="1.65rem" />
      <Bloque ancho="min(46rem, 90%)" alto=".9rem" />
    </div>
  );
}

/** Fila de indicadores. */
export function EsqueletoKpi({ cantidad = 4 }: { cantidad?: number }) {
  return (
    <div className="rejilla-kpi">
      {Array.from({ length: cantidad }).map((_, i) => (
        <div key={i} className="panel kpi">
          <Bloque ancho="4.5rem" alto="1.5rem" />
          <div style={{ height: '.45rem' }} />
          <Bloque ancho="6.5rem" alto=".6rem" />
        </div>
      ))}
    </div>
  );
}

/** Tabla de datos. */
export function EsqueletoTabla({
  filas = 8,
  columnas = 6,
  conFiltros = true,
}: {
  filas?: number;
  columnas?: number;
  conFiltros?: boolean;
}) {
  return (
    <div className="panel">
      <div className="panel-cabecera">
        <Bloque ancho="9rem" alto=".7rem" />
      </div>

      {conFiltros && (
        <div className="filtros">
          <Bloque ancho="11rem" alto="1.9rem" />
          <Bloque ancho="8rem" alto="1.9rem" />
          <Bloque ancho="8rem" alto="1.9rem" />
        </div>
      )}

      <div className="esq-tabla">
        {/* Encabezado */}
        <div className="esq-fila esq-fila-cabecera">
          {Array.from({ length: columnas }).map((_, i) => (
            <Bloque key={i} ancho={i === 1 ? '80%' : '55%'} alto=".62rem" />
          ))}
        </div>
        {/* Filas de datos, con anchos ligeramente distintos para que no parezca
            una rejilla perfecta (eso se ve artificial) */}
        {Array.from({ length: filas }).map((_, f) => (
          <div key={f} className="esq-fila">
            {Array.from({ length: columnas }).map((_, c) => (
              <Bloque
                key={c}
                ancho={`${45 + ((f * 7 + c * 13) % 45)}%`}
                alto=".78rem"
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Panel con un gráfico dentro. */
export function EsqueletoGrafico({ altura = '230px' }: { altura?: string }) {
  return (
    <div className="panel">
      <div className="panel-cabecera">
        <Bloque ancho="12rem" alto=".7rem" />
      </div>
      <div className="esq-grafico" style={{ height: altura }}>
        {/* Barras de alturas distintas, para que sugiera un gráfico real */}
        {[52, 74, 41, 88, 63, 79, 48, 92, 57, 70, 45, 83].map((h, i) => (
          <span key={i} className="esq-barra" style={{ height: `${h}%` }} aria-hidden />
        ))}
      </div>
    </div>
  );
}

/** Ficha de datos (pares etiqueta / valor). */
export function EsqueletoFicha({ lineas = 6 }: { lineas?: number }) {
  return (
    <div className="panel">
      <div className="panel-cabecera">
        <Bloque ancho="8rem" alto=".7rem" />
      </div>
      <div className="esq-ficha">
        {Array.from({ length: lineas }).map((_, i) => (
          <div key={i} className="esq-ficha-fila">
            <Bloque ancho="7rem" alto=".62rem" />
            <Bloque ancho={`${40 + ((i * 17) % 45)}%`} alto=".82rem" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Barra de pestañas. */
export function EsqueletoPestanas({ cantidad = 6 }: { cantidad?: number }) {
  return (
    <div className="esq-pestanas">
      {Array.from({ length: cantidad }).map((_, i) => (
        <Bloque key={i} ancho={`${4 + ((i * 3) % 4)}rem`} alto="1.6rem" redondez="3px" />
      ))}
    </div>
  );
}

/**
 * Esqueleto genérico para una pantalla de listado: cabecera, indicadores
 * y tabla. Es el que usan casi todas las pantallas del sistema.
 */
export function EsqueletoListado({
  kpis = 0,
  filas = 10,
  columnas = 7,
}: {
  kpis?: number;
  filas?: number;
  columnas?: number;
}) {
  return (
    <>
      <EsqueletoCabecera />
      {kpis > 0 && <EsqueletoKpi cantidad={kpis} />}
      <EsqueletoTabla filas={filas} columnas={columnas} />
      <span className="sr-solo" role="status">Cargando información…</span>
    </>
  );
}
