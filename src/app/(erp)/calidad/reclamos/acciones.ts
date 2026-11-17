'use server';

/**
 * ============================================================================
 *  ACCIONES DE LA BANDEJA DE RECLAMOS (090, M5–M6)
 * ============================================================================
 *  Atender (estado, clasificación y plazo, causa, acciones correctivas) y
 *  cerrar con el PDF de respuesta. Las dos las vuelve a comprobar la base:
 *  reclamo_actualizar y reclamo_cerrar solo dejan pasar a Calidad y Gerencia.
 *
 *  AL CERRAR
 *   1. El PDF ya lo subió el navegador a «respuestas/<id>/…» (bucket reclamos).
 *   2. Se crea un enlace firmado de 100 días: es el que el portal entrega al
 *      cliente que validó sus 3 datos, durante los 3 meses de la propuesta.
 *   3. reclamo_cerrar deja el estado, la conclusión y el historial.
 *   4. Correo de cierre desde reclamos@: con el PDF adjunto si pesa hasta el
 *      límite de Configuración (10 MB); si pesa más, el correo lleva el aviso
 *      para descargarlo del portal. Nunca lleva la Llave de seguimiento.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { traducirErrorBase, rolNoPuede } from '@/lib/mensajesBase';
import { ROLES_ATIENDEN_RECLAMOS } from '@/lib/reclamos';
import { enviarCorreo, leerPlantilla, rellenar, type Adjunto } from '@/lib/correo';

export type Resultado = { ok: boolean; mensaje: string; correo?: { ok: boolean; estado: string; mensaje: string } };

// Algo más que los «3 meses» que el portal ofrece la descarga (portal_descarga
// cuenta 3 meses de calendario, hasta 92 días): el enlace no debe vencer antes.
const VIGENCIA_ENLACE = 100 * 24 * 3600;

export type DatosAtencion = {
  estado: 'pendiente' | 'en_revision' | 'en_investigacion';
  clasificacion_id: number | null;
  causa: string;
  acciones: string;
  nota: string;
  /** Quién lo atiende (Calidad o Gerencia). Sin elegir, la base deja al actual o a quien guarda. */
  responsable_id: string | null;
};

export async function actualizarReclamo(id: number, d: DatosAtencion): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión caducó. Vuelva a entrar.' };
  if (!ROLES_ATIENDEN_RECLAMOS.includes(usuario.rol)) {
    return { ok: false, mensaje: rolNoPuede(usuario.rol, 'atender reclamos', ROLES_ATIENDEN_RECLAMOS) };
  }
  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('reclamo_actualizar', {
    p_id: id, p_estado: d.estado, p_clasificacion_id: d.clasificacion_id,
    p_causa: d.causa, p_acciones: d.acciones, p_nota: d.nota, p_responsable_id: d.responsable_id || null,
  });
  if (error) return { ok: false, mensaje: traducirErrorBase(error, { que: 'guardar la atención del reclamo', quien: ROLES_ATIENDEN_RECLAMOS }) };
  revalidatePath(`/calidad/reclamos/${id}`);
  revalidatePath('/calidad/reclamos');
  return { ok: true, mensaje: 'Atención guardada. Queda en el historial del reclamo.' };
}

export type DatosCierre = {
  ruta: string;
  nombre: string;
  tamano: number;
  alcance: 'proforma' | 'contenedor';
  packing_list_id: number | null;
  conclusion: string;
};

export async function cerrarReclamo(id: number, d: DatosCierre): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión caducó. Vuelva a entrar.' };
  if (!ROLES_ATIENDEN_RECLAMOS.includes(usuario.rol)) {
    return { ok: false, mensaje: rolNoPuede(usuario.rol, 'cerrar reclamos', ROLES_ATIENDEN_RECLAMOS) };
  }
  if (!d.ruta.startsWith(`respuestas/${id}/`)) return { ok: false, mensaje: 'Primero suba el PDF de respuesta.' };

  const supabase = await crearClienteServidor();
  const almacen = supabase.storage.from('reclamos');

  const { data: firmado, error: errFirma } = await almacen.createSignedUrl(d.ruta, VIGENCIA_ENLACE, { download: d.nombre });
  if (errFirma || !firmado?.signedUrl) {
    return { ok: false, mensaje: 'No se encontró el PDF subido. Vuelva a subirlo e inténtelo de nuevo.' };
  }

  const { data: cierre, error } = await supabase.rpc('reclamo_cerrar', {
    p_id: id, p_conclusion: d.conclusion, p_ruta: d.ruta, p_nombre: d.nombre, p_tamano: d.tamano,
    p_alcance: d.alcance, p_packing_list_id: d.alcance === 'contenedor' ? d.packing_list_id : null,
    p_url: firmado.signedUrl,
  });
  if (error) return { ok: false, mensaje: traducirErrorBase(error, { que: 'cerrar el reclamo', quien: ROLES_ATIENDEN_RECLAMOS }) };
  revalidatePath(`/calidad/reclamos/${id}`);
  revalidatePath('/calidad/reclamos');

  /* ---- El correo de cierre ---- */
  const c = cierre as { numero: string; correo: string; nombre: string; idioma: 'es' | 'en'; numero_proforma: string };
  const { data: params } = await supabase.from('parametros').select('clave, valor')
    .in('clave', ['correo_adjunto_max_mb', 'portal_url']);
  const param = (k: string) => (params ?? []).find((p) => p.clave === k)?.valor as string | undefined;
  const maxMb = Number(param('correo_adjunto_max_mb') ?? 10) || 10;
  const portalUrl = param('portal_url') || 'https://clientes.santamonicafishing.com';
  const en = c.idioma === 'en';

  let adjuntos: Adjunto[] = [];
  if (d.tamano <= maxMb * 1024 * 1024) {
    const { data: archivo } = await almacen.download(d.ruta);
    if (archivo) adjuntos = [{ nombre: d.nombre, contenido: Buffer.from(await archivo.arrayBuffer()), tipo: 'application/pdf' }];
  }
  const notaPdf = adjuntos.length
    ? (en ? 'The response PDF is attached. You can also download it from the tracking portal for 3 months.'
          : 'Adjuntamos el PDF de respuesta. También puede descargarlo del portal de seguimiento durante 3 meses.')
    : (en ? `The response PDF is too large to attach: download it from the tracking portal (${portalUrl}) within the next 3 months.`
          : `El PDF de respuesta pesa demasiado para adjuntarlo: descárguelo del portal de seguimiento (${portalUrl}) en los próximos 3 meses.`);

  let correo: Resultado['correo'];
  try {
    const plantilla = await leerPlantilla(supabase, 'reclamo_cierre', c.idioma);
    const valores = { numero: c.numero, nombre: c.nombre, numero_proforma: c.numero_proforma, conclusion: d.conclusion.trim(), nota_pdf: notaPdf };
    correo = await enviarCorreo({
      tipo: 'reclamo_cierre', remitente: 'reclamos', para: [c.correo],
      asunto: rellenar(plantilla.asunto, valores), texto: rellenar(plantilla.cuerpo, valores),
      adjuntos, entidad: 'reclamos', entidadId: id,
      boton: { texto: en ? 'Open the tracking portal' : 'Abrir el portal de seguimiento', url: portalUrl },
    }, { supabase, enviadoPorNombre: usuario.nombre });
  } catch (e) {
    correo = { ok: false, estado: 'error', mensaje: e instanceof Error ? e.message : 'No se pudo armar el correo de cierre.' };
  }

  return { ok: true, mensaje: `Reclamo ${c.numero} cerrado.`, correo };
}

/** Si el cierre no se completó, el PDF subido no debe quedar suelto. */
export async function descartarRespuesta(id: number, ruta: string): Promise<void> {
  if (!ruta.startsWith(`respuestas/${id}/`)) return;
  const supabase = await crearClienteServidor();
  const { data } = await supabase.from('reclamos').select('respuesta_ruta').eq('id', id).maybeSingle();
  if (data?.respuesta_ruta === ruta) return;   // ya quedó como respuesta: no se toca
  await supabase.storage.from('reclamos').remove([ruta]);
}
