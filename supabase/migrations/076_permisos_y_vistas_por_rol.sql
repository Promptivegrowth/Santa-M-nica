-- ============================================================================
--  076 · PERMISOS Y VISTAS POR ROL (ronda «pedidos de Oliver»)
-- ============================================================================
--  Redactores que recorrieron la aplicación con cada rol encontraron botones
--  que la pantalla ofrecía y la base rechazaba con su mensaje técnico, y reglas
--  que solo vivían en la pantalla. Aquí, la parte que le toca a la base:
--
--    1. APARTAR STOCK. La política de `reservas` dejaba escribir a Gerencia,
--       Operaciones, Comercial y Comercio Exterior; la pantalla y el servidor,
--       a Gerencia, Operaciones, Comercial y Almacén. Almacén veía «Apartar
--       stock» y recibía «new row violates row-level security policy». Queda
--       UNA lista (la de src/lib/permisosVentas.ts → ROLES_APARTAN_STOCK):
--       Gerencia, Operaciones, Comercial y Almacén. Comercio Exterior sale: ni
--       la pantalla ni el servidor le dejaban apartar, y la guía tampoco.
--       Modificar o borrar una reserva directamente queda en Gerencia y
--       Operaciones: liberar, consumir, expirar o mudarla de bodega lo hacen
--       funciones SECURITY DEFINER con sus propias reglas (reserva_liberar
--       exige ser quien la apartó, o Gerencia u Operaciones).
--
--    2. CRÉDITO DEL CLIENTE. Bloquear, desbloquear y cambiar la línea de
--       crédito es control financiero: Gerencia y Operaciones. Comercial sigue
--       editando el resto de la ficha. Un disparador lo exige (la política de
--       la tabla es por fila, no por columna).
--
--    3. FACTURAR SOLO LO CONFIRMADO. Se podía emitir el comprobante de un
--       pedido «pendiente de validación». Ahora la base exige que el pedido
--       esté confirmado (o ya despachado o cerrado).
--
--    4. EL CONTROL TOWER SIN DÓLARES. Almacén y Calidad ven toneladas y
--       cantidades: la vista de indicadores suma las toneladas de los pedidos
--       en riesgo (columna nueva al final, `tm_en_riesgo`).
--
--  Re-ejecutable: `drop policy if exists`, `create or replace`, bloques DO.
-- ============================================================================


-- ============================================================================
--  1 · RESERVAS: UNA SOLA LISTA PARA APARTAR
-- ============================================================================
drop policy if exists escritura_comercial on reservas;
drop policy if exists reservas_apartar on reservas;
drop policy if exists reservas_modificar on reservas;
drop policy if exists reservas_borrar on reservas;

-- Apartar (insertar): los cuatro roles que atienden las reservas de un pedido.
create policy reservas_apartar on reservas
  for insert to authenticated
  with check (puede('gerencia', 'operaciones', 'comercial', 'almacen'));

-- Tocar una reserva a mano: solo Gerencia y Operaciones. El resto de cambios
-- (liberar, consumir al despachar, expirar, mudar de bodega) los hacen
-- funciones SECURITY DEFINER que no pasan por esta política.
create policy reservas_modificar on reservas
  for update to authenticated
  using (puede('gerencia', 'operaciones'))
  with check (puede('gerencia', 'operaciones'));

create policy reservas_borrar on reservas
  for delete to authenticated
  using (puede('gerencia', 'operaciones'));

comment on policy reservas_apartar on reservas is
  '076 · Apartan stock Gerencia, Operaciones, Comercial y Almacén (misma lista que ROLES_APARTAN_STOCK en la aplicación).';


-- ============================================================================
--  2 · CLIENTES: BLOQUEO Y LÍNEA DE CRÉDITO, DE GERENCIA Y OPERACIONES
-- ============================================================================
create or replace function clientes_proteger_credito()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Los procesos del sistema (sin usuario) y Gerencia u Operaciones, libres.
  if auth.uid() is null or puede('gerencia', 'operaciones') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.linea_credito, 0) <> 0 or coalesce(new.bloqueado, false) then
      raise exception 'La línea de crédito y el bloqueo del cliente los fijan Gerencia u Operaciones. Cree el cliente sin línea y sin bloqueo, y pídales que la asignen.'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if new.linea_credito is distinct from old.linea_credito then
    raise exception 'Cambiar la línea de crédito de un cliente lo hacen Gerencia u Operaciones.'
      using errcode = 'insufficient_privilege';
  end if;
  if new.bloqueado is distinct from old.bloqueado
     or (new.bloqueado and new.motivo_bloqueo is distinct from old.motivo_bloqueo) then
    raise exception 'Bloquear o desbloquear un cliente lo hacen Gerencia u Operaciones.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

revoke execute on function clientes_proteger_credito() from public, anon;

drop trigger if exists trg_clientes_proteger_credito on clientes;
create trigger trg_clientes_proteger_credito
  before insert or update on clientes
  for each row execute function clientes_proteger_credito();


-- ============================================================================
--  3 · FACTURAS: SOLO DE UN PEDIDO CONFIRMADO
-- ============================================================================
create or replace function facturas_exigir_pedido_confirmado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ciclo ciclo_pedido;
  v_numero text;
begin
  if auth.uid() is null or new.pedido_id is null then
    return new;
  end if;

  select ciclo, numero_proforma into v_ciclo, v_numero from pedidos where id = new.pedido_id;

  if v_ciclo = 'cancelado' then
    raise exception 'El pedido % está cancelado: no se le emite comprobante.', v_numero;
  end if;
  if v_ciclo is null or v_ciclo not in ('confirmado', 'despachado', 'cerrado') then
    raise exception 'Primero Gerencia u Operaciones debe confirmar el pedido %: todavía está %.',
      v_numero, replace(coalesce(v_ciclo::text, 'sin ciclo'), '_', ' ');
  end if;
  return new;
end $$;

revoke execute on function facturas_exigir_pedido_confirmado() from public, anon;

drop trigger if exists trg_facturas_pedido_confirmado on facturas;
create trigger trg_facturas_pedido_confirmado
  before insert on facturas
  for each row execute function facturas_exigir_pedido_confirmado();


-- ============================================================================
--  4 · INDICADORES: LAS TONELADAS DE LOS PEDIDOS EN RIESGO
-- ============================================================================
--  La misma vista de la 021, con una columna más AL FINAL (una vista solo
--  admite columnas nuevas al final). Es lo que el Control Tower enseña a
--  quien no ve importes, en lugar de «US$ en juego».
create or replace view v_kpi_ventas as
 WITH valor_pedidos AS (
         SELECT p.id,
            p.ciclo,
            p.cobertura,
            p.situacion,
            p.moneda,
            p.fecha_solicitada,
            p.fecha_comprometida,
            p.cliente_id,
            p.prioridad,
            a_dolares(sum(((pl.cantidad_tm * pl.precio_tm) * ((1)::numeric - (pl.descuento_pct / (100)::numeric)))), p.moneda, p.tipo_cambio) AS venta,
            sum((pl.cantidad_tm * pl.costo_estimado_tm)) AS costo,
            sum(pl.cantidad_tm) AS tm
           FROM (pedidos p
             JOIN pedido_lineas pl ON ((pl.pedido_id = p.id)))
          GROUP BY p.id
        )
 SELECT COALESCE(sum(
        CASE
            WHEN (ciclo = 'confirmado'::ciclo_pedido) THEN venta
            ELSE (0)::numeric
        END), (0)::numeric) AS venta_comprometida,
    COALESCE(sum(
        CASE
            WHEN ((ciclo = ANY (ARRAY['despachado'::ciclo_pedido, 'cerrado'::ciclo_pedido])) AND (fecha_solicitada >= date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone))) THEN venta
            ELSE (0)::numeric
        END), (0)::numeric) AS venta_mes,
    COALESCE(sum(
        CASE
            WHEN (ciclo = ANY (ARRAY['despachado'::ciclo_pedido, 'cerrado'::ciclo_pedido])) THEN venta
            ELSE (0)::numeric
        END), (0)::numeric) AS venta_acumulada,
    COALESCE(sum(
        CASE
            WHEN (ciclo = ANY (ARRAY['confirmado'::ciclo_pedido, 'pendiente_validacion'::ciclo_pedido])) THEN venta
            ELSE (0)::numeric
        END), (0)::numeric) AS backlog,
    count(*) FILTER (WHERE ((ciclo = 'confirmado'::ciclo_pedido) AND (cobertura = ANY (ARRAY['pendiente_stock'::cobertura_pedido, 'parcialmente_disponible'::cobertura_pedido])))) AS pedidos_en_riesgo,
    COALESCE(sum(venta) FILTER (WHERE ((ciclo = 'confirmado'::ciclo_pedido) AND (cobertura = ANY (ARRAY['pendiente_stock'::cobertura_pedido, 'parcialmente_disponible'::cobertura_pedido])))), (0)::numeric) AS venta_en_riesgo,
    count(*) FILTER (WHERE (ciclo = 'confirmado'::ciclo_pedido)) AS pedidos_abiertos,
    count(*) FILTER (WHERE (situacion = 'bloqueado_credito'::situacion_financiera)) AS pedidos_bloqueados,
    count(*) FILTER (WHERE ((ciclo = 'confirmado'::ciclo_pedido) AND (fecha_comprometida < CURRENT_DATE))) AS pedidos_atrasados,
    count(*) FILTER (WHERE ((prioridad = 'urgente'::prioridad) AND (ciclo <> ALL (ARRAY['cerrado'::ciclo_pedido, 'cancelado'::ciclo_pedido])))) AS pedidos_urgentes,
        CASE
            WHEN (COALESCE(sum(venta), (0)::numeric) > (0)::numeric) THEN (((COALESCE(sum(venta), (0)::numeric) - COALESCE(sum(costo), (0)::numeric)) / COALESCE(sum(venta), (0)::numeric)) * (100)::numeric)
            ELSE (0)::numeric
        END AS margen_pct,
    COALESCE(sum(tm) FILTER (WHERE (ciclo = 'confirmado'::ciclo_pedido)), (0)::numeric) AS tm_comprometidas,
    -- 076: las toneladas de los pedidos en riesgo, para quien no ve importes.
    COALESCE(sum(tm) FILTER (WHERE ((ciclo = 'confirmado'::ciclo_pedido) AND (cobertura = ANY (ARRAY['pendiente_stock'::cobertura_pedido, 'parcialmente_disponible'::cobertura_pedido])))), (0)::numeric) AS tm_en_riesgo
   FROM valor_pedidos;
