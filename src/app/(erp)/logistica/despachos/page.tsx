/**
 * ============================================================================
 *  DESPACHOS · lo que ya salió
 * ============================================================================
 *  Decisión de Marco León en la reunión: la venta TERMINA cuando el producto
 *  sale del almacén. No hay distribución secundaria.
 *
 *  Por eso el despacho es el hecho que cierra el ciclo: consume la reserva,
 *  escribe la salida en el Kardex y habilita la facturación.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel, Vacio } from '@/components/ui/Pagina';
import { num, fechaHora } from '@/lib/formato';

export const metadata: Metadata = { title: 'Despachos' };
export const dynamic = 'force-dynamic';

export default async function PaginaDespachos() {
  const supabase = await crearClienteServidor();
  const { data: filas } = await supabase
    .from('despachos')
    .select('id, numero, fecha_salida, packing_lists(id, codigo, contenedor, guia_remision), almacenes(nombre), usuarios!despachos_encargado_id_fkey(nombre)')
    .order('fecha_salida', { ascending: false })
    .limit(150);

  return (
    <>
      <CabeceraPagina
        titulo="Despachos"
        descripcion="Salidas ejecutadas. Cada una consumió su reserva y escribió la salida correspondiente en el Kardex."
      />

      <Panel titulo={`${(filas ?? []).length} despachos`}>
        {(filas ?? []).length === 0 ? (
          <Vacio titulo="Sin despachos" mensaje="Todavía no se ha ejecutado ningún despacho." />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos">
              <thead>
                <tr><th>Despacho</th><th>Packing</th><th>Contenedor</th><th>Guía</th><th>Almacén</th><th>Encargado</th><th className="num">Salida</th></tr>
              </thead>
              <tbody>
                {(filas ?? []).map((d) => {
                  const pk = Array.isArray(d.packing_lists) ? d.packing_lists[0] : d.packing_lists;
                  const alm = Array.isArray(d.almacenes) ? d.almacenes[0] : d.almacenes;
                  const usr = Array.isArray(d.usuarios) ? d.usuarios[0] : d.usuarios;
                  return (
                    <tr key={d.id as number}>
                      <td className="mono">{d.numero as string}</td>
                      <td>
                        {pk ? (
                          <Link href={`/logistica/packing/${pk.id}`} className="enlace-dato">{pk.codigo as string}</Link>
                        ) : '—'}
                      </td>
                      <td className="mono">{pk?.contenedor ?? '—'}</td>
                      <td className="mono">{pk?.guia_remision ?? '—'}</td>
                      <td>{alm?.nombre ?? '—'}</td>
                      <td style={{ fontSize: '.78rem', color: 'var(--tinta-3)' }}>{usr?.nombre ?? '—'}</td>
                      <td className="num">{fechaHora(d.fecha_salida as string)}</td>
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
