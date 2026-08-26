/**
 * ============================================================================
 *  NUEVA COTIZACIÓN
 * ============================================================================
 *  Esta pantalla carga en el servidor todos los catálogos que el formulario
 *  necesita —clientes, vendedores, destinos, listas de precio y el catálogo de
 *  productos con su disponibilidad— y se los entrega ya listos al formulario.
 *
 *  ¿Por qué así y no pidiéndolos desde el navegador?
 *  Porque el buscador de productos tiene que ser instantáneo. Si cada tecla
 *  disparara una consulta al servidor, escribir sería incómodo. En cambio se
 *  envía el catálogo una sola vez (unos 40 kB) y la búsqueda ocurre en el
 *  navegador, sin espera.
 *
 *  El PRECIO sí se consulta al servidor cada vez, porque depende del cliente y
 *  del volumen, y esa lógica debe vivir en un solo lugar: la base de datos.
 * ============================================================================
 */
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina } from '@/components/ui/Pagina';
import { FormularioCotizacion } from './FormularioCotizacion';
import { puedeVender, type Rol } from '@/lib/navegacion';

export const metadata: Metadata = { title: 'Nueva cotización' };
export const dynamic = 'force-dynamic';

export default async function PaginaNuevaCotizacion() {
  const usuario = await obtenerUsuarioActual();
  const rol = (usuario?.rol ?? 'consulta') as Rol;

  // Quien no puede vender no debería llegar aquí ni escribiendo la dirección
  if (!puedeVender(rol)) redirect('/ventas/cotizaciones');

  const supabase = await crearClienteServidor();

  const [
    { data: clientes },
    { data: vendedores },
    { data: destinos },
    { data: listas },
    { data: unidades },
    { data: parametros },
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
    // Catálogo de unidades vendibles con la disponibilidad ya sumada
    supabase
      .from('sku_presentaciones')
      .select('id, skus(codigo, corte, especies(nombre), formatos(nombre)), presentaciones(descripcion)')
      .eq('activo', true)
      .limit(600),
    supabase
      .from('parametros')
      .select('clave, valor')
      .in('clave', ['igv_porcentaje', 'cotizacion_validez_dias', 'tipo_cambio_referencial', 'descuento_max_sin_autorizacion']),
  ]);

  // La disponibilidad se pide aparte y se cruza en memoria: es una sola
  // consulta agregada en lugar de 360 consultas individuales.
  const { data: disponibles } = await supabase
    .from('v_disponibilidad')
    .select('sku_presentacion_id, disponible_kg');

  const stockPorUnidad = new Map<number, number>();
  for (const d of disponibles ?? []) {
    const id = Number(d.sku_presentacion_id);
    stockPorUnidad.set(id, (stockPorUnidad.get(id) ?? 0) + Number(d.disponible_kg ?? 0));
  }

  /** Desenvuelve las relaciones anidadas, que Supabase devuelve como listas. */
  const primero = <T,>(v: unknown): T | undefined =>
    (Array.isArray(v) ? v[0] : v) as T | undefined;

  const catalogo = (unidades ?? []).map((u) => {
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
      presentacion: String(pres?.descripcion ?? ''),
      disponible_kg: stockPorUnidad.get(u.id as number) ?? 0,
    };
  });

  const valor = (clave: string, defecto: number) =>
    Number((parametros ?? []).find((p) => p.clave === clave)?.valor ?? defecto);

  return (
    <>
      <CabeceraPagina
        titulo="Nueva cotización"
        descripcion="Una oferta, todavía sin compromiso de entrega. Elija el cliente, agregue productos y el sistema resuelve el precio que le corresponde según su volumen. Si el cliente acepta, con un botón se convierte en pedido con su número de proforma."
        volver={{ href: '/ventas/cotizaciones', texto: 'Volver a cotizaciones' }}
      />

      <FormularioCotizacion
        clientes={(clientes ?? []).map((c) => ({
          id: c.id as number,
          nombre: c.razon_social as string,
          pais: (c.pais as string) ?? '—',
          moneda: (c.moneda as string) ?? 'USD',
          bloqueado: Boolean(c.bloqueado),
        }))}
        vendedores={(vendedores ?? []).map((v) => ({ id: v.id as number, nombre: v.nombre as string }))}
        destinos={(destinos ?? []).map((d) => ({
          id: d.id as number,
          nombre: d.puerto as string,
          pais: d.pais as string,
        }))}
        listas={(listas ?? []).map((l) => ({
          id: l.id as number,
          nombre: l.nombre as string,
          moneda: l.moneda as string,
          incoterm: l.incoterm as string,
        }))}
        unidades={catalogo}
        igv={valor('igv_porcentaje', 18)}
        validezDefecto={valor('cotizacion_validez_dias', 15)}
        tipoCambioDefecto={valor('tipo_cambio_referencial', 3.75)}
        topeDescuento={valor('descuento_max_sin_autorizacion', 3)}
        puedeAutorizarDescuento={['gerencia', 'operaciones'].includes(rol)}
      />
    </>
  );
}
