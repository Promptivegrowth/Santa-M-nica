/**
 * Sube UN documento del embarque desde el navegador y lo registra (084).
 * Lo usan la ficha («Documentos del embarque») y el formulario de programar,
 * que adjunta la etiqueta y el packing justo después de crear el embarque.
 *
 * El archivo va directo al repositorio privado —no pasa por el servidor de la
 * aplicación— y luego el servidor lo registra (documentos.ts). Si el registro
 * falla, el servidor lo borra.
 */
import { crearClienteNavegador } from '@/lib/supabase/navegador';
import { accionSegura } from '@/lib/accionSegura';
import {
  FORMATOS_DOCUMENTO, MAXIMO_DOCUMENTO, NOMBRE_DOCUMENTO, tipoMimeDe, type TipoDocumentoEmbarque,
} from '@/lib/documentosEmbarque';
import { registrarDocumentoEmbarque } from './documentos';

/** Un nombre de archivo que sirve como ruta: sin tildes ni espacios raros. */
const limpio = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-80);

export async function subirDocumentoEmbarque(
  embarqueId: number, tipo: TipoDocumentoEmbarque, archivo: File, comentario?: string | null,
): Promise<{ ok: boolean; mensaje: string }> {
  const mime = tipoMimeDe(archivo.name, archivo.type);
  if (!FORMATOS_DOCUMENTO[tipo].mimes.includes(mime)) {
    return { ok: false, mensaje: `${archivo.name}: ${FORMATOS_DOCUMENTO[tipo].texto}.` };
  }
  if (archivo.size > MAXIMO_DOCUMENTO) return { ok: false, mensaje: `${archivo.name}: pasa de 15 MB.` };
  if (archivo.size === 0) return { ok: false, mensaje: `${archivo.name}: está vacío.` };

  const ruta = `embarque-${embarqueId}/${tipo}/${Date.now()}-${limpio(archivo.name)}`;
  try {
    const supabase = crearClienteNavegador();
    const { error } = await supabase.storage.from('despachos').upload(ruta, archivo, { contentType: mime, upsert: false });
    if (error) {
      return {
        ok: false,
        mensaje: /row-level security|unauthorized|403/i.test(error.message)
          ? `${archivo.name}: su usuario no puede subir documentos a este embarque.`
          : `${archivo.name}: no se pudo subir (${error.message}). Vuelva a intentarlo.`,
      };
    }
  } catch {
    return { ok: false, mensaje: `${archivo.name}: se perdió la conexión al subirlo. Vuelva a intentarlo.` };
  }
  const r = await accionSegura(() => registrarDocumentoEmbarque({
    embarque_id: embarqueId, tipo, ruta, nombre: archivo.name, tipo_mime: mime, tamano_bytes: archivo.size,
    comentario: comentario ?? null,
  }));
  return { ok: r.ok, mensaje: r.ok ? r.mensaje : `${NOMBRE_DOCUMENTO[tipo]} «${archivo.name}»: ${r.mensaje}` };
}
