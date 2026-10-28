/**
 * ============================================================================
 *  RESERVAS · el stock que está apartado y por qué
 * ============================================================================
 *  Esta pantalla existe por una frase concreta de la reunión: «el producto
 *  está físicamente, pero figura asignado a un cliente que nunca lo llevó».
 *
 *  Antes ese apartado vivía en la cabeza de alguien o en un Excel paralelo.
 *  Aquí se ve entero: qué lote, para qué pedido, de qué cliente, desde cuándo
 *  y hasta cuándo. Y se puede soltar en un clic, dejando dicho por qué.
 *
 *  La lista arranca filtrada por reservas ACTIVAS, que son las que retienen
 *  stock. Las liberadas y expiradas se consultan cambiando el filtro: no se
 *  borran nunca, porque son la prueba de qué pasó con cada tonelada.
 *
 *  «TODOS LOS ESTADOS» TIENE SU PROPIO VALOR
 *  Antes la opción vacía del desplegable decía «Todos» pero, como vacío
 *  significa «lo de siempre», seguía enseñando solo las activas. Ahora la
 *  opción vacía se llama «Activa» —que es lo que muestra— y «Todos los
 *  estados» manda estado=todos, que no filtra.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { Filtros, Paginacion } from '@/components/ui/Filtros';
import { BotonLiberar, BotonExpirar } from './Liberar';
import { Icono } from '@/components/estructura/Icono';
import { fecha, num, tm, etiquetaEstado, diasDesdeHoy } from '@/lib/formato';
import { traerTodo } from '@/lib/traerTodo';
import { rolPuedeVerRuta, type Rol } from '@/lib/navegacion';
import { motivoNoLiberar, ROLES_LIBERAN_CUALQUIER_RESERVA } from '@/lib/permisosVentas';
import { uno, campo } from '@/lib/relaciones';
import { hoyEnLima, desplazarDias } from '@/lib/fechas';

export const metadata: Metadata = { title: 'Reservas' };
export const dynamic = 'force-dynamic';

const POR_PAGINA = 40;

const TONO: Record<string, 'ok' | 'atencion' | 'critico' | 'info' | 'neutro'> = {
  solicitada: 'neutro',
  activa: 'info',
  en_preparacion: 'atencion',
  consumida: 'ok',
  liberada: 'neutro',
  expirada: 'critico',
};

export default async function PaginaReservas(props: PageProps<'/almacenes/reservas'>) {
  const q = await props.searchParams;
  const supabase = await crearClienteServidor();
  const usuario = await obtenerUsuarioActual();
  const rol = (usuario?.rol ?? 'consulta') as Rol;
  /* Enlaces a Clientes y a Configuración solo para quien tiene esas pantallas. */
  const veClientes = rolPuedeVerRuta(rol, '/ventas/clientes');
  const veConfiguracion = rolPuedeVerRuta(rol, '/configuracion');

  /*
   * Liberar se decide FILA POR FILA (076): quien la apartó puede soltarla;
   * una ajena, solo Gerencia u Operaciones (es lo que exige la base). Antes
   * Comercial y Almacén veían el botón encendido en reservas de otros y la
   * base respondía con su mensaje crudo.
   */
  const bloqueoLiberar = (creadoPor: string | null) => motivoNoLiberar(rol, usuario?.id, creadoPor);
  const puedeExpirar = ROLES_LIBERAN_CUALQUIER_RESERVA.includes(rol);

  const pagina = Math.max(1, Number(q.pagina ?? 1));
  // Por defecto se muestran las activas: son las que hoy están reteniendo kilos.
  /* Lo que vino en la dirección (para conservarlo en los enlaces) y lo que
     se filtra de verdad: sin nada, las activas; «todos», sin filtro. */
  const estadoParam = (q.estado as string) ?? '';
  const estado = estadoParam === 'todos' ? '' : estadoParam || 'activa';
  const idBuscado = q.id ? Number(q.id) : null;
  const buscar = ((q.buscar as string) ?? '').trim();
  const almacen = (q.almacen as string) ?? '';
  const desde = (q.desde as string) ?? '';
  const hasta = (q.hasta as string) ?? '';
  /*
   * El rango puede mirar dos cosas distintas y no dan lo mismo: «qué se apartó
   * esta semana» es la fecha de creación; «qué se me vence esta semana» es la
   * de vencimiento, que es la pregunta que de verdad importa aquí.
   */
  const campoFecha = (q.campo_fecha as string) === 'creado_en' ? 'creado_en' : 'vence_el';

  let consulta = supabase
    .from('reservas')
    // La cadena del select va entera en un literal, sin concatenar: Supabase
    // deduce los tipos de la consulta leyendo ese texto en tiempo de
    // compilación, y una suma de cadenas le impide hacerlo.
    .select(
      'id, bultos, peso_neto_kg, estado, vence_el, creado_en, creado_por, liberado_en, motivo_liberacion, sku_solicitado_id, sku_reservado_id, solicitado:sku_presentaciones!reservas_sku_solicitado_id_fkey(skus(codigo)), lotes(id, codigo_pallet, fecha_produccion, sku_presentaciones(skus(codigo, corte, especies(nombre)))), almacenes(nombre), pedido_lineas(pedido_id, pedidos(numero_proforma, ciclo, clientes(id, razon_social)))',
      { count: 'exact' }
    );

  // Si se llega desde una alerta, se enfoca esa reserva concreta sin filtros.
  if (idBuscado) {
    consulta = consulta.eq('id', idBuscado);
  } else {
    // «cerradas» = liberadas + expiradas: es lo que cuenta la tarjeta «Liberadas históricas».
    if (estado === 'cerradas') consulta = consulta.in('estado', ['liberada', 'expirada']);
    else if (estado) consulta = consulta.eq('estado', estado);
    if (almacen) consulta = consulta.eq('almacen_id', Number(almacen));
    if (desde) consulta = consulta.gte(campoFecha, desde);
    // «Hasta el 27» tiene que incluir el 27 entero: la columna lleva hora.
    if (hasta) consulta = consulta.lte(campoFecha, `${hasta}T23:59:59.999`);
    if (buscar) {
      const limpio = buscar.replace(/[%,()]/g, ' ');
      consulta = consulta.or(
        `lotes.codigo_pallet.ilike.%${limpio}%,` +
        `pedido_lineas.pedidos.numero_proforma.ilike.%${limpio}%,` +
        `pedido_lineas.pedidos.clientes.razon_social.ilike.%${limpio}%`
      );
    }
  }

  const [{ data: filas, count }, todas, { data: yaVencidas }] = await Promise.all([
    consulta
      .order('creado_en', { ascending: false })
      .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1),
    /*
     * Por páginas: hay 1 195 reservas y la API devuelve mil como mucho, sin
     * avisar de que cortó. Las tarjetas de arriba contaban de menos.
     */
    traerTodo<{ estado: string; peso_neto_kg: number }>(
      (d, h) => supabase.from('reservas').select('estado, peso_neto_kg').range(d, h)
    ),
    /*
     * Quién está vencida lo decide la BASE DE DATOS, con su propio reloj.
     *
     * Es deliberado y no una manía: la función reservas_expirar_vencidas()
     * usa el now() de PostgreSQL, así que si aquí comparásemos contra el
     * reloj del servidor web, el botón podría decir «3 vencidas» y la
     * expiración liberar 2. Un desfase de segundos entre dos máquinas basta
     * para que la cuenta que ve el usuario no cuadre con lo que ocurre.
     */
    supabase
      .from('reservas')
      .select('peso_neto_kg')
      .eq('estado', 'activa')
      .lt('vence_el', 'now()'),
  ]);

  const { data: almacenes } = await supabase
    .from('almacenes').select('id, nombre').eq('activo', true).order('nombre');

  /* Fechas para los atajos, en el huso de la operación. */
  const hoy = hoyEnLima();
  const ayer = desplazarDias(hoy, -1);
  const enTresDias = desplazarDias(hoy, 3);
  const enUnaSemana = desplazarDias(hoy, 7);

  /** Arma la dirección conservando lo que ya está puesto. */
  function conFiltros(cambios: Record<string, string>) {
    const p = new URLSearchParams();
    if (estadoParam) p.set('estado', estadoParam);
    if (almacen) p.set('almacen', almacen);
    if (buscar) p.set('buscar', buscar);
    if (campoFecha !== 'vence_el') p.set('campo_fecha', campoFecha);
    if (desde) p.set('desde', desde);
    if (hasta) p.set('hasta', hasta);
    for (const [k, v] of Object.entries(cambios)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    const t = p.toString();
    return `/almacenes/reservas${t ? '?' + t : ''}`;
  }

  const universo = todas ?? [];
  const activas = universo.filter((r) => r.estado === 'activa');
  const kgActivos = activas.reduce((s, r) => s + Number(r.peso_neto_kg ?? 0), 0);

  const vencidas = yaVencidas ?? [];
  const kgVencidos = vencidas.reduce((s, r) => s + Number(r.peso_neto_kg ?? 0), 0);

  return (
    <>
      <CabeceraPagina
        titulo="Reservas de stock"
        descripcion="Todo lo que está apartado ahora mismo: qué lote, para qué pedido y de qué cliente. Si una reserva ya no corresponde, se libera desde aquí y el producto vuelve a estar disponible al instante."
      >
        <BotonExpirar vencidas={vencidas.length} puede={puedeExpirar} />
      </CabeceraPagina>

      {vencidas.length > 0 && (
        <div className="ficha-aviso ficha-aviso-atencion">
          <Icono nombre="reloj" tamano={17} />
          <span>
            <strong>
              Hay {vencidas.length} reservas cuyo plazo ya venció, reteniendo {tm(kgVencidos)}.
            </strong>{' '}
            Ese producto está físicamente en cámara y figura como no disponible. Es exactamente el
            caso que hoy hace que se le diga «no hay» a un cliente teniendo mercadería. Puede
            soltarlas de golpe con el botón de arriba, o revisarlas una a una.
          </span>
        </div>
      )}

      <RejillaKpi>
        <Kpi etiqueta="Reservas activas" valor={num(activas.length)} tono="marca" href="/almacenes/reservas?estado=activa#lista" />
        <Kpi etiqueta="Stock apartado" valor={tm(kgActivos)} nota="No figura como disponible" href="/almacenes/reservas?estado=activa#lista" />
        <Kpi
          etiqueta="Con plazo vencido"
          valor={num(vencidas.length)}
          tono={vencidas.length > 0 ? 'critico' : 'ok'}
          nota={tm(kgVencidos) + ' recuperables'}
          href="/almacenes/reservas?estado=activa"
        />
        <Kpi
          etiqueta="Liberadas históricas"
          valor={num(universo.filter((r) => ['liberada', 'expirada'].includes(r.estado as string)).length)}
          nota="Conservan su motivo"
          href="/almacenes/reservas?estado=cerradas#lista"
        />
      </RejillaKpi>

      <Panel id="lista" titulo={idBuscado ? `Reserva #${idBuscado}` : `${num(count ?? 0)} reserva${count === 1 ? '' : 's'}`}>
        {idBuscado ? (
          <div style={{ padding: '.6rem 1rem' }}>
            <Link href="/almacenes/reservas" className="btn btn-sutil">
              <Icono nombre="volver" tamano={14} />
              Ver todas las reservas
            </Link>
          </div>
        ) : (
          <>
            <Filtros
              campos={[
                {
                  tipo: 'select',
                  clave: 'estado',
                  etiqueta: 'Estado',
                  // La vacía es «Activa» (lo que se ve al entrar); «Todos los estados» no filtra.
                  textoTodos: 'Activa',
                  opciones: [
                    { valor: 'todos', texto: 'Todos los estados' },
                    { valor: 'cerradas', texto: 'Liberadas y expiradas' },
                    ...Object.keys(TONO)
                      .filter((e) => e !== 'activa')
                      .map((e) => ({ valor: e, texto: etiquetaEstado(e) })),
                  ],
                },
                {
                  tipo: 'select',
                  clave: 'almacen',
                  etiqueta: 'Almacén',
                  opciones: (almacenes ?? []).map((a) => ({
                    valor: String(a.id), texto: a.nombre as string,
                  })),
                },
                {
                  tipo: 'select',
                  clave: 'campo_fecha',
                  etiqueta: 'Filtrar por',
                  opciones: [
                    { valor: 'vence_el', texto: 'Fecha de vencimiento' },
                    { valor: 'creado_en', texto: 'Fecha en que se apartó' },
                  ],
                },
                { tipo: 'fecha', clave: 'desde', etiqueta: 'Desde' },
                { tipo: 'fecha', clave: 'hasta', etiqueta: 'Hasta' },
                { tipo: 'texto', clave: 'buscar', etiqueta: 'Pallet, proforma o cliente', ancho: '16rem' },
              ]}
            />

            {/* Los rangos que se consultan a diario, a un clic */}
            <div className="atajos-fecha">
              <span>Rápido:</span>
              <Link href={conFiltros({ estado: 'activa', campo_fecha: 'vence_el', desde: '', hasta: ayer })}>
                Ya vencidas
              </Link>
              <Link href={conFiltros({ estado: 'activa', campo_fecha: 'vence_el', desde: hoy, hasta: enTresDias })}>
                Vencen en 3 días
              </Link>
              <Link href={conFiltros({ estado: 'activa', campo_fecha: 'vence_el', desde: hoy, hasta: enUnaSemana })}>
                Vencen esta semana
              </Link>
              <Link href={conFiltros({ campo_fecha: 'creado_en', desde: hoy, hasta: hoy })}>
                Apartadas hoy
              </Link>
              {(desde || hasta || almacen || buscar) && (
                <Link href={conFiltros({ desde: '', hasta: '', almacen: '', buscar: '', campo_fecha: '' })}
                      className="atajo-limpiar">
                  Quitar filtros
                </Link>
              )}
            </div>
          </>
        )}

        {(filas ?? []).length === 0 ? (
          <Vacio
            titulo="Sin reservas"
            mensaje="No hay reservas con estos filtros. Si buscaba una que ya se liberó, cambie el filtro de estado."
          />
        ) : (
          <>
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos">
                <thead>
                  <tr>
                    <th>Lote</th>
                    <th>Producto</th>
                    <th>Almacén</th>
                    <th>Pedido</th>
                    <th>Cliente</th>
                    <th className="num">Bultos</th>
                    <th className="num">Peso</th>
                    <th className="num">Desde</th>
                    <th className="num">Vence</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {(filas ?? []).map((r) => {
                    const lote = uno<Record<string, unknown>>(r.lotes);
                    const sp = uno<Record<string, unknown>>(lote?.sku_presentaciones);
                    const sku = uno<Record<string, unknown>>(sp?.skus);
                    const pl = uno<Record<string, unknown>>(r.pedido_lineas);
                    const ped = uno<Record<string, unknown>>(pl?.pedidos);
                    const cli = uno<Record<string, unknown>>(ped?.clientes);
                    const dias = r.vence_el ? diasDesdeHoy(r.vence_el as string) : null;
                    const activa = r.estado === 'activa' || r.estado === 'en_preparacion';

                    return (
                      <tr key={r.id as number}>
                        <td className="mono">
                          {lote?.id ? (
                            <Link href={`/almacenes/lotes/${lote.id}`} className="enlace-ficha">
                              {String(lote.codigo_pallet)}
                            </Link>
                          ) : '—'}
                        </td>
                        <td style={{ fontSize: '.78rem' }}>
                          {campo(sku?.especies, 'nombre')} · {campo(sku, 'corte')}
                          {/* SKU equivalente (octubre, punto 10): qué se pidió y qué se apartó. */}
                          {r.sku_solicitado_id !== r.sku_reservado_id && (
                            <>
                              <br />
                              <span className="pill pill-atencion">Equivalente</span>{' '}
                              <span style={{ fontSize: '.7rem', color: 'var(--tinta-3)' }}>
                                apartado {campo(sku, 'codigo')} · se pidió {campo(uno<Record<string, unknown>>(r.solicitado)?.skus, 'codigo')}
                              </span>
                            </>
                          )}
                        </td>
                        <td style={{ fontSize: '.78rem' }}>{campo(r.almacenes, 'nombre')}</td>
                        <td className="mono">
                          {pl?.pedido_id ? (
                            <Link href={`/ventas/pedidos/${pl.pedido_id}`} className="enlace-ficha">
                              {String(ped?.numero_proforma ?? '—')}
                            </Link>
                          ) : '—'}
                        </td>
                        <td>
                          {cli?.id && veClientes ? (
                            <Link href={`/ventas/clientes/${cli.id}`} className="enlace-ficha">
                              {String(cli.razon_social)}
                            </Link>
                          ) : cli?.id ? String(cli.razon_social) : '—'}
                        </td>
                        <td className="num">{num(r.bultos)}</td>
                        <td className="num">{tm(Number(r.peso_neto_kg))}</td>
                        <td className="num" style={{ fontSize: '.73rem' }}>{fecha(r.creado_en as string)}</td>
                        <td className="num">
                          {dias === null ? '—'
                            : dias < 0 ? <Etiqueta texto={`Venció hace ${Math.abs(dias)} d`} tono="critico" />
                            : dias <= 3 ? <Etiqueta texto={`En ${dias} d`} tono="atencion" />
                            : <span style={{ fontSize: '.73rem' }}>{fecha(r.vence_el as string)}</span>}
                        </td>
                        <td>
                          <Etiqueta
                            texto={etiquetaEstado(r.estado as string)}
                            tono={TONO[r.estado as string] ?? 'neutro'}
                          />
                          {r.motivo_liberacion ? (
                            <div style={{ fontSize: '.7rem', color: 'var(--tinta-3)', marginTop: '.15rem' }}>
                              {r.motivo_liberacion as string}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <div className="acciones-fila">
                            {lote?.id ? (
                              <Link href={`/almacenes/lotes/${lote.id}`} className="accion-btn" title="Ver el lote">
                                <Icono nombre="ver" tamano={15} />
                              </Link>
                            ) : null}
                            {activa && (
                              <BotonLiberar
                                reservaId={r.id as number}
                                etiqueta={`${tm(Number(r.peso_neto_kg))} de ${String(lote?.codigo_pallet ?? 'este lote')}`}
                                bloqueo={bloqueoLiberar((r.creado_por as string | null) ?? null)}
                              />
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!idBuscado && <Paginacion pagina={pagina} porPagina={POR_PAGINA} total={count ?? 0} />}
          </>
        )}
      </Panel>

      <p className="pie-explicativo">
        Una reserva nunca se borra: al liberarla cambia de estado y conserva quién la soltó, cuándo y
        por qué. El plazo de vencimiento se configura en{' '}
        {veConfiguracion
          ? <Link href="/configuracion?t=parametros">Configuración → Parámetros</Link>
          : 'Configuración → Parámetros (Gerencia u Operaciones)'}, junto con si la
        expiración automática está activa.
      </p>
    </>
  );
}
