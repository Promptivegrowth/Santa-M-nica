/**
 * ============================================================================
 *  INVENTARIO VALORIZADO · cuánto vale lo que hay
 * ============================================================================
 *  El costo se calcula por PROMEDIO MÓVIL: cada vez que entra producto, el
 *  costo del lote se recalcula ponderando lo que ya había con lo que entra.
 *  Al salir producto, el costo no cambia.
 *
 *  El método es un parámetro configurable desde Configuración.
 * ============================================================================
 */
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio } from '@/components/ui/Pagina';
import { GraficoBarras } from '@/components/graficos/Graficos';
import { tm, num, dinero } from '@/lib/formato';
import { veCostos, type Rol } from '@/lib/navegacion';

export const metadata: Metadata = { title: 'Inventario valorizado' };
export const dynamic = 'force-dynamic';

export default async function PaginaValorizado() {
  const usuario = await obtenerUsuarioActual();
  // Esta pantalla muestra costos: los roles sin permiso no deben llegar aquí.
  if (!veCostos((usuario?.rol ?? 'consulta') as Rol)) redirect('/panel');

  const supabase = await crearClienteServidor();
  const [{ data: resumen }, { data: ocupabilidad }, { data: rotacion }] = await Promise.all([
    supabase.from('v_resumen_inventario').select('*').single(),
    supabase.from('v_ocupabilidad').select('*').order('ocupado_tm', { ascending: false }),
    supabase.from('v_rotacion_sku').select('*').order('valor', { ascending: false }).limit(40),
  ]);

  const inv = resumen ?? { fisico_kg: 0, disponible_kg: 0, reservado_kg: 0, bloqueado_kg: 0, valor_total: 0, lotes: 0 };
  const costoPromedio = Number(inv.fisico_kg) > 0 ? Number(inv.valor_total) / Number(inv.fisico_kg) : 0;

  return (
    <>
      <CabeceraPagina
        titulo="Inventario valorizado"
        descripcion="Cuánto capital hay inmovilizado en cámara, calculado a costo promedio móvil."
      />

      <RejillaKpi>
        <Kpi etiqueta="Valor total del inventario" valor={dinero(inv.valor_total, 'USD', 0)} tono="marca" />
        <Kpi etiqueta="Toneladas" valor={tm(inv.fisico_kg)} sufijo="TM" nota={`${num(inv.lotes)} lotes`} />
        <Kpi etiqueta="Costo promedio" valor={dinero(costoPromedio * 1000, 'USD', 0)} nota="Por tonelada" />
        <Kpi etiqueta="Valor bloqueado" valor={dinero(Number(inv.bloqueado_kg) * costoPromedio, 'USD', 0)} tono="critico"
             nota="Capital detenido por calidad" />
      </RejillaKpi>

      <Panel titulo="Valor por almacén" className="mb-espacio">
        <GraficoBarras
          datos={(ocupabilidad ?? []).map((o) => ({
            etiqueta: o.almacen as string,
            valor: Number(o.ocupado_tm ?? 0) * 1000 * costoPromedio,
            nota: `${num(o.ocupado_tm, 1)} TM`,
          }))}
          formato="dolares"
          horizontal
          altura={230}
        />
      </Panel>

      <Panel titulo="Productos con mayor capital inmovilizado">
        {(rotacion ?? []).length === 0 ? (
          <Vacio titulo="Sin datos" mensaje="Todavía no hay stock valorizado." />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos">
              <thead>
                <tr>
                  <th>SKU</th><th>Producto</th><th>Presentación</th>
                  <th className="num">Stock</th><th className="num">Salidas 12 m</th>
                  <th className="num">Rotación</th><th className="num">Valor</th>
                </tr>
              </thead>
              <tbody>
                {(rotacion ?? []).map((r, i) => (
                  <tr key={i}>
                    <td className="mono">{r.sku_codigo as string}</td>
                    <td>
                      {r.especie as string} · {r.formato as string}
                      <br /><span style={{ color: 'var(--tinta-3)', fontSize: '.74rem' }}>{r.corte as string}</span>
                    </td>
                    <td className="mono">{r.presentacion as string}</td>
                    <td className="num">{num(r.stock_tm, 1)} TM</td>
                    <td className="num">{num(r.salidas_12m_tm, 1)} TM</td>
                    <td className="num" style={{ color: Number(r.rotacion) < 0.5 ? 'var(--atencion)' : undefined }}>
                      {num(r.rotacion, 2)}
                    </td>
                    <td className="num"><strong>{dinero(r.valor, 'USD', 0)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="pie-explicativo">
        La <strong>rotación</strong> compara lo que salió en los últimos 12 meses contra lo que hay
        hoy en cámara. Un valor bajo indica producto que se mueve poco y está inmovilizando capital.
      </p>
    </>
  );
}
