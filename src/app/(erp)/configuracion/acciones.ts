'use server';

/**
 * ============================================================================
 *  ACCIONES DE CONFIGURACIÓN
 * ============================================================================
 *  Estas funciones corren EN EL SERVIDOR aunque se disparen desde un botón del
 *  navegador. Eso importa por seguridad: la validación y el guardado ocurren
 *  donde el usuario no puede manipularlos.
 *
 *  La validación se hace en tres capas, como todo el sistema:
 *   1. El formulario avisa al escribir.
 *   2. Esta función revuelve a comprobar antes de guardar.
 *   3. La base de datos tiene la última palabra con sus restricciones y RLS.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';

export type ResultadoAccion = { ok: boolean; mensaje: string };

/**
 * Guarda el valor de un parámetro del negocio.
 * Ejemplos: el umbral de anticuamiento, los días de vigencia de una reserva,
 * la capacidad del contenedor, el IGV.
 */
export async function guardarParametro(
  clave: string,
  valor: string
): Promise<ResultadoAccion> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) {
    return { ok: false, mensaje: 'Su sesión expiró. Vuelva a iniciar sesión.' };
  }

  const supabase = await crearClienteServidor();

  /* ---- Validación en el servidor ---- */
  const { data: parametro } = await supabase
    .from('parametros')
    .select('clave, tipo_dato, etiqueta, editable_por')
    .eq('clave', clave)
    .single();

  if (!parametro) {
    return { ok: false, mensaje: `El parámetro "${clave}" no existe.` };
  }

  const limpio = valor.trim();
  if (limpio === '') {
    return { ok: false, mensaje: `${parametro.etiqueta} no puede quedar vacío.` };
  }

  if (parametro.tipo_dato === 'numero') {
    const n = Number(limpio);
    if (!Number.isFinite(n)) {
      return { ok: false, mensaje: `${parametro.etiqueta} debe ser un número. Recibido: "${limpio}".` };
    }
    if (n < 0) {
      return { ok: false, mensaje: `${parametro.etiqueta} no puede ser negativo.` };
    }
  }

  if (parametro.tipo_dato === 'booleano' && !['true', 'false'].includes(limpio)) {
    return { ok: false, mensaje: `${parametro.etiqueta} solo admite verdadero o falso.` };
  }

  /* ---- Guardado ---- */
  const { error } = await supabase
    .from('parametros')
    .update({
      valor: limpio,
      actualizado_en: new Date().toISOString(),
      actualizado_por: usuario.id,
    })
    .eq('clave', clave);

  if (error) {
    // Si RLS lo rechaza, el mensaje debe decir por qué y qué hacer
    if (error.code === '42501' || /policy/i.test(error.message)) {
      return {
        ok: false,
        mensaje: 'Su rol no tiene permiso para cambiar este parámetro. Solicítelo a Gerencia u Operaciones.',
      };
    }
    return { ok: false, mensaje: `No se pudo guardar: ${error.message}` };
  }

  // Las pantallas que dependen del parámetro deben recalcularse
  revalidatePath('/configuracion');
  revalidatePath('/almacenes/anticuamiento');
  revalidatePath('/panel');

  return { ok: true, mensaje: `${parametro.etiqueta} actualizado correctamente.` };
}

/** Activa o desactiva una regla del motor de alertas. */
export async function alternarRegla(id: number, activa: boolean): Promise<ResultadoAccion> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró.' };

  const supabase = await crearClienteServidor();
  const { error } = await supabase
    .from('reglas')
    .update({ activa, actualizado_en: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    return {
      ok: false,
      mensaje: /policy/i.test(error.message)
        ? 'Su rol no tiene permiso para modificar las reglas del sistema.'
        : `No se pudo guardar: ${error.message}`,
    };
  }

  revalidatePath('/configuracion');
  revalidatePath('/alertas');
  return { ok: true, mensaje: activa ? 'Regla activada.' : 'Regla desactivada.' };
}
