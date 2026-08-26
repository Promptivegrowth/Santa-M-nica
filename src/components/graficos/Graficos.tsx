'use client';

/**
 * ============================================================================
 *  GRÁFICOS · dibujados en SVG, sin librerías externas
 * ============================================================================
 *  ¿Por qué SVG a mano y no una librería de gráficos?
 *   · Peso: una librería típica añade entre 100 y 400 kB al navegador. Estos
 *     gráficos pesan unos pocos kB y la pantalla abre notablemente más rápido.
 *   · Control: el color, el grosor del trazo y la tipografía siguen exactamente
 *     el sistema de diseño de la marca.
 *   · Tema: heredan las variables CSS, así que el modo oscuro sale solo.
 *
 *  Todos los gráficos incluyen:
 *   · Capa de interacción (el dato se muestra al pasar el cursor o tocar).
 *   · Leyenda cuando hay dos o más series, y etiquetas directas cuando caben,
 *     para que la identidad nunca dependa únicamente del color.
 *   · Rejilla discreta que no compite con los datos.
 * ============================================================================
 */
import { useState, useEffect, useId } from 'react';
import { colorSerie, colorRampa, ESTADO } from './paleta';
import { tm, num, dinero } from '@/lib/formato';

/* --------------------------------------------------------------------------
   FORMATO DE LOS VALORES
   --------------------------------------------------------------------------
   Estos gráficos corren en el navegador, pero los usan pantallas que se
   renderizan en el servidor. React NO permite pasar funciones desde el
   servidor al navegador, así que en lugar de mandar una función de formato se
   manda el NOMBRE del formato y aquí se aplica.
   -------------------------------------------------------------------------- */
export type Formato =
  | 'kg_a_tm'    // el valor viene en kilos y se muestra en toneladas
  | 'tm'         // el valor ya viene en toneladas
  | 'dolares'
  | 'soles'
  | 'entero'
  | 'decimal';

/** Aplica el formato indicado y le añade el sufijo si lo hay. */
function aplicarFormato(valor: number, formato: Formato = 'entero', sufijo?: string): string {
  let texto: string;
  switch (formato) {
    case 'kg_a_tm': texto = `${tm(valor)} TM`; break;
    case 'tm':      texto = `${num(valor, 1)} TM`; break;
    case 'dolares': texto = dinero(valor, 'USD', 0); break;
    case 'soles':   texto = dinero(valor, 'PEN', 0); break;
    case 'decimal': texto = num(valor, 2); break;
    default:        texto = num(valor, 0);
  }
  return sufijo ? `${texto} ${sufijo}` : texto;
}

/* --------------------------------------------------------------------------
   Detecta si estamos en tema oscuro, para elegir la paleta correcta.
   -------------------------------------------------------------------------- */
function useTemaOscuro(): boolean {
  const [oscuro, setOscuro] = useState(false);

  useEffect(() => {
    function calcular() {
      const marca = document.documentElement.getAttribute('data-tema');
      if (marca === 'oscuro') return true;
      if (marca === 'claro') return false;
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    setOscuro(calcular());

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const alCambiar = () => setOscuro(calcular());
    mq.addEventListener('change', alCambiar);

    // También reaccionamos si el usuario cambia el tema desde la cabecera
    const obs = new MutationObserver(alCambiar);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-tema'] });

    return () => { mq.removeEventListener('change', alCambiar); obs.disconnect(); };
  }, []);

  return oscuro;
}

/* --------------------------------------------------------------------------
   Leyenda compartida
   -------------------------------------------------------------------------- */
function Leyenda({ series }: { series: { nombre: string; color: string }[] }) {
  if (series.length < 2) return null; // con una sola serie el título ya la nombra
  return (
    <ul className="grafico-leyenda">
      {series.map((s) => (
        <li key={s.nombre}>
          <span className="grafico-leyenda-marca" style={{ background: s.color }} />
          {s.nombre}
        </li>
      ))}
    </ul>
  );
}

/* ==========================================================================
   1. GRÁFICO DE BARRAS
   Para comparar magnitudes entre categorías (toneladas por almacén, ventas
   por cliente, etc.).
   ========================================================================== */
export type Barra = { etiqueta: string; valor: number; nota?: string; tono?: 'serie' | 'rampa' | 'estado' };

export function GraficoBarras({
  datos,
  altura = 220,
  formato = 'entero',
  sufijo,
  horizontal = false,
  tono = 'serie',
}: {
  datos: Barra[];
  altura?: number;
  formato?: Formato;
  sufijo?: string;
  /** Horizontal cuando las etiquetas son largas (nombres de clientes o bodegas). */
  horizontal?: boolean;
  tono?: 'serie' | 'rampa';
}) {
  const oscuro = useTemaOscuro();
  const [activa, setActiva] = useState<number | null>(null);

  if (!datos.length) return <div className="grafico-vacio">Sin datos para mostrar</div>;

  const max = Math.max(...datos.map((d) => d.valor), 1);

  function color(_d: Barra, i: number) {
    return tono === 'rampa' ? colorRampa(i, datos.length, oscuro) : colorSerie(0, oscuro);
  }
  const fmt = (v: number) => aplicarFormato(v, formato, sufijo);

  /* ---- Variante horizontal: una fila por categoría ---- */
  if (horizontal) {
    return (
      <div className="grafico-barras-h" style={{ minHeight: altura }}>
        {datos.map((d, i) => (
          <div
            key={d.etiqueta + i}
            className="barra-h"
            onMouseEnter={() => setActiva(i)}
            onMouseLeave={() => setActiva(null)}
            data-activa={activa === i ? 'si' : 'no'}
          >
            <span className="barra-h-etiqueta" title={d.etiqueta}>{d.etiqueta}</span>
            <span className="barra-h-pista">
              <span
                className="barra-h-relleno"
                style={{ width: `${(d.valor / max) * 100}%`, background: color(d, i) }}
              />
            </span>
            {/* Etiqueta directa: el número siempre visible, sin depender del color */}
            <span className="barra-h-valor">{fmt(d.valor)}</span>
            {activa === i && d.nota && <span className="barra-h-nota">{d.nota}</span>}
          </div>
        ))}
      </div>
    );
  }

  /* ---- Variante vertical ---- */
  const ancho = 100;
  const separacion = 2; // hueco de superficie entre barras
  const anchoBarra = (ancho - separacion * (datos.length - 1)) / datos.length;

  return (
    <div className="grafico-caja">
      <svg
        viewBox={`0 0 ${ancho} 60`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: altura }}
        role="img"
        aria-label="Gráfico de barras"
      >
        {/* Rejilla discreta al fondo */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f} x1={0} x2={ancho} y1={60 - f * 56} y2={60 - f * 56}
            stroke="var(--linea)" strokeWidth="0.25" vectorEffect="non-scaling-stroke"
          />
        ))}

        {datos.map((d, i) => {
          const h = (d.valor / max) * 56;
          const x = i * (anchoBarra + separacion);
          return (
            <rect
              key={d.etiqueta + i}
              x={x} y={60 - h} width={anchoBarra} height={Math.max(h, 0.6)}
              rx="1"
              fill={color(d, i)}
              opacity={activa === null || activa === i ? 1 : 0.45}
              onMouseEnter={() => setActiva(i)}
              onMouseLeave={() => setActiva(null)}
              style={{ transition: 'opacity .12s ease' }}
            >
              <title>{`${d.etiqueta}: ${fmt(d.valor)}`}</title>
            </rect>
          );
        })}
      </svg>

      <div className="grafico-eje-x">
        {datos.map((d, i) => (
          <span key={d.etiqueta + i} data-activa={activa === i ? 'si' : 'no'} title={d.etiqueta}>
            {d.etiqueta}
          </span>
        ))}
      </div>

      {activa !== null && (
        <div className="grafico-globo">
          <strong>{datos[activa].etiqueta}</strong>
          <span>{fmt(datos[activa].valor)}</span>
          {datos[activa].nota && <small>{datos[activa].nota}</small>}
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
   2. GRÁFICO DE LÍNEAS
   Para evolución en el tiempo. Admite hasta tres series.
   ========================================================================== */
export type Serie = { nombre: string; valores: number[] };

export function GraficoLineas({
  etiquetas,
  series,
  altura = 220,
  formato = 'entero',
  sufijo,
  area = false,
}: {
  etiquetas: string[];
  series: Serie[];
  altura?: number;
  formato?: Formato;
  sufijo?: string;
  area?: boolean;
}) {
  const oscuro = useTemaOscuro();
  const [pos, setPos] = useState<number | null>(null);
  const id = useId();

  if (!series.length || !etiquetas.length) {
    return <div className="grafico-vacio">Sin datos para mostrar</div>;
  }

  const todos = series.flatMap((s) => s.valores);
  const max = Math.max(...todos, 1);
  const min = Math.min(...todos, 0);
  const rango = max - min || 1;

  const W = 100, H = 60, margen = 2;
  const x = (i: number) => (i / Math.max(1, etiquetas.length - 1)) * W;
  const y = (v: number) => H - margen - ((v - min) / rango) * (H - margen * 2);

  const conColor = series.map((s, i) => ({ ...s, color: colorSerie(i, oscuro) }));
  const fmt = (v: number) => aplicarFormato(v, formato, sufijo);

  return (
    <div className="grafico-caja">
      <Leyenda series={conColor.map((s) => ({ nombre: s.nombre, color: s.color }))} />

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: altura }}
        role="img"
        aria-label="Gráfico de evolución"
        onMouseLeave={() => setPos(null)}
        onMouseMove={(e) => {
          const caja = e.currentTarget.getBoundingClientRect();
          const rel = (e.clientX - caja.left) / caja.width;
          setPos(Math.round(rel * (etiquetas.length - 1)));
        }}
      >
        {/* Rejilla */}
        {[0, 0.5, 1].map((f) => (
          <line
            key={f} x1={0} x2={W} y1={margen + f * (H - margen * 2)} y2={margen + f * (H - margen * 2)}
            stroke="var(--linea)" strokeWidth="0.25" vectorEffect="non-scaling-stroke"
          />
        ))}

        {conColor.map((s, si) => {
          const puntos = s.valores.map((v, i) => `${x(i)},${y(v)}`).join(' ');
          return (
            <g key={s.nombre}>
              {area && (
                <>
                  <defs>
                    <linearGradient id={`${id}-deg-${si}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={s.color} stopOpacity="0.26" />
                      <stop offset="100%" stopColor={s.color} stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <polygon
                    points={`0,${H} ${puntos} ${W},${H}`}
                    fill={`url(#${id}-deg-${si})`}
                  />
                </>
              )}
              <polyline
                points={puntos}
                fill="none"
                stroke={s.color}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
              {/* Punto final destacado: ayuda a leer el valor actual */}
              <circle
                cx={x(s.valores.length - 1)} cy={y(s.valores[s.valores.length - 1])}
                r="1.6" fill={s.color} stroke="var(--superficie)" strokeWidth="0.8"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}

        {/* Cruceta de lectura */}
        {pos !== null && pos >= 0 && pos < etiquetas.length && (
          <>
            <line
              x1={x(pos)} x2={x(pos)} y1={0} y2={H}
              stroke="var(--tinta-3)" strokeWidth="0.4" strokeDasharray="1.5 1.5"
              vectorEffect="non-scaling-stroke"
            />
            {conColor.map((s) => (
              <circle
                key={s.nombre}
                cx={x(pos)} cy={y(s.valores[pos] ?? 0)} r="2"
                fill={s.color} stroke="var(--superficie)" strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </>
        )}
      </svg>

      <div className="grafico-eje-x">
        {etiquetas.map((e, i) => (
          <span key={e + i} data-activa={pos === i ? 'si' : 'no'}>{e}</span>
        ))}
      </div>

      {pos !== null && pos >= 0 && pos < etiquetas.length && (
        <div className="grafico-globo">
          <strong>{etiquetas[pos]}</strong>
          {conColor.map((s) => (
            <span key={s.nombre} className="grafico-globo-serie">
              <i style={{ background: s.color }} />
              {s.nombre}: <b>{fmt(s.valores[pos] ?? 0)}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
   3. COMPOSICIÓN (barra apilada horizontal)
   Para mostrar de qué se compone un total: físico = disponible + reservado +
   bloqueado. Es más legible que un gráfico circular.
   ========================================================================== */
export function GraficoComposicion({
  partes,
  formato = 'entero',
  sufijo,
}: {
  partes: { nombre: string; valor: number; color?: string }[];
  formato?: Formato;
  sufijo?: string;
}) {
  const oscuro = useTemaOscuro();
  const fmt = (v: number) => aplicarFormato(v, formato, sufijo);
  const total = partes.reduce((s, p) => s + p.valor, 0) || 1;

  const conColor = partes.map((p, i) => ({
    ...p,
    color: p.color ?? colorSerie(i, oscuro),
    pct: (p.valor / total) * 100,
  }));

  return (
    <div className="grafico-composicion">
      <div className="composicion-barra" role="img" aria-label="Composición del total">
        {conColor.map((p) => (
          <span
            key={p.nombre}
            className="composicion-parte"
            style={{ width: `${p.pct}%`, background: p.color }}
            title={`${p.nombre}: ${fmt(p.valor)} (${p.pct.toFixed(1)} %)`}
          />
        ))}
      </div>
      <ul className="composicion-detalle">
        {conColor.map((p) => (
          <li key={p.nombre}>
            <span className="composicion-marca" style={{ background: p.color }} />
            <span className="composicion-nombre">{p.nombre}</span>
            <span className="composicion-valor">{fmt(p.valor)}</span>
            <span className="composicion-pct">{p.pct.toFixed(1)} %</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ==========================================================================
   4. MINIGRÁFICO (sparkline)
   Una tendencia diminuta que acompaña a un indicador.
   ========================================================================== */
export function MiniGrafico({
  valores,
  ancho = 84,
  alto = 24,
  tono = 'serie',
}: {
  valores: number[];
  ancho?: number;
  alto?: number;
  tono?: 'serie' | 'ok' | 'critico';
}) {
  const oscuro = useTemaOscuro();
  if (valores.length < 2) return null;

  const max = Math.max(...valores);
  const min = Math.min(...valores);
  const rango = max - min || 1;
  const puntos = valores
    .map((v, i) => `${(i / (valores.length - 1)) * ancho},${alto - ((v - min) / rango) * (alto - 3) - 1.5}`)
    .join(' ');

  const color =
    tono === 'ok' ? (oscuro ? ESTADO.ok.oscuro : ESTADO.ok.claro)
    : tono === 'critico' ? (oscuro ? ESTADO.critico.oscuro : ESTADO.critico.claro)
    : colorSerie(0, oscuro);

  return (
    <svg width={ancho} height={alto} aria-hidden="true" style={{ display: 'block' }}>
      <polyline
        points={puntos} fill="none" stroke={color} strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round"
      />
      <circle
        cx={ancho} cy={alto - ((valores[valores.length - 1] - min) / rango) * (alto - 3) - 1.5}
        r="2" fill={color}
      />
    </svg>
  );
}

/* ==========================================================================
   5. MEDIDOR CIRCULAR (ocupabilidad de una bodega)
   ========================================================================== */
export function Medidor({
  porcentaje,
  etiqueta,
  detalle,
  tamano = 96,
}: {
  porcentaje: number;
  etiqueta: string;
  detalle?: string;
  tamano?: number;
}) {
  const oscuro = useTemaOscuro();
  const p = Math.max(0, Math.min(100, porcentaje));
  const r = 40;
  const circunferencia = 2 * Math.PI * r;

  // El color expresa ESTADO (holgado / justo / lleno), no identidad.
  const color =
    p >= 90 ? (oscuro ? ESTADO.critico.oscuro : ESTADO.critico.claro)
    : p >= 75 ? (oscuro ? ESTADO.atencion.oscuro : ESTADO.atencion.claro)
    : colorSerie(0, oscuro);

  return (
    <div className="medidor" style={{ width: tamano }}>
      <svg viewBox="0 0 100 100" width={tamano} height={tamano} role="img"
           aria-label={`${etiqueta}: ${p.toFixed(1)} por ciento`}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--superficie-3)" strokeWidth="9" />
        <circle
          cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={`${(p / 100) * circunferencia} ${circunferencia}`}
          transform="rotate(-90 50 50)"
          style={{ transition: 'stroke-dasharray .5s ease' }}
        />
        <text x="50" y="49" textAnchor="middle" dominantBaseline="middle"
              className="medidor-cifra">{p.toFixed(0)}%</text>
      </svg>
      <span className="medidor-etiqueta">{etiqueta}</span>
      {detalle && <span className="medidor-detalle">{detalle}</span>}
    </div>
  );
}
