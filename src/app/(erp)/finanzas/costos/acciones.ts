'use server';

/**
 * ============================================================================
 *  LOS TRES COSTOS DE PRODUCCIÓN · carga del mes y actualizaciones
 * ============================================================================
 *  Oliver: «son tres costos, a llenar al inicio de mes [...] ese lo tendría
 *  que ingresar Marco». Y el documento de mejoras (2.2): obligatorio al
 *  inicio de cada mes, actualizable después —semanalmente—, con registro del
 *  costo anterior, el nuevo, la fecha y el usuario.
 *
 *  CÓMO SE TRADUCE UN «GUARDAR» (migración 057)
 *  El costo ya no es «el de un mes»: es el que rige DESDE una fecha, y solo
 *  hacia adelante. Así que guardar en la pantalla significa:
 *
 *    · Mes en curso, producto SIN la carga del mes → carga mensual desde hoy.
 *    · Mes en curso, producto CON la carga del mes → actualización desde hoy.
 *      Si ya hay una vigencia que empieza hoy, se corrige esa.
 *    · Mes futuro → la carga mensual de ese mes, desde el día 1. Se puede
 *      corregir hasta que llegue ese día.
 *    · Mes pasado → no se puede: ya se aplicó a ingresos reales.
 *
 *  La base impone lo mismo por su cuenta (costos_solo_hacia_adelante), y el
 *  historial lo escribe un disparador: esta capa no puede saltárselo.
 *
 *  QUIÉN ESCRIBE (migración 062)
 *  Un permiso de PERSONA, «carga_costos»: hoy Marco y Oliver, que son quienes
 *  conocen el costo de cada producto. Antes era el rol Gerencia, y Oliver
 *  veía la pantalla en solo lectura sin saber por qué.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { hoyEnLima } from '@/lib/fechas';

export type Resultado =
  | { ok: true; mensaje: string; cuantos?: number }
  | { ok: false; mensaje: string };

/** Escriben costos las personas con el permiso «carga_costos». */
async function autorizar() {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { error: 'Su sesión caducó. Vuelva a entrar.' };
  if (usuario.carga_costos !== true) {
    return {
      error:
        'Usted no tiene permiso para cargar costos de producción. Lo da Gerencia en ' +
        'Configuración → Usuarios, columna «Carga costos».',
    };
  }
  return { usuario };
}

/** «2026-09» → primer día «2026-09-01». */
const primerDia = (periodo: string) => `${periodo}-01`;

/**
 * Desde qué día rige lo que se guarde en ese periodo, o por qué no se puede.
 * Es la única regla de fechas de esta capa; la base aplica la misma.
 */
function vigenciaPara(periodo: string): { desde: string; esMesActual: boolean } | { error: string } {
  if (!/^\d{4}-\d{2}$/.test(periodo)) return { error: 'Periodo no válido.' };
  const hoy = hoyEnLima();
  const actual = hoy.slice(0, 7);
  if (periodo < actual) {
    return {
      error:
        'Ese mes ya pasó y sus costos se aplicaron a los ingresos de esos días: no se pueden cambiar. ' +
        'Si el costo de hoy es otro, cárguelo en el mes en curso y regirá desde hoy.',
    };
  }
  return periodo === actual ? { desde: hoy, esMesActual: true } : { desde: primerDia(periodo), esMesActual: false };
}

/** Traduce el error de la base a algo que se entienda en pantalla. */
function explicar(mensaje: string): string {
  //  Las excepciones de los disparadores ya vienen redactadas para el usuario.
  return mensaje.replace(/^.*?ERROR:\s*/, '');
}

export type DatosCosto = {
  sku_id: number;
  /** El mes que se está mirando en pantalla: «AAAA-MM». */
  periodo: string;
  materia_prima_kg: number;
  conversion_kg: number;
  variable_kg: number;
  observaciones?: string;
};

/* ==========================================================================
   GUARDAR EL COSTO DE UN PRODUCTO
   ========================================================================== */
export async function guardarCosto(d: DatosCosto): Promise<Resultado> {
  const permiso = await autorizar();
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  for (const [nombre, valor] of [
    ['materia prima', d.materia_prima_kg],
    ['conversión', d.conversion_kg],
    ['variable', d.variable_kg],
  ] as const) {
    if (!Number.isFinite(valor) || valor < 0) {
      return { ok: false, mensaje: `El costo de ${nombre} no puede ser negativo.` };
    }
  }

  const total = d.materia_prima_kg + d.conversion_kg + d.variable_kg;
  if (total <= 0) {
    return {
      ok: false,
      mensaje:
        'Los tres costos no pueden ser cero: eso daría un margen del 100 % en todo lo que se venda. ' +
        'Si todavía no los tiene, deje el producto sin cargar en vez de ponerlo en cero.',
    };
  }

  const v = vigenciaPara(d.periodo);
  if ('error' in v) return { ok: false, mensaje: v.error };

  const supabase = await crearClienteServidor();

  /*
   * ¿Carga del mes o actualización? Depende de si el producto ya tiene su
   * carga mensual en ese mes. En un mes futuro siempre es la carga.
   */
  let tipo: 'mensual' | 'actualizacion' = 'mensual';
  if (v.esMesActual) {
    const { data: carga } = await supabase
      .from('costos_mensuales').select('id')
      .eq('sku_id', d.sku_id).eq('tipo', 'mensual')
      .gte('vigente_desde', primerDia(d.periodo)).lte('vigente_desde', v.desde)
      .limit(1);
    if ((carga ?? []).length > 0) tipo = 'actualizacion';
  }

  //  Si ya hay una vigencia que empieza ese mismo día, se corrige esa: no
  //  pueden convivir dos costos que rigen desde el mismo día.
  const { data: mismaFecha } = await supabase
    .from('costos_mensuales').select('id, tipo')
    .eq('sku_id', d.sku_id).eq('vigente_desde', v.desde).maybeSingle();

  const valores = {
    materia_prima_kg: d.materia_prima_kg,
    conversion_kg: d.conversion_kg,
    variable_kg: d.variable_kg,
    registrado_por: permiso.usuario!.id,
    observaciones: d.observaciones?.trim() || null,
  };

  const { error } = mismaFecha
    ? await supabase.from('costos_mensuales').update(valores).eq('id', mismaFecha.id)
    : await supabase.from('costos_mensuales').insert({
        ...valores,
        sku_id: d.sku_id,
        vigente_desde: v.desde,
        //  anio y mes los rellena la base a partir de la vigencia.
        anio: Number(v.desde.slice(0, 4)),
        mes: Number(v.desde.slice(5, 7)),
        tipo,
      });

  if (error) return { ok: false, mensaje: explicar(error.message) };

  /*
   * Se vuelve a leer antes de decir que se guardó: una escritura que la
   * política de seguridad rechaza NO da error, simplemente no afecta a
   * ninguna fila.
   */
  const { data: verif } = await supabase
    .from('costos_mensuales').select('total_kg, tipo')
    .eq('sku_id', d.sku_id).eq('vigente_desde', v.desde).maybeSingle();

  if (!verif || Math.abs(Number(verif.total_kg) - total) > 0.0001) {
    return { ok: false, mensaje: 'El costo no llegó a guardarse. Avise a soporte en vez de volver a intentarlo.' };
  }

  revalidatePath('/finanzas/costos');
  revalidatePath('/finanzas/rentabilidad');

  const que = mismaFecha ? 'Corregido' : verif.tipo === 'actualizacion' ? 'Actualización registrada' : 'Carga del mes registrada';
  const desde = v.desde.split('-').reverse().join('/');
  return {
    ok: true,
    mensaje: `${que}: US$ ${total.toFixed(4)} por kilo, desde el ${desde}. Los ingresos anteriores conservan su costo.`,
  };
}

/* ==========================================================================
   CARGAR EL MES CON LOS COSTOS QUE RIGEN
   --------------------------------------------------------------------------
   El botón que hace sostenible la carga obligatoria: 191 productos por tres
   campos son 573 números cada mes, y nadie sostiene eso. Se toma el costo que
   rige hoy para cada producto que todavía no tiene la carga del mes y se
   registra como tal; luego se ajusta solo lo que se movió.

   Nunca pisa nada: solo crea la carga de los que no la tienen.
   ========================================================================== */
export async function cargarMesConVigentes(periodo: string): Promise<Resultado> {
  const permiso = await autorizar();
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const v = vigenciaPara(periodo);
  if ('error' in v) return { ok: false, mensaje: v.error };

  const supabase = await crearClienteServidor();
  const finMes = new Date(Number(periodo.slice(0, 4)), Number(periodo.slice(5, 7)), 0).getDate();

  const [{ data: vigentes }, { data: yaCargados }, { data: mismaFecha }] = await Promise.all([
    //  El costo que rige hoy de cada producto: la vigencia más reciente.
    supabase.from('v_costos_carga_mes').select('sku_id, total_kg'),
    supabase.from('costos_mensuales').select('sku_id')
      .eq('tipo', 'mensual')
      .gte('vigente_desde', primerDia(periodo)).lte('vigente_desde', `${periodo}-${finMes}`),
    supabase.from('costos_mensuales').select('sku_id').eq('vigente_desde', v.desde),
  ]);

  const tienen = new Set([...(yaCargados ?? []), ...(mismaFecha ?? [])].map((c) => Number(c.sku_id)));
  const faltan = (vigentes ?? []).filter((x) => !tienen.has(Number(x.sku_id)) && Number(x.total_kg) > 0);

  if (!faltan.length) {
    return { ok: false, mensaje: 'Todos los productos que tienen algún costo ya tienen la carga de este mes.' };
  }

  //  Los tres componentes de la vigencia que rige, no solo el total.
  const ids = faltan.map((f) => Number(f.sku_id));
  const { data: detalle } = await supabase
    .from('costos_mensuales')
    .select('sku_id, vigente_desde, materia_prima_kg, conversion_kg, variable_kg')
    .in('sku_id', ids).lte('vigente_desde', hoyEnLima())
    .order('vigente_desde', { ascending: false });

  const ultimo = new Map<number, { materia_prima_kg: number; conversion_kg: number; variable_kg: number }>();
  for (const c of detalle ?? []) {
    if (!ultimo.has(Number(c.sku_id))) ultimo.set(Number(c.sku_id), c as never);
  }

  const filas = ids.filter((id) => ultimo.has(id)).map((id) => ({
    sku_id: id,
    vigente_desde: v.desde,
    anio: Number(v.desde.slice(0, 4)),
    mes: Number(v.desde.slice(5, 7)),
    tipo: 'mensual',
    materia_prima_kg: ultimo.get(id)!.materia_prima_kg,
    conversion_kg: ultimo.get(id)!.conversion_kg,
    variable_kg: ultimo.get(id)!.variable_kg,
    registrado_por: permiso.usuario!.id,
    observaciones: 'Carga del mes con el costo que regía',
  }));

  const { error } = await supabase.from('costos_mensuales').insert(filas);
  if (error) return { ok: false, mensaje: explicar(error.message) };

  await supabase.rpc('registrar_evento', {
    p_entidad: 'costos_mensuales',
    p_entidad_id: null,
    p_tipo: 'costos_cargados',
    p_descripcion: `${permiso.usuario!.nombre} cargó ${filas.length} costos de ${periodo} con los que regían`,
    p_severidad: 'info',
  }).then(() => undefined, () => undefined);

  //  El aviso de costos sin cargar se recalcula al momento, no mañana.
  await supabase.rpc('costos_avisar_carga_mensual').then(() => undefined, () => undefined);

  revalidatePath('/finanzas/costos');
  revalidatePath('/finanzas/rentabilidad');

  return {
    ok: true,
    cuantos: filas.length,
    mensaje:
      `${filas.length} producto${filas.length === 1 ? '' : 's'} con la carga del mes, ` +
      `con el costo que regía. Revise y ajuste lo que haya cambiado.`,
  };
}

/* ==========================================================================
   QUITAR EL COSTO QUE SE ACABA DE PONER
   --------------------------------------------------------------------------
   Solo se puede quitar una vigencia que todavía no empezó o que empieza hoy
   —un error recién cometido—. Una que ya rige se aplicó a ingresos: la base
   lo impide y el mensaje lo explica.
   ========================================================================== */
export async function borrarCosto(sku_id: number, periodo: string): Promise<Resultado> {
  const permiso = await autorizar();
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const v = vigenciaPara(periodo);
  if ('error' in v) return { ok: false, mensaje: v.error };

  const supabase = await crearClienteServidor();
  const { data: fila } = await supabase
    .from('costos_mensuales').select('id')
    .eq('sku_id', sku_id).eq('vigente_desde', v.desde).maybeSingle();

  if (!fila) {
    return {
      ok: false,
      mensaje:
        'El costo que rige hoy empezó antes de hoy y ya se aplicó a ingresos: no se puede quitar. ' +
        'Si está mal, escriba el correcto y quedará como actualización desde hoy.',
    };
  }

  const { error } = await supabase.from('costos_mensuales').delete().eq('id', fila.id);
  if (error) return { ok: false, mensaje: explicar(error.message) };

  await supabase.rpc('costos_avisar_carga_mensual').then(() => undefined, () => undefined);
  revalidatePath('/finanzas/costos');
  revalidatePath('/finanzas/rentabilidad');
  return { ok: true, mensaje: 'Quitado. Vuelve a regir el costo anterior de este producto.' };
}

/* ==========================================================================
   ACTUALIZACIÓN SEMANAL EN BLOQUE
   --------------------------------------------------------------------------
   El costo se conoce por producto, pero cuando se mueve —el precio de playa de
   la pota, la planilla— se mueve para muchos a la vez. Tocar 191 filas una por
   una cada semana no es viable. Esto cambia un componente para todos los
   productos de una especie o familia, con un valor nuevo o un porcentaje, y
   lo registra como actualización que rige DESDE HOY: lo que ya ingresó
   conserva su costo. Cada producto queda en el historial.
   ========================================================================== */
export type DatosBloque = {
  especie: string;      // '' = todas
  familia: string;      // '' = todas (clasificación comercial)
  componente: 'materia_prima_kg' | 'conversion_kg' | 'variable_kg';
  modo: 'valor' | 'porcentaje';
  cantidad: number;
  soloContar?: boolean; // para enseñar a cuántos productos afecta antes de aplicar
};

const NOMBRE_COMPONENTE = {
  materia_prima_kg: 'materia prima', conversion_kg: 'conversión', variable_kg: 'variable',
} as const;

export async function actualizarEnBloque(d: DatosBloque): Promise<Resultado> {
  const permiso = await autorizar();
  if (permiso.error) return { ok: false, mensaje: permiso.error };
  if (!(d.componente in NOMBRE_COMPONENTE)) return { ok: false, mensaje: 'Componente no válido.' };
  if (!Number.isFinite(d.cantidad)) return { ok: false, mensaje: 'Escriba un número.' };
  if (d.modo === 'valor' && d.cantidad < 0) return { ok: false, mensaje: 'Un costo no puede ser negativo.' };
  if (d.modo === 'porcentaje' && (d.cantidad <= -100 || d.cantidad > 500)) {
    return { ok: false, mensaje: 'El porcentaje tiene que estar entre −99 % y +500 %.' };
  }

  const supabase = await crearClienteServidor();
  const hoy = hoyEnLima();
  const periodo = hoy.slice(0, 7);

  //  Los productos del alcance.
  let consulta = supabase.from('skus').select('id, clasificacion_comercial, especies!inner(nombre)').eq('activo', true);
  if (d.especie) consulta = consulta.eq('especies.nombre', d.especie);
  if (d.familia) consulta = consulta.eq('clasificacion_comercial', d.familia);
  const { data: productos } = await consulta;
  const ids = (productos ?? []).map((p) => Number(p.id));
  if (!ids.length) return { ok: false, mensaje: 'Ningún producto activo coincide con ese alcance.' };

  //  El costo que rige hoy de cada uno, y lo registrado este mes.
  const [{ data: vigentes }, { data: delMes }] = await Promise.all([
    supabase.rpc('costos_vigentes_al', { p_fecha: hoy }),
    supabase.from('costos_mensuales').select('sku_id, tipo, vigente_desde')
      .gte('vigente_desde', `${periodo}-01`).lte('vigente_desde', hoy).in('sku_id', ids),
  ]);
  type Vig = { sku_id: number; materia_prima_kg: number; conversion_kg: number; variable_kg: number };
  const vigentePor = new Map(((vigentes ?? []) as Vig[]).map((v) => [Number(v.sku_id), v]));
  const conCarga = new Set((delMes ?? []).filter((x) => x.tipo === 'mensual').map((x) => Number(x.sku_id)));
  const hoyPor = new Map((delMes ?? []).filter((x) => x.vigente_desde === hoy).map((x) => [Number(x.sku_id), x.tipo as string]));

  const afectados = ids.filter((id) => vigentePor.has(id));
  const sinCosto = ids.length - afectados.length;
  if (!afectados.length) {
    return { ok: false, mensaje: 'Ninguno de esos productos tiene un costo cargado que actualizar. Cárguelos primero en la tabla.' };
  }
  const detalle = d.modo === 'valor'
    ? `${NOMBRE_COMPONENTE[d.componente]} a US$ ${d.cantidad.toFixed(4)}/kg`
    : `${NOMBRE_COMPONENTE[d.componente]} ${d.cantidad > 0 ? '+' : ''}${d.cantidad} %`;
  const alcance = [d.especie, d.familia].filter(Boolean).join(' · ') || 'todos los productos';

  if (d.soloContar) {
    return {
      ok: true, cuantos: afectados.length,
      mensaje: `Afectará a ${afectados.length} producto${afectados.length === 1 ? '' : 's'} (${alcance})` +
        (sinCosto ? `; ${sinCosto} sin costo cargado quedan fuera.` : '.'),
    };
  }

  const filas = afectados.map((id) => {
    const v = vigentePor.get(id)!;
    const actual = Number(v[d.componente]);
    const nuevo = d.modo === 'valor' ? d.cantidad : Math.round(actual * (1 + d.cantidad / 100) * 10000) / 10000;
    return {
      sku_id: id,
      vigente_desde: hoy,
      anio: Number(hoy.slice(0, 4)),
      mes: Number(hoy.slice(5, 7)),
      //  Si hoy ya había una vigencia se corrige con su mismo tipo; si no, es
      //  la carga del mes (si aún no la tenía) o una actualización.
      tipo: hoyPor.get(id) ?? (conCarga.has(id) ? 'actualizacion' : 'mensual'),
      materia_prima_kg: Number(v.materia_prima_kg),
      conversion_kg: Number(v.conversion_kg),
      variable_kg: Number(v.variable_kg),
      [d.componente]: nuevo,
      registrado_por: permiso.usuario!.id,
      observaciones: `Actualización en bloque: ${detalle} (${alcance})`,
    };
  });
  if (filas.some((f) => f.materia_prima_kg + f.conversion_kg + f.variable_kg <= 0)) {
    return { ok: false, mensaje: 'Con ese cambio algún producto quedaría con costo cero. Revise la cantidad.' };
  }

  const { error } = await supabase.from('costos_mensuales').upsert(filas, { onConflict: 'sku_id,vigente_desde' });
  if (error) return { ok: false, mensaje: explicar(error.message) };

  //  Se relee: una escritura que la política rechaza no da error.
  const { count } = await supabase.from('costos_mensuales').select('id', { count: 'exact', head: true })
    .eq('vigente_desde', hoy).in('sku_id', afectados);
  if ((count ?? 0) < afectados.length) {
    return { ok: false, mensaje: 'No se llegaron a guardar todos. Avise a soporte.' };
  }

  await supabase.rpc('costos_avisar_carga_mensual').then(() => undefined, () => undefined);
  revalidatePath('/finanzas/costos');
  revalidatePath('/finanzas/rentabilidad');
  return {
    ok: true, cuantos: afectados.length,
    mensaje: `${afectados.length} producto${afectados.length === 1 ? '' : 's'} actualizado${afectados.length === 1 ? '' : 's'} ` +
      `(${detalle}), desde hoy. Lo que ya ingresó conserva su costo.` +
      (sinCosto ? ` ${sinCosto} sin costo cargado quedaron fuera.` : ''),
  };
}
