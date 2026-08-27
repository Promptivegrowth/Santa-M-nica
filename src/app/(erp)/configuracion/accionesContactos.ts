'use server';

/**
 * ============================================================================
 *  MAESTRO DE CONTACTOS Y CUENTAS BANCARIAS
 * ============================================================================
 *  Los dos viven en la misma pantalla y en el mismo archivo porque se usan
 *  juntos: los dos aparecen en la cotización y en la proforma, y quien
 *  mantiene uno mantiene el otro.
 *
 *  Se parecen en la forma y se diferencian en el riesgo:
 *
 *    UN CONTACTO      es un dato de agenda. Si está mal, el correo rebota.
 *                     Lo edita cualquiera del área comercial.
 *
 *    UNA CUENTA       es donde el cliente deposita el dinero. Cambiar un
 *                     número de cuenta en un documento que sale de la empresa
 *                     es la forma más barata que existe de desviar un cobro,
 *                     así que solo gerencia y operaciones la tocan, y nunca
 *                     se borra: se desactiva.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';

export type Resultado =
  | { ok: true; id: number; mensaje: string }
  | { ok: false; mensaje: string; campo?: string };

const PUEDEN_CONTACTOS = ['gerencia', 'operaciones', 'comercial', 'comex'];
const PUEDEN_CUENTAS = ['gerencia', 'operaciones'];

/** Refresca todo lo que muestra estos datos. */
function refrescar() {
  revalidatePath('/configuracion');
  revalidatePath('/ventas/cotizaciones');
  revalidatePath('/ventas/clientes');
}

/* ==========================================================================
   CONTACTOS
   ========================================================================== */

export type DatosContacto = {
  cliente_id: number;
  nombre: string;
  cargo: string | null;
  telefono: string | null;
  email: string | null;
  principal: boolean;
};

/**
 * Comprueba lo mínimo. Deliberadamente poco: se pidió que el contacto no
 * bloqueara nada, así que solo se exige el nombre —sin nombre no es un
 * contacto— y que el correo, si se escribe, parezca un correo.
 */
function validarContacto(d: DatosContacto): string | null {
  if (!d.cliente_id) return 'Elija a qué cliente pertenece el contacto.';
  if (!d.nombre?.trim()) return 'El contacto necesita un nombre.';
  if (d.nombre.trim().length > 120) return 'El nombre es demasiado largo.';
  if (d.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) {
    return `«${d.email}» no parece un correo válido.`;
  }
  return null;
}

export async function crearContacto(d: DatosContacto): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró.' };
  if (!PUEDEN_CONTACTOS.includes(usuario.rol)) {
    return { ok: false, mensaje: 'Su rol no puede administrar contactos.' };
  }

  const problema = validarContacto(d);
  if (problema) return { ok: false, mensaje: problema };

  const supabase = await crearClienteServidor();

  /*
   * Solo puede haber un principal por cliente, y hay un índice único que lo
   * garantiza. Antes de marcar este, se desmarca el anterior: si no, el
   * insert chocaría contra el índice y el usuario vería un error de base de
   * datos en vez de que las cosas simplemente funcionen.
   */
  if (d.principal) {
    await supabase.from('contactos')
      .update({ principal: false })
      .eq('cliente_id', d.cliente_id)
      .eq('principal', true);
  }

  const { data, error } = await supabase
    .from('contactos')
    .insert({
      cliente_id: d.cliente_id,
      nombre: d.nombre.trim(),
      cargo: d.cargo?.trim() || null,
      telefono: d.telefono?.trim() || null,
      email: d.email?.trim() || null,
      principal: d.principal,
      creado_por: usuario.id,
    })
    .select('id')
    .single();

  if (error) return { ok: false, mensaje: `No se pudo guardar: ${error.message}` };

  refrescar();
  return { ok: true, id: data.id as number, mensaje: `Contacto ${d.nombre} agregado.` };
}

export async function actualizarContacto(id: number, d: DatosContacto): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró.' };
  if (!PUEDEN_CONTACTOS.includes(usuario.rol)) {
    return { ok: false, mensaje: 'Su rol no puede administrar contactos.' };
  }

  const problema = validarContacto(d);
  if (problema) return { ok: false, mensaje: problema };

  const supabase = await crearClienteServidor();

  if (d.principal) {
    await supabase.from('contactos')
      .update({ principal: false })
      .eq('cliente_id', d.cliente_id)
      .eq('principal', true)
      .neq('id', id);
  }

  const { error } = await supabase
    .from('contactos')
    .update({
      nombre: d.nombre.trim(),
      cargo: d.cargo?.trim() || null,
      telefono: d.telefono?.trim() || null,
      email: d.email?.trim() || null,
      principal: d.principal,
    })
    .eq('id', id);

  if (error) return { ok: false, mensaje: `No se pudo guardar: ${error.message}` };

  refrescar();
  return { ok: true, id, mensaje: `Contacto ${d.nombre} actualizado.` };
}

/**
 * No se borra: se desactiva.
 *
 * Un contacto puede estar citado en cotizaciones de hace un año. Borrarlo
 * dejaría esos documentos diciendo «dirigido a nadie», y la copia que guarda
 * cada cotización perdería su referencia al maestro.
 */
export async function desactivarContacto(id: number): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró.' };
  if (!PUEDEN_CONTACTOS.includes(usuario.rol)) {
    return { ok: false, mensaje: 'Su rol no puede administrar contactos.' };
  }

  const supabase = await crearClienteServidor();
  const { error } = await supabase
    .from('contactos')
    .update({ activo: false, principal: false })
    .eq('id', id);

  if (error) return { ok: false, mensaje: `No se pudo desactivar: ${error.message}` };

  refrescar();
  return { ok: true, id, mensaje: 'Contacto desactivado. Las cotizaciones que lo citan lo conservan.' };
}

export async function reactivarContacto(id: number): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró.' };
  if (!PUEDEN_CONTACTOS.includes(usuario.rol)) {
    return { ok: false, mensaje: 'Su rol no puede administrar contactos.' };
  }

  const supabase = await crearClienteServidor();
  const { error } = await supabase.from('contactos').update({ activo: true }).eq('id', id);
  if (error) return { ok: false, mensaje: `No se pudo reactivar: ${error.message}` };

  refrescar();
  return { ok: true, id, mensaje: 'Contacto reactivado.' };
}

/* ==========================================================================
   CUENTAS BANCARIAS
   ========================================================================== */

export type DatosCuenta = {
  banco: string;
  tipo: 'corriente' | 'ahorros' | 'detraccion';
  moneda: 'USD' | 'PEN';
  numero: string;
  cci: string | null;
  swift: string | null;
  titular: string | null;
  principal: boolean;
  observaciones: string | null;
};

function validarCuenta(d: DatosCuenta): string | null {
  if (!d.banco?.trim()) return 'Indique el banco.';
  if (!d.numero?.trim()) return 'Indique el número de cuenta.';

  /*
   * La detracción es un régimen peruano y siempre va en soles, en el Banco de
   * la Nación. La base tiene una restricción que lo impide, pero se comprueba
   * también aquí para poder explicarlo en castellano en vez de mostrar el
   * error de PostgreSQL.
   */
  if (d.tipo === 'detraccion' && d.moneda !== 'PEN') {
    return 'La cuenta de detracción es siempre en soles: el régimen no admite dólares.';
  }

  // El CCI peruano tiene exactamente 20 dígitos, con o sin guiones.
  if (d.cci?.trim()) {
    const digitos = d.cci.replace(/\D/g, '');
    if (digitos.length !== 20) {
      return `El CCI debe tener 20 dígitos y este tiene ${digitos.length}.`;
    }
  }

  // El SWIFT/BIC son 8 u 11 caracteres.
  if (d.swift?.trim() && !/^[A-Za-z]{6}[A-Za-z0-9]{2}([A-Za-z0-9]{3})?$/.test(d.swift.trim())) {
    return 'El código SWIFT debe tener 8 u 11 caracteres (por ejemplo, BCONPEPL).';
  }

  return null;
}

export async function crearCuenta(d: DatosCuenta): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró.' };
  if (!PUEDEN_CUENTAS.includes(usuario.rol)) {
    return {
      ok: false,
      mensaje: 'Solo gerencia u operaciones pueden dar de alta una cuenta bancaria.',
    };
  }

  const problema = validarCuenta(d);
  if (problema) return { ok: false, mensaje: problema };

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase
    .from('cuentas_bancarias')
    .insert({
      banco: d.banco.trim(),
      tipo: d.tipo,
      moneda: d.moneda,
      numero: d.numero.trim(),
      cci: d.cci?.trim() || null,
      swift: d.swift?.trim().toUpperCase() || null,
      titular: d.titular?.trim() || null,
      principal: d.principal,
      observaciones: d.observaciones?.trim() || null,
    })
    .select('id')
    .single();

  if (error) return { ok: false, mensaje: `No se pudo guardar: ${error.message}` };

  refrescar();
  return { ok: true, id: data.id as number, mensaje: `Cuenta de ${d.banco} agregada.` };
}

export async function actualizarCuenta(id: number, d: DatosCuenta): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró.' };
  if (!PUEDEN_CUENTAS.includes(usuario.rol)) {
    return { ok: false, mensaje: 'Solo gerencia u operaciones pueden modificar una cuenta.' };
  }

  const problema = validarCuenta(d);
  if (problema) return { ok: false, mensaje: problema };

  const supabase = await crearClienteServidor();
  const { error } = await supabase
    .from('cuentas_bancarias')
    .update({
      banco: d.banco.trim(),
      tipo: d.tipo,
      moneda: d.moneda,
      numero: d.numero.trim(),
      cci: d.cci?.trim() || null,
      swift: d.swift?.trim().toUpperCase() || null,
      titular: d.titular?.trim() || null,
      principal: d.principal,
      observaciones: d.observaciones?.trim() || null,
    })
    .eq('id', id);

  if (error) return { ok: false, mensaje: `No se pudo guardar: ${error.message}` };

  refrescar();
  return { ok: true, id, mensaje: `Cuenta de ${d.banco} actualizada.` };
}

/**
 * Tampoco se borra. Los documentos ya emitidos la siguen mostrando —es lo
 * correcto: decían esa cuenta el día que salieron— y deja de ofrecerse para
 * los nuevos.
 */
export async function cambiarEstadoCuenta(id: number, activo: boolean): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró.' };
  if (!PUEDEN_CUENTAS.includes(usuario.rol)) {
    return { ok: false, mensaje: 'Solo gerencia u operaciones pueden dar de baja una cuenta.' };
  }

  const supabase = await crearClienteServidor();
  const { error } = await supabase
    .from('cuentas_bancarias')
    .update({ activo, principal: activo ? undefined : false })
    .eq('id', id);

  if (error) return { ok: false, mensaje: `No se pudo cambiar: ${error.message}` };

  refrescar();
  return {
    ok: true,
    id,
    mensaje: activo
      ? 'Cuenta reactivada.'
      : 'Cuenta dada de baja. Los documentos ya emitidos la siguen mostrando.',
  };
}
