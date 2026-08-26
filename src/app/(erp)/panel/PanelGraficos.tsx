'use client';

/**
 * ============================================================================
 *  GRÁFICOS DEL PANEL
 * ============================================================================
 *  Va aparte de la página porque necesita interactividad (pasar el cursor por
 *  las series). Los DATOS ya vienen calculados desde el servidor: aquí solo se
 *  dibujan.
 * ============================================================================
 */
import { Panel } from '@/components/ui/Pagina';
import {
  GraficoLineas,
  GraficoBarras,
  GraficoComposicion,
  Medidor,
} from '@/components/graficos/Graficos';
import { tm, num, dinero } from '@/lib/formato';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];

/** Convierte "2026-08" en "ago 26" para que el eje sea legible. */
function etiquetaMes(periodo: string): string {
  const [anio, mes] = periodo.split('-');
  return `${MESES[Number(mes) - 1] ?? mes} ${anio.slice(2)}`;
}

export function PanelGraficos({
  mensual,
  composicion,
  anticuamiento,
  ocupabilidad,
  topClientes,
  mostrarVenta,
}: {
  mensual: { periodo: string; ingresos: number; despachos: number }[];
  composicion: { nombre: string; valor: number }[];
  anticuamiento: { nombre: string; valor: number }[];
  ocupabilidad: { almacen: string; pct: number; ocupado: number; capacidad: number }[];
  topClientes: { etiqueta: string; valor: number }[];
  mostrarVenta: boolean;
}) {
  return (
    <>
      {/* --- Fila 1: movimiento en el tiempo + composición del stock --- */}
      <div className="rejilla-ancha" style={{ marginBottom: '.85rem' }}>
        <Panel titulo="Ingresos frente a despachos · toneladas por mes">
          <GraficoLineas
            etiquetas={mensual.map((m) => etiquetaMes(m.periodo))}
            series={[
              { nombre: 'Ingresos a cámara', valores: mensual.map((m) => m.ingresos) },
              { nombre: 'Despachos', valores: mensual.map((m) => m.despachos) },
            ]}
            formato="tm"
            area
            altura={230}
          />
        </Panel>

        <Panel titulo="De qué se compone el stock">
          <GraficoComposicion
            partes={composicion}
            formato="kg_a_tm"
          />
          <p className="nota-panel">
            El <strong>disponible</strong> es lo único que Ventas puede prometer hoy.
            Lo reservado ya tiene dueño y lo bloqueado espera dictamen de Calidad.
          </p>
        </Panel>
      </div>

      {/* --- Fila 2: ocupabilidad por bodega --- */}
      <Panel titulo="Ocupabilidad por almacén" className="panel-medidores">
        <div className="medidores">
          {ocupabilidad
            .filter((o) => o.capacidad > 0)
            .map((o) => (
              <Medidor
                key={o.almacen}
                porcentaje={o.pct}
                etiqueta={o.almacen}
                detalle={`${num(o.ocupado, 0)} / ${num(o.capacidad, 0)} TM`}
              />
            ))}
        </div>
      </Panel>

      {/* --- Fila 3: antigüedad + mejores clientes --- */}
      <div className="rejilla-2" style={{ marginTop: '.85rem' }}>
        <Panel titulo="Antigüedad del stock en cámara">
          {/*
            Estas categorías tienen ORDEN natural (de más nuevo a más viejo),
            así que el color usa una rampa de un solo tono: expresa "más" o
            "menos", no identidad.
          */}
          <GraficoBarras
            datos={anticuamiento.map((a) => ({ etiqueta: a.nombre, valor: a.valor }))}
            formato="kg_a_tm"
            horizontal
            tono="rampa"
            altura={130}
          />
          <p className="nota-panel">
            El umbral de alerta es configurable desde <strong>Configuración</strong>.
            Hoy está en 12 meses, tal como lo controla hoy Operaciones.
          </p>
        </Panel>

        {mostrarVenta && (
          <Panel titulo="Principales clientes por venta despachada">
            <GraficoBarras
              datos={topClientes}
              formato="dolares"
              horizontal
              altura={190}
            />
          </Panel>
        )}
      </div>

      <style jsx global>{`
        .nota-panel {
          margin: 0;
          padding: 0 1rem 0.9rem;
          font-size: 0.78rem;
          color: var(--tinta-3);
          line-height: 1.5;
        }
        .medidores {
          display: flex;
          flex-wrap: wrap;
          gap: 1.1rem 1.4rem;
          padding: 1.1rem 1rem;
          justify-content: flex-start;
        }
        .lista-alertas {
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .lista-alertas li {
          display: grid;
          grid-template-columns: auto 1fr auto;
          align-items: start;
          gap: 0.6rem;
          padding: 0.6rem 1rem;
          border-bottom: 1px solid var(--linea);
        }
        .lista-alertas li:last-child {
          border-bottom: none;
        }
        .lista-alertas-texto {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .lista-alertas-texto strong {
          font-size: 0.82rem;
        }
        .lista-alertas-texto span {
          font-size: 0.76rem;
          color: var(--tinta-3);
          line-height: 1.45;
        }
        .lista-alertas time {
          font-family: var(--font-mono);
          font-size: 0.62rem;
          color: var(--tinta-3);
          white-space: nowrap;
        }
      `}</style>
    </>
  );
}
