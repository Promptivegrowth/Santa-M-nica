/**
 * ============================================================================
 *  ANTICUAMIENTO · producto que lleva demasiado tiempo en cámara
 * ============================================================================
 *  De la reunión con Oliver Tello:
 *
 *    — "¿Cuánto tiempo maneja el producto?"
 *    — "Dos años en la pota, pero generamos una alerta desde los 12 meses."
 *    — "¿Tienen un sistema para eso?"
 *    — "Actualmente no."
 *
 *  Hoy alguien mira fechas a mano. Esta pantalla lo automatiza, y el umbral de
 *  los 12 meses NO está escrito en el código: es un parámetro que Operaciones
 *  puede cambiar desde Configuración y que surte efecto al instante.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { AccionesLista } from '@/components/ui/Acciones';
import { Filtros, Paginacion } from '@/components/ui/Filtros';
import { GraficoBarras } from '@/components/graficos/Graficos';
import { tm, num, fecha, dinero } from '@/lib/formato';
import { veCostos, type Rol } from '@/lib/navegacion';

export const metadata: Metadata = { title: 'Anticuamiento' };
export const dynamic = 'force-dynamic';

const POR_PAGINA = 40;
const NOMBRE_RANGO: Record<string, string> = {
  '<12': 'Menos de 12 meses',
  '12-18': '12 a 18 meses',
  '18-24': '18 a 24 meses',
  '>24': 'Más de 24 meses',
};

export default async function PaginaAnticuamiento(props: PageProps<'/almacenes/anticuamiento'>) {
  const q = await props.searchParams;
  const supabase = await crearClienteServidor();
  const usuario = await obtenerUsuarioActual();
  const puedeVerCostos = veCostos((usuario?.rol ?? 'consulta') as Rol);

  const pagina = Math.max(1, Number(q.pagina ?? 1));
  const rango = (q.rango as string) ?? '';
  const soloAlerta = (q.alerta as string) === 'si';
  const situacion = (q.situacion as string) ?? '';

  const [{ data: resumen }, { data: umbral }] = await Promise.all([
    supabase.from('v_anticuamiento_resumen').select('*').order('orden'),
    supabase.from('parametros').select('valor').eq('clave', 'anticuamiento_alerta_meses').single(),
  ]);

  let consulta = supabase.from('v_anticuamiento').select('*', { count: 'exact' }).gt('fisico_kg', 0);
  if (rango) consulta = consulta.eq('rango', rango);
  if (soloAlerta) consulta = consulta.eq('en_alerta', true);
  /*
   * El filtro que se pidió: separar lo que YA venció de lo que está POR
   * vencer. No es lo mismo y no se hace lo mismo con cada uno: lo vencido hay
   * que darlo de baja o mandarlo a harina, y lo que está por vencer todavía
   * se puede vender.
   */
  if (situacion) consulta = consulta.eq('situacion_vida_util', situacion);

  const { data: filas, count } = await consulta
    /*
     * Se ordena por los días que le QUEDAN, no por los meses que lleva. Es lo
     * que preguntó Oliver: lo primero que tiene que aparecer es lo que está a
     * punto de perderse, y el pallet más viejo no siempre es el más urgente
     * —un producto de doce meses de vida útil vence antes que uno de
     * veinticuatro producido el mismo día—.
     */
    .order('dias_para_vencer', { ascending: true })
    .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);

  /*
   * Los tres grupos, CONTADOS EN LA BASE.
   *
   * Antes se traían las filas y se contaban aquí, y las tarjetas decían «26
   * vencidos» cuando había 47: la API devuelve como mucho mil filas por
   * consulta, y con 1 519 lotes en cámara el corte se comía un tercio del
   * inventario sin avisar. Un error de los peores, porque la cifra sale y
   * parece razonable.
   */
  const { data: porSituacion } = await supabase
    .from('v_anticuamiento_situacion')
    .select('*');

  const grupo = (nombre: string) => {
    const f = (porSituacion ?? []).find((x) => x.situacion === nombre);
    return {
      lotes: Number(f?.lotes ?? 0),
      kg: Number(f?.fisico_kg ?? 0),
      valor: Number(f?.valor ?? 0),
    };
  };
  const yaVencido = grupo('vencido');
  const porVencer = grupo('por_vencer');

  const total = (resumen ?? []).reduce((s, r) => s + Number(r.fisico_kg ?? 0), 0);
  const sobreUmbral = (resumen ?? []).filter((r) => r.rango !== '<12');
  const tmSobre = sobreUmbral.reduce((s, r) => s + Number(r.fisico_kg ?? 0), 0);
  const valorSobre = sobreUmbral.reduce((s, r) => s + Number(r.valor ?? 0), 0);
  const vencidos = (resumen ?? []).reduce((s, r) => s + Number(r.lotes_vencidos ?? 0), 0);

  return (
    <>
      <CabeceraPagina
        titulo="Anticuamiento del stock"
        descripcion={`Producto ordenado por el tiempo que lleva en cámara. El umbral de alerta está en ${umbral?.valor ?? 12} meses y se puede cambiar desde Configuración.`}
      />

      <RejillaKpi>
        <Kpi etiqueta="Stock total" valor={tm(total)} sufijo="TM" nota="En todas las bodegas" />
        <Kpi
          etiqueta="Sobre el umbral"
          valor={tm(tmSobre)}
          sufijo="TM"
          tono={tmSobre > 0 ? 'atencion' : 'ok'}
          nota={`${((tmSobre / (total || 1)) * 100).toFixed(1)} % del inventario`}
        />
        {puedeVerCostos && (
          <Kpi
            etiqueta="Valor comprometido"
            valor={dinero(valorSobre, 'USD', 0)}
            tono="atencion"
            nota="Capital parado en producto antiguo"
          />
        )}
        <Kpi
          etiqueta="Lotes con vida útil vencida"
          valor={num(vencidos)}
          tono={vencidos > 0 ? 'critico' : 'ok'}
          nota="Requieren disposición"
        />
      </RejillaKpi>

      {/*
        LAS DOS SITUACIONES QUE EXIGEN UNA DECISIÓN.
        Van antes que el gráfico de antigüedad porque son lo accionable: los
        meses en cámara describen, el vencimiento obliga.
      */}
      <RejillaKpi>
        <Kpi
          etiqueta="Ya vencido"
          valor={num(yaVencido.lotes)}
          sufijo="pallets"
          tono={yaVencido.lotes > 0 ? 'critico' : 'ok'}
          nota={`${tm(yaVencido.kg)} TM${puedeVerCostos ? ` · ${dinero(yaVencido.valor, 'USD', 0)}` : ''}`}
          href="/almacenes/anticuamiento?situacion=vencido"
        />
        <Kpi
          etiqueta="Por vencer"
          valor={num(porVencer.lotes)}
          sufijo="pallets"
          tono={porVencer.lotes > 0 ? 'atencion' : 'ok'}
          nota={`${tm(porVencer.kg)} TM · todavía se pueden colocar`}
          href="/almacenes/anticuamiento?situacion=por_vencer"
        />
        <Kpi
          etiqueta="Sobre el umbral"
          valor={tm(tmSobre)}
          sufijo="TM"
          nota={`más de ${umbral?.valor ?? 12} meses en cámara`}
        />
        {puedeVerCostos && (
          <Kpi
            etiqueta="Capital en riesgo"
            valor={dinero(yaVencido.valor + porVencer.valor, 'USD', 0)}
            tono={yaVencido.valor + porVencer.valor > 0 ? 'atencion' : 'ok'}
            nota="vencido y por vencer"
          />
        )}
      </RejillaKpi>

      <div className="atajos-fecha">
        <span>Rápido:</span>
        <Link href="/almacenes/anticuamiento?situacion=vencido">Ya vencido</Link>
        <Link href="/almacenes/anticuamiento?situacion=por_vencer">Por vencer</Link>
        <Link href="/almacenes/anticuamiento?alerta=si">Sobre el umbral de meses</Link>
        {(rango || soloAlerta || situacion) && (
          <Link href="/almacenes/anticuamiento" className="atajo-limpiar">Quitar filtros</Link>
        )}
      </div>

      <Panel titulo="Distribución por antigüedad" className="mb-espacio">
        {/*
          Los rangos tienen ORDEN natural, así que el color usa una rampa de un
          solo tono (de claro a oscuro): expresa "más antiguo", no identidad.
        */}
        <GraficoBarras
          datos={(resumen ?? []).map((r) => ({
            etiqueta: NOMBRE_RANGO[r.rango as string] ?? (r.rango as string),
            valor: Number(r.fisico_kg ?? 0),
            nota: `${num(r.lotes)} lotes`,
          }))}
          formato="kg_a_tm"
          horizontal
          tono="rampa"
          altura={140}
        />
      </Panel>

      <Panel titulo={`${num(count ?? 0)} lotes en cámara`}>
        <Filtros
          campos={[
            {
              tipo: 'select', clave: 'rango', etiqueta: 'Rango de antigüedad',
              opciones: Object.entries(NOMBRE_RANGO).map(([v, t]) => ({ valor: v, texto: t })),
            },
            {
              tipo: 'select', clave: 'alerta', etiqueta: 'Mostrar',
              opciones: [{ valor: 'si', texto: 'Solo los que superan el umbral' }],
            },
          ]}
        />

        {(filas ?? []).length === 0 ? (
          <Vacio titulo="Sin lotes" mensaje="No hay lotes que coincidan con los filtros." />
        ) : (
          <>
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos">
                <thead>
                  <tr>
                    <th>Pallet</th>
                    <th>Producto</th>
                    <th>Almacén</th>
                    <th className="num">Producción</th>
                    <th className="num">Vence</th>
                    <th className="num">Meses</th>
                    <th className="num">Físico</th>
                    <th className="num">Disponible</th>
                    {puedeVerCostos && <th className="num">Valor</th>}
                    <th>Situación</th>
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
                      <td className="num">{fecha(f.fecha_produccion as string)}</td>
                      {/*
                        Cuándo vence y cuánto le queda. El signo importa: «−40»
                        y «40 d» son situaciones opuestas y tienen que leerse
                        distinto de un vistazo.
                      */}
                      <td className="num" style={{ fontSize: '.76rem' }}>
                        {fecha(f.fecha_vencimiento as string)}
                        <br />
                        <span style={{
                          fontSize: '.68rem',
                          color: Number(f.dias_para_vencer) < 0 ? 'var(--critico)'
                            : Number(f.dias_para_vencer) <= 90 ? 'var(--atencion)' : 'var(--tinta-3)',
                        }}>
                          {Number(f.dias_para_vencer) < 0
                            ? `venció hace ${Math.abs(Number(f.dias_para_vencer))} d`
                            : `quedan ${num(f.dias_para_vencer)} d`}
                        </span>
                      </td>
                      <td className="num"><strong>{num(f.meses_almacenado, 1)}</strong></td>
                      <td className="num">{tm(f.fisico_kg)}</td>
                      <td className="num">{tm(f.disponible_kg)}</td>
                      {puedeVerCostos && <td className="num">{num(f.valor, 0)}</td>}
                      <td>
                        {f.situacion_vida_util === 'vencido' ? (
                          <Etiqueta texto="Vencido" tono="critico" />
                        ) : f.situacion_vida_util === 'por_vencer' ? (
                          <Etiqueta texto="Por vencer" tono="atencion" />
                        ) : f.en_alerta ? (
                          <Etiqueta texto="Antiguo" tono="atencion" />
                        ) : (
                          <Etiqueta texto="Vigente" tono="ok" />
                        )}
                      </td>
                      <td>
                        <AccionesLista
                          ver={`/almacenes/lotes/${f.lote_id}`}
                          verTitulo={`Ver el lote ${f.codigo_pallet}`}
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
    </>
  );
}
