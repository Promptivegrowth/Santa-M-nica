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
 *
 *  POR QUÉ AQUÍ NO SE VE EL STOCK
 *  Se quitó a pedido de operaciones, y la razón es buena: si el mismo dato
 *  aparece en dos pantallas, tarde o temprano una de las dos se lee mal. El
 *  stock vive en Existencias y en Disponibilidad, que es donde se va a
 *  buscarlo. Aquí se responde otra pregunta: qué se puede vender y a cuánto se
 *  vendió la última vez.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { Filtros, Paginacion } from '@/components/ui/Filtros';
import { AccionesLista } from '@/components/ui/Acciones';
import { Icono } from '@/components/estructura/Icono';
import { num, dinero, fecha } from '@/lib/formato';
import { uno, campo } from '@/lib/relaciones';

export const metadata: Metadata = { title: 'Productos' };
export const dynamic = 'force-dynamic';

const POR_PAGINA = 40;

/** Cómo se llama cada empaque en la pantalla. En la base son minúsculas. */
const NOMBRE_EMPAQUE: Record<string, string> = {
  sacos: 'Sacos',
  cajas: 'Cajas',
  block: 'Block',
};

export default async function PaginaProductos(props: PageProps<'/ventas/productos'>) {
  const q = await props.searchParams;
  const supabase = await crearClienteServidor();
  const usuarioActual = await obtenerUsuarioActual();
  const puedeEditar = ['gerencia', 'operaciones', 'comercial'].includes(usuarioActual?.rol ?? '');

  const pagina = Math.max(1, Number(q.pagina ?? 1));
  const buscar = ((q.buscar as string) ?? '').trim();
  const especie = (q.especie as string) ?? '';
  const formato = (q.formato as string) ?? '';
  const corte = (q.corte as string) ?? '';
  const orden = (q.orden as string) ?? '';

  /*
   * El maestro completo son 360 unidades vendibles: cabe entero en memoria y
   * permite buscar por cualquier campo —incluidos los de las tablas
   * relacionadas— sin pelearse con los filtros anidados de PostgREST, que no
   * saben filtrar por «el nombre de la especie de este SKU».
   */
  const [{ data: unidades }, { data: ventas }, { data: especies }, { data: tcParam }] = await Promise.all([
    supabase
      .from('sku_presentaciones')
      .select('id, activo, skus(id, codigo, corte, clasificacion_comercial, empaque, vida_util_meses, activo, especies(nombre), formatos(nombre)), presentaciones(codigo, descripcion, congelamiento, peso_bulto_kg)')
      .order('id')
      .limit(1000),
    /*
     * El último precio al que se VENDIÓ cada producto.
     *
     * No sale de la lista de precios —esa es la tarifa, lo que se pide— sino
     * de las líneas de pedido, que es lo que el cliente aceptó pagar. Se
     * excluyen los borradores y los cancelados: un precio que nunca llegó a
     * cerrarse no es un precio de venta.
     *
     * Son menos de mil líneas en total, así que se traen enteras y el «más
     * reciente por producto» se resuelve aquí. Ordenar por una columna de la
     * tabla relacionada no se puede pedir a PostgREST sin una vista nueva.
     */
    supabase
      .from('pedido_lineas')
      .select('sku_presentacion_id, precio_tm, descuento_pct, pedidos!inner(fecha_solicitada, moneda, tipo_cambio, ciclo)')
      .not('pedidos.ciclo', 'in', '(borrador,cancelado)')
      .limit(5000),
    supabase.from('especies').select('nombre').eq('activo', true).order('nombre'),
    supabase.from('parametros').select('valor').eq('clave', 'tipo_cambio_referencial').maybeSingle(),
  ]);

  /*
   * EL TIPO DE CAMBIO DE RESPALDO
   *
   * Los pedidos en soles guardan `tipo_cambio = 1`, no la cotización del
   * dólar: el campo se llenó como «soles por unidad de la moneda del
   * documento», que para un documento en soles vale uno. Dividir por ese uno
   * dejaría un importe en soles rotulado como dólares —una diferencia de casi
   * cuatro veces—, así que cuando el valor guardado no es una cotización
   * creíble se usa el referencial de Configuración.
   *
   * Es un parche honesto sobre una ambigüedad del modelo: hay que decidir con
   * el cliente qué significa exactamente ese campo y normalizarlo.
   */
  const tcReferencial = Number(tcParam?.valor ?? 3.75) || 3.75;

  /* ---- El último precio de venta de cada unidad vendible, en dólares ---- */
  const ultimaVenta = new Map<number, { precio: number; fecha: string }>();
  for (const l of ventas ?? []) {
    const ped = uno<Record<string, unknown>>(l.pedidos);
    const cuando = String(ped?.fecha_solicitada ?? '');
    if (!cuando) continue;

    const id = Number(l.sku_presentacion_id);
    const previo = ultimaVenta.get(id);
    if (previo && previo.fecha >= cuando) continue;   // las fechas ISO se comparan como texto

    /*
     * Todo se muestra en dólares, que es como lo pidió el cliente. Un pedido
     * en soles se convierte con SU PROPIO tipo de cambio —el que se pactó ese
     * día—, no con el referencial de hoy: si no, el precio histórico cambiaría
     * solo cada vez que se mueve el dólar.
     */
    const bruto = Number(l.precio_tm ?? 0) * (1 - Number(l.descuento_pct ?? 0) / 100);
    let enDolares = bruto;
    if (ped?.moneda === 'PEN') {
      const propio = Number(ped?.tipo_cambio ?? 0);
      // Por debajo de 1,5 no puede ser una cotización del dólar: es el 1 por
      // defecto. En ese caso manda el referencial de Configuración.
      enDolares = bruto / (propio > 1.5 ? propio : tcReferencial);
    }

    ultimaVenta.set(id, { precio: enDolares, fecha: cuando });
  }

  const catalogo = (unidades ?? []).map((u) => {
    const sku = uno<Record<string, unknown>>(u.skus);
    const pres = uno<Record<string, unknown>>(u.presentaciones);
    const venta = ultimaVenta.get(u.id as number);
    return {
      id: u.id as number,
      activo: Boolean(u.activo) && Boolean(sku?.activo),
      codigo: String(sku?.codigo ?? ''),
      especie: campo(sku?.especies, 'nombre', ''),
      formato: campo(sku?.formatos, 'nombre', ''),
      corte: String(sku?.corte ?? ''),
      clasificacion: String(sku?.clasificacion_comercial ?? ''),
      empaque: String(sku?.empaque ?? ''),
      presentacion: String(pres?.descripcion ?? ''),
      presentacionCodigo: String(pres?.codigo ?? ''),
      congelamiento: String(pres?.congelamiento ?? ''),
      pesoBulto: Number(pres?.peso_bulto_kg ?? 0),
      ultimoPrecio: venta?.precio ?? null,
      ultimaVenta: venta?.fecha ?? null,
    };
  });

  /* ---- Los mismos campos que busca el formulario de venta ---- */
  const texto = buscar.toLowerCase();
  const filtrado = catalogo.filter((p) => {
    if (especie && p.especie !== especie) return false;
    if (formato && p.formato !== formato) return false;
    if (corte && p.corte !== corte) return false;
    if (!texto) return true;
    return `${p.codigo} ${p.especie} ${p.formato} ${p.corte} ${p.presentacion} ${p.presentacionCodigo} ${p.congelamiento} ${p.empaque}`
      .toLowerCase()
      .includes(texto);
  });

  /*
   * ORDEN
   * Se pidió poder empezar por el más barato. Los productos que nunca se han
   * vendido no tienen precio, y van SIEMPRE al final: si fueran primeros —que
   * es lo que pasa si se les trata como cero— la lista arrancaría con veinte
   * filas en blanco y el orden no serviría de nada.
   */
  const ordenado = [...filtrado];
  if (orden === 'precio_asc' || orden === 'precio_desc') {
    const signo = orden === 'precio_asc' ? 1 : -1;
    ordenado.sort((a, b) => {
      if (a.ultimoPrecio === null && b.ultimoPrecio === null) return 0;
      if (a.ultimoPrecio === null) return 1;
      if (b.ultimoPrecio === null) return -1;
      return (a.ultimoPrecio - b.ultimoPrecio) * signo;
    });
  } else if (orden === 'reciente') {
    ordenado.sort((a, b) => (b.ultimaVenta ?? '').localeCompare(a.ultimaVenta ?? ''));
  } else {
    ordenado.sort((a, b) => a.codigo.localeCompare(b.codigo, 'es'));
  }

  const pagina1 = (pagina - 1) * POR_PAGINA;
  const visibles = ordenado.slice(pagina1, pagina1 + POR_PAGINA);

  const cortes = new Set(catalogo.map((p) => p.corte)).size;
  const conPrecio = catalogo.filter((p) => p.ultimoPrecio !== null).length;

  /*
   * Los desplegables se encadenan: al elegir una especie, «Formato» solo
   * ofrece los formatos que esa especie tiene, y «Corte» solo los cortes que
   * quedan. Son 126 cortes en el maestro; sin encadenar, esa lista es
   * inservible.
   */
  const opcionesFormato = [...new Set(
    catalogo.filter((p) => !especie || p.especie === especie).map((p) => p.formato)
  )].filter(Boolean).sort((a, b) => a.localeCompare(b, 'es'));

  const opcionesCorte = [...new Set(
    catalogo
      .filter((p) => (!especie || p.especie === especie) && (!formato || p.formato === formato))
      .map((p) => p.corte)
  )].filter(Boolean).sort((a, b) => a.localeCompare(b, 'es'));

  return (
    <>
      <CabeceraPagina
        titulo="Productos"
        descripcion="El maestro de lo que se puede vender: cada fila es un corte en una presentación concreta. Aparecen también los que ahora mismo no tienen stock, porque se pueden cotizar igual."
      >
        {puedeEditar && (
          <Link href="/ventas/productos/nuevo" className="btn btn-primario">
            <Icono nombre="mas" tamano={15} />
            Nuevo producto
          </Link>
        )}
        <Link href="/ventas/disponibilidad" className="btn btn-secundario">
          <Icono nombre="disponibilidad" tamano={15} />
          Ver solo lo disponible
        </Link>
        <Link href="/ventas/cotizaciones/nueva" className="btn btn-primario">
          <Icono nombre="cotizacion" tamano={15} />
          Cotizar
        </Link>
      </CabeceraPagina>

      {/*
        Los dos indicadores de stock que había aquí se fueron a Existencias.
        En su lugar van dos que sí pertenecen a un maestro: cuántos productos
        tienen precio de venta conocido y cuántas especies se manejan.
      */}
      <RejillaKpi>
        <Kpi etiqueta="Unidades vendibles" valor={num(catalogo.length)} nota="SKU × presentación" />
        <Kpi etiqueta="Cortes distintos" valor={num(cortes)} />
        <Kpi etiqueta="Especies" valor={num((especies ?? []).length)} />
        <Kpi
          etiqueta="Con precio de venta"
          valor={num(conPrecio)}
          tono={conPrecio > 0 ? 'ok' : 'atencion'}
          nota={`${num(catalogo.length - conPrecio)} nunca se han vendido`}
        />
      </RejillaKpi>

      <Panel titulo={`${num(filtrado.length)} productos`}>
        <Filtros
          campos={[
            /* La etiqueta va corta a propósito: con el texto largo se salía
               de su columna y se montaba encima del filtro de Especie. */
            { tipo: 'texto', clave: 'buscar', etiqueta: 'SKU o corte', ancho: '14rem' },
            {
              tipo: 'select', clave: 'especie', etiqueta: 'Especie',
              opciones: (especies ?? []).map((e) => ({ valor: e.nombre as string, texto: e.nombre as string })),
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
              tipo: 'select', clave: 'orden', etiqueta: 'Ordenar por',
              opciones: [
                { valor: 'precio_asc', texto: 'Precio: del más barato' },
                { valor: 'precio_desc', texto: 'Precio: del más caro' },
                { valor: 'reciente', texto: 'Vendido más recientemente' },
              ],
            },
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
                    {/* El SKU va primero y en monoespaciado: es el código con
                        el que la empresa identifica el producto en sus otros
                        sistemas, así que es la columna por la que se busca. */}
                    <th>SKU</th>
                    <th>Especie</th>
                    <th>Formato</th>
                    <th>Corte</th>
                    <th>Presentación</th>
                    <th>Empaque</th>
                    <th>Congelamiento</th>
                    <th className="num">Bulto</th>
                    <th className="num">Último precio</th>
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
                        {/*
                          Se quitó la columna «Estado», pero un producto
                          descatalogado hay que poder distinguirlo o se
                          cotizará por error. Se marca aquí mismo, pegado al
                          código, que es donde se está mirando.
                        */}
                        {!p.activo && (
                          <> <Etiqueta texto="Descatalogado" tono="neutro" /></>
                        )}
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
                      <td style={{ fontSize: '.78rem' }}>
                        {p.empaque ? NOMBRE_EMPAQUE[p.empaque] ?? p.empaque : '—'}
                      </td>
                      <td style={{ fontSize: '.78rem' }}>{p.congelamiento || '—'}</td>
                      <td className="num">{num(p.pesoBulto, 1)} kg</td>
                      <td className="num">
                        {/*
                          El último precio al que se cerró una venta, siempre
                          en dólares. Debajo, cuándo fue: un precio de hace dos
                          años no vale lo mismo que uno del mes pasado, y sin
                          la fecha nadie puede saberlo.
                        */}
                        {p.ultimoPrecio === null ? (
                          <span style={{ color: 'var(--tinta-3)' }}>—</span>
                        ) : (
                          <>
                            <strong>{dinero(p.ultimoPrecio, 'USD', 2)}</strong>
                            <br />
                            <span style={{ color: 'var(--tinta-3)', fontSize: '.68rem' }}>
                              /TM · {fecha(p.ultimaVenta)}
                            </span>
                          </>
                        )}
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
            <Paginacion pagina={pagina} porPagina={POR_PAGINA} total={ordenado.length} />
          </>
        )}
      </Panel>

      <p className="pie-explicativo">
        El <strong>último precio</strong> es el de la venta más reciente que se cerró de ese
        producto, convertido a dólares con el tipo de cambio de ese mismo pedido. No es la tarifa
        de la lista de precios: es lo que un cliente aceptó pagar. Los borradores y los pedidos
        cancelados no cuentan.
        <br /><br />
        El <strong>stock</strong> ya no se muestra aquí: se consulta en{' '}
        <Link href="/almacenes/existencias">Existencias</Link> y en{' '}
        <Link href="/ventas/disponibilidad">Disponibilidad</Link>, que es donde está completo y por
        bodega.
        <br /><br />
        Un producto <strong>descatalogado</strong> no desaparece: se deja de poder cotizar, pero
        sigue apareciendo en el Kardex, en los pedidos antiguos y en la trazabilidad. Borrarlo
        dejaría sin explicación todo lo que se vendió de él.
      </p>
    </>
  );
}
