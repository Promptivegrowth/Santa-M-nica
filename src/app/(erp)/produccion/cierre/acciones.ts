'use server';

/**
 * ============================================================================
 *  CIERRE SEMANAL DE PRODUCCIÓN · guardar un dato
 * ============================================================================
 *  Escriben Marco y Oliver (permiso de Objetivos, 060). Planes y materia prima
 *  real en todas las categorías; producción, stock y ventas solo en las que el
 *  ERP no conoce (harinas residuales) —la base rechaza lo demás (063)—.
 *  Vacío quita el dato. El historial lo escribe un disparador.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';

export type Resultado = { ok: true; mensaje: string } | { ok: false; mensaje: string };
const CAMPOS = ['plan_mp', 'real_mp', 'plan_prod', 'plan_ventas', 'real_prod', 'stock_inicial', 'ventas'];

export async function guardarDatoCierre(d: {
  categoria_id: number; anio: number; mes: number; campo: string; valor: number | null;
}): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión caducó. Vuelva a entrar.' };
  if (usuario.ve_objetivos !== true) return { ok: false, mensaje: 'El cierre de producción es solo para las personas autorizadas.' };
  if (!CAMPOS.includes(d.campo)) return { ok: false, mensaje: 'Dato no válido.' };
  if (!Number.isInteger(d.mes) || d.mes < 1 || d.mes > 12) return { ok: false, mensaje: 'Mes no válido.' };
  if (d.valor !== null && (!Number.isFinite(d.valor) || d.valor < 0)) {
    return { ok: false, mensaje: 'Las toneladas tienen que ser un número mayor o igual que cero.' };
  }

  const supabase = await crearClienteServidor();
  const clave = { categoria_id: d.categoria_id, anio: d.anio, mes: d.mes, campo: d.campo };
  const { error } = d.valor === null
    ? await supabase.from('cierre_valores').delete().match(clave)
    : await supabase.from('cierre_valores').upsert(
        { ...clave, valor: d.valor, registrado_por: usuario.id, actualizado_en: new Date().toISOString() },
        { onConflict: 'categoria_id,anio,mes,campo' });
  if (error) return { ok: false, mensaje: error.message.replace(/^.*?ERROR:\s*/, '') };

  //  Se relee: una escritura que la política rechaza no da error.
  const { data: verif } = await supabase.from('cierre_valores').select('valor').match(clave).maybeSingle();
  const quedo = verif ? Number(verif.valor) : null;
  if ((d.valor === null) !== (quedo === null) || (d.valor !== null && Math.abs(quedo! - d.valor) > 0.0005)) {
    return { ok: false, mensaje: 'El dato no llegó a guardarse. Avise a soporte.' };
  }
  revalidatePath('/produccion/cierre');
  return { ok: true, mensaje: 'Guardado.' };
}
