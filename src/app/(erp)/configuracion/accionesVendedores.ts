'use server';

/**
 * ============================================================================
 *  MAESTRO DE VENDEDORES
 * ============================================================================
 *  El «vendedor» de una cotización o un pedido no es una persona del equipo:
 *  es POR QUIÉN LLEGÓ LA VENTA. Puede ser la venta directa de Santa Mónica o
 *  un intermediario (bróker, agente) que trae al cliente. Sale impreso en la
 *  cotización y sirve para medir cada canal en Rentabilidad › Por vendedor.
 *
 *  Antes solo se cargaba por base de datos; ahora lo mantienen Gerencia y
 *  Operaciones desde Configuración › Maestros (la base lo exige igual, con la
 *  política «escritura_maestros»).
 *
 *  Un vendedor que ya se usó NO se borra: se desactiva. Borrarlo dejaría a sus
 *  cotizaciones y pedidos sin canal y descuadraría los reportes por vendedor.
 *  Desactivado, deja de ofrecerse al cotizar pero su historia queda intacta.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';

export type Resultado = { ok: true; mensaje: string } | { ok: false; mensaje: string };

export type TipoVendedor = 'final' | 'intermediario';
export type DatosVendedor = { nombre: string; tipo: TipoVendedor; email: string | null };

const PUEDEN_VENDEDORES = ['gerencia', 'operaciones'];

/** Refresca todo lo que muestra la lista de vendedores. */
function refrescar() {
  revalidatePath('/configuracion');
  revalidatePath('/ventas/cotizaciones');
  revalidatePath('/ventas/pedidos');
  revalidatePath('/ventas/clientes');
}

async function autorizar() {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { error: 'Su sesión expiró. Vuelva a entrar.' };
  if (!PUEDEN_VENDEDORES.includes(usuario.rol)) {
    return { error: 'Los vendedores los administran Gerencia y Operaciones.' };
  }
  return { usuario };
}

/** Lo mínimo: nombre, tipo válido y un correo que parezca correo. */
function validar(d: DatosVendedor): string | null {
  const nombre = d.nombre?.trim() ?? '';
  if (!nombre) return 'El vendedor necesita un nombre.';
  if (nombre.length > 120) return 'El nombre es demasiado largo (máximo 120 caracteres).';
  if (!['final', 'intermediario'].includes(d.tipo)) return 'Elija si es venta directa o un intermediario.';
  if (d.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) {
    return `«${d.email}» no parece un correo válido.`;
  }
  return null;
}

/**
 * ¿Ya hay otro con ese nombre? Se compara sin mayúsculas ni espacios de más:
 * «Pacific Seafood» y «pacific seafood » saldrían como dos canales distintos
 * en los reportes. La base tiene además un índice único que lo garantiza.
 */
async function nombreRepetido(nombre: string, exceptoId?: number): Promise<string | null> {
  const supabase = await crearClienteServidor();
  const { data } = await supabase.from('vendedores').select('id, nombre');
  const normal = nombre.trim().toLowerCase();
  const otro = (data ?? []).find((v) => String(v.nombre).trim().toLowerCase() === normal && v.id !== exceptoId);
  return otro ? `Ya existe un vendedor llamado «${otro.nombre}».` : null;
}

export async function crearVendedor(d: DatosVendedor): Promise<Resultado> {
  const permiso = await autorizar();
  if (permiso.error) return { ok: false, mensaje: permiso.error };
  const problema = validar(d) ?? (await nombreRepetido(d.nombre));
  if (problema) return { ok: false, mensaje: problema };

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase
    .from('vendedores')
    .insert({ nombre: d.nombre.trim(), tipo: d.tipo, email: d.email?.trim() || null, activo: true })
    .select('id');
  if (error) return { ok: false, mensaje: `No se pudo guardar: ${error.message}` };
  // Una escritura rechazada por la base vuelve sin error y sin filas.
  if (!data?.length) return { ok: false, mensaje: 'Su rol no puede dar de alta vendedores.' };

  refrescar();
  return { ok: true, mensaje: `Vendedor «${d.nombre.trim()}» agregado. Ya se puede elegir al cotizar.` };
}

export async function actualizarVendedor(id: number, d: DatosVendedor): Promise<Resultado> {
  const permiso = await autorizar();
  if (permiso.error) return { ok: false, mensaje: permiso.error };
  const problema = validar(d) ?? (await nombreRepetido(d.nombre, id));
  if (problema) return { ok: false, mensaje: problema };

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase
    .from('vendedores')
    .update({ nombre: d.nombre.trim(), tipo: d.tipo, email: d.email?.trim() || null })
    .eq('id', id)
    .select('id');
  if (error) return { ok: false, mensaje: `No se pudo guardar: ${error.message}` };
  if (!data?.length) return { ok: false, mensaje: 'Ese vendedor ya no existe o su rol no puede modificarlo.' };

  refrescar();
  return { ok: true, mensaje: `Vendedor «${d.nombre.trim()}» actualizado. Los documentos ya emitidos lo muestran con el nombre nuevo.` };
}

/** Desactivar: deja de ofrecerse al cotizar, sin tocar su historia. Reactivar lo devuelve. */
export async function cambiarEstadoVendedor(id: number, activo: boolean): Promise<Resultado> {
  const permiso = await autorizar();
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase
    .from('vendedores').update({ activo }).eq('id', id).select('nombre');
  if (error) return { ok: false, mensaje: `No se pudo cambiar: ${error.message}` };
  if (!data?.length) return { ok: false, mensaje: 'Ese vendedor ya no existe o su rol no puede modificarlo.' };

  refrescar();
  return {
    ok: true,
    mensaje: activo
      ? `«${data[0].nombre}» vuelve a ofrecerse al cotizar.`
      : `«${data[0].nombre}» desactivado: ya no se ofrece al cotizar. Sus cotizaciones, pedidos y clientes lo conservan.`,
  };
}

/** Cuántas veces se usó: lo que decide si se puede borrar o solo desactivar. */
export async function usosVendedor(id: number): Promise<{ clientes: number; cotizaciones: number; pedidos: number }> {
  const supabase = await crearClienteServidor();
  const contar = async (tabla: 'clientes' | 'cotizaciones' | 'pedidos') =>
    (await supabase.from(tabla).select('id', { count: 'exact', head: true }).eq('vendedor_id', id)).count ?? 0;
  const [clientes, cotizaciones, pedidos] = await Promise.all([contar('clientes'), contar('cotizaciones'), contar('pedidos')]);
  return { clientes, cotizaciones, pedidos };
}

export async function borrarVendedor(id: number): Promise<Resultado> {
  const permiso = await autorizar();
  if (permiso.error) return { ok: false, mensaje: permiso.error };

  const u = await usosVendedor(id);
  if (u.clientes + u.cotizaciones + u.pedidos > 0) {
    return {
      ok: false,
      mensaje: `No se puede borrar: figura en ${u.clientes} cliente(s), ${u.cotizaciones} cotización(es) y ${u.pedidos} pedido(s). Desactívelo para que ya no se ofrezca.`,
    };
  }

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.from('vendedores').delete().eq('id', id).select('nombre');
  if (error) return { ok: false, mensaje: `No se pudo borrar: ${error.message}` };
  if (!data?.length) return { ok: false, mensaje: 'Ese vendedor ya no existe o su rol no puede borrarlo.' };

  refrescar();
  return { ok: true, mensaje: `Vendedor «${data[0].nombre}» borrado.` };
}
