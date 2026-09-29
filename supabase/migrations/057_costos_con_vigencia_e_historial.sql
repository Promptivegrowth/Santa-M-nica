-- ============================================================================
--  057 · COSTOS CON VIGENCIA, HISTORIAL Y MARGEN BRUTO
-- ============================================================================
--  Documento de mejoras, punto 2.2:
--
--    «Margen bruto = Venta – Costo. El costo deberá ser ingresado
--     obligatoriamente al inicio de cada mes para las compras/ingresos. Luego
--     deberá existir la opción de actualizarlo semanalmente. Cada modificación
--     deberá mantener el registro del costo anterior, nuevo costo, fecha y
--     usuario que realizó el cambio.»
--
--  Y Oliver, sobre cómo se aplica un cambio:
--
--    «Solo que se recalcule de la fecha en los ingresos/compras en adelante;
--     cada vez que se actualice sea solo actualizar en adelante. Ejemplo: si
--     actualizo hoy 28/09, solo corresponde a los costos de los que ingrese a
--     futuro; si luego actualizo el 05/10, igual solo los que corresponden del
--     05/10 en adelante.»
--
--  QUÉ CAMBIA
--  1. Un costo deja de ser «el de un mes» y pasa a ser «el que rige DESDE una
--     fecha». La carga de inicio de mes es una vigencia; cada actualización
--     semanal, otra. El costo en un día cualquiera es la última vigencia que
--     empezó ese día o antes.
--  2. Solo hacia adelante: una vigencia no puede empezar en el pasado, y una
--     que ya empezó no se puede cambiar ni borrar —ya se aplicó a ingresos
--     reales—. Lo impone la base, no la pantalla.
--  3. Cada alta, corrección o baja queda en `costos_historial` con el costo
--     anterior, el nuevo, la fecha y el usuario. El historial no se puede
--     editar.
--  4. El lote toma su costo AL INGRESAR, de la vigencia de ese momento, y lo
--     conserva. Ya no lo teclea Almacén. Como el Kardex es inmutable (002),
--     «solo hacia adelante» es literalmente lo que ocurre: lo que ya entró no
--     se toca.
--  5. El margen bruto se calcula con lo que de verdad se vendió: kilos
--     despachados × precio, menos esos mismos kilos × el costo del lote de
--     donde salieron.
--
--  La tabla sigue llamándose `costos_mensuales` para no romper lo que ya la
--  usa; `anio` y `mes` pasan a ser el mes de la vigencia y se rellenan solos.
-- ============================================================================


-- ============================================================================
--  1. LA VIGENCIA
-- ============================================================================
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'costos_mensuales' and column_name = 'vigente_desde') then
    alter table costos_mensuales add column vigente_desde date;
    update costos_mensuales set vigente_desde = make_date(anio, mes, 1);
    alter table costos_mensuales alter column vigente_desde set not null;
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_name = 'costos_mensuales' and column_name = 'tipo') then
    alter table costos_mensuales add column tipo text not null default 'mensual'
      check (tipo in ('mensual', 'actualizacion'));
  end if;

  --  Antes solo cabía un costo por producto y mes; ahora caben varios en el
  --  mismo mes —la carga y sus actualizaciones—, uno por día.
  if exists (select 1 from pg_constraint where conname = 'costos_mensuales_sku_id_anio_mes_key') then
    alter table costos_mensuales drop constraint costos_mensuales_sku_id_anio_mes_key;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'costos_mensuales_sku_vigencia_key') then
    alter table costos_mensuales add constraint costos_mensuales_sku_vigencia_key unique (sku_id, vigente_desde);
  end if;
end $$;

comment on column costos_mensuales.vigente_desde is
  'Desde qué día rige este costo. Rige hasta que empieza la siguiente vigencia del mismo producto. Nunca puede ser una fecha pasada.';
comment on column costos_mensuales.tipo is
  '«mensual»: la carga obligatoria del mes. «actualizacion»: un ajuste posterior dentro del mes (el documento prevé que sea semanal).';

create index if not exists idx_costos_vigencia on costos_mensuales(sku_id, vigente_desde desc);


-- ============================================================================
--  2. ANIO Y MES SE RELLENAN SOLOS
--  Quedan como el mes de la vigencia, para agrupar. Si alguien inserta con el
--  formato viejo —año y mes sin fecha— la vigencia es el día 1 de ese mes.
--  El nombre empieza por «a_» porque los disparadores BEFORE se ejecutan en
--  orden alfabético y este tiene que ir antes que la regla de fechas.
-- ============================================================================
create or replace function costos_normalizar()
returns trigger language plpgsql as $$
begin
  if new.vigente_desde is null then
    new.vigente_desde := make_date(new.anio, new.mes, 1);
  end if;
  new.anio := extract(year  from new.vigente_desde)::int;
  new.mes  := extract(month from new.vigente_desde)::int;
  return new;
end $$;

drop trigger if exists trg_costos_a_normalizar on costos_mensuales;
create trigger trg_costos_a_normalizar
  before insert or update on costos_mensuales
  for each row execute function costos_normalizar();


-- ============================================================================
--  3. SOLO HACIA ADELANTE
--  La regla de Oliver, en la base. `app.costos_carga_historica` existe solo
--  para las migraciones y los datos de demostración, que sí tienen que poder
--  sembrar meses pasados; no se puede activar desde la aplicación.
-- ============================================================================
create or replace function costos_solo_hacia_adelante()
returns trigger language plpgsql as $$
declare
  v_hoy date := (now() at time zone 'America/Lima')::date;
begin
  if coalesce(current_setting('app.costos_carga_historica', true), '') = 'si' then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    if new.vigente_desde < v_hoy then
      raise exception 'Un costo no se puede cargar con fecha pasada (%). Rige desde hoy o desde una fecha futura: lo que ya ingresó conserva el costo con el que entró.',
        to_char(new.vigente_desde, 'DD/MM/YYYY');
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    --  Una escritura que no cambia nada no molesta a nadie.
    if (old.vigente_desde, old.tipo, old.materia_prima_kg, old.conversion_kg, old.variable_kg)
       is not distinct from
       (new.vigente_desde, new.tipo, new.materia_prima_kg, new.conversion_kg, new.variable_kg) then
      return new;
    end if;
    if old.vigente_desde < v_hoy then
      raise exception 'Este costo rige desde el % y ya se aplicó a los ingresos de esos días, así que no se puede modificar. Registre una actualización con fecha de hoy.',
        to_char(old.vigente_desde, 'DD/MM/YYYY');
    end if;
    if new.vigente_desde < v_hoy then
      raise exception 'Un costo no se puede mover a una fecha pasada (%).', to_char(new.vigente_desde, 'DD/MM/YYYY');
    end if;
    return new;
  end if;

  --  DELETE
  if old.vigente_desde < v_hoy then
    raise exception 'Este costo rige desde el % y ya se aplicó a ingresos reales: no se puede borrar. Si hay que cambiarlo, registre una actualización con fecha de hoy.',
      to_char(old.vigente_desde, 'DD/MM/YYYY');
  end if;
  return old;
end $$;

drop trigger if exists trg_costos_b_adelante on costos_mensuales;
create trigger trg_costos_b_adelante
  before insert or update or delete on costos_mensuales
  for each row execute function costos_solo_hacia_adelante();


-- ============================================================================
--  4. EL HISTORIAL
--  «Costo anterior, nuevo costo, fecha y usuario». Se guardan los tres
--  componentes y el total, antes y después, porque «el costo subió» no dice
--  si fue la materia prima o la planilla.
-- ============================================================================
create table if not exists costos_historial (
  id                   bigserial primary key,
  costo_id             bigint,                       -- sin FK: la vigencia puede borrarse
  sku_id               bigint not null references skus(id) on delete cascade,
  vigente_desde        date not null,
  tipo                 text not null,
  accion               text not null check (accion in ('alta', 'correccion', 'baja')),

  materia_prima_antes  numeric(14,4),
  conversion_antes     numeric(14,4),
  variable_antes       numeric(14,4),
  total_antes          numeric(14,4),

  materia_prima_nuevo  numeric(14,4),
  conversion_nuevo     numeric(14,4),
  variable_nuevo       numeric(14,4),
  total_nuevo          numeric(14,4),

  usuario_id           uuid references usuarios(id),
  usuario_nombre       text,
  registrado_en        timestamptz not null default now(),
  observaciones        text
);

comment on table costos_historial is
  'Cada alta, corrección o baja de un costo de producción, con el valor anterior, el nuevo, la fecha y el usuario. Inmutable: lo escribe solo el disparador de costos_mensuales.';
comment on column costos_historial.total_antes is
  'En un alta, el costo que regía justo antes de esta vigencia; en una corrección o baja, el valor que tenía la propia vigencia.';

create index if not exists idx_costos_hist_sku on costos_historial(sku_id, registrado_en desc);
create index if not exists idx_costos_hist_fecha on costos_historial(registrado_en desc);

alter table costos_historial enable row level security;
drop policy if exists "lectura_costos_historial" on costos_historial;
create policy "lectura_costos_historial" on costos_historial
  for select to authenticated
  using ( puede('gerencia', 'operaciones', 'comercial') );
--  Sin políticas de escritura: nadie escribe aquí directamente.

create or replace function costos_historial_inmutable()
returns trigger language plpgsql as $$
begin
  --  El mismo interruptor de mantenimiento que las migraciones: lo usan las
  --  pruebas automáticas para no dejar su rastro en el historial real. Desde
  --  la aplicación no se puede activar.
  if coalesce(current_setting('app.costos_carga_historica', true), '') = 'si' then
    return old;
  end if;
  raise exception 'El historial de costos no se puede modificar ni borrar.';
end $$;

drop trigger if exists trg_costos_historial_inmutable on costos_historial;
create trigger trg_costos_historial_inmutable
  before update or delete on costos_historial
  for each row execute function costos_historial_inmutable();

create or replace function costos_registrar_historial()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_usuario uuid;
  v_nombre  text;
  v_prev    costos_mensuales%rowtype;
begin
  v_usuario := coalesce(auth.uid(), case when tg_op = 'DELETE' then old.registrado_por else new.registrado_por end);
  select nombre into v_nombre from usuarios where id = v_usuario;

  if tg_op = 'INSERT' then
    --  El «anterior» de un alta es lo que regía justo antes.
    select * into v_prev from costos_mensuales
     where sku_id = new.sku_id and vigente_desde < new.vigente_desde
     order by vigente_desde desc limit 1;
    insert into costos_historial (costo_id, sku_id, vigente_desde, tipo, accion,
      materia_prima_antes, conversion_antes, variable_antes, total_antes,
      materia_prima_nuevo, conversion_nuevo, variable_nuevo, total_nuevo,
      usuario_id, usuario_nombre, observaciones)
    values (new.id, new.sku_id, new.vigente_desde, new.tipo, 'alta',
      v_prev.materia_prima_kg, v_prev.conversion_kg, v_prev.variable_kg, v_prev.total_kg,
      new.materia_prima_kg, new.conversion_kg, new.variable_kg, new.total_kg,
      v_usuario, v_nombre, new.observaciones);
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if (old.materia_prima_kg, old.conversion_kg, old.variable_kg, old.vigente_desde)
       is not distinct from (new.materia_prima_kg, new.conversion_kg, new.variable_kg, new.vigente_desde) then
      return new;
    end if;
    insert into costos_historial (costo_id, sku_id, vigente_desde, tipo, accion,
      materia_prima_antes, conversion_antes, variable_antes, total_antes,
      materia_prima_nuevo, conversion_nuevo, variable_nuevo, total_nuevo,
      usuario_id, usuario_nombre, observaciones)
    values (new.id, new.sku_id, new.vigente_desde, new.tipo, 'correccion',
      old.materia_prima_kg, old.conversion_kg, old.variable_kg, old.total_kg,
      new.materia_prima_kg, new.conversion_kg, new.variable_kg, new.total_kg,
      v_usuario, v_nombre, new.observaciones);
    return new;
  end if;

  insert into costos_historial (costo_id, sku_id, vigente_desde, tipo, accion,
    materia_prima_antes, conversion_antes, variable_antes, total_antes,
    usuario_id, usuario_nombre)
  values (old.id, old.sku_id, old.vigente_desde, old.tipo, 'baja',
    old.materia_prima_kg, old.conversion_kg, old.variable_kg, old.total_kg,
    v_usuario, v_nombre);
  return old;
end $$;

drop trigger if exists trg_costos_historial on costos_mensuales;
create trigger trg_costos_historial
  after insert or update or delete on costos_mensuales
  for each row execute function costos_registrar_historial();

--  El historial de lo que ya había, para que la pantalla no empiece en blanco:
--  cada carga, con la anterior de ese producto como «antes».
insert into costos_historial (costo_id, sku_id, vigente_desde, tipo, accion,
  materia_prima_antes, conversion_antes, variable_antes, total_antes,
  materia_prima_nuevo, conversion_nuevo, variable_nuevo, total_nuevo,
  usuario_id, usuario_nombre, registrado_en, observaciones)
select c.id, c.sku_id, c.vigente_desde, c.tipo, 'alta',
       lag(c.materia_prima_kg) over w, lag(c.conversion_kg) over w,
       lag(c.variable_kg) over w, lag(c.total_kg) over w,
       c.materia_prima_kg, c.conversion_kg, c.variable_kg, c.total_kg,
       c.registrado_por, u.nombre, c.creado_en, c.observaciones
  from costos_mensuales c
  left join usuarios u on u.id = c.registrado_por
 where not exists (select 1 from costos_historial h where h.costo_id = c.id)
window w as (partition by c.sku_id order by c.vigente_desde);


-- ============================================================================
--  5. DATOS DE DEMOSTRACIÓN · actualizaciones a mitad de mes
--  Para que la pantalla enseñe cómo se ve una actualización semanal: a diez
--  productos les subió la materia prima un 3 % el día 15 de este mes. Solo si
--  ese día ya pasó y todavía no hay ninguna actualización.
-- ============================================================================
do $$
declare v_dia date := date_trunc('month', now() at time zone 'America/Lima')::date + 14;
begin
  if v_dia <= (now() at time zone 'America/Lima')::date
     and not exists (select 1 from costos_mensuales where tipo = 'actualizacion') then
    perform set_config('app.costos_carga_historica', 'si', true);
    insert into costos_mensuales (sku_id, anio, mes, vigente_desde, tipo,
      materia_prima_kg, conversion_kg, variable_kg, registrado_por, observaciones)
    select c.sku_id, extract(year from v_dia), extract(month from v_dia), v_dia, 'actualizacion',
           round(c.materia_prima_kg * 1.03, 4), c.conversion_kg, c.variable_kg, c.registrado_por,
           'Subió la materia prima: precio de playa de la segunda quincena'
      from costos_mensuales c
     where c.vigente_desde = date_trunc('month', v_dia)::date
       and c.sku_id in (select id from skus where activo order by id limit 10);
    perform set_config('app.costos_carga_historica', '', true);
  end if;
end $$;


-- ============================================================================
--  6. EL COSTO QUE RIGE EN UNA FECHA
-- ============================================================================
create or replace function costo_produccion_kg(p_sku_id bigint, p_fecha date)
returns numeric
language sql stable parallel safe as $$
  select c.total_kg
    from costos_mensuales c
   where c.sku_id = p_sku_id
     and c.vigente_desde <= p_fecha
   order by c.vigente_desde desc
   limit 1;
$$;

comment on function costo_produccion_kg is
  'Costo total por kilo que rige para un producto en una fecha: la última vigencia que empezó ese día o antes. NULL si nunca se cargó, que es lo correcto: un cero daría un margen del 100 %.';

--  El costo que regía en una fecha para TODOS los productos, una fila por
--  producto. Lo usa la pantalla de costos: traer todas las vigencias y
--  quedarse con la última en el navegador pasaría del tope de mil filas de la
--  API en cuanto haya seis meses de historia. SECURITY INVOKER: quien no puede
--  leer costos no recibe nada.
create or replace function costos_vigentes_al(p_fecha date)
returns setof costos_mensuales
language sql stable security invoker as $$
  select distinct on (c.sku_id) c.*
    from costos_mensuales c
   where c.vigente_desde <= p_fecha
   order by c.sku_id, c.vigente_desde desc;
$$;

--  El margen de contribución (033) busca el costo con la misma regla: la
--  vigencia del día del pedido, no la del mes entero. Mismas columnas.
create or replace view v_margen_contribucion as
select
  pl.id                          as pedido_linea_id,
  p.id                           as pedido_id,
  p.numero_proforma,
  p.cliente_id,
  cl.razon_social                as cliente,
  p.fecha_solicitada,
  p.ciclo,
  s.id                           as sku_id,
  s.codigo                       as sku,
  s.corte,
  s.clasificacion_comercial      as familia,
  pl.cantidad_tm,
  a_dolares(pl.precio_tm * (1 - pl.descuento_pct / 100), p.moneda, p.tipo_cambio) as precio_tm,
  cm.materia_prima_kg * 1000     as materia_prima_tm,
  cm.conversion_kg    * 1000     as conversion_tm,
  cm.variable_kg      * 1000     as variable_tm,
  cm.total_kg         * 1000     as costo_produccion_tm,
  cm.anio                        as costo_anio,
  cm.mes                         as costo_mes,
  a_dolares(pl.precio_tm * (1 - pl.descuento_pct / 100), p.moneda, p.tipo_cambio)
    - cm.total_kg * 1000         as margen_tm,
  (a_dolares(pl.precio_tm * (1 - pl.descuento_pct / 100), p.moneda, p.tipo_cambio)
    - cm.total_kg * 1000) * pl.cantidad_tm as margen_linea,
  case
    when a_dolares(pl.precio_tm * (1 - pl.descuento_pct / 100), p.moneda, p.tipo_cambio) > 0
     and cm.total_kg is not null
    then round(
      100 * (a_dolares(pl.precio_tm * (1 - pl.descuento_pct / 100), p.moneda, p.tipo_cambio)
             - cm.total_kg * 1000)
      / a_dolares(pl.precio_tm * (1 - pl.descuento_pct / 100), p.moneda, p.tipo_cambio), 2)
    else null
  end                            as margen_pct,
  (cm.total_kg is null)          as sin_costo
from pedido_lineas pl
join pedidos p  on p.id = pl.pedido_id
join clientes cl on cl.id = p.cliente_id
join sku_presentaciones sp on sp.id = pl.sku_presentacion_id
join skus s on s.id = sp.sku_id
left join lateral (
  select c.total_kg, c.materia_prima_kg, c.conversion_kg, c.variable_kg, c.anio, c.mes
    from costos_mensuales c
   where c.sku_id = s.id
     and c.vigente_desde <= p.fecha_solicitada
   order by c.vigente_desde desc
   limit 1
) cm on true;


-- ============================================================================
--  7. EL LOTE TOMA SU COSTO AL INGRESAR
-- ============================================================================
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'lotes' and column_name = 'costo_origen') then
    alter table lotes add column costo_origen text not null default 'manual'
      check (costo_origen in ('estandar', 'manual'));
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_name = 'lotes' and column_name = 'costo_vigencia_id') then
    alter table lotes add column costo_vigencia_id bigint references costos_mensuales(id) on delete set null;
  end if;
end $$;

comment on column lotes.costo_origen is
  '«estandar»: el costo lo puso el sistema, de la vigencia que regía al ingresar. «manual»: se tecleó porque el producto no tenía costo cargado (o el lote es anterior a esta regla).';
comment on column lotes.costo_vigencia_id is 'La vigencia de costos_mensuales de la que salió el costo del lote.';

insert into parametros (clave, valor, tipo_dato, grupo, etiqueta, descripcion, unidad, editable_por)
values ('costos_exigir_carga_mensual', 'no', 'texto', 'inventario',
        'Exigir el costo del mes para ingresar',
        'Con «si», no se puede registrar el ingreso de un producto que no tenga cargado el costo del mes en curso. Con «no», el ingreso se registra con el último costo vigente y el aviso de costos sin cargar sigue saltando. Se deja en «no» para no parar la planta por un dato administrativo.',
        'si / no', 'gerencia')
on conflict (clave) do nothing;

create or replace function lotes_costo_de_ingreso()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_hoy   date := (now() at time zone 'America/Lima')::date;
  v_sku   bigint;
  v_id    bigint;
  v_total numeric;
begin
  if coalesce(current_setting('app.costos_carga_historica', true), '') = 'si' then
    return new;
  end if;

  select sku_id into v_sku from sku_presentaciones where id = new.sku_presentacion_id;

  if param_txt('costos_exigir_carga_mensual', 'no') = 'si'
     and not exists (select 1 from costos_mensuales
                      where sku_id = v_sku and tipo = 'mensual'
                        and vigente_desde between date_trunc('month', v_hoy)::date and v_hoy) then
    raise exception 'Este producto no tiene cargado el costo de %. Gerencia tiene que cargarlo antes de registrar el ingreso.',
      to_char(v_hoy, 'MM/YYYY');
  end if;

  select id, total_kg into v_id, v_total
    from costos_mensuales
   where sku_id = v_sku and vigente_desde <= v_hoy
   order by vigente_desde desc limit 1;

  if v_id is not null and v_total > 0 then
    new.costo_unitario    := v_total;
    new.costo_origen      := 'estandar';
    new.costo_vigencia_id := v_id;
  else
    new.costo_origen := 'manual';
  end if;
  return new;
end $$;

comment on function lotes_costo_de_ingreso is
  'Al nacer un lote le pone el costo de la vigencia que rige ese día. Es SECURITY DEFINER porque quien registra el ingreso —Almacén— no puede leer los costos, y aun así su pallet tiene que llevar el correcto.';

drop trigger if exists trg_lotes_costo_de_ingreso on lotes;
create trigger trg_lotes_costo_de_ingreso
  before insert on lotes
  for each row execute function lotes_costo_de_ingreso();

--  Para el formulario de ingreso: qué costo se va a aplicar. Almacén no lee
--  la tabla de costos, así que se le da solo esto, y solo de un producto.
create or replace function costo_vigente_ingreso(p_sku_presentacion_id bigint)
returns table (total_kg numeric, vigente_desde date, tipo text)
language sql stable security definer set search_path = public as $$
  select c.total_kg, c.vigente_desde, c.tipo
    from costos_mensuales c
    join sku_presentaciones sp on sp.sku_id = c.sku_id
   where sp.id = p_sku_presentacion_id
     and c.vigente_desde <= (now() at time zone 'America/Lima')::date
     --  SECURITY DEFINER se salta la política de lectura de costos, así que
     --  el filtro de quién puede verlo tiene que ir aquí: quien registra
     --  ingresos y quien ya ve costos. A cualquier otro, nada.
     and puede('gerencia', 'operaciones', 'comercial', 'almacen')
   order by c.vigente_desde desc
   limit 1;
$$;


-- ============================================================================
--  8. LA CARGA OBLIGATORIA DEL MES
-- ============================================================================
drop view if exists v_costos_carga_mes;
create view v_costos_carga_mes with (security_invoker = true) as
with hoy as (select (now() at time zone 'America/Lima')::date as d)
select
  s.id                                                       as sku_id,
  s.codigo,
  exists (select 1 from costos_mensuales c, hoy
           where c.sku_id = s.id and c.tipo = 'mensual'
             and c.vigente_desde between date_trunc('month', hoy.d)::date and hoy.d) as cargado,
  v.vigente_desde,
  v.tipo,
  v.total_kg
from skus s
left join lateral (
  select c.vigente_desde, c.tipo, c.total_kg from costos_mensuales c, hoy
   where c.sku_id = s.id and c.vigente_desde <= hoy.d
   order by c.vigente_desde desc limit 1
) v on true
where s.activo;

comment on view v_costos_carga_mes is
  'Por producto activo: si ya tiene la carga obligatoria del mes en curso, y qué costo rige hoy.';

create or replace function costos_avisar_carga_mensual()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_hoy date := (now() at time zone 'America/Lima')::date;
  v_faltan int; v_total int;
begin
  select count(*) filter (where not exists (
           select 1 from costos_mensuales c
            where c.sku_id = s.id and c.tipo = 'mensual'
              and c.vigente_desde between date_trunc('month', v_hoy)::date and v_hoy)),
         count(*)
    into v_faltan, v_total
    from skus s where s.activo;

  if v_faltan = 0 then
    update alertas set atendida = true, atendida_en = now()
     where titulo = 'Costos del mes sin cargar' and not atendida;
    return 0;
  end if;

  perform alerta_resumen('costos_mensuales', 'Costos del mes sin cargar', 'critica',
    format('%s de %s productos no tienen el costo de %s. Sus ingresos se valorizan con el último costo vigente y el margen bruto del mes sale con costos viejos.',
           v_faltan, v_total, to_char(v_hoy, 'MM/YYYY')));
  return v_faltan;
end $$;

select costos_avisar_carga_mensual();

do $$
begin
  perform cron.unschedule('avisar_costos_del_mes')
    where exists (select 1 from cron.job where jobname = 'avisar_costos_del_mes');
  perform cron.schedule('avisar_costos_del_mes', '35 11 * * *', 'select costos_avisar_carga_mensual()');
end $$;


-- ============================================================================
--  9. EL MARGEN BRUTO
--  Venta − costo, sobre lo que de verdad salió: cada línea de packing
--  despachada, con el precio de su línea de pedido y el costo del lote del
--  que salió. En dólares. El mes es el de la salida, en hora de Lima.
-- ============================================================================
drop view if exists v_margen_bruto_mensual;
drop view if exists v_margen_bruto_pedido;
drop view if exists v_margen_bruto_linea;

create view v_margen_bruto_linea as
select
  pkl.id                                                        as packing_linea_id,
  pk.id                                                         as packing_list_id,
  d.id                                                          as despacho_id,
  (d.fecha_salida at time zone 'America/Lima')::date            as fecha_salida,
  date_trunc('month', d.fecha_salida at time zone 'America/Lima')::date as mes,
  p.id                                                          as pedido_id,
  p.numero_proforma,
  p.cliente_id,
  coalesce(c.nombre_corto, c.razon_social)                      as cliente,
  s.id                                                          as sku_id,
  s.codigo                                                      as sku,
  case when esp.nombre = 'POTA' then f.nombre
       else f.nombre || ' (' || lower(esp.nombre) || ')' end    as familia,
  l.id                                                          as lote_id,
  l.codigo_pallet,
  l.costo_origen,
  pkl.peso_neto_kg                                              as kg,
  a_dolares(pl.precio_tm * (1 - pl.descuento_pct / 100), p.moneda, p.tipo_cambio) as precio_tm,
  a_dolares(pl.precio_tm * (1 - pl.descuento_pct / 100), p.moneda, p.tipo_cambio)
    * pkl.peso_neto_kg / 1000                                   as venta,
  l.costo_unitario                                              as costo_kg,
  l.costo_unitario * pkl.peso_neto_kg                           as costo,
  a_dolares(pl.precio_tm * (1 - pl.descuento_pct / 100), p.moneda, p.tipo_cambio)
    * pkl.peso_neto_kg / 1000 - l.costo_unitario * pkl.peso_neto_kg as margen,
  (l.costo_unitario <= 0)                                       as sin_costo
from packing_lineas pkl
join packing_lists pk      on pk.id = pkl.packing_list_id and pk.estado <> 'anulado'
join despachos d           on d.packing_list_id = pk.id
join pedido_lineas pl      on pl.id = pkl.pedido_linea_id
join pedidos p             on p.id = pl.pedido_id
join clientes c            on c.id = p.cliente_id
join lotes l               on l.id = pkl.lote_id
join sku_presentaciones sp on sp.id = l.sku_presentacion_id
join skus s                on s.id = sp.sku_id
join especies esp          on esp.id = s.especie_id
join formatos f            on f.id = s.formato_id;

comment on view v_margen_bruto_linea is
  'Margen bruto por línea despachada: kilos × precio de su línea de pedido (US$) menos kilos × costo del lote del que salieron. El costo del lote es el que regía cuando ingresó.';

create view v_margen_bruto_pedido as
select
  pedido_id, numero_proforma, cliente_id, cliente,
  sum(kg)                                                       as kg,
  sum(venta)                                                    as venta,
  sum(costo)                                                    as costo,
  sum(margen)                                                   as margen,
  case when sum(venta) > 0 then round(sum(margen) / sum(venta) * 100, 2) end as margen_pct,
  min(fecha_salida)                                             as primera_salida,
  max(fecha_salida)                                             as ultima_salida,
  count(*) filter (where sin_costo)                             as lineas_sin_costo
from v_margen_bruto_linea
group by pedido_id, numero_proforma, cliente_id, cliente;

create view v_margen_bruto_mensual as
select
  mes,
  to_char(mes, 'YYYY-MM')                                       as clave,
  count(distinct pedido_id)                                     as pedidos,
  sum(kg)                                                       as kg,
  sum(venta)                                                    as venta,
  sum(costo)                                                    as costo,
  sum(margen)                                                   as margen,
  case when sum(venta) > 0 then round(sum(margen) / sum(venta) * 100, 2) end as margen_pct,
  count(*) filter (where sin_costo)                             as lineas_sin_costo
from v_margen_bruto_linea
group by mes;

comment on view v_margen_bruto_mensual is 'Margen bruto por mes de salida: venta, costo y margen en US$.';


-- ============================================================================
--  10. QUIÉN PUEDE LLAMAR A ESTAS FUNCIONES
--  Supabase da permiso de ejecución a `anon` —cualquiera con la clave pública,
--  sin iniciar sesión— sobre toda función nueva. Para estas no tiene sentido:
--  una devuelve costos y las demás regeneran avisos. Solo usuarios con sesión.
-- ============================================================================
do $$
declare f text;
begin
  foreach f in array array[
    'costo_vigente_ingreso(bigint)',
    'costos_vigentes_al(date)',
    'costos_avisar_carga_mensual()',
    'stock_avisar_condicion()',
    'demora_avisar()',
    'cobertura_avisar_baja()'
  ] loop
    if to_regprocedure(f) is not null then
      execute format('revoke all on function %s from public, anon', f);
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;
end $$;
