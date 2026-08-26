/**
 * Raíz del sitio.
 * No tiene contenido propio: manda al panel principal. Si el usuario no tiene
 * sesión, el proxy de autenticación lo desviará al login.
 */
import { redirect } from 'next/navigation';

export default function Inicio() {
  redirect('/panel');
}
