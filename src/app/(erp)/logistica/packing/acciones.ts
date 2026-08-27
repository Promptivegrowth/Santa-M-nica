'use server';

/**
 * ============================================================================
 *  PACKING LIST Y PLANO DE ESTIBA
 * ============================================================================
 *  QUÉ ES EL PLANO Y POR QUÉ IMPORTA QUE SE PUEDA EDITAR
 *
 *  El plano dice cuántos sacos de cada lote van en cada fila del contenedor.
 *  El sistema lo propone solo, con criterio FIFO: el lote más antiguo se carga
 *  primero, y por lo tanto queda al fondo. Eso está bien como punto de partida
 *  y mal como imposición, porque en el muelle mandan cosas que el programa no
 *  sabe:
 *
 *    · Lo que se descarga primero en destino tiene que ir en la puerta.
 *    · Si un lote lleva muestra para análisis, va accesible.
 *    · Un cambio de última hora —un pallet que no pasó calidad— obliga a
 *      recolocar todo lo demás.
 *
 *  Por eso ahora el plano se edita casilla por casilla. Lo que NO se puede es
 *  guardar un plano imposible, y de eso se encarga esta capa:
 *
 *    1. Ningún lote puede llevar más sacos repartidos de los que tiene.
 *    2. Ninguna fila puede pasar de su cupo de sacos.
 *    3. No se pueden usar más filas de las que tiene el contenedor.
 *    4. La suma total tiene que cuadrar con los bultos del packing.
 *
 *  Se comprueban las cuatro AQUÍ, en el servidor, aunque la pantalla ya avise
 *  mientras se escribe: la pantalla es una comodidad, esto es la garantía.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';

export type Resultado =
  | { ok: true; mensaje: string }
  | { ok: false; mensaje: string; detalles?: string[] };

const PUEDEN_EDITAR = ['gerencia', 'operaciones', 'almacen', 'comex'];

function refrescar(packingId: number) {
  revalidatePath('/logistica/packing');
  revalidatePath(`/logistica/packing/${packingId}`);
  revalidatePath('/logistica/despachos');
  revalidatePath('/reportes');
}

async function autorizar() {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { error: 'Su sesión caducó. Vuelva a entrar.' };
  if (!PUEDEN_EDITAR.includes(usuario.rol)) {
    return { error: `Su rol (${usuario.rol}) no puede modificar packing lists.` };
  }
  return { usuario };
}

/** Un packing cerrado ya se despachó: su plano es historia, no borrador. */
async function comprobarAbierto(packingId: number) {
  const supabase = await crearClienteServidor();
  const { data } = await supabase
    .from('packing_lists')
    .select('estado, codigo, filas_contenedor, sacos_por_fila')
    .eq('id', packingId)
    .maybeSingle();

  if (!data) return { error: 'Ese packing list ya no existe.' };
  if (data.estado === 'cerrado') {
    return { error: `El packing ${data.codigo} ya fue despachado: su plano no se puede cambiar.` };
  }
  if (data.estado === 'anulado') {
    return { error: `El packing ${data.codigo} está anulado.` };
  }
  return { packing: data };
}

/* ==========================================================================
   EL PLANO
   ========================================================================== */

export type CeldaPlano = { lote_id: number; fila: number; sacos: number };

/**
 * Guarda el plano entero de una vez.
 *
 * Se manda completo y no celda por celda a propósito: mover sacos de una fila
 * a otra son dos cambios que solo tienen sentido juntos, y guardarlos por
 * separado dejaría el plano descuadrado entre uno y otro.
 */
export async function guardarPlano(packingId: number, celdas: CeldaPlano[]): Promise<Resultado> {
  const permiso = await autorizar();
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const estado = await comprobarAbierto(packingId);
  if (estado.error) return { ok: false, mensaje: estado.error };

  const pk = estado.packing!;
  const filasMax = Number(pk.filas_contenedor);
  const cupoFila = Number(pk.sacos_por_fila);

  const supabase = await crearClienteServidor();

  /* ---- Cuántos bultos tiene cada lote según el packing ---- */
  const { data: lineas } = await supabase
    .from('packing_lineas')
    .select('lote_id, bultos, lotes(codigo_pallet)')
    .eq('packing_list_id', packingId);

  if (!lineas?.length) {
    return { ok: false, mensaje: 'El packing no tiene lotes cargados: primero hay que agregarlos.' };
  }

  const nombreLote = new Map(
    lineas.map((l) => {
      const lote = Array.isArray(l.lotes) ? l.lotes[0] : l.lotes;
      return [Number(l.lote_id), String(lote?.codigo_pallet ?? l.lote_id)];
    })
  );
  const bultosDe = new Map(lineas.map((l) => [Number(l.lote_id), Number(l.bultos)]));

  /* ---- Las cuatro comprobaciones ---- */
  const detalles: string[] = [];
  const utiles = celdas.filter((c) => c.sacos > 0);

  for (const c of utiles) {
    if (!Number.isInteger(c.sacos) || c.sacos < 0) {
      detalles.push(`Los sacos van en números enteros: llegó ${c.sacos}.`);
    }
    if (c.fila < 1 || c.fila > filasMax) {
      detalles.push(`La fila ${c.fila} no existe: el contenedor tiene ${filasMax}.`);
    }
    if (!bultosDe.has(Number(c.lote_id))) {
      detalles.push(`El lote ${c.lote_id} no está en este packing.`);
    }
  }

  // 1 · Por lote: ni más ni menos de lo que tiene
  const porLote = new Map<number, number>();
  for (const c of utiles) {
    porLote.set(Number(c.lote_id), (porLote.get(Number(c.lote_id)) ?? 0) + c.sacos);
  }
  for (const [loteId, bultos] of bultosDe) {
    const puesto = porLote.get(loteId) ?? 0;
    if (puesto > bultos) {
      detalles.push(
        `El pallet ${nombreLote.get(loteId)} tiene ${bultos} bultos y en el plano hay ${puesto} repartidos: ` +
        `sobran ${puesto - bultos}.`
      );
    } else if (puesto < bultos) {
      detalles.push(
        `Al pallet ${nombreLote.get(loteId)} le faltan ${bultos - puesto} bultos por colocar ` +
        `(${puesto} de ${bultos}).`
      );
    }
  }

  // 2 · Por fila: sin pasarse del cupo
  const porFila = new Map<number, number>();
  for (const c of utiles) {
    porFila.set(c.fila, (porFila.get(c.fila) ?? 0) + c.sacos);
  }
  for (const [fila, total] of porFila) {
    if (total > cupoFila) {
      detalles.push(`La fila ${fila} lleva ${total} sacos y solo caben ${cupoFila}.`);
    }
  }

  if (detalles.length > 0) {
    return {
      ok: false,
      mensaje: 'El plano no cuadra y no se guardó. Revise:',
      // Se limita para que el aviso siga siendo legible con un plano grande.
      detalles: detalles.slice(0, 8),
    };
  }

  /* ---- Se rehace el plano ----
     Borrar y reinsertar es más simple y más seguro que ir comparando celda a
     celda: el plano de un contenedor son unas decenas de filas, no miles. */
  const { error: errorBorrar } = await supabase
    .from('plano_estiba').delete().eq('packing_list_id', packingId);
  if (errorBorrar) return { ok: false, mensaje: `No se pudo limpiar el plano: ${errorBorrar.message}` };

  if (utiles.length > 0) {
    const { error } = await supabase.from('plano_estiba').insert(
      utiles.map((c) => ({
        packing_list_id: packingId,
        lote_id: c.lote_id,
        fila: c.fila,
        sacos: c.sacos,
      }))
    );
    if (error) return { ok: false, mensaje: `No se pudo guardar el plano: ${error.message}` };
  }

  const filasUsadas = porFila.size;
  const totalSacos = [...porFila.values()].reduce((s, n) => s + n, 0);

  await supabase.rpc('registrar_evento', {
    p_entidad: 'packing_lists',
    p_entidad_id: packingId,
    p_tipo: 'plano_editado',
    p_descripcion: `Plano de estiba de ${pk.codigo} guardado a mano: ${totalSacos} sacos en ${filasUsadas} filas`,
    p_severidad: 'info',
  }).then(() => undefined, () => undefined);

  refrescar(packingId);
  return {
    ok: true,
    mensaje: `Plano guardado: ${totalSacos} sacos repartidos en ${filasUsadas} de ${filasMax} filas.`,
  };
}

/** Vuelve a proponer el plano con el criterio FIFO de la base de datos. */
export async function regenerarPlano(packingId: number): Promise<Resultado> {
  const permiso = await autorizar();
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const estado = await comprobarAbierto(packingId);
  if (estado.error) return { ok: false, mensaje: estado.error };

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc('generar_plano_estiba', { p_packing_list_id: packingId });

  if (error) return { ok: false, mensaje: `No se pudo regenerar: ${error.message}` };

  refrescar(packingId);
  return {
    ok: true,
    mensaje:
      `Plano rehecho con criterio FIFO en ${data} filas: el lote más antiguo va primero, ` +
      'o sea al fondo del contenedor. Ajuste a mano lo que haga falta.',
  };
}

/* ==========================================================================
   LOS LOTES DEL PACKING
   ========================================================================== */

/** Los lotes que se pueden cargar en este contenedor. */
export type LoteCargable = {
  lote_id: number;
  codigo_pallet: string;
  producto: string;
  fecha_produccion: string;
  meses: number;
  bultos_disponibles: number;
  kg_disponibles: number;
  reservado_para: string | null;
};

export async function lotesCargables(packingId: number): Promise<LoteCargable[]> {
  const supabase = await crearClienteServidor();

  const { data: pk } = await supabase
    .from('packing_lists').select('embarque_id, embarques(almacen_id)').eq('id', packingId).maybeSingle();
  if (!pk) return [];

  const emb = Array.isArray(pk.embarques) ? pk.embarques[0] : pk.embarques;
  const almacenId = Number(emb?.almacen_id);

  /*
   * Solo lotes de la MISMA bodega desde la que sale el embarque. Cargar un
   * pallet que está en otra cámara exigiría un traslado antes, y ofrecerlo
   * aquí sería prometer algo que el camión no puede cumplir.
   */
  const { data: stock } = await supabase
    .from('v_stock_lote')
    .select('lote_id, codigo_pallet, fecha_produccion, meses_almacenado, fisico_bultos, disponible_kg, bloqueado_kg, sku_presentacion_id')
    .eq('almacen_id', almacenId)
    .gt('disponible_kg', 0)
    .order('fecha_produccion', { ascending: true })
    .limit(120);

  const ids = (stock ?? []).map((s) => s.sku_presentacion_id as number);
  const { data: productos } = ids.length
    ? await supabase
        .from('sku_presentaciones')
        .select('id, skus(codigo, corte, especies(nombre)), presentaciones(descripcion, peso_bulto_kg)')
        .in('id', [...new Set(ids)])
    : { data: [] };

  const desc = new Map(
    (productos ?? []).map((p) => {
      const sku = Array.isArray(p.skus) ? p.skus[0] : p.skus;
      const esp = Array.isArray(sku?.especies) ? sku.especies[0] : sku?.especies;
      const pres = Array.isArray(p.presentaciones) ? p.presentaciones[0] : p.presentaciones;
      return [
        p.id as number,
        {
          texto: `${sku?.codigo ?? ''} · ${esp?.nombre ?? ''} · ${sku?.corte ?? ''} · ${pres?.descripcion ?? ''}`,
          kgBulto: Number(pres?.peso_bulto_kg ?? 0) || 1,
        },
      ];
    })
  );

  // Los que ya están en este packing no se vuelven a ofrecer.
  const { data: yaPuestos } = await supabase
    .from('packing_lineas').select('lote_id').eq('packing_list_id', packingId);
  const puestos = new Set((yaPuestos ?? []).map((x) => Number(x.lote_id)));

  return (stock ?? [])
    .filter((s) => !puestos.has(Number(s.lote_id)) && Number(s.bloqueado_kg) === 0)
    .map((s) => {
      const info = desc.get(s.sku_presentacion_id as number);
      const kg = Number(s.disponible_kg);
      return {
        lote_id: s.lote_id as number,
        codigo_pallet: s.codigo_pallet as string,
        producto: info?.texto ?? '—',
        fecha_produccion: String(s.fecha_produccion),
        meses: Number(s.meses_almacenado ?? 0),
        // Los bultos que se pueden cargar salen del peso disponible, no del
        // físico: parte del pallet puede estar apartada para otro pedido.
        bultos_disponibles: Math.floor(kg / (info?.kgBulto ?? 1)),
        kg_disponibles: kg,
        reservado_para: null,
      };
    })
    .filter((l) => l.bultos_disponibles > 0);
}

export async function agregarLoteAlPacking(
  packingId: number,
  loteId: number,
  bultos: number,
  kg: number
): Promise<Resultado> {
  const permiso = await autorizar();
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const estado = await comprobarAbierto(packingId);
  if (estado.error) return { ok: false, mensaje: estado.error };

  if (!(bultos > 0)) return { ok: false, mensaje: 'Indique cuántos bultos se cargan.' };
  if (!(kg > 0)) return { ok: false, mensaje: 'Indique el peso que se carga.' };

  const supabase = await crearClienteServidor();

  const { data: lote } = await supabase
    .from('lotes').select('codigo_pallet').eq('id', loteId).maybeSingle();

  const { error } = await supabase.from('packing_lineas').insert({
    packing_list_id: packingId,
    lote_id: loteId,
    bultos: Math.round(bultos),
    peso_neto_kg: kg,
  });

  if (error) {
    if (error.code === '23505') {
      return { ok: false, mensaje: `El pallet ${lote?.codigo_pallet} ya está en este packing.` };
    }
    return { ok: false, mensaje: `No se pudo agregar: ${error.message}` };
  }

  refrescar(packingId);
  return {
    ok: true,
    mensaje:
      `Pallet ${lote?.codigo_pallet} agregado con ${bultos} bultos. ` +
      'Acuérdese de colocarlo en el plano de estiba antes de despachar.',
  };
}

export async function quitarLoteDelPacking(packingId: number, loteId: number): Promise<Resultado> {
  const permiso = await autorizar();
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const estado = await comprobarAbierto(packingId);
  if (estado.error) return { ok: false, mensaje: estado.error };

  const supabase = await crearClienteServidor();

  // Se quita también del plano: dejarlo ahí produciría un plano que reparte
  // sacos de un lote que ya no está cargado.
  await supabase.from('plano_estiba').delete().eq('packing_list_id', packingId).eq('lote_id', loteId);
  const { error } = await supabase
    .from('packing_lineas').delete().eq('packing_list_id', packingId).eq('lote_id', loteId);

  if (error) return { ok: false, mensaje: `No se pudo quitar: ${error.message}` };

  refrescar(packingId);
  return { ok: true, mensaje: 'Pallet quitado del packing y del plano.' };
}

/* ==========================================================================
   LOS DATOS DEL EMBARQUE EN EL PACKING
   ========================================================================== */

export type DatosPacking = {
  contenedor: string | null;
  precinto: string | null;
  guia_remision: string | null;
  dam: string | null;
  supervisor_id: string | null;
  turno: 'dia' | 'noche';
  fecha_carga: string | null;
  hora_inicio: string | null;
  hora_fin: string | null;
  filas_contenedor: number;
  sacos_por_fila: number;
  observaciones: string | null;
};

export async function guardarDatosPacking(packingId: number, d: DatosPacking): Promise<Resultado> {
  const permiso = await autorizar();
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const estado = await comprobarAbierto(packingId);
  if (estado.error) return { ok: false, mensaje: estado.error };

  if (!(d.filas_contenedor > 0) || !(d.sacos_por_fila > 0)) {
    return { ok: false, mensaje: 'Las filas y los sacos por fila tienen que ser mayores que cero.' };
  }

  /*
   * Achicar el contenedor con un plano ya hecho dejaría sacos colocados en
   * filas que dejan de existir. Se avisa en vez de romperlo en silencio.
   */
  const supabase = await crearClienteServidor();
  const { data: fuera } = await supabase
    .from('plano_estiba')
    .select('fila')
    .eq('packing_list_id', packingId)
    .gt('fila', d.filas_contenedor)
    .limit(1);

  if ((fuera ?? []).length > 0) {
    return {
      ok: false,
      mensaje:
        `No se puede reducir a ${d.filas_contenedor} filas: el plano ya tiene sacos colocados más allá. ` +
        'Recoloque esos sacos primero, o rehaga el plano.',
    };
  }

  const texto = (v: string | null) => (v?.trim() ? v.trim() : null);

  const { error } = await supabase
    .from('packing_lists')
    .update({
      contenedor: texto(d.contenedor),
      precinto: texto(d.precinto),
      guia_remision: texto(d.guia_remision),
      dam: texto(d.dam),
      supervisor_id: d.supervisor_id || null,
      turno: d.turno,
      fecha_carga: d.fecha_carga || null,
      hora_inicio: d.hora_inicio || null,
      hora_fin: d.hora_fin || null,
      filas_contenedor: d.filas_contenedor,
      sacos_por_fila: d.sacos_por_fila,
      observaciones: texto(d.observaciones),
    })
    .eq('id', packingId);

  if (error) return { ok: false, mensaje: `No se pudo guardar: ${error.message}` };

  refrescar(packingId);
  return { ok: true, mensaje: 'Datos del embarque guardados.' };
}
