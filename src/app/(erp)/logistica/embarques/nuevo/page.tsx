/**
 * PROGRAMAR UN EMBARQUE
 * Trae los catálogos y los pedidos que tienen stock apartado esperando salir.
 */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel } from '@/components/ui/Pagina';
import { FormularioEmbarque } from './FormularioEmbarque';
import { pedidosParaEmbarcar } from '../acciones';

export const metadata: Metadata = { title: 'Nuevo embarque' };
export const dynamic = 'force-dynamic';

const PUEDEN = ['gerencia', 'operaciones', 'comex', 'almacen'];

export default async function PaginaNuevoEmbarque() {
  const usuario = await obtenerUsuarioActual();
  if (!PUEDEN.includes(usuario?.rol ?? '')) redirect('/logistica/embarques');

  const supabase = await crearClienteServidor();
  const [
    { data: almacenes }, { data: destinos }, { data: transportistas },
    { data: vehiculos }, { data: conductores },
  ] = await Promise.all([
    supabase.from('almacenes').select('id, nombre').eq('activo', true).order('nombre'),
    supabase.from('destinos').select('id, puerto, pais').eq('activo', true).order('puerto'),
    supabase.from('transportistas').select('id, razon_social').eq('activo', true).order('razon_social'),
    supabase.from('vehiculos').select('id, placa, soat_vence, revision_vence').eq('activo', true).order('placa'),
    supabase.from('conductores').select('id, nombre').eq('activo', true).order('nombre'),
  ]);

  const primerAlmacen = Number(almacenes?.[0]?.id ?? 0);
  const pedidos = await pedidosParaEmbarcar(primerAlmacen);
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });

  return (
    <>
      <CabeceraPagina
        titulo="Programar embarque"
        descripcion="La salida: qué día, desde qué bodega y hacia qué puerto. Después se le crea el contenedor y se le carga la mercadería."
        volver={{ href: '/logistica/embarques', texto: 'Volver a embarques' }}
      />
      <Panel>
        <FormularioEmbarque
          almacenes={(almacenes ?? []).map((a) => ({ id: a.id as number, nombre: a.nombre as string }))}
          destinos={(destinos ?? []).map((x) => ({
            id: x.id as number, puerto: x.puerto as string, pais: (x.pais as string) ?? '',
          }))}
          transportistas={(transportistas ?? []).map((t) => ({
            id: t.id as number, nombre: t.razon_social as string,
          }))}
          vehiculos={(vehiculos ?? []).map((v) => ({
            id: v.id as number,
            placa: v.placa as string,
            soat: (v.soat_vence as string) ?? null,
            revision: (v.revision_vence as string) ?? null,
          }))}
          conductores={(conductores ?? []).map((c) => ({ id: c.id as number, nombre: c.nombre as string }))}
          pedidos={pedidos}
          hoy={hoy}
        />
      </Panel>
    </>
  );
}
