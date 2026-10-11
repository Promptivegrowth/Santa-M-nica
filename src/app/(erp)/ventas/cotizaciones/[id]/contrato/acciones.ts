'use server';

/**
 * ============================================================================
 *  ACCIONES DEL CONTRATO (observaciones de octubre, punto 8)
 * ============================================================================
 *  Generar guarda el TEXTO FINAL —el que se revisó en pantalla, con lo que se
 *  le haya corregido— con su número. Si mañana cambia la plantilla, este
 *  contrato sigue diciendo lo mismo: es lo que se firmó.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { puedeVender, type Rol } from '@/lib/navegacion';

type Resultado = { ok: true; id: number; numero: string; mensaje: string } | { ok: false; mensaje: string };

export async function generarContrato(cotizacionId: number, titulo: string, cuerpo: string): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró.' };
  if (!puedeVender(usuario.rol as Rol)) return { ok: false, mensaje: 'Su rol no puede generar contratos.' };

  const t = titulo.trim();
  const c = cuerpo.trim();
  if (t.length < 3) return { ok: false, mensaje: 'El contrato necesita un título.' };
  if (c.length < 50) return { ok: false, mensaje: 'El texto del contrato está vacío o es demasiado corto.' };
  //  Un marcador sin llenar en un contrato que se va a firmar es un error, no un detalle.
  const pendientes = c.match(/\{\{\s*[a-z_]+\s*\}\}/gi);
  if (pendientes) {
    return { ok: false, mensaje: `Quedan datos sin completar: ${[...new Set(pendientes)].join(', ')}. Corríjalos en el texto antes de generar.` };
  }

  const supabase = await crearClienteServidor();
  const { data: cot } = await supabase
    .from('cotizaciones').select('numero, aprobada_en, estado').eq('id', cotizacionId).maybeSingle();
  if (!cot) return { ok: false, mensaje: 'Esa cotización ya no existe.' };
  if (!cot.aprobada_en) {
    return { ok: false, mensaje: `${cot.numero} todavía no está aprobada: el contrato se genera sobre un precio autorizado.` };
  }
  if (['rechazada', 'vencida'].includes(String(cot.estado))) {
    return { ok: false, mensaje: `${cot.numero} está ${cot.estado}: no corresponde un contrato.` };
  }

  const anio = new Date().getFullYear();
  const { data: n, error: errNum } = await supabase.rpc('siguiente_correlativo', { p_serie: 'CTR', p_anio: anio });
  if (errNum || !n) return { ok: false, mensaje: 'No se pudo reservar el número del contrato. Vuelva a intentarlo.' };
  const numero = `CTR-${anio}-${String(n).padStart(4, '0')}`;

  const { data, error } = await supabase
    .from('contratos')
    .insert({ numero, cotizacion_id: cotizacionId, titulo: t, cuerpo: c, generado_por: usuario.id })
    .select('id')
    .single();
  if (error || !data) return { ok: false, mensaje: `No se pudo guardar el contrato: ${error?.message ?? 'sin permiso'}` };

  await supabase.rpc('registrar_evento', {
    p_entidad: 'cotizaciones',
    p_entidad_id: cotizacionId,
    p_tipo: 'contrato_generado',
    p_descripcion: `${usuario.nombre} generó el contrato ${numero} desde la cotización ${cot.numero}.`,
    p_severidad: 'info',
  }).then(() => undefined, () => undefined);

  revalidatePath(`/ventas/cotizaciones/${cotizacionId}`);
  revalidatePath(`/ventas/cotizaciones/${cotizacionId}/contrato`);
  return { ok: true, id: Number(data.id), numero, mensaje: `Contrato ${numero} generado. Ya se puede descargar.` };
}

/** La plantilla institucional. Solo Gerencia la cambia (la base también lo exige). */
export async function guardarPlantillaContrato(titulo: string, cuerpo: string): Promise<{ ok: boolean; mensaje: string }> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró.' };
  if (usuario.rol !== 'gerencia') return { ok: false, mensaje: 'Solo Gerencia puede cambiar la plantilla del contrato.' };
  if (titulo.trim().length < 3 || cuerpo.trim().length < 50) {
    return { ok: false, mensaje: 'La plantilla necesita título y un texto de al menos 50 caracteres.' };
  }
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase
    .from('plantillas_documento')
    .update({ titulo: titulo.trim(), cuerpo: cuerpo.trim(), actualizado_por: usuario.id, actualizado_en: new Date().toISOString() })
    .eq('clave', 'contrato_venta')
    .select('clave');
  if (error) return { ok: false, mensaje: `No se pudo guardar: ${error.message}` };
  if (!data?.length) return { ok: false, mensaje: 'No tiene permiso para cambiar la plantilla.' };
  revalidatePath('/ventas/cotizaciones', 'layout');
  return { ok: true, mensaje: 'Plantilla guardada. Los contratos nuevos ya la usan; los generados no cambian.' };
}
