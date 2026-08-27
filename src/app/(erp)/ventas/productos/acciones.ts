'use server';

/**
 * ============================================================================
 *  DATOS EN VIVO PARA EL BUSCADOR DE PRODUCTOS
 * ============================================================================
 *  El buscador filtra en el navegador, contra un catálogo que se descargó al
 *  abrir la pantalla. Eso hace que escribir sea instantáneo, pero tiene un
 *  problema: el stock de ese catálogo es una foto del momento en que se abrió.
 *
 *  Si alguien reservó 20 TM hace cinco minutos, el vendedor las sigue viendo
 *  disponibles y se las promete a otro cliente. Es exactamente el problema que
 *  este ERP existe para eliminar, así que no puede reaparecer en el buscador.
 *
 *  La solución es preguntar solo por lo que el usuario está viendo: en cuanto
 *  aparecen resultados, se consulta el detalle de esos —normalmente menos de
 *  diez— y se refrescan con lo que hay AHORA. Una sola llamada, y el precio
 *  llega en la misma.
 * ============================================================================
 */
import { crearClienteServidor } from '@/lib/supabase/servidor';

export type DetalleProducto = {
  id: number;
  /** Kilos libres ahora mismo, sumando todos los almacenes. */
  disponible_kg: number;
  fisico_kg: number;
  reservado_kg: number;
  /** Dónde está, para poder decirle al cliente desde qué bodega sale. */
  almacenes: string[];
  /** El precio que le tocaría a ESTE cliente por ESTE volumen. */
  precio_tm: number | null;
  /** Meses del lote más antiguo que queda: lo que conviene sacar primero. */
  meses_lote_antiguo: number | null;
  /** Cuántos bultos completos salen del disponible. */
  bultos: number;
};

/**
 * Devuelve el detalle en vivo de varias unidades vendibles a la vez.
 *
 * Se piden en bloque y no una por una: diez consultas seguidas desde el
 * navegador tardan diez veces más que una que devuelve diez filas.
 */
export async function detalleProductos(
  ids: number[],
  clienteId: number,
  cantidadTm = 1
): Promise<DetalleProducto[]> {
  if (!ids.length || !clienteId) return [];

  // Un tope de seguridad: el buscador muestra doce, nadie necesita más.
  const pedidos = ids.slice(0, 12);

  const supabase = await crearClienteServidor();

  const [{ data: stock }, { data: pesos }, { data: antiguedad }] = await Promise.all([
    supabase
      .from('v_disponibilidad')
      .select('sku_presentacion_id, almacen, fisico_kg, disponible_kg, reservado_kg')
      .in('sku_presentacion_id', pedidos),
    supabase
      .from('sku_presentaciones')
      .select('id, presentaciones(peso_bulto_kg)')
      .in('id', pedidos),
    supabase
      .from('v_anticuamiento')
      .select('lote_id, meses_almacenado, sku_codigo')
      .order('meses_almacenado', { ascending: false })
      .limit(1000),
  ]);

  /*
   * El precio depende del cliente y del volumen, así que hay que resolverlo
   * uno por uno: es una función de la base y no se puede pedir en lote. Son
   * consultas diminutas y van en paralelo.
   */
  const precios = await Promise.all(
    pedidos.map(async (id) => {
      const { data } = await supabase.rpc('resolver_precio', {
        p_sku_presentacion_id: id,
        p_cliente_id: clienteId,
        p_cantidad_tm: cantidadTm,
      });
      return { id, precio: data === null || data === undefined ? null : Number(data) };
    })
  );
  const precioPorId = new Map(precios.map((p) => [p.id, p.precio]));

  const pesoPorId = new Map(
    (pesos ?? []).map((p) => {
      const pres = Array.isArray(p.presentaciones) ? p.presentaciones[0] : p.presentaciones;
      return [p.id as number, Number(pres?.peso_bulto_kg ?? 0)];
    })
  );

  /* ---- La antigüedad se mide por SKU, que es como se controla en cámara ---- */
  const mesesPorSku = new Map<string, number>();
  for (const a of antiguedad ?? []) {
    const sku = String(a.sku_codigo ?? '');
    const meses = Number(a.meses_almacenado ?? 0);
    if (!sku) continue;
    mesesPorSku.set(sku, Math.max(mesesPorSku.get(sku) ?? 0, meses));
  }

  const { data: codigos } = await supabase
    .from('sku_presentaciones')
    .select('id, skus(codigo)')
    .in('id', pedidos);
  const skuPorId = new Map(
    (codigos ?? []).map((c) => {
      const s = Array.isArray(c.skus) ? c.skus[0] : c.skus;
      return [c.id as number, String(s?.codigo ?? '')];
    })
  );

  return pedidos.map((id) => {
    const filas = (stock ?? []).filter((s) => Number(s.sku_presentacion_id) === id);
    const disponible = filas.reduce((s, f) => s + Number(f.disponible_kg ?? 0), 0);
    const peso = pesoPorId.get(id) ?? 0;
    const meses = mesesPorSku.get(skuPorId.get(id) ?? '');

    return {
      id,
      disponible_kg: disponible,
      fisico_kg: filas.reduce((s, f) => s + Number(f.fisico_kg ?? 0), 0),
      reservado_kg: filas.reduce((s, f) => s + Number(f.reservado_kg ?? 0), 0),
      // Solo los almacenes donde queda algo libre: los demás no sirven de nada
      // para prometer una entrega.
      almacenes: filas
        .filter((f) => Number(f.disponible_kg ?? 0) > 0)
        .map((f) => String(f.almacen))
        .sort(),
      precio_tm: precioPorId.get(id) ?? null,
      meses_lote_antiguo: meses === undefined ? null : meses,
      bultos: peso > 0 ? Math.floor(disponible / peso) : 0,
    };
  });
}
