/**
 * ============================================================================
 *  EDICIÓN DE PRODUCTO
 * ============================================================================
 *  OJO CON EL IDENTIFICADOR DE LA DIRECCIÓN
 *  Las fichas de producto se numeran por PRESENTACIÓN, no por SKU: la ficha
 *  «05 · 2 X 11 KG» y la ficha «05 · 4 X 6 KG» son dos direcciones distintas
 *  del mismo producto. Para que el enlace «Editar» de cualquiera de las dos
 *  funcione, aquí se acepta el identificador de la presentación y se resuelve
 *  a qué SKU pertenece.
 *
 *  Se edita el SKU entero, con todas sus presentaciones a la vez, porque es
 *  así como se piensa un producto: no se edita «la versión de 11 kilos».
 * ============================================================================
 */
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel } from '@/components/ui/Pagina';
import { FormularioProducto, type ProductoExistente, type Presentacion } from '../../FormularioProducto';
import { formatosDeEspecie, clasificacionesUsadas } from '../../accionesMaestro';

export const metadata: Metadata = { title: 'Editar producto' };
export const dynamic = 'force-dynamic';

const PUEDEN = ['gerencia', 'operaciones', 'comercial'];

export default async function PaginaEditarProducto(
  props: PageProps<'/ventas/productos/[id]/editar'>
) {
  const { id } = await props.params;
  const usuario = await obtenerUsuarioActual();
  if (!PUEDEN.includes(usuario?.rol ?? '')) redirect(`/ventas/productos/${id}`);

  const numero = Number(id);
  if (!Number.isFinite(numero)) notFound();

  const supabase = await crearClienteServidor();

  // El número de la dirección es el de la presentación: se traduce a su SKU.
  const { data: unidad } = await supabase
    .from('sku_presentaciones').select('sku_id').eq('id', numero).maybeSingle();
  if (!unidad) notFound();
  const skuId = unidad.sku_id as number;

  const [{ data: sku }, { data: especies }, { data: presentaciones }, { data: enlaces }] =
    await Promise.all([
      supabase.from('skus').select('*').eq('id', skuId).maybeSingle(),
      supabase.from('especies').select('id, nombre').eq('activo', true).order('nombre'),
      supabase.from('presentaciones').select('id, codigo, descripcion, peso_bulto_kg, congelamiento')
        .eq('activo', true).order('descripcion'),
      supabase.from('sku_presentaciones').select('presentacion_id, activo').eq('sku_id', skuId),
    ]);

  if (!sku) notFound();

  const [formatos, clasificaciones] = await Promise.all([
    formatosDeEspecie(sku.especie_id as number),
    clasificacionesUsadas(),
  ]);

  const datos: ProductoExistente = {
    id: sku.id as number,
    activo: Boolean(sku.activo),
    codigo: (sku.codigo as string) ?? '',
    especie_id: sku.especie_id as number,
    formato_id: sku.formato_id as number,
    corte: (sku.corte as string) ?? '',
    clasificacion_comercial: (sku.clasificacion_comercial as string) ?? '',
    empaque: (sku.empaque as 'sacos' | 'cajas' | 'block') ?? 'sacos',
    vida_util_meses: (sku.vida_util_meses as number) ?? null,
    presentaciones: (enlaces ?? [])
      .filter((e) => e.activo)
      .map((e) => e.presentacion_id as number),
  };

  return (
    <>
      <CabeceraPagina
        titulo={`Editar ${datos.codigo} · ${datos.corte}`}
        descripcion="Los cambios quedan en la bitácora. Las presentaciones que ya tienen lotes no se borran al quitarlas: se desactivan."
      />
      <Panel>
        <FormularioProducto
          producto={datos}
          especies={(especies ?? []).map((e) => ({ id: e.id as number, nombre: e.nombre as string }))}
          formatosIniciales={formatos}
          clasificaciones={clasificaciones}
          presentaciones={(presentaciones ?? []).map((p) => ({
            id: p.id as number,
            codigo: p.codigo as string,
            descripcion: p.descripcion as string,
            peso_bulto_kg: Number(p.peso_bulto_kg),
            congelamiento: p.congelamiento as string,
          })) as Presentacion[]}
        />
      </Panel>
    </>
  );
}
