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
    return { error: `Su rol (${usuario.rol}) no puede ${que}.` };
  }
  return { usuario };
}

/* ==========================================================================
   CREAR
   ========================================================================== */

export type LineaTraslado = { lote_id: number; bultos: number; peso_kg: number };

export type DatosTraslado = {
  almacen_origen_id: number;
  almacen_destino_id: number;
  fecha_programada: string | null;
  transportista_id: number | null;
  vehiculo_id: number | null;
  conductor_id: number | null;
  observaciones: string | null;
  lineas: LineaTraslado[];
};

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

  const supabase = await crearClienteServidor();

  /* ---- Cada pallet tiene que tener saldo en el origen y estar liberado ---- */
  for (const l of d.lineas) {
    if (!(l.peso_kg > 0) || !(l.bultos > 0)) {
      return { ok: false, mensaje: 'Todos los pallets necesitan bultos y peso mayores que cero.' };
    }

    const { data: stock } = await supabase
      .from('v_stock_lote')
      .select('codigo_pallet, disponible_kg, bloqueado_kg')
      .eq('lote_id', l.lote_id)
      .eq('almacen_id', d.almacen_origen_id)
      .maybeSingle();

    if (!stock) {
      return { ok: false, mensaje: `El lote ${l.lote_id} no tiene saldo en la bodega de origen.` };
    }
    if (Number(stock.bloqueado_kg) > 0) {
      return {
        ok: false,
        mensaje: `El pallet ${stock.codigo_pallet} está bloqueado por calidad y no puede moverse de bodega.`,
      };
    }
    if (l.peso_kg > Number(stock.disponible_kg) + 0.001) {
      return {
        ok: false,
        mensaje:
          `Del pallet ${stock.codigo_pallet} hay ${Number(stock.disponible_kg).toLocaleString('es-PE', { maximumFractionDigits: 1 })} kg ` +
          `disponibles y quiere mover ${l.peso_kg.toLocaleString('es-PE', { maximumFractionDigits: 1 })} kg. ` +
          'El resto está apartado para un pedido.',
      };
    }
  }

  const anio = new Date().getFullYear();
  const { data: correlativo, error: errNum } = await supabase
    .rpc('siguiente_correlativo', { p_serie: 'TRAS', p_anio: anio });
  if (errNum) return { ok: false, mensaje: `No se pudo reservar el número: ${errNum.message}` };

  const numero = `TRAS-${anio}-${String(correlativo).padStart(4, '0')}`;

  const { data: traslado, error } = await supabase
    .from('traslados')
    .insert({
      numero,
      almacen_origen_id: d.almacen_origen_id,
      almacen_destino_id: d.almacen_destino_id,
      // El primer estado del enum es «borrador», no «solicitado».
      estado: 'borrador',
      fecha_programada: d.fecha_programada || null,
      transportista_id: d.transportista_id,
      vehiculo_id: d.vehiculo_id,
      conductor_id: d.conductor_id,
      observaciones: d.observaciones?.trim() || null,
      creado_por: permiso.usuario!.id,
    })
    .select('id')
    .single();

  if (error || !traslado) return { ok: false, mensaje: `No se pudo crear el traslado: ${error?.message}` };

  const { error: errLin } = await supabase.from('traslado_lineas').insert(
    d.lineas.map((l) => ({
      traslado_id: traslado.id,
      lote_id: l.lote_id,
      bultos_enviados: Math.round(l.bultos),
      peso_enviado_kg: l.peso_kg,
    }))
  );

  if (errLin) {
    // Un traslado sin líneas no significa nada: se deshace entero.
    await supabase.from('traslados').delete().eq('id', traslado.id);
    return { ok: false, mensaje: `No se pudieron cargar los pallets: ${errLin.message}` };
  }

  refrescar(traslado.id as number);
  return {
    ok: true,
    id: traslado.id as number,
    mensaje:
      `Traslado ${numero} creado con ${d.lineas.length} pallet${d.lineas.length === 1 ? '' : 's'}. ` +
      'Todavía no se movió nada: hace falta que operaciones lo autorice.',
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
  if (error) return { ok: false, mensaje: `No se pudo autorizar: ${error.message}` };

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
  if (error) return { ok: false, mensaje: `No se pudo despachar: ${error.message}` };

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

    if (error) return { ok: false, mensaje: `No se pudo anotar lo recibido: ${error.message}` };
  }

  const { error } = await supabase.rpc('traslado_aceptar', { p_traslado_id: id });
  if (error) return { ok: false, mensaje: `No se pudo aceptar: ${error.message}` };

  /* ---- ¿Cuadró? Se dice, con el número ---- */
  const { data: lineas } = await supabase
    .from('traslado_lineas')
    .select('bultos_enviados, bultos_aceptados, peso_enviado_kg, peso_aceptado_kg, lotes(codigo_pallet)')
    .eq('traslado_id', id);

  const descuadres = (lineas ?? []).filter(
    (l) => Math.abs(Number(l.peso_enviado_kg) - Number(l.peso_aceptado_kg ?? 0)) > 0.01
  );

  refrescar(id);

  if (descuadres.length === 0) {
    return { ok: true, id, mensaje: 'Traslado aceptado. Lo recibido coincide exactamente con lo enviado.' };
  }

  const detalle = descuadres.map((l) => {
    const lote = Array.isArray(l.lotes) ? l.lotes[0] : l.lotes;
    const dif = Number(l.peso_aceptado_kg ?? 0) - Number(l.peso_enviado_kg);
    return `${lote?.codigo_pallet}: ${dif > 0 ? '+' : ''}${dif.toFixed(1)} kg`;
  }).join(' · ');

  return {
    ok: true, id,
    mensaje:
      `Traslado aceptado con ${descuadres.length} discrepancia${descuadres.length === 1 ? '' : 's'}: ${detalle}. ` +
      'Quedaron registradas con su alerta: la diferencia no se pierde, se investiga.',
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
        `El traslado ${t.numero} está ${String(t.estado).replace('_', ' ')}: el stock ya se movió y ` +
        'no se puede anular. Si llegó mal, acéptelo con la cantidad real y quedará la discrepancia.',
    };
  }

  const { error } = await supabase
    .from('traslados')
    .update({ estado: 'anulado', observaciones: motivo.trim() })
    .eq('id', id);

  if (error) return { ok: false, mensaje: `No se pudo anular: ${error.message}` };

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
  disponible_kg: number;
  bultos: number;
  kg_por_bulto: number;
};

export async function lotesEnBodega(almacenId: number): Promise<LoteTrasladable[]> {
  const supabase = await crearClienteServidor();

  const { data: stock } = await supabase
    .from('v_stock_lote')
    .select('lote_id, codigo_pallet, disponible_kg, fisico_bultos, meses_almacenado, bloqueado_kg, sku_presentacion_id')
    .eq('almacen_id', almacenId)
    .gt('disponible_kg', 0)
    .order('fecha_produccion', { ascending: true })
    .limit(150);

  const ids = [...new Set((stock ?? []).map((s) => s.sku_presentacion_id as number))];
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

  return (stock ?? [])
    // Lo bloqueado por calidad no se mueve de bodega: primero se resuelve.
    .filter((s) => Number(s.bloqueado_kg) === 0)
    .map((s) => {
      const info = desc.get(s.sku_presentacion_id as number);
      const kg = Number(s.disponible_kg);
      return {
        lote_id: s.lote_id as number,
        codigo_pallet: s.codigo_pallet as string,
        producto: info?.texto ?? '—',
        meses: Number(s.meses_almacenado ?? 0),
        disponible_kg: kg,
        bultos: Math.floor(kg / (info?.kgBulto ?? 1)),
        kg_por_bulto: info?.kgBulto ?? 1,
      };
    })
    .filter((l) => l.bultos > 0);
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
    if (errNum) return { ok: false, mensaje: `No se pudo reservar el número: ${errNum.message}` };

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
        creado_por: permiso.usuario!.id,
      })
      .select('id')
      .single();

    if (error || !traslado) {
      return { ok: false, mensaje: `No se pudo crear el traslado desde ${origen.nombre}: ${error?.message}` };
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
      return { ok: false, mensaje: `No se pudieron cargar los pallets: ${errLin.message}` };
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
