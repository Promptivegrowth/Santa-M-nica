'use server';

/**
 * ============================================================================
 *  MAESTRO DE PRODUCTOS · crear, editar, desactivar y borrar
 * ============================================================================
 *  QUÉ ES UN «PRODUCTO» AQUÍ
 *  No es una fila: son dos niveles, y conviene entenderlo antes de tocar nada.
 *
 *    SKU            — qué es el producto: especie, formato, corte,
 *                     clasificación comercial, empaque y vida útil.
 *                     Ejemplo: pota · filete · «B» 2000-4000 · sacos.
 *
 *    PRESENTACIÓN   — cómo viene empacado ese SKU: el peso del bulto y el
 *                     tipo de congelamiento. Ejemplo: 2 × 10 KG en placas.
 *
 *  Un mismo SKU puede venderse en varias presentaciones, y la misma
 *  presentación sirve a muchos SKU. Lo que se cotiza, se reserva y se despacha
 *  es la COMBINACIÓN de los dos. Por eso al dar de alta un producto hay que
 *  elegir al menos una presentación: un SKU sin presentaciones no se puede
 *  vender, y aparecería en el buscador sin que nadie pueda agregarlo.
 *
 *  MISMA REGLA QUE EN CLIENTES
 *  Se desactiva, no se borra, en cuanto el producto tocó un lote o un
 *  documento. Borrar un SKU con lotes dejaría el Kardex apuntando al vacío.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';

export type Resultado =
  | { ok: true; id: number; mensaje: string }
  | { ok: false; mensaje: string; campo?: string };

const PUEDEN_EDITAR = ['gerencia', 'operaciones', 'comercial'];
const PUEDEN_BORRAR = ['gerencia', 'operaciones'];

export type DatosProducto = {
  codigo: string;
  especie_id: number;
  formato_id: number;
  corte: string;
  clasificacion_comercial: string;
  empaque: 'sacos' | 'cajas' | 'block';
  vida_util_meses: number | null;
  /** Las presentaciones en las que se vende. Al menos una. */
  presentaciones: number[];
};

function refrescar(id?: number) {
  revalidatePath('/ventas/productos');
  if (id) revalidatePath(`/ventas/productos/${id}`);
  revalidatePath('/ventas/disponibilidad');
  revalidatePath('/ventas/cotizaciones');
  revalidatePath('/almacenes/existencias');
  revalidatePath('/configuracion');
}

function validar(d: DatosProducto): { mensaje: string; campo: string } | null {
  if (!d.codigo?.trim()) return { mensaje: 'El producto necesita un código de SKU.', campo: 'codigo' };
  if (d.codigo.trim().length > 20) return { mensaje: 'El código no puede pasar de 20 caracteres.', campo: 'codigo' };
  if (!d.especie_id) return { mensaje: 'Elija la especie: pota, merluza, bonito…', campo: 'especie_id' };
  if (!d.formato_id) return { mensaje: 'Elija el formato: filete, aletas, tentáculo…', campo: 'formato_id' };
  if (!d.corte?.trim()) return { mensaje: 'Falta el corte. Es lo que distingue un producto de otro.', campo: 'corte' };
  if (d.corte.trim().length > 120) return { mensaje: 'La descripción del corte es demasiado larga.', campo: 'corte' };
  // La base la exige, y con razón: es la familia comercial con la que se
  // agrupa el producto en los reportes («REJOS», «RECORTES FRESCOS»).
  if (!d.clasificacion_comercial?.trim()) {
    return {
      mensaje: 'Falta la clasificación comercial: es la familia con la que se agrupa el producto en los reportes.',
      campo: 'clasificacion_comercial',
    };
  }
  if (d.vida_util_meses !== null && (d.vida_util_meses < 1 || d.vida_util_meses > 120)) {
    return { mensaje: 'La vida útil va de 1 a 120 meses.', campo: 'vida_util_meses' };
  }
  if (!d.presentaciones?.length) {
    return {
      mensaje: 'Elija al menos una presentación. Un producto sin presentación no se puede cotizar ni despachar.',
      campo: 'presentaciones',
    };
  }
  return null;
}

async function autorizar(permitidos: string[]) {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { error: 'Su sesión caducó. Vuelva a entrar.' };
  if (!permitidos.includes(usuario.rol)) {
    return { error: `Su rol (${usuario.rol}) no puede modificar el maestro de productos.` };
  }
  return { usuario };
}

/**
 * Comprueba que el formato elegido pertenezca a la especie elegida.
 *
 * Los formatos cuelgan de una especie: «filete de pota» y «filete de merluza»
 * son dos formatos distintos. Si el navegador enviara una combinación
 * imposible —por un desplegable desincronizado o por alguien tocando la
 * petición— se crearía un producto que no existe.
 */
async function formatoPerteneceAEspecie(formatoId: number, especieId: number): Promise<boolean> {
  const supabase = await crearClienteServidor();
  const { data } = await supabase
    .from('formatos').select('especie_id').eq('id', formatoId).maybeSingle();
  return Number(data?.especie_id) === Number(especieId);
}

/* ==========================================================================
   CREAR
   ========================================================================== */
export async function crearProducto(d: DatosProducto): Promise<Resultado> {
  const permiso = await autorizar(PUEDEN_EDITAR);
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const problema = validar(d);
  if (problema) return { ok: false, ...problema };

  if (!(await formatoPerteneceAEspecie(d.formato_id, d.especie_id))) {
    return { ok: false, mensaje: 'Ese formato no pertenece a la especie elegida.', campo: 'formato_id' };
  }

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase
    .from('skus')
    .insert({
      codigo: d.codigo.trim(),
      especie_id: d.especie_id,
      formato_id: d.formato_id,
      corte: d.corte.trim(),
      clasificacion_comercial: d.clasificacion_comercial.trim(),
      empaque: d.empaque,
      vida_util_meses: d.vida_util_meses,
      activo: true,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      return { ok: false, mensaje: `Ya existe un producto con el código ${d.codigo.trim()}.`, campo: 'codigo' };
    }
    return { ok: false, mensaje: `No se pudo crear el producto: ${error.message}` };
  }

  /*
   * Las presentaciones se enlazan después. Si esto fallara, el SKU quedaría
   * creado pero sin poder venderse, así que se deshace el alta: es preferible
   * un error limpio a un producto a medio hacer que nadie sabe por qué no
   * aparece en el buscador.
   */
  const { error: errorPres } = await supabase
    .from('sku_presentaciones')
    .insert(d.presentaciones.map((p) => ({ sku_id: data.id, presentacion_id: p, activo: true })));

  if (errorPres) {
    await supabase.from('skus').delete().eq('id', data.id);
    return { ok: false, mensaje: `No se pudieron enlazar las presentaciones: ${errorPres.message}`, campo: 'presentaciones' };
  }

  await supabase.rpc('registrar_evento', {
    p_entidad: 'skus',
    p_entidad_id: data.id,
    p_tipo: 'producto_creado',
    p_descripcion: `Alta del producto ${d.codigo.trim()} · ${d.corte.trim()}, con ${d.presentaciones.length} presentación${d.presentaciones.length === 1 ? '' : 'es'}`,
    p_severidad: 'info',
  }).then(() => undefined, () => undefined);

  refrescar(data.id);
  return { ok: true, id: data.id, mensaje: `Producto ${d.codigo.trim()} creado y listo para cotizar.` };
}

/* ==========================================================================
   EDITAR
   ========================================================================== */
export async function actualizarProducto(id: number, d: DatosProducto): Promise<Resultado> {
  const permiso = await autorizar(PUEDEN_EDITAR);
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const problema = validar(d);
  if (problema) return { ok: false, ...problema };

  if (!(await formatoPerteneceAEspecie(d.formato_id, d.especie_id))) {
    return { ok: false, mensaje: 'Ese formato no pertenece a la especie elegida.', campo: 'formato_id' };
  }

  const supabase = await crearClienteServidor();
  const { data: antes } = await supabase
    .from('skus').select('codigo, corte, vida_util_meses, empaque').eq('id', id).maybeSingle();
  if (!antes) return { ok: false, mensaje: 'Ese producto ya no existe.' };

  const { error } = await supabase
    .from('skus')
    .update({
      codigo: d.codigo.trim(),
      especie_id: d.especie_id,
      formato_id: d.formato_id,
      corte: d.corte.trim(),
      clasificacion_comercial: d.clasificacion_comercial.trim(),
      empaque: d.empaque,
      vida_util_meses: d.vida_util_meses,
    })
    .eq('id', id);

  if (error) {
    if (error.code === '23505') {
      return { ok: false, mensaje: `Ya existe otro producto con el código ${d.codigo.trim()}.`, campo: 'codigo' };
    }
    return { ok: false, mensaje: `No se pudo guardar: ${error.message}` };
  }

  /* ---- Presentaciones: se comparan las de antes con las de ahora ----
     Las que se quitan NO se borran si ya tienen lotes: se desactivan, porque
     un lote existente apunta a esa combinación y borrarla lo dejaría huérfano. */
  const { data: actuales } = await supabase
    .from('sku_presentaciones').select('id, presentacion_id, activo').eq('sku_id', id);

  const existentes = actuales ?? [];
  const pedidas = new Set(d.presentaciones);

  for (const sp of existentes) {
    const sigue = pedidas.has(Number(sp.presentacion_id));
    if (sigue && !sp.activo) {
      await supabase.from('sku_presentaciones').update({ activo: true }).eq('id', sp.id);
    } else if (!sigue && sp.activo) {
      const { count } = await supabase
        .from('lotes').select('id', { count: 'exact', head: true }).eq('sku_presentacion_id', sp.id);

      if ((count ?? 0) > 0) {
        await supabase.from('sku_presentaciones').update({ activo: false }).eq('id', sp.id);
      } else {
        await supabase.from('sku_presentaciones').delete().eq('id', sp.id);
      }
    }
    pedidas.delete(Number(sp.presentacion_id));
  }

  // Las que quedan en el conjunto son nuevas.
  if (pedidas.size > 0) {
    await supabase.from('sku_presentaciones')
      .insert([...pedidas].map((p) => ({ sku_id: id, presentacion_id: p, activo: true })));
  }

  const cambios: string[] = [];
  if (antes.codigo !== d.codigo.trim()) cambios.push(`código: ${antes.codigo} → ${d.codigo.trim()}`);
  if (antes.corte !== d.corte.trim()) cambios.push(`corte: «${antes.corte}» → «${d.corte.trim()}»`);
  if (antes.vida_util_meses !== d.vida_util_meses) cambios.push(`vida útil: ${antes.vida_util_meses ?? 'sin definir'} → ${d.vida_util_meses ?? 'sin definir'} meses`);
  if (antes.empaque !== d.empaque) cambios.push(`empaque: ${antes.empaque} → ${d.empaque}`);

  await supabase.rpc('registrar_evento', {
    p_entidad: 'skus',
    p_entidad_id: id,
    p_tipo: 'producto_modificado',
    p_descripcion: cambios.length
      ? `Cambios en ${d.codigo.trim()}: ${cambios.join('; ')}`
      : `Se guardó el producto ${d.codigo.trim()}`,
    p_severidad: 'info',
    p_metadatos: { cambios },
  }).then(() => undefined, () => undefined);

  refrescar(id);
  return { ok: true, id, mensaje: 'Producto actualizado.' };
}

/* ==========================================================================
   DESACTIVAR Y REACTIVAR
   ========================================================================== */
export async function cambiarEstadoProducto(id: number, activo: boolean): Promise<Resultado> {
  const permiso = await autorizar(PUEDEN_EDITAR);
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const supabase = await crearClienteServidor();
  const { data: sku } = await supabase.from('skus').select('codigo, corte').eq('id', id).maybeSingle();
  if (!sku) return { ok: false, mensaje: 'Ese producto ya no existe.' };

  const { error } = await supabase.from('skus').update({ activo }).eq('id', id);
  if (error) return { ok: false, mensaje: `No se pudo cambiar el estado: ${error.message}` };

  await supabase.rpc('registrar_evento', {
    p_entidad: 'skus',
    p_entidad_id: id,
    p_tipo: activo ? 'producto_reactivado' : 'producto_desactivado',
    p_descripcion: `${activo ? 'Se reactivó' : 'Se desactivó'} el producto ${sku.codigo} · ${sku.corte}`,
    p_severidad: 'info',
  }).then(() => undefined, () => undefined);

  refrescar(id);
  return {
    ok: true,
    id,
    mensaje: activo
      ? `${sku.codigo} vuelve a aparecer al cotizar.`
      : `${sku.codigo} ya no aparecerá al cotizar. El stock que haya en cámara sigue contando.`,
  };
}

/* ==========================================================================
   BORRAR DE VERDAD
   ========================================================================== */

/** Qué impide borrar un producto. Se consulta antes, para poder explicarlo. */
export async function usosDelProducto(id: number): Promise<{
  lotes: number; cotizaciones: number; pedidos: number; precios: number; total: number;
}> {
  const supabase = await crearClienteServidor();

  const { data: sps } = await supabase.from('sku_presentaciones').select('id').eq('sku_id', id);
  const ids = (sps ?? []).map((x) => x.id as number);
  if (ids.length === 0) return { lotes: 0, cotizaciones: 0, pedidos: 0, precios: 0, total: 0 };

  const contar = async (tabla: string, columna: string) => {
    const { count } = await supabase
      .from(tabla).select('id', { count: 'exact', head: true }).in(columna, ids);
    return count ?? 0;
  };

  const [lotes, cotizaciones, pedidos, precios] = await Promise.all([
    contar('lotes', 'sku_presentacion_id'),
    contar('cotizacion_lineas', 'sku_presentacion_id'),
    contar('pedido_lineas', 'sku_presentacion_id'),
    contar('precios', 'sku_presentacion_id'),
  ]);

  // Los precios no bloquean: son una tarifa, no un hecho ocurrido. Se borran
  // con el producto. Lotes y líneas de documento sí bloquean.
  return { lotes, cotizaciones, pedidos, precios, total: lotes + cotizaciones + pedidos };
}

export async function eliminarProducto(id: number): Promise<Resultado> {
  const permiso = await autorizar(PUEDEN_BORRAR);
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const supabase = await crearClienteServidor();
  const { data: sku } = await supabase.from('skus').select('codigo, corte').eq('id', id).maybeSingle();
  if (!sku) return { ok: false, mensaje: 'Ese producto ya no existe.' };

  const usos = await usosDelProducto(id);
  if (usos.total > 0) {
    const detalle = [
      usos.lotes ? `${usos.lotes} lote${usos.lotes === 1 ? '' : 's'} en cámara o en el histórico` : null,
      usos.cotizaciones ? `${usos.cotizaciones} línea${usos.cotizaciones === 1 ? '' : 's'} de cotización` : null,
      usos.pedidos ? `${usos.pedidos} línea${usos.pedidos === 1 ? '' : 's'} de pedido` : null,
    ].filter(Boolean).join(', ');

    return {
      ok: false,
      mensaje:
        `No se puede borrar ${sku.codigo}: tiene ${detalle}. ` +
        'Borrarlo dejaría el Kardex y los documentos apuntando a un producto que no existe. ' +
        'Use «Desactivar»: deja de ofrecerse al cotizar y todo el historial se conserva.',
    };
  }

  const { data: sps } = await supabase.from('sku_presentaciones').select('id').eq('sku_id', id);
  const ids = (sps ?? []).map((x) => x.id as number);
  if (ids.length) await supabase.from('precios').delete().in('sku_presentacion_id', ids);
  await supabase.from('sku_presentaciones').delete().eq('sku_id', id);

  const { error } = await supabase.from('skus').delete().eq('id', id);
  if (error) return { ok: false, mensaje: `No se pudo borrar: ${error.message}` };

  await supabase.rpc('registrar_evento', {
    p_entidad: 'skus',
    p_entidad_id: null,
    p_tipo: 'producto_eliminado',
    p_descripcion: `Se borró el producto ${sku.codigo} · ${sku.corte}, que no tenía lotes ni documentos`,
    p_severidad: 'advertencia',
    p_metadatos: { codigo: sku.codigo, corte: sku.corte },
  }).then(() => undefined, () => undefined);

  refrescar();
  return { ok: true, id, mensaje: `Producto ${sku.codigo} borrado.` };
}

/* ==========================================================================
   AYUDA PARA EL FORMULARIO
   ========================================================================== */

/** Las clasificaciones comerciales que ya se usan, para sugerirlas. */
export async function clasificacionesUsadas(): Promise<string[]> {
  const supabase = await crearClienteServidor();
  const { data } = await supabase.from('skus').select('clasificacion_comercial');
  return [...new Set((data ?? [])
    .map((s) => String(s.clasificacion_comercial ?? '').trim())
    .filter(Boolean))].sort();
}

/** Los formatos de una especie, para el segundo desplegable. */
export async function formatosDeEspecie(especieId: number): Promise<{ id: number; nombre: string }[]> {
  const supabase = await crearClienteServidor();
  const { data } = await supabase
    .from('formatos').select('id, nombre').eq('especie_id', especieId).eq('activo', true).order('nombre');
  return (data ?? []).map((f) => ({ id: f.id as number, nombre: f.nombre as string }));
}

/** Propone el siguiente código de SKU libre. Los actuales son numéricos. */
export async function siguienteCodigoProducto(): Promise<string> {
  const supabase = await crearClienteServidor();
  const { data } = await supabase.from('skus').select('codigo');

  // Los códigos existentes son números guardados como texto («05», «162»).
  // Se busca el mayor numérico; si alguien usó letras, esa fila se ignora.
  const mayor = (data ?? []).reduce((max, s) => {
    const n = Number(String(s.codigo).trim());
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);

  return String(mayor + 1);
}
