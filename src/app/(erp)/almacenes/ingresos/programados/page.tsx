/**
 * ============================================================================
 *  INGRESOS PROGRAMADOS · lo que todavía no llega
 * ============================================================================
 *  Pedido de Oliver: dejar cargado lo que va a llegar y confirmarlo al
 *  llegar. Los programados nacen de una importación desde Excel (una fila con
 *  «Llega el» futuro). Aquí se ven por fecha de llegada, los atrasados
 *  primero, y se confirman (uno o varios, corrigiendo bultos y kilos reales)
 *  o se anulan. Abajo, los últimos confirmados y anulados.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { Icono } from '@/components/estructura/Icono';
import { fecha, fechaHora, num } from '@/lib/formato';
import { hoyEnLima } from '@/lib/fechas';
import { PUEDEN_INGRESAR, NOMBRE_ORIGEN } from '../tipos';
import { ListaProgramados, type Programado } from './ListaProgramados';

export const metadata: Metadata = { title: 'Ingresos programados' };
export const dynamic = 'force-dynamic';

const CAMPOS = 'id, codigo_pallet, fecha_llegada, fecha_produccion, bultos, peso_neto_kg, origen_ingreso, proveedor, estado, lote_id, ' +
  'importacion_id, confirmado_en, anulado_en, motivo_anulacion, almacenes(nombre), camaras(nombre), ' +
  'sku_presentaciones(skus(codigo, corte, especies(nombre)), presentaciones(descripcion)), ' +
  'autor:usuarios!ingresos_programados_creado_por_fkey(nombre), confirmador:usuarios!ingresos_programados_confirmado_por_fkey(nombre), ' +
  'anulador:usuarios!ingresos_programados_anulado_por_fkey(nombre)';

const uno = (x: unknown) => (Array.isArray(x) ? x[0] : x) as Record<string, unknown> | null;

export default async function PaginaProgramados() {
  const usuario = await obtenerUsuarioActual();
  if (!(PUEDEN_INGRESAR as readonly string[]).includes(usuario?.rol ?? '')) redirect('/almacenes/ingresos');

  const supabase = await crearClienteServidor();
  const [{ data: vivos }, { data: cerrados }] = await Promise.all([
    supabase.from('ingresos_programados').select(CAMPOS).eq('estado', 'programado').order('fecha_llegada').order('id').limit(1000),
    supabase.from('ingresos_programados').select(CAMPOS).neq('estado', 'programado').order('id', { ascending: false }).limit(30),
  ]);

  const convertir = (p: Record<string, unknown>): Programado => {
    const sp = uno(p.sku_presentaciones);
    const sku = uno(sp?.skus);
    const pres = uno(sp?.presentaciones);
    return {
      id: Number(p.id),
      codigo_pallet: String(p.codigo_pallet),
      fecha_llegada: String(p.fecha_llegada),
      producto: `${sku?.codigo ?? ''} · ${String(uno(sku?.especies)?.nombre ?? '')} · ${String(sku?.corte ?? '')} · ${String(pres?.descripcion ?? '')}`,
      origen: NOMBRE_ORIGEN[String(p.origen_ingreso)] ?? String(p.origen_ingreso),
      proveedor: (p.proveedor as string) ?? null,
      bodega: String(uno(p.almacenes)?.nombre ?? '—'),
      camara: (uno(p.camaras)?.nombre as string) ?? null,
      bultos: Number(p.bultos),
      peso_neto_kg: Number(p.peso_neto_kg),
      importacion_id: (p.importacion_id as number) ?? null,
      autor: String(uno(p.autor)?.nombre ?? '—'),
    };
  };

  const lista = ((vivos ?? []) as unknown as Record<string, unknown>[]).map(convertir);

  return (
    <>
      <CabeceraPagina
        titulo="Ingresos programados"
        descripcion="Pallets que se sabe que van a llegar. No mueven stock: al llegar se confirma (corrigiendo bultos y kilos si no coinciden) y recién entonces nace el pallet."
        volver={{ href: '/almacenes/ingresos', texto: 'Volver a ingresos' }}
      >
        <Link href="/almacenes/ingresos/importar" className="btn btn-secundario">
          <Icono nombre="ingresos" tamano={15} /> Importar desde Excel
        </Link>
      </CabeceraPagina>

      <ListaProgramados programados={lista} hoy={hoyEnLima()} />

      <Panel titulo="Últimos confirmados y anulados" className="mb-espacio">
        {(cerrados ?? []).length === 0 ? (
          <Vacio titulo="Todavía no hay" mensaje="Aquí aparecerán los ingresos programados ya confirmados o anulados." />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos" data-tabla="programados-cerrados">
              <thead>
                <tr><th>Pallet</th><th>Esperado</th><th>Estado</th><th>Quién y cuándo</th><th className="num">Bultos</th><th className="num">Kg</th><th>Detalle</th></tr>
              </thead>
              <tbody>
                {((cerrados ?? []) as unknown as Record<string, unknown>[]).map((p) => (
                  <tr key={Number(p.id)} data-programado={Number(p.id)}>
                    <td className="mono">{String(p.codigo_pallet)}</td>
                    <td>{fecha(p.fecha_llegada as string)}</td>
                    <td><Etiqueta texto={p.estado === 'confirmado' ? 'Llegó' : 'Anulado'} tono={p.estado === 'confirmado' ? 'ok' : 'neutro'} /></td>
                    <td>{p.estado === 'confirmado'
                      ? `${String(uno(p.confirmador)?.nombre ?? '—')} · ${fechaHora(p.confirmado_en as string)}`
                      : `${String(uno(p.anulador)?.nombre ?? '—')} · ${fechaHora(p.anulado_en as string)}`}</td>
                    <td className="num">{num(Number(p.bultos))}</td>
                    <td className="num">{num(Number(p.peso_neto_kg), 1)}</td>
                    <td>
                      {p.lote_id ? <Link href={`/almacenes/lotes/${p.lote_id}`} className="enlace-dato">Ver el pallet</Link>
                        : p.motivo_anulacion ? String(p.motivo_anulacion) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
