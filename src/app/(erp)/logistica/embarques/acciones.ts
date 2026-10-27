'use server';

/**
 * ============================================================================
 *  EMBARQUES Y PACKING LISTS
 * ============================================================================
 *  UN EMBARQUE ES LA SALIDA PROGRAMADA. Dice qué día sale, desde qué bodega,
 *  hacia qué puerto y con qué naviera. Puede agrupar varios pedidos —eso es
 *  consolidar— y un mismo pedido puede repartirse en varios embarques —eso es
 *  despacho parcial—.
 *
 *  UN PACKING LIST ES UN CONTENEDOR CONCRETO de ese embarque. Un embarque con
 *  tres contenedores lleva tres packing lists, cada uno con su matrícula, su
 *  precinto y su plano de estiba.
 *
 *  Por eso el packing se crea DESDE el embarque y no al revés: sin saber a
 *  dónde va y desde qué bodega, un contenedor no significa nada.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { mensajeNoPuede, mensajeDeBase } from '@/lib/permisosLogistica';

export type Resultado =
  | { ok: true; id: number; numero: string; mensaje: string }
  | { ok: false; mensaje: string; campo?: string };

const PUEDEN = ['gerencia', 'operaciones', 'comex', 'almacen'];

function refrescar(id?: number) {
  revalidatePath('/logistica/embarques');
  if (id) revalidatePath(`/logistica/embarques/${id}`);
  revalidatePath('/logistica/planificador');
  revalidatePath('/logistica/packing');
  revalidatePath('/ventas/pedidos');
  revalidatePath('/panel');
}

async function autorizar(que: string, permitidos: string[] = PUEDEN) {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { error: 'Su sesión caducó. Vuelva a entrar.' };
  if (!permitidos.includes(usuario.rol)) {
    return { error: mensajeNoPuede(usuario.rol, que, permitidos) };
  }
  return { usuario };
}

/**
 * Confirmar y cancelar son decisiones de la salida (booking, cliente, flete),
 * no de la carga: las toman Gerencia, Operaciones y Comercio Exterior.
 * Almacén programa y arma contenedores, pero no confirma ni cancela.
 */
const PUEDEN_DECIDIR = ['gerencia', 'operaciones', 'comex'];

type Cliente = Awaited<ReturnType<typeof crearClienteServidor>>;
type Fallo = { ok: false; mensaje: string; campo?: string };

/* ==========================================================================
   LAS VALIDACIONES QUE COMPARTEN EL ALTA, LA EDICIÓN Y «AGREGAR PEDIDOS»
   ========================================================================== */

/** Fecha, destino y vehículo en regla: valen igual al programar que al editar. */
async function validarCabecera(
  supabase: Cliente,
  d: { fecha_programada: string; tipo_despacho: string; destino_id: number | null; vehiculo_id: number | null }
): Promise<Fallo | null> {
  if (!d.fecha_programada) {
    return { ok: false, mensaje: 'Indique qué día sale.', campo: 'fecha_programada' };
  }
  if (d.tipo_despacho === 'exportacion' && !d.destino_id) {
    return { ok: false, mensaje: 'Una exportación necesita puerto de destino.', campo: 'destino_id' };
  }

  /*
   * El vehículo tiene que estar en regla. Un camión con el SOAT vencido no
   * puede circular, y descubrirlo en la carretera cuesta el flete y el
   * contenedor. Se avisa aquí, antes de programarlo.
   */
  if (d.vehiculo_id) {
    const { data: v } = await supabase
      .from('vehiculos')
      .select('placa, soat_vence, revision_vence')
      .eq('id', d.vehiculo_id)
      .maybeSingle();

    const vencidos: string[] = [];
    if (v?.soat_vence && String(v.soat_vence) < d.fecha_programada) vencidos.push('el SOAT');
    if (v?.revision_vence && String(v.revision_vence) < d.fecha_programada) vencidos.push('la revisión técnica');

    if (vencidos.length > 0) {
      return {
        ok: false,
        mensaje:
          `Al vehículo ${v?.placa} se le vence ${vencidos.join(' y ')} antes del ${d.fecha_programada}. ` +
          'Renuévelo o asigne otro: un camión sin documentos en regla no puede salir.',
        campo: 'vehiculo_id',
      };
    }
  }
  return null;
}

/*
 * LAS CANTIDADES POR PRODUCTO (punto 13). Se revisan antes de escribir nada:
 * que cada línea sea de un pedido elegido, que la cantidad sea positiva y
 * que no pase de lo que queda por programar. La base lo vuelve a comprobar
 * con un disparador —dos personas a la vez no pueden prometer de más—; esto
 * es para poder decir el motivo con palabras.
 */
async function validarLineas(
  supabase: Cliente,
  pedidos: number[],
  lineas: { pedido_linea_id: number; cantidad_kg: number }[]
): Promise<Fallo | null> {
  if (!lineas.length) return null;
  const { data: prog } = await supabase
    .from('v_pedido_linea_programacion')
    .select('pedido_linea_id, pedido_id, por_programar_kg')
    .in('pedido_linea_id', [...new Set(lineas.map((l) => l.pedido_linea_id))]);
  const de = new Map((prog ?? []).map((x) => [Number(x.pedido_linea_id), x]));
  const porLinea = new Map<number, number>();
  for (const l of lineas) porLinea.set(l.pedido_linea_id, (porLinea.get(l.pedido_linea_id) ?? 0) + Number(l.cantidad_kg));
  for (const [lineaId, kg] of porLinea) {
    const x = de.get(lineaId);
    if (!x || !pedidos.includes(Number(x.pedido_id))) {
      return { ok: false, mensaje: 'Hay una cantidad para un producto de un pedido que no está marcado.', campo: 'lineas' };
    }
    if (kg > Number(x.por_programar_kg) + 0.5) {
      return {
        ok: false,
        mensaje: `De un producto quedan ${(Number(x.por_programar_kg) / 1000).toFixed(3)} TM por programar y se están programando ${(kg / 1000).toFixed(3)} TM.`,
        campo: 'lineas',
      };
    }
  }
  return null;
}

/** Un error de la base («raise exception») sin el prefijo técnico. */
function sinPrefijo(m: string | undefined) {
  return String(m ?? '').replace(/^.*?ERROR:\s*/, '').trim();
}

/* ==========================================================================
   CREAR UN EMBARQUE
   ========================================================================== */

export type DatosEmbarque = {
  fecha_programada: string;
  almacen_id: number;
  destino_id: number | null;
  tipo_despacho: 'exportacion' | 'mercado_nacional' | 'traslado';
  booking: string | null;
  naviera: string | null;
  transportista_id: number | null;
  vehiculo_id: number | null;
  conductor_id: number | null;
  observaciones: string | null;
  /** Los pedidos que van en este embarque. */
  pedidos: number[];
  /**
   * Observaciones de octubre, punto 13: por cada proforma, QUÉ productos y
   * CUÁNTO sale (despacho parcial), con el SKU realmente apartado. Si no
   * viene —la llamada antigua, desde el planificador— el embarque lleva los
   * pedidos enteros, como siempre.
   */
  lineas?: { pedido_linea_id: number; sku_presentacion_id: number; cantidad_kg: number }[];
};

export async function crearEmbarque(d: DatosEmbarque): Promise<Resultado> {
  const permiso = await autorizar('programar embarques');
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  if (!d.almacen_id) {
    return { ok: false, mensaje: 'Indique desde qué bodega sale.', campo: 'almacen_id' };
  }

  const supabase = await crearClienteServidor();

  //  Fecha, destino y vehículo: las mismas reglas que al editarlo.
  const malCabecera = await validarCabecera(supabase, d);
  if (malCabecera) return malCabecera;

  const lineas = (d.lineas ?? []).filter((l) => Number(l.cantidad_kg) > 0);
  if (d.lineas && d.pedidos.length > 0 && lineas.length === 0) {
    return { ok: false, mensaje: 'Indique cuánto sale de al menos un producto.', campo: 'lineas' };
  }
  const malLineas = await validarLineas(supabase, d.pedidos, lineas);
  if (malLineas) return malLineas;

  const anio = Number(d.fecha_programada.slice(0, 4));
  const { data: correlativo, error: errNum } = await supabase
    .rpc('siguiente_correlativo', { p_serie: 'EMB', p_anio: anio });
  if (errNum) return { ok: false, mensaje: mensajeDeBase(errNum, 'No se pudo reservar el número') };

  const numero = `EMB-${anio}-${String(correlativo).padStart(4, '0')}`;

  const { data: embarque, error } = await supabase
    .from('embarques')
    .insert({
      numero,
      fecha_programada: d.fecha_programada,
      almacen_id: d.almacen_id,
      destino_id: d.destino_id,
      tipo_despacho: d.tipo_despacho,
      booking: d.booking?.trim() || null,
      naviera: d.naviera?.trim() || null,
      transportista_id: d.transportista_id,
      vehiculo_id: d.vehiculo_id,
      conductor_id: d.conductor_id,
      observaciones: d.observaciones?.trim() || null,
      estado: 'planificado',
      creado_por: permiso.usuario!.id,
    })
    .select('id')
    .single();

  if (error || !embarque) return { ok: false, mensaje: mensajeDeBase(error, 'No se pudo crear el embarque') };

  if (d.pedidos?.length) {
    const { error: errPed } = await supabase
      .from('embarque_pedidos')
      .insert(d.pedidos.map((pedido_id) => ({ embarque_id: embarque.id, pedido_id })));

    if (errPed) {
      await supabase.from('embarques').delete().eq('id', embarque.id);
      return { ok: false, mensaje: mensajeDeBase(errPed, 'No se pudieron asociar los pedidos') };
    }
  }

  //  Qué productos y cuánto sale de cada uno (punto 13).
  if (lineas.length) {
    const { error: errLin } = await supabase.from('embarque_lineas').insert(
      lineas.map((l) => ({
        embarque_id: embarque.id,
        pedido_linea_id: l.pedido_linea_id,
        sku_presentacion_id: l.sku_presentacion_id,
        cantidad_kg: Math.round(Number(l.cantidad_kg) * 1000) / 1000,
        creado_por: permiso.usuario!.id,
      }))
    );
    if (errLin) {
      await supabase.from('embarque_pedidos').delete().eq('embarque_id', embarque.id);
      await supabase.from('embarques').delete().eq('id', embarque.id);
      return { ok: false, mensaje: mensajeDeBase(errLin, 'No se pudieron guardar las cantidades') };
    }
  }

  await supabase.rpc('registrar_evento', {
    p_entidad: 'embarques',
    p_entidad_id: embarque.id,
    p_tipo: 'embarque_creado',
    p_descripcion: `Embarque ${numero} programado para el ${d.fecha_programada} con ${d.pedidos?.length ?? 0} pedidos` +
      (lineas.length ? ` y ${(lineas.reduce((t, l) => t + Number(l.cantidad_kg), 0) / 1000).toFixed(3)} TM elegidas producto por producto` : ''),
    p_severidad: 'info',
  }).then(() => undefined, () => undefined);

  refrescar(embarque.id as number);
  return {
    ok: true,
    id: embarque.id as number,
    numero,
    mensaje:
      `Embarque ${numero} programado para el ${d.fecha_programada}. ` +
      'Ya aparece en el calendario. Ahora hay que crearle su contenedor.',
  };
}

/* ==========================================================================
   CREAR UN PACKING LIST DENTRO DE UN EMBARQUE
   ========================================================================== */

export type DatosPackingNuevo = {
  embarque_id: number;
  contenedor: string | null;
  precinto: string | null;
  filas_contenedor: number;
  sacos_por_fila: number;
  supervisor_id: string | null;
  turno: 'dia' | 'noche';
  fecha_carga: string | null;
};

export async function crearPacking(d: DatosPackingNuevo): Promise<Resultado> {
  const permiso = await autorizar('crear packing lists');
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  if (!d.embarque_id) return { ok: false, mensaje: 'Falta el embarque.' };
  if (!(d.filas_contenedor > 0) || !(d.sacos_por_fila > 0)) {
    return { ok: false, mensaje: 'La capacidad del contenedor tiene que ser mayor que cero.' };
  }

  const supabase = await crearClienteServidor();

  const { data: emb } = await supabase
    .from('embarques').select('numero, estado').eq('id', d.embarque_id).maybeSingle();
  if (!emb) return { ok: false, mensaje: 'Ese embarque ya no existe.' };
  if (emb.estado === 'despachado') {
    return { ok: false, mensaje: `El embarque ${emb.numero} ya se despachó: no admite contenedores nuevos.` };
  }
  if (emb.estado === 'cancelado') {
    return { ok: false, mensaje: `El embarque ${emb.numero} está cancelado: no admite contenedores.` };
  }

  /* ---- El código sigue el formato de la casa: PL POT### ---- */
  const { data: ultimo } = await supabase
    .from('packing_lists').select('codigo').like('codigo', 'PL POT%')
    .order('codigo', { ascending: false }).limit(1).maybeSingle();

  const n = Number(String(ultimo?.codigo ?? 'PL POT000').replace('PL POT', '')) || 0;
  const codigo = `PL POT${String(n + 1).padStart(3, '0')}`;

  const { data: packing, error } = await supabase
    .from('packing_lists')
    .insert({
      codigo,
      embarque_id: d.embarque_id,
      contenedor: d.contenedor?.trim() || null,
      precinto: d.precinto?.trim() || null,
      filas_contenedor: d.filas_contenedor,
      sacos_por_fila: d.sacos_por_fila,
      supervisor_id: d.supervisor_id || null,
      turno: d.turno,
      fecha_carga: d.fecha_carga || null,
      estado: 'abierto',
      creado_por: permiso.usuario!.id,
    })
    .select('id')
    .single();

  if (error || !packing) {
    if (error?.code === '23505') {
      return { ok: false, mensaje: `Ya existe un packing con el código ${codigo}. Vuelva a intentarlo.` };
    }
    return { ok: false, mensaje: mensajeDeBase(error, 'No se pudo crear el packing') };
  }

  /* ══════════════════════════════════════════════════════════════════════
     EL CONTENEDOR NACE CON LOS PALLETS QUE YA ESTABAN APARTADOS
     ══════════════════════════════════════════════════════════════════════
     Si el embarque lleva pedidos con stock apartado en esta bodega, esa
     mercadería ES la que va a subir: alguien ya decidió que es de ese
     cliente. Obligar a buscarla otra vez en una lista de sesenta pallets
     —donde además no aparecía, porque estar apartado le baja el disponible a
     cero— era hacer dos veces el mismo trabajo.

     Se precarga, y desde la ficha se puede quitar o agregar lo que haga
     falta. Precargar no es decidir por el usuario: es no pedirle que repita
     una decisión que ya tomó.
     ══════════════════════════════════════════════════════════════════════ */
  const { data: pedidosDelEmbarque } = await supabase
    .from('embarque_pedidos').select('pedido_id').eq('embarque_id', d.embarque_id);
  const idsPedidos = (pedidosDelEmbarque ?? []).map((x) => Number(x.pedido_id));

  let precargados = 0;
  let kgPrecargados = 0;
  const bloqueadosFuera: string[] = [];

  if (idsPedidos.length > 0) {
    const { data: emb2 } = await supabase
      .from('embarques').select('almacen_id').eq('id', d.embarque_id).maybeSingle();

    const { data: reservas } = await supabase
      .from('reservas')
      .select('lote_id, bultos, peso_neto_kg, pedido_linea_id, sku_reservado_id, pedido_lineas!inner(pedido_id)')
      .eq('almacen_id', Number(emb2?.almacen_id))
      .in('estado', ['activa', 'en_preparacion'])
      .in('pedido_lineas.pedido_id', idsPedidos)
      .order('lote_id');

    /*
     * SI EL EMBARQUE DICE CUÁNTO SALE DE CADA PRODUCTO (punto 13), se precarga
     * solo eso: las reservas de esas líneas y de ese SKU, hasta la cantidad
     * programada. La última reserva puede entrar a medias —es un despacho
     * parcial—, con los bultos en proporción.
     */
    const { data: programadas } = await supabase
      .from('embarque_lineas').select('pedido_linea_id, sku_presentacion_id, cantidad_kg').eq('embarque_id', d.embarque_id);
    const cupo = new Map<string, number>();
    for (const x of programadas ?? []) {
      const k = `${x.pedido_linea_id}-${x.sku_presentacion_id}`;
      cupo.set(k, (cupo.get(k) ?? 0) + Number(x.cantidad_kg));
    }

    /* Un pallet puede tener varias reservas del mismo embarque: viajan juntas
       en una sola línea de packing, que es como sube al contenedor. */
    /*
     * Cada pallet va con la línea del pedido a la que pertenece (la de más
     * kilos si el pallet está repartido entre dos). Sin ese vínculo, el
     * despacho no sabía a qué proforma correspondía cada pallet.
     */
    const porLote = new Map<number, { bultos: number; kg: number; lineas: Map<number, number> }>();
    for (const r of reservas ?? []) {
      let kg = Number(r.peso_neto_kg ?? 0);
      let bultos = Number(r.bultos ?? 0);
      if (cupo.size > 0) {
        const k = `${r.pedido_linea_id}-${r.sku_reservado_id}`;
        const queda = cupo.get(k) ?? 0;
        if (queda <= 0.0005) continue;
        if (kg > queda) { bultos = Math.max(1, Math.round(bultos * (queda / kg))); kg = queda; }
        cupo.set(k, queda - kg);
      }
      const id = Number(r.lote_id);
      const previo = porLote.get(id) ?? { bultos: 0, kg: 0, lineas: new Map<number, number>() };
      previo.bultos += bultos;
      previo.kg += kg;
      previo.lineas.set(Number(r.pedido_linea_id), (previo.lineas.get(Number(r.pedido_linea_id)) ?? 0) + kg);
      porLote.set(id, previo);
    }

    /*
     * Lo bloqueado por Calidad no se precarga (075): no podría salir. Se
     * avisa cuál, para que Calidad o el responsable decida.
     */
    for (const loteId of [...porLote.keys()]) {
      const { data: bloqueo } = await supabase.rpc('lote_bloqueo_texto', { p_lote_id: loteId });
      if (bloqueo) {
        const { data: l } = await supabase.from('lotes').select('codigo_pallet').eq('id', loteId).maybeSingle();
        bloqueadosFuera.push(`${l?.codigo_pallet ?? loteId} (${bloqueo})`);
        porLote.delete(loteId);
      }
    }

    if (porLote.size > 0) {
      const { error: errPre } = await supabase.from('packing_lineas').insert(
        [...porLote.entries()].map(([lote_id, v]) => ({
          packing_list_id: packing.id,
          lote_id,
          pedido_linea_id: [...v.lineas.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
          bultos: Math.max(1, Math.round(v.bultos)),
          peso_neto_kg: v.kg,
        }))
      );

      /*
       * Si la precarga falla, el contenedor se queda igual: existe y está
       * vacío, que es un estado válido y se puede llenar a mano. Deshacer el
       * packing por esto sería peor.
       */
      if (!errPre) {
        precargados = porLote.size;
        kgPrecargados = [...porLote.values()].reduce((t, v) => t + v.kg, 0);
      }
    }
  }

  // El embarque pasa a estar en preparación: ya se está armando su carga.
  if (emb.estado === 'planificado' || emb.estado === 'confirmado') {
    await supabase.from('embarques').update({ estado: 'en_preparacion' }).eq('id', d.embarque_id);
  }

  refrescar(d.embarque_id);
  revalidatePath(`/logistica/packing/${packing.id}`);

  return {
    ok: true,
    id: packing.id as number,
    numero: codigo,
    mensaje:
      `Contenedor ${codigo} creado para el embarque ${emb.numero}. ` +
      (precargados > 0
        ? `Ya lleva cargados ${precargados} pallet${precargados === 1 ? '' : 's'} ` +
          `—${(kgPrecargados / 1000).toFixed(2)} TM— que estaban apartados para sus pedidos. ` +
          'Revíselos y arme el plano de estiba.'
        : 'Ahora hay que cargarle los pallets y armar su plano de estiba.') +
      (bloqueadosFuera.length
        ? ` No se cargó lo bloqueado por Calidad: ${bloqueadosFuera.join(', ')}.`
        : ''),
  };
}

/* ==========================================================================
   OBSERVACIONES DEL EMBARQUE (observaciones de octubre, punto 12)
   --------------------------------------------------------------------------
   Se podían escribir al programar, pero después no se podían cambiar: lo
   que pasaba en la coordinación —«el booking se movió al jueves»— no tenía
   dónde quedar. Ahora se editan desde la ficha y el historial guarda cada
   versión (la tabla está auditada).
   ========================================================================== */
export async function guardarObservacionesEmbarque(id: number, texto: string): Promise<Resultado> {
  const permiso = await autorizar('editar embarques');
  if (permiso.error) return { ok: false, mensaje: permiso.error };
  const limpio = texto.trim();
  if (limpio.length > 1000) return { ok: false, mensaje: 'Las observaciones no pueden pasar de 1000 caracteres.' };

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase
    .from('embarques').update({ observaciones: limpio || null }).eq('id', id).select('numero');
  if (error) return { ok: false, mensaje: mensajeDeBase(error, 'No se pudo guardar') };
  //  Sin filas y sin error es una política que dijo que no.
  if (!data?.length) return { ok: false, mensaje: 'No tiene permiso para modificar este embarque.' };

  refrescar(id);
  return { ok: true, id, numero: String(data[0].numero), mensaje: limpio ? 'Observaciones guardadas.' : 'Observaciones borradas.' };
}

/* ==========================================================================
   EL CICLO DEL EMBARQUE DESPUÉS DE PROGRAMARLO
   --------------------------------------------------------------------------
   La guía de uso tuvo que avisar que un embarque, una vez programado, no se
   podía confirmar, cancelar ni editar, ni se le podían agregar pedidos: todo
   lo que pasaba después —«la naviera confirmó el booking», «el cliente pidió
   moverlo al jueves», «se cayó la venta»— no tenía dónde quedar. Ahora se
   hace desde la ficha, con los mismos controles que el alta y con su evento
   en el historial.

     planificado ──Confirmar──▶ confirmado ──(primer contenedor)──▶ en preparación
          │                         │                                   │
          └──────── Cancelar ───────┴────── (sin ningún despacho) ──────┘
   ========================================================================== */

/**
 * CONFIRMAR: la salida está asegurada (planificado → confirmado).
 *
 * En una exportación se exige el BOOKING: es la reserva de espacio en el buque
 * que da la naviera, y sin ella el contenedor no tiene dónde embarcar. Dar por
 * confirmada una salida sin booking es exactamente la confusión que el estado
 * existe para evitar. En mercado nacional y traslados no hay buque y no se pide.
 */
export async function confirmarEmbarque(id: number): Promise<Resultado> {
  const permiso = await autorizar('confirmar embarques', PUEDEN_DECIDIR);
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const supabase = await crearClienteServidor();
  const { data: e } = await supabase
    .from('embarques')
    .select('numero, estado, tipo_despacho, booking, fecha_programada, destino_id, vehiculo_id')
    .eq('id', id).maybeSingle();
  if (!e) return { ok: false, mensaje: 'Ese embarque ya no existe.' };
  if (e.estado !== 'planificado') {
    return {
      ok: false,
      mensaje: e.estado === 'confirmado'
        ? `El embarque ${e.numero} ya estaba confirmado.`
        : `El embarque ${e.numero} está ${String(e.estado).replace('_', ' ')}: solo se confirma uno planificado.`,
    };
  }

  const { count } = await supabase
    .from('embarque_pedidos').select('pedido_id', { count: 'exact', head: true }).eq('embarque_id', id);
  if (!count) {
    return { ok: false, mensaje: `El embarque ${e.numero} no lleva ningún pedido: agréguele al menos uno antes de confirmarlo.` };
  }
  if (e.tipo_despacho === 'exportacion' && !String(e.booking ?? '').trim()) {
    return {
      ok: false,
      mensaje:
        'Para confirmar una exportación hace falta el booking de la naviera: es la reserva de espacio ' +
        'en el buque, y sin ella el contenedor no tiene dónde embarcar. Anótelo con «Editar embarque» y vuelva a confirmar.',
      campo: 'booking',
    };
  }
  const mal = await validarCabecera(supabase, {
    fecha_programada: String(e.fecha_programada), tipo_despacho: String(e.tipo_despacho),
    destino_id: e.destino_id as number | null, vehiculo_id: e.vehiculo_id as number | null,
  });
  if (mal) return mal;

  //  «Solo si sigue planificado»: dos personas a la vez no lo confirman dos veces.
  const { data, error } = await supabase
    .from('embarques').update({ estado: 'confirmado' }).eq('id', id).eq('estado', 'planificado').select('id');
  if (error) return { ok: false, mensaje: mensajeDeBase(error, 'No se pudo confirmar') };
  if (!data?.length) return { ok: false, mensaje: 'No se pudo confirmar: el embarque cambió mientras tanto o no tiene permiso. Recargue la página.' };

  await supabase.rpc('registrar_evento', {
    p_entidad: 'embarques', p_entidad_id: id, p_tipo: 'embarque_confirmado',
    p_descripcion: `Embarque ${e.numero} confirmado` + (e.booking ? ` con el booking ${e.booking}` : ''),
    p_severidad: 'info',
  }).then(() => undefined, () => undefined);

  refrescar(id);
  return {
    ok: true, id, numero: String(e.numero),
    mensaje: `Embarque ${e.numero} confirmado. El siguiente paso es crearle su contenedor.`,
  };
}

/**
 * CANCELAR: con motivo, y solo si no salió ningún contenedor. La base hace
 * todo de una vez (embarque_cancelar, migración 068): anula y vacía los
 * contenedores abiertos, deja los pedidos libres para programarse de nuevo y
 * NO suelta las reservas —son del pedido, no del embarque—.
 */
export async function cancelarEmbarque(id: number, motivo: string): Promise<Resultado> {
  const permiso = await autorizar('cancelar embarques', PUEDEN_DECIDIR);
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const limpio = (motivo ?? '').trim();
  if (limpio.length < 5) {
    return { ok: false, mensaje: 'Escriba por qué se cancela (al menos 5 caracteres): sin motivo nadie sabrá después qué pasó.', campo: 'motivo' };
  }
  if (limpio.length > 300) return { ok: false, mensaje: 'El motivo no puede pasar de 300 caracteres.', campo: 'motivo' };

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc('embarque_cancelar', { p_embarque_id: id, p_motivo: limpio });
  if (error) return { ok: false, mensaje: sinPrefijo(error.message) };

  const r = (data ?? {}) as { numero?: string; packings_anulados?: number; pallets_bajados?: number; pedidos?: number };
  refrescar(id);
  return {
    ok: true, id, numero: String(r.numero ?? ''),
    mensaje:
      `Embarque ${r.numero} cancelado. ` +
      (r.packings_anulados
        ? `Se anularon ${r.packings_anulados} contenedor${r.packings_anulados === 1 ? '' : 'es'} y se bajaron ${r.pallets_bajados} pallet${r.pallets_bajados === 1 ? '' : 's'}. `
        : '') +
      `Sus ${r.pedidos ?? 0} pedido${r.pedidos === 1 ? '' : 's'} quedan libres para programarse en otro embarque, con su mercadería todavía apartada.`,
  };
}

/** Lo que se puede cambiar de un embarque ya programado. */
export type DatosEdicionEmbarque = {
  fecha_programada: string;
  destino_id: number | null;
  booking: string | null;
  naviera: string | null;
  transportista_id: number | null;
  vehiculo_id: number | null;
  conductor_id: number | null;
  observaciones: string | null;
};

/**
 * EDITAR: fecha, destino, booking, naviera, transporte y observaciones. No la
 * bodega ni el tipo: los contenedores ya se arman en esa bodega y para ese
 * tipo, y cambiarlos sería otro embarque. No si ya salió o se canceló.
 */
export async function editarEmbarque(id: number, d: DatosEdicionEmbarque): Promise<Resultado> {
  const permiso = await autorizar('editar embarques');
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const supabase = await crearClienteServidor();
  const { data: e } = await supabase
    .from('embarques')
    .select('numero, estado, tipo_despacho, fecha_programada, destino_id, booking, naviera, transportista_id, vehiculo_id, conductor_id, observaciones')
    .eq('id', id).maybeSingle();
  if (!e) return { ok: false, mensaje: 'Ese embarque ya no existe.' };
  if (e.estado === 'despachado') return { ok: false, mensaje: `El embarque ${e.numero} ya se despachó: sus datos quedan como salieron.` };
  if (e.estado === 'cancelado') return { ok: false, mensaje: `El embarque ${e.numero} está cancelado: ya no se edita.` };

  const texto = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);
  const nuevo = {
    fecha_programada: d.fecha_programada,
    destino_id: d.destino_id || null,
    booking: texto(d.booking),
    naviera: texto(d.naviera),
    transportista_id: d.transportista_id || null,
    vehiculo_id: d.vehiculo_id || null,
    conductor_id: d.conductor_id || null,
    observaciones: texto(d.observaciones),
  };

  const mal = await validarCabecera(supabase, { ...nuevo, tipo_despacho: String(e.tipo_despacho) });
  if (mal) return mal;
  if ((nuevo.booking ?? '').length > 40) return { ok: false, mensaje: 'El booking no puede pasar de 40 caracteres.', campo: 'booking' };
  if ((nuevo.naviera ?? '').length > 60) return { ok: false, mensaje: 'La naviera no puede pasar de 60 caracteres.', campo: 'naviera' };
  if ((nuevo.observaciones ?? '').length > 1000) return { ok: false, mensaje: 'Las observaciones no pueden pasar de 1000 caracteres.', campo: 'observaciones' };
  //  Lo que exigió confirmar no se puede quitar después.
  if (e.estado !== 'planificado' && e.tipo_despacho === 'exportacion' && e.booking && !nuevo.booking) {
    return { ok: false, mensaje: 'Esta exportación ya está confirmada con su booking: puede cambiarlo, pero no dejarlo vacío.', campo: 'booking' };
  }

  //  Qué cambió, en palabras, para el historial.
  const cambios: string[] = [];
  const antes = e as Record<string, unknown>;
  const etiquetas: Record<keyof typeof nuevo, string> = {
    fecha_programada: 'fecha', destino_id: 'destino', booking: 'booking', naviera: 'naviera',
    transportista_id: 'transportista', vehiculo_id: 'vehículo', conductor_id: 'conductor', observaciones: 'observaciones',
  };
  for (const k of Object.keys(nuevo) as (keyof typeof nuevo)[]) {
    const a = antes[k] == null ? null : String(antes[k]);
    const b = nuevo[k] == null ? null : String(nuevo[k]);
    if (a === b) continue;
    cambios.push(['fecha_programada', 'booking', 'naviera'].includes(k)
      ? `${etiquetas[k]}: ${a ?? '—'} → ${b ?? '—'}`
      : etiquetas[k]);
  }
  if (!cambios.length) return { ok: true, id, numero: String(e.numero), mensaje: 'No había nada que cambiar.' };

  const { data, error } = await supabase.from('embarques').update(nuevo).eq('id', id).select('id');
  if (error) return { ok: false, mensaje: mensajeDeBase(error, 'No se pudo guardar') };
  if (!data?.length) return { ok: false, mensaje: 'No tiene permiso para modificar este embarque.' };

  await supabase.rpc('registrar_evento', {
    p_entidad: 'embarques', p_entidad_id: id, p_tipo: 'embarque_editado',
    p_descripcion: `Embarque ${e.numero} editado. Cambió: ${cambios.join('; ')}.`,
    p_severidad: 'info',
  }).then(() => undefined, () => undefined);

  refrescar(id);
  return { ok: true, id, numero: String(e.numero), mensaje: `Cambios guardados: ${cambios.join('; ')}.` };
}

/**
 * AGREGAR PEDIDOS a un embarque ya programado, con «Sale ahora» por producto
 * como en el alta (las mismas validaciones: ni más que el saldo ni de un
 * pedido que no se marcó). Si el embarque ya tiene contenedor, lo nuevo no
 * sube solo: se carga desde el packing con «Agregar pallet».
 */
export async function agregarPedidosAEmbarque(
  id: number,
  pedidos: number[],
  lineasIn: { pedido_linea_id: number; sku_presentacion_id: number; cantidad_kg: number }[]
): Promise<Resultado> {
  const permiso = await autorizar('cambiar los pedidos de un embarque');
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const supabase = await crearClienteServidor();
  const { data: e } = await supabase.from('embarques').select('numero, estado, almacen_id').eq('id', id).maybeSingle();
  if (!e) return { ok: false, mensaje: 'Ese embarque ya no existe.' };
  if (e.estado === 'despachado' || e.estado === 'cancelado') {
    return { ok: false, mensaje: `El embarque ${e.numero} está ${e.estado}: ya no se le agregan pedidos.` };
  }
  const ids = [...new Set((pedidos ?? []).map(Number))].filter(Boolean);
  if (!ids.length) return { ok: false, mensaje: 'Marque al menos un pedido para agregar.', campo: 'pedidos' };

  const { data: yaEstan } = await supabase
    .from('embarque_pedidos').select('pedido_id, pedidos(numero_proforma)').eq('embarque_id', id).in('pedido_id', ids);
  if ((yaEstan ?? []).length) {
    const pf = (yaEstan ?? []).map((x) => (Array.isArray(x.pedidos) ? x.pedidos[0] : x.pedidos)?.numero_proforma).join(', ');
    return { ok: false, mensaje: `${pf} ya está en este embarque.`, campo: 'pedidos' };
  }

  //  Tiene que haber algo apartado en ESTA bodega: si no, no hay qué cargar aquí.
  const { data: apartado } = await supabase
    .from('reservas').select('pedido_lineas!inner(pedido_id)')
    .eq('almacen_id', Number(e.almacen_id)).in('estado', ['activa', 'en_preparacion'])
    .in('pedido_lineas.pedido_id', ids);
  const conStock = new Set((apartado ?? []).map((r) => Number((Array.isArray(r.pedido_lineas) ? r.pedido_lineas[0] : r.pedido_lineas)?.pedido_id)));
  const sinStock = ids.filter((p) => !conStock.has(p));
  if (sinStock.length) {
    return { ok: false, mensaje: 'Algún pedido marcado no tiene stock apartado en la bodega de este embarque: no habría qué cargar desde aquí.', campo: 'pedidos' };
  }

  const lineas = (lineasIn ?? []).filter((l) => Number(l.cantidad_kg) > 0);
  if (!lineas.length) return { ok: false, mensaje: 'Indique cuánto sale de al menos un producto.', campo: 'lineas' };
  const mal = await validarLineas(supabase, ids, lineas);
  if (mal) return mal;
  //  Cada pedido marcado tiene que llevar algo: si no, quedaría dentro sin carga.
  const { data: lineasPed } = await supabase.from('pedido_lineas').select('id, pedido_id').in('pedido_id', ids);
  const pedidoDe = new Map((lineasPed ?? []).map((l) => [Number(l.id), Number(l.pedido_id)]));
  const conCarga = new Set(lineas.map((l) => pedidoDe.get(l.pedido_linea_id)));
  if (ids.some((p) => !conCarga.has(p))) {
    return { ok: false, mensaje: 'De cada pedido marcado tiene que salir algo: póngale cantidad o desmárquelo.', campo: 'lineas' };
  }

  const { error: errPed } = await supabase
    .from('embarque_pedidos').insert(ids.map((pedido_id) => ({ embarque_id: id, pedido_id })));
  if (errPed) return { ok: false, mensaje: mensajeDeBase(errPed, 'No se pudieron agregar los pedidos') };

  const { error: errLin } = await supabase.from('embarque_lineas').insert(
    lineas.map((l) => ({
      embarque_id: id,
      pedido_linea_id: l.pedido_linea_id,
      sku_presentacion_id: l.sku_presentacion_id,
      cantidad_kg: Math.round(Number(l.cantidad_kg) * 1000) / 1000,
      creado_por: permiso.usuario!.id,
    }))
  );
  if (errLin) {
    await supabase.from('embarque_pedidos').delete().eq('embarque_id', id).in('pedido_id', ids);
    return { ok: false, mensaje: `No se pudieron guardar las cantidades: ${sinPrefijo(errLin.message)}` };
  }

  const { data: pfs } = await supabase.from('pedidos').select('numero_proforma').in('id', ids);
  const nombres = (pfs ?? []).map((p) => p.numero_proforma).join(', ');
  const tmTotal = lineas.reduce((t, l) => t + Number(l.cantidad_kg), 0) / 1000;
  await supabase.rpc('registrar_evento', {
    p_entidad: 'embarques', p_entidad_id: id, p_tipo: 'embarque_pedido_agregado',
    p_descripcion: `Se agregó ${nombres} al embarque ${e.numero}: ${tmTotal.toFixed(3)} TM elegidas producto por producto.`,
    p_severidad: 'info',
  }).then(() => undefined, () => undefined);

  const { count: abiertos } = await supabase.from('packing_lists').select('id', { count: 'exact', head: true })
    .eq('embarque_id', id).in('estado', ['abierto', 'en_carga']);

  refrescar(id);
  return {
    ok: true, id, numero: String(e.numero),
    mensaje: `Se agregó ${nombres} (${tmTotal.toFixed(3)} TM) al embarque ${e.numero}.` +
      (abiertos ? ' Su mercadería no sube sola al contenedor que ya existe: cárguela desde el packing con «Agregar pallet».' : ''),
  };
}

/**
 * QUITAR UN PEDIDO del embarque: solo si ninguno de sus pallets está ya en un
 * contenedor (lo controla la base, embarque_quitar_pedido). Sus kilos vuelven
 * a quedar por programar; las reservas no se tocan.
 */
export async function quitarPedidoDeEmbarque(id: number, pedidoId: number): Promise<Resultado> {
  const permiso = await autorizar('cambiar los pedidos de un embarque');
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc('embarque_quitar_pedido', { p_embarque_id: id, p_pedido_id: pedidoId });
  if (error) return { ok: false, mensaje: sinPrefijo(error.message) };
  const r = (data ?? {}) as { numero?: string; proforma?: string };

  refrescar(id);
  revalidatePath(`/ventas/pedidos/${pedidoId}`);
  return {
    ok: true, id, numero: String(r.numero ?? ''),
    mensaje: `${r.proforma} quitada del embarque ${r.numero}. Vuelve a quedar por programar, con su mercadería todavía apartada.`,
  };
}

/**
 * Los pedidos que se pueden AGREGAR a un embarque: los mismos que ofrece el
 * alta (stock apartado y saldo por programar), pero solo los que tienen algo
 * apartado en la bodega de este embarque y no están ya dentro.
 */
export async function pedidosParaAgregar(embarqueId: number): Promise<PedidoEmbarcable[]> {
  const supabase = await crearClienteServidor();
  const [{ data: e }, { data: dentro }] = await Promise.all([
    supabase.from('embarques').select('almacen_id').eq('id', embarqueId).maybeSingle(),
    supabase.from('embarque_pedidos').select('pedido_id').eq('embarque_id', embarqueId),
  ]);
  if (!e) return [];
  const almacen = Number(e.almacen_id);
  const yaDentro = new Set((dentro ?? []).map((x) => Number(x.pedido_id)));
  const todos = await pedidosParaEmbarcar(almacen);
  return todos.filter((p) => !yaDentro.has(p.id) && p.bodegas.some((b) => b.almacen_id === almacen && b.kg > 0));
}

/* ==========================================================================
   AYUDAS PARA EL FORMULARIO
   ========================================================================== */

/** Los pedidos que se pueden meter en un embarque desde esa bodega. */
export type PedidoEmbarcable = {
  id: number;
  numero: string;
  cliente: string;
  destino: string;
  tm_pedidas: number;
  tm_reservadas: number;
  fecha_comprometida: string | null;
  /**
   * En qué bodegas está el stock que se le apartó, con sus kilos.
   *
   * Es lo que evita el error más caro de esta pantalla: un embarque sale de
   * UNA bodega, y si el pedido tiene la mercadería repartida entre dos, solo
   * se podrá cargar la parte que esté en la bodega elegida. El resto necesita
   * un traslado antes, y eso se decide ahora, no el día de la carga.
   */
  bodegas: { almacen_id: number; nombre: string; kg: number }[];
};

/**
 * Lo que se puede programar de cada línea de un pedido (punto 13): lo pedido,
 * lo ya programado en otros embarques, el saldo, y lo apartado POR SKU —el
 * SKU realmente reservado, que puede ser un equivalente (punto 10)—, con la
 * bodega donde está.
 */
export type LineaEmbarcable = {
  pedido_id: number;
  pedido_linea_id: number;
  producto: string;
  sku_presentacion_id: number;
  sku: string;
  equivalente: boolean;
  pedido_kg: number;
  programado_kg: number;
  por_programar_kg: number;
  reservado_kg: number;
  bodegas: { almacen_id: number; kg: number }[];
};

export async function lineasParaEmbarcar(pedidoIds: number[]): Promise<LineaEmbarcable[]> {
  if (!pedidoIds.length) return [];
  const supabase = await crearClienteServidor();
  const [{ data: lineas }, { data: prog }, { data: reservas }] = await Promise.all([
    supabase.from('pedido_lineas')
      .select('id, pedido_id, orden, sku_presentacion_id, sku_presentaciones(skus(codigo, corte, especies(nombre)), presentaciones(descripcion))')
      .in('pedido_id', pedidoIds).order('orden'),
    supabase.from('v_pedido_linea_programacion')
      .select('pedido_linea_id, pedido_kg, programado_kg, por_programar_kg').in('pedido_id', pedidoIds),
    supabase.from('reservas')
      .select('pedido_linea_id, almacen_id, peso_neto_kg, sku_reservado_id, reservado:sku_presentaciones!reservas_sku_reservado_id_fkey(skus(codigo), presentaciones(descripcion)), pedido_lineas!inner(pedido_id)')
      .in('estado', ['activa', 'en_preparacion'])
      .in('pedido_lineas.pedido_id', pedidoIds),
  ]);
  const progDe = new Map((prog ?? []).map((x) => [Number(x.pedido_linea_id), x]));
  const uno1 = <T,>(v: unknown) => (Array.isArray(v) ? v[0] : v) as T | undefined;

  const filas: LineaEmbarcable[] = [];
  for (const l of lineas ?? []) {
    const sp = uno1<Record<string, unknown>>(l.sku_presentaciones);
    const sku = uno1<Record<string, unknown>>(sp?.skus);
    const pres = uno1<Record<string, unknown>>(sp?.presentaciones);
    const producto = `${sku?.codigo ?? ''} · ${uno1<Record<string, unknown>>(sku?.especies)?.nombre ?? ''} ${sku?.corte ?? ''} · ${pres?.descripcion ?? ''}`;
    const p = progDe.get(Number(l.id));
    const base = {
      pedido_id: Number(l.pedido_id), pedido_linea_id: Number(l.id), producto,
      pedido_kg: Number(p?.pedido_kg ?? 0), programado_kg: Number(p?.programado_kg ?? 0),
      por_programar_kg: Number(p?.por_programar_kg ?? 0),
    };
    //  Lo apartado de esta línea, agrupado por el SKU que de verdad se apartó.
    const porSku = new Map<number, { texto: string; kg: number; bodegas: Map<number, number> }>();
    for (const r of (reservas ?? []).filter((x) => Number(x.pedido_linea_id) === Number(l.id))) {
      const id = Number(r.sku_reservado_id ?? l.sku_presentacion_id);
      const rsp = uno1<Record<string, unknown>>(r.reservado);
      const g = porSku.get(id) ?? {
        texto: `${uno1<Record<string, unknown>>(rsp?.skus)?.codigo ?? ''} · ${uno1<Record<string, unknown>>(rsp?.presentaciones)?.descripcion ?? ''}`,
        kg: 0, bodegas: new Map<number, number>(),
      };
      g.kg += Number(r.peso_neto_kg ?? 0);
      g.bodegas.set(Number(r.almacen_id), (g.bodegas.get(Number(r.almacen_id)) ?? 0) + Number(r.peso_neto_kg ?? 0));
      porSku.set(id, g);
    }
    if (porSku.size === 0) {
      //  Sin nada apartado: se muestra igual, para que se vea el saldo, pero sin cantidad propuesta.
      filas.push({ ...base, sku_presentacion_id: Number(l.sku_presentacion_id), sku: `${sku?.codigo ?? ''} · ${pres?.descripcion ?? ''}`,
        equivalente: false, reservado_kg: 0, bodegas: [] });
    }
    for (const [id, g] of porSku) {
      filas.push({
        ...base, sku_presentacion_id: id, sku: g.texto, equivalente: id !== Number(l.sku_presentacion_id),
        reservado_kg: g.kg, bodegas: [...g.bodegas.entries()].map(([almacen_id, kg]) => ({ almacen_id, kg })),
      });
    }
  }
  return filas;
}

export async function pedidosParaEmbarcar(almacenId: number): Promise<PedidoEmbarcable[]> {
  const supabase = await crearClienteServidor();

  /*
   * El filtro va EN LA CONSULTA, no después de traer las filas.
   *
   * Antes se pedían los 120 pedidos con la fecha comprometida más próxima y
   * recién ahí se descartaban los que no tenían reserva. Con 436 pedidos en
   * el sistema, uno creado hoy quedaba fuera de esos 120 y no aparecía nunca
   * en esta lista, por mucho que estuviera cubierto al 50 %. El corte se
   * comía justo lo que se acababa de apartar.
   */
  const { data } = await supabase
    .from('v_pedidos_tablero')
    .select('id, numero_proforma, cliente, destino, tm_pedidas, tm_reservadas, fecha_comprometida')
    .gt('tm_reservadas', 0)
    .order('fecha_comprometida', { ascending: true })
    .limit(300);

  const conReserva = data ?? [];

  /*
   * Los que ya están en algún embarque, ¿se vuelven a ofrecer? Desde el punto
   * 13, depende:
   *   · si ese embarque dijo cuánto lleva de cada producto, el pedido vuelve
   *     a salir mientras le quede saldo por programar (despacho parcial);
   *   · si es un embarque de antes, que llevaba el pedido entero, no.
   */
  const { data: yaPuestos } = await supabase
    .from('embarque_pedidos').select('pedido_id, embarque_id, embarques!inner(estado)').neq('embarques.estado', 'cancelado');
  const { data: conDetalle } = await supabase.from('embarque_lineas').select('embarque_id, pedido_lineas(pedido_id)');
  const detallados = new Set((conDetalle ?? []).map((x) => {
    const pl = Array.isArray(x.pedido_lineas) ? x.pedido_lineas[0] : x.pedido_lineas;
    return `${x.embarque_id}-${pl?.pedido_id}`;
  }));
  const puestos = new Set((yaPuestos ?? [])
    .filter((x) => !detallados.has(`${x.embarque_id}-${x.pedido_id}`))
    .map((x) => Number(x.pedido_id)));

  const almacenNum = Number(almacenId);
  void almacenNum; // La bodega ya filtra los lotes; aquí solo se listan pedidos.

  const candidatosTodos = conReserva.filter((p) => !puestos.has(Number(p.id)));
  //  Y de esos, solo los que todavía tienen algo por programar.
  const { data: saldos } = candidatosTodos.length
    ? await supabase.from('v_pedido_linea_programacion').select('pedido_id, por_programar_kg')
        .in('pedido_id', candidatosTodos.map((p) => Number(p.id))).gt('por_programar_kg', 0.5)
    : { data: [] };
  const conSaldo = new Set((saldos ?? []).map((x) => Number(x.pedido_id)));
  const candidatos = candidatosTodos.filter((p) => conSaldo.has(Number(p.id)));
  const ids = candidatos.map((p) => Number(p.id));

  /* ---- Dónde está físicamente lo que se apartó a cada pedido ---- */
  const { data: reservas } = ids.length
    ? await supabase
        .from('reservas')
        .select('peso_neto_kg, almacen_id, almacenes(nombre), pedido_lineas!inner(pedido_id)')
        .in('estado', ['activa', 'en_preparacion'])
        .in('pedido_lineas.pedido_id', ids)
    : { data: [] };

  const porPedido = new Map<number, Map<number, { nombre: string; kg: number }>>();
  for (const r of reservas ?? []) {
    const pl = Array.isArray(r.pedido_lineas) ? r.pedido_lineas[0] : r.pedido_lineas;
    const alm = Array.isArray(r.almacenes) ? r.almacenes[0] : r.almacenes;
    const pedidoId = Number(pl?.pedido_id);
    const almacen = Number(r.almacen_id);
    if (!porPedido.has(pedidoId)) porPedido.set(pedidoId, new Map());
    const mapa = porPedido.get(pedidoId)!;
    const previo = mapa.get(almacen) ?? { nombre: String(alm?.nombre ?? '—'), kg: 0 };
    previo.kg += Number(r.peso_neto_kg ?? 0);
    mapa.set(almacen, previo);
  }

  return candidatos
    .map((p) => ({
      id: p.id as number,
      numero: p.numero_proforma as string,
      cliente: (p.cliente as string) ?? '—',
      destino: (p.destino as string) ?? '—',
      tm_pedidas: Number(p.tm_pedidas ?? 0),
      tm_reservadas: Number(p.tm_reservadas ?? 0),
      fecha_comprometida: (p.fecha_comprometida as string) ?? null,
      bodegas: [...(porPedido.get(Number(p.id)) ?? new Map()).entries()]
        .map(([almacen_id, v]) => ({ almacen_id, nombre: v.nombre, kg: v.kg }))
        .sort((a, b) => b.kg - a.kg),
    }))
    .sort((a, b) => (b.tm_reservadas / (b.tm_pedidas || 1)) - (a.tm_reservadas / (a.tm_pedidas || 1)));
}
