/**
 * ============================================================================
 *  ALTA DE INGRESO A CÁMARA
 * ============================================================================
 *  Trae todos los catálogos de una vez para que el formulario no tenga que
 *  pedir nada mientras se llena: quien registra treinta pallets seguidos no
 *  puede esperar a que carguen los desplegables en cada uno.
 *
 *  Los productos se ordenan por código, que es como se buscan en planta.
 * ============================================================================
 */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel } from '@/components/ui/Pagina';
import { FormularioIngreso, type OpcionProducto } from '../FormularioIngreso';
import { siguienteCodigoPallet } from '../acciones';
import { uno, campo } from '@/lib/relaciones';

export const metadata: Metadata = { title: 'Nuevo ingreso' };
export const dynamic = 'force-dynamic';

const PUEDEN = ['gerencia', 'operaciones', 'almacen'];

export default async function PaginaNuevoIngreso() {
  const usuario = await obtenerUsuarioActual();
  if (!PUEDEN.includes(usuario?.rol ?? '')) redirect('/almacenes/ingresos');

  const supabase = await crearClienteServidor();
  const [codigo, { data: unidades }, { data: almacenes }, { data: plantas }, { data: lineas }] =
    await Promise.all([
      siguienteCodigoPallet(),
      supabase
        .from('sku_presentaciones')
        .select('id, activo, skus(codigo, corte, activo, especies(nombre)), presentaciones(descripcion, peso_bulto_kg)')
        .eq('activo', true)
        .limit(1000),
      supabase.from('almacenes').select('id, nombre').eq('activo', true).order('nombre'),
      supabase.from('plantas').select('id, nombre').eq('activo', true).order('nombre'),
      supabase.from('lineas_procesadoras').select('id, nombre').eq('activo', true).order('nombre'),
    ]);

  const productos: OpcionProducto[] = (unidades ?? [])
    .filter((u) => {
      const sku = uno<Record<string, unknown>>(u.skus);
      return Boolean(sku?.activo);
    })
    .map((u) => {
      const sku = uno<Record<string, unknown>>(u.skus);
      const pres = uno<Record<string, unknown>>(u.presentaciones);
      return {
        id: u.id as number,
        codigo: campo(sku, 'codigo'),
        descripcion: `${campo(sku?.especies, 'nombre')} · ${campo(sku, 'corte')} · ${campo(pres, 'descripcion')}`,
        peso_bulto_kg: Number(pres?.peso_bulto_kg ?? 0),
      };
    })
    .sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));

  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });

  return (
    <>
      <CabeceraPagina
        titulo="Registrar ingreso a cámara"
        descripcion="Cada ingreso da de alta un pallet y abre su Kardex. Desde este momento el producto cuenta como stock y se puede reservar y vender."
        volver={{ href: '/almacenes/ingresos', texto: 'Volver a ingresos' }}
      />
      <Panel>
        <FormularioIngreso
          productos={productos}
          almacenes={(almacenes ?? []).map((a) => ({ id: a.id as number, nombre: a.nombre as string }))}
          plantas={(plantas ?? []).map((x) => ({ id: x.id as number, nombre: x.nombre as string }))}
          lineas={(lineas ?? []).map((x) => ({ id: x.id as number, nombre: x.nombre as string }))}
          codigoPropuesto={codigo}
          hoy={hoy}
        />
      </Panel>
    </>
  );
}
