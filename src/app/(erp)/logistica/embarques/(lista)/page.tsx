import Link from 'next/link';
/**
 * ============================================================================
 *  EMBARQUES · la programación de salidas, como su Excel («Obs. ERP 4», 10)
 * ============================================================================
 *  Un embarque agrupa uno o varios pedidos que salen juntos desde una bodega
 *  hacia un destino. Esta pantalla es la LISTA DE PROGRAMACIÓN: una fila por
 *  embarque con semana, despacho, zarpe, N.º de packing, booking, naviera,
 *  operador logístico, almacén… filtrable en cada columna y descargable en
 *  Excel y PDF. Oliver: «la vista que más vamos a usar es la lista».
 *
 *  Por defecto se ve desde el LUNES de la semana en curso: lo despachado el
 *  martes sigue a la vista hasta el domingo, y lo que viene, todo. «Ver
 *  también las pasadas» abre el histórico.
 * ============================================================================
 */
import type { Metadata } from 'next';
import { CabeceraPagina, Panel } from '@/components/ui/Pagina';
import { Icono } from '@/components/estructura/Icono';
import { hoyEnLima } from '@/lib/fechas';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { cargarProgramacion, rangoDeParametros } from '@/lib/programacionDatos';
import { PUEDEN_EMBARQUES, rolPuede } from '@/lib/permisosLogistica';
import { TablaProgramacion } from '../../TablaProgramacion';
import { NumeracionPacking } from './NumeracionPacking';

export const metadata: Metadata = { title: 'Embarques' };
export const dynamic = 'force-dynamic';

export default async function PaginaEmbarques(props: PageProps<'/logistica/embarques'>) {
  const q = (await props.searchParams) as Record<string, string | string[] | undefined>;
  const usuario = await obtenerUsuarioActual();
  const puedeProgramar = rolPuede(usuario?.rol, PUEDEN_EMBARQUES);
  const fijaNumeracion = rolPuede(usuario?.rol, ['gerencia', 'operaciones']);

  const hoy = hoyEnLima();
  const verTodo = q.todo === '1';
  const rango = rangoDeParametros({ ...q, vista: undefined }, hoy);

  const supabase = await crearClienteServidor();
  const [filas, { data: numeracion }] = await Promise.all([
    cargarProgramacion(supabase, { desde: rango.desde, hasta: rango.hasta }),
    supabase.rpc('estado_numeracion_packing'),
  ]);

  /** Conserva los filtros de columna al alternar entre próximos e histórico. */
  function enlace(cambios: Record<string, string>) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (typeof v === 'string' && v) p.set(k, v);
    for (const [k, v] of Object.entries(cambios)) { if (v) p.set(k, v); else p.delete(k); }
    const t = p.toString();
    return `/logistica/embarques${t ? '?' + t : ''}`;
  }

  const num = (numeracion ?? null) as { propuesto?: string; mayor_usado?: number | null; actualizado_en?: string | null; actualizado_por?: string | null } | null;

  return (
    <>
      <CabeceraPagina
        titulo="Embarques · programación"
        descripcion="Una fila por embarque, como su Excel: semana, despacho, zarpe, N.º de packing, booking, naviera, operador logístico y almacén. Filtre en cada columna y descargue lo que ve en Excel o PDF."
      >
        <Link href="/logistica/planificador" className="btn btn-secundario">
          <Icono nombre="planificador" tamano={15} />
          Ver en el calendario
        </Link>
        {puedeProgramar && (
          <Link href="/logistica/embarques/nuevo" className="btn btn-primario">
            <Icono nombre="mas" tamano={15} />
            Programar embarque
          </Link>
        )}
      </CabeceraPagina>

      <div className="atajos-fecha" style={{ padding: '0 0 .8rem', display: 'flex', flexWrap: 'wrap', gap: '.5rem 1rem', alignItems: 'center' }}>
        <span>{verTodo ? 'Viendo todo el histórico.' : 'Viendo desde el lunes de esta semana en adelante.'}</span>
        {verTodo ? (
          <Link href={enlace({ todo: '', desde: '' })}>Ver solo desde esta semana</Link>
        ) : (
          <Link href={enlace({ todo: '1', desde: '' })}>Ver también las pasadas</Link>
        )}
        {num?.propuesto && (
          <NumeracionPacking
            propuesto={num.propuesto}
            mayorUsado={num.mayor_usado ?? null}
            fijadoPor={num.actualizado_por ?? null}
            fijadoEn={num.actualizado_en ?? null}
            puede={fijaNumeracion}
          />
        )}
      </div>

      <Panel titulo="Programación de embarques">
        <TablaProgramacion filas={filas} descripcionRango={rango.descripcion} />
      </Panel>
    </>
  );
}
