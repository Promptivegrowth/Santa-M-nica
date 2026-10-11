/**
 * El contrato generado, en PDF (observaciones de octubre, punto 8). Se lee con
 * la sesión del usuario: si la base no le deja ver el contrato, no hay PDF.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { generarPdfContrato } from '@/lib/pdfContrato';
import { uno } from '@/lib/relaciones';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/contratos/[id]'>) {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return NextResponse.json({ error: 'Inicie sesión.' }, { status: 401 });

  const { id } = await ctx.params;
  const supabase = await crearClienteServidor();
  const [{ data: c }, { data: params }] = await Promise.all([
    supabase.from('contratos')
      .select('numero, titulo, cuerpo, cotizaciones(clientes(razon_social))')
      .eq('id', Number(id)).maybeSingle(),
    supabase.from('parametros').select('clave, valor')
      .in('clave', ['empresa_razon_social', 'firmante_nombre', 'firmante_cargo']),
  ]);
  if (!c) return NextResponse.json({ error: 'Ese contrato no existe o no tiene acceso.' }, { status: 404 });

  const p = new Map((params ?? []).map((x) => [String(x.clave), String(x.valor ?? '')]));
  const cliente = uno<Record<string, unknown>>(uno<Record<string, unknown>>(c.cotizaciones)?.clientes);
  const pdf = await generarPdfContrato({
    numero: String(c.numero),
    titulo: String(c.titulo),
    cuerpo: String(c.cuerpo),
    empresa: p.get('empresa_razon_social') ?? '',
    cliente: String(cliente?.razon_social ?? ''),
    firmante: p.get('firmante_nombre') ?? '',
    cargoFirmante: p.get('firmante_cargo') ?? '',
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="SantaMonica_${String(c.numero)}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
