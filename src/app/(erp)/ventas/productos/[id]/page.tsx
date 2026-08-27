/**
 * ============================================================================
 *  FICHA DEL PRODUCTO
 * ============================================================================
 *  Un producto no es solo un nombre en un catálogo. Antes de ofrecerlo hay que
 *  saber cuatro cosas, y hasta ahora estaban en cuatro pantallas distintas:
 *
 *    ¿QUÉ ES?          especie, formato, corte, presentación, vida útil
 *    ¿CUÁNTO HAY?      físico y disponible, almacén por almacén
 *    ¿A CUÁNTO SE VA?  precios por lista y por escala de volumen
 *    ¿SE VENDE?        a quién se le ha vendido y cuánto, últimamente
 *
 *  Es la pantalla que contesta «¿puedo prometerle 20 TM de anillas a este
 *  cliente y a qué precio?» sin abrir otra cosa.
 * ============================================================================
 */
import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel, Vacio, Etiqueta, RejillaKpi, Kpi } from '@/components/ui/Pagina';
import { EsqueletoKpi, EsqueletoTabla, EsqueletoFicha } from '@/components/ui/Esqueleto';
import { Icono } from '@/components/estructura/Icono';
import { fecha, num, dinero, tm } from '@/lib/formato';
import { veCostos, type Rol } from '@/lib/navegacion';
import { uno, campo } from '@/lib/relaciones';

export const dynamic = 'force-dynamic';

export async function generateMetadata(
  props: PageProps<'/ventas/productos/[id]'>
): Promise<Metadata> {
  const { id } = await props.params;
  const supabase = await crearClienteServidor();
  const { data } = await supabase
    .from('sku_presentaciones').select('skus(codigo)').eq('id', Number(id)).single();
  return { title: campo(data?.skus, 'codigo', 'Producto') };
}

export default async function FichaProducto(props: PageProps<'/ventas/productos/[id]'>) {
  const { id } = await props.params;
  const unidadId = Number(id);

  const supabase = await crearClienteServidor();
  const { data: u } = await supabase
    .from('sku_presentaciones')
    .select('id, activo, skus(id, codigo, corte, clasificacion_comercial, empaque, vida_util_meses, activo, especies(nombre), formatos(nombre)), presentaciones(codigo, descripcion, congelamiento, peso_bulto_kg)')
    .eq('id', unidadId)
    .single();

  if (!u) notFound();

  const sku = uno<Record<string, unknown>>(u.skus);
  const pres = uno<Record<string, unknown>>(u.presentaciones);

  return (
    <>
      <CabeceraPagina
        titulo={`${campo(sku, 'codigo')} · ${campo(pres, 'descripcion')}`}
        descripcion={`${campo(sku?.especies, 'nombre')} · ${campo(sku?.formatos, 'nombre')} · ${campo(sku, 'corte')}`}
        volver={{ href: '/ventas/productos', texto: 'Volver a productos' }}
      >
        {u.activo && sku?.activo ? (
          <Etiqueta texto="Vendible" tono="ok" />
        ) : (
          <Etiqueta texto="Descatalogado" tono="neutro" />
        )}
        <Link href="/ventas/cotizaciones/nueva" className="btn btn-primario">
          <Icono nombre="cotizacion" tamano={15} />
          Cotizar
        </Link>
      </CabeceraPagina>

      <Suspense fallback={<CargandoCuerpo />}>
        <CuerpoProducto unidadId={unidadId} sku={sku} pres={pres} />
      </Suspense>
    </>
  );
}

function CargandoCuerpo() {
  return (
    <>
      <EsqueletoKpi cantidad={4} />
      <div className="rejilla-2">
        <EsqueletoFicha lineas={8} />
        <EsqueletoTabla filas={4} columnas={4} conFiltros={false} />
      </div>
      <EsqueletoTabla filas={5} columnas={6} conFiltros={false} />
      <span className="sr-solo" role="status">Cargando el producto…</span>
    </>
  );
}

/** Existencias, precios y ventas recientes de esta unidad vendible. */
async function CuerpoProducto({
  unidadId,
  sku,
  pres,
}: {
  unidadId: number;
  sku: Record<string, unknown> | undefined;
  pres: Record<string, unknown> | undefined;
}) {
  const supabase = await crearClienteServidor();
  const usuario = await obtenerUsuarioActual();
  const puedeVerImportes = veCostos((usuario?.rol ?? 'consulta') as Rol);

  const [{ data: stock }, { data: precios }, { data: lotes }, { data: ventas }] = await Promise.all([
    supabase
      .from('v_disponibilidad')
      .select('almacen, almacen_tipo, fisico_kg, disponible_kg, reservado_kg, bloqueado_kg, lotes')
      .eq('sku_presentacion_id', unidadId),
    supabase
      .from('precios')
      .select('id, tm_desde, tm_hasta, precio_tm, activo, listas_precio(nombre, moneda, incoterm, activo), clientes(razon_social)')
      .eq('sku_presentacion_id', unidadId)
      .order('tm_desde'),
    supabase
      .from('lotes')
      .select('id, codigo_pallet, fecha_produccion, campania, existencias(peso_neto_kg, almacenes(nombre))')
      .eq('sku_presentacion_id', unidadId)
      .order('fecha_produccion', { ascending: false })
      .limit(15),
    supabase
      .from('pedido_lineas')
      .select('id, cantidad_tm, precio_tm, descuento_pct, pedidos(id, numero_proforma, ciclo, moneda, fecha_comprometida, clientes(id, razon_social))')
      .eq('sku_presentacion_id', unidadId)
      .order('id', { ascending: false })
      .limit(15),
  ]);

  const fisico = (stock ?? []).reduce((s, x) => s + Number(x.fisico_kg ?? 0), 0);
  const disponible = (stock ?? []).reduce((s, x) => s + Number(x.disponible_kg ?? 0), 0);
  const reservado = (stock ?? []).reduce((s, x) => s + Number(x.reservado_kg ?? 0), 0);
  const vendidasTm = (ventas ?? []).reduce((s, v) => s + Number(v.cantidad_tm ?? 0), 0);

  const pesoBulto = Number(pres?.peso_bulto_kg ?? 0);
  const bultosDisponibles = pesoBulto > 0 ? Math.floor(disponible / pesoBulto) : 0;

  return (
    <>
      {disponible <= 0 && fisico > 0 && (
        <div className="ficha-aviso ficha-aviso-atencion">
          <Icono nombre="reservas" tamano={17} />
          <span>
            <strong>Hay {tm(fisico)} en cámara pero nada disponible:</strong> está todo apartado o
            bloqueado por calidad. Antes de decirle «no hay» a un cliente, revise{' '}
            <Link href="/almacenes/reservas">las reservas</Link>: puede que alguna ya no
            corresponda.
          </span>
        </div>
      )}

      <RejillaKpi>
        <Kpi etiqueta="Físico en cámara" valor={tm(fisico)} nota={`${(stock ?? []).length} almacenes`} />
        <Kpi etiqueta="Apartado" valor={tm(reservado)} tono={reservado > 0 ? 'atencion' : 'neutro'} />
        <Kpi
          etiqueta="Disponible"
          valor={tm(disponible)}
          tono={disponible > 0 ? 'ok' : 'critico'}
          nota={pesoBulto > 0 ? `≈ ${num(bultosDisponibles)} bultos` : undefined}
        />
        <Kpi etiqueta="Vendido reciente" valor={num(vendidasTm, 1)} sufijo="TM" nota={`${(ventas ?? []).length} líneas`} />
      </RejillaKpi>

      <div className="rejilla-2 mb-espacio">
        <Panel titulo="Qué es este producto">
          <dl className="ficha">
            <div><dt>Código SKU</dt><dd className="mono">{campo(sku, 'codigo')}</dd></div>
            <div><dt>Especie</dt><dd>{campo(sku?.especies, 'nombre')}</dd></div>
            <div><dt>Formato</dt><dd>{campo(sku?.formatos, 'nombre')}</dd></div>
            <div><dt>Corte</dt><dd>{campo(sku, 'corte')}</dd></div>
            <div><dt>Presentación</dt><dd>{campo(pres, 'descripcion')} · <span className="mono">{campo(pres, 'codigo')}</span></dd></div>
            <div><dt>Congelamiento</dt><dd>{campo(pres, 'congelamiento')}</dd></div>
            <div><dt>Peso por bulto</dt><dd>{num(pesoBulto, 2)} kg</dd></div>
            <div><dt>Clasificación</dt><dd>{campo(sku, 'clasificacion_comercial', '—')}</dd></div>
            <div><dt>Empaque</dt><dd>{campo(sku, 'empaque', '—')}</dd></div>
            <div>
              <dt>Vida útil</dt>
              <dd>
                {sku?.vida_util_meses ? `${num(Number(sku.vida_util_meses))} meses` : 'No definida'}
              </dd>
            </div>
          </dl>
        </Panel>

        <Panel titulo={`Existencias por almacén · ${(stock ?? []).length}`}>
          {(stock ?? []).length === 0 ? (
            <Vacio
              titulo="Sin existencias"
              mensaje="Este producto no tiene stock en ninguna cámara. Se puede cotizar, pero habrá que producirlo."
            />
          ) : (
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos">
                <thead>
                  <tr>
                    <th>Almacén</th><th className="num">Físico</th>
                    <th className="num">Apartado</th><th className="num">Disponible</th>
                    <th className="num">Lotes</th>
                  </tr>
                </thead>
                <tbody>
                  {(stock ?? []).map((s, i) => (
                    <tr key={i}>
                      <td>
                        {s.almacen as string}
                        <br />
                        <span style={{ fontSize: '.7rem', color: 'var(--tinta-3)' }}>
                          {s.almacen_tipo as string}
                        </span>
                      </td>
                      <td className="num">{tm(Number(s.fisico_kg))}</td>
                      <td className="num">{Number(s.reservado_kg) > 0 ? tm(Number(s.reservado_kg)) : '—'}</td>
                      <td className="num">
                        <strong style={{ color: Number(s.disponible_kg) > 0 ? 'var(--ok)' : 'var(--tinta-3)' }}>
                          {tm(Number(s.disponible_kg))}
                        </strong>
                      </td>
                      <td className="num">{num(s.lotes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {/* ---- Precios ---- */}
      {puedeVerImportes && (
        <Panel titulo={`Precios vigentes · ${(precios ?? []).length}`} className="mb-espacio">
          {(precios ?? []).length === 0 ? (
            <Vacio
              titulo="Sin precio de lista"
              mensaje="No hay precio cargado para este producto. Al cotizarlo habrá que ponerlo a mano, y no quedará escala por volumen."
            />
          ) : (
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos">
                <thead>
                  <tr>
                    <th>Lista</th><th>Incoterm</th><th>Cliente</th>
                    <th className="num">Desde</th><th className="num">Hasta</th>
                    <th className="num">Precio / TM</th><th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {(precios ?? []).map((p) => {
                    const lista = uno<Record<string, unknown>>(p.listas_precio);
                    return (
                      <tr key={p.id as number}>
                        <td>{String(lista?.nombre ?? '—')}</td>
                        <td className="mono">{String(lista?.incoterm ?? '—')}</td>
                        <td style={{ fontSize: '.78rem' }}>
                          {campo(p.clientes, 'razon_social', 'Todos')}
                        </td>
                        <td className="num">{num(p.tm_desde, 1)} TM</td>
                        <td className="num">{p.tm_hasta ? `${num(p.tm_hasta, 1)} TM` : 'sin tope'}</td>
                        <td className="num">
                          <strong>{dinero(Number(p.precio_tm), String(lista?.moneda ?? 'USD') as 'USD' | 'PEN', 2)}</strong>
                        </td>
                        <td>
                          {p.activo && lista?.activo
                            ? <Etiqueta texto="Vigente" tono="ok" />
                            : <Etiqueta texto="Inactivo" tono="neutro" />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="pie-explicativo" style={{ margin: '0', padding: '.6rem 1rem 0' }}>
            El precio que se aplica al cotizar sale de aquí: se busca la escala que corresponde al
            volumen pedido y, si el cliente tiene precio propio, ese manda sobre el de lista.
          </p>
        </Panel>
      )}

      {/* ---- Lotes ---- */}
      <Panel titulo={`Lotes producidos · ${(lotes ?? []).length} más recientes`} className="mb-espacio">
        {(lotes ?? []).length === 0 ? (
          <Vacio titulo="Sin lotes" mensaje="Nunca se ha producido este producto." />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos">
              <thead>
                <tr>
                  <th>Pallet</th><th className="num">Producción</th><th className="num">Campaña</th>
                  <th>Dónde está</th><th className="num">Peso</th><th></th>
                </tr>
              </thead>
              <tbody>
                {(lotes ?? []).map((l) => {
                  const ex = (l.existencias ?? []) as { peso_neto_kg: number; almacenes: unknown }[];
                  const peso = ex.reduce((s, e) => s + Number(e.peso_neto_kg ?? 0), 0);
                  return (
                    <tr key={l.id as number}>
                      <td className="mono">
                        <Link href={`/almacenes/lotes/${l.id}`} className="enlace-ficha">
                          {l.codigo_pallet as string}
                        </Link>
                      </td>
                      <td className="num" style={{ fontSize: '.76rem' }}>{fecha(l.fecha_produccion as string)}</td>
                      <td className="num">{l.campania as number}</td>
                      <td style={{ fontSize: '.78rem' }}>
                        {ex.length === 0
                          ? <span style={{ color: 'var(--tinta-3)' }}>Ya salió</span>
                          : ex.map((e, i) => (
                              <span key={i}>{i > 0 ? ', ' : ''}{campo(e.almacenes, 'nombre')}</span>
                            ))}
                      </td>
                      <td className="num">{peso > 0 ? tm(peso) : '—'}</td>
                      <td>
                        <Link href={`/almacenes/lotes/${l.id}`} className="accion-btn" title="Ver el lote">
                          <Icono nombre="ver" tamano={15} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* ---- A quién se le vende ---- */}
      <Panel titulo={`Ventas recientes · ${(ventas ?? []).length} líneas`}>
        {(ventas ?? []).length === 0 ? (
          <Vacio titulo="Sin ventas" mensaje="Este producto nunca se ha incluido en un pedido." />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos">
              <thead>
                <tr>
                  <th>Proforma</th><th>Cliente</th><th className="num">Cantidad</th>
                  {puedeVerImportes && <th className="num">Precio</th>}
                  <th className="num">Compromiso</th><th></th>
                </tr>
              </thead>
              <tbody>
                {(ventas ?? []).map((v) => {
                  const ped = uno<Record<string, unknown>>(v.pedidos);
                  const cli = uno<Record<string, unknown>>(ped?.clientes);
                  return (
                    <tr key={v.id as number}>
                      <td className="mono">
                        {ped?.id ? (
                          <Link href={`/ventas/pedidos/${ped.id}`} className="enlace-ficha">
                            {String(ped.numero_proforma)}
                          </Link>
                        ) : '—'}
                      </td>
                      <td>
                        {cli?.id ? (
                          <Link href={`/ventas/clientes/${cli.id}`} className="enlace-ficha">
                            {String(cli.razon_social)}
                          </Link>
                        ) : '—'}
                      </td>
                      <td className="num">{num(v.cantidad_tm, 3)} TM</td>
                      {puedeVerImportes && (
                        <td className="num">
                          {dinero(Number(v.precio_tm), String(ped?.moneda ?? 'USD') as 'USD' | 'PEN', 2)}
                          {Number(v.descuento_pct) > 0 && (
                            <span style={{ color: 'var(--atencion)', fontSize: '.72rem' }}>
                              {' '}−{num(v.descuento_pct, 1)}%
                            </span>
                          )}
                        </td>
                      )}
                      <td className="num" style={{ fontSize: '.76rem' }}>
                        {ped?.fecha_comprometida ? fecha(String(ped.fecha_comprometida)) : '—'}
                      </td>
                      <td>
                        {ped?.id ? (
                          <Link href={`/ventas/pedidos/${ped.id}`} className="accion-btn" title="Ver el pedido">
                            <Icono nombre="ver" tamano={15} />
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
