/**
 * ============================================================================
 *  NUEVO TRASLADO
 * ============================================================================
 *  Arma un traslado en borrador entre dos bodegas. Trae de una vez las
 *  bodegas y el transporte (son pocos); los pallets se piden al elegir el
 *  origen, porque dependen de él.
 *
 *  Lo crean Gerencia, Operaciones y Almacén (los mismos que pueden solicitar
 *  un traslado en la acción del servidor). Los demás vuelven a la lista.
 * ============================================================================
 */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel } from '@/components/ui/Pagina';
import { hoyEnLima } from '@/lib/fechas';
import { FormularioTraslado } from '../FormularioTraslado';

export const metadata: Metadata = { title: 'Nuevo traslado' };
export const dynamic = 'force-dynamic';

const PUEDEN = ['gerencia', 'operaciones', 'almacen'];

export default async function PaginaNuevoTraslado() {
  const usuario = await obtenerUsuarioActual();
  if (!PUEDEN.includes(usuario?.rol ?? '')) redirect('/almacenes/traslados');

  const supabase = await crearClienteServidor();
  const [{ data: almacenes }, { data: transportistas }, { data: vehiculos }, { data: conductores }] =
    await Promise.all([
      supabase.from('almacenes').select('id, nombre').eq('activo', true).order('nombre'),
      supabase.from('transportistas').select('id, razon_social').eq('activo', true).order('razon_social'),
      supabase.from('vehiculos').select('id, placa, transportista_id').eq('activo', true).order('placa'),
      supabase.from('conductores').select('id, nombre, transportista_id').eq('activo', true).order('nombre'),
    ]);

  return (
    <>
      <CabeceraPagina
        titulo="Nuevo traslado"
        descripcion="Elija de qué bodega sale, a cuál va y qué pallets lleva. Se crea en borrador: no se mueve nada hasta que se autorice y se despache."
        volver={{ href: '/almacenes/traslados', texto: 'Volver a traslados' }}
      />
      <Panel>
        <FormularioTraslado
          almacenes={(almacenes ?? []).map((a) => ({ id: a.id as number, nombre: a.nombre as string }))}
          transportistas={(transportistas ?? []).map((t) => ({ id: t.id as number, nombre: t.razon_social as string }))}
          vehiculos={(vehiculos ?? []).map((v) => ({
            id: v.id as number, placa: v.placa as string, transportista_id: (v.transportista_id as number | null) ?? null,
          }))}
          conductores={(conductores ?? []).map((c) => ({
            id: c.id as number, nombre: c.nombre as string, transportista_id: (c.transportista_id as number | null) ?? null,
          }))}
          hoy={hoyEnLima()}
        />
      </Panel>
    </>
  );
}
