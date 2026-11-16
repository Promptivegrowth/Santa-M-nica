/**
 * ============================================================================
 *  PESTAÑA «PORTAL DEL CLIENTE» · llave de seguimiento y envíos (M1, M3, M7)
 * ============================================================================
 *  La llave nace sola con la proforma (trigger de la migración 090). Aquí se
 *  ve enmascarada —solo sus 4 últimos caracteres—, se envían los accesos al
 *  representante del cliente desde comex@, se revisa «como cliente» lo que
 *  verá en el portal y queda el registro de cada envío.
 * ============================================================================
 */
import Link from 'next/link';
import { crearClienteServidor } from '@/lib/supabase/servidor';
import { Panel, Vacio } from '@/components/ui/Pagina';
import { EnviosDocumento } from '@/components/ventas/EnviosDocumento';
import { fechaHora } from '@/lib/formato';
import { listaCorreos, correosInvalidos, CORREO_CONFIGURADO } from '@/lib/correo';
import { uno } from '@/lib/relaciones';
import type { Rol } from '@/lib/navegacion';
import { EnviarAccesos, RegenerarLlave } from './AccesosPortal';

const ENVIAN_ACCESOS: Rol[] = ['gerencia', 'operaciones', 'comercial', 'comex'];
const VEN_COMO_CLIENTE: Rol[] = ['gerencia', 'operaciones', 'comercial', 'comex', 'calidad'];

export async function PestanaPortal({ pedidoId, numero, rol }: { pedidoId: number; numero: string; rol: Rol }) {
  const supabase = await crearClienteServidor();
  const [{ data: info, error }, { data: pedido }] = await Promise.all([
    supabase.rpc('pedido_llave_info', { p_pedido_id: pedidoId }),
    supabase.from('pedidos').select('cliente_id, contacto_email, clientes(codigo, pais, email)').eq('id', pedidoId).single(),
  ]);
  const cliente = uno<Record<string, string | null>>(pedido?.clientes);
  const { data: contactos } = pedido
    ? await supabase.from('contactos').select('email, principal').eq('cliente_id', pedido.cliente_id).eq('activo', true)
    : { data: [] };
  const principal = (contactos ?? []).filter((c) => c.principal).map((c) => String(c.email ?? ''));
  const destinatarios = listaCorreos([
    String(pedido?.contacto_email ?? ''),
    ...principal,
    ...(!pedido?.contacto_email && !principal.length ? [cliente?.email ?? ''] : []),
  ]).filter((c) => !correosInvalidos([c]).length);
  const pais = (cliente?.pais ?? '').trim();
  const idioma: 'es' | 'en' = !pais || /^per[uú]$/i.test(pais) ? 'es' : 'en';

  const llave = info as { mascara: string; generada_en: string; regenerada_veces: number; envios: number; ultimo_envio: string | null } | null;
  const puedeEnviar = ENVIAN_ACCESOS.includes(rol);

  return (
    <>
      <div className="rejilla-2">
        <Panel titulo="Llave de seguimiento">
          {error ? (
            <Vacio titulo="No se pudo leer la llave" mensaje={error.message} />
          ) : !llave ? (
            <Vacio titulo="Esta proforma aún no tiene llave" mensaje="Se genera sola al enviar los accesos." />
          ) : (
            <dl className="ficha" data-bloque="llave">
              <div><dt>Código Cliente</dt><dd className="mono">{cliente?.codigo ?? '—'}</dd></div>
              <div><dt>N.° de proforma</dt><dd className="mono">{numero}</dd></div>
              <div><dt>Llave</dt><dd className="mono" data-llave-mascara>{llave.mascara}</dd></div>
              <div><dt>Generada</dt><dd>{fechaHora(llave.generada_en)}{llave.regenerada_veces > 0 && ` · regenerada ${llave.regenerada_veces} ${llave.regenerada_veces === 1 ? 'vez' : 'veces'}`}</dd></div>
              <div><dt>Accesos enviados</dt><dd>{llave.envios ? `${llave.envios} · último ${fechaHora(llave.ultimo_envio)}` : 'Todavía no'}</dd></div>
            </dl>
          )}
          <p style={{ fontSize: '.8rem', color: 'var(--tinta-3)', margin: '.75rem 1rem' }}>
            La llave es única, no caduca y no se imprime en la proforma: solo viaja en el correo de accesos.
            {!CORREO_CONFIGURADO() && ' El envío de correos aún no está configurado: los correos quedan registrados como «simulado» y no salen.'}
          </p>
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', padding: '0 1rem 1rem' }}>
            {puedeEnviar && (
              <EnviarAccesos
                pedidoId={pedidoId}
                numero={numero}
                destinatarios={destinatarios}
                idiomaSugerido={idioma}
                yaEnviado={(llave?.envios ?? 0) > 0}
              />
            )}
            {VEN_COMO_CLIENTE.includes(rol) && (
              <Link href={`/ventas/pedidos/${pedidoId}/portal?idioma=${idioma}`} className="btn btn-secundario" data-enlace="ver-como-cliente">
                Ver como cliente
              </Link>
            )}
            {rol === 'gerencia' && <RegenerarLlave pedidoId={pedidoId} />}
          </div>
        </Panel>

        <Panel titulo="Cómo lo verá el cliente">
          <ol style={{ margin: '.75rem 1rem 1rem 2.2rem', padding: 0, listStyle: 'decimal', fontSize: '.84rem', lineHeight: 1.55, color: 'var(--tinta-2)' }}>
            <li>Recibe desde comex@ el correo con su Código Cliente, el N.° de proforma, la Llave, la cuenta de seguimiento, la contraseña y el enlace.</li>
            <li>Entra al portal con la cuenta de seguimiento: solo ve un cuadro de búsqueda.</li>
            <li>Escribe los 3 datos (5 fallos = bloqueo de 1 minuto).</li>
            <li>Ve el avance de la proforma o la línea de tiempo de cada contenedor, sin montos.</li>
            <li>Puede generar un reclamo con evidencia, que llega a la bandeja de Calidad.</li>
          </ol>
        </Panel>
      </div>

      <EnviosDocumento entidad="pedidos" entidadId={pedidoId} tipos={['accesos', 'proforma']}
                       titulo="Correos de esta proforma (accesos y PDF)" />
    </>
  );
}
