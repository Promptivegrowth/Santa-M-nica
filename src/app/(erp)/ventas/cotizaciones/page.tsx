/**
 * ============================================================================
 *  COTIZACIONES
 * ============================================================================
 *  La cotización es el paso anterior al pedido: se le ofrece un precio al
 *  cliente sin comprometerse todavía a entregar.
 *
 *  Cuando el cliente acepta, la cotización se convierte en pedido heredando
 *  cliente, precios, moneda e incoterm. Ese es el principio de reuso que pidió
 *  el cliente: nada se teclea dos veces.
 * ============================================================================
 */
import type { Metadata } from 'next';
import { CabeceraPagina, Etiqueta } from '@/components/ui/Pagina';
import { Listado } from '@/components/ui/Listado';
import { fecha, etiquetaEstado } from '@/lib/formato';

export const metadata: Metadata = { title: 'Cotizaciones' };
export const dynamic = 'force-dynamic';

const TONO: Record<string, 'ok' | 'atencion' | 'critico' | 'info' | 'neutro'> = {
  aceptada: 'ok', enviada: 'info', borrador: 'neutro', rechazada: 'critico', vencida: 'atencion',
};

export default async function PaginaCotizaciones(props: PageProps<'/ventas/cotizaciones'>) {
  const q = await props.searchParams;
  return (
    <>
      <CabeceraPagina
        titulo="Cotizaciones"
        descripcion="Precios ofrecidos a los clientes. Al aceptarse, la cotización pasa a pedido heredando todos sus datos."
      />
      <Listado
        vista="cotizaciones"
        parametros={q as Record<string, string | undefined>}
        orden="fecha"
        titulo="Cotizaciones emitidas"
        filtros={[
          { tipo: 'texto', clave: 'buscar', etiqueta: 'Número', ancho: '10rem' },
          { tipo: 'select', clave: 'estado', etiqueta: 'Estado',
            opciones: Object.keys(TONO).map((e) => ({ valor: e, texto: etiquetaEstado(e) })) },
          { tipo: 'fecha', clave: 'desde', etiqueta: 'Desde' },
        ]}
        filtrosAplicados={[
          { clave: 'buscar', columna: 'numero', operador: 'contiene' },
          { clave: 'estado', columna: 'estado', operador: 'igual' },
          { clave: 'desde', columna: 'fecha', operador: 'desde' },
        ]}
        columnas={[
          { clave: 'numero', titulo: 'Cotización', mono: true },
          { clave: 'fecha', titulo: 'Fecha', numerica: true, render: (f) => fecha(f.fecha as string) },
          { clave: 'moneda', titulo: 'Moneda', mono: true },
          { clave: 'incoterm', titulo: 'Incoterm', mono: true },
          { clave: 'validez_dias', titulo: 'Validez', numerica: true, render: (f) => `${f.validez_dias} días` },
          { clave: 'estado', titulo: 'Estado',
            render: (f) => <Etiqueta texto={etiquetaEstado(f.estado as string)} tono={TONO[f.estado as string] ?? 'neutro'} /> },
        ]}
        vacio={{ titulo: 'Sin cotizaciones', mensaje: 'No hay cotizaciones con estos filtros.' }}
      />
    </>
  );
}
