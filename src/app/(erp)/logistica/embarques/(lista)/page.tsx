/**
 * ============================================================================
 *  EMBARQUES · la programación de salidas
 * ============================================================================
 *  Un embarque agrupa uno o varios pedidos que salen juntos desde una bodega
 *  hacia un destino. Esa flexibilidad es la que permite consolidar pedidos
 *  pequeños o dividir uno grande en varios contenedores.
 * ============================================================================
 */
import type { Metadata } from 'next';
import { CabeceraPagina, Etiqueta } from '@/components/ui/Pagina';
import { Listado } from '@/components/ui/Listado';
import { fecha, etiquetaEstado } from '@/lib/formato';

export const metadata: Metadata = { title: 'Embarques' };
export const dynamic = 'force-dynamic';

const TONO: Record<string, 'ok' | 'atencion' | 'info' | 'neutro' | 'critico'> = {
  despachado: 'ok', en_preparacion: 'atencion', confirmado: 'info',
  planificado: 'neutro', cancelado: 'critico',
};

export default async function PaginaEmbarques(props: PageProps<'/logistica/embarques'>) {
  const q = await props.searchParams;
  return (
    <>
      <CabeceraPagina
        titulo="Embarques"
        descripcion="Cada embarque agrupa los pedidos que salen juntos. Un pedido grande puede repartirse en varios; varios pequeños pueden consolidarse en uno."
      />
      <Listado
        vista="embarques"
        ficha={{ base: '/logistica/embarques', titulo: 'Ver el embarque' }}
        parametros={q as Record<string, string | undefined>}
        orden="fecha_programada"
        titulo="Embarques programados"
        filtros={[
          { tipo: 'texto', clave: 'buscar', etiqueta: 'Número o booking', ancho: '12rem' },
          { tipo: 'select', clave: 'estado', etiqueta: 'Estado',
            opciones: Object.keys(TONO).map((e) => ({ valor: e, texto: etiquetaEstado(e) })) },
          { tipo: 'fecha', clave: 'desde', etiqueta: 'Desde' },
        ]}
        filtrosAplicados={[
          { clave: 'buscar', columna: 'numero', operador: 'contiene', columnas: ['numero', 'booking', 'naviera'] },
          { clave: 'estado', columna: 'estado', operador: 'igual' },
          { clave: 'desde', columna: 'fecha_programada', operador: 'desde' },
        ]}
        columnas={[
          { clave: 'numero', titulo: 'Embarque', mono: true },
          { clave: 'fecha_programada', titulo: 'Fecha', numerica: true,
            render: (f) => fecha(f.fecha_programada as string) },
          { clave: 'booking', titulo: 'Booking', mono: true },
          { clave: 'naviera', titulo: 'Naviera' },
          { clave: 'tipo_despacho', titulo: 'Tipo',
            render: (f) => etiquetaEstado(String(f.tipo_despacho)) },
          { clave: 'estado', titulo: 'Estado',
            render: (f) => <Etiqueta texto={etiquetaEstado(String(f.estado))} tono={TONO[String(f.estado)] ?? 'neutro'} /> },
        ]}
        vacio={{ titulo: 'Sin embarques', mensaje: 'No hay embarques con estos filtros.' }}
      />
    </>
  );
}
