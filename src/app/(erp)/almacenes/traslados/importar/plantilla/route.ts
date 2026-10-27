/**
 * ============================================================================
 *  PLANTILLA DE TRASLADOS · la descarga
 * ============================================================================
 *  Hojas: «Traslados» (la que se llena), «Pallets disponibles» (todo lo que
 *  hoy se puede mover, bodega por bodega, con sus bultos y kilos disponibles,
 *  para copiar el código), «Listas» (bodegas) e «Instrucciones».
 *
 *  Lo bloqueado por Calidad y lo apartado entero para pedidos no aparece en
 *  «Pallets disponibles»: no se puede trasladar.
 * ============================================================================
 */
import { NextResponse } from 'next/server';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { generarPlantilla } from '@/lib/importacionExcel';
import { hoyEnLima } from '@/lib/fechas';
import { rolNoPuede } from '@/lib/mensajesBase';
import { PUEDEN_SOLICITAR, palletsDisponibles, bultosDisponibles } from '../../registro';
import { COLUMNAS_TRASLADO, HOJA_TRASLADOS } from '../columnas';

export const dynamic = 'force-dynamic';

export async function GET() {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return NextResponse.json({ error: 'Inicie sesión.' }, { status: 401 });
  if (!(PUEDEN_SOLICITAR as readonly string[]).includes(usuario.rol)) {
    return NextResponse.json({ error: rolNoPuede(usuario.rol, 'importar traslados', PUEDEN_SOLICITAR) }, { status: 403 });
  }

  const supabase = await crearClienteServidor();
  const [{ data: bodegas }, stock] = await Promise.all([
    supabase.from('almacenes').select('id, nombre').eq('activo', true).order('nombre'),
    palletsDisponibles(supabase),
  ]);
  const nombreBodega = new Map((bodegas ?? []).map((b) => [Number(b.id), String(b.nombre)]));

  /* La descripción del producto de cada pallet. */
  const ids = [...new Set(stock.map((s) => Number(s.sku_presentacion_id)))];
  const desc = new Map<number, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('sku_presentaciones')
      .select('id, skus(codigo, corte, especies(nombre)), presentaciones(descripcion)').in('id', ids.slice(i, i + 200));
    for (const p of data ?? []) {
      const sku = (Array.isArray(p.skus) ? p.skus[0] : p.skus) as Record<string, unknown> | null;
      const esp = (Array.isArray(sku?.especies) ? (sku?.especies as unknown[])[0] : sku?.especies) as Record<string, unknown> | null;
      const pres = (Array.isArray(p.presentaciones) ? p.presentaciones[0] : p.presentaciones) as Record<string, unknown> | null;
      desc.set(Number(p.id), [sku?.codigo, esp?.nombre, sku?.corte, pres?.descripcion].filter(Boolean).join(' · '));
    }
  }

  const filas = stock
    .filter((s) => nombreBodega.has(Number(s.almacen_id)))
    .map((s) => {
      const st = {
        lote_id: Number(s.lote_id), almacen_id: Number(s.almacen_id), codigo_pallet: String(s.codigo_pallet),
        sku_presentacion_id: Number(s.sku_presentacion_id), fisico_kg: Number(s.fisico_kg), fisico_bultos: Number(s.fisico_bultos),
        disponible_kg: Number(s.disponible_kg), bloqueado_kg: Number(s.bloqueado_kg), meses: Number(s.meses_almacenado ?? 0),
      };
      return { st, b: bultosDisponibles(st) };
    })
    .filter((x) => x.b > 0)
    .sort((a, z) => (nombreBodega.get(a.st.almacen_id) ?? '').localeCompare(nombreBodega.get(z.st.almacen_id) ?? '', 'es') ||
      a.st.codigo_pallet.localeCompare(z.st.codigo_pallet, 'es', { numeric: true }));

  const hoy = hoyEnLima();
  const ej = filas[0];
  const otra = (bodegas ?? []).find((b) => Number(b.id) !== ej?.st.almacen_id);

  const buffer = await generarPlantilla({
    titulo: 'Plantilla de traslados entre bodegas',
    subtitulo:
      'Una fila por pallet. Copie el código de la hoja «Pallets disponibles» y suba el archivo en Stock › Traslados › Importar desde Excel. ' +
      'Las columnas con * son obligatorias. La fila gris es de ejemplo: el sistema la salta.',
    hoja: HOJA_TRASLADOS,
    columnas: COLUMNAS_TRASLADO,
    ejemplo: {
      codigo_pallet: 'EJEMPLO 0001',
      origen: ej ? nombreBodega.get(ej.st.almacen_id) ?? '' : '',
      destino: String(otra?.nombre ?? ''),
      observaciones: 'FILA DE EJEMPLO: escriba encima o bórrela',
    },
    listas: [
      { clave: 'origen', titulo: 'Bodega', valores: (bodegas ?? []).map((b) => String(b.nombre)) },
      { clave: 'destino', titulo: 'Bodega de destino', valores: (bodegas ?? []).map((b) => String(b.nombre)) },
    ],
    referencias: [{
      hoja: 'Pallets disponibles',
      titulo: `Pallets que hoy se pueden trasladar (${filas.length}). No aparecen los bloqueados por Calidad ni los apartados enteros para pedidos.`,
      encabezados: ['Código de pallet', 'Producto', 'Bodega', 'Bultos disponibles', 'Kilos disponibles', 'Meses en cámara'],
      anchos: [18, 50, 26, 12, 13, 10],
      filas: filas.map(({ st, b }) => [
        st.codigo_pallet, desc.get(st.sku_presentacion_id) ?? '', nombreBodega.get(st.almacen_id) ?? '',
        b, Math.round(st.disponible_kg * 10) / 10, Math.round(st.meses * 10) / 10,
      ]),
    }],
    instrucciones: [
      'Una fila por pallet. Copie el código desde la hoja «Pallets disponibles» (donde también ve su bodega y cuánto tiene disponible).',
      'Bodega de origen es donde está hoy el pallet; bodega de destino, a dónde va. No pueden ser la misma.',
      'Si va el pallet entero, deje vacíos Bultos y Kilos: va todo lo disponible. Si va una parte, ponga los bultos (y, si quiere, los kilos exactos).',
      'No se puede trasladar lo bloqueado por Calidad, lo apartado para un pedido, ni un pallet que ya va en otro traslado que todavía no sale.',
      'Al subir, el sistema revisa cada fila y le dice qué está bien y qué no, y por qué. Las filas con error se corrigen en la misma pantalla.',
      'Con «Crear traslados en borrador», las filas con el mismo origen, destino y fecha programada forman un traslado. Nace en borrador: sigue su circuito normal (Gerencia u Operaciones lo autoriza, Almacén lo despacha con la guía y el destino lo recibe).',
    ],
    usuario: String(usuario.nombre ?? usuario.email ?? ''),
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="SantaMonica_Plantilla_Traslados_${hoy}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
