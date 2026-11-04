/**
 * ============================================================================
 *  MI FIRMA · la que sale en la proforma y en el contrato (083)
 * ============================================================================
 *  Oliver, reunión del 04/11: «si aprueba Walter sale la firma de Walter; si
 *  aprueba Cathy, puede salir la firma de Cathy». Cada usuario sube aquí su
 *  firma escaneada y su cargo. Firma quien APROBÓ la cotización (o quien
 *  registró el pedido, si no vino de una cotización); si esa persona no subió
 *  su firma, sale la de Gerencia de Configuración → Parámetros.
 *
 *  Gerencia ve además la lista de quienes aprueban cotizaciones y puede subir
 *  la firma por ellos: no todos van a hacerlo en persona.
 * ============================================================================
 */
import type { Metadata } from 'next';
import { obtenerUsuarioActual, crearClienteServidor } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel } from '@/components/ui/Pagina';
import { NOMBRE_ROL, type Rol } from '@/lib/navegacion';
import { FirmaUsuario } from './FirmaUsuario';

export const metadata: Metadata = { title: 'Mi firma' };
export const dynamic = 'force-dynamic';

export default async function PaginaFirma() {
  const usuario = await obtenerUsuarioActual();
  const supabase = await crearClienteServidor();
  const esGerencia = usuario?.rol === 'gerencia';

  const [{ data: mia }, { data: otros }] = await Promise.all([
    usuario
      ? supabase.from('firmas_usuario').select('firma, cargo').eq('usuario_id', usuario.id).maybeSingle()
      : Promise.resolve({ data: null }),
    /*
     * Gerencia: los demás que pueden aprobar o generar documentos con precio.
     * Se listan los que aprueban cotizaciones primero: son los que firman.
     */
    esGerencia
      ? supabase.from('usuarios').select('id, nombre, email, rol, aprueba_cotizaciones')
          .eq('activo', true).in('rol', ['gerencia', 'operaciones', 'comercial', 'comex'])
          .neq('id', usuario!.id)
          .order('aprueba_cotizaciones', { ascending: false }).order('nombre')
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  const ids = (otros ?? []).map((o) => String(o.id));
  const { data: firmasOtros } = ids.length
    ? await supabase.from('firmas_usuario').select('usuario_id, firma, cargo').in('usuario_id', ids)
    : { data: [] as Record<string, unknown>[] };
  const porUsuario = new Map((firmasOtros ?? []).map((f) => [String(f.usuario_id), f]));

  return (
    <>
      <CabeceraPagina
        titulo="Mi firma"
        descripcion={`${usuario?.nombre ?? ''} · ${usuario ? NOMBRE_ROL[usuario.rol as Rol] : ''} · la firma de la proforma y del contrato`}
      />

      <Panel titulo="Mi firma y mi cargo" className="mb-espacio">
        <div style={{ padding: '.9rem 1rem 1rem' }}>
          {usuario && (
            <FirmaUsuario
              usuarioId={usuario.id} nombre={usuario.nombre} propia
              firmaInicial={String(mia?.firma ?? '')} cargoInicial={String(mia?.cargo ?? '')}
            />
          )}
        </div>
      </Panel>

      {esGerencia && (otros ?? []).length > 0 && (
        <Panel titulo="Firmas del equipo · solo Gerencia" className="mb-espacio">
          <div style={{ padding: '.6rem 1rem 1rem', display: 'grid', gap: '1.2rem' }} data-bloque="firmas-equipo">
            {(otros ?? []).map((o) => {
              const f = porUsuario.get(String(o.id));
              return (
                <div key={String(o.id)} style={{ borderTop: '1px solid var(--linea)', paddingTop: '.8rem' }}>
                  <p style={{ margin: '0 0 .5rem' }}>
                    <strong>{String(o.nombre)}</strong>{' '}
                    <small style={{ color: 'var(--tinta-3)' }}>
                      {NOMBRE_ROL[o.rol as Rol]} · {String(o.email)}
                      {o.aprueba_cotizaciones ? ' · aprueba cotizaciones' : ''}
                    </small>
                  </p>
                  <FirmaUsuario
                    usuarioId={String(o.id)} nombre={String(o.nombre)} propia={false}
                    firmaInicial={String(f?.firma ?? '')} cargoInicial={String(f?.cargo ?? '')}
                  />
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      <p className="pie-explicativo">
        Firma la proforma y el contrato <b>quien aprobó la cotización</b> (si el pedido no vino de una
        cotización, quien lo registró). Si esa persona no subió su firma, sale la de Gerencia de
        Configuración → Parámetros. Suba la firma en <b>alta resolución</b> (escaneada a 300 ppp o una foto
        nítida), recortada al trazo y sobre fondo blanco o transparente, en PNG o JPG: el sistema la ajusta
        sola. Cada uno sube la suya; Gerencia puede subir la de cualquiera.
      </p>
    </>
  );
}
