/**
 * ============================================================================
 *  PRODUCTOS · el maestro de lo que se vende
 * ============================================================================
 *  Aquí hay una distinción que confunde a todo el mundo la primera vez, así
 *  que conviene dejarla clara:
 *
 *    ESPECIE      pota, bonito, merluza…            (8 en el sistema)
 *    FORMATO      laminado, filete, entera…         (10)
 *    CORTE        anillas mixtas S-P, recorte A…    (126)
 *    SKU          la combinación de los tres        (191)
 *    PRESENTACIÓN cómo va empacado: 2 x 10 kg…      (36)
 *
 *  Lo que de verdad se vende no es el SKU, es el SKU EN UNA PRESENTACIÓN: el
 *  mismo corte en placas de 20 kg y en bolsas de 10 kg son dos cosas distintas
 *  para el cliente, para el almacén y para el precio. Por eso esta pantalla
 *  lista unidades vendibles y no SKU a secas.
 *
 *  Es el maestro, no el inventario: aparecen también los productos sin stock,
 *  porque siguen siendo cotizables. Para ver solo lo que hay ahora mismo está
 *  Disponibilidad.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor } from '@/lib/supabase/servidor';
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { Filtros, Paginacion } from '@/components/ui/Filtros';
import { AccionesLista } from '@/components/ui/Acciones';
import { Icono } from '@/components/estructura/Icono';
import { num, tm } from '@/lib/formato';
import { uno, campo } from '@/lib/relaciones';

export const metadata: Metadata = { title: 'Productos' };
export const dynamic = 'force-dynamic';

const POR_PAGINA = 40;

export default async function PaginaProductos(props: PageProps<'/ventas/productos'>) {
  const q = await props.searchParams;
  const supabase = await crearClienteServidor();

  const pagina = Math.max(1, Number(q.pagina ?? 1));
  const buscar = ((q.buscar as string) ?? '').trim();
  const especie = (q.especie as string) ?? '';
  const soloConStock = q.stock === 'si';

  /*
   * El maestro completo son 360 unidades vendibles: cabe entero en memoria y
   * permite buscar por cualquier campo —incluidos los de las tablas
   * relacionadas— sin pelearse con los filtros anidados de PostgREST, que no
   * saben filtrar por «el nombre de la especie de este SKU».
   */
  const [{ data: unidades }, { data: disponibilidad }, { data: especies }] = await Promise.all([
    supabase
      .from('sku_presentaciones')
      .select('id, activo, skus(id, codigo, corte, clasificacion_comercial, empaque, vida_util_meses, activo, especies(nombre), formatos(nombre)), presentaciones(codigo, descripcion, congelamiento, peso_bulto_kg)')
      .order('id')
      .limit(1000),
    supabase.from('v_disponibilidad').select('sku_presentacion_id, disponible_kg, fisico_kg'),
    supabase.from('especies').select('nombre').eq('activo', true).order('nombre'),
  ]);

  /* ---- Stock sumado por unidad vendible, no por almacén ---- */
  const stock = new Map<number, { disponible: number; fisico: number }>();
  for (const d of disponibilidad ?? []) {
    const id = Number(d.sku_presentacion_id);
    const acumulado = stock.get(id) ?? { disponible: 0, fisico: 0 };
    acumulado.disponible += Number(d.disponible_kg ?? 0);
    acumulado.fisico += Number(d.fisico_kg ?? 0);
    stock.set(id, acumulado);
  }

  const catalogo = (unidades ?? []).map((u) => {
    const sku = uno<Record<string, unknown>>(u.skus);
    const pres = uno<Record<string, unknown>>(u.presentaciones);
    const s = stock.get(u.id as number) ?? { disponible: 0, fisico: 0 };
    return {
      id: u.id as number,
      activo: Boolean(u.activo) && Boolean(sku?.activo),
      codigo: String(sku?.codigo ?? ''),
      especie: campo(sku?.especies, 'nombre', ''),
      formato: campo(sku?.formatos, 'nombre', ''),
      corte: String(sku?.corte ?? ''),
      presentacion: String(pres?.descripcion ?? ''),
      presentacionCodigo: String(pres?.codigo ?? ''),
      congelamiento: String(pres?.congelamiento ?? ''),
      pesoBulto: Number(pres?.peso_bulto_kg ?? 0),
      disponible: s.disponible,
      fisico: s.fisico,
    };
  });

  /* ---- Los mismos campos que busca el formulario de venta ---- */
  const texto = buscar.toLowerCase();
  const filtrado = catalogo.filter((p) => {
    if (especie && p.especie !== especie) return false;
    if (soloConStock && p.disponible <= 0) return false;
    if (!texto) return true;
    return `${p.codigo} ${p.especie} ${p.formato} ${p.corte} ${p.presentacion} ${p.presentacionCodigo} ${p.congelamiento}`
      .toLowerCase()
      .includes(texto);
  });

  const pagina1 = (pagina - 1) * POR_PAGINA;
  const visibles = filtrado.slice(pagina1, pagina1 + POR_PAGINA);

  const conStock = catalogo.filter((p) => p.disponible > 0).length;
  const cortes = new Set(catalogo.map((p) => p.corte)).size;

  return (
    <>
      <CabeceraPagina
        titulo="Productos"
        descripcion="El maestro de lo que se puede vender: cada fila es un corte en una presentación concreta. Aparecen también los que ahora mismo no tienen stock, porque se pueden cotizar igual."
      >
        <Link href="/ventas/disponibilidad" className="btn btn-secundario">
          <Icono nombre="disponibilidad" tamano={15} />
          Ver solo lo disponible
        </Link>
        <Link href="/ventas/cotizaciones/nueva" className="btn btn-primario">
          <Icono nombre="cotizacion" tamano={15} />
          Cotizar
        </Link>
      </CabeceraPagina>

      <RejillaKpi>
        <Kpi etiqueta="Unidades vendibles" valor={num(catalogo.length)} nota="SKU × presentación" />
        <Kpi etiqueta="Cortes distintos" valor={num(cortes)} />
        <Kpi
          etiqueta="Con stock ahora"
          valor={num(conStock)}
          tono={conStock > 0 ? 'ok' : 'atencion'}
          nota={`${num(catalogo.length - conStock)} sin existencias`}
        />
        <Kpi
          etiqueta="Disponible total"
          valor={tm(catalogo.reduce((s, p) => s + p.disponible, 0))}
          nota="Libre para vender"
        />
      </RejillaKpi>

      <Panel titulo={`${num(filtrado.length)} productos`}>
        <Filtros
          campos={[
            { tipo: 'texto', clave: 'buscar', etiqueta: 'SKU, especie, corte o presentación', ancho: '17rem' },
            {
              tipo: 'select', clave: 'especie', etiqueta: 'Especie',
              opciones: (especies ?? []).map((e) => ({ valor: e.nombre as string, texto: e.nombre as string })),
            },
            { tipo: 'select', clave: 'stock', etiqueta: 'Existencias',
              opciones: [{ valor: 'si', texto: 'Solo con stock' }] },
          ]}
        />

        {visibles.length === 0 ? (
          <Vacio
            titulo="Sin productos"
            mensaje="No hay productos que coincidan. Pruebe con menos filtros o busque por el corte."
          />
        ) : (
          <>
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Especie</th>
                    <th>Formato</th>
                    <th>Corte</th>
                    <th>Presentación</th>
                    <th>Congelamiento</th>
                    <th className="num">Bulto</th>
                    <th className="num">Disponible</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((p) => (
                    <tr key={p.id}>
                      <td className="mono">
                        <Link href={`/ventas/productos/${p.id}`} className="enlace-ficha">
                          {p.codigo}
                        </Link>
                      </td>
                      <td>{p.especie}</td>
                      <td>{p.formato}</td>
                      <td style={{ fontSize: '.8rem' }}>{p.corte}</td>
                      <td className="mono" style={{ fontSize: '.76rem' }}>
                        {p.presentacion}
                        <br />
                        <span style={{ color: 'var(--tinta-3)', fontSize: '.7rem' }}>
                          {p.presentacionCodigo}
                        </span>
                      </td>
                      <td style={{ fontSize: '.78rem' }}>{p.congelamiento || '—'}</td>
                      <td className="num">{num(p.pesoBulto, 1)} kg</td>
                      <td className="num">
                        {p.disponible > 0 ? (
                          <strong style={{ color: 'var(--ok)' }}>{tm(p.disponible)}</strong>
                        ) : p.fisico > 0 ? (
                          <Etiqueta texto="Comprometido" tono="atencion" />
                        ) : (
                          <span style={{ color: 'var(--tinta-3)' }}>—</span>
                        )}
                      </td>
                      <td>
                        {p.activo
                          ? <Etiqueta texto="Vendible" tono="ok" />
                          : <Etiqueta texto="Descatalogado" tono="neutro" />}
                      </td>
                      <td>
                        <AccionesLista
                          ver={`/ventas/productos/${p.id}`}
                          verTitulo={`Ver ${p.codigo} · ${p.presentacion}`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Paginacion pagina={pagina} porPagina={POR_PAGINA} total={filtrado.length} />
          </>
        )}
      </Panel>

      <p className="pie-explicativo">
        Un producto <strong>descatalogado</strong> no desaparece: se deja de poder cotizar, pero
        sigue apareciendo en el Kardex, en los pedidos antiguos y en la trazabilidad. Borrarlo
        dejaría sin explicación todo lo que se vendió de él.
      </p>
    </>
  );
}
