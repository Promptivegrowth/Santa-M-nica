/**
 * ============================================================================
 *  CONTRATO DE LA PROFORMA
 * ============================================================================
 *  El contrato de venta internacional con el modelo institucional de Santa
 *  Mónica (observaciones de octubre, punto 8, y el Word que envió Oliver).
 *
 *  Arriba, los contratos ya generados con su PDF y su Word. Abajo, el
 *  siguiente —el primero o una revisión—, armado con la proforma, para
 *  revisarlo y generarlo.
 * ============================================================================
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel, Vacio } from '@/components/ui/Pagina';
import { Icono } from '@/components/estructura/Icono';
import { armarDatosContrato } from '@/lib/contratoVenta';
import { fechaHora } from '@/lib/formato';
import { puedeVender, type Rol } from '@/lib/navegacion';
import { uno } from '@/lib/relaciones';
import { EditorContrato } from './EditorContrato';
import { puedeDescargarDocumentos, motivoSinDescarga } from '../../../DocumentosApagados';
import { listaDeRoles } from '@/lib/permisosVentas';

export const metadata: Metadata = { title: 'Contrato' };
export const dynamic = 'force-dynamic';

export default async function PaginaContrato(props: PageProps<'/ventas/pedidos/[id]/contrato'>) {
  const { id } = await props.params;
  const pedidoId = Number(id);
  const supabase = await crearClienteServidor();
  const usuario = await obtenerUsuarioActual();

  const { data: ped } = await supabase
    .from('pedidos').select('id, numero_proforma, cotizacion_id, clientes(razon_social), cotizaciones(numero)')
    .eq('id', pedidoId).maybeSingle();
  if (!ped) notFound();

  const [{ data: generados }, armado] = await Promise.all([
    supabase.from('contratos')
      .select('id, numero, revision, generado_en, usuarios!contratos_generado_por_fkey(nombre)')
      .eq('pedido_id', pedidoId).order('revision', { ascending: false }),
    armarDatosContrato(supabase, pedidoId),
  ]);
  const puede = puedeVender((usuario?.rol ?? 'consulta') as Rol);
  const cot = uno<Record<string, unknown>>(ped.cotizaciones);

  /*
   * El contrato lleva precios (076): quien no descarga la proforma tampoco lo
   * abre. Antes Consulta llegaba aquí, leía «pulse Generar» y no tenía ese
   * botón. El acceso desde el pedido ya se le muestra apagado.
   */
  if (!puedeDescargarDocumentos(usuario?.rol)) {
    return (
      <>
        <CabeceraPagina
          titulo={`Contrato · ${ped.numero_proforma}`}
          volver={{ href: `/ventas/pedidos/${pedidoId}`, texto: `Volver a ${ped.numero_proforma}` }}
        />
        <Vacio titulo="El contrato no está disponible para su rol" mensaje={motivoSinDescarga(usuario?.rol)} />
      </>
    );
  }

  return (
    <>
      <CabeceraPagina
        titulo={`Contrato · ${ped.numero_proforma}`}
        descripcion={`${uno<Record<string, unknown>>(ped.clientes)?.razon_social ?? ''} · modelo institucional de Santa Mónica, en inglés y castellano`}
        volver={{ href: `/ventas/pedidos/${pedidoId}`, texto: `Volver a ${ped.numero_proforma}` }}
      />

      <Panel titulo={`Contratos generados · ${(generados ?? []).length}`} className="mb-espacio">
        {(generados ?? []).length === 0 ? (
          <Vacio
            titulo="Ninguno todavía"
            mensaje={puede
              ? 'Revise los datos de abajo y pulse «Generar».'
              : `Todavía no se generó ningún contrato. Lo generan ${listaDeRoles(['gerencia', 'operaciones', 'comercial', 'comex'])}.`}
          />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos" data-cuadro="contratos">
              <thead><tr><th>Número</th><th>Generado</th><th>Por</th><th>Descargar</th></tr></thead>
              <tbody>
                {(generados ?? []).map((g) => (
                  <tr key={g.id as number} data-contrato={g.numero as string}>
                    <td className="mono">{g.numero as string}{g.revision === (generados ?? [])[0]?.revision && (generados ?? []).length > 1 ? ' · vigente' : ''}</td>
                    <td className="num">{fechaHora(g.generado_en as string)}</td>
                    <td>{(uno<Record<string, unknown>>(g.usuarios)?.nombre as string) ?? '—'}</td>
                    <td>
                      <div className="acciones-fila">
                        <a href={`/api/contratos/${g.id}?formato=pdf`} className="btn btn-secundario btn-chico" data-descargar="pdf">
                          <Icono nombre="descargar" tamano={14} /> PDF
                        </a>
                        <a href={`/api/contratos/${g.id}?formato=word`} className="btn btn-secundario btn-chico" data-descargar="word">
                          <Icono nombre="descargar" tamano={14} /> Word
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {!armado.ok ? (
        <Vacio titulo="No se puede armar el contrato" mensaje={armado.mensaje} />
      ) : puede ? (
        <Panel titulo={armado.revision === 0 ? 'Revisar y generar' : 'Generar una revisión'} className="mb-espacio">
          <div style={{ padding: '.8rem 1rem 1rem' }}>
            <EditorContrato pedidoId={pedidoId} inicial={armado.datos} siguiente={armado.datos.numero} />
          </div>
        </Panel>
      ) : null}

      <p className="pie-explicativo">
        El contrato toma la cantidad, la tolerancia, el mes de embarque, el puerto y el adelanto de la
        proforma, y el comprador de la ficha del cliente.
        {ped.cotizacion_id && cot?.numero ? <> Viene de la cotización <Link href={`/ventas/cotizaciones/${ped.cotizacion_id}`}>{String(cot.numero)}</Link>.</> : null}
      </p>
    </>
  );
}
