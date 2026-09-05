/**
 * ============================================================================
 *  COSTOS DE PRODUCCIÓN · los tres componentes, mes a mes
 * ============================================================================
 *  Oliver lo pidió así, con sus palabras:
 *
 *    «Lo que queríamos hallar era el margen de contribución. No la utilidad,
 *     sino el margen de contribución: costo de venta menos costo total de
 *     producción. Mi costo total incluye el precio de materia prima, el costo
 *     de conversión —la mano de obra— y otro costo variable. Son tres, a
 *     llenar al inicio de mes. Ese lo tendría que ingresar Marco.»
 *
 *  QUÉ RELACIÓN TIENE CON EL COSTO QUE YA HABÍA
 *  Son dos costos distintos y los dos hacen falta:
 *
 *    · El del LOTE (`lotes.costo_unitario`) dice lo que costó ESE pallet. Es
 *      el que valoriza el inventario: lo que hay en cámara vale lo que costó.
 *    · El MENSUAL, que es esta pantalla, es el estándar del producto. Es
 *      contra el que se mide el margen, porque un margen se compara con el
 *      costo del período, no con el del pallet que casualmente se despachó.
 *
 *  ESCRIBE SOLO GERENCIA
 *  Y la base lo impone por su cuenta, no solo esta pantalla: quien teclea el
 *  costo decide, de hecho, si un pedido parece rentable.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio } from '@/components/ui/Pagina';
import { Filtros } from '@/components/ui/Filtros';
import { Icono } from '@/components/estructura/Icono';
import { num, dinero } from '@/lib/formato';
import { hoyEnLima } from '@/lib/fechas';
import { veCostos, type Rol } from '@/lib/navegacion';
import { uno } from '@/lib/relaciones';
import { FilaCosto } from './FilaCosto';
import { CopiarMes } from './CopiarMes';
import { redirect } from 'next/navigation';

export const metadata: Metadata = { title: 'Costos de producción' };
export const dynamic = 'force-dynamic';

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

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
  const puedeEditar = rol === 'gerencia';

  const hoy = hoyEnLima();
  const { anio, mes } = periodoPedido(q.periodo as string | undefined, hoy);
  const buscar = ((q.buscar as string) ?? '').trim().toLowerCase();
  const familia = (q.familia as string) ?? '';
  const soloFaltantes = q.faltantes === 'si';

  const [{ data: productos }, { data: costos }, { data: familias }] = await Promise.all([
    supabase
      .from('skus')
      .select('id, codigo, corte, clasificacion_comercial, especies(nombre), formatos(nombre)')
      .eq('activo', true)
      .order('codigo'),
    supabase
      .from('costos_mensuales')
      .select('sku_id, materia_prima_kg, conversion_kg, variable_kg, total_kg')
      .eq('anio', anio).eq('mes', mes),
    supabase.from('skus').select('clasificacion_comercial').eq('activo', true),
  ]);

  const porSku = new Map(
    (costos ?? []).map((c) => [Number(c.sku_id), c as Record<string, unknown>])
  );

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
    };
  });

  const filtrada = lista.filter((p) => {
    if (familia && p.familia !== familia) return false;
    if (soloFaltantes && p.total !== null) return false;
    if (!buscar) return true;
    return `${p.codigo} ${p.corte} ${p.familia} ${p.especie}`.toLowerCase().includes(buscar);
  });

  const cargados = lista.filter((p) => p.total !== null);
  const faltan = lista.length - cargados.length;

  /* El promedio ponderado no tendría sentido sin volumen; se da el simple. */
  const medio = cargados.length
    ? cargados.reduce((s, p) => s + (p.total ?? 0), 0) / cargados.length
    : 0;
  const medioMp = cargados.length
    ? cargados.reduce((s, p) => s + (p.mp ?? 0), 0) / cargados.length
    : 0;

  const anterior = desplazarMes(anio, mes, -1);
  const siguiente = desplazarMes(anio, mes, 1);
  const opcionesFamilia = [...new Set((familias ?? []).map((f) => String(f.clasificacion_comercial)))]
    .sort((a, b) => a.localeCompare(b, 'es'));

  return (
    <>
      <CabeceraPagina
        titulo="Costos de producción"
        descripcion="Los tres componentes del costo de cada producto, mes a mes: materia prima, conversión y variable. Es el estándar contra el que se mide el margen de contribución."
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
            Está viendo los costos en <strong>solo lectura</strong>. Cargarlos corresponde a
            Gerencia, que es quien tiene los datos de compra y de planilla.
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

      <RejillaKpi>
        <Kpi etiqueta="Productos con costo" valor={num(cargados.length)}
             nota={`de ${num(lista.length)} activos`}
             tono={faltan === 0 ? 'ok' : 'atencion'} />
        <Kpi etiqueta="Sin cargar" valor={num(faltan)}
             tono={faltan > 0 ? 'atencion' : 'ok'}
             nota="usan el último costo anterior"
             href={`/finanzas/costos?periodo=${comoTexto({ anio, mes })}&faltantes=si`} />
        <Kpi etiqueta="Costo medio" valor={dinero(medio, 'USD', 3)} sufijo="/kg" tono="marca"
             nota={`${dinero(medio * 1000, 'USD', 0)} por TM`} />
        <Kpi etiqueta="Materia prima" valor={dinero(medioMp, 'USD', 3)} sufijo="/kg"
             nota={medio > 0 ? `${((medioMp / medio) * 100).toFixed(0)} % del costo` : '—'} />
      </RejillaKpi>

      {puedeEditar && <CopiarMes anio={anio} mes={mes} faltan={faltan} />}

      <Panel titulo={`${num(filtrada.length)} productos`}>
        <Filtros
          campos={[
            { tipo: 'texto', clave: 'buscar', etiqueta: 'Código, corte o especie', ancho: '15rem' },
            {
              tipo: 'select', clave: 'familia', etiqueta: 'Familia',
              opciones: opcionesFamilia.map((f) => ({ valor: f, texto: f })),
            },
            {
              tipo: 'select', clave: 'faltantes', etiqueta: 'Mostrar',
              opciones: [{ valor: 'si', texto: 'Solo los que faltan' }],
            },
          ]}
        />

        {filtrada.length === 0 ? (
          <Vacio
            titulo="Sin productos"
            mensaje="No hay productos que coincidan con estos filtros."
          />
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
                </tr>
              </thead>
              <tbody>
                {filtrada.map((p) => (
                  <FilaCosto
                    key={p.id}
                    skuId={p.id}
                    codigo={p.codigo}
                    corte={p.corte}
                    familia={p.familia}
                    anio={anio}
                    mes={mes}
                    mp={p.mp}
                    conv={p.conv}
                    varia={p.varia}
                    puedeEditar={puedeEditar}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="pie-explicativo">
          Los tres costos van en <strong>dólares por kilo</strong>, que es como está el resto del
          sistema. La columna de la derecha los pasa a tonelada, que es la unidad en la que se
          vende, para no tener que multiplicar a mano.
          {puedeEditar && (
            <>
              <br /><br />
              Se guarda al salir de la casilla o al pulsar Enter. Para <strong>quitar</strong> el
              costo de un producto, deje los tres campos vacíos: sus pedidos volverán a medirse
              con el último costo anterior que tenga cargado.
            </>
          )}
          <br /><br />
          Un producto <strong>sin cargar</strong> no vale cero: si valiera cero, todo lo que se
          venda de él daría un margen del 100 %. Se mide con el último mes que sí tenga costo, y
          si no hay ninguno su margen se marca como no calculable.
        </p>
      </Panel>
    </>
  );
}
