'use server';

/**
 * ============================================================================
 *  MAESTRO DE ALMACENES · Configuración › Maestros › Almacenes
 * ============================================================================
 *  Hasta ahora este catálogo era solo de consulta. Desde la reunión con
 *  Oliver Tello (074) se edita aquí, por Gerencia y Operaciones:
 *
 *   · QUÉ RECIBE CADA ALMACÉN. La producción entra solo por las cámaras de
 *     Santa Mónica, Freeko y Hayduk; las compras, solo por los almacenes que
 *     se marquen (hoy Elamar y Perufrost). El formulario de ingreso, la
 *     importación desde Excel y la base de datos obedecen estas casillas.
 *   · DAR DE ALTA un almacén nuevo («si se da el caso de comprar a otra
 *     empresa, pues agregarlo»).
 *   · DESACTIVAR uno que ya no se usa. Un almacén con stock no se desactiva
 *     (primero se traslada lo que tiene), y uno con historia no se borra: sus
 *     movimientos y traslados lo necesitan. Solo se borra uno recién creado
 *     por error, que nunca se usó.
 *
 *  Cada cambio queda en Auditoría con quién y cuándo (disparador
 *  audit_almacenes). La base exige además el rol (política escritura_maestros).
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { rolNoPuede, traducirErrorBase } from '@/lib/mensajesBase';

export type Resultado = { ok: true; mensaje: string } | { ok: false; mensaje: string };

export type DatosAlmacen = {
  codigo: string;
  nombre: string;
  tipo: 'propio' | 'externo';
  operador: string;
  ciudad: string;
  capacidad_tm: number | null;
  despachos_dia_max: number;
  recibe_produccion: boolean;
  recibe_compras: boolean;
  activo: boolean;
};

const PUEDEN = ['gerencia', 'operaciones'] as const;

async function autorizar() {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return { error: 'Su sesión caducó. Vuelva a entrar.' };
  if (!(PUEDEN as readonly string[]).includes(usuario.rol)) return { error: rolNoPuede(usuario.rol, 'modificar los almacenes', PUEDEN) };
  return { usuario };
}

function refrescar() {
  revalidatePath('/configuracion');
  revalidatePath('/almacenes/ingresos/nuevo');
  revalidatePath('/almacenes/existencias');
  revalidatePath('/almacenes/traslados/nuevo');
}

type Cliente = Awaited<ReturnType<typeof crearClienteServidor>>;

/** Un código corto a partir del nombre: «Frigorífico del Norte» → «FRIGOR». */
function codigoDesde(nombre: string): string {
  return nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'ALM';
}

async function validar(supabase: Cliente, d: DatosAlmacen, exceptoId?: number): Promise<string | null> {
  const nombre = d.nombre?.trim() ?? '';
  if (!nombre) return 'El almacén necesita un nombre.';
  if (nombre.length > 80) return 'El nombre es demasiado largo (máximo 80 caracteres).';
  if (!['propio', 'externo'].includes(d.tipo)) return 'Elija si el almacén es propio o externo (de un tercero).';
  if (d.capacidad_tm !== null && (!(d.capacidad_tm >= 0) || d.capacidad_tm > 100000)) return 'La capacidad tiene que ser un número de toneladas, cero o más.';
  if (!Number.isInteger(d.despachos_dia_max) || d.despachos_dia_max < 1 || d.despachos_dia_max > 50) {
    return 'Los despachos por día tienen que ser un número entero entre 1 y 50.';
  }
  if (d.codigo?.trim() && !/^[A-Za-z0-9-]{2,10}$/.test(d.codigo.trim())) {
    return 'El código va con letras, números o guion, de 2 a 10 caracteres (p. ej. «FRIOSUR»).';
  }

  const { data } = await supabase.from('almacenes').select('id, nombre, codigo');
  const n = nombre.toLowerCase();
  const mismoNombre = (data ?? []).find((a) => String(a.nombre).trim().toLowerCase() === n && a.id !== exceptoId);
  if (mismoNombre) return `Ya existe un almacén llamado «${mismoNombre.nombre}».`;
  const codigo = d.codigo?.trim().toUpperCase();
  if (codigo) {
    const mismoCodigo = (data ?? []).find((a) => String(a.codigo).toUpperCase() === codigo && a.id !== exceptoId);
    if (mismoCodigo) return `El código ${codigo} ya es de «${mismoCodigo.nombre}».`;
  }
  return null;
}

/** Cuánto stock tiene un almacén, en kilos. */
async function stockKg(supabase: Cliente, id: number): Promise<number> {
  const { data } = await supabase.from('existencias').select('peso_neto_kg').eq('almacen_id', id).gt('peso_neto_kg', 0).limit(1000);
  return (data ?? []).reduce((s, e) => s + Number(e.peso_neto_kg), 0);
}

export async function crearAlmacen(d: DatosAlmacen): Promise<Resultado> {
  const permiso = await autorizar();
  if (permiso.error) return { ok: false, mensaje: permiso.error };
  const supabase = await crearClienteServidor();
  const problema = await validar(supabase, d);
  if (problema) return { ok: false, mensaje: problema };

  /* Sin código, se arma uno del nombre; si está tomado, se le agrega un número. */
  let codigo = d.codigo?.trim().toUpperCase() || codigoDesde(d.nombre);
  if (!d.codigo?.trim()) {
    const { data } = await supabase.from('almacenes').select('codigo');
    const usados = new Set((data ?? []).map((a) => String(a.codigo).toUpperCase()));
    for (let i = 2; usados.has(codigo); i++) codigo = `${codigoDesde(d.nombre).slice(0, 5)}${i}`;
  }

  const { data, error } = await supabase.from('almacenes').insert({
    codigo,
    nombre: d.nombre.trim(),
    tipo: d.tipo,
    operador: d.operador?.trim() || d.nombre.trim(),
    ciudad: d.ciudad?.trim() || null,
    capacidad_tm: d.capacidad_tm,
    despachos_dia_max: d.despachos_dia_max,
    recibe_produccion: d.recibe_produccion,
    recibe_compras: d.recibe_compras,
    activo: d.activo,
  }).select('id');
  if (error) return { ok: false, mensaje: traducirErrorBase(error, { que: 'dar de alta el almacén', quien: PUEDEN }) };
  if (!data?.length) return { ok: false, mensaje: rolNoPuede(permiso.usuario!.rol, 'dar de alta almacenes', PUEDEN) };

  refrescar();
  const recibe = [d.recibe_produccion && 'producción', d.recibe_compras && 'compras'].filter(Boolean).join(' y ');
  return {
    ok: true,
    mensaje: `Almacén «${d.nombre.trim()}» (${codigo}) dado de alta. ` +
      (recibe ? `Recibe ingresos de ${recibe}.` : 'No recibe ingresos directos: le llega stock por traslado.') +
      ' Si va a tener cámaras, pida que se carguen.',
  };
}

export async function actualizarAlmacen(id: number, d: DatosAlmacen): Promise<Resultado> {
  const permiso = await autorizar();
  if (permiso.error) return { ok: false, mensaje: permiso.error };
  const supabase = await crearClienteServidor();
  const problema = await validar(supabase, d, id);
  if (problema) return { ok: false, mensaje: problema };

  const { data: antes } = await supabase.from('almacenes').select('activo, codigo').eq('id', id).maybeSingle();
  if (!antes) return { ok: false, mensaje: 'Ese almacén ya no existe.' };
  if (antes.activo && !d.activo) {
    const kg = await stockKg(supabase, id);
    if (kg > 0.001) {
      return {
        ok: false,
        mensaje: `No se puede desactivar: tiene ${(kg / 1000).toLocaleString('es-PE', { maximumFractionDigits: 2 })} TM en stock. ` +
          'Trasládelas a otra bodega primero; desactivado no se vería en Existencias ni se podría despachar desde él.',
      };
    }
  }

  const { data, error } = await supabase.from('almacenes').update({
    //  El código no se cambia: es la clave que conocen los reportes y las plantillas.
    nombre: d.nombre.trim(),
    tipo: d.tipo,
    operador: d.operador?.trim() || d.nombre.trim(),
    ciudad: d.ciudad?.trim() || null,
    capacidad_tm: d.capacidad_tm,
    despachos_dia_max: d.despachos_dia_max,
    recibe_produccion: d.recibe_produccion,
    recibe_compras: d.recibe_compras,
    activo: d.activo,
  }).eq('id', id).select('id');
  if (error) return { ok: false, mensaje: traducirErrorBase(error, { que: 'guardar el almacén', quien: PUEDEN }) };
  if (!data?.length) return { ok: false, mensaje: 'Ese almacén ya no existe o su rol no puede modificarlo.' };

  refrescar();
  return { ok: true, mensaje: `Almacén «${d.nombre.trim()}» actualizado. El cambio rige desde ya para los ingresos y las importaciones.` };
}

/** Solo uno que nunca se usó: sin movimientos, traslados, cámaras ni usuarios. */
export async function borrarAlmacen(id: number): Promise<Resultado> {
  const permiso = await autorizar();
  if (permiso.error) return { ok: false, mensaje: permiso.error };
  const supabase = await crearClienteServidor();

  const contar = async (tabla: string, columna: string) =>
    (await supabase.from(tabla).select('id', { count: 'exact', head: true }).eq(columna, id)).count ?? 0;
  const [mov, tOri, tDes, cam, usu, prog] = await Promise.all([
    contar('movimientos', 'almacen_id'), contar('traslados', 'almacen_origen_id'), contar('traslados', 'almacen_destino_id'),
    contar('camaras', 'almacen_id'), contar('usuarios', 'almacen_id'), contar('ingresos_programados', 'almacen_id'),
  ]);
  if (mov + tOri + tDes + cam + usu + prog > 0) {
    return { ok: false, mensaje: 'Este almacén ya tiene historia (movimientos, traslados, cámaras o usuarios): no se borra, se desactiva.' };
  }
  const { data, error } = await supabase.from('almacenes').delete().eq('id', id).select('nombre');
  if (error) return { ok: false, mensaje: traducirErrorBase(error, { que: 'borrar el almacén', quien: PUEDEN }) };
  if (!data?.length) return { ok: false, mensaje: 'Ese almacén ya no existe o su rol no puede borrarlo.' };
  refrescar();
  return { ok: true, mensaje: `Almacén «${data[0].nombre}» borrado.` };
}
