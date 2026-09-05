'use server';

/**
 * ============================================================================
 *  LOS TRES COSTOS DE PRODUCCIÓN, MES A MES
 * ============================================================================
 *  Oliver: «son tres costos, a llenar al inicio de mes [...] ese lo tendría
 *  que ingresar Marco, que tiene todos los datos».
 *
 *  Escribe solo GERENCIA. No es rigidez: el costo de producción decide el
 *  margen de toda la empresa, y quien lo teclea decide de hecho si un pedido
 *  parece rentable. La base lo impone también, con su propia política.
 *
 *  EL BOTÓN QUE DE VERDAD IMPORTA
 *  «Copiar del mes anterior». Son 191 productos por tres campos: 573 números
 *  cada mes. Nadie sostiene eso, y un sistema que lo exige acaba con los
 *  costos sin cargar. Lo normal es que el mes cambie poco, así que se copia y
 *  se ajusta lo que se movió.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';

export type Resultado =
  | { ok: true; mensaje: string; cuantos?: number }
  | { ok: false; mensaje: string };

/** Solo Gerencia escribe costos. */
const PUEDEN_ESCRIBIR = ['gerencia'];

async function autorizar() {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { error: 'Su sesión caducó. Vuelva a entrar.' };
  if (!PUEDEN_ESCRIBIR.includes(usuario.rol)) {
    return {
      error:
        `Su rol (${usuario.rol}) no puede cargar costos de producción. ` +
        'Corresponde a Gerencia, que es quien tiene los datos de compra y de planilla.',
    };
  }
  return { usuario };
}

export type DatosCosto = {
  sku_id: number;
  anio: number;
  mes: number;
  materia_prima_kg: number;
  conversion_kg: number;
  variable_kg: number;
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

  const supabase = await crearClienteServidor();

  const { error } = await supabase
    .from('costos_mensuales')
    .upsert({
      sku_id: d.sku_id,
      anio: d.anio,
      mes: d.mes,
      materia_prima_kg: d.materia_prima_kg,
      conversion_kg: d.conversion_kg,
      variable_kg: d.variable_kg,
      registrado_por: permiso.usuario!.id,
    }, { onConflict: 'sku_id,anio,mes' });

  if (error) return { ok: false, mensaje: `No se pudo guardar: ${error.message}` };

  /*
   * Se vuelve a leer antes de decir que se guardó.
   *
   * Es la lección de un fallo real de este mismo proyecto: una escritura que
   * la política de seguridad rechaza NO da error, simplemente no afecta a
   * ninguna fila. Decir «guardado» sin haber mirado deja al usuario
   * convencido de algo que no ocurrió.
   */
  const { data: verif } = await supabase
    .from('costos_mensuales')
    .select('total_kg')
    .eq('sku_id', d.sku_id).eq('anio', d.anio).eq('mes', d.mes)
    .maybeSingle();

  if (!verif || Math.abs(Number(verif.total_kg) - total) > 0.0001) {
    return {
      ok: false,
      mensaje: 'El costo no llegó a guardarse. Avise a soporte en vez de volver a intentarlo.',
    };
  }

  revalidatePath('/finanzas/costos');
  revalidatePath('/finanzas/rentabilidad');

  return { ok: true, mensaje: `Costo guardado: US$ ${total.toFixed(4)} por kilo.` };
}

/* ==========================================================================
   COPIAR EL MES ANTERIOR
   --------------------------------------------------------------------------
   El botón que hace sostenible cargar costos todos los meses. Copia solo lo
   que FALTA: nunca pisa un valor ya cargado, porque quien lo escribió a mano
   lo hizo con un motivo.
   ========================================================================== */
export async function copiarMesAnterior(anio: number, mes: number): Promise<Resultado> {
  const permiso = await autorizar();
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const supabase = await crearClienteServidor();

  const anteriorMes = mes === 1 ? 12 : mes - 1;
  const anteriorAnio = mes === 1 ? anio - 1 : anio;

  const [{ data: origen }, { data: yaHay }] = await Promise.all([
    supabase
      .from('costos_mensuales')
      .select('sku_id, materia_prima_kg, conversion_kg, variable_kg')
      .eq('anio', anteriorAnio).eq('mes', anteriorMes),
    supabase
      .from('costos_mensuales')
      .select('sku_id')
      .eq('anio', anio).eq('mes', mes),
  ]);

  if (!origen?.length) {
    return {
      ok: false,
      mensaje:
        `No hay costos cargados en ${String(anteriorMes).padStart(2, '0')}/${anteriorAnio}, ` +
        'así que no hay nada que copiar.',
    };
  }

  const cargados = new Set((yaHay ?? []).map((c) => Number(c.sku_id)));
  const nuevos = origen.filter((c) => !cargados.has(Number(c.sku_id)));

  if (!nuevos.length) {
    return { ok: false, mensaje: 'Este mes ya tiene todos los productos del mes anterior cargados.' };
  }

  const { error } = await supabase.from('costos_mensuales').insert(
    nuevos.map((c) => ({
      sku_id: c.sku_id,
      anio, mes,
      materia_prima_kg: c.materia_prima_kg,
      conversion_kg: c.conversion_kg,
      variable_kg: c.variable_kg,
      registrado_por: permiso.usuario!.id,
      observaciones: `Copiado de ${String(anteriorMes).padStart(2, '0')}/${anteriorAnio}`,
    }))
  );

  if (error) return { ok: false, mensaje: `No se pudo copiar: ${error.message}` };

  await supabase.rpc('registrar_evento', {
    p_entidad: 'costos_mensuales',
    p_entidad_id: null,
    p_tipo: 'costos_copiados',
    p_descripcion:
      `${permiso.usuario!.nombre} copió ${nuevos.length} costos de ` +
      `${String(anteriorMes).padStart(2, '0')}/${anteriorAnio} a ${String(mes).padStart(2, '0')}/${anio}`,
    p_severidad: 'info',
  }).then(() => undefined, () => undefined);

  revalidatePath('/finanzas/costos');
  revalidatePath('/finanzas/rentabilidad');

  return {
    ok: true,
    cuantos: nuevos.length,
    mensaje:
      `${nuevos.length} producto${nuevos.length === 1 ? '' : 's'} copiado${nuevos.length === 1 ? '' : 's'} ` +
      `de ${String(anteriorMes).padStart(2, '0')}/${anteriorAnio}. ` +
      'Revise y ajuste lo que haya cambiado.',
  };
}

/* ==========================================================================
   BORRAR EL COSTO DE UN PRODUCTO EN UN MES
   ========================================================================== */
export async function borrarCosto(sku_id: number, anio: number, mes: number): Promise<Resultado> {
  const permiso = await autorizar();
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const supabase = await crearClienteServidor();
  const { error } = await supabase
    .from('costos_mensuales').delete()
    .eq('sku_id', sku_id).eq('anio', anio).eq('mes', mes);

  if (error) return { ok: false, mensaje: `No se pudo borrar: ${error.message}` };

  revalidatePath('/finanzas/costos');
  revalidatePath('/finanzas/rentabilidad');
  return {
    ok: true,
    mensaje:
      'Costo borrado. Los pedidos de ese mes pasarán a medirse con el último costo anterior que haya cargado.',
  };
}
