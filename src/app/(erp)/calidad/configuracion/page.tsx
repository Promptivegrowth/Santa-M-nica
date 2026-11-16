/**
 * ============================================================================
 *  PORTAL Y RECLAMOS · configuración (090, propuesta COT-2026-11-253)
 * ============================================================================
 *  Lo que la propuesta deja «configurable sin programar»:
 *    · Motivos de reclamo y clasificaciones con su plazo (Calidad, Gerencia).
 *    · Plantillas de correo con la marca (Gerencia; Calidad las de reclamos).
 *    · Hitos de la línea de tiempo del portal (Gerencia).
 *    · La cuenta de seguimiento y su contraseña (Gerencia).
 *    · La auditoría de accesos al portal (Gerencia).
 *  El correo del Jefe de Calidad y las direcciones del portal y del ERP son
 *  parámetros: están en Configuración, grupo «Portal de clientes y reclamos».
 * ============================================================================
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { fechaHora } from '@/lib/formato';
import { VARIABLES_PLANTILLA } from '@/lib/reclamos';
import {
  EditorMotivos, EditorClasificaciones, EditorPlantillas, EditorHitos, CambiarClavePortal, type Plantilla,
} from './Editores';

export const metadata: Metadata = { title: 'Portal y reclamos' };
export const dynamic = 'force-dynamic';

const MOTIVO_INTENTO: Record<string, string> = {
  credenciales: 'Correo o contraseña incorrectos',
  limite_ip: 'Límite por IP',
  limite_codigo: 'Límite por Código Cliente',
  no_coincide: 'Los 3 datos no coinciden',
  bloqueo: '5.° fallo: bloqueo de 1 minuto',
  captcha: 'CAPTCHA incorrecto',
};

export default async function ConfiguracionPortal() {
  const usuario = await obtenerUsuarioActual();
  const rol = usuario?.rol ?? 'consulta';
  const esGerencia = rol === 'gerencia';
  const configuraReclamos = ['gerencia', 'calidad'].includes(rol);

  const supabase = await crearClienteServidor();
  const [{ data: motivos, error }, { data: clasificaciones }, { data: plantillas }, { data: hitos }, cuenta, intentos, { data: parametros }] = await Promise.all([
    supabase.from('reclamo_motivos').select('id, nombre_es, nombre_en, activo, orden').order('orden').order('id'),
    supabase.from('reclamo_clasificaciones').select('id, nombre, plazo_dias, activo, orden').order('orden').order('id'),
    supabase.from('plantillas_correo').select('clave, idioma, nombre, asunto, cuerpo').order('clave').order('idioma', { ascending: false }),
    supabase.from('portal_hitos').select('clave, vista, etiqueta_es, etiqueta_en, origen, orden, visible').order('vista', { ascending: false }).order('orden'),
    /* La función no deja pasar a Calidad: se pide solo para Gerencia. */
    esGerencia ? supabase.rpc('portal_cuenta_acceso') : Promise.resolve({ data: null }),
    esGerencia
      ? supabase.from('portal_intentos').select('id, creado_en, tipo, ip, codigo_cliente, numero_proforma, exito, motivo').order('creado_en', { ascending: false }).limit(100)
      : Promise.resolve({ data: null }),
    supabase.from('parametros').select('clave, etiqueta, valor').eq('grupo', 'portal').order('etiqueta'),
  ]);

  const datosCuenta = cuenta.data as { email: string; actualizado_en: string } | null;
  const filasIntentos = (intentos.data ?? []) as Record<string, string | boolean | null>[];

  const listaPlantillas: Plantilla[] = (plantillas ?? []).map((p) => ({
    clave: String(p.clave), idioma: String(p.idioma), nombre: String(p.nombre),
    asunto: String(p.asunto), cuerpo: String(p.cuerpo),
    puede: esGerencia || (rol === 'calidad' && String(p.clave).startsWith('reclamo')),
    variables: VARIABLES_PLANTILLA[String(p.clave)] ?? [],
  }));

  return (
    <>
      <CabeceraPagina
        titulo="Portal y reclamos"
        descripcion="Motivos y plazos de reclamo, plantillas de correo, hitos de la línea de tiempo y la cuenta de seguimiento del portal de clientes."
      />

      {error ? (
        <Vacio titulo="Todavía no está activado" mensaje="El portal de clientes necesita la migración 090 en la base. Avise a sistemas." />
      ) : (
        <>
          <div className="rejilla-2">
            <Panel titulo="Motivos de reclamo">
              <p style={{ padding: '0 1rem', fontSize: '.82rem', color: 'var(--tinta-2)' }}>
                La lista que elige el cliente en el portal. Un motivo desactivado deja de ofrecerse, pero los reclamos que ya lo usan lo conservan.
              </p>
              <EditorMotivos puede={configuraReclamos}
                motivos={(motivos ?? []).map((m) => ({ id: Number(m.id), nombre_es: String(m.nombre_es), nombre_en: String(m.nombre_en), activo: !!m.activo, orden: Number(m.orden) }))} />
            </Panel>
            <Panel titulo="Clasificaciones y plazos">
              <p style={{ padding: '0 1rem', fontSize: '.82rem', color: 'var(--tinta-2)' }}>
                Al clasificar un reclamo, su fecha límite es el día en que se registró más este plazo. Alimenta el semáforo de la bandeja.
              </p>
              <EditorClasificaciones puede={configuraReclamos}
                clasificaciones={(clasificaciones ?? []).map((c) => ({ id: Number(c.id), nombre: String(c.nombre), plazo_dias: Number(c.plazo_dias), activo: !!c.activo, orden: Number(c.orden) }))} />
            </Panel>
          </div>

          <Panel titulo="Plantillas de correo" className="mb-espacio">
            <p style={{ padding: '0 1rem', fontSize: '.82rem', color: 'var(--tinta-2)' }}>
              Cada correo en español y en inglés. {esGerencia ? 'Gerencia edita todas.' : 'Calidad edita las de reclamos; las de Comercial las edita Gerencia.'}
              {' '}Los correos de reclamos nunca llevan la Llave de seguimiento.
            </p>
            <EditorPlantillas plantillas={listaPlantillas} />
          </Panel>

          <Panel titulo="Hitos de la línea de tiempo del portal" className="mb-espacio">
            <p style={{ padding: '0 1rem', fontSize: '.82rem', color: 'var(--tinta-2)' }}>
              Cómo se llama cada hito para el cliente y si se muestra. La fecha sale sola del ERP (embarques, packing y despachos); el zarpe y la
              entrega los registra Operaciones en el embarque. {!esGerencia && 'Los edita Gerencia.'}
            </p>
            <EditorHitos puede={esGerencia}
              hitos={(hitos ?? []).map((h) => ({
                clave: String(h.clave), vista: String(h.vista), etiqueta_es: String(h.etiqueta_es), etiqueta_en: String(h.etiqueta_en),
                origen: String(h.origen), orden: Number(h.orden), visible: !!h.visible,
              }))} />
          </Panel>

          <div className="rejilla-2">
            <Panel titulo="Cuenta de seguimiento">
              <div style={{ padding: '1rem' }}>
                {esGerencia ? (
                  <>
                    <p style={{ margin: '0 0 .8rem' }}>
                      Correo de acceso: <strong className="mono">{datosCuenta?.email ?? '—'}</strong>
                      {datosCuenta?.actualizado_en && <><br /><small style={{ color: 'var(--tinta-3)' }}>Contraseña cambiada por última vez: {fechaHora(datosCuenta.actualizado_en)}</small></>}
                    </p>
                    <p style={{ fontSize: '.82rem', color: 'var(--tinta-2)', margin: '0 0 .8rem' }}>
                      Es la misma para todos los clientes y viaja en el correo de accesos. Al entrar, el cliente solo ve el cuadro de búsqueda; lo suyo lo
                      abre con su Código Cliente, N.° de proforma y Llave.
                    </p>
                    <CambiarClavePortal />
                  </>
                ) : (
                  <p style={{ margin: 0, fontSize: '.85rem' }}>La cuenta de seguimiento y su contraseña las administra Gerencia.</p>
                )}
              </div>
            </Panel>
            <Panel titulo="Correos y direcciones">
              <div style={{ padding: '1rem', fontSize: '.85rem' }}>
                <dl className="ficha-resumen" style={{ padding: 0 }}>
                  {(parametros ?? []).map((p) => (
                    <div key={p.clave}><dt>{p.etiqueta}</dt><dd className="mono" style={{ wordBreak: 'break-all' }}>{String(p.valor)}</dd></div>
                  ))}
                </dl>
                <p style={{ margin: '.8rem 0 0', color: 'var(--tinta-2)' }}>
                  Se cambian en {['gerencia', 'operaciones'].includes(rol)
                    ? <Link href="/configuracion" className="enlace-ficha">Configuración</Link>
                    : 'Configuración'}, grupo «Portal de clientes y reclamos». Los correos enviados se revisan en{' '}
                  <Link href="/correos" className="enlace-ficha">Correos enviados</Link>.
                </p>
              </div>
            </Panel>
          </div>

          {esGerencia && (
            <Panel titulo="Auditoría de accesos al portal · últimos 100" className="mb-espacio">
              {filasIntentos.length === 0 ? (
                <Vacio titulo="Sin accesos todavía" mensaje="Aquí quedan las entradas y búsquedas del portal, exitosas y fallidas. Nunca se guarda la Llave." />
              ) : (
                <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
                  <table className="datos" data-cuadro="auditoria-portal">
                    <thead><tr><th>Fecha</th><th>Tipo</th><th>Resultado</th><th>Código Cliente</th><th>Proforma</th><th>IP</th></tr></thead>
                    <tbody>
                      {filasIntentos.map((i) => (
                        <tr key={String(i.id)}>
                          <td style={{ whiteSpace: 'nowrap' }}>{fechaHora(String(i.creado_en))}</td>
                          <td>{i.tipo === 'login' ? 'Ingreso' : i.tipo === 'captcha' ? 'CAPTCHA' : 'Búsqueda'}</td>
                          <td>{i.exito
                            ? <Etiqueta texto="Correcto" tono="ok" />
                            : <Etiqueta texto={MOTIVO_INTENTO[String(i.motivo)] ?? String(i.motivo ?? 'Fallido')} tono={String(i.motivo).startsWith('limite') || i.motivo === 'bloqueo' ? 'critico' : 'atencion'} />}
                          </td>
                          <td className="mono">{String(i.codigo_cliente ?? '—')}</td>
                          <td className="mono">{String(i.numero_proforma ?? '—')}</td>
                          <td className="mono" style={{ fontSize: '.76rem' }}>{String(i.ip ?? '—')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          )}
        </>
      )}
    </>
  );
}
