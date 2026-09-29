/**
 * La pantalla de necesidades pasó al módulo de Producción (documento de
 * mejoras, puntos 5 y 12). Se deja esta dirección para que los enlaces
 * guardados sigan llegando.
 */
import { redirect } from 'next/navigation';

export default function NecesidadesMovida() {
  redirect('/produccion');
}
