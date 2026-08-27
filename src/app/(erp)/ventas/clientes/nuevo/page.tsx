/**
 * ============================================================================
 *  ALTA DE CLIENTE
 * ============================================================================
 *  El código se propone ya calculado —el siguiente libre— para que nadie tenga
 *  que ir a mirar cuál fue el último. Se puede cambiar.
 *
 *  La lista de países sale de los clientes que ya existen, no de un catálogo
 *  cerrado: si mañana se vende a un país nuevo, se escribe y ya está. El campo
 *  es un `datalist`, o sea que sugiere sin obligar.
 * ============================================================================
 */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel } from '@/components/ui/Pagina';
import { FormularioCliente } from '../FormularioCliente';
import { siguienteCodigoCliente } from '../acciones';

export const metadata: Metadata = { title: 'Nuevo cliente' };
export const dynamic = 'force-dynamic';

const PUEDEN = ['gerencia', 'operaciones', 'comercial'];

export default async function PaginaNuevoCliente() {
  const usuario = await obtenerUsuarioActual();
  if (!PUEDEN.includes(usuario?.rol ?? '')) redirect('/ventas/clientes');

  const supabase = await crearClienteServidor();
  const [codigo, { data: filas }, { data: vendedores }] = await Promise.all([
    siguienteCodigoCliente(),
    supabase.from('clientes').select('pais').eq('activo', true),
    supabase.from('vendedores').select('id, nombre').eq('activo', true).order('nombre'),
  ]);

  const paises = [...new Set((filas ?? []).map((f) => f.pais as string).filter(Boolean))].sort();

  return (
    <>
      <CabeceraPagina
        titulo="Nuevo cliente"
        descripcion="Los campos marcados con asterisco son los únicos obligatorios. El país y el RUC deciden qué comprobante se le emitirá, así que conviene ponerlos bien desde el principio."
      />
      <Panel>
        <FormularioCliente
          codigoPropuesto={codigo}
          paises={paises}
          vendedores={(vendedores ?? []).map((v) => ({ id: v.id as number, nombre: v.nombre as string }))}
        />
      </Panel>
    </>
  );
}
