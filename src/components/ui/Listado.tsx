/**
 * ============================================================================
 *  LISTADO GENÉRICO
 * ============================================================================
 *  Muchas pantallas del ERP son la misma cosa: una tabla con filtros, orden y
 *  paginación sobre una vista de la base de datos. En lugar de repetir ese
 *  código veinte veces, se define una sola vez aquí.
 *
 *  Cada pantalla solo declara QUÉ columnas quiere y CÓMO se pinta cada celda.
 *  La consulta, los filtros, el conteo y la paginación los resuelve este
 *  componente contra el servidor.
 * ============================================================================
 */
import { crearClienteServidor } from '@/lib/supabase/servidor';
import { Panel, Vacio } from './Pagina';
import { Filtros, Paginacion, type CampoFiltro } from './Filtros';
import { AccionesLista } from './Acciones';
import { num } from '@/lib/formato';

export type Columna = {
  clave: string;
  titulo: string;
  /** Alinea a la derecha y usa cifras tabulares. */
  numerica?: boolean;
  /** Fuente monoespaciada, para códigos. */
  mono?: boolean;
  /** Cómo se pinta la celda. Si no se indica, se muestra el valor tal cual. */
  render?: (fila: Record<string, unknown>) => React.ReactNode;
};

export type FiltroAplicado = {
  clave: string;
  columna: string;
  /** 'igual' compara exacto; 'contiene' busca texto; 'desde' es mayor o igual. */
  operador: 'igual' | 'contiene' | 'desde' | 'hasta' | 'verdadero';
  /** Para 'contiene' con varias columnas a la vez. */
  columnas?: string[];
};

export async function Listado({
  vista,
  columnas,
  filtros = [],
  filtrosAplicados = [],
  parametros,
  orden,
  ascendente = false,
  porPagina = 40,
  titulo,
  vacio,
  fijos,
  ficha,
}: {
  /** Nombre de la tabla o vista de la base de datos. */
  vista: string;
  columnas: Columna[];
  filtros?: CampoFiltro[];
  filtrosAplicados?: FiltroAplicado[];
  parametros: Record<string, string | string[] | undefined>;
  orden: string;
  ascendente?: boolean;
  porPagina?: number;
  titulo?: string;
  vacio?: { titulo: string; mensaje: string };
  /** Condiciones fijas que siempre se aplican (por ejemplo, solo activos). */
  fijos?: { columna: string; valor: string | number | boolean; operador?: 'igual' | 'mayor' | 'en' }[];
  /**
   * A dónde lleva cada fila. Si se indica, el listado añade por su cuenta una
   * última columna con el botón de «ver detalle», igual en todas las pantallas.
   *
   *   base   ruta de la ficha, sin el identificador. Ej. '/ventas/clientes'
   *   clave  columna de la que sale ese identificador. Por defecto 'id', que
   *          es lo habitual; algunas VISTAS lo exponen con otro nombre
   *          (v_anticuamiento lo llama 'lote_id', por ejemplo).
   *   titulo texto de ayuda del botón.
   *
   * Se declara en vez de pasarse una función porque así la pantalla no puede
   * equivocarse construyendo la URL a mano, que es donde salen los 404.
   */
  ficha?: { base: string; clave?: string; titulo?: string };
}) {
  const supabase = await crearClienteServidor();
  const pagina = Math.max(1, Number(parametros.pagina ?? 1));

  let consulta = supabase.from(vista).select('*', { count: 'exact' });

  /* ---- Condiciones fijas de la pantalla ---- */
  for (const f of fijos ?? []) {
    if (f.operador === 'mayor') consulta = consulta.gt(f.columna, f.valor);
    else if (f.operador === 'en') consulta = consulta.in(f.columna, String(f.valor).split(','));
    else consulta = consulta.eq(f.columna, f.valor);
  }

  /* ---- Filtros que vienen de la dirección web ---- */
  for (const f of filtrosAplicados) {
    const valor = parametros[f.clave] as string | undefined;
    if (!valor) continue;

    if (f.operador === 'contiene') {
      const cols = f.columnas ?? [f.columna];
      consulta = consulta.or(cols.map((c) => `${c}.ilike.%${valor}%`).join(','));
    } else if (f.operador === 'desde') {
      consulta = consulta.gte(f.columna, valor);
    } else if (f.operador === 'hasta') {
      consulta = consulta.lte(f.columna, valor);
    } else if (f.operador === 'verdadero') {
      if (valor === 'si') consulta = consulta.eq(f.columna, true);
    } else {
      // Los identificadores llegan como texto; si es un número, se convierte
      const v = /^\d+$/.test(valor) ? Number(valor) : valor;
      consulta = consulta.eq(f.columna, v);
    }
  }

  const { data: filas, count, error } = await consulta
    .order(orden, { ascending: ascendente })
    .range((pagina - 1) * porPagina, pagina * porPagina - 1);

  if (error) {
    return (
      <Panel titulo={titulo}>
        <Vacio
          titulo="No se pudieron cargar los datos"
          mensaje={`${error.message}. Vuelva a intentarlo o avise a soporte.`}
        />
      </Panel>
    );
  }

  return (
    <Panel titulo={titulo ?? `${num(count ?? 0)} registros`}>
      {filtros.length > 0 && <Filtros campos={filtros} />}

      {(filas ?? []).length === 0 ? (
        <Vacio
          titulo={vacio?.titulo ?? 'Sin resultados'}
          mensaje={vacio?.mensaje ?? 'No hay registros que coincidan con los filtros aplicados.'}
        />
      ) : (
        <>
          <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
            <table className="datos">
              <thead>
                <tr>
                  {columnas.map((c) => (
                    <th key={c.clave} className={c.numerica ? 'num' : undefined}>{c.titulo}</th>
                  ))}
                  {ficha && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {(filas ?? []).map((fila, i) => (
                  <tr key={(fila.id as number) ?? i}>
                    {columnas.map((c) => (
                      <td
                        key={c.clave}
                        className={c.numerica ? 'num' : c.mono ? 'mono' : undefined}
                      >
                        {c.render
                          ? c.render(fila as Record<string, unknown>)
                          : ((fila as Record<string, unknown>)[c.clave] as React.ReactNode) ?? '—'}
                      </td>
                    ))}
                    {ficha && (
                      <td>
                        <AccionesLista
                          ver={
                            // Sin identificador no hay ficha que abrir: el botón
                            // se dibuja apagado en vez de llevar a un 404.
                            (fila as Record<string, unknown>)[ficha.clave ?? 'id'] != null
                              ? `${ficha.base}/${(fila as Record<string, unknown>)[ficha.clave ?? 'id']}`
                              : null
                          }
                          verTitulo={ficha.titulo ?? 'Ver detalle'}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Paginacion pagina={pagina} porPagina={porPagina} total={count ?? 0} />
        </>
      )}
    </Panel>
  );
}
