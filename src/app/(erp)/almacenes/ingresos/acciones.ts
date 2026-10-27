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
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { hoyEnLima } from '@/lib/fechas';
import { rolNoPuede } from '@/lib/mensajesBase';
import { PUEDEN_INGRESAR, type DatosIngreso } from './tipos';
import { cargarContexto, revisarIngreso, crearIngreso, refrescarIngresos, normalizarCodigo } from './registro';

export type { DatosIngreso } from './tipos';

export type Resultado =
  | { ok: true; id: number; mensaje: string }
  | { ok: false; mensaje: string; campo?: string };

async function autorizar() {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { error: 'Su sesión caducó. Vuelva a entrar.' };
  if (!(PUEDEN_INGRESAR as readonly string[]).includes(usuario.rol)) {
    return { error: rolNoPuede(usuario.rol, 'registrar ingresos a cámara', PUEDEN_INGRESAR) };
  }
  return { usuario };
}

/* ==========================================================================
   REGISTRAR
   --------------------------------------------------------------------------
   Las reglas y el alta viven en registro.ts: son las mismas para el
   formulario, la importación desde Excel y la confirmación de un ingreso
   programado (074). Aquí solo se autoriza y se muestra el primer problema,
   que es el que el formulario marca en rojo.
   ========================================================================== */
export async function registrarIngreso(d: DatosIngreso): Promise<Resultado> {
  const permiso = await autorizar();
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const supabase = await crearClienteServidor();
  const ctx = await cargarContexto(supabase, [normalizarCodigo(d.codigo_pallet)], [Number(d.sku_presentacion_id)], hoyEnLima());
  const problemas = revisarIngreso(d, ctx);
  if (problemas.length) return { ok: false, mensaje: problemas[0].mensaje, campo: problemas[0].campo };

  const r = await crearIngreso(supabase, permiso.usuario!.id as string, d);
  if (!r.ok) return r;

  refrescarIngresos();
  return { ok: true, id: r.id, mensaje: r.mensaje };
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

/**
 * El costo que se le va a poner al pallet: el que rige hoy para ese producto.
 *
 * Lo pone la base al crear el lote (057); esto es solo para enseñarlo en el
 * formulario antes de guardar. Almacén no puede leer la tabla de costos, así
 * que se pregunta a una función que devuelve solo esto y solo de un producto.
 * `null` si el producto nunca tuvo costo cargado: entonces sí se teclea.
 */
export async function costoVigente(skuPresentacionId: number): Promise<
  { total_kg: number; vigente_desde: string; tipo: string } | null
> {
  const supabase = await crearClienteServidor();
  const { data } = await supabase.rpc('costo_vigente_ingreso', { p_sku_presentacion_id: skuPresentacionId });
  const fila = (data ?? [])[0];
  return fila ? { total_kg: Number(fila.total_kg), vigente_desde: String(fila.vigente_desde), tipo: String(fila.tipo) } : null;
}
