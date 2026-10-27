'use server';

/**
 * ============================================================================
 *  ARCHIVOS DEL DESPACHO · guía final y fotos de la carga
 * ============================================================================
 *  Observaciones de octubre, puntos 15 y 17.
 *
 *  El archivo lo sube el NAVEGADOR directo al repositorio privado —así una
 *  foto de 8 MB no pasa por el servidor de la aplicación—, y aquí solo se
 *  registra en la base. Por eso se revisa con cuidado lo que llega: que la
 *  ruta sea de ese despacho y de ese tipo, y que el formato sea el correcto.
 *  Si el registro falla, se borra el archivo: no quedan huérfanos.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { PUEDEN_DESPACHAR, mensajeNoPuede, mensajeDeBase } from '@/lib/permisosLogistica';

const PUEDEN: string[] = PUEDEN_DESPACHAR;
const FORMATOS = { guia: ['application/pdf'], foto: ['image/jpeg', 'image/png'] } as const;
const MAXIMO = 15 * 1024 * 1024;

type Resultado = { ok: true; mensaje: string } | { ok: false; mensaje: string };

export async function registrarArchivoDespacho(a: {
  despacho_id: number;
  tipo: 'guia' | 'foto';
  ruta: string;
  nombre: string;
  tipo_mime: string;
  tamano_bytes: number;
  descripcion?: string | null;
}): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró.' };
  const supabase = await crearClienteServidor();
  const descartar = () => supabase.storage.from('despachos').remove([a.ruta]).then(() => undefined, () => undefined);

  if (!PUEDEN.includes(usuario.rol)) {
    await descartar();
    return { ok: false, mensaje: mensajeNoPuede(usuario.rol, 'adjuntar archivos al despacho', PUEDEN) };
  }
  if (!(a.tipo in FORMATOS) || !a.ruta.startsWith(`despacho-${a.despacho_id}/${a.tipo}/`) || a.ruta.includes('..')) {
    await descartar();
    return { ok: false, mensaje: 'La ruta del archivo no corresponde a este despacho.' };
  }
  if (!(FORMATOS[a.tipo] as readonly string[]).includes(a.tipo_mime)) {
    await descartar();
    return {
      ok: false,
      mensaje: a.tipo === 'guia' ? 'La guía de remisión tiene que ser un PDF.' : 'Las fotos tienen que ser JPG o PNG.',
    };
  }
  if (!(a.tamano_bytes > 0) || a.tamano_bytes > MAXIMO) {
    await descartar();
    return { ok: false, mensaje: 'El archivo está vacío o pasa de 15 MB.' };
  }

  const { data: desp } = await supabase.from('despachos').select('numero').eq('id', a.despacho_id).maybeSingle();
  if (!desp) { await descartar(); return { ok: false, mensaje: 'Ese despacho ya no existe.' }; }

  const { error } = await supabase.from('despacho_archivos').insert({
    despacho_id: a.despacho_id,
    tipo: a.tipo,
    ruta: a.ruta,
    nombre: a.nombre.slice(0, 200),
    tipo_mime: a.tipo_mime,
    tamano_bytes: a.tamano_bytes,
    descripcion: a.descripcion?.trim() || null,
    subido_por: usuario.id,
  });
  if (error) {
    await descartar();
    return { ok: false, mensaje: mensajeDeBase(error, 'No se pudo registrar el archivo') };
  }

  revalidatePath(`/logistica/despachos/${a.despacho_id}`);
  return { ok: true, mensaje: a.tipo === 'guia' ? `Guía adjuntada al ${desp.numero}.` : 'Foto agregada.' };
}

export async function borrarArchivoDespacho(id: number): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró.' };
  if (!PUEDEN.includes(usuario.rol)) return { ok: false, mensaje: mensajeNoPuede(usuario.rol, 'quitar archivos del despacho', PUEDEN) };

  const supabase = await crearClienteServidor();
  const { data: a } = await supabase.from('despacho_archivos').select('despacho_id, ruta').eq('id', id).maybeSingle();
  if (!a) return { ok: false, mensaje: 'Ese archivo ya no está.' };

  const { data: borrados, error } = await supabase.from('despacho_archivos').delete().eq('id', id).select('id');
  if (error || !borrados?.length) return { ok: false, mensaje: error ? mensajeDeBase(error, 'No se pudo quitar el archivo') : 'No se pudo quitar el archivo: su usuario no tiene permiso, o alguien ya lo quitó. Recargue la pantalla.' };
  await supabase.storage.from('despachos').remove([String(a.ruta)]);

  revalidatePath(`/logistica/despachos/${a.despacho_id}`);
  return { ok: true, mensaje: 'Archivo quitado.' };
}
