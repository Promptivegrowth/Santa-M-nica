'use server';

/**
 * ============================================================================
 *  ACCIONES SOBRE RESERVAS
 * ============================================================================
 *  Aquí vive la operación que resuelve el problema que planteó el cliente:
 *  soltar un apartado que ya no corresponde, para que ese producto vuelva a
 *  estar disponible para vender.
 *
 *  Dos decisiones deliberadas:
 *
 *  1. LIBERAR EXIGE MOTIVO. No es burocracia: hoy nadie sabe por qué el stock
 *     figuraba apartado, y sin motivo el mismo problema se repite el mes que
 *     viene. La base de datos rechaza motivos de menos de 5 caracteres, así
 *     que la validación de aquí solo adelanta el aviso.
 *
 *  2. LIBERAR NO BORRA. La reserva pasa a estado «liberada» y conserva quién,
 *     cuándo y por qué. El Kardex y el historial quedan íntegros.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';

export type Resultado = { ok: true; mensaje: string } | { ok: false; mensaje: string };

/** Roles que pueden soltar stock apartado. */
const PUEDEN_LIBERAR = ['gerencia', 'operaciones', 'comercial', 'almacen'];

export async function liberarReserva(reservaId: number, motivo: string): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró. Vuelva a entrar.' };

  if (!PUEDEN_LIBERAR.includes(usuario.rol)) {
    return { ok: false, mensaje: 'Su rol no puede liberar reservas.' };
  }

  const limpio = motivo.trim();
  if (limpio.length < 5) {
    return {
      ok: false,
      mensaje: 'Explique por qué se libera, con al menos 5 caracteres. Ese texto queda en el historial del lote.',
    };
  }
  if (limpio.length > 300) {
    return { ok: false, mensaje: 'El motivo no puede superar los 300 caracteres.' };
  }

  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('reserva_liberar', {
    p_reserva_id: reservaId,
    p_motivo: limpio,
  });

  if (error) return { ok: false, mensaje: `No se pudo liberar: ${error.message}` };

  // Todo lo que cambia de número al soltar stock.
  revalidatePath('/almacenes/reservas');
  revalidatePath('/almacenes/existencias');
  revalidatePath('/ventas/disponibilidad');
  revalidatePath('/panel');

  return { ok: true, mensaje: 'Reserva liberada. El stock ya figura como disponible.' };
}

/**
 * Ejecuta la expiración automática de reservas vencidas.
 *
 * En producción esto lo dispara una tarea programada, pero se expone también
 * como botón: en la reunión quedó claro que hacía falta poder «limpiar ahora»
 * sin esperar al proceso nocturno.
 */
export async function expirarReservasVencidas(): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró. Vuelva a entrar.' };
  if (!['gerencia', 'operaciones'].includes(usuario.rol)) {
    return { ok: false, mensaje: 'Solo gerencia u operaciones pueden ejecutar la expiración masiva.' };
  }

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc('reservas_expirar_vencidas');

  if (error) return { ok: false, mensaje: `No se pudo ejecutar: ${error.message}` };

  revalidatePath('/almacenes/reservas');
  revalidatePath('/almacenes/existencias');
  revalidatePath('/ventas/disponibilidad');
  revalidatePath('/panel');

  const n = Number(data ?? 0);
  return {
    ok: true,
    mensaje:
      n === 0
        ? 'No había ninguna reserva vencida: todo está al día.'
        : `Se liberaron ${n} reservas vencidas. Ese stock vuelve a estar disponible.`,
  };
}

/* ==========================================================================
   CREAR UNA RESERVA
   --------------------------------------------------------------------------
   Reservar es apartar kilos de UN LOTE CONCRETO en UNA BODEGA CONCRETA para
   UNA LÍNEA de un pedido. No se aparta «pota en general»: se aparta el pallet
   SM 26 02 0168 de Freeko, porque llegado el despacho hay que ir a buscarlo.

   POR QUÉ NO SE RESERVA SOLO AL CONVERTIR LA COTIZACIÓN
   Porque el sistema no puede decidir por almacén QUÉ pallet conviene sacar.
   Esa elección tiene criterio: lo más antiguo primero para que no se venza, o
   el que está en la bodega desde la que sale el contenedor para no pagar un
   traslado. Reservar automáticamente el primer lote que apareciera daría un
   resultado peor que dejarlo elegir, y encima invisible.

   Lo que sí hace el sistema es no dejar equivocarse: comprueba el disponible
   real, el estado de calidad, que el lote sea del producto correcto y que no
   se pase de lo que el cliente pidió.
   ========================================================================== */

export type ResultadoReserva =
  | { ok: true; id: number; mensaje: string }
  | { ok: false; mensaje: string };

/** Roles que pueden apartar stock. */
const PUEDEN_RESERVAR = ['gerencia', 'operaciones', 'comercial', 'almacen'];

export type DatosReserva = {
  pedido_linea_id: number;
  lote_id: number;
  almacen_id: number;
  bultos: number;
  peso_neto_kg: number;
  /** Días hasta el vencimiento. Si no viene, se usa el parámetro configurado. */
  dias?: number;
  observaciones?: string | null;
};

/** Cifra con separador de miles, para los mensajes. */
function kg(n: number): string {
  return n.toLocaleString('es-PE', { maximumFractionDigits: 1 }) + ' kg';
}

/** Refresca todo lo que cambia al apartar o soltar stock. */
function refrescarReservas(pedidoId?: number) {
  revalidatePath('/almacenes/reservas');
  revalidatePath('/ventas/disponibilidad');
  revalidatePath('/almacenes/existencias');
  revalidatePath('/ventas/pedidos');
  revalidatePath('/ventas/control');
  if (pedidoId) revalidatePath('/ventas/pedidos/' + pedidoId);
}

export async function crearReserva(d: DatosReserva): Promise<ResultadoReserva> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró. Vuelva a entrar.' };
  if (!PUEDEN_RESERVAR.includes(usuario.rol)) {
    return { ok: false, mensaje: `Su rol (${usuario.rol}) no puede apartar stock.` };
  }

  if (!d.pedido_linea_id) return { ok: false, mensaje: 'Falta indicar para qué línea del pedido es.' };
  if (!d.lote_id || !d.almacen_id) return { ok: false, mensaje: 'Elija el lote que se va a apartar.' };
  if (!(d.peso_neto_kg > 0)) return { ok: false, mensaje: 'El peso a reservar tiene que ser mayor que cero.' };
  if (!(d.bultos > 0)) return { ok: false, mensaje: 'Indique cuántos bultos se apartan.' };

  const supabase = await crearClienteServidor();

  /* ---- 1. El lote tiene que existir, tener saldo y estar liberado ---- */
  const { data: stock } = await supabase
    .from('v_stock_lote')
    .select('codigo_pallet, fisico_kg, disponible_kg, bloqueado_kg, fisico_bultos')
    .eq('lote_id', d.lote_id)
    .eq('almacen_id', d.almacen_id)
    .maybeSingle();

  if (!stock) return { ok: false, mensaje: 'Ese lote ya no tiene saldo en esa bodega.' };

  const pallet = String(stock.codigo_pallet);

  if (Number(stock.bloqueado_kg) > 0) {
    return {
      ok: false,
      mensaje:
        `El pallet ${pallet} está bloqueado por calidad y no se puede apartar. ` +
        'Revise su dictamen en Almacenes → Calidad: mientras esté observado, inmovilizado o ' +
        'en espera de resultados, no sale de cámara.',
    };
  }

  const disponible = Number(stock.disponible_kg);
  if (d.peso_neto_kg > disponible + 0.001) {
    return {
      ok: false,
      mensaje:
        `Del pallet ${pallet} solo quedan ${kg(disponible)} disponibles y está pidiendo ` +
        `${kg(d.peso_neto_kg)}. El resto está apartado para otro pedido o bloqueado por calidad.`,
    };
  }

  /* ---- 2. Ni más de lo pedido, ni de otro producto ---- */
  const { data: linea } = await supabase
    .from('pedido_lineas')
    .select('cantidad_tm, pedido_id, sku_presentacion_id, pedidos(numero_proforma, situacion)')
    .eq('id', d.pedido_linea_id)
    .maybeSingle();

  if (!linea) return { ok: false, mensaje: 'Esa línea de pedido ya no existe.' };

  /*
   * El pedido no tiene un campo «estado»: lleva `situacion` —dónde va la
   * facturación— y `cobertura` —cuánto stock tiene apartado—. Lo que impide
   * apartar más es que ya se haya facturado: eso significa que el producto
   * salió, y apartarle stock a un pedido despachado retendría kilos que
   * nadie va a ir a buscar.
   */
  const ped = Array.isArray(linea.pedidos) ? linea.pedidos[0] : linea.pedidos;
  const yaFacturado = ['facturado', 'parcialmente_cobrado', 'cobrado'];
  if (yaFacturado.includes(String(ped?.situacion))) {
    return {
      ok: false,
      mensaje:
        `El pedido ${ped?.numero_proforma} ya está ${String(ped?.situacion).replace('_', ' ')}: ` +
        'su mercadería salió y no admite apartar más stock.',
    };
  }

  /*
   * El lote tiene que ser del producto que se pidió. Apartar un pallet de
   * merluza para una línea de pota cuadraría en kilos, y sería un error que
   * solo se descubriría el día de la carga, con el contenedor esperando.
   */
  const { data: lote } = await supabase
    .from('lotes').select('sku_presentacion_id').eq('id', d.lote_id).maybeSingle();

  if (Number(lote?.sku_presentacion_id) !== Number(linea.sku_presentacion_id)) {
    return { ok: false, mensaje: `El pallet ${pallet} no es del producto de esta línea del pedido.` };
  }

  const { data: yaReservado } = await supabase
    .from('reservas')
    .select('peso_neto_kg')
    .eq('pedido_linea_id', d.pedido_linea_id)
    .in('estado', ['activa', 'en_preparacion', 'consumida']);

  const apartado = (yaReservado ?? []).reduce((s, r) => s + Number(r.peso_neto_kg), 0);
  const pedidoKg = Number(linea.cantidad_tm) * 1000;
  const falta = pedidoKg - apartado;

  if (falta <= 0.001) {
    return {
      ok: false,
      mensaje: `Esta línea ya está cubierta por completo: ${(apartado / 1000).toFixed(2)} TM de ${(pedidoKg / 1000).toFixed(2)} TM pedidas.`,
    };
  }
  if (d.peso_neto_kg > falta + 0.001) {
    return {
      ok: false,
      mensaje: `Se pasaría de lo pedido: faltan ${kg(falta)} por cubrir y está apartando ${kg(d.peso_neto_kg)}.`,
    };
  }

  /* ---- 3. El plazo sale del parámetro configurado ---- */
  const { data: param } = await supabase
    .from('parametros').select('valor').eq('clave', 'reserva_dias_vencimiento').maybeSingle();

  const dias = d.dias ?? Number(param?.valor ?? 15);
  const vence = new Date(Date.now() + dias * 86400000).toISOString();

  /* ---- 4. Se aparta ---- */
  const { data: creada, error } = await supabase
    .from('reservas')
    .insert({
      pedido_linea_id: d.pedido_linea_id,
      lote_id: d.lote_id,
      almacen_id: d.almacen_id,
      bultos: Math.round(d.bultos),
      peso_neto_kg: d.peso_neto_kg,
      estado: 'activa',
      vence_el: vence,
      creado_por: usuario.id,
      observaciones: d.observaciones?.trim() || null,
    })
    .select('id')
    .single();

  if (error) return { ok: false, mensaje: `No se pudo apartar: ${error.message}` };

  await supabase.rpc('registrar_evento', {
    p_entidad: 'reservas',
    p_entidad_id: creada.id,
    p_tipo: 'reserva_creada',
    p_descripcion:
      `Se apartaron ${kg(d.peso_neto_kg)} del pallet ${pallet} para el pedido ` +
      `${ped?.numero_proforma}, con vencimiento a ${dias} días`,
    p_severidad: 'info',
    p_metadatos: { pallet, kg: d.peso_neto_kg, bultos: d.bultos, dias },
  }).then(() => undefined, () => undefined);

  refrescarReservas(linea.pedido_id as number);

  const restante = falta - d.peso_neto_kg;
  return {
    ok: true,
    id: creada.id as number,
    mensaje:
      `Apartados ${kg(d.peso_neto_kg)} del pallet ${pallet}. ` +
      (restante > 0.001
        ? `Faltan ${kg(restante)} para cubrir la línea.`
        : 'La línea queda cubierta al 100 %.'),
  };
}

/* ==========================================================================
   LOTES CANDIDATOS PARA UNA LÍNEA
   --------------------------------------------------------------------------
   Los lotes que sirven para cubrir una línea, ordenados por antigüedad: lo
   más viejo primero. Es el criterio que evita que el stock se venza en cámara,
   y el que hoy almacén aplica de memoria.
   ========================================================================== */
export type LoteCandidato = {
  lote_id: number;
  almacen_id: number;
  codigo_pallet: string;
  almacen: string;
  fecha_produccion: string;
  meses: number;
  disponible_kg: number;
  fisico_bultos: number;
  /** Kilos por bulto, para proponer cuántos bultos salen de los kilos. */
  kg_por_bulto: number;
};

export type OpcionesDeLinea = {
  candidatos: LoteCandidato[];
  faltaKg: number;
  pedidoKg: number;
  producto: string;
  aviso: string | null;
};

export async function lotesParaLinea(pedidoLineaId: number): Promise<OpcionesDeLinea> {
  const supabase = await crearClienteServidor();
  const vacio: OpcionesDeLinea = { candidatos: [], faltaKg: 0, pedidoKg: 0, producto: '', aviso: null };

  const { data: linea } = await supabase
    .from('pedido_lineas')
    .select('cantidad_tm, sku_presentacion_id, sku_presentaciones(presentaciones(peso_bulto_kg, descripcion), skus(codigo, corte, especies(nombre)))')
    .eq('id', pedidoLineaId)
    .maybeSingle();

  if (!linea) return vacio;

  const sp = Array.isArray(linea.sku_presentaciones) ? linea.sku_presentaciones[0] : linea.sku_presentaciones;
  const presentacion = Array.isArray(sp?.presentaciones) ? sp.presentaciones[0] : sp?.presentaciones;
  const sku = Array.isArray(sp?.skus) ? sp.skus[0] : sp?.skus;
  const especie = Array.isArray(sku?.especies) ? sku.especies[0] : sku?.especies;

  const producto = `${sku?.codigo ?? ''} · ${especie?.nombre ?? ''} · ${sku?.corte ?? ''}`.trim();
  const kgPorBulto = Number(presentacion?.peso_bulto_kg ?? 0) || 1;

  const { data: reservado } = await supabase
    .from('reservas').select('peso_neto_kg')
    .eq('pedido_linea_id', pedidoLineaId)
    .in('estado', ['activa', 'en_preparacion', 'consumida']);

  const pedidoKg = Number(linea.cantidad_tm) * 1000;
  const apartado = (reservado ?? []).reduce((s, r) => s + Number(r.peso_neto_kg), 0);
  const faltaKg = Math.max(0, pedidoKg - apartado);

  const { data: lotes } = await supabase
    .from('v_stock_lote')
    .select('lote_id, almacen_id, codigo_pallet, fecha_produccion, disponible_kg, fisico_bultos, meses_almacenado')
    .eq('sku_presentacion_id', linea.sku_presentacion_id)
    .gt('disponible_kg', 0)
    .order('fecha_produccion', { ascending: true })
    .limit(60);

  const ids = [...new Set((lotes ?? []).map((l) => l.almacen_id as number))];
  const { data: almacenes } = ids.length
    ? await supabase.from('almacenes').select('id, nombre').in('id', ids)
    : { data: [] as { id: number; nombre: string }[] };

  const nombreAlmacen = new Map((almacenes ?? []).map((a) => [a.id as number, a.nombre as string]));

  const candidatos: LoteCandidato[] = (lotes ?? []).map((l) => ({
    lote_id: l.lote_id as number,
    almacen_id: l.almacen_id as number,
    codigo_pallet: l.codigo_pallet as string,
    almacen: nombreAlmacen.get(l.almacen_id as number) ?? '—',
    fecha_produccion: String(l.fecha_produccion),
    meses: Number(l.meses_almacenado ?? 0),
    disponible_kg: Number(l.disponible_kg),
    fisico_bultos: Number(l.fisico_bultos ?? 0),
    kg_por_bulto: kgPorBulto,
  }));

  const totalDisponible = candidatos.reduce((s, c) => s + c.disponible_kg, 0);

  /*
   * El aviso se calcula aquí y no en la pantalla porque necesita el total
   * disponible, que la pantalla no tiene. Y se dice el número: «no hay stock»
   * no ayuda; «faltan 4 200 kg y solo hay 1 800» dice qué hacer.
   */
  let aviso: string | null = null;
  if (faltaKg > 0 && totalDisponible === 0) {
    aviso =
      'No hay ni un kilo disponible de este producto. Revise si hay reservas vencidas que se ' +
      'puedan liberar, o si está bloqueado por calidad.';
  } else if (faltaKg > totalDisponible) {
    aviso =
      `Faltan ${faltaKg.toLocaleString('es-PE', { maximumFractionDigits: 0 })} kg por cubrir y solo hay ` +
      `${totalDisponible.toLocaleString('es-PE', { maximumFractionDigits: 0 })} kg disponibles. ` +
      'Se puede apartar lo que hay y completar cuando entre producción.';
  }

  return { candidatos, faltaKg, pedidoKg, producto, aviso };
}

/* ==========================================================================
   APARTAR TODO LO DISPONIBLE, DE UNA VEZ
   --------------------------------------------------------------------------
   Una línea casi nunca se cubre con un solo pallet: hay que ir tomando de
   varios hasta juntar las toneladas. Hacerlo de a uno son cuatro o cinco
   clics idénticos, y el resultado es siempre el mismo, porque el criterio no
   cambia: se toma del más antiguo hacia el más nuevo hasta cubrir lo que
   falta o hasta que se acabe el stock.

   Esta función hace ese recorrido de una vez. El botón de elegir uno a uno
   sigue existiendo, porque hay veces que se quiere sacar de una bodega
   concreta —la que está al lado del contenedor— y no del pallet más viejo.

   NO ES UNA TRANSACCIÓN ÚNICA, Y ESTÁ BIEN QUE NO LO SEA
   Cada pallet se aparta por separado y con sus propias validaciones. Si uno
   falla —lo bloqueó calidad hace un minuto, otro usuario se lo llevó—, los
   anteriores quedan apartados igual y el resultado dice cuántos entraron y
   cuál falló. Deshacer los buenos porque uno salió mal obligaría a repetir
   todo el trabajo por un pallet.
   ========================================================================== */

export type ResultadoLote = {
  apartados: number;
  kgApartados: number;
  faltaKg: number;
  mensaje: string;
  fallos: string[];
};

export async function apartarTodoDisponible(pedidoLineaId: number): Promise<ResultadoLote> {
  const opciones = await lotesParaLinea(pedidoLineaId);

  if (opciones.faltaKg <= 0) {
    return {
      apartados: 0, kgApartados: 0, faltaKg: 0,
      mensaje: 'Esta línea ya está cubierta por completo.',
      fallos: [],
    };
  }
  if (opciones.candidatos.length === 0) {
    return {
      apartados: 0, kgApartados: 0, faltaKg: opciones.faltaKg,
      mensaje: 'No hay ni un kilo disponible de este producto para apartar.',
      fallos: [],
    };
  }

  let porCubrir = opciones.faltaKg;
  let apartados = 0;
  let kgApartados = 0;
  const fallos: string[] = [];

  for (const lote of opciones.candidatos) {
    if (porCubrir <= 0.001) break;

    // Del pallet se toma lo que falte, o todo lo que tenga si es menos.
    const kilos = Math.round(Math.min(porCubrir, lote.disponible_kg) * 10) / 10;
    if (kilos <= 0) continue;

    const r = await crearReserva({
      pedido_linea_id: pedidoLineaId,
      lote_id: lote.lote_id,
      almacen_id: lote.almacen_id,
      bultos: Math.max(1, Math.ceil(kilos / lote.kg_por_bulto)),
      peso_neto_kg: kilos,
    });

    if (r.ok) {
      apartados += 1;
      kgApartados += kilos;
      porCubrir -= kilos;
    } else {
      fallos.push(`${lote.codigo_pallet}: ${r.mensaje}`);
    }
  }

  const restante = Math.max(0, porCubrir);
  const kgTexto = kgApartados.toLocaleString('es-PE', { maximumFractionDigits: 1 });

  let mensaje: string;
  if (apartados === 0) {
    mensaje = 'No se pudo apartar de ningún pallet.';
  } else if (restante <= 0.001) {
    mensaje = `Línea cubierta al 100 %: se apartaron ${kgTexto} kg de ${apartados} pallet${apartados === 1 ? '' : 's'}.`;
  } else {
    mensaje =
      `Se apartaron ${kgTexto} kg de ${apartados} pallet${apartados === 1 ? '' : 's'}: ` +
      `es todo lo que había. Faltan ${restante.toLocaleString('es-PE', { maximumFractionDigits: 0 })} kg, ` +
      'que solo se cubren con producción nueva o liberando reservas vencidas.';
  }

  return { apartados, kgApartados, faltaKg: restante, mensaje, fallos };
}
