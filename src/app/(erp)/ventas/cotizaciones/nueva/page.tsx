/**
 * ============================================================================
 *  NUEVA COTIZACIÓN
 * ============================================================================
 *  El primero de los dos caminos hacia una proforma: la oferta previa.
 *
 *  Se usa cuando hay negociación: se le pasa un precio al cliente, él lo
 *  evalúa, y si acepta se convierte en pedido con un botón heredando todo.
 *  Ese registro es lo que permite medir cuántas ofertas se cierran y cuántas
 *  se pierden — un dato que hoy no existe en ninguna parte, porque la
 *  negociación ocurre por correo o WhatsApp y no queda en el sistema.
 *
 *  Si el cliente pide sin negociar, el camino corto es
 *  /ventas/pedidos/nuevo.
 * ============================================================================
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina } from '@/components/ui/Pagina';
import { FormularioVenta } from '@/components/ventas/FormularioVenta';
import { cargarCatalogoVenta } from '@/lib/catalogoVenta';
import { puedeVender, type Rol } from '@/lib/navegacion';

export const metadata: Metadata = { title: 'Nueva cotización' };
export const dynamic = 'force-dynamic';

export default async function PaginaNuevaCotizacion() {
  const usuario = await obtenerUsuarioActual();
  const rol = (usuario?.rol ?? 'consulta') as Rol;

  if (!puedeVender(rol)) redirect('/ventas/cotizaciones');

  const cat = await cargarCatalogoVenta();

  return (
    <>
      <CabeceraPagina
        titulo="Nueva cotización"
        descripcion="Una oferta, todavía sin compromiso de entrega. Elija el cliente, agregue productos y el sistema resuelve el precio que le corresponde según su volumen. Si el cliente acepta, con un botón se convierte en pedido con su número de proforma."
        volver={{ href: '/ventas/cotizaciones', texto: 'Volver a cotizaciones' }}
      />

      <div className="aviso-camino">
        <span aria-hidden style={{ fontSize: '1.1rem', lineHeight: 1 }}>💡</span>
        <span>
          <strong>Esto es una oferta, no un compromiso.</strong> No aparta stock y puede caducar sin
          consecuencias. Si el cliente ya pidió en firme y no hay nada que negociar, use{' '}
          <Link href="/ventas/pedidos/nuevo">nuevo pedido</Link> y se ahorra un paso.
        </span>
      </div>

      <FormularioVenta
        modo="cotizacion"
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
      />
    </>
  );
}
