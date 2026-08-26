/**
 * ============================================================================
 *  EDITAR COTIZACIÓN
 * ============================================================================
 *  Corregir una oferta que todavía no cerró: cambió el precio acordado, el
 *  cliente pidió más volumen, se equivocaron de presentación.
 *
 *  Solo se llega aquí si la cotización está en borrador o enviada y NO generó
 *  pedido. Esa regla se comprueba tres veces —al pintar el botón, al abrir
 *  esta página y dentro de actualizarCotizacion()— porque una URL se puede
 *  escribir a mano y el servidor es el único sitio donde una regla es real.
 *
 *  Es el MISMO formulario que se usa para crear. Se le pasa el contenido
 *  actual y él sabe que debe actualizar en vez de insertar.
 * ============================================================================
 */
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina } from '@/components/ui/Pagina';
import { FormularioVenta, type DatosEdicion } from '@/components/ventas/FormularioVenta';
import { cargarCatalogoVenta } from '@/lib/catalogoVenta';
import { puedeVender, type Rol } from '@/lib/navegacion';

export const dynamic = 'force-dynamic';

export async function generateMetadata(
  props: PageProps<'/ventas/cotizaciones/[id]/editar'>
): Promise<Metadata> {
  const { id } = await props.params;
  return { title: `Editar cotización #${id}` };
}

export default async function PaginaEditarCotizacion(
  props: PageProps<'/ventas/cotizaciones/[id]/editar'>
) {
  const { id } = await props.params;
  const cotId = Number(id);

  const usuario = await obtenerUsuarioActual();
  const rol = (usuario?.rol ?? 'consulta') as Rol;
  if (!puedeVender(rol)) redirect(`/ventas/cotizaciones/${cotId}`);

  const supabase = await crearClienteServidor();

  const [{ data: cot }, { data: lineas }, { data: pedido }] = await Promise.all([
    supabase
      .from('cotizaciones')
      .select('id, numero, estado, cliente_id, vendedor_id, destino_id, lista_id, moneda, tipo_cambio, incoterm, validez_dias, observaciones')
      .eq('id', cotId)
      .single(),
    supabase
      .from('cotizacion_lineas')
      .select('sku_presentacion_id, cantidad_tm, precio_lista_tm, precio_tm, descuento_pct')
      .eq('cotizacion_id', cotId)
      .order('orden'),
    supabase.from('pedidos').select('id').eq('cotizacion_id', cotId).maybeSingle(),
  ]);

  if (!cot) notFound();

  /* ---- Las mismas dos reglas que aplica el servidor al guardar ---- */
  if (pedido) redirect(`/ventas/cotizaciones/${cotId}?nohayeditar=convertida`);
  if (!['borrador', 'enviada'].includes(cot.estado as string)) {
    redirect(`/ventas/cotizaciones/${cotId}?nohayeditar=${cot.estado}`);
  }

  const cat = await cargarCatalogoVenta();

  const edicion: DatosEdicion = {
    id: cot.id as number,
    numero: cot.numero as string,
    cliente_id: cot.cliente_id as number,
    vendedor_id: (cot.vendedor_id as number) ?? null,
    destino_id: (cot.destino_id as number) ?? null,
    lista_id: (cot.lista_id as number) ?? null,
    moneda: cot.moneda as 'USD' | 'PEN',
    tipo_cambio: Number(cot.tipo_cambio),
    incoterm: cot.incoterm as DatosEdicion['incoterm'],
    validez_dias: Number(cot.validez_dias ?? 15),
    observaciones: (cot.observaciones as string) ?? null,
    lineas: (lineas ?? []).map((l) => ({
      sku_presentacion_id: l.sku_presentacion_id as number,
      cantidad_tm: Number(l.cantidad_tm),
      precio_lista_tm: Number(l.precio_lista_tm),
      precio_tm: Number(l.precio_tm),
      descuento_pct: Number(l.descuento_pct),
    })),
  };

  return (
    <>
      <CabeceraPagina
        titulo={`Editar ${cot.numero}`}
        descripcion="Cambie lo que haga falta y guarde. Queda registrado en el historial de la cotización quién modificó qué y cuándo, así que siempre se puede reconstruir el precio que se ofreció en cada momento."
        volver={{ href: `/ventas/cotizaciones/${cotId}`, texto: `Volver a ${cot.numero}` }}
      />

      <div className="aviso-camino">
        <span aria-hidden style={{ fontSize: '1.1rem', lineHeight: 1 }}>✏️</span>
        <span>
          <strong>Está modificando una oferta ya emitida.</strong> Si el cliente recibió la versión
          anterior, conviene reenviársela después de guardar: el sistema conserva ambas versiones en
          el historial, pero el correo del cliente no.
        </span>
      </div>

      <FormularioVenta
        modo="cotizacion"
        edicion={edicion}
        clientes={cat.clientes}
        vendedores={cat.vendedores}
        destinos={cat.destinos}
        listas={cat.listas}
        unidades={cat.unidades}
        igv={cat.igv}
        validezDefecto={cat.validezDefecto}
        tipoCambioDefecto={cat.tipoCambioDefecto}
        topeDescuento={cat.topeDescuento}
        puedeAutorizarDescuento={['gerencia', 'operaciones'].includes(rol)}
      />
    </>
  );
}
