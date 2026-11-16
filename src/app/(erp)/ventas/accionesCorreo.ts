'use server';

/**
 * ============================================================================
 *  CORREOS DESDE VENTAS · accesos al portal, proformas y cotizaciones
 * ============================================================================
 *  Propuesta del portal de clientes (COT-2026-11-253), módulos M1 y M7:
 *
 *   · «Enviar accesos»: el correo con los 6 datos (Código Cliente, N.° de
 *     proforma, Llave, cuenta, contraseña y enlace) sale desde comex@ al
 *     representante del cliente. La Llave SOLO viaja en ese correo: la vista
 *     previa y el registro la llevan enmascarada.
 *   · «Enviar por correo»: el PDF de la proforma o de la cotización, el mismo
 *     que se descarga, con copia al vendedor y el mensaje editable.
 *
 *  Todo con la sesión del usuario: la base decide quién puede revelar la
 *  llave (pedido_llave_revelar) y quién registra el envío.
 * ============================================================================
 */
import { revalidatePath } from 'next/cache';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { enviarCorreo, rellenar, leerPlantilla, listaCorreos, correosInvalidos, enmascararLlave } from '@/lib/correo';
import { generarArchivoDocumento } from '@/lib/documentoArchivo';
import { PUEDEN_DESCARGAR_DOCUMENTOS } from '@/lib/permisosFinanzas';
import { nombreRol, listaDeRoles } from '@/lib/permisosVentas';
import { uno } from '@/lib/relaciones';
import type { Rol } from '@/lib/navegacion';

type Idioma = 'es' | 'en';
type Resultado = { ok: boolean; mensaje: string; estado?: 'enviado' | 'simulado' | 'error' };

/** Quienes envían los accesos al portal (la misma lista que pedido_llave_revelar). */
const ENVIAN_ACCESOS: Rol[] = ['gerencia', 'operaciones', 'comercial', 'comex'];

const CLAVE_OCULTA = '••••••••';

function idiomaValido(i: string): Idioma {
  return i === 'en' ? 'en' : 'es';
}

/* --------------------------------------------------------------------------
   M1 · ACCESOS AL PORTAL
   -------------------------------------------------------------------------- */

async function datosAccesos(pedidoId: number) {
  const supabase = await crearClienteServidor();
  const [{ data: pedido }, { data: params }] = await Promise.all([
    supabase.from('pedidos')
      .select('id, numero_proforma, contacto_nombre, clientes(codigo, razon_social)')
      .eq('id', pedidoId).single(),
    supabase.from('parametros').select('valor').eq('clave', 'portal_url').maybeSingle(),
  ]);
  if (!pedido) throw new Error('No se encontró el pedido.');
  const cliente = uno<Record<string, string>>(pedido.clientes);
  return {
    supabase,
    numero: String(pedido.numero_proforma),
    contacto: pedido.contacto_nombre || cliente?.razon_social || '',
    codigoCliente: cliente?.codigo ?? '',
    portalUrl: String(params?.valor ?? '').trim() || 'https://clientes.santamonicafishing.com',
  };
}

/**
 * Vista previa del correo de accesos, con la Llave y la contraseña
 * enmascaradas. Las reales solo se leen al enviar.
 */
export async function vistaPreviaAccesos(
  pedidoId: number, idioma: string
): Promise<{ ok: true; asunto: string; texto: string } | { ok: false; mensaje: string }> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario || !ENVIAN_ACCESOS.includes(usuario.rol as Rol)) {
    return { ok: false, mensaje: `Los accesos al portal los envían ${listaDeRoles(ENVIAN_ACCESOS)}.` };
  }
  try {
    const d = await datosAccesos(pedidoId);
    const [plantilla, { data: info }, { data: cuenta }] = await Promise.all([
      leerPlantilla(d.supabase, 'accesos', idiomaValido(idioma)),
      d.supabase.rpc('pedido_llave_info', { p_pedido_id: pedidoId }),
      d.supabase.rpc('portal_cuenta_acceso'),
    ]);
    const valores = {
      contacto: d.contacto, codigo_cliente: d.codigoCliente, numero_proforma: d.numero,
      llave: (info as { mascara?: string } | null)?.mascara ?? '••••-••••-••••',
      correo_acceso: (cuenta as { email?: string } | null)?.email ?? '',
      clave_acceso: CLAVE_OCULTA, portal_url: d.portalUrl,
    };
    return { ok: true, asunto: rellenar(plantilla.asunto, valores), texto: rellenar(plantilla.cuerpo, valores) };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : 'No se pudo preparar el correo.' };
  }
}

export async function enviarAccesos(pedidoId: number, para: string[], idioma: string): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario || !ENVIAN_ACCESOS.includes(usuario.rol as Rol)) {
    return { ok: false, mensaje: `${nombreRol(usuario?.rol)} no envía accesos al portal: lo hacen ${listaDeRoles(ENVIAN_ACCESOS)}.` };
  }
  const destinatarios = listaCorreos(para);
  if (!destinatarios.length) return { ok: false, mensaje: 'Escriba el correo del representante del cliente.' };
  const malos = correosInvalidos(destinatarios);
  if (malos.length) return { ok: false, mensaje: `Revise estas direcciones: ${malos.join(', ')}.` };

  const lengua = idiomaValido(idioma);
  try {
    const d = await datosAccesos(pedidoId);
    const [{ data: llave, error: errLlave }, { data: cuenta, error: errCuenta }, plantilla] = await Promise.all([
      d.supabase.rpc('pedido_llave_revelar', { p_pedido_id: pedidoId }),
      d.supabase.rpc('portal_cuenta_acceso'),
      leerPlantilla(d.supabase, 'accesos', lengua),
    ]);
    if (errLlave || !llave) return { ok: false, mensaje: errLlave?.message ?? 'No se pudo leer la llave de seguimiento.' };
    if (errCuenta || !cuenta) return { ok: false, mensaje: errCuenta?.message ?? 'No hay una cuenta de seguimiento activa.' };
    const c = cuenta as { email: string; clave: string };

    const base = { contacto: d.contacto, codigo_cliente: d.codigoCliente, numero_proforma: d.numero, correo_acceso: c.email, portal_url: d.portalUrl };
    const real = { ...base, llave: String(llave), clave_acceso: c.clave };
    const oculto = { ...base, llave: enmascararLlave(String(llave)), clave_acceso: CLAVE_OCULTA };

    const r = await enviarCorreo({
      tipo: 'accesos', remitente: 'comex', para: destinatarios,
      asunto: rellenar(plantilla.asunto, real),
      texto: rellenar(plantilla.cuerpo, real),
      textoRegistro: rellenar(plantilla.cuerpo, oculto),
      entidad: 'pedidos', entidadId: pedidoId,
      boton: { texto: lengua === 'en' ? 'Open the portal' : 'Abrir el portal', url: d.portalUrl },
    }, { supabase: d.supabase });

    if (r.ok) {
      await d.supabase.rpc('registrar_evento', {
        p_entidad: 'pedidos', p_entidad_id: pedidoId, p_tipo: 'accesos_enviados',
        p_descripcion: `Accesos al portal de ${d.numero} ${r.estado === 'enviado' ? 'enviados' : 'registrados (envío simulado)'} a ${destinatarios.join(', ')} por ${usuario.nombre}`,
        p_severidad: 'info', p_metadatos: { para: destinatarios, idioma: lengua, estado: r.estado },
      });
    }
    revalidatePath(`/ventas/pedidos/${pedidoId}`);
    return { ok: r.ok, mensaje: r.mensaje, estado: r.estado };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : 'No se pudo enviar el correo.' };
  }
}

export async function regenerarLlave(pedidoId: number, motivo: string): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (usuario?.rol !== 'gerencia') return { ok: false, mensaje: 'Solo Gerencia puede regenerar la llave de seguimiento.' };
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc('pedido_llave_regenerar', { p_pedido_id: pedidoId, p_motivo: motivo });
  if (error) return { ok: false, mensaje: error.message };
  revalidatePath(`/ventas/pedidos/${pedidoId}`);
  return {
    ok: true,
    mensaje: `Llave regenerada (${(data as { mascara: string }).mascara}). La anterior ya no sirve: envíe los accesos otra vez al cliente.`,
  };
}

/* --------------------------------------------------------------------------
   M7 · PROFORMAS Y COTIZACIONES DESDE comex@
   -------------------------------------------------------------------------- */

type TipoEnvio = 'proforma' | 'cotizacion';

async function cabeceraDocumento(tipo: TipoEnvio, id: number) {
  const supabase = await crearClienteServidor();
  const tabla = tipo === 'proforma' ? 'pedidos' : 'cotizaciones';
  const campoNumero = tipo === 'proforma' ? 'numero_proforma' : 'numero';
  const { data } = await supabase.from(tabla)
    .select(`${campoNumero}, cliente_id, contacto_nombre, contacto_email, vendedores(nombre, email), clientes(razon_social, pais, email)`)
    .eq('id', id).single();
  if (!data) throw new Error('No se encontró el documento.');
  const fila = data as unknown as Record<string, unknown>;
  const vendedor = uno<Record<string, string | null>>(fila.vendedores);
  const cliente = uno<Record<string, string | null>>(fila.clientes);
  const { data: contactos } = await supabase.from('contactos')
    .select('email, principal').eq('cliente_id', Number(fila.cliente_id)).eq('activo', true)
    .order('principal', { ascending: false });
  return {
    supabase,
    numero: String(fila[campoNumero]),
    contacto: String(fila.contacto_nombre ?? '') || cliente?.razon_social || '',
    pais: cliente?.pais ?? '',
    para: listaCorreos([
      String(fila.contacto_email ?? ''),
      ...(contactos ?? []).filter((c) => c.principal).map((c) => String(c.email ?? '')),
      ...(!fila.contacto_email && !(contactos ?? []).some((c) => c.principal) ? [cliente?.email ?? ''] : []),
    ]).filter((c) => !correosInvalidos([c]).length),
    sugeridos: listaCorreos((contactos ?? []).map((c) => String(c.email ?? ''))).filter((c) => !correosInvalidos([c]).length),
    vendedor: vendedor?.nombre ?? '',
    cc: listaCorreos([vendedor?.email ?? '']).filter((c) => !correosInvalidos([c]).length),
  };
}

export type BorradorEnvio = {
  para: string[]; cc: string[]; sugeridos: string[]; asunto: string; mensaje: string; idioma: Idioma;
};

export async function prepararEnvioDocumento(
  tipo: TipoEnvio, id: number, idioma?: string
): Promise<{ ok: true; borrador: BorradorEnvio } | { ok: false; mensaje: string }> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario || !PUEDEN_DESCARGAR_DOCUMENTOS.includes(usuario.rol as Rol)) {
    return { ok: false, mensaje: `Los documentos comerciales los envían ${listaDeRoles(PUEDEN_DESCARGAR_DOCUMENTOS)}.` };
  }
  try {
    const d = await cabeceraDocumento(tipo, id);
    const lengua: Idioma = idioma ? idiomaValido(idioma) : (/^per[uú]$/i.test(d.pais.trim()) || !d.pais ? 'es' : 'en');
    const p = await leerPlantilla(d.supabase, tipo, lengua);
    const valores = { numero: d.numero, contacto: d.contacto, vendedor: d.vendedor || usuario.nombre };
    return {
      ok: true,
      borrador: {
        para: d.para, cc: d.cc, sugeridos: d.sugeridos, idioma: lengua,
        asunto: rellenar(p.asunto, valores), mensaje: rellenar(p.cuerpo, valores),
      },
    };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : 'No se pudo preparar el correo.' };
  }
}

export async function enviarDocumentoPorCorreo(
  tipo: TipoEnvio, id: number,
  datos: { para: string; cc: string; asunto: string; mensaje: string }
): Promise<Resultado> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario || !PUEDEN_DESCARGAR_DOCUMENTOS.includes(usuario.rol as Rol)) {
    return { ok: false, mensaje: `${nombreRol(usuario?.rol)} no envía documentos comerciales: lo hacen ${listaDeRoles(PUEDEN_DESCARGAR_DOCUMENTOS)}.` };
  }
  const para = listaCorreos(datos.para);
  const cc = listaCorreos(datos.cc);
  if (!para.length) return { ok: false, mensaje: 'Escriba al menos un destinatario.' };
  const malos = correosInvalidos([...para, ...cc]);
  if (malos.length) return { ok: false, mensaje: `Revise estas direcciones: ${malos.join(', ')}.` };
  if (!datos.asunto.trim()) return { ok: false, mensaje: 'Escriba el asunto del correo.' };
  if (datos.mensaje.trim().length < 5) return { ok: false, mensaje: 'Escriba el mensaje del correo.' };

  const archivo = await generarArchivoDocumento(tipo, id, 'pdf');
  if (!archivo.ok) {
    return {
      ok: false,
      mensaje: archivo.detalles?.length
        ? `${archivo.error} ${archivo.detalles.join(' · ')}`
        : archivo.error,
    };
  }

  const supabase = await crearClienteServidor();
  const entidad = tipo === 'proforma' ? 'pedidos' : 'cotizaciones';
  const r = await enviarCorreo({
    tipo, remitente: 'comex', para, cc,
    asunto: datos.asunto.trim(), texto: datos.mensaje.trim(),
    adjuntos: [{ nombre: archivo.nombre, contenido: archivo.archivo, tipo: archivo.tipoMime }],
    entidad, entidadId: id,
  }, { supabase });

  if (r.ok) {
    await supabase.rpc('registrar_evento', {
      p_entidad: entidad, p_entidad_id: id, p_tipo: 'documento_enviado',
      p_descripcion: `${archivo.documento.titulo} ${archivo.documento.numero} ${r.estado === 'enviado' ? 'enviada' : 'registrada (envío simulado)'} por correo a ${para.join(', ')} por ${usuario.nombre}`,
      p_severidad: 'info', p_metadatos: { para, cc, estado: r.estado },
    });
  }
  revalidatePath(tipo === 'proforma' ? `/ventas/pedidos/${id}` : `/ventas/cotizaciones/${id}`);
  return { ok: r.ok, mensaje: r.mensaje, estado: r.estado };
}
