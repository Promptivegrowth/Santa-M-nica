/**
 * ============================================================================
 *  LAS COLUMNAS DE LA PLANTILLA DE INGRESOS
 * ============================================================================
 *  Son los mismos campos que pide el formulario «Registrar ingreso», más uno:
 *  «Llega el», para los ingresos programados. Se declaran una vez y las usan
 *  la plantilla, la lectura del archivo y la pantalla de revisión (para
 *  nombrar la columna de cada error).
 *
 *  087 · LA PLANTILLA HABLA COMO SU BASE. En la reunión del 10/11, Dany
 *  (Almacén) dijo que la plantilla «no está alineada» a su día a día: él lleva
 *  los ingresos en su base (hoja GENERAL, una fila por pallet) con SUS títulos
 *  y SUS nombres de producto. Desde aquí las columnas llevan esos mismos
 *  títulos y van en su mismo orden (FECHA DE PRODUCCIÓN, N°PALLET, CODIGO,
 *  OPERACIÓN INGRESO, PRESENTACION, TIPO DE CONGELAMIENTO, PESO BULTO, TOTAL,
 *  PESO NETO, ALMACEN, CAMARA DE ALMACENAMIENTO…): copia sus filas y pega.
 *
 *  Los títulos anteriores («Código de pallet», «Producto», «Bodega»…) quedan
 *  como alias, y Origen / Proceso siguen leyéndose si vienen: un archivo
 *  armado con la plantilla anterior se lee igual. El lector busca cada columna
 *  por su TÍTULO, no por su posición.
 *
 *  Archivo sin código de servidor: lo importa también la pantalla.
 * ============================================================================
 */
import type { ColumnaPlantilla } from '@/lib/importacionExcel';

export const HOJA_INGRESOS = 'Ingresos';

/** Su columna MOTIVO INGRESO: los motivos que son un ingreso a cámara. */
export const MOTIVOS_INGRESO = ['PRIMER PROCESO', 'M.C PRIMER PROCESO', 'REPROCESO', 'REEMPAQUE', 'REIMPORTACIÓN', 'MAQUILA', 'COMPRA'];

export const COLUMNAS_INGRESO: ColumnaPlantilla[] = [
  { clave: 'fecha_produccion', titulo: 'FECHA DE PRODUCCIÓN', obligatoria: true, ancho: 13, tipo: 'fecha',
    alias: ['Fecha de producción', 'Fecha produccion'],
    ayuda: 'DD/MM/AAAA. No puede ser futura: con ella se calcula la antigüedad y la vida útil.' },
  { clave: 'codigo_pallet', titulo: 'N°PALLET', obligatoria: true, ancho: 17, tipo: 'texto',
    alias: ['Código de pallet', 'Pallet', 'Código', 'Codigo pallet', 'N° PALLET', 'Nº PALLET', 'N PALLET'],
    ayuda: 'La matrícula del pallet, p. ej. «AL J04 26 30417». No se puede repetir: ni en el archivo ni con un pallet que ya exista.' },
  { clave: 'codigo', titulo: 'CODIGO', ancho: 8, tipo: 'texto', alias: ['Código SKU', 'Codigo SKU', 'SKU'],
    ayuda: 'El código del producto en su base (p. ej. 169), el mismo del sistema. Con CODIGO + PRESENTACION + TIPO DE CONGELAMIENTO el producto queda claro aunque OPERACIÓN INGRESO venga vacía.' },
  { clave: 'producto', titulo: 'OPERACIÓN INGRESO', obligatoria: true, ancho: 44, tipo: 'texto', alias: ['Producto', 'Operacion de ingreso'],
    ayuda: 'El nombre del producto tal como lo escriben en su base, p. ej. «ALETAS-"P" 1000-UP X 20 KG» (lista desplegable y hoja «Productos»). ' +
      'También vale el texto de la primera columna de la hoja «Productos» (p. ej. «169 · 2 X 10 KG · POTA · "P" 1000-UP»). Puede ir vacía si escribe CODIGO y PRESENTACION.' },
  { clave: 'presentacion', titulo: 'PRESENTACION', ancho: 12, tipo: 'texto', alias: ['Presentación'],
    ayuda: 'Cómo viene empacado, p. ej. «2 X 10 KG» o «4 X 5 KG». Decide cuando el mismo producto y el mismo peso por bulto vienen en dos presentaciones.' },
  //  081 · Su columna TIPO DE CONGELAMIENTO. 087: también decide cuando la
  //  presentación existe en placas y en túnel; antes, si el peso solo dejaba
  //  una opción, se ignoraba (un pallet de túnel podía entrar como placas).
  { clave: 'congelamiento', titulo: 'TIPO DE CONGELAMIENTO', ancho: 12, tipo: 'texto', alias: ['Tipo de congelamiento', 'Congelamiento'],
    ayuda: 'PLACAS o TUNEL (de la lista). Si lo escribe, el pallet entra con la presentación de ese congelamiento; si el producto no la tiene, el sistema se lo dice.' },
  { clave: 'kg_bulto', titulo: 'PESO BULTO', ancho: 9, tipo: 'numero', alias: ['Kg por bulto', 'Peso bulto (kg)'],
    ayuda: 'Kilos por saco o caja, p. ej. «20 KG». Solo hace falta si no escribe el PESO NETO: se multiplica por el TOTAL.' },
  { clave: 'bultos', titulo: 'TOTAL', obligatoria: true, ancho: 8, tipo: 'numero', alias: ['Bultos', 'Total bultos', 'Sacos'],
    ayuda: 'Cuántos bultos (sacos o cajas) tiene el pallet. Si trae medio saco (p. ej. 48.5: un saco con un solo bloque), se registra como un bulto más con el PESO NETO exacto, y queda anotado.' },
  { clave: 'peso_kg', titulo: 'PESO NETO', obligatoria: true, ancho: 11, tipo: 'numero',
    alias: ['Peso neto total (kg)', 'Peso neto (kg)', 'Kilos', 'Peso (kg)'],
    ayuda: 'El peso neto de todo el pallet, en kilos. Si lo deja vacío y pone PESO BULTO, se multiplica.' },
  { clave: 'bodega', titulo: 'ALMACEN', obligatoria: true, ancho: 16, tipo: 'texto', alias: ['Bodega', 'Almacén'],
    ayuda: 'Como en su base: SANTA MONICA, FREEKO, HAYDUK… (lista desplegable). En SANTA MONICA la cámara dice a cuál de sus tres cámaras entra.' },
  { clave: 'camara', titulo: 'CAMARA DE ALMACENAMIENTO', ancho: 15, tipo: 'texto', alias: ['Cámara', 'Camara'],
    ayuda: 'Como en su base: «CAMARA N° 01», «CAMARA N° 02», «CAMARA N° 03». Obligatoria si el ALMACEN es SANTA MONICA. En los almacenes externos (FREEKO, HAYDUK…) puede ir vacía o repetir el almacén.' },
  { clave: 'turno', titulo: 'TURNO', ancho: 8, tipo: 'texto', alias: ['Turno'],
    ayuda: 'DIA o NOCHE. Vacío: DIA.' },
  { clave: 'linea', titulo: 'LINEA PROCESADORA', ancho: 16, tipo: 'texto', alias: ['Línea procesadora'],
    ayuda: 'De la lista (SANTA MONICA, SERVIS CHIROQUE, SERVIS CELTA…). Sirve para rastrear un problema hasta la línea que lo produjo.' },
  { clave: 'motivo', titulo: 'MOTIVO INGRESO', ancho: 16, tipo: 'texto', alias: ['Motivo de ingreso'],
    ayuda: 'PRIMER PROCESO, REPROCESO, REEMPAQUE, MAQUILA, COMPRA… (lista). Vacío: PRIMER PROCESO. MAQUILA queda como producción por maquila; COMPRA, como producto comprado (pide el proveedor). ' +
      'Un TRASLADO ALM TERCERO no es un ingreso: se registra en Stock › Traslados.' },
  { clave: 'planta', titulo: 'PLANTA', ancho: 14, tipo: 'texto', alias: ['Planta'],
    ayuda: 'De la lista.' },
  { clave: 'proveedor', titulo: 'PROVEEDOR (si es compra)', ancho: 22, tipo: 'texto', alias: ['Proveedor (si es compra)', 'Proveedor'],
    ayuda: 'Obligatorio si el MOTIVO INGRESO es COMPRA: razón social de a quién se compró.' },
  { clave: 'costo', titulo: 'COSTO POR KG (US$)', ancho: 11, tipo: 'numero', alias: ['Costo por kg (US$)'],
    ayuda: 'Solo cuenta si el producto no tiene costo cargado en Costos de producción: si lo tiene, el pallet toma el que rige hoy.' },
  { clave: 'llega_el', titulo: 'LLEGA EL (si es programado)', ancho: 14, tipo: 'fecha',
    alias: ['Llega el (si es programado)', 'Llega el', 'Fecha de llegada'],
    ayuda: 'Solo si el pallet TODAVÍA NO LLEGA: la fecha en que se espera. Queda como ingreso programado y no mueve stock hasta que se confirme su llegada. Vacío o una fecha de hoy o anterior: entra al stock al registrar.' },
  { clave: 'observaciones', titulo: 'OBSERVACIONES', ancho: 30, tipo: 'texto', alias: ['Observaciones'],
    ayuda: 'Algo fuera de lo normal en este pallet (máximo 200 caracteres).' },
  /* Se leen si vienen, pero ya no salen en la plantilla: las columnas Origen y
     Proceso de la plantilla anterior (087: las reemplaza MOTIVO INGRESO) y su
     ID_PRES («PLACAS20 KG»), que trae el congelamiento. */
  { clave: 'origen', titulo: 'Origen', soloLectura: true, tipo: 'texto',
    ayuda: 'Producción o Compras (plantilla anterior).' },
  { clave: 'proceso', titulo: 'Proceso', soloLectura: true, tipo: 'texto',
    ayuda: 'Producción propia o Maquila (plantilla anterior).' },
  { clave: 'id_pres', titulo: 'ID_PRES', soloLectura: true, tipo: 'texto',
    ayuda: 'Su ID_PRES, p. ej. «PLACAS20 KG»: si no hay TIPO DE CONGELAMIENTO, se toma de aquí.' },
  { clave: 'aros', titulo: 'N° AROS', soloLectura: true, tipo: 'numero', alias: ['N AROS', 'Nº AROS', 'AROS'],
    ayuda: 'Sus bloques: si el TOTAL tiene medio saco, se anota con cuántos aros vino.' },
];

/** Las columnas que se ven (en la plantilla y en el editor de una fila). */
export const COLUMNAS_VISIBLES = COLUMNAS_INGRESO.filter((c) => !c.soloLectura);

export const TITULO_COLUMNA: Record<string, string> = Object.fromEntries(
  COLUMNAS_INGRESO.map((c) => [c.clave, c.titulo])
);

/** De qué campo del ingreso a qué columna del Excel: para poner cada error en su columna. */
export const COLUMNA_DE_CAMPO: Record<string, string> = {
  codigo_pallet: 'codigo_pallet',
  sku_presentacion_id: 'producto',
  //  087 · El origen sale del MOTIVO INGRESO (o de la columna Origen, si vino).
  origen_ingreso: 'motivo',
  proveedor: 'proveedor',
  almacen_id: 'bodega',
  camara_id: 'camara',
  bultos: 'bultos',
  peso_neto_kg: 'peso_kg',
  fecha_produccion: 'fecha_produccion',
  fecha_llegada: 'llega_el',
  costo_unitario: 'costo',
  turno: 'turno',
  proceso: 'motivo',
  planta_id: 'planta',
  linea_procesadora_id: 'linea',
  observaciones: 'observaciones',
};

export type ErrorColumna = { columna: string; mensaje: string };

export type EstadoFila = 'valida' | 'con_error' | 'descartada' | 'procesando' | 'registrada' | 'programada' | 'fallida';

export const TEXTO_ESTADO_FILA: Record<EstadoFila, string> = {
  valida: 'Lista',
  con_error: 'Con error',
  descartada: 'Descartada',
  procesando: 'Registrando…',
  registrada: 'Registrada',
  programada: 'Programada',
  fallida: 'No se registró',
};

export const TEXTO_ESTADO_IMPORTACION: Record<string, string> = {
  revision: 'En revisión',
  lista: 'Lista para validar',
  validada: 'Validada',
};
