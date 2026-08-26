'use server';

/**
 * ============================================================================
 *  ACCIONES SOBRE RESERVAS
 * ============================================================================
 *  Aquí vive la operación que resuelve el problema que planteó el cliente:
 *  soltar un apartado que ya no corresponde, para que ese producto vuelva a
 *  estar disponible para vender.
 *
 *  Dos decisiones deliberadas:
 *
 *  1. LIBERAR EXIGE MOTIVO. No es burocracia: hoy nadie sabe por qué el stock
 *     figuraba apartado, y sin motivo el mismo problema se repite el mes que
 *     viene. La base de datos rechaza motivos de menos de 5 caracteres, así
 *     que la validación de aquí solo adelanta el aviso.
 *
 *  2. LIBERAR NO BORRA. La reserva pasa a estado «liberada» y conserva quién,
 *     cuándo y por qué. El Kardex y el historial quedan íntegros.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';

export type Resultado = { ok: true; mensaje: string } | { ok: false; mensaje: string };

/** Roles que pueden soltar stock apartado. */
const PUEDEN_LIBERAR = ['gerencia', 'operaciones', 'comercial', 'almacen'];

export async function liberarReserva(reservaId: number, motivo: string): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró. Vuelva a entrar.' };

  if (!PUEDEN_LIBERAR.includes(usuario.rol)) {
    return { ok: false, mensaje: 'Su rol no puede liberar reservas.' };
  }

  const limpio = motivo.trim();
  if (limpio.length < 5) {
    return {
      ok: false,
      mensaje: 'Explique por qué se libera, con al menos 5 caracteres. Ese texto queda en el historial del lote.',
    };
  }
  if (limpio.length > 300) {
    return { ok: false, mensaje: 'El motivo no puede superar los 300 caracteres.' };
  }

  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('reserva_liberar', {
    p_reserva_id: reservaId,
    p_motivo: limpio,
  });

  if (error) return { ok: false, mensaje: `No se pudo liberar: ${error.message}` };

  // Todo lo que cambia de número al soltar stock.
  revalidatePath('/almacenes/reservas');
  revalidatePath('/almacenes/existencias');
  revalidatePath('/ventas/disponibilidad');
  revalidatePath('/panel');

  return { ok: true, mensaje: 'Reserva liberada. El stock ya figura como disponible.' };
}

/**
 * Ejecuta la expiración automática de reservas vencidas.
 *
 * En producción esto lo dispara una tarea programada, pero se expone también
 * como botón: en la reunión quedó claro que hacía falta poder «limpiar ahora»
 * sin esperar al proceso nocturno.
 */
export async function expirarReservasVencidas(): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró. Vuelva a entrar.' };
  if (!['gerencia', 'operaciones'].includes(usuario.rol)) {
    return { ok: false, mensaje: 'Solo gerencia u operaciones pueden ejecutar la expiración masiva.' };
  }

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc('reservas_expirar_vencidas');

  if (error) return { ok: false, mensaje: `No se pudo ejecutar: ${error.message}` };

  revalidatePath('/almacenes/reservas');
  revalidatePath('/almacenes/existencias');
  revalidatePath('/ventas/disponibilidad');
  revalidatePath('/panel');

  const n = Number(data ?? 0);
  return {
    ok: true,
    mensaje:
      n === 0
        ? 'No había ninguna reserva vencida: todo está al día.'
        : `Se liberaron ${n} reservas vencidas. Ese stock vuelve a estar disponible.`,
  };
}
