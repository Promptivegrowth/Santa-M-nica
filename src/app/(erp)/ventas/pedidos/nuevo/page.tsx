/**
 * ============================================================================
 *  NUEVO PEDIDO DIRECTO
 * ============================================================================
 *  El segundo camino para que nazca una proforma.
 *
 *  ¿Cuándo se usa? Cuando el cliente pide sin negociación previa: el habitual
 *  que ya conoce el precio y manda su orden de compra. Obligarle a Comex a
 *  inventarse una cotización para ese caso tendría dos efectos malos: una
 *  pantalla más que rellenar sin motivo, y un indicador de conversión que
 *  diría siempre 100 % y no serviría para nada.
 *
 *  ¿Cuándo NO se usa? Cuando hubo negociación. Ahí se crea la cotización,
 *  queda registro de la oferta, y si el cliente acepta se convierte con un
 *  botón. Así se puede medir cuántas ofertas se cierran y cuántas se pierden.
 * ============================================================================
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { proponerNumeroProforma } from '@/lib/numeroProformaServidor';
import { CabeceraPagina } from '@/components/ui/Pagina';
import { FormularioVenta } from '@/components/ventas/FormularioVenta';
import { cargarCatalogoVenta } from '@/lib/catalogoVenta';
import { puedeVender, type Rol } from '@/lib/navegacion';
import { puedeCotizar } from '@/lib/permisosVentas';

export const metadata: Metadata = { title: 'Nuevo pedido' };
export const dynamic = 'force-dynamic';

export default async function PaginaNuevoPedido(props: PageProps<'/ventas/pedidos/nuevo'>) {
  //  ?cliente=ID: se llega desde la ficha del cliente y ya viene elegido.
  const q = await props.searchParams;
  const clienteInicial = Number(q.cliente) || undefined;
  const usuario = await obtenerUsuarioActual();
  const rol = (usuario?.rol ?? 'consulta') as Rol;

  // Quien no puede vender no debería llegar aquí ni escribiendo la dirección
  if (!puedeVender(rol)) redirect('/ventas/pedidos');

  //  082 · El próximo número de proforma, propuesto en el formulario y editable.
  const [cat, numeroPropuesto] = await Promise.all([
    cargarCatalogoVenta(),
    crearClienteServidor().then(proponerNumeroProforma),
  ]);

  return (
    <>
      <CabeceraPagina
        titulo="Nuevo pedido"
        descripcion="Registra directamente el compromiso de entrega, sin pasar por cotización. El número de proforma viene propuesto y se puede cambiar por el que corresponda; ya registrado, se le puede reservar stock."
        volver={{ href: '/ventas/pedidos', texto: 'Volver a pedidos' }}
      />

      <div className="aviso-camino">
        <span aria-hidden style={{ fontSize: '1.1rem', lineHeight: 1 }}>💡</span>
        <span>
          <strong>Use esta pantalla cuando el cliente pide sin negociar.</strong> Si en cambio le
          está pasando un precio para que lo evalúe, empiece por una{' '}
          {/* Comex registra pedidos pero no entra a Cotizaciones: no se le ofrece el enlace. */}
          {puedeCotizar(rol)
            ? <Link href="/ventas/cotizaciones/nueva">cotización</Link>
            : <>cotización (la prepara Comercial)</>}{' '}
          y conviértala cuando acepte: así queda registro de la oferta y el sistema puede medir
          cuántas se cierran.
        </span>
      </div>

      <FormularioVenta
        modo="pedido"
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
        clienteInicial={clienteInicial}
        numeroPropuesto={numeroPropuesto}
      />
    </>
  );
}
