/**
 * ============================================================================
 *  INGRESOS · lo que entró a cámara
 * ============================================================================
 *  Cada ingreso crea un LOTE y escribe la primera línea de su Kardex.
 *  A partir de ahí ese lote se puede rastrear durante toda su vida.
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, Etiqueta } from '@/components/ui/Pagina';
import { Listado } from '@/components/ui/Listado';
import { Icono } from '@/components/estructura/Icono';
import { tm, num, fechaHora } from '@/lib/formato';
import { veCostos, type Rol } from '@/lib/navegacion';

export const metadata: Metadata = { title: 'Ingresos' };
export const dynamic = 'force-dynamic';

export default async function PaginaIngresos(props: PageProps<'/almacenes/ingresos'>) {
  const q = await props.searchParams;
  const usuario = await obtenerUsuarioActual();
  const puedeVerCostos = veCostos((usuario?.rol ?? 'consulta') as Rol);
  const puedeRegistrar = ['gerencia', 'operaciones', 'almacen'].includes(usuario?.rol ?? '');

  return (
    <>
      <CabeceraPagina
        titulo="Ingresos a cámara"
        descripcion="Cada ingreso da de alta un lote y abre su Kardex. Es el punto de partida de toda la trazabilidad."
      >
        {puedeRegistrar && (
          <Link href="/almacenes/ingresos/nuevo" className="btn btn-primario">
            <Icono nombre="mas" tamano={15} />
            Registrar ingreso
          </Link>
        )}
      </CabeceraPagina>
      <Listado
        vista="v_kardex"
        ficha={{ base: '/almacenes/lotes', clave: 'lote_id', titulo: 'Ver el lote que ingresó' }}
        parametros={q as Record<string, string | undefined>}
        orden="fecha"
        titulo="Ingresos registrados"
        fijos={[{ columna: 'tipo', valor: 'ingreso' }]}
        filtros={[
          { tipo: 'texto', clave: 'buscar', etiqueta: 'Pallet o documento', ancho: '13rem' },
          { tipo: 'fecha', clave: 'desde', etiqueta: 'Desde' },
        ]}
        filtrosAplicados={[
          { clave: 'buscar', columna: 'codigo_pallet', operador: 'contiene',
            columnas: ['codigo_pallet', 'documento_ref', 'sku_codigo'] },
          { clave: 'desde', columna: 'fecha', operador: 'desde' },
        ]}
        columnas={[
          { clave: 'fecha', titulo: 'Fecha', numerica: true, render: (f) => fechaHora(f.fecha as string) },
          { clave: 'codigo_pallet', titulo: 'Pallet',
            render: (f) => (
              <Link href={`/trazabilidad?q=${encodeURIComponent(String(f.codigo_pallet))}`} className="enlace-dato">
                {String(f.codigo_pallet)}
              </Link>
            ) },
          { clave: 'sku_codigo', titulo: 'Producto',
            render: (f) => (
              <>
                <span className="mono" style={{ color: 'var(--tinta-3)' }}>{String(f.sku_codigo)}</span>{' '}
                {String(f.especie)} · {String(f.formato)}
                <br />
                <span style={{ color: 'var(--tinta-3)', fontSize: '.74rem' }}>{String(f.corte)}</span>
              </>
            ) },
          { clave: 'almacen', titulo: 'Almacén' },
          { clave: 'entrada_bultos', titulo: 'Bultos', numerica: true, render: (f) => num(Number(f.entrada_bultos)) },
          { clave: 'entrada_kg', titulo: 'Peso', numerica: true, render: (f) => `${tm(f.entrada_kg as number)} TM` },
          ...(puedeVerCostos ? [{
            clave: 'valor', titulo: 'Valor', numerica: true,
            render: (f: Record<string, unknown>) => num(Number(f.valor), 0),
          }] : []),
          { clave: 'motivo', titulo: 'Motivo',
            render: (f) => f.motivo ? <Etiqueta texto={String(f.motivo)} tono="ok" /> : '—' },
          { clave: 'usuario', titulo: 'Registró' },
        ]}
        vacio={{ titulo: 'Sin ingresos', mensaje: 'No hay ingresos con estos filtros.' }}
      />
    </>
  );
}
