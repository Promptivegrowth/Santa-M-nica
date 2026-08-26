-- ============================================================================
--  SANTA MÓNICA ERP · MIGRACIÓN 007 · DATOS BASE DE CONFIGURACIÓN
-- ============================================================================
--  Estos NO son datos de prueba: son la configuración del sistema.
--  Todos los valores de aquí se pueden cambiar después desde la pantalla de
--  Configuración, sin tocar código. Eso fue un pedido explícito del cliente.
-- ============================================================================


-- ============================================================================
--  1. PARÁMETROS DEL NEGOCIO
--  Cada fila es un número que antes estaría "quemado" en el código.
-- ============================================================================
insert into parametros (clave, valor, tipo_dato, grupo, etiqueta, descripcion, unidad, editable_por) values

-- --- Inventario y vida útil ---
('vida_util_meses', '24', 'numero', 'inventario', 'Vida útil del producto',
 'Meses que el producto se considera apto desde su fecha de producción. La pota maneja 2 años.', 'meses', 'gerencia'),

('anticuamiento_alerta_meses', '12', 'numero', 'inventario', 'Alerta de anticuamiento',
 'A partir de cuántos meses en cámara el sistema empieza a avisar. Hoy Oliver lo controla a mano a los 12 meses.', 'meses', 'operaciones'),

('anticuamiento_critico_meses', '18', 'numero', 'inventario', 'Anticuamiento crítico',
 'A partir de cuántos meses la alerta pasa a ser crítica y exige acción comercial.', 'meses', 'operaciones'),

('costo_metodo', 'promedio_movil', 'texto', 'inventario', 'Método de costeo',
 'Cómo se calcula el costo del inventario. Promedio móvil recalcula el costo cada vez que entra producto.', null, 'gerencia'),

('stock_minimo_alerta_tm', '5', 'numero', 'inventario', 'Stock mínimo para alertar quiebre',
 'Por debajo de estas toneladas disponibles, el SKU se marca en riesgo de quiebre.', 'TM', 'operaciones'),

-- --- Reservas: el parámetro que resuelve el problema número uno ---
('reserva_dias_vencimiento', '15', 'numero', 'comercial', 'Días de vigencia de una reserva',
 'Si nadie despacha la reserva en este plazo, se libera sola y el stock vuelve a estar disponible.', 'días', 'operaciones'),

('reserva_aviso_previo_dias', '3', 'numero', 'comercial', 'Aviso previo al vencimiento',
 'Con cuántos días de anticipación se avisa que una reserva está por vencer.', 'días', 'operaciones'),

-- --- Comercial ---
('igv_porcentaje', '18', 'numero', 'comercial', 'IGV',
 'Único impuesto que aplica según lo confirmado en la reunión.', '%', 'gerencia'),

('detraccion_porcentaje', '12', 'numero', 'comercial', 'Detracción SPOT',
 'Porcentaje de detracción aplicable a servicios gravados.', '%', 'gerencia'),

('moneda_defecto', 'USD', 'texto', 'comercial', 'Moneda por defecto',
 'La exportación se cotiza en dólares; el mercado nacional puede usar soles.', null, 'gerencia'),

('tipo_cambio_referencial', '3.75', 'numero', 'comercial', 'Tipo de cambio referencial',
 'Valor sugerido al crear una proforma. Se puede cambiar en cada documento.', 'PEN/USD', 'comercial'),

('cotizacion_validez_dias', '15', 'numero', 'comercial', 'Validez de la cotización',
 'Cuántos días se mantiene el precio ofrecido al cliente.', 'días', 'comercial'),

('margen_minimo_alerta', '8', 'numero', 'comercial', 'Margen mínimo aceptable',
 'Por debajo de este margen el pedido se marca como "margen bajo" y requiere revisión.', '%', 'gerencia'),

('descuento_max_sin_autorizacion', '3', 'numero', 'comercial', 'Descuento libre',
 'Descuento máximo que comercial puede dar sin pedir autorización.', '%', 'gerencia'),

-- --- Logística ---
('contenedor_filas', '22', 'numero', 'logistica', 'Filas por contenedor',
 'Cuántas filas de carga tiene un contenedor estándar. En el plano POT761 real son 22.', 'filas', 'operaciones'),

('contenedor_sacos_por_fila', '61', 'numero', 'logistica', 'Sacos por fila',
 'Cuántos sacos entran en cada fila del contenedor. En el plano POT761 real son 61.', 'sacos', 'operaciones'),

('despachos_simultaneos_max', '4', 'numero', 'logistica', 'Despachos simultáneos máximos',
 'Tope de almacenes despachando a la vez. Oliver indicó que 4 ya es el límite práctico.', 'almacenes', 'operaciones'),

('dias_operativos', 'lun,mar,mie,jue,vie,sab', 'texto', 'logistica', 'Días operativos',
 'Días en que se despacha con normalidad. El domingo se puede, pero con sobrecosto.', null, 'operaciones'),

('recargo_domingo_pct', '35', 'numero', 'logistica', 'Recargo dominical',
 'Sobrecosto por despachar en domingo.', '%', 'gerencia'),

('tiempo_carga_objetivo_horas', '2', 'numero', 'logistica', 'Tiempo objetivo de carga',
 'Meta de horas para cargar un contenedor. El promedio real hoy es de 4,9 horas.', 'horas', 'operaciones'),

-- --- Empresa ---
('empresa_razon_social', 'INDUSTRIAL PESQUERA SANTA MÓNICA S.A.C.', 'texto', 'empresa', 'Razón social', 'Nombre legal para documentos y reportes.', null, 'gerencia'),
('empresa_ruc', '20205572229', 'texto', 'empresa', 'RUC', 'Registro único de contribuyente.', null, 'gerencia'),
('empresa_marca', 'Santa Mónica Fishing', 'texto', 'empresa', 'Marca comercial', 'Nombre con el que aparece en reportes y exportaciones.', null, 'gerencia'),
('empresa_direccion', 'Chimbote, Áncash, Perú', 'texto', 'empresa', 'Dirección', 'Domicilio fiscal.', null, 'gerencia'),

-- --- Sistema ---
('campania_actual', '2026', 'numero', 'sistema', 'Campaña en curso', 'Año de campaña que se usa por defecto al registrar lotes.', null, 'operaciones'),
('paginacion_filas', '50', 'numero', 'sistema', 'Filas por página', 'Cuántos registros se muestran por página en las grillas.', 'filas', 'gerencia');


-- ============================================================================
--  2. MOTIVOS
--  El Excel maneja 14 motivos de ingreso y 16 de salida. Aquí quedan
--  tipificados y, sobre todo, marcados los que exigen autorización.
-- ============================================================================

-- --- Motivos de INGRESO ---
insert into motivos (ambito, codigo, nombre, requiere_autorizacion) values
('ingreso','PRIMER_PROCESO',      'Primer proceso',                 false),
('ingreso','MAQUILA',             'Maquila',                        false),
('ingreso','TRASLADO_TERCERO',    'Traslado desde almacén tercero', false),
('ingreso','REEMPAQUE',           'Reempaque',                      false),
('ingreso','REPROCESO',           'Retorno de reproceso',           false),
('ingreso','REIMPORTACION',       'Reimportación',                  true),
('ingreso','MC_PRIMER_PROCESO',   'Muestra de calidad · primer proceso', false),
('ingreso','DEVOLUCION_CLIENTE',  'Devolución de cliente',          true);

-- --- Motivos de SALIDA ---
insert into motivos (ambito, codigo, nombre, requiere_autorizacion) values
('salida','DESPACHADO',        'Despacho a cliente',        false),
('salida','TRASLADO_ALMACEN',  'Traslado entre almacenes',  true),
('salida','REPROCESO',         'Salida a reproceso',        true),
('salida','REEMPAQUE',         'Salida a reempaque',        true),
('salida','MC_PT',             'Muestra de calidad · producto terminado', false),
('salida','M_INTERTEK',        'Muestra Intertek',          false),
('salida','M_SGS',             'Muestra SGS',               false),
('salida','DONACION',          'Donación',                  true),
('salida','MERMADO',           'Mermado',                   true),
('salida','HARINA',            'Producto derivado a harina', true),
('salida','PARA_COCINA',       'Producto para cocina',      true),
('salida','VIDA_UTIL',         'Baja por vida útil vencida', true);

-- --- Motivos de AJUSTE (todos exigen autorización: pedido de Marco) ---
insert into motivos (ambito, codigo, nombre, requiere_autorizacion) values
('ajuste','CONTEO_FISICO',     'Diferencia de conteo físico',      true),
('ajuste','DISCREPANCIA_TRAS', 'Discrepancia de traslado',         true),
('ajuste','ERROR_REGISTRO',    'Corrección de error de registro',  true),
('ajuste','MERMA_CAMARA',      'Merma en cámara',                  true),
('ajuste','RECLASIFICACION',   'Reclasificación de producto',      true);

-- --- Motivos de BLOQUEO DE CALIDAD ---
--  Los cuatro que mencionó Oliver: normativo, microbiológico,
--  fisicoquímico y organoléptico, más los que aparecen en la data real.
insert into motivos (ambito, codigo, nombre, requiere_autorizacion) values
('bloqueo','NORMATIVO',        'Normativo',                        false),
('bloqueo','MICROBIOLOGICO',   'Microbiológico',                   false),
('bloqueo','FISICOQUIMICO',    'Fisicoquímico',                    false),
('bloqueo','ORGANOLEPTICO',    'Organoléptico',                    false),
('bloqueo','SANIPES',          'Inmovilizado por SANIPES',         false),
('bloqueo','PARASITADO',       'Producto parasitado',              false),
('bloqueo','QUEMADURA_FRIO',   'Quemaduras por frío',              false),
('bloqueo','BAJO_PESO',        'Bajo peso',                        false),
('bloqueo','POR_EMPACAR',      'Pendiente de empaque',             false),
('bloqueo','EVAL_CALIDAD',     'En evaluación de calidad',         false);

-- --- Motivos de LIBERACIÓN DE RESERVA ---
--  Tipificados para poder medir POR QUÉ se caen las reservas.
insert into motivos (ambito, codigo, nombre, requiere_autorizacion) values
('liberacion_reserva','CLIENTE_DESISTIO',  'El cliente desistió de la compra',  false),
('liberacion_reserva','CAMBIO_PRODUCTO',   'Cambio de producto solicitado',     false),
('liberacion_reserva','REASIGNACION',      'Reasignación a otro cliente',       true),
('liberacion_reserva','VENCIMIENTO',       'Vencimiento del plazo de reserva',  false),
('liberacion_reserva','ERROR_ASIGNACION',  'Error en la asignación original',   false),
('liberacion_reserva','BLOQUEO_CALIDAD',   'Producto observado por calidad',    false);


-- ============================================================================
--  3. REGLAS INICIALES DEL MOTOR
--  Ejemplos funcionales que el cliente puede editar o desactivar.
-- ============================================================================
insert into reglas (nombre, descripcion, entidad, condicion, severidad, mensaje, activa) values

('Producto con más de 12 meses en cámara',
 'El caso que Oliver controla hoy manualmente: avisar cuando un lote supera el año almacenado.',
 'lote',
 '{"campo":"meses_almacenado","operador":">=","valor":12}'::jsonb,
 'advertencia',
 'El lote {codigo_pallet} lleva {meses_almacenado} meses en cámara y supera el umbral de alerta.',
 true),

('Producto que superó la vida útil',
 'Producto que pasó los 24 meses y ya no es comercializable.',
 'lote',
 '{"campo":"meses_almacenado","operador":">=","valor":24}'::jsonb,
 'critica',
 'El lote {codigo_pallet} superó la vida útil de 24 meses. Requiere disposición inmediata.',
 true),

('Reserva próxima a vencer',
 'Avisa antes de que una reserva se caiga sola y libere el producto.',
 'reserva',
 '{"campo":"dias_para_vencer","operador":"<=","valor":3}'::jsonb,
 'advertencia',
 'La reserva del pedido {numero_proforma} vence en {dias_para_vencer} días.',
 true),

('Pedido sin movimiento',
 'Pedido confirmado que lleva demasiado tiempo sin avanzar.',
 'pedido',
 '{"campo":"dias_sin_movimiento","operador":">=","valor":10}'::jsonb,
 'advertencia',
 'El pedido {numero_proforma} lleva {dias_sin_movimiento} días sin movimiento.',
 true),

('Pedido con margen bajo',
 'Venta por debajo del margen mínimo definido por gerencia.',
 'pedido',
 '{"campo":"margen_pct","operador":"<","valor":8}'::jsonb,
 'critica',
 'El pedido {numero_proforma} tiene un margen de {margen_pct}%, por debajo del mínimo.',
 true),

('Factura vencida',
 'Documento que pasó su fecha de vencimiento sin cobrarse.',
 'factura',
 '{"campo":"dias_vencida","operador":">","valor":0}'::jsonb,
 'critica',
 'La factura {numero} está vencida hace {dias_vencida} días.',
 true),

('Traslado detenido en tránsito',
 'Producto que salió de una bodega y nadie confirmó su recepción.',
 'traslado',
 '{"campo":"dias_en_transito","operador":">=","valor":5}'::jsonb,
 'critica',
 'El traslado {numero} lleva {dias_en_transito} días en tránsito sin aceptación en destino.',
 true),

('SOAT por vencer',
 'Documento del vehículo próximo a caducar.',
 'vehiculo',
 '{"campo":"dias_para_vencer_soat","operador":"<=","valor":30}'::jsonb,
 'advertencia',
 'El SOAT del vehículo {placa} vence en {dias_para_vencer_soat} días.',
 true);
