/**
 * ============================================================================
 *  REGISTRAR UN AJUSTE, UNA MERMA O UNA MUESTRA
 * ============================================================================
 *  Se llega desde «Ajustes de stock» o desde la ficha del pallet (botón
 *  «Ajustar stock», que trae el pallet ya elegido con ?lote=).
 *
 *  Los motivos salen del catálogo (Configuración → motivos). Cada uno dice
 *  para qué tipo de movimiento sirve (columna tipos_movimiento, migración 069);
 *  los de ámbito «ajuste» sin lista valen para los ajustes que suman y restan.
 * ============================================================================
 */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel } from '@/components/ui/Pagina';
import { FormularioAjuste, type MotivoAjuste } from '../FormularioAjuste';
import { posicionesDePallet, type TipoAjuste } from '../acciones';

export const metadata: Metadata = { title: 'Registrar ajuste' };
export const dynamic = 'force-dynamic';

const PUEDEN = ['gerencia', 'operaciones', 'almacen', 'calidad'];
const TIPOS: TipoAjuste[] = ['ajuste_positivo', 'ajuste_negativo', 'salida_merma', 'salida_muestra'];

export default async function PaginaNuevoAjuste(props: PageProps<'/almacenes/ajustes/nuevo'>) {
  const usuario = await obtenerUsuarioActual();
  if (!PUEDEN.includes(usuario?.rol ?? '')) redirect('/almacenes/ajustes');

  const q = await props.searchParams;
  const loteId = Number(q.lote ?? 0) || 0;
  const almacenId = Number(q.almacen ?? 0) || 0;

  const supabase = await crearClienteServidor();
  const [{ data: filas }, posiciones] = await Promise.all([
    supabase
      .from('motivos')
      .select('id, nombre, ambito, tipos_movimiento, requiere_autorizacion')
      .eq('activo', true)
      .order('nombre'),
    loteId ? posicionesDePallet({ loteId }) : Promise.resolve([]),
  ]);

  const motivos: MotivoAjuste[] = (filas ?? [])
    .map((m) => {
      const lista = (m.tipos_movimiento as string[] | null) ??
        (m.ambito === 'ajuste' ? ['ajuste_positivo', 'ajuste_negativo'] : []);
      return {
        id: m.id as number,
        nombre: m.nombre as string,
        tipos: lista.filter((t): t is TipoAjuste => TIPOS.includes(t as TipoAjuste)),
        requiere_autorizacion: Boolean(m.requiere_autorizacion),
      };
    })
    .filter((m) => m.tipos.length > 0);

  /* Si viene la bodega, se deja solo esa posición; si no, se elige. */
  const iniciales = almacenId ? posiciones.filter((p) => p.almacen_id === almacenId) : posiciones;

  return (
    <>
      <CabeceraPagina
        titulo="Registrar ajuste, merma o muestra"
        descripcion="Cada registro es un movimiento nuevo del Kardex, con su motivo y quién lo hizo. El stock y el valor del pallet se actualizan al instante; lo anterior no se borra."
        volver={{ href: '/almacenes/ajustes', texto: 'Volver a ajustes' }}
      />
      <Panel>
        <FormularioAjuste
          motivos={motivos}
          rol={usuario?.rol ?? 'consulta'}
          posicionesIniciales={iniciales}
        />
      </Panel>
    </>
  );
}
