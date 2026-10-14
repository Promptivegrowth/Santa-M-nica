/**
 * ============================================================================
 *  CONTRATO DESDE LA COTIZACIÓN APROBADA
 * ============================================================================
 *  Oliver: «el contrato debe generarse al aprobar la cotización, al igual que
 *  se genera la proforma». El contrato lleva el número de la proforma
 *  (SM26-378 → SM-2026-378), así que vive en la proforma:
 *
 *    · si la cotización ya tiene proforma, se va directo a su contrato;
 *    · si está aprobada pero aún no, se ofrece generar la proforma y pasar al
 *      contrato en un solo paso.
 * ============================================================================
 */
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel, Vacio } from '@/components/ui/Pagina';
import { puedeVender, type Rol } from '@/lib/navegacion';
import { ProformaYContrato } from './ProformaYContrato';

export const metadata: Metadata = { title: 'Contrato' };
export const dynamic = 'force-dynamic';

export default async function ContratoDesdeCotizacion(props: PageProps<'/ventas/cotizaciones/[id]/contrato'>) {
  const { id } = await props.params;
  const cotId = Number(id);
  const supabase = await crearClienteServidor();
  const usuario = await obtenerUsuarioActual();

  const [{ data: cot }, { data: pedido }] = await Promise.all([
    supabase.from('cotizaciones').select('id, numero, estado, aprobada_en').eq('id', cotId).maybeSingle(),
    supabase.from('pedidos').select('id').eq('cotizacion_id', cotId).maybeSingle(),
  ]);
  if (!cot) notFound();
  if (pedido) redirect(`/ventas/pedidos/${pedido.id}/contrato`);

  const volver = { href: `/ventas/cotizaciones/${cotId}`, texto: `Volver a ${cot.numero}` };
  if (!cot.aprobada_en) {
    return (
      <>
        <CabeceraPagina titulo={`Contrato · ${cot.numero}`} volver={volver} />
        <Vacio titulo="Todavía no está aprobada" mensaje="El contrato se genera cuando la cotización está aprobada: es el precio autorizado lo que se firma." />
      </>
    );
  }

  return (
    <>
      <CabeceraPagina titulo={`Contrato · ${cot.numero}`} volver={volver} />
      <Panel titulo="Aprobada · falta la proforma" className="mb-espacio">
        <div style={{ padding: '.9rem 1rem 1.1rem', display: 'grid', gap: '.8rem' }}>
          <p style={{ margin: 0 }}>
            El contrato lleva el número de la proforma (por ejemplo, la proforma SM26-378 da el contrato
            SM-2026-378), y de ella toma la cantidad, el mes de embarque y el puerto. Esta cotización está
            aprobada pero todavía no tiene proforma.
          </p>
          {puedeVender((usuario?.rol ?? 'consulta') as Rol) && !['rechazada', 'vencida'].includes(String(cot.estado)) ? (
            <ProformaYContrato cotizacionId={cotId} />
          ) : (
            <p className="pie-explicativo" style={{ margin: 0 }}>Pídale a Comercial que genere la proforma.</p>
          )}
        </div>
      </Panel>
    </>
  );
}
