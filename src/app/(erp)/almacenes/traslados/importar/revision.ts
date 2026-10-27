/**
 * ============================================================================
 *  IMPORTAR TRASLADOS · de texto del Excel a una línea de traslado
 * ============================================================================
 *  Cada fila del Excel es un pallet que se mueve. Aquí se busca el pallet por
 *  su código, las bodegas por su nombre, se calculan bultos y kilos si vienen
 *  vacíos (va todo lo disponible), y se le aplica la MISMA regla que al
 *  formulario «Nuevo traslado» (registro.ts, problemaLinea): saldo en el
 *  origen, ni apartado ni bloqueado por Calidad, que no vaya ya en otro
 *  traslado. Además, que el pallet no se repita en el archivo.
 *
 *  No es una acción del servidor: la llaman las acciones de importación.
 * ============================================================================
 */
import { normalizarTexto, leerNumero, leerFecha } from '@/lib/importacionExcel';
import { hoyEnLima } from '@/lib/fechas';
import {
  cargarContextoTraslado, problemaLinea, bultosDisponibles, kgPorBulto,
  type ClienteBase, type ContextoTraslado, type LineaTraslado,
} from '../registro';
import type { ErrorColumna, EstadoFila } from '../../ingresos/importar/columnas';

export type BodegaT = { id: number; nombre: string; codigo: string; activo: boolean };

export type ContextoImportTraslado = ContextoTraslado & {
  hoy: string;
  bodegas: BodegaT[];
  /** Código de pallet (normalizado) → lotes con ese código. */
  lotes: Map<string, number[]>;
};

export const normalizarCodigo = (c: string) => String(c ?? '').trim().toUpperCase();

export async function cargarContextoImport(supabase: ClienteBase, codigos: string[]): Promise<ContextoImportTraslado> {
  const unicos = [...new Set(codigos.map(normalizarCodigo).filter(Boolean))];
  const lotes = new Map<string, number[]>();
  for (let i = 0; i < unicos.length; i += 150) {
    const { data } = await supabase.from('lotes').select('id, codigo_pallet').in('codigo_pallet', unicos.slice(i, i + 150));
    for (const l of data ?? []) {
      const c = normalizarCodigo(String(l.codigo_pallet));
      lotes.set(c, [...(lotes.get(c) ?? []), Number(l.id)]);
    }
  }
  const [{ data: bodegas }, ctx] = await Promise.all([
    supabase.from('almacenes').select('id, nombre, codigo, activo').order('nombre'),
    cargarContextoTraslado(supabase, [...lotes.values()].flat()),
  ]);
  return {
    ...ctx,
    hoy: hoyEnLima(),
    lotes,
    bodegas: (bodegas ?? []).map((b) => ({ id: Number(b.id), nombre: String(b.nombre), codigo: String(b.codigo), activo: Boolean(b.activo) })),
  };
}

export type FilaTrasladoInterpretada = {
  origen_id: number;
  destino_id: number;
  fecha: string | null;
  observaciones: string | null;
  linea: LineaTraslado | null;
  errores: ErrorColumna[];
};

const kg1 = (n: number) => n.toLocaleString('es-PE', { maximumFractionDigits: 1 });

export function interpretarFilaTraslado(v: Record<string, string>, ctx: ContextoImportTraslado): FilaTrasladoInterpretada {
  const errores: ErrorColumna[] = [];
  const mal = (columna: string, mensaje: string) => { if (!errores.some((e) => e.columna === columna)) errores.push({ columna, mensaje }); };
  const nombre = (id: number) => ctx.bodegas.find((b) => b.id === id)?.nombre ?? 'esa bodega';

  const bodega = (texto: string, columna: string, que: string) => {
    const t = normalizarTexto(texto);
    if (!t) { mal(columna, `Falta la bodega de ${que}.`); return 0; }
    const b = ctx.bodegas.find((x) => normalizarTexto(x.nombre) === t || normalizarTexto(x.codigo) === t);
    if (!b) { mal(columna, `No existe la bodega «${texto}». Elíjala de la lista.`); return 0; }
    if (!b.activo) { mal(columna, `La bodega ${b.nombre} está desactivada.`); return 0; }
    return b.id;
  };
  const origen = bodega(v.origen ?? '', 'origen', 'origen');
  const destino = bodega(v.destino ?? '', 'destino', 'destino');
  if (origen && destino && origen === destino) mal('destino', 'El origen y el destino no pueden ser la misma bodega.');

  let fecha: string | null = null;
  if (v.fecha?.trim()) {
    fecha = leerFecha(v.fecha);
    if (!fecha) mal('fecha', `«${v.fecha}» no es una fecha: escríbala como DD/MM/AAAA.`);
    else if (fecha < ctx.hoy) mal('fecha', 'La fecha programada ya pasó: déjela vacía o ponga una de hoy en adelante.');
  }
  if ((v.observaciones ?? '').length > 200) mal('observaciones', 'Las observaciones pasan de 200 caracteres: acórtelas.');

  /* ---- El pallet ---- */
  const codigo = normalizarCodigo(v.codigo_pallet ?? '');
  let linea: LineaTraslado | null = null;
  if (!codigo) mal('codigo_pallet', 'Falta el código de pallet.');
  else {
    const ids = ctx.lotes.get(codigo) ?? [];
    if (!ids.length) mal('codigo_pallet', `No existe ningún pallet con el código ${codigo}. Cópielo de la hoja «Pallets disponibles».`);
    else if (origen) {
      const enOrigen = ids.filter((id) => (ctx.stock.get(`${id}-${origen}`)?.fisico_kg ?? 0) > 0.001);
      if (enOrigen.length === 0) {
        //  ¿Dónde está, entonces? Se dice, para corregir la bodega sin buscar.
        const donde = [...ctx.stock.values()].filter((s) => ids.includes(s.lote_id) && s.fisico_kg > 0.001).map((s) => nombre(s.almacen_id));
        mal('codigo_pallet', donde.length
          ? `El pallet ${codigo} no está en ${nombre(origen)}: está en ${[...new Set(donde)].join(', ')}.`
          : `El pallet ${codigo} no tiene stock en ninguna bodega.`);
      } else if (enOrigen.length > 1) {
        mal('codigo_pallet', `Hay ${enOrigen.length} pallets con el código ${codigo} en ${nombre(origen)}: trasládelos desde «Nuevo traslado», donde se distinguen.`);
      } else {
        const s = ctx.stock.get(`${enOrigen[0]}-${origen}`)!;
        const dispB = bultosDisponibles(s);
        const porBulto = kgPorBulto(s);
        let bultos = v.bultos?.trim() ? leerNumero(v.bultos) : NaN;
        let kilos = v.kilos?.trim() ? leerNumero(v.kilos) : NaN;
        if (v.bultos?.trim() && Number.isNaN(bultos)) mal('bultos', `«${v.bultos}» no es un número.`);
        if (v.kilos?.trim() && Number.isNaN(kilos)) mal('kilos', `«${v.kilos}» no es un número.`);
        /* Lo vacío se completa: sin nada, va todo lo disponible; con solo
           bultos, los kilos salen de los kilos por bulto reales del pallet; con
           solo kilos, los bultos que corresponden. */
        if (!v.bultos?.trim() && !v.kilos?.trim()) {
          bultos = dispB;
          kilos = dispB === s.fisico_bultos ? Math.min(s.disponible_kg, s.fisico_kg) : dispB * porBulto;
        } else if (v.bultos?.trim() && !v.kilos?.trim() && !Number.isNaN(bultos)) {
          kilos = bultos === s.fisico_bultos ? s.fisico_kg : bultos * porBulto;
          if (bultos === dispB) kilos = Math.min(kilos, s.disponible_kg);
        } else if (!v.bultos?.trim() && v.kilos?.trim() && !Number.isNaN(kilos)) {
          bultos = Math.max(1, Math.round(kilos / (porBulto || 1)));
        }
        if (!Number.isNaN(bultos) && !Number.isNaN(kilos)) {
          linea = { lote_id: s.lote_id, bultos, peso_kg: Math.round(kilos * 1000) / 1000 };
          const p = problemaLinea(linea, origen, ctx, nombre(origen));
          if (p) {
            const columna = p.campo === 'pallet' ? 'codigo_pallet' : p.campo;
            mal(columna, p.mensaje + (p.campo !== 'pallet' ? ` Disponible: ${dispB} bultos · ${kg1(s.disponible_kg)} kg.` : ''));
          }
        }
      }
    }
  }

  return { origen_id: origen, destino_id: destino, fecha, observaciones: v.observaciones?.trim() || null, linea, errores };
}

export type FilaGuardadaT = {
  id: number; importacion_id: number; fila: number; datos: Record<string, string>;
  errores: ErrorColumna[]; estado: EstadoFila; resultado: string | null;
};

export function revisarConjuntoTraslados(filas: FilaGuardadaT[], ctx: ContextoImportTraslado, forzar: Set<number> = new Set()) {
  const primera = new Map<string, number>();
  for (const f of [...filas].filter((x) => x.estado !== 'descartada' && x.estado !== 'fallida').sort((a, b) => a.fila - b.fila)) {
    const c = normalizarCodigo(f.datos.codigo_pallet ?? '');
    if (c && !primera.has(c)) primera.set(c, f.fila);
  }
  const cambiadas: FilaGuardadaT[] = [];
  for (const f of filas) {
    if (!['valida', 'con_error'].includes(f.estado) && !forzar.has(f.id)) continue;
    const { errores } = interpretarFilaTraslado(f.datos, ctx);
    const c = normalizarCodigo(f.datos.codigo_pallet ?? '');
    const pri = primera.get(c);
    if (c && pri !== undefined && pri !== f.fila && !errores.some((e) => e.columna === 'codigo_pallet')) {
      errores.unshift({ columna: 'codigo_pallet', mensaje: `El pallet ${c} ya aparece en la fila ${pri} de este archivo: cada pallet va una sola vez.` });
    }
    const estado: EstadoFila = errores.length ? 'con_error' : 'valida';
    if (estado !== f.estado || JSON.stringify(errores) !== JSON.stringify(f.errores) || forzar.has(f.id)) {
      cambiadas.push({ ...f, errores, estado, resultado: forzar.has(f.id) ? null : f.resultado });
    }
  }
  return cambiadas;
}

export async function revisarImportacionTraslados(supabase: ClienteBase, importacionId: number, forzar: Set<number> = new Set()) {
  const { data: filas, error } = await supabase
    .from('importaciones_excel_filas').select('id, importacion_id, fila, datos, errores, estado, resultado')
    .eq('importacion_id', importacionId).order('fila');
  if (error) return { ok: false as const, mensaje: 'No se pudieron leer las filas de la importación.' };
  const lista = (filas ?? []) as unknown as FilaGuardadaT[];
  const ctx = await cargarContextoImport(supabase, lista.map((f) => f.datos.codigo_pallet ?? ''));
  const cambiadas = revisarConjuntoTraslados(lista, ctx, forzar);
  if (cambiadas.length) {
    const { error: e2 } = await supabase.from('importaciones_excel_filas').upsert(cambiadas.map((f) => ({
      id: f.id, importacion_id: f.importacion_id, fila: f.fila, datos: f.datos, errores: f.errores,
      estado: f.estado, resultado: f.resultado, actualizado_en: new Date().toISOString(),
    })));
    if (e2) return { ok: false as const, mensaje: 'No se pudo guardar la revisión de las filas. Vuelva a intentarlo.' };
  }
  return { ok: true as const };
}
