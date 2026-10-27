'use server';

/**
 * ============================================================================
 *  IMPORTAR TRASLADOS DESDE EXCEL · las acciones
 * ============================================================================
 *  Mismo circuito que la importación de ingresos, con una diferencia: aquí no
 *  hace falta una validación aparte, porque lo que se crea son traslados en
 *  BORRADOR, que ya tienen su propia autorización (Gerencia u Operaciones),
 *  su despacho y su recepción en destino.
 *
 *    1. Subir: se lee el archivo y se revisa cada fila (mismas reglas que
 *       «Nuevo traslado»). No se crea nada.
 *    2. Corregir o descartar filas en pantalla.
 *    3. «Crear N traslados en borrador»: las filas listas se agrupan por
 *       bodega de origen → bodega de destino (y fecha programada, si la hay:
 *       dos fechas son dos viajes) y cada grupo es un traslado.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { leerPlantilla } from '@/lib/importacionExcel';
import { rolNoPuede, traducirErrorBase } from '@/lib/mensajesBase';
import { PUEDEN_SOLICITAR, insertarTraslado, problemaLinea, type LineaTraslado } from '../registro';
import { COLUMNAS_TRASLADO, HOJA_TRASLADOS } from './columnas';
import {
  cargarContextoImport, interpretarFilaTraslado, revisarConjuntoTraslados, revisarImportacionTraslados,
  type FilaGuardadaT,
} from './revision';

export type Resultado = { ok: true; id: number; mensaje: string } | { ok: false; mensaje: string };

const MAXIMO_BYTES = 950 * 1024;

async function autorizar(que: string) {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { error: 'Su sesión caducó. Vuelva a entrar.' };
  if (!(PUEDEN_SOLICITAR as readonly string[]).includes(usuario.rol)) return { error: rolNoPuede(usuario.rol, que, PUEDEN_SOLICITAR) };
  return { usuario };
}

function refrescar(id?: number) {
  revalidatePath('/almacenes/traslados/importar');
  if (id) revalidatePath(`/almacenes/traslados/importar/${id}`);
}

export async function subirImportacionTraslados(formulario: FormData): Promise<Resultado> {
  const permiso = await autorizar('importar traslados');
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const archivo = formulario.get('archivo');
  if (!(archivo instanceof File) || archivo.size === 0) return { ok: false, mensaje: 'Elija el archivo de Excel que quiere subir.' };
  if (!/\.xlsx$/i.test(archivo.name)) {
    return { ok: false, mensaje: `«${archivo.name}» no es un libro de Excel .xlsx. Guárdelo como «Libro de Excel (.xlsx)» y vuelva a subirlo.` };
  }
  if (archivo.size > MAXIMO_BYTES) {
    return { ok: false, mensaje: `El archivo pesa ${Math.round(archivo.size / 1024)} KB y el máximo son ${Math.round(MAXIMO_BYTES / 1024)} KB. Borre la hoja «Pallets disponibles» antes de subirlo, o divídalo en dos.` };
  }

  const leido = await leerPlantilla(await archivo.arrayBuffer(), { hoja: HOJA_TRASLADOS, columnas: COLUMNAS_TRASLADO, claveEjemplo: 'codigo_pallet' });
  if (!leido.ok) return { ok: false, mensaje: leido.mensaje };

  const supabase = await crearClienteServidor();
  const { data: imp, error } = await supabase
    .from('importaciones_excel')
    .insert({ tipo: 'traslados', archivo: archivo.name.slice(0, 200), archivo_bytes: archivo.size, creado_por: permiso.usuario!.id })
    .select('id').single();
  if (error || !imp) return { ok: false, mensaje: traducirErrorBase(error, { que: 'guardar la importación', quien: PUEDEN_SOLICITAR }) };

  const borrador: FilaGuardadaT[] = leido.filas.map((f, i) => ({
    id: -(i + 1), importacion_id: Number(imp.id), fila: f.fila, datos: f.valores, errores: [], estado: 'con_error', resultado: null,
  }));
  const ctx = await cargarContextoImport(supabase, borrador.map((f) => f.datos.codigo_pallet ?? ''));
  const revisadas = new Map(revisarConjuntoTraslados(borrador, ctx).map((f) => [f.id, f]));
  const { error: errFilas } = await supabase.from('importaciones_excel_filas').insert(borrador.map((f) => {
    const r = revisadas.get(f.id) ?? f;
    return { importacion_id: r.importacion_id, fila: r.fila, datos: r.datos, errores: r.errores, estado: r.estado };
  }));
  if (errFilas) {
    await supabase.from('importaciones_excel').delete().eq('id', imp.id);
    return { ok: false, mensaje: traducirErrorBase(errFilas, { que: 'guardar las filas de la importación', quien: PUEDEN_SOLICITAR }) };
  }

  const validas = [...revisadas.values()].filter((f) => f.estado === 'valida').length;
  refrescar(Number(imp.id));
  return {
    ok: true, id: Number(imp.id),
    mensaje: `Se leyeron ${leido.filas.length} filas: ${validas} listas y ${leido.filas.length - validas} con error.` +
      (leido.ignoradas.length ? ` No se leyeron estas columnas, que no son de la plantilla: ${leido.ignoradas.join(', ')}.` : ''),
  };
}

async function filaEditable(supabase: Awaited<ReturnType<typeof crearClienteServidor>>, filaId: number) {
  const { data } = await supabase
    .from('importaciones_excel_filas').select('id, importacion_id, fila, estado, importaciones_excel(tipo)').eq('id', filaId).maybeSingle();
  if (!data) return { error: 'Esa fila ya no existe.' };
  const imp = Array.isArray(data.importaciones_excel) ? data.importaciones_excel[0] : data.importaciones_excel;
  if ((imp as { tipo?: string } | null)?.tipo !== 'traslados') return { error: 'Esa fila no es de una importación de traslados.' };
  if (['registrada', 'procesando'].includes(String(data.estado))) {
    return { error: `La fila ${data.fila} ya está en un traslado: corríjalo desde la ficha del traslado (mientras esté en borrador se puede anular).` };
  }
  return { fila: data };
}

export async function corregirFilaTraslado(filaId: number, valores: Record<string, string>): Promise<Resultado> {
  const permiso = await autorizar('corregir importaciones de traslados');
  if (permiso.error) return { ok: false, mensaje: permiso.error };
  const supabase = await crearClienteServidor();
  const f = await filaEditable(supabase, filaId);
  if (f.error) return { ok: false, mensaje: f.error };

  const datos = Object.fromEntries(COLUMNAS_TRASLADO.map((c) => [c.clave, String(valores[c.clave] ?? '').trim().slice(0, 300)]));
  const { data: upd, error } = await supabase.from('importaciones_excel_filas')
    .update({ datos, estado: 'con_error', actualizado_en: new Date().toISOString() }).eq('id', filaId).select('id');
  if (error || !upd?.length) return { ok: false, mensaje: traducirErrorBase(error, { que: 'guardar la corrección', quien: PUEDEN_SOLICITAR }) };

  const importacionId = Number(f.fila!.importacion_id);
  const r = await revisarImportacionTraslados(supabase, importacionId, new Set([filaId]));
  if (!r.ok) return r;
  const { data: queda } = await supabase.from('importaciones_excel_filas').select('estado, errores').eq('id', filaId).single();
  refrescar(importacionId);
  const errores = (queda?.errores ?? []) as { mensaje: string }[];
  return queda?.estado === 'valida'
    ? { ok: true, id: filaId, mensaje: `Fila ${f.fila!.fila} corregida: ya está lista.` }
    : { ok: false, mensaje: `La fila ${f.fila!.fila} todavía tiene error: ${errores.map((e) => e.mensaje).join(' ')}` };
}

export async function descartarFilaTraslado(filaId: number, descartar: boolean): Promise<Resultado> {
  const permiso = await autorizar('corregir importaciones de traslados');
  if (permiso.error) return { ok: false, mensaje: permiso.error };
  const supabase = await crearClienteServidor();
  const f = await filaEditable(supabase, filaId);
  if (f.error) return { ok: false, mensaje: f.error };
  const { data: upd, error } = await supabase.from('importaciones_excel_filas')
    .update({ estado: descartar ? 'descartada' : 'con_error', resultado: null, actualizado_en: new Date().toISOString() })
    .eq('id', filaId).select('id');
  if (error || !upd?.length) return { ok: false, mensaje: traducirErrorBase(error, { que: 'descartar la fila', quien: PUEDEN_SOLICITAR }) };
  const importacionId = Number(f.fila!.importacion_id);
  const r = await revisarImportacionTraslados(supabase, importacionId, descartar ? new Set() : new Set([filaId]));
  if (!r.ok) return r;
  refrescar(importacionId);
  return { ok: true, id: filaId, mensaje: descartar ? `Fila ${f.fila!.fila} descartada: no irá en ningún traslado.` : `Fila ${f.fila!.fila} restaurada y revisada de nuevo.` };
}

/* ==========================================================================
   CREAR LOS TRASLADOS EN BORRADOR
   ========================================================================== */
export async function crearTrasladosImportados(importacionId: number): Promise<{ ok: boolean; mensaje: string }> {
  const permiso = await autorizar('solicitar traslados');
  if (permiso.error) return { ok: false, mensaje: permiso.error };
  const usuarioId = permiso.usuario!.id as string;

  const supabase = await crearClienteServidor();
  const { data: imp } = await supabase.from('importaciones_excel').select('id, tipo, archivo').eq('id', importacionId).maybeSingle();
  if (!imp || imp.tipo !== 'traslados') return { ok: false, mensaje: 'Esa importación ya no existe.' };

  /* Se toman las filas listas (si otra persona pulsó a la vez, cada fila va
     en un solo traslado). */
  const { data: tomadas } = await supabase.from('importaciones_excel_filas')
    .update({ estado: 'procesando', actualizado_en: new Date().toISOString() })
    .eq('importacion_id', importacionId).eq('estado', 'valida')
    .select('id, importacion_id, fila, datos, errores, estado, resultado');
  const filas = ((tomadas ?? []) as unknown as FilaGuardadaT[]).sort((a, b) => a.fila - b.fila);
  if (!filas.length) return { ok: false, mensaje: 'No hay filas listas: corrija o descarte las que tienen error.' };

  //  Las reglas otra vez, con el stock de este instante.
  const ctx = await cargarContextoImport(supabase, filas.map((f) => f.datos.codigo_pallet ?? ''));
  type Grupo = { origen: number; destino: number; fecha: string | null; obs: Set<string>; filas: { f: FilaGuardadaT; l: LineaTraslado }[] };
  const grupos = new Map<string, Grupo>();
  const cambios: Record<string, unknown>[] = [];
  const marcar = (f: FilaGuardadaT, c: Record<string, unknown>) =>
    cambios.push({ id: f.id, importacion_id: f.importacion_id, fila: f.fila, datos: f.datos, errores: f.errores, estado: f.estado, resultado: f.resultado, ...c, actualizado_en: new Date().toISOString() });

  const usados = new Set<number>();
  for (const f of filas) {
    const i = interpretarFilaTraslado(f.datos, ctx);
    if (i.errores.length || !i.linea || usados.has(i.linea.lote_id)) {
      marcar(f, { estado: 'con_error', errores: i.errores.length ? i.errores : [{ columna: 'codigo_pallet', mensaje: 'El pallet se repite en el archivo.' }], resultado: 'Al crear el traslado ya no cumplía las reglas: corríjala.' });
      continue;
    }
    usados.add(i.linea.lote_id);
    const clave = `${i.origen_id}-${i.destino_id}-${i.fecha ?? ''}`;
    if (!grupos.has(clave)) grupos.set(clave, { origen: i.origen_id, destino: i.destino_id, fecha: i.fecha, obs: new Set(), filas: [] });
    const g = grupos.get(clave)!;
    if (i.observaciones) g.obs.add(i.observaciones);
    g.filas.push({ f, l: i.linea });
  }

  const nombre = (id: number) => ctx.bodegas.find((b) => b.id === id)?.nombre ?? '';
  const creados: string[] = [];
  for (const g of grupos.values()) {
    //  Última comprobación por línea, con la regla común.
    const malas = g.filas.filter((x) => problemaLinea(x.l, g.origen, ctx, nombre(g.origen)));
    for (const x of malas) marcar(x.f, { estado: 'con_error', errores: [{ columna: 'codigo_pallet', mensaje: problemaLinea(x.l, g.origen, ctx, nombre(g.origen))!.mensaje }] });
    const buenas = g.filas.filter((x) => !malas.includes(x));
    if (!buenas.length) continue;

    const r = await insertarTraslado(supabase, usuarioId, {
      almacen_origen_id: g.origen, almacen_destino_id: g.destino, fecha_programada: g.fecha,
      transportista_id: null, vehiculo_id: null, conductor_id: null,
      observaciones: [...g.obs].join(' · ').slice(0, 300) || `Importado de «${imp.archivo}»`,
      lineas: buenas.map((x) => x.l),
    });
    for (const x of buenas) {
      marcar(x.f, r.ok
        ? { estado: 'registrada', traslado_id: r.id, resultado: `Va en el traslado ${r.numero} (${nombre(g.origen)} → ${nombre(g.destino)}), en borrador.` }
        : { estado: 'fallida', resultado: r.mensaje });
    }
    if (r.ok) {
      creados.push(r.numero);
      revalidatePath(`/almacenes/traslados/${r.id}`);
    }
  }

  if (cambios.length) await supabase.from('importaciones_excel_filas').upsert(cambios);
  await supabase.from('importaciones_excel')
    .update({ estado: 'validada', procesado_por: usuarioId, procesado_en: new Date().toISOString() }).eq('id', importacionId);

  revalidatePath('/almacenes/traslados');
  refrescar(importacionId);
  const mal = cambios.filter((c) => c.estado !== 'registrada').length;
  return {
    ok: creados.length > 0 && mal === 0,
    mensaje: creados.length
      ? `${creados.length} traslado${creados.length === 1 ? '' : 's'} creado${creados.length === 1 ? '' : 's'} en borrador: ${creados.join(', ')}. ` +
        'Todavía no se movió nada: falta que Gerencia u Operaciones los autorice, que Almacén los despache y que el destino los reciba.' +
        (mal ? ` ${mal} fila${mal === 1 ? '' : 's'} no entró: mire el motivo en la tabla.` : '')
      : 'No se creó ningún traslado: mire el motivo en cada fila.',
  };
}

