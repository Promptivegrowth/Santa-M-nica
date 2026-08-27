-- ============================================================================
--  015 · CONTACTOS DEL CLIENTE Y CUENTAS BANCARIAS
-- ============================================================================
--  Dos cosas que faltaban en la cotización y que el cliente pidió.
--
--  CONTACTOS
--  Hasta ahora el cliente tenía UN contacto, guardado como tres campos sueltos
--  en su propia fila. Eso no aguanta la realidad: en una empresa importadora
--  se habla con el jefe de compras para negociar, con logística para coordinar
--  el embarque y con el área contable para cobrar. Son tres personas, con
--  cargo, teléfono y correo distintos, y la cotización va dirigida a UNA de
--  ellas.
--
--  CUENTAS BANCARIAS
--  Son las de Santa Mónica, no las del cliente: es donde le dicen que pague.
--  Van en la cotización y en la proforma porque es ahí donde el comprador las
--  busca. Se incluye la CUENTA DE DETRACCIÓN, que en Perú es una cuenta del
--  vendedor en el Banco de la Nación a la que el comprador deposita un
--  porcentaje del pago; sin ese número, el cliente nacional no puede cumplir
--  con el régimen y la operación se traba.
--
--  NADA DE ESTO ES OBLIGATORIO
--  Ni el contacto ni las cuentas bloquean guardar una cotización. Se pidió
--  así, y tiene sentido: una oferta rápida por teléfono no debería quedarse
--  sin registrar porque falte el correo de alguien.
-- ============================================================================

/* ---------------------------------------------------------------------------
   Tipos
   --------------------------------------------------------------------------- */
do $$
begin
  if not exists (select 1 from pg_type where typname = 'tipo_cuenta') then
    create type tipo_cuenta as enum ('corriente', 'ahorros', 'detraccion');
  end if;
end $$;

/* ---------------------------------------------------------------------------
   CONTACTOS · las personas con las que se habla en cada cliente
   --------------------------------------------------------------------------- */
create table if not exists contactos (
  id          bigserial primary key,
  cliente_id  bigint not null references clientes(id) on delete cascade,
  nombre      text not null,
  cargo       text,
  telefono    text,
  email       text,
  -- El que se propone por defecto al cotizar a este cliente.
  principal   boolean not null default false,
  activo      boolean not null default true,
  observaciones text,
  creado_en   timestamptz not null default now(),
  creado_por  uuid references usuarios(id),

  constraint contacto_con_nombre check (length(trim(nombre)) > 0)
);

create index if not exists idx_contactos_cliente on contactos (cliente_id) where activo;

-- Un solo contacto principal por cliente. Si hubiera dos, «el principal» no
-- significaría nada y el formulario tendría que elegir al azar.
create unique index if not exists idx_contacto_principal_unico
  on contactos (cliente_id) where principal and activo;

/* ---------------------------------------------------------------------------
   CUENTAS BANCARIAS · las de la empresa, donde el cliente paga
   --------------------------------------------------------------------------- */
create table if not exists cuentas_bancarias (
  id          bigserial primary key,
  banco       text not null,
  tipo        tipo_cuenta not null default 'corriente',
  moneda      moneda not null default 'USD',
  numero      text not null,
  -- Código de Cuenta Interbancario: hace falta para transferencias entre
  -- bancos distintos dentro de Perú.
  cci         text,
  -- Para las transferencias desde el exterior, que es como cobra el 98 % de
  -- lo que factura esta empresa.
  swift       text,
  titular     text,
  principal   boolean not null default false,
  activo      boolean not null default true,
  observaciones text,
  creado_en   timestamptz not null default now(),

  constraint cuenta_con_numero check (length(trim(numero)) > 0),
  -- La detracción es siempre en soles y siempre en el Banco de la Nación:
  -- una detracción en dólares no existe.
  constraint detraccion_en_soles check (tipo <> 'detraccion' or moneda = 'PEN')
);

create index if not exists idx_cuentas_activas on cuentas_bancarias (tipo) where activo;

/* ---------------------------------------------------------------------------
   Enganche con la cotización y el pedido
   ---------------------------------------------------------------------------
   El contacto se guarda por partida doble: la referencia al maestro y una
   COPIA de sus datos. Suena redundante y no lo es:

     · la referencia permite saber a quién se le mandó y actualizar sus datos;
     · la copia mantiene el documento igual que el día que se emitió, aunque
       después esa persona cambie de cargo o se vaya de la empresa.

   Y además la copia es lo que permite escribir un contacto suelto en la
   cotización sin tener que darlo de alta en el maestro, que fue justo lo que
   se pidió.
   --------------------------------------------------------------------------- */
alter table cotizaciones
  add column if not exists contacto_id       bigint references contactos(id) on delete set null,
  add column if not exists contacto_nombre   text,
  add column if not exists contacto_cargo    text,
  add column if not exists contacto_telefono text,
  add column if not exists contacto_email    text;

alter table pedidos
  add column if not exists contacto_id       bigint references contactos(id) on delete set null,
  add column if not exists contacto_nombre   text,
  add column if not exists contacto_cargo    text,
  add column if not exists contacto_telefono text,
  add column if not exists contacto_email    text;

/* ---------------------------------------------------------------------------
   Qué cuentas se muestran en cada documento
   ---------------------------------------------------------------------------
   Muchas a muchas: una cotización puede llevar la cuenta en dólares y la de
   detracción, y otra solo la de soles. Se guarda la relación y no una copia
   porque un número de cuenta no cambia; si la cuenta se da de baja, el
   documento antiguo la sigue mostrando, que es lo correcto.
   --------------------------------------------------------------------------- */
create table if not exists cotizacion_cuentas (
  cotizacion_id bigint not null references cotizaciones(id) on delete cascade,
  cuenta_id     bigint not null references cuentas_bancarias(id) on delete cascade,
  primary key (cotizacion_id, cuenta_id)
);

create table if not exists pedido_cuentas (
  pedido_id bigint not null references pedidos(id) on delete cascade,
  cuenta_id bigint not null references cuentas_bancarias(id) on delete cascade,
  primary key (pedido_id, cuenta_id)
);

/* ---------------------------------------------------------------------------
   Seguridad
   ---------------------------------------------------------------------------
   Se sigue el mismo patrón del resto del sistema: lee cualquier usuario
   activo, escribe quien tiene el permiso comercial. Las cuentas bancarias las
   toca solo gerencia u operaciones: cambiar un número de cuenta en una
   cotización es la forma más barata que existe de desviar un cobro.
   --------------------------------------------------------------------------- */
alter table contactos          enable row level security;
alter table cuentas_bancarias  enable row level security;
alter table cotizacion_cuentas enable row level security;
alter table pedido_cuentas     enable row level security;

drop policy if exists contactos_lectura on contactos;
create policy contactos_lectura on contactos
  for select using (es_usuario_activo());

drop policy if exists contactos_escritura on contactos;
create policy contactos_escritura on contactos
  for all using (puede('gerencia','operaciones','comercial','comex'))
  with check (puede('gerencia','operaciones','comercial','comex'));

drop policy if exists cuentas_lectura on cuentas_bancarias;
create policy cuentas_lectura on cuentas_bancarias
  for select using (es_usuario_activo());

drop policy if exists cuentas_escritura on cuentas_bancarias;
create policy cuentas_escritura on cuentas_bancarias
  for all using (puede('gerencia','operaciones'))
  with check (puede('gerencia','operaciones'));

drop policy if exists cot_cuentas_lectura on cotizacion_cuentas;
create policy cot_cuentas_lectura on cotizacion_cuentas
  for select using (es_usuario_activo());

drop policy if exists cot_cuentas_escritura on cotizacion_cuentas;
create policy cot_cuentas_escritura on cotizacion_cuentas
  for all using (puede('gerencia','operaciones','comercial','comex'))
  with check (puede('gerencia','operaciones','comercial','comex'));

drop policy if exists ped_cuentas_lectura on pedido_cuentas;
create policy ped_cuentas_lectura on pedido_cuentas
  for select using (es_usuario_activo());

drop policy if exists ped_cuentas_escritura on pedido_cuentas;
create policy ped_cuentas_escritura on pedido_cuentas
  for all using (puede('gerencia','operaciones','comercial','comex'))
  with check (puede('gerencia','operaciones','comercial','comex'));

comment on table contactos is
  'Personas de contacto de cada cliente. La cotización se dirige a una de ellas y guarda copia de sus datos.';
comment on table cuentas_bancarias is
  'Cuentas de cobro de Santa Mónica, incluida la de detracción del Banco de la Nación. Se imprimen en la cotización y en la proforma.';
