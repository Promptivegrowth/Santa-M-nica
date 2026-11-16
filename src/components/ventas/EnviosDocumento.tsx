/**
 * ============================================================================
 *  REGISTRO DE ENVÍOS DE UN DOCUMENTO · quién, cuándo, a quién y cómo salió
 * ============================================================================
 *  Lee correos_salida (migración 090) con la sesión del usuario: cada rol ve
 *  lo que su política le permite. El texto registrado nunca lleva la Llave.
 * ============================================================================
 */
import { crearClienteServidor } from '@/lib/supabase/servidor';
import { Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { fechaHora } from '@/lib/formato';

const TONO: Record<string, 'ok' | 'atencion' | 'critico'> = { enviado: 'ok', simulado: 'atencion', error: 'critico' };
const TEXTO: Record<string, string> = { enviado: 'Enviado', simulado: 'Simulado (sin configurar)', error: 'Error' };
const TIPO: Record<string, string> = { accesos: 'Accesos al portal', proforma: 'Proforma', cotizacion: 'Cotización' };

export async function EnviosDocumento({
  entidad,
  entidadId,
  tipos,
  titulo = 'Envíos de este documento',
}: {
  entidad: 'pedidos' | 'cotizaciones';
  entidadId: number;
  tipos: string[];
  titulo?: string;
}) {
  const supabase = await crearClienteServidor();
  const { data: envios, error } = await supabase
    .from('correos_salida')
    .select('id, tipo, para, cc, asunto, estado, error, enviado_por_nombre, creado_en')
    .eq('entidad', entidad).eq('entidad_id', entidadId).in('tipo', tipos)
    .order('creado_en', { ascending: false }).limit(50);

  return (
    <Panel titulo={titulo} id="envios">
      {error ? (
        <Vacio titulo="No se pudo leer el registro de envíos" mensaje={error.message} />
      ) : !envios?.length ? (
        <Vacio titulo="Todavía no se ha enviado por correo" mensaje="Cada envío queda aquí: fecha, destinatarios, quién lo envió y si salió." />
      ) : (
        <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
          <table data-tabla="envios">
            <thead>
              <tr><th>Fecha</th><th>Correo</th><th>Destinatarios</th><th>Enviado por</th><th>Estado</th></tr>
            </thead>
            <tbody>
              {envios.map((e) => (
                <tr key={e.id}>
                  <td className="mono">{fechaHora(e.creado_en as string)}</td>
                  <td>{TIPO[e.tipo as string] ?? e.tipo}<br /><small style={{ color: 'var(--tinta-3)' }}>{e.asunto as string}</small></td>
                  <td>
                    {(e.para as string[]).join(', ')}
                    {(e.cc as string[])?.length > 0 && <><br /><small style={{ color: 'var(--tinta-3)' }}>cc: {(e.cc as string[]).join(', ')}</small></>}
                  </td>
                  <td>{e.enviado_por_nombre as string}</td>
                  <td>
                    <Etiqueta texto={TEXTO[e.estado as string] ?? String(e.estado)} tono={TONO[e.estado as string] ?? 'neutro'} />
                    {e.error && <><br /><small style={{ color: 'var(--critico)' }}>{e.error as string}</small></>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
