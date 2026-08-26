/**
 * ============================================================================
 *  PIEZAS DE PÁGINA
 * ============================================================================
 *  Componentes de presentación que se repiten en todas las pantallas.
 *  Tenerlos en un solo sitio asegura que el sistema se vea coherente y que un
 *  cambio de criterio visual se aplique en todas partes a la vez.
 * ============================================================================
 */
import Link from 'next/link';
import { clases } from '@/lib/formato';

/* --------------------------------------------------------------------------
   Cabecera de pantalla: título, explicación y acciones
   -------------------------------------------------------------------------- */
export function CabeceraPagina({
  titulo,
  descripcion,
  volver,
  children,
}: {
  titulo: string;
  /** Una línea que explica para qué sirve la pantalla, en lenguaje del negocio. */
  descripcion?: string;
  volver?: { href: string; texto: string };
  children?: React.ReactNode;
}) {
  return (
    <header className="cab-pagina">
      <div className="cab-pagina-texto">
        {volver && (
          <Link href={volver.href} className="cab-volver">
            ← {volver.texto}
          </Link>
        )}
        <h1>{titulo}</h1>
        {descripcion && <p>{descripcion}</p>}
      </div>
      {children && <div className="cab-pagina-acciones">{children}</div>}
    </header>
  );
}

/* --------------------------------------------------------------------------
   Rejilla de indicadores
   -------------------------------------------------------------------------- */
export function RejillaKpi({ children }: { children: React.ReactNode }) {
  return <div className="rejilla-kpi">{children}</div>;
}

export function Kpi({
  etiqueta,
  valor,
  sufijo,
  tono = 'neutro',
  nota,
  href,
}: {
  etiqueta: string;
  valor: string | number;
  sufijo?: string;
  tono?: 'neutro' | 'ok' | 'atencion' | 'critico' | 'marca';
  nota?: string;
  href?: string;
}) {
  const contenido = (
    <>
      <span className="kpi-valor" data-tono={tono}>
        {valor}
        {sufijo && <small className="kpi-sufijo">{sufijo}</small>}
      </span>
      <span className="kpi-etiqueta">{etiqueta}</span>
      {nota && <span className="kpi-nota">{nota}</span>}
    </>
  );

  return href ? (
    <Link href={href} className="kpi panel kpi-enlace">{contenido}</Link>
  ) : (
    <div className="kpi panel">{contenido}</div>
  );
}

/* --------------------------------------------------------------------------
   Panel con cabecera
   -------------------------------------------------------------------------- */
export function Panel({
  titulo,
  acciones,
  children,
  className,
}: {
  titulo?: string;
  acciones?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={clases('panel', className)}>
      {(titulo || acciones) && (
        <div className="panel-cabecera">
          {titulo && <span className="panel-titulo">{titulo}</span>}
          {acciones && <div className="panel-acciones">{acciones}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/* --------------------------------------------------------------------------
   Estado vacío: qué hacer cuando no hay datos
   -------------------------------------------------------------------------- */
export function Vacio({
  titulo = 'No hay resultados',
  mensaje,
}: {
  titulo?: string;
  mensaje?: string;
}) {
  return (
    <div className="vacio">
      <strong>{titulo}</strong>
      {mensaje && <span>{mensaje}</span>}
    </div>
  );
}

/* --------------------------------------------------------------------------
   Etiquetas de estado
   -------------------------------------------------------------------------- */
export function Etiqueta({
  texto,
  tono = 'neutro',
}: {
  texto: string;
  tono?: 'ok' | 'atencion' | 'critico' | 'info' | 'neutro';
}) {
  return <span className={`pill pill-${tono}`}>{texto}</span>;
}

/**
 * Semáforo de pedidos: los cinco estados que pide la especificación.
 * El color va acompañado SIEMPRE de texto, porque el color solo no es
 * accesible para quien no lo distingue.
 */
export function Semaforo({
  estado,
}: {
  estado: 'completo' | 'parcial' | 'riesgo' | 'bloqueado' | 'despachado';
}) {
  const textos = {
    completo: 'Completo',
    parcial: 'Parcial',
    riesgo: 'En riesgo',
    bloqueado: 'Bloqueado',
    despachado: 'Despachado',
  };
  return (
    <span className="semaforo-caja" title={textos[estado]}>
      <span className={`semaforo sem-${estado}`} />
      <span className="semaforo-texto">{textos[estado]}</span>
    </span>
  );
}

/* --------------------------------------------------------------------------
   Barra de proporción: para porcentajes de avance
   -------------------------------------------------------------------------- */
export function Barra({
  porcentaje,
  tono = 'marca',
}: {
  porcentaje: number;
  tono?: 'marca' | 'ok' | 'atencion' | 'critico';
}) {
  const p = Math.max(0, Math.min(100, porcentaje));
  return (
    <span
      className="barra-prop"
      role="img"
      aria-label={`${p.toFixed(0)} por ciento`}
      title={`${p.toFixed(1)} %`}
    >
      <span className="barra-prop-relleno" data-tono={tono} style={{ width: `${p}%` }} />
    </span>
  );
}
