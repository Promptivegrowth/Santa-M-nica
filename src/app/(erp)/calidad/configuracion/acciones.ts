'use server';

/**
 * ============================================================================
 *  CONFIGURACIÓN DEL PORTAL Y DE LOS RECLAMOS (090)
 * ============================================================================
 *  Quién configura qué, según la tabla de roles de la propuesta:
 *    · Motivos y clasificaciones con su plazo: Calidad y Gerencia.
 *    · Plantillas de correo: Gerencia todas; Calidad las de reclamos.
 *    · Hitos de la línea de tiempo: Gerencia (y Operaciones).
 *    · Contraseña de la cuenta de seguimiento: solo Gerencia.
 *  Se escribe con la sesión del usuario: las políticas de la base son la
 *  última palabra. Aquí se avisa antes, con palabras.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { traducirErrorBase, rolNoPuede } from '@/lib/mensajesBase';

export type Resultado = { ok: boolean; mensaje: string };

const RUTA = '/calidad/configuracion';
const CONFIGURAN_RECLAMOS = ['gerencia', 'calidad'];

async function conPermiso(roles: string[], que: string) {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { error: 'Su sesión caducó. Vuelva a entrar.' } as const;
  if (!roles.includes(usuario.rol)) return { error: rolNoPuede(usuario.rol, que, roles) } as const;
  return { usuario, supabase: await crearClienteServidor() } as const;
}

export type Motivo = { id: number | null; nombre_es: string; nombre_en: string; activo: boolean; orden: number };

export async function guardarMotivo(m: Motivo): Promise<Resultado> {
  const p = await conPermiso(CONFIGURAN_RECLAMOS, 'configurar los motivos de reclamo');
  if ('error' in p) return { ok: false, mensaje: p.error! };
  if (m.nombre_es.trim().length < 3 || m.nombre_en.trim().length < 3) {
    return { ok: false, mensaje: 'Escriba el motivo en español y en inglés (lo ve el cliente en el portal).' };
  }
  const fila = { nombre_es: m.nombre_es.trim(), nombre_en: m.nombre_en.trim(), activo: m.activo, orden: Math.trunc(m.orden) || 0 };
  const { data, error } = m.id
    ? await p.supabase.from('reclamo_motivos').update(fila).eq('id', m.id).select('id')
    : await p.supabase.from('reclamo_motivos').insert(fila).select('id');
  if (error || !data?.length) return { ok: false, mensaje: traducirErrorBase(error, { que: 'guardar el motivo', quien: CONFIGURAN_RECLAMOS }) };
  revalidatePath(RUTA);
  return { ok: true, mensaje: 'Motivo guardado.' };
}

export type Clasificacion = { id: number | null; nombre: string; plazo_dias: number; activo: boolean; orden: number };

export async function guardarClasificacion(c: Clasificacion): Promise<Resultado> {
  const p = await conPermiso(CONFIGURAN_RECLAMOS, 'configurar las clasificaciones de reclamo');
  if ('error' in p) return { ok: false, mensaje: p.error! };
  if (c.nombre.trim().length < 3) return { ok: false, mensaje: 'Escriba el nombre de la clasificación.' };
  const plazo = Math.trunc(c.plazo_dias);
  if (!(plazo >= 1 && plazo <= 365)) return { ok: false, mensaje: 'El plazo va de 1 a 365 días.' };
  const fila = { nombre: c.nombre.trim(), plazo_dias: plazo, activo: c.activo, orden: Math.trunc(c.orden) || 0 };
  const { data, error } = c.id
    ? await p.supabase.from('reclamo_clasificaciones').update(fila).eq('id', c.id).select('id')
    : await p.supabase.from('reclamo_clasificaciones').insert(fila).select('id');
  if (error || !data?.length) return { ok: false, mensaje: traducirErrorBase(error, { que: 'guardar la clasificación', quien: CONFIGURAN_RECLAMOS }) };
  revalidatePath(RUTA);
  return { ok: true, mensaje: 'Clasificación guardada. El plazo nuevo vale para los reclamos que se clasifiquen desde ahora.' };
}

export async function guardarPlantilla(d: { clave: string; idioma: string; asunto: string; cuerpo: string }): Promise<Resultado> {
  const roles = d.clave.startsWith('reclamo') ? CONFIGURAN_RECLAMOS : ['gerencia'];
  const p = await conPermiso(roles, 'editar esta plantilla de correo');
  if ('error' in p) return { ok: false, mensaje: p.error! };
  if (d.asunto.trim().length < 3 || d.cuerpo.trim().length < 10) return { ok: false, mensaje: 'Escriba el asunto y el texto del correo.' };
  if (d.clave === 'accesos' && !d.cuerpo.includes('{{llave}}')) {
    return { ok: false, mensaje: 'El correo de accesos tiene que llevar {{llave}}: es el único medio por el que el cliente la recibe.' };
  }
  if (d.clave.startsWith('reclamo') && /\{\{\s*llave\s*\}\}/.test(d.asunto + d.cuerpo)) {
    return { ok: false, mensaje: 'Los correos de reclamos nunca llevan la Llave de seguimiento.' };
  }
  const { data, error } = await p.supabase.from('plantillas_correo')
    .update({ asunto: d.asunto.trim(), cuerpo: d.cuerpo.replace(/\r\n/g, '\n').trim(), actualizado_en: new Date().toISOString(), actualizado_por: p.usuario.id })
    .eq('clave', d.clave).eq('idioma', d.idioma).select('clave');
  if (error || !data?.length) return { ok: false, mensaje: traducirErrorBase(error, { que: 'guardar la plantilla', quien: roles }) };
  revalidatePath(RUTA);
  return { ok: true, mensaje: 'Plantilla guardada. Los próximos correos salen con este texto.' };
}

export async function guardarHito(h: { clave: string; etiqueta_es: string; etiqueta_en: string; visible: boolean; orden: number }): Promise<Resultado> {
  const p = await conPermiso(['gerencia', 'operaciones'], 'configurar los hitos del portal');
  if ('error' in p) return { ok: false, mensaje: p.error! };
  if (!h.etiqueta_es.trim() || !h.etiqueta_en.trim()) return { ok: false, mensaje: 'Escriba el nombre del hito en español y en inglés.' };
  const { data, error } = await p.supabase.from('portal_hitos')
    .update({ etiqueta_es: h.etiqueta_es.trim(), etiqueta_en: h.etiqueta_en.trim(), visible: h.visible, orden: Math.trunc(h.orden) || 0 })
    .eq('clave', h.clave).select('clave');
  if (error || !data?.length) return { ok: false, mensaje: traducirErrorBase(error, { que: 'guardar el hito', quien: ['gerencia', 'operaciones'] }) };
  revalidatePath(RUTA);
  return { ok: true, mensaje: 'Hito guardado. El portal ya lo muestra así.' };
}

export async function cambiarClavePortal(clave: string): Promise<Resultado> {
  const p = await conPermiso(['gerencia'], 'cambiar la contraseña de la cuenta de seguimiento');
  if ('error' in p) return { ok: false, mensaje: p.error! };
  const { error } = await p.supabase.rpc('portal_cuenta_cambiar_clave', { p_clave: clave });
  if (error) return { ok: false, mensaje: traducirErrorBase(error, { que: 'cambiar la contraseña', quien: ['gerencia'] }) };
  revalidatePath(RUTA);
  return {
    ok: true,
    mensaje: 'Contraseña cambiada. Se cerraron las sesiones abiertas del portal; los próximos correos de accesos llevan la nueva. ' +
      'Avise a los clientes que ya tenían la anterior (reenvíe los accesos desde cada proforma).',
  };
}
