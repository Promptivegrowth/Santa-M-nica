import Link from 'next/link';
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
import { Icono } from '@/components/estructura/Icono';
import { fecha, etiquetaEstado } from '@/lib/formato';
import { hoyEnLima } from '@/lib/fechas';
import { obtenerUsuarioActual } from '@/lib/supabase/servidor';

export const metadata: Metadata = { title: 'Embarques' };
export const dynamic = 'force-dynamic';

const TONO: Record<string, 'ok' | 'atencion' | 'info' | 'neutro' | 'critico'> = {
  despachado: 'ok', en_preparacion: 'atencion', confirmado: 'info',
  planificado: 'neutro', cancelado: 'critico',
};

export default async function PaginaEmbarques(props: PageProps<'/logistica/embarques'>) {
  const q = await props.searchParams;
  const usuario = await obtenerUsuarioActual();
  const puedeProgramar = ['gerencia', 'operaciones', 'comex', 'almacen']
    .includes(usuario?.rol ?? '');

  /*
   * Por defecto se ven las salidas de HOY EN ADELANTE.
   *
   * Sin este arranque la lista abría en febrero, con los embarques más viejos
   * —todos ya despachados— y lo de mañana a doscientas filas de distancia. La
   * pregunta que trae a alguien a esta pantalla es «qué sale ahora», no «qué
   * salió hace medio año».
   *
   * `verTodo` lo desactiva sin borrar el resto de filtros, para consultar el
   * histórico cuando de verdad hace falta.
   */
  const hoy = hoyEnLima();
  const verTodo = q.todo === '1';
  const parametros = {
    ...(q as Record<string, string | undefined>),
    desde: verTodo ? (q.desde as string | undefined) : ((q.desde as string) ?? hoy),
  };

  /** Conserva los filtros al alternar entre próximos e histórico. */
  function enlace(cambios: Record<string, string>) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) {
      if (typeof v === 'string' && v) p.set(k, v);
    }
    for (const [k, v] of Object.entries(cambios)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    const t = p.toString();
    return `/logistica/embarques${t ? '?' + t : ''}`;
  }

  return (
    <>
      <CabeceraPagina
        titulo="Embarques"
        descripcion="Cada embarque agrupa los pedidos que salen juntos. Un pedido grande puede repartirse en varios; varios pequeños pueden consolidarse en uno."
      >
        {puedeProgramar && (
          <Link href="/logistica/embarques/nuevo" className="btn btn-primario">
            <Icono nombre="mas" tamano={15} />
            Programar embarque
          </Link>
        )}
      </CabeceraPagina>

      {/* Qué se está viendo, y cómo cambiarlo */}
      <div className="atajos-fecha" style={{ padding: '0 0 .8rem' }}>
        <span>{verTodo ? 'Viendo todo el histórico.' : `Viendo las salidas desde el ${fecha(parametros.desde ?? hoy)}.`}</span>
        {verTodo ? (
          <Link href={enlace({ todo: '', desde: '' })}>Ver solo las próximas</Link>
        ) : (
          <Link href={enlace({ todo: '1', desde: '' })}>Ver también las pasadas</Link>
        )}
      </div>

      <Listado
        vista="embarques"
        ficha={{ base: '/logistica/embarques', titulo: 'Ver el embarque' }}
        parametros={parametros}
        orden="fecha_programada"
        /*
         * Ascendente: primero lo que sale ANTES.
         *
         * Con orden descendente, arriba quedaba lo que sale dentro de tres
         * semanas y lo de mañana caía al fondo de 190 filas. A logística le
         * importa lo que viene, no lo que está lejos.
         */
        ascendente
        titulo="Embarques programados"
        filtros={[
          { tipo: 'texto', clave: 'buscar', etiqueta: 'Número o booking', ancho: '12rem' },
          { tipo: 'select', clave: 'estado', etiqueta: 'Estado',
            opciones: Object.keys(TONO).map((e) => ({ valor: e, texto: etiquetaEstado(e) })) },
          { tipo: 'fecha', clave: 'desde', etiqueta: 'Sale desde' },
          { tipo: 'fecha', clave: 'hasta', etiqueta: 'Sale hasta' },
        ]}
        filtrosAplicados={[
          { clave: 'buscar', columna: 'numero', operador: 'contiene', columnas: ['numero', 'booking', 'naviera'] },
          { clave: 'estado', columna: 'estado', operador: 'igual' },
          { clave: 'desde', columna: 'fecha_programada', operador: 'desde' },
          { clave: 'hasta', columna: 'fecha_programada', operador: 'hasta' },
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
