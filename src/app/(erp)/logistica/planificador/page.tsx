/**
 * ============================================================================
 *  PLANIFICADOR DE EMBARQUES · el calendario de salidas
 * ============================================================================
 *  Muestra qué sale cada día, desde qué bodega, hacia qué destino, con cuánta
 *  carga y para qué cliente.
 *
 *  Dos reglas del negocio quedan visibles aquí:
 *   · Se opera de lunes a sábado. El domingo se puede despachar, pero tiene un
 *     sobrecosto (ambas cosas son parámetros configurables).
 *   · Hay un tope de almacenes despachando en simultáneo. Oliver indicó que
 *     cuatro ya es el límite práctico; el calendario pinta en rojo el día que
 *     lo supera, que es la información que hace falta para mover un embarque
 *     antes de que llegue la fecha.
 *
 *  POR QUÉ EL MES ENTERO Y NO UNA VENTANA MÓVIL
 *  La versión anterior traía «desde hace una semana hasta dentro de un mes».
 *  Eso hace imposible comparar dos meses o enseñar el mes cerrado a alguien:
 *  la ventana se mueve sola. Con el mes como unidad, la dirección web es
 *  estable y se puede compartir: /logistica/planificador?mes=2026-09.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor } from '@/lib/supabase/servidor';
import { hoyEnLima } from '@/lib/fechas';
import { CabeceraPagina, RejillaKpi, Kpi, Panel } from '@/components/ui/Pagina';
import { CalendarioEmbarques, type EmbarqueCalendario } from './Calendario';
import { num, tm } from '@/lib/formato';
import { uno, campo } from '@/lib/relaciones';

export const metadata: Metadata = { title: 'Planificador' };
export const dynamic = 'force-dynamic';

/**
 * Interpreta el parámetro `mes` ('AAAA-MM'). Si no viene o viene mal, se
 * planta en el mes de hoy en lugar de fallar: un parámetro escrito a mano en
 * la barra de direcciones no puede tumbar una pantalla.
 */
function mesPedido(valor: string | undefined, hoy: string): { anio: number; mes: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(valor ?? '');
  if (m) {
    const anio = Number(m[1]);
    const mes = Number(m[2]) - 1;
    if (anio >= 2000 && anio <= 2100 && mes >= 0 && mes <= 11) return { anio, mes };
  }
  return { anio: Number(hoy.slice(0, 4)), mes: Number(hoy.slice(5, 7)) - 1 };
}

export default async function PaginaPlanificador(props: PageProps<'/logistica/planificador'>) {
  const q = await props.searchParams;
  const supabase = await crearClienteServidor();

  const hoy = hoyEnLima();
  const { anio, mes } = mesPedido(q.mes as string | undefined, hoy);

  /*
   * El rango que se pide a la base de datos incluye los días de relleno que
   * el calendario pinta de los meses vecinos: si no, la primera semana
   * aparecería vacía aunque el lunes 31 de agosto hubiera dos salidas.
   */
  const primero = new Date(Date.UTC(anio, mes, 1));
  const desde = new Date(primero.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  // Date.UTC devuelve milisegundos, no una fecha: se le suma directamente.
  const hasta = new Date(Date.UTC(anio, mes + 1, 0) + 7 * 86400000)
    .toISOString().slice(0, 10);

  const [{ data: crudos }, { data: params }] = await Promise.all([
    supabase
      .from('embarques')
      // La cadena del select va entera en un literal, sin concatenar: Supabase
      // deduce los tipos de la consulta leyendo ese texto en tiempo de
      // compilación, y una suma de cadenas le impide hacerlo.
      .select(
        'id, numero, fecha_programada, estado, booking, naviera, almacenes(nombre), destinos(puerto, pais), packing_lists(contenedor, packing_lineas(bultos, peso_neto_kg)), embarque_pedidos(pedidos(clientes(razon_social), pedido_lineas(cantidad_tm)))'
      )
      .gte('fecha_programada', desde)
      .lte('fecha_programada', hasta)
      .order('fecha_programada'),
    supabase.from('parametros').select('clave, valor')
      .in('clave', ['despachos_simultaneos_max', 'recargo_domingo_pct']),
  ]);

  const topeSimultaneo = Number(params?.find((p) => p.clave === 'despachos_simultaneos_max')?.valor ?? 4);
  const recargoDomingo = Number(params?.find((p) => p.clave === 'recargo_domingo_pct')?.valor ?? 35);

  /* ---- Se aplana a la forma que consume el calendario ----
     La conversión se hace AQUÍ y no en el componente: el navegador no tiene
     por qué recibir el árbol entero de relaciones anidadas para pintar una
     ficha de dos líneas. */
  const embarques: EmbarqueCalendario[] = (crudos ?? []).map((e) => {
    const packings = (Array.isArray(e.packing_lists) ? e.packing_lists : [e.packing_lists])
      .filter(Boolean) as Record<string, unknown>[];

    let kg = 0;
    let bultos = 0;
    for (const p of packings) {
      for (const l of (p.packing_lineas ?? []) as Record<string, unknown>[]) {
        kg += Number(l.peso_neto_kg ?? 0);
        bultos += Number(l.bultos ?? 0);
      }
    }

    /*
     * DE DÓNDE SALE LA CARGA DE UN DÍA
     *
     * Si el embarque ya tiene packing, el peso es el REAL: lo que se cargó,
     * pallet por pallet. Si todavía no lo tiene —que es lo normal en un
     * embarque planificado a tres semanas vista— ese peso es cero, y pintar
     * «0,0 TM» en el calendario haría creer que el embarque va vacío.
     *
     * En ese caso se usa lo COMPROMETIDO en los pedidos que van dentro. Es
     * una previsión, no una realidad, y la pantalla lo dice: la ficha marca
     * cuál de las dos cifras está enseñando. Mezclarlas sin avisar sería
     * peor que no dar la cifra.
     */
    const pedidos = ((e.embarque_pedidos ?? []) as Record<string, unknown>[])
      .map((ep) => uno<Record<string, unknown>>(ep.pedidos))
      .filter(Boolean) as Record<string, unknown>[];

    const tmComprometidas = pedidos.reduce(
      (suma, ped) => suma + ((ped.pedido_lineas ?? []) as Record<string, unknown>[])
        .reduce((s, l) => s + Number(l.cantidad_tm ?? 0), 0),
      0
    );

    const hayPacking = kg > 0;

    // Un embarque puede consolidar varios pedidos: si son de un solo cliente
    // se nombra; si son de varios, se dice cuántos en vez de mentir con uno.
    const clientes = new Set(
      pedidos
        .map((ped) => campo(ped.clientes, 'razon_social'))
        .filter((c) => c && c !== '—')
    );

    const dst = uno<Record<string, unknown>>(e.destinos);

    return {
      id: e.id as number,
      numero: e.numero as string,
      dia: e.fecha_programada as string,
      estado: e.estado as string,
      almacen: campo(e.almacenes, 'nombre'),
      destino: (dst?.puerto as string) ?? 'Sin destino',
      pais: (dst?.pais as string) ?? '',
      cliente:
        clientes.size === 1 ? [...clientes][0] as string
        : clientes.size > 1 ? `${clientes.size} clientes consolidados`
        : null,
      contenedor: (packings[0]?.contenedor as string) ?? null,
      booking: (e.booking as string) ?? null,
      naviera: (e.naviera as string) ?? null,
      tm: hayPacking ? kg / 1000 : tmComprometidas,
      bultos: hayPacking ? bultos : 0,
      cargaReal: hayPacking,
      pedidos: pedidos.length,
    };
  });

  /* ---- Indicadores del MES, no del rango con relleno ---- */
  const delMes = embarques.filter(
    (e) => Number(e.dia.slice(0, 4)) === anio && Number(e.dia.slice(5, 7)) === mes + 1
  );

  const porDia = new Map<string, EmbarqueCalendario[]>();
  for (const e of delMes) {
    if (!porDia.has(e.dia)) porDia.set(e.dia, []);
    porDia.get(e.dia)!.push(e);
  }

  const diasSobreTope = [...porDia.values()]
    .filter((lista) => new Set(lista.map((e) => e.almacen)).size > topeSimultaneo).length;
  const domingos = [...porDia.keys()]
    .filter((d) => new Date(d + 'T12:00:00Z').getUTCDay() === 0).length;
  const tmMes = delMes.reduce((s, e) => s + e.tm, 0);
  const sinPacking = delMes.filter((e) => !e.cargaReal).length;

  return (
    <>
      <CabeceraPagina
        titulo="Planificador de embarques"
        descripcion={`Agenda de salidas del mes. El tope de bodegas despachando a la vez está en ${topeSimultaneo}; despachar en domingo tiene un recargo de ${recargoDomingo} %. Pulse un día para ver su detalle.`}
      >
        <Link href="/logistica/embarques" className="btn btn-secundario">Ver lista completa</Link>
      </CabeceraPagina>

      <RejillaKpi>
        <Kpi
          etiqueta="Embarques del mes"
          valor={num(delMes.length)}
          tono="marca"
          nota={`${num(porDia.size)} días con salida`}
        />
        <Kpi
          etiqueta="Carga programada"
          valor={tm(tmMes * 1000)}
          sufijo="TM"
          nota={
            sinPacking > 0
              ? `${sinPacking} sin packing: esa parte es la comprometida`
              : 'Toda con packing cargado'
          }
        />
        <Kpi
          etiqueta="Días sobre el tope simultáneo"
          valor={num(diasSobreTope)}
          tono={diasSobreTope > 0 ? 'atencion' : 'ok'}
          nota={`Más de ${topeSimultaneo} bodegas a la vez`}
        />
        <Kpi
          etiqueta="Salidas en domingo"
          valor={num(domingos)}
          tono={domingos > 0 ? 'atencion' : 'ok'}
          nota={`Con recargo del ${recargoDomingo} %`}
        />
      </RejillaKpi>

      <Panel>
        <CalendarioEmbarques
          embarques={embarques}
          anio={anio}
          mes={mes}
          hoy={hoy}
          topeSimultaneo={topeSimultaneo}
          recargoDomingo={recargoDomingo}
        />
      </Panel>

      <p className="pie-explicativo">
        El tope de bodegas simultáneas y el recargo de domingo se cambian en{' '}
        <Link href="/configuracion?t=parametros">Configuración → Parámetros</Link>: el calendario
        recalcula los avisos con el valor nuevo, sin tocar el programa. La carga de cada día sale de
        los packing lists ya cargados; un embarque todavía sin packing aparece con cero toneladas,
        que es la verdad: aún no se le ha asignado producto.
      </p>
    </>
  );
}
