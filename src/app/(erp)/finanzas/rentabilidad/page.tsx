/**
 * ============================================================================
 *  RENTABILIDAD · por pedido, cliente, producto y vendedor
 * ============================================================================
 *  La especificación pedía las cuatro vistas. El costo lo aporta Almacenes:
 *  es el costo promedio móvil de los lotes que efectivamente se despacharon.
 *
 *  El margen mínimo aceptable es un parámetro configurable; por debajo de él,
 *  el pedido se marca como "margen bajo".
 * ============================================================================
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { GraficoBarras } from '@/components/graficos/Graficos';
import { num, dinero, pct, fecha } from '@/lib/formato';
import { veCostos, type Rol } from '@/lib/navegacion';

export const metadata: Metadata = { title: 'Rentabilidad' };
export const dynamic = 'force-dynamic';

const EJES = [
  { clave: 'pedido',   titulo: 'Por pedido' },
  { clave: 'cliente',  titulo: 'Por cliente' },
  { clave: 'vendedor', titulo: 'Por vendedor' },
  { clave: 'bajo',     titulo: 'Margen bajo' },
];

export default async function PaginaRentabilidad(props: PageProps<'/finanzas/rentabilidad'>) {
  const q = await props.searchParams;
  const eje = (q.eje as string) ?? 'pedido';

  const usuario = await obtenerUsuarioActual();
  if (!veCostos((usuario?.rol ?? 'consulta') as Rol)) redirect('/panel');

  const supabase = await crearClienteServidor();
  const [{ data: filas }, { data: minimo }] = await Promise.all([
    supabase.from('v_rentabilidad_pedido').select('*').in('ciclo', ['despachado', 'cerrado']).limit(1000),
    supabase.from('parametros').select('valor').eq('clave', 'margen_minimo_alerta').single(),
  ]);

  const lista = filas ?? [];
  const margenMinimo = Number(minimo?.valor ?? 8);

  const venta = lista.reduce((s, f) => s + Number(f.venta ?? 0), 0);
  const costo = lista.reduce((s, f) => s + Number(f.costo_estimado ?? 0), 0);
  const margen = venta - costo;
  const margenPct = venta > 0 ? (margen / venta) * 100 : 0;
  const bajoMargen = lista.filter((f) => Number(f.margen_pct) < margenMinimo);

  /** Agrupa por la dimensión elegida. */
  function agrupar(campo: 'cliente' | 'vendedor') {
    const m = new Map<string, { venta: number; margen: number }>();
    for (const f of lista) {
      const k = (f[campo] as string) ?? 'Sin asignar';
      const a = m.get(k) ?? { venta: 0, margen: 0 };
      a.venta += Number(f.venta ?? 0);
      a.margen += Number(f.margen ?? 0);
      m.set(k, a);
    }
    return [...m.entries()]
      .map(([nombre, v]) => ({ nombre, ...v, pct: v.venta > 0 ? (v.margen / v.venta) * 100 : 0 }))
      .sort((a, b) => b.venta - a.venta);
  }

  const agrupado = eje === 'cliente' ? agrupar('cliente') : eje === 'vendedor' ? agrupar('vendedor') : [];

  return (
    <>
      <CabeceraPagina
        titulo="Rentabilidad"
        descripcion={`Venta contra costo de los pedidos ya despachados. El margen mínimo aceptable está configurado en ${margenMinimo} %.`}
      />

      <RejillaKpi>
        <Kpi etiqueta="Venta despachada" valor={dinero(venta, 'USD', 0)} tono="marca" />
        <Kpi etiqueta="Costo" valor={dinero(costo, 'USD', 0)} />
        <Kpi etiqueta="Margen" valor={dinero(margen, 'USD', 0)} tono="ok" />
        <Kpi etiqueta="Margen %" valor={pct(margenPct)} tono={margenPct < margenMinimo ? 'critico' : 'ok'} />
        <Kpi etiqueta="Pedidos con margen bajo" valor={num(bajoMargen.length)}
             tono={bajoMargen.length > 0 ? 'atencion' : 'ok'} href="/finanzas/rentabilidad?eje=bajo" />
      </RejillaKpi>

      <nav className="pestanas no-imprimir" aria-label="Ejes de análisis">
        {EJES.map((e) => (
          <Link key={e.clave} href={`/finanzas/rentabilidad?eje=${e.clave}`} className="pestana"
                data-activa={eje === e.clave ? 'si' : 'no'}>{e.titulo}</Link>
        ))}
      </nav>

      {(eje === 'cliente' || eje === 'vendedor') && (
        <>
          <Panel titulo={`Venta por ${eje}`} className="mb-espacio">
            <GraficoBarras
              datos={agrupado.slice(0, 12).map((a) => ({
                etiqueta: a.nombre.length > 26 ? a.nombre.slice(0, 25) + '…' : a.nombre,
                valor: a.venta,
                nota: `margen ${a.pct.toFixed(1)} %`,
              }))}
              formato="dolares"
              horizontal
              altura={260}
            />
          </Panel>
          <Panel titulo={`Detalle por ${eje}`}>
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos">
                <thead>
                  <tr><th>{eje === 'cliente' ? 'Cliente' : 'Vendedor'}</th>
                      <th className="num">Venta</th><th className="num">Margen</th><th className="num">Margen %</th></tr>
                </thead>
                <tbody>
                  {agrupado.map((a) => (
                    <tr key={a.nombre}>
                      <td>{a.nombre}</td>
                      <td className="num">{dinero(a.venta, 'USD', 0)}</td>
                      <td className="num">{dinero(a.margen, 'USD', 0)}</td>
                      <td className="num">
                        <strong style={{ color: a.pct < margenMinimo ? 'var(--critico)' : 'var(--ok)' }}>
                          {pct(a.pct)}
                        </strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}

      {(eje === 'pedido' || eje === 'bajo') && (
        <Panel titulo={eje === 'bajo' ? `${bajoMargen.length} pedidos por debajo del margen mínimo` : `${lista.length} pedidos despachados`}>
          {(eje === 'bajo' ? bajoMargen : lista).length === 0 ? (
            <Vacio titulo="Sin resultados" mensaje="No hay pedidos en esta categoría." />
          ) : (
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos">
                <thead>
                  <tr>
                    <th>Proforma</th><th>Cliente</th><th className="num">Fecha</th><th className="num">TM</th>
                    <th className="num">Venta</th><th className="num">Costo</th>
                    <th className="num">Margen</th><th className="num">Margen %</th>
                  </tr>
                </thead>
                <tbody>
                  {(eje === 'bajo' ? bajoMargen : lista).slice(0, 200).map((f) => (
                    <tr key={f.pedido_id as number}>
                      <td>
                        <Link href={`/ventas/pedidos/${f.pedido_id}?t=rentabilidad`} className="enlace-dato">
                          {f.numero_proforma as string}
                        </Link>
                      </td>
                      <td title={f.cliente as string}>
                        {String(f.cliente).length > 26 ? String(f.cliente).slice(0, 25) + '…' : String(f.cliente)}
                      </td>
                      <td className="num">{fecha(f.fecha_solicitada as string)}</td>
                      <td className="num">{num(f.tm, 1)}</td>
                      {/* La vista devuelve estas tres cifras YA en dólares:
                          es la única forma de restar la venta contra un costo
                          que siempre se registra en dólares. */}
                      <td className="num">{dinero(f.venta as number, 'USD', 0)}</td>
                      <td className="num">{dinero(f.costo_estimado as number, 'USD', 0)}</td>
                      <td className="num">{dinero(f.margen as number, 'USD', 0)}</td>
                      <td className="num">
                        <strong style={{ color: Number(f.margen_pct) < margenMinimo ? 'var(--critico)' : 'var(--ok)' }}>
                          {pct(f.margen_pct)}
                        </strong>
                        {Number(f.margen_pct) < margenMinimo && <> <Etiqueta texto="Bajo" tono="critico" /></>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </>
  );
}
