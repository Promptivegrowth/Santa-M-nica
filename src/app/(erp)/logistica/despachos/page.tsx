/**
 * ============================================================================
 *  DESPACHOS · lo que ya salió
 * ============================================================================
 *  Decisión de Marco León en la reunión: la venta TERMINA cuando el producto
 *  sale del almacén. No hay distribución secundaria.
 *
 *  Por eso el despacho es el hecho que cierra el ciclo: consume la reserva,
 *  escribe la salida en el Kardex y habilita la facturación.
 *
 *  OBSERVACIONES DE OCTUBRE
 *   · Punto 14: un selector para elegir qué despachos —o qué ítems de un
 *     despacho— se gestionan: Excel o reporte de carga de lo elegido.
 *   · Puntos 15 y 17: cada despacho tiene ficha, con su guía final en PDF y
 *     las fotos de la carga.
 * ============================================================================
 */
import type { Metadata } from 'next';
import { crearClienteServidor } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel, Vacio } from '@/components/ui/Pagina';
import { cargarDespachos } from '@/lib/despachosDatos';
import { SelectorDespachos } from './SelectorDespachos';

export const metadata: Metadata = { title: 'Despachos' };
export const dynamic = 'force-dynamic';

export default async function PaginaDespachos() {
  const supabase = await crearClienteServidor();
  const despachos = await cargarDespachos(supabase, { limite: 150 });

  return (
    <>
      <CabeceraPagina
        titulo="Despachos"
        descripcion="Salidas ejecutadas. Cada una consumió su reserva y escribió la salida en el Kardex. Marque los que quiera gestionar —enteros o ítem por ítem— para sacar su Excel o su reporte de carga."
      />

      <Panel titulo={`${despachos.length} despachos`}>
        {despachos.length === 0 ? (
          <Vacio titulo="Sin despachos" mensaje="Todavía no se ha ejecutado ningún despacho." />
        ) : (
          <SelectorDespachos despachos={despachos} />
        )}
      </Panel>
    </>
  );
}
