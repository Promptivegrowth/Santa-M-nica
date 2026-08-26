-- ============================================================================
--  SANTA MÓNICA ERP · MIGRACIÓN 003 · COMERCIAL, LOGÍSTICA Y FINANCIERO
-- ============================================================================
--  El recorrido completo de una venta, explicado en simple:
--
--   1. COTIZACIÓN  → le paso un precio al cliente. Todavía no me comprometo.
--   2. PEDIDO      → el cliente acepta. Ahora sí me comprometo a entregar.
--   3. RESERVA     → aparto lotes concretos para ese pedido. Ese producto ya
--                    no se le puede prometer a nadie más.
--   4. EMBARQUE    → programo qué día sale y en qué contenedor.
--   5. PACKING LIST→ armo la carga real del contenedor.
--   6. PLANO ESTIBA→ dibujo dónde va cada lote dentro del contenedor.
--   7. DESPACHO    → sale del almacén. Aquí termina la venta.
--   8. FACTURA     → emito el documento.
--   9. COBRANZA    → me pagan.
--
--  Cada paso guarda de dónde vino, para poder recorrer la cadena en ambos
--  sentidos. Eso es la trazabilidad.
-- ============================================================================


-- ============================================================================
--  1. LISTAS DE PRECIO
--  De la reunión: "el precio es uno por cantidades y dos por clientes", y
--  además varía por estación según la materia prima. Por eso las listas
--  tienen vigencia y admiten escalas por volumen y precio por cliente.
-- ============================================================================
create table listas_precio (
  id              bigserial primary key,
  nombre          text not null,
  moneda          moneda not null default 'USD',
  incoterm        incoterm not null default 'FOB',
  vigente_desde   date not null,
  vigente_hasta   date,
  activo          boolean not null default true,
  creado_en       timestamptz not null default now(),
  constraint lista_vigencia_coherente
    check (vigente_hasta is null or vigente_hasta >= vigente_desde)
);
comment on table listas_precio is 'Tarifarios con vigencia. Permiten que el precio cambie por temporada sin perder el histórico.';

create table precios (
  id                   bigserial primary key,
  lista_id             bigint not null references listas_precio(id) on delete cascade,
  sku_presentacion_id  bigint not null references sku_presentaciones(id),
  -- Si cliente_id es NULL, es el precio base para todos.
  -- Si tiene valor, es un precio pactado con ese cliente en particular.
  cliente_id           bigint references clientes(id) on delete cascade,
  -- Escala por volumen en toneladas. desde=0 y hasta=NULL significa "cualquier cantidad".
  tm_desde             numeric(12,3) not null default 0 check (tm_desde >= 0),
  tm_hasta             numeric(12,3) check (tm_hasta is null or tm_hasta > tm_desde),
  precio_tm            numeric(14,4) not null check (precio_tm >= 0),
  activo               boolean not null default true,
  unique (lista_id, sku_presentacion_id, cliente_id, tm_desde)
);
comment on table precios is 'Precio por tonelada. Resolución: primero el del cliente, luego la escala por volumen, luego el base.';

create index idx_precios_lista  on precios(lista_id);
create index idx_precios_sku    on precios(sku_presentacion_id);
create index idx_precios_cliente on precios(cliente_id) where cliente_id is not null;


-- ============================================================================
--  2. COTIZACIONES
-- ============================================================================
create table cotizaciones (
  id              bigserial primary key,
  numero          text not null unique,
  cliente_id      bigint not null references clientes(id),
  vendedor_id     bigint references vendedores(id),
  estado          estado_cotizacion not null default 'borrador',
  moneda          moneda not null default 'USD',
  tipo_cambio     numeric(10,4) not null default 1 check (tipo_cambio > 0),
  incoterm        incoterm not null default 'FOB',
  destino_id      bigint references destinos(id),
  lista_id        bigint references listas_precio(id),
  validez_dias    int not null default 15 check (validez_dias > 0),
  fecha           date not null default current_date,
  observaciones   text,
  creado_por      uuid not null references usuarios(id),
  creado_en       timestamptz not null default now()
);

create table cotizacion_lineas (
  id                   bigserial primary key,
  cotizacion_id        bigint not null references cotizaciones(id) on delete cascade,
  sku_presentacion_id  bigint not null references sku_presentaciones(id),
  cantidad_tm          numeric(14,3) not null check (cantidad_tm > 0),
  precio_lista_tm      numeric(14,4) not null default 0,
  precio_tm            numeric(14,4) not null check (precio_tm >= 0),
  descuento_pct        numeric(6,3) not null default 0 check (descuento_pct >= 0 and descuento_pct <= 100),
  -- Trazabilidad de precio: si se dio un descuento, quién lo autorizó
  descuento_autorizado_por uuid references usuarios(id),
  orden                int not null default 1
);
comment on table cotizacion_lineas is 'Se guarda el precio de lista Y el aplicado, para poder auditar el descuento.';

create index idx_cotlin_cot on cotizacion_lineas(cotizacion_id);


-- ============================================================================
--  3. PEDIDOS (proformas)
--  Los 18 estados de la especificación, separados en tres ejes que no se
--  pueden contradecir entre sí.
-- ============================================================================
create table pedidos (
  id                bigserial primary key,
  numero_proforma   text not null unique,       -- SM26-310/4
  cotizacion_id     bigint references cotizaciones(id),   -- de dónde vino
  cliente_id        bigint not null references clientes(id),
  vendedor_id       bigint references vendedores(id),
  oc_cliente        text,

  moneda            moneda not null default 'USD',
  tipo_cambio       numeric(10,4) not null default 1 check (tipo_cambio > 0),
  incoterm          incoterm not null default 'FOB',
  destino_id        bigint references destinos(id),
  tipo_despacho     tipo_despacho not null default 'exportacion',
  condicion_pago    text,
  dias_credito      int not null default 0 check (dias_credito >= 0),
  prioridad         prioridad not null default 'normal',

  -- Las tres fechas de la especificación
  fecha_solicitada  date not null default current_date,
  fecha_posible     date,
  fecha_comprometida date,

  -- Los tres ejes de estado
  ciclo             ciclo_pedido not null default 'borrador',
  cobertura         cobertura_pedido not null default 'pendiente_stock',
  situacion         situacion_financiera not null default 'sin_facturar',

  observaciones     text,
  creado_por        uuid not null references usuarios(id),
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now()
);
comment on table pedidos is 'La proforma. Entidad central del sistema: todo lo demás cuelga de aquí.';

create index idx_pedidos_cliente  on pedidos(cliente_id);
create index idx_pedidos_ciclo    on pedidos(ciclo);
create index idx_pedidos_cobertura on pedidos(cobertura);
create index idx_pedidos_fecha    on pedidos(fecha_solicitada desc);
create index idx_pedidos_prioridad on pedidos(prioridad);

create table pedido_lineas (
  id                   bigserial primary key,
  pedido_id            bigint not null references pedidos(id) on delete cascade,
  sku_presentacion_id  bigint not null references sku_presentaciones(id),
  cantidad_tm          numeric(14,3) not null check (cantidad_tm > 0),
  precio_lista_tm      numeric(14,4) not null default 0,
  precio_tm            numeric(14,4) not null check (precio_tm >= 0),
  descuento_pct        numeric(6,3) not null default 0 check (descuento_pct >= 0 and descuento_pct <= 100),
  descuento_autorizado_por uuid references usuarios(id),
  -- Costo estimado al momento de vender (para el margen estimado)
  costo_estimado_tm    numeric(14,4) not null default 0,
  orden                int not null default 1,
  observaciones        text
);
comment on table pedido_lineas is 'Qué y cuánto se pidió. El costo real sale de los lotes efectivamente despachados.';

create index idx_pedlin_pedido on pedido_lineas(pedido_id);
create index idx_pedlin_sku    on pedido_lineas(sku_presentacion_id);


-- ============================================================================
--  4. RESERVAS · la solución al problema número uno
--  Oliver: "tener producto que sí está disponible, pero que ya está asignado
--  a un cliente que en realidad no debería, porque se asignó y no se despachó".
--
--  Aquí la reserva:
--   · apunta a un LOTE concreto en un ALMACÉN concreto (no a "producto en general")
--   · tiene fecha de vencimiento
--   · deja registro de quién la creó, liberó o reasignó, y por qué
-- ============================================================================
create table reservas (
  id                bigserial primary key,
  pedido_linea_id   bigint not null references pedido_lineas(id) on delete cascade,
  lote_id           bigint not null references lotes(id),
  almacen_id        bigint not null references almacenes(id),
  bultos            int not null check (bultos > 0),
  peso_neto_kg      numeric(14,3) not null check (peso_neto_kg > 0),
  estado            estado_reserva not null default 'activa',

  -- Vencimiento: si nadie la usa, se libera sola. Plazo configurable.
  vence_el          timestamptz,

  creado_por        uuid not null references usuarios(id),
  creado_en         timestamptz not null default now(),
  -- Trazabilidad de la liberación (punto crítico)
  liberado_por      uuid references usuarios(id),
  liberado_en       timestamptz,
  motivo_liberacion text,
  -- Si se reasignó a otro pedido, de dónde venía
  reasignada_desde  bigint references reservas(id),

  observaciones     text
);
comment on table reservas is 'Producto apartado para un pedido. Contra lote concreto y con vencimiento: así no quedan reservas fantasma.';

create index idx_reservas_linea   on reservas(pedido_linea_id);
create index idx_reservas_lote    on reservas(lote_id);
create index idx_reservas_estado  on reservas(estado);
create index idx_reservas_activas on reservas(lote_id, almacen_id) where estado in ('activa','en_preparacion');
create index idx_reservas_vence   on reservas(vence_el) where estado = 'activa';


-- ============================================================================
--  5. EMBARQUES · el planificador
-- ============================================================================
create table embarques (
  id                bigserial primary key,
  numero            text not null unique,
  fecha_programada  date not null,
  almacen_id        bigint not null references almacenes(id),
  destino_id        bigint references destinos(id),
  tipo_despacho     tipo_despacho not null default 'exportacion',
  booking           text,
  naviera           text,
  transportista_id  bigint references transportistas(id),
  vehiculo_id       bigint references vehiculos(id),
  conductor_id      bigint references conductores(id),
  estado            estado_embarque not null default 'planificado',
  observaciones     text,
  creado_por        uuid not null references usuarios(id),
  creado_en         timestamptz not null default now()
);
comment on table embarques is 'Programación del despacho: qué día, desde qué bodega, hacia qué destino.';

create index idx_embarques_fecha  on embarques(fecha_programada);
create index idx_embarques_estado on embarques(estado);
create index idx_embarques_almacen on embarques(almacen_id);

-- Un embarque puede agrupar varios pedidos (consolidación) y un pedido puede
-- repartirse en varios embarques (despacho parcial). Por eso es tabla puente.
create table embarque_pedidos (
  embarque_id bigint not null references embarques(id) on delete cascade,
  pedido_id   bigint not null references pedidos(id) on delete cascade,
  primary key (embarque_id, pedido_id)
);
comment on table embarque_pedidos is 'Permite agrupar, dividir y consolidar pedidos en embarques.';


-- ============================================================================
--  6. PACKING LIST Y PLANO DE ESTIBA
--  El plano es una matriz: filas del contenedor × lotes. Reproduce exactamente
--  el archivo PLANO_POT_761 que entregó el cliente.
-- ============================================================================
create table packing_lists (
  id                bigserial primary key,
  codigo            text not null unique,       -- "PL POT761"
  embarque_id       bigint not null references embarques(id) on delete cascade,
  contenedor        text,
  precinto          text,
  guia_remision     text,
  dam               text,                        -- declaración aduanera
  supervisor_id     uuid references usuarios(id),
  turno             turno_operativo not null default 'dia',
  -- Tiempos reales de carga: alimentan el KPI de productividad
  fecha_carga       date,
  hora_inicio       time,
  hora_fin          time,
  -- Capacidad del contenedor, configurable (en el POT761 real: 22 filas × 61 sacos)
  filas_contenedor  int not null default 22 check (filas_contenedor > 0),
  sacos_por_fila    int not null default 61 check (sacos_por_fila > 0),
  estado            estado_packing not null default 'abierto',
  observaciones     text,
  creado_por        uuid not null references usuarios(id),
  creado_en         timestamptz not null default now()
);
comment on table packing_lists is 'La carga real de un contenedor, con sus tiempos y su documentación.';

create index idx_packing_embarque on packing_lists(embarque_id);
create index idx_packing_estado   on packing_lists(estado);

-- Qué lotes van en el packing (resumen por lote)
create table packing_lineas (
  id               bigserial primary key,
  packing_list_id  bigint not null references packing_lists(id) on delete cascade,
  lote_id          bigint not null references lotes(id),
  pedido_linea_id  bigint references pedido_lineas(id),
  bultos           int not null check (bultos > 0),
  peso_neto_kg     numeric(14,3) not null check (peso_neto_kg > 0),
  unique (packing_list_id, lote_id)
);

-- EL PLANO DE ESTIBA: cuántos sacos de cada lote van en cada fila
create table plano_estiba (
  id               bigserial primary key,
  packing_list_id  bigint not null references packing_lists(id) on delete cascade,
  lote_id          bigint not null references lotes(id),
  fila             int not null check (fila > 0),
  sacos            int not null check (sacos > 0),
  unique (packing_list_id, lote_id, fila)
);
comment on table plano_estiba is 'Matriz lote × fila del contenedor. Se genera sola con reparto FIFO por fecha de producción.';

create index idx_plano_packing on plano_estiba(packing_list_id);


-- ============================================================================
--  7. DESPACHOS
--  Aquí termina la venta (decisión de Marco: no hay distribución secundaria).
-- ============================================================================
create table despachos (
  id               bigserial primary key,
  packing_list_id  bigint not null references packing_lists(id),
  numero           text not null unique,
  fecha_salida     timestamptz not null default now(),
  encargado_id     uuid references usuarios(id),
  almacen_id       bigint not null references almacenes(id),
  observaciones    text,
  creado_por       uuid not null references usuarios(id),
  creado_en        timestamptz not null default now()
);
comment on table despachos is 'Salida física del producto. Dispara el consumo de reservas y los movimientos de Kardex.';


-- ============================================================================
--  8. FACTURACIÓN Y COBRANZA
--  Fase 1: comprobante interno con formato de factura (no electrónica SUNAT).
-- ============================================================================
create table facturas (
  id                bigserial primary key,
  numero            text not null unique,
  pedido_id         bigint not null references pedidos(id),
  cliente_id        bigint not null references clientes(id),
  despacho_id       bigint references despachos(id),
  moneda            moneda not null default 'USD',
  tipo_cambio       numeric(10,4) not null default 1 check (tipo_cambio > 0),
  subtotal          numeric(16,2) not null default 0 check (subtotal >= 0),
  igv               numeric(16,2) not null default 0 check (igv >= 0),
  total             numeric(16,2) not null default 0 check (total >= 0),
  fecha_emision     date not null default current_date,
  fecha_vencimiento date not null,
  estado            estado_factura not null default 'emitida',
  anulada_por       uuid references usuarios(id),
  anulada_en        timestamptz,
  motivo_anulacion  text,
  creado_por        uuid not null references usuarios(id),
  creado_en         timestamptz not null default now(),
  constraint factura_vencimiento_coherente check (fecha_vencimiento >= fecha_emision)
);
comment on table facturas is 'Comprobante interno. Vínculo uno a uno con la venta para la trazabilidad documental.';

create index idx_facturas_cliente on facturas(cliente_id);
create index idx_facturas_estado  on facturas(estado);
create index idx_facturas_venc    on facturas(fecha_vencimiento);

create table factura_lineas (
  id                  bigserial primary key,
  factura_id          bigint not null references facturas(id) on delete cascade,
  pedido_linea_id     bigint references pedido_lineas(id),
  sku_presentacion_id bigint not null references sku_presentaciones(id),
  cantidad_tm         numeric(14,3) not null check (cantidad_tm > 0),
  precio_tm           numeric(14,4) not null check (precio_tm >= 0),
  importe             numeric(16,2) not null default 0
);

create table cobranzas (
  id           bigserial primary key,
  factura_id   bigint not null references facturas(id) on delete cascade,
  monto        numeric(16,2) not null check (monto > 0),
  fecha        date not null default current_date,
  medio        text,
  referencia   text,
  observaciones text,
  registrado_por uuid not null references usuarios(id),
  creado_en    timestamptz not null default now()
);
comment on table cobranzas is 'Pagos recibidos. La suma contra el total de la factura define el estado de cobranza.';

create index idx_cobranzas_factura on cobranzas(factura_id);


-- ============================================================================
--  9. MOTOR DE REGLAS Y ALERTAS
--  "productos con más de 6 meses de producidos, con toneladas y valor" — se
--  define desde una pantalla, sin tocar código.
-- ============================================================================
create table reglas (
  id            bigserial primary key,
  nombre        text not null,
  descripcion   text,
  entidad       text not null,        -- 'lote', 'pedido', 'factura', 'reserva'…
  -- Condición en formato estructurado: {campo, operador, valor}
  condicion     jsonb not null,
  severidad     severidad_alerta not null default 'advertencia',
  mensaje       text not null,
  activa        boolean not null default true,
  creado_por    uuid references usuarios(id),
  creado_en     timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
comment on table reglas is 'Reglas configurables por el usuario. Generan alertas sin necesidad de desplegar código.';

create table alertas (
  id           bigserial primary key,
  regla_id     bigint references reglas(id) on delete cascade,
  entidad      text not null,
  entidad_id   bigint not null,
  severidad    severidad_alerta not null default 'advertencia',
  titulo       text not null,
  mensaje      text not null,
  datos        jsonb,
  atendida     boolean not null default false,
  atendida_por uuid references usuarios(id),
  atendida_en  timestamptz,
  generada_en  timestamptz not null default now()
);

create index idx_alertas_pendientes on alertas(severidad, generada_en desc) where not atendida;
create index idx_alertas_entidad    on alertas(entidad, entidad_id);


-- ============================================================================
--  10. IMPORTACIONES (aduanas y conciliación de almacenes externos)
-- ============================================================================
create table importaciones (
  id            bigserial primary key,
  tipo          text not null check (tipo in ('aduanas','conciliacion_externa')),
  archivo       text not null,
  almacen_id    bigint references almacenes(id),
  periodo       text,
  filas_ok      int not null default 0,
  filas_error   int not null default 0,
  detalle       jsonb,
  procesado_por uuid not null references usuarios(id),
  creado_en     timestamptz not null default now()
);

-- Precios de mercado extraídos del archivo de aduanas
create table precios_mercado (
  id           bigserial primary key,
  importacion_id bigint references importaciones(id) on delete cascade,
  anio         int not null,
  semana       int not null check (semana between 1 and 53),
  especie      text,
  descripcion  text,
  toneladas    numeric(14,3) not null default 0,
  valor_fob    numeric(16,2) not null default 0,
  precio_prom_tm numeric(14,4) generated always as
    (case when toneladas > 0 then valor_fob / toneladas else 0 end) stored
);
comment on table precios_mercado is 'Data pública de exportaciones para comparar el precio propio contra el mercado.';

create index idx_precmerc_periodo on precios_mercado(anio, semana);


-- ============================================================================
--  AUDITORÍA sobre las tablas comerciales críticas
-- ============================================================================
create trigger audit_pedidos      after insert or update or delete on pedidos        for each row execute function auditar_cambios();
create trigger audit_pedido_lin   after insert or update or delete on pedido_lineas  for each row execute function auditar_cambios();
create trigger audit_reservas     after insert or update or delete on reservas       for each row execute function auditar_cambios();
create trigger audit_cotizaciones after insert or update or delete on cotizaciones   for each row execute function auditar_cambios();
create trigger audit_cot_lineas   after insert or update or delete on cotizacion_lineas for each row execute function auditar_cambios();
create trigger audit_embarques    after insert or update or delete on embarques      for each row execute function auditar_cambios();
create trigger audit_packing      after insert or update or delete on packing_lists  for each row execute function auditar_cambios();
create trigger audit_despachos    after insert or update or delete on despachos      for each row execute function auditar_cambios();
create trigger audit_facturas     after insert or update or delete on facturas       for each row execute function auditar_cambios();
create trigger audit_cobranzas    after insert or update or delete on cobranzas      for each row execute function auditar_cambios();
create trigger audit_precios      after insert or update or delete on precios        for each row execute function auditar_cambios();
create trigger audit_reglas       after insert or update or delete on reglas         for each row execute function auditar_cambios();
