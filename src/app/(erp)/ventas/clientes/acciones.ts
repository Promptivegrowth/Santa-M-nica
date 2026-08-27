'use server';

/**
 * ============================================================================
 *  MAESTRO DE CLIENTES · crear, editar, desactivar y borrar
 * ============================================================================
 *  POR QUÉ «DESACTIVAR» Y NO «BORRAR», CASI SIEMPRE
 *  Un cliente al que ya se le facturó no se puede borrar: sus facturas, sus
 *  pedidos y su Kardex apuntan a él. Borrarlo dejaría documentos huérfanos y
 *  reportes que no cuadran con la contabilidad. Por eso hay dos operaciones
 *  distintas y el sistema elige sola cuál corresponde:
 *
 *    · DESACTIVAR — el cliente deja de aparecer para cotizar, pero su
 *      historial sigue entero. Es lo que se hace el 99 % de las veces.
 *    · BORRAR     — solo si NUNCA se le emitió nada. Sirve para deshacer un
 *      alta equivocada: se cargó mal el nombre y se quiere empezar de cero.
 *
 *  Si se pide borrar un cliente con movimientos, no se borra a medias ni se
 *  desactiva en silencio: se explica cuántos documentos lo impiden y se
 *  ofrece desactivarlo.
 *
 *  EL RUC SE VALIDA DE VERDAD
 *  No basta con contar once dígitos: se comprueba el dígito verificador con el
 *  mismo cálculo que hace SUNAT. Un RUC mal tecleado que entra al maestro sale
 *  después impreso en una factura, y ahí ya cuesta caro.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';

export type Resultado =
  | { ok: true; id: number; mensaje: string }
  | { ok: false; mensaje: string; campo?: string };

/** Quién puede tocar el maestro de clientes. */
const PUEDEN_EDITAR = ['gerencia', 'operaciones', 'comercial'];
/** Borrar de verdad es más restrictivo que editar. */
const PUEDEN_BORRAR = ['gerencia', 'operaciones'];

export type DatosCliente = {
  codigo: string;
  razon_social: string;
  nombre_corto: string | null;
  tipo: 'final' | 'intermediario';
  pais: string;
  ruc_tax_id: string | null;
  contacto: string | null;
  email: string | null;
  telefono: string | null;
  vendedor_id: number | null;
  moneda: 'USD' | 'PEN';
  linea_credito: number;
  dias_credito: number;
  bloqueado: boolean;
  motivo_bloqueo: string | null;
};

/** Refresca todo lo que muestra clientes. */
function refrescar(id?: number) {
  revalidatePath('/ventas/clientes');
  if (id) revalidatePath(`/ventas/clientes/${id}`);
  revalidatePath('/ventas/cotizaciones');
  revalidatePath('/ventas/pedidos');
  revalidatePath('/configuracion');
}

/**
 * Dígito verificador de un RUC peruano, por módulo 11.
 *
 * Es el mismo cálculo que la función `ruc_digito_verificador` de la base de
 * datos. Se repite aquí para poder avisar al usuario MIENTRAS escribe, sin
 * esperar a que la base rechace el registro.
 */
function digitoVerificadorRuc(diez: string): number {
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((s, p, i) => s + Number(diez[i]) * p, 0);
  const resto = 11 - (suma % 11);
  return resto === 10 ? 0 : resto === 11 ? 1 : resto;
}

/** ¿Es un RUC peruano válido? Once dígitos y el verificador que corresponde. */
export async function rucValido(ruc: string): Promise<boolean> {
  const limpio = ruc.trim();
  if (!/^\d{11}$/.test(limpio)) return false;
  return digitoVerificadorRuc(limpio.slice(0, 10)) === Number(limpio[10]);
}

/**
 * Revisa los datos antes de tocar la base.
 *
 * Se valida aquí, en el servidor, y no solo en el formulario: la validación
 * del navegador se puede saltar, la del servidor no.
 */
function validar(d: DatosCliente): { mensaje: string; campo: string } | null {
  if (!d.codigo?.trim()) return { mensaje: 'El cliente necesita un código.', campo: 'codigo' };
  if (d.codigo.trim().length > 20) return { mensaje: 'El código no puede pasar de 20 caracteres.', campo: 'codigo' };
  if (!d.razon_social?.trim()) return { mensaje: 'Falta la razón social.', campo: 'razon_social' };
  if (d.razon_social.trim().length > 200) return { mensaje: 'La razón social es demasiado larga.', campo: 'razon_social' };
  if (!d.pais?.trim()) return { mensaje: 'Indique el país: de él depende si la venta lleva IGV.', campo: 'pais' };

  /*
   * El RUC es opcional, pero si se escribe tiene que estar bien. Y para un
   * cliente peruano se insiste: sin RUC el sistema emitirá BOLETA, que a una
   * empresa no le sirve porque no da derecho a crédito fiscal.
   */
  const ruc = d.ruc_tax_id?.trim() ?? '';
  if (d.pais.trim() === 'Perú' && ruc) {
    if (!/^\d{11}$/.test(ruc)) {
      return { mensaje: 'Un RUC peruano tiene exactamente once dígitos.', campo: 'ruc_tax_id' };
    }
    if (digitoVerificadorRuc(ruc.slice(0, 10)) !== Number(ruc[10])) {
      return {
        mensaje: `El RUC ${ruc} no es válido: el último dígito no corresponde. Revise si hay un número cambiado.`,
        campo: 'ruc_tax_id',
      };
    }
  }

  if (d.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) {
    return { mensaje: `«${d.email}» no parece un correo válido.`, campo: 'email' };
  }
  if (d.linea_credito < 0) return { mensaje: 'La línea de crédito no puede ser negativa.', campo: 'linea_credito' };
  if (d.dias_credito < 0 || d.dias_credito > 365) {
    return { mensaje: 'Los días de crédito van de 0 a 365.', campo: 'dias_credito' };
  }
  if (d.bloqueado && !d.motivo_bloqueo?.trim()) {
    return { mensaje: 'Si bloquea al cliente, escriba por qué: alguien va a preguntar.', campo: 'motivo_bloqueo' };
  }
  return null;
}

/** Deja los campos de texto listos para guardar: sin espacios sobrantes, y los vacíos como nulos. */
function limpiar(d: DatosCliente) {
  const texto = (v: string | null) => {
    const t = v?.trim();
    return t ? t : null;
  };
  return {
    codigo: d.codigo.trim(),
    razon_social: d.razon_social.trim(),
    nombre_corto: texto(d.nombre_corto),
    tipo: d.tipo,
    pais: d.pais.trim(),
    ruc_tax_id: texto(d.ruc_tax_id),
    contacto: texto(d.contacto),
    email: texto(d.email),
    telefono: texto(d.telefono),
    vendedor_id: d.vendedor_id ?? null,
    moneda: d.moneda,
    linea_credito: d.linea_credito,
    dias_credito: d.dias_credito,
    bloqueado: d.bloqueado,
    motivo_bloqueo: d.bloqueado ? texto(d.motivo_bloqueo) : null,
  };
}

/** Comprueba el permiso y devuelve el usuario, o el motivo del rechazo. */
async function autorizar(permitidos: string[]) {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { error: 'Su sesión caducó. Vuelva a entrar.' };
  if (!permitidos.includes(usuario.rol)) {
    return { error: `Su rol (${usuario.rol}) no puede modificar el maestro de clientes.` };
  }
  return { usuario };
}

/* ==========================================================================
   CREAR
   ========================================================================== */
export async function crearCliente(d: DatosCliente): Promise<Resultado> {
  const permiso = await autorizar(PUEDEN_EDITAR);
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const problema = validar(d);
  if (problema) return { ok: false, ...problema };

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase
    .from('clientes')
    .insert({ ...limpiar(d), activo: true })
    .select('id')
    .single();

  if (error) {
    // 23505 es la violación de unicidad. El mensaje crudo de PostgreSQL no le
    // dice nada a un comercial; este sí.
    if (error.code === '23505') {
      return { ok: false, mensaje: `Ya existe un cliente con el código ${d.codigo.trim()}.`, campo: 'codigo' };
    }
    return { ok: false, mensaje: `No se pudo crear el cliente: ${error.message}` };
  }

  await supabase.rpc('registrar_evento', {
    p_entidad: 'clientes',
    p_entidad_id: data.id,
    p_tipo: 'cliente_creado',
    p_descripcion: `Alta del cliente ${d.codigo.trim()} · ${d.razon_social.trim()} (${d.pais})`,
    p_severidad: 'info',
    p_metadatos: { pais: d.pais, moneda: d.moneda, con_ruc: Boolean(d.ruc_tax_id?.trim()) },
  }).then(() => undefined, () => undefined);

  refrescar(data.id);
  return { ok: true, id: data.id, mensaje: `Cliente ${d.razon_social.trim()} creado.` };
}

/* ==========================================================================
   EDITAR
   ========================================================================== */
export async function actualizarCliente(id: number, d: DatosCliente): Promise<Resultado> {
  const permiso = await autorizar(PUEDEN_EDITAR);
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const problema = validar(d);
  if (problema) return { ok: false, ...problema };

  const supabase = await crearClienteServidor();

  /*
   * Se lee el estado anterior para poder contar QUÉ cambió en la bitácora.
   * «Se modificó el cliente» no sirve de nada seis meses después; «se le subió
   * la línea de crédito de 80 000 a 220 000» sí.
   */
  const { data: antes } = await supabase
    .from('clientes')
    .select('razon_social, ruc_tax_id, linea_credito, dias_credito, bloqueado, pais')
    .eq('id', id)
    .maybeSingle();

  if (!antes) return { ok: false, mensaje: 'Ese cliente ya no existe.' };

  const { error } = await supabase.from('clientes').update(limpiar(d)).eq('id', id);

  if (error) {
    if (error.code === '23505') {
      return { ok: false, mensaje: `Ya existe otro cliente con el código ${d.codigo.trim()}.`, campo: 'codigo' };
    }
    return { ok: false, mensaje: `No se pudo guardar: ${error.message}` };
  }

  const cambios: string[] = [];
  if (antes.razon_social !== d.razon_social.trim()) cambios.push(`razón social: «${antes.razon_social}» → «${d.razon_social.trim()}»`);
  if ((antes.ruc_tax_id ?? '') !== (d.ruc_tax_id?.trim() ?? '')) cambios.push(`RUC: ${antes.ruc_tax_id ?? 'sin RUC'} → ${d.ruc_tax_id?.trim() ?? 'sin RUC'}`);
  if (Number(antes.linea_credito) !== d.linea_credito) cambios.push(`línea de crédito: ${antes.linea_credito} → ${d.linea_credito}`);
  if (antes.dias_credito !== d.dias_credito) cambios.push(`días de crédito: ${antes.dias_credito} → ${d.dias_credito}`);
  if (antes.bloqueado !== d.bloqueado) cambios.push(d.bloqueado ? 'se bloqueó' : 'se desbloqueó');
  if (antes.pais !== d.pais.trim()) cambios.push(`país: ${antes.pais} → ${d.pais.trim()} (cambia el IGV)`);

  await supabase.rpc('registrar_evento', {
    p_entidad: 'clientes',
    p_entidad_id: id,
    p_tipo: 'cliente_modificado',
    p_descripcion: cambios.length
      ? `Cambios en ${d.razon_social.trim()}: ${cambios.join('; ')}`
      : `Se guardó ${d.razon_social.trim()} sin cambios de fondo`,
    p_severidad: 'info',
    p_metadatos: { cambios },
  }).then(() => undefined, () => undefined);

  refrescar(id);
  return { ok: true, id, mensaje: 'Cliente actualizado.' };
}

/* ==========================================================================
   DESACTIVAR Y REACTIVAR
   ========================================================================== */
export async function cambiarEstadoCliente(id: number, activo: boolean): Promise<Resultado> {
  const permiso = await autorizar(PUEDEN_EDITAR);
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const supabase = await crearClienteServidor();
  const { data: cliente } = await supabase
    .from('clientes').select('razon_social').eq('id', id).maybeSingle();
  if (!cliente) return { ok: false, mensaje: 'Ese cliente ya no existe.' };

  const { error } = await supabase.from('clientes').update({ activo }).eq('id', id);
  if (error) return { ok: false, mensaje: `No se pudo cambiar el estado: ${error.message}` };

  await supabase.rpc('registrar_evento', {
    p_entidad: 'clientes',
    p_entidad_id: id,
    p_tipo: activo ? 'cliente_reactivado' : 'cliente_desactivado',
    p_descripcion: `${activo ? 'Se reactivó' : 'Se desactivó'} el cliente ${cliente.razon_social}`,
    p_severidad: 'info',
  }).then(() => undefined, () => undefined);

  refrescar(id);
  return {
    ok: true,
    id,
    mensaje: activo
      ? `${cliente.razon_social} vuelve a estar disponible para cotizar.`
      : `${cliente.razon_social} ya no aparecerá al cotizar. Su historial queda intacto.`,
  };
}

/* ==========================================================================
   BORRAR DE VERDAD
   ========================================================================== */

/**
 * Cuenta qué documentos impiden borrar un cliente.
 *
 * Se consulta ANTES de intentar el borrado para poder explicarlo. Dejar que
 * falle la clave foránea daría un mensaje de PostgreSQL que no le sirve a
 * nadie: «violates foreign key constraint facturas_cliente_id_fkey».
 */
export async function documentosDelCliente(id: number): Promise<{
  cotizaciones: number; pedidos: number; facturas: number; contactos: number; total: number;
}> {
  const supabase = await crearClienteServidor();
  const contar = async (tabla: string) => {
    const { count } = await supabase
      .from(tabla).select('id', { count: 'exact', head: true }).eq('cliente_id', id);
    return count ?? 0;
  };

  const [cotizaciones, pedidos, facturas, contactos] = await Promise.all([
    contar('cotizaciones'), contar('pedidos'), contar('facturas'), contar('contactos'),
  ]);

  // Los contactos no bloquean: se borran junto con el cliente porque no
  // significan nada sin él. Los documentos sí, porque son historia contable.
  return {
    cotizaciones, pedidos, facturas, contactos,
    total: cotizaciones + pedidos + facturas,
  };
}

export async function eliminarCliente(id: number): Promise<Resultado> {
  const permiso = await autorizar(PUEDEN_BORRAR);
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const supabase = await crearClienteServidor();
  const { data: cliente } = await supabase
    .from('clientes').select('razon_social, codigo').eq('id', id).maybeSingle();
  if (!cliente) return { ok: false, mensaje: 'Ese cliente ya no existe.' };

  const docs = await documentosDelCliente(id);
  if (docs.total > 0) {
    const detalle = [
      docs.cotizaciones ? `${docs.cotizaciones} cotización${docs.cotizaciones === 1 ? '' : 'es'}` : null,
      docs.pedidos ? `${docs.pedidos} pedido${docs.pedidos === 1 ? '' : 's'}` : null,
      docs.facturas ? `${docs.facturas} factura${docs.facturas === 1 ? '' : 's'}` : null,
    ].filter(Boolean).join(', ');

    return {
      ok: false,
      mensaje:
        `No se puede borrar ${cliente.razon_social}: tiene ${detalle}. ` +
        'Borrarlo dejaría esos documentos sin dueño y los reportes dejarían de cuadrar con contabilidad. ' +
        'Use «Desactivar»: el cliente deja de aparecer al cotizar y su historial se conserva.',
    };
  }

  // Los contactos y las cuentas asociadas se van con él: no son historia
  // contable, son datos de agenda que sin el cliente no significan nada.
  await supabase.from('contactos').delete().eq('cliente_id', id);

  const { error } = await supabase.from('clientes').delete().eq('id', id);
  if (error) return { ok: false, mensaje: `No se pudo borrar: ${error.message}` };

  await supabase.rpc('registrar_evento', {
    p_entidad: 'clientes',
    p_entidad_id: null,
    p_tipo: 'cliente_eliminado',
    p_descripcion: `Se borró el cliente ${cliente.codigo} · ${cliente.razon_social}, que no tenía documentos emitidos`,
    p_severidad: 'advertencia',
    p_metadatos: { codigo: cliente.codigo, razon_social: cliente.razon_social },
  }).then(() => undefined, () => undefined);

  refrescar();
  return { ok: true, id, mensaje: `Cliente ${cliente.razon_social} borrado.` };
}

/* ==========================================================================
   AYUDA PARA EL FORMULARIO
   ========================================================================== */

/** Propone el siguiente código libre, con el formato CLI-0000. */
export async function siguienteCodigoCliente(): Promise<string> {
  const supabase = await crearClienteServidor();
  const { data } = await supabase
    .from('clientes').select('codigo').like('codigo', 'CLI-%')
    .order('codigo', { ascending: false }).limit(1).maybeSingle();

  const ultimo = Number(String(data?.codigo ?? 'CLI-0000').replace('CLI-', '')) || 0;
  return `CLI-${String(ultimo + 1).padStart(4, '0')}`;
}
