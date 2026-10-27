'use server';

/**
 * ============================================================================
 *  IMPORTAR INGRESOS DESDE EXCEL · las acciones
 * ============================================================================
 *  El circuito, tal como lo pidieron Oliver y Gerencia:
 *
 *    1. SUBIR. Almacén (o cualquiera que hoy registra ingresos) sube la
 *       plantilla llena. Se lee, se revisa cada fila con las reglas del
 *       formulario manual y se guarda TODO: la importación, cada fila tal como
 *       venía, sus errores. No entra nada al stock.
 *    2. CORREGIR. En pantalla se corrige una fila con error (y se vuelve a
 *       revisar), o se descarta. También se puede corregir el Excel y subirlo
 *       otra vez: es otra importación.
 *    3. DEJAR LISTA. Quien preparó el archivo lo deja «Lista para validar».
 *       Queda un aviso en Alertas y en el panel de Gerencia y Operaciones.
 *    4. VALIDAR Y REGISTRAR. Los ingresos los validan Walter, Marco y Oliver
 *       —cualquiera de los tres: Gerencia u Operaciones—. Al pulsarlo, cada
 *       fila lista se registra con la MISMA función que el formulario (o queda
 *       como ingreso programado si todavía no llega), y la fila dice qué pasó.
 *       Si quien subió el archivo es de Gerencia u Operaciones, valida en el
 *       mismo paso, sin dejarlo «lista».
 *
 *  Nada de esto depende de una persona concreta: cualquiera de los roles
 *  puede continuar lo que dejó otro.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { leerPlantilla } from '@/lib/importacionExcel';
import { rolNoPuede, traducirErrorBase } from '@/lib/mensajesBase';
import { PUEDEN_INGRESAR, PUEDEN_VALIDAR_IMPORTACION } from '../tipos';
import { crearIngreso, crearProgramado, refrescarIngresos, normalizarCodigo } from '../registro';
import { COLUMNAS_INGRESO, HOJA_INGRESOS, type EstadoFila } from './columnas';
import {
  cargarCatalogoIngresos, contextoDeFilas, interpretarFila, revisarConjunto, revisarFila, revisarImportacion,
  type FilaGuardada,
} from './revision';

export type Resultado = { ok: true; id: number; mensaje: string } | { ok: false; mensaje: string };

/** Un archivo de un mega ya son miles de filas; más es casi seguro otra cosa. */
const MAXIMO_BYTES = 950 * 1024;

async function autorizar(roles: readonly string[], que: string) {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { error: 'Su sesión caducó. Vuelva a entrar.' };
  if (!roles.includes(usuario.rol)) return { error: rolNoPuede(usuario.rol, que, roles) };
  return { usuario };
}

function refrescar(id?: number) {
  revalidatePath('/almacenes/ingresos/importar');
  if (id) revalidatePath(`/almacenes/ingresos/importar/${id}`);
  revalidatePath('/alertas');
  revalidatePath('/panel');
}

/* ==========================================================================
   1 · SUBIR
   ========================================================================== */
export async function subirImportacionIngresos(formulario: FormData): Promise<Resultado> {
  const permiso = await autorizar(PUEDEN_INGRESAR, 'importar ingresos a cámara');
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const archivo = formulario.get('archivo');
  if (!(archivo instanceof File) || archivo.size === 0) {
    return { ok: false, mensaje: 'Elija el archivo de Excel que quiere subir.' };
  }
  if (!/\.xlsx$/i.test(archivo.name)) {
    return { ok: false, mensaje: `«${archivo.name}» no es un libro de Excel .xlsx. Guárdelo como «Libro de Excel (.xlsx)» y vuelva a subirlo.` };
  }
  if (archivo.size > MAXIMO_BYTES) {
    return { ok: false, mensaje: `El archivo pesa ${Math.round(archivo.size / 1024)} KB y el máximo son ${Math.round(MAXIMO_BYTES / 1024)} KB. Divídalo en dos.` };
  }

  const leido = await leerPlantilla(await archivo.arrayBuffer(), {
    hoja: HOJA_INGRESOS, columnas: COLUMNAS_INGRESO, claveEjemplo: 'codigo_pallet',
  });
  if (!leido.ok) return { ok: false, mensaje: leido.mensaje };

  const supabase = await crearClienteServidor();

  const { data: imp, error } = await supabase
    .from('importaciones_excel')
    .insert({ tipo: 'ingresos', archivo: archivo.name.slice(0, 200), archivo_bytes: archivo.size, creado_por: permiso.usuario!.id })
    .select('id')
    .single();
  if (error || !imp) {
    return { ok: false, mensaje: traducirErrorBase(error, { que: 'guardar la importación', quien: PUEDEN_INGRESAR }) };
  }

  /* Se revisan todas juntas (para los duplicados dentro del archivo) y se
     guardan de una vez. */
  const cat = await cargarCatalogoIngresos(supabase);
  const borrador: FilaGuardada[] = leido.filas.map((f, i) => ({
    id: -(i + 1), importacion_id: Number(imp.id), fila: f.fila, datos: f.valores, errores: [], estado: 'con_error', resultado: null,
  }));
  const ctx = await contextoDeFilas(supabase, borrador, cat);
  const revisadas = new Map(revisarConjunto(borrador, cat, ctx).map((f) => [f.id, f]));

  const { error: errFilas } = await supabase.from('importaciones_excel_filas').insert(
    borrador.map((f) => {
      const r = revisadas.get(f.id) ?? f;
      return { importacion_id: r.importacion_id, fila: r.fila, datos: r.datos, errores: r.errores, estado: r.estado };
    })
  );
  if (errFilas) {
    await supabase.from('importaciones_excel').delete().eq('id', imp.id);
    return { ok: false, mensaje: traducirErrorBase(errFilas, { que: 'guardar las filas de la importación', quien: PUEDEN_INGRESAR }) };
  }

  const validas = [...revisadas.values()].filter((f) => f.estado === 'valida').length;
  refrescar(Number(imp.id));
  return {
    ok: true,
    id: Number(imp.id),
    mensaje:
      `Se leyeron ${leido.filas.length} fila${leido.filas.length === 1 ? '' : 's'}: ${validas} lista${validas === 1 ? '' : 's'} y ` +
      `${leido.filas.length - validas} con error.` +
      (leido.ignoradas.length ? ` No se leyeron estas columnas, que no son de la plantilla: ${leido.ignoradas.join(', ')}.` : ''),
  };
}

/* ==========================================================================
   2 · CORREGIR O DESCARTAR UNA FILA
   ========================================================================== */
async function filaEditable(supabase: Awaited<ReturnType<typeof crearClienteServidor>>, filaId: number) {
  const { data } = await supabase
    .from('importaciones_excel_filas').select('id, importacion_id, fila, estado, importaciones_excel(tipo)').eq('id', filaId).maybeSingle();
  if (!data) return { error: 'Esa fila ya no existe.' };
  const imp = Array.isArray(data.importaciones_excel) ? data.importaciones_excel[0] : data.importaciones_excel;
  if ((imp as { tipo?: string } | null)?.tipo !== 'ingresos') return { error: 'Esa fila no es de una importación de ingresos.' };
  if (['registrada', 'programada', 'procesando'].includes(String(data.estado))) {
    return { error: `La fila ${data.fila} ya se registró: no se puede cambiar. Si hay que corregir el pallet, hágalo desde su ficha.` };
  }
  return { fila: data };
}

export async function corregirFilaIngreso(filaId: number, valores: Record<string, string>): Promise<Resultado> {
  const permiso = await autorizar(PUEDEN_INGRESAR, 'corregir importaciones de ingresos');
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const supabase = await crearClienteServidor();
  const f = await filaEditable(supabase, filaId);
  if (f.error) return { ok: false, mensaje: f.error };

  //  Solo las columnas de la plantilla, como texto.
  const datos = Object.fromEntries(COLUMNAS_INGRESO.map((c) => [c.clave, String(valores[c.clave] ?? '').trim().slice(0, 300)]));
  const { data: upd, error } = await supabase
    .from('importaciones_excel_filas').update({ datos, estado: 'con_error', actualizado_en: new Date().toISOString() })
    .eq('id', filaId).select('id');
  if (error || !upd?.length) return { ok: false, mensaje: traducirErrorBase(error, { que: 'guardar la corrección', quien: PUEDEN_INGRESAR }) };

  const importacionId = Number(f.fila!.importacion_id);
  const r = await revisarImportacion(supabase, importacionId, new Set([filaId]));
  if (!r.ok) return r;

  const { data: queda } = await supabase.from('importaciones_excel_filas').select('estado, errores').eq('id', filaId).single();
  refrescar(importacionId);
  const errores = (queda?.errores ?? []) as { mensaje: string }[];
  return queda?.estado === 'valida'
    ? { ok: true, id: filaId, mensaje: `Fila ${f.fila!.fila} corregida: ya está lista para registrar.` }
    : { ok: false, mensaje: `La fila ${f.fila!.fila} todavía tiene ${errores.length} error${errores.length === 1 ? '' : 'es'}: ${errores.map((e) => e.mensaje).join(' ')}` };
}

export async function descartarFilaIngreso(filaId: number, descartar: boolean): Promise<Resultado> {
  const permiso = await autorizar(PUEDEN_INGRESAR, 'corregir importaciones de ingresos');
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const supabase = await crearClienteServidor();
  const f = await filaEditable(supabase, filaId);
  if (f.error) return { ok: false, mensaje: f.error };

  const { data: upd, error } = await supabase
    .from('importaciones_excel_filas')
    .update({ estado: descartar ? 'descartada' : 'con_error', resultado: null, actualizado_en: new Date().toISOString() })
    .eq('id', filaId).select('id');
  if (error || !upd?.length) return { ok: false, mensaje: traducirErrorBase(error, { que: 'descartar la fila', quien: PUEDEN_INGRESAR }) };

  const importacionId = Number(f.fila!.importacion_id);
  //  Descartar una fila puede liberar un código repetido en otra: se revisa todo.
  const r = await revisarImportacion(supabase, importacionId, descartar ? new Set() : new Set([filaId]));
  if (!r.ok) return r;
  refrescar(importacionId);
  return {
    ok: true, id: filaId,
    mensaje: descartar
      ? `Fila ${f.fila!.fila} descartada: no se registrará. Puede recuperarla con «Restaurar».`
      : `Fila ${f.fila!.fila} restaurada y revisada de nuevo.`,
  };
}

/* ==========================================================================
   3 · DEJAR LISTA PARA VALIDAR
   ========================================================================== */
export async function dejarListaParaValidar(importacionId: number): Promise<Resultado> {
  const permiso = await autorizar(PUEDEN_INGRESAR, 'preparar importaciones de ingresos');
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const supabase = await crearClienteServidor();
  const { data: imp } = await supabase.from('importaciones_excel').select('id, estado, tipo, archivo').eq('id', importacionId).maybeSingle();
  if (!imp || imp.tipo !== 'ingresos') return { ok: false, mensaje: 'Esa importación ya no existe.' };
  if (imp.estado === 'lista') return { ok: false, mensaje: 'Esta importación ya está lista para validar: falta que Gerencia u Operaciones la valide.' };

  const { count } = await supabase.from('importaciones_excel_filas')
    .select('id', { count: 'exact', head: true }).eq('importacion_id', importacionId).eq('estado', 'valida');
  if (!count) return { ok: false, mensaje: 'No hay ninguna fila lista: corrija o descarte las filas con error antes de enviarla a validar.' };

  const { data: upd, error } = await supabase
    .from('importaciones_excel')
    .update({ estado: 'lista', enviada_por: permiso.usuario!.id, enviada_en: new Date().toISOString() })
    .eq('id', importacionId).select('id');
  if (error || !upd?.length) return { ok: false, mensaje: traducirErrorBase(error, { que: 'dejar lista la importación', quien: PUEDEN_INGRESAR }) };

  refrescar(importacionId);
  return {
    ok: true, id: importacionId,
    mensaje: `Importación lista para validar con ${count} ingreso${count === 1 ? '' : 's'}. Gerencia y Operaciones la ven en Alertas y en su panel; ` +
      'el stock entra cuando cualquiera de ellos pulse «Validar y registrar».',
  };
}

/* ==========================================================================
   4 · VALIDAR Y REGISTRAR
   --------------------------------------------------------------------------
   Se registra por tandas (la pantalla llama una y otra vez hasta terminar):
   cada pallet son cuatro escrituras en la base, y trescientos de una sola vez
   podrían pasar el tiempo máximo de una petición. Con tandas, además, la
   pantalla puede decir «van 40 de 120».
   ========================================================================== */
export type ResultadoTanda =
  | { ok: true; procesadas: number; pendientes: number; registradas: number; programadas: number; fallidas: number; mensaje: string }
  | { ok: false; mensaje: string };

const TANDA = 15;

export async function validarYRegistrar(importacionId: number): Promise<ResultadoTanda> {
  const permiso = await autorizar(PUEDEN_VALIDAR_IMPORTACION, 'validar importaciones de ingresos');
  if (permiso.error) {
    return { ok: false, mensaje: `${permiso.error} Déjela «Lista para validar» y quedará avisado en sus Alertas.` };
  }
  const usuarioId = permiso.usuario!.id as string;

  const supabase = await crearClienteServidor();
  const { data: imp } = await supabase.from('importaciones_excel').select('id, tipo, estado, archivo').eq('id', importacionId).maybeSingle();
  if (!imp || imp.tipo !== 'ingresos') return { ok: false, mensaje: 'Esa importación ya no existe.' };

  /* Quién validó y cuándo. La base exige además que sea Gerencia u Operaciones (074). */
  const { error: errVal } = await supabase
    .from('importaciones_excel')
    .update({ estado: 'validada', procesado_por: usuarioId, procesado_en: new Date().toISOString() })
    .eq('id', importacionId);
  if (errVal) return { ok: false, mensaje: traducirErrorBase(errVal, { que: 'validar la importación', quien: PUEDEN_VALIDAR_IMPORTACION }) };

  /* Una fila que quedó «registrando» hace más de dos minutos (se cortó la
     conexión a mitad) vuelve a la cola: si llegó a crearse el pallet, la
     regla del código repetido lo dirá. */
  await supabase.from('importaciones_excel_filas').update({ estado: 'valida' })
    .eq('importacion_id', importacionId).eq('estado', 'procesando')
    .lt('actualizado_en', new Date(Date.now() - 120000).toISOString());

  const { data: cola } = await supabase
    .from('importaciones_excel_filas').select('id, importacion_id, fila, datos, errores, estado, resultado')
    .eq('importacion_id', importacionId).eq('estado', 'valida').order('fila').limit(TANDA);
  const tanda = (cola ?? []) as unknown as FilaGuardada[];

  const cat = await cargarCatalogoIngresos(supabase);
  const ctx = await contextoDeFilas(supabase, tanda, cat);
  let registradas = 0, programadas = 0, fallidas = 0, procesadas = 0;

  for (const f of tanda) {
    /* Se «toma» la fila antes de registrarla: si dos personas pulsan a la vez,
       cada fila la registra solo una. */
    const { data: tomada } = await supabase.from('importaciones_excel_filas')
      .update({ estado: 'procesando', actualizado_en: new Date().toISOString() })
      .eq('id', f.id).eq('estado', 'valida').select('id');
    if (!tomada?.length) continue;
    procesadas++;

    //  Las mismas reglas, otra vez y con datos de este instante.
    const interp = interpretarFila(f.datos, cat, ctx.hoy);
    const errores = revisarFila(interp, ctx);
    let cambio: Record<string, unknown>;

    if (errores.length) {
      fallidas++;
      cambio = { estado: 'con_error' as EstadoFila, errores, resultado: 'Al registrar ya no cumplía las reglas: corríjala.' };
    } else if (interp.fechaLlegada) {
      const r = await crearProgramado(supabase, usuarioId, interp.datos, interp.fechaLlegada, importacionId);
      if (r.ok) { programadas++; cambio = { estado: 'programada', resultado: r.mensaje, ingreso_programado_id: r.id }; }
      else { fallidas++; cambio = { estado: 'fallida', resultado: r.mensaje }; }
    } else {
      const r = await crearIngreso(supabase, usuarioId, interp.datos, { documento: `importado de «${imp.archivo}»` });
      if (r.ok) { registradas++; cambio = { estado: 'registrada', resultado: r.mensaje, lote_id: r.id }; }
      else { fallidas++; cambio = { estado: 'fallida', resultado: r.mensaje }; }
    }
    //  Que el código ya usado cuente para las filas que siguen en esta tanda.
    if (cambio.estado === 'registrada' || cambio.estado === 'programada') ctx.existentes.add(normalizarCodigo(interp.datos.codigo_pallet));

    await supabase.from('importaciones_excel_filas')
      .update({ ...cambio, actualizado_en: new Date().toISOString() }).eq('id', f.id);
  }

  const { count: pendientes } = await supabase.from('importaciones_excel_filas')
    .select('id', { count: 'exact', head: true }).eq('importacion_id', importacionId).in('estado', ['valida', 'procesando']);

  if (registradas) refrescarIngresos();
  if (programadas) revalidatePath('/almacenes/ingresos/programados');
  refrescar(importacionId);

  return {
    ok: true, procesadas, pendientes: pendientes ?? 0, registradas, programadas, fallidas,
    mensaje: `${registradas} registrado${registradas === 1 ? '' : 's'}, ${programadas} programado${programadas === 1 ? '' : 's'}` +
      (fallidas ? `, ${fallidas} con problema` : '') + '.',
  };
}
