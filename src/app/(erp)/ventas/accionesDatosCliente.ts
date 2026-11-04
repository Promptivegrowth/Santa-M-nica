'use server';

/**
 * ============================================================================
 *  «ACTUALIZAR CON LA FICHA DEL CLIENTE» (migración 085)
 * ============================================================================
 *  La cotización fija los datos fiscales del cliente al emitirse y el pedido
 *  los hereda (punto 01 de «Observaciones ERP 4»). Si después se corrige la
 *  ficha del cliente —como pasó con la carga de la lista BASC—, el documento
 *  no cambia por debajo: su ficha avisa y esta acción vuelve a copiar los
 *  datos, con constancia en el historial.
 *
 *  Lo hacen quienes venden. En un pedido, solo mientras no tenga un
 *  comprobante vigente: el comprobante ya salió con los datos de antes. La
 *  regla la aplica la base (actualizar_datos_cliente_documento).
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { puedeVender, type Rol } from '@/lib/navegacion';
import { nombreRol, listaDeRoles } from '@/lib/permisosVentas';

const VENDEN: Rol[] = ['gerencia', 'operaciones', 'comercial', 'comex'];

export async function actualizarDatosCliente(
  tipo: 'cotizacion' | 'pedido',
  id: number,
): Promise<{ ok: boolean; mensaje: string }> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró. Vuelva a iniciar sesión.' };
  if (!puedeVender(usuario.rol as Rol)) {
    return {
      ok: false,
      mensaje: `${nombreRol(usuario.rol)} no actualiza los datos del cliente en los documentos: lo hacen ${listaDeRoles(VENDEN)}.`,
    };
  }
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc('actualizar_datos_cliente_documento', { p_tipo: tipo, p_id: id });
  if (error) {
    const m = String(error.message ?? '');
    return {
      ok: false,
      mensaje: m && !/violates|constraint|column|relation|syntax|function/i.test(m)
        ? m
        : 'No se pudieron actualizar los datos del cliente. Vuelva a intentarlo; si se repite, avise a Sistemas.',
    };
  }
  if (tipo === 'cotizacion') {
    revalidatePath(`/ventas/cotizaciones/${id}`);
  } else {
    revalidatePath(`/ventas/pedidos/${id}`);
    revalidatePath(`/ventas/pedidos/${id}/contrato`);
  }
  return { ok: true, mensaje: String(data ?? 'Listo.') };
}
