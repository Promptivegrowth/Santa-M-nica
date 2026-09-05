'use server';

/**
 * ============================================================================
 *  LO QUE COMERCIAL LE DEJA DICHO A LOGÍSTICA
 * ============================================================================
 *  Oliver lo describió como el problema que más les cuesta:
 *
 *    «Dependemos mucho de un correo que a veces lo envían a última hora en el
 *     que nos ponen el peso neto o el peso bruto total que puede ir en el
 *     contenedor. Y a veces tenemos el contenedor ya cargando y todavía no
 *     confirman.»
 *
 *  El dato lo tiene Comercial —lo sabe por el destino de la proforma— pero
 *  viajaba por correo y llegaba tarde. Aquí se escribe en el propio embarque,
 *  donde Almacén lo va a ver antes de subir el primer pallet.
 *
 *  POR QUÉ LO ESCRIBE COMERCIAL Y NO ALMACÉN
 *  Porque es información del mercado y del cliente, no de la carga. Almacén la
 *  consume; si además tuviera que averiguarla, seguiríamos dependiendo del
 *  correo.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';

export type Resultado =
  | { ok: true; mensaje: string }
  | { ok: false; mensaje: string };

/** Quién puede fijar los topes de una salida. */
const PUEDEN = ['gerencia', 'operaciones', 'comercial', 'comex'];

export type DatosTope = {
  embarque_id: number;
  /** Kilos de producto. Nulo = se hereda el tope del destino. */
  peso_neto_max_kg: number | null;
  /** Kilos con empaque. Es el que suele venir en el correo de la naviera. */
  peso_bruto_max_kg: number | null;
  nota_comercial: string | null;
};

export async function guardarTopeEmbarque(d: DatosTope): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión caducó. Vuelva a entrar.' };
  if (!PUEDEN.includes(usuario.rol)) {
    return { ok: false, mensaje: `Su rol (${usuario.rol}) no puede fijar los topes de un embarque.` };
  }

  /*
   * Un tope de cero o negativo no es «sin tope»: es un dato mal escrito que
   * bloquearía cualquier carga. Se distingue del vacío, que sí significa
   * «hereda el del destino».
   */
  for (const [campo, valor] of [
    ['neto', d.peso_neto_max_kg],
    ['bruto', d.peso_bruto_max_kg],
  ] as const) {
    if (valor !== null && !(valor > 0)) {
      return {
        ok: false,
        mensaje: `El peso ${campo} máximo tiene que ser mayor que cero. Déjelo vacío si no hay tope confirmado.`,
      };
    }
  }

  if (d.peso_neto_max_kg && d.peso_bruto_max_kg && d.peso_bruto_max_kg < d.peso_neto_max_kg) {
    return {
      ok: false,
      mensaje:
        'El peso bruto no puede ser menor que el neto: el bruto incluye el empaque. ' +
        'Revise si los números están cambiados.',
    };
  }

  const supabase = await crearClienteServidor();

  const { data: emb } = await supabase
    .from('embarques').select('numero, estado').eq('id', d.embarque_id).maybeSingle();
  if (!emb) return { ok: false, mensaje: 'Ese embarque ya no existe.' };
  if (emb.estado === 'despachado') {
    return {
      ok: false,
      mensaje: `${emb.numero} ya salió: fijarle un tope ahora no cambiaría nada de lo que se cargó.`,
    };
  }

  const nota = d.nota_comercial?.trim() || null;

  /*
   * SE ESCRIBE POR FUNCIÓN, NO CON UN UPDATE DIRECTO.
   *
   * La política de escritura de `embarques` no incluye a Comercial —y no debe
   * incluirlo: le daría también la fecha, la bodega y el destino—. Un UPDATE
   * suyo no fallaba: afectaba a CERO filas y devolvía éxito, así que la
   * pantalla decía «guardado» y no había guardado nada.
   *
   * `fijar_tope_embarque` escribe exactamente estas tres columnas y comprueba
   * el rol por su cuenta. Las políticas limitan filas; esto limita columnas.
   */
  const { error } = await supabase.rpc('fijar_tope_embarque', {
    p_embarque_id: d.embarque_id,
    p_neto_kg: d.peso_neto_max_kg,
    p_bruto_kg: d.peso_bruto_max_kg,
    p_nota: nota,
  });

  if (error) return { ok: false, mensaje: `No se pudo guardar: ${error.message}` };

  /*
   * Y AUN ASÍ SE COMPRUEBA QUE QUEDÓ ESCRITO.
   *
   * Es la lección del fallo anterior: decir «guardado» sin haber mirado es
   * peor que dar un error, porque el usuario se marcha convencido. Una lectura
   * de una fila cuesta nada al lado de eso.
   */
  const { data: verif } = await supabase
    .from('embarques')
    .select('peso_neto_max_kg, peso_bruto_max_kg, nota_comercial')
    .eq('id', d.embarque_id)
    .maybeSingle();

  const guardado =
    Number(verif?.peso_neto_max_kg ?? 0) === Number(d.peso_neto_max_kg ?? 0) &&
    Number(verif?.peso_bruto_max_kg ?? 0) === Number(d.peso_bruto_max_kg ?? 0) &&
    (verif?.nota_comercial ?? null) === nota;

  if (!guardado) {
    return {
      ok: false,
      mensaje:
        'El cambio no llegó a guardarse. Es un problema de permisos sobre el embarque: ' +
        'avise a soporte en vez de volver a intentarlo.',
    };
  }

  await supabase.rpc('registrar_evento', {
    p_entidad: 'embarques',
    p_entidad_id: d.embarque_id,
    p_tipo: 'tope_confirmado',
    p_descripcion:
      `${usuario.nombre} fijó los topes de ${emb.numero}: ` +
      `${d.peso_neto_max_kg ? `neto ${d.peso_neto_max_kg} kg` : 'neto sin tope'}, ` +
      `${d.peso_bruto_max_kg ? `bruto ${d.peso_bruto_max_kg} kg` : 'bruto sin tope'}` +
      (nota ? `. Nota: ${nota}` : ''),
    p_severidad: 'info',
  }).then(() => undefined, () => undefined);

  revalidatePath('/logistica/planificador');
  revalidatePath(`/logistica/embarques/${d.embarque_id}`);
  revalidatePath('/logistica/packing');

  return {
    ok: true,
    mensaje:
      `Topes de ${emb.numero} guardados. ` +
      'Almacén los verá antes de cargar el contenedor.',
  };
}
