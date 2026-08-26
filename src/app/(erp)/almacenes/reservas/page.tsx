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
import { type Rol } from '@/lib/navegacion';
import { uno, campo } from '@/lib/relaciones';

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

  const puedeLiberar = ['gerencia', 'operaciones', 'comercial', 'almacen'].includes(rol);
  const puedeExpirar = ['gerencia', 'operaciones'].includes(rol);

  const pagina = Math.max(1, Number(q.pagina ?? 1));
  // Por defecto se muestran las activas: son las que hoy están reteniendo kilos.
  const estado = (q.estado as string) ?? 'activa';
  const idBuscado = q.id ? Number(q.id) : null;

  let consulta = supabase
    .from('reservas')
    // La cadena del select va entera en un literal, sin concatenar: Supabase
    // deduce los tipos de la consulta leyendo ese texto en tiempo de
    // compilación, y una suma de cadenas le impide hacerlo.
    .select(
      'id, bultos, peso_neto_kg, estado, vence_el, creado_en, liberado_en, motivo_liberacion, lotes(id, codigo_pallet, fecha_produccion, sku_presentaciones(skus(codigo, corte, especies(nombre)))), almacenes(nombre), pedido_lineas(pedido_id, pedidos(numero_proforma, ciclo, clientes(id, razon_social)))',
      { count: 'exact' }
    );

  // Si se llega desde una alerta, se enfoca esa reserva concreta sin filtros.
  if (idBuscado) consulta = consulta.eq('id', idBuscado);
  else if (estado) consulta = consulta.eq('estado', estado);

  const [{ data: filas, count }, { data: todas }] = await Promise.all([
    consulta
      .order('creado_en', { ascending: false })
      .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1),
    supabase.from('reservas').select('estado, peso_neto_kg, vence_el'),
  ]);

  const universo = todas ?? [];
  const activas = universo.filter((r) => r.estado === 'activa');
  const kgActivos = activas.reduce((s, r) => s + Number(r.peso_neto_kg ?? 0), 0);

  // El instante se toma UNA vez y se reutiliza. Leer el reloj dentro del
  // filtro haría que dos reservas se comparasen contra momentos distintos, y
  // convierte el render en impuro: mismo dato, resultado distinto.
  const ahora = Date.now();
  const vencidas = activas.filter(
    (r) => r.vence_el && new Date(r.vence_el as string).getTime() < ahora
  );
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
        <Kpi etiqueta="Reservas activas" valor={num(activas.length)} tono="marca" />
        <Kpi etiqueta="Stock apartado" valor={tm(kgActivos)} nota="No figura como disponible" />
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
        />
      </RejillaKpi>

      <Panel titulo={idBuscado ? `Reserva #${idBuscado}` : `${num(count ?? 0)} reservas`}>
        {idBuscado ? (
          <div style={{ padding: '.6rem 1rem' }}>
            <Link href="/almacenes/reservas" className="btn btn-sutil">
              <Icono nombre="volver" tamano={14} />
              Ver todas las reservas
            </Link>
          </div>
        ) : (
          <Filtros
            campos={[
              {
                tipo: 'select',
                clave: 'estado',
                etiqueta: 'Estado',
                opciones: Object.keys(TONO).map((e) => ({ valor: e, texto: etiquetaEstado(e) })),
              },
            ]}
          />
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
                          {cli?.id ? (
                            <Link href={`/ventas/clientes/${cli.id}`} className="enlace-ficha">
                              {String(cli.razon_social)}
                            </Link>
                          ) : '—'}
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
                                <Icono nombre="buscar" tamano={14} />
                              </Link>
                            ) : null}
                            {activa && (
                              <BotonLiberar
                                reservaId={r.id as number}
                                etiqueta={`${tm(Number(r.peso_neto_kg))} de ${String(lote?.codigo_pallet ?? 'este lote')}`}
                                puedeLiberar={puedeLiberar}
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
        <Link href="/configuracion?t=parametros">Configuración → Parámetros</Link>, junto con si la
        expiración automática está activa.
      </p>
    </>
  );
}
