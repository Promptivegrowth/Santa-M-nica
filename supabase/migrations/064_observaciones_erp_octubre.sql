-- ============================================================================
--  064 · OBSERVACIONES DEL ERP (documento de Oliver, octubre 2026)
-- ============================================================================
--  El documento «Observaciones ERP.docx» trae 17 puntos. Esta migración pone
--  en la base lo que necesitan los que tocan datos; el resto es pantalla.
--
--     3   Tipo de cambio SUNAT automático        tipos_cambio_sunat + columnas
--     4   Fecha tentativa de despacho            cotizaciones / pedidos
--     5   Plazos según prioridad                 parámetros + plazo_referencia()
--     6   Formas de pago y adelantos             cotizaciones / pedidos
--     7   Observaciones de la cotización         se corrigen las proformas viejas
--     8   Contrato al aprobar la cotización      plantillas_documento + contratos
--    10   SKU similares en la reserva            reservas.sku_solicitado / reservado
--    11   Origen del ingreso                     movimientos.origen_ingreso
--    13   Qué sale en cada embarque              embarque_lineas + v_pedido_linea_programacion
--    15   Guía final en PDF  ┐
--    17   Reporte de carga   ┘                   despacho_archivos + bucket privado
--    16   Ocultar Objetivos mensuales            parámetro modulo_objetivos_activo
--
--  Se puede volver a ejecutar: todo comprueba antes de crear.
-- ============================================================================


-- ============================================================================
--  3. TIPO DE CAMBIO SUNAT
-- ============================================================================
--  El que publica SUNAT para cada día, guardado la primera vez que alguien lo
--  necesita. Así una cotización de hace un año sigue diciendo con qué tipo se
--  hizo, aunque la página de SUNAT cambie o no responda.
--
--  ¿COMPRA O VENTA? El documento pide validarlo. Para el comprobante de venta
--  en dólares el Reglamento del IGV usa el «promedio ponderado VENTA», así
--  que se propone venta; queda en un parámetro para que el contador lo cambie
--  sin tocar código. La pantalla enseña los dos.
-- ============================================================================
create table if not exists tipos_cambio_sunat (
  fecha          date primary key,
  compra         numeric(8,4) not null check (compra between 1 and 20),
  venta          numeric(8,4) not null check (venta between 1 and 20),
  --  El día que SUNAT publicó el valor. Para un domingo o feriado no publica, y
  --  vale el último publicado: se guarda cuál fue para poder decirlo.
  publicado_el   date not null,
  fuente         text not null default 'SUNAT',
  consultado_en  timestamptz not null default now()
);
comment on table tipos_cambio_sunat is
  'Tipo de cambio oficial SUNAT por día (064). Se llena solo al consultarlo; publicado_el dice de qué publicación sale.';

alter table tipos_cambio_sunat enable row level security;
drop policy if exists "tc_sunat_lectura"   on tipos_cambio_sunat;
drop policy if exists "tc_sunat_escritura" on tipos_cambio_sunat;
create policy "tc_sunat_lectura" on tipos_cambio_sunat for select to authenticated using (true);
--  Lo escribe el servidor con la sesión de quien está cotizando. Solo quien
--  vende o administra: nadie más tiene por qué grabar un tipo de cambio.
create policy "tc_sunat_escritura" on tipos_cambio_sunat for all to authenticated
  using (puede('gerencia', 'operaciones', 'comercial', 'comex'))
  with check (puede('gerencia', 'operaciones', 'comercial', 'comex'));

do $$
begin
  --  De dónde salió el tipo de cambio de cada documento y de qué día es.
  if not exists (select 1 from information_schema.columns
                 where table_name = 'cotizaciones' and column_name = 'tipo_cambio_fecha') then
    alter table cotizaciones
      add column tipo_cambio_fecha  date,
      add column tipo_cambio_fuente text check (tipo_cambio_fuente in ('sunat', 'manual')),
      add column tipo_cambio_clase  text check (tipo_cambio_clase in ('compra', 'venta'));
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_name = 'pedidos' and column_name = 'tipo_cambio_fecha') then
    alter table pedidos
      add column tipo_cambio_fecha  date,
      add column tipo_cambio_fuente text check (tipo_cambio_fuente in ('sunat', 'manual')),
      add column tipo_cambio_clase  text check (tipo_cambio_clase in ('compra', 'venta'));
  end if;
end $$;


-- ============================================================================
--  4 y 5. FECHA TENTATIVA DE DESPACHO Y PLAZOS POR PRIORIDAD
-- ============================================================================
--  La fecha tentativa es OPCIONAL. Si está, manda. Si no, el plazo lo pone la
--  prioridad, como definió Oliver:
--      Urgente  hasta 1 semana
--      Normal   más de 1 y hasta 3 semanas
--      Baja     más de 3 semanas
--  «Alta» no está en el documento pero existe en el sistema (69 pedidos la
--  usan): se deja entre urgente y normal, en 2 semanas.
--  Los días son parámetros: si mañana «urgente» son 5 días, se cambia ahí.
-- ============================================================================
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_name = 'cotizaciones' and column_name = 'fecha_tentativa_despacho') then
    alter table cotizaciones add column fecha_tentativa_despacho date;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_name = 'pedidos' and column_name = 'fecha_tentativa_despacho') then
    alter table pedidos add column fecha_tentativa_despacho date;
  end if;
end $$;

insert into parametros (clave, valor, tipo_dato, grupo, etiqueta, descripcion, unidad, editable_por) values
  ('plazo_dias_urgente', '7',  'numero', 'comercial', 'Plazo de entrega · Urgente',
   'Prioridad urgente: hasta 1 semana. Fecha de referencia cuando la cotización no trae fecha tentativa.', 'días', 'gerencia'),
  ('plazo_dias_alta',    '14', 'numero', 'comercial', 'Plazo de entrega · Alta',
   'Prioridad alta: no está en el documento de Oliver; se deja entre urgente y normal.', 'días', 'gerencia'),
  ('plazo_dias_normal',  '21', 'numero', 'comercial', 'Plazo de entrega · Normal',
   'Prioridad normal: más de 1 y hasta 3 semanas.', 'días', 'gerencia'),
  ('plazo_dias_baja',    '42', 'numero', 'comercial', 'Plazo de entrega · Baja',
   'Prioridad baja: más de 3 semanas. Como no tiene tope, se toma 6 semanas como fecha de referencia.', 'días', 'gerencia'),
  ('tipo_cambio_sunat_usar', 'venta', 'texto', 'comercial', 'Tipo de cambio SUNAT a usar',
   'compra o venta. Para el comprobante de venta el Reglamento del IGV usa el promedio ponderado venta. Confirmar con el contador.', null, 'gerencia')
on conflict (clave) do nothing;

/** La fecha límite de referencia: la tentativa si la hay; si no, la base más el plazo de la prioridad. */
create or replace function plazo_referencia(p_prioridad prioridad, p_desde date, p_tentativa date default null)
returns date
language sql stable
set search_path = public
as $$
  select coalesce(
    p_tentativa,
    p_desde + coalesce(
      (select valor::int from parametros where clave = 'plazo_dias_' || p_prioridad::text),
      case p_prioridad when 'urgente' then 7 when 'alta' then 14 when 'baja' then 42 else 21 end
    )
  );
$$;
revoke execute on function plazo_referencia(prioridad, date, date) from public, anon;
grant execute on function plazo_referencia(prioridad, date, date) to authenticated;


-- ============================================================================
--  6. FORMAS DE PAGO Y ADELANTOS
-- ============================================================================
--  En la cotización: la forma de pago, el % de adelanto y lo que el cliente
--  REALMENTE abonó. El monto de adelanto no se guarda: es total × %, y si se
--  guardara se descuadraría al cambiar una línea. La diferencia tampoco.
-- ============================================================================
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_name = 'cotizaciones' and column_name = 'forma_pago') then
    alter table cotizaciones
      add column forma_pago        text check (forma_pago in
                                     ('contado', 'adelanto_saldo', 'credito', 'carta_credito', 'cad')),
      add column adelanto_pct      numeric(5,2) not null default 0 check (adelanto_pct between 0 and 100),
      add column adelanto_abonado  numeric(14,2) check (adelanto_abonado >= 0),
      add column adelanto_abonado_en date;
  end if;
  --  El pedido ya tenía condicion_pago (texto) y pago_adelanto_pct. Le falta
  --  la forma estructurada y lo abonado, que viajan desde la cotización.
  if not exists (select 1 from information_schema.columns
                 where table_name = 'pedidos' and column_name = 'forma_pago') then
    alter table pedidos
      add column forma_pago        text check (forma_pago in
                                     ('contado', 'adelanto_saldo', 'credito', 'carta_credito', 'cad')),
      add column adelanto_abonado  numeric(14,2) check (adelanto_abonado >= 0),
      add column adelanto_abonado_en date;
  end if;
end $$;


-- ============================================================================
--  7. LAS OBSERVACIONES DE LA COTIZACIÓN PASAN A LA PROFORMA
-- ============================================================================
--  Hasta hoy la proforma nacía con «Generado desde la cotización COT-…» y lo
--  que el comercial había escrito se perdía. El vínculo con la cotización ya
--  está en cotizacion_id (y la ficha lo enseña), así que esa frase sobraba.
--  Se corrigen las proformas que nacieron así: llevan lo que decía su
--  cotización, o nada si la cotización no tenía observaciones.
-- ============================================================================
update pedidos p
   set observaciones = nullif(trim(c.observaciones), '')
  from cotizaciones c
 where c.id = p.cotizacion_id
   and p.observaciones = 'Generado desde la cotización ' || c.numero;


-- ============================================================================
--  8. CONTRATO AL APROBAR LA COTIZACIÓN
-- ============================================================================
--  La plantilla es un texto con marcadores {{cliente}}, {{productos}}… que
--  Gerencia edita en Configuración. Cuando llegue la plantilla institucional
--  se pega ahí y no hay que tocar código.
--  El contrato generado guarda el TEXTO FINAL: si mañana cambia la plantilla,
--  el contrato que se firmó sigue diciendo lo que decía.
-- ============================================================================
create table if not exists plantillas_documento (
  clave           text primary key,
  titulo          text not null,
  cuerpo          text not null,
  actualizado_por uuid references usuarios(id),
  actualizado_en  timestamptz not null default now()
);
alter table plantillas_documento enable row level security;
drop policy if exists "plantillas_lectura"   on plantillas_documento;
drop policy if exists "plantillas_escritura" on plantillas_documento;
create policy "plantillas_lectura" on plantillas_documento for select to authenticated using (true);
create policy "plantillas_escritura" on plantillas_documento for all to authenticated
  using (puede('gerencia')) with check (puede('gerencia'));

insert into plantillas_documento (clave, titulo, cuerpo) values ('contrato_venta', 'CONTRATO DE COMPRAVENTA INTERNACIONAL',
'Conste por el presente documento el contrato de compraventa que celebran, de una parte, {{empresa}}, con RUC {{ruc_empresa}}, con domicilio en {{direccion_empresa}}, a quien en adelante se denominará EL VENDEDOR; y de la otra parte, {{cliente}}, con documento {{documento_cliente}}, con domicilio en {{direccion_cliente}}, {{pais_cliente}}, a quien en adelante se denominará EL COMPRADOR; en los términos y condiciones siguientes:

PRIMERA · OBJETO
EL VENDEDOR se obliga a vender y EL COMPRADOR a comprar los productos hidrobiológicos congelados que se detallan a continuación, conforme a la cotización {{numero_cotizacion}} del {{fecha_cotizacion}}:

{{productos}}

SEGUNDA · PRECIO
El precio total de la operación es de {{total}} ({{total_letras}}), en condición {{incoterm}}{{destino}}.

TERCERA · FORMA DE PAGO
{{forma_pago}}

CUARTA · ENTREGA
{{entrega}}

QUINTA · CALIDAD
Los productos se entregan congelados, conservados a -18 °C o menos, conforme a las especificaciones acordadas y con los certificados sanitarios que exige el país de destino.

SEXTA · CONDICIONES PARTICULARES
{{observaciones}}

SÉPTIMA · LEY APLICABLE
El presente contrato se rige por las leyes de la República del Perú. Cualquier controversia se resolverá de manera directa entre las partes y, de no lograrse acuerdo, ante los tribunales de Lima.

Firmado en dos ejemplares de igual valor, en Lima, el {{fecha_contrato}}.')
on conflict (clave) do nothing;

create table if not exists contratos (
  id             bigserial primary key,
  numero         text not null unique,
  cotizacion_id  bigint not null references cotizaciones(id) on delete restrict,
  titulo         text not null,
  cuerpo         text not null,
  generado_por   uuid references usuarios(id),
  generado_en    timestamptz not null default now()
);
create index if not exists contratos_cotizacion_idx on contratos (cotizacion_id);
comment on table contratos is
  'Contratos generados desde una cotización aprobada (064). Guardan el texto final: no cambian si cambia la plantilla.';

alter table contratos enable row level security;
drop policy if exists "contratos_lectura"   on contratos;
drop policy if exists "contratos_escritura" on contratos;
create policy "contratos_lectura" on contratos for select to authenticated
  using (puede('gerencia', 'operaciones', 'comercial', 'comex'));
create policy "contratos_escritura" on contratos for insert to authenticated
  with check (puede('gerencia', 'operaciones', 'comercial', 'comex'));

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'audit_contratos') then
    create trigger audit_contratos after insert or update or delete on contratos
      for each row execute function auditar_cambios();
  end if;
end $$;


-- ============================================================================
--  10. SKU SIMILARES EN LA RESERVA
-- ============================================================================
--  Hasta hoy una línea solo se podía cubrir con pallets de SU producto. Oliver
--  pide poder usar uno equivalente (otra presentación del mismo corte, por
--  ejemplo) y que quede registrado qué se pidió y qué se apartó.
--  Las dos columnas las llena un disparador: no dependen de que la pantalla
--  se acuerde, y quedan fijas aunque luego se edite la línea del pedido.
-- ============================================================================
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_name = 'reservas' and column_name = 'sku_solicitado_id') then
    alter table reservas
      add column sku_solicitado_id bigint references sku_presentaciones(id),
      add column sku_reservado_id  bigint references sku_presentaciones(id);
  end if;
end $$;

create or replace function reservas_fijar_skus()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.lote_id is distinct from old.lote_id
     or new.pedido_linea_id is distinct from old.pedido_linea_id then
    select sku_presentacion_id into new.sku_solicitado_id from pedido_lineas where id = new.pedido_linea_id;
    select sku_presentacion_id into new.sku_reservado_id  from lotes         where id = new.lote_id;
  end if;
  return new;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_reservas_fijar_skus') then
    create trigger trg_reservas_fijar_skus before insert or update on reservas
      for each row execute function reservas_fijar_skus();
  end if;
end $$;

--  Las reservas que ya existían: lo pedido y lo apartado salen de sus tablas.
update reservas r
   set sku_solicitado_id = pl.sku_presentacion_id,
       sku_reservado_id  = l.sku_presentacion_id
  from pedido_lineas pl, lotes l
 where pl.id = r.pedido_linea_id and l.id = r.lote_id
   and r.sku_solicitado_id is null;


-- ============================================================================
--  11. ORIGEN DEL INGRESO: PRODUCCIÓN O COMPRAS
-- ============================================================================
--  Se guarda EN EL MOVIMIENTO, como pide el documento. El Kardex no se edita,
--  así que los ingresos anteriores quedan «sin clasificar»: no se inventa de
--  dónde vinieron. Desde hoy es obligatorio (la restricción NOT VALID no
--  revisa lo viejo pero sí todo lo nuevo).
-- ============================================================================
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_name = 'movimientos' and column_name = 'origen_ingreso') then
    alter table movimientos
      add column origen_ingreso text check (origen_ingreso in ('produccion', 'compras')),
      add column proveedor      text;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'movimientos_ingreso_con_origen') then
    alter table movimientos add constraint movimientos_ingreso_con_origen
      check (tipo <> 'ingreso' or origen_ingreso is not null) not valid;
  end if;
end $$;
comment on column movimientos.origen_ingreso is
  'Solo en ingresos (064): produccion = planta propia; compras = adquirido a un tercero. Nulo en los anteriores a octubre 2026.';

--  El Kardex lo enseña y se puede filtrar por él. Se AGREGAN dos columnas al
--  final de la vista (una vista existente solo admite columnas nuevas al final).
create or replace view v_kardex as
 SELECT m.id,
    m.fecha,
    m.tipo,
    signo_movimiento(m.tipo) AS signo,
    m.lote_id,
    l.codigo_pallet,
    l.fecha_produccion,
    m.almacen_id,
    a.nombre AS almacen,
    sp.id AS sku_presentacion_id,
    s.codigo AS sku_codigo,
    esp.nombre AS especie,
    fo.nombre AS formato,
    s.corte,
    pr.descripcion AS presentacion,
        CASE
            WHEN (signo_movimiento(m.tipo) = 1) THEN m.bultos
            ELSE 0
        END AS entrada_bultos,
        CASE
            WHEN (signo_movimiento(m.tipo) = 1) THEN m.peso_neto_kg
            ELSE (0)::numeric
        END AS entrada_kg,
        CASE
            WHEN (signo_movimiento(m.tipo) = '-1'::integer) THEN m.bultos
            ELSE 0
        END AS salida_bultos,
        CASE
            WHEN (signo_movimiento(m.tipo) = '-1'::integer) THEN m.peso_neto_kg
            ELSE (0)::numeric
        END AS salida_kg,
    m.costo_unitario,
    (m.peso_neto_kg * m.costo_unitario) AS valor,
    m.documento_tipo,
    m.documento_id,
    m.documento_ref,
    mo.nombre AS motivo,
    u.nombre AS usuario,
    ua.nombre AS autorizado_por,
    m.origen_ingreso,
    m.proveedor
   FROM ((((((((((movimientos m
     JOIN lotes l ON ((l.id = m.lote_id)))
     JOIN almacenes a ON ((a.id = m.almacen_id)))
     JOIN sku_presentaciones sp ON ((sp.id = l.sku_presentacion_id)))
     JOIN skus s ON ((s.id = sp.sku_id)))
     JOIN especies esp ON ((esp.id = s.especie_id)))
     JOIN formatos fo ON ((fo.id = s.formato_id)))
     JOIN presentaciones pr ON ((pr.id = sp.presentacion_id)))
     LEFT JOIN motivos mo ON ((mo.id = m.motivo_id)))
     LEFT JOIN usuarios u ON ((u.id = m.usuario_id)))
     LEFT JOIN usuarios ua ON ((ua.id = m.autorizado_por)));


-- ============================================================================
--  13. QUÉ PRODUCTOS Y CUÁNTO SALE EN CADA EMBARQUE
-- ============================================================================
--  Antes el embarque llevaba pedidos enteros. Ahora, por cada proforma, se
--  elige qué productos y cuántos kilos salen (despacho parcial), con el SKU
--  realmente apartado, que puede ser un equivalente (punto 10).
-- ============================================================================
create table if not exists embarque_lineas (
  id                  bigserial primary key,
  embarque_id         bigint not null references embarques(id) on delete cascade,
  pedido_linea_id     bigint not null references pedido_lineas(id) on delete restrict,
  sku_presentacion_id bigint not null references sku_presentaciones(id),
  cantidad_kg         numeric(14,3) not null check (cantidad_kg > 0),
  creado_por          uuid references usuarios(id),
  creado_en           timestamptz not null default now(),
  unique (embarque_id, pedido_linea_id, sku_presentacion_id)
);
create index if not exists embarque_lineas_linea_idx on embarque_lineas (pedido_linea_id);

alter table embarque_lineas enable row level security;
drop policy if exists "embarque_lineas_lectura"   on embarque_lineas;
drop policy if exists "embarque_lineas_escritura" on embarque_lineas;
create policy "embarque_lineas_lectura" on embarque_lineas for select to authenticated using (true);
create policy "embarque_lineas_escritura" on embarque_lineas for all to authenticated
  using (puede('gerencia', 'operaciones', 'comex', 'almacen'))
  with check (puede('gerencia', 'operaciones', 'comex', 'almacen'));

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'audit_embarque_lineas') then
    create trigger audit_embarque_lineas after insert or update or delete on embarque_lineas
      for each row execute function auditar_cambios();
  end if;
end $$;

/*
 * Lo programado no puede pasar de lo que falta despachar de la línea. Lo
 * comprueba la base: dos personas programando a la vez el mismo pedido no
 * pueden, entre las dos, prometer más de lo que el cliente pidió.
 */
create or replace function embarque_lineas_validar()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_pedido_kg   numeric;
  v_otros_kg    numeric;
  v_proforma    text;
begin
  select pl.cantidad_tm * 1000, p.numero_proforma
    into v_pedido_kg, v_proforma
    from pedido_lineas pl join pedidos p on p.id = pl.pedido_id
   where pl.id = new.pedido_linea_id;

  select coalesce(sum(el.cantidad_kg), 0) into v_otros_kg
    from embarque_lineas el join embarques e on e.id = el.embarque_id
   where el.pedido_linea_id = new.pedido_linea_id
     and el.id is distinct from new.id
     and e.estado <> 'cancelado';

  if v_otros_kg + new.cantidad_kg > v_pedido_kg + 0.5 then
    raise exception 'De esa línea de la proforma % quedan % kg por programar y se están programando % kg.',
      v_proforma, round(greatest(v_pedido_kg - v_otros_kg, 0), 1), round(new.cantidad_kg, 1);
  end if;
  return new;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_embarque_lineas_validar') then
    create trigger trg_embarque_lineas_validar before insert or update on embarque_lineas
      for each row execute function embarque_lineas_validar();
  end if;
end $$;

--  Por línea de pedido: lo pedido, lo programado en embarques vivos, lo que
--  ya salió y el saldo que queda por programar.
create or replace view v_pedido_linea_programacion as
select
  pl.id                         as pedido_linea_id,
  pl.pedido_id,
  pl.sku_presentacion_id,
  pl.cantidad_tm * 1000         as pedido_kg,
  coalesce(pr.programado_kg, 0) as programado_kg,
  coalesce(rs.despachado_kg, 0) as despachado_kg,
  coalesce(rs.reservado_kg, 0)  as reservado_kg,
  greatest(pl.cantidad_tm * 1000 - coalesce(pr.programado_kg, 0), 0) as por_programar_kg
from pedido_lineas pl
left join lateral (
  select sum(el.cantidad_kg) as programado_kg
    from embarque_lineas el join embarques e on e.id = el.embarque_id
   where el.pedido_linea_id = pl.id and e.estado <> 'cancelado'
) pr on true
left join lateral (
  select sum(r.peso_neto_kg) filter (where r.estado = 'consumida')                       as despachado_kg,
         sum(r.peso_neto_kg) filter (where r.estado in ('activa', 'en_preparacion'))     as reservado_kg
    from reservas r where r.pedido_linea_id = pl.id
) rs on true;
alter view v_pedido_linea_programacion set (security_invoker = true);


-- ============================================================================
--  15 y 17. ARCHIVOS DEL DESPACHO: GUÍA FINAL Y FOTOS DE LA CARGA
-- ============================================================================
--  Un repositorio PRIVADO: una guía de remisión o la foto de un contenedor no
--  se publican en internet. Se ven con un enlace firmado que caduca.
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('despachos', 'despachos', false, 15728640,
        array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "despachos_archivos_leer"   on storage.objects;
drop policy if exists "despachos_archivos_subir"  on storage.objects;
drop policy if exists "despachos_archivos_borrar" on storage.objects;
create policy "despachos_archivos_leer" on storage.objects for select to authenticated
  using (bucket_id = 'despachos');
create policy "despachos_archivos_subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'despachos' and puede('gerencia', 'operaciones', 'almacen', 'comex'));
create policy "despachos_archivos_borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'despachos' and puede('gerencia', 'operaciones', 'almacen', 'comex'));

create table if not exists despacho_archivos (
  id            bigserial primary key,
  despacho_id   bigint not null references despachos(id) on delete restrict,
  tipo          text not null check (tipo in ('guia', 'foto')),
  ruta          text not null unique,
  nombre        text not null,
  tipo_mime     text not null,
  tamano_bytes  bigint not null check (tamano_bytes > 0),
  descripcion   text,
  subido_por    uuid references usuarios(id),
  subido_en     timestamptz not null default now()
);
create index if not exists despacho_archivos_despacho_idx on despacho_archivos (despacho_id, tipo);

alter table despacho_archivos enable row level security;
drop policy if exists "despacho_archivos_lectura"   on despacho_archivos;
drop policy if exists "despacho_archivos_escritura" on despacho_archivos;
drop policy if exists "despacho_archivos_borrado"   on despacho_archivos;
create policy "despacho_archivos_lectura" on despacho_archivos for select to authenticated using (true);
create policy "despacho_archivos_escritura" on despacho_archivos for insert to authenticated
  with check (puede('gerencia', 'operaciones', 'almacen', 'comex'));
create policy "despacho_archivos_borrado" on despacho_archivos for delete to authenticated
  using (puede('gerencia', 'operaciones', 'almacen', 'comex'));

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'audit_despacho_archivos') then
    create trigger audit_despacho_archivos after insert or update or delete on despacho_archivos
      for each row execute function auditar_cambios();
  end if;
end $$;


-- ============================================================================
--  16. OCULTAR «OBJETIVOS MENSUALES» SIN BORRAR NADA
-- ============================================================================
--  Un interruptor. Los datos, las metas y los permisos de Marco y Oliver se
--  quedan como están; volver a mostrarlo es poner «si».
-- ============================================================================
insert into parametros (clave, valor, tipo_dato, grupo, etiqueta, descripcion, unidad, editable_por) values
  ('modulo_objetivos_activo', 'no', 'texto', 'sistema', 'Módulo Objetivos mensuales visible',
   'si / no. Oliver pidió ocultarlo temporalmente (octubre 2026). Los datos se conservan.', null, 'gerencia')
on conflict (clave) do nothing;
