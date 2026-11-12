/**
 * ============================================================================
 *  DESPACHOS ELIMINADOS (089 · reunión del 12/11)
 * ============================================================================
 *  «Con validación, comentario y que haya un historial de despachos
 *  eliminados». Cada fila es un despacho que Gerencia eliminó: quién, cuándo,
 *  por qué y qué salía. Lo que salió volvió a cámara con su propio movimiento
 *  en el Kardex (ANUL-DESP-…), que sigue a la vista.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel, Vacio } from '@/components/ui/Pagina';
import { fechaHora, num, tm } from '@/lib/formato';

export const metadata: Metadata = { title: 'Despachos eliminados' };
export const dynamic = 'force-dynamic';

type Pallet = { pallet?: string; bultos?: number; kg?: number };

export default async function PaginaDespachosEliminados() {
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase
    .from('despachos_eliminados')
    .select('id, numero, packing_list_id, packing, embarque_id, embarque, almacen, fecha_salida, pallets, bultos, kg, proformas, detalle, motivo, eliminado_por_nombre, eliminado_en')
    .order('eliminado_en', { ascending: false })
    .limit(300);
  const filas = data ?? [];

  return (
    <>
      <CabeceraPagina
        titulo="Despachos eliminados"
        descripcion="Los despachos que Gerencia eliminó, con el motivo. Lo que había salido volvió a cámara y queda en el Kardex como «Vuelve por despacho eliminado»."
        volver={{ href: '/logistica/despachos', texto: 'Volver a despachos' }}
      />

      <Panel titulo={`${num(filas.length)} eliminados`}>
        {error ? (
          <Vacio titulo="Todavía no está activado" mensaje="El historial de despachos eliminados necesita la migración 089 en la base. Avise a sistemas." />
        ) : filas.length === 0 ? (
          <Vacio titulo="Ninguno" mensaje="No se ha eliminado ningún despacho." />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos" data-cuadro="despachos-eliminados">
              <thead>
                <tr>
                  <th>Despacho</th><th>Eliminado</th><th>Por</th><th>Motivo</th>
                  <th>Packing · embarque</th><th>Proformas</th>
                  <th className="num">Volvió a cámara</th><th>Pallets</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => {
                  const pallets = (Array.isArray(f.detalle) ? f.detalle : []) as Pallet[];
                  return (
                    <tr key={f.id}>
                      <td className="mono">
                        <s>{f.numero}</s>
                        <br /><small style={{ color: 'var(--tinta-3)' }}>salió {f.fecha_salida ? fechaHora(f.fecha_salida) : '—'}</small>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fechaHora(f.eliminado_en)}</td>
                      <td>{f.eliminado_por_nombre ?? '—'}</td>
                      <td style={{ maxWidth: '18rem' }}>{f.motivo}</td>
                      <td className="mono" style={{ fontSize: '.78rem' }}>
                        {f.packing_list_id ? <Link href={`/logistica/packing/${f.packing_list_id}`} className="enlace-ficha">{f.packing}</Link> : (f.packing ?? '—')}
                        {' · '}
                        {f.embarque_id ? <Link href={`/logistica/embarques/${f.embarque_id}`} className="enlace-ficha">{f.embarque}</Link> : (f.embarque ?? '—')}
                      </td>
                      <td className="mono" style={{ fontSize: '.78rem' }}>{f.proformas ?? '—'}</td>
                      <td className="num">{num(Number(f.bultos))} b · {tm(Number(f.kg), 3)} TM</td>
                      <td style={{ fontSize: '.74rem' }}>
                        {pallets.filter((p) => p.pallet).map((p) => `${p.pallet} (${num(Number(p.bultos ?? 0))} b)`).join(', ') || num(Number(f.pallets))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
