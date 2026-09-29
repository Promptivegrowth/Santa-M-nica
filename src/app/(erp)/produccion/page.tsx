/**
 * ============================================================================
 *  PRODUCCIÓN · lo que falta producir para completar los pedidos
 * ============================================================================
 *  Documento de mejoras, punto 5:
 *
 *    «Mostrar las cantidades que faltan producir para completar los pedidos,
 *     considerando los pedidos existentes y el stock disponible. Los productos
 *     que se encuentren en Backorder por falta de stock deberán reflejarse
 *     también como necesidad de producción.»
 *
 *  La cifra es la MISMA que la tarjeta Backorder de Control de pedidos: sale
 *  del mismo reparto del stock libre por prioridad (migraciones 052 y 058).
 *  Antes había dos cálculos de «lo que falta» y no coincidían; tener dos
 *  números para lo mismo es peor que no tener ninguno.
 *
 *  De lo general a lo concreto: familia → producto → los pedidos que esperan
 *  ese producto. Cada nivel se abre pulsando el anterior (punto 7).
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor } from '@/lib/supabase/servidor';
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { Filtros } from '@/components/ui/Filtros';
import { traerTodo } from '@/lib/traerTodo';
import { hoyEnLima } from '@/lib/fechas';
import { num, fecha } from '@/lib/formato';

export const metadata: Metadata = { title: 'Producción' };
export const dynamic = 'force-dynamic';

type Producto = {
  sku_presentacion_id: number; sku_codigo: string; especie: string; formato: string; corte: string | null;
  presentacion: string; familia: string; pendiente_kg: number; cubierto_kg: number; producir_kg: number;
  pedidos: number; clientes: number; fecha_mas_proxima: string | null; retenido_kg: number;
};
type Linea = {
  linea_id: number; pedido_id: number; numero_proforma: string; cliente_id: number; cliente: string;
  fecha_comprometida: string | null; prioridad: string | null; sku_presentacion_id: number; familia: string;
  pedido_kg: number; despachado_kg: number; reservado_kg: number; con_stock_kg: number; producir_kg: number;
};

const tm = (kg: number) => num(Number(kg) / 1000, 1);

export default async function PaginaProduccion(props: PageProps<'/produccion'>) {
  const q = await props.searchParams;
  const supabase = await crearClienteServidor();
  const hoy = hoyEnLima();

  const familia = (q.familia as string) ?? '';
  const buscar = ((q.buscar as string) ?? '').trim().toLowerCase();
  const skuElegido = Number(q.sku ?? 0) || null;

  const [productos, lineas] = await Promise.all([
    traerTodo<Producto>((d, h) =>
      supabase.from('v_produccion_necesidades').select('*')
        .order('producir_kg', { ascending: false }).order('sku_presentacion_id').range(d, h)),
    traerTodo<Linea>((d, h) =>
      supabase.from('v_produccion_necesidad_linea')
        .select('linea_id, pedido_id, numero_proforma, cliente_id, cliente, fecha_comprometida, prioridad, sku_presentacion_id, familia, pedido_kg, despachado_kg, reservado_kg, con_stock_kg, producir_kg')
        .order('fecha_comprometida', { ascending: true, nullsFirst: false }).order('linea_id').range(d, h)),
  ]);

  /* ---- Las tarjetas: el total, sin filtros ---- */
  const suma = (xs: { producir_kg: number }[]) => xs.reduce((s, x) => s + Number(x.producir_kg), 0);
  const totalKg = suma(productos);
  const pedidosEsperan = new Set(lineas.map((l) => l.pedido_id)).size;
  const clientesEsperan = new Set(lineas.map((l) => l.cliente_id)).size;
  const retenidoKg = productos.reduce((s, p) => s + Number(p.retenido_kg), 0);
  const atrasadas = lineas.filter((l) => l.fecha_comprometida && l.fecha_comprometida < hoy);

  /* ---- Por familia ---- */
  const porFamilia = new Map<string, { kg: number; productos: number; pedidos: Set<number> }>();
  for (const p of productos) {
    const f = porFamilia.get(p.familia) ?? { kg: 0, productos: 0, pedidos: new Set<number>() };
    f.kg += Number(p.producir_kg);
    f.productos += 1;
    porFamilia.set(p.familia, f);
  }
  for (const l of lineas) porFamilia.get(l.familia)?.pedidos.add(l.pedido_id);
  const familias = [...porFamilia.entries()].sort((a, b) => b[1].kg - a[1].kg);

  /* ---- Por producto, con los filtros ---- */
  const filtrados = productos.filter((p) =>
    (!familia || p.familia === familia)
    && (!buscar || `${p.sku_codigo} ${p.corte ?? ''} ${p.formato} ${p.presentacion}`.toLowerCase().includes(buscar)));

  const elegido = skuElegido ? productos.find((p) => p.sku_presentacion_id === skuElegido) : null;
  const lineasElegido = skuElegido ? lineas.filter((l) => l.sku_presentacion_id === skuElegido) : [];

  const enlace = (extra: Record<string, string | number>) => {
    const p = new URLSearchParams();
    if (familia) p.set('familia', familia);
    if (buscar) p.set('buscar', buscar);
    for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
    return `/produccion?${p.toString()}`;
  };

  return (
    <>
      <CabeceraPagina
        titulo="Necesidades de producción"
        descripcion="Lo que falta producir para completar los pedidos confirmados, después de repartir el stock libre por prioridad. Es el backorder de Control de pedidos, visto desde la planta."
      />

      <RejillaKpi>
        <Kpi etiqueta="Por producir" valor={tm(totalKg)} sufijo="TM"
             tono={totalKg > 0 ? 'critico' : 'ok'} nota="el backorder de todos los pedidos"
             href="/produccion#productos" />
        <Kpi etiqueta="Productos" valor={num(productos.length)} tono={productos.length > 0 ? 'atencion' : 'ok'}
             nota={`en ${num(familias.length)} familias`} href="/produccion#familias" />
        <Kpi etiqueta="Pedidos que esperan" valor={num(pedidosEsperan)}
             nota={`${num(clientesEsperan)} clientes`} href="/ventas/control?vista=backorder" />
        <Kpi etiqueta="Ya comprometidos" valor={num(new Set(atrasadas.map((l) => l.pedido_id)).size)}
             tono={atrasadas.length > 0 ? 'critico' : 'ok'}
             nota="pedidos con fecha pasada y aún sin producto" href="/ventas/control?vista=retrasados" />
        <Kpi etiqueta="Retenido por Calidad" valor={tm(retenidoKg)} sufijo="TM"
             nota="de estos productos: podría liberarse antes de producir"
             href="/almacenes/alertas#condicion" />
      </RejillaKpi>

      {/* ============ POR FAMILIA ============ */}
      <div id="familias">
        <Panel titulo="Por familia" className="mb-espacio">
          {familias.length === 0 ? (
            <Vacio titulo="Nada que producir" mensaje="El stock libre cubre todos los pedidos confirmados." />
          ) : (
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos" data-cuadro="familias">
                <thead>
                  <tr>
                    <th>Familia</th>
                    <th className="num">Por producir</th>
                    <th className="num">Productos</th>
                    <th className="num">Pedidos</th>
                    <th className="num">Del total</th>
                  </tr>
                </thead>
                <tbody>
                  {familias.map(([nombre, f]) => (
                    <tr key={nombre} data-familia={nombre}>
                      <td>
                        <Link href={`/produccion?familia=${encodeURIComponent(nombre)}#productos`} className="enlace-ficha">
                          {nombre}
                        </Link>
                      </td>
                      <td className="num"><strong>{tm(f.kg)} TM</strong></td>
                      <td className="num">{num(f.productos)}</td>
                      <td className="num">{num(f.pedidos.size)}</td>
                      <td className="num">{totalKg > 0 ? `${((f.kg / totalKg) * 100).toFixed(1)} %` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {/* ============ POR PRODUCTO ============ */}
      <div id="productos">
        <Panel titulo={`${num(filtrados.length)} productos · ${tm(suma(filtrados))} TM por producir`} className="mb-espacio">
          <Filtros
            campos={[
              { tipo: 'texto', clave: 'buscar', etiqueta: 'Código, corte o formato', ancho: '14rem' },
              {
                tipo: 'select', clave: 'familia', etiqueta: 'Familia',
                opciones: familias.map(([f]) => ({ valor: f, texto: f })),
              },
            ]}
          />
          {filtrados.length === 0 ? (
            <Vacio titulo="Sin productos" mensaje="Ningún producto con estos filtros tiene backorder." />
          ) : (
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos" data-cuadro="productos">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Familia</th>
                    <th className="num">Falta entregar</th>
                    <th className="num">Cubre el stock</th>
                    <th className="num">Por producir</th>
                    <th className="num">Pedidos</th>
                    <th className="num">Primera fecha</th>
                    <th className="num">Retenido</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((p) => {
                    const vencida = p.fecha_mas_proxima && p.fecha_mas_proxima < hoy;
                    return (
                      <tr key={p.sku_presentacion_id} data-sku={p.sku_presentacion_id}
                          aria-current={p.sku_presentacion_id === skuElegido ? 'true' : undefined}>
                        <td>
                          <Link href={enlace({ sku: p.sku_presentacion_id }) + '#detalle'} className="enlace-ficha">
                            <span className="mono">{p.sku_codigo}</span> {p.especie} · {p.formato}
                          </Link>
                          <br />
                          <span style={{ color: 'var(--tinta-3)', fontSize: '.72rem' }}>
                            {[p.corte, p.presentacion].filter(Boolean).join(' · ')}
                          </span>
                        </td>
                        <td>{p.familia}</td>
                        <td className="num">{tm(p.pendiente_kg)}</td>
                        <td className="num">{tm(p.cubierto_kg)}</td>
                        <td className="num"><strong style={{ color: 'var(--critico)' }}>{tm(p.producir_kg)} TM</strong></td>
                        <td className="num">{num(p.pedidos)}</td>
                        <td className="num" style={{ color: vencida ? 'var(--critico)' : undefined, fontWeight: vencida ? 600 : undefined }}>
                          {p.fecha_mas_proxima ? fecha(p.fecha_mas_proxima) : '—'}
                        </td>
                        <td className="num" style={{ color: Number(p.retenido_kg) > 0 ? 'var(--atencion)' : 'var(--tinta-3)' }}>
                          {Number(p.retenido_kg) > 0 ? `${tm(p.retenido_kg)} TM` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="pie-explicativo">
            <strong>Falta entregar</strong>: lo pedido que aún no salió ni está reservado.{' '}
            <strong>Cubre el stock</strong>: la parte que el stock libre alcanza a cubrir, repartido por
            prioridad y fecha comprometida. <strong>Por producir</strong>: el resto, que es el backorder.{' '}
            <strong>Retenido</strong>: stock del mismo producto que Calidad tiene observado o
            inmovilizado; si se libera, reduce lo que hay que producir.
          </p>
        </Panel>
      </div>

      {/* ============ LOS PEDIDOS DE UN PRODUCTO ============ */}
      {elegido && (
        <div id="detalle">
          <Panel
            titulo={`${elegido.sku_codigo} ${elegido.formato} · ${num(lineasElegido.length)} pedidos esperan ${tm(elegido.producir_kg)} TM`}
            className="mb-espacio"
          >
            <div className="atajos-fecha" style={{ marginBottom: '.5rem' }}>
              <Link href={enlace({}) + '#productos'} className="atajo-limpiar">Cerrar</Link>
            </div>
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos" data-cuadro="detalle">
                <thead>
                  <tr>
                    <th>Proforma</th>
                    <th>Cliente</th>
                    <th className="num">Comprometido</th>
                    <th>Prioridad</th>
                    <th className="num">Pedido</th>
                    <th className="num">Salió</th>
                    <th className="num">Reservado</th>
                    <th className="num">Cubre el stock</th>
                    <th className="num">Por producir</th>
                  </tr>
                </thead>
                <tbody>
                  {lineasElegido.map((l) => (
                    <tr key={l.linea_id}>
                      <td className="mono">
                        <Link href={`/ventas/pedidos/${l.pedido_id}`} className="enlace-ficha">{l.numero_proforma}</Link>
                      </td>
                      <td>{l.cliente}</td>
                      <td className="num">
                        {l.fecha_comprometida ? fecha(l.fecha_comprometida) : '—'}
                        {l.fecha_comprometida && l.fecha_comprometida < hoy && <> <Etiqueta texto="Atrasado" tono="critico" /></>}
                      </td>
                      <td>{l.prioridad ?? '—'}</td>
                      <td className="num">{tm(l.pedido_kg)}</td>
                      <td className="num">{tm(l.despachado_kg)}</td>
                      <td className="num">{tm(l.reservado_kg)}</td>
                      <td className="num">{tm(l.con_stock_kg)}</td>
                      <td className="num"><strong>{tm(l.producir_kg)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}
