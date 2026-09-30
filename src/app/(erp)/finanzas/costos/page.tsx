/**
 * ============================================================================
 *  COSTOS DE PRODUCCIÓN · los tres componentes, con vigencia e historial
 * ============================================================================
 *  Oliver lo pidió así, con sus palabras:
 *
 *    «Lo que queríamos hallar era el margen de contribución. No la utilidad,
 *     sino el margen de contribución: costo de venta menos costo total de
 *     producción. Mi costo total incluye el precio de materia prima, el costo
 *     de conversión —la mano de obra— y otro costo variable. Son tres, a
 *     llenar al inicio de mes. Ese lo tendría que ingresar Marco.»
 *
 *  QUÉ RELACIÓN TIENE CON EL COSTO DEL LOTE
 *  Desde la migración 057 el lote toma su costo de aquí AL INGRESAR y lo
 *  conserva: el costo que rige el día en que entra el pallet es el suyo. Ya
 *  no lo teclea Almacén.
 *
 *  ESCRIBE SOLO GERENCIA
 *  Y la base lo impone por su cuenta, no solo esta pantalla: quien teclea el
 *  costo decide, de hecho, si un pedido parece rentable.
 *
 *  VIGENCIAS, SOLO HACIA ADELANTE (documento de mejoras 2.2 y migración 057)
 *  La carga de inicio de mes es obligatoria; después se puede actualizar —la
 *  idea es semanalmente—. Cada cambio rige desde el día en que se hace y solo
 *  para lo que ingrese desde entonces: el pallet que entró ayer conserva el
 *  costo con el que entró. Cada alta o corrección queda en el historial con
 *  el valor anterior, el nuevo, la fecha y el usuario.
 *
 *  Qué se ve según el mes elegido:
 *    · el mes en curso → el costo que rige HOY, editable;
 *    · un mes futuro   → su carga mensual, que regirá desde el día 1, editable;
 *    · un mes pasado   → el que regía al cerrar ese mes, solo lectura.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio } from '@/components/ui/Pagina';
import { Filtros } from '@/components/ui/Filtros';
import { Icono } from '@/components/estructura/Icono';
import { num, dinero, fecha, fechaHora } from '@/lib/formato';
import { hoyEnLima } from '@/lib/fechas';
import { veCostos, type Rol } from '@/lib/navegacion';
import { uno } from '@/lib/relaciones';
import { traerTodo } from '@/lib/traerTodo';
import { FilaCosto } from './FilaCosto';
import { CopiarMes } from './CopiarMes';
import { ActualizarEnBloque } from './ActualizarEnBloque';
import { redirect } from 'next/navigation';

export const metadata: Metadata = { title: 'Costos de producción' };
export const dynamic = 'force-dynamic';

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre',
];
const ACCION: Record<string, string> = { alta: 'Alta', correccion: 'Corrección', baja: 'Baja' };
const TIPO: Record<string, string> = { mensual: 'Carga del mes', actualizacion: 'Actualización' };

/** Interpreta `?periodo=AAAA-MM`; ante cualquier cosa rara, el mes de hoy. */
function periodoPedido(valor: string | undefined, hoy: string) {
  const m = /^(\d{4})-(\d{2})$/.exec(valor ?? '');
  if (m) {
    const anio = Number(m[1]);
    const mes = Number(m[2]);
    if (anio >= 2000 && anio <= 2100 && mes >= 1 && mes <= 12) return { anio, mes };
  }
  return { anio: Number(hoy.slice(0, 4)), mes: Number(hoy.slice(5, 7)) };
}

const desplazarMes = (anio: number, mes: number, n: number) => {
  const total = anio * 12 + (mes - 1) + n;
  return { anio: Math.floor(total / 12), mes: (total % 12) + 1 };
};
const comoTexto = (p: { anio: number; mes: number }) =>
  `${p.anio}-${String(p.mes).padStart(2, '0')}`;

type Vigencia = {
  id: number; sku_id: number; vigente_desde: string; tipo: 'mensual' | 'actualizacion';
  materia_prima_kg: number; conversion_kg: number; variable_kg: number; total_kg: number;
};

export default async function PaginaCostos(props: PageProps<'/finanzas/costos'>) {
  const q = await props.searchParams;
  const supabase = await crearClienteServidor();
  const usuario = await obtenerUsuarioActual();
  const rol = (usuario?.rol ?? 'consulta') as Rol;

  /*
   * Quien no puede ver costos no entra, ni escribiendo la dirección. La base
   * tampoco le devolvería nada —la política de lectura lo excluye— pero es
   * mejor una redirección que una pantalla vacía sin explicación.
   */
  if (!veCostos(rol)) redirect('/panel');
  //  Permiso de persona (062): hoy Marco y Oliver.
  const puedeEditar = usuario?.carga_costos === true;

  const hoy = hoyEnLima();
  const { anio, mes } = periodoPedido(q.periodo as string | undefined, hoy);
  const buscar = ((q.buscar as string) ?? '').trim().toLowerCase();
  const familia = (q.familia as string) ?? '';
  const soloFaltantes = q.faltantes === 'si';
  const historialDe = Number(q.historial ?? 0) || null;

  const periodo = comoTexto({ anio, mes });
  const mesActual = hoy.slice(0, 7);
  const esPasado = periodo < mesActual;
  const esActual = periodo === mesActual;
  const ultimoDia = `${periodo}-${String(new Date(anio, mes, 0).getDate()).padStart(2, '0')}`;
  /*
   * La fecha a la que se mira el costo: hoy en el mes en curso, el último día
   * en un mes pasado. En un mes futuro solo cuenta su propia carga.
   */
  const fechaRef = esActual ? hoy : esPasado ? ultimoDia : null;

  let consultaHistorial = supabase.from('costos_historial')
    .select('id, sku_id, vigente_desde, tipo, accion, materia_prima_antes, conversion_antes, variable_antes, total_antes, materia_prima_nuevo, conversion_nuevo, variable_nuevo, total_nuevo, usuario_nombre, registrado_en, observaciones, skus(codigo)')
    .order('registrado_en', { ascending: false }).order('id', { ascending: false });
  consultaHistorial = historialDe ? consultaHistorial.eq('sku_id', historialDe) : consultaHistorial.limit(40);

  const [{ data: productos }, vigentes, delMes, { data: familias }, { data: historial }] = await Promise.all([
    supabase
      .from('skus')
      .select('id, codigo, corte, clasificacion_comercial, especies(nombre), formatos(nombre)')
      .eq('activo', true)
      .order('codigo'),
    //  El que rige a la fecha de referencia, uno por producto (057).
    fechaRef
      ? traerTodo<Vigencia>((d, h) => supabase.rpc('costos_vigentes_al', { p_fecha: fechaRef }).range(d, h))
      : Promise.resolve([] as Vigencia[]),
    //  Todo lo registrado DENTRO del mes: su carga y sus actualizaciones.
    traerTodo<Vigencia>((d, h) =>
      supabase.from('costos_mensuales')
        .select('id, sku_id, vigente_desde, tipo, materia_prima_kg, conversion_kg, variable_kg, total_kg')
        .gte('vigente_desde', `${periodo}-01`).lte('vigente_desde', ultimoDia)
        .order('vigente_desde').order('id').range(d, h)),
    supabase.from('skus').select('clasificacion_comercial').eq('activo', true),
    consultaHistorial,
  ]);

  //  Qué se muestra de cada producto: el que rige, o en un mes futuro su carga.
  const porSku = new Map<number, Vigencia>();
  if (fechaRef) {
    for (const v of vigentes) porSku.set(Number(v.sku_id), v);
  } else {
    for (const v of delMes) if (v.tipo === 'mensual') porSku.set(Number(v.sku_id), v);
  }
  const conCarga = new Set(delMes.filter((v) => v.tipo === 'mensual').map((v) => Number(v.sku_id)));
  const actualizaciones = delMes.filter((v) => v.tipo === 'actualizacion').length;

  const lista = (productos ?? []).map((p) => {
    const c = porSku.get(p.id as number);
    return {
      id: p.id as number,
      codigo: String(p.codigo),
      corte: String(p.corte),
      familia: String(p.clasificacion_comercial),
      especie: String(uno<Record<string, unknown>>(p.especies)?.nombre ?? ''),
      mp: c ? Number(c.materia_prima_kg) : null,
      conv: c ? Number(c.conversion_kg) : null,
      varia: c ? Number(c.variable_kg) : null,
      total: c ? Number(c.total_kg) : null,
      vigenteDesde: c ? String(c.vigente_desde) : null,
      tipo: c ? c.tipo : null,
      cargado: conCarga.has(p.id as number),
    };
  });

  const filtrada = lista.filter((p) => {
    if (familia && p.familia !== familia) return false;
    if (soloFaltantes && p.cargado) return false;
    if (!buscar) return true;
    return `${p.codigo} ${p.corte} ${p.familia} ${p.especie}`.toLowerCase().includes(buscar);
  });

  const conCosto = lista.filter((p) => p.total !== null);
  const faltan = lista.filter((p) => !p.cargado).length;

  /* El promedio ponderado no tendría sentido sin volumen; se da el simple. */
  const medio = conCosto.length ? conCosto.reduce((s, p) => s + (p.total ?? 0), 0) / conCosto.length : 0;
  const medioMp = conCosto.length ? conCosto.reduce((s, p) => s + (p.mp ?? 0), 0) / conCosto.length : 0;

  const skuHistorial = historialDe ? lista.find((p) => p.id === historialDe) : null;
  const editable = puedeEditar && !esPasado;

  const anterior = desplazarMes(anio, mes, -1);
  const siguiente = desplazarMes(anio, mes, 1);
  const opcionesEspecie = [...new Set(lista.map((p) => p.especie).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  const opcionesFamilia = [...new Set((familias ?? []).map((f) => String(f.clasificacion_comercial)))]
    .sort((a, b) => a.localeCompare(b, 'es'));

  return (
    <>
      <CabeceraPagina
        titulo="Costos de producción"
        descripcion="Materia prima, conversión y variable de cada producto. La carga del mes es obligatoria; cada actualización rige desde el día en que se hace y solo para lo que ingrese desde entonces."
      >
        <Link href="/finanzas/rentabilidad" className="btn btn-secundario">
          <Icono nombre="rentabilidad" tamano={15} />
          Ver el margen
        </Link>
      </CabeceraPagina>

      {!puedeEditar && (
        <div className="ficha-aviso ficha-aviso-info" role="status">
          <Icono nombre="alerta" tamano={17} />
          <span>
            Está viendo los costos en <strong>solo lectura</strong>. Los cargan las personas con
            permiso (hoy Marco y Oliver); Gerencia lo da en Configuración → Usuarios.
          </span>
        </div>
      )}

      {/* ══════ EL MES ══════ */}
      <div className="costos-periodo">
        <Link href={`/finanzas/costos?periodo=${comoTexto(anterior)}`} className="btn btn-sutil btn-chico">
          ← {MESES[anterior.mes - 1]}
        </Link>
        <strong>{MESES[mes - 1]} {anio}</strong>
        <Link href={`/finanzas/costos?periodo=${comoTexto(siguiente)}`} className="btn btn-sutil btn-chico">
          {MESES[siguiente.mes - 1]} →
        </Link>
      </div>

      {esPasado && (
        <div className="ficha-aviso ficha-aviso-info" role="status">
          <Icono nombre="alerta" tamano={17} />
          <span>
            {MESES[mes - 1]} ya pasó: se muestra el costo que regía el {fecha(ultimoDia)}, en solo
            lectura. Esos costos ya se aplicaron a los ingresos de esos días.
          </span>
        </div>
      )}

      <RejillaKpi>
        <Kpi etiqueta={`Con la carga de ${MESES[mes - 1].toLowerCase()}`} valor={num(lista.length - faltan)}
             nota={`de ${num(lista.length)} activos · obligatoria`}
             tono={faltan === 0 ? 'ok' : esActual || esPasado ? 'critico' : 'atencion'}
             href={`/finanzas/costos?periodo=${periodo}`} />
        <Kpi etiqueta="Sin la carga del mes" valor={num(faltan)}
             tono={faltan > 0 ? (esActual ? 'critico' : 'atencion') : 'ok'}
             nota={esActual ? 'ingresan con el último costo vigente' : 'ver cuáles'}
             href={`/finanzas/costos?periodo=${periodo}&faltantes=si`} />
        <Kpi etiqueta="Actualizaciones del mes" valor={num(actualizaciones)}
             nota="después de la carga"
             href={`/finanzas/costos?periodo=${periodo}#historial`} />
        <Kpi etiqueta={esActual ? 'Costo medio hoy' : 'Costo medio'} valor={dinero(medio, 'USD', 3)}
             sufijo="/kg" tono="marca"
             nota={medio > 0 ? `${dinero(medio * 1000, 'USD', 0)} por TM · materia prima ${((medioMp / medio) * 100).toFixed(0)} %` : '—'}
  href="#productos" />
      </RejillaKpi>

      {/*
        LAS DOS TAREAS, CON NOMBRE. Oliver no encontraba dónde se actualizan
        los costos: antes la pantalla decidía sola si un cambio era la carga
        del mes o una actualización. Ahora cada tarea tiene su sitio.
      */}
      {editable && (
        <Panel titulo="¿Qué quiere hacer?" className="mb-espacio">
          <div className="costos-tareas" data-bloque="tareas">
            <section>
              <h3>1 · Carga del mes <small>obligatoria, al inicio de cada mes</small></h3>
              <p>
                {esActual
                  ? <>Los costos de {MESES[mes - 1].toLowerCase()}. Rigen desde el día en que se cargan.</>
                  : <>Se puede dejar lista la de {MESES[mes - 1].toLowerCase()} antes de que empiece: regirá desde el día 1.</>}
                {' '}Lo más rápido: cargar todos con el costo vigente y corregir en la tabla solo los productos que cambiaron.
              </p>
              {faltan > 0
                ? <CopiarMes periodo={periodo} nombreMes={MESES[mes - 1].toLowerCase()} faltan={faltan} esMesActual={esActual} />
                : <p className="ficha-aviso ficha-aviso-ok" role="status">Los {num(lista.length)} productos ya tienen la carga de {MESES[mes - 1].toLowerCase()}.</p>}
            </section>
            <section>
              <h3>2 · Actualización semanal <small>cuando un costo se mueve</small></h3>
              {esActual ? (
                <>
                  <p>
                    Rige <strong>desde hoy</strong> y solo para lo que ingrese desde hoy; lo que ya entró conserva
                    su costo. Para <strong>un producto</strong>, escriba el nuevo valor en su fila de la tabla. Para
                    <strong> muchos a la vez</strong> —por ejemplo, la materia prima de toda la pota—, use esto:
                  </p>
                  <ActualizarEnBloque especies={opcionesEspecie} familias={opcionesFamilia} hoy={hoy} />
                </>
              ) : (
                <p>Las actualizaciones se hacen en el mes en curso y rigen desde el día en que se registran. Vaya a <Link href="/finanzas/costos">{MESES[Number(hoy.slice(5, 7)) - 1].toLowerCase()}</Link>.</p>
              )}
            </section>
          </div>
        </Panel>
      )}

      <Panel id="productos" titulo={`${num(filtrada.length)} productos`}>
        <Filtros
          campos={[
            { tipo: 'texto', clave: 'buscar', etiqueta: 'Código, corte o especie', ancho: '15rem' },
            {
              tipo: 'select', clave: 'familia', etiqueta: 'Familia',
              opciones: opcionesFamilia.map((f) => ({ valor: f, texto: f })),
            },
            {
              tipo: 'select', clave: 'faltantes', etiqueta: 'Mostrar',
              opciones: [{ valor: 'si', texto: 'Solo los que no tienen la carga del mes' }],
            },
          ]}
        />

        {filtrada.length === 0 ? (
          <Vacio titulo="Sin productos" mensaje="No hay productos que coincidan con estos filtros." />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos tabla-costos">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Corte</th>
                  <th>Familia</th>
                  <th className="num">Materia prima</th>
                  <th className="num">Conversión</th>
                  <th className="num">Variable</th>
                  <th className="num">Total US$/kg</th>
                  <th className="num">US$/TM</th>
                  <th className="num">Rige desde</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtrada.map((p) => (
                  <FilaCosto
                    key={`${p.id}-${p.vigenteDesde ?? 'x'}-${p.total ?? 0}`}
                    skuId={p.id}
                    codigo={p.codigo}
                    corte={p.corte}
                    familia={p.familia}
                    periodo={periodo}
                    mp={p.mp}
                    conv={p.conv}
                    varia={p.varia}
                    vigenteDesde={p.vigenteDesde}
                    tipo={p.tipo}
                    puedeEditar={editable}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="pie-explicativo">
          Los tres costos van en <strong>dólares por kilo</strong>, que es como está el resto del
          sistema; la columna US$/TM los pasa a tonelada, que es la unidad en la que se vende.
          {editable && (
            <>
              <br /><br />
              Se guarda al salir de la casilla o al pulsar Enter.{' '}
              {esActual ? (
                <>
                  En el mes en curso, lo que guarde <strong>rige desde hoy</strong>: si el producto aún
                  no tiene la carga del mes, queda como carga; si ya la tiene, como actualización. Lo
                  que ingresó antes conserva su costo.
                </>
              ) : (
                <>
                  En un mes futuro, lo que guarde es su carga y <strong>regirá desde el día 1</strong>;
                  se puede corregir hasta entonces.
                </>
              )}{' '}
              Dejar los tres campos vacíos quita solo lo registrado hoy (o la carga futura): un
              costo que ya rige desde antes no se puede quitar.
            </>
          )}
          <br /><br />
          Un producto <strong>sin cargar</strong> no vale cero: si valiera cero, todo lo que se
          venda de él daría un margen del 100 %. Sigue rigiendo su último costo cargado, y si no
          tiene ninguno su margen se marca como no calculable.
        </p>
      </Panel>

      {/* ══════ EL HISTORIAL ══════ */}
      <div id="historial" style={{ marginTop: '1rem' }}>
        <Panel
          titulo={skuHistorial
            ? `Historial de ${skuHistorial.codigo} · ${num((historial ?? []).length)} cambios`
            : 'Últimos cambios de costo'}
          className="mb-espacio"
        >
          {skuHistorial && (
            <div className="atajos-fecha" style={{ marginBottom: '.5rem' }}>
              <Link href={`/finanzas/costos?periodo=${periodo}#historial`} className="atajo-limpiar">
                Ver los de todos los productos
              </Link>
            </div>
          )}
          {(historial ?? []).length === 0 ? (
            <Vacio titulo="Sin cambios" mensaje="Todavía no se ha registrado ningún costo." />
          ) : (
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos" data-cuadro="historial">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Usuario</th>
                    <th>Producto</th>
                    <th>Qué</th>
                    <th className="num">Rige desde</th>
                    <th className="num">Costo anterior</th>
                    <th className="num">Costo nuevo</th>
                    <th className="num">Variación</th>
                  </tr>
                </thead>
                <tbody>
                  {(historial ?? []).map((h) => {
                    const antes = h.total_antes === null ? null : Number(h.total_antes);
                    const nuevo = h.total_nuevo === null ? null : Number(h.total_nuevo);
                    const variacion = antes && nuevo !== null ? ((nuevo - antes) / antes) * 100 : null;
                    const sku = uno<Record<string, unknown>>(h.skus);
                    //  Los tres componentes en la ayuda: «subió» no dice si fue la materia prima o la planilla.
                    const partes = (mp: unknown, cv: unknown, vr: unknown) =>
                      mp === null ? '' : `MP ${Number(mp).toFixed(4)} · Conv ${Number(cv).toFixed(4)} · Var ${Number(vr).toFixed(4)}`;
                    return (
                      <tr key={h.id as number} data-accion={h.accion as string}>
                        <td className="num" style={{ fontSize: '.74rem', whiteSpace: 'nowrap' }}>
                          {fechaHora(h.registrado_en as string)}
                        </td>
                        <td>{(h.usuario_nombre as string) ?? '—'}</td>
                        <td className="mono">
                          <Link href={`/finanzas/costos?periodo=${periodo}&historial=${h.sku_id}#historial`}
                                className="enlace-ficha">
                            {String(sku?.codigo ?? h.sku_id)}
                          </Link>
                        </td>
                        <td style={{ fontSize: '.78rem' }}>
                          {ACCION[h.accion as string]} · {TIPO[h.tipo as string] ?? String(h.tipo)}
                          {h.observaciones && (
                            <>
                              <br />
                              <span style={{ color: 'var(--tinta-3)', fontSize: '.72rem' }}>{h.observaciones as string}</span>
                            </>
                          )}
                        </td>
                        <td className="num">{fecha(h.vigente_desde as string)}</td>
                        <td className="num mono" title={partes(h.materia_prima_antes, h.conversion_antes, h.variable_antes)}>
                          {antes === null ? '—' : antes.toFixed(4)}
                        </td>
                        <td className="num mono" title={partes(h.materia_prima_nuevo, h.conversion_nuevo, h.variable_nuevo)}>
                          {nuevo === null ? '—' : <strong>{nuevo.toFixed(4)}</strong>}
                        </td>
                        <td className="num" style={{
                          color: variacion === null ? undefined
                            : variacion > 0 ? 'var(--critico)' : variacion < 0 ? 'var(--ok)' : undefined,
                        }}>
                          {variacion === null ? '—' : `${variacion > 0 ? '+' : ''}${variacion.toFixed(1)} %`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="pie-explicativo">
            Cada alta, corrección o baja de un costo queda aquí con el valor anterior, el nuevo, la
            fecha y quién la hizo. Este registro no se puede editar ni borrar. Pase el cursor sobre
            un costo para ver sus tres componentes.
          </p>
        </Panel>
      </div>
    </>
  );
}
