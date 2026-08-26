/**
 * ============================================================================
 *  LAYOUT DEL ERP · rutas protegidas
 * ============================================================================
 *  Todo lo que cuelga de este layout exige sesión iniciada.
 *
 *  Aquí se resuelve, EN EL SERVIDOR:
 *   · quién es el usuario y cuál es su rol,
 *   · qué menú le corresponde ver,
 *   · cuántas alertas tiene pendientes.
 *
 *  Hacerlo en el servidor evita que el navegador tenga que pedir estos datos
 *  después de pintar, que es lo que produce esos saltos molestos al cargar.
 * ============================================================================
 */
import { redirect } from 'next/navigation';
import { obtenerUsuarioActual, crearClienteServidor } from '@/lib/supabase/servidor';
import { navegacionPara, type Rol } from '@/lib/navegacion';
import { Marco } from '@/components/estructura/Marco';

export default async function LayoutErp({ children }: LayoutProps<'/'>) {
  const usuario = await obtenerUsuarioActual();

  // Sin sesión válida no se pasa de aquí. El proxy ya redirige antes, pero
  // esta comprobación es la red de seguridad por si alguien llega directo.
  if (!usuario) redirect('/login');

  const supabase = await crearClienteServidor();
  const { count } = await supabase
    .from('alertas')
    .select('id', { count: 'exact', head: true })
    .eq('atendida', false);

  return (
    <Marco
      usuario={{ nombre: usuario.nombre, email: usuario.email, rol: usuario.rol as Rol }}
      grupos={navegacionPara(usuario.rol as Rol)}
      alertasPendientes={count ?? 0}
    >
      {children}
    </Marco>
  );
}
