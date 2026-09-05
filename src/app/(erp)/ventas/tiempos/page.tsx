/**
 * ============================================================================
 *  TIEMPOS DEL FLUJO · cuánto tarda cada paso
 * ============================================================================
 *  Lo pidió Oliver: «para ver cuál es el tiempo promedio que nos lleva desde
 *  cotizar hasta despachar [...] desde que se cotiza hasta que se programa el
 *  despacho, y otro desde que se programa hasta que se despacha».
 *
 *  LA DECISIÓN DE DISEÑO MÁS IMPORTANTE DE ESTA PANTALLA
 *  Cada tramo se mide sobre una población distinta, y eso hay que decirlo o la
 *  pantalla miente. Solo los pedidos que ya salieron tienen «de la oferta al
 *  muelle»; los que aún no se han programado no tienen «tiempo hasta
 *  programar». Si se enseñaran los promedios a secas, uno podría salir mayor
 *  que el total y nadie entendería por qué.
 *
 *  Por eso debajo de cada cifra va SIEMPRE sobre cuántos pedidos se calculó.
 *
 *  Y POR QUÉ SE MUESTRA LA MEDIANA JUNTO AL PROMEDIO
 *  Porque en plazos de entrega el promedio engaña: un pedido que se atascó
 *  seis meses arrastra la media de los otros cuarenta. La mediana dice cuánto
 *  tarda el pedido normal, que es la pregunta que se está haciendo.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { Filtros, Paginacion } from '@/components/ui/Filtros';
import { AccionesLista } from '@/components/ui/Acciones';
import { num, dinero, fecha } from '@/lib/formato';
import { hoyEnLima, desplazarDias } from '@/lib/fechas';
import { veCostos, type Rol } from '@/lib/navegacion';

export const metadata: Metadata = { title: 'Tiempos del flujo' };
export const dynamic = 'force-dynamic';

const POR_PAGINA = 40;

/**
 * Los tramos de la cadena, en orden.
 *
 * `signo` marca los dos donde un número NEGATIVO es una buena noticia: salió
 * antes de lo programado, o antes de lo prometido al cliente. En los demás,
 * menos días siempre es mejor.
 */
const TRAMOS = [
  {
    clave: 'dias_negociacion',
    titulo: 'Cotización → Pedido',
    ayuda: 'Lo que tarda el cliente en aceptar la oferta',
    signo: false,
  },
  {
    clave: 'dias_a_programar',
    titulo: 'Pedido → Salida programada',
    ayuda: 'El plazo de entrega que la empresa se da a sí misma',
    signo: false,
  },
  {
    clave: 'dias_puntualidad',
    titulo: 'Programado → Despachado',
    ayuda: 'Puntualidad. Negativo significa que salió antes de lo previsto',
    signo: true,
  },
  {
    clave: 'dias_a_facturar',
    titulo: 'Despacho → Factura',
    ayuda: 'Cuánto se tarda en emitir el comprobante',
    signo: false,
  },
  {
    clave: 'dias_a_cobrar',
    titulo: 'Factura → Cobro',
    ayuda: 'Los días que el dinero está en la calle',
    signo: false,
  },
] as const;

type Fila = Record<string, unknown>;

/** Promedio, mediana y cuántos pedidos entraron en el cálculo. */
function resumir(filas: Fila[], clave: string) {
  const valores = filas
    .map((f) => f[clave])
    .filter((v) => v !== null && v !== undefined)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  if (valores.length === 0) return { n: 0, promedio: null, mediana: null, p90: null };

  const suma = valores.reduce((s, v) => s + v, 0);
  const medio = Math.floor(valores.length / 2);
  return {
    n: valores.length,
    promedio: suma / valores.length,
    mediana: valores.length % 2 ? valores[medio] : (valores[medio - 1] + valores[medio]) / 2,
    p90: valores[Math.min(valores.length - 1, Math.floor(valores.length * 0.9))],
  };
}

/** Cómo se pinta un número de días según si tardar es malo o es normal. */
function tonoDias(dias: number | null, esPuntualidad: boolean) {
  if (dias === null) return 'neutro' as const;
  if (esPuntualidad) {
    if (dias <= 0) return 'ok' as const;
    return dias <= 2 ? 'atencion' as const : 'critico' as const;
  }
  return 'marca' as const;
}

export default async function PaginaTiempos(props: PageProps<'/ventas/tiempos'>) {
  const q = await props.searchParams;
  const supabase = await crearClienteServidor();
  const usuario = await obtenerUsuarioActual();
  const puedeVerImportes = veCostos((usuario?.rol ?? 'consulta') as Rol);

  const pagina = Math.max(1, Number(q.pagina ?? 1));
  const buscar = ((q.buscar as string) ?? '').trim();
  const desde = (q.desde as string) ?? '';
  const hasta = (q.hasta as string) ?? '';
  const destino = (q.destino as string) ?? '';
  const vendedor = (q.vendedor as string) ?? '';
  const soloCompletos = q.completos === 'si';

  const hoy = hoyEnLima();

  let consulta = supabase.from('v_tiempos_flujo').select('*');

  /* El rango va sobre la fecha del PEDIDO: es el hito que tienen todos. La
     cotización solo la tiene una parte, y el despacho, menos todavía. */
  if (desde) consulta = consulta.gte('f_pedido', desde);
  if (hasta) consulta = consulta.lte('f_pedido', hasta);
  if (destino) consulta = consulta.eq('destino', destino);
  if (vendedor) consulta = consulta.eq('vendedor', vendedor);
  if (buscar) {
    const limpio = buscar.replace(/[%,()]/g, ' ');
    consulta = consulta.or(`numero_proforma.ilike.%${limpio}%,cliente.ilike.%${limpio}%,cotizacion.ilike.%${limpio}%`);
  }
  /* «Cadena completa» son los que llegaron al muelle: sin despacho no hay
     tiempo total que medir, y son justamente los que Oliver quiere ver. */
  if (soloCompletos) consulta = consulta.not('f_despacho', 'is', null);

  const [{ data: filas }, { data: destinos }, { data: vendedores }] = await Promise.all([
    consulta.order('f_pedido', { ascending: false }).limit(2000),
    supabase.from('destinos').select('puerto').order('puerto'),
    supabase.from('vendedores').select('nombre').order('nombre'),
  ]);

  const lista = (filas ?? []) as Fila[];

  /*
   * LOS PEDIDOS CON LA CRONOLOGÍA ROTA NO ENTRAN EN NINGÚN PROMEDIO.
   *
   * Un pedido que aparece despachado antes de existir no es una entrega
   * rapidísima: es un dato mal grabado. Y basta uno con −178 días para que la
   * media de los otros noventa deje de significar nada.
   *
   * No se descartan en silencio: se cuentan aparte y la pantalla los enseña,
   * porque un dato imposible es algo que alguien tiene que ir a corregir.
   */
  const sanos = lista.filter((f) => f.cronologia_valida !== false);
  const rotos = lista.length - sanos.length;

  const total = resumir(sanos, 'dias_total');
  const resumenes = TRAMOS.map((t) => ({ ...t, ...resumir(sanos, t.clave) }));

  /* La escala de las barras: el tramo más lento marca el 100 %. */
  const mayor = Math.max(1, ...resumenes.map((r) => Math.abs(r.promedio ?? 0)));

  const visibles = lista.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
  const hayFiltros = Boolean(buscar || desde || hasta || destino || vendedor || soloCompletos);

  return (
    <>
      <CabeceraPagina
        titulo="Tiempos del flujo"
        descripcion="Cuánto tarda de verdad cada paso, de la oferta al muelle y del muelle al cobro. Se mide con las fechas del negocio, no con la hora en que se tecleó cada documento."
      />

      <RejillaKpi>
        <Kpi
          etiqueta="De la oferta al muelle"
          valor={total.promedio === null ? '—' : num(total.promedio, 1)}
          sufijo="días"
          tono="marca"
          nota={total.n ? `promedio de ${num(total.n)} pedidos despachados` : 'ningún pedido despachado con estos filtros'}
        />
        <Kpi
          etiqueta="El pedido normal"
          valor={total.mediana === null ? '—' : num(total.mediana, 0)}
          sufijo="días"
          nota="mediana: la mitad tarda menos que esto"
        />
        <Kpi
          etiqueta="Los más lentos"
          valor={total.p90 === null ? '—' : num(total.p90, 0)}
          sufijo="días"
          tono="atencion"
          nota="uno de cada diez tarda esto o más"
        />
        <Kpi
          etiqueta="Pedidos analizados"
          valor={num(sanos.length)}
          tono={rotos > 0 ? 'atencion' : 'neutro'}
          nota={rotos > 0
            ? `${num(rotos)} quedaron fuera por fechas imposibles`
            : soloCompletos ? 'solo los que ya salieron' : 'todos los del filtro'}
        />
      </RejillaKpi>

      {rotos > 0 && (
        <div className="ficha-aviso ficha-aviso-atencion" role="status">
          <span>
            <strong>{num(rotos)} pedido{rotos === 1 ? '' : 's'} con fechas imposibles</strong> —
            aparecen despachados o facturados antes de existir. No entran en ningún promedio,
            porque uno solo bastaría para falsearlos. Están marcados en la tabla de abajo y hay
            que corregirles la fecha.
          </span>
        </div>
      )}

      {/* ══════ EL EMBUDO ══════ */}
      <Panel titulo="Dónde se va el tiempo" className="mb-espacio">
        <div className="tramos">
          {resumenes.map((r) => {
            const ancho = r.promedio === null ? 0 : (Math.abs(r.promedio) / mayor) * 100;
            const tono = tonoDias(r.promedio, r.signo);
            return (
              <div key={r.clave} className="tramo">
                <div className="tramo-cab">
                  <strong>{r.titulo}</strong>
                  <span className="tramo-cifra" data-tono={tono}>
                    {r.promedio === null ? '—' : `${num(r.promedio, 1)} d`}
                  </span>
                </div>
                <span className="tramo-barra">
                  <i data-tono={tono} style={{ width: `${Math.max(ancho, r.n ? 2 : 0)}%` }} />
                </span>
                <div className="tramo-pie">
                  <span>{r.ayuda}</span>
                  {/*
                    Cuántos pedidos entraron en ESTE promedio. Sin este número
                    la comparación entre tramos es engañosa: cada uno se calcula
                    sobre los pedidos que llegaron hasta ahí, y no son los
                    mismos.
                  */}
                  <span className="tramo-n">
                    {r.n === 0
                      ? 'sin datos'
                      : `${num(r.n)} pedido${r.n === 1 ? '' : 's'} · mediana ${num(r.mediana ?? 0, 0)} d`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <p className="pie-explicativo">
          Cada tramo se calcula sobre los pedidos que llegaron hasta ese punto, así que las
          poblaciones no son las mismas y las cifras no se pueden sumar entre sí. Para compararlas
          de verdad, marque <strong>«Solo cadena completa»</strong> en los filtros: ahí todos los
          tramos se miden sobre los mismos pedidos y sí suman el total.
          <br /><br />
          En <strong>Programado → Despachado</strong> un número negativo es buena noticia: el
          contenedor salió antes de la fecha prevista.
        </p>
      </Panel>

      {/* ══════ EL DETALLE ══════ */}
      <Panel titulo={`${num(lista.length)} pedidos`}>
        <Filtros
          campos={[
            { tipo: 'texto', clave: 'buscar', etiqueta: 'Proforma, cliente o cotización', ancho: '15rem' },
            { tipo: 'fecha', clave: 'desde', etiqueta: 'Pedidos desde' },
            { tipo: 'fecha', clave: 'hasta', etiqueta: 'Pedidos hasta' },
            {
              tipo: 'select', clave: 'destino', etiqueta: 'Destino',
              opciones: (destinos ?? []).map((d) => ({ valor: d.puerto as string, texto: d.puerto as string })),
            },
            {
              tipo: 'select', clave: 'vendedor', etiqueta: 'Vendedor',
              opciones: (vendedores ?? []).map((v) => ({ valor: v.nombre as string, texto: v.nombre as string })),
            },
            {
              tipo: 'select', clave: 'completos', etiqueta: 'Alcance',
              opciones: [{ valor: 'si', texto: 'Solo cadena completa' }],
            },
          ]}
        />

        <div className="atajos-fecha">
          <span>Rápido:</span>
          <Link href="/ventas/tiempos?completos=si">Solo los que ya salieron</Link>
          <Link href={`/ventas/tiempos?desde=${desplazarDias(hoy, -30)}&hasta=${hoy}`}>Últimos 30 días</Link>
          <Link href={`/ventas/tiempos?desde=${desplazarDias(hoy, -90)}&hasta=${hoy}`}>Últimos 90 días</Link>
          {hayFiltros && <Link href="/ventas/tiempos" className="atajo-limpiar">Quitar filtros</Link>}
        </div>

        {visibles.length === 0 ? (
          <Vacio
            titulo="Sin pedidos"
            mensaje="No hay pedidos que coincidan con estos filtros. Pruebe a ampliar el rango de fechas."
          />
        ) : (
          <>
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos">
                <thead>
                  <tr>
                    <th>Proforma</th>
                    <th>Cliente</th>
                    <th>Destino</th>
                    <th className="num">Pedido</th>
                    <th className="num">Cot→Ped</th>
                    <th className="num">Ped→Prog</th>
                    <th className="num">Prog→Desp</th>
                    <th className="num">Total</th>
                    <th className="num">vs. compromiso</th>
                    {puedeVerImportes && <th className="num">Venta US$</th>}
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((f) => {
                    /** Un tramo sin datos se pinta como raya, no como cero. */
                    const dias = (clave: string, esPuntualidad = false) => {
                      const v = f[clave];
                      if (v === null || v === undefined) {
                        return <span style={{ color: 'var(--tinta-3)' }}>—</span>;
                      }
                      const n = Number(v);
                      const color = esPuntualidad
                        ? n <= 0 ? 'var(--ok)' : n <= 2 ? 'var(--atencion)' : 'var(--critico)'
                        : undefined;
                      return (
                        <span style={{ color }}>
                          {n > 0 && esPuntualidad ? '+' : ''}{num(n, 0)} d
                        </span>
                      );
                    };

                    const roto = f.cronologia_valida === false;

                    return (
                      <tr key={f.pedido_id as number} className={roto ? 'fila-incoherente' : undefined}>
                        <td className="mono">
                          <Link href={`/ventas/pedidos/${f.pedido_id}`} className="enlace-ficha">
                            {f.numero_proforma as string}
                          </Link>
                          <br />
                          <span style={{ color: 'var(--tinta-3)', fontSize: '.68rem' }}>
                            {(f.cotizacion as string) ?? 'directo'}
                          </span>
                          {roto && (
                            <> <Etiqueta texto="Fechas imposibles" tono="critico" /></>
                          )}
                        </td>
                        <td title={f.cliente as string}>
                          {String(f.cliente).length > 26 ? String(f.cliente).slice(0, 25) + '…' : String(f.cliente)}
                        </td>
                        <td style={{ fontSize: '.78rem' }}>{(f.destino as string) ?? '—'}</td>
                        <td className="num" style={{ fontSize: '.76rem' }}>{fecha(f.f_pedido as string)}</td>
                        <td className="num">{dias('dias_negociacion')}</td>
                        <td className="num">{dias('dias_a_programar')}</td>
                        <td className="num">{dias('dias_puntualidad', true)}</td>
                        <td className="num">
                          {f.dias_total === null || f.dias_total === undefined ? (
                            <Etiqueta texto="En curso" tono="neutro" />
                          ) : (
                            <strong>{num(Number(f.dias_total), 0)} d</strong>
                          )}
                        </td>
                        <td className="num">{dias('dias_vs_compromiso', true)}</td>
                        {puedeVerImportes && (
                          <td className="num">{dinero(f.venta_usd as number, 'USD', 0)}</td>
                        )}
                        <td>
                          <AccionesLista
                            ver={`/ventas/pedidos/${f.pedido_id}`}
                            verTitulo={`Ver el pedido ${f.numero_proforma}`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Paginacion pagina={pagina} porPagina={POR_PAGINA} total={lista.length} />
          </>
        )}

        <p className="pie-explicativo">
          <strong>vs. compromiso</strong> compara la salida real con la fecha que se le prometió al
          cliente, que no siempre coincide con la programación interna. Un valor positivo es un
          retraso frente a lo prometido.
          <br /><br />
          El paso <strong>pedido → reserva de stock</strong> no aparece porque la reserva todavía no
          guarda una fecha de negocio, solo la hora en que se registró. Se prefiere no mostrar un
          dato antes que mostrar uno que no significa lo que parece.
        </p>
      </Panel>
    </>
  );
}
