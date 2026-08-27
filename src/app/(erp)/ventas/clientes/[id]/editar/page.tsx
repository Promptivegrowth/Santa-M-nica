/**
 * ============================================================================
 *  EDICIÓN DE CLIENTE
 * ============================================================================
 *  Usa el mismo formulario que el alta. Si el cliente no existe, devuelve 404
 *  de verdad —no una pantalla vacía—, que es lo que espera cualquiera que
 *  llegue por un enlace viejo.
 * ============================================================================
 */
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel } from '@/components/ui/Pagina';
import { FormularioCliente, type ClienteExistente } from '../../FormularioCliente';

export const metadata: Metadata = { title: 'Editar cliente' };
export const dynamic = 'force-dynamic';

const PUEDEN = ['gerencia', 'operaciones', 'comercial'];

export default async function PaginaEditarCliente(
  props: PageProps<'/ventas/clientes/[id]/editar'>
) {
  const { id } = await props.params;
  const usuario = await obtenerUsuarioActual();
  if (!PUEDEN.includes(usuario?.rol ?? '')) redirect(`/ventas/clientes/${id}`);

  const numero = Number(id);
  if (!Number.isFinite(numero)) notFound();

  const supabase = await crearClienteServidor();
  const [{ data: cliente }, { data: filas }, { data: vendedores }] = await Promise.all([
    supabase.from('clientes').select('*').eq('id', numero).maybeSingle(),
    supabase.from('clientes').select('pais').eq('activo', true),
    supabase.from('vendedores').select('id, nombre').eq('activo', true).order('nombre'),
  ]);

  if (!cliente) notFound();

  const paises = [...new Set((filas ?? []).map((f) => f.pais as string).filter(Boolean))].sort();

  const datos: ClienteExistente = {
    id: cliente.id as number,
    activo: Boolean(cliente.activo),
    codigo: (cliente.codigo as string) ?? '',
    razon_social: (cliente.razon_social as string) ?? '',
    nombre_corto: (cliente.nombre_corto as string) ?? '',
    tipo: (cliente.tipo as 'final' | 'intermediario') ?? 'final',
    pais: (cliente.pais as string) ?? '',
    ruc_tax_id: (cliente.ruc_tax_id as string) ?? '',
    contacto: (cliente.contacto as string) ?? '',
    email: (cliente.email as string) ?? '',
    telefono: (cliente.telefono as string) ?? '',
    vendedor_id: (cliente.vendedor_id as number) ?? null,
    moneda: (cliente.moneda as 'USD' | 'PEN') ?? 'PEN',
    linea_credito: Number(cliente.linea_credito ?? 0),
    dias_credito: Number(cliente.dias_credito ?? 0),
    bloqueado: Boolean(cliente.bloqueado),
    motivo_bloqueo: (cliente.motivo_bloqueo as string) ?? '',
  };

  return (
    <>
      <CabeceraPagina
        titulo={`Editar ${datos.razon_social}`}
        descripcion="Los cambios quedan registrados en la bitácora, campo por campo: quién los hizo, cuándo y qué había antes."
      />
      <Panel>
        <FormularioCliente cliente={datos} paises={paises}
          vendedores={(vendedores ?? []).map((v) => ({ id: v.id as number, nombre: v.nombre as string }))} />
      </Panel>
    </>
  );
}
