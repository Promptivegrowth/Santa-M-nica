/**
 * Excel de los despachos elegidos en el selector (observaciones de octubre,
 * punto 14): un renglón por ítem, con su despacho, embarque, proforma,
 * producto y cantidad. Así la relación entre todos queda en la hoja.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { cargarDespachos, idsDeTexto } from '@/lib/despachosDatos';
import { generarReporte } from '@/lib/excel';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return NextResponse.json({ error: 'Inicie sesión.' }, { status: 401 });

  const ids = idsDeTexto(req.nextUrl.searchParams.get('ids')).slice(0, 200);
  if (!ids.length) return NextResponse.json({ error: 'Elija al menos un despacho.' }, { status: 400 });
  const items = new Set(idsDeTexto(req.nextUrl.searchParams.get('items')));

  const supabase = await crearClienteServidor();
  const despachos = await cargarDespachos(supabase, { ids });

  const filas = despachos.flatMap((d) => {
    const parcial = items.size > 0 && d.items.some((i) => items.has(i.id));
    return d.items.filter((i) => !parcial || items.has(i.id)).map((i) => ({
      despacho: d.numero,
      fecha_salida: d.fecha_salida,
      embarque: d.embarque ?? '',
      proforma: i.proforma ?? '',
      cliente: i.cliente ?? '',
      contenedor: d.contenedor ?? '',
      guia: d.guia ?? '',
      destino: d.destino ?? '',
      pallet: i.pallet,
      sku: i.sku,
      producto: i.producto,
      bultos: i.bultos,
      tm: i.kg / 1000,
    }));
  });

  const buffer = await generarReporte({
    titulo: 'Despachos elegidos',
    subtitulo: `${despachos.length} despacho(s) · ${filas.length} ítem(s), con su proforma, embarque, producto y cantidad`,
    hoja: 'Despachos',
    columnas: [
      { titulo: 'Despacho', clave: 'despacho', ancho: 16 },
      { titulo: 'Salida', clave: 'fecha_salida', ancho: 18, formato: 'dd/mm/yyyy hh:mm' },
      { titulo: 'Embarque', clave: 'embarque', ancho: 15 },
      { titulo: 'Proforma', clave: 'proforma', ancho: 13 },
      { titulo: 'Cliente', clave: 'cliente', ancho: 30 },
      { titulo: 'Contenedor', clave: 'contenedor', ancho: 15 },
      { titulo: 'Guía', clave: 'guia', ancho: 14 },
      { titulo: 'Destino', clave: 'destino', ancho: 20 },
      { titulo: 'Pallet', clave: 'pallet', ancho: 18 },
      { titulo: 'SKU', clave: 'sku', ancho: 10 },
      { titulo: 'Producto', clave: 'producto', ancho: 34 },
      { titulo: 'Bultos', clave: 'bultos', ancho: 9, formato: '#,##0' },
      { titulo: 'TM', clave: 'tm', ancho: 10, formato: '#,##0.000' },
    ],
    filas: filas.map((f) => ({ ...f, fecha_salida: new Date(f.fecha_salida) })),
    usuario: usuario.nombre as string,
    totalizar: ['bultos', 'tm'],
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="SantaMonica_Despachos_elegidos.xlsx"',
      'Cache-Control': 'no-store',
    },
  });
}
