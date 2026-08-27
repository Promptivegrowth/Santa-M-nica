'use server';

/**
 * ============================================================================
 *  EJECUTAR UN DESPACHO
 * ============================================================================
 *  Este es el momento en que la mercadería SALE de verdad. Hasta aquí estaba
 *  reservada —apartada, pero contando como stock físico—; a partir de aquí ya
 *  no está.
 *
 *  QUÉ PASA AL PULSAR EL BOTÓN, EN UNA SOLA OPERACIÓN DE BASE DE DATOS:
 *    1. Se crea el despacho con su número.
 *    2. Se escribe una salida en el Kardex por cada lote cargado.
 *    3. Las reservas de esos lotes pasan a «consumida»: dejan de retener nada.
 *    4. El packing list se cierra y el embarque queda «despachado».
 *
 *  POR QUÉ LO HACE LA BASE DE DATOS Y NO ESTE ARCHIVO
 *  Porque son cuatro cosas que tienen que pasar todas o ninguna. Si se hicieran
 *  desde aquí, una caída de red entre el paso 2 y el 3 dejaría el stock
 *  descontado y las reservas todavía reteniendo: el inventario mostraría menos
 *  de lo que hay y encima apartado. La función `ejecutar_despacho` corre dentro
 *  de una transacción, así que eso no puede ocurrir.
 *
 *  ESTA OPERACIÓN NO SE DESHACE
 *  El Kardex es inmutable por disparador. Un despacho equivocado se corrige con
 *  un ajuste autorizado, que deja su propia huella. Por eso la pantalla pide
 *  confirmación con el número del contenedor.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';

export type Resultado =
  | { ok: true; id: number; numero: string; mensaje: string }
  | { ok: false; mensaje: string; detalles?: string[] };

/** Quién puede sacar mercadería de cámara. */
const PUEDEN_DESPACHAR = ['gerencia', 'operaciones', 'almacen', 'comex'];

function refrescar() {
  revalidatePath('/logistica/despachos');
  revalidatePath('/logistica/packing');
  revalidatePath('/logistica/embarques');
  revalidatePath('/logistica/planificador');
  revalidatePath('/almacenes/existencias');
  revalidatePath('/almacenes/reservas');
  revalidatePath('/almacenes/movimientos');
  revalidatePath('/almacenes/kardex');
  revalidatePath('/ventas/disponibilidad');
  revalidatePath('/ventas/pedidos');
  revalidatePath('/panel');
}

/* ==========================================================================
   REVISIÓN PREVIA
   --------------------------------------------------------------------------
   Se comprueba ANTES de llamar a la función, para poder explicar qué falta en
   lugar de devolver un error de PostgreSQL. La función vuelve a comprobarlo
   por su cuenta: esta revisión es para el usuario, no para la seguridad.
   ========================================================================== */
export type Revision = {
  puede: boolean;
  packing: string;
  contenedor: string | null;
  embarque: string;
  destino: string;
  almacen: string;
  lotes: number;
  bultos: number;
  tm: number;
  impedimentos: string[];
  avisos: string[];
};

export async function revisarDespacho(packingListId: number): Promise<Revision | null> {
  const supabase = await crearClienteServidor();

  const { data: pk } = await supabase
    .from('packing_lists')
    .select('id, codigo, contenedor, precinto, guia_remision, dam, estado, fecha_carga, embarques(numero, estado, fecha_programada, almacenes(nombre), destinos(puerto, pais))')
    .eq('id', packingListId)
    .maybeSingle();

  if (!pk) return null;

  const emb = Array.isArray(pk.embarques) ? pk.embarques[0] : pk.embarques;
  const alm = Array.isArray(emb?.almacenes) ? emb.almacenes[0] : emb?.almacenes;
  const dst = Array.isArray(emb?.destinos) ? emb.destinos[0] : emb?.destinos;

  const [{ data: lineas }, { count: celdasPlano }] = await Promise.all([
    supabase.from('packing_lineas').select('bultos, peso_neto_kg').eq('packing_list_id', packingListId),
    supabase.from('plano_estiba').select('id', { count: 'exact', head: true }).eq('packing_list_id', packingListId),
  ]);

  const impedimentos: string[] = [];
  const avisos: string[] = [];

  if (pk.estado === 'cerrado') impedimentos.push('Este packing ya fue despachado.');
  if (pk.estado === 'anulado') impedimentos.push('Este packing está anulado.');
  if ((lineas ?? []).length === 0) impedimentos.push('El packing no tiene ni un lote cargado.');
  if ((celdasPlano ?? 0) === 0) {
    impedimentos.push(
      'No tiene plano de estiba. Sin él no se sabe qué lote quedó en cada fila del contenedor, ' +
      'que es justo lo que hace falta si en destino aparece un problema.'
    );
  }

  // Estos no impiden despachar, pero conviene saberlos antes y no después.
  if (!pk.contenedor) avisos.push('No tiene número de contenedor cargado.');
  if (!pk.precinto) avisos.push('No tiene número de precinto.');
  if (!pk.guia_remision) avisos.push('No tiene guía de remisión: SUNAT la exige para el traslado.');
  if (!pk.dam && dst?.pais && dst.pais !== 'Perú') {
    avisos.push('No tiene DAM cargada, y es una exportación.');
  }

  const bultos = (lineas ?? []).reduce((s, l) => s + Number(l.bultos ?? 0), 0);
  const kg = (lineas ?? []).reduce((s, l) => s + Number(l.peso_neto_kg ?? 0), 0);

  return {
    puede: impedimentos.length === 0,
    packing: pk.codigo as string,
    contenedor: (pk.contenedor as string) ?? null,
    embarque: (emb?.numero as string) ?? '—',
    destino: `${dst?.puerto ?? '—'}${dst?.pais ? ', ' + dst.pais : ''}`,
    almacen: (alm?.nombre as string) ?? '—',
    lotes: (lineas ?? []).length,
    bultos,
    tm: kg / 1000,
    impedimentos,
    avisos,
  };
}

/* ==========================================================================
   EJECUTAR
   ========================================================================== */
export async function ejecutarDespacho(packingListId: number): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión caducó. Vuelva a entrar.' };
  if (!PUEDEN_DESPACHAR.includes(usuario.rol)) {
    return { ok: false, mensaje: `Su rol (${usuario.rol}) no puede despachar mercadería.` };
  }

  const revision = await revisarDespacho(packingListId);
  if (!revision) return { ok: false, mensaje: 'Ese packing list ya no existe.' };
  if (!revision.puede) {
    return {
      ok: false,
      mensaje: `No se puede despachar ${revision.packing}.`,
      detalles: revision.impedimentos,
    };
  }

  const supabase = await crearClienteServidor();

  /* ---- El número del despacho, de un contador atómico ----
     Se usa el mismo mecanismo que las proformas: la base entrega los números
     de a uno, así que dos personas despachando a la vez no pueden sacar el
     mismo. */
  const anio = new Date().getFullYear();
  const { data: correlativo, error: errorNum } = await supabase
    .rpc('siguiente_correlativo', { p_serie: 'DESP', p_anio: anio });

  if (errorNum) {
    return { ok: false, mensaje: `No se pudo reservar el número de despacho: ${errorNum.message}` };
  }

  const numero = `DESP-${anio}-${String(correlativo).padStart(4, '0')}`;

  const { data: despachoId, error } = await supabase
    .rpc('ejecutar_despacho', { p_packing_list_id: packingListId, p_numero: numero });

  if (error) {
    /*
     * La función lanza excepciones con texto en cristiano («No se puede
     * despachar sin plano de estiba generado»). Se pasa tal cual: es más útil
     * que cualquier cosa que se pudiera inventar aquí.
     */
    return { ok: false, mensaje: `No se pudo despachar: ${error.message}` };
  }

  refrescar();

  return {
    ok: true,
    id: Number(despachoId),
    numero,
    mensaje:
      `Despacho ${numero} ejecutado. Salieron ${revision.bultos.toLocaleString('es-PE')} bultos ` +
      `y ${revision.tm.toFixed(2)} TM hacia ${revision.destino}. ` +
      'El stock ya está descontado del Kardex y las reservas quedaron consumidas.',
  };
}
