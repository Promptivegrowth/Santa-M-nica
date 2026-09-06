/**
 * ============================================================================
 *  EXISTENCIAS · el detalle lote por lote
 * ============================================================================
 *  Mientras "Disponibilidad" resume por producto, esta pantalla baja al nivel
 *  del LOTE: qué pallet concreto está en qué cámara, cuánto queda de él, cuánto
 *  está apartado y cuántos meses lleva almacenado.
 *
 *  Es la vista que usa el jefe de almacén cuando tiene que ir físicamente a
 *  buscar el producto.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel, Vacio, Etiqueta, Barra } from '@/components/ui/Pagina';
import { Filtros, Paginacion } from '@/components/ui/Filtros';
import { GraficoBarras } from '@/components/graficos/Graficos';
import { AccionesLista } from '@/components/ui/Acciones';
import { num, fecha, tm, dinero } from '@/lib/formato';
import { veCostos, type Rol } from '@/lib/navegacion';
import { traerTodo } from '@/lib/traerTodo';

export const metadata: Metadata = { title: 'Existencias' };
export const dynamic = 'force-dynamic';

const POR_PAGINA = 50;

export default async function PaginaExistencias(props: PageProps<'/almacenes/existencias'>) {
  const q = await props.searchParams;
  const supabase = await crearClienteServidor();
  const usuario = await obtenerUsuarioActual();
  const puedeVerCostos = veCostos((usuario?.rol ?? 'consulta') as Rol);

  const pagina = Math.max(1, Number(q.pagina ?? 1));
  const buscar = (q.buscar as string) ?? '';
  const almacenId = (q.almacen as string) ?? '';
  const rango = (q.rango as string) ?? '';
  /* Los tres que pidió Oliver: «agregarle filtro de formato y filtro de corte».
     Va también especie, que es lo que encadena a los otros dos. */
  const especie = (q.especie as string) ?? '';
  const formato = (q.formato as string) ?? '';
  const corte = (q.corte as string) ?? '';
  /* Cómo se agrupa el gráfico de arriba. Por formato es lo que se pidió
     —«filete 300 toneladas, aleta 200»— y los otros dos ejes salen gratis. */
  const eje = (q.eje as string) || 'formato';

  const [{ data: almacenes }, { data: catalogo }] = await Promise.all([
    supabase.from('almacenes').select('id, nombre').eq('activo', true).order('nombre'),
    /*
     * Solo lo que TIENE STOCK. Ofrecer los 179 cortes del maestro llenaría el
     * desplegable de opciones que devuelven una pantalla vacía, y ante una
     * pantalla vacía nadie sabe si es que no hay producto o si el filtro está
     * roto. La vista agrupa en la base: leer los 1 519 lotes para sacar los
     * valores distintos chocaría con el tope de mil filas de la API.
     */
    /*
     * Son ~1 043 filas: JUSTO por encima del tope de mil de la API. Con una
     * consulta normal se perderían las últimas cuarenta y pico sin ningún
     * aviso, y con ellas los cortes que solo aparecen ahí. Se pagina.
     */
    traerTodo<{ especie: string; formato: string; corte: string; familia: string;
                almacen_id: number; rango: string; fisico_kg: number; valor: number }>(
      (d, h) => supabase.from('v_stock_catalogo')
        .select('especie, formato, corte, familia, almacen_id, rango, fisico_kg, valor')
        .range(d, h)
    ).then((data) => ({ data })),
  ]);

  /*
   * Los desplegables se encadenan, igual que en Productos: al elegir una
   * especie, «Formato» solo ofrece los suyos, y «Corte» solo los que quedan.
   * Son 178 cortes con stock; sin encadenar, esa lista no se puede usar.
   */
  const cat = catalogo ?? [];
  const unicos = (xs: (string | null)[]) =>
    [...new Set(xs.filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'es'));

  const opcionesEspecie = unicos(cat.map((c) => c.especie as string));
  const opcionesFormato = unicos(
    cat.filter((c) => !especie || c.especie === especie).map((c) => c.formato as string)
  );
  const opcionesCorte = unicos(
    cat.filter((c) => (!especie || c.especie === especie) && (!formato || c.formato === formato))
       .map((c) => c.corte as string)
  );

  // v_anticuamiento ya reúne lote + producto + almacén + antigüedad en una vista
  let consulta = supabase.from('v_anticuamiento').select('*', { count: 'exact' }).gt('fisico_kg', 0);

  if (buscar) {
    consulta = consulta.or(
      `codigo_pallet.ilike.%${buscar}%,sku_codigo.ilike.%${buscar}%,corte.ilike.%${buscar}%`
    );
  }
  if (almacenId) consulta = consulta.eq('almacen_id', Number(almacenId));
  if (rango) consulta = consulta.eq('rango', rango);
  if (especie) consulta = consulta.eq('especie', especie);
  if (formato) consulta = consulta.eq('formato', formato);
  if (corte) consulta = consulta.eq('corte', corte);

  const { data: filas, count } = await consulta
    .order('fisico_kg', { ascending: false })
    .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);

  /*
   * LA DISTRIBUCIÓN DEL STOCK POR GRUPO DE PRODUCTO.
   *
   * Se pidió en la reunión: «en las existencias, igual una visual, pero por
   * grupo de PT: filete trescientas toneladas, aleta doscientas».
   *
   * Se agrupa EN LA BASE, no aquí.
   *
   * Traerse las filas y sumarlas en memoria parecía más simple, pero la API de
   * Supabase devuelve como mucho mil por consulta —y pedir `limit(5000)`
   * devuelve mil igual—. Con 1 519 lotes en cámara, el gráfico se pintaba con
   * dos tercios del inventario y con cifras que parecían razonables.
   */
  const campoEje: 'especie' | 'familia' | 'formato' =
    eje === 'especie' ? 'especie' : eje === 'familia' ? 'familia' : 'formato';

  /*
   * El gráfico responde a LOS MISMOS FILTROS que la tabla.
   *
   * Antes no lo hacía: leía una vista con la distribución global, así que al
   * filtrar por «Cámara 01» la tabla enseñaba esa cámara y el gráfico seguía
   * pintando el inventario entero. Dos cifras distintas en la misma pantalla,
   * y la de arriba —la grande, la que se mira primero— era la que no
   * correspondía a lo que se estaba consultando.
   *
   * Se agrupa sobre el catálogo, que ya viene resumido: mil filas en vez de
   * mil quinientos lotes, y sin traerse ni un kilo de más.
   */
  const acumulado = new Map<string, { kg: number; valor: number }>();
  for (const c of cat) {
    if (especie && c.especie !== especie) continue;
    if (formato && c.formato !== formato) continue;
    if (corte && c.corte !== corte) continue;
    if (almacenId && String(c.almacen_id) !== almacenId) continue;
    if (rango && c.rango !== rango) continue;

    const clave = String(c[campoEje] ?? '') || 'Sin clasificar';
    const a = acumulado.get(clave) ?? { kg: 0, valor: 0 };
    a.kg += Number(c.fisico_kg ?? 0);
    a.valor += Number(c.valor ?? 0);
    acumulado.set(clave, a);
  }

  const porGrupo = [...acumulado.entries()]
    .map(([etiqueta, v]) => ({ etiqueta, kg: v.kg, valor: v.valor }))
    .sort((a, b) => b.kg - a.kg);

  const kgTotal = porGrupo.reduce((t, g) => t + g.kg, 0);

  /* Un gráfico con treinta barras no se lee. Se enseñan los diez mayores y el
     resto se agrupa, que es como se mira una distribución. */
  const CUANTOS = 10;
  const visiblesGrafico = porGrupo.slice(0, CUANTOS);
  const resto = porGrupo.slice(CUANTOS);
  const datosGrafico = [
    ...visiblesGrafico.map((g) => ({ etiqueta: g.etiqueta, valor: g.kg / 1000 })),
    ...(resto.length
      ? [{ etiqueta: `Otros ${resto.length}`, valor: resto.reduce((t, g) => t + g.kg, 0) / 1000 }]
      : []),
  ];

  const EJES = [
    { clave: 'formato', titulo: 'Por formato' },
    { clave: 'familia', titulo: 'Por familia comercial' },
    { clave: 'especie', titulo: 'Por especie' },
  ];

  /** Conserva los filtros al cambiar de eje. */
  function enlaceEje(clave: string) {
    const p = new URLSearchParams();
    if (buscar) p.set('buscar', buscar);
    if (almacenId) p.set('almacen', almacenId);
    if (rango) p.set('rango', rango);
    if (especie) p.set('especie', especie);
    if (formato) p.set('formato', formato);
    if (corte) p.set('corte', corte);
    if (clave !== 'formato') p.set('eje', clave);
    const t = p.toString();
    return `/almacenes/existencias${t ? '?' + t : ''}`;
  }

  return (
    <>
      <CabeceraPagina
        titulo="Existencias por lote"
        descripcion="Cada fila es un lote concreto en una bodega concreta. Es la vista que se usa para ir a buscar el producto físicamente."
      />

      <Panel
        titulo="Cómo se reparte el stock"
        className="mb-espacio"
        acciones={
          <nav className="pestanas-linea no-imprimir">
            {EJES.map((e) => (
              <Link key={e.clave} href={enlaceEje(e.clave)} className="pestana"
                    data-activa={eje === e.clave ? 'si' : 'no'}>
                {e.titulo}
              </Link>
            ))}
          </nav>
        }
      >
        {datosGrafico.length === 0 ? (
          <Vacio titulo="Sin stock" mensaje="No hay existencias que coincidan con estos filtros." />
        ) : (
          <>
            <GraficoBarras datos={datosGrafico} formato="decimal" sufijo=" TM" horizontal altura={260} />

            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos">
                <thead>
                  <tr>
                    <th>{EJES.find((e) => e.clave === eje)?.titulo.replace('Por ', '') ?? 'Grupo'}</th>
                    <th className="num">Toneladas</th>
                    <th className="num">Participación</th>
                    {puedeVerCostos && <th className="num">Valor US$</th>}
                  </tr>
                </thead>
                <tbody>
                  {porGrupo.map((g) => {
                    const pct = kgTotal > 0 ? (g.kg / kgTotal) * 100 : 0;
                    return (
                      <tr key={g.etiqueta}>
                        <td>{g.etiqueta}</td>
                        <td className="num"><strong>{tm(g.kg)}</strong> TM</td>
                        <td className="num" style={{ minWidth: '7rem' }}>
                          <Barra porcentaje={pct} tono="marca" />
                          <span style={{ fontSize: '.68rem', color: 'var(--tinta-3)' }}>
                            {pct.toFixed(1)} %
                          </span>
                        </td>
                        {puedeVerCostos && (
                          <td className="num">{dinero(g.valor, 'USD', 0)}</td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <p className="pie-explicativo">
          El reparto se calcula sobre <strong>todo el stock que cumplen los desplegables</strong>,
          no sobre la página que se está viendo: un gráfico que cambiara al pasar de hoja no
          diría nada. El buscador de arriba{' '}
          <strong>no reordena el gráfico</strong>, solo acota la tabla: busca por pallet y por
          SKU, que no son formas de agrupar el inventario. El gráfico enseña los diez grupos
          mayores y agrupa el resto; la tabla los lista todos.
        </p>
      </Panel>

      <Panel titulo={`${num(count ?? 0)} posiciones con saldo`}>
        <Filtros
          campos={[
            { tipo: 'texto', clave: 'buscar', etiqueta: 'Pallet, SKU o corte', ancho: '13rem' },
            {
              tipo: 'select', clave: 'almacen', etiqueta: 'Almacén',
              opciones: (almacenes ?? []).map((a) => ({ valor: String(a.id), texto: a.nombre as string })),
            },
            {
              tipo: 'select', clave: 'especie', etiqueta: 'Especie',
              opciones: opcionesEspecie.map((e) => ({ valor: e, texto: e })),
            },
            {
              tipo: 'select', clave: 'formato', etiqueta: 'Formato',
              opciones: opcionesFormato.map((f) => ({ valor: f, texto: f })),
            },
            {
              tipo: 'select', clave: 'corte', etiqueta: 'Corte',
              opciones: opcionesCorte.map((c) => ({ valor: c, texto: c })),
            },
            {
              tipo: 'select', clave: 'rango', etiqueta: 'Antigüedad',
              opciones: [
                { valor: '<12', texto: 'Menos de 12 meses' },
                { valor: '12-18', texto: '12 a 18 meses' },
                { valor: '18-24', texto: '18 a 24 meses' },
                { valor: '>24', texto: 'Más de 24 meses' },
              ],
            },
          ]}
        />

        {(filas ?? []).length === 0 ? (
          <Vacio titulo="Sin existencias" mensaje="No hay lotes que coincidan con los filtros aplicados." />
        ) : (
          <>
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos">
                <thead>
                  <tr>
                    <th>Pallet</th>
                    <th>Producto</th>
                    <th>Almacén</th>
                    <th className="num">Físico</th>
                    <th className="num">Disponible</th>
                    <th className="num">Producción</th>
                    <th className="num">Meses</th>
                    {puedeVerCostos && <th className="num">Valor</th>}
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {(filas ?? []).map((f) => (
                    <tr key={`${f.lote_id}-${f.almacen_id}`}>
                      <td className="mono">
                        <Link href={`/almacenes/lotes/${f.lote_id}`} className="enlace-ficha">
                          {f.codigo_pallet as string}
                        </Link>
                      </td>
                      <td>
                        <span className="mono" style={{ color: 'var(--tinta-3)' }}>{f.sku_codigo}</span>{' '}
                        {f.especie} · {f.formato}
                        <br />
                        <span style={{ color: 'var(--tinta-3)', fontSize: '.74rem' }}>{f.corte}</span>
                      </td>
                      <td>{f.almacen}</td>
                      <td className="num">{tm(f.fisico_kg)}</td>
                      <td className="num">
                        <strong style={{ color: Number(f.disponible_kg) > 0 ? 'var(--ok)' : 'var(--tinta-3)' }}>
                          {tm(f.disponible_kg)}
                        </strong>
                      </td>
                      <td className="num">{fecha(f.fecha_produccion as string)}</td>
                      <td className="num">{num(f.meses_almacenado, 1)}</td>
                      {puedeVerCostos && <td className="num">{num(f.valor, 0)}</td>}
                      <td>
                        {f.vencido ? (
                          <Etiqueta texto="Vida útil vencida" tono="critico" />
                        ) : f.en_alerta ? (
                          <Etiqueta texto="Antigüedad alta" tono="atencion" />
                        ) : (
                          <Etiqueta texto="Normal" tono="ok" />
                        )}
                      </td>
                      <td>
                        <AccionesLista
                          ver={`/almacenes/lotes/${f.lote_id}`}
                          verTitulo={`Ver el lote ${f.codigo_pallet}`}
                          extras={[
                            {
                              href: `/trazabilidad?q=${encodeURIComponent(String(f.codigo_pallet))}`,
                              icono: 'trazabilidad',
                              titulo: 'Buscarlo en trazabilidad',
                            },
                          ]}
                        />
                      </td>
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
        Al hacer clic en el código de pallet se abre la <strong>trazabilidad completa</strong> de ese
        lote: de dónde vino, por qué bodegas pasó y a qué clientes se despachó.
      </p>
    </>
  );
}
