'use client';

/**
 * ============================================================================
 *  PREFERENCIAS DEL NAVEGADOR
 * ============================================================================
 *  Cuatro cosas del ERP se recuerdan en el propio navegador de cada persona:
 *  si la barra lateral está angosta, qué tema eligió, si ya vio el preloader
 *  en esta sesión, y si su equipo está en modo oscuro.
 *
 *  Todo eso vive FUERA de React —en localStorage, en sessionStorage o en una
 *  media query del sistema— y el servidor no puede conocerlo: cuando dibuja el
 *  HTML no existe ningún navegador todavía.
 *
 *  LA FORMA INGENUA Y POR QUÉ SE ABANDONÓ
 *  Lo natural es leerlo dentro de un useEffect y guardarlo con setState. Pero
 *  eso obliga a React a dibujar la pantalla DOS veces: una con el valor por
 *  defecto y otra con el real. En la práctica se ve como un parpadeo —la barra
 *  aparece ancha y se encoge, el gráfico sale en colores claros y cambia— y
 *  además dispara una cascada de renderizados en todo lo que cuelgue debajo.
 *
 *  LA FORMA CORRECTA
 *  React tiene una herramienta pensada exactamente para esto:
 *  useSyncExternalStore. Se le dan tres cosas —cómo suscribirse a los cambios,
 *  cómo leer el valor en el navegador y qué valor usar en el servidor— y React
 *  se encarga de que la hidratación cuadre y de repintar solo cuando el valor
 *  cambia de verdad. Ni efectos, ni doble renderizado, ni parpadeo.
 *
 *  Un detalle importante: `getSnapshot` DEBE devolver valores comparables con
 *  Object.is. Por eso aquí todo son cadenas y booleanos, nunca objetos nuevos:
 *  devolver un objeto recién creado en cada lectura metería a React en un
 *  bucle infinito de renderizados.
 * ============================================================================
 */
import { useCallback, useSyncExternalStore } from 'react';

type Almacen = 'local' | 'session';

/* --------------------------------------------------------------------------
   Un pequeño bus de avisos.

   El evento 'storage' del navegador solo llega a las OTRAS pestañas, nunca a
   la que acaba de escribir. Como aquí queremos que la propia pestaña se entere
   al instante de sus propios cambios, se mantiene una lista de oyentes y se
   les avisa a mano desde guardarPreferencia().
   -------------------------------------------------------------------------- */
const oyentes = new Set<() => void>();

function avisarATodos() {
  oyentes.forEach((f) => f());
}

function suscribirAlmacen(alCambiar: () => void) {
  oyentes.add(alCambiar);
  window.addEventListener('storage', alCambiar);
  return () => {
    oyentes.delete(alCambiar);
    window.removeEventListener('storage', alCambiar);
  };
}

/** Lee sin reventar: en modo privado el acceso al almacenamiento puede lanzar. */
function leerCrudo(almacen: Almacen, clave: string): string | null {
  try {
    const store = almacen === 'local' ? window.localStorage : window.sessionStorage;
    return store.getItem(clave);
  } catch {
    return null;
  }
}

/**
 * Guarda una preferencia y avisa a quien la esté observando.
 * Pasar `null` como valor la borra: es lo que hace el tema «sistema», que no
 * es un valor guardado sino la ausencia de uno.
 */
export function guardarPreferencia(almacen: Almacen, clave: string, valor: string | null) {
  try {
    const store = almacen === 'local' ? window.localStorage : window.sessionStorage;
    if (valor === null) store.removeItem(clave);
    else store.setItem(clave, valor);
  } catch {
    /* sin almacenamiento: la preferencia no persiste, pero la sesión sigue */
  }
  avisarATodos();
}

/**
 * Devuelve lo que hay guardado bajo esa clave, o null.
 *
 * En el servidor devuelve siempre null, que es la verdad: allí no hay
 * navegador. Quien la use debe tratar ese null como «todavía no lo sé», no
 * como «no está guardado».
 */
export function usePreferencia(almacen: Almacen, clave: string): string | null {
  const enNavegador = useCallback(() => leerCrudo(almacen, clave), [almacen, clave]);
  const enServidor = useCallback(() => null, []);
  return useSyncExternalStore(suscribirAlmacen, enNavegador, enServidor);
}

/* --------------------------------------------------------------------------
   ¿Ya estamos en el navegador?

   Sirve para lo que solo debe aparecer después de hidratar —el preloader, por
   ejemplo—. Es la misma idea que un `useEffect(() => setMontado(true), [])`,
   pero sin el renderizado extra que aquel provoca.
   -------------------------------------------------------------------------- */
const sinCambios = () => () => {};
const siempreCierto = () => true;
const siempreFalso = () => false;

export function useEnNavegador(): boolean {
  return useSyncExternalStore(sinCambios, siempreCierto, siempreFalso);
}

/* --------------------------------------------------------------------------
   ¿Está activo el tema oscuro?

   Depende de dos fuentes a la vez:
     · el atributo data-tema del <html>, que pone la cabecera cuando el usuario
       elige claro u oscuro a mano;
     · la preferencia del sistema operativo, que manda cuando el usuario dejó
       la opción en «sistema».

   Se vigilan las dos: la media query con su propio evento, y el atributo con
   un MutationObserver. Así los gráficos cambian de paleta en el mismo instante
   en que se pulsa el botón de la cabecera.
   -------------------------------------------------------------------------- */
function suscribirTema(alCambiar: () => void) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', alCambiar);

  const observador = new MutationObserver(alCambiar);
  observador.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-tema'],
  });

  return () => {
    mq.removeEventListener('change', alCambiar);
    observador.disconnect();
  };
}

function temaOscuroAhora(): boolean {
  const marca = document.documentElement.getAttribute('data-tema');
  if (marca === 'oscuro') return true;
  if (marca === 'claro') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function useTemaOscuro(): boolean {
  // En el servidor se asume claro. Es la elección menos dañina: si acierta no
  // pasa nada y si falla, el cambio ocurre en la primera pintura del cliente.
  return useSyncExternalStore(suscribirTema, temaOscuroAhora, siempreFalso);
}
