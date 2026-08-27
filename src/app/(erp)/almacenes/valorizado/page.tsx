/**
 * ============================================================================
 *  INVENTARIO VALORIZADO · cuánto vale lo que hay
 * ============================================================================
 *  El costo se calcula por PROMEDIO MÓVIL: cada vez que entra producto, el
 *  costo del lote se recalcula ponderando lo que ya había con lo que entra.
 *  Al salir producto, el costo no cambia. El método es configurable.
 *
 *  LO QUE SE VE ES LO QUE SE DESCARGA
 *  Los filtros de esta pantalla viven en la dirección web, y los botones de
 *  Excel y PDF se los pasan tal cual a la API. Si alguien acota a una bodega y
 *  a un rango de producción, el archivo trae eso mismo y además lo deja
 *  impreso en la cabecera. Un botón «Exportar» que bajara siempre todo sería
 *  una trampa: el usuario creería haber descargado lo que veía.
 *
 *  El rango de fechas aquí acota la FECHA DE PRODUCCIÓN, no la de hoy. Es la
 *  pregunta que se hace de verdad en almacén: «cuánto vale lo que produjimos
 *  en marzo y sigue en cámara».
 * ============================================================================
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { Filtros, Paginacion } from '@/components/ui/Filtros';
import { BotonesReporte } from '@/components/ui/BotonesReporte';
import { GraficoBarras } from '@/components/graficos/Graficos';
import { tm, num, dinero, fecha } from '@/lib/formato';
import { veCostos, type Rol } from '@/lib/navegacion';

export const metadata: Metadata = { title: 'Inventario valorizado' };
export const dynamic = 'force-dynamic';

const POR_PAGINA = 50;

/** Los tramos de antigüedad, tal como los calcula la vista v_anticuamiento. */
const RANGOS = [
  { valor: '<12', texto: 'Menos de 12 meses' },
  { valor: '12-18', texto: 'Entre 12 y 18 meses' },
  { valor: '18-24', texto: 'Entre 18 y 24 meses' },
  { valor: '>24', texto: 'Más de 24 meses' },
];

export default async function PaginaValorizado(props: PageProps<'/almacenes/valorizado'>) {
  const usuario = await obtenerUsuarioActual();
  // Esta pantalla muestra costos: los roles sin permiso no deben llegar aquí.
  if (!veCostos((usuario?.rol ?? 'consulta') as Rol)) redirect('/panel');

  const q = await props.searchParams;
  const supabase = await crearClienteServidor();

  const pagina = Math.max(1, Number(q.pagina ?? 1));
  const desde = (q.desde as string) ?? '';
  const hasta = (q.hasta as string) ?? '';
  const almacen = (q.almacen as string) ?? '';
  const rango = (q.rango as string) ?? '';
  const especie = (q.especie as string) ?? '';
  const buscar = ((q.buscar as string) ?? '').trim();
  const hayFiltros = Boolean(desde || hasta || almacen || rango || especie || buscar);

  /*
   * La consulta filtrada se arma una sola vez y se usa dos veces: para las
   * filas de la página y para los totales del universo filtrado. Los KPI de
   * arriba NUNCA se calculan sobre la página visible.
   */
  function base() {
    let c = supabase.from('v_anticuamiento').select('*', { count: 'exact' }).gt('fisico_kg', 0);
    if (desde) c = c.gte('fecha_produccion', desde);
    if (hasta) c = c.lte('fecha_produccion', hasta);
    if (almacen) c = c.eq('almacen_id', Number(almacen));
    if (rango) c = c.eq('rango', rango);
    if (especie) c = c.eq('especie', especie);
    if (buscar) {
      const limpio = buscar.replace(/[%,()]/g, ' ');
      c = c.or(
        ['codigo_pallet', 'sku_codigo', 'corte', 'especie']
          .map((col) => `${col}.ilike.%${limpio}%`).join(',')
      );
    }
    return c;
  }

  const [{ data: filas, count }, { data: universo }, { data: almacenes }, { data: especies }] =
    await Promise.all([
      base().order('valor', { ascending: false })
        .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1),
      base().select('fisico_kg, valor, almacen, rango, lote_id'),
      supabase.from('almacenes').select('id, nombre').eq('activo', true).order('nombre'),
      supabase.from('especies').select('nombre').eq('activo', true).order('nombre'),
    ]);

  const total = universo ?? [];
  const kg = total.reduce((s, r) => s + Number(r.fisico_kg ?? 0), 0);
  const valor = total.reduce((s, r) => s + Number(r.valor ?? 0), 0);
  const costoPorKg = kg > 0 ? valor / kg : 0;
  const lotes = new Set(total.map((r) => r.lote_id)).size;

  // Capital retenido en producto viejo: la cifra que despierta a un gerente.
  const valorViejo = total
    .filter((r) => r.rango === '18-24' || r.rango === '>24')
    .reduce((s, r) => s + Number(r.valor ?? 0), 0);

  /* Valor por almacén, calculado sobre el universo FILTRADO, no sobre todo. */
  const porAlmacen = [...total.reduce((mapa, r) => {
    const a = String(r.almacen);
    const acc = mapa.get(a) ?? { valor: 0, kg: 0 };
    acc.valor += Number(r.valor ?? 0);
    acc.kg += Number(r.fisico_kg ?? 0);
    mapa.set(a, acc);
    return mapa;
  }, new Map<string, { valor: number; kg: number }>())]
    .sort((a, b) => b[1].valor - a[1].valor);

  return (
    <>
      <CabeceraPagina
        titulo="Inventario valorizado"
        descripcion="Cuánto capital hay inmovilizado en cámara, calculado a costo promedio móvil. El Excel y el PDF salen con los filtros que tenga puestos aquí."
      >
        <BotonesReporte tipo="valorizado" />
      </CabeceraPagina>

      <RejillaKpi>
        <Kpi
          etiqueta={hayFiltros ? 'Valor de lo filtrado' : 'Valor total del inventario'}
          valor={dinero(valor, 'USD', 0)}
          tono="marca"
          nota={hayFiltros ? 'Solo lo que cumple los filtros' : 'Todo lo que hay en cámara'}
        />
        <Kpi etiqueta="Toneladas" valor={tm(kg)} sufijo="TM" nota={`${num(lotes)} lotes`} />
        <Kpi etiqueta="Costo promedio" valor={dinero(costoPorKg * 1000, 'USD', 0)} nota="Por tonelada" />
        <Kpi
          etiqueta="Capital en producto de +18 meses"
          valor={dinero(valorViejo, 'USD', 0)}
          tono={valorViejo > 0 ? 'critico' : 'ok'}
          nota={valor > 0 ? `${num((valorViejo / valor) * 100, 1)} % del total` : 'Sin producto viejo'}
          href="/almacenes/valorizado?rango=%3E24"
        />
      </RejillaKpi>

      {porAlmacen.length > 0 && (
        <Panel titulo="Valor por almacén" className="mb-espacio">
          <GraficoBarras
            datos={porAlmacen.map(([nombre, d]) => ({
              etiqueta: nombre,
              valor: d.valor,
              nota: `${num(d.kg / 1000, 1)} TM`,
            }))}
            formato="dolares"
            horizontal
            altura={Math.max(160, porAlmacen.length * 34)}
          />
        </Panel>
      )}

      <Panel titulo={`Detalle por lote · ${num(count ?? 0)} posiciones`}>
        <Filtros
          campos={[
            { tipo: 'fecha', clave: 'desde', etiqueta: 'Producido desde' },
            { tipo: 'fecha', clave: 'hasta', etiqueta: 'Producido hasta' },
            {
              tipo: 'select', clave: 'almacen', etiqueta: 'Almacén',
              opciones: (almacenes ?? []).map((a) => ({
                valor: String(a.id), texto: a.nombre as string,
              })),
            },
            {
              tipo: 'select', clave: 'rango', etiqueta: 'Antigüedad',
              opciones: RANGOS,
            },
            {
              tipo: 'select', clave: 'especie', etiqueta: 'Especie',
              opciones: (especies ?? []).map((e) => ({
                valor: e.nombre as string, texto: e.nombre as string,
              })),
            },
            { tipo: 'texto', clave: 'buscar', etiqueta: 'Pallet, SKU o corte', ancho: '16rem' },
          ]}
        />

        {(filas ?? []).length === 0 ? (
          <Vacio
            titulo="Sin resultados"
            mensaje="No hay stock valorizado con estos filtros. Pruebe a ampliar el rango de producción o a quitar la bodega."
          />
        ) : (
          <>
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos">
                <thead>
                  <tr>
                    <th>Pallet</th>
                    <th>SKU</th>
                    <th>Producto</th>
                    <th>Almacén</th>
                    <th className="num">Producido</th>
                    <th className="num">Meses</th>
                    <th>Antigüedad</th>
                    <th className="num">Físico</th>
                    <th className="num">Costo / kg</th>
                    <th className="num">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {(filas ?? []).map((r) => (
                    <tr key={`${r.lote_id}-${r.almacen_id}`}>
                      <td className="mono">
                        <Link href={`/almacenes/lotes/${r.lote_id}`} className="enlace-ficha">
                          {r.codigo_pallet as string}
                        </Link>
                      </td>
                      <td className="mono">{r.sku_codigo as string}</td>
                      <td style={{ fontSize: '.78rem' }}>
                        {r.especie as string} · {r.formato as string}
                        <br />
                        <span style={{ color: 'var(--tinta-3)', fontSize: '.72rem' }}>
                          {r.corte as string}
                        </span>
                      </td>
                      <td style={{ fontSize: '.78rem' }}>{r.almacen as string}</td>
                      <td className="num mono" style={{ fontSize: '.74rem' }}>
                        {fecha(r.fecha_produccion as string)}
                      </td>
                      <td className="num">{num(r.meses_almacenado, 1)}</td>
                      <td>
                        <Etiqueta
                          texto={r.rango as string}
                          tono={
                            r.rango === '>24' ? 'critico'
                            : r.rango === '18-24' ? 'atencion'
                            : r.rango === '12-18' ? 'info'
                            : 'ok'
                          }
                        />
                      </td>
                      <td className="num">{num(r.fisico_kg)} kg</td>
                      <td className="num">{dinero(r.costo_promedio, 'USD', 2)}</td>
                      <td className="num"><strong>{dinero(r.valor, 'USD', 0)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Paginacion pagina={pagina} porPagina={POR_PAGINA} total={count ?? 0} />
          </>
        )}
      </Panel>

      <p className="pie-explicativo">
        El <strong>costo promedio móvil</strong> se recalcula en cada ingreso, ponderando lo que ya
        había con lo que entra; las salidas no lo alteran. El método es un parámetro que se cambia
        en <Link href="/configuracion?t=parametros">Configuración → Parámetros</Link>. Para ver el
        movimiento que produjo cada costo, entre al lote y mire su Kardex.
      </p>
    </>
  );
}
