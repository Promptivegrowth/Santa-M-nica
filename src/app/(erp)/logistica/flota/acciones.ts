'use server';

/**
 * ============================================================================
 *  FLOTA · alta, edición y baja de transportistas, vehículos y conductores
 * ============================================================================
 *  La pantalla de Flota era de solo lectura: un camión nuevo, un SOAT
 *  renovado o un chofer que entra no tenían dónde cargarse, y el control que
 *  impide programar un vehículo con documentos vencidos trabajaba con fechas
 *  que nadie podía poner al día.
 *
 *  LO QUE SE PUEDE Y LO QUE NO
 *  · Dar de alta y editar: con sus datos reales (placa, capacidad, SOAT,
 *    revisión técnica; DNI, brevete y su vencimiento; RUC y contacto).
 *  · DESACTIVAR, no borrar, lo que ya se usó: un camión que llevó embarques
 *    figura en sus guías y en su historial. Desactivado deja de ofrecerse al
 *    programar, pero lo pasado sigue diciendo qué camión fue.
 *  · Borrar solo lo que nunca se usó (un alta equivocada).
 *
 *  Lo hacen Gerencia, Operaciones y Comercio Exterior —quien coordina el
 *  transporte—. La base lo vuelve a exigir con sus políticas (migración 068).
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { NOMBRE_ROL, type Rol } from '@/lib/navegacion';

export type ResultadoFlota = { ok: true; id: number; mensaje: string } | { ok: false; mensaje: string; campo?: string };

const PUEDEN = ['gerencia', 'operaciones', 'comex'];

export type TablaFlota = 'transportistas' | 'vehiculos' | 'conductores';
const NOMBRE: Record<TablaFlota, string> = {
  transportistas: 'el transportista', vehiculos: 'el vehículo', conductores: 'el conductor',
};

async function autorizar() {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { error: 'Su sesión caducó. Vuelva a entrar.' };
  if (!PUEDEN.includes(usuario.rol)) {
    return { error: `${NOMBRE_ROL[usuario.rol as Rol] ?? 'Su rol'} no puede modificar la flota: lo hacen Gerencia, Operaciones y Comercio Exterior.` };
  }
  return { usuario };
}

function refrescar() {
  revalidatePath('/logistica/flota');
  revalidatePath('/logistica/embarques/nuevo');
  revalidatePath('/configuracion');
}

const limpio = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);
const fechaValida = (v: string | null) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Inserta o actualiza, y comprueba que la escritura de verdad ocurrió (RLS). */
async function guardar(tabla: TablaFlota, id: number | null, fila: Record<string, unknown>, texto: string): Promise<ResultadoFlota> {
  const supabase = await crearClienteServidor();
  const consulta = id
    ? supabase.from(tabla).update(fila).eq('id', id).select('id')
    : supabase.from(tabla).insert(fila).select('id');
  const { data, error } = await consulta;
  if (error) {
    if (error.code === '23505') return { ok: false, mensaje: 'Ya existe un vehículo con esa placa.', campo: 'placa' };
    return { ok: false, mensaje: `No se pudo guardar ${NOMBRE[tabla]}: ${error.message}` };
  }
  //  Sin filas y sin error es la política de la base diciendo que no.
  if (!data?.length) return { ok: false, mensaje: `No tiene permiso para modificar ${NOMBRE[tabla]}.` };
  refrescar();
  return { ok: true, id: Number(data[0].id), mensaje: id ? `${texto} actualizado.` : `${texto} dado de alta.` };
}

/* ==========================================================================
   TRANSPORTISTAS
   ========================================================================== */
export type DatosTransportista = {
  razon_social: string;
  tipo: 'propio' | 'tercero';
  ruc: string | null;
  contacto: string | null;
  telefono: string | null;
};

export async function guardarTransportista(id: number | null, d: DatosTransportista): Promise<ResultadoFlota> {
  const permiso = await autorizar();
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const razon = limpio(d.razon_social);
  if (!razon) return { ok: false, mensaje: 'Escriba la razón social del transportista.', campo: 'razon_social' };
  if (d.tipo !== 'propio' && d.tipo !== 'tercero') return { ok: false, mensaje: 'Indique si es flota propia o de un tercero.', campo: 'tipo' };
  const ruc = limpio(d.ruc);
  if (ruc && !/^\d{11}$/.test(ruc)) return { ok: false, mensaje: 'El RUC tiene 11 dígitos, sin espacios ni guiones.', campo: 'ruc' };

  return guardar('transportistas', id, {
    razon_social: razon, tipo: d.tipo, ruc, contacto: limpio(d.contacto), telefono: limpio(d.telefono),
  }, `Transportista ${razon}`);
}

/* ==========================================================================
   VEHÍCULOS
   ========================================================================== */
export type DatosVehiculo = {
  placa: string;
  transportista_id: number | null;
  marca: string | null;
  modelo: string | null;
  capacidad_tm: number | null;
  soat_vence: string | null;
  revision_vence: string | null;
};

export async function guardarVehiculo(id: number | null, d: DatosVehiculo): Promise<ResultadoFlota> {
  const permiso = await autorizar();
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  //  La placa se guarda como se escribe en la tarjeta: mayúsculas y con guion.
  const placa = limpio(d.placa)?.toUpperCase().replace(/\s+/g, '') ?? null;
  if (!placa) return { ok: false, mensaje: 'Escriba la placa del vehículo.', campo: 'placa' };
  if (!/^[A-Z0-9-]{5,10}$/.test(placa)) {
    return { ok: false, mensaje: 'La placa lleva letras y números, con o sin guion (por ejemplo, C4M-238).', campo: 'placa' };
  }
  //  En la base el vehículo siempre pertenece a un transportista (también el propio).
  if (!d.transportista_id) {
    return { ok: false, mensaje: 'Elija de qué transportista es. Si es de la empresa, elija el transportista propio.', campo: 'transportista_id' };
  }
  const capacidad = d.capacidad_tm === null || d.capacidad_tm === undefined || String(d.capacidad_tm) === '' ? null : Number(d.capacidad_tm);
  if (capacidad !== null && (!Number.isFinite(capacidad) || capacidad <= 0 || capacidad > 60)) {
    return { ok: false, mensaje: 'La capacidad va en toneladas, mayor que cero y razonable para un camión (hasta 60 TM).', campo: 'capacidad_tm' };
  }
  const soat = limpio(d.soat_vence);
  const revision = limpio(d.revision_vence);
  if (!fechaValida(soat)) return { ok: false, mensaje: 'La fecha del SOAT no es válida.', campo: 'soat_vence' };
  if (!fechaValida(revision)) return { ok: false, mensaje: 'La fecha de la revisión técnica no es válida.', campo: 'revision_vence' };

  return guardar('vehiculos', id, {
    placa, transportista_id: d.transportista_id, marca: limpio(d.marca), modelo: limpio(d.modelo),
    capacidad_tm: capacidad, soat_vence: soat, revision_vence: revision,
  }, `Vehículo ${placa}`);
}

/* ==========================================================================
   CONDUCTORES
   ========================================================================== */
export type DatosConductor = {
  nombre: string;
  dni: string | null;
  licencia: string | null;
  licencia_vence: string | null;
  transportista_id: number | null;
  telefono: string | null;
};

export async function guardarConductor(id: number | null, d: DatosConductor): Promise<ResultadoFlota> {
  const permiso = await autorizar();
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const nombre = limpio(d.nombre);
  if (!nombre) return { ok: false, mensaje: 'Escriba el nombre del conductor.', campo: 'nombre' };
  const dni = limpio(d.dni);
  if (dni && !/^\d{8}$/.test(dni)) return { ok: false, mensaje: 'El DNI tiene 8 dígitos.', campo: 'dni' };
  const licencia = limpio(d.licencia)?.toUpperCase() ?? null;
  const vence = limpio(d.licencia_vence);
  if (!fechaValida(vence)) return { ok: false, mensaje: 'La fecha de vencimiento del brevete no es válida.', campo: 'licencia_vence' };
  if (vence && !licencia) return { ok: false, mensaje: 'Si pone el vencimiento, escriba también el número de brevete.', campo: 'licencia' };

  return guardar('conductores', id, {
    nombre, dni, licencia, licencia_vence: vence, transportista_id: d.transportista_id || null, telefono: limpio(d.telefono),
  }, `Conductor ${nombre}`);
}

/* ==========================================================================
   DESACTIVAR, REACTIVAR Y BORRAR
   ========================================================================== */

/** Dónde se usó: embarques y traslados (y, para un transportista, su flota). */
async function usoDe(tabla: TablaFlota, id: number): Promise<string[]> {
  const supabase = await crearClienteServidor();
  const col = tabla === 'transportistas' ? 'transportista_id' : tabla === 'vehiculos' ? 'vehiculo_id' : 'conductor_id';
  const cuenta = async (t: string, c: string) =>
    (await supabase.from(t).select('id', { count: 'exact', head: true }).eq(c, id)).count ?? 0;
  const usos: string[] = [];
  const emb = await cuenta('embarques', col);
  if (emb) usos.push(`${emb} embarque${emb === 1 ? '' : 's'}`);
  const tras = await cuenta('traslados', col);
  if (tras) usos.push(`${tras} traslado${tras === 1 ? '' : 's'}`);
  if (tabla === 'transportistas') {
    const v = await cuenta('vehiculos', 'transportista_id');
    if (v) usos.push(`${v} vehículo${v === 1 ? '' : 's'}`);
    const c = await cuenta('conductores', 'transportista_id');
    if (c) usos.push(`${c} conductor${c === 1 ? '' : 'es'}`);
  }
  return usos;
}

export async function cambiarActivo(tabla: TablaFlota, id: number, activo: boolean): Promise<ResultadoFlota> {
  const permiso = await autorizar();
  if (permiso.error) return { ok: false, mensaje: permiso.error };
  if (!['transportistas', 'vehiculos', 'conductores'].includes(tabla)) return { ok: false, mensaje: 'Tabla desconocida.' };

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.from(tabla).update({ activo }).eq('id', id).select('id');
  if (error) return { ok: false, mensaje: `No se pudo cambiar: ${error.message}` };
  if (!data?.length) return { ok: false, mensaje: `No tiene permiso para modificar ${NOMBRE[tabla]}.` };

  /*
   * Desactivar no toca lo ya programado: se avisa si quedan embarques por
   * salir con este vehículo o chofer, para que alguien los reasigne.
   */
  let aviso = '';
  if (!activo && tabla !== 'transportistas') {
    const col = tabla === 'vehiculos' ? 'vehiculo_id' : 'conductor_id';
    const { count } = await supabase.from('embarques').select('id', { count: 'exact', head: true })
      .eq(col, id).in('estado', ['planificado', 'confirmado', 'en_preparacion']);
    if (count) aviso = ` Ojo: sigue asignado a ${count} embarque${count === 1 ? '' : 's'} por salir; reasígnelos desde «Editar embarque».`;
  }

  refrescar();
  return {
    ok: true, id,
    mensaje: activo
      ? 'Reactivado: vuelve a ofrecerse al programar embarques.'
      : `Desactivado: ya no se ofrece al programar embarques, y lo pasado conserva su dato.${aviso}`,
  };
}

export async function eliminarDeFlota(tabla: TablaFlota, id: number): Promise<ResultadoFlota> {
  const permiso = await autorizar();
  if (permiso.error) return { ok: false, mensaje: permiso.error };
  if (!['transportistas', 'vehiculos', 'conductores'].includes(tabla)) return { ok: false, mensaje: 'Tabla desconocida.' };

  const usos = await usoDe(tabla, id);
  if (usos.length) {
    return {
      ok: false,
      mensaje: `No se puede borrar ${NOMBRE[tabla]}: figura en ${usos.join(', ')}. Desactívelo: deja de ofrecerse y lo pasado conserva su dato.`,
    };
  }
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.from(tabla).delete().eq('id', id).select('id');
  if (error) {
    if (error.code === '23503') return { ok: false, mensaje: `No se puede borrar ${NOMBRE[tabla]}: otro registro lo usa. Desactívelo.` };
    return { ok: false, mensaje: `No se pudo borrar: ${error.message}` };
  }
  if (!data?.length) return { ok: false, mensaje: `No tiene permiso para borrar ${NOMBRE[tabla]}.` };
  refrescar();
  return { ok: true, id, mensaje: 'Borrado: no se había usado nunca.' };
}
