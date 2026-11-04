-- ============================================================================
--  085 · VENTAS, CLIENTES Y DESTINOS («Observaciones ERP 4» de Oliver)
-- ============================================================================
--  Cuatro pedidos de la matriz de Oliver Tello (Operaciones), noviembre 2026:
--
--   01 «Corregir base de clientes: dirección, identificación fiscal y
--      vendedor, debe coincidir en cotización con proforma».
--   12 «Permitir ingreso manual de destinos no listados».
--   13 «…modificar cotización después de aceptada bajo una autorización, y
--      permitir eliminar proformas».
--   (El 06, elegir varios pallets a la vez, es solo de pantalla y servidor:
--    no necesita nada de la base.)
--
--  ── 01 · POR QUÉ NO COINCIDÍAN ─────────────────────────────────────────────
--  La cotización y la proforma NO guardaban los datos del cliente: los leían
--  de la ficha del cliente en el momento de generar el PDF. El caso real que
--  lo destapó (KULALIA, 03/11): la cotización COT-2026-0196 se hizo a las
--  21:51, el pedido SM26-623 a las 21:52, y a las 21:59 se cargó la lista BASC
--  de Comex, que corrigió razón social, dirección, CIF… El PDF de la
--  cotización bajado antes decía una cosa; la proforma bajada después, otra.
--  Y el vendedor sí se copiaba, pero la cotización no lo proponía: quedó
--  «Sin vendedor» mientras el cliente tiene uno asignado.
--
--  LA REGLA QUE QUEDA
--   · La cotización FIJA los datos fiscales del cliente (razón social,
--     dirección, identificación fiscal y su etiqueta) al crearse: es lo que
--     se le ofreció a esa empresa ese día.
--   · El pedido que nace de ella los HEREDA tal cual (no vuelve a leer la
--     ficha). Un pedido directo los fija al crearse.
--   · Si se cambia el cliente de una cotización, se fijan los del nuevo.
--   · Si la ficha del cliente se corrige después, el documento NO cambia por
--     debajo: la ficha del documento avisa de la diferencia y ofrece
--     «Actualizar con la ficha del cliente» (queda en el historial).
--   · Los documentos anteriores a esta migración no tienen la copia (NULL):
--     siguen leyendo la ficha, exactamente como hasta hoy. No se reescribe
--     ningún pedido real.
--   · El vendedor: el formulario propone el asignado al cliente (se puede
--     cambiar) y el pedido lo hereda de la cotización, como ya hacía.
--
--  ── 12 · DESTINOS NO LISTADOS ──────────────────────────────────────────────
--  El maestro de destinos lo escriben Gerencia y Operaciones. Para que quien
--  cotiza no se quede sin poder poner el puerto, registrar_destino() lo da
--  de alta desde el formulario de venta (o devuelve el que ya existe con el
--  mismo nombre y país, sin importar mayúsculas, tildes ni espacios).
--
--  ── 13 · MODIFICAR UNA COTIZACIÓN ACEPTADA, CON AUTORIZACIÓN ───────────────
--   1. Quien aprueba cotizaciones (la facultad personal de Configuración ›
--      Usuarios) o Gerencia AUTORIZA la modificación, con un motivo.
--   2. Quien cotiza la edita con el formulario de siempre y guarda.
--   3. Al guardar, en UNA operación: cambia la cotización, el cambio pasa al
--      pedido que nació de ella (cabecera y líneas, casadas por producto: las
--      reservas de un producto que sigue se conservan) y la autorización se
--      consume. Queda en el historial de los dos, con quién autorizó.
--   No se puede si el pedido ya tiene un comprobante vigente, ya salió o está
--   cancelado; quitar un producto que tiene stock apartado, embarque o
--   packing, o bajar su cantidad por debajo de lo apartado, se rechaza con el
--   porqué. El contrato es una copia firmada: hay que generarlo otra vez.
--
--  ── 13 · ELIMINAR UN PEDIDO (proforma) ─────────────────────────────────────
--  Solo Gerencia (el «acceso total»), con motivo, y solo si no tiene nada
--  posterior que dependa de él: comprobantes (aunque estén anulados: son
--  documentos tributarios), embarques no cancelados, packing, despachos ni
--  reservas vigentes. Si tiene reservas, se cancela primero (las suelta).
--  Se borran con él sus líneas, contratos generados y alertas; su historial
--  (eventos y auditoría) se conserva. La cotización de origen vuelve a estar
--  disponible (aprobada o borrador), o se elimina también si se pide.
--  La base, además, deja de permitir que cualquier otro rol borre pedidos.
--
--  Re-ejecutable.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
--  1 · LOS DATOS DEL CLIENTE, FIJADOS EN EL DOCUMENTO
-- ────────────────────────────────────────────────────────────────────────────
alter table cotizaciones add column if not exists cliente_razon_social    text;
alter table cotizaciones add column if not exists cliente_direccion       text;
alter table cotizaciones add column if not exists cliente_tax_id          text;
alter table cotizaciones add column if not exists cliente_etiqueta_tax_id text;
alter table cotizaciones add column if not exists cliente_datos_en        timestamptz;

alter table pedidos add column if not exists cliente_razon_social    text;
alter table pedidos add column if not exists cliente_direccion       text;
alter table pedidos add column if not exists cliente_tax_id          text;
alter table pedidos add column if not exists cliente_etiqueta_tax_id text;
alter table pedidos add column if not exists cliente_datos_en        timestamptz;

comment on column cotizaciones.cliente_datos_en is
  'Cuándo se copiaron los datos fiscales del cliente (razón social, dirección, identificación) a esta cotización (085). NULL = cotización anterior a la 085: los documentos leen la ficha del cliente.';
comment on column pedidos.cliente_datos_en is
  'Cuándo se fijaron los datos fiscales del cliente en este pedido; si nació de una cotización, son los de ella (085). NULL = anterior a la 085: se lee la ficha del cliente.';

/*
 * La cotización: al crearse, y si se le cambia el cliente.
 * En un INSERT que ya trae los datos puestos (cliente_datos_en), se respetan.
 */
create or replace function cotizacion_fijar_datos_cliente()
returns trigger
language plpgsql
set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.cliente_id is not distinct from old.cliente_id then
    return new;
  end if;
  if tg_op = 'INSERT' and new.cliente_datos_en is not null then
    return new;
  end if;
  select c.razon_social, c.direccion, c.ruc_tax_id, c.etiqueta_tax_id, now()
    into new.cliente_razon_social, new.cliente_direccion, new.cliente_tax_id,
         new.cliente_etiqueta_tax_id, new.cliente_datos_en
    from clientes c where c.id = new.cliente_id;
  return new;
end $$;

drop trigger if exists trg_cotizaciones_datos_cliente on cotizaciones;
create trigger trg_cotizaciones_datos_cliente
  before insert or update of cliente_id on cotizaciones
  for each row execute function cotizacion_fijar_datos_cliente();

/*
 * El pedido: hereda los de su cotización (si es del mismo cliente y los
 * tiene); si no, los de la ficha del cliente.
 */
create or replace function pedido_fijar_datos_cliente()
returns trigger
language plpgsql
set search_path = public as $$
declare
  cot record;
begin
  if tg_op = 'UPDATE' and new.cliente_id is not distinct from old.cliente_id then
    return new;
  end if;
  if tg_op = 'INSERT' and new.cliente_datos_en is not null then
    return new;
  end if;
  if tg_op = 'INSERT' and new.cotizacion_id is not null then
    select c.cliente_id, c.cliente_razon_social, c.cliente_direccion, c.cliente_tax_id,
           c.cliente_etiqueta_tax_id, c.cliente_datos_en
      into cot
      from cotizaciones c where c.id = new.cotizacion_id;
    if found and cot.cliente_id = new.cliente_id and cot.cliente_datos_en is not null then
      new.cliente_razon_social    := cot.cliente_razon_social;
      new.cliente_direccion       := cot.cliente_direccion;
      new.cliente_tax_id          := cot.cliente_tax_id;
      new.cliente_etiqueta_tax_id := cot.cliente_etiqueta_tax_id;
      new.cliente_datos_en        := cot.cliente_datos_en;
      return new;
    end if;
  end if;
  select c.razon_social, c.direccion, c.ruc_tax_id, c.etiqueta_tax_id, now()
    into new.cliente_razon_social, new.cliente_direccion, new.cliente_tax_id,
         new.cliente_etiqueta_tax_id, new.cliente_datos_en
    from clientes c where c.id = new.cliente_id;
  return new;
end $$;

drop trigger if exists trg_pedidos_datos_cliente on pedidos;
create trigger trg_pedidos_datos_cliente
  before insert or update of cliente_id on pedidos
  for each row execute function pedido_fijar_datos_cliente();

/*
 * «Actualizar con la ficha del cliente»: vuelve a copiar los datos de la
 * ficha al documento. Lo hacen quienes venden; en un pedido, solo mientras no
 * tenga un comprobante vigente (el comprobante ya salió con los de antes).
 * Devuelve el texto para la pantalla.
 */
create or replace function actualizar_datos_cliente_documento(p_tipo text, p_id bigint)
returns text
language plpgsql
security definer
set search_path = public as $$
declare
  v_cliente bigint;
  v_numero  text;
  v_antes   jsonb;
  v_ahora   jsonb;
  v_fac     text;
  c         record;
begin
  if not puede('gerencia', 'operaciones', 'comercial', 'comex') then
    raise exception using errcode = '42501',
      message = 'Actualizar los datos del cliente en un documento lo hacen Gerencia, Operaciones, Comercial o Comercio Exterior.';
  end if;
  if p_tipo not in ('cotizacion', 'pedido') then
    raise exception using errcode = 'P0001', message = 'Documento desconocido.';
  end if;

  if p_tipo = 'cotizacion' then
    select cliente_id, numero,
           jsonb_build_object('razon_social', cliente_razon_social, 'direccion', cliente_direccion,
                              'tax_id', cliente_tax_id, 'etiqueta', cliente_etiqueta_tax_id)
      into v_cliente, v_numero, v_antes
      from cotizaciones where id = p_id for update;
  else
    select cliente_id, numero_proforma,
           jsonb_build_object('razon_social', cliente_razon_social, 'direccion', cliente_direccion,
                              'tax_id', cliente_tax_id, 'etiqueta', cliente_etiqueta_tax_id)
      into v_cliente, v_numero, v_antes
      from pedidos where id = p_id for update;
    select numero into v_fac from facturas
     where pedido_id = p_id and estado <> 'anulada' order by fecha_emision limit 1;
    if v_fac is not null then
      raise exception using errcode = 'P0001', message = format(
        'El pedido %s ya tiene el comprobante %s emitido con los datos de antes: no se cambian por debajo. Si los datos del cliente estaban mal, Finanzas anula el comprobante y se emite otro.',
        v_numero, v_fac);
    end if;
  end if;
  if v_numero is null then
    raise exception using errcode = 'P0001', message = 'Ese documento ya no existe.';
  end if;

  select razon_social, direccion, ruc_tax_id, etiqueta_tax_id into c from clientes where id = v_cliente;
  v_ahora := jsonb_build_object('razon_social', c.razon_social, 'direccion', c.direccion,
                                'tax_id', c.ruc_tax_id, 'etiqueta', c.etiqueta_tax_id);

  if p_tipo = 'cotizacion' then
    update cotizaciones
       set cliente_razon_social = c.razon_social, cliente_direccion = c.direccion,
           cliente_tax_id = c.ruc_tax_id, cliente_etiqueta_tax_id = c.etiqueta_tax_id,
           cliente_datos_en = now()
     where id = p_id;
  else
    update pedidos
       set cliente_razon_social = c.razon_social, cliente_direccion = c.direccion,
           cliente_tax_id = c.ruc_tax_id, cliente_etiqueta_tax_id = c.etiqueta_tax_id,
           cliente_datos_en = now()
     where id = p_id;
  end if;

  perform registrar_evento(
    case when p_tipo = 'cotizacion' then 'cotizaciones' else 'pedidos' end, p_id,
    'datos_cliente_actualizados',
    format('Se actualizaron los datos del cliente en %s con los de su ficha: %s · %s · %s %s.',
           v_numero, coalesce(c.razon_social, '—'), coalesce(c.direccion, 'sin dirección'),
           coalesce(c.etiqueta_tax_id, 'Id.'), coalesce(c.ruc_tax_id, '—')),
    'info', jsonb_build_object('antes', v_antes, 'ahora', v_ahora));

  return format('Listo: %s lleva ahora los datos de la ficha del cliente. Los PDF que ya se descargaron llevan los de antes: vuelva a descargarlos antes de enviarlos.', v_numero);
end $$;


-- ────────────────────────────────────────────────────────────────────────────
--  2 · DESTINOS NO LISTADOS, DESDE EL FORMULARIO DE VENTA
-- ────────────────────────────────────────────────────────────────────────────
/* Cómo se compara un nombre: sin mayúsculas, tildes ni espacios de más. */
create or replace function clave_destino(p text)
returns text
language sql
immutable
set search_path = public as $$
  select lower(regexp_replace(trim(translate(coalesce(p, ''),
    'ÁÉÍÓÚÜÑáéíóúüñÀÈÌÒÙàèìòùÂÊÎÔÛâêîôûÇç', 'AEIOUUNaeiouunAEIOUaeiouAEIOUaeiouCc')), '\s+', ' ', 'g'));
$$;

create or replace function registrar_destino(p_puerto text, p_pais text)
returns jsonb
language plpgsql
security definer
set search_path = public as $$
declare
  v_puerto text := regexp_replace(trim(coalesce(p_puerto, '')), '\s+', ' ', 'g');
  v_pais   text := regexp_replace(trim(coalesce(p_pais, '')), '\s+', ' ', 'g');
  v_id     bigint;
  v_activo boolean;
begin
  if not puede('gerencia', 'operaciones', 'comercial', 'comex') then
    raise exception using errcode = '42501',
      message = 'Agregar un destino lo hacen Gerencia, Operaciones, Comercial o Comercio Exterior.';
  end if;
  if length(v_puerto) < 2 then
    raise exception using errcode = 'P0001', message = 'Escriba el nombre del puerto o ciudad de destino.';
  end if;
  if length(v_puerto) > 80 then
    raise exception using errcode = 'P0001', message = 'El nombre del destino no puede pasar de 80 caracteres.';
  end if;
  if length(v_pais) < 2 then
    raise exception using errcode = 'P0001', message = 'Escriba el país del destino: sale en la proforma y en el contrato.';
  end if;
  if length(v_pais) > 60 then
    raise exception using errcode = 'P0001', message = 'El país no puede pasar de 60 caracteres.';
  end if;

  --  ¿Ya existe? Entonces se usa ese (y si estaba desactivado, se reactiva).
  select id, activo into v_id, v_activo from destinos
   where clave_destino(puerto) = clave_destino(v_puerto)
     and clave_destino(pais) = clave_destino(v_pais)
   order by activo desc, id limit 1;
  if v_id is not null then
    if not v_activo then update destinos set activo = true where id = v_id; end if;
    return jsonb_build_object('id', v_id, 'nuevo', false);
  end if;

  insert into destinos (puerto, pais, activo) values (v_puerto, v_pais, true) returning id into v_id;
  perform registrar_evento('destinos', v_id, 'destino_creado',
    format('Se agregó el destino %s (%s) desde el formulario de venta.', v_puerto, v_pais), 'info', null);
  return jsonb_build_object('id', v_id, 'nuevo', true);
end $$;


-- ────────────────────────────────────────────────────────────────────────────
--  3 · ¿SE PUEDE TOCAR ESTE PEDIDO? (modificar su cotización o eliminarlo)
-- ────────────────────────────────────────────────────────────────────────────
/*
 * Lo que impide cambiar las condiciones de un pedido ya hecho. NULL = nada.
 * El texto es el que ve la persona: dice qué lo impide y qué hacer.
 */
create or replace function problema_modificar_pedido(p_pedido_id bigint)
returns text
language plpgsql
stable
security definer
set search_path = public as $$
declare
  p     record;
  v_fac text;
  v_emb text;
begin
  select numero_proforma, ciclo into p from pedidos where id = p_pedido_id;
  if not found then return 'El pedido ya no existe.'; end if;
  if p.ciclo in ('despachado', 'cerrado') then
    return format('El pedido %s ya está %s: lo que salió no se cambia.', p.numero_proforma, p.ciclo);
  end if;
  if p.ciclo = 'cancelado' then
    return format('El pedido %s está cancelado: haga una cotización nueva.', p.numero_proforma);
  end if;
  select numero into v_fac from facturas
   where pedido_id = p_pedido_id and estado <> 'anulada' order by fecha_emision limit 1;
  if v_fac is not null then
    return format('El pedido %s ya tiene el comprobante %s emitido: lo facturado no se cambia. Si hay que corregirlo, Finanzas anula el comprobante primero.',
                  p.numero_proforma, v_fac);
  end if;
  select e.numero into v_emb from embarque_pedidos ep join embarques e on e.id = ep.embarque_id
   where ep.pedido_id = p_pedido_id and e.estado = 'despachado' limit 1;
  if v_emb is not null then
    return format('El pedido %s salió en el embarque %s: lo despachado no se cambia.', p.numero_proforma, v_emb);
  end if;
  return null;
end $$;


-- ────────────────────────────────────────────────────────────────────────────
--  4 · MODIFICAR UNA COTIZACIÓN ACEPTADA, CON AUTORIZACIÓN
-- ────────────────────────────────────────────────────────────────────────────
alter table cotizaciones add column if not exists modificacion_autorizada_por uuid references usuarios(id);
alter table cotizaciones add column if not exists modificacion_autorizada_en  timestamptz;
alter table cotizaciones add column if not exists modificacion_motivo         text;

comment on column cotizaciones.modificacion_autorizada_en is
  'Autorización abierta para modificar esta cotización YA ACEPTADA (085): quién (modificacion_autorizada_por), cuándo y por qué. Se consume al guardar la modificación; vuelve a NULL.';

/* ¿Puede esta persona autorizar? La facultad de aprobar cotizaciones, o Gerencia. */
create or replace function autoriza_modificar_cotizacion()
returns boolean
language sql
stable
security definer
set search_path = public as $$
  select exists (
    select 1 from usuarios u
     where u.id = auth.uid() and u.activo and (u.aprueba_cotizaciones or u.rol = 'gerencia')
  );
$$;

create or replace function autorizar_modificacion_cotizacion(p_cotizacion_id bigint, p_motivo text)
returns text
language plpgsql
security definer
set search_path = public as $$
declare
  v_motivo text := trim(coalesce(p_motivo, ''));
  c        record;
  v_ped    record;
  v_prob   text;
  v_nombre text;
begin
  if not autoriza_modificar_cotizacion() then
    raise exception using errcode = '42501',
      message = 'Autorizar la modificación de una cotización aceptada lo hacen las personas que aprueban cotizaciones (Configuración › Usuarios y roles) o Gerencia.';
  end if;
  if length(v_motivo) < 5 then
    raise exception using errcode = 'P0001',
      message = 'Explique por qué se modifica (al menos 5 caracteres): queda en el historial de la cotización y del pedido.';
  end if;
  if length(v_motivo) > 300 then
    raise exception using errcode = 'P0001', message = 'El motivo no puede pasar de 300 caracteres.';
  end if;

  select id, numero, estado, modificacion_autorizada_en into c
    from cotizaciones where id = p_cotizacion_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'Esa cotización ya no existe.';
  end if;
  if c.estado <> 'aceptada' then
    raise exception using errcode = 'P0001', message = format(
      '%s está %s: se corrige con «Editar», sin autorización. La autorización es solo para una cotización aceptada (que ya generó su pedido).',
      c.numero, c.estado);
  end if;
  select id, numero_proforma into v_ped from pedidos where cotizacion_id = p_cotizacion_id;
  if v_ped.id is null then
    raise exception using errcode = 'P0001', message = format('%s no tiene pedido: no hace falta autorización.', c.numero);
  end if;
  v_prob := problema_modificar_pedido(v_ped.id);
  if v_prob is not null then
    raise exception using errcode = 'P0001', message = v_prob;
  end if;

  update cotizaciones
     set modificacion_autorizada_por = auth.uid(), modificacion_autorizada_en = now(),
         modificacion_motivo = v_motivo
   where id = p_cotizacion_id;

  select nombre into v_nombre from usuarios where id = auth.uid();
  perform registrar_evento('cotizaciones', p_cotizacion_id, 'cotizacion_modificacion_autorizada',
    format('%s autorizó modificar %s, ya aceptada (pedido %s): %s', v_nombre, c.numero, v_ped.numero_proforma, v_motivo),
    'advertencia', jsonb_build_object('pedido_id', v_ped.id, 'motivo', v_motivo));
  perform registrar_evento('pedidos', v_ped.id, 'cotizacion_modificacion_autorizada',
    format('%s autorizó modificar la cotización %s de este pedido: %s', v_nombre, c.numero, v_motivo),
    'advertencia', jsonb_build_object('cotizacion_id', p_cotizacion_id, 'motivo', v_motivo));

  return format('Autorizado. %s ya se puede editar: al guardar, los cambios pasan también al pedido %s.', c.numero, v_ped.numero_proforma);
end $$;

create or replace function retirar_autorizacion_modificacion(p_cotizacion_id bigint)
returns text
language plpgsql
security definer
set search_path = public as $$
declare
  c record;
  v_nombre text;
begin
  if not autoriza_modificar_cotizacion() then
    raise exception using errcode = '42501',
      message = 'Retirar la autorización lo hacen las personas que aprueban cotizaciones o Gerencia.';
  end if;
  select numero, modificacion_autorizada_en into c from cotizaciones where id = p_cotizacion_id for update;
  if c.numero is null then
    raise exception using errcode = 'P0001', message = 'Esa cotización ya no existe.';
  end if;
  if c.modificacion_autorizada_en is null then
    return format('%s no tenía una autorización abierta.', c.numero);
  end if;
  update cotizaciones
     set modificacion_autorizada_por = null, modificacion_autorizada_en = null, modificacion_motivo = null
   where id = p_cotizacion_id;
  select nombre into v_nombre from usuarios where id = auth.uid();
  perform registrar_evento('cotizaciones', p_cotizacion_id, 'cotizacion_modificacion_retirada',
    format('%s retiró la autorización para modificar %s sin que se usara.', v_nombre, c.numero), 'info', null);
  return format('Se retiró la autorización: %s vuelve a quedar cerrada.', c.numero);
end $$;

/*
 * Guarda la modificación autorizada: la cotización y su pedido, juntos.
 *
 *   p_cab    la cabecera, con las mismas claves que guarda actualizarCotizacion
 *            (y condicion_pago, el texto que imprime la proforma).
 *   p_lineas [{sku_presentacion_id, cantidad_tm, precio_lista_tm, precio_tm,
 *              descuento_pct, descuento_autorizado_por}] en el orden de pantalla.
 *   p_cambios lo que cambió, dicho en palabras (lo calcula el servidor).
 *
 * Las líneas del pedido se casan por PRODUCTO (no se admite el mismo dos
 * veces): la que sigue se actualiza y conserva sus reservas; la nueva se
 * agrega; la que se quita se borra solo si no tiene stock apartado, embarque,
 * packing ni comprobante.
 */
create or replace function modificar_cotizacion_aceptada(
  p_cotizacion_id bigint, p_cab jsonb, p_lineas jsonb, p_cambios text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public as $$
declare
  c          record;
  v_ped      record;
  v_prob     text;
  v_l        jsonb;
  v_pl       record;
  v_pl_id    bigint;
  v_kg       numeric;
  v_texto    text;
  v_orden    int := 0;
  v_skus     bigint[] := '{}';
  v_sku      bigint;
  v_nombre   text;
  v_autoriza text;
  v_contratos int;
begin
  if not puede('gerencia', 'operaciones', 'comercial') then
    raise exception using errcode = '42501',
      message = 'Modificar una cotización lo hacen Gerencia, Operaciones o Comercial.';
  end if;

  select * into c from cotizaciones where id = p_cotizacion_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'Esa cotización ya no existe.';
  end if;
  if c.estado <> 'aceptada' then
    raise exception using errcode = 'P0001', message = format('%s ya no está aceptada (está %s). Vuelva a abrirla.', c.numero, c.estado);
  end if;
  if c.modificacion_autorizada_en is null then
    raise exception using errcode = 'P0001', message = format(
      '%s está aceptada y no tiene autorización para modificarse (o ya se usó). Pídala a quien aprueba cotizaciones.', c.numero);
  end if;
  if (p_cab->>'cliente_id')::bigint is distinct from c.cliente_id then
    raise exception using errcode = 'P0001', message =
      'En una cotización aceptada no se cambia el cliente: el pedido ya es de ese cliente. Si la venta es para otro, elimine el pedido o haga una cotización nueva.';
  end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception using errcode = 'P0001', message = 'La cotización necesita al menos una línea de producto.';
  end if;

  select * into v_ped from pedidos where cotizacion_id = p_cotizacion_id for update;
  if v_ped.id is null then
    raise exception using errcode = 'P0001', message = format('%s no tiene pedido.', c.numero);
  end if;
  v_prob := problema_modificar_pedido(v_ped.id);
  if v_prob is not null then
    raise exception using errcode = 'P0001', message = v_prob;
  end if;

  /* ---- La cotización: cabecera ---- */
  update cotizaciones set
    vendedor_id              = nullif(p_cab->>'vendedor_id', '')::bigint,
    destino_id               = nullif(p_cab->>'destino_id', '')::bigint,
    lista_id                 = nullif(p_cab->>'lista_id', '')::bigint,
    moneda                   = coalesce(nullif(p_cab->>'moneda', '')::moneda, moneda),
    tipo_cambio              = coalesce(nullif(p_cab->>'tipo_cambio', '')::numeric, tipo_cambio),
    prioridad                = coalesce(nullif(p_cab->>'prioridad', ''), 'normal')::prioridad,
    incoterm                 = coalesce(nullif(p_cab->>'incoterm', '')::incoterm, incoterm),
    validez_dias             = coalesce(nullif(p_cab->>'validez_dias', '')::int, validez_dias),
    observaciones            = nullif(p_cab->>'observaciones', ''),
    contacto_id              = nullif(p_cab->>'contacto_id', '')::bigint,
    contacto_nombre          = nullif(p_cab->>'contacto_nombre', ''),
    contacto_cargo           = nullif(p_cab->>'contacto_cargo', ''),
    contacto_telefono        = nullif(p_cab->>'contacto_telefono', ''),
    contacto_email           = nullif(p_cab->>'contacto_email', ''),
    tipo_cambio_fecha        = nullif(p_cab->>'tipo_cambio_fecha', '')::date,
    tipo_cambio_fuente       = nullif(p_cab->>'tipo_cambio_fuente', ''),
    tipo_cambio_clase        = nullif(p_cab->>'tipo_cambio_clase', ''),
    fecha_tentativa_despacho = nullif(p_cab->>'fecha_tentativa_despacho', '')::date,
    forma_pago               = nullif(p_cab->>'forma_pago', ''),
    adelanto_pct             = coalesce(nullif(p_cab->>'adelanto_pct', '')::numeric, 0),
    adelanto_abonado         = nullif(p_cab->>'adelanto_abonado', '')::numeric,
    adelanto_abonado_en      = nullif(p_cab->>'adelanto_abonado_en', '')::date,
    --  El certificado de captura (083) solo si la pantalla lo manda.
    certificado_captura      = case when p_cab ? 'certificado_captura'
                                    then (p_cab->>'certificado_captura')::boolean
                                    else certificado_captura end,
    --  La autorización se consume.
    modificacion_autorizada_por = null,
    modificacion_autorizada_en  = null,
    modificacion_motivo         = null
  where id = p_cotizacion_id;

  /* ---- La cotización: líneas (se reemplazan, conservando el costo del mismo producto) ---- */
  create temporary table if not exists _costos_085 (sku bigint primary key, costo numeric) on commit drop;
  delete from _costos_085 where true;  -- (con WHERE: la API exige WHERE en todo DELETE)
  insert into _costos_085
    select distinct on (sku_presentacion_id) sku_presentacion_id, costo_estimado_tm
      from cotizacion_lineas where cotizacion_id = p_cotizacion_id order by sku_presentacion_id, orden;
  delete from cotizacion_lineas where cotizacion_id = p_cotizacion_id;

  for v_l in select * from jsonb_array_elements(p_lineas) loop
    v_orden := v_orden + 1;
    v_sku := (v_l->>'sku_presentacion_id')::bigint;
    if v_sku = any(v_skus) then
      raise exception using errcode = 'P0001', message = 'Hay un producto repetido en las líneas: júntelo en una sola.';
    end if;
    v_skus := v_skus || v_sku;
    insert into cotizacion_lineas (cotizacion_id, sku_presentacion_id, cantidad_tm, precio_lista_tm, precio_tm,
                                   descuento_pct, descuento_autorizado_por, costo_estimado_tm, orden)
    values (p_cotizacion_id, v_sku, (v_l->>'cantidad_tm')::numeric, (v_l->>'precio_lista_tm')::numeric,
            (v_l->>'precio_tm')::numeric, coalesce((v_l->>'descuento_pct')::numeric, 0),
            nullif(v_l->>'descuento_autorizado_por', '')::uuid,
            (select costo from _costos_085 where sku = v_sku), v_orden);
  end loop;

  /* ---- El pedido: líneas que se quitan ---- */
  for v_pl in
    select pl.id, pl.sku_presentacion_id, 'SKU ' || s.codigo || ' · ' || coalesce(pr.descripcion, '') as producto
      from pedido_lineas pl
      join sku_presentaciones sp on sp.id = pl.sku_presentacion_id
      join skus s on s.id = sp.sku_id
      left join presentaciones pr on pr.id = sp.presentacion_id
     where pl.pedido_id = v_ped.id and not (pl.sku_presentacion_id = any(v_skus))
  loop
    select coalesce(sum(peso_neto_kg), 0) into v_kg from reservas
     where pedido_linea_id = v_pl.id and estado in ('activa', 'en_preparacion', 'consumida', 'solicitada');
    if v_kg > 0 then
      raise exception using errcode = 'P0001', message = format(
        'No se puede quitar %s del pedido %s: tiene %s kg de stock apartado. Suelte esas reservas primero (pestaña Reservas del pedido) y vuelva a guardar.',
        trim(v_pl.producto), v_ped.numero_proforma, to_char(v_kg, 'FM999G999G990D0'));
    end if;
    if exists (select 1 from embarque_lineas where pedido_linea_id = v_pl.id) then
      raise exception using errcode = 'P0001', message = format(
        'No se puede quitar %s del pedido %s: está cargado en un embarque. Sáquelo del embarque primero.', trim(v_pl.producto), v_ped.numero_proforma);
    end if;
    if exists (select 1 from packing_lineas where pedido_linea_id = v_pl.id) then
      raise exception using errcode = 'P0001', message = format(
        'No se puede quitar %s del pedido %s: ya tiene packing.', trim(v_pl.producto), v_ped.numero_proforma);
    end if;
    if exists (select 1 from factura_lineas where pedido_linea_id = v_pl.id) then
      raise exception using errcode = 'P0001', message = format(
        'No se puede quitar %s del pedido %s: figura en un comprobante.', trim(v_pl.producto), v_ped.numero_proforma);
    end if;
    delete from pedido_lineas where id = v_pl.id;
  end loop;

  /* ---- El pedido: líneas que siguen o que se agregan ---- */
  v_orden := 0;
  for v_l in select * from jsonb_array_elements(p_lineas) loop
    v_orden := v_orden + 1;
    v_sku := (v_l->>'sku_presentacion_id')::bigint;
    v_pl_id := null;
    select pl.id into v_pl_id from pedido_lineas pl where pl.pedido_id = v_ped.id and pl.sku_presentacion_id = v_sku limit 1;
    if v_pl_id is not null then
      select coalesce(sum(peso_neto_kg), 0) into v_kg from reservas
       where pedido_linea_id = v_pl_id and estado in ('activa', 'en_preparacion', 'consumida', 'solicitada');
      if (v_l->>'cantidad_tm')::numeric * 1000 < v_kg - 0.001 then
        select 'SKU ' || s.codigo || ' · ' || coalesce(pr.descripcion, '') into v_texto
          from sku_presentaciones sp join skus s on s.id = sp.sku_id
          left join presentaciones pr on pr.id = sp.presentacion_id where sp.id = v_sku;
        raise exception using errcode = 'P0001', message = format(
          'No se puede bajar %s a %s TM: ya tiene %s kg apartados en el pedido %s. Suelte primero lo que sobra (pestaña Reservas) o deje al menos %s TM.',
          trim(v_texto), to_char((v_l->>'cantidad_tm')::numeric, 'FM999G990D000'), to_char(v_kg, 'FM999G999G990D0'),
          v_ped.numero_proforma, to_char(v_kg / 1000, 'FM999G990D000'));
      end if;
      update pedido_lineas set
        cantidad_tm = (v_l->>'cantidad_tm')::numeric,
        precio_lista_tm = (v_l->>'precio_lista_tm')::numeric,
        precio_tm = (v_l->>'precio_tm')::numeric,
        descuento_pct = coalesce((v_l->>'descuento_pct')::numeric, 0),
        descuento_autorizado_por = nullif(v_l->>'descuento_autorizado_por', '')::uuid,
        orden = v_orden
      where id = v_pl_id;
    else
      insert into pedido_lineas (pedido_id, sku_presentacion_id, cantidad_tm, precio_lista_tm, precio_tm,
                                 descuento_pct, descuento_autorizado_por, costo_estimado_tm, orden)
      values (v_ped.id, v_sku, (v_l->>'cantidad_tm')::numeric, (v_l->>'precio_lista_tm')::numeric,
              (v_l->>'precio_tm')::numeric, coalesce((v_l->>'descuento_pct')::numeric, 0),
              nullif(v_l->>'descuento_autorizado_por', '')::uuid,
              (select costo from _costos_085 where sku = v_sku), v_orden);
    end if;
  end loop;

  /* ---- El pedido: cabecera (lo que viene de la cotización) ---- */
  update pedidos set
    vendedor_id              = nullif(p_cab->>'vendedor_id', '')::bigint,
    destino_id               = nullif(p_cab->>'destino_id', '')::bigint,
    moneda                   = coalesce(nullif(p_cab->>'moneda', '')::moneda, moneda),
    tipo_cambio              = coalesce(nullif(p_cab->>'tipo_cambio', '')::numeric, tipo_cambio),
    incoterm                 = coalesce(nullif(p_cab->>'incoterm', '')::incoterm, incoterm),
    tipo_despacho            = case when coalesce(nullif(p_cab->>'incoterm', ''), incoterm::text) = 'EXW' then 'mercado_nacional' else 'exportacion' end::tipo_despacho,
    prioridad                = coalesce(nullif(p_cab->>'prioridad', ''), 'normal')::prioridad,
    condicion_pago           = coalesce(nullif(p_cab->>'condicion_pago', ''), condicion_pago),
    forma_pago               = nullif(p_cab->>'forma_pago', ''),
    pago_adelanto_pct        = nullif(nullif(p_cab->>'adelanto_pct', '')::numeric, 0),
    tipo_cambio_fecha        = nullif(p_cab->>'tipo_cambio_fecha', '')::date,
    tipo_cambio_fuente       = nullif(p_cab->>'tipo_cambio_fuente', ''),
    tipo_cambio_clase        = nullif(p_cab->>'tipo_cambio_clase', ''),
    fecha_tentativa_despacho = nullif(p_cab->>'fecha_tentativa_despacho', '')::date,
    contacto_id              = nullif(p_cab->>'contacto_id', '')::bigint,
    contacto_nombre          = nullif(p_cab->>'contacto_nombre', ''),
    contacto_cargo           = nullif(p_cab->>'contacto_cargo', ''),
    contacto_telefono        = nullif(p_cab->>'contacto_telefono', ''),
    contacto_email           = nullif(p_cab->>'contacto_email', ''),
    --  Las observaciones pasan solo si el pedido no las cambió por su cuenta.
    observaciones            = case when observaciones is not distinct from c.observaciones
                                    then nullif(p_cab->>'observaciones', '') else observaciones end,
    actualizado_en           = now()
  where id = v_ped.id;

  --  La cobertura se recalcula con las cantidades nuevas.
  perform recalcular_cobertura_pedido(v_ped.id);

  select nombre into v_nombre from usuarios where id = auth.uid();
  select nombre into v_autoriza from usuarios where id = c.modificacion_autorizada_por;
  select count(*) into v_contratos from contratos where pedido_id = v_ped.id;

  perform registrar_evento('cotizaciones', p_cotizacion_id, 'cotizacion_aceptada_modificada',
    format('%s modificó %s, ya aceptada, con la autorización de %s (%s). Cambió: %s. Los cambios pasaron al pedido %s.',
           v_nombre, c.numero, coalesce(v_autoriza, '—'), c.modificacion_motivo,
           coalesce(nullif(array_to_string(p_cambios, ', '), ''), 'nada comercial'), v_ped.numero_proforma),
    'advertencia', jsonb_build_object('pedido_id', v_ped.id, 'cambios', to_jsonb(p_cambios),
                                      'autorizo', c.modificacion_autorizada_por, 'motivo', c.modificacion_motivo));
  perform registrar_evento('pedidos', v_ped.id, 'pedido_modificado_desde_cotizacion',
    format('Cambios de la cotización %s aplicados al pedido (%s, autorizado por %s): %s.',
           c.numero, v_nombre, coalesce(v_autoriza, '—'),
           coalesce(nullif(array_to_string(p_cambios, ', '), ''), 'nada comercial')),
    'advertencia', jsonb_build_object('cotizacion_id', p_cotizacion_id, 'cambios', to_jsonb(p_cambios)));

  return jsonb_build_object('pedido_id', v_ped.id, 'numero_proforma', v_ped.numero_proforma, 'contratos', v_contratos);
end $$;


-- ────────────────────────────────────────────────────────────────────────────
--  5 · ELIMINAR UN PEDIDO (solo Gerencia)
-- ────────────────────────────────────────────────────────────────────────────
/* Lo que impide borrarlo. NULL = se puede. */
create or replace function problema_eliminar_pedido(p_pedido_id bigint)
returns text
language plpgsql
stable
security definer
set search_path = public as $$
declare
  p     record;
  v_txt text;
  v_n   int;
  v_kg  numeric;
begin
  select numero_proforma, ciclo into p from pedidos where id = p_pedido_id;
  if not found then return 'Ese pedido ya no existe.'; end if;
  if p.ciclo in ('despachado', 'cerrado') then
    return format('%s ya está %s: lo que salió es historia de stock y de ventas y no se borra.', p.numero_proforma, p.ciclo);
  end if;
  select string_agg(numero, ', ' order by fecha_emision) into v_txt from facturas where pedido_id = p_pedido_id;
  if v_txt is not null then
    return format('%s tiene comprobantes (%s), aunque estén anulados: son documentos tributarios y no se borran. Use «Cancelar pedido».',
                  p.numero_proforma, v_txt);
  end if;
  select string_agg(e.numero, ', ') into v_txt from embarque_pedidos ep join embarques e on e.id = ep.embarque_id
   where ep.pedido_id = p_pedido_id and e.estado <> 'cancelado';
  if v_txt is not null then
    return format('%s está en el embarque %s: sáquelo del embarque (Logística) antes de eliminarlo.', p.numero_proforma, v_txt);
  end if;
  if exists (select 1 from embarque_lineas el join pedido_lineas pl on pl.id = el.pedido_linea_id where pl.pedido_id = p_pedido_id) then
    return format('%s tiene líneas cargadas en un embarque (aunque esté cancelado): quítelas del embarque antes de eliminarlo.', p.numero_proforma);
  end if;
  if exists (select 1 from packing_lineas pk join pedido_lineas pl on pl.id = pk.pedido_linea_id where pl.pedido_id = p_pedido_id) then
    return format('%s ya tiene packing: no se borra.', p.numero_proforma);
  end if;
  select count(*), coalesce(sum(r.peso_neto_kg), 0) into v_n, v_kg
    from reservas r join pedido_lineas pl on pl.id = r.pedido_linea_id
   where pl.pedido_id = p_pedido_id and r.estado in ('solicitada', 'activa', 'en_preparacion', 'consumida');
  if v_n > 0 then
    return format('%s tiene %s reserva(s) vigente(s) (%s kg de stock apartado). Primero «Cancelar pedido»: suelta todo lo apartado y deja constancia; después se puede eliminar.',
                  p.numero_proforma, v_n, to_char(v_kg, 'FM999G999G990D0'));
  end if;
  return null;
end $$;

create or replace function eliminar_pedido(p_pedido_id bigint, p_motivo text, p_con_cotizacion boolean default false)
returns text
language plpgsql
security definer
set search_path = public as $$
declare
  v_motivo text := trim(coalesce(p_motivo, ''));
  p        record;
  c        record;
  v_prob   text;
  v_nombre text;
  v_estado text;
  v_ctr    int;
  v_reservas bigint[];
  v_lineas int;
  v_resultado text;
begin
  if not puede('gerencia') then
    raise exception using errcode = '42501',
      message = format('%s no elimina pedidos: lo hace solo Gerencia (acceso total). Para dejarlo sin efecto, use «Cancelar pedido» (Gerencia u Operaciones).',
                       coalesce((select initcap(rol::text) from usuarios where id = auth.uid()), 'Su rol'));
  end if;
  if length(v_motivo) < 5 then
    raise exception using errcode = 'P0001',
      message = 'Explique por qué se elimina (al menos 5 caracteres): queda en el historial.';
  end if;

  select id, numero_proforma, cotizacion_id, cliente_id into p from pedidos where id = p_pedido_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'Ese pedido ya no existe.';
  end if;
  v_prob := problema_eliminar_pedido(p_pedido_id);
  if v_prob is not null then
    raise exception using errcode = 'P0001', message = v_prob;
  end if;

  select nombre into v_nombre from usuarios where id = auth.uid();
  select count(*) into v_lineas from pedido_lineas where pedido_id = p_pedido_id;
  select array_agg(r.id) into v_reservas from reservas r join pedido_lineas pl on pl.id = r.pedido_linea_id
   where pl.pedido_id = p_pedido_id;

  --  Lo que solo existe por el pedido.
  delete from contratos where pedido_id = p_pedido_id;
  get diagnostics v_ctr = row_count;
  delete from alertas where entidad = 'pedidos' and entidad_id = p_pedido_id;
  if v_reservas is not null then
    delete from alertas where entidad = 'reservas' and entidad_id = any(v_reservas);
  end if;
  --  Las líneas, sus reservas ya sueltas (historia, queda en auditoría), las
  --  cuentas y el vínculo con embarques cancelados se van en cascada.
  delete from pedidos where id = p_pedido_id;

  perform registrar_evento('pedidos', p_pedido_id, 'pedido_eliminado',
    format('%s eliminó el pedido %s (%s línea(s)%s): %s', v_nombre, p.numero_proforma, v_lineas,
           case when v_ctr > 0 then format(', %s contrato(s) generado(s)', v_ctr) else '' end, v_motivo),
    'advertencia', jsonb_build_object('numero_proforma', p.numero_proforma, 'cotizacion_id', p.cotizacion_id,
                                      'cliente_id', p.cliente_id, 'motivo', v_motivo, 'contratos', v_ctr));
  v_resultado := format('Pedido %s eliminado.', p.numero_proforma);

  if p.cotizacion_id is not null then
    select id, numero, aprobada_en into c from cotizaciones where id = p.cotizacion_id for update;
    if c.id is not null then
      if p_con_cotizacion then
        delete from contratos where cotizacion_id = c.id;
        delete from alertas where entidad = 'cotizaciones' and entidad_id = c.id;
        delete from cotizaciones where id = c.id;
        perform registrar_evento('cotizaciones', c.id, 'cotizacion_eliminada',
          format('%s eliminó la cotización %s junto con su pedido %s: %s', v_nombre, c.numero, p.numero_proforma, v_motivo),
          'advertencia', jsonb_build_object('numero', c.numero, 'pedido', p.numero_proforma, 'motivo', v_motivo));
        v_resultado := v_resultado || format(' También se eliminó la cotización %s.', c.numero);
      else
        --  Vuelve a estar disponible: aprobada si tenía la firma; si no, borrador.
        v_estado := case when c.aprobada_en is not null then 'aprobada' else 'borrador' end;
        update cotizaciones
           set estado = v_estado::estado_cotizacion,
               modificacion_autorizada_por = null, modificacion_autorizada_en = null, modificacion_motivo = null
         where id = c.id;
        perform registrar_evento('cotizaciones', c.id, 'cotizacion_reabierta',
          format('Se eliminó el pedido %s que había generado (%s): la cotización %s vuelve a %s.', p.numero_proforma, v_nombre, c.numero, v_estado),
          'advertencia', jsonb_build_object('pedido', p.numero_proforma, 'motivo', v_motivo));
        v_resultado := v_resultado || format(' La cotización %s vuelve a %s: se puede convertir otra vez, marcar como rechazada o eliminar.', c.numero, v_estado);
      end if;
    end if;
  end if;
  return v_resultado;
end $$;

/*
 * La base deja de permitir que se borren pedidos a mano. Antes la política
 * era «todo» para quienes venden, incluido DELETE. Ahora:
 *   · Gerencia, por eliminar_pedido() (que pide motivo y revisa todo).
 *   · Quien lo acaba de crear, en los 15 minutos siguientes y mientras no
 *     tenga líneas: es el «deshacer» del servidor cuando falla la copia de
 *     las líneas al crear el pedido.
 */
drop policy if exists escritura_comercial on pedidos;
drop policy if exists pedidos_crear on pedidos;
drop policy if exists pedidos_modificar on pedidos;
drop policy if exists pedidos_borrar on pedidos;
create policy pedidos_crear on pedidos for insert
  with check (puede('gerencia', 'operaciones', 'comercial', 'comex'));
create policy pedidos_modificar on pedidos for update
  using (puede('gerencia', 'operaciones', 'comercial', 'comex'))
  with check (puede('gerencia', 'operaciones', 'comercial', 'comex'));
create policy pedidos_borrar on pedidos for delete
  using (
    puede('gerencia')
    or (puede('gerencia', 'operaciones', 'comercial', 'comex')
        and creado_por = auth.uid()
        and creado_en > now() - interval '15 minutes'
        and not exists (select 1 from pedido_lineas l where l.pedido_id = pedidos.id))
  );


-- ────────────────────────────────────────────────────────────────────────────
--  6 · PERMISOS DE LAS FUNCIONES
-- ────────────────────────────────────────────────────────────────────────────
revoke all on function cotizacion_fijar_datos_cliente() from public, anon;
revoke all on function pedido_fijar_datos_cliente() from public, anon;
revoke all on function actualizar_datos_cliente_documento(text, bigint) from public, anon;
revoke all on function registrar_destino(text, text) from public, anon;
revoke all on function problema_modificar_pedido(bigint) from public, anon;
revoke all on function autoriza_modificar_cotizacion() from public, anon;
revoke all on function autorizar_modificacion_cotizacion(bigint, text) from public, anon;
revoke all on function retirar_autorizacion_modificacion(bigint) from public, anon;
revoke all on function modificar_cotizacion_aceptada(bigint, jsonb, jsonb, text[]) from public, anon;
revoke all on function problema_eliminar_pedido(bigint) from public, anon;
revoke all on function eliminar_pedido(bigint, text, boolean) from public, anon;

grant execute on function actualizar_datos_cliente_documento(text, bigint) to authenticated;
grant execute on function registrar_destino(text, text) to authenticated;
grant execute on function problema_modificar_pedido(bigint) to authenticated;
grant execute on function autoriza_modificar_cotizacion() to authenticated;
grant execute on function autorizar_modificacion_cotizacion(bigint, text) to authenticated;
grant execute on function retirar_autorizacion_modificacion(bigint) to authenticated;
grant execute on function modificar_cotizacion_aceptada(bigint, jsonb, jsonb, text[]) to authenticated;
grant execute on function problema_eliminar_pedido(bigint) to authenticated;
grant execute on function eliminar_pedido(bigint, text, boolean) to authenticated;
