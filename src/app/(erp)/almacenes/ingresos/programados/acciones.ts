'use server';

/**
 * ============================================================================
 *  INGRESOS PROGRAMADOS · confirmar la llegada o anular
 * ============================================================================
 *  Un ingreso programado es un pallet que se sabe que va a llegar (casi
 *  siempre una compra) y que ya quedó cargado con todos sus datos. No mueve
 *  stock. Cuando el camión llega:
 *
 *    · «Confirmar llegada»: se cuentan los bultos y se pesan; si no coinciden
 *      con lo anunciado se corrigen ahí mismo, y nace el pallet con la MISMA
 *      función que el formulario de ingreso (registro.ts). Se puede confirmar
 *      uno o varios de una vez.
 *    · «Anular»: no va a llegar. Con motivo.
 *
 *  Confirmar la llegada lo puede hacer Almacén, además de Gerencia y
 *  Operaciones: es la constatación física de que el pallet entró a cámara.
 *  La validación de los datos ya la hizo Gerencia u Operaciones al validar la
 *  importación que lo programó.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { hoyEnLima } from '@/lib/fechas';
import { rolNoPuede, traducirErrorBase } from '@/lib/mensajesBase';
import { PUEDEN_INGRESAR, type DatosIngreso } from '../tipos';
import { cargarContexto, revisarIngreso, crearIngreso, refrescarIngresos, normalizarCodigo } from '../registro';

export type ResultadoLlegada = {
  ok: boolean;
  mensaje: string;
  filas: { id: number; ok: boolean; mensaje: string; lote_id?: number }[];
};

async function autorizar(que: string) {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { error: 'Su sesión caducó. Vuelva a entrar.' };
  if (!(PUEDEN_INGRESAR as readonly string[]).includes(usuario.rol)) return { error: rolNoPuede(usuario.rol, que, PUEDEN_INGRESAR) };
  return { usuario };
}

export async function confirmarLlegadas(
  items: { id: number; bultos: number; peso_neto_kg: number }[]
): Promise<ResultadoLlegada> {
  const permiso = await autorizar('confirmar la llegada de ingresos programados');
  if (permiso.error) return { ok: false, mensaje: permiso.error, filas: [] };
  if (!items.length) return { ok: false, mensaje: 'Elija al menos un ingreso para confirmar.', filas: [] };
  const usuarioId = permiso.usuario!.id as string;

  const supabase = await crearClienteServidor();
  const resultados: ResultadoLlegada['filas'] = [];

  for (const it of items) {
    /* Se toma el programado antes de crear el pallet: si dos personas
       confirman a la vez, lo confirma una sola. */
    const { data: tomado } = await supabase
      .from('ingresos_programados')
      .update({ estado: 'confirmado', confirmado_por: usuarioId, confirmado_en: new Date().toISOString() })
      .eq('id', it.id).eq('estado', 'programado')
      .select('*');
    const p = tomado?.[0];
    if (!p) {
      resultados.push({ id: it.id, ok: false, mensaje: 'Ya no está programado: otra persona lo confirmó o lo anuló.' });
      continue;
    }
    const soltar = () => supabase.from('ingresos_programados')
      .update({ estado: 'programado', confirmado_por: null, confirmado_en: null }).eq('id', it.id);

    const d: DatosIngreso = {
      codigo_pallet: String(p.codigo_pallet),
      sku_presentacion_id: Number(p.sku_presentacion_id),
      almacen_id: Number(p.almacen_id),
      camara_id: p.camara_id ? Number(p.camara_id) : null,
      fecha_produccion: String(p.fecha_produccion),
      turno: p.turno as DatosIngreso['turno'],
      proceso: p.proceso as DatosIngreso['proceso'],
      planta_id: p.planta_id ? Number(p.planta_id) : null,
      linea_procesadora_id: p.linea_procesadora_id ? Number(p.linea_procesadora_id) : null,
      //  Lo que de verdad llegó, si se corrigió al contar.
      bultos: Number(it.bultos),
      peso_neto_kg: Number(it.peso_neto_kg),
      costo_unitario: Number(p.costo_unitario ?? 0),
      observaciones: p.observaciones as string | null,
      origen_ingreso: p.origen_ingreso as DatosIngreso['origen_ingreso'],
      proveedor: p.proveedor as string | null,
    };

    //  Las reglas de siempre, con los datos de hoy (la bodega pudo dejar de recibir ese origen…).
    const ctx = await cargarContexto(supabase, [normalizarCodigo(d.codigo_pallet)], [d.sku_presentacion_id], hoyEnLima());
    const problemas = revisarIngreso(d, ctx);
    if (problemas.length) {
      await soltar();
      resultados.push({ id: it.id, ok: false, mensaje: `${d.codigo_pallet}: ${problemas[0].mensaje}` });
      continue;
    }

    const cambio = Number(p.bultos) !== d.bultos || Math.abs(Number(p.peso_neto_kg) - d.peso_neto_kg) > 0.0005;
    const r = await crearIngreso(supabase, usuarioId, d, {
      documento: cambio
        ? `llegada de un ingreso programado; se anunciaron ${p.bultos} bultos y ${Number(p.peso_neto_kg).toLocaleString('es-PE', { maximumFractionDigits: 1 })} kg`
        : 'llegada de un ingreso programado',
    });
    if (!r.ok) {
      await soltar();
      resultados.push({ id: it.id, ok: false, mensaje: `${d.codigo_pallet}: ${r.mensaje}` });
      continue;
    }

    await supabase.from('ingresos_programados')
      .update({ lote_id: r.id, bultos: d.bultos, peso_neto_kg: d.peso_neto_kg }).eq('id', it.id);
    await supabase.rpc('registrar_evento', {
      p_entidad: 'ingresos_programados', p_entidad_id: it.id, p_tipo: 'ingreso_programado_confirmado',
      p_descripcion: `Llegó el pallet ${r.codigo}` + (cambio ? ` con ${d.bultos} bultos y ${d.peso_neto_kg} kg (se anunciaron ${p.bultos} y ${p.peso_neto_kg})` : ''),
      p_severidad: 'info', p_metadatos: { lote_id: r.id },
    }).then(() => undefined, () => undefined);
    resultados.push({ id: it.id, ok: true, mensaje: r.mensaje, lote_id: r.id });
  }

  const bien = resultados.filter((r) => r.ok).length;
  if (bien) refrescarIngresos();
  revalidatePath('/almacenes/ingresos/programados');
  const mal = resultados.length - bien;
  return {
    ok: mal === 0,
    mensaje: `${bien} llegada${bien === 1 ? '' : 's'} confirmada${bien === 1 ? '' : 's'}` +
      (mal ? `; ${mal} no se pudo: ${resultados.filter((r) => !r.ok).map((r) => r.mensaje).join(' · ')}` : '. Los pallets ya están en stock.'),
    filas: resultados,
  };
}

export async function anularProgramado(id: number, motivo: string): Promise<{ ok: boolean; mensaje: string }> {
  const permiso = await autorizar('anular ingresos programados');
  if (permiso.error) return { ok: false, mensaje: permiso.error };
  if (!motivo?.trim() || motivo.trim().length < 5) {
    return { ok: false, mensaje: 'Escriba por qué se anula (al menos 5 letras): sin motivo nadie sabrá qué pasó.' };
  }

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase
    .from('ingresos_programados')
    .update({ estado: 'anulado', anulado_por: permiso.usuario!.id, anulado_en: new Date().toISOString(), motivo_anulacion: motivo.trim().slice(0, 300) })
    .eq('id', id).eq('estado', 'programado')
    .select('codigo_pallet');
  if (error) return { ok: false, mensaje: traducirErrorBase(error, { que: 'anular el ingreso programado', quien: PUEDEN_INGRESAR }) };
  if (!data?.length) return { ok: false, mensaje: 'Ya no está programado: otra persona lo confirmó o lo anuló.' };

  await supabase.rpc('registrar_evento', {
    p_entidad: 'ingresos_programados', p_entidad_id: id, p_tipo: 'ingreso_programado_anulado',
    p_descripcion: `Ingreso programado del pallet ${data[0].codigo_pallet} anulado: ${motivo.trim()}`,
    p_severidad: 'info', p_metadatos: {},
  }).then(() => undefined, () => undefined);

  revalidatePath('/almacenes/ingresos/programados');
  return { ok: true, mensaje: `Ingreso programado del pallet ${data[0].codigo_pallet} anulado. No se movió stock.` };
}
