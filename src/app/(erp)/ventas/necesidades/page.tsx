/**
 * ============================================================================
 *  NECESIDADES · qué falta producir o comprar
 * ============================================================================
 *  Compara lo que está prometido a los clientes contra lo que hay disponible.
 *  La diferencia es lo que Producción tiene que fabricar o Compras conseguir.
 *
 *  Es el puente entre Ventas y Producción, y sustituye la conversación
 *  informal de "¿tenemos filete L-P para el pedido de la próxima semana?".
 * ============================================================================
 */
import type { Metadata } from 'next';
import { crearClienteServidor } from '@/lib/supabase/servidor';
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio, Barra } from '@/components/ui/Pagina';
import { GraficoBarras } from '@/components/graficos/Graficos';
import { num, fecha } from '@/lib/formato';

export const metadata: Metadata = { title: 'Necesidades' };
export const dynamic = 'force-dynamic';

export default async function PaginaNecesidades() {
  const supabase = await crearClienteServidor();
  const { data: filas } = await supabase
    .from('v_necesidades').select('*').order('tm_faltantes', { ascending: false });

  const lista = filas ?? [];
  const totalFalta = lista.reduce((s, f) => s + Number(f.tm_faltantes ?? 0), 0);
  const totalPedido = lista.reduce((s, f) => s + Number(f.tm_pedidas ?? 0), 0);
  const skusAfectados = lista.length;
  // Cuántos pedidos distintos dependen de que esto se produzca. Es el dato
  // que convierte «faltan 40 TM» en «hay 6 clientes esperando».
  const pedidosAfectados = new Set(lista.flatMap((f) => [f.pedidos])).size;

  return (
    <>
      <CabeceraPagina
        titulo="Necesidades"
        descripcion="Lo que está prometido a clientes y no está cubierto con stock. Es el requerimiento que va a Producción."
      />

      <RejillaKpi>
        <Kpi etiqueta="Toneladas faltantes" valor={num(totalFalta, 1)} sufijo="TM" tono={totalFalta > 0 ? 'critico' : 'ok'} />
        <Kpi etiqueta="Productos afectados" valor={num(skusAfectados)} tono="atencion" />
        <Kpi
          etiqueta="Pedidos en espera"
          valor={num(pedidosAfectados)}
          tono={pedidosAfectados > 0 ? 'atencion' : 'ok'}
          nota="Dependen de esta producción"
        />
        <Kpi etiqueta="Total comprometido" valor={num(totalPedido, 1)} sufijo="TM" nota="En pedidos confirmados" />
      </RejillaKpi>

      {lista.length > 0 && (
        <Panel titulo="Mayores faltantes" className="mb-espacio">
          <GraficoBarras
            datos={lista.slice(0, 10).map((f) => ({
              etiqueta: `${f.sku_codigo} · ${f.corte}`.slice(0, 34),
              valor: Number(f.tm_faltantes ?? 0),
              nota: `${f.pedidos} pedidos`,
            }))}
            formato="tm"
            horizontal
            altura={220}
          />
        </Panel>
      )}

      <Panel titulo={`${lista.length} productos con faltante`}>
        {lista.length === 0 ? (
          <Vacio
            titulo="Todo cubierto"
            mensaje="Todos los pedidos confirmados tienen stock disponible suficiente."
          />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos">
              <thead>
                <tr>
                  <th>SKU</th><th>Producto</th><th>Presentación</th>
                  <th className="num">Pedido</th><th className="num">Disponible</th>
                  <th className="num">Falta</th><th className="num">Cobertura</th>
                  <th className="num">Pedidos</th><th className="num">Fecha más próxima</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((f, i) => {
                  const cobertura = (Number(f.tm_disponibles) / (Number(f.tm_pedidas) || 1)) * 100;
                  return (
                    <tr key={i}>
                      <td className="mono">{f.sku_codigo as string}</td>
                      <td>
                        {f.especie as string} · {f.formato as string}
                        <br />
                        <span style={{ color: 'var(--tinta-3)', fontSize: '.74rem' }}>{f.corte as string}</span>
                      </td>
                      <td className="mono">{f.presentacion as string}</td>
                      <td className="num">{num(f.tm_pedidas, 1)}</td>
                      <td className="num">{num(f.tm_disponibles, 1)}</td>
                      <td className="num"><strong style={{ color: 'var(--critico)' }}>{num(f.tm_faltantes, 1)}</strong></td>
                      <td className="num" style={{ minWidth: '5rem' }}>
                        <Barra porcentaje={cobertura} tono={cobertura >= 100 ? 'ok' : cobertura > 50 ? 'atencion' : 'critico'} />
                      </td>
                      <td className="num">{num(f.pedidos)}</td>
                      <td className="num">{fecha(f.fecha_mas_proxima as string)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="pie-explicativo">
        Las cantidades están en toneladas. El faltante se calcula comparando lo comprometido en
        pedidos <strong>confirmados</strong> contra el stock <strong>disponible</strong> — es decir,
        ya descontando lo bloqueado por calidad y lo reservado para otros pedidos.
      </p>
    </>
  );
}
