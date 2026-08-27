/**
 * ============================================================================
 *  CATÁLOGOS PARA LOS FORMULARIOS DE VENTA
 * ============================================================================
 *  Tanto la cotización como el pedido directo necesitan exactamente los mismos
 *  datos de partida: clientes, vendedores, destinos, listas de precio, el
 *  catálogo de productos con su disponibilidad y los parámetros del negocio.
 *
 *  Se cargan una sola vez, aquí, y los dos formularios los reutilizan.
 *
 *  DECISIÓN DE RENDIMIENTO
 *  El catálogo de productos viaja entero al navegador (unas 360 unidades
 *  vendibles, alrededor de 40 kB) para que el buscador responda al instante.
 *  Si cada tecla disparara una consulta al servidor, escribir sería incómodo.
 *  El PRECIO, en cambio, sí se consulta al servidor cada vez: depende del
 *  cliente y del volumen, y esa lógica debe vivir en un solo sitio.
 * ============================================================================
 */
import { crearClienteServidor } from '@/lib/supabase/servidor';

export type UnidadVendible = {
  id: number;
  sku: string;
  especie: string;
  formato: string;
  corte: string;
  presentacion: string;
  /** «placas», «IQF», «bloque»… Es como se pide el producto por teléfono. */
  congelamiento: string;
  disponible_kg: number;
};

/** Desenvuelve las relaciones anidadas, que Supabase devuelve como listas. */
function primero<T>(v: unknown): T | undefined {
  return (Array.isArray(v) ? v[0] : v) as T | undefined;
}

export async function cargarCatalogoVenta() {
  const supabase = await crearClienteServidor();

  const [
    { data: clientes },
    { data: vendedores },
    { data: destinos },
    { data: listas },
    { data: unidades },
    { data: parametros },
    { data: disponibles },
  ] = await Promise.all([
    supabase
      .from('clientes')
      .select('id, razon_social, pais, moneda, bloqueado')
      .eq('activo', true)
      .order('razon_social'),
    supabase.from('vendedores').select('id, nombre').eq('activo', true).order('nombre'),
    supabase.from('destinos').select('id, puerto, pais').eq('activo', true).order('puerto'),
    supabase
      .from('listas_precio')
      .select('id, nombre, moneda, incoterm')
      .eq('activo', true)
      .order('vigente_desde', { ascending: false }),
    supabase
      .from('sku_presentaciones')
      .select('id, skus(codigo, corte, especies(nombre), formatos(nombre)), presentaciones(codigo, descripcion, congelamiento)')
      .eq('activo', true)
      .limit(600),
    supabase
      .from('parametros')
      .select('clave, valor')
      .in('clave', [
        'igv_porcentaje',
        'cotizacion_validez_dias',
        'tipo_cambio_referencial',
        'descuento_max_sin_autorizacion',
      ]),
    // La disponibilidad en una sola consulta agregada, no 360 individuales
    supabase.from('v_disponibilidad').select('sku_presentacion_id, disponible_kg'),
  ]);

  const stockPorUnidad = new Map<number, number>();
  for (const d of disponibles ?? []) {
    const id = Number(d.sku_presentacion_id);
    stockPorUnidad.set(id, (stockPorUnidad.get(id) ?? 0) + Number(d.disponible_kg ?? 0));
  }

  const catalogo: UnidadVendible[] = (unidades ?? []).map((u) => {
    const sku = primero<Record<string, unknown>>(u.skus);
    const esp = primero<Record<string, unknown>>(sku?.especies);
    const fmt = primero<Record<string, unknown>>(sku?.formatos);
    const pres = primero<Record<string, unknown>>(u.presentaciones);
    return {
      id: u.id as number,
      sku: String(sku?.codigo ?? ''),
      especie: String(esp?.nombre ?? ''),
      formato: String(fmt?.nombre ?? ''),
      corte: String(sku?.corte ?? ''),
      // El código de la presentación entra en el texto porque en el almacén
      // se refieren a ella así: «PLACAS20 KG#8», no «2 X 10 KG».
      presentacion: [pres?.descripcion, pres?.codigo].filter(Boolean).join(' · '),
      congelamiento: String(pres?.congelamiento ?? ''),
      disponible_kg: stockPorUnidad.get(u.id as number) ?? 0,
    };
  });

  const valor = (clave: string, defecto: number) =>
    Number((parametros ?? []).find((p) => p.clave === clave)?.valor ?? defecto);

  return {
    clientes: (clientes ?? []).map((c) => ({
      id: c.id as number,
      nombre: c.razon_social as string,
      pais: (c.pais as string) ?? '—',
      moneda: (c.moneda as string) ?? 'USD',
      bloqueado: Boolean(c.bloqueado),
    })),
    vendedores: (vendedores ?? []).map((v) => ({
      id: v.id as number,
      nombre: v.nombre as string,
    })),
    destinos: (destinos ?? []).map((d) => ({
      id: d.id as number,
      nombre: d.puerto as string,
      pais: d.pais as string,
    })),
    listas: (listas ?? []).map((l) => ({
      id: l.id as number,
      nombre: l.nombre as string,
      moneda: l.moneda as string,
      incoterm: l.incoterm as string,
    })),
    unidades: catalogo,
    igv: valor('igv_porcentaje', 18),
    validezDefecto: valor('cotizacion_validez_dias', 15),
    tipoCambioDefecto: valor('tipo_cambio_referencial', 3.75),
    topeDescuento: valor('descuento_max_sin_autorizacion', 3),
  };
}
