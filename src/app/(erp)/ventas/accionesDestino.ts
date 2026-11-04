'use server';

/**
 * ============================================================================
 *  AGREGAR UN DESTINO QUE NO ESTÁ EN LA LISTA (migración 085)
 * ============================================================================
 *  «Observaciones ERP 4», punto 12 (Oliver): «permitir ingreso manual de
 *  destinos no listados». El maestro de destinos lo mantienen Gerencia y
 *  Operaciones en Configuración; quien cotiza no podía poner un puerto nuevo
 *  y tenía que dejar la oferta «sin destino» o esperar a que alguien lo diera
 *  de alta.
 *
 *  Ahora, desde el formulario de cotización o de pedido, «Otro destino…»
 *  pide el puerto y el país y lo da de alta en el acto (registrar_destino en
 *  la base). Si ya existía con el mismo nombre y país —sin importar
 *  mayúsculas, tildes ni espacios— se usa ese: no se duplica.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { puedeVender, type Rol } from '@/lib/navegacion';
import { nombreRol, listaDeRoles } from '@/lib/permisosVentas';

const AGREGAN: Rol[] = ['gerencia', 'operaciones', 'comercial', 'comex'];

export type ResultadoDestino =
  | { ok: true; destino: { id: number; nombre: string; pais: string }; nuevo: boolean; mensaje: string }
  | { ok: false; mensaje: string; campo?: 'puerto' | 'pais' };

export async function agregarDestino(puerto: string, pais: string): Promise<ResultadoDestino> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró. Vuelva a iniciar sesión.' };
  if (!puedeVender(usuario.rol as Rol)) {
    return { ok: false, mensaje: `${nombreRol(usuario.rol)} no agrega destinos: lo hacen ${listaDeRoles(AGREGAN)}.` };
  }

  const p = puerto.replace(/\s+/g, ' ').trim();
  const pa = pais.replace(/\s+/g, ' ').trim();
  //  Las mismas reglas que la base, para avisar sin ir a ella.
  if (p.length < 2) return { ok: false, mensaje: 'Escriba el nombre del puerto o ciudad de destino.', campo: 'puerto' };
  if (p.length > 80) return { ok: false, mensaje: 'El nombre del destino no puede pasar de 80 caracteres.', campo: 'puerto' };
  if (pa.length < 2) return { ok: false, mensaje: 'Escriba el país del destino: sale en la proforma y en el contrato.', campo: 'pais' };
  if (pa.length > 60) return { ok: false, mensaje: 'El país no puede pasar de 60 caracteres.', campo: 'pais' };

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc('registrar_destino', { p_puerto: p, p_pais: pa });
  if (error || !data) {
    const m = String(error?.message ?? '');
    //  La base escribe sus motivos para la persona; lo técnico no se enseña.
    return {
      ok: false,
      mensaje: m && !/violates|constraint|column|relation|syntax|function/i.test(m)
        ? m
        : 'No se pudo agregar el destino. Vuelva a intentarlo; si se repite, avise a Sistemas.',
    };
  }

  const r = data as { id: number; nuevo: boolean };
  const { data: fila } = await supabase.from('destinos').select('id, puerto, pais').eq('id', r.id).maybeSingle();
  revalidatePath('/configuracion');
  return {
    ok: true,
    nuevo: r.nuevo,
    destino: { id: Number(r.id), nombre: String(fila?.puerto ?? p), pais: String(fila?.pais ?? pa) },
    mensaje: r.nuevo
      ? `Destino ${fila?.puerto ?? p} (${fila?.pais ?? pa}) agregado a la lista.`
      : `${fila?.puerto ?? p} (${fila?.pais ?? pa}) ya estaba en la lista: se eligió ese.`,
  };
}
