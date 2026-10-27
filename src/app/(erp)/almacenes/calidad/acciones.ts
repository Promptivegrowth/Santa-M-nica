'use server';

/**
 * ============================================================================
 *  DICTÁMENES DE CALIDAD
 * ============================================================================
 *  Cada lote lleva hasta cuatro dictámenes independientes —calidad,
 *  microbiología, cámara y producto terminado—, y basta con que UNO esté
 *  abierto para que el lote no se pueda vender ni mover de bodega.
 *
 *  QUÉ SIGNIFICA CADA ESTADO
 *    liberado             el lote se puede vender.
 *    observado            hay un hallazgo; no sale hasta resolverlo.
 *    inmovilizado         hallazgo grave; no sale ni se traslada.
 *    espera_resultados    se mandó muestra al laboratorio; tampoco sale.
 *
 *  Los tres últimos bloquean, y eso lo decide la base de datos con la función
 *  `lote_bloqueado`, no esta pantalla. La excepción es el motivo «Solo mercado
 *  nacional»: no bloquea, solo limita a quién se vende (migración 061).
 *
 *  UN DICTAMEN NO SE EDITA: SE REEMPLAZA
 *  Cuando se emite uno nuevo del mismo tipo, el anterior deja de estar vigente
 *  pero se conserva. Así queda la historia entera: cuándo se observó, quién lo
 *  observó, con qué sustento, y cuándo y quién lo liberó. Editar el anterior
 *  borraría justo lo que hace falta si mañana llega un reclamo sanitario.
 *
 *  TODO EN UNA SOLA TRANSACCIÓN (077)
 *  Antes esta acción daba de baja el anterior y luego insertaba el nuevo, en
 *  dos llamadas. Si el nuevo fallaba —«Solo mercado nacional» sobre un pallet
 *  apartado para exportación, por ejemplo—, el anterior ya no estaba vigente
 *  y un pallet bloqueado quedaba libre sin que nadie lo liberara. Ahora lo
 *  hace la función dictamen_registrar() de la base: o todo, o nada.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { NOMBRE_ROL, type Rol } from '@/lib/navegacion';

export type Resultado =
  | { ok: true; id: number; mensaje: string }
  | { ok: false; mensaje: string; campo?: string };

/** Calidad y Operaciones dictaminan; Gerencia también. La base lo vuelve a exigir. */
const PUEDEN_DICTAMINAR = ['gerencia', 'operaciones', 'calidad'];

export type TipoDictamen = 'calidad' | 'microbiologia' | 'camara' | 'producto_terminado';
export type EstadoDictamen = 'liberado' | 'observado' | 'inmovilizado' | 'espera_resultados';

export type DatosDictamen = {
  lote_id: number;
  tipo: TipoDictamen;
  estado: EstadoDictamen;
  motivo_id: number | null;
  motivo_texto: string | null;
  sustento_url: string | null;
  observaciones: string | null;
};

/** Los que impiden que el lote salga de cámara. */
const BLOQUEAN: EstadoDictamen[] = ['observado', 'inmovilizado', 'espera_resultados'];

const NOMBRE_TIPO: Record<TipoDictamen, string> = {
  calidad: 'calidad', microbiologia: 'microbiología', camara: 'cámara', producto_terminado: 'producto terminado',
};
const NOMBRE_ESTADO: Record<EstadoDictamen, string> = {
  liberado: 'liberado', observado: 'observado', inmovilizado: 'inmovilizado',
  espera_resultados: 'en espera de resultados',
};

function refrescar(loteId: number) {
  revalidatePath('/almacenes/calidad');
  revalidatePath(`/almacenes/lotes/${loteId}`);
  revalidatePath('/almacenes/existencias');
  revalidatePath('/ventas/disponibilidad');
  revalidatePath('/almacenes/reservas');
  revalidatePath('/alertas');
  revalidatePath('/panel');
}

/**
 * Un error de la base, dicho para el usuario. Los mensajes que redactan las
 * funciones y disparadores ya vienen en castellano; lo que no (un permiso,
 * una regla técnica) se traduce aquí y nunca llega crudo.
 */
function traducirError(error: { code?: string; message?: string }): string {
  const m = error.message ?? '';
  if (error.code === '42501' || /row-level security|permission denied/i.test(m)) {
    return 'Su rol no puede emitir dictámenes de calidad: lo hacen Calidad, Operaciones y Gerencia.';
  }
  //  Los mensajes propios (raise exception) empiezan en mayúscula y en castellano.
  if (/^[A-ZÁÉÍÓÚÑ«]/.test(m) && !/violates|constraint|column|relation|function/i.test(m)) return m;
  return 'No se pudo registrar el dictamen. Vuelva a intentarlo; si se repite, avise a soporte.';
}

export async function registrarDictamen(d: DatosDictamen): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión caducó. Vuelva a entrar.' };
  if (!PUEDEN_DICTAMINAR.includes(usuario.rol)) {
    return {
      ok: false,
      mensaje: `${NOMBRE_ROL[usuario.rol as Rol] ?? 'Su rol'} no puede emitir dictámenes de calidad: lo hacen Calidad, Operaciones y Gerencia.`,
    };
  }

  if (!d.lote_id) return { ok: false, mensaje: 'Elija el lote.', campo: 'lote_id' };

  /*
   * Bloquear un lote sin decir por qué es lo peor que puede pasar aquí: dentro
   * de un mes nadie sabrá si se puede liberar. Por eso el motivo es
   * obligatorio cuando el dictamen bloquea, y opcional cuando libera. (La
   * base lo vuelve a comprobar.)
   */
  if (BLOQUEAN.includes(d.estado) && !d.motivo_id && !d.motivo_texto?.trim()) {
    return {
      ok: false,
      mensaje: 'Un dictamen que bloquea necesita motivo: quien lo vea después tiene que saber por qué.',
      campo: 'motivo',
    };
  }

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc('dictamen_registrar', {
    p_lote_id: d.lote_id,
    p_tipo: d.tipo,
    p_estado: d.estado,
    p_motivo_id: d.motivo_id,
    p_motivo_texto: d.motivo_texto?.trim() || null,
    p_sustento_url: d.sustento_url?.trim() || null,
    p_observaciones: d.observaciones?.trim() || null,
  });

  if (error || !data) {
    return { ok: false, mensaje: traducirError(error ?? {}) };
  }

  const r = data as {
    id: number; pallet: string; bloquea: boolean; condiciona: boolean;
    sigue_bloqueado: boolean; solo_nacional: boolean;
  };

  refrescar(d.lote_id);

  const pallet = r.pallet;
  let mensaje: string;
  if (r.condiciona && !r.sigue_bloqueado) {
    mensaje =
      `Pallet ${pallet} marcado «Solo mercado nacional». Sigue disponible, pero solo se puede ` +
      'reservar y cargar para pedidos de mercado nacional.';
  } else if (r.condiciona) {
    mensaje =
      `Pallet ${pallet} marcado «Solo mercado nacional», pero SIGUE bloqueado por otro dictamen ` +
      'abierto: hasta liberarlo no se puede reservar, trasladar ni despachar.';
  } else if (r.bloquea) {
    mensaje =
      `Pallet ${pallet} ${NOMBRE_ESTADO[d.estado]}. ` +
      'Deja de estar disponible: no se puede reservar, trasladar ni despachar.';
  } else if (r.sigue_bloqueado) {
    mensaje =
      `Dictamen de ${NOMBRE_TIPO[d.tipo]} liberado, pero el pallet ${pallet} ` +
      'SIGUE bloqueado por otro dictamen abierto. Revise los demás para que vuelva a estar disponible.';
  } else if (r.solo_nacional) {
    mensaje =
      `Dictamen de ${NOMBRE_TIPO[d.tipo]} liberado. El pallet ${pallet} está disponible, pero sigue ` +
      '«Solo mercado nacional» por otro dictamen.';
  } else {
    mensaje =
      `Pallet ${pallet} liberado. Ya no tiene ningún dictamen abierto: vuelve a estar ` +
      'disponible para vender.';
  }

  return { ok: true, id: Number(r.id), mensaje };
}

/* ==========================================================================
   AYUDAS
   ========================================================================== */

/** Los motivos tipificados de observación, del maestro. */
export async function motivosCalidad(): Promise<{ id: number; nombre: string; condiciona_venta: boolean }[]> {
  const supabase = await crearClienteServidor();
  const { data } = await supabase
    .from('motivos').select('id, nombre, ambito, condiciona_venta').eq('activo', true).order('nombre');

  /*
   * El maestro de motivos sirve a varias cosas —ingreso, salida, ajuste,
   * bloqueo—; los de calidad son los del ámbito «bloqueo». Si ese ámbito
   * estuviera vacío se ofrecen todos: es preferible una lista larga a un
   * desplegable en blanco que impida registrar el dictamen.
   *
   * Se pasa también si el motivo solo condiciona la venta («Solo mercado
   * nacional»): el formulario avisa ANTES de guardar que ese pallet no sale
   * del inventario vendible, solo queda limitado a pedidos nacionales.
   */
  const deBloqueo = (data ?? []).filter((m) => String(m.ambito ?? '') === 'bloqueo');
  const lista = deBloqueo.length > 0 ? deBloqueo : (data ?? []);
  return lista.map((m) => ({
    id: m.id as number,
    nombre: m.nombre as string,
    condiciona_venta: m.condiciona_venta === true,
  }));
}

/** Qué dictámenes tiene ahora mismo un lote. */
export async function dictamenesDelLote(loteId: number): Promise<{
  tipo: string; estado: string; motivo: string | null; emitido_en: string;
}[]> {
  const supabase = await crearClienteServidor();
  const { data } = await supabase
    .from('dictamenes_calidad')
    .select('tipo, estado, motivo_texto, emitido_en, motivos(nombre)')
    .eq('lote_id', loteId)
    .eq('vigente', true);

  return (data ?? []).map((x) => {
    const m = Array.isArray(x.motivos) ? x.motivos[0] : x.motivos;
    //  El tipificado y el texto, los dos si hay los dos.
    const partes = [m?.nombre as string | undefined, (x.motivo_texto as string | null) ?? undefined]
      .filter((p): p is string => !!p && p.trim() !== '');
    return {
      tipo: x.tipo as string,
      estado: x.estado as string,
      motivo: partes.length ? partes.join(' · ') : null,
      emitido_en: String(x.emitido_en),
    };
  });
}
