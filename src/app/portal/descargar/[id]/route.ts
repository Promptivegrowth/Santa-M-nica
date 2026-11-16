/**
 * PDF de respuesta de un reclamo cerrado. Solo para la proforma validada en
 * esta sesión y durante 3 meses desde el cierre (lo decide portal_descarga).
 * Se redirige al enlace temporal firmado del almacenamiento.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { clientePortal, secretoPortal, tokenPortal, portalConfigurado } from '@/lib/portal/servidor';

export async function GET(peticion: NextRequest, contexto: { params: Promise<{ id: string }> }) {
  const { id } = await contexto.params;
  const volver = new URL('/portal/consulta', peticion.url);
  const token = await tokenPortal();
  const reclamoId = Number(id);
  if (!token || !portalConfigurado() || !Number.isInteger(reclamoId) || reclamoId <= 0) {
    return NextResponse.redirect(volver);
  }
  const { data } = await clientePortal().rpc('portal_descarga', {
    p_secreto: secretoPortal(), p_token: token, p_reclamo_id: reclamoId,
  });
  if (!data) return NextResponse.redirect(volver);
  return NextResponse.redirect(String(data), { headers: { 'Cache-Control': 'no-store' } });
}
