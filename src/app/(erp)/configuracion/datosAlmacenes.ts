/**
 * ============================================================================
 *  MAESTRO DE ALMACENES · los datos de la tabla
 * ============================================================================
 *  Cada almacén con lo que admite (074), sus cámaras, su stock y cuánta
 *  historia tiene: es lo que decide si se puede desactivar (sin stock) o
 *  borrar (sin historia), y la tabla lo explica en vez de esconder el botón.
 * ============================================================================
 */
import type { crearClienteServidor } from '@/lib/supabase/servidor';
import { traerTodo } from '@/lib/traerTodo';
import type { FilaAlmacen } from './GestionAlmacenes';

export async function cargarAlmacenes(supabase: Awaited<ReturnType<typeof crearClienteServidor>>): Promise<FilaAlmacen[]> {
  const [{ data: almacenes }, { data: camaras }, existencias] = await Promise.all([
    supabase.from('almacenes')
      .select('id, codigo, nombre, tipo, operador, ciudad, capacidad_tm, despachos_dia_max, recibe_produccion, recibe_compras, activo')
      .order('activo', { ascending: false }).order('nombre'),
    supabase.from('camaras').select('almacen_id, nombre').eq('activo', true),
    traerTodo<{ almacen_id: number; peso_neto_kg: number }>((d, h) =>
      supabase.from('existencias').select('almacen_id, peso_neto_kg').gt('peso_neto_kg', 0).order('lote_id').range(d, h)),
  ]);

  return Promise.all((almacenes ?? []).map(async (a) => {
    const id = Number(a.id);
    const { count } = await supabase.from('movimientos').select('id', { count: 'exact', head: true }).eq('almacen_id', id);
    return {
      id,
      codigo: String(a.codigo),
      nombre: String(a.nombre),
      tipo: a.tipo as FilaAlmacen['tipo'],
      operador: (a.operador as string) ?? '',
      ciudad: (a.ciudad as string) ?? '',
      capacidad_tm: a.capacidad_tm === null ? null : Number(a.capacidad_tm),
      despachos_dia_max: Number(a.despachos_dia_max),
      recibe_produccion: Boolean(a.recibe_produccion),
      recibe_compras: Boolean(a.recibe_compras),
      activo: Boolean(a.activo),
      camaras: (camaras ?? []).filter((c) => Number(c.almacen_id) === id).map((c) => String(c.nombre)),
      stock_kg: existencias.filter((e) => Number(e.almacen_id) === id).reduce((s, e) => s + Number(e.peso_neto_kg), 0),
      movimientos: count ?? 0,
    };
  }));
}
