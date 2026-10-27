/**
 * ============================================================================
 *  PLANTILLA DE INGRESOS · la descarga
 * ============================================================================
 *  Genera en el momento el Excel con el formato correcto y las listas válidas
 *  de HOY: si mañana se agrega un producto o se habilita una bodega para
 *  compras, la próxima plantilla ya lo trae.
 *
 *  Hojas: «Ingresos» (la que se llena), «Listas» (productos con su código,
 *  bodegas y qué admite cada una, cámaras, plantas, líneas…) e
 *  «Instrucciones».
 * ============================================================================
 */
import { NextResponse } from 'next/server';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { generarPlantilla } from '@/lib/importacionExcel';
import { hoyEnLima } from '@/lib/fechas';
import { rolNoPuede } from '@/lib/mensajesBase';
import { PUEDEN_INGRESAR } from '../../tipos';
import { COLUMNAS_INGRESO, HOJA_INGRESOS } from '../columnas';
import { cargarCatalogoIngresos } from '../revision';

export const dynamic = 'force-dynamic';

export async function GET() {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return NextResponse.json({ error: 'Inicie sesión.' }, { status: 401 });
  if (!(PUEDEN_INGRESAR as readonly string[]).includes(usuario.rol)) {
    return NextResponse.json({ error: rolNoPuede(usuario.rol, 'importar ingresos a cámara', PUEDEN_INGRESAR) }, { status: 403 });
  }

  const supabase = await crearClienteServidor();
  const cat = await cargarCatalogoIngresos(supabase);
  const activas = cat.bodegas.filter((b) => b.activo && (b.recibe_produccion || b.recibe_compras));
  const nombreBodega = new Map(cat.bodegas.map((b) => [b.id, b.nombre]));
  const hoy = hoyEnLima();
  const [a, m, d] = hoy.split('-');

  const ejProducto = cat.productos[0];
  const ejBodega = activas.find((b) => b.recibe_produccion) ?? activas[0];

  const buffer = await generarPlantilla({
    titulo: 'Plantilla de ingresos a cámara',
    subtitulo:
      'Pegue sus pallets debajo de los encabezados (una fila por pallet) y suba el archivo en Stock › Ingresos › Importar desde Excel. ' +
      'Las columnas con * son obligatorias. La fila gris es de ejemplo: el sistema la salta.',
    hoja: HOJA_INGRESOS,
    columnas: COLUMNAS_INGRESO,
    ejemplo: {
      codigo_pallet: 'EJEMPLO 0001',
      producto: ejProducto?.etiqueta ?? '',
      origen: 'Producción',
      bodega: ejBodega?.nombre ?? '',
      bultos: 40,
      peso_kg: ejProducto ? Math.round(40 * (ejProducto.kg_bulto || 20) * 10) / 10 : 800,
      fecha_produccion: `${d}/${m}/${a}`,
      turno: 'Día',
      proceso: 'Producción propia',
      observaciones: 'FILA DE EJEMPLO: escriba encima o bórrela',
    },
    listas: [
      { clave: 'producto', titulo: 'Producto', valores: cat.productos.map((p) => p.etiqueta) },
      { clave: 'origen', titulo: 'Origen', valores: ['Producción', 'Compras'] },
      { clave: 'bodega', titulo: 'Bodega', valores: activas.map((b) => b.nombre) },
      { clave: 'camara', titulo: 'Cámara', valores: [...new Set(cat.camaras.map((c) => c.nombre))] },
      { clave: 'turno', titulo: 'Turno', valores: ['Día', 'Noche'] },
      { clave: 'proceso', titulo: 'Proceso', valores: ['Producción propia', 'Maquila'] },
      { clave: 'planta', titulo: 'Planta', valores: cat.plantas.map((p) => p.nombre) },
      { clave: 'linea', titulo: 'Línea procesadora', valores: cat.lineas.map((l) => l.nombre) },
    ],
    referencias: [
      {
        hoja: 'Productos',
        titulo: 'Productos activos: copie el texto de la primera columna en «Producto»',
        encabezados: ['Producto (copie este texto)', 'Código SKU', 'Presentación', 'Especie', 'Corte', 'Kg por bulto'],
        anchos: [52, 11, 16, 18, 30, 11],
        filas: cat.productos.map((p) => [p.etiqueta, p.codigo, p.presentacion, p.especie, p.corte, p.kg_bulto]),
      },
      {
        hoja: 'Bodegas',
        titulo: 'Qué recibe cada bodega (lo define Gerencia u Operaciones en Configuración › Maestros › Almacenes)',
        encabezados: ['Bodega', 'Código', 'Recibe producción', 'Recibe compras', 'Cámaras'],
        anchos: [28, 10, 17, 15, 30],
        filas: cat.bodegas.filter((b) => b.activo).map((b) => [
          b.nombre, b.codigo, b.recibe_produccion ? 'Sí' : 'No', b.recibe_compras ? 'Sí' : 'No',
          cat.camaras.filter((c) => c.almacen_id === b.id).map((c) => c.nombre).join(', ') || '—',
        ]),
      },
      {
        hoja: 'Cámaras',
        titulo: 'Cámaras de cada bodega',
        encabezados: ['Cámara', 'Bodega'],
        anchos: [18, 28],
        filas: cat.camaras.map((c) => [c.nombre, nombreBodega.get(c.almacen_id) ?? '—']),
      },
    ],
    instrucciones: [
      'Una fila por pallet. Copie sus tablas debajo de los encabezados de la hoja «Ingresos» (pegado especial › valores, para no traer formatos raros).',
      'No cambie el nombre de los encabezados. Puede dejar vacías las columnas opcionales o incluso borrarlas.',
      'Producto, origen, bodega, cámara, turno, proceso, planta y línea tienen lista desplegable. Las listas completas están en las hojas «Listas», «Productos», «Bodegas» y «Cámaras».',
      'Cada origen entra solo por ciertas bodegas: la producción por las que «Recibe producción» y las compras por las que «Recibe compras» (hoja «Bodegas»). Una compra necesita el proveedor.',
      'El código de pallet no se puede repetir: ni dentro del archivo ni con un pallet que ya exista en el sistema.',
      'Si un pallet TODAVÍA NO LLEGA, ponga en «Llega el» la fecha en que se espera: quedará como ingreso programado y no moverá stock hasta que se confirme su llegada en Stock › Ingresos › Ingresos programados.',
      'Suba el archivo en Stock › Ingresos › Importar desde Excel. El sistema revisa cada fila con las mismas reglas del formulario y le dice qué filas están bien, cuáles no y por qué. Las que tengan error se corrigen en la misma pantalla (o en el Excel, y se vuelve a subir).',
      'Almacén deja la importación «Lista para validar»; el stock entra cuando Gerencia u Operaciones pulsa «Validar y registrar».',
    ],
    usuario: String(usuario.nombre ?? usuario.email ?? ''),
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="SantaMonica_Plantilla_Ingresos_${hoy}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
