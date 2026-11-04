'use server';

/**
 * ============================================================================
 *  DOCUMENTOS Y COMENTARIOS DEL EMBARQUE («Observaciones ERP 4», puntos 08 y 09)
 * ============================================================================
 *  Oliver: «al programar, opción para subir el packing list en PDF o Excel»
 *  —el que se declara al cliente y a SANIPES difiere del real por la
 *  sobreproducción declarada el sábado— «y la etiqueta que sube Comercial».
 *
 *  Cuatro clases de documento:
 *    etiqueta           modelo de etiqueta (PDF o imagen). Lo sube Comercial.
 *    packing_declarado  el packing list que se declara al cliente / SANIPES.
 *    packing_real       el packing interno, con lo que de verdad sale.
 *    otro               cualquier otro papel de la salida.
 *  Cada subida es una VERSIÓN: la más reciente de cada clase es la vigente y
 *  las anteriores se quedan, con quién y cuándo. Eso, más los comentarios,
 *  es el «seguimiento del packing list» que se pidió.
 *
 *  Igual que los archivos del despacho (despachos/archivos.ts): el NAVEGADOR
 *  sube el archivo directo al repositorio privado —mismo repositorio, carpeta
 *  «embarque-<id>/»— y aquí solo se registra, revisando que la ruta sea de
 *  ese embarque y de esa clase y que el formato sea el correcto. Si el
 *  registro falla, se borra el archivo: no quedan huérfanos.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { mensajeNoPuede, mensajeDeBase, rolPuede } from '@/lib/permisosLogistica';
import {
  PUEDEN_DOCUMENTOS_EMBARQUE, PUEDEN_QUITAR_CUALQUIERA, FORMATOS_DOCUMENTO, MAXIMO_DOCUMENTO,
  NOMBRE_DOCUMENTO, EN_FRASE_DOCUMENTO, type TipoDocumentoEmbarque,
} from '@/lib/documentosEmbarque';

type Resultado = { ok: true; mensaje: string } | { ok: false; mensaje: string };

function refrescar(embarqueId: number) {
  revalidatePath(`/logistica/embarques/${embarqueId}`);
  revalidatePath('/logistica/embarques');
  revalidatePath('/logistica/planificador');
}

export async function registrarDocumentoEmbarque(a: {
  embarque_id: number;
  tipo: TipoDocumentoEmbarque;
  ruta: string;
  nombre: string;
  tipo_mime: string;
  tamano_bytes: number;
  comentario?: string | null;
}): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró. Vuelva a entrar.' };
  const supabase = await crearClienteServidor();
  const descartar = () => supabase.storage.from('despachos').remove([a.ruta]).then(() => undefined, () => undefined);

  if (!rolPuede(usuario.rol, PUEDEN_DOCUMENTOS_EMBARQUE)) {
    await descartar();
    return { ok: false, mensaje: mensajeNoPuede(usuario.rol, 'adjuntar documentos al embarque', PUEDEN_DOCUMENTOS_EMBARQUE) };
  }
  if (!(a.tipo in FORMATOS_DOCUMENTO) || !a.ruta.startsWith(`embarque-${a.embarque_id}/${a.tipo}/`) || a.ruta.includes('..')) {
    await descartar();
    return { ok: false, mensaje: 'La ruta del archivo no corresponde a este embarque.' };
  }
  if (!FORMATOS_DOCUMENTO[a.tipo].mimes.includes(a.tipo_mime)) {
    await descartar();
    return { ok: false, mensaje: `${NOMBRE_DOCUMENTO[a.tipo]}: ${FORMATOS_DOCUMENTO[a.tipo].texto}.` };
  }
  if (!(a.tamano_bytes > 0) || a.tamano_bytes > MAXIMO_DOCUMENTO) {
    await descartar();
    return { ok: false, mensaje: 'El archivo está vacío o pasa de 15 MB.' };
  }
  const comentario = (a.comentario ?? '').trim();
  if (comentario.length > 500) {
    await descartar();
    return { ok: false, mensaje: 'El comentario del archivo no puede pasar de 500 caracteres.' };
  }

  const { data: emb } = await supabase.from('embarques').select('numero, estado').eq('id', a.embarque_id).maybeSingle();
  if (!emb) { await descartar(); return { ok: false, mensaje: 'Ese embarque ya no existe.' }; }
  if (emb.estado === 'cancelado') {
    await descartar();
    return { ok: false, mensaje: `El embarque ${emb.numero} está cancelado: ya no se le adjuntan documentos.` };
  }

  //  ¿Cuántas versiones había de esta clase? Para decir «versión 2».
  const { count: previas } = await supabase.from('embarque_archivos')
    .select('id', { count: 'exact', head: true }).eq('embarque_id', a.embarque_id).eq('tipo', a.tipo);

  const { error } = await supabase.from('embarque_archivos').insert({
    embarque_id: a.embarque_id,
    tipo: a.tipo,
    ruta: a.ruta,
    nombre: a.nombre.slice(0, 200),
    tipo_mime: a.tipo_mime,
    tamano_bytes: a.tamano_bytes,
    comentario: comentario || null,
    subido_por: usuario.id,
  });
  if (error) {
    await descartar();
    return { ok: false, mensaje: mensajeDeBase(error, 'No se pudo registrar el archivo') };
  }

  const version = (previas ?? 0) + 1;
  await supabase.rpc('registrar_evento', {
    p_entidad: 'embarques', p_entidad_id: a.embarque_id, p_tipo: 'embarque_documento',
    p_descripcion: `${usuario.nombre} subió ${EN_FRASE_DOCUMENTO[a.tipo]} «${a.nombre.slice(0, 80)}»` +
      (version > 1 ? ` (versión ${version}; reemplaza a la anterior)` : '') + (comentario ? `: ${comentario.slice(0, 200)}` : '') + '.',
    p_severidad: 'info',
  }).then(() => undefined, () => undefined);

  refrescar(a.embarque_id);
  return {
    ok: true,
    mensaje: `${NOMBRE_DOCUMENTO[a.tipo]} adjuntado al ${emb.numero}` + (version > 1 ? ` (versión ${version}: es la vigente).` : '.'),
  };
}

/**
 * Quitar un documento: quien lo subió, o Gerencia u Operaciones (la base
 * decide con su política; aquí se dice por qué no, en palabras).
 */
export async function quitarDocumentoEmbarque(id: number): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró. Vuelva a entrar.' };
  if (!rolPuede(usuario.rol, PUEDEN_DOCUMENTOS_EMBARQUE)) {
    return { ok: false, mensaje: mensajeNoPuede(usuario.rol, 'quitar documentos del embarque', PUEDEN_DOCUMENTOS_EMBARQUE) };
  }

  const supabase = await crearClienteServidor();
  const { data: a } = await supabase.from('embarque_archivos')
    .select('embarque_id, ruta, nombre, tipo, subido_por').eq('id', id).maybeSingle();
  if (!a) return { ok: false, mensaje: 'Ese archivo ya no está.' };
  if (a.subido_por !== usuario.id && !rolPuede(usuario.rol, PUEDEN_QUITAR_CUALQUIERA)) {
    return { ok: false, mensaje: 'Solo puede quitar los documentos que subió usted. Los de otra persona los quitan Gerencia u Operaciones.' };
  }

  const { data: borrados, error } = await supabase.from('embarque_archivos').delete().eq('id', id).select('id');
  if (error || !borrados?.length) {
    return { ok: false, mensaje: error ? mensajeDeBase(error, 'No se pudo quitar el archivo') : 'No se pudo quitar el archivo: su usuario no tiene permiso, o alguien ya lo quitó. Recargue la pantalla.' };
  }
  await supabase.storage.from('despachos').remove([String(a.ruta)]);

  await supabase.rpc('registrar_evento', {
    p_entidad: 'embarques', p_entidad_id: Number(a.embarque_id), p_tipo: 'embarque_documento_quitado',
    p_descripcion: `${usuario.nombre} quitó ${EN_FRASE_DOCUMENTO[a.tipo as TipoDocumentoEmbarque] ?? 'un documento'} «${String(a.nombre).slice(0, 80)}».`,
    p_severidad: 'info',
  }).then(() => undefined, () => undefined);

  refrescar(Number(a.embarque_id));
  return { ok: true, mensaje: 'Documento quitado.' };
}

/**
 * Un comentario en la bitácora del embarque. No se edita ni se borra: queda
 * con su autor y su hora (es el seguimiento).
 */
export async function comentarEmbarque(embarqueId: number, texto: string): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró. Vuelva a entrar.' };
  if (!rolPuede(usuario.rol, PUEDEN_DOCUMENTOS_EMBARQUE)) {
    return { ok: false, mensaje: mensajeNoPuede(usuario.rol, 'comentar en el embarque', PUEDEN_DOCUMENTOS_EMBARQUE) };
  }
  const limpio = (texto ?? '').trim();
  if (!limpio) return { ok: false, mensaje: 'Escriba el comentario.' };
  if (limpio.length > 1000) return { ok: false, mensaje: `El comentario puede tener hasta 1000 caracteres (este tiene ${limpio.length}).` };

  const supabase = await crearClienteServidor();
  const { data: emb } = await supabase.from('embarques').select('numero').eq('id', embarqueId).maybeSingle();
  if (!emb) return { ok: false, mensaje: 'Ese embarque ya no existe.' };

  const { data, error } = await supabase.from('embarque_comentarios')
    .insert({ embarque_id: embarqueId, texto: limpio, autor_id: usuario.id }).select('id');
  if (error || !data?.length) return { ok: false, mensaje: mensajeDeBase(error, 'No se pudo guardar el comentario') };

  refrescar(embarqueId);
  return { ok: true, mensaje: 'Comentario agregado.' };
}
