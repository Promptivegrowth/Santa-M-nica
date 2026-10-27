'use server';

/**
 * ============================================================================
 *  TRASLADOS ENTRE BODEGAS · la máquina de cuatro firmas
 * ============================================================================
 *  Fue un requisito explícito de Marco en la reunión: «cambias de centro, el
 *  otro centro tiene que tener un doble paso: y el otro paso de aceptación».
 *
 *  De ahí los cuatro estados, cada uno con su firma:
 *
 *    BORRADOR     almacén pide mover producto. No se mueve nada todavía.
 *    AUTORIZADO   operaciones aprueba. Sigue sin moverse nada.
 *    EN TRÁNSITO  salió del origen. El stock YA NO está ahí, y todavía no
 *                 está en el destino: existe el «en tránsito», que es
 *                 justamente lo que hoy no se puede ver en el Excel y donde
 *                 se pierde la mercadería que «salió pero no llegó».
 *    ACEPTADO     llegó. Se cuenta lo recibido; si no coincide con lo
 *                 enviado, la diferencia queda registrada como discrepancia.
 *
 *  Las transiciones las ejecutan funciones de la base de datos, que escriben
 *  el Kardex y mueven las existencias dentro de una transacción. Aquí solo se
 *  comprueban permisos y se traducen los errores a algo que se pueda leer.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { traerTodo } from '@/lib/traerTodo';
import { rolNoPuede, traducirErrorBase } from '@/lib/mensajesBase';
import {
  cargarContextoTraslado, problemaLinea, insertarTraslado,
  type DatosTraslado,
} from './registro';

export type { LineaTraslado, DatosTraslado } from './registro';

export type Resultado =
  | { ok: true; id: number; mensaje: string }
  | { ok: false; mensaje: string };

/** Quién puede hacer qué. Son distintos a propósito: por eso hay cuatro pasos. */
const PUEDEN_SOLICITAR = ['gerencia', 'operaciones', 'almacen'];
const PUEDEN_AUTORIZAR = ['gerencia', 'operaciones'];
const PUEDEN_DESPACHAR = ['gerencia', 'operaciones', 'almacen'];
const PUEDEN_ACEPTAR = ['gerencia', 'operaciones', 'almacen'];

function refrescar(id?: number) {
  revalidatePath('/almacenes/traslados');
  if (id) revalidatePath(`/almacenes/traslados/${id}`);
  revalidatePath('/almacenes/existencias');
  revalidatePath('/almacenes/movimientos');
  revalidatePath('/almacenes/kardex');
  revalidatePath('/ventas/disponibilidad');
  revalidatePath('/alertas');
}

async function autorizar(permitidos: string[], que: string) {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { error: 'Su sesión caducó. Vuelva a entrar.' };
  if (!permitidos.includes(usuario.rol)) {
    //  Con el nombre del rol («Comercio Exterior»), no su clave, y quién sí puede.
    return { error: rolNoPuede(usuario.rol, que, permitidos) };
  }
  return { usuario };
}

/* ==========================================================================
   CREAR
   ========================================================================== */

/*
 * Las reglas de cada pallet y el alta viven en registro.ts: son las mismas
 * para este formulario y para la importación desde Excel (074).
 */
export async function crearTraslado(d: DatosTraslado): Promise<Resultado> {
  const permiso = await autorizar(PUEDEN_SOLICITAR, 'solicitar traslados');
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  if (!d.almacen_origen_id || !d.almacen_destino_id) {
    return { ok: false, mensaje: 'Indique de qué bodega sale y a cuál va.' };
  }
  if (d.almacen_origen_id === d.almacen_destino_id) {
    return { ok: false, mensaje: 'El origen y el destino no pueden ser la misma bodega.' };
  }
  if (!d.lineas?.length) {
    return { ok: false, mensaje: 'Elija al menos un pallet para trasladar.' };
  }
  if (new Set(d.lineas.map((l) => l.lote_id)).size !== d.lineas.length) {
    return { ok: false, mensaje: 'Un mismo pallet aparece dos veces: júntelo en una sola línea.' };
  }

  const supabase = await crearClienteServidor();

  /* ---- Cada pallet tiene que tener saldo en el origen y estar liberado ---- */
  const ctx = await cargarContextoTraslado(supabase, d.lineas.map((l) => l.lote_id));
  for (const l of d.lineas) {
    const p = problemaLinea(l, d.almacen_origen_id, ctx);
    if (p) return { ok: false, mensaje: p.mensaje };
  }

  const r = await insertarTraslado(supabase, permiso.usuario!.id as string, d);
  if (!r.ok) return r;

  refrescar(r.id);
  return {
    ok: true,
    id: r.id,
    mensaje:
      `Traslado ${r.numero} creado en borrador con ${d.lineas.length} pallet${d.lineas.length === 1 ? '' : 's'}. ` +
      'Todavía no se movió nada: falta que Gerencia u Operaciones lo autorice y que Almacén lo despache.',
  };
}

/* ==========================================================================
   LAS TRES TRANSICIONES
   ========================================================================== */

export async function autorizarTraslado(id: number): Promise<Resultado> {
  const permiso = await autorizar(PUEDEN_AUTORIZAR, 'autorizar traslados');
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('traslado_autorizar', { p_traslado_id: id });
  if (error) return { ok: false, mensaje: traducirErrorBase(error, { que: 'autorizar el traslado', quien: PUEDEN_AUTORIZAR }) };

  refrescar(id);
  return {
    ok: true, id,
    mensaje: 'Traslado autorizado. El stock sigue en la bodega de origen hasta que se despache.',
  };
}

export async function despacharTraslado(id: number, guia: string): Promise<Resultado> {
  const permiso = await autorizar(PUEDEN_DESPACHAR, 'despachar traslados');
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  if (!guia?.trim()) {
    return {
      ok: false,
      mensaje: 'Falta el número de guía de remisión: sin ella el camión no puede circular.',
    };
  }

  const supabase = await crearClienteServidor();
  const { error } = await supabase
    .rpc('traslado_despachar', { p_traslado_id: id, p_guia: guia.trim() });
  if (error) return { ok: false, mensaje: traducirErrorBase(error, { que: 'despachar el traslado', quien: PUEDEN_DESPACHAR }) };

  refrescar(id);
  return {
    ok: true, id,
    mensaje:
      'Traslado en tránsito. El stock ya salió de la bodega de origen y todavía no está en la de ' +
      'destino: hasta que alguien lo acepte, figura en tránsito.',
  };
}

export async function aceptarTraslado(
  id: number,
  recibido: { linea_id: number; bultos: number; peso_kg: number; observacion?: string }[]
): Promise<Resultado> {
  const permiso = await autorizar(PUEDEN_ACEPTAR, 'aceptar traslados');
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const supabase = await crearClienteServidor();

  /*
   * Primero se anota lo que REALMENTE llegó, línea por línea. La función de la
   * base compara contra lo enviado y, si no cuadra, deja registrada la
   * discrepancia con su alerta. Por eso se graba antes de llamarla.
   */
  for (const r of recibido) {
    if (r.bultos < 0 || r.peso_kg < 0) {
      return { ok: false, mensaje: 'Lo recibido no puede ser negativo.' };
    }
    const { error } = await supabase
      .from('traslado_lineas')
      .update({
        bultos_aceptados: Math.round(r.bultos),
        peso_aceptado_kg: r.peso_kg,
        observacion: r.observacion?.trim() || null,
      })
      .eq('id', r.linea_id)
      .eq('traslado_id', id);

    if (error) return { ok: false, mensaje: traducirErrorBase(error, { que: 'anotar lo recibido', quien: PUEDEN_ACEPTAR }) };
  }

  const { error } = await supabase.rpc('traslado_aceptar', { p_traslado_id: id });
  if (error) return { ok: false, mensaje: traducirErrorBase(error, { que: 'recibir el traslado', quien: PUEDEN_ACEPTAR }) };

  /* ---- ¿Cuadró? Se dice, con el número ---- */
  const { data: lineas } = await supabase
    .from('traslado_lineas')
    .select('bultos_enviados, bultos_aceptados, peso_enviado_kg, peso_aceptado_kg, lotes(codigo_pallet)')
    .eq('traslado_id', id);

  const descuadres = (lineas ?? []).filter(
    (l) => Math.abs(Number(l.peso_enviado_kg) - Number(l.peso_aceptado_kg ?? 0)) > 0.005 ||
           Number(l.bultos_enviados) !== Number(l.bultos_aceptados ?? 0)
  );

  refrescar(id);
  revalidatePath('/almacenes/reservas');

  if (descuadres.length === 0) {
    return { ok: true, id, mensaje: 'Traslado aceptado. Lo recibido coincide exactamente con lo enviado, en bultos y en kilos.' };
  }

  /* Dicho como es: cuánto salió, cuánto llegó, y si falta o sobra. */
  const kgTexto = (n: number) => n.toLocaleString('es-PE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  let faltaKg = 0;
  let sobraKg = 0;
  const detalle = descuadres.map((l) => {
    const lote = Array.isArray(l.lotes) ? l.lotes[0] : l.lotes;
    const difKg = Number(l.peso_aceptado_kg ?? 0) - Number(l.peso_enviado_kg);
    const difB = Number(l.bultos_aceptados ?? 0) - Number(l.bultos_enviados);
    if (difKg < 0) faltaKg += -difKg; else sobraKg += difKg;
    const que = difKg < -0.005 ? `faltan ${kgTexto(-difKg)} kg` : difKg > 0.005 ? `sobran ${kgTexto(difKg)} kg` : 'mismo peso';
    const bultos = difB < 0 ? `, ${-difB} bulto${difB === -1 ? '' : 's'} menos` : difB > 0 ? `, ${difB} bulto${difB === 1 ? '' : 's'} más` : '';
    return `${lote?.codigo_pallet}: salieron ${l.bultos_enviados} bultos · ${kgTexto(Number(l.peso_enviado_kg))} kg, ` +
      `llegaron ${l.bultos_aceptados} bultos · ${kgTexto(Number(l.peso_aceptado_kg ?? 0))} kg (${que}${bultos})`;
  }).join(' · ');

  const consecuencia = [
    faltaKg > 0.005
      ? `El faltante (${kgTexto(faltaKg)} kg) ya salió del inventario: el origen registró la salida completa y el destino solo lo recibido. Si aparece, se registra con un ajuste que suma.`
      : '',
    sobraKg > 0.005
      ? `El sobrante (${kgTexto(sobraKg)} kg) entró en el destino. Si fue un error de pesaje, se corrige con un ajuste que resta.`
      : '',
  ].filter(Boolean).join(' ');

  return {
    ok: true, id,
    mensaje:
      `Traslado aceptado con ${descuadres.length} diferencia${descuadres.length === 1 ? '' : 's'}. ${detalle}. ` +
      `${consecuencia} Cada diferencia quedó en el historial del traslado y como aviso en Alertas.`.trim(),
  };
}

export async function anularTraslado(id: number, motivo: string): Promise<Resultado> {
  const permiso = await autorizar(PUEDEN_AUTORIZAR, 'anular traslados');
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  if (!motivo?.trim() || motivo.trim().length < 5) {
    return { ok: false, mensaje: 'Escriba por qué se anula: sin motivo nadie sabrá qué pasó.' };
  }

  const supabase = await crearClienteServidor();
  const { data: t } = await supabase
    .from('traslados').select('estado, numero').eq('id', id).maybeSingle();

  if (!t) return { ok: false, mensaje: 'Ese traslado ya no existe.' };
  if (t.estado === 'en_transito' || t.estado === 'aceptado') {
    return {
      ok: false,
      mensaje:
        `El traslado ${t.numero} está ${t.estado === 'en_transito' ? 'en tránsito' : 'aceptado'}: el stock ya se movió y ` +
        'no se puede anular. Si llegó mal, acéptelo con la cantidad real y quedará la discrepancia.',
    };
  }

  const { error } = await supabase
    .from('traslados')
    .update({ estado: 'anulado', observaciones: motivo.trim() })
    .eq('id', id);

  if (error) return { ok: false, mensaje: traducirErrorBase(error, { que: 'anular el traslado', quien: PUEDEN_AUTORIZAR }) };

  refrescar(id);
  return { ok: true, id, mensaje: `Traslado ${t.numero} anulado.` };
}

/* ==========================================================================
   AYUDA PARA EL FORMULARIO
   ========================================================================== */

export type LoteTrasladable = {
  lote_id: number;
  codigo_pallet: string;
  producto: string;
  meses: number;
  /** Lo que hay en cámara y lo que de eso se puede mover (físico − reservado). */
  fisico_kg: number;
  disponible_kg: number;
  /** Bultos que se pueden mover: todos si nada está reservado; si no, la parte libre. */
  bultos: number;
  fisico_bultos: number;
  kg_por_bulto: number;
  solo_nacional: boolean;
};

export type PalletsTrasladables = {
  lotes: LoteTrasladable[];
  /** Pallets de la bodega que no se ofrecen, y por qué. */
  bloqueados: number;
  reservadosEnteros: number;
};

/**
 * Los pallets que se pueden trasladar desde una bodega.
 *
 * Solo se ofrece lo DISPONIBLE: lo reservado para un pedido no se lleva a otra
 * cámara sin darse cuenta (para eso está la consolidación del embarque, que
 * mueve lo apartado para ESE embarque). Lo bloqueado por Calidad no se mueve.
 * Se trae entero por páginas: una bodega grande tiene más de 300 pallets y
 * la API corta en mil sin avisar.
 */
export async function lotesEnBodega(almacenId: number): Promise<PalletsTrasladables> {
  const supabase = await crearClienteServidor();

  const stock = await traerTodo<{
    lote_id: number; codigo_pallet: string; disponible_kg: number; fisico_kg: number;
    fisico_bultos: number; meses_almacenado: number; bloqueado_kg: number;
    solo_nacional_kg: number; sku_presentacion_id: number;
  }>((d, h) => supabase
    .from('v_stock_lote')
    .select('lote_id, codigo_pallet, disponible_kg, fisico_kg, fisico_bultos, meses_almacenado, bloqueado_kg, solo_nacional_kg, sku_presentacion_id')
    .eq('almacen_id', almacenId)
    .order('fecha_produccion', { ascending: true })
    .order('lote_id', { ascending: true })
    .range(d, h));

  const ids = [...new Set(stock.map((s) => Number(s.sku_presentacion_id)))];
  const { data: productos } = ids.length
    ? await supabase
        .from('sku_presentaciones')
        .select('id, skus(codigo, corte, especies(nombre)), presentaciones(descripcion, peso_bulto_kg)')
        .in('id', ids)
    : { data: [] };

  const desc = new Map(
    (productos ?? []).map((p) => {
      const sku = Array.isArray(p.skus) ? p.skus[0] : p.skus;
      const esp = Array.isArray(sku?.especies) ? sku.especies[0] : sku?.especies;
      const pres = Array.isArray(p.presentaciones) ? p.presentaciones[0] : p.presentaciones;
      return [p.id as number, {
        texto: `${sku?.codigo ?? ''} · ${esp?.nombre ?? ''} · ${sku?.corte ?? ''}`,
        kgBulto: Number(pres?.peso_bulto_kg ?? 0) || 1,
      }];
    })
  );

  let bloqueados = 0;
  let reservadosEnteros = 0;
  const lotes: LoteTrasladable[] = [];

  for (const s of stock) {
    // Lo bloqueado por calidad no se mueve de bodega: primero se resuelve.
    if (Number(s.bloqueado_kg) > 0) { bloqueados++; continue; }
    const fisico = Number(s.fisico_kg);
    const disp = Number(s.disponible_kg);
    const fisicoBultos = Number(s.fisico_bultos);
    /* Si nada está apartado se mueven los bultos reales del pallet; si hay
       algo apartado, la parte libre en proporción (redondeando hacia abajo). */
    const bultos = disp >= fisico - 0.001 ? fisicoBultos : Math.floor(fisicoBultos * (disp / fisico));
    if (disp <= 0.001 || bultos <= 0) { reservadosEnteros++; continue; }
    const info = desc.get(Number(s.sku_presentacion_id));
    lotes.push({
      lote_id: Number(s.lote_id),
      codigo_pallet: String(s.codigo_pallet),
      producto: info?.texto ?? '—',
      meses: Number(s.meses_almacenado ?? 0),
      fisico_kg: fisico,
      disponible_kg: disp,
      bultos,
      fisico_bultos: fisicoBultos,
      kg_por_bulto: info?.kgBulto ?? 1,
      solo_nacional: Number(s.solo_nacional_kg) > 0,
    });
  }

  return { lotes, bloqueados, reservadosEnteros };
}

/* ==========================================================================
   CONSOLIDAR ANTES DE EMBARCAR
   --------------------------------------------------------------------------
   El problema que resuelve: un pedido tiene su mercadería apartada en dos o
   tres bodegas, y el contenedor se carga en una sola. Lo que está en las
   otras se queda en tierra.

   Hasta ahora la pantalla se limitaba a avisarlo y ofrecer un enlace a la
   lista de traslados, que es un callejón: había que volver a averiguar a mano
   qué lotes, de qué bodega, cuántos kilos. El sistema ya sabe las tres cosas.

   Esta función arma los traslados sola. Uno por bodega de origen, porque un
   traslado va de UN sitio a otro; si la mercadería está repartida en tres
   cámaras salen tres, y eso es correcto: son tres camiones.

   POR QUÉ AQUÍ SÍ SE MUEVE STOCK RESERVADO
   `crearTraslado` no deja mover más de lo disponible, y lo reservado no lo
   está. Es la regla correcta para un traslado normal: nadie debería llevarse
   a otra cámara lo que está apartado para un cliente sin darse cuenta.

   Aquí es al revés: se mueve PRECISAMENTE lo apartado, y para ese mismo
   cliente. No se le quita nada a nadie, se junta lo que ya era suyo. Por eso
   esta función valida contra las reservas en vez de contra el disponible, y
   por eso la base de datos ahora muda la reserva junto con el pallet.
   ========================================================================== */

export type ResultadoConsolidacion =
  | {
      ok: true;
      traslados: { id: number; numero: string; origen: string; kg: number; pallets: number }[];
      mensaje: string;
    }
  | { ok: false; mensaje: string };

/** Qué habría que mover para poder cargarlo todo desde una bodega. */
export type PlanConsolidacion = {
  destino_id: number;
  destino: string;
  origenes: {
    almacen_id: number;
    nombre: string;
    kg: number;
    pallets: { lote_id: number; codigo: string; bultos: number; kg: number }[];
  }[];
  kgTotal: number;
};

export async function planConsolidacion(
  pedidoIds: number[],
  almacenDestinoId: number
): Promise<PlanConsolidacion | null> {
  if (!pedidoIds.length || !almacenDestinoId) return null;

  const supabase = await crearClienteServidor();

  const { data: destino } = await supabase
    .from('almacenes').select('nombre').eq('id', almacenDestinoId).maybeSingle();
  if (!destino) return null;

  /* Las reservas vivas de esos pedidos que NO están en la bodega destino. */
  const { data: reservas } = await supabase
    .from('reservas')
    .select('id, lote_id, almacen_id, bultos, peso_neto_kg, lotes(codigo_pallet), almacenes(nombre), pedido_lineas!inner(pedido_id)')
    .in('estado', ['activa', 'en_preparacion'])
    .neq('almacen_id', almacenDestinoId)
    .in('pedido_lineas.pedido_id', pedidoIds);

  const porOrigen = new Map<number, PlanConsolidacion['origenes'][number]>();

  for (const r of reservas ?? []) {
    const alm = Array.isArray(r.almacenes) ? r.almacenes[0] : r.almacenes;
    const lote = Array.isArray(r.lotes) ? r.lotes[0] : r.lotes;
    const almacenId = Number(r.almacen_id);

    if (!porOrigen.has(almacenId)) {
      porOrigen.set(almacenId, {
        almacen_id: almacenId,
        nombre: String(alm?.nombre ?? '—'),
        kg: 0,
        pallets: [],
      });
    }
    const grupo = porOrigen.get(almacenId)!;
    grupo.kg += Number(r.peso_neto_kg ?? 0);

    /* Un mismo pallet puede tener varias reservas del mismo pedido: se juntan
       en una sola línea de traslado, que es como viaja en el camión. */
    const yaEsta = grupo.pallets.find((p) => p.lote_id === Number(r.lote_id));
    if (yaEsta) {
      yaEsta.bultos += Number(r.bultos ?? 0);
      yaEsta.kg += Number(r.peso_neto_kg ?? 0);
    } else {
      grupo.pallets.push({
        lote_id: Number(r.lote_id),
        codigo: String(lote?.codigo_pallet ?? r.lote_id),
        bultos: Number(r.bultos ?? 0),
        kg: Number(r.peso_neto_kg ?? 0),
      });
    }
  }

  const origenes = [...porOrigen.values()].sort((a, b) => b.kg - a.kg);

  return {
    destino_id: almacenDestinoId,
    destino: destino.nombre as string,
    origenes,
    kgTotal: origenes.reduce((s, o) => s + o.kg, 0),
  };
}

export async function consolidarEnBodega(
  pedidoIds: number[],
  almacenDestinoId: number
): Promise<ResultadoConsolidacion> {
  const permiso = await autorizar(PUEDEN_SOLICITAR, 'crear traslados de consolidación');
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const plan = await planConsolidacion(pedidoIds, almacenDestinoId);
  if (!plan) return { ok: false, mensaje: 'No se pudo armar el plan de consolidación.' };
  if (plan.origenes.length === 0) {
    return { ok: false, mensaje: 'No hay nada que mover: todo el stock apartado ya está en esa bodega.' };
  }

  const supabase = await crearClienteServidor();
  const anio = new Date().getFullYear();
  const creados: { id: number; numero: string; origen: string; kg: number; pallets: number }[] = [];

  for (const origen of plan.origenes) {
    /* Un pallet bloqueado por calidad no se mueve: se avisa y se salta. El
       resto del traslado se hace igual, que es mejor que no hacer ninguno. */
    const permitidos: typeof origen.pallets = [];
    for (const p of origen.pallets) {
      const { data: stock } = await supabase
        .from('v_stock_lote')
        .select('bloqueado_kg')
        .eq('lote_id', p.lote_id)
        .eq('almacen_id', origen.almacen_id)
        .maybeSingle();
      if (Number(stock?.bloqueado_kg ?? 0) === 0) permitidos.push(p);
    }

    if (permitidos.length === 0) continue;

    const { data: correlativo, error: errNum } = await supabase
      .rpc('siguiente_correlativo', { p_serie: 'TRAS', p_anio: anio });
    if (errNum) return { ok: false, mensaje: traducirErrorBase(errNum, { que: 'reservar el número del traslado', quien: PUEDEN_SOLICITAR }) };

    const numero = `TRAS-${anio}-${String(correlativo).padStart(4, '0')}`;

    const { data: traslado, error } = await supabase
      .from('traslados')
      .insert({
        numero,
        almacen_origen_id: origen.almacen_id,
        almacen_destino_id: almacenDestinoId,
        estado: 'borrador',
        observaciones:
          `Consolidación para embarcar desde ${plan.destino}. ` +
          `Mueve stock ya apartado de ${pedidoIds.length} pedido(s); las reservas viajan con la mercadería.`,
        /*
         * Para qué pedidos se junta (migración 068). Sin esto el despacho del
         * traslado validaba contra el disponible —y lo apartado no lo es—, y
         * fallaba con «disponible: 0 kg». Con esto admite lo apartado para
         * ESTOS pedidos y, al aceptarlo, muda justo sus reservas.
         */
        consolida_pedidos: pedidoIds.map(Number),
        creado_por: permiso.usuario!.id,
      })
      .select('id')
      .single();

    if (error || !traslado) {
      return { ok: false, mensaje: traducirErrorBase(error, { que: `crear el traslado desde ${origen.nombre}`, quien: PUEDEN_SOLICITAR }) };
    }

    const { error: errLin } = await supabase.from('traslado_lineas').insert(
      permitidos.map((p) => ({
        traslado_id: traslado.id,
        lote_id: p.lote_id,
        bultos_enviados: Math.max(1, Math.round(p.bultos)),
        peso_enviado_kg: p.kg,
      }))
    );

    if (errLin) {
      await supabase.from('traslados').delete().eq('id', traslado.id);
      return { ok: false, mensaje: traducirErrorBase(errLin, { que: 'cargar los pallets del traslado', quien: PUEDEN_SOLICITAR }) };
    }

    creados.push({
      id: traslado.id as number,
      numero,
      origen: origen.nombre,
      kg: permitidos.reduce((s, p) => s + p.kg, 0),
      pallets: permitidos.length,
    });
  }

  if (creados.length === 0) {
    return {
      ok: false,
      mensaje: 'No se creó ningún traslado: los pallets que faltan están bloqueados por calidad.',
    };
  }

  refrescar();
  revalidatePath('/logistica/embarques/nuevo');

  const kg = creados.reduce((s, t) => s + t.kg, 0);
  return {
    ok: true,
    traslados: creados,
    mensaje:
      `${creados.length} traslado${creados.length === 1 ? '' : 's'} en borrador para juntar ` +
      `${(kg / 1000).toFixed(2)} TM en ${plan.destino}. ` +
      'Todavía no se movió nada: hace falta que operaciones los autorice y que almacén los despache.',
  };
}
