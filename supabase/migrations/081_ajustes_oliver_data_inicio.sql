-- ============================================================================
--  081 · AJUSTES DE OLIVER TELLO TRAS REVISAR LA DATA DE INICIO
-- ============================================================================
--  Re-ejecutable: `if not exists`, `create or replace`, y cada corrección de
--  datos solo toca lo que todavía está como antes (una segunda pasada no
--  cambia nada).
--
--   1. ALMACENES DE TRÁNSITO. Exalmar y Peruvian «son los de compra y venta, no
--      tienen una capacidad específica». Se marcan como de tránsito: no tienen
--      capacidad (la base lo exige) y no se les calcula ocupación (salen de
--      v_ocupabilidad: ni en el panel ni en el reporte de ocupabilidad).
--   2. ORDEN DE LOS ALMACENES. Un campo «orden» editable en Configuración ›
--      Maestros › Almacenes. Las listas y desplegables ordenan por él y luego
--      por nombre: Santa Mónica · Cámara 01, 02, 03, Freeko, Depsa, Perufrost
--      y luego los demás por nombre.
--   3. CLIENTES ANOTADOS EN LOS SALDOS. La carga inicial (080) escribió en las
--      observaciones de 45 lotes (118 filas de DATA) «Cliente anotado en la
--      base anterior: …». Oliver: son saldos de un despacho anterior; el
--      cliente se pone cuando se jale para despacho. Se quita SOLO esa frase,
--      con el texto exacto que escribió la carga; el resto del lote no cambia.
--   4. TODO EN DÓLARES. Los clientes en soles pasan a USD, y la lista de precio
--      «Mercado nacional 2026» también (sus precios se pasan a dólares con el
--      tipo de cambio con que se armaron: 3.75; quedan en el 85 % de la lista
--      FOB, como estaban). Las cuentas bancarias en soles NO se tocan: la de
--      detracción (Banco de la Nación) es en soles por ley y la otra sirve para
--      cobrar en soles a un cliente nacional que lo pida.
--   5. LÍNEA DE CRÉDITO. Se vacía en todos los clientes («sin definir»: la
--      columna pasa a admitir NULL) y solo la fija quien tiene el permiso
--      personal «Línea de crédito» (usuarios.fija_credito), que da o quita
--      Gerencia. Hoy, solo Cathy Lee. Bloquear y desbloquear sigue siendo de
--      Gerencia y Operaciones.
-- ============================================================================


-- ============================================================================
--  1 y 2 · ALMACENES: DE TRÁNSITO Y ORDEN
-- ============================================================================
alter table almacenes add column if not exists es_transito boolean not null default false;
comment on column almacenes.es_transito is
  'Almacén de tránsito (compra y venta, p. ej. Exalmar y Peruvian): no tiene capacidad y no se le calcula ocupación (081).';

alter table almacenes add column if not exists orden integer not null default 100;
comment on column almacenes.orden is
  'Posición en las listas y desplegables de almacenes (menor primero; a igual orden, por nombre). Se edita en Configuración › Maestros › Almacenes (081).';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'almacenes_transito_sin_capacidad') then
    --  Primero se vacía la capacidad de los de tránsito (abajo se marcan).
    update almacenes set capacidad_tm = null where es_transito and capacidad_tm is not null;
    alter table almacenes add constraint almacenes_transito_sin_capacidad
      check (not es_transito or capacidad_tm is null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'almacenes_orden_rango') then
    alter table almacenes add constraint almacenes_orden_rango check (orden between 0 and 999);
  end if;
end $$;

--  Exalmar y Peruvian: de tránsito, sin capacidad. Solo si aún no lo están.
update almacenes set es_transito = true, capacidad_tm = null
 where codigo in ('EXALMAR', 'PERUVIAN') and not es_transito;

--  El orden inicial que pidió Oliver. Solo se pone si el almacén sigue con el
--  valor por defecto (100): si alguien ya lo cambió en el maestro, se respeta.
update almacenes a set orden = v.orden
  from (values ('STM-C1', 10), ('STM-C2', 20), ('STM-C3', 30),
               ('FREEKO', 40), ('DEPSA', 50), ('PERUFR', 60)) as v(codigo, orden)
 where a.codigo = v.codigo and a.orden = 100;

/*
 * Ocupabilidad: la misma vista (010) sin los almacenes de tránsito y con el
 * orden del maestro al final (una vista solo admite columnas nuevas al final).
 */
create or replace view v_ocupabilidad as
 select a.id as almacen_id,
        a.codigo,
        a.nombre as almacen,
        a.tipo,
        a.capacidad_tm,
        coalesce(sum(v.fisico_kg), 0::numeric) / 1000::numeric as ocupado_tm,
        coalesce(sum(v.disponible_kg), 0::numeric) / 1000::numeric as disponible_tm,
        coalesce(sum(v.reservado_kg + v.preparacion_kg), 0::numeric) / 1000::numeric as comprometido_tm,
        coalesce(sum(v.bloqueado_kg), 0::numeric) / 1000::numeric as bloqueado_tm,
        case
          when a.capacidad_tm > 0::numeric
          then least(999::numeric, coalesce(sum(v.fisico_kg), 0::numeric) / 1000::numeric / a.capacidad_tm * 100::numeric)
          else null::numeric
        end as ocupabilidad_pct,
        count(distinct v.lote_id) as lotes,
        a.orden
   from almacenes a
   left join v_stock_lote v on v.almacen_id = a.id
  where a.activo and not a.es_transito
  group by a.id, a.codigo, a.nombre, a.tipo, a.capacidad_tm, a.orden;


-- ============================================================================
--  3 · EL CLIENTE ANOTADO EN LOS SALDOS DE LA CARGA INICIAL
-- ============================================================================
--  Las tres frases exactas que escribió la carga (scratchpad\c80\armar.mjs):
--  « Cliente anotado en la base anterior: <CLIENTE>.» después del motivo de
--  ingreso. Solo en lotes de la carga inicial (sus observaciones empiezan con
--  «Inventario inicial desde DATA 2025»).
update lotes
   set observaciones = btrim(replace(replace(replace(observaciones,
         ' Cliente anotado en la base anterior: KULALIA S.L..', ''),
         ' Cliente anotado en la base anterior: PESCIRO ASIA INTERNACIONAL LTD..', ''),
         ' Cliente anotado en la base anterior: BUENO FOOD CORPORATION LIMITED.', ''))
 where observaciones like 'Inventario inicial desde DATA 2025%'
   and observaciones like '%Cliente anotado en la base anterior: %';


-- ============================================================================
--  4 · TODO EN DÓLARES
-- ============================================================================
update clientes set moneda = 'USD' where moneda <> 'USD';

--  La lista nacional: sus precios estaban en soles (= FOB × 0.85 × 3.75). Se
--  pasan a dólares con ese mismo 3.75, y se cambia la moneda en la MISMA
--  sentencia que la condición: si ya está en USD, no se vuelve a dividir.
with lista as (
  update listas_precio set moneda = 'USD'
   where moneda <> 'USD'
  returning id
)
update precios p set precio_tm = round(p.precio_tm / 3.75, 4)
  from lista l
 where p.lista_id = l.id;

update parametros
   set descripcion = 'Todo se cotiza y se vende en dólares (pedido de Operaciones, 081): clientes, listas de precio, cotizaciones y pedidos nacen en USD. '
                  || 'Los soles quedan para lo legal: la cuenta de detracción y el comprobante nacional en soles si un cliente lo pide.'
 where clave = 'moneda_defecto';


-- ============================================================================
--  5 · LÍNEA DE CRÉDITO: SIN DEFINIR, Y SOLO LA FIJA QUIEN TIENE EL PERMISO
-- ============================================================================
--  «Sin definir» es NULL. 0 sigue siendo un valor válido: «no se le fía».
--  Ninguna regla, alerta ni bloqueo automático mira la línea: la ficha del
--  cliente la enseña («Sin línea asignada») y nada más.
alter table clientes alter column linea_credito drop not null;
alter table clientes alter column linea_credito drop default;

--  Una sola vez, la primera pasada (la marca es que el permiso todavía no
--  existe): se vacían las líneas, se crea el permiso y se le da a Cathy Lee y
--  a nadie más. En una segunda pasada no se borran las líneas que ella haya
--  fijado después ni se deshace lo que Gerencia haya cambiado.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'usuarios' and column_name = 'fija_credito') then
    update clientes set linea_credito = null where linea_credito is not null;
    alter table usuarios add column fija_credito boolean not null default false;
    update usuarios set fija_credito = true where lower(email) = 'clee@santamonicafishing.com';
  end if;
end $$;

comment on column usuarios.fija_credito is
  'Permiso personal «Línea de crédito»: puede fijar o cambiar la línea de crédito de un cliente. Lo da o lo quita Gerencia (081). Hoy, Cathy Lee.';

create or replace function puede_fijar_credito() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select fija_credito and activo from usuarios where id = auth.uid()), false);
$$;
revoke all on function puede_fijar_credito() from public, anon;
grant execute on function puede_fijar_credito() to authenticated;

/*
 * El guardián del cliente (076), con la línea separada del bloqueo:
 *   · la línea de crédito → solo quien tiene el permiso «Línea de crédito»;
 *   · bloquear / desbloquear → Gerencia u Operaciones, como antes.
 * Los procesos del sistema (sin usuario) pasan.
 */
create or replace function clientes_proteger_credito()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.linea_credito is not null and not puede_fijar_credito() then
      raise exception 'La línea de crédito la fija quien tiene el permiso «Línea de crédito». Cree el cliente con la línea sin definir y pídale que la asigne.'
        using errcode = 'insufficient_privilege';
    end if;
    if coalesce(new.bloqueado, false) and not puede('gerencia', 'operaciones') then
      raise exception 'El bloqueo del cliente lo fijan Gerencia u Operaciones. Cree el cliente sin bloqueo y pídales que lo bloqueen.'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if new.linea_credito is distinct from old.linea_credito and not puede_fijar_credito() then
    raise exception 'La línea de crédito la fija quien tiene el permiso «Línea de crédito» (lo asigna Gerencia en Configuración › Usuarios y roles).'
      using errcode = 'insufficient_privilege';
  end if;
  if (new.bloqueado is distinct from old.bloqueado
      or (new.bloqueado and new.motivo_bloqueo is distinct from old.motivo_bloqueo))
     and not puede('gerencia', 'operaciones') then
    raise exception 'Bloquear o desbloquear un cliente lo hacen Gerencia u Operaciones.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

/*
 * El guardián de la ficha del usuario (070), con el permiso nuevo en la lista
 * de lo que solo cambia Gerencia.
 */
create or replace function public.usuarios_proteger_permisos()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_quien uuid := auth.uid();
  v_rol   rol_usuario;
begin
  if v_quien is null then
    return new;
  end if;
  select rol into v_rol from usuarios where id = v_quien;

  if (new.rol, new.activo, new.almacen_id, new.aprueba_cotizaciones, new.carga_costos, new.fija_credito)
     is distinct from (old.rol, old.activo, old.almacen_id, old.aprueba_cotizaciones, old.carga_costos, old.fija_credito)
     and v_rol is distinct from 'gerencia' then
    raise exception 'Solo Gerencia puede cambiar el rol, el estado, el almacén o los permisos de aprobar, de cargar costos y de línea de crédito de un usuario.';
  end if;

  if new.ve_objetivos is distinct from old.ve_objetivos
     and not coalesce((select ve_objetivos from usuarios where id = v_quien), false) then
    raise exception 'Solo quien ya tiene acceso a Objetivos mensuales puede darlo o quitarlo.';
  end if;

  if new.debe_cambiar_clave is distinct from old.debe_cambiar_clave
     and v_rol is distinct from 'gerencia'
     and coalesce(current_setting('sm.clave_cambiada', true), '') <> 'si' then
    raise exception 'El aviso de cambio de contraseña solo se apaga cambiando la contraseña.';
  end if;

  return new;
end $function$;
