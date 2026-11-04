/**
 * ============================================================================
 *  QUIÉN FIRMA LA PROFORMA Y EL CONTRATO
 * ============================================================================
 *  Oliver, reunión del 04/11: «si aprueba Walter sale la firma de Walter; si
 *  aprueba Cathy, puede salir la firma de Cathy». En la proforma SM26-384 del
 *  modelo firma Cathy Lee, «Jefe Comercial y Exportaciones».
 *
 *  LA REGLA (migración 083)
 *   1. Firma QUIEN APROBÓ LA COTIZACIÓN de la que nació el pedido. Aprobar es
 *      el acto que compromete el precio y las condiciones: es la persona que
 *      «se obliga» por la empresa en ese contrato.
 *   2. Si el pedido no vino de una cotización (pedido directo) o la cotización
 *      no registra quién la aprobó, firma QUIEN REGISTRÓ EL PEDIDO: en un
 *      pedido directo, registrarlo es el compromiso. (El pedido no guarda quién
 *      lo confirmó; quien lo registró es el dato que sí existe.)
 *   3. Si esa persona no subió su firma (Mi cuenta → Mi firma), sale la de
 *      Gerencia de Configuración → Parámetros, como hasta ahora: una firma de
 *      quien sí tiene facultad es mejor que una raya vacía.
 *
 *  Se resuelve en un solo sitio para que la proforma y el contrato no puedan
 *  llevar firmas distintas.
 * ============================================================================
 */
import type { crearClienteServidor } from '@/lib/supabase/servidor';

type Cliente = Awaited<ReturnType<typeof crearClienteServidor>>;

export type Firmante = {
  /** El usuario cuya firma sale; null = la de Gerencia de Parámetros. */
  usuarioId: string | null;
  nombre: string;
  cargo: string;
  /** La imagen incrustada. Vacía = se firma a mano sobre la raya. */
  firma: string;
  /**
   * En el contrato, la firma de Parámetros puede ser el BLOQUE completo del
   * modelo (trazo + nombre, cargo, empresa y RUC dibujados en la imagen).
   * Si lo es, el PDF no vuelve a escribir el nombre debajo.
   */
  firmaBloqueContrato: string;
  /** Por qué firma esta persona, para la pantalla. */
  motivo: string;
};

/**
 * La firma de un pedido. `cotizacionId` y `creadoPor` son los del pedido.
 */
export async function resolverFirmante(
  supabase: Cliente,
  pedido: { cotizacion_id?: unknown; creado_por?: unknown },
): Promise<Firmante> {
  /* ---- 1 · ¿Quién se comprometió? ---- */
  let candidato: string | null = null;
  let motivo = '';
  if (pedido.cotizacion_id) {
    const { data: cot } = await supabase
      .from('cotizaciones').select('numero, aprobada_por').eq('id', Number(pedido.cotizacion_id)).maybeSingle();
    if (cot?.aprobada_por) {
      candidato = String(cot.aprobada_por);
      motivo = `aprobó la cotización ${cot.numero}`;
    }
  }
  if (!candidato && pedido.creado_por) {
    candidato = String(pedido.creado_por);
    motivo = 'registró el pedido';
  }

  //  La firma se pide aparte y no anidada en `usuarios`: firmas_usuario tiene
  //  dos referencias a usuarios (de quién es y quién la subió) y anidarla
  //  sería ambiguo.
  const [{ data: params }, persona, suya] = await Promise.all([
    supabase.from('parametros').select('clave, valor')
      .in('clave', ['firmante_nombre', 'firmante_cargo', 'firmante_firma', 'firmante_firma_contrato']),
    candidato
      ? supabase.from('usuarios').select('nombre').eq('id', candidato).maybeSingle()
      : Promise.resolve({ data: null }),
    candidato
      ? supabase.from('firmas_usuario').select('firma, cargo').eq('usuario_id', candidato).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const p = new Map((params ?? []).map((x) => [String(x.clave), String(x.valor ?? '')]));

  /* ---- 2 · Si tiene firma, firma él ---- */
  const fila = persona?.data as Record<string, unknown> | null;
  const propia = suya?.data as Record<string, unknown> | null;
  const firmaPropia = String(propia?.firma ?? '').trim();
  if (candidato && fila && firmaPropia.startsWith('data:image/')) {
    return {
      usuarioId: candidato,
      nombre: String(fila.nombre ?? ''),
      cargo: String(propia?.cargo ?? '').trim(),
      firma: firmaPropia,
      firmaBloqueContrato: '',
      motivo: `Firma ${String(fila.nombre ?? '')}, que ${motivo}.`,
    };
  }

  /* ---- 3 · Si no, la de Gerencia por defecto ---- */
  const nombreDefecto = (p.get('firmante_nombre') ?? '').trim();
  return {
    usuarioId: null,
    nombre: nombreDefecto,
    cargo: (p.get('firmante_cargo') ?? '').trim(),
    firma: (p.get('firmante_firma') ?? '').trim(),
    firmaBloqueContrato: (p.get('firmante_firma_contrato') ?? '').trim(),
    motivo: candidato && fila
      ? `${String(fila.nombre ?? '')} ${motivo}, pero no ha subido su firma: sale la de Gerencia${nombreDefecto ? ` (${nombreDefecto})` : ''}.`
      : `Sale la firma de Gerencia${nombreDefecto ? ` (${nombreDefecto})` : ''}.`,
  };
}

/**
 * La firma que lleva un contrato YA GENERADO. El contrato guarda quién firma
 * (nombre, cargo y su usuario); la imagen se busca al descargar.
 *
 * Si esa persona quitó su firma después, sale la de Gerencia CON el nombre y
 * el cargo de Gerencia (`defecto`): el trazo de Walter con el nombre de otro
 * debajo sería peor que la raya vacía.
 */
export async function firmaDeContrato(
  supabase: Cliente,
  usuarioId: string | null | undefined,
): Promise<{ imagen: string | null; esBloque: boolean; defecto: { nombre: string; cargo: string } | null }> {
  if (usuarioId) {
    const { data } = await supabase.from('firmas_usuario').select('firma').eq('usuario_id', usuarioId).maybeSingle();
    const f = String(data?.firma ?? '').trim();
    if (f.startsWith('data:image/')) return { imagen: f, esBloque: false, defecto: null };
  }
  const { data: firmas } = await supabase.from('parametros').select('clave, valor')
    .in('clave', ['firmante_firma', 'firmante_firma_contrato', 'firmante_nombre', 'firmante_cargo']);
  const valor = (clave: string) => String(firmas?.find((f) => f.clave === clave)?.valor ?? '').trim();
  const bloque = valor('firmante_firma_contrato') || null;
  const suelta = valor('firmante_firma') || null;
  return {
    imagen: bloque ?? suelta,
    esBloque: !!bloque,
    defecto: usuarioId ? { nombre: valor('firmante_nombre'), cargo: valor('firmante_cargo') } : null,
  };
}
