'use server';

/**
 * ============================================================================
 *  DIVIDIR UN PALLET (088 · reunión con Dany, Almacén, 10/11)
 * ============================================================================
 *  Almacén separa parte de los sacos de un pallet y los arma en otro, con un
 *  número nuevo: para un despacho que no se lleva el pallet entero, o para
 *  reacomodar la cámara. Lo que queda en el original es su SALDO.
 *
 *  Todo lo importante lo hace la base: pallet_dividir() valida el rol, que el
 *  original quede con algo, que no se toque lo reservado ni un pallet en un
 *  packing o un traslado abierto o bloqueado por Calidad, y que el número
 *  nuevo no exista; crea el pallet hijo con la trazabilidad del original y
 *  escribe en el Kardex la salida y el ingreso por división. Aquí solo se
 *  traduce la respuesta.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { NOMBRE_ROL, type Rol } from '@/lib/navegacion';

const PUEDEN_DIVIDIR = ['gerencia', 'operaciones', 'almacen'];

export type DatosDivision = {
  lote_id: number;
  almacen_id: number;
  bultos: number;
  peso_kg: number;
  codigo_nuevo: string;
  detalle: string;
};

export type ResultadoDivision =
  | { ok: true; mensaje: string; lote_nuevo_id: number }
  | { ok: false; mensaje: string };

const kg = (n: number) => n.toLocaleString('es-PE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const bultos = (n: number) => `${n} bulto${n === 1 ? '' : 's'}`;

export async function dividirPallet(d: DatosDivision): Promise<ResultadoDivision> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión caducó. Vuelva a entrar.' };
  if (!PUEDEN_DIVIDIR.includes(usuario.rol)) {
    return { ok: false, mensaje: `${NOMBRE_ROL[usuario.rol as Rol] ?? 'Su rol'} no puede dividir pallets: lo hacen Almacén, Operaciones o Gerencia.` };
  }
  if (!d.lote_id || !d.almacen_id) return { ok: false, mensaje: 'Elija en qué bodega está el pallet que se divide.' };
  if (!Number.isInteger(d.bultos) || d.bultos <= 0) return { ok: false, mensaje: 'Los bultos que pasan al pallet nuevo van en número entero, más de cero.' };
  if (!(d.peso_kg > 0)) return { ok: false, mensaje: 'Indique los kilos que pasan al pallet nuevo (más de cero).' };
  if (!d.codigo_nuevo?.trim()) return { ok: false, mensaje: 'Escriba el N° de pallet del pallet nuevo.' };

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc('pallet_dividir', {
    p_lote_id: d.lote_id,
    p_almacen_id: d.almacen_id,
    p_bultos: d.bultos,
    p_peso_kg: d.peso_kg,
    p_codigo_nuevo: d.codigo_nuevo,
    p_detalle: d.detalle?.trim() || null,
  });
  if (error) {
    //  Sin la migración 088 la función no existe: se dice en palabras.
    if (/pallet_dividir/.test(error.message) && /(find|exist|schema cache)/i.test(error.message)) {
      return { ok: false, mensaje: 'La división de pallets todavía no está activada en la base (migración 088). Avise a sistemas.' };
    }
    return { ok: false, mensaje: error.message };
  }

  const r = data as { documento: string; lote_nuevo_id: number; codigo_nuevo: string; pallet: string; almacen: string; bultos_quedan: number; kg_quedan: number };
  for (const ruta of ['/almacenes/existencias', '/almacenes/kardex', '/almacenes/movimientos', '/almacenes/valorizado', '/ventas/disponibilidad']) {
    revalidatePath(ruta);
  }
  revalidatePath(`/almacenes/lotes/${d.lote_id}`);

  return {
    ok: true,
    lote_nuevo_id: Number(r.lote_nuevo_id),
    mensaje: `${r.documento}: el pallet ${r.codigo_nuevo} nació con ${bultos(d.bultos)} · ${kg(d.peso_kg)} kg en ${r.almacen}. ` +
      `Al ${r.pallet} le quedan ${bultos(Number(r.bultos_quedan))} · ${kg(Number(r.kg_quedan))} kg (saldo).`,
  };
}
