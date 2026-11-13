'use server';

/**
 * ============================================================================
 *  IMPORTAR TRASLADOS DESDE EXCEL · las acciones
 * ============================================================================
 *  Lo que el equipo lleva en Excel son traslados que YA OCURRIERON, con su
 *  guía y su fecha (079). Por eso entran ejecutados, con el mismo circuito de
 *  validación que la importación de ingresos:
 *
 *    1. SUBIR: se lee el archivo y se revisa cada fila (mismas reglas que
 *       «Nuevo traslado», más la fecha: de hoy hacia atrás). No se mueve nada.
 *    2. CORREGIR o descartar filas en pantalla.
 *    3. DEJAR LISTA (Almacén): «Dejar lista para validar». Queda un aviso en
 *       Alertas y en el panel de Gerencia y Operaciones.
 *    4. VALIDAR Y REGISTRAR (Gerencia u Operaciones): las filas listas se
 *       agrupan por bodega de origen → destino, fecha y guía (un viaje), y cada
 *       grupo se registra con traslado_registrar_hecho(): el traslado nace,
 *       se autoriza, se despacha y se recibe en UNA sola operación, con las
 *       funciones del circuito de siempre (el stock, el Kardex y las reservas
 *       se mueven como en cualquier traslado). Si una línea falla, ese
 *       traslado no se registra y sus filas dicen por qué.
 *       Si quien subió es de Gerencia u Operaciones, registra en el mismo paso.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { leerPlantilla } from '@/lib/importacionExcel';
import type { FalloCarga } from '@/lib/falloCarga';
import { rolNoPuede, traducirErrorBase } from '@/lib/mensajesBase';
import { PUEDEN_VALIDAR_IMPORTACION } from '../../ingresos/tipos';
import { PUEDEN_SOLICITAR, problemaLinea, type LineaTraslado } from '../registro';
import { COLUMNAS_TRASLADO, HOJA_TRASLADOS } from './columnas';
import {
  cargarContextoImport, interpretarFilaTraslado, revisarConjuntoTraslados, revisarImportacionTraslados,
  type FilaGuardadaT,
} from './revision';

export type Resultado = { ok: true; id: number; mensaje: string } | FalloCarga;

const MAXIMO_BYTES = 950 * 1024;

async function autorizar(que: string, roles: readonly string[] = PUEDEN_SOLICITAR) {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { error: 'Su sesión caducó. Vuelva a entrar.' };
  if (!(roles as readonly string[]).includes(usuario.rol)) return { error: rolNoPuede(usuario.rol, que, roles) };
  return { usuario };
}

function refrescar(id?: number) {
  revalidatePath('/almacenes/traslados/importar');
  if (id) revalidatePath(`/almacenes/traslados/importar/${id}`);
  revalidatePath('/alertas');
  revalidatePath('/panel');
}

export async function subirImportacionTraslados(formulario: FormData): Promise<Resultado> {
  const permiso = await autorizar('importar traslados');
  if (permiso.error) return { ok: false, tipo: 'permiso', mensaje: permiso.error };

  const archivo = formulario.get('archivo');
  if (!(archivo instanceof File) || archivo.size === 0) return { ok: false, tipo: 'vacio', mensaje: 'Elija el archivo de Excel que quiere subir.' };
  if (!/\.xlsx$/i.test(archivo.name)) {
    return { ok: false, tipo: 'archivo', mensaje: `«${archivo.name}» no es un libro de Excel .xlsx. Guárdelo como «Libro de Excel (.xlsx)» y vuelva a subirlo.` };
  }
  if (archivo.size > MAXIMO_BYTES) {
    return { ok: false, tipo: 'tamano', mensaje: `El archivo pesa ${Math.round(archivo.size / 1024)} KB y el máximo son ${Math.round(MAXIMO_BYTES / 1024)} KB. Borre la hoja «Pallets disponibles» antes de subirlo, o divídalo en dos.` };
  }

  const leido = await leerPlantilla(await archivo.arrayBuffer(), { hoja: HOJA_TRASLADOS, columnas: COLUMNAS_TRASLADO, claveEjemplo: 'codigo_pallet' })
    .catch((e) => {
      console.error('No se pudo recorrer el Excel de traslados:', e);
      return { ok: false as const, tipo: 'archivo' as const, mensaje: 'El archivo se abrió pero no se pudo recorrer: puede tener hojas protegidas, vínculos rotos u objetos que el sistema no lee. Copie sus filas a la plantilla en blanco y súbala.' };
    });
  if (!leido.ok) return { ok: false, tipo: leido.tipo, mensaje: leido.mensaje };

  const supabase = await crearClienteServidor();
  const { data: imp, error } = await supabase
    .from('importaciones_excel')
    .insert({ tipo: 'traslados', archivo: archivo.name.slice(0, 200), archivo_bytes: archivo.size, creado_por: permiso.usuario!.id })
    .select('id').single();
  if (error || !imp) return { ok: false, tipo: 'base', mensaje: traducirErrorBase(error, { que: 'guardar la importación', quien: PUEDEN_SOLICITAR }) };

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
    return { ok: false, tipo: 'base', mensaje: traducirErrorBase(errFilas, { que: 'guardar las filas de la importación', quien: PUEDEN_SOLICITAR }) };
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
    return {
      error: `La fila ${data.fila} ya se registró en un traslado y el pallet ya cambió de bodega: no se puede cambiar. ` +
        'Si hubo un error, regístrelo con otro traslado de vuelta.',
    };
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
   DEJAR LISTA PARA VALIDAR (Almacén)
   ========================================================================== */
export async function dejarListaTraslados(importacionId: number): Promise<Resultado> {
  const permiso = await autorizar('preparar importaciones de traslados');
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const supabase = await crearClienteServidor();
  const { data: imp } = await supabase.from('importaciones_excel').select('id, estado, tipo').eq('id', importacionId).maybeSingle();
  if (!imp || imp.tipo !== 'traslados') return { ok: false, mensaje: 'Esa importación ya no existe.' };
  if (imp.estado === 'lista') return { ok: false, mensaje: 'Esta importación ya está lista para validar: falta que Gerencia u Operaciones la valide.' };

  const { count } = await supabase.from('importaciones_excel_filas')
    .select('id', { count: 'exact', head: true }).eq('importacion_id', importacionId).eq('estado', 'valida');
  if (!count) return { ok: false, mensaje: 'No hay ninguna fila lista: corrija o descarte las filas con error antes de enviarla a validar.' };

  const { data: upd, error } = await supabase.from('importaciones_excel')
    .update({ estado: 'lista', enviada_por: permiso.usuario!.id, enviada_en: new Date().toISOString() })
    .eq('id', importacionId).select('id');
  if (error || !upd?.length) return { ok: false, mensaje: traducirErrorBase(error, { que: 'dejar lista la importación', quien: PUEDEN_SOLICITAR }) };

  refrescar(importacionId);
  return {
    ok: true, id: importacionId,
    mensaje: `Importación lista para validar con ${count} pallet${count === 1 ? '' : 's'}. Gerencia y Operaciones la ven en Alertas y en su panel; ` +
      'los traslados se registran (ya recibidos, moviendo el stock) cuando cualquiera de ellos pulse «Validar y registrar».',
  };
}

/* ==========================================================================
   VALIDAR Y REGISTRAR (Gerencia u Operaciones)
   --------------------------------------------------------------------------
   Por tandas de traslados (la pantalla llama una y otra vez hasta terminar):
   cada traslado es una operación completa en la base (autorizar, despachar y
   recibir), y muchos de una vez podrían pasar el tiempo máximo de una
   petición.
   ========================================================================== */
export type ResultadoTandaT =
  | { ok: true; procesadas: number; pendientes: number; traslados: string[]; registradas: number; fallidas: number; mensaje: string }
  | { ok: false; mensaje: string };

/** Traslados por tanda. */
const TANDA = 8;

export async function validarYRegistrarTraslados(importacionId: number): Promise<ResultadoTandaT> {
  const permiso = await autorizar('validar importaciones de traslados', PUEDEN_VALIDAR_IMPORTACION);
  if (permiso.error) {
    return { ok: false, mensaje: `${permiso.error} Déjela «Lista para validar» y quedará avisado en sus Alertas.` };
  }
  const usuarioId = permiso.usuario!.id as string;

  const supabase = await crearClienteServidor();
  const { data: imp } = await supabase.from('importaciones_excel').select('id, tipo, archivo').eq('id', importacionId).maybeSingle();
  if (!imp || imp.tipo !== 'traslados') return { ok: false, mensaje: 'Esa importación ya no existe.' };

  /* Quién validó y cuándo. La base exige además que sea Gerencia u Operaciones (079). */
  const { error: errVal } = await supabase.from('importaciones_excel')
    .update({ estado: 'validada', procesado_por: usuarioId, procesado_en: new Date().toISOString() }).eq('id', importacionId);
  if (errVal) return { ok: false, mensaje: traducirErrorBase(errVal, { que: 'validar la importación', quien: PUEDEN_VALIDAR_IMPORTACION }) };

  /* Una fila que quedó «registrando» hace más de dos minutos (se cortó la
     conexión a mitad) vuelve a la cola. Si su traslado sí llegó a
     registrarse, la base ya la marcó «registrada» en la misma operación, así
     que aquí solo vuelven las que de verdad no entraron. */
  await supabase.from('importaciones_excel_filas').update({ estado: 'valida' })
    .eq('importacion_id', importacionId).eq('estado', 'procesando')
    .lt('actualizado_en', new Date(Date.now() - 120000).toISOString());

  const { data: cola } = await supabase.from('importaciones_excel_filas')
    .select('id, importacion_id, fila, datos, errores, estado, resultado')
    .eq('importacion_id', importacionId).eq('estado', 'valida').order('fila');
  const filas = ((cola ?? []) as unknown as FilaGuardadaT[]);

  //  Las reglas otra vez, con el stock de este instante.
  const ctx = await cargarContextoImport(supabase, filas.map((f) => f.datos.codigo_pallet ?? ''));
  type Grupo = {
    origen: number; destino: number; fecha: string; guia: string | null; obs: Set<string>;
    filas: { f: FilaGuardadaT; l: LineaTraslado }[];
  };
  const grupos = new Map<string, Grupo>();
  const cambios: { id: number; cambio: Record<string, unknown> }[] = [];
  const usados = new Set<number>();
  for (const f of filas) {
    const i = interpretarFilaTraslado(f.datos, ctx);
    if (i.errores.length || !i.linea || !i.fecha || usados.has(i.linea.lote_id)) {
      cambios.push({ id: f.id, cambio: {
        estado: 'con_error',
        errores: i.errores.length ? i.errores : [{ columna: 'codigo_pallet', mensaje: 'El pallet se repite en el archivo.' }],
        resultado: 'Al registrar ya no cumplía las reglas: corríjala.',
      } });
      continue;
    }
    usados.add(i.linea.lote_id);
    //  Un viaje: mismo origen, destino, fecha y guía.
    const clave = `${i.origen_id}-${i.destino_id}-${i.fecha}-${(i.guia ?? '').toUpperCase()}`;
    if (!grupos.has(clave)) grupos.set(clave, { origen: i.origen_id, destino: i.destino_id, fecha: i.fecha, guia: i.guia, obs: new Set(), filas: [] });
    const g = grupos.get(clave)!;
    if (i.observaciones) g.obs.add(i.observaciones);
    g.filas.push({ f, l: i.linea });
  }

  const nombre = (id: number) => ctx.bodegas.find((b) => b.id === id)?.nombre ?? '';
  const creados: string[] = [];
  let registradas = 0, fallidas = cambios.length, procesadas = cambios.length;
  for (const g of [...grupos.values()].slice(0, TANDA)) {
    //  Última comprobación por línea, con la regla común.
    const buenas: typeof g.filas = [];
    for (const x of g.filas) {
      const p = problemaLinea(x.l, g.origen, ctx, nombre(g.origen));
      if (p) {
        fallidas++; procesadas++;
        cambios.push({ id: x.f.id, cambio: { estado: 'con_error', errores: [{ columna: 'codigo_pallet', mensaje: p.mensaje }] } });
      } else buenas.push(x);
    }
    if (!buenas.length) continue;

    /* Se «toman» las filas antes de registrar: si dos personas pulsan a la
       vez, cada fila va en un solo traslado. */
    const { data: tomadas } = await supabase.from('importaciones_excel_filas')
      .update({ estado: 'procesando', actualizado_en: new Date().toISOString() })
      .in('id', buenas.map((x) => x.f.id)).eq('estado', 'valida').select('id');
    const tomadasId = new Set((tomadas ?? []).map((t) => Number(t.id)));
    const van = buenas.filter((x) => tomadasId.has(x.f.id));
    if (!van.length) continue;
    procesadas += van.length;

    const { data: hecho, error } = await supabase.rpc('traslado_registrar_hecho', {
      p_origen: g.origen,
      p_destino: g.destino,
      p_fecha: g.fecha,
      p_guia: g.guia ?? '',
      p_observaciones: [...g.obs].join(' · ').slice(0, 300) || `Importado de «${imp.archivo}»`,
      p_lineas: van.map((x) => ({ lote_id: x.l.lote_id, bultos: Math.round(x.l.bultos), peso_kg: x.l.peso_kg })),
      p_importacion_id: importacionId,
      p_filas: van.map((x) => x.f.id),
    });
    const fila0 = (Array.isArray(hecho) ? hecho[0] : hecho) as { id_traslado?: number; numero_traslado?: string } | null;
    if (error || !fila0?.id_traslado) {
      //  No se registró nada de este traslado: sus filas dicen por qué.
      const motivo = traducirErrorBase(error, { que: 'registrar el traslado', quien: PUEDEN_VALIDAR_IMPORTACION });
      fallidas += van.length;
      for (const x of van) cambios.push({ id: x.f.id, cambio: { estado: 'fallida', resultado: `No se registró: ${motivo}` } });
      continue;
    }
    //  Las filas ya quedaron «registrada» en la misma operación de la base.
    registradas += van.length;
    creados.push(String(fila0.numero_traslado));
    revalidatePath(`/almacenes/traslados/${fila0.id_traslado}`);
  }

  for (const c of cambios) {
    await supabase.from('importaciones_excel_filas').update({ ...c.cambio, actualizado_en: new Date().toISOString() }).eq('id', c.id);
  }

  const { count: pendientes } = await supabase.from('importaciones_excel_filas')
    .select('id', { count: 'exact', head: true }).eq('importacion_id', importacionId).in('estado', ['valida', 'procesando']);

  if (creados.length) {
    revalidatePath('/almacenes/traslados');
    revalidatePath('/almacenes/existencias');
  }
  refrescar(importacionId);
  return {
    ok: true, procesadas, pendientes: pendientes ?? 0, traslados: creados, registradas, fallidas,
    mensaje: `${creados.length} traslado${creados.length === 1 ? '' : 's'} registrado${creados.length === 1 ? '' : 's'}` +
      (fallidas ? `, ${fallidas} fila${fallidas === 1 ? '' : 's'} con problema` : '') + '.',
  };
}
