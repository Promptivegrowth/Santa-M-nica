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

  const [{ data: resumen }, { data: umbral }] = await Promise.all([
    supabase.from('v_anticuamiento_resumen').select('*').order('orden'),
    supabase.from('parametros').select('valor').eq('clave', 'anticuamiento_alerta_meses').single(),
  ]);

  let consulta = supabase.from('v_anticuamiento').select('*', { count: 'exact' }).gt('fisico_kg', 0);
  if (rango) consulta = consulta.eq('rango', rango);
  if (soloAlerta) consulta = consulta.eq('en_alerta', true);

  const { data: filas, count } = await consulta
    .order('meses_almacenado', { ascending: false })
    .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);

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
                      <td>
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
                      <td className="num"><strong>{num(f.meses_almacenado, 1)}</strong></td>
                      <td className="num">{tm(f.fisico_kg)}</td>
                      <td className="num">{tm(f.disponible_kg)}</td>
                      {puedeVerCostos && <td className="num">{num(f.valor, 0)}</td>}
                      <td>
                        {f.vencido ? (
                          <Etiqueta texto="Vencido" tono="critico" />
                        ) : f.en_alerta ? (
                          <Etiqueta texto="En alerta" tono="atencion" />
                        ) : (
                          <Etiqueta texto="Normal" tono="ok" />
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
