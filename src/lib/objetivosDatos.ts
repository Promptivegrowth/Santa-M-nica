/**
 * ============================================================================
 *  OBJETIVOS MENSUALES · de la base al tablero, y el filtro
 * ============================================================================
 *  Lo usan la pantalla y la exportación a Excel: los dos piden el mismo
 *  tablero con los mismos filtros, así que el archivo descargado dice
 *  exactamente lo que se estaba viendo.
 *
 *  La seguridad no está aquí sino en la base (migración 060): quien no tiene
 *  el permiso recibe tablas vacías.
 * ============================================================================
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { armarTablero, mesDesdeParametro, type FilaTablero, type Indicador, type Estado } from './objetivos';

export type Filtros = {
  anio: number;
  bloque: string;
  buscar: string;
  /** '' | estado del semáforo | 'sin_meta' */
  estado: string;
  desde: number;
  hasta: number;
  vista: 'real' | 'metas' | 'completo';
};

/** Lee los filtros de la dirección web, con valores sensatos por defecto. */
export function leerFiltros(q: Record<string, string | string[] | undefined>, anioActual: number): Filtros {
  const texto = (k: string) => (typeof q[k] === 'string' ? (q[k] as string) : '');
  const mes = (k: string, d: number) => {
    const n = Number(texto(k));
    return Number.isInteger(n) && n >= 1 && n <= 12 ? n : d;
  };
  const anio = Number(texto('anio')) || anioActual;
  let desde = mes('desde', 1);
  let hasta = mes('hasta', 12);
  if (desde > hasta) [desde, hasta] = [hasta, desde];
  const vista = texto('vista');
  return {
    anio,
    bloque: texto('bloque'),
    buscar: texto('buscar').trim().toLowerCase(),
    estado: texto('estado'),
    desde, hasta,
    vista: vista === 'metas' || vista === 'completo' ? vista : 'real',
  };
}

export async function cargarTablero(supabase: SupabaseClient, anio: number) {
  const [{ data: indicadores }, { data: valores }, { data: metas }, { data: erp }, { data: params }] = await Promise.all([
    supabase.from('objetivos_indicadores').select('*').eq('activo', true).order('orden'),
    supabase.from('objetivos_valores').select('indicador_id, mes, valor').eq('anio', anio),
    supabase.from('objetivos_metas').select('indicador_id, mes, esperado, maximo').eq('anio', anio),
    supabase.rpc('objetivos_erp', { p_anio: anio }),
    supabase.from('parametros').select('clave, valor').in('clave', ['objetivos_tipo_cambio', 'objetivos_erp_desde']),
  ]);
  const param = (c: string) => (params ?? []).find((p) => p.clave === c)?.valor as string | undefined;
  const tipoCambio = Number(param('objetivos_tipo_cambio') ?? 3.4);
  const erpDesde = param('objetivos_erp_desde') ?? '';

  const filas = armarTablero({
    indicadores: (indicadores ?? []) as Indicador[],
    valores: (valores ?? []).map((v) => ({ indicador_id: Number(v.indicador_id), mes: Number(v.mes), valor: Number(v.valor) })),
    erp: ((erp ?? []) as { fuente: string; mes: number; valor: number }[])
      .map((v) => ({ fuente: v.fuente, mes: Number(v.mes), valor: Number(v.valor) })),
    metas: (metas ?? []).map((m) => ({
      indicador_id: Number(m.indicador_id),
      mes: m.mes === null ? null : Number(m.mes),
      esperado: m.esperado === null ? null : Number(m.esperado),
      maximo: m.maximo === null ? null : Number(m.maximo),
    })),
    tipoCambio,
    erpDesdeMes: mesDesdeParametro(erpDesde, anio),
  });
  return { filas, tipoCambio, erpDesde };
}

/** ¿Tiene este indicador alguna meta en el rango, o la del año? */
const tieneMeta = (f: FilaTablero, desde: number, hasta: number) =>
  f.anio.esperado !== null || f.anio.maximo !== null
  || f.meses.slice(desde - 1, hasta).some((c) => c.esperado !== null || c.maximo !== null);

/**
 * Aplica los filtros. Por estado, un indicador entra si ALGÚN mes del rango
 * —o el año— está en ese estado: «no cumple» tiene que traer todo lo que
 * falló, aunque sea un mes.
 */
export function filtrar(filas: FilaTablero[], f: Filtros): FilaTablero[] {
  return filas.filter((fila) => {
    const i = fila.indicador;
    if (f.bloque && i.bloque !== f.bloque) return false;
    if (f.buscar && !`${i.nombre} ${i.codigo} ${i.unidad}`.toLowerCase().includes(f.buscar)) return false;
    if (!f.estado) return true;
    if (f.estado === 'sin_meta') return i.sentido !== 'informativo' && !tieneMeta(fila, f.desde, f.hasta);
    const estados = [...fila.meses.slice(f.desde - 1, f.hasta).map((c) => c.estado), fila.anio.estado];
    if (f.estado === 'cumple') return estados.some((e) => e === 'cumple' || e === 'supera');
    return estados.includes(f.estado as Estado);
  });
}

/** El último mes del rango con algún dato: es el que resumen las tarjetas. */
export function mesDeReferencia(filas: FilaTablero[], f: Filtros): number | null {
  for (let m = f.hasta; m >= f.desde; m--) {
    if (filas.some((x) => x.meses[m - 1].valor !== null)) return m;
  }
  return null;
}

/** Los filtros como texto legible, para dejar constancia en el Excel. */
export function describirFiltros(f: Filtros, nombreMes: string[]): Record<string, string> {
  const d: Record<string, string> = { Año: String(f.anio), Meses: `${nombreMes[f.desde - 1]} a ${nombreMes[f.hasta - 1]}` };
  if (f.bloque) d.Bloque = f.bloque;
  if (f.buscar) d.Buscar = f.buscar;
  if (f.estado) d.Estado = f.estado;
  d.Vista = { real: 'Valores reales', metas: 'Metas', completo: 'Real y metas' }[f.vista];
  return d;
}

/** Los filtros de vuelta a la dirección web (para el botón de Excel y los enlaces). */
export function aConsulta(f: Filtros, cambios: Partial<Filtros> = {}): string {
  const x = { ...f, ...cambios };
  const p = new URLSearchParams();
  p.set('anio', String(x.anio));
  if (x.bloque) p.set('bloque', x.bloque);
  if (x.buscar) p.set('buscar', x.buscar);
  if (x.estado) p.set('estado', x.estado);
  if (x.desde !== 1) p.set('desde', String(x.desde));
  if (x.hasta !== 12) p.set('hasta', String(x.hasta));
  if (x.vista !== 'real') p.set('vista', x.vista);
  return p.toString();
}
