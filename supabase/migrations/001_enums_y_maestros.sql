-- ============================================================================
--  SANTA MÓNICA ERP · MIGRACIÓN 001 · ENUMERACIONES Y TABLAS MAESTRAS
-- ============================================================================
--  ¿Qué es una "tabla maestra"?
--  Es un catálogo: la lista de cosas que existen y casi no cambian. Los
--  almacenes, los productos, los clientes, los destinos. El resto del sistema
--  no escribe texto libre: elige de estas listas.
--
--  ¿Por qué importa tanto?
--  Porque el Excel actual guarda todo como texto escrito a mano, y eso produjo
--  110 formas distintas de escribir 87 clientes y 18 nombres para 10 bodegas.
--  Cada variante rompe un reporte. Aquí eso ya no puede pasar.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- LIMPIEZA: hace que esta migración se pueda volver a correr durante el
-- desarrollo sin tener que borrar el proyecto a mano.
-- ---------------------------------------------------------------------------
do $limpieza$
declare
  sentencias text;
begin
  -- Borra todas las tablas del esquema público
  select coalesce(string_agg(format('drop table if exists public.%I cascade;', tablename), ' '), '')
    into sentencias from pg_tables where schemaname = 'public';
  if sentencias <> '' then execute sentencias; end if;

  -- Borra todas las vistas
  select coalesce(string_agg(format('drop view if exists public.%I cascade;', viewname), ' '), '')
    into sentencias from pg_views where schemaname = 'public';
  if sentencias <> '' then execute sentencias; end if;

  -- Borra todos los tipos enumerados propios
  select coalesce(string_agg(format('drop type if exists public.%I cascade;', t.typname), ' '), '')
    into sentencias
    from pg_type t join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'public' and t.typtype = 'e';
  if sentencias <> '' then execute sentencias; end if;
end
$limpieza$;


-- ============================================================================
--  1. ENUMERACIONES
--  Son listas cerradas de valores. Si el sistema intenta guardar algo que no
--  está en la lista, Postgres lo rechaza. Es la primera línea de defensa.
-- ============================================================================

-- Los siete roles del sistema (ver hoja de ruta, sección 01)
create type rol_usuario as enum (
  'gerencia',     -- Marco León · acceso total
  'operaciones',  -- Oliver Tello · autoriza traslados, ajustes y reservas
  'comercial',    -- ventas · cotiza, pide, reserva
  'comex',        -- comercio exterior · embarques y documentación
  'almacen',      -- jefe de bodega · ingresos, picking, acepta traslados
  'calidad',      -- dictámenes sanitarios
  'consulta'      -- solo lectura, sin costos
);

create type tipo_almacen         as enum ('propio', 'externo');
create type tipo_proceso         as enum ('propia', 'maquila');
create type turno_operativo      as enum ('dia', 'noche');
create type tipo_congelamiento   as enum ('placas', 'tunel');
create type tipo_empaque         as enum ('sacos', 'cajas', 'block');
create type moneda               as enum ('USD', 'PEN');
create type incoterm             as enum ('EXW', 'FOB', 'CFR', 'CIF', 'DAP');
create type prioridad            as enum ('baja', 'normal', 'alta', 'urgente');
create type tipo_despacho        as enum ('exportacion', 'mercado_nacional', 'traslado');
create type tipo_cliente         as enum ('final', 'intermediario');
create type tipo_transportista   as enum ('propio', 'tercero');

-- Movimientos del Kardex. Cada fila del Kardex es de uno de estos tipos.
create type tipo_movimiento as enum (
  'ingreso',           -- entra producto nuevo (producción o compra)
  'salida_despacho',   -- sale por venta
  'traslado_salida',   -- sale de una bodega hacia otra
  'traslado_ingreso',  -- entra en la bodega destino
  'ajuste_positivo',   -- corrección que suma (requiere autorización)
  'ajuste_negativo',   -- corrección que resta (requiere autorización)
  'salida_reproceso',  -- sale para volver a procesarse
  'ingreso_reproceso', -- vuelve del reproceso
  'salida_muestra',    -- sale como muestra de calidad
  'salida_merma'       -- se pierde (vida útil, daño)
);

-- Estados del traslado: la máquina de tres pasos que pidió Marco en la reunión
create type estado_traslado as enum (
  'borrador',    -- se está armando
  'autorizado',  -- jefatura dio el visto bueno
  'en_transito', -- salió del origen, aún no llega
  'aceptado',    -- el destino confirmó la recepción
  'anulado'
);

-- Ciclo de vida de la reserva: la solución al problema número uno del negocio
create type estado_reserva as enum (
  'solicitada',
  'activa',
  'en_preparacion',
  'consumida',
  'expirada',
  'liberada'
);

-- Los 18 estados del pedido de la especificación, descompuestos en tres ejes
-- independientes para que no se puedan contradecir entre sí.
create type ciclo_pedido as enum (
  'borrador', 'pendiente_validacion', 'confirmado', 'despachado', 'cerrado', 'cancelado'
);
create type cobertura_pedido as enum (
  'pendiente_stock', 'parcialmente_disponible', 'completo',
  'reservado', 'programado', 'en_preparacion', 'preparado'
);
create type situacion_financiera as enum (
  'sin_facturar', 'bloqueado_credito', 'facturado',
  'parcialmente_cobrado', 'cobrado', 'vencido'
);

create type estado_cotizacion as enum ('borrador', 'enviada', 'aceptada', 'rechazada', 'vencida');
create type estado_embarque   as enum ('planificado', 'confirmado', 'en_preparacion', 'despachado', 'cancelado');
create type estado_packing    as enum ('abierto', 'en_carga', 'cerrado', 'anulado');
create type estado_factura    as enum ('emitida', 'parcialmente_cobrada', 'cobrada', 'vencida', 'anulada');

-- Calidad: cuatro dictámenes independientes, tal como los lleva hoy el Excel
create type tipo_dictamen as enum ('calidad', 'microbiologia', 'camara', 'producto_terminado');
create type estado_dictamen as enum ('liberado', 'observado', 'inmovilizado', 'espera_resultados');

create type severidad_alerta as enum ('info', 'advertencia', 'critica');


-- ============================================================================
--  2. USUARIOS Y SEGURIDAD
-- ============================================================================

-- Cada usuario del ERP se apoya en el sistema de autenticación de Supabase
-- (tabla auth.users) y le agrega los datos del negocio: nombre y rol.
create table usuarios (
  id          uuid primary key references auth.users(id) on delete cascade,
  nombre      text not null check (length(trim(nombre)) > 0),
  email       text not null unique,
  rol         rol_usuario not null default 'consulta',
  -- Si es jefe de almacén, a qué bodega pertenece (se enlaza más abajo)
  almacen_id  bigint,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);
comment on table usuarios is 'Personas que usan el ERP, con su rol. El rol gobierna los permisos en la base de datos.';

-- Función auxiliar: devuelve el rol de quien está haciendo la consulta.
-- Las políticas de seguridad la usan para decidir qué puede ver cada uno.
create or replace function rol_actual() returns rol_usuario
language sql stable security definer set search_path = public as $$
  select rol from usuarios where id = auth.uid();
$$;

-- ¿El usuario actual tiene alguno de estos roles?
create or replace function tiene_rol(variadic roles rol_usuario[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select rol from usuarios where id = auth.uid()) = any(roles), false);
$$;

-- ¿Puede ver costos y márgenes? (el rol 'consulta' y 'almacen' no)
create or replace function puede_ver_costos() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select rol from usuarios where id = auth.uid())
      in ('gerencia','operaciones','comercial'), false);
$$;


-- ============================================================================
--  3. PARÁMETROS CONFIGURABLES
--  Instrucción explícita del cliente: TODO debe ser editable desde la pantalla.
--  Por eso ningún umbral, plazo ni método vive como constante en el código:
--  todos son filas de esta tabla.
-- ============================================================================
create table parametros (
  clave        text primary key,
  valor        text not null,
  tipo_dato    text not null default 'texto' check (tipo_dato in ('texto','numero','booleano','fecha')),
  grupo        text not null default 'general',
  etiqueta     text not null,
  descripcion  text,
  unidad       text,
  editable_por rol_usuario not null default 'gerencia',
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references usuarios(id)
);
comment on table parametros is 'Toda constante del negocio vive aquí para que el cliente la pueda cambiar sin desplegar código.';


-- ============================================================================
--  4. ESTRUCTURA FÍSICA: PLANTAS, ALMACENES Y CÁMARAS
-- ============================================================================

create table plantas (
  id      bigserial primary key,
  codigo  text not null unique,
  nombre  text not null,
  tipo    tipo_proceso not null default 'propia',
  activo  boolean not null default true
);
comment on table plantas is 'Centros productivos. Santa Mónica es propia; el resto son maquilas.';

create table almacenes (
  id            bigserial primary key,
  codigo        text not null unique,
  nombre        text not null,
  tipo          tipo_almacen not null,
  operador      text,               -- quién opera la bodega si es de terceros
  planta_id     bigint references plantas(id),
  capacidad_tm  numeric(12,2) check (capacidad_tm is null or capacidad_tm > 0),
  ciudad        text,
  -- ¿Cuántos despachos simultáneos aguanta? (la reunión: entre 3 y 6 por día)
  despachos_dia_max int not null default 4 check (despachos_dia_max > 0),
  activo        boolean not null default true,
  creado_en     timestamptz not null default now()
);
comment on table almacenes is 'Las 10 bodegas reales: 3 cámaras propias + 7 operadores externos.';

-- Ahora sí podemos enlazar el usuario con su almacén
alter table usuarios
  add constraint usuarios_almacen_fk foreign key (almacen_id) references almacenes(id);

create table camaras (
  id           bigserial primary key,
  almacen_id   bigint not null references almacenes(id) on delete cascade,
  nombre       text not null,
  capacidad_tm numeric(12,2) check (capacidad_tm is null or capacidad_tm > 0),
  activo       boolean not null default true,
  unique (almacen_id, nombre)
);
comment on table camaras is 'Subdivisiones dentro de un almacén (Cámara 01, 02, 03 en Santa Mónica).';

create table lineas_procesadoras (
  id     bigserial primary key,
  nombre text not null unique,
  planta_id bigint references plantas(id),
  activo boolean not null default true
);


-- ============================================================================
--  5. CATÁLOGO DE PRODUCTO
--  Jerarquía real observada en la data:
--    ESPECIE → FORMATO → CORTE → (PRESENTACIÓN) → CLASIFICACIÓN COMERCIAL
--  El SKU vendible es la combinación de un producto con una presentación:
--  el mismo corte a 20 KG y a 22.5 KG son dos líneas de venta distintas.
-- ============================================================================

create table especies (
  id     bigserial primary key,
  nombre text not null unique,      -- POTA, MERLUZA, BONITO, PERICO, JUREL…
  activo boolean not null default true
);

create table formatos (
  id         bigserial primary key,
  especie_id bigint not null references especies(id) on delete cascade,
  nombre     text not null,          -- FILETE, ALETAS, TENTACULO, NUCAS…
  activo     boolean not null default true,
  unique (especie_id, nombre)
);

create table presentaciones (
  id                 bigserial primary key,
  codigo             text not null unique,        -- PLACAS21 KG
  congelamiento      tipo_congelamiento not null,
  peso_bulto_kg      numeric(8,3) not null check (peso_bulto_kg > 0),
  descripcion        text not null,               -- "3 X 7 KG"
  activo             boolean not null default true
);
comment on table presentaciones is 'Cómo viene empacado el producto: tipo de congelamiento y peso por bulto.';

create table skus (
  id                      bigserial primary key,
  codigo                  text not null unique,   -- 01 … 191, como en el Excel
  especie_id              bigint not null references especies(id),
  formato_id              bigint not null references formatos(id),
  corte                   text not null,          -- "L-P" 2000-4000, C/UÑA 500-1000…
  clasificacion_comercial text not null,          -- FILETE FRESCO CP, REJOS, ALAS FRESCAS…
  empaque                 tipo_empaque not null default 'sacos',
  -- Vida útil en meses. Configurable por SKU; por defecto toma el parámetro global.
  vida_util_meses         int check (vida_util_meses is null or vida_util_meses > 0),
  activo                  boolean not null default true,
  creado_en               timestamptz not null default now()
  -- Nota: la clave de negocio es el CODIGO. No se restringe por
  -- (especie, formato, corte) porque el catálogo real distingue además por
  -- tipo de empaque: el mismo corte existe en bloques y en bolsas.
);
comment on table skus is 'Los 191 productos del catálogo, con la misma codificación que usa el Excel actual.';

-- La unidad realmente vendible: producto + presentación
create table sku_presentaciones (
  id               bigserial primary key,
  sku_id           bigint not null references skus(id) on delete cascade,
  presentacion_id  bigint not null references presentaciones(id),
  activo           boolean not null default true,
  unique (sku_id, presentacion_id)
);
comment on table sku_presentaciones is 'Unidad de venta: un SKU en una presentación concreta. Es lo que se cotiza y se despacha.';


-- ============================================================================
--  6. CLIENTES, VENDEDORES Y DESTINOS
-- ============================================================================

create table vendedores (
  id     bigserial primary key,
  nombre text not null unique,
  tipo   tipo_cliente not null default 'intermediario',
  email  text,
  activo boolean not null default true
);
comment on table vendedores is 'Separación vendedor / cliente final que pide la cotización para la facturación consignada.';

create table clientes (
  id             bigserial primary key,
  codigo         text not null unique,
  razon_social   text not null,
  nombre_corto   text,
  tipo           tipo_cliente not null default 'final',
  pais           text,
  ruc_tax_id     text,
  contacto       text,
  email          text,
  telefono       text,
  vendedor_id    bigint references vendedores(id),
  -- Crédito: la reunión confirmó que sí manejan crédito
  moneda         moneda not null default 'USD',
  linea_credito  numeric(14,2) not null default 0 check (linea_credito >= 0),
  dias_credito   int not null default 0 check (dias_credito >= 0),
  bloqueado      boolean not null default false,
  motivo_bloqueo text,
  activo         boolean not null default true,
  creado_en      timestamptz not null default now()
);
comment on table clientes is 'Maestro único de clientes. Un registro por empresa real: se acabaron las 4 grafías de un mismo cliente.';

create table destinos (
  id     bigserial primary key,
  puerto text not null,
  pais   text not null,
  activo boolean not null default true,
  unique (puerto, pais)
);

-- Matriz configurable: qué bodega está habilitada para despachar a qué país.
-- Es una regla real del negocio (certificaciones sanitarias por mercado).
create table almacenes_habilitados (
  almacen_id bigint not null references almacenes(id) on delete cascade,
  pais       text not null,
  habilitado boolean not null default true,
  nota       text,
  primary key (almacen_id, pais)
);
comment on table almacenes_habilitados is 'Restricción de almacén por país de destino. Editable desde Configuración.';


-- ============================================================================
--  7. TRANSPORTE
--  De la reunión: vehículos propios para traslados y venta local; terceros
--  autorizados para puerto. Se controlan SOAT, revisión y licencias.
-- ============================================================================

create table transportistas (
  id           bigserial primary key,
  razon_social text not null unique,
  tipo         tipo_transportista not null default 'tercero',
  ruc          text,
  contacto     text,
  telefono     text,
  activo       boolean not null default true
);

create table vehiculos (
  id                bigserial primary key,
  placa             text not null unique,
  transportista_id  bigint not null references transportistas(id),
  marca             text,
  modelo            text,
  capacidad_tm      numeric(10,2),
  soat_vence        date,
  revision_vence    date,
  activo            boolean not null default true
);
comment on table vehiculos is 'Flota. Las fechas de vencimiento alimentan alertas automáticas.';

create table conductores (
  id               bigserial primary key,
  nombre           text not null,
  dni              text unique,
  licencia         text,
  licencia_vence   date,
  transportista_id bigint references transportistas(id),
  telefono         text,
  activo           boolean not null default true
);


-- ============================================================================
--  8. CATÁLOGOS DE MOTIVOS
--  El Excel tiene 14 motivos de ingreso y 16 de salida. Aquí son editables.
-- ============================================================================
create table motivos (
  id        bigserial primary key,
  ambito    text not null check (ambito in ('ingreso','salida','ajuste','bloqueo','liberacion_reserva')),
  codigo    text not null,
  nombre    text not null,
  -- ¿Esta operación exige que un rol superior la autorice?
  requiere_autorizacion boolean not null default false,
  activo    boolean not null default true,
  unique (ambito, codigo)
);
comment on table motivos is 'Por qué se hizo un movimiento. Tipificado y editable, nunca texto libre.';


-- ============================================================================
--  ÍNDICES de apoyo para las consultas más frecuentes
-- ============================================================================
create index idx_almacenes_activo    on almacenes(activo) where activo;
create index idx_skus_especie        on skus(especie_id);
create index idx_skus_formato        on skus(formato_id);
create index idx_skupres_sku         on sku_presentaciones(sku_id);
create index idx_clientes_activo     on clientes(activo) where activo;
create index idx_clientes_vendedor   on clientes(vendedor_id);
create index idx_camaras_almacen     on camaras(almacen_id);
create index idx_usuarios_rol        on usuarios(rol);
