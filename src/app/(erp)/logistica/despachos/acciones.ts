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
 *  LO QUE SALIÓ DE VERDAD (075, pedido de Oliver Tello)
 *  No siempre sale exactamente lo cargado: un muestreo en el muelle, sacos
 *  dañados, un pallet que no entra. Por defecto sale todo lo cargado (cero
 *  clics de más); si no, se declara por pallet lo que salió y el motivo:
 *    · Muestreo y sacos dañados (merma) → salen del stock con su propio
 *      movimiento (salida_muestra, salida_merma), no como venta al cliente,
 *      y su reserva se libera.
 *    · No entró en el contenedor y otro → vuelve a cámara (nada en el
 *      Kardex) y sigue apartado para el mismo pedido: queda pendiente para
 *      el próximo embarque.
 *  En los cuatro casos el pedido queda con ese saldo pendiente, y el
 *  embarque deja de darlo por programado cuando termina de salir.
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
import { PUEDEN_DESPACHAR, mensajeNoPuede } from '@/lib/permisosLogistica';

export type Resultado =
  | { ok: true; id: number; numero: string; mensaje: string }
  | { ok: false; mensaje: string; detalles?: string[] };

const uno = <T = Record<string, unknown>>(v: unknown) => (Array.isArray(v) ? v[0] : v) as T | undefined;

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
  revalidatePath('/reportes');
}

/* ==========================================================================
   LOS MOTIVOS DE UNA DIFERENCIA
   ========================================================================== */
export type MotivoDiferencia = 'muestreo' | 'merma' | 'no_entro' | 'otro';

/** Si la diferencia sale del stock (muestra, merma) o vuelve a cámara. */
const SALE_DEL_STOCK: Record<MotivoDiferencia, boolean> = {
  muestreo: true,
  merma: true,
  no_entro: false,
  otro: false,
};

/** Lo que salió de UN pallet cuando no es todo lo cargado. */
export type AjusteDespacho = {
  lote_id: number;
  /** Lo que SALIÓ, no la diferencia. */
  bultos: number;
  kg: number;
  motivo: MotivoDiferencia | '';
  detalle?: string | null;
};

/* ==========================================================================
   REVISIÓN PREVIA
   --------------------------------------------------------------------------
   Se comprueba ANTES de llamar a la función, para poder explicar qué falta en
   lugar de devolver un error de PostgreSQL. La función vuelve a comprobarlo
   por su cuenta: esta revisión es para el usuario, no para la seguridad.
   ========================================================================== */

/** Un pallet del contenedor, como se ve antes de despachar. */
export type LineaRevision = {
  lote_id: number;
  pallet: string;
  producto: string;
  bultos: number;
  kg: number;
  /** Si Calidad lo bloqueó, por qué. Un pallet bloqueado no sale. */
  bloqueo: string | null;
};

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
  lineas: LineaRevision[];
};

export async function revisarDespacho(packingListId: number): Promise<Revision | null> {
  const supabase = await crearClienteServidor();

  const { data: pk } = await supabase
    .from('packing_lists')
    .select('id, codigo, contenedor, precinto, guia_remision, dam, estado, fecha_carga, embarques(numero, estado, fecha_programada, almacenes(nombre), destinos(puerto, pais))')
    .eq('id', packingListId)
    .maybeSingle();

  if (!pk) return null;

  const emb = uno<Record<string, unknown>>(pk.embarques);
  const alm = uno<Record<string, unknown>>(emb?.almacenes);
  const dst = uno<Record<string, unknown>>(emb?.destinos);

  const [{ data: lineas }, { count: celdasPlano }] = await Promise.all([
    supabase.from('packing_lineas')
      .select('lote_id, bultos, peso_neto_kg, lotes(codigo_pallet, sku_presentaciones(skus(codigo, corte, especies(nombre)), presentaciones(descripcion)))')
      .eq('packing_list_id', packingListId)
      .order('id'),
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

  /*
   * Un pallet que Calidad bloqueó DESPUÉS de subirlo al contenedor no sale.
   * Se dice cuál y por qué; la base lo vuelve a comprobar al despachar.
   * (Solo puede quedarse en el contenedor como «no entró», con 0 bultos.)
   */
  const bloqueos = await Promise.all((lineas ?? []).map(async (l) => {
    const { data } = await supabase.rpc('lote_bloqueo_texto', { p_lote_id: Number(l.lote_id) });
    return (data as string | null) ?? null;
  }));
  const filas: LineaRevision[] = (lineas ?? []).map((l, i) => {
    const lote = uno<Record<string, unknown>>(l.lotes);
    const sp = uno<Record<string, unknown>>(lote?.sku_presentaciones);
    const sku = uno<Record<string, unknown>>(sp?.skus);
    return {
      lote_id: Number(l.lote_id),
      pallet: String(lote?.codigo_pallet ?? l.lote_id),
      producto: `${uno<Record<string, unknown>>(sku?.especies)?.nombre ?? ''} ${sku?.corte ?? ''} · ${uno<Record<string, unknown>>(sp?.presentaciones)?.descripcion ?? ''}`.trim(),
      bultos: Number(l.bultos ?? 0),
      kg: Number(l.peso_neto_kg ?? 0),
      bloqueo: bloqueos[i],
    };
  });
  for (const f of filas.filter((x) => x.bloqueo)) {
    impedimentos.push(
      `El pallet ${f.pallet} está bloqueado por Calidad (${f.bloqueo}) y no puede salir. ` +
      'Quítelo del contenedor y rehaga el plano, o espere a que Calidad lo libere.'
    );
  }

  // Estos no impiden despachar, pero conviene saberlos antes y no después.
  if (!pk.contenedor) avisos.push('No tiene número de contenedor cargado.');
  if (!pk.precinto) avisos.push('No tiene número de precinto.');
  if (!pk.guia_remision) avisos.push('No tiene guía de remisión: SUNAT la exige para el traslado.');
  if (!pk.dam && dst?.pais && dst.pais !== 'Perú') {
    avisos.push('No tiene DAM cargada, y es una exportación.');
  }

  const bultos = filas.reduce((s, l) => s + l.bultos, 0);
  const kg = filas.reduce((s, l) => s + l.kg, 0);

  return {
    puede: impedimentos.length === 0,
    packing: pk.codigo as string,
    contenedor: (pk.contenedor as string) ?? null,
    embarque: (emb?.numero as string) ?? '—',
    destino: `${dst?.puerto ?? '—'}${dst?.pais ? ', ' + dst.pais : ''}`,
    almacen: (alm?.nombre as string) ?? '—',
    lotes: filas.length,
    bultos,
    tm: kg / 1000,
    impedimentos,
    avisos,
    lineas: filas,
  };
}

/* ==========================================================================
   EJECUTAR
   ========================================================================== */
export async function ejecutarDespacho(
  packingListId: number,
  ajustes: AjusteDespacho[] = []
): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión caducó. Vuelva a entrar.' };
  if (!PUEDEN_DESPACHAR.includes(usuario.rol)) {
    return { ok: false, mensaje: mensajeNoPuede(usuario.rol, 'despachar mercadería', PUEDEN_DESPACHAR) };
  }

  const revision = await revisarDespacho(packingListId);
  if (!revision) return { ok: false, mensaje: 'Ese packing list ya no existe.' };

  /* ---- Lo que salió, pallet por pallet ----
     Se valida aquí para poder decir TODO lo que está mal de una vez; la base
     lo vuelve a comprobar (es la garantía) y además lo hace todo o nada. */
  const comprobacion = validarAjustes(revision.lineas, ajustes);
  if (comprobacion.detalles.length) {
    return { ok: false, mensaje: 'Lo que salió no cuadra y no se despachó nada. Revise:', detalles: comprobacion.detalles };
  }
  const efectivos = comprobacion.efectivos;

  /*
   * Un pallet bloqueado que se declara entero como «no entró» se queda en
   * cámara: ese impedimento ya no aplica. Los demás, sí.
   */
  const seQueda = new Set(efectivos.filter((a) => a.bultos === 0 && !SALE_DEL_STOCK[a.motivo]).map((a) => a.lote_id));
  const impedimentos = revision.impedimentos.filter((t) =>
    !revision.lineas.some((l) => l.bloqueo && seQueda.has(l.lote_id) && t.startsWith(`El pallet ${l.pallet} está bloqueado`)));
  if (impedimentos.length) {
    return {
      ok: false,
      mensaje: `No se puede despachar ${revision.packing}.`,
      detalles: impedimentos,
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
    return { ok: false, mensaje: 'No se pudo reservar el número de despacho y no salió nada. Vuelva a intentarlo en un momento.' };
  }

  const numero = `DESP-${anio}-${String(correlativo).padStart(4, '0')}`;

  const { data: despachoId, error } = await supabase
    .rpc('ejecutar_despacho', {
      p_packing_list_id: packingListId,
      p_numero: numero,
      p_ajustes: efectivos.length ? efectivos : null,
    });

  if (error) {
    /*
     * La función lanza excepciones con texto en cristiano («El pallet … está
     * bloqueado por Calidad…»). Se pasa tal cual: es más útil que cualquier
     * cosa que se pudiera inventar aquí. Lo que no es de la función (una
     * restricción de la tabla, un permiso) se traduce: el usuario no tiene
     * por qué leer nombres de columnas.
     */
    const tecnico = /violates|constraint|permission denied|row-level security|syntax error|does not exist/i.test(error.message);
    return {
      ok: false,
      mensaje: tecnico
        ? 'No se pudo despachar: la base de datos rechazó la operación y no salió nada. Recargue la pantalla y vuelva a intentarlo; si se repite, avise a Sistemas.'
        : `No se pudo despachar: ${error.message} No salió nada: el despacho se hace entero o no se hace.`,
    };
  }

  refrescar();

  const salioDe = (l: LineaRevision) => efectivos.find((a) => a.lote_id === l.lote_id);
  const kgSalio = revision.lineas.reduce((t, l) => t + (salioDe(l)?.kg ?? l.kg), 0);
  const bultosSalio = revision.lineas.reduce((t, l) => t + (salioDe(l)?.bultos ?? l.bultos), 0);
  const diferencia = efectivos.length
    ? ` No salieron ${(revision.bultos - bultosSalio).toLocaleString('es-PE')} bultos ` +
      `(${((revision.tm * 1000 - kgSalio) / 1000).toFixed(3)} TM) de ${efectivos.length} ` +
      `pallet${efectivos.length === 1 ? '' : 's'}: el muestreo y la merma salieron del stock con su propio ` +
      'movimiento; lo que no entró sigue en cámara, apartado para su pedido.'
    : '';

  return {
    ok: true,
    id: Number(despachoId),
    numero,
    mensaje:
      `Despacho ${numero} ejecutado. Salieron ${bultosSalio.toLocaleString('es-PE')} bultos ` +
      `y ${(kgSalio / 1000).toFixed(2)} TM hacia ${revision.destino}. ` +
      'El stock ya está descontado del Kardex y las reservas quedaron consumidas.' + diferencia,
  };
}

/* ==========================================================================
   LA COMPROBACIÓN DE LO QUE SALIÓ
   --------------------------------------------------------------------------
   Las mismas reglas que aplica ejecutar_despacho en la base:
     · no sale más de lo cargado (ni bultos ni kilos), ni cantidades negativas;
     · si salen bultos salen kilos, y al revés;
     · con diferencia, el motivo es obligatorio; con «Otro», qué pasó;
     · lo que vuelve a cámara (no entró, otro) son sacos enteros;
     · un pallet bloqueado por Calidad solo puede quedarse en cámara.
   Un ajuste que no cambia nada se descarta: salió todo.
   ========================================================================== */
function validarAjustes(lineas: LineaRevision[], ajustes: AjusteDespacho[]) {
  const detalles: string[] = [];
  const efectivos: { lote_id: number; bultos: number; kg: number; motivo: MotivoDiferencia; detalle: string | null }[] = [];
  const vistos = new Set<number>();

  for (const a of Array.isArray(ajustes) ? ajustes : []) {
    const l = lineas.find((x) => x.lote_id === Number(a?.lote_id));
    if (!l) { detalles.push('Se indicó lo que salió de un pallet que no está en este contenedor. Recargue la pantalla.'); continue; }
    if (vistos.has(l.lote_id)) { detalles.push(`El pallet ${l.pallet} llegó dos veces.`); continue; }
    vistos.add(l.lote_id);

    const b = Number(a.bultos);
    const kg = Math.round(Number(a.kg) * 1000) / 1000;
    if (!Number.isInteger(b) || !Number.isFinite(kg)) {
      detalles.push(`${l.pallet}: los bultos van en números enteros y los kilos en números.`); continue;
    }
    if (b < 0 || kg < 0) { detalles.push(`${l.pallet}: no pueden salir cantidades negativas.`); continue; }
    if (b > l.bultos) {
      detalles.push(`${l.pallet}: se cargaron ${l.bultos} bultos y no pueden salir ${b} (no se despacha más de lo cargado).`); continue;
    }
    if (kg > l.kg + 0.001) {
      detalles.push(`${l.pallet}: se cargaron ${l.kg.toLocaleString('es-PE')} kg y no pueden salir ${kg.toLocaleString('es-PE')} kg (no se despacha más de lo cargado).`);
      continue;
    }
    if ((b === 0) !== (kg <= 0.0005)) { detalles.push(`${l.pallet}: si salen bultos tienen que salir kilos, y al revés.`); continue; }

    const faltanB = l.bultos - b;
    const faltanKg = Math.round((l.kg - kg) * 1000) / 1000;
    if (faltanB === 0 && faltanKg <= 0.0005) continue; // salió todo: no es un ajuste

    const motivo = (a.motivo || '') as MotivoDiferencia | '';
    const detalle = String(a.detalle ?? '').trim() || null;
    if (!motivo || !(motivo in SALE_DEL_STOCK)) {
      detalles.push(`${l.pallet}: salen ${b} de ${l.bultos} bultos; elija el motivo de la diferencia.`); continue;
    }
    if (motivo === 'otro' && (detalle ?? '').length < 5) {
      detalles.push(`${l.pallet}: con «Otro», escriba qué pasó (al menos 5 letras).`); continue;
    }
    if (faltanB > 0 && faltanKg <= 0.0005) {
      detalles.push(`${l.pallet}: salen ${faltanB} bultos menos pero los mismos kilos; corrija los kilos.`); continue;
    }
    if (!SALE_DEL_STOCK[motivo] && faltanB === 0) {
      detalles.push(`${l.pallet}: lo que no sale vuelve a cámara en sacos enteros; indique cuántos bultos no salieron.`); continue;
    }
    if (l.bloqueo && (b > 0 || SALE_DEL_STOCK[motivo])) {
      detalles.push(`${l.pallet} está bloqueado por Calidad (${l.bloqueo}): no puede salir.`); continue;
    }
    efectivos.push({ lote_id: l.lote_id, bultos: b, kg, motivo, detalle });
  }
  return { detalles, efectivos };
}
