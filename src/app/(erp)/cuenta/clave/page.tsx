/**
 * ============================================================================
 *  CAMBIAR MI CONTRASEÑA
 * ============================================================================
 *  Para todos los roles. Es la pantalla a la que el sistema manda a quien
 *  entra con una contraseña temporal (la que puso Gerencia al crear la cuenta
 *  o al restablecerla): hasta cambiarla no puede abrir ninguna otra.
 *
 *  Se pide la contraseña actual. Sin ella, cualquiera que encontrara una
 *  sesión abierta en una computadora prestada podría quedarse con la cuenta.
 * ============================================================================
 */
import type { Metadata } from 'next';
import { obtenerUsuarioActual, crearClienteServidor } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel } from '@/components/ui/Pagina';
import { FormularioClave } from './FormularioClave';

export const metadata: Metadata = { title: 'Cambiar mi contraseña' };
export const dynamic = 'force-dynamic';

export default async function PaginaClave() {
  const usuario = await obtenerUsuarioActual();
  const supabase = await crearClienteServidor();
  const { data: ficha } = usuario
    ? await supabase.from('usuarios').select('debe_cambiar_clave').eq('id', usuario.id).maybeSingle()
    : { data: null };
  const temporal = ficha?.debe_cambiar_clave === true;

  return (
    <>
      <CabeceraPagina
        titulo="Cambiar mi contraseña"
        descripcion={`${usuario?.nombre ?? ''} · ${usuario?.email ?? ''}`}
      />

      {temporal && (
        <div className="ficha-aviso ficha-aviso-atencion" role="status" data-bloque="clave-temporal-aviso">
          <span>
            <strong>Está entrando con una contraseña temporal.</strong> Elija ahora la suya: hasta
            cambiarla, el sistema no le deja abrir otras pantallas.
          </span>
        </div>
      )}

      <Panel titulo="Contraseña nueva" className="mb-espacio">
        <FormularioClave temporal={temporal} />
      </Panel>

      <p className="pie-explicativo">
        Mínimo 8 caracteres, con letras y números, y distinta de la actual. Si la olvida, pida a
        Gerencia que le ponga una temporal desde Configuración → Usuarios y roles: el sistema no
        envía correos de recuperación.
      </p>
    </>
  );
}
