'use server';

/**
 * ============================================================================
 *  VERIFICACIONES BASC DEL CLIENTE
 * ============================================================================
 *  La lista de Comex (formato BASC.F.15.01) registra, por cliente, cuatro
 *  controles: Lista Clinton, ONU terrorismo, ONU armas y el acuerdo de
 *  seguridad. Se repiten —la lista es «Verificación 2026»—, así que cada uno
 *  se guarda con su fecha y queda la historia.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { hoyEnLima } from '@/lib/fechas';
import { nombreRol, listaDeRoles } from '@/lib/permisosVentas';
import type { Rol } from '@/lib/navegacion';

const PUEDEN = ['gerencia', 'operaciones', 'comercial', 'comex'];
const CONTROLES = ['lista_clinton', 'onu_terrorismo', 'onu_armas', 'acuerdo_seguridad'] as const;
export type Control = (typeof CONTROLES)[number];

export async function registrarVerificacion(v: {
  cliente_id: number;
  control: Control;
  resultado: string;
  fecha: string;
  enviado_el?: string | null;
  firmado_el?: string | null;
}): Promise<{ ok: boolean; mensaje: string }> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró.' };
  if (!PUEDEN.includes(usuario.rol)) {
    return { ok: false, mensaje: `${nombreRol(usuario.rol)} no registra verificaciones BASC: lo hacen ${listaDeRoles(PUEDEN as Rol[])}.` };
  }
  if (!CONTROLES.includes(v.control)) return { ok: false, mensaje: 'Ese control no existe.' };
  const resultado = v.resultado.trim();
  if (!resultado) return { ok: false, mensaje: 'Indique el resultado (OK, Negativo, SI…).' };
  const esFecha = (f?: string | null) => !f || /^\d{4}-\d{2}-\d{2}$/.test(f);
  if (!v.fecha || !esFecha(v.fecha) || !esFecha(v.enviado_el) || !esFecha(v.firmado_el)) return { ok: false, mensaje: 'Revise las fechas.' };
  if (v.fecha > hoyEnLima()) return { ok: false, mensaje: 'La fecha de la verificación no puede ser futura.' };

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.from('cliente_verificaciones').upsert({
    cliente_id: v.cliente_id, control: v.control, resultado, fecha: v.fecha,
    enviado_el: v.control === 'acuerdo_seguridad' ? (v.enviado_el || null) : null,
    firmado_el: v.control === 'acuerdo_seguridad' ? (v.firmado_el || null) : null,
    responsable: usuario.nombre, fuente: 'manual', creado_por: usuario.id,
  }, { onConflict: 'cliente_id,control,fecha' }).select('id');
  if (error) return { ok: false, mensaje: `No se pudo guardar: ${error.message}` };
  if (!data?.length) return { ok: false, mensaje: 'No tiene permiso para registrar verificaciones.' };

  revalidatePath(`/ventas/clientes/${v.cliente_id}`);
  revalidatePath('/ventas/clientes');
  return { ok: true, mensaje: 'Verificación registrada.' };
}
