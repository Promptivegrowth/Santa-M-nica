/**
 * ============================================================================
 *  PLANTILLA DE INGRESOS · la descarga
 * ============================================================================
 *  Genera en el momento el Excel con el formato correcto y las listas válidas
 *  de HOY: si mañana se agrega un producto o se habilita una bodega para
 *  compras, la próxima plantilla ya lo trae.
 *
 *  Hojas: «Ingresos» (la que se llena), «Listas» (las listas desplegables),
 *  «Productos», «Almacenes» e «Instrucciones».
 *
 *  087 · Habla como su base (reunión con Dany, 10/11): los títulos y el orden
 *  de su hoja GENERAL, y en las listas sus nombres —OPERACIÓN INGRESO
 *  («ALETAS-"P" 1000-UP X 20 KG»), ALMACEN («SANTA MONICA»), CAMARA DE
 *  ALMACENAMIENTO («CAMARA N° 02»), DIA / NOCHE, PLACAS / TUNEL—. La hoja
 *  «Productos» va ordenada por ese nombre y trae su CODIGO, PRESENTACION y
 *  TIPO DE CONGELAMIENTO, para encontrar cada producto como él lo busca.
 * ============================================================================
 */
import { NextResponse } from 'next/server';
import { crearClienteServidor, obtenerUsuarioActual } from '@/lib/supabase/servidor';
import { generarPlantilla, normalizarTexto } from '@/lib/importacionExcel';
import { hoyEnLima } from '@/lib/fechas';
import { rolNoPuede } from '@/lib/mensajesBase';
import { PUEDEN_INGRESAR } from '../../tipos';
import { COLUMNAS_INGRESO, HOJA_INGRESOS, MOTIVOS_INGRESO } from '../columnas';
import { cargarCatalogoIngresos, nombreAlmacen } from '../revision';

export const dynamic = 'force-dynamic';

/** Como lo escriben en su base: mayúsculas y sin tildes («Santa Mónica» → «SANTA MONICA»). */
const comoSuBase = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
/** «Cámara 02» → «CAMARA N° 02». */
const camaraSuBase = (t: string) => {
  const n = /(\d+)\s*$/.exec(t);
  return n ? `CAMARA N° ${n[1].padStart(2, '0')}` : comoSuBase(t);
};
const CONGELAMIENTO: Record<string, string> = { placas: 'PLACAS', tunel: 'TUNEL' };

export async function GET() {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) return NextResponse.json({ error: 'Inicie sesión.' }, { status: 401 });
  if (!(PUEDEN_INGRESAR as readonly string[]).includes(usuario.rol)) {
    return NextResponse.json({ error: rolNoPuede(usuario.rol, 'importar ingresos a cámara', PUEDEN_INGRESAR) }, { status: 403 });
  }

  const supabase = await crearClienteServidor();
  const cat = await cargarCatalogoIngresos(supabase);
  const activas = cat.bodegas.filter((b) => b.activo && (b.recibe_produccion || b.recibe_compras));
  const hoy = hoyEnLima();
  const [a, m, d] = hoy.split('-');

  const almacenes = [...new Set(activas.map((b) => comoSuBase(nombreAlmacen(b.nombre))))];
  const camaras = [...new Set(cat.camaras.map((c) => camaraSuBase(c.nombre)))].sort();
  const productos = [...cat.productos].sort((x, y) =>
    (x.nombre_base || x.etiqueta).localeCompare(y.nombre_base || y.etiqueta, 'es') || x.congelamiento.localeCompare(y.congelamiento));
  const nombres = [...new Set(productos.map((p) => p.nombre_base).filter(Boolean))];

  //  El ejemplo, con un producto de todos los días.
  const ej = productos.find((p) => normalizarTexto(p.nombre_base) === normalizarTexto('ALETAS-"P" 1000-UP X 20 KG') && p.congelamiento === 'placas')
    ?? productos.find((p) => p.nombre_base) ?? productos[0];
  const ejBodega = activas.find((b) => b.recibe_produccion && cat.camaras.some((c) => c.almacen_id === b.id));
  const ejCamara = ejBodega && cat.camaras.find((c) => c.almacen_id === ejBodega.id);

  const buffer = await generarPlantilla({
    titulo: 'INGRESO DE PRODUCCIÓN DIARIA · plantilla',
    subtitulo:
      'Los mismos títulos y el mismo orden de su hoja GENERAL: copie sus filas de ingreso y péguelas debajo (una fila por pallet). ' +
      'Las columnas con * son obligatorias. La fila gris es de ejemplo: el sistema la salta. Súbala en Stock › Ingresos › Importar desde Excel.',
    hoja: HOJA_INGRESOS,
    columnas: COLUMNAS_INGRESO,
    ejemplo: {
      fecha_produccion: `${d}/${m}/${a}`,
      codigo_pallet: 'EJEMPLO 0001',
      codigo: ej?.codigo ?? '',
      producto: ej?.nombre_base || ej?.etiqueta || '',
      presentacion: ej?.presentacion ?? '',
      congelamiento: CONGELAMIENTO[ej?.congelamiento ?? ''] ?? '',
      kg_bulto: ej?.kg_bulto || 20,
      bultos: 56,
      peso_kg: Math.round(56 * (ej?.kg_bulto || 20) * 10) / 10,
      bodega: ejBodega ? comoSuBase(nombreAlmacen(ejBodega.nombre)) : almacenes[0] ?? '',
      camara: ejCamara ? camaraSuBase(ejCamara.nombre) : '',
      turno: 'DIA',
      linea: cat.lineas[0]?.nombre ?? '',
      motivo: 'PRIMER PROCESO',
      observaciones: 'FILA DE EJEMPLO: escriba encima o bórrela',
    },
    listas: [
      { clave: 'producto', titulo: 'OPERACIÓN INGRESO', valores: nombres },
      {
        clave: 'presentacion', titulo: 'PRESENTACION',
        valores: [...new Set(cat.productos.map((p) => p.presentacion))].sort((x, y) => x.localeCompare(y, 'es', { numeric: true })),
      },
      { clave: 'congelamiento', titulo: 'TIPO DE CONGELAMIENTO', valores: ['PLACAS', 'TUNEL'] },
      { clave: 'bodega', titulo: 'ALMACEN', valores: almacenes },
      { clave: 'camara', titulo: 'CAMARA DE ALMACENAMIENTO', valores: camaras },
      { clave: 'turno', titulo: 'TURNO', valores: ['DIA', 'NOCHE'] },
      { clave: 'linea', titulo: 'LINEA PROCESADORA', valores: cat.lineas.map((l) => l.nombre) },
      { clave: 'motivo', titulo: 'MOTIVO INGRESO', valores: MOTIVOS_INGRESO },
      { clave: 'planta', titulo: 'PLANTA', valores: cat.plantas.map((p) => p.nombre) },
    ],
    referencias: [
      {
        hoja: 'Productos',
        titulo: 'Productos activos, por su nombre en su base. Copie OPERACIÓN INGRESO, o escriba CODIGO + PRESENTACION + TIPO DE CONGELAMIENTO',
        encabezados: ['OPERACIÓN INGRESO', 'CODIGO', 'PRESENTACION', 'TIPO DE CONGELAMIENTO', 'PESO BULTO', 'Especie', 'Formato', 'Corte', 'Texto del sistema'],
        anchos: [46, 9, 13, 13, 10, 12, 14, 30, 52],
        filas: productos.map((p) => [
          p.nombre_base, p.codigo, p.presentacion, CONGELAMIENTO[p.congelamiento] ?? '', p.kg_bulto,
          p.especie, p.formato, p.corte, p.etiqueta,
        ]),
      },
      {
        hoja: 'Almacenes',
        titulo: 'Cómo escribir cada almacén (lo define Gerencia u Operaciones en Configuración › Maestros › Almacenes)',
        encabezados: ['ALMACEN', 'CAMARA DE ALMACENAMIENTO', 'Bodega en el sistema', 'Recibe producción', 'Recibe compras'],
        anchos: [18, 26, 30, 17, 15],
        filas: cat.bodegas.filter((b) => b.activo).flatMap((b) => {
          const suyas = cat.camaras.filter((c) => c.almacen_id === b.id);
          const fila = (camara: string) => [comoSuBase(nombreAlmacen(b.nombre)), camara, b.nombre,
            b.recibe_produccion ? 'Sí' : 'No', b.recibe_compras ? 'Sí' : 'No'];
          return suyas.length ? suyas.map((c) => fila(camaraSuBase(c.nombre))) : [fila('(vacía)')];
        }),
      },
    ],
    instrucciones: [
      'Una fila por pallet. Copie sus filas de ingreso (p. ej. de su hoja GENERAL) y péguelas debajo de los encabezados de la hoja «Ingresos» (pegado especial › valores). Los títulos son los mismos de su base, en el mismo orden.',
      'No cambie el nombre de los encabezados. Puede dejar vacías las columnas opcionales o borrarlas. Si su tabla trae columnas de más (N° AROS, ESTATUS, CLIENTE…), no pasa nada: el sistema las salta y se lo avisa.',
      'El PRODUCTO se reconoce por su OPERACIÓN INGRESO («ALETAS-"P" 1000-UP X 20 KG»), o por su CODIGO (169) con PRESENTACION («2 X 10 KG») y TIPO DE CONGELAMIENTO (PLACAS o TUNEL). Con las tres columnas el producto queda exacto, aunque el nombre venga vacío.',
      'Si un producto existe pero no con esa presentación o ese congelamiento, el sistema se lo dice con las presentaciones que sí tiene: se habilita en Ventas › Productos (Gerencia u Operaciones).',
      'ALMACEN y CAMARA DE ALMACENAMIENTO se escriben como en su base: SANTA MONICA + «CAMARA N° 01/02/03»; en FREEKO, HAYDUK y los demás la cámara puede ir vacía. La hoja «Almacenes» dice qué recibe cada uno.',
      'MOTIVO INGRESO: PRIMER PROCESO (o vacío) entra como producción propia; MAQUILA, como producción por maquila; COMPRA, como producto comprado y pide el PROVEEDOR. REPROCESO, REEMPAQUE, REIMPORTACIÓN y M.C PRIMER PROCESO entran como producción y el motivo queda anotado en el pallet. Un TRASLADO ALM TERCERO no es un ingreso: va en Stock › Traslados.',
      'El N°PALLET no se puede repetir: ni dentro del archivo ni con un pallet que ya exista en el sistema.',
      'Si un pallet TODAVÍA NO LLEGA, ponga en «LLEGA EL» la fecha en que se espera: quedará como ingreso programado y no moverá stock hasta que se confirme su llegada en Stock › Ingresos › Ingresos programados.',
      'Suba el archivo en Stock › Ingresos › Importar desde Excel. También puede subir su propio libro: el sistema busca la hoja que tenga estos títulos. Revisa cada fila con las mismas reglas del formulario y le dice qué filas están bien, cuáles no y por qué; las que tengan error se corrigen en la misma pantalla.',
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
