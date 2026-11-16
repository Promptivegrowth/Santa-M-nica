/**
 * ============================================================================
 *  «VER COMO CLIENTE» · la proforma tal como la verá el cliente en el portal
 * ============================================================================
 *  Plus del módulo M3: Comercial revisa lo que verá el cliente antes de
 *  enviarle los accesos. Los datos salen de la MISMA función que usa el
 *  portal (portal_vista_empleado → privado.datos_portal), así que lo que se
 *  ve aquí es exactamente lo que verá él: sin montos ni datos internos.
 * ============================================================================
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel, Vacio } from '@/components/ui/Pagina';
import { VistaPortal } from '@/components/portal/VistaPortal';
import type { DatosPortal } from '@/lib/portal/servidor';
import { nombreRol, listaDeRoles } from '@/lib/permisosVentas';
import type { Rol } from '@/lib/navegacion';

export const dynamic = 'force-dynamic';

const VEN_COMO_CLIENTE: Rol[] = ['gerencia', 'operaciones', 'comercial', 'comex', 'calidad'];

export async function generateMetadata(props: PageProps<'/ventas/pedidos/[id]/portal'>): Promise<Metadata> {
  const { id } = await props.params;
  const supabase = await crearClienteServidor();
  const { data } = await supabase.from('pedidos').select('numero_proforma').eq('id', Number(id)).single();
  return { title: `Vista del cliente · ${data?.numero_proforma ?? 'Pedido'}` };
}

export default async function VistaDelCliente(props: PageProps<'/ventas/pedidos/[id]/portal'>) {
  const { id } = await props.params;
  const q = await props.searchParams;
  const pedidoId = Number(id);
  if (!Number.isInteger(pedidoId) || pedidoId <= 0) notFound();
  const idioma = q.idioma === 'en' ? 'en' : 'es';

  const [usuario, supabase] = await Promise.all([obtenerUsuarioActual(), crearClienteServidor()]);
  const { data: pedido } = await supabase.from('pedidos').select('numero_proforma').eq('id', pedidoId).maybeSingle();
  if (!pedido) notFound();
  const volver = { href: `/ventas/pedidos/${pedidoId}?t=portal`, texto: `Volver a ${pedido.numero_proforma}` };

  if (!VEN_COMO_CLIENTE.includes((usuario?.rol ?? 'consulta') as Rol)) {
    return (
      <>
        <CabeceraPagina titulo="Vista del cliente" volver={volver} />
        <Panel>
          <Vacio
            titulo="Esta vista no está disponible para su rol"
            mensaje={`${nombreRol(usuario?.rol)} no revisa el portal de clientes: lo hacen ${listaDeRoles(VEN_COMO_CLIENTE)}.`}
          />
        </Panel>
      </>
    );
  }

  const { data, error } = await supabase.rpc('portal_vista_empleado', { p_pedido_id: pedidoId, p_idioma: idioma });
  const datos = data as DatosPortal | null;

  return (
    <>
      <CabeceraPagina
        titulo={`Vista del cliente · ${pedido.numero_proforma}`}
        descripcion="Lo mismo que verá el cliente en el portal de seguimiento después de escribir sus 3 datos."
        volver={volver}
      >
        <Link
          href={`/ventas/pedidos/${pedidoId}/portal?idioma=${idioma === 'en' ? 'es' : 'en'}`}
          className="btn btn-secundario"
          data-enlace="cambiar-idioma"
        >
          {idioma === 'en' ? 'Ver en español' : 'View in English'}
        </Link>
      </CabeceraPagina>

      <p className="pt-banda-previa" role="note" data-bloque="vista-previa">
        Vista previa: así verá el cliente esta proforma en el portal. Los botones del cliente (generar reclamo,
        descargar PDF) están desactivados aquí.
      </p>

      {error || !datos ? (
        <Panel>
          <Vacio titulo="No se pudo armar la vista del cliente" mensaje={error?.message ?? 'La proforma no existe.'} />
        </Panel>
      ) : (
        <VistaPortal datos={datos} idioma={idioma} vistaPrevia />
      )}
    </>
  );
}
