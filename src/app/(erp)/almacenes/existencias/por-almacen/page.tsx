/**
 * ============================================================================
 *  EXISTENCIAS POR ALMACÉN · el resumen que Dany mira en su Power BI
 * ============================================================================
 *  Dany (21/11): «una consulta en existencias, ¿se puede revisar por almacén?
 *  así más o menos como la imagen». La imagen es su reporte de anticuamiento:
 *  filtros a la izquierda (almacén, cámara, especie, producto) y tres tablas
 *  —por especie, por producto y el detalle proceso › especie › producto ›
 *  corte › congelamiento › presentación— con Tn en almacén, comprometido,
 *  disponible, observado y tiempo promedio en cámara.
 *
 *  Se usa SU vocabulario: «producto» es la familia comercial (ALAS FRESCAS,
 *  FILETE DARUMA…), y «proceso» separa FRESCOS de PRECOCIDOS.
 *
 *  Se suma aquí y no en la base: son ~2 200 posiciones, se traen en páginas de
 *  mil con traerTodo y no hace falta tocar el esquema para un resumen. Van
 *  ORDENADAS: sin orden, cada página sale de una lectura distinta y unas filas
 *  se repiten y otras se pierden (la primera versión sumaba 2 047 TM de 1 980).
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel, Vacio } from '@/components/ui/Pagina';
import { Filtros } from '@/components/ui/Filtros';
import { num, tm } from '@/lib/formato';
import { traerTodo } from '@/lib/traerTodo';
import { uno } from '@/lib/relaciones';

export const metadata: Metadata = { title: 'Existencias por almacén' };
export const dynamic = 'force-dynamic';

/* Las tres cámaras de planta son tres «almacenes» en el sistema; en el
   Power BI de Dany son uno solo, STM, con cámaras C1, C2 y C3. */
const STM = 'stm';
const esCamaraPlanta = (nombre: string) => nombre.startsWith('Santa Mónica');

type Suma = { fisico: number; comprometido: number; disponible: number; observado: number; mesesKg: number };
const vacia = (): Suma => ({ fisico: 0, comprometido: 0, disponible: 0, observado: 0, mesesKg: 0 });

/* Las tres tablas chicas comparten columnas: el nombre del grupo y las tres cifras. */
function Cabecera({ primera }: { primera: string }) {
  return (
    <thead>
      <tr>
        <th>{primera}</th>
        <th className="num">Tn almacén</th>
        <th className="num" title="Reservado + en preparación">Comprom.</th>
        <th className="num">Disp. (Tn)</th>
      </tr>
    </thead>
  );
}

function Cifras({ s }: { s: Suma }) {
  return (
    <>
      <td className="num">{tm(s.fisico)}</td>
      <td className="num">{s.comprometido > 0 ? tm(s.comprometido) : ''}</td>
      <td className={`num${s.disponible > 0 ? ' disp' : ''}`}>
        <strong>{s.disponible > 0 ? tm(s.disponible) : ''}</strong>
      </td>
    </>
  );
}

function Total({ s }: { s: Suma }) {
  return (
    <tfoot>
      <tr className="fila-total">
        <td><strong>Total</strong></td>
        <td className="num"><strong>{tm(s.fisico)}</strong></td>
        <td className="num"><strong>{tm(s.comprometido)}</strong></td>
        <td className="num"><strong>{tm(s.disponible)}</strong></td>
      </tr>
    </tfoot>
  );
}

export default async function PaginaExistenciasPorAlmacen(props: PageProps<'/almacenes/existencias/por-almacen'>) {
  const q = await props.searchParams;
  const supabase = await crearClienteServidor();

  const almacen = (q.almacen as string) ?? '';
  const especie = (q.especie as string) ?? '';
  const producto = (q.producto as string) ?? '';
  const proceso = (q.proceso as string) ?? '';

  const [{ data: almacenes }, lotes, stock] = await Promise.all([
    supabase.from('almacenes').select('id, nombre').eq('activo', true).order('orden').order('nombre'),
    traerTodo<{ lote_id: number; almacen_id: number; especie: string; formato: string; familia: string;
                corte: string; meses_almacenado: number }>(
      (d, h) => supabase.from('v_anticuamiento')
        .select('lote_id, almacen_id, especie, formato, familia, corte, meses_almacenado')
        .gt('fisico_kg', 0).order('lote_id').order('almacen_id').range(d, h)
    ),
    /* v_stock_lote trae el desglose que la otra vista no: lo bloqueado por
       Calidad (observado) y lo reservado o en preparación (comprometido). */
    traerTodo<{ lote_id: number; almacen_id: number; sku_presentacion_id: number; fisico_kg: number;
                bloqueado_kg: number; reservado_kg: number; preparacion_kg: number; disponible_kg: number }>(
      (d, h) => supabase.from('v_stock_lote')
        .select('lote_id, almacen_id, sku_presentacion_id, fisico_kg, bloqueado_kg, reservado_kg, preparacion_kg, disponible_kg')
        .gt('fisico_kg', 0).order('lote_id').order('almacen_id').range(d, h)
    ),
  ]);

  const idsPres = [...new Set(stock.map((s) => s.sku_presentacion_id).filter(Boolean))];
  const { data: presentaciones } = idsPres.length
    ? await supabase.from('sku_presentaciones')
        .select('id, presentaciones(descripcion, congelamiento)')
        .in('id', idsPres)
    : { data: [] };
  const presentacion = new Map((presentaciones ?? []).map((p) => {
    const pr = uno<Record<string, unknown>>(p.presentaciones);
    return [Number(p.id), {
      descripcion: String(pr?.descripcion ?? '—'),
      congelamiento: pr?.congelamiento === 'tunel' ? 'TÚNEL' : pr?.congelamiento ? 'PLACAS' : '—',
    }];
  }));

  const nombreAlmacen = new Map((almacenes ?? []).map((a) => [Number(a.id), String(a.nombre)]));
  const infoLote = new Map(lotes.map((l) => [`${l.lote_id}-${l.almacen_id}`, l]));

  /* Cada posición con todo lo que hace falta para filtrar y agrupar. */
  const posiciones = stock.flatMap((s) => {
    const l = infoLote.get(`${s.lote_id}-${s.almacen_id}`);
    if (!l) return [];
    const p = presentacion.get(Number(s.sku_presentacion_id));
    return [{
      almacenId: Number(s.almacen_id),
      almacen: nombreAlmacen.get(Number(s.almacen_id)) ?? '—',
      proceso: l.formato === 'PRECOCIDOS' ? 'PRECOCIDOS' : 'FRESCOS',
      especie: l.especie ?? '—',
      producto: l.familia || l.formato || '—',
      corte: l.corte ?? '—',
      congelamiento: p?.congelamiento ?? '—',
      presentacion: p?.descripcion ?? '—',
      fisico: Number(s.fisico_kg ?? 0),
      comprometido: Number(s.reservado_kg ?? 0) + Number(s.preparacion_kg ?? 0),
      disponible: Number(s.disponible_kg ?? 0),
      observado: Number(s.bloqueado_kg ?? 0),
      meses: Number(l.meses_almacenado ?? 0),
    }];
  });

  const enAlmacen = (x: { almacenId: number; almacen: string }) =>
    !almacen ? true : almacen === STM ? esCamaraPlanta(x.almacen) : String(x.almacenId) === almacen;

  /* Los desplegables se encadenan: solo se ofrece lo que hay en el almacén elegido. */
  const unicos = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b, 'es'));
  const delAlmacen = posiciones.filter(enAlmacen);
  const opcionesEspecie = unicos(delAlmacen.map((x) => x.especie));
  const opcionesProducto = unicos(delAlmacen.filter((x) => !especie || x.especie === especie).map((x) => x.producto));

  const filas = delAlmacen.filter((x) =>
    (!especie || x.especie === especie) &&
    (!producto || x.producto === producto) &&
    (!proceso || x.proceso === proceso)
  );

  function agrupar(clave: (x: (typeof filas)[number]) => string) {
    const m = new Map<string, Suma>();
    for (const x of filas) {
      const k = clave(x);
      const s = m.get(k) ?? vacia();
      s.fisico += x.fisico;
      s.comprometido += x.comprometido;
      s.disponible += x.disponible;
      s.observado += x.observado;
      s.mesesKg += x.meses * x.fisico;
      m.set(k, s);
    }
    return m;
  }
  const total = [...agrupar(() => 'total').values()][0] ?? vacia();
  const ordenar = (m: Map<string, Suma>) =>
    [...m.entries()].sort((a, b) => b[1].fisico - a[1].fisico);

  const porAlmacen = ordenar(agrupar((x) => x.almacen));
  const porEspecie = ordenar(agrupar((x) => x.especie));
  const porProducto = ordenar(agrupar((x) => x.producto));

  /* El detalle va ordenado como en su reporte, de lo general a lo particular,
     y cada nivel solo se escribe en su primera fila para que se lea agrupado. */
  const SEP = '\u0001';
  const detalle = [...agrupar((x) =>
    [x.proceso, x.especie, x.producto, x.corte, x.congelamiento, x.presentacion].join(SEP)
  ).entries()]
    .map(([k, s]) => ({ niveles: k.split(SEP), ...s }))
    .sort((a, b) => {
      for (let i = 0; i < a.niveles.length; i++) {
        const c = a.niveles[i].localeCompare(b.niveles[i], 'es', { numeric: true });
        if (c) return c;
      }
      return 0;
    });

  const enlace = (cambios: Record<string, string>) => {
    const p = new URLSearchParams();
    const actual: Record<string, string> = { almacen, especie, producto, proceso, ...cambios };
    for (const [k, v] of Object.entries(actual)) if (v) p.set(k, v);
    const t = p.toString();
    return `/almacenes/existencias/por-almacen${t ? '?' + t : ''}`;
  };

  const tituloAlmacen = !almacen ? 'Todos los almacenes'
    : almacen === STM ? 'Santa Mónica (las tres cámaras)'
    : nombreAlmacen.get(Number(almacen)) ?? '';

  const meses = (s: Suma) => (s.fisico > 0 ? s.mesesKg / s.fisico : 0);

  return (
    <>
      <CabeceraPagina
        titulo="Existencias por almacén"
        descripcion="Cuánto hay en cada almacén, cuánto está comprometido con pedidos y cuánto queda libre, por especie, producto, corte y presentación."
        volver={{ href: '/almacenes/existencias', texto: 'Existencias por lote' }}
      />

      <Panel titulo={tituloAlmacen} className="mb-espacio">
        <Filtros
          campos={[
            {
              tipo: 'select', clave: 'almacen', etiqueta: 'Almacén',
              opciones: [
                { valor: STM, texto: 'Santa Mónica (todas las cámaras)' },
                ...(almacenes ?? []).map((a) => ({ valor: String(a.id), texto: a.nombre as string })),
              ],
            },
            { tipo: 'select', clave: 'proceso', etiqueta: 'Proceso',
              opciones: [{ valor: 'FRESCOS', texto: 'Frescos' }, { valor: 'PRECOCIDOS', texto: 'Precocidos' }] },
            { tipo: 'select', clave: 'especie', etiqueta: 'Especie',
              opciones: opcionesEspecie.map((e) => ({ valor: e, texto: e })) },
            { tipo: 'select', clave: 'producto', etiqueta: 'Producto',
              opciones: opcionesProducto.map((p) => ({ valor: p, texto: p })) },
          ]}
        />

        {filas.length === 0 ? (
          <Vacio titulo="Sin stock" mensaje="No hay existencias que coincidan con estos filtros." />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos compacta" data-tabla="por-almacen">
              <Cabecera primera="Almacén" />
              <tbody>
                {porAlmacen.map(([nombre, s]) => {
                  const id = (almacenes ?? []).find((a) => a.nombre === nombre)?.id;
                  return (
                    <tr key={nombre}>
                      <td>
                        {id ? <Link href={enlace({ almacen: String(id) })} className="enlace-dato">{nombre}</Link> : nombre}
                      </td>
                      <Cifras s={s} />
                    </tr>
                  );
                })}
              </tbody>
              <Total s={total} />
            </table>
          </div>
        )}
      </Panel>

      {filas.length > 0 && (
        <>
          <div className="rejilla-2 mb-espacio" style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 22rem), 1fr))' }}>
            <Panel titulo="Por especie">
              <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
                <table className="datos compacta" data-tabla="por-especie">
                  <Cabecera primera="Especie" />
                  <tbody>
                    {porEspecie.map(([nombre, s]) => (
                      <tr key={nombre}>
                        <td><Link href={enlace({ especie: nombre, producto: '' })} className="enlace-dato">{nombre}</Link></td>
                        <Cifras s={s} />
                      </tr>
                    ))}
                  </tbody>
                  <Total s={total} />
                </table>
              </div>
            </Panel>

            <Panel titulo="Detalle por producto">
              <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
                <table className="datos compacta" data-tabla="por-producto">
                  <Cabecera primera="Producto" />
                  <tbody>
                    {porProducto.map(([nombre, s]) => (
                      <tr key={nombre}>
                        <td><Link href={enlace({ producto: nombre })} className="enlace-dato">{nombre}</Link></td>
                        <Cifras s={s} />
                      </tr>
                    ))}
                  </tbody>
                  <Total s={total} />
                </table>
              </div>
            </Panel>
          </div>

          <Panel titulo="Reporte por producto terminado">
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos compacta" data-tabla="detalle">
                <thead>
                  <tr>
                    <th>Proceso</th>
                    <th>Especie</th>
                    <th>Producto</th>
                    <th>Corte</th>
                    <th>Tipo cong.</th>
                    <th>Pres.</th>
                    <th className="num">Tn almacén</th>
                    <th className="num" title="Reservado para pedidos + en preparación de despacho">Comprom. (Tn)</th>
                    <th className="num">Disp. (Tn)</th>
                    <th className="num" title="Bloqueado por Calidad">Observ. (Tn)</th>
                    <th className="num" title="Meses en cámara, promediados por peso">Tiempo prom. (meses)</th>
                  </tr>
                </thead>
                <tbody>
                  {detalle.map((d, i) => {
                    const anterior = detalle[i - 1]?.niveles;
                    /* Un nivel se escribe si cambió él o alguno de los de su izquierda. */
                    let cambio = !anterior;
                    const celdas = d.niveles.map((v, n) => {
                      cambio = cambio || anterior[n] !== v;
                      return cambio ? v : '';
                    });
                    return (
                      <tr key={d.niveles.join('|')} className={i > 0 && celdas[2] ? 'nuevo-grupo' : undefined}>
                        {celdas.map((v, n) => (
                          <td key={n} className={n >= 4 ? 'corto' : undefined} style={n < 3 ? { fontWeight: 600 } : undefined}>{v}</td>
                        ))}
                        <td className="num">{tm(d.fisico)}</td>
                        <td className="num">{d.comprometido > 0 ? tm(d.comprometido) : ''}</td>
                        <td className={`num${d.disponible > 0 ? ' disp' : ''}`}>
                          {d.disponible > 0 ? tm(d.disponible) : ''}
                        </td>
                        <td className="num">{d.observado > 0 ? tm(d.observado) : ''}</td>
                        <td className="num">{num(meses(d), 1)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="fila-total">
                    <td colSpan={6}><strong>Total</strong></td>
                    <td className="num"><strong>{tm(total.fisico)}</strong></td>
                    <td className="num"><strong>{tm(total.comprometido)}</strong></td>
                    <td className="num"><strong>{tm(total.disponible)}</strong></td>
                    <td className="num"><strong>{tm(total.observado)}</strong></td>
                    <td className="num"><strong>{num(meses(total), 1)}</strong></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Panel>

          <p className="pie-explicativo" data-nota="por-almacen">
            <strong>Comprometido</strong> = reservado para pedidos + en preparación de despacho.{' '}
            <strong>Observado</strong> = bloqueado por Calidad. <strong>Disponible</strong> = lo que queda
            libre para vender, reservar o trasladar. <strong>Tiempo prom.</strong> = meses en cámara,
            promediados por peso. Las tres cámaras de planta se pueden ver juntas con
            «Santa Mónica (todas las cámaras)» o por separado.
          </p>
        </>
      )}
    </>
  );
}
