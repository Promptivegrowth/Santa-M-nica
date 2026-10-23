/**
 * ============================================================================
 *  AJUSTES DE STOCK · lo que se corrigió, se perdió o salió como muestra
 * ============================================================================
 *  Los cuatro movimientos del Kardex que no vienen de un documento comercial
 *  —ni de un ingreso, ni de un traslado, ni de un despacho—: el ajuste que
 *  suma, el que resta, la merma y la muestra. Son los que hay que poder
 *  explicar en una auditoría, y por eso tienen su propia pantalla: cada línea
 *  con su motivo, lo que escribió quien la registró y quién la autorizó.
 *
 *  Nada de esto se edita. Un ajuste equivocado se compensa con otro ajuste, y
 *  los dos quedan aquí.
 *
 *  Las tarjetas suman sobre los mismos filtros que la tabla (menos el de tipo,
 *  que es lo que separan), y cada una lleva a la tabla filtrada por su tipo
 *  CONSERVANDO el resto: la cifra y el detalle al que lleva son lo mismo.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, RejillaKpi, Kpi, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { Filtros, Paginacion } from '@/components/ui/Filtros';
import { AccionesLista } from '@/components/ui/Acciones';
import { Icono } from '@/components/estructura/Icono';
import { num, fechaHora, dinero } from '@/lib/formato';
import { veCostos, type Rol } from '@/lib/navegacion';
import { traerTodo } from '@/lib/traerTodo';

export const metadata: Metadata = { title: 'Ajustes de stock' };
export const dynamic = 'force-dynamic';

const POR_PAGINA = 50;

const TIPOS: Record<string, { texto: string; tono: 'ok' | 'critico' | 'atencion' | 'neutro'; signo: 1 | -1 }> = {
  ajuste_positivo: { texto: 'Ajuste que suma', tono: 'ok', signo: 1 },
  ajuste_negativo: { texto: 'Ajuste que resta', tono: 'atencion', signo: -1 },
  salida_merma: { texto: 'Merma', tono: 'critico', signo: -1 },
  salida_muestra: { texto: 'Muestra', tono: 'neutro', signo: -1 },
};
const CLAVES = Object.keys(TIPOS);

/** Quién ve el botón para registrar (cada uno, lo que su rol permite). */
const PUEDEN_REGISTRAR = ['gerencia', 'operaciones', 'almacen', 'calidad'];

const kg = (n: number) => n.toLocaleString('es-PE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export default async function PaginaAjustes(props: PageProps<'/almacenes/ajustes'>) {
  const q = await props.searchParams;
  const supabase = await crearClienteServidor();
  const usuario = await obtenerUsuarioActual();
  const rol = (usuario?.rol ?? 'consulta') as Rol;
  const puedeVerCostos = veCostos(rol);

  const pagina = Math.max(1, Number(q.pagina ?? 1));
  const tipo = CLAVES.includes(String(q.tipo ?? '')) ? String(q.tipo) : '';
  const almacen = (q.almacen as string) ?? '';
  const desde = (q.desde as string) ?? '';
  const hasta = (q.hasta as string) ?? '';
  const buscar = ((q.buscar as string) ?? '').trim().replace(/[%,()]/g, ' ');

  /*
   * Los filtros comunes a la tabla y a las tarjetas (las fechas, en hora de
   * Lima). Se escriben dos veces a propósito: con un ayudante genérico, el
   * tipado de Supabase se vuelve infinito y el compilador se rinde.
   */
  const desdeLima = desde ? `${desde}T00:00:00-05:00` : '';
  const hastaLima = hasta ? `${hasta}T23:59:59.999-05:00` : '';
  const filtroTexto = buscar
    ? `codigo_pallet.ilike.%${buscar}%,documento_ref.ilike.%${buscar}%,motivo.ilike.%${buscar}%`
    : '';

  let consulta = supabase.from('v_kardex').select('*', { count: 'exact' }).in('tipo', tipo ? [tipo] : CLAVES);
  if (almacen) consulta = consulta.eq('almacen_id', Number(almacen));
  if (desdeLima) consulta = consulta.gte('fecha', desdeLima);
  if (hastaLima) consulta = consulta.lte('fecha', hastaLima);
  if (filtroTexto) consulta = consulta.or(filtroTexto);

  const [{ data: filas, count }, universo, { data: almacenes }] = await Promise.all([
    consulta.order('fecha', { ascending: false }).range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1),
    traerTodo<{ tipo: string; entrada_kg: number; salida_kg: number; valor: number }>(
      (d, h) => {
        let u = supabase.from('v_kardex').select('tipo, entrada_kg, salida_kg, valor').in('tipo', CLAVES);
        if (almacen) u = u.eq('almacen_id', Number(almacen));
        if (desdeLima) u = u.gte('fecha', desdeLima);
        if (hastaLima) u = u.lte('fecha', hastaLima);
        if (filtroTexto) u = u.or(filtroTexto);
        return u.range(d, h);
      }
    ),
    supabase.from('almacenes').select('id, nombre').eq('activo', true).order('nombre'),
  ]);

  /* Lo que escribió quien registró: está en el movimiento, no en la vista. */
  const ids = (filas ?? []).map((f) => Number(f.id));
  const { data: notas } = ids.length
    ? await supabase.from('movimientos').select('id, observaciones').in('id', ids)
    : { data: [] as { id: number; observaciones: string | null }[] };
  const nota = new Map((notas ?? []).map((n) => [Number(n.id), (n.observaciones as string | null) ?? '']));

  const totales = CLAVES.map((t) => {
    const del = (universo ?? []).filter((r) => r.tipo === t);
    return {
      tipo: t,
      cuantos: del.length,
      kg: del.reduce((s, r) => s + Number(r.entrada_kg ?? 0) + Number(r.salida_kg ?? 0), 0),
      valor: del.reduce((s, r) => s + Number(r.valor ?? 0), 0),
    };
  });

  /** La tarjeta lleva a su tipo sin perder los demás filtros. */
  function conTipo(t: string) {
    const p = new URLSearchParams();
    if (almacen) p.set('almacen', almacen);
    if (desde) p.set('desde', desde);
    if (hasta) p.set('hasta', hasta);
    if (buscar) p.set('buscar', buscar);
    p.set('tipo', t);
    return `/almacenes/ajustes?${p.toString()}#detalle`;
  }

  return (
    <>
      <CabeceraPagina
        titulo="Ajustes de stock"
        descripcion="Ajustes que suman o restan, mermas y muestras: los movimientos del Kardex que no vienen de un ingreso, un traslado ni un despacho. Cada uno con su motivo y quién lo registró. Nada se edita: un error se compensa con otro ajuste."
      >
        {PUEDEN_REGISTRAR.includes(rol) && (
          <Link href="/almacenes/ajustes/nuevo" className="btn btn-primario" data-accion="nuevo-ajuste">
            <Icono nombre="mas" tamano={15} />
            Registrar ajuste
          </Link>
        )}
      </CabeceraPagina>

      <RejillaKpi>
        {totales.map((t) => (
          <Kpi
            key={t.tipo}
            etiqueta={TIPOS[t.tipo].texto}
            valor={`${kg(t.kg)} kg`}
            tono={t.cuantos === 0 ? 'neutro' : TIPOS[t.tipo].signo === 1 ? 'ok' : t.tipo === 'salida_merma' ? 'critico' : 'atencion'}
            nota={`${num(t.cuantos)} registro${t.cuantos === 1 ? '' : 's'}${puedeVerCostos ? ` · ${dinero(t.valor, 'USD', 0)}` : ''}`}
            href={conTipo(t.tipo)}
          />
        ))}
      </RejillaKpi>

      <Panel id="detalle" titulo={`${num(count ?? 0)} ${tipo ? TIPOS[tipo].texto.toLowerCase() + (count === 1 ? '' : 's') : 'movimientos'}`}>
        <Filtros
          campos={[
            { tipo: 'texto', clave: 'buscar', etiqueta: 'Pallet, documento o motivo', ancho: '14rem' },
            {
              tipo: 'select', clave: 'tipo', etiqueta: 'Tipo',
              opciones: CLAVES.map((t) => ({ valor: t, texto: TIPOS[t].texto })),
            },
            {
              tipo: 'select', clave: 'almacen', etiqueta: 'Almacén',
              opciones: (almacenes ?? []).map((a) => ({ valor: String(a.id), texto: a.nombre as string })),
            },
            { tipo: 'fecha', clave: 'desde', etiqueta: 'Desde' },
            { tipo: 'fecha', clave: 'hasta', etiqueta: 'Hasta' },
          ]}
        />

        {(filas ?? []).length === 0 ? (
          <Vacio
            titulo="Sin registros"
            mensaje="No hay ajustes, mermas ni muestras con estos filtros. Se registran con «Registrar ajuste» o desde la ficha del pallet."
          />
        ) : (
          <>
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Tipo</th>
                    <th>Documento</th>
                    <th>Pallet</th>
                    <th>Producto</th>
                    <th>Almacén</th>
                    <th className="num">Bultos</th>
                    <th className="num">Peso</th>
                    {puedeVerCostos && <th className="num">Valor</th>}
                    <th>Motivo</th>
                    <th>Registró</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {(filas ?? []).map((f) => {
                    const t = TIPOS[f.tipo as string];
                    const kilos = Number(f.entrada_kg ?? 0) + Number(f.salida_kg ?? 0);
                    const bultos = Number(f.entrada_bultos ?? 0) + Number(f.salida_bultos ?? 0);
                    const texto = nota.get(Number(f.id));
                    return (
                      <tr key={f.id as number}>
                        <td className="mono" style={{ fontSize: '.74rem' }}>{fechaHora(f.fecha as string)}</td>
                        <td><Etiqueta texto={t?.texto ?? String(f.tipo)} tono={t?.tono ?? 'neutro'} /></td>
                        <td className="mono" style={{ fontSize: '.74rem' }}>{(f.documento_ref as string) ?? '—'}</td>
                        <td className="mono">
                          <Link href={`/almacenes/lotes/${f.lote_id}`} className="enlace-ficha">
                            {f.codigo_pallet as string}
                          </Link>
                        </td>
                        <td style={{ fontSize: '.78rem' }}>
                          {f.especie as string} · {f.formato as string}
                          <br />
                          <span style={{ color: 'var(--tinta-3)', fontSize: '.72rem' }}>{f.corte as string}</span>
                        </td>
                        <td style={{ fontSize: '.78rem' }}>{f.almacen as string}</td>
                        <td className="num">{t?.signo === 1 ? '+' : '−'}{num(bultos)}</td>
                        <td className="num">
                          <strong style={{ color: t?.signo === 1 ? 'var(--ok)' : 'var(--critico)' }}>
                            {t?.signo === 1 ? '+' : '−'}{kg(kilos)} kg
                          </strong>
                        </td>
                        {puedeVerCostos && <td className="num">{dinero(Number(f.valor ?? 0), 'USD', 2)}</td>}
                        <td style={{ fontSize: '.78rem', maxWidth: '18rem' }}>
                          <strong>{(f.motivo as string) ?? '—'}</strong>
                          {texto ? <><br /><span style={{ color: 'var(--tinta-3)' }}>{texto}</span></> : null}
                        </td>
                        <td style={{ fontSize: '.76rem' }}>
                          {(f.usuario as string) ?? '—'}
                          {f.autorizado_por ? (
                            <><br /><span style={{ color: 'var(--tinta-3)' }}>autorizó {f.autorizado_por as string}</span></>
                          ) : null}
                        </td>
                        <td>
                          <AccionesLista
                            ver={`/almacenes/lotes/${f.lote_id}`}
                            verTitulo={`Ver el pallet ${f.codigo_pallet}`}
                          />
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
        Quién registra qué: los <strong>ajustes</strong> (que suman o restan) los registra y autoriza
        Gerencia u Operaciones; las <strong>mermas</strong>, Gerencia, Operaciones o Almacén (Almacén solo
        con un motivo que no pida autorización); las <strong>muestras</strong>, también Calidad. Si lo que
        se resta toca kilos reservados para un pedido, el sistema lo avisa y solo Gerencia u Operaciones
        pueden confirmarlo. Los motivos y si piden autorización se cambian en Configuración.
      </p>
    </>
  );
}
