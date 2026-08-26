/**
 * ============================================================================
 *  KARDEX · el diario del almacén
 * ============================================================================
 *  ¿Qué es un Kardex? Es el libro donde se anota TODO lo que entra y sale del
 *  almacén, en orden. Igual que la libreta de un contador: nunca se borra ni se
 *  corrige una línea; si hubo un error, se escribe otra línea que lo compensa.
 *
 *  Esa regla es lo que hace confiable el inventario: el saldo de cada lote no
 *  es un número que alguien escribió, sino la suma de todos sus movimientos.
 *
 *  La base de datos IMPIDE físicamente modificar o borrar estas líneas: hay un
 *  disparador que rechaza cualquier intento de UPDATE o DELETE.
 * ============================================================================
 */
import type { Metadata } from 'next';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { CabeceraPagina, Panel, Vacio, Etiqueta } from '@/components/ui/Pagina';
import { Filtros, Paginacion } from '@/components/ui/Filtros';
import { tm, num, fechaHora, etiquetaEstado } from '@/lib/formato';
import { veCostos, type Rol } from '@/lib/navegacion';

export const metadata: Metadata = { title: 'Kardex' };
export const dynamic = 'force-dynamic';

const POR_PAGINA = 50;

/** Cómo se presenta cada tipo de movimiento en pantalla. */
const TIPOS: Record<string, { texto: string; tono: 'ok' | 'critico' | 'atencion' | 'info' | 'neutro' }> = {
  ingreso: { texto: 'Ingreso', tono: 'ok' },
  traslado_ingreso: { texto: 'Entrada traslado', tono: 'ok' },
  ingreso_reproceso: { texto: 'Vuelve de reproceso', tono: 'ok' },
  ajuste_positivo: { texto: 'Ajuste (+)', tono: 'atencion' },
  salida_despacho: { texto: 'Despacho', tono: 'info' },
  traslado_salida: { texto: 'Salida traslado', tono: 'info' },
  salida_reproceso: { texto: 'A reproceso', tono: 'atencion' },
  salida_muestra: { texto: 'Muestra', tono: 'neutro' },
  salida_merma: { texto: 'Merma', tono: 'critico' },
  ajuste_negativo: { texto: 'Ajuste (−)', tono: 'critico' },
};

export default async function PaginaKardex(props: PageProps<'/almacenes/kardex'>) {
  const q = await props.searchParams;
  const supabase = await crearClienteServidor();
  const usuario = await obtenerUsuarioActual();
  const puedeVerCostos = veCostos((usuario?.rol ?? 'consulta') as Rol);

  const pagina = Math.max(1, Number(q.pagina ?? 1));
  const buscar = (q.buscar as string) ?? '';
  const tipo = (q.tipo as string) ?? '';
  const almacenId = (q.almacen as string) ?? '';
  const desde = (q.desde as string) ?? '';

  const { data: almacenes } = await supabase
    .from('almacenes').select('id, nombre').eq('activo', true).order('nombre');

  let consulta = supabase.from('v_kardex').select('*', { count: 'exact' });
  if (buscar) {
    consulta = consulta.or(
      `codigo_pallet.ilike.%${buscar}%,documento_ref.ilike.%${buscar}%,sku_codigo.ilike.%${buscar}%`
    );
  }
  if (tipo) consulta = consulta.eq('tipo', tipo);
  if (almacenId) consulta = consulta.eq('almacen_id', Number(almacenId));
  if (desde) consulta = consulta.gte('fecha', desde);

  const { data: filas, count } = await consulta
    .order('fecha', { ascending: false })
    .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);

  return (
    <>
      <CabeceraPagina
        titulo="Kardex"
        descripcion="Todas las entradas y salidas del almacén, en orden. Ninguna línea se puede modificar ni borrar: para corregir un error se registra un movimiento inverso."
      />

      <Panel titulo={`${num(count ?? 0)} movimientos registrados`}>
        <Filtros
          campos={[
            { tipo: 'texto', clave: 'buscar', etiqueta: 'Pallet, documento o SKU', ancho: '13rem' },
            {
              tipo: 'select', clave: 'tipo', etiqueta: 'Tipo de movimiento',
              opciones: Object.entries(TIPOS).map(([v, t]) => ({ valor: v, texto: t.texto })),
            },
            {
              tipo: 'select', clave: 'almacen', etiqueta: 'Almacén',
              opciones: (almacenes ?? []).map((a) => ({ valor: String(a.id), texto: a.nombre as string })),
            },
            { tipo: 'fecha', clave: 'desde', etiqueta: 'Desde' },
          ]}
        />

        {(filas ?? []).length === 0 ? (
          <Vacio titulo="Sin movimientos" mensaje="No hay movimientos que coincidan con los filtros." />
        ) : (
          <>
            <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
              <table className="datos">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Movimiento</th>
                    <th>Pallet</th>
                    <th>Producto</th>
                    <th>Almacén</th>
                    <th className="num">Entrada</th>
                    <th className="num">Salida</th>
                    {puedeVerCostos && <th className="num">Valor</th>}
                    <th>Documento</th>
                    <th>Registró</th>
                  </tr>
                </thead>
                <tbody>
                  {(filas ?? []).map((f) => {
                    const t = TIPOS[f.tipo as string] ?? {
                      texto: etiquetaEstado(f.tipo as string),
                      tono: 'neutro' as const,
                    };
                    return (
                      <tr key={f.id as number}>
                        <td className="mono" style={{ whiteSpace: 'nowrap' }}>{fechaHora(f.fecha as string)}</td>
                        <td><Etiqueta texto={t.texto} tono={t.tono} /></td>
                        <td className="mono">{f.codigo_pallet}</td>
                        <td>
                          <span className="mono" style={{ color: 'var(--tinta-3)' }}>{f.sku_codigo}</span>{' '}
                          {f.formato} · {f.corte}
                        </td>
                        <td>{f.almacen}</td>
                        <td className="num" style={{ color: Number(f.entrada_kg) > 0 ? 'var(--ok)' : undefined }}>
                          {Number(f.entrada_kg) > 0 ? tm(f.entrada_kg) : '—'}
                        </td>
                        <td className="num" style={{ color: Number(f.salida_kg) > 0 ? 'var(--critico)' : undefined }}>
                          {Number(f.salida_kg) > 0 ? tm(f.salida_kg) : '—'}
                        </td>
                        {puedeVerCostos && <td className="num">{num(f.valor, 0)}</td>}
                        <td className="mono">{(f.documento_ref as string) ?? '—'}</td>
                        <td style={{ fontSize: '.76rem', color: 'var(--tinta-3)' }}>
                          {(f.usuario as string) ?? '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Paginacion pagina={pagina} porPagina={POR_PAGINA} total={count ?? 0} />
          </>
        )}
      </Panel>

      <p className="pie-explicativo">
        Las cantidades están en toneladas. El Kardex es la <strong>única fuente de verdad</strong> del
        inventario: las existencias que ve el resto del sistema son la suma de estas líneas, calculada
        automáticamente por la base de datos.
      </p>
    </>
  );
}
