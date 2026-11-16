'use server';

/**
 * ============================================================================
 *  ACCIONES DEL PORTAL DE CLIENTES
 * ============================================================================
 *  Todas corren en el servidor y hablan con la base SOLO a través de las
 *  funciones portal_*, con el secreto del servidor. Ninguna recibe ni devuelve
 *  datos del ERP: lo que vuelve al navegador son mensajes y, al final, el N.°
 *  de reclamo. La Llave viaja una sola vez (al buscar) y no se guarda.
 * ============================================================================
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  clientePortal, secretoPortal, tokenPortal, ipCliente, idiomaPortal, portalConfigurado, consultaPortal,
  COOKIE_SESION, COOKIE_IDIOMA,
} from '@/lib/portal/servidor';
import { textos, type Idioma } from '@/lib/portal/textos';
import { nuevoCaptcha, svgComoDataUri } from '@/lib/portal/captcha';
import { enviarCorreo, leerPlantilla, rellenar } from '@/lib/correo';

type Resultado = { ok: boolean; mensaje: string };

const OCHO_HORAS = 8 * 60 * 60;

function opcionesCookie(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T | null> {
  const { data, error } = await clientePortal().rpc(fn, { p_secreto: secretoPortal(), ...args });
  if (error) { console.error(`${fn}:`, error.message); return null; }
  return data as T;
}

/* ---------------------------------------------------------------- Sesión */

export async function iniciarSesion(email: string, clave: string): Promise<Resultado> {
  const idioma = await idiomaPortal();
  const t = textos(idioma);
  if (!portalConfigurado()) return { ok: false, mensaje: t.noConfigurado };
  const r = await rpc<{ ok: boolean; token?: string; motivo?: string }>('portal_iniciar_sesion', {
    p_email: String(email ?? '').slice(0, 200),
    p_clave: String(clave ?? '').slice(0, 200),
    p_ip: await ipCliente(),
    p_agente: '',
    p_idioma: idioma,
  });
  if (!r) return { ok: false, mensaje: t.errorGeneral };
  if (!r.ok || !r.token) return { ok: false, mensaje: r.motivo === 'limite' ? t.demasiadosIngresos : t.credencialesMal };
  (await cookies()).set(COOKIE_SESION, r.token, opcionesCookie(OCHO_HORAS));
  return { ok: true, mensaje: '' };
}

export async function cerrarSesion(): Promise<void> {
  const token = await tokenPortal();
  if (token && portalConfigurado()) await rpc('portal_cerrar_sesion', { p_token: token });
  (await cookies()).delete(COOKIE_SESION);
  redirect('/portal/acceso');
}

export async function cambiarIdioma(idioma: Idioma): Promise<void> {
  const valor = idioma === 'en' ? 'en' : 'es';
  (await cookies()).set(COOKIE_IDIOMA, valor, { ...opcionesCookie(365 * 24 * 3600), httpOnly: false });
  const token = await tokenPortal();
  if (token && portalConfigurado()) await rpc('portal_idioma', { p_token: token, p_idioma: valor });
}

/* ---------------------------------------------------------------- Búsqueda */

export type Captcha = { id: string; imagen: string };

/** Una imagen nueva. La respuesta queda en la base, nunca en el navegador. */
export async function pedirCaptcha(): Promise<Captcha | null> {
  const token = await tokenPortal();
  if (!token || !portalConfigurado()) return null;
  const { respuesta, svg } = nuevoCaptcha();
  const id = await rpc<string>('portal_captcha_registrar', { p_token: token, p_respuesta: respuesta });
  return id ? { id, imagen: svgComoDataUri(svg) } : null;
}

export type ResultadoBusqueda = Resultado & { bloqueadoHasta?: string; captcha?: Captcha | null; sesion?: boolean };

export async function buscarProforma(datos: {
  codigo: string; numero: string; llave: string; captchaId: string; captcha: string;
}): Promise<ResultadoBusqueda> {
  const t = textos(await idiomaPortal());
  const token = await tokenPortal();
  if (!token || !portalConfigurado()) return { ok: false, mensaje: t.sesionVencida, sesion: false };
  const campos = [datos.codigo, datos.numero, datos.llave].map((v) => String(v ?? '').trim());
  if (campos.some((v) => !v)) return { ok: false, mensaje: t.buscarAyuda, captcha: undefined };

  const r = await rpc<{ ok: boolean; motivo?: string; hasta?: string; restantes?: number }>('portal_buscar', {
    p_token: token,
    p_codigo: campos[0].slice(0, 40),
    p_numero: campos[1].slice(0, 60),
    p_llave: campos[2].slice(0, 40),
    p_captcha_id: /^[0-9a-f-]{36}$/i.test(datos.captchaId) ? datos.captchaId : null,
    p_captcha: String(datos.captcha ?? '').slice(0, 10),
    p_ip: await ipCliente(),
  });
  if (r?.ok) return { ok: true, mensaje: '' };

  const captcha = await pedirCaptcha();
  if (!r) return { ok: false, mensaje: t.errorGeneral, captcha };
  switch (r.motivo) {
    case 'sesion': return { ok: false, mensaje: t.sesionVencida, sesion: false };
    case 'bloqueado': {
      const s = Math.max(1, Math.ceil((new Date(r.hasta!).getTime() - Date.now()) / 1000));
      return { ok: false, mensaje: t.bloqueado(s), bloqueadoHasta: r.hasta, captcha };
    }
    case 'limite': return { ok: false, mensaje: t.limite, captcha };
    case 'captcha': return { ok: false, mensaje: t.captchaMal, captcha };
    default:
      return { ok: false, mensaje: `${t.noCoincide} ${r.restantes ? t.restantes(r.restantes) : ''}`.trim(), captcha };
  }
}

export async function otraConsulta(): Promise<void> {
  const token = await tokenPortal();
  if (token && portalConfigurado()) await rpc('portal_salir_consulta', { p_token: token });
  redirect('/portal');
}

/* ---------------------------------------------------------------- Reclamos */

export async function pedirCodigo(nombre: string, correo: string): Promise<Resultado & {
  verificacionId?: string; codigoPrueba?: string;
}> {
  const idioma = await idiomaPortal();
  const t = textos(idioma);
  const token = await tokenPortal();
  if (!token || !portalConfigurado()) return { ok: false, mensaje: t.sesionVencida };
  const r = await rpc<{ ok: boolean; motivo?: string; verificacion_id?: string; codigo?: string; correo?: string }>(
    'portal_reclamo_codigo', { p_token: token, p_correo: String(correo ?? '').slice(0, 200), p_nombre: String(nombre ?? '').slice(0, 120) });
  if (!r) return { ok: false, mensaje: t.errorGeneral };
  if (!r.ok) {
    return { ok: false, mensaje: r.motivo === 'datos' ? t.faltaContacto : r.motivo === 'limite' ? t.limite : t.sesionVencida };
  }

  const consulta = await consultaPortal();
  const supabase = clientePortal();
  const plantilla = await leerPlantilla(supabase, 'reclamo_codigo', idioma, secretoPortal());
  const valores = { nombre, codigo: r.codigo!, numero_proforma: consulta?.numero_proforma ?? '' };
  const envio = await enviarCorreo({
    tipo: 'reclamo_codigo', remitente: 'reclamos', para: [r.correo!],
    asunto: rellenar(plantilla.asunto, valores),
    asuntoRegistro: rellenar(plantilla.asunto, { ...valores, codigo: '••••••' }),
    texto: rellenar(plantilla.cuerpo, valores),
    // El código es de un solo uso, pero tampoco se guarda en el registro
    textoRegistro: rellenar(plantilla.cuerpo, { ...valores, codigo: '••••••' }),
    entidad: 'pedidos', entidadId: consulta?.pedido_id,
  }, { supabase, secreto: secretoPortal(), enviadoPorNombre: `${nombre} (portal)` });

  if (envio.estado === 'error') return { ok: false, mensaje: t.errorGeneral };
  return {
    ok: true,
    verificacionId: r.verificacion_id,
    mensaje: t.codigoEnviado(r.correo!),
    // Solo mientras el envío de correos no esté configurado (modo simulado)
    codigoPrueba: envio.estado === 'simulado' ? r.codigo : undefined,
  };
}

export async function verificarCodigo(verificacionId: string, codigo: string): Promise<Resultado & { ticket?: string }> {
  const t = textos(await idiomaPortal());
  const token = await tokenPortal();
  if (!token || !portalConfigurado()) return { ok: false, mensaje: t.sesionVencida };
  const r = await rpc<{ ok: boolean; motivo?: string; restantes?: number; ticket?: string }>('portal_reclamo_verificar', {
    p_token: token, p_verificacion: verificacionId, p_codigo: String(codigo ?? '').slice(0, 12),
  });
  if (!r) return { ok: false, mensaje: t.errorGeneral };
  if (r.ok) return { ok: true, mensaje: t.correoVerificado, ticket: r.ticket };
  if (r.motivo === 'codigo') return { ok: false, mensaje: t.codigoMal(Math.max(0, r.restantes ?? 0)) };
  return { ok: false, mensaje: r.motivo === 'sesion' ? t.sesionVencida : t.codigoVencido };
}

export async function registrarReclamo(datos: {
  verificacionId: string; motivoId: number; descripcion: string; packingListId: number | null; observaciones: string;
}): Promise<Resultado & { numero?: string; fecha?: string }> {
  const idioma = await idiomaPortal();
  const t = textos(idioma);
  const token = await tokenPortal();
  if (!token || !portalConfigurado()) return { ok: false, mensaje: t.sesionVencida };
  const r = await rpc<{
    ok: boolean; motivo?: string; id?: number; numero?: string; numero_proforma?: string; cliente?: string;
    correo?: string; nombre?: string; jefe_calidad?: string; erp_url?: string;
  } & Record<string, unknown>>('portal_reclamo_registrar', {
    p_token: token,
    p_verificacion: datos.verificacionId,
    p_motivo_id: Number(datos.motivoId) || null,
    p_descripcion: String(datos.descripcion ?? '').slice(0, 4000),
    p_packing_list_id: datos.packingListId ? Number(datos.packingListId) : null,
    p_observaciones: String(datos.observaciones ?? '').slice(0, 2000),
  });
  if (!r) return { ok: false, mensaje: t.errorGeneral };
  if (!r.ok) {
    const mensajes: Record<string, string> = {
      evidencia: t.faltaEvidencia, motivo: t.faltaMotivo, descripcion: t.faltaDescripcion,
      verificacion: t.codigoVencido, sesion: t.sesionVencida,
    };
    return { ok: false, mensaje: mensajes[String(r.motivo)] ?? t.errorGeneral };
  }

  /* Los dos avisos: al contacto (sin la Llave) y al Jefe de Calidad. */
  const supabase = clientePortal();
  const secreto = secretoPortal();
  const urlErp = r.erp_url || process.env.ERP_URL || 'https://erp.santamonicafishing.com';
  const valores = {
    numero: r.numero!, nombre: r.nombre!, correo: r.correo!, numero_proforma: r.numero_proforma!,
    cliente: r.cliente!, motivo: String(r.motivo ?? ''),
    enlace: `${(urlErp || 'https://erp.santamonicafishing.com').replace(/\/$/, '')}/calidad/reclamos/${r.id}`,
  };
  try {
    const alCliente = await leerPlantilla(supabase, 'reclamo_registrado', idioma, secreto);
    await enviarCorreo({
      tipo: 'reclamo_registrado', remitente: 'reclamos', para: [r.correo!],
      asunto: rellenar(alCliente.asunto, valores), texto: rellenar(alCliente.cuerpo, valores),
      entidad: 'reclamos', entidadId: r.id,
    }, { supabase, secreto, enviadoPorNombre: `${r.nombre} (portal)` });
    if (r.jefe_calidad) {
      const aCalidad = await leerPlantilla(supabase, 'reclamo_nuevo', 'es', secreto);
      await enviarCorreo({
        tipo: 'reclamo_nuevo', remitente: 'reclamos', para: [r.jefe_calidad],
        asunto: rellenar(aCalidad.asunto, valores), texto: rellenar(aCalidad.cuerpo, valores),
        entidad: 'reclamos', entidadId: r.id,
        boton: { texto: 'Abrir el reclamo en el ERP', url: valores.enlace },
      }, { supabase, secreto, enviadoPorNombre: 'Portal de clientes' });
    }
  } catch (e) {
    // El reclamo ya quedó registrado: un fallo del aviso no lo deshace.
    console.error('Avisos del reclamo:', e);
  }
  return { ok: true, mensaje: '', numero: r.numero, fecha: new Date().toISOString() };
}
