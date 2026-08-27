/**
 * ============================================================================
 *  MOVIMIENTOS DEL DÍA · qué se movió hoy en cámara, con nombre y apellido
 * ============================================================================
 *  QUÉ RESUELVE
 *  El cierre de almacén. A las seis de la tarde alguien tiene que poder
 *  responder tres preguntas sin abrir un Excel: qué entró, qué salió, y si el
 *  saldo del día cuadra. Hoy eso se responde llamando por teléfono.
 *
 *  DIFERENCIA CON EL KARDEX
 *  El Kardex es el historial completo de un producto a lo largo del tiempo:
 *  se entra por producto y se lee hacia atrás. Esta pantalla se entra por
 *  FECHA y se lee de un vistazo: es el parte del día, no el expediente del
 *  lote. Se apoyan en la misma vista `v_kardex`, que es inmutable por
 *  disparador: aquí no hay forma de maquillar un movimiento.
 *
 *  POR DEFECTO MUESTRA HOY
 *  Y si hoy no hubo nada, lo dice y ofrece el último día con movimiento en
 *  vez de dejar una tabla vacía sin explicación.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { Filtros, Paginacion } from '@/components/ui/Filtros';
import { BotonesReporte } from '@/components/ui/BotonesReporte';
import { Icono } from '@/components/estructura/Icono';
import { num, tm, dinero, fecha } from '@/lib/formato';
import { veCostos, type Rol } from '@/lib/navegacion';

export const metadata: Metadata = { title: 'Movimientos del día' };
export const dynamic = 'force-dynamic';

const POR_PAGINA = 60;

/**
 * Los tipos de movimiento, con su nombre en cristiano y si suma o resta.
 * El signo se declara aquí igual que en la función `signo_movimiento()` de la
 * base de datos; son las dos caras de la misma regla.
 */
const TIPOS: Record<string, { texto: string; signo: 1 | -1; tono: 'ok' | 'atencion' | 'critico' | 'info' | 'neutro' }> = {
  ingreso:           { texto: 'Ingreso de producción', signo: 1,  tono: 'ok' },
  traslado_ingreso:  { texto: 'Entrada por traslado',  signo: 1,  tono: 'info' },
  ingreso_reproceso: { texto: 'Vuelta de reproceso',   signo: 1,  tono: 'info' },
  ajuste_positivo:   { texto: 'Ajuste que suma',       signo: 1,  tono: 'atencion' },
  salida_despacho:   { texto: 'Salida por despacho',   signo: -1, tono: 'neutro' },
  traslado_salida:   { texto: 'Salida por traslado',   signo: -1, tono: 'info' },
  salida_reproceso:  { texto: 'Salida a reproceso',    signo: -1, tono: 'info' },
  salida_muestra:    { texto: 'Muestra de calidad',    signo: -1, tono: 'neutro' },
  ajuste_negativo:   { texto: 'Ajuste que resta',      signo: -1, tono: 'atencion' },
  salida_merma:      { texto: 'Merma',                 signo: -1, tono: 'critico' },
};

/** La fecha de hoy en el huso de Lima, que es donde está la cámara. */
function hoyEnLima(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
}

/** Hora legible de una marca de tiempo. */
function hora(valor: string): string {
  return new Date(valor).toLocaleTimeString('es-PE', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima',
  });
}

export default async function PaginaMovimientos(props: PageProps<'/almacenes/movimientos'>) {
  const q = await props.searchParams;
  const supabase = await crearClienteServidor();
  const usuario = await obtenerUsuarioActual();
  const puedeVerCostos = veCostos((usuario?.rol ?? 'consulta') as Rol);

  const pagina = Math.max(1, Number(q.pagina ?? 1));
  const hoy = hoyEnLima();
  const desde = (q.desde as string) || hoy;
  const hasta = (q.hasta as string) || desde;
  const tipo = (q.tipo as string) ?? '';
  const almacen = (q.almacen as string) ?? '';
  const buscar = ((q.buscar as string) ?? '').trim();

  /* ---- La consulta principal ----
     Se construye una vez y se reutiliza: una para las filas de la página y
     otra idéntica para los totales del rango entero. Los totales NO se sacan
     de la página visible: si hay 300 movimientos y se ven 60, el total tiene
     que ser el de los 300. */
  function base() {
    let c = supabase.from('v_kardex').select('*', { count: 'exact' })
      .gte('fecha', desde)
      .lte('fecha', `${hasta}T23:59:59.999`);
    if (tipo) c = c.eq('tipo', tipo);
    if (almacen) c = c.eq('almacen_id', Number(almacen));
    if (buscar) {
      const limpio = buscar.replace(/[%,()]/g, ' ');
      c = c.or(
        ['codigo_pallet', 'sku_codigo', 'documento_ref', 'corte']
          .map((col) => `${col}.ilike.%${limpio}%`).join(',')
      );
    }
    return c;
  }

  const [{ data: filas, count }, { data: todo }, { data: almacenes }, { data: ultimo }] =
    await Promise.all([
      base().order('fecha', { ascending: false }).range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1),
      // Los agregados del rango. Solo las columnas que se suman: traer el
      // detalle entero para calcular cuatro cifras sería tirar ancho de banda.
      base().select('tipo, entrada_kg, salida_kg, entrada_bultos, salida_bultos, valor, lote_id, usuario'),
      supabase.from('almacenes').select('id, nombre').eq('activo', true).order('nombre'),
      // Por si el rango elegido sale vacío: cuál fue el último día con vida.
      supabase.from('v_kardex').select('fecha').order('fecha', { ascending: false }).limit(1).maybeSingle(),
    ]);

  const universo = todo ?? [];
  const entradaKg = universo.reduce((s, m) => s + Number(m.entrada_kg ?? 0), 0);
  const salidaKg = universo.reduce((s, m) => s + Number(m.salida_kg ?? 0), 0);
  const entradaBultos = universo.reduce((s, m) => s + Number(m.entrada_bultos ?? 0), 0);
  const salidaBultos = universo.reduce((s, m) => s + Number(m.salida_bultos ?? 0), 0);
  const lotesTocados = new Set(universo.map((m) => m.lote_id)).size;
  const personas = new Set(universo.map((m) => m.usuario).filter(Boolean)).size;
  const neto = entradaKg - salidaKg;

  /* ---- Desglose por tipo: la lectura rápida del parte del día ---- */
  const porTipo = [...universo.reduce((mapa, m) => {
    const t = String(m.tipo);
    const acc = mapa.get(t) ?? { movimientos: 0, kg: 0, bultos: 0 };
    acc.movimientos += 1;
    acc.kg += Number(m.entrada_kg ?? 0) + Number(m.salida_kg ?? 0);
    acc.bultos += Number(m.entrada_bultos ?? 0) + Number(m.salida_bultos ?? 0);
    mapa.set(t, acc);
    return mapa;
  }, new Map<string, { movimientos: number; kg: number; bultos: number }>())]
    .sort((a, b) => b[1].kg - a[1].kg);

  const unSoloDia = desde === hasta;
  const esHoy = unSoloDia && desde === hoy;
  const rangoVacio = (count ?? 0) === 0;
  const ultimoDia = ultimo?.fecha ? String(ultimo.fecha).slice(0, 10) : null;

  return (
    <>
      <CabeceraPagina
        titulo={esHoy ? 'Movimientos de hoy' : 'Movimientos de almacén'}
        descripcion={
          esHoy
            ? 'El parte del día: todo lo que entró y salió de cámara hoy, con su documento de respaldo y quién lo registró. Cambie el rango de fechas para consultar otro día.'
            : unSoloDia
              ? `Todo lo que entró y salió el ${fecha(desde)}, movimiento por movimiento.`
              : `Todo lo que entró y salió entre el ${fecha(desde)} y el ${fecha(hasta)}, movimiento por movimiento.`
        }
      >
        <BotonesReporte tipo="movimientos" />
      </CabeceraPagina>

      {/* Aviso honesto cuando el rango no tiene nada: mejor que una tabla muda */}
      {rangoVacio && ultimoDia && ultimoDia !== desde && (
        <div className="ficha-aviso ficha-aviso-info">
          <Icono nombre="alerta" tamano={17} />
          <span>
            <strong>
              No hubo movimientos{' '}
              {unSoloDia ? `el ${fecha(desde)}` : `entre el ${fecha(desde)} y el ${fecha(hasta)}`}.
            </strong>{' '}
            El último día con actividad registrada fue el {fecha(ultimoDia)}.{' '}
            <Link href={`/almacenes/movimientos?desde=${ultimoDia}&hasta=${ultimoDia}`}>
              Ver ese día
            </Link>.
          </span>
        </div>
      )}

      <RejillaKpi>
        <Kpi
          etiqueta="Movimientos"
          valor={num(count ?? 0)}
          tono="marca"
          // Concordancia: «1 lote · 1 persona» frente a «155 lotes · 3 personas».
          nota={
            `${num(lotesTocados)} lote${lotesTocados === 1 ? '' : 's'} · ` +
            `${num(personas)} persona${personas === 1 ? '' : 's'}`
          }
        />
        <Kpi
          etiqueta="Entró"
          valor={tm(entradaKg)}
          sufijo="TM"
          tono="ok"
          nota={`${num(entradaBultos)} bultos`}
        />
        <Kpi
          etiqueta="Salió"
          valor={tm(salidaKg)}
          sufijo="TM"
          nota={`${num(salidaBultos)} bultos`}
        />
        <Kpi
          etiqueta="Saldo del período"
          valor={(neto >= 0 ? '+' : '−') + tm(Math.abs(neto))}
          sufijo="TM"
          tono={neto >= 0 ? 'ok' : 'atencion'}
          nota={neto >= 0 ? 'La cámara creció' : 'La cámara se vació en esa cantidad'}
        />
      </RejillaKpi>

      {/* ---- El desglose por tipo: qué clase de movimiento pesó más ---- */}
      {porTipo.length > 0 && (
        <Panel titulo="Por tipo de movimiento" className="mb-espacio">
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Efecto</th>
                  <th className="num">Movimientos</th>
                  <th className="num">Bultos</th>
                  <th className="num">Toneladas</th>
                  <th className="num">Peso relativo</th>
                </tr>
              </thead>
              <tbody>
                {porTipo.map(([t, d]) => {
                  const meta = TIPOS[t] ?? { texto: t, signo: -1 as const, tono: 'neutro' as const };
                  const pct = entradaKg + salidaKg > 0 ? (d.kg / (entradaKg + salidaKg)) * 100 : 0;
                  return (
                    <tr key={t}>
                      <td>
                        <Link href={`/almacenes/movimientos?desde=${desde}&hasta=${hasta}&tipo=${t}`}
                              className="enlace-ficha">
                          {meta.texto}
                        </Link>
                      </td>
                      <td>
                        <Etiqueta
                          texto={meta.signo === 1 ? 'Suma stock' : 'Resta stock'}
                          tono={meta.signo === 1 ? 'ok' : 'neutro'}
                        />
                      </td>
                      <td className="num">{num(d.movimientos)}</td>
                      <td className="num">{num(d.bultos)}</td>
                      <td className="num"><strong>{tm(d.kg)}</strong></td>
                      <td className="num">
                        {/* Barra proporcional: se lee antes que el número */}
                        <div className="barra-mini" title={`${num(pct, 1)} % del movimiento del período`}>
                          <span style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
                        </div>
                        <small>{num(pct, 1)} %</small>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel titulo={`Detalle · ${num(count ?? 0)} movimientos`}>
        <Filtros
          campos={[
            { tipo: 'fecha', clave: 'desde', etiqueta: 'Desde' },
            { tipo: 'fecha', clave: 'hasta', etiqueta: 'Hasta' },
            {
              tipo: 'select', clave: 'tipo', etiqueta: 'Tipo de movimiento',
              opciones: Object.entries(TIPOS).map(([v, d]) => ({ valor: v, texto: d.texto })),
            },
            {
              tipo: 'select', clave: 'almacen', etiqueta: 'Almacén',
              opciones: (almacenes ?? []).map((a) => ({
                valor: String(a.id), texto: a.nombre as string,
              })),
            },
            { tipo: 'texto', clave: 'buscar', etiqueta: 'Pallet, SKU, documento o corte', ancho: '18rem' },
          ]}
        />

        {(filas ?? []).length === 0 ? (
          <Vacio
            titulo="Sin movimientos"
            mensaje="No hay movimientos con estos filtros. Pruebe a ampliar el rango de fechas o a quitar el tipo."
          />
        ) : (
          <>
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos">
                <thead>
                  <tr>
                    <th className="num">Hora</th>
                    {!unSoloDia && <th className="num">Fecha</th>}
                    <th>Movimiento</th>
                    <th>Pallet</th>
                    <th>Producto</th>
                    <th>Almacén</th>
                    <th className="num">Bultos</th>
                    <th className="num">Peso</th>
                    {puedeVerCostos && <th className="num">Valor</th>}
                    <th>Documento</th>
                    <th>Motivo</th>
                    <th>Registró</th>
                  </tr>
                </thead>
                <tbody>
                  {(filas ?? []).map((m) => {
                    const meta = TIPOS[String(m.tipo)] ?? {
                      texto: String(m.tipo), signo: -1 as const, tono: 'neutro' as const,
                    };
                    const entra = meta.signo === 1;
                    const kg = Number(entra ? m.entrada_kg : m.salida_kg);
                    const bultos = Number(entra ? m.entrada_bultos : m.salida_bultos);

                    return (
                      <tr key={m.id as number}>
                        <td className="num mono" style={{ fontSize: '.76rem' }}>
                          {hora(m.fecha as string)}
                        </td>
                        {!unSoloDia && (
                          <td className="num mono" style={{ fontSize: '.74rem' }}>
                            {String(m.fecha).slice(0, 10)}
                          </td>
                        )}
                        <td>
                          <Etiqueta texto={meta.texto} tono={meta.tono} />
                        </td>
                        <td className="mono">
                          <Link href={`/almacenes/lotes/${m.lote_id}`} className="enlace-ficha">
                            {m.codigo_pallet as string}
                          </Link>
                        </td>
                        <td style={{ fontSize: '.78rem' }}>
                          <span className="mono">{m.sku_codigo as string}</span> · {m.corte as string}
                          <br />
                          <span style={{ color: 'var(--tinta-3)', fontSize: '.72rem' }}>
                            {m.especie as string} · {m.presentacion as string}
                          </span>
                        </td>
                        <td style={{ fontSize: '.78rem' }}>{m.almacen as string}</td>
                        <td className="num">{num(bultos)}</td>
                        <td className="num">
                          {/*
                            El signo delante del peso es lo que permite leer la
                            columna en diagonal: sin él hay que mirar el tipo
                            de movimiento para saber si esa cifra sumó o restó.
                          */}
                          <strong style={{ color: entra ? 'var(--ok)' : 'var(--tinta-2)' }}>
                            {entra ? '+' : '−'}{num(kg)} kg
                          </strong>
                        </td>
                        {puedeVerCostos && (
                          <td className="num">{m.valor ? dinero(m.valor, 'USD', 0) : '—'}</td>
                        )}
                        <td className="mono" style={{ fontSize: '.74rem' }}>
                          {(m.documento_ref as string) ?? '—'}
                        </td>
                        <td style={{ fontSize: '.74rem' }}>{(m.motivo as string) ?? '—'}</td>
                        <td style={{ fontSize: '.74rem' }}>
                          {(m.usuario as string) ?? '—'}
                          {m.autorizado_por ? (
                            <>
                              <br />
                              <span style={{ color: 'var(--tinta-3)', fontSize: '.7rem' }}>
                                autorizó {m.autorizado_por as string}
                              </span>
                            </>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Paginacion pagina={pagina} porPagina={POR_PAGINA} total={count ?? 0} />
          </>
        )}
      </Panel>

      <p className="pie-explicativo">
        Estos movimientos <strong>no se pueden editar ni borrar</strong>: la base de datos lo impide
        con un disparador, incluso para un administrador. Una corrección se hace con un ajuste, que
        deja su propia fila y necesita autorización. Para seguir un producto concreto a lo largo del
        tiempo, use el <Link href="/almacenes/kardex">Kardex</Link>; esta pantalla se lee por día.
      </p>
    </>
  );
}
