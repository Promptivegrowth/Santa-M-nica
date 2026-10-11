/**
 * ============================================================================
 *  TIPO DE CAMBIO OFICIAL SUNAT
 * ============================================================================
 *  Observaciones ERP (oct. 2026), punto 3: «las cotizaciones deben obtener
 *  automáticamente el tipo de cambio oficial publicado por SUNAT para la
 *  fecha aplicable, mostrando el valor y la fecha de referencia».
 *
 *  DE DÓNDE SALE
 *  De la consulta pública de SUNAT, que devuelve el mes entero: por cada día
 *  publicado, compra (C) y venta (V). Se guarda TODO el mes en la tabla
 *  `tipos_cambio_sunat` la primera vez, así la siguiente cotización del mes
 *  no vuelve a preguntar, y una cotización vieja sigue sabiendo con qué tipo
 *  se hizo aunque SUNAT no responda ese día.
 *
 *  DÍAS SIN PUBLICACIÓN
 *  SUNAT no publica domingos ni feriados. Para esos días rige el último valor
 *  publicado —es la regla de SUNAT—, y se guarda cuál fue (publicado_el) para
 *  decirlo en pantalla: «SUNAT · publicado el 10/10/2026».
 *
 *  SI SUNAT NO RESPONDE
 *  No se inventa nada: se devuelve el error y el usuario escribe el tipo a
 *  mano, que queda marcado como «manual».
 * ============================================================================
 */
//  Solo se importa desde acciones de servidor: hace peticiones a SUNAT.
import type { crearClienteServidor } from '@/lib/supabase/servidor';

type Cliente = Awaited<ReturnType<typeof crearClienteServidor>>;

export type TipoCambioSunat = {
  /** La fecha que se pidió. */
  fecha: string;
  compra: number;
  venta: number;
  /** El día de la publicación que rige para esa fecha. */
  publicado_el: string;
  /** Cuál de los dos usa el sistema (parámetro tipo_cambio_sunat_usar). */
  clase: 'compra' | 'venta';
  /** El valor que se propone para el documento. */
  valor: number;
};

const URL_MES = 'https://e-consulta.sunat.gob.pe/cl-at-ittipcam/tcS01Alias/listarTipoCambio';
const URL_HOY = 'https://www.sunat.gob.pe/a/txt/tipoCambio.txt';

/** «10/10/2026» → «2026-10-10». */
const iso = (dmy: string) => dmy.split('/').reverse().join('-');

async function conTiempo(url: string, init: RequestInit = {}, ms = 8000): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: c.signal, cache: 'no-store' });
  } finally {
    clearTimeout(t);
  }
}

/** Los valores publicados en un mes, por día. El mes de SUNAT empieza en 0. */
async function publicadosDelMes(anio: number, mes: number): Promise<Map<string, { compra: number; venta: number }>> {
  const r = await conTiempo(URL_MES, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ anio, mes: mes - 1, token: 'erp' }),
  });
  if (!r.ok) throw new Error(`SUNAT respondió ${r.status}`);
  const filas = (await r.json()) as { fecPublica: string; valTipo: string; codTipo: 'C' | 'V' }[];
  const dias = new Map<string, { compra: number; venta: number }>();
  for (const f of Array.isArray(filas) ? filas : []) {
    const d = iso(f.fecPublica);
    const previo = dias.get(d) ?? { compra: 0, venta: 0 };
    if (f.codTipo === 'C') previo.compra = Number(f.valTipo);
    if (f.codTipo === 'V') previo.venta = Number(f.valTipo);
    dias.set(d, previo);
  }
  for (const [d, v] of dias) if (!(v.compra > 0 && v.venta > 0)) dias.delete(d);
  return dias;
}

/** El de hoy, por si la consulta mensual falla: SUNAT lo deja también en un texto plano. */
async function publicadoHoy(): Promise<{ fecha: string; compra: number; venta: number } | null> {
  const r = await conTiempo(URL_HOY);
  if (!r.ok) return null;
  const [dmy, compra, venta] = (await r.text()).trim().split('|');
  if (!dmy || !(Number(compra) > 0) || !(Number(venta) > 0)) return null;
  return { fecha: iso(dmy), compra: Number(compra), venta: Number(venta) };
}

async function claseConfigurada(supabase: Cliente): Promise<'compra' | 'venta'> {
  const { data } = await supabase
    .from('parametros').select('valor').eq('clave', 'tipo_cambio_sunat_usar').maybeSingle();
  return String(data?.valor ?? 'venta').trim().toLowerCase() === 'compra' ? 'compra' : 'venta';
}

/**
 * El tipo de cambio SUNAT que rige para una fecha («AAAA-MM-DD»).
 * Primero mira lo guardado; si no está, consulta a SUNAT y guarda el mes.
 */
export async function obtenerTipoCambioSunat(
  supabase: Cliente,
  fecha: string
): Promise<{ ok: true; tc: TipoCambioSunat } | { ok: false; mensaje: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { ok: false, mensaje: 'Fecha no válida.' };
  const clase = await claseConfigurada(supabase);
  const armar = (f: { compra: number; venta: number; publicado_el: string }): TipoCambioSunat => ({
    fecha, compra: Number(f.compra), venta: Number(f.venta), publicado_el: String(f.publicado_el),
    clase, valor: Number(clase === 'compra' ? f.compra : f.venta),
  });

  /* ---- 1. Ya guardado ---- */
  const { data: guardado } = await supabase
    .from('tipos_cambio_sunat').select('compra, venta, publicado_el').eq('fecha', fecha).maybeSingle();
  if (guardado) return { ok: true, tc: armar(guardado as { compra: number; venta: number; publicado_el: string }) };

  /* ---- 2. A SUNAT: el mes de la fecha y, si hace falta, el anterior ---- */
  try {
    const anio = Number(fecha.slice(0, 4));
    const mes = Number(fecha.slice(5, 7));
    let dias = await publicadosDelMes(anio, mes);
    let anteriores = [...dias.keys()].filter((d) => d <= fecha);
    //  El 1 de un mes que cae domingo: rige el último del mes anterior.
    if (anteriores.length === 0) {
      const previo = mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 };
      const delPrevio = await publicadosDelMes(previo.anio, previo.mes);
      dias = new Map([...delPrevio, ...dias]);
      anteriores = [...dias.keys()].filter((d) => d <= fecha);
    }
    //  Hoy puede no estar todavía en la lista mensual: se mira el texto del día.
    if (fecha >= (anteriores.sort().at(-1) ?? '') && !dias.has(fecha)) {
      const hoy = await publicadoHoy().catch(() => null);
      if (hoy && hoy.fecha <= fecha) {
        dias.set(hoy.fecha, { compra: hoy.compra, venta: hoy.venta });
        anteriores = [...dias.keys()].filter((d) => d <= fecha);
      }
    }
    const rige = anteriores.sort().at(-1);
    if (!rige) return { ok: false, mensaje: `SUNAT no tiene tipo de cambio publicado para el ${fecha}.` };

    /*
     * Se guardan los días publicados del mes y, además, la fecha pedida con
     * el valor que rige (si fue un domingo, el del sábado). Si la escritura
     * falla —un rol sin permiso— el valor se devuelve igual.
     */
    const filas = [...dias.entries()].map(([d, v]) => ({ fecha: d, compra: v.compra, venta: v.venta, publicado_el: d }));
    if (rige !== fecha) {
      const v = dias.get(rige)!;
      filas.push({ fecha, compra: v.compra, venta: v.venta, publicado_el: rige });
    }
    await supabase.from('tipos_cambio_sunat').upsert(filas, { onConflict: 'fecha', ignoreDuplicates: true });

    const v = dias.get(rige)!;
    return { ok: true, tc: armar({ compra: v.compra, venta: v.venta, publicado_el: rige }) };
  } catch (e) {
    const motivo = e instanceof Error && e.name === 'AbortError' ? 'no respondió a tiempo' : 'no respondió';
    return {
      ok: false,
      mensaje: `La consulta de SUNAT ${motivo}. Escriba el tipo de cambio a mano: quedará marcado como manual.`,
    };
  }
}
