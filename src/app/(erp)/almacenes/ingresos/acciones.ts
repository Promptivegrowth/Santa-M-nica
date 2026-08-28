'use server';

/**
 * ============================================================================
 *  REGISTRAR UN INGRESO A CÁMARA
 * ============================================================================
 *  Este es el punto de partida de todo. Aquí nace un lote, y con él su Kardex,
 *  su costo y su trazabilidad. Todo lo que después se reserva, se despacha y
 *  se factura arranca en esta pantalla.
 *
 *  QUÉ PASA POR DEBAJO CUANDO SE GUARDA
 *  Se hacen dos cosas, en este orden:
 *
 *    1. Se crea el LOTE: qué producto es, de qué día, de qué turno y de qué
 *       línea salió, cuántos bultos y cuánto pesan.
 *    2. Se escribe un MOVIMIENTO de tipo «ingreso» en el Kardex.
 *
 *  El segundo paso es el que mueve el inventario. Un disparador de la base de
 *  datos toma ese movimiento y actualiza las existencias, y de paso recalcula
 *  el costo promedio móvil de la bodega. Nosotros no tocamos existencias a
 *  mano: si lo hiciéramos, el Kardex y el stock podrían decir cosas distintas,
 *  que es exactamente el problema que este sistema vino a resolver.
 *
 *  POR QUÉ EL CÓDIGO DE PALLET ES ÚNICO Y NO SE PUEDE REPETIR
 *  Porque es la matrícula del producto. Dos pallets con el mismo código hacen
 *  imposible responder «¿dónde está el lote que salió mal?», que es la única
 *  pregunta que importa cuando hay un reclamo sanitario.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { hoyEnLima } from '@/lib/fechas';

export type Resultado =
  | { ok: true; id: number; mensaje: string }
  | { ok: false; mensaje: string; campo?: string };

/** Quién puede meter producto a cámara. */
const PUEDEN_INGRESAR = ['gerencia', 'operaciones', 'almacen'];

export type DatosIngreso = {
  codigo_pallet: string;
  sku_presentacion_id: number;
  almacen_id: number;
  camara_id: number | null;
  fecha_produccion: string;      // AAAA-MM-DD
  turno: 'dia' | 'noche';
  proceso: 'propia' | 'maquila';
  planta_id: number | null;
  linea_procesadora_id: number | null;
  bultos: number;
  peso_neto_kg: number;
  costo_unitario: number;
  observaciones: string | null;
};

function refrescar() {
  revalidatePath('/almacenes/ingresos');
  revalidatePath('/almacenes/movimientos');
  revalidatePath('/almacenes/kardex');
  revalidatePath('/almacenes/existencias');
  revalidatePath('/almacenes/valorizado');
  revalidatePath('/almacenes/anticuamiento');
  revalidatePath('/ventas/disponibilidad');
  revalidatePath('/panel');
}

function validar(d: DatosIngreso): { mensaje: string; campo: string } | null {
  if (!d.codigo_pallet?.trim()) {
    return { mensaje: 'El pallet necesita un código: es su matrícula para toda la trazabilidad.', campo: 'codigo_pallet' };
  }
  if (d.codigo_pallet.trim().length > 30) {
    return { mensaje: 'El código de pallet es demasiado largo.', campo: 'codigo_pallet' };
  }
  if (!d.sku_presentacion_id) return { mensaje: 'Elija qué producto entró.', campo: 'sku_presentacion_id' };
  if (!d.almacen_id) return { mensaje: 'Elija a qué bodega entró.', campo: 'almacen_id' };
  if (!d.fecha_produccion) return { mensaje: 'Falta la fecha de producción.', campo: 'fecha_produccion' };

  /*
   * Una fecha futura casi siempre es un dedazo en el año, y trae consecuencias
   * caras: el anticuamiento sale negativo y el producto nunca entra en alerta
   * de vida útil.
   */
  const hoy = hoyEnLima();
  if (d.fecha_produccion > hoy) {
    return { mensaje: `La fecha de producción no puede ser futura: hoy es ${hoy}.`, campo: 'fecha_produccion' };
  }

  if (!(d.bultos > 0)) return { mensaje: 'Los bultos tienen que ser más de cero.', campo: 'bultos' };
  if (!Number.isInteger(d.bultos)) return { mensaje: 'Los bultos van en números enteros.', campo: 'bultos' };
  if (!(d.peso_neto_kg > 0)) return { mensaje: 'El peso neto tiene que ser mayor que cero.', campo: 'peso_neto_kg' };
  if (d.costo_unitario < 0) return { mensaje: 'El costo no puede ser negativo.', campo: 'costo_unitario' };

  return null;
}

async function autorizar() {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { error: 'Su sesión caducó. Vuelva a entrar.' };
  if (!PUEDEN_INGRESAR.includes(usuario.rol)) {
    return { error: `Su rol (${usuario.rol}) no puede registrar ingresos a cámara.` };
  }
  return { usuario };
}

/* ==========================================================================
   REGISTRAR
   ========================================================================== */
export async function registrarIngreso(d: DatosIngreso): Promise<Resultado> {
  const permiso = await autorizar();
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const problema = validar(d);
  if (problema) return { ok: false, ...problema };

  const supabase = await crearClienteServidor();
  const codigo = d.codigo_pallet.trim().toUpperCase();

  /* ---- 1. El código no puede estar repetido ---- */
  const { data: repetido } = await supabase
    .from('lotes').select('id').eq('codigo_pallet', codigo).maybeSingle();

  if (repetido) {
    return {
      ok: false,
      mensaje:
        `Ya existe un pallet con el código ${codigo}. El código es la matrícula del producto: ` +
        'dos iguales harían imposible saber cuál es cuál si hubiera un reclamo.',
      campo: 'codigo_pallet',
    };
  }

  /* ---- 2. La cámara tiene que ser de esa bodega ---- */
  if (d.camara_id) {
    const { data: camara } = await supabase
      .from('camaras').select('almacen_id, nombre').eq('id', d.camara_id).maybeSingle();
    if (Number(camara?.almacen_id) !== Number(d.almacen_id)) {
      return { ok: false, mensaje: 'Esa cámara no pertenece a la bodega elegida.', campo: 'camara_id' };
    }
  }

  /* ---- 3. Nace el lote ----
     La campaña se deduce del año de producción: es como se agrupa la
     temporada en los reportes, y pedirla a mano solo daría ocasión de
     equivocarse. */
  const campania = Number(d.fecha_produccion.slice(0, 4));

  const { data: lote, error: errorLote } = await supabase
    .from('lotes')
    .insert({
      codigo_pallet: codigo,
      campania,
      sku_presentacion_id: d.sku_presentacion_id,
      fecha_produccion: d.fecha_produccion,
      turno: d.turno,
      proceso: d.proceso,
      planta_id: d.planta_id,
      linea_procesadora_id: d.linea_procesadora_id,
      bultos_iniciales: d.bultos,
      peso_neto_inicial_kg: d.peso_neto_kg,
      costo_unitario: d.costo_unitario,
      observaciones: d.observaciones?.trim() || null,
      creado_por: permiso.usuario!.id,
    })
    .select('id')
    .single();

  if (errorLote || !lote) {
    return { ok: false, mensaje: `No se pudo crear el lote: ${errorLote?.message}` };
  }

  /* ---- 4. El movimiento, que es lo que mueve el inventario ----
     Si esto fallara, quedaría un lote fantasma: existiría en la tabla pero con
     cero stock, sin Kardex y sin explicación. Se deshace el lote para no dejar
     ese cadáver en la base. */
  const { error: errorMov } = await supabase.from('movimientos').insert({
    tipo: 'ingreso',
    lote_id: lote.id,
    almacen_id: d.almacen_id,
    camara_id: d.camara_id,
    bultos: d.bultos,
    peso_neto_kg: d.peso_neto_kg,
    costo_unitario: d.costo_unitario,
    documento_tipo: 'ingreso',
    documento_ref: `ING-${String(lote.id).padStart(6, '0')}`,
    usuario_id: permiso.usuario!.id,
    observaciones: d.observaciones?.trim() || null,
  });

  if (errorMov) {
    await supabase.from('lotes').delete().eq('id', lote.id);
    return { ok: false, mensaje: `No se pudo registrar el movimiento: ${errorMov.message}` };
  }

  await supabase.rpc('registrar_evento', {
    p_entidad: 'lotes',
    p_entidad_id: lote.id,
    p_tipo: 'ingreso_registrado',
    p_descripcion:
      `Ingreso del pallet ${codigo}: ${d.bultos} bultos, ` +
      `${d.peso_neto_kg.toLocaleString('es-PE', { maximumFractionDigits: 1 })} kg, ` +
      `producidos el ${d.fecha_produccion}`,
    p_severidad: 'info',
    p_metadatos: { pallet: codigo, bultos: d.bultos, kg: d.peso_neto_kg, almacen_id: d.almacen_id },
  }).then(() => undefined, () => undefined);

  refrescar();

  return {
    ok: true,
    id: lote.id as number,
    mensaje:
      `Pallet ${codigo} ingresado: ${d.bultos} bultos y ` +
      `${d.peso_neto_kg.toLocaleString('es-PE', { maximumFractionDigits: 1 })} kg ya están disponibles para vender.`,
  };
}

/* ==========================================================================
   AYUDAS PARA EL FORMULARIO
   ========================================================================== */

/** Las cámaras de una bodega. Se cargan al elegirla. */
export async function camarasDeAlmacen(almacenId: number): Promise<{ id: number; nombre: string }[]> {
  const supabase = await crearClienteServidor();
  const { data } = await supabase
    .from('camaras').select('id, nombre').eq('almacen_id', almacenId).eq('activo', true).order('nombre');
  return (data ?? []).map((c) => ({ id: c.id as number, nombre: c.nombre as string }));
}

/**
 * Propone el siguiente código de pallet siguiendo el formato de la casa.
 *
 * Los códigos reales tienen la forma «SM 26 02 0168»: dos letras de la planta,
 * el año, el mes y un correlativo. Se propone el siguiente número libre de ese
 * mes; si el usuario usa otro formato, puede escribirlo encima.
 */
export async function siguienteCodigoPallet(prefijo = 'SM'): Promise<string> {
  const supabase = await crearClienteServidor();
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
  const anio = hoy.slice(2, 4);
  const mes = hoy.slice(5, 7);
  const raiz = `${prefijo} ${anio} ${mes} `;

  const { data } = await supabase
    .from('lotes').select('codigo_pallet').like('codigo_pallet', `${raiz}%`)
    .order('codigo_pallet', { ascending: false }).limit(1).maybeSingle();

  const ultimo = Number(String(data?.codigo_pallet ?? '').slice(-4)) || 0;
  return `${raiz}${String(ultimo + 1).padStart(4, '0')}`;
}

/** El costo del último ingreso de ese producto, para proponerlo. */
export async function costoSugerido(skuPresentacionId: number): Promise<number> {
  const supabase = await crearClienteServidor();
  const { data } = await supabase
    .from('lotes').select('costo_unitario')
    .eq('sku_presentacion_id', skuPresentacionId)
    .order('creado_en', { ascending: false })
    .limit(1).maybeSingle();
  return Number(data?.costo_unitario ?? 0);
}
