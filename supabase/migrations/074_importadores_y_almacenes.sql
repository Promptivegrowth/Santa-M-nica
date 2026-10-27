-- ============================================================================
--  074 · IMPORTAR INGRESOS Y TRASLADOS DESDE EXCEL · QUÉ ALMACÉN RECIBE QUÉ
-- ============================================================================
--  Reunión con Oliver Tello (jefe de Operaciones), octubre de 2026:
--
--    «No queremos hacer un retrabajo estar llenando por formulario.»
--
--  Su equipo ya tiene en Excel la lista de lo que entra a cámara y de lo que
--  se traslada. Desde esta versión el sistema les da una plantilla, la suben,
--  se revisa fila por fila con las MISMAS reglas del formulario manual y se
--  registra lo que está bien. Esta migración pone en la base lo que eso
--  necesita:
--
--   1. QUÉ ALMACÉN RECIBE QUÉ. La producción entra solo por las cámaras de
--      Santa Mónica, Freeko y (en menor medida) Hayduk; las compras, solo por
--      dos almacenes (Elamar y Perufrost en el sistema). Depsa, Coinrefri y
--      Emergent Cold son almacenamiento externo: les llega stock por
--      traslado, nunca por ingreso. Cada almacén lleva dos casillas que lo
--      dicen, editables por Gerencia y Operaciones en Configuración ›
--      Maestros › Almacenes, y la base rechaza un ingreso que no cuadre.
--
--   2. LAS IMPORTACIONES (tabla importaciones_excel; «importaciones», de 003,
--      es otra cosa: la carga de datos de aduanas, y no se toca). Cada archivo subido queda guardado con quién lo
--      subió, cuándo, cada fila tal como venía, sus errores y lo que pasó con
--      ella (registrada, programada, descartada…), para poder volver a verla.
--
--   3. LOS INGRESOS PROGRAMADOS. Lo que todavía no llega pero ya se sabe que
--      va a llegar. No mueve stock: es un aviso con todos los datos del
--      pallet, que se confirma al llegar (y entonces sí nace el lote) o se
--      anula.
--
--  Lo pueden hacer TODOS los que hoy registran ingresos (Gerencia,
--  Operaciones y Almacén), sin una aprobación aparte: Oliver pidió
--  expresamente no depender de una sola persona.
--
--  Re-ejecutable: columnas e índices con «if not exists», funciones con
--  «create or replace», disparadores y políticas se borran y se vuelven a
--  crear. Los valores iniciales de las casillas SOLO se ponen la primera vez,
--  para no pisar lo que después se cambie desde Configuración.
-- ============================================================================


-- ----------------------------------------------------------------------------
--  1 · QUÉ ALMACÉN RECIBE INGRESOS DE PRODUCCIÓN Y DE COMPRAS
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'almacenes' and column_name = 'recibe_produccion') then
    alter table almacenes
      add column recibe_produccion boolean not null default false,
      add column recibe_compras    boolean not null default false;

    --  Valores iniciales, según lo que dijo Oliver. Por código, que es fijo.
    update almacenes set recibe_produccion = true
     where codigo in ('STM-C1', 'STM-C2', 'STM-C3', 'FREEKO', 'HAYDUK');
    update almacenes set recibe_compras = true
     where codigo in ('ELAMAR', 'PERUFR');
  end if;
end $$;

comment on column almacenes.recibe_produccion is
  'Admite ingresos a cámara con origen Producción (074). Lo editan Gerencia y Operaciones.';
comment on column almacenes.recibe_compras is
  'Admite ingresos a cámara con origen Compras (074). Lo editan Gerencia y Operaciones.';

/*
 * ¿Puede esta bodega recibir un ingreso de este origen? Devuelve el motivo en
 * palabras si no puede, o null si puede. Es la única definición de la regla:
 * la usan los dos disparadores de abajo.
 */
create or replace function almacen_rechaza_ingreso(p_almacen_id bigint, p_origen text)
returns text
language plpgsql stable
set search_path = public
as $$
declare
  a       almacenes%rowtype;
  v_lista text;
  v_que   text := case p_origen when 'produccion' then 'Producción' when 'compras' then 'Compras' else p_origen end;
begin
  if p_origen is null then return null; end if;   -- ingresos anteriores a octubre: sin origen
  select * into a from almacenes where id = p_almacen_id;
  if not found then return 'Esa bodega no existe.'; end if;
  if not a.activo then
    return format('La bodega %s está desactivada y no recibe ingresos.', a.nombre);
  end if;
  if (p_origen = 'produccion' and a.recibe_produccion) or (p_origen = 'compras' and a.recibe_compras) then
    return null;
  end if;

  select string_agg(nombre, ', ' order by nombre) into v_lista
    from almacenes
   where activo and case p_origen when 'produccion' then recibe_produccion else recibe_compras end;

  return format(
    'La bodega %s no recibe ingresos de %s. Los ingresos de %s entran por: %s. '
    'Si esta bodega también debe recibirlos, Gerencia u Operaciones lo habilita en Configuración › Maestros › Almacenes.',
    a.nombre, v_que, v_que, coalesce(v_lista, 'ninguna bodega (no hay ninguna habilitada)'));
end $$;

revoke execute on function almacen_rechaza_ingreso(bigint, text) from public, anon;
grant execute on function almacen_rechaza_ingreso(bigint, text) to authenticated;

/* El Kardex no acepta un ingreso en una bodega que no recibe ese origen. */
create or replace function movimientos_ingreso_bodega_valida()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_motivo text;
begin
  if new.tipo <> 'ingreso' then return new; end if;
  v_motivo := almacen_rechaza_ingreso(new.almacen_id, new.origen_ingreso);
  if v_motivo is not null then raise exception '%', v_motivo; end if;
  return new;
end $$;

drop trigger if exists trg_movimientos_ingreso_bodega on movimientos;
create trigger trg_movimientos_ingreso_bodega
  before insert on movimientos
  for each row execute function movimientos_ingreso_bodega_valida();


-- ----------------------------------------------------------------------------
--  2 · LAS IMPORTACIONES DESDE EXCEL
-- ----------------------------------------------------------------------------
create table if not exists importaciones_excel (
  id             bigserial primary key,
  tipo           text not null check (tipo in ('ingresos', 'traslados')),
  archivo        text not null,
  archivo_bytes  integer,
  creado_por     uuid not null default auth.uid() references usuarios(id),
  creado_en      timestamptz not null default now(),
  --  La última vez que alguien pulsó «Registrar» (o «Crear traslados»).
  procesado_por  uuid references usuarios(id),
  procesado_en   timestamptz
);
comment on table importaciones_excel is
  'Cada archivo de Excel subido para importar ingresos o traslados (074): quién, cuándo y qué archivo.';

create table if not exists importaciones_excel_filas (
  id                    bigserial primary key,
  importacion_id        bigint not null references importaciones_excel(id) on delete cascade,
  --  El número de fila en la hoja de Excel: es como lo busca quien corrige.
  fila                  integer not null,
  --  Lo que venía en cada columna, como texto, tal cual se leyó (o se corrigió).
  datos                 jsonb not null,
  --  [{ "columna": "bodega", "mensaje": "…" }, …]
  errores               jsonb not null default '[]'::jsonb,
  estado                text not null check (estado in
                          ('valida', 'con_error', 'descartada', 'procesando', 'registrada', 'programada', 'fallida')),
  --  Lo que pasó al registrar, en palabras.
  resultado             text,
  lote_id               bigint references lotes(id) on delete set null,
  traslado_id           bigint references traslados(id) on delete set null,
  ingreso_programado_id bigint,
  actualizado_en        timestamptz not null default now()
);
create index if not exists idx_importacion_filas_imp on importaciones_excel_filas (importacion_id, fila);

/*
 * QUIÉN VALIDA UNA IMPORTACIÓN DE INGRESOS
 * Los ingresos los validan Walter, Marco y Oliver: cualquiera de los tres, que
 * en el sistema son Gerencia y Operaciones. Almacén prepara el archivo, lo
 * sube, corrige las filas y lo deja «Lista para validar»; el stock recién
 * entra cuando alguien de Gerencia u Operaciones pulsa «Validar y registrar».
 * Si quien sube es de Gerencia u Operaciones, valida en el mismo paso.
 *
 *   revision   recién subida o en corrección. No entra nada al stock.
 *   lista      Almacén la dio por buena: espera a Gerencia u Operaciones
 *              (queda un aviso en Alertas y en el panel).
 *   validada   alguien de Gerencia u Operaciones la validó y se registró.
 *
 * Las importaciones de traslados no pasan por aquí: crean traslados en
 * borrador, que ya tienen su propia autorización.
 */
alter table importaciones_excel add column if not exists estado text not null default 'revision';
alter table importaciones_excel add column if not exists enviada_por uuid references usuarios(id);
alter table importaciones_excel add column if not exists enviada_en timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'importaciones_excel_estado_valido') then
    alter table importaciones_excel add constraint importaciones_excel_estado_valido
      check (estado in ('revision', 'lista', 'validada'));
  end if;
end $$;
comment on column importaciones_excel.estado is
  'revision → lista (Almacén la deja lista para validar) → validada (Gerencia u Operaciones la validó y se registró).';
comment on column importaciones_excel.procesado_por is
  'Ingresos: quién la validó (Gerencia u Operaciones). Traslados: quién creó los borradores.';

/*
 * La base sostiene la regla aunque alguien se salte la pantalla: solo
 * Gerencia u Operaciones marcan una importación de ingresos como validada.
 * Y avisa: al quedar «lista» se abre un aviso en Alertas (sale también en el
 * panel de Gerencia y Operaciones); al validarse o volver a revisión, se cierra.
 */
create or replace function importaciones_excel_estado_y_aviso()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_filas   integer;
  v_quien   text;
begin
  if new.tipo = 'ingresos' and new.estado = 'validada'
     and (tg_op = 'INSERT' or old.estado <> 'validada')
     and not puede('gerencia'::rol_usuario, 'operaciones'::rol_usuario) then
    raise exception 'Las importaciones de ingresos las validan Gerencia u Operaciones. Déjela «Lista para validar» y avíseles.';
  end if;

  if tg_op = 'UPDATE' and new.estado is distinct from old.estado then
    --  Sale de «lista»: el aviso ya no hace falta.
    if old.estado = 'lista' then
      update alertas
         set atendida = true, atendida_por = auth.uid(), atendida_en = now()
       where entidad = 'importacion' and entidad_id = new.id and not atendida;
    end if;
    --  Entra en «lista»: se avisa a quien valida.
    if new.estado = 'lista' and new.tipo = 'ingresos' then
      select count(*) into v_filas from importaciones_excel_filas where importacion_id = new.id and estado = 'valida';
      select nombre into v_quien from usuarios where id = coalesce(new.enviada_por, auth.uid());
      insert into alertas (entidad, entidad_id, severidad, titulo, mensaje, datos)
      values ('importacion', new.id, 'advertencia', 'Importación de ingresos por validar',
              format('%s dejó lista para validar la importación «%s» con %s ingreso%s. Entran al stock cuando Gerencia u Operaciones pulse «Validar y registrar».',
                     coalesce(v_quien, 'Almacén'), new.archivo, v_filas, case when v_filas = 1 then '' else 's' end),
              jsonb_build_object('importacion_id', new.id, 'filas', v_filas));
    end if;
  end if;
  return new;
end $$;

revoke execute on function importaciones_excel_estado_y_aviso() from public, anon;

drop trigger if exists trg_importaciones_excel_estado on importaciones_excel;
create trigger trg_importaciones_excel_estado
  before insert or update of estado on importaciones_excel
  for each row execute function importaciones_excel_estado_y_aviso();


-- ----------------------------------------------------------------------------
--  3 · INGRESOS PROGRAMADOS
-- ----------------------------------------------------------------------------
create table if not exists ingresos_programados (
  id                    bigserial primary key,
  codigo_pallet         text not null,
  sku_presentacion_id   bigint not null references sku_presentaciones(id),
  almacen_id            bigint not null references almacenes(id),
  camara_id             bigint references camaras(id),
  --  Cuándo se espera que llegue.
  fecha_llegada         date not null,
  fecha_produccion      date not null,
  turno                 text not null default 'dia'    check (turno in ('dia', 'noche')),
  proceso               text not null default 'propia' check (proceso in ('propia', 'maquila')),
  planta_id             bigint references plantas(id),
  linea_procesadora_id  bigint references lineas_procesadoras(id),
  bultos                integer not null check (bultos > 0),
  peso_neto_kg          numeric(14, 3) not null check (peso_neto_kg > 0),
  costo_unitario        numeric not null default 0 check (costo_unitario >= 0),
  origen_ingreso        text not null check (origen_ingreso in ('produccion', 'compras')),
  proveedor             text,
  observaciones         text,
  estado                text not null default 'programado' check (estado in ('programado', 'confirmado', 'anulado')),
  importacion_id        bigint references importaciones_excel(id) on delete set null,
  --  El pallet que nació al confirmar la llegada.
  lote_id               bigint references lotes(id) on delete set null,
  creado_por            uuid not null default auth.uid() references usuarios(id),
  creado_en             timestamptz not null default now(),
  confirmado_por        uuid references usuarios(id),
  confirmado_en         timestamptz,
  anulado_por           uuid references usuarios(id),
  anulado_en            timestamptz,
  motivo_anulacion      text,
  constraint ingresos_programados_compra_con_proveedor
    check (origen_ingreso <> 'compras' or nullif(btrim(proveedor), '') is not null)
);
comment on table ingresos_programados is
  'Lo que se sabe que va a llegar a cámara (074). No mueve stock: al confirmar la llegada nace el lote con su ingreso.';

--  Un código de pallet no puede estar esperando dos veces.
create unique index if not exists ingresos_programados_pallet_vivo
  on ingresos_programados (upper(btrim(codigo_pallet))) where estado = 'programado';
create index if not exists idx_ingresos_programados_estado on ingresos_programados (estado, fecha_llegada);

/* Lo programado tampoco puede ir a una bodega que no recibe ese origen. */
create or replace function ingresos_programados_validar()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_motivo text;
begin
  if new.estado <> 'programado' then return new; end if;
  v_motivo := almacen_rechaza_ingreso(new.almacen_id, new.origen_ingreso);
  if v_motivo is not null then raise exception '%', v_motivo; end if;
  if new.camara_id is not null
     and not exists (select 1 from camaras where id = new.camara_id and almacen_id = new.almacen_id) then
    raise exception 'Esa cámara no pertenece a la bodega elegida.';
  end if;
  if exists (select 1 from lotes where upper(btrim(codigo_pallet)) = upper(btrim(new.codigo_pallet))) then
    raise exception 'Ya existe un pallet con el código %: no se puede programar otra vez.', upper(btrim(new.codigo_pallet));
  end if;
  return new;
end $$;

drop trigger if exists trg_ingresos_programados_validar on ingresos_programados;
create trigger trg_ingresos_programados_validar
  before insert or update of almacen_id, camara_id, origen_ingreso, codigo_pallet, estado on ingresos_programados
  for each row execute function ingresos_programados_validar();


-- ----------------------------------------------------------------------------
--  4 · PERMISOS Y HUELLA
-- ----------------------------------------------------------------------------
--  Los mismos que hoy registran ingresos y solicitan traslados: Gerencia,
--  Operaciones y Almacén. Cualquiera de ellos puede ver, registrar y confirmar
--  lo que subió otro (pedido expreso: que no dependa de una sola persona).
alter table importaciones_excel        enable row level security;
alter table importaciones_excel_filas    enable row level security;
alter table ingresos_programados enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['importaciones_excel', 'importaciones_excel_filas', 'ingresos_programados'] loop
    execute format('drop policy if exists lectura_operacion on %I', t);
    execute format('drop policy if exists escritura_operacion on %I', t);
    execute format(
      'create policy lectura_operacion on %I for select using '
      '(puede(''gerencia''::rol_usuario, ''operaciones''::rol_usuario, ''almacen''::rol_usuario))', t);
    execute format(
      'create policy escritura_operacion on %I for all using '
      '(puede(''gerencia''::rol_usuario, ''operaciones''::rol_usuario, ''almacen''::rol_usuario)) with check '
      '(puede(''gerencia''::rol_usuario, ''operaciones''::rol_usuario, ''almacen''::rol_usuario))', t);
  end loop;
end $$;

grant select, insert, update, delete on importaciones_excel, importaciones_excel_filas, ingresos_programados to authenticated;
grant usage, select on sequence importaciones_excel_id_seq, importaciones_excel_filas_id_seq, ingresos_programados_id_seq to authenticated;
revoke all on importaciones_excel, importaciones_excel_filas, ingresos_programados from anon;

--  Quién creó, confirmó o anuló cada cosa, como en el resto del sistema. Las
--  filas de una importación no se auditan una por una: cada fila guarda su
--  propio estado y resultado, y la importación sí queda auditada.
drop trigger if exists audit_importaciones_excel on importaciones_excel;
create trigger audit_importaciones_excel
  after insert or update or delete on importaciones_excel
  for each row execute function auditar_cambios();

drop trigger if exists audit_ingresos_programados on ingresos_programados;
create trigger audit_ingresos_programados
  after insert or update or delete on ingresos_programados
  for each row execute function auditar_cambios();


-- ----------------------------------------------------------------------------
--  5 · EL HISTORIAL DE LOS TRASLADOS EN PALABRAS
-- ----------------------------------------------------------------------------
--  Los traslados de la carga inicial dejaron en su historial frases como
--  «Traslado TRAS-2026-0047 en estado en_transito»: el nombre interno del
--  estado. Se reescriben como las que escriben hoy las funciones del
--  traslado. Solo cambia el texto; no se borra ni se agrega ningún evento.
update eventos
   set descripcion = regexp_replace(descripcion, ' en estado (borrador|autorizado|en_transito|aceptado|anulado)$',
         case substring(descripcion from ' en estado ([a-z_]+)$')
           when 'borrador'    then ' creado en borrador'
           when 'autorizado'  then ' autorizado'
           when 'en_transito' then ' despachado: en tránsito'
           when 'aceptado'    then ' recibido en destino'
           when 'anulado'     then ' anulado'
         end)
 where entidad = 'traslados'
   and descripcion ~ ' en estado (borrador|autorizado|en_transito|aceptado|anulado)$';
