/**
 * ============================================================================
 *  CONTRATO DE LA COTIZACIÓN (observaciones de octubre, punto 8)
 * ============================================================================
 *  Tres cosas en una pantalla:
 *    1. Los contratos ya generados, con su PDF.
 *    2. El contrato armado con los datos de la cotización, para revisarlo y
 *       generarlo.
 *    3. Para Gerencia, la plantilla institucional y los datos que sabe llenar.
 *
 *  Solo existe para cotizaciones APROBADAS: un contrato sobre un precio que
 *  nadie autorizó no tiene sentido.
 * ============================================================================
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel, Vacio } from '@/components/ui/Pagina';
import { Icono } from '@/components/estructura/Icono';
import { armarContrato, MARCADORES } from '@/lib/contrato';
import { fechaHora } from '@/lib/formato';
import { puedeVender, type Rol } from '@/lib/navegacion';
import { uno } from '@/lib/relaciones';
import { EditorContrato, EditorPlantilla } from './EditorContrato';

export const metadata: Metadata = { title: 'Contrato' };
export const dynamic = 'force-dynamic';

export default async function PaginaContrato(props: PageProps<'/ventas/cotizaciones/[id]/contrato'>) {
  const { id } = await props.params;
  const cotId = Number(id);
  const supabase = await crearClienteServidor();
  const usuario = await obtenerUsuarioActual();
  const rol = (usuario?.rol ?? 'consulta') as Rol;

  const { data: cot } = await supabase
    .from('cotizaciones').select('id, numero, estado, aprobada_en, clientes(razon_social)').eq('id', cotId).maybeSingle();
  if (!cot) notFound();

  const volver = { href: `/ventas/cotizaciones/${cotId}`, texto: `Volver a ${cot.numero}` };

  if (!cot.aprobada_en) {
    return (
      <>
        <CabeceraPagina titulo={`Contrato · ${cot.numero}`} volver={volver} />
        <Vacio
          titulo="Todavía no está aprobada"
          mensaje="El contrato se genera cuando la cotización está aprobada: es el precio autorizado lo que se firma."
        />
      </>
    );
  }

  const [{ data: generados }, armado, { data: plantilla }] = await Promise.all([
    supabase.from('contratos')
      .select('id, numero, titulo, generado_en, usuarios!contratos_generado_por_fkey(nombre)')
      .eq('cotizacion_id', cotId).order('generado_en', { ascending: false }),
    armarContrato(supabase, cotId),
    supabase.from('plantillas_documento').select('titulo, cuerpo').eq('clave', 'contrato_venta').maybeSingle(),
  ]);

  const puede = puedeVender(rol);

  return (
    <>
      <CabeceraPagina
        titulo={`Contrato · ${cot.numero}`}
        descripcion={`${uno<Record<string, unknown>>(cot.clientes)?.razon_social ?? ''} · se completa solo con los datos de la cotización aprobada`}
        volver={volver}
      />

      <Panel titulo={`Contratos generados · ${(generados ?? []).length}`} className="mb-espacio">
        {(generados ?? []).length === 0 ? (
          <Vacio titulo="Ninguno todavía" mensaje="Revise el texto de abajo y pulse «Generar contrato»." />
        ) : (
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos" data-cuadro="contratos">
              <thead><tr><th>Número</th><th>Título</th><th>Generado</th><th>Por</th><th>Descargar</th></tr></thead>
              <tbody>
                {(generados ?? []).map((g) => (
                  <tr key={g.id as number} data-contrato={g.numero as string}>
                    <td className="mono">{g.numero as string}</td>
                    <td>{g.titulo as string}</td>
                    <td className="num">{fechaHora(g.generado_en as string)}</td>
                    <td>{(uno<Record<string, unknown>>(g.usuarios)?.nombre as string) ?? '—'}</td>
                    <td>
                      <a href={`/api/contratos/${g.id}`} className="btn btn-secundario btn-chico" data-descargar="contrato">
                        <Icono nombre="descargar" tamano={14} /> PDF
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {puede && armado && (
        <Panel titulo="Revisar y generar" className="mb-espacio">
          <div style={{ padding: '.8rem 1rem 1rem' }}>
            <EditorContrato cotizacionId={cotId} titulo={armado.titulo} cuerpo={armado.cuerpo} sinResolver={armado.sinResolver} />
          </div>
        </Panel>
      )}

      {rol === 'gerencia' && plantilla && (
        <Panel titulo="Plantilla institucional" className="mb-espacio">
          <div style={{ padding: '.8rem 1rem 1rem' }}>
            <p className="pie-explicativo" style={{ marginTop: 0 }}>
              Es provisional hasta que llegue la plantilla oficial de Santa Mónica: péguela aquí y use
              los marcadores de la lista. Los contratos ya generados no cambian.
            </p>
            <div className="contrato-plantilla">
              <EditorPlantilla titulo={plantilla.titulo as string} cuerpo={plantilla.cuerpo as string} />
              <dl className="contrato-marcadores">
                {MARCADORES.map((m) => (
                  <div key={m.clave}><dt className="mono">{`{{${m.clave}}}`}</dt><dd>{m.que}</dd></div>
                ))}
              </dl>
            </div>
          </div>
        </Panel>
      )}

      <p className="pie-explicativo">
        <Link href={volver.href}>Volver a la cotización</Link>
      </p>
    </>
  );
}
