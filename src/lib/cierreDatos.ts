/**
 * ============================================================================
 *  CIERRE SEMANAL DE PRODUCCIÓN · de la base a las filas
 * ============================================================================
 *  Junta lo que se ingresa (planes, materia prima real, las harinas) con lo
 *  que pone el ERP (producción real, stock inicial y ventas por especie) y
 *  calcula las 14 columnas. Lo usan la pantalla y el Excel, así que dicen lo
 *  mismo. La seguridad está en la base (063): a quien no tiene el permiso le
 *  llegan tablas vacías.
 * ============================================================================
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { calcularFila, totalizar, type Datos, type FilaCierre } from './cierre';

export type Categoria = { id: number; codigo: string; nombre: string; orden: number; especie: string | null };
export type FilaConCategoria = { categoria: Categoria; fila: FilaCierre };

export const CAMPOS_MANUALES = ['plan_mp', 'real_mp', 'plan_prod', 'plan_ventas'] as const;
export const CAMPOS_ERP = ['real_prod', 'stock_inicial', 'ventas'] as const;

export async function cargarCierre(supabase: SupabaseClient, anio: number, mes: number) {
  const [{ data: categorias }, { data: valores }, { data: erp }, { data: params }] = await Promise.all([
    supabase.from('cierre_categorias').select('id, codigo, nombre, orden, especie').eq('activo', true).order('orden'),
    supabase.from('cierre_valores').select('categoria_id, campo, valor').eq('anio', anio).eq('mes', mes),
    supabase.rpc('cierre_erp', { p_anio: anio, p_mes: mes }),
    supabase.from('parametros').select('clave, valor').in('clave', ['cierre_dias_proyeccion', 'cierre_dias_mes']),
  ]);
  const param = (c: string, d: number) => Number((params ?? []).find((p) => p.clave === c)?.valor ?? d);
  const dias = { proyeccion: param('cierre_dias_proyeccion', 20), mes: param('cierre_dias_mes', 26) };

  const tecleado = new Map((valores ?? []).map((v) => [`${v.categoria_id}|${v.campo}`, Number(v.valor)]));
  const delErp = new Map(((erp ?? []) as { especie: string; prod_real: number; stock_inicial: number; ventas: number }[])
    .map((e) => [e.especie, e]));

  const filas: FilaConCategoria[] = ((categorias ?? []) as Categoria[]).map((c) => {
    const t = (campo: string) => tecleado.get(`${c.id}|${campo}`) ?? null;
    const e = c.especie ? delErp.get(c.especie) : undefined;
    const datos: Datos = {
      plan_mp: t('plan_mp'),
      real_mp: t('real_mp'),
      plan_prod: t('plan_prod'),
      plan_ventas: t('plan_ventas'),
      //  Con especie, lo pone el ERP; sin especie (harinas), lo ingresado.
      real_prod: c.especie ? (e ? Number(e.prod_real) : 0) : t('real_prod'),
      stock_inicial: c.especie ? (e ? Number(e.stock_inicial) : 0) : t('stock_inicial'),
      ventas: c.especie ? (e ? Number(e.ventas) : 0) : t('ventas'),
    };
    return { categoria: c, fila: calcularFila(datos, dias) };
  });

  return { filas, total: totalizar(filas.map((f) => f.fila)), dias };
}
