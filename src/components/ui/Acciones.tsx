/**
 * ============================================================================
 *  ACCIONES DE FILA · «ver detalle» y compañía
 * ============================================================================
 *  Un listado sin forma de abrir cada fila no es un ERP, es un reporte. Este
 *  par de piezas se monta igual en las once pantallas de listado del sistema,
 *  para que el gesto sea SIEMPRE el mismo: el código de la izquierda lleva a la
 *  ficha, y el icono de la derecha también.
 *
 *  Se ofrecen las dos vías a propósito. El usuario experto pulsa el número, que
 *  es lo que ya está mirando; el usuario nuevo busca un botón al final de la
 *  fila, que es lo que ha visto en cualquier otro sistema. Sale más barato
 *  poner las dos que enseñar una.
 *
 *  Son componentes de servidor: solo dibujan enlaces, no necesitan JavaScript
 *  en el navegador. Lo que sí modifica datos (eliminar, liberar, convertir)
 *  vive en componentes cliente propios, junto a su acción de servidor.
 * ============================================================================
 */
import Link from 'next/link';
import { Icono } from '@/components/estructura/Icono';

/**
 * El código de un documento, convertido en enlace a su ficha.
 * Si no hay destino —porque el registro no tiene ficha propia— se devuelve el
 * texto tal cual, sin fingir que se puede pulsar.
 */
export function CodigoEnlace({
  href,
  texto,
  titulo,
}: {
  href: string | null;
  texto: string | number | null | undefined;
  titulo?: string;
}) {
  const contenido = texto == null || texto === '' ? '—' : String(texto);
  if (!href || contenido === '—') return <strong>{contenido}</strong>;
  return (
    <Link href={href} className="enlace-ficha" title={titulo ?? `Abrir ${contenido}`}>
      {contenido}
    </Link>
  );
}

/**
 * La celda de acciones al final de la fila.
 *
 * `ver` es el destino principal. `extras` permite añadir enlaces propios de
 * cada pantalla (por ejemplo, «ver el pedido» desde una factura) sin tener que
 * escribir otra vez la maquetación de los botones.
 */
export function AccionesLista({
  ver,
  verTitulo = 'Ver detalle',
  extras,
}: {
  ver?: string | null;
  verTitulo?: string;
  extras?: { href: string; icono: string; titulo: string }[];
}) {
  return (
    <div className="acciones-fila">
      {ver ? (
        <Link href={ver} className="accion-btn" title={verTitulo} aria-label={verTitulo}>
          <Icono nombre="ver" tamano={15} />
        </Link>
      ) : (
        // Se deja el hueco ocupado para que la columna no baile de ancho entre
        // filas que tienen ficha y filas que no.
        <span className="accion-btn" aria-hidden style={{ opacity: 0.25 }}>
          <Icono nombre="ver" tamano={15} />
        </span>
      )}

      {(extras ?? []).map((e) => (
        <Link key={e.href + e.icono} href={e.href} className="accion-btn" title={e.titulo} aria-label={e.titulo}>
          <Icono nombre={e.icono} tamano={14} />
        </Link>
      ))}
    </div>
  );
}
