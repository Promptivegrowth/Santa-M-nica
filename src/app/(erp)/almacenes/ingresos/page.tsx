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
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, Etiqueta } from '@/components/ui/Pagina';
import { Listado } from '@/components/ui/Listado';
import { Icono } from '@/components/estructura/Icono';
import { tm, num, fechaHora } from '@/lib/formato';
import { veCostos, type Rol } from '@/lib/navegacion';
import { PUEDEN_INGRESAR, PUEDEN_VALIDAR_IMPORTACION } from './tipos';

export const metadata: Metadata = { title: 'Ingresos' };
export const dynamic = 'force-dynamic';

export default async function PaginaIngresos(props: PageProps<'/almacenes/ingresos'>) {
  const q = await props.searchParams;
  const usuario = await obtenerUsuarioActual();
  const puedeVerCostos = veCostos((usuario?.rol ?? 'consulta') as Rol);
  const puedeRegistrar = (PUEDEN_INGRESAR as readonly string[]).includes(usuario?.rol ?? '');

  /* Lo que espera a alguien (074): ingresos programados por confirmar e
     importaciones listas para validar. Se cuentan para decirlo en los botones. */
  let programados = 0;
  let porValidar = 0;
  if (puedeRegistrar) {
    const supabase = await crearClienteServidor();
    const [a, b] = await Promise.all([
      supabase.from('ingresos_programados').select('id', { count: 'exact', head: true }).eq('estado', 'programado'),
      supabase.from('importaciones_excel').select('id', { count: 'exact', head: true }).eq('tipo', 'ingresos').eq('estado', 'lista'),
    ]);
    programados = a.count ?? 0;
    porValidar = b.count ?? 0;
  }
  const valida = (PUEDEN_VALIDAR_IMPORTACION as readonly string[]).includes(usuario?.rol ?? '');

  return (
    <>
      <CabeceraPagina
        titulo="Ingresos a cámara"
        descripcion="Cada ingreso da de alta un lote y abre su Kardex. Es el punto de partida de toda la trazabilidad."
      >
        {puedeRegistrar && (
          <Link href="/almacenes/ingresos/programados" className="btn btn-secundario" data-accion="ingresos-programados">
            <Icono nombre="reloj" tamano={15} />
            Ingresos programados{programados ? ` · ${programados}` : ''}
          </Link>
        )}
        {puedeRegistrar && (
          <Link href="/almacenes/ingresos/importar" className="btn btn-secundario" data-accion="importar-ingresos"
                title={valida && porValidar ? `${porValidar} importación(es) esperan su validación` : 'Cargar muchos pallets de una vez desde una plantilla de Excel'}>
            <Icono nombre="descargar" tamano={15} />
            Importar desde Excel{valida && porValidar ? ` · ${porValidar} por validar` : ''}
          </Link>
        )}
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
          //  Observaciones de octubre, punto 11: consultar por origen.
          { tipo: 'select', clave: 'origen', etiqueta: 'Origen',
            opciones: [{ valor: 'produccion', texto: 'Producción' }, { valor: 'compras', texto: 'Compras' }] },
          { tipo: 'fecha', clave: 'desde', etiqueta: 'Desde' },
        ]}
        filtrosAplicados={[
          { clave: 'buscar', columna: 'codigo_pallet', operador: 'contiene',
            columnas: ['codigo_pallet', 'documento_ref', 'sku_codigo'] },
          { clave: 'origen', columna: 'origen_ingreso', operador: 'igual' },
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
          { clave: 'origen_ingreso', titulo: 'Origen',
            render: (f) => f.origen_ingreso === 'compras'
              ? <span data-origen="compras"><Etiqueta texto="Compras" tono="info" />{f.proveedor ? <><br /><small style={{ color: 'var(--tinta-3)' }}>{String(f.proveedor)}</small></> : null}</span>
              : f.origen_ingreso === 'produccion'
                ? <span data-origen="produccion"><Etiqueta texto="Producción" tono="ok" /></span>
                : <span data-origen="sin" style={{ color: 'var(--tinta-3)', fontSize: '.74rem' }}>Sin clasificar</span> },
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
