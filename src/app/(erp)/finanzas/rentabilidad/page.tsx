/**
 * ============================================================================
 *  RENTABILIDAD · por pedido, cliente, producto y vendedor
 * ============================================================================
 *  La especificación pedía las cuatro vistas. El costo lo aporta Almacenes:
 *  es el costo promedio móvil de los lotes que efectivamente se despacharon.
 *
 *  El margen mínimo aceptable es un parámetro configurable; por debajo de él,
 *  el pedido se marca como "margen bajo".
 *
 *  MARGEN BRUTO (documento de mejoras 2.2 · migración 057)
 *  «Margen bruto = Venta − Costo.» Es la pestaña principal. Se mide sobre lo
 *  que de verdad salió: los kilos despachados por el precio de su línea de
 *  pedido, menos esos mismos kilos por el costo con el que ingresó el pallet
 *  del que salieron. Por mes de salida, en hora de Lima.
 *
 *  LO QUE NO TIENE COSTO NO TIENE MARGEN (migración 071)
 *  Una línea sin costo cargado entraba con costo cero: un 100 % de margen que
 *  subía el del mes, el del pedido y el de la familia. Ahora el margen y su
 *  porcentaje se miden SOLO con las líneas que tienen costo, y lo que quedó
 *  fuera se enseña aparte —toneladas e importe— con un aviso. En todas las
 *  pestañas: en Margen bruto el costo es el del pallet; en Por pedido,
 *  cliente, vendedor y Margen bajo, el costo estimado de la línea de pedido.
 * ============================================================================
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { Icono } from '@/components/estructura/Icono';
import { GraficoBarras } from '@/components/graficos/Graficos';
import { Filtros, Paginacion } from '@/components/ui/Filtros';
import { traerTodo } from '@/lib/traerTodo';
import { num, dinero, pct, fecha } from '@/lib/formato';
import { veCostos, type Rol } from '@/lib/navegacion';

export const metadata: Metadata = { title: 'Rentabilidad' };
export const dynamic = 'force-dynamic';

const POR_PAGINA = 50;

const EJES = [
  { clave: 'bruto',       titulo: 'Margen bruto' },
  { clave: 'pedido',      titulo: 'Por pedido' },
  { clave: 'cliente',     titulo: 'Por cliente' },
  { clave: 'vendedor',    titulo: 'Por vendedor' },
  { clave: 'contribucion', titulo: 'Margen de contribución' },
  { clave: 'bajo',        titulo: 'Margen bajo' },
];

export default async function PaginaRentabilidad(props: PageProps<'/finanzas/rentabilidad'>) {
  const q = await props.searchParams;
  const eje = (q.eje as string) ?? 'bruto';

  const usuario = await obtenerUsuarioActual();
  if (!veCostos((usuario?.rol ?? 'consulta') as Rol)) redirect('/panel');

  const supabase = await crearClienteServidor();
  const [filas, { data: minimo }, { data: porFamilia }] = await Promise.all([
    /* Paginado: `.limit(1000)` no traía más de mil aunque hubiera más, y la
       API corta en mil sin avisar. */
    traerTodo<Record<string, unknown>>((d, h) =>
      supabase.from('v_rentabilidad_pedido').select('*').in('ciclo', ['despachado', 'cerrado'])
        .order('pedido_id').range(d, h)),
    supabase.from('parametros').select('valor').eq('clave', 'margen_minimo_alerta').single(),
    /*
     * El margen de CONTRIBUCIÓN, que es distinto del que ya había.
     *
     * El de arriba compara la venta contra el costo estimado del pedido. Este
     * la compara contra el costo de PRODUCCIÓN del período —materia prima,
     * conversión y variable— que es lo que pidió Oliver: «no la utilidad, sino
     * el margen de contribución».
     */
    supabase.from('v_margen_contribucion_familia').select('*').order('venta', { ascending: false }),
  ]);

  //  Del más reciente al más antiguo, como estaba (la vista no tiene orden propio).
  const lista = [...filas].sort((a, b) =>
    String(b.fecha_solicitada ?? '').localeCompare(String(a.fecha_solicitada ?? '')) || Number(b.pedido_id) - Number(a.pedido_id));
  const margenMinimo = Number(minimo?.valor ?? 8);
  const n0 = (v: unknown) => Number(v ?? 0);

  /*
   * El margen, SOLO con lo que tiene costo. `venta` sigue siendo todo lo
   * despachado; `ventaConCosto` es la base del porcentaje.
   */
  const venta = lista.reduce((s, f) => s + n0(f.venta), 0);
  const costo = lista.reduce((s, f) => s + n0(f.costo_estimado), 0);
  const ventaConCosto = lista.reduce((s, f) => s + n0(f.venta_con_costo), 0);
  const margen = lista.reduce((s, f) => s + n0(f.margen_con_costo), 0);
  const margenPct = ventaConCosto > 0 ? (margen / ventaConCosto) * 100 : null;
  const sinCosto = {
    pedidos: lista.filter((f) => n0(f.lineas_sin_costo) > 0).length,
    tm: lista.reduce((s, f) => s + n0(f.tm_sin_costo), 0),
    venta: lista.reduce((s, f) => s + n0(f.venta_sin_costo), 0),
  };
  //  Un pedido sin ningún costo no tiene margen: no es «bajo», es desconocido.
  const bajoMargen = lista.filter((f) => f.margen_con_costo_pct !== null && n0(f.margen_con_costo_pct) < margenMinimo);

  /** Agrupa por la dimensión elegida. */
  function agrupar(campo: 'cliente' | 'vendedor') {
    const m = new Map<string, { venta: number; ventaConCosto: number; margen: number; ventaSinCosto: number }>();
    for (const f of lista) {
      const k = (f[campo] as string) ?? 'Sin asignar';
      const a = m.get(k) ?? { venta: 0, ventaConCosto: 0, margen: 0, ventaSinCosto: 0 };
      a.venta += n0(f.venta);
      a.ventaConCosto += n0(f.venta_con_costo);
      a.margen += n0(f.margen_con_costo);
      a.ventaSinCosto += n0(f.venta_sin_costo);
      m.set(k, a);
    }
    return [...m.entries()]
      .map(([nombre, v]) => ({ nombre, ...v, pct: v.ventaConCosto > 0 ? (v.margen / v.ventaConCosto) * 100 : null }))
      .sort((a, b) => b.venta - a.venta);
  }

  const agrupado = eje === 'cliente' ? agrupar('cliente') : eje === 'vendedor' ? agrupar('vendedor') : [];

  /* ---- Los totales del margen de contribución ---- */
  const familias = (porFamilia ?? []).filter((f) => Number(f.venta ?? 0) > 0);
  const contrib = {
    venta: familias.reduce((s, f) => s + Number(f.venta ?? 0), 0),
    mp: familias.reduce((s, f) => s + Number(f.materia_prima ?? 0), 0),
    conv: familias.reduce((s, f) => s + Number(f.conversion ?? 0), 0),
    varia: familias.reduce((s, f) => s + Number(f.variable ?? 0), 0),
    margen: familias.reduce((s, f) => s + Number(f.margen ?? 0), 0),
    sinCosto: (porFamilia ?? []).reduce((s, f) => s + Number(f.lineas_sin_costo ?? 0), 0),
  };
  const contribPct = contrib.venta > 0 ? (contrib.margen / contrib.venta) * 100 : 0;
  const enPerdida = familias.filter((f) => Number(f.margen_pct ?? 0) < 0);

  /* ---- El margen bruto: por mes de salida ---- */
  type LineaBruto = {
    pedido_id: number; numero_proforma: string; cliente: string; familia: string;
    kg: number; venta: number; costo: number; margen: number; sin_costo: boolean;
  };
  const { data: mesesBruto } = eje === 'bruto'
    ? await supabase.from('v_margen_bruto_mensual').select('*').order('mes', { ascending: false })
    : { data: [] as Record<string, unknown>[] };
  /*
   * EL DESPLEGABLE «MES».
   * Antes su primera opción decía «Todos», pero al elegirla la pantalla
   * enseñaba el mes más reciente, no la suma de todos. Ahora cada opción dice
   * lo que hace: la primera es «El más reciente (mes)», que es lo que se ve al
   * entrar, y «Todos los meses» suma de verdad todo lo despachado.
   */
  const TODOS = 'todos';
  const todosLosMeses = q.mes === TODOS;
  const claveBruto = todosLosMeses ? '' : (q.mes as string) || String(mesesBruto?.[0]?.clave ?? '');
  const mesDeVista = (mesesBruto ?? []).find((m) => m.clave === claveBruto);
  const lineasBruto = eje === 'bruto' && (claveBruto || todosLosMeses)
    ? await traerTodo<LineaBruto>((d, h) => {
        let c = supabase.from('v_margen_bruto_linea')
          .select('pedido_id, numero_proforma, cliente, familia, kg, venta, costo, margen, sin_costo');
        if (!todosLosMeses) c = c.eq('mes', `${claveBruto}-01`);
        return c.order('packing_linea_id').range(d, h);
      })
    : [];

  /** Suma las líneas del período por una clave: pedido o familia. */
  function sumarBruto(clave: (l: LineaBruto) => string) {
    const m = new Map<string, {
      nombre: string; ref: LineaBruto; kg: number; venta: number; costo: number; margen: number;
      sinCosto: number; kgSinCosto: number; ventaSinCosto: number; ventaConCosto: number;
    }>();
    for (const l of lineasBruto) {
      const k = clave(l);
      const a = m.get(k) ?? { nombre: k, ref: l, kg: 0, venta: 0, costo: 0, margen: 0, sinCosto: 0, kgSinCosto: 0, ventaSinCosto: 0, ventaConCosto: 0 };
      a.kg += Number(l.kg); a.venta += Number(l.venta); a.costo += Number(l.costo);
      //  La línea sin costo no aporta margen ni cuenta en la base del %.
      if (l.sin_costo) { a.sinCosto += 1; a.kgSinCosto += Number(l.kg); a.ventaSinCosto += Number(l.venta); }
      else { a.margen += Number(l.margen ?? 0); a.ventaConCosto += Number(l.venta); }
      m.set(k, a);
    }
    return [...m.values()]
      .map((a) => ({ ...a, pct: a.ventaConCosto > 0 ? (a.margen / a.ventaConCosto) * 100 : null }))
      .sort((a, b) => b.venta - a.venta);
  }
  const brutoPedidos = sumarBruto((l) => String(l.pedido_id));
  const brutoFamilias = sumarBruto((l) => l.familia);

  /* El resumen del período: el del mes sale de la vista; el de todos los
     meses, de sumar las líneas (los pedidos se cuentan una vez aunque salgan
     en dos meses). */
  const mesBruto = todosLosMeses
    ? (lineasBruto.length === 0 ? undefined : (() => {
        const t = sumarBruto(() => 'todo')[0];
        return {
          venta: t.venta, costo: t.costo, margen: t.margen, kg: t.kg,
          margen_pct: t.pct, pedidos: brutoPedidos.length, lineas_sin_costo: t.sinCosto,
          kg_sin_costo: t.kgSinCosto, venta_sin_costo: t.ventaSinCosto, venta_con_costo: t.ventaConCosto,
        } as Record<string, unknown>;
      })())
    : mesDeVista;
  const nombreMesBruto = (clave: string) => {
    const t = new Date(`${clave}-01T12:00:00`).toLocaleDateString('es-PE', { month: 'long', year: 'numeric' });
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  const periodoBruto = todosLosMeses ? 'todos los meses' : claveBruto ? nombreMesBruto(claveBruto).toLowerCase() : '';
  const brutoSinCosto = {
    lineas: Number(mesBruto?.lineas_sin_costo ?? 0),
    kg: Number(mesBruto?.kg_sin_costo ?? 0),
    venta: Number(mesBruto?.venta_sin_costo ?? 0),
    ventaConCosto: Number(mesBruto?.venta_con_costo ?? 0),
  };
  /** El % de margen, o una raya si no hay ninguna venta con costo. */
  const textoPct = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)} %`);

  /** Celdas de margen y % de un pedido o familia del margen bruto. */
  type Suma = { margen: number; pct: number | null; ventaConCosto: number; kgSinCosto: number };
  const celdaMargen = (a: Suma) => (a.ventaConCosto > 0
    ? <strong style={{ color: a.margen < 0 ? 'var(--critico)' : undefined }}>{dinero(a.margen, 'USD', 0)}</strong>
    : <Etiqueta texto="Sin costo" tono="atencion" />);
  const celdaPct = (a: Suma) => (
    <>
      <strong style={{ color: tonoPct(a.pct) }}>{textoPct(a.pct)}</strong>
      {a.kgSinCosto > 0 && a.ventaConCosto > 0 && (
        <><br /><span style={{ color: 'var(--atencion)', fontSize: '.68rem' }}>
          {num(a.kgSinCosto / 1000, 1)} TM sin costo, fuera</span></>
      )}
    </>
  );
  const tonoPct = (v: number | null) =>
    v === null ? 'var(--tinta-3)' : v < 0 ? 'var(--critico)' : v < margenMinimo ? 'var(--atencion)' : 'var(--ok)';
  /* La página de la tabla de pedidos (Por pedido y Margen bajo). */
  const filasPedidos = eje === 'bajo' ? bajoMargen : lista;
  const pagina = Math.min(Math.max(1, Math.ceil(filasPedidos.length / POR_PAGINA)),
    Math.max(1, Math.floor(Number(q.pagina ?? 1)) || 1));
  const pedidosPagina = filasPedidos.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);

  return (
    <>
      <CabeceraPagina
        titulo="Rentabilidad"
        descripcion={`Venta contra costo de los pedidos ya despachados. El margen mínimo aceptable está configurado en ${margenMinimo} %.`}
      />

      {eje !== 'bruto' && (
      <RejillaKpi>
        <Kpi etiqueta="Venta despachada" valor={dinero(venta, 'USD', 0)} tono="marca" href="/finanzas/rentabilidad?eje=pedido" />
        <Kpi etiqueta="Costo" valor={dinero(costo, 'USD', 0)} href="/finanzas/rentabilidad?eje=pedido" />
        <Kpi etiqueta="Margen" valor={dinero(margen, 'USD', 0)} tono="ok"
             nota={sinCosto.venta > 0 ? 'solo de las líneas con costo' : undefined}
             href="/finanzas/rentabilidad?eje=pedido" />
        <Kpi etiqueta="Margen %" valor={margenPct === null ? '—' : pct(margenPct)}
             tono={margenPct === null ? 'neutro' : margenPct < margenMinimo ? 'critico' : 'ok'}
             nota={sinCosto.venta > 0 ? `sobre ${dinero(ventaConCosto, 'USD', 0)} con costo` : undefined}
             href="/finanzas/rentabilidad?eje=pedido" />
        <Kpi etiqueta="Pedidos con margen bajo" valor={num(bajoMargen.length)}
             tono={bajoMargen.length > 0 ? 'atencion' : 'ok'} href="/finanzas/rentabilidad?eje=bajo" />
        <Kpi etiqueta="Venta sin costo" valor={dinero(sinCosto.venta, 'USD', 0)}
             tono={sinCosto.venta > 0 ? 'atencion' : 'neutro'}
             nota={sinCosto.venta > 0 ? `${num(sinCosto.tm, 1)} TM en ${num(sinCosto.pedidos)} pedidos · fuera del margen` : 'todas las líneas tienen costo'}
             href="/finanzas/rentabilidad?eje=pedido" />
      </RejillaKpi>
      )}

      {eje !== 'bruto' && eje !== 'contribucion' && sinCosto.venta > 0 && (
        <div className="ficha-aviso ficha-aviso-atencion" role="status" data-aviso="sin-costo">
          <Icono nombre="alerta" tamano={17} />
          <span>
            <strong>{num(sinCosto.tm, 1)} TM ({dinero(sinCosto.venta, 'USD', 0)} de venta) no tienen costo estimado</strong>{' '}
            en su línea de pedido. Quedan fuera del margen y de su porcentaje: contarlas con costo
            cero les daría un 100 % de margen que no existe. El margen se mide sobre{' '}
            {dinero(ventaConCosto, 'USD', 0)} de venta con costo.
          </span>
        </div>
      )}

      <nav className="pestanas no-imprimir" aria-label="Ejes de análisis">
        {EJES.map((e) => (
          <Link key={e.clave} href={`/finanzas/rentabilidad?eje=${e.clave}`} className="pestana"
                data-activa={eje === e.clave ? 'si' : 'no'}>{e.titulo}</Link>
        ))}
      </nav>

      {/* ══════ MARGEN BRUTO ══════ */}
      {eje === 'bruto' && (
        <>
          <div className="ficha-aviso ficha-aviso-info" role="status">
            <Icono nombre="alerta" tamano={17} />
            <span>
              <strong>Margen bruto = venta − costo</strong>, sobre lo que salió en el mes: los kilos
              despachados por el precio de su pedido, menos esos kilos por el costo con el que
              ingresó cada pallet. El costo lo fija Gerencia en{' '}
              <Link href="/finanzas/costos">Costos de producción</Link> y cada pallet conserva el
              que regía el día en que entró. Un pallet sin costo cargado no tiene margen: se deja
              fuera del margen y de su porcentaje, y se avisa aparte.
            </span>
          </div>

          <Panel titulo="Mes de salida" className="mb-espacio">
            <Filtros
              campos={[{
                tipo: 'select', clave: 'mes', etiqueta: 'Mes',
                textoTodos: mesesBruto?.[0]
                  ? `El más reciente (${nombreMesBruto(String(mesesBruto[0].clave)).toLowerCase()})`
                  : 'El más reciente',
                opciones: [
                  { valor: TODOS, texto: 'Todos los meses' },
                  ...(mesesBruto ?? []).map((m) => ({ valor: String(m.clave), texto: nombreMesBruto(String(m.clave)) })),
                ],
              }]}
            />
          </Panel>

          {!mesBruto ? (
            <Vacio titulo="Sin despachos" mensaje="No hay despachos en ese mes, así que no hay margen que medir." />
          ) : (
            <>
              {brutoSinCosto.lineas > 0 && (
                <div className="ficha-aviso ficha-aviso-atencion" role="status" data-aviso="sin-costo">
                  <Icono nombre="alerta" tamano={17} />
                  <span>
                    <strong>
                      {num(brutoSinCosto.lineas)} línea{brutoSinCosto.lineas === 1 ? '' : 's'} despachada{brutoSinCosto.lineas === 1 ? '' : 's'} sin
                      costo cargado: {num(brutoSinCosto.kg / 1000, 1)} TM y {dinero(brutoSinCosto.venta, 'USD', 0)} de venta
                    </strong>{' '}
                    en {periodoBruto}. Quedan fuera del margen bruto y de su porcentaje (contarlas con
                    costo cero les daría un 100 % de margen que no existe). El margen se mide sobre{' '}
                    {dinero(brutoSinCosto.ventaConCosto, 'USD', 0)} de venta con costo.{' '}
                    <Link href="/finanzas/costos">Cargar los costos que faltan</Link>.
                  </span>
                </div>
              )}

              <RejillaKpi>
                <Kpi etiqueta="Venta" valor={dinero(Number(mesBruto.venta), 'USD', 0)} tono="marca"
                     nota={`${num(Number(mesBruto.kg) / 1000, 1)} TM despachadas`} href="#bruto-pedidos" />
                <Kpi etiqueta="Costo" valor={dinero(Number(mesBruto.costo), 'USD', 0)}
                     nota="costo de ingreso de los pallets" href="#bruto-familias" />
                <Kpi etiqueta="Margen bruto" valor={dinero(Number(mesBruto.margen ?? 0), 'USD', 0)}
                     tono={Number(mesBruto.margen ?? 0) >= 0 ? 'ok' : 'critico'}
                     nota={brutoSinCosto.lineas > 0 ? 'solo de las líneas con costo' : undefined}
                     href="#bruto-pedidos" />
                <Kpi etiqueta="Margen bruto %"
                     valor={mesBruto.margen_pct === null || mesBruto.margen_pct === undefined ? '—' : pct(Number(mesBruto.margen_pct))}
                     tono={mesBruto.margen_pct === null || mesBruto.margen_pct === undefined ? 'neutro'
                       : Number(mesBruto.margen_pct) < 0 ? 'critico' : Number(mesBruto.margen_pct) < margenMinimo ? 'atencion' : 'ok'}
                     nota={brutoSinCosto.lineas > 0
                       ? `sobre ${dinero(brutoSinCosto.ventaConCosto, 'USD', 0)} con costo · mínimo ${margenMinimo} %`
                       : `el mínimo aceptable es ${margenMinimo} %`}
                     href="#bruto-evolucion" />
                <Kpi etiqueta="Pedidos" valor={num(Number(mesBruto.pedidos))}
                     nota={brutoSinCosto.lineas > 0
                       ? `${num(brutoSinCosto.lineas)} líneas sin costo · ${num(brutoSinCosto.kg / 1000, 1)} TM`
                       : todosLosMeses ? 'con salida en algún mes' : 'con salida en el mes'}
                     tono={brutoSinCosto.lineas > 0 ? 'atencion' : 'neutro'} href="#bruto-pedidos" />
              </RejillaKpi>

              <div id="bruto-pedidos">
                <Panel titulo={`${num(brutoPedidos.length)} pedidos con salida en ${periodoBruto}`} className="mb-espacio">
                  <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
                    <table className="datos" data-cuadro="bruto-pedidos">
                      <thead>
                        <tr>
                          <th>Proforma</th><th>Cliente</th><th className="num">TM</th>
                          <th className="num">Venta</th><th className="num">Costo</th>
                          <th className="num">Margen bruto</th><th className="num">%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {brutoPedidos.map((a) => (
                          <tr key={a.nombre}>
                            <td>
                              <Link href={`/ventas/pedidos/${a.ref.pedido_id}?t=rentabilidad`} className="enlace-dato">
                                {a.ref.numero_proforma}
                              </Link>
                            </td>
                            <td>{a.ref.cliente}</td>
                            <td className="num">{num(a.kg / 1000, 1)}</td>
                            <td className="num">{dinero(a.venta, 'USD', 0)}</td>
                            <td className="num">{dinero(a.costo, 'USD', 0)}</td>
                            <td className="num">{celdaMargen(a)}</td>
                            <td className="num">{celdaPct(a)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              </div>

              <div id="bruto-familias">
                <Panel titulo="Por familia" className="mb-espacio">
                  <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
                    <table className="datos" data-cuadro="bruto-familias">
                      <thead>
                        <tr>
                          <th>Familia</th><th className="num">TM</th><th className="num">Venta</th>
                          <th className="num">Costo</th><th className="num">Margen bruto</th><th className="num">%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {brutoFamilias.map((a) => (
                          <tr key={a.nombre}>
                            <td>{a.nombre}</td>
                            <td className="num">{num(a.kg / 1000, 1)}</td>
                            <td className="num">{dinero(a.venta, 'USD', 0)}</td>
                            <td className="num">{dinero(a.costo, 'USD', 0)}</td>
                            <td className="num">{celdaMargen(a)}</td>
                            <td className="num">{celdaPct(a)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              </div>
            </>
          )}

          <div id="bruto-evolucion">
            <Panel titulo="Margen bruto por mes" className="mb-espacio">
              <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
                <table className="datos" data-cuadro="bruto-meses">
                  <thead>
                    <tr>
                      <th>Mes</th><th className="num">Pedidos</th><th className="num">TM</th>
                      <th className="num">Venta</th><th className="num">Costo</th>
                      <th className="num">Margen bruto</th><th className="num">%</th>
                      <th className="num">Sin costo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(mesesBruto ?? []).slice(0, 12).map((m) => (
                      <tr key={String(m.clave)} data-mes={String(m.clave)}>
                        <td>
                          <Link href={`/finanzas/rentabilidad?eje=bruto&mes=${m.clave}`} className="enlace-ficha">
                            {nombreMesBruto(String(m.clave))}
                          </Link>
                        </td>
                        <td className="num">{num(Number(m.pedidos))}</td>
                        <td className="num">{num(Number(m.kg) / 1000, 1)}</td>
                        <td className="num">{dinero(Number(m.venta), 'USD', 0)}</td>
                        <td className="num">{dinero(Number(m.costo), 'USD', 0)}</td>
                        <td className="num">{dinero(Number(m.margen ?? 0), 'USD', 0)}</td>
                        <td className="num">
                          <strong style={{ color: tonoPct(m.margen_pct === null ? null : Number(m.margen_pct)) }}>
                            {m.margen_pct === null ? '—' : pct(Number(m.margen_pct))}
                          </strong>
                        </td>
                        <td className="num" style={{ color: Number(m.kg_sin_costo) > 0 ? 'var(--atencion)' : 'var(--tinta-3)' }}>
                          {Number(m.kg_sin_costo) > 0
                            ? `${num(Number(m.kg_sin_costo) / 1000, 1)} TM · ${dinero(Number(m.venta_sin_costo), 'USD', 0)}`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        </>
      )}

      {/* ══════ MARGEN DE CONTRIBUCIÓN ══════ */}
      {eje === 'contribucion' && (
        <>
          <div className="ficha-aviso ficha-aviso-info" role="status">
            <Icono nombre="alerta" tamano={17} />
            <span>
              <strong>Esto no es la utilidad.</strong> El margen de contribución compara el precio
              de venta contra el <strong>costo de producción</strong> —materia prima, conversión y
              variable— sin repartir los gastos fijos de la empresa. Dice cuánto aporta cada
              producto a cubrirlos.
              {contrib.sinCosto > 0 && (
                <>
                  {' '}Hay <strong>{num(contrib.sinCosto)} líneas sin costo cargado</strong> que
                  quedan fuera de estas cifras: no se les puede calcular margen, y meterlas con
                  cero lo inflaría.{' '}
                  <Link href="/finanzas/costos">Cargar los costos que faltan</Link>.
                </>
              )}
            </span>
          </div>

          <RejillaKpi>
            <Kpi etiqueta="Venta medible" valor={dinero(contrib.venta, 'USD', 0)} tono="marca"
                 nota="solo lo que tiene costo cargado"
  href="#familias-contribucion" />
            <Kpi etiqueta="Costo de producción"
                 valor={dinero(contrib.mp + contrib.conv + contrib.varia, 'USD', 0)}
                 nota="los tres componentes"
  href="#composicion" />
            <Kpi etiqueta="Margen de contribución" valor={dinero(contrib.margen, 'USD', 0)}
                 tono={contrib.margen > 0 ? 'ok' : 'critico'}
  href="#familias-contribucion" />
            <Kpi etiqueta="Sobre la venta" valor={`${contribPct.toFixed(1)} %`}
                 tono={contribPct >= margenMinimo ? 'ok' : 'atencion'}
                 nota={`el mínimo aceptable es ${margenMinimo} %`}
  href="#familias-contribucion" />
            <Kpi etiqueta="Familias en pérdida" valor={num(enPerdida.length)}
                 tono={enPerdida.length > 0 ? 'critico' : 'ok'}
                 nota="se venden por debajo de su costo"
  href="#familias-contribucion" />
          </RejillaKpi>

          {/* De qué se compone el costo: es la pregunta que hay detrás de
              pedir los tres números por separado. */}
          <Panel id="composicion" titulo="De qué se compone el costo" className="mb-espacio">
            <div className="composicion">
              {[
                { nombre: 'Materia prima', valor: contrib.mp, tono: 'marca' as const },
                { nombre: 'Conversión (mano de obra)', valor: contrib.conv, tono: 'atencion' as const },
                { nombre: 'Variable', valor: contrib.varia, tono: 'critico' as const },
                { nombre: 'Margen de contribución', valor: contrib.margen, tono: 'ok' as const },
              ].map((parte) => {
                const pct = contrib.venta > 0 ? (parte.valor / contrib.venta) * 100 : 0;
                return (
                  <div key={parte.nombre} className="composicion-fila">
                    <span className="composicion-nombre">{parte.nombre}</span>
                    <span className="composicion-barra">
                      <i data-tono={parte.tono} style={{ width: `${Math.max(0, pct)}%` }} />
                    </span>
                    <span className="composicion-cifra">{dinero(parte.valor, 'USD', 0)}</span>
                    <span className="composicion-pct">{pct.toFixed(1)} %</span>
                  </div>
                );
              })}
            </div>
            <p className="pie-explicativo">
              Las cuatro partes suman el 100 % de la venta: lo que se paga por el pescado, lo que
              cuesta procesarlo, el resto de costos variables, y lo que queda para cubrir los
              gastos fijos y ganar.
            </p>
          </Panel>

          <Panel id="familias-contribucion" titulo={`${familias.length} familias de producto`}>
            {familias.length === 0 ? (
              <Vacio
                titulo="Sin costos cargados"
                mensaje="Todavía no hay costos de producción cargados, así que no se puede calcular ningún margen de contribución."
              />
            ) : (
              <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
                <table className="datos">
                  <thead>
                    <tr>
                      <th>Familia</th>
                      <th className="num">TM</th>
                      <th className="num">Venta</th>
                      <th className="num">Materia prima</th>
                      <th className="num">Conversión</th>
                      <th className="num">Variable</th>
                      <th className="num">Margen</th>
                      <th className="num">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {familias.map((f) => {
                      const pct = Number(f.margen_pct ?? 0);
                      return (
                        <tr key={f.familia as string}>
                          <td style={{ fontSize: '.8rem' }}>
                            {String(f.familia)}
                            {Number(f.lineas_sin_costo) > 0 && (
                              <>
                                <br />
                                <span style={{ color: 'var(--atencion)', fontSize: '.68rem' }}>
                                  {num(Number(f.lineas_sin_costo))} líneas sin costo, fuera del cálculo
                                </span>
                              </>
                            )}
                          </td>
                          <td className="num">{num(f.tm as number, 1)}</td>
                          <td className="num">{dinero(f.venta as number, 'USD', 0)}</td>
                          <td className="num">{dinero(f.materia_prima as number, 'USD', 0)}</td>
                          <td className="num">{dinero(f.conversion as number, 'USD', 0)}</td>
                          <td className="num">{dinero(f.variable as number, 'USD', 0)}</td>
                          <td className="num">
                            <strong style={{ color: pct < 0 ? 'var(--critico)' : undefined }}>
                              {dinero(f.margen as number, 'USD', 0)}
                            </strong>
                          </td>
                          <td className="num">
                            <strong style={{
                              color: pct < 0 ? 'var(--critico)'
                                : pct < margenMinimo ? 'var(--atencion)' : 'var(--ok)',
                            }}>
                              {pct.toFixed(1)} %
                            </strong>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="pie-explicativo">
              Una familia con margen <strong>negativo</strong> se está vendiendo por debajo de lo
              que cuesta producirla. No siempre es un error —puede ser un producto de arrastre o
              una liquidación de stock antiguo— pero tiene que ser una decisión, no una sorpresa.
            </p>
          </Panel>
        </>
      )}

      {(eje === 'cliente' || eje === 'vendedor') && (
        <>
          <Panel titulo={`Venta por ${eje}`} className="mb-espacio">
            <GraficoBarras
              datos={agrupado.slice(0, 12).map((a) => ({
                etiqueta: a.nombre.length > 26 ? a.nombre.slice(0, 25) + '…' : a.nombre,
                valor: a.venta,
                nota: a.pct === null ? 'sin costo' : `margen ${a.pct.toFixed(1)} %`,
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
                      <th className="num">Venta</th><th className="num">Margen</th><th className="num">Margen %</th>
                      <th className="num">Venta sin costo</th></tr>
                </thead>
                <tbody>
                  {agrupado.map((a) => (
                    <tr key={a.nombre}>
                      <td>{a.nombre}</td>
                      <td className="num">{dinero(a.venta, 'USD', 0)}</td>
                      <td className="num">
                        {a.pct === null ? <Etiqueta texto="Sin costo" tono="atencion" /> : dinero(a.margen, 'USD', 0)}
                      </td>
                      <td className="num">
                        <strong style={{ color: a.pct === null ? 'var(--tinta-3)' : a.pct < margenMinimo ? 'var(--critico)' : 'var(--ok)' }}>
                          {a.pct === null ? '—' : pct(a.pct)}
                        </strong>
                      </td>
                      <td className="num" style={{ color: a.ventaSinCosto > 0 ? 'var(--atencion)' : 'var(--tinta-3)' }}>
                        {a.ventaSinCosto > 0 ? dinero(a.ventaSinCosto, 'USD', 0) : '—'}
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
          {filasPedidos.length === 0 ? (
            <Vacio titulo="Sin resultados" mensaje="No hay pedidos en esta categoría." />
          ) : (
            <>
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos" data-cuadro="pedidos">
                <thead>
                  <tr>
                    <th>Proforma</th><th>Cliente</th><th className="num">Fecha</th><th className="num">TM</th>
                    <th className="num">Venta</th><th className="num">Costo</th>
                    <th className="num">Margen</th><th className="num">Margen %</th>
                  </tr>
                </thead>
                <tbody>
                  {pedidosPagina.map((f) => (
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
                      <td className="num">{num(f.tm as number, 1)}</td>
                      {/* La vista devuelve estas tres cifras YA en dólares:
                          es la única forma de restar la venta contra un costo
                          que siempre se registra en dólares. */}
                      <td className="num">{dinero(f.venta as number, 'USD', 0)}</td>
                      <td className="num">{dinero(f.costo_estimado as number, 'USD', 0)}</td>
                      {/* El margen, SOLO de las líneas con costo (071). Un pedido
                          sin ningún costo no tiene margen: ni bueno ni bajo. */}
                      {f.margen_con_costo_pct === null ? (
                        <>
                          <td className="num"><Etiqueta texto="Sin costo" tono="atencion" /></td>
                          <td className="num" style={{ color: 'var(--tinta-3)' }}>—</td>
                        </>
                      ) : (
                        <>
                          <td className="num">{dinero(f.margen_con_costo as number, 'USD', 0)}</td>
                          <td className="num">
                            <strong style={{ color: n0(f.margen_con_costo_pct) < margenMinimo ? 'var(--critico)' : 'var(--ok)' }}>
                              {pct(f.margen_con_costo_pct as number)}
                            </strong>
                            {n0(f.margen_con_costo_pct) < margenMinimo && <> <Etiqueta texto="Bajo" tono="critico" /></>}
                            {n0(f.tm_sin_costo) > 0 && (
                              <><br /><span style={{ color: 'var(--atencion)', fontSize: '.68rem' }}>
                                {num(n0(f.tm_sin_costo), 1)} TM sin costo, fuera</span></>
                            )}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Paginacion pagina={pagina} porPagina={POR_PAGINA} total={filasPedidos.length} />
            </>
          )}
        </Panel>
      )}
    </>
  );
}
