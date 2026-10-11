/**
 * ============================================================================
 *  MÓDULOS QUE SE PUEDEN APAGAR SIN BORRARLOS
 * ============================================================================
 *  Observaciones ERP (oct. 2026), punto 16: «Ocultar temporalmente Objetivos
 *  Mensuales del menú y de la navegación, sin eliminar datos ni configuración,
 *  de modo que pueda reactivarse posteriormente».
 *
 *  Es un parámetro (`modulo_objetivos_activo`), no código comentado: volver a
 *  mostrarlo es un clic en Configuración, y los datos, metas y permisos de
 *  Marco y Oliver siguen donde estaban.
 * ============================================================================
 */
import type { crearClienteServidor } from '@/lib/supabase/servidor';

type Cliente = Awaited<ReturnType<typeof crearClienteServidor>>;

/** ¿Está visible el módulo Objetivos mensuales? Ante la duda, oculto: es lo que se pidió. */
export async function objetivosActivo(supabase: Cliente): Promise<boolean> {
  const { data } = await supabase
    .from('parametros').select('valor').eq('clave', 'modulo_objetivos_activo').maybeSingle();
  return String(data?.valor ?? 'no').trim().toLowerCase() === 'si';
}
