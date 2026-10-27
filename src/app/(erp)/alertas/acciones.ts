'use server';

/**
 * ============================================================================
 *  ALERTAS · marcar una como atendida
 * ============================================================================
 *  El Motor de reglas ya decía «una alerta que alguien marcó como atendida no
 *  se vuelve a abrir para el mismo registro», y el evaluador lo respetaba
 *  (reglas_evaluar no reabre las que tienen `atendida_por`). Lo que faltaba
 *  era el botón: en Alertas no había cómo marcarla.
 *
 *  QUIÉN
 *  Gerencia y Operaciones, que son quienes administran las reglas. Los demás
 *  roles ven las alertas, pero cerrarlas es decidir que ya no hace falta
 *  mirarlas, y eso no le toca a quien solo consulta.
 *
 *  QUÉ QUEDA
 *  Quién la marcó y cuándo (atendida_por, atendida_en). No se borra: se ve
 *  en Alertas con el filtro «Estado · Atendidas a mano».
 *
 *  LO QUE NO HACE
 *  No arregla la causa. Si es un aviso de resumen («Stock observado…»,
 *  «Cotizaciones por vencer»), la tarea de la mañana lo vuelve a abrir si la
 *  situación sigue igual; si es de una regla sobre un registro concreto, ya
 *  no vuelve para ese registro.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { NOMBRE_ROL, type Rol } from '@/lib/navegacion';

export type ResultadoAlerta = { ok: boolean; mensaje: string };

/* No se exporta: un archivo 'use server' solo puede exportar funciones. */
const PUEDEN_ATENDER: Rol[] = ['gerencia', 'operaciones'];

export async function marcarAtendida(id: number): Promise<ResultadoAlerta> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión caducó. Vuelva a entrar.' };
  if (!PUEDEN_ATENDER.includes(usuario.rol as Rol)) {
    return {
      ok: false,
      mensaje: `${NOMBRE_ROL[usuario.rol as Rol] ?? 'Su rol'} no puede marcar alertas como atendidas: lo hacen Gerencia y Operaciones.`,
    };
  }

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase
    .from('alertas')
    .update({ atendida: true, atendida_por: usuario.id, atendida_en: new Date().toISOString() })
    .eq('id', id)
    .eq('atendida', false)
    .select('id, titulo, regla_id, entidad_id');

  if (error) {
    return { ok: false, mensaje: 'No se pudo marcar la alerta. Vuelva a intentarlo; si se repite, avise a soporte.' };
  }
  //  Cero filas: otro la cerró antes (o la regla la resolvió sola).
  if (!data?.length) {
    return { ok: false, mensaje: 'Esa alerta ya estaba cerrada: alguien la atendió o se resolvió sola. Recargue la pantalla.' };
  }

  revalidatePath('/alertas');
  revalidatePath('/panel');
  revalidatePath('/configuracion');

  const a = data[0];
  const esResumen = !a.regla_id && Number(a.entidad_id) === 0;
  return {
    ok: true,
    mensaje: esResumen
      ? `«${a.titulo}» marcada como atendida. Si la situación sigue igual, la revisión de mañana la vuelve a abrir.`
      : `«${a.titulo}» marcada como atendida a su nombre. No se vuelve a abrir para este registro.`,
  };
}
