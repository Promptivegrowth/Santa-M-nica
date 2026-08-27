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
 *  `lote_bloqueado`, no esta pantalla. Aquí solo se registra el dictamen.
 *
 *  UN DICTAMEN NO SE EDITA: SE REEMPLAZA
 *  Cuando se emite uno nuevo del mismo tipo, el anterior deja de estar vigente
 *  pero se conserva. Así queda la historia entera: cuándo se observó, quién lo
 *  observó, con qué sustento, y cuándo y quién lo liberó. Editar el anterior
 *  borraría justo lo que hace falta si mañana llega un reclamo sanitario.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';

export type Resultado =
  | { ok: true; id: number; mensaje: string }
  | { ok: false; mensaje: string; campo?: string };

/** Calidad y operaciones dictaminan; gerencia por si acaso. */
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

function refrescar(loteId: number) {
  revalidatePath('/almacenes/calidad');
  revalidatePath(`/almacenes/lotes/${loteId}`);
  revalidatePath('/almacenes/existencias');
  revalidatePath('/ventas/disponibilidad');
  revalidatePath('/almacenes/reservas');
  revalidatePath('/alertas');
  revalidatePath('/panel');
}

export async function registrarDictamen(d: DatosDictamen): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión caducó. Vuelva a entrar.' };
  if (!PUEDEN_DICTAMINAR.includes(usuario.rol)) {
    return { ok: false, mensaje: `Su rol (${usuario.rol}) no puede emitir dictámenes de calidad.` };
  }

  if (!d.lote_id) return { ok: false, mensaje: 'Elija el lote.', campo: 'lote_id' };

  /*
   * Bloquear un lote sin decir por qué es lo peor que puede pasar aquí: dentro
   * de un mes nadie sabrá si se puede liberar. Por eso el motivo es
   * obligatorio cuando el dictamen bloquea, y opcional cuando libera.
   */
  if (BLOQUEAN.includes(d.estado) && !d.motivo_id && !d.motivo_texto?.trim()) {
    return {
      ok: false,
      mensaje: 'Un dictamen que bloquea necesita motivo: quien lo vea después tiene que saber por qué.',
      campo: 'motivo',
    };
  }

  const supabase = await crearClienteServidor();

  const { data: lote } = await supabase
    .from('lotes').select('codigo_pallet').eq('id', d.lote_id).maybeSingle();
  if (!lote) return { ok: false, mensaje: 'Ese lote ya no existe.' };

  /* ---- Si el nuevo dictamen libera, se comprueba qué había antes ---- */
  const { data: previo } = await supabase
    .from('dictamenes_calidad')
    .select('id, estado')
    .eq('lote_id', d.lote_id)
    .eq('tipo', d.tipo)
    .eq('vigente', true)
    .maybeSingle();

  /* ---- El anterior del mismo tipo deja de estar vigente, pero se conserva ---- */
  if (previo) {
    await supabase
      .from('dictamenes_calidad')
      .update({
        vigente: false,
        // Si el nuevo libera, se marca en el viejo quién y cuándo lo levantó.
        ...(d.estado === 'liberado'
          ? { liberado_por: usuario.id, liberado_en: new Date().toISOString() }
          : {}),
      })
      .eq('id', previo.id);
  }

  const { data: creado, error } = await supabase
    .from('dictamenes_calidad')
    .insert({
      lote_id: d.lote_id,
      tipo: d.tipo,
      estado: d.estado,
      motivo_id: d.motivo_id,
      motivo_texto: d.motivo_texto?.trim() || null,
      sustento_url: d.sustento_url?.trim() || null,
      observaciones: d.observaciones?.trim() || null,
      emitido_por: usuario.id,
      vigente: true,
      ...(d.estado === 'liberado'
        ? { liberado_por: usuario.id, liberado_en: new Date().toISOString() }
        : {}),
    })
    .select('id')
    .single();

  if (error || !creado) {
    return { ok: false, mensaje: `No se pudo registrar el dictamen: ${error?.message}` };
  }

  const bloquea = BLOQUEAN.includes(d.estado);

  await supabase.rpc('registrar_evento', {
    p_entidad: 'lotes',
    p_entidad_id: d.lote_id,
    p_tipo: bloquea ? 'lote_bloqueado' : 'lote_liberado',
    p_descripcion:
      `Dictamen de ${d.tipo.replace('_', ' ')} para ${lote.codigo_pallet}: ${d.estado.replace('_', ' ')}` +
      (d.motivo_texto?.trim() ? ` · ${d.motivo_texto.trim()}` : ''),
    p_severidad: d.estado === 'inmovilizado' ? 'critica' : bloquea ? 'advertencia' : 'info',
    p_metadatos: { pallet: lote.codigo_pallet, tipo: d.tipo, estado: d.estado },
  }).then(() => undefined, () => undefined);

  /* ---- ¿Sigue bloqueado por otro dictamen? Conviene decirlo ---- */
  const { data: sigueBloqueado } = await supabase
    .rpc('lote_bloqueado', { p_lote_id: d.lote_id });

  refrescar(d.lote_id);

  let mensaje: string;
  if (bloquea) {
    mensaje =
      `Pallet ${lote.codigo_pallet} ${d.estado === 'inmovilizado' ? 'inmovilizado' : d.estado === 'observado' ? 'observado' : 'en espera de resultados'}. ` +
      'Deja de estar disponible: no se puede reservar, trasladar ni despachar.';
  } else if (sigueBloqueado) {
    mensaje =
      `Dictamen de ${d.tipo.replace('_', ' ')} liberado, pero el pallet ${lote.codigo_pallet} ` +
      'SIGUE bloqueado por otro dictamen abierto. Revise los demás para que vuelva a estar disponible.';
  } else {
    mensaje =
      `Pallet ${lote.codigo_pallet} liberado. Ya no tiene ningún dictamen abierto: vuelve a estar ` +
      'disponible para vender.';
  }

  return { ok: true, id: creado.id as number, mensaje };
}

/* ==========================================================================
   AYUDAS
   ========================================================================== */

/** Los motivos tipificados de observación, del maestro. */
export async function motivosCalidad(): Promise<{ id: number; nombre: string }[]> {
  const supabase = await crearClienteServidor();
  const { data } = await supabase
    .from('motivos').select('id, nombre, ambito').eq('activo', true).order('nombre');

  /*
   * El maestro de motivos sirve a varias cosas —ingreso, salida, ajuste,
   * bloqueo—; los de calidad son los del ámbito «bloqueo». Si ese ámbito
   * estuviera vacío se ofrecen todos: es preferible una lista larga a un
   * desplegable en blanco que impida registrar el dictamen.
   */
  const deBloqueo = (data ?? []).filter((m) => String(m.ambito ?? '') === 'bloqueo');
  const lista = deBloqueo.length > 0 ? deBloqueo : (data ?? []);
  return lista.map((m) => ({ id: m.id as number, nombre: m.nombre as string }));
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
    return {
      tipo: x.tipo as string,
      estado: x.estado as string,
      motivo: (x.motivo_texto as string) ?? (m?.nombre as string) ?? null,
      emitido_en: String(x.emitido_en),
    };
  });
}
