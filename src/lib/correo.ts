/**
 * ============================================================================
 *  CORREOS DEL SISTEMA · desde comex@ y reclamos@ (propuesta COT-2026-11-253)
 * ============================================================================
 *  Todos los correos que salen del ERP y del portal pasan por aquí:
 *
 *    accesos             comex@     Datos de acceso al portal (con la Llave)
 *    proforma/cotizacion comex@     El PDF del documento, con copia al vendedor
 *    reclamo_codigo      reclamos@  Código de verificación de un solo uso
 *    reclamo_registrado  reclamos@  N.° de reclamo (nunca la Llave)
 *    reclamo_nuevo       reclamos@  Aviso al Jefe de Aseguramiento de Calidad
 *    reclamo_cierre      reclamos@  Conclusión y PDF (o aviso para descargarlo)
 *
 *  CÓMO SE ENVÍA
 *  El sistema no guarda la contraseña de ningún buzón. Envía por un servicio
 *  de envío autorizado (Resend, por API), con el dominio verificado con SPF,
 *  DKIM y DMARC por TI. Variables en Vercel:
 *
 *    RESEND_API_KEY   la clave del servicio (sin ella, modo simulado)
 *    CORREO_COMEX     «Santa Mónica Fishing <comex@santamonicafishing.com>»
 *    CORREO_RECLAMOS  «Santa Mónica Fishing <reclamos@santamonicafishing.com>»
 *
 *  MODO SIMULADO
 *  Mientras TI no configure el envío, el correo NO sale, pero queda
 *  registrado en «Correos enviados» con estado «simulado» y su contenido, para
 *  que se pueda revisar todo el flujo. La pantalla lo dice siempre.
 *
 *  LO QUE SE REGISTRA
 *  Cada envío queda en correos_salida: quién, cuándo, a quién y el texto. El
 *  texto registrado va con la Llave y la contraseña ENMASCARADAS: la Llave
 *  nunca se guarda en registros.
 * ============================================================================
 */

export type Remitente = 'comex' | 'reclamos';

export type TipoCorreo =
  | 'accesos' | 'proforma' | 'cotizacion'
  | 'reclamo_codigo' | 'reclamo_registrado' | 'reclamo_nuevo' | 'reclamo_cierre';

export type Adjunto = { nombre: string; contenido: Buffer; tipo: string };

export type Correo = {
  tipo: TipoCorreo;
  remitente: Remitente;
  para: string[];
  cc?: string[];
  asunto: string;
  /** Texto plano: se convierte a HTML con la marca. */
  texto: string;
  /** Lo que se guarda en el registro, si difiere (enmascarado). */
  textoRegistro?: string;
  /** El asunto que se guarda, si lleva algo que no debe quedar (el código de verificación). */
  asuntoRegistro?: string;
  adjuntos?: Adjunto[];
  entidad?: string;
  entidadId?: number;
  /** Un enlace destacado al pie del mensaje (por ejemplo, al portal). */
  boton?: { texto: string; url: string };
};

export type ResultadoCorreo = {
  ok: boolean;
  estado: 'enviado' | 'simulado' | 'error';
  mensaje: string;
};

/** Cualquier cliente de Supabase con .rpc (el del usuario o el del portal). */
type ConRpc = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> };

export const CORREO_CONFIGURADO = () => !!process.env.RESEND_API_KEY;

export function direccionRemitente(r: Remitente): string {
  return r === 'comex'
    ? process.env.CORREO_COMEX || 'Santa Mónica Fishing <comex@santamonicafishing.com>'
    : process.env.CORREO_RECLAMOS || 'Santa Mónica Fishing <reclamos@santamonicafishing.com>';
}

const FORMA_CORREO = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/;

/** Limpia una lista escrita a mano: separa por coma o punto y coma y quita repetidos. */
export function listaCorreos(valor: string | string[] | null | undefined): string[] {
  const crudos = Array.isArray(valor) ? valor : String(valor ?? '').split(/[,;\s]+/);
  return [...new Set(crudos.map((c) => c.trim().toLowerCase()).filter(Boolean))];
}

export function correosInvalidos(lista: string[]): string[] {
  return lista.filter((c) => !FORMA_CORREO.test(c));
}

/** Reemplaza {{variable}} por su valor. Una variable sin valor queda vacía. */
export function rellenar(plantilla: string, valores: Record<string, string | number | null | undefined>): string {
  return plantilla.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k: string) => String(valores[k] ?? ''));
}

export async function leerPlantilla(
  supabase: ConRpc, clave: string, idioma: 'es' | 'en', secreto?: string
): Promise<{ asunto: string; cuerpo: string }> {
  const { data, error } = await supabase.rpc('plantilla_correo', {
    p_secreto: secreto ?? null, p_clave: clave, p_idioma: idioma,
  });
  if (error || !data) throw new Error(`No se encontró la plantilla de correo «${clave}» (${idioma}).`);
  return data as { asunto: string; cuerpo: string };
}

function escapar(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** El texto plano, vestido con la marca: cabecera azul, párrafos y pie. */
export function htmlCorreo(texto: string, boton?: { texto: string; url: string }): string {
  const parrafos = escapar(texto)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;line-height:1.55">${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
  const accion = boton
    ? `<p style="margin:22px 0 6px"><a href="${escapar(boton.url)}" style="background:#304f8c;color:#fff;text-decoration:none;padding:10px 18px;border-radius:4px;font-weight:600;display:inline-block">${escapar(boton.texto)}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#eef1f6;font-family:Arial,Helvetica,sans-serif;color:#101a2c">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f6;padding:24px 0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border:1px solid #c9d4e4">
<tr><td style="background:#1b2c52;color:#fff;padding:18px 24px;font-size:15px;letter-spacing:.08em;font-weight:700">SANTA MÓNICA FISHING</td></tr>
<tr><td style="padding:24px;font-size:14px">${parrafos}${accion}</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid #e6ecf4;color:#556278;font-size:11px">Industrial Pesquera Santa Mónica S.A. · santamonicafishing.com · Este es un correo automático.</td></tr>
</table></td></tr></table></body></html>`;
}

/**
 * Envía (o simula) y SIEMPRE registra. Nunca lanza: devuelve qué pasó, para
 * que la pantalla lo diga con sus palabras.
 */
export async function enviarCorreo(
  correo: Correo,
  registro: { supabase: ConRpc; secreto?: string; enviadoPorNombre?: string }
): Promise<ResultadoCorreo> {
  const para = listaCorreos(correo.para);
  const cc = listaCorreos(correo.cc ?? []).filter((c) => !para.includes(c));
  const malos = correosInvalidos([...para, ...cc]);
  if (!para.length) return { ok: false, estado: 'error', mensaje: 'Falta el destinatario del correo.' };
  if (malos.length) return { ok: false, estado: 'error', mensaje: `Revise estas direcciones: ${malos.join(', ')}.` };

  let estado: ResultadoCorreo['estado'] = 'simulado';
  let error: string | null = null;
  let proveedorId: string | null = null;

  if (CORREO_CONFIGURADO()) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: direccionRemitente(correo.remitente),
          to: para,
          cc: cc.length ? cc : undefined,
          subject: correo.asunto,
          text: correo.texto,
          html: htmlCorreo(correo.texto, correo.boton),
          attachments: (correo.adjuntos ?? []).map((a) => ({
            filename: a.nombre, content: a.contenido.toString('base64'), content_type: a.tipo,
          })),
        }),
        signal: AbortSignal.timeout(20000),
      });
      const cuerpo = (await r.json().catch(() => ({}))) as { id?: string; message?: string };
      if (r.ok) { estado = 'enviado'; proveedorId = cuerpo.id ?? null; }
      else { estado = 'error'; error = cuerpo.message ?? `El servicio de correo respondió ${r.status}.`; }
    } catch (e) {
      estado = 'error';
      error = e instanceof Error ? e.message : 'No se pudo contactar al servicio de correo.';
    }
  }

  const { error: errReg } = await registro.supabase.rpc('correo_registrar', {
    p_secreto: registro.secreto ?? null,
    p_correo: {
      tipo: correo.tipo,
      remitente: direccionRemitente(correo.remitente),
      para, cc,
      asunto: correo.asuntoRegistro ?? correo.asunto,
      cuerpo: correo.textoRegistro ?? correo.texto,
      adjuntos: (correo.adjuntos ?? []).map((a) => ({ nombre: a.nombre, tamano: a.contenido.length })),
      estado, error, proveedor_id: proveedorId,
      entidad: correo.entidad ?? null, entidad_id: correo.entidadId ?? null,
      enviado_por_nombre: registro.enviadoPorNombre ?? null,
    },
  });
  if (errReg) console.error('No se pudo registrar el correo:', errReg.message);

  if (estado === 'enviado') return { ok: true, estado, mensaje: `Correo enviado a ${para.join(', ')}.` };
  if (estado === 'simulado') {
    return {
      ok: true, estado,
      mensaje: `Correo registrado para ${para.join(', ')}, pero NO salió: el envío de correos aún no está configurado ` +
        '(falta conectar el dominio con TI). Queda en «Correos enviados» con estado «simulado».',
    };
  }
  return { ok: false, estado, mensaje: `El correo no se pudo enviar: ${error}` };
}

/** «K7M2-9QXP-4TWD» → «••••-••••-4TWD». */
export function enmascararLlave(llave: string): string {
  return `••••-••••-${llave.slice(-4)}`;
}
