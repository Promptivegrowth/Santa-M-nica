/**
 * ============================================================================
 *  ETIQUETAS · las claves internas dichas en castellano
 * ============================================================================
 *  La base guarda los estados, los tipos y los nombres de columna como claves
 *  cortas y sin tildes (`pendiente_validacion`, `en_transito`, `ruc_tax_id`).
 *  Son buenas para programar y malas para leer: en pantalla salían como
 *  «PENDIENTE VALIDACION», «En preparacion» o «Modificado: fecha_carga».
 *
 *  Este archivo es el ÚNICO diccionario. Toda pantalla que muestre una clave
 *  pasa por aquí (directamente o por `etiquetaEstado` de formato.ts), así que
 *  corregir una palabra aquí la corrige en todo el sistema.
 *
 *  Lo que no esté en el diccionario no se muestra crudo: se convierte a texto
 *  legible (guiones bajos a espacios, «_id» fuera, tildes de las palabras que
 *  más se repiten). Es una red, no un sustituto: si una clave nueva sale rara,
 *  se agrega aquí.
 * ============================================================================
 */

/* ==========================================================================
   1. ESTADOS Y TIPOS (los enumerados de la base)
   ========================================================================== */
export const ESTADOS: Record<string, string> = {
  // Ciclo del pedido
  borrador: 'Borrador',
  pendiente_validacion: 'Pendiente de validación',
  confirmado: 'Confirmado',
  despachado: 'Despachado',
  cerrado: 'Cerrado',
  cancelado: 'Cancelado',
  // Cobertura del pedido
  pendiente_stock: 'Pendiente de stock',
  parcialmente_disponible: 'Parcialmente disponible',
  completo: 'Completo',
  reservado: 'Reservado',
  programado: 'Programado',
  en_preparacion: 'En preparación',
  preparado: 'Preparado',
  // Situación financiera
  sin_facturar: 'Sin facturar',
  bloqueado_credito: 'Bloqueado por crédito',
  facturado: 'Facturado',
  parcialmente_cobrado: 'Parcialmente cobrado',
  cobrado: 'Cobrado',
  vencido: 'Vencido',
  // Cotización
  aprobada: 'Aprobada',
  enviada: 'Enviada',
  aceptada: 'Aceptada',
  rechazada: 'Rechazada',
  vencida: 'Vencida',
  // Dictamen de calidad
  liberado: 'Liberado',
  observado: 'Observado',
  inmovilizado: 'Inmovilizado',
  espera_resultados: 'En espera de resultados',
  en_espera: 'En espera de resultados',
  condicionado: 'Solo mercado nacional',
  // Tipo de dictamen
  calidad: 'Calidad',
  microbiologia: 'Microbiología',
  camara: 'Cámara',
  producto_terminado: 'Producto terminado',
  // Embarque, packing
  planificado: 'Planificado',
  abierto: 'Abierto',
  en_carga: 'En carga',
  anulado: 'Anulado',
  // Factura
  emitida: 'Emitida',
  parcialmente_cobrada: 'Parcialmente cobrada',
  cobrada: 'Cobrada',
  anulada: 'Anulada',
  // Reserva
  solicitada: 'Solicitada',
  activa: 'Activa',
  consumida: 'Consumida',
  expirada: 'Expirada',
  liberada: 'Liberada',
  // Traslado
  autorizado: 'Autorizado',
  en_transito: 'En tránsito',
  aceptado: 'Aceptado',
  // Prioridad y severidad
  baja: 'Baja',
  normal: 'Normal',
  alta: 'Alta',
  urgente: 'Urgente',
  info: 'Informativa',
  advertencia: 'Advertencia',
  critica: 'Crítica',
  // Tipo de despacho
  exportacion: 'Exportación',
  mercado_nacional: 'Mercado nacional',
  traslado: 'Traslado',
  // Movimientos del Kardex
  ingreso: 'Ingreso',
  salida_despacho: 'Salida por despacho',
  traslado_salida: 'Salida por traslado',
  traslado_ingreso: 'Ingreso por traslado',
  ajuste_positivo: 'Ajuste que suma',
  ajuste_negativo: 'Ajuste que resta',
  salida_reproceso: 'Salida a reproceso',
  ingreso_reproceso: 'Ingreso de reproceso',
  salida_muestra: 'Muestra',
  salida_merma: 'Merma',
  // Turno y proceso
  dia: 'Día',
  noche: 'Noche',
  propia: 'Producción propia',
  maquila: 'Maquila',
  // Almacén, cliente, transportista, cuenta
  propio: 'Propio',
  externo: 'Externo',
  tercero: 'Tercero',
  final: 'Cliente final',
  intermediario: 'Intermediario',
  corriente: 'Corriente',
  ahorros: 'Ahorros',
  detraccion: 'Detracción',
  factura: 'Factura',
  boleta: 'Boleta',
  // Empaque y congelamiento
  sacos: 'Sacos',
  cajas: 'Cajas',
  block: 'Block',
  placas: 'Placas',
  tunel: 'Túnel',
  // Costeo
  promedio_movil: 'Promedio móvil',
  // Roles
  gerencia: 'Gerencia',
  operaciones: 'Operaciones',
  comercial: 'Comercial',
  comex: 'Comercio Exterior',
  almacen: 'Almacén',
  consulta: 'Consulta',
};

/* ==========================================================================
   2. NOMBRES DE CAMPO (columnas que salen en el historial y la auditoría)
   ========================================================================== */
export const CAMPOS: Record<string, string> = {
  // Generales
  numero: 'número',
  codigo: 'código',
  nombre: 'nombre',
  estado: 'estado',
  tipo: 'tipo',
  activo: 'activo / inactivo',
  observaciones: 'observaciones',
  observacion: 'observación',
  creado_en: 'fecha de creación',
  creado_por: 'creado por',
  actualizado_en: 'fecha de actualización',
  actualizado_por: 'actualizado por',
  moneda: 'moneda',
  tipo_cambio: 'tipo de cambio',
  tipo_cambio_fecha: 'fecha del tipo de cambio',
  tipo_cambio_fuente: 'fuente del tipo de cambio',
  tipo_cambio_clase: 'clase de tipo de cambio',
  incoterm: 'Incoterm',
  destino_id: 'destino',
  almacen_id: 'almacén',
  cliente_id: 'cliente',
  vendedor_id: 'vendedor',
  pedido_id: 'pedido',
  lote_id: 'pallet',
  fecha: 'fecha',
  prioridad: 'prioridad',
  forma_pago: 'forma de pago',
  adelanto_pct: 'adelanto (%)',
  adelanto_abonado: 'adelanto abonado',
  adelanto_abonado_en: 'fecha del abono del adelanto',
  // Clientes
  razon_social: 'razón social',
  nombre_corto: 'nombre corto',
  pais: 'país',
  ruc_tax_id: 'RUC / Tax ID',
  etiqueta_tax_id: 'nombre del documento tributario',
  contacto: 'contacto',
  email: 'correo',
  telefono: 'teléfono',
  linea_credito: 'línea de crédito',
  dias_credito: 'días de crédito',
  bloqueado: 'bloqueo',
  motivo_bloqueo: 'motivo del bloqueo',
  direccion: 'dirección',
  continente: 'continente',
  web: 'sitio web',
  condicion: 'condición',
  forma_pago_habitual: 'forma de pago habitual',
  referencias_comerciales: 'referencias comerciales',
  productos_interes: 'productos de interés',
  // Pedidos y cotizaciones
  numero_proforma: 'número de proforma',
  cotizacion_id: 'cotización',
  oc_cliente: 'orden de compra del cliente',
  tipo_despacho: 'tipo de despacho',
  condicion_pago: 'condición de pago',
  fecha_solicitada: 'fecha solicitada',
  fecha_posible: 'fecha posible',
  fecha_comprometida: 'fecha comprometida',
  fecha_tentativa_despacho: 'fecha tentativa de despacho',
  ciclo: 'etapa del pedido',
  cobertura: 'cobertura',
  situacion: 'situación financiera',
  contacto_id: 'contacto',
  contacto_nombre: 'nombre del contacto',
  contacto_cargo: 'cargo del contacto',
  contacto_telefono: 'teléfono del contacto',
  contacto_email: 'correo del contacto',
  contenedor_tipo: 'tipo de contenedor',
  contenedores: 'contenedores',
  tolerancia_pct: 'tolerancia (%)',
  mes_embarque: 'mes de embarque',
  pago_adelanto_pct: 'adelanto (%)',
  puerto_embarque: 'puerto de embarque',
  peso_neto_max_kg: 'peso neto máximo',
  peso_bruto_max_kg: 'peso bruto máximo',
  nota_restricciones: 'restricciones',
  restricciones_por: 'restricciones anotadas por',
  restricciones_en: 'fecha de las restricciones',
  validez_dias: 'días de validez',
  vence_el: 'fecha de vencimiento',
  aprobada_por: 'aprobada por',
  aprobada_en: 'fecha de aprobación',
  lista_id: 'lista de precios',
  cantidad_tm: 'cantidad (TM)',
  precio_lista_tm: 'precio de lista',
  precio_tm: 'precio por TM',
  descuento_pct: 'descuento (%)',
  descuento_autorizado_por: 'descuento autorizado por',
  costo_estimado_tm: 'costo estimado por TM',
  orden: 'orden',
  sku_presentacion_id: 'producto',
  // Embarques, packing, despachos
  fecha_programada: 'fecha programada',
  booking: 'booking',
  naviera: 'naviera',
  transportista_id: 'transportista',
  vehiculo_id: 'vehículo',
  conductor_id: 'conductor',
  motivo_cancelacion: 'motivo de la cancelación',
  embarque_id: 'embarque',
  contenedor: 'contenedor',
  precinto: 'precinto',
  guia_remision: 'guía de remisión',
  dam: 'DAM',
  supervisor_id: 'supervisor',
  turno: 'turno',
  fecha_carga: 'fecha de carga',
  hora_inicio: 'hora de inicio',
  hora_fin: 'hora de fin',
  filas_contenedor: 'filas del contenedor',
  sacos_por_fila: 'sacos por fila',
  packing_list_id: 'packing list',
  fecha_salida: 'fecha de salida',
  encargado_id: 'encargado',
  cantidad_kg: 'cantidad (kg)',
  pedido_linea_id: 'línea del pedido',
  // Lotes, reservas, traslados
  codigo_pallet: 'código de pallet',
  codigo_lote: 'código de lote',
  campania: 'campaña',
  fecha_produccion: 'fecha de producción',
  juliano: 'juliano',
  planta_id: 'planta',
  linea_procesadora_id: 'línea procesadora',
  proceso: 'proceso',
  bultos: 'bultos',
  bultos_iniciales: 'bultos iniciales',
  peso_neto_kg: 'peso neto',
  peso_neto_inicial_kg: 'peso neto inicial',
  costo_unitario: 'costo unitario',
  costo_origen: 'origen del costo',
  costo_vigencia_id: 'costo vigente',
  liberado_por: 'liberado por',
  liberado_en: 'fecha de liberación',
  motivo_liberacion: 'motivo de la liberación',
  reasignada_desde: 'reasignada desde',
  sku_solicitado_id: 'producto solicitado',
  sku_reservado_id: 'producto reservado',
  almacen_origen_id: 'almacén de origen',
  almacen_destino_id: 'almacén de destino',
  guia_numero: 'número de guía',
  autorizado_por: 'autorizado por',
  autorizado_en: 'fecha de autorización',
  despachado_por: 'despachado por',
  despachado_en: 'fecha de despacho',
  aceptado_por: 'recibido por',
  aceptado_en: 'fecha de recepción',
  consolida_pedidos: 'pedidos que consolida',
  bultos_enviados: 'bultos enviados',
  peso_enviado_kg: 'peso enviado',
  bultos_aceptados: 'bultos recibidos',
  peso_aceptado_kg: 'peso recibido',
  // Calidad
  motivo_id: 'motivo',
  motivo_texto: 'motivo escrito',
  sustento_url: 'sustento',
  emitido_por: 'emitido por',
  emitido_en: 'fecha de emisión',
  vigente: 'vigencia',
  // Facturas y cobros
  despacho_id: 'despacho',
  subtotal: 'subtotal',
  igv: 'IGV',
  total: 'total',
  fecha_emision: 'fecha de emisión',
  fecha_vencimiento: 'fecha de vencimiento',
  anulada_por: 'anulada por',
  anulada_en: 'fecha de anulación',
  motivo_anulacion: 'motivo de la anulación',
  tipo_comprobante: 'tipo de comprobante',
  monto: 'monto',
  medio: 'medio de pago',
  referencia: 'referencia',
  // Flota
  placa: 'placa',
  marca: 'marca',
  modelo: 'modelo',
  capacidad_tm: 'capacidad (TM)',
  soat_vence: 'vencimiento del SOAT',
  revision_vence: 'vencimiento de la revisión técnica',
  dni: 'DNI',
  licencia: 'brevete',
  licencia_vence: 'vencimiento del brevete',
  ruc: 'RUC',
  // Usuarios, parámetros, reglas
  rol: 'rol',
  aprueba_cotizaciones: 'aprueba cotizaciones',
  ve_objetivos: 've objetivos',
  carga_costos: 'carga costos',
  debe_cambiar_clave: 'debe cambiar la contraseña',
  valor: 'valor',
  clave: 'clave',
  etiqueta: 'nombre',
  descripcion: 'descripción',
  unidad: 'unidad',
  editable_por: 'quién lo cambia',
  activa: 'encendida / apagada',
  severidad: 'severidad',
  mensaje: 'mensaje',
  // Productos y maestros
  especie_id: 'especie',
  formato_id: 'formato',
  corte: 'corte',
  clasificacion_comercial: 'clasificación comercial',
  empaque: 'empaque',
  vida_util_meses: 'vida útil (meses)',
  talla: 'talla',
  puerto: 'puerto',
  operador: 'operador',
  ciudad: 'ciudad',
  despachos_dia_max: 'despachos por día',
  vigente_desde: 'vigente desde',
  vigente_hasta: 'vigente hasta',
  tm_desde: 'desde (TM)',
  tm_hasta: 'hasta (TM)',
  cargo: 'cargo',
  principal: 'principal',
  banco: 'banco',
  cci: 'CCI',
  swift: 'SWIFT',
  titular: 'titular',
};

/** Campos que cambian solos al guardar y no le dicen nada al usuario. */
export const CAMPOS_SIN_INTERES = new Set(['actualizado_en', 'actualizado_por']);

/* ==========================================================================
   3. NOMBRES DE TABLA (filtro de la auditoría)
   ========================================================================== */
export const TABLAS: Record<string, string> = {
  almacenes: 'Almacenes',
  cliente_verificaciones: 'Verificaciones de clientes (BASC)',
  clientes: 'Clientes',
  cobranzas: 'Cobros',
  conductores: 'Conductores',
  contratos: 'Contratos',
  cotizacion_lineas: 'Líneas de cotización',
  cotizaciones: 'Cotizaciones',
  despacho_archivos: 'Archivos de despacho',
  despachos: 'Despachos',
  dictamenes_calidad: 'Dictámenes de calidad',
  embarque_lineas: 'Líneas de embarque',
  embarques: 'Embarques',
  facturas: 'Comprobantes (facturas y boletas)',
  lotes: 'Pallets (lotes)',
  movimientos: 'Movimientos del Kardex',
  packing_lists: 'Packing lists',
  packing_lineas: 'Líneas de packing list',
  parametros: 'Parámetros del negocio',
  pedido_lineas: 'Líneas de pedido',
  pedidos: 'Pedidos',
  precios: 'Precios',
  reglas: 'Reglas de alerta',
  reservas: 'Reservas',
  skus: 'Productos (SKU)',
  transportistas: 'Transportistas',
  traslado_lineas: 'Líneas de traslado',
  traslados: 'Traslados',
  usuarios: 'Usuarios',
  vehiculos: 'Vehículos',
  vendedores: 'Vendedores',
};

/* ==========================================================================
   4. LA RED: tildes de las palabras que más se repiten en las claves
   ========================================================================== */
const TILDES: Record<string, string> = {
  validacion: 'validación', preparacion: 'preparación', transito: 'tránsito',
  exportacion: 'exportación', camara: 'cámara', microbiologia: 'microbiología',
  dia: 'día', dias: 'días', credito: 'crédito', numero: 'número', codigo: 'código',
  telefono: 'teléfono', direccion: 'dirección', pais: 'país', razon: 'razón',
  liberacion: 'liberación', cancelacion: 'cancelación', anulacion: 'anulación',
  emision: 'emisión', autorizacion: 'autorización', recepcion: 'recepción',
  produccion: 'producción', campania: 'campaña', almacen: 'almacén',
  vehiculo: 'vehículo', guia: 'guía', remision: 'remisión', situacion: 'situación',
  cotizacion: 'cotización', descripcion: 'descripción', observacion: 'observación',
  condicion: 'condición', informacion: 'información', minimo: 'mínimo',
  maximo: 'máximo', ultimo: 'último', periodo: 'período', automatico: 'automático',
  util: 'útil', tunel: 'túnel', detraccion: 'detracción', movil: 'móvil',
};

function conTildes(texto: string): string {
  return texto.replace(/[a-zñ]+/gi, (p) => TILDES[p.toLowerCase()] ?? p);
}

const mayuscula = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

/* ==========================================================================
   5. LAS FUNCIONES
   ========================================================================== */

/** 'pendiente_validacion' → 'Pendiente de validación'. */
export function etiquetaClave(valor: string | null | undefined): string {
  if (!valor) return '—';
  const conocida = ESTADOS[valor];
  if (conocida) return conocida;
  return mayuscula(conTildes(valor.replace(/_/g, ' ')));
}

/** 'ruc_tax_id' → 'RUC / Tax ID'; 'fecha_carga' → 'fecha de carga' (en minúscula, para listas). */
export function etiquetaCampo(campo: string): string {
  const conocido = CAMPOS[campo];
  if (conocido) return conocido;
  //  Lo que no está en el diccionario: «_id» fuera, guiones a espacios, tildes.
  return conTildes(campo.replace(/_id$/, '').replace(/_(kg|tm|pct)$/, ' ($1)').replace(/_/g, ' ')).trim();
}

/** 'dictamenes_calidad' → 'Dictámenes de calidad'. */
export function etiquetaTabla(tabla: string): string {
  return TABLAS[tabla] ?? mayuscula(conTildes(tabla.replace(/_/g, ' ')));
}

/**
 * Un texto ya redactado (un evento del historial) que trae claves sueltas:
 * «Pedido SMN-1 · pendiente_validacion», «Traslado T-3 en estado en_transito»,
 * «Dictamen de producto_terminado: espera_resultados». Se cambian las claves
 * conocidas por su nombre en minúscula; el resto del texto no se toca.
 *
 * Solo se reemplazan las claves con guion bajo (no son palabras del idioma) y
 * las pocas de una sola palabra que solo difieren por la tilde («camara»,
 * «microbiologia»): una palabra normal como «liberado» queda tal cual.
 */
export function textoLegible(texto: string | null | undefined): string {
  if (!texto) return '';
  return texto
    .replace(/\b[a-z]+(?:_[a-z]+)+\b/g, (clave) => {
      const conocida = ESTADOS[clave];
      return conocida ? conocida.toLowerCase() : clave;
    })
    .replace(/\b(camara|microbiologia|exportacion|preparacion|validacion|transito)\b/g,
      (p) => TILDES[p] ?? p);
}
