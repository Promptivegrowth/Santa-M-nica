/**
 * ALTA DE PRODUCTO
 * El código se propone ya calculado. Las especies y las presentaciones salen
 * de sus catálogos; los formatos se cargan al elegir la especie.
 */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel } from '@/components/ui/Pagina';
import { FormularioProducto, type Presentacion } from '../FormularioProducto';
import { siguienteCodigoProducto, clasificacionesUsadas } from '../accionesMaestro';

export const metadata: Metadata = { title: 'Nuevo producto' };
export const dynamic = 'force-dynamic';

const PUEDEN = ['gerencia', 'operaciones', 'comercial'];

export default async function PaginaNuevoProducto() {
  const usuario = await obtenerUsuarioActual();
  if (!PUEDEN.includes(usuario?.rol ?? '')) redirect('/ventas/productos');

  const supabase = await crearClienteServidor();
  const [codigo, clasificaciones, { data: especies }, { data: presentaciones }] = await Promise.all([
    siguienteCodigoProducto(),
    clasificacionesUsadas(),
    supabase.from('especies').select('id, nombre').eq('activo', true).order('nombre'),
    supabase.from('presentaciones').select('id, codigo, descripcion, peso_bulto_kg, congelamiento')
      .eq('activo', true).order('descripcion'),
  ]);

  return (
    <>
      <CabeceraPagina
        titulo="Nuevo producto"
        descripcion="Un producto son dos cosas: qué es —especie, formato y corte— y en qué presentaciones se vende. Hacen falta las dos para poder cotizarlo."
      />
      <Panel>
        <FormularioProducto
          codigoPropuesto={codigo}
          especies={(especies ?? []).map((e) => ({ id: e.id as number, nombre: e.nombre as string }))}
          formatosIniciales={[]}
          clasificaciones={clasificaciones}
          presentaciones={(presentaciones ?? []).map((p) => ({
            id: p.id as number,
            codigo: p.codigo as string,
            descripcion: p.descripcion as string,
            peso_bulto_kg: Number(p.peso_bulto_kg),
            congelamiento: p.congelamiento as string,
          })) as Presentacion[]}
        />
      </Panel>
    </>
  );
}
