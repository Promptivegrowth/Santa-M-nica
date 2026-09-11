'use server';

/**
 * ============================================================================
 *  LO QUE EL CLIENTE LE DICE A COMERCIAL SOBRE EL PESO
 * ============================================================================
 *  Oliver lo describió como el problema que más les cuesta:
 *
 *    «Dependemos mucho de un correo que a veces lo envían a última hora en el
 *     que nos ponen el peso neto o el peso bruto total que puede ir en el
 *     contenedor. Y a veces tenemos el contenedor ya cargando y todavía no
 *     confirman.»
 *
 *  POR QUÉ VIVE EN EL PEDIDO Y NO EN EL EMBARQUE
 *  Porque se lo preguntamos y fue tajante:
 *
 *    «Esa restricción debe registrarse en el pedido, ya que no hay un maestro.
 *     El 90 % de las observaciones son que el cliente indica a Comercial.»
 *
 *  La primera versión la puso en el embarque y en un maestro por destino. Las
 *  dos estaban mal: el maestro no existe en su operación, y el embarque puede
 *  consolidar dos pedidos —entonces no hay forma de saber a cuál de los dos
 *  clientes pertenece el límite que se está escribiendo—.
 *
 *  El planificador sigue enseñándolo, calculado sobre los pedidos de cada
 *  salida y quedándose con el más estricto.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';

export type Resultado =
  | { ok: true; mensaje: string }
  | { ok: false; mensaje: string };

/** Quién puede dejar anotada la restricción del cliente. */
const PUEDEN = ['gerencia', 'operaciones', 'comercial', 'comex'];

export type DatosRestriccion = {
  pedido_id: number;
  /** Kilos de producto. Nulo = el cliente no puso límite. */
  peso_neto_max_kg: number | null;
  /** Kilos con empaque. Es el que suele venir en el correo de la naviera. */
  peso_bruto_max_kg: number | null;
  nota_restricciones: string | null;
};

export async function guardarRestriccionPedido(d: DatosRestriccion): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión caducó. Vuelva a entrar.' };
  if (!PUEDEN.includes(usuario.rol)) {
    return {
      ok: false,
      mensaje: `Su rol (${usuario.rol}) no puede fijar restricciones de peso.`,
    };
  }

  /*
   * Un tope de cero o negativo no es «sin tope»: es un dato mal escrito que
   * bloquearía cualquier carga. Se distingue del vacío, que sí significa
   * «el cliente no puso límite».
   */
  for (const [campo, valor] of [
    ['neto', d.peso_neto_max_kg],
    ['bruto', d.peso_bruto_max_kg],
  ] as const) {
    if (valor !== null && !(valor > 0)) {
      return {
        ok: false,
        mensaje: `El peso ${campo} máximo tiene que ser mayor que cero. Déjelo vacío si el cliente no indicó límite.`,
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

  const { data: ped } = await supabase
    .from('pedidos').select('numero_proforma, ciclo').eq('id', d.pedido_id).maybeSingle();
  if (!ped) return { ok: false, mensaje: 'Ese pedido ya no existe.' };
  if (['despachado', 'cerrado', 'cancelado'].includes(ped.ciclo as string)) {
    return {
      ok: false,
      mensaje:
        `${ped.numero_proforma} ya está ${ped.ciclo}: cambiarle la restricción ahora no ` +
        'afectaría a nada de lo que se cargó.',
    };
  }

  const nota = d.nota_restricciones?.trim() || null;

  /*
   * SE ESCRIBE POR FUNCIÓN, NO CON UN UPDATE DIRECTO.
   *
   * La política de escritura de `pedidos` es más estrecha que esto, y con
   * razón: darle a Comercial el UPDATE de la tabla le daría también el
   * destino, las fechas y el ciclo. Un UPDATE suyo no fallaba —afectaba a CERO
   * filas y devolvía éxito—, así que la pantalla decía «guardado» sin haber
   * guardado nada.
   *
   * `fijar_restriccion_pedido` escribe exactamente estas tres columnas y
   * comprueba el rol por su cuenta. Las políticas limitan filas; esto limita
   * columnas.
   */
  const { error } = await supabase.rpc('fijar_restriccion_pedido', {
    p_pedido_id: d.pedido_id,
    p_neto_kg: d.peso_neto_max_kg,
    p_bruto_kg: d.peso_bruto_max_kg,
    p_nota: nota,
  });

  if (error) return { ok: false, mensaje: `No se pudo guardar: ${error.message}` };

  /*
   * Y AUN ASÍ SE COMPRUEBA QUE QUEDÓ ESCRITO.
   *
   * Es la lección del fallo anterior: decir «guardado» sin haber mirado es
   * peor que dar un error, porque el usuario se marcha convencido. Leer una
   * fila cuesta nada al lado de eso.
   */
  const { data: verif } = await supabase
    .from('pedidos')
    .select('peso_neto_max_kg, peso_bruto_max_kg, nota_restricciones')
    .eq('id', d.pedido_id)
    .maybeSingle();

  const guardado =
    Number(verif?.peso_neto_max_kg ?? 0) === Number(d.peso_neto_max_kg ?? 0) &&
    Number(verif?.peso_bruto_max_kg ?? 0) === Number(d.peso_bruto_max_kg ?? 0) &&
    (verif?.nota_restricciones ?? null) === nota;

  if (!guardado) {
    return {
      ok: false,
      mensaje:
        'El cambio no llegó a guardarse. Es un problema de permisos sobre el pedido: ' +
        'avise a soporte en vez de volver a intentarlo.',
    };
  }

  await supabase.rpc('registrar_evento', {
    p_entidad: 'pedidos',
    p_entidad_id: d.pedido_id,
    p_tipo: 'restriccion_peso',
    p_descripcion:
      `${usuario.nombre} fijó la restricción de peso de ${ped.numero_proforma}: ` +
      `${d.peso_neto_max_kg ? `neto ${d.peso_neto_max_kg} kg` : 'neto sin límite'}, ` +
      `${d.peso_bruto_max_kg ? `bruto ${d.peso_bruto_max_kg} kg` : 'bruto sin límite'}` +
      (nota ? `. Nota: ${nota}` : ''),
    p_severidad: 'info',
  }).then(() => undefined, () => undefined);

  revalidatePath(`/ventas/pedidos/${d.pedido_id}`);
  revalidatePath('/logistica/planificador');
  revalidatePath('/logistica/packing');

  return {
    ok: true,
    mensaje:
      `Restricción de ${ped.numero_proforma} guardada. ` +
      'Almacén la verá en el planificador antes de cargar el contenedor.',
  };
}
