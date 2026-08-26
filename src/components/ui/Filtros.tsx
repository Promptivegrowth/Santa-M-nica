'use client';

/**
 * ============================================================================
 *  BARRA DE FILTROS
 * ============================================================================
 *  Los filtros viven en la dirección web (la URL). Eso tiene tres ventajas
 *  prácticas para el usuario:
 *   · Puede guardar la vista filtrada en favoritos.
 *   · Puede compartirla por correo y el otro ve exactamente lo mismo.
 *   · El botón "atrás" del navegador funciona como se espera.
 *
 *  Además, al vivir en la URL, el filtrado lo resuelve el servidor sobre la
 *  base de datos, y no el navegador sobre miles de filas descargadas.
 * ============================================================================
 */
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import type { ReadonlyURLSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

export type CampoFiltro =
  | { tipo: 'texto'; clave: string; etiqueta: string; ancho?: string }
  | { tipo: 'select'; clave: string; etiqueta: string; opciones: { valor: string; texto: string }[] }
  | { tipo: 'fecha'; clave: string; etiqueta: string };

/** Los valores que dicta la direccion web en este momento. Funcion pura. */
function desdeLaUrl(
  campos: CampoFiltro[],
  params: URLSearchParams | ReadonlyURLSearchParams
): Record<string, string> {
  const salida: Record<string, string> = {};
  campos.forEach((c) => { salida[c.clave] = params.get(c.clave) ?? ''; });
  return salida;
}

export function Filtros({ campos }: { campos: CampoFiltro[] }) {
  const router = useRouter();
  const ruta = usePathname();
  const params = useSearchParams();
  const [pendiente, iniciar] = useTransition();

  /*
   * Hay estado local porque escribir tiene que sentirse instantaneo: la caja
   * de texto no puede esperar a que el servidor devuelva la pagina filtrada.
   * Pero la verdad sigue estando en la URL, asi que cuando esta cambia —el
   * boton «atras», un enlace con filtros, el borrado de todos— hay que
   * resincronizar.
   *
   * Esa resincronizacion se hace DURANTE el renderizado y no dentro de un
   * useEffect. Es el patron que documenta React para ajustar estado cuando
   * cambian las entradas: React descarta el renderizado a medias y repite con
   * el valor nuevo, sin llegar a pintar el intermedio. Con un efecto, en
   * cambio, el usuario alcanza a ver un fotograma con los filtros viejos.
   */
  const claveUrl = params.toString();
  const [ultimaClave, setUltimaClave] = useState(claveUrl);
  const [valores, setValores] = useState<Record<string, string>>(() => desdeLaUrl(campos, params));

  if (claveUrl !== ultimaClave) {
    setUltimaClave(claveUrl);
    setValores(desdeLaUrl(campos, params));
  }

  function aplicar(nuevos: Record<string, string>) {
    const p = new URLSearchParams();
    Object.entries(nuevos).forEach(([k, v]) => { if (v) p.set(k, v); });
    // Al cambiar un filtro se vuelve a la primera página
    iniciar(() => router.replace(`${ruta}?${p.toString()}`, { scroll: false }));
  }

  function cambiar(clave: string, valor: string, inmediato = false) {
    const nuevos = { ...valores, [clave]: valor };
    setValores(nuevos);
    if (inmediato) aplicar(nuevos);
  }

  const hayFiltros = Object.values(valores).some(Boolean);

  return (
    <div className="filtros" data-cargando={pendiente ? 'si' : 'no'}>
      {campos.map((c) => (
        <label key={c.clave} className="filtro-campo">
          <span className="etiqueta">{c.etiqueta}</span>

          {c.tipo === 'texto' && (
            <input
              type="search"
              className="campo"
              style={c.ancho ? { minWidth: c.ancho } : undefined}
              value={valores[c.clave] ?? ''}
              placeholder="Escriba para buscar…"
              onChange={(e) => cambiar(c.clave, e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') aplicar(valores); }}
              onBlur={() => aplicar(valores)}
            />
          )}

          {c.tipo === 'select' && (
            <select
              className="campo"
              value={valores[c.clave] ?? ''}
              onChange={(e) => cambiar(c.clave, e.target.value, true)}
            >
              <option value="">Todos</option>
              {c.opciones.map((o) => (
                <option key={o.valor} value={o.valor}>{o.texto}</option>
              ))}
            </select>
          )}

          {c.tipo === 'fecha' && (
            <input
              type="date"
              className="campo"
              value={valores[c.clave] ?? ''}
              onChange={(e) => cambiar(c.clave, e.target.value, true)}
            />
          )}
        </label>
      ))}

      <div className="filtro-acciones">
        <button type="button" className="btn btn-secundario" onClick={() => aplicar(valores)}>
          {pendiente ? 'Filtrando…' : 'Aplicar'}
        </button>
        {hayFiltros && (
          <button
            type="button"
            className="btn btn-sutil"
            onClick={() => { setValores({}); iniciar(() => router.replace(ruta, { scroll: false })); }}
          >
            Limpiar
          </button>
        )}
      </div>

      <style jsx>{`
        .filtro-acciones { display: flex; gap: .3rem; align-items: center; margin-inline-start: auto; }
        .filtros[data-cargando='si'] { opacity: .65; }
      `}</style>
    </div>
  );
}

/* --------------------------------------------------------------------------
   Paginación
   -------------------------------------------------------------------------- */
export function Paginacion({
  pagina,
  porPagina,
  total,
}: {
  pagina: number;
  porPagina: number;
  total: number;
}) {
  const router = useRouter();
  const ruta = usePathname();
  const params = useSearchParams();

  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const desde = total === 0 ? 0 : (pagina - 1) * porPagina + 1;
  const hasta = Math.min(pagina * porPagina, total);

  function ir(p: number) {
    const q = new URLSearchParams(params.toString());
    q.set('pagina', String(p));
    router.replace(`${ruta}?${q.toString()}`, { scroll: false });
  }

  return (
    <div className="paginacion">
      <span>
        Mostrando <strong>{desde.toLocaleString('es-PE')}–{hasta.toLocaleString('es-PE')}</strong>{' '}
        de <strong>{total.toLocaleString('es-PE')}</strong> registros
      </span>
      <div className="paginacion-botones">
        <button className="btn btn-secundario" disabled={pagina <= 1} onClick={() => ir(pagina - 1)}>
          Anterior
        </button>
        <span className="paginacion-actual">{pagina} / {paginas}</span>
        <button className="btn btn-secundario" disabled={pagina >= paginas} onClick={() => ir(pagina + 1)}>
          Siguiente
        </button>
      </div>

      <style jsx>{`
        .paginacion-actual {
          font-family: var(--font-mono); font-size: .72rem;
          padding: 0 .5rem; align-self: center; color: var(--tinta-2);
        }
      `}</style>
    </div>
  );
}
