/**
 * ============================================================================
 *  PORTAL DE CLIENTES · lado servidor
 * ============================================================================
 *  El portal NO usa la sesión de Supabase del ERP. Quien entra con la cuenta
 *  de seguimiento recibe solo una cookie opaca (sm_portal), httpOnly y
 *  limitada a la dirección del portal. El servidor habla con la base como
 *  «anon» y solo puede llamar a las funciones portal_*, que además exigen el
 *  secreto del servidor (PORTAL_SECRETO). Sin ese secreto, la clave pública
 *  de Supabase no sirve para nada en el portal.
 * ============================================================================
 */
import { createClient } from '@supabase/supabase-js';
import { cookies, headers } from 'next/headers';
import type { Idioma } from './textos';

export const COOKIE_SESION = 'sm_portal';
export const COOKIE_IDIOMA = 'sm_portal_idioma';

export function secretoPortal(): string {
  return process.env.PORTAL_SECRETO ?? '';
}

export function portalConfigurado(): boolean {
  return secretoPortal().length >= 32;
}

/** Cliente sin sesión: no guarda ni lee cookies de Supabase. */
export function clientePortal() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function tokenPortal(): Promise<string | null> {
  return (await cookies()).get(COOKIE_SESION)?.value ?? null;
}

export async function idiomaPortal(): Promise<Idioma> {
  return (await cookies()).get(COOKIE_IDIOMA)?.value === 'en' ? 'en' : 'es';
}

/** La IP del cliente según Vercel (la primera de x-forwarded-for). */
export async function ipCliente(): Promise<string> {
  const h = await headers();
  return (h.get('x-forwarded-for')?.split(',')[0] ?? h.get('x-real-ip') ?? 'local').trim().slice(0, 64);
}

export type EstadoSesion = {
  ok: boolean;
  idioma?: Idioma;
  bloqueada_hasta?: string | null;
  consulta?: boolean;
};

export async function sesionPortal(): Promise<EstadoSesion> {
  const token = await tokenPortal();
  if (!token || !portalConfigurado()) return { ok: false };
  const { data, error } = await clientePortal().rpc('portal_sesion', { p_secreto: secretoPortal(), p_token: token });
  if (error || !data) return { ok: false };
  return data as EstadoSesion;
}

/** Lo que el portal muestra de una proforma (privado.datos_portal). */
export type Hito = { clave: string; etiqueta: string; fecha: string | null; cumplido: boolean };
export type DatosPortal = {
  pedido_id: number;
  numero_proforma: string;
  cliente_codigo: string;
  cliente: string;
  destino: string | null;
  incoterm: string | null;
  mes_embarque: string | null;
  fecha_comprometida: string | null;
  cancelada: boolean;
  contenedores_previstos: number | null;
  hitos: Hito[];
  productos: { descripcion: string; cantidad_tm: number }[];
  contenedores: {
    id: number; referencia: string; contenedor: string | null; precinto: string | null; destino: string | null;
    bultos: number; tm: number; hitos: Hito[];
    productos: { descripcion: string; bultos: number; kg: number }[];
    reclamos_pendientes: number;
  }[];
  reclamos: {
    id: number; numero: string; motivo: string; estado: string; contenedor: string | null;
    creado_en: string; cerrado_en: string | null; conclusion: string | null; descargable: boolean;
    historial: { estado: string; fecha: string }[];
  }[];
  motivos: { id: number; nombre: string }[];
};

export async function consultaPortal(): Promise<DatosPortal | null> {
  const token = await tokenPortal();
  if (!token || !portalConfigurado()) return null;
  const { data, error } = await clientePortal().rpc('portal_consulta', { p_secreto: secretoPortal(), p_token: token });
  if (error) { console.error('portal_consulta:', error.message); return null; }
  return (data as DatosPortal | null) ?? null;
}
