'use server';

/**
 * ============================================================================
 *  OBJETIVOS MENSUALES · guardar un valor o una meta
 * ============================================================================
 *  Escriben solo Marco y Oliver. La base lo impone por su cuenta (060); aquí
 *  se comprueba antes para poder dar un mensaje claro, y se relee después:
 *  una escritura que la política rechaza no da error, afecta a cero filas.
 *
 *  El historial —valor anterior, nuevo, fecha y usuario— lo escribe un
 *  disparador de la base: esta capa no puede saltárselo.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';

export type Resultado = { ok: true; mensaje: string } | { ok: false; mensaje: string };

async function autorizar() {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { error: 'Su sesión caducó. Vuelva a entrar.' };
  if (usuario.ve_objetivos !== true) return { error: 'Objetivos mensuales es solo para las personas autorizadas.' };
  return { usuario };
}

const valido = (n: number | null) => n === null || (Number.isFinite(n) && n >= 0);

/* ==========================================================================
   UN VALOR DEL MES · null lo quita
   ========================================================================== */
export async function guardarValor(d: {
  indicador_id: number; anio: number; mes: number; valor: number | null;
}): Promise<Resultado> {
  const permiso = await autorizar();
  if (permiso.error) return { ok: false, mensaje: permiso.error };
  if (!Number.isInteger(d.mes) || d.mes < 1 || d.mes > 12) return { ok: false, mensaje: 'Mes no válido.' };
  if (!valido(d.valor)) return { ok: false, mensaje: 'El valor tiene que ser un número mayor o igual que cero.' };

  const supabase = await crearClienteServidor();
  const { data: ind } = await supabase
    .from('objetivos_indicadores').select('tipo, nombre').eq('id', d.indicador_id).maybeSingle();
  if (!ind) return { ok: false, mensaje: 'Ese indicador no existe.' };

  if (d.valor === null) {
    const { error } = await supabase.from('objetivos_valores').delete()
      .eq('indicador_id', d.indicador_id).eq('anio', d.anio).eq('mes', d.mes);
    if (error) return { ok: false, mensaje: `No se pudo quitar: ${error.message}` };
  } else {
    const { error } = await supabase.from('objetivos_valores').upsert({
      indicador_id: d.indicador_id, anio: d.anio, mes: d.mes, valor: d.valor,
      registrado_por: permiso.usuario!.id, actualizado_en: new Date().toISOString(),
      observacion: null,
    }, { onConflict: 'indicador_id,anio,mes' });
    if (error) return { ok: false, mensaje: `No se pudo guardar: ${error.message}` };
  }

  const { data: verif } = await supabase.from('objetivos_valores').select('valor')
    .eq('indicador_id', d.indicador_id).eq('anio', d.anio).eq('mes', d.mes).maybeSingle();
  const quedo = verif ? Number(verif.valor) : null;
  if ((d.valor === null) !== (quedo === null) || (d.valor !== null && Math.abs(quedo! - d.valor) > 1e-6)) {
    return { ok: false, mensaje: 'El cambio no llegó a guardarse. Avise a soporte.' };
  }

  revalidatePath('/objetivos');
  return {
    ok: true,
    mensaje: d.valor === null
      ? (ind.tipo === 'manual' ? 'Valor quitado.' : 'Ajuste quitado: vuelve a mandar el cálculo.')
      : 'Guardado.',
  };
}

/* ==========================================================================
   UNA META · mes null = la del año; esperado y máximo vacíos la quitan
   ========================================================================== */
export async function guardarMeta(d: {
  indicador_id: number; anio: number; mes: number | null; esperado: number | null; maximo: number | null;
}): Promise<Resultado> {
  const permiso = await autorizar();
  if (permiso.error) return { ok: false, mensaje: permiso.error };
  if (d.mes !== null && (!Number.isInteger(d.mes) || d.mes < 1 || d.mes > 12)) return { ok: false, mensaje: 'Mes no válido.' };
  if (!valido(d.esperado) || !valido(d.maximo)) return { ok: false, mensaje: 'Las metas tienen que ser números mayores o iguales que cero.' };
  if (d.esperado !== null && d.maximo !== null && d.maximo < d.esperado) {
    return { ok: false, mensaje: 'El máximo no puede ser menor que el esperado.' };
  }

  const supabase = await crearClienteServidor();
  let existente = supabase.from('objetivos_metas').select('id')
    .eq('indicador_id', d.indicador_id).eq('anio', d.anio);
  existente = d.mes === null ? existente.is('mes', null) : existente.eq('mes', d.mes);
  const { data: fila } = await existente.maybeSingle();

  const quitar = d.esperado === null && d.maximo === null;
  const { error } = quitar
    ? (fila ? await supabase.from('objetivos_metas').delete().eq('id', fila.id) : { error: null })
    : fila
      ? await supabase.from('objetivos_metas').update({
          esperado: d.esperado, maximo: d.maximo, registrado_por: permiso.usuario!.id, actualizado_en: new Date().toISOString(),
        }).eq('id', fila.id)
      : await supabase.from('objetivos_metas').insert({
          indicador_id: d.indicador_id, anio: d.anio, mes: d.mes,
          esperado: d.esperado, maximo: d.maximo, registrado_por: permiso.usuario!.id,
        });
  if (error) return { ok: false, mensaje: `No se pudo guardar: ${error.message}` };

  let relectura = supabase.from('objetivos_metas').select('esperado, maximo')
    .eq('indicador_id', d.indicador_id).eq('anio', d.anio);
  relectura = d.mes === null ? relectura.is('mes', null) : relectura.eq('mes', d.mes);
  const { data: verif } = await relectura.maybeSingle();
  const igual = (a: unknown, b: number | null) => (a === null || a === undefined ? b === null : b !== null && Math.abs(Number(a) - b) < 1e-6);
  const bien = quitar ? !verif : !!verif && igual(verif.esperado, d.esperado) && igual(verif.maximo, d.maximo);
  if (!bien) return { ok: false, mensaje: 'La meta no llegó a guardarse. Avise a soporte.' };

  revalidatePath('/objetivos');
  return { ok: true, mensaje: quitar ? 'Meta quitada.' : 'Meta guardada.' };
}

/* ==========================================================================
   QUIÉN VE OBJETIVOS · lo da o lo quita alguien que ya lo ve
   ========================================================================== */
export async function alternarAccesoObjetivos(usuarioId: string, ve: boolean): Promise<Resultado> {
  const permiso = await autorizar();
  if (permiso.error) return { ok: false, mensaje: permiso.error };
  if (usuarioId === permiso.usuario!.id && !ve) {
    return { ok: false, mensaje: 'No puede quitarse el acceso a sí mismo: pídaselo a la otra persona autorizada.' };
  }
  const supabase = await crearClienteServidor();
  //  Función propia (060): Oliver no es Gerencia y aun así tiene que poder hacerlo.
  const { error } = await supabase.rpc('fijar_acceso_objetivos', { p_usuario: usuarioId, p_valor: ve });
  if (error) return { ok: false, mensaje: error.message.replace(/^.*?ERROR:\s*/, '') };
  const { data: verif } = await supabase.from('usuarios').select('ve_objetivos').eq('id', usuarioId).maybeSingle();
  if (verif?.ve_objetivos !== ve) return { ok: false, mensaje: 'El cambio no llegó a guardarse. Avise a soporte.' };
  revalidatePath('/configuracion');
  return { ok: true, mensaje: ve ? 'Acceso dado.' : 'Acceso quitado.' };
}
