/**
 * ============================================================================
 *  EDITAR COTIZACIÓN
 * ============================================================================
 *  Corregir una oferta que todavía no cerró: cambió el precio acordado, el
 *  cliente pidió más volumen, se equivocaron de presentación.
 *
 *  Solo se llega aquí si la cotización está en borrador, aprobada o enviada y
 *  NO generó pedido. Esa regla se comprueba tres veces —al pintar el botón,
 *  al abrir esta página y dentro de actualizarCotizacion()— porque una URL se
 *  puede escribir a mano y el servidor es el único sitio donde una regla es
 *  real. (Antes el botón de la ficha se ofrecía en una aprobada, pero esta
 *  página la rebotaba sin decir nada: lo encontró la revisión de la Guía.)
 *
 *  Si la cotización ya tiene la aprobación, se avisa ANTES de tocar nada que
 *  un cambio comercial la anula al guardar (lo decide el servidor).
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
import { type Rol } from '@/lib/navegacion';
import { puedeCotizar } from '@/lib/permisosVentas';
import { aprobacionObligatoria } from '../../acciones';
import { fechaHora } from '@/lib/formato';
import { campo } from '@/lib/relaciones';

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
  if (!puedeCotizar(rol)) redirect(`/ventas/cotizaciones/${cotId}`);

  const supabase = await crearClienteServidor();

  const [{ data: cot }, { data: lineas }, { data: pedido }, { data: cuentas }, exigeAprobacion] = await Promise.all([
    supabase
      .from('cotizaciones')
      .select('aprobada_en, aprobador:usuarios!cotizaciones_aprobada_por_fkey(nombre), id, numero, estado, cliente_id, vendedor_id, destino_id, lista_id, moneda, tipo_cambio, incoterm, validez_dias, prioridad, observaciones, contacto_id, contacto_nombre, contacto_cargo, contacto_telefono, contacto_email, tipo_cambio_fecha, tipo_cambio_fuente, tipo_cambio_clase, fecha_tentativa_despacho, forma_pago, adelanto_pct, adelanto_abonado, adelanto_abonado_en')
      .eq('id', cotId)
      .single(),
    supabase
      .from('cotizacion_lineas')
      .select('sku_presentacion_id, cantidad_tm, precio_lista_tm, precio_tm, descuento_pct, descuento_autorizado_por')
      .eq('cotizacion_id', cotId)
      .order('orden'),
    supabase.from('pedidos').select('id').eq('cotizacion_id', cotId).maybeSingle(),
    supabase.from('cotizacion_cuentas').select('cuenta_id').eq('cotizacion_id', cotId),
    aprobacionObligatoria(),
  ]);

  if (!cot) notFound();

  /* ---- Las mismas dos reglas que aplica el servidor al guardar ---- */
  if (pedido) redirect(`/ventas/cotizaciones/${cotId}?nohayeditar=convertida`);
  if (!['borrador', 'aprobada', 'enviada'].includes(cot.estado as string)) {
    redirect(`/ventas/cotizaciones/${cotId}?nohayeditar=${cot.estado}`);
  }

  const cat = await cargarCatalogoVenta();

  /* ¿Guardar un cambio comercial anularía la aprobación? La misma regla que el servidor. */
  const conFirma = exigeAprobacion && (Boolean(cot.aprobada_en) || ['aprobada', 'enviada'].includes(cot.estado as string));

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
    prioridad: (cot.prioridad as 'baja' | 'normal' | 'alta' | 'urgente') ?? 'normal',
    observaciones: (cot.observaciones as string) ?? null,
    //  Observaciones de octubre: tipo de cambio, entrega y pago, tal como se guardaron.
    tipo_cambio_fecha: (cot.tipo_cambio_fecha as string) ?? null,
    tipo_cambio_fuente: (cot.tipo_cambio_fuente as 'sunat' | 'manual') ?? null,
    tipo_cambio_clase: (cot.tipo_cambio_clase as 'compra' | 'venta') ?? null,
    fecha_tentativa_despacho: (cot.fecha_tentativa_despacho as string) ?? null,
    forma_pago: (cot.forma_pago as DatosEdicion['forma_pago']) ?? null,
    adelanto_pct: Number(cot.adelanto_pct ?? 0),
    adelanto_abonado: cot.adelanto_abonado === null || cot.adelanto_abonado === undefined ? null : Number(cot.adelanto_abonado),
    adelanto_abonado_en: (cot.adelanto_abonado_en as string) ?? null,
    // Se recupera tal cual estaba: al reabrir un documento no se le cambia el
    // contacto por debajo, porque quizá ya se envió con ese.
    contacto: {
      id: (cot.contacto_id as number) ?? null,
      nombre: (cot.contacto_nombre as string) ?? '',
      cargo: (cot.contacto_cargo as string) ?? '',
      telefono: (cot.contacto_telefono as string) ?? '',
      email: (cot.contacto_email as string) ?? '',
    },
    cuentas: (cuentas ?? []).map((c) => Number(c.cuenta_id)),
    lineas: (lineas ?? []).map((l) => ({
      sku_presentacion_id: l.sku_presentacion_id as number,
      cantidad_tm: Number(l.cantidad_tm),
      precio_lista_tm: Number(l.precio_lista_tm),
      precio_tm: Number(l.precio_tm),
      descuento_pct: Number(l.descuento_pct),
      //  Un descuento ya autorizado se respeta mientras no se suba (lo decide el servidor).
      descuento_autorizado_pct: l.descuento_autorizado_por ? Number(l.descuento_pct) : null,
    })),
  };

  return (
    <>
      <CabeceraPagina
        titulo={`Editar ${cot.numero}`}
        descripcion="Cambie lo que haga falta y guarde. Queda registrado en el historial de la cotización quién modificó qué y cuándo, así que siempre se puede reconstruir el precio que se ofreció en cada momento."
        volver={{ href: `/ventas/cotizaciones/${cotId}`, texto: `Volver a ${cot.numero}` }}
      />

      {/*
        EL AVISO DE LA APROBACIÓN, antes de tocar nada. Es la regla que
        aplica el servidor al guardar: aquí solo se anuncia.
      */}
      {conFirma && (
        <div className="ficha-aviso ficha-aviso-atencion" role="status" data-aviso="anula-aprobacion">
          <span aria-hidden style={{ fontSize: '1.1rem', lineHeight: 1 }}>⚠️</span>
          <span>
            <strong>
              Esta cotización está {cot.estado === 'enviada' ? 'enviada' : 'aprobada'}
              {cot.aprobada_en ? ` (la aprobó ${campo(cot.aprobador, 'nombre', 'quien aprueba cotizaciones')} el ${fechaHora(cot.aprobada_en as string)})` : ''}.
            </strong>{' '}
            Si al guardar cambia algo comercial —productos, cantidades, precios, descuentos, moneda,
            incoterm, forma de pago o % de adelanto, destino o cliente—, <strong>la aprobación se
            anula</strong>: la cotización vuelve a borrador y habrá que aprobarla otra vez antes de
            enviarla. Corregir observaciones, contacto, cuentas, vendedor, validez o prioridad la
            conserva.
          </span>
        </div>
      )}

      {cot.estado === 'enviada' && (
        <div className="aviso-camino">
          <span aria-hidden style={{ fontSize: '1.1rem', lineHeight: 1 }}>✏️</span>
          <span>
            <strong>Está modificando una oferta ya enviada.</strong> Si el cliente recibió la versión
            anterior, conviene reenviársela después de guardar: el sistema conserva ambas versiones en
            el historial, pero el correo del cliente no.
          </span>
        </div>
      )}

      <FormularioVenta
        modo="cotizacion"
        edicion={edicion}
        clientes={cat.clientes}
        vendedores={cat.vendedores}
        destinos={cat.destinos}
        listas={cat.listas}
        unidades={cat.unidades}
        contactos={cat.contactos}
        cuentas={cat.cuentas}
        igv={cat.igv}
        validezDefecto={cat.validezDefecto}
        tipoCambioDefecto={cat.tipoCambioDefecto}
        topeDescuento={cat.topeDescuento}
        puedeAutorizarDescuento={['gerencia', 'operaciones'].includes(rol)}
        plazos={cat.plazos}
      />
    </>
  );
}
