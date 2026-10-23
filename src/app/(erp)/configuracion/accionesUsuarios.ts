'use server';

/**
 * ============================================================================
 *  USUARIOS · alta, rol, estado y contraseña
 * ============================================================================
 *  CÓMO SE CREA UN USUARIO SIN LA CLAVE DE SERVICIO
 *  En producción la aplicación solo tiene la clave anónima de Supabase, que no
 *  sirve para la API de administración (crear o invitar usuarios). Y no debe
 *  tener la otra: la clave de servicio se salta todas las políticas.
 *
 *  Por eso todo pasa por funciones de la base (migración 070) que corren con
 *  los permisos de su dueño —pueden escribir en auth.users— pero que lo
 *  primero que hacen es comprobar que quien llama es de Gerencia:
 *
 *    usuario_crear             cuenta de acceso + ficha, con contraseña temporal
 *    usuario_cambiar_rol       el rol (y el almacén, para el rol Almacén)
 *    usuario_cambiar_estado    activar / desactivar (corta también la sesión)
 *    usuario_restablecer_clave nueva contraseña temporal, si la olvidó
 *    cambiar_mi_clave          cada uno la suya, sabiendo la actual
 *
 *  Gerencia comunica la contraseña temporal en persona; al entrar, el sistema
 *  obliga a cambiarla. No hay correo de por medio: el proyecto no tiene un
 *  servidor de correo propio y el de Supabase no sirve para esto.
 *
 *  Aquí se adelantan las comprobaciones baratas (para responder sin ir a la
 *  base), pero la última palabra es de la base.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { NOMBRE_ROL, type Rol } from '@/lib/navegacion';

export type ResultadoUsuario = { ok: boolean; mensaje: string; id?: string };

const ROLES = Object.keys(NOMBRE_ROL) as Rol[];

/** El mensaje de la base, sin el prefijo técnico cuando lo trae. */
function motivo(mensaje: string | undefined): string {
  return (mensaje ?? 'Error desconocido.').replace(/^ERROR:\s*/i, '').trim();
}

/** Las mismas reglas que impone la base (usuario_validar_clave). */
function problemaDeClave(clave: string): string | null {
  if (!clave || clave.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(clave) || !/[0-9]/.test(clave)) {
    return 'La contraseña debe combinar letras y números.';
  }
  return null;
}

async function soloGerencia(): Promise<{ id: string } | ResultadoUsuario> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró. Vuelva a iniciar sesión.' };
  if (usuario.rol !== 'gerencia') {
    return { ok: false, mensaje: 'Solo Gerencia administra los usuarios.' };
  }
  return { id: usuario.id as string };
}

function refrescar() {
  revalidatePath('/configuracion');
}

/* ==========================================================================
   ALTA
   ========================================================================== */
export async function crearUsuario(d: {
  nombre: string;
  email: string;
  rol: string;
  clave: string;
  almacenId: number | null;
}): Promise<ResultadoUsuario> {
  const quien = await soloGerencia();
  if ('ok' in quien) return quien;

  const nombre = d.nombre.trim();
  const email = d.email.trim().toLowerCase();
  if (nombre.length < 3) return { ok: false, mensaje: 'Escriba el nombre completo de la persona.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, mensaje: 'El correo no tiene forma de correo (nombre@empresa.pe).' };
  }
  if (!ROLES.includes(d.rol as Rol)) return { ok: false, mensaje: 'Elija el rol de la persona.' };
  const malaClave = problemaDeClave(d.clave);
  if (malaClave) return { ok: false, mensaje: malaClave };

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc('usuario_crear', {
    p_email: email,
    p_nombre: nombre,
    p_rol: d.rol,
    p_clave: d.clave,
    p_almacen_id: d.rol === 'almacen' ? d.almacenId : null,
  });
  if (error) return { ok: false, mensaje: motivo(error.message) };

  refrescar();
  return {
    ok: true,
    id: String(data),
    mensaje:
      `Usuario creado: ${nombre} (${email}), rol ${NOMBRE_ROL[d.rol as Rol]}. ` +
      'Comuníquele en persona la contraseña temporal: al entrar por primera vez el sistema le pedirá cambiarla.',
  };
}

/* ==========================================================================
   ROL
   ========================================================================== */
export async function cambiarRolUsuario(
  usuarioId: string,
  rol: string,
  almacenId: number | null = null
): Promise<ResultadoUsuario> {
  const quien = await soloGerencia();
  if ('ok' in quien) return quien;
  if (!ROLES.includes(rol as Rol)) return { ok: false, mensaje: 'Ese rol no existe.' };
  if (usuarioId === quien.id && rol !== 'gerencia') {
    return { ok: false, mensaje: 'No puede quitarse a sí mismo el rol Gerencia: pídaselo a otra persona de Gerencia.' };
  }

  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('usuario_cambiar_rol', {
    p_id: usuarioId, p_rol: rol, p_almacen_id: almacenId,
  });
  if (error) return { ok: false, mensaje: motivo(error.message) };

  // Se relee: una escritura bloqueada no da error, deja la fila como estaba.
  const { data: verif } = await supabase.from('usuarios').select('nombre, rol').eq('id', usuarioId).maybeSingle();
  if (verif?.rol !== rol) {
    return { ok: false, mensaje: 'El cambio no llegó a guardarse. Es un problema de permisos: avise a soporte.' };
  }
  refrescar();
  return {
    ok: true,
    mensaje: `${verif.nombre} ahora tiene el rol ${NOMBRE_ROL[rol as Rol]}. Lo verá la próxima vez que cambie de pantalla.`,
  };
}

/* ==========================================================================
   ESTADO
   ========================================================================== */
export async function cambiarEstadoUsuario(usuarioId: string, activo: boolean): Promise<ResultadoUsuario> {
  const quien = await soloGerencia();
  if ('ok' in quien) return quien;
  if (usuarioId === quien.id && !activo) {
    return { ok: false, mensaje: 'No puede desactivar su propia cuenta: pídaselo a otra persona de Gerencia.' };
  }

  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('usuario_cambiar_estado', { p_id: usuarioId, p_activo: activo });
  if (error) return { ok: false, mensaje: motivo(error.message) };

  const { data: verif } = await supabase.from('usuarios').select('nombre, activo').eq('id', usuarioId).maybeSingle();
  if (verif?.activo !== activo) {
    return { ok: false, mensaje: 'El cambio no llegó a guardarse. Es un problema de permisos: avise a soporte.' };
  }
  refrescar();
  return {
    ok: true,
    mensaje: activo
      ? `${verif.nombre} vuelve a tener acceso con su contraseña de siempre.`
      : `${verif.nombre} ya no puede entrar: se cerraron sus sesiones abiertas. Sus registros y su historial se conservan.`,
  };
}

/* ==========================================================================
   CONTRASEÑA TEMPORAL (olvido)
   ========================================================================== */
export async function restablecerClaveUsuario(usuarioId: string, clave: string): Promise<ResultadoUsuario> {
  const quien = await soloGerencia();
  if ('ok' in quien) return quien;
  if (usuarioId === quien.id) {
    return { ok: false, mensaje: 'Su propia contraseña se cambia desde «Cambiar mi contraseña», en el menú de su nombre.' };
  }
  const malaClave = problemaDeClave(clave);
  if (malaClave) return { ok: false, mensaje: malaClave };

  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('usuario_restablecer_clave', { p_id: usuarioId, p_clave: clave });
  if (error) return { ok: false, mensaje: motivo(error.message) };

  refrescar();
  return {
    ok: true,
    mensaje: 'Contraseña temporal guardada y sesiones cerradas. Comuníquesela en persona: al entrar, el sistema le pedirá cambiarla.',
  };
}

/* ==========================================================================
   LA PROPIA CONTRASEÑA
   ========================================================================== */
export async function cambiarMiClave(actual: string, nueva: string, repetida: string): Promise<ResultadoUsuario> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { ok: false, mensaje: 'Su sesión expiró. Vuelva a iniciar sesión.' };
  if (!actual) return { ok: false, mensaje: 'Escriba su contraseña actual (la temporal, si se la acaban de dar).' };
  if (nueva !== repetida) return { ok: false, mensaje: 'La contraseña nueva y su repetición no coinciden.' };
  if (nueva === actual) return { ok: false, mensaje: 'La contraseña nueva tiene que ser distinta de la actual.' };
  const malaClave = problemaDeClave(nueva);
  if (malaClave) return { ok: false, mensaje: malaClave };

  const supabase = await crearClienteServidor();
  const { error } = await supabase.rpc('cambiar_mi_clave', { p_actual: actual, p_nueva: nueva });
  if (error) return { ok: false, mensaje: motivo(error.message) };

  revalidatePath('/', 'layout');
  return { ok: true, mensaje: 'Contraseña cambiada. Úsela a partir de ahora para entrar.' };
}
