-- ============================================================================
--  SANTA MÓNICA ERP · MIGRACIÓN 004 · LÓGICA DE NEGOCIO
-- ============================================================================
--  Aquí viven las reglas que hacen que el sistema resuelva el problema real.
--  La más importante de todas es la de DISPONIBILIDAD.
--
--  ¿Por qué es tan importante?
--  Porque hoy el negocio no sabe cuánto puede vender de verdad. Tiene producto
--  en la cámara que figura "apartado" para un cliente que nunca lo llevó, y al
--  mismo tiempo le dice que no a clientes reales. Esta migración define, de una
--  vez y para siempre, qué significa "disponible".
-- ============================================================================


-- ============================================================================
--  1. VISTA BASE: el stock de cada lote en cada bodega, ya descompuesto
-- ============================================================================
create or replace view v_stock_lote as
select
  e.lote_id,
  e.almacen_id,
  e.camara_id,
  l.sku_presentacion_id,
  l.fecha_produccion,
  l.campania,
  l.codigo_pallet,
  l.codigo_lote,

  -- FÍSICO: lo que hay en la cámara, se pueda vender o no
  e.peso_neto_kg                                   as fisico_kg,
  e.bultos                                         as fisico_bultos,
  e.costo_promedio,

  -- BLOQUEADO: si calidad lo observó, no se puede vender
  case when lote_bloqueado(e.lote_id) then e.peso_neto_kg else 0 end as bloqueado_kg,

  -- RESERVADO: apartado para un pedido, todavía no se empezó a preparar
  coalesce(r.reservado_kg, 0)                      as reservado_kg,

  -- EN PREPARACIÓN: ya está asignado a un packing list en armado
  coalesce(r.preparacion_kg, 0)                    as preparacion_kg,

  -- DISPONIBLE: lo que realmente se le puede prometer a un cliente nuevo
  greatest(
    e.peso_neto_kg
      - (case when lote_bloqueado(e.lote_id) then e.peso_neto_kg else 0 end)
      - coalesce(r.reservado_kg, 0)
      - coalesce(r.preparacion_kg, 0)
  , 0)                                             as disponible_kg,

  -- Antigüedad en meses, para el control de anticuamiento
  (extract(epoch from (now() - l.fecha_produccion::timestamptz)) / 2629800)::numeric(8,2) as meses_almacenado

from existencias e
join lotes l on l.id = e.lote_id
left join lateral (
  select
    sum(case when rv.estado = 'activa'          then rv.peso_neto_kg else 0 end) as reservado_kg,
    sum(case when rv.estado = 'en_preparacion'  then rv.peso_neto_kg else 0 end) as preparacion_kg
  from reservas rv
  where rv.lote_id = e.lote_id
    and rv.almacen_id = e.almacen_id
    and rv.estado in ('activa','en_preparacion')
) r on true
where e.bultos > 0;

comment on view v_stock_lote is 'Las cinco cantidades por lote y bodega. Es la base de todo cálculo de disponibilidad.';


-- ============================================================================
--  2. STOCK EN TRÁNSITO
--  Producto que ya salió de una bodega pero todavía no fue aceptado en la otra.
--  Decisión de diseño: NO es vendible hoy, pero SÍ se puede prometer a futuro.
-- ============================================================================
create or replace view v_stock_transito as
select
  t.id                    as traslado_id,
  t.almacen_destino_id    as almacen_id,
  tl.lote_id,
  l.sku_presentacion_id,
  tl.peso_enviado_kg      as transito_kg,
  tl.bultos_enviados      as transito_bultos,
  t.fecha_programada      as llegada_estimada
from traslados t
join traslado_lineas tl on tl.traslado_id = t.id
join lotes l on l.id = tl.lote_id
where t.estado = 'en_transito';

comment on view v_stock_transito is 'Producto viajando entre bodegas. No cuenta como disponible, sí cuenta para el ATP.';


-- ============================================================================
--  3. DISPONIBILIDAD POR PRODUCTO Y BODEGA
--  Es la consulta que hace Ventas antes de cotizar.
-- ============================================================================
create or replace view v_disponibilidad as
select
  sp.id                              as sku_presentacion_id,
  sp.sku_id,
  s.codigo                           as sku_codigo,
  esp.nombre                         as especie,
  f.nombre                           as formato,
  s.corte,
  p.descripcion                      as presentacion,
  p.peso_bulto_kg,
  a.id                               as almacen_id,
  a.nombre                           as almacen,
  a.tipo                             as almacen_tipo,

  coalesce(sum(v.fisico_kg), 0)      as fisico_kg,
  coalesce(sum(v.bloqueado_kg), 0)   as bloqueado_kg,
  coalesce(sum(v.reservado_kg), 0)   as reservado_kg,
  coalesce(sum(v.preparacion_kg), 0) as preparacion_kg,
  coalesce(sum(v.disponible_kg), 0)  as disponible_kg,
  coalesce(sum(v.fisico_bultos), 0)  as fisico_bultos,
  -- Costo promedio ponderado por peso
  case when coalesce(sum(v.fisico_kg),0) > 0
       then sum(v.fisico_kg * v.costo_promedio) / sum(v.fisico_kg)
       else 0 end                    as costo_promedio,
  count(distinct v.lote_id)          as lotes

from sku_presentaciones sp
join skus s        on s.id = sp.sku_id
join especies esp  on esp.id = s.especie_id
join formatos f    on f.id = s.formato_id
join presentaciones p on p.id = sp.presentacion_id
cross join almacenes a
left join v_stock_lote v
       on v.sku_presentacion_id = sp.id and v.almacen_id = a.id
where a.activo
group by sp.id, sp.sku_id, s.codigo, esp.nombre, f.nombre, s.corte,
         p.descripcion, p.peso_bulto_kg, a.id, a.nombre, a.tipo
having coalesce(sum(v.fisico_kg), 0) > 0;

comment on view v_disponibilidad is 'Cuánto hay y cuánto se puede vender de cada producto en cada bodega.';


-- ============================================================================
--  4. COMPROMETIDO
--  Líneas de pedidos ya confirmados a las que todavía no se les asignó lote.
--  Es venta prometida sin respaldo físico asignado: hay que descontarla.
-- ============================================================================
create or replace view v_comprometido as
select
  pl.sku_presentacion_id,
  sum( greatest( pl.cantidad_tm * 1000
                 - coalesce(res.reservado_kg, 0), 0) ) as comprometido_kg
from pedido_lineas pl
join pedidos pe on pe.id = pl.pedido_id
left join lateral (
  select sum(r.peso_neto_kg) as reservado_kg
  from reservas r
  where r.pedido_linea_id = pl.id
    and r.estado in ('activa','en_preparacion','consumida')
) res on true
where pe.ciclo = 'confirmado'
group by pl.sku_presentacion_id;

comment on view v_comprometido is 'Venta comprometida sin lote asignado todavía. Se resta del disponible global.';


-- ============================================================================
--  5. ATP · AVAILABLE TO PROMISE
--  "¿Cuánto puedo prometer realmente a un pedido nuevo para la fecha F?"
--
--  Fórmula:
--     disponible actual
--   + lo que viene en tránsito y llega antes de F
--   − lo comprometido sin lote asignado
-- ============================================================================
create or replace function atp(
  p_sku_presentacion_id bigint,
  p_fecha date default null,
  p_almacen_id bigint default null
) returns numeric
language sql stable as $$
  with disp as (
    select coalesce(sum(disponible_kg), 0) as kg
      from v_disponibilidad
     where sku_presentacion_id = p_sku_presentacion_id
       and (p_almacen_id is null or almacen_id = p_almacen_id)
  ),
  trans as (
    select coalesce(sum(transito_kg), 0) as kg
      from v_stock_transito
     where sku_presentacion_id = p_sku_presentacion_id
       and (p_almacen_id is null or almacen_id = p_almacen_id)
       and (p_fecha is null or llegada_estimada <= p_fecha)
  ),
  comp as (
    select coalesce(sum(comprometido_kg), 0) as kg
      from v_comprometido
     where sku_presentacion_id = p_sku_presentacion_id
  )
  select greatest( (select kg from disp) + (select kg from trans) - (select kg from comp), 0 );
$$;
comment on function atp is 'Cuánto se puede prometer de verdad a una fecha, considerando tránsito y compromisos.';


-- ============================================================================
--  6. RESOLUCIÓN DE PRECIO
--  Orden de precedencia (de la reunión: "el precio es uno por cantidades y
--  dos por clientes"):
--    1º precio pactado con ese cliente para ese volumen
--    2º precio base para ese volumen
--    3º precio base sin escala
-- ============================================================================
create or replace function resolver_precio(
  p_sku_presentacion_id bigint,
  p_cliente_id bigint,
  p_cantidad_tm numeric,
  p_fecha date default current_date
) returns numeric
language sql stable as $$
  select pr.precio_tm
    from precios pr
    join listas_precio lp on lp.id = pr.lista_id
   where pr.sku_presentacion_id = p_sku_presentacion_id
     and pr.activo and lp.activo
     and lp.vigente_desde <= p_fecha
     and (lp.vigente_hasta is null or lp.vigente_hasta >= p_fecha)
     and pr.tm_desde <= p_cantidad_tm
     and (pr.tm_hasta is null or pr.tm_hasta >= p_cantidad_tm)
     and (pr.cliente_id = p_cliente_id or pr.cliente_id is null)
   -- El precio del cliente gana sobre el base; a igualdad, el de escala más alta
   order by (pr.cliente_id is not null) desc, pr.tm_desde desc, lp.vigente_desde desc
   limit 1;
$$;
comment on function resolver_precio is 'Devuelve el precio que corresponde según cliente, volumen y vigencia.';


-- ============================================================================
--  7. PARÁMETROS · lectura tipada
-- ============================================================================
create or replace function param_num(p_clave text, p_defecto numeric default 0)
returns numeric language sql stable as $$
  select coalesce((select valor::numeric from parametros where clave = p_clave), p_defecto);
$$;

create or replace function param_txt(p_clave text, p_defecto text default '')
returns text language sql stable as $$
  select coalesce((select valor from parametros where clave = p_clave), p_defecto);
$$;


-- ============================================================================
--  8. MÁQUINA DE ESTADOS · TRASLADO EN TRES PASOS
--  Requisito directo de Marco León en la reunión.
-- ============================================================================

-- PASO 1 · Autorizar (solo gerencia u operaciones)
create or replace function traslado_autorizar(p_traslado_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare t traslados%rowtype;
begin
  select * into t from traslados where id = p_traslado_id for update;
  if not found then raise exception 'Traslado % no existe', p_traslado_id; end if;
  if t.estado <> 'borrador' then
    raise exception 'Solo se puede autorizar un traslado en borrador (estado actual: %)', t.estado;
  end if;
  if not exists (select 1 from traslado_lineas where traslado_id = p_traslado_id) then
    raise exception 'No se puede autorizar un traslado sin líneas de producto';
  end if;

  update traslados
     set estado = 'autorizado', autorizado_por = auth.uid(), autorizado_en = now()
   where id = p_traslado_id;

  perform registrar_evento('traslado', p_traslado_id, 'traslado_autorizado',
    format('Traslado %s autorizado', t.numero), 'info');
end;
$$;

-- PASO 2 · Despachar: el producto SALE del origen (se escribe en el Kardex)
create or replace function traslado_despachar(p_traslado_id bigint, p_guia text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  t traslados%rowtype;
  ln record;
  v_disp numeric;
begin
  select * into t from traslados where id = p_traslado_id for update;
  if not found then raise exception 'Traslado % no existe', p_traslado_id; end if;
  if t.estado <> 'autorizado' then
    raise exception 'El traslado debe estar autorizado antes de despacharse (estado actual: %)', t.estado;
  end if;

  -- Validación: no se puede sacar más de lo que hay disponible
  for ln in select * from traslado_lineas where traslado_id = p_traslado_id loop
    select coalesce(disponible_kg, 0) into v_disp
      from v_stock_lote
     where lote_id = ln.lote_id and almacen_id = t.almacen_origen_id;
    if coalesce(v_disp,0) < ln.peso_enviado_kg then
      raise exception 'El lote % no tiene suficiente stock disponible en el almacén de origen (disponible: % kg, solicitado: % kg)',
        ln.lote_id, coalesce(v_disp,0), ln.peso_enviado_kg;
    end if;
  end loop;

  -- Kardex: salida del origen
  for ln in select * from traslado_lineas where traslado_id = p_traslado_id loop
    insert into movimientos (tipo, lote_id, almacen_id, bultos, peso_neto_kg,
                             costo_unitario, documento_tipo, documento_id, documento_ref, usuario_id)
    select 'traslado_salida', ln.lote_id, t.almacen_origen_id, ln.bultos_enviados, ln.peso_enviado_kg,
           coalesce(e.costo_promedio, 0), 'traslado', p_traslado_id, coalesce(p_guia, t.guia_numero), auth.uid()
      from existencias e
     where e.lote_id = ln.lote_id and e.almacen_id = t.almacen_origen_id;
  end loop;

  update traslados
     set estado = 'en_transito', despachado_por = auth.uid(), despachado_en = now(),
         guia_numero = coalesce(p_guia, guia_numero)
   where id = p_traslado_id;

  perform registrar_evento('traslado', p_traslado_id, 'traslado_despachado',
    format('Traslado %s despachado con guía %s', t.numero, coalesce(p_guia, t.guia_numero, 's/g')), 'info');
end;
$$;

-- PASO 3 · Aceptar en destino: el producto ENTRA (segunda firma)
create or replace function traslado_aceptar(p_traslado_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  t traslados%rowtype;
  ln record;
  v_difs int := 0;
begin
  select * into t from traslados where id = p_traslado_id for update;
  if not found then raise exception 'Traslado % no existe', p_traslado_id; end if;
  if t.estado <> 'en_transito' then
    raise exception 'Solo se puede aceptar un traslado en tránsito (estado actual: %)', t.estado;
  end if;

  for ln in select * from traslado_lineas where traslado_id = p_traslado_id loop
    -- Si nadie declaró lo recibido, se asume que llegó todo
    if ln.bultos_aceptados is null then
      update traslado_lineas
         set bultos_aceptados = ln.bultos_enviados,
             peso_aceptado_kg = ln.peso_enviado_kg
       where id = ln.id;
      ln.bultos_aceptados := ln.bultos_enviados;
      ln.peso_aceptado_kg := ln.peso_enviado_kg;
    end if;

    -- Kardex: ingreso en destino por lo REALMENTE aceptado
    if ln.bultos_aceptados > 0 then
      insert into movimientos (tipo, lote_id, almacen_id, bultos, peso_neto_kg,
                               costo_unitario, documento_tipo, documento_id, documento_ref, usuario_id)
      select 'traslado_ingreso', ln.lote_id, t.almacen_destino_id, ln.bultos_aceptados, ln.peso_aceptado_kg,
             coalesce(e.costo_promedio, 0), 'traslado', p_traslado_id, t.guia_numero, auth.uid()
        from existencias e
       where e.lote_id = ln.lote_id and e.almacen_id = t.almacen_origen_id
       limit 1;
    end if;

    -- Discrepancia: llegó menos de lo enviado
    if ln.peso_aceptado_kg < ln.peso_enviado_kg then
      v_difs := v_difs + 1;
      perform registrar_evento('traslado', p_traslado_id, 'discrepancia_traslado',
        format('Discrepancia en lote %s: enviados %s kg, aceptados %s kg. Requiere ajuste autorizado.',
               ln.lote_id, ln.peso_enviado_kg, ln.peso_aceptado_kg), 'critica',
        jsonb_build_object('lote_id', ln.lote_id,
                           'enviado_kg', ln.peso_enviado_kg,
                           'aceptado_kg', ln.peso_aceptado_kg));
    end if;
  end loop;

  update traslados
     set estado = 'aceptado', aceptado_por = auth.uid(), aceptado_en = now()
   where id = p_traslado_id;

  perform registrar_evento('traslado', p_traslado_id, 'traslado_aceptado',
    format('Traslado %s aceptado en destino%s', t.numero,
           case when v_difs > 0 then format(' con %s discrepancia(s)', v_difs) else '' end),
    case when v_difs > 0 then 'critica' else 'info' end);
end;
$$;


-- ============================================================================
--  9. CICLO DE VIDA DE LA RESERVA
-- ============================================================================

-- Crear reserva validando que haya stock disponible en ese lote
create or replace function reserva_crear(
  p_pedido_linea_id bigint, p_lote_id bigint, p_almacen_id bigint,
  p_bultos int, p_peso_kg numeric
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_disp numeric;
  v_id bigint;
  v_dias numeric;
begin
  -- Validación 1: el lote no puede estar bloqueado por calidad
  if lote_bloqueado(p_lote_id) then
    raise exception 'El lote % tiene una observación de calidad abierta y no se puede reservar', p_lote_id;
  end if;

  -- Validación 2: tiene que haber stock disponible suficiente
  select coalesce(disponible_kg, 0) into v_disp
    from v_stock_lote where lote_id = p_lote_id and almacen_id = p_almacen_id;
  if coalesce(v_disp, 0) < p_peso_kg then
    raise exception 'Stock insuficiente en el lote %: disponible % kg, solicitado % kg',
      p_lote_id, coalesce(v_disp,0), p_peso_kg;
  end if;

  -- El plazo de vencimiento es un parámetro configurable por el cliente
  v_dias := param_num('reserva_dias_vencimiento', 15);

  insert into reservas (pedido_linea_id, lote_id, almacen_id, bultos, peso_neto_kg,
                        estado, vence_el, creado_por)
  values (p_pedido_linea_id, p_lote_id, p_almacen_id, p_bultos, p_peso_kg,
          'activa', now() + (v_dias || ' days')::interval, auth.uid())
  returning id into v_id;

  perform registrar_evento('reserva', v_id, 'reserva_creada',
    format('Reserva de %s kg del lote %s', p_peso_kg, p_lote_id), 'info',
    jsonb_build_object('lote_id', p_lote_id, 'almacen_id', p_almacen_id, 'peso_kg', p_peso_kg));

  return v_id;
end;
$$;

-- Liberar reserva: EXIGE motivo. Es el punto crítico número uno del negocio.
create or replace function reserva_liberar(p_reserva_id bigint, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare r reservas%rowtype;
begin
  if p_motivo is null or length(trim(p_motivo)) < 5 then
    raise exception 'Debe indicar un motivo de al menos 5 caracteres para liberar una reserva';
  end if;

  select * into r from reservas where id = p_reserva_id for update;
  if not found then raise exception 'La reserva % no existe', p_reserva_id; end if;
  if r.estado not in ('activa','en_preparacion') then
    raise exception 'Solo se pueden liberar reservas activas o en preparación (estado actual: %)', r.estado;
  end if;

  update reservas
     set estado = 'liberada', liberado_por = auth.uid(), liberado_en = now(),
         motivo_liberacion = p_motivo
   where id = p_reserva_id;

  perform registrar_evento('reserva', p_reserva_id, 'reserva_liberada',
    format('Reserva liberada: %s', p_motivo), 'advertencia',
    jsonb_build_object('lote_id', r.lote_id, 'peso_kg', r.peso_neto_kg, 'motivo', p_motivo));
end;
$$;

-- Expiración automática: se ejecuta periódicamente y suelta lo que nadie usó.
-- ESTA es la función que elimina el problema de las "reservas fantasma".
create or replace function reservas_expirar_vencidas()
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  with vencidas as (
    update reservas
       set estado = 'expirada', liberado_en = now(),
           motivo_liberacion = 'Vencimiento automático del plazo de reserva'
     where estado = 'activa' and vence_el is not null and vence_el < now()
    returning id, lote_id, peso_neto_kg
  )
  select count(*) into v_n from vencidas;

  if v_n > 0 then
    insert into alertas (entidad, entidad_id, severidad, titulo, mensaje)
    values ('reserva', 0, 'advertencia', 'Reservas expiradas',
            format('Se liberaron automáticamente %s reservas vencidas. El stock volvió a estar disponible.', v_n));
  end if;
  return v_n;
end;
$$;
comment on function reservas_expirar_vencidas is 'Libera reservas vencidas. Resuelve el problema del producto apartado que nadie llevó.';


-- ============================================================================
--  10. GENERACIÓN DEL PLANO DE ESTIBA
--  Reproduce el algoritmo del archivo PLANO_POT_761:
--  se ordenan los lotes por fecha de producción (el más viejo sale primero) y
--  se van llenando las filas del contenedor una tras otra.
-- ============================================================================
create or replace function generar_plano_estiba(p_packing_list_id bigint)
returns int language plpgsql security definer set search_path = public as $$
declare
  pk packing_lists%rowtype;
  ln record;
  v_fila int := 1;
  v_cupo int;
  v_restante int;
  v_n int;
  v_filas_usadas int := 0;
begin
  select * into pk from packing_lists where id = p_packing_list_id;
  if not found then raise exception 'Packing list % no existe', p_packing_list_id; end if;
  if pk.estado = 'cerrado' then
    raise exception 'El packing list ya está cerrado y no se puede regenerar';
  end if;

  -- Se rehace desde cero
  delete from plano_estiba where packing_list_id = p_packing_list_id;

  v_cupo := pk.sacos_por_fila;

  -- FIFO: el lote más antiguo se carga primero
  for ln in
    select pl.lote_id, pl.bultos, l.fecha_produccion
      from packing_lineas pl
      join lotes l on l.id = pl.lote_id
     where pl.packing_list_id = p_packing_list_id
     order by l.fecha_produccion asc, pl.lote_id asc
  loop
    v_restante := ln.bultos;
    while v_restante > 0 loop
      if v_fila > pk.filas_contenedor then
        raise exception 'La carga excede la capacidad del contenedor (% filas de % sacos)',
          pk.filas_contenedor, pk.sacos_por_fila;
      end if;
      v_n := least(v_restante, v_cupo);

      insert into plano_estiba (packing_list_id, lote_id, fila, sacos)
      values (p_packing_list_id, ln.lote_id, v_fila, v_n)
      on conflict (packing_list_id, lote_id, fila)
        do update set sacos = plano_estiba.sacos + excluded.sacos;

      v_restante := v_restante - v_n;
      v_cupo := v_cupo - v_n;
      if v_cupo = 0 then
        v_fila := v_fila + 1;
        v_cupo := pk.sacos_por_fila;
      end if;
    end loop;
  end loop;

  v_filas_usadas := case when v_cupo = pk.sacos_por_fila then v_fila - 1 else v_fila end;

  perform registrar_evento('packing_list', p_packing_list_id, 'plano_generado',
    format('Plano de estiba generado: %s filas utilizadas', v_filas_usadas), 'info');

  return v_filas_usadas;
end;
$$;
comment on function generar_plano_estiba is 'Reparte los lotes en las filas del contenedor con criterio FIFO. Reproduce el PLANO_POT_761.';


-- ============================================================================
--  11. EJECUTAR DESPACHO
--  Es el momento en que la venta se cierra: el producto sale del almacén,
--  se consume la reserva y se escribe en el Kardex.
-- ============================================================================
create or replace function ejecutar_despacho(p_packing_list_id bigint, p_numero text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  pk packing_lists%rowtype;
  emb embarques%rowtype;
  ln record;
  v_despacho_id bigint;
begin
  select * into pk from packing_lists where id = p_packing_list_id for update;
  if not found then raise exception 'Packing list % no existe', p_packing_list_id; end if;
  if pk.estado = 'cerrado' then raise exception 'El packing list ya fue despachado'; end if;

  select * into emb from embarques where id = pk.embarque_id;

  -- Validación: tiene que existir el plano de estiba
  if not exists (select 1 from plano_estiba where packing_list_id = p_packing_list_id) then
    raise exception 'No se puede despachar sin plano de estiba generado';
  end if;

  insert into despachos (packing_list_id, numero, almacen_id, encargado_id, creado_por)
  values (p_packing_list_id, p_numero, emb.almacen_id, pk.supervisor_id, auth.uid())
  returning id into v_despacho_id;

  -- Kardex: salida por venta de cada lote cargado
  for ln in select * from packing_lineas where packing_list_id = p_packing_list_id loop
    insert into movimientos (tipo, lote_id, almacen_id, bultos, peso_neto_kg, costo_unitario,
                             documento_tipo, documento_id, documento_ref, usuario_id)
    select 'salida_despacho', ln.lote_id, emb.almacen_id, ln.bultos, ln.peso_neto_kg,
           coalesce(e.costo_promedio, 0), 'despacho', v_despacho_id, p_numero, auth.uid()
      from existencias e
     where e.lote_id = ln.lote_id and e.almacen_id = emb.almacen_id;

    -- La reserva se consume: deja de bloquear stock
    update reservas
       set estado = 'consumida'
     where lote_id = ln.lote_id
       and almacen_id = emb.almacen_id
       and estado in ('activa','en_preparacion');
  end loop;

  update packing_lists set estado = 'cerrado' where id = p_packing_list_id;
  update embarques set estado = 'despachado' where id = pk.embarque_id;

  perform registrar_evento('despacho', v_despacho_id, 'despacho_ejecutado',
    format('Despacho %s ejecutado desde packing %s', p_numero, pk.codigo), 'info');

  return v_despacho_id;
end;
$$;


-- ============================================================================
--  12. RECÁLCULO DE COBERTURA DEL PEDIDO
--  El eje "cobertura" no se edita a mano: se deduce del estado de las reservas.
-- ============================================================================
create or replace function recalcular_cobertura_pedido(p_pedido_id bigint)
returns cobertura_pedido
language plpgsql security definer set search_path = public as $$
declare
  v_pedido_kg numeric;
  v_reservado_kg numeric;
  v_preparacion_kg numeric;
  v_consumido_kg numeric;
  v_nueva cobertura_pedido;
begin
  select coalesce(sum(cantidad_tm * 1000), 0) into v_pedido_kg
    from pedido_lineas where pedido_id = p_pedido_id;

  select coalesce(sum(case when r.estado = 'activa'         then r.peso_neto_kg else 0 end), 0),
         coalesce(sum(case when r.estado = 'en_preparacion' then r.peso_neto_kg else 0 end), 0),
         coalesce(sum(case when r.estado = 'consumida'      then r.peso_neto_kg else 0 end), 0)
    into v_reservado_kg, v_preparacion_kg, v_consumido_kg
    from reservas r
    join pedido_lineas pl on pl.id = r.pedido_linea_id
   where pl.pedido_id = p_pedido_id;

  if v_pedido_kg = 0 then
    v_nueva := 'pendiente_stock';
  elsif v_consumido_kg >= v_pedido_kg then
    v_nueva := 'preparado';
  elsif v_preparacion_kg > 0 then
    v_nueva := 'en_preparacion';
  elsif (v_reservado_kg + v_consumido_kg) >= v_pedido_kg then
    v_nueva := 'reservado';
  elsif (v_reservado_kg + v_consumido_kg) > 0 then
    v_nueva := 'parcialmente_disponible';
  else
    v_nueva := 'pendiente_stock';
  end if;

  update pedidos set cobertura = v_nueva, actualizado_en = now() where id = p_pedido_id;
  return v_nueva;
end;
$$;

-- Cada vez que cambia una reserva, se recalcula la cobertura del pedido
create or replace function trg_reserva_recalcula_pedido() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pedido_id bigint;
begin
  select pl.pedido_id into v_pedido_id
    from pedido_lineas pl
   where pl.id = coalesce(new.pedido_linea_id, old.pedido_linea_id);
  if v_pedido_id is not null then
    perform recalcular_cobertura_pedido(v_pedido_id);
  end if;
  return coalesce(new, old);
end;
$$;

create trigger trg_reservas_cobertura
  after insert or update or delete on reservas
  for each row execute function trg_reserva_recalcula_pedido();
