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
 *
 *  REUNIÓN DEL 12/11 (089): Gerencia puede eliminar un despacho desde su
 *  ficha; aquí se avisa el resultado y se enlaza el historial de eliminados.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { rolPuedeVerRuta, type Rol } from '@/lib/navegacion';
import { CabeceraPagina, Panel, Vacio } from '@/components/ui/Pagina';
import { Icono } from '@/components/estructura/Icono';
import { cargarDespachos } from '@/lib/despachosDatos';
import { SelectorDespachos } from './SelectorDespachos';

export const metadata: Metadata = { title: 'Despachos' };
export const dynamic = 'force-dynamic';

export default async function PaginaDespachos(props: PageProps<'/logistica/despachos'>) {
  const q = await props.searchParams;
  const supabase = await crearClienteServidor();
  const [despachos, usuario] = await Promise.all([
    cargarDespachos(supabase, { limite: 150 }),
    obtenerUsuarioActual(),
  ]);
  /* El número de embarque se enlaza solo si el rol tiene Embarques. */
  const veEmbarques = rolPuedeVerRuta((usuario?.rol ?? 'consulta') as Rol, '/logistica/embarques');

  return (
    <>
      <CabeceraPagina
        titulo="Despachos"
        descripcion="Salidas ejecutadas. Cada una consumió su reserva y escribió la salida en el Kardex. Marque los que quiera gestionar —enteros o ítem por ítem— para sacar su Excel o su reporte de carga."
      >
        <Link href="/logistica/despachos/eliminados" className="btn btn-sutil" data-accion="ver-eliminados">
          <Icono nombre="papelera" tamano={15} />
          Despachos eliminados
        </Link>
      </CabeceraPagina>

      {typeof q.eliminado === 'string' && (
        <div className="ficha-aviso ficha-aviso-ok" role="status" data-aviso="despacho-eliminado">
          <Icono nombre="papelera" tamano={17} />
          <span>{q.eliminado} Queda en el historial de despachos eliminados con el motivo.</span>
        </div>
      )}

      <Panel titulo={`${despachos.length} despachos`}>
        {despachos.length === 0 ? (
          <Vacio titulo="Sin despachos" mensaje="Todavía no se ha ejecutado ningún despacho." />
        ) : (
          <SelectorDespachos despachos={despachos} veEmbarques={veEmbarques} />
        )}
      </Panel>
    </>
  );
}
