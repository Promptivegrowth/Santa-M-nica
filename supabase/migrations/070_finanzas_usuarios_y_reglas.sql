-- ============================================================================
--  070 · FINANZAS, USUARIOS Y MOTOR DE REGLAS
-- ============================================================================
--  Cierra las «limitaciones conocidas» del área de Finanzas y Herramientas que
--  dejó escritas la Guía de uso:
--
--    1. COBRANZAS Y ANULACIONES DE VERDAD. Registrar un cobro y anular un
--       comprobante pasan por la base, con el comprobante bloqueado mientras se
--       decide. Antes las reglas («no más que el saldo», «no anular con
--       cobros») vivían solo en el servidor de la aplicación, y la política de
--       la tabla dejaba escribir a quien la pantalla no dejaba.
--
--    2. EL ESTADO DE LA FACTURA SE CALCULA, NO SE RECUERDA. «Vencida» depende
--       del día de hoy: guardarla una vez y no volver a mirarla es lo que hacía
--       que una factura vencida en septiembre siguiera diciendo «Emitida» en
--       octubre. Ahora:
--         · las vistas lo calculan al leer, con el día de hoy EN LIMA;
--         · cada cobro lo recalcula en el acto (disparador);
--         · un trabajo nocturno lo pone al día en la tabla, para las pantallas
--           que leen la columna directamente.
--
--    3. LOS ANULADOS SE PUEDEN VER. La vista de cuentas por cobrar los excluye
--       —y está bien: no se deben—; la lista de comprobantes ahora sale de una
--       vista propia que los incluye.
--
--    4. EL BUSCADOR LLEVA A LA FICHA DEL PRODUCTO. El enlace apuntaba a
--       /almacenes/productos, que nunca existió.
--
--    5. USUARIOS DESDE LA PANTALLA, SIN LA CLAVE DE SERVICIO. En producción
--       solo existe la clave anónima, así que el alta no puede usar la API de
--       administración de Supabase. Se hace con funciones SECURITY DEFINER que
--       exigen el rol Gerencia y escriben directamente en auth.users (la
--       contraseña, cifrada con bcrypt, que es lo que usa Supabase). La persona
--       entra con una contraseña temporal y el sistema le obliga a cambiarla.
--       Desactivar corta la entrada en tres sitios: la ficha (activo = false),
--       la cuenta de acceso (banned_until) y las sesiones abiertas.
--
--    6. LAS REGLAS DE ALERTA SE EVALÚAN. La tabla `reglas` tenía interruptores
--       que nada consultaba: las alertas «por regla» eran las de la siembra de
--       agosto y no se volvían a generar. Ahora un evaluador las recorre cada
--       mañana y al tocar el interruptor.
--
--  Re-ejecutable: todo es `create or replace`, `if not exists` o bloque DO.
--  OJO: 070b reemplaza varias de estas funciones y vistas (cobros anulados,
--  reglas sin duplicar). Si se vuelve a ejecutar esta, ejecute después la 070b
--  y la 072 (permisos).
-- ============================================================================


-- ============================================================================
--  1 · EL ESTADO DE UNA FACTURA, CALCULADO
-- ============================================================================
--  Una sola definición para todo el sistema, en este orden:
--    anulada        → anulada (no se toca nunca)
--    saldo ≤ 0,01   → cobrada (un céntimo de tolerancia por el redondeo)
--    vencida la fecha y con saldo → vencida, aunque tenga pagos parciales:
--                     lo que importa para cobrar es que ya venció
--    con algún pago → parcialmente cobrada
--    sin pagos      → emitida
--  «Hoy» es el día de Lima: a las ocho de la noche en el Perú ya es mañana en
--  UTC, y una factura no puede vencer cinco horas antes de tiempo.
-- ----------------------------------------------------------------------------
create or replace function estado_factura_al_dia(
  p_estado      estado_factura,
  p_total       numeric,
  p_cobrado     numeric,
  p_vencimiento date
) returns estado_factura
language sql stable set search_path = public as $$
  select case
    when p_estado = 'anulada' then 'anulada'::estado_factura
    when coalesce(p_total, 0) - coalesce(p_cobrado, 0) <= 0.01 then 'cobrada'::estado_factura
    when p_vencimiento < (now() at time zone 'America/Lima')::date then 'vencida'::estado_factura
    when coalesce(p_cobrado, 0) > 0 then 'parcialmente_cobrada'::estado_factura
    else 'emitida'::estado_factura
  end;
$$;
comment on function estado_factura_al_dia is
  'Estado real de un comprobante según su saldo y su vencimiento en hora de Lima (070).';


-- ============================================================================
--  2 · CUENTAS POR COBRAR · mismas columnas, estado y días calculados
-- ============================================================================
--  Se conservan las columnas y su orden (las vistas solo pueden crecer al
--  final). Cambian tres cálculos:
--    · `estado`         sale de estado_factura_al_dia, no de la columna guardada;
--    · `dias_vencida`   se cuenta contra el día de Lima, no contra el de UTC;
--    · `tramo_antiguedad` mira el saldo y no el estado guardado.
-- ----------------------------------------------------------------------------
create or replace view v_cuentas_cobrar as
select
  f.id,
  f.numero,
  f.cliente_id,
  c.razon_social as cliente,
  c.pais,
  f.moneda,
  f.total,
  f.fecha_emision,
  f.fecha_vencimiento,
  estado_factura_al_dia(f.estado, f.total, cb.cobrado, f.fecha_vencimiento) as estado,
  cb.cobrado,
  f.total - cb.cobrado as saldo,
  (now() at time zone 'America/Lima')::date - f.fecha_vencimiento as dias_vencida,
  case
    when f.total - cb.cobrado <= 0.01 then 'Al día'
    when f.fecha_vencimiento >= (now() at time zone 'America/Lima')::date then 'Vigente'
    when (now() at time zone 'America/Lima')::date - f.fecha_vencimiento <= 30 then '1 a 30 días'
    when (now() at time zone 'America/Lima')::date - f.fecha_vencimiento <= 60 then '31 a 60 días'
    when (now() at time zone 'America/Lima')::date - f.fecha_vencimiento <= 90 then '61 a 90 días'
    else 'Más de 90 días'
  end as tramo_antiguedad,
  f.tipo_cambio,
  a_dolares(f.total, f.moneda, f.tipo_cambio) as total_usd,
  a_dolares(cb.cobrado, f.moneda, f.tipo_cambio) as cobrado_usd,
  a_dolares(f.total - cb.cobrado, f.moneda, f.tipo_cambio) as saldo_usd
from facturas f
join clientes c on c.id = f.cliente_id
cross join lateral (
  select coalesce(sum(x.monto), 0::numeric) as cobrado
    from cobranzas x where x.factura_id = f.id
) cb
where f.estado <> 'anulada';


-- ============================================================================
--  3 · LA LISTA DE COMPROBANTES, CON LOS ANULADOS
-- ============================================================================
--  La pantalla de Facturación la usa con un filtro de estado: por defecto
--  oculta los anulados, pero se pueden pedir. Un anulado no debe nada: su
--  saldo es cero aunque su total no lo sea.
-- ----------------------------------------------------------------------------
create or replace view v_comprobantes as
select
  f.id,
  f.numero,
  f.tipo_comprobante,
  f.cliente_id,
  c.razon_social as cliente,
  c.pais,
  f.pedido_id,
  pe.numero_proforma,
  f.moneda,
  f.tipo_cambio,
  f.total,
  f.fecha_emision,
  f.fecha_vencimiento,
  estado_factura_al_dia(f.estado, f.total, cb.cobrado, f.fecha_vencimiento) as estado,
  cb.cobrado,
  case when f.estado = 'anulada' then 0::numeric else f.total - cb.cobrado end as saldo,
  case when f.estado = 'anulada' then null
       else (now() at time zone 'America/Lima')::date - f.fecha_vencimiento end as dias_vencida,
  (f.estado = 'anulada') as anulada,
  f.anulada_en,
  f.motivo_anulacion,
  a_dolares(f.total, f.moneda, f.tipo_cambio) as total_usd
from facturas f
join clientes c on c.id = f.cliente_id
left join pedidos pe on pe.id = f.pedido_id
cross join lateral (
  select coalesce(sum(x.monto), 0::numeric) as cobrado
    from cobranzas x where x.factura_id = f.id
) cb;

comment on view v_comprobantes is
  'Todos los comprobantes, incluidos los anulados, con su estado calculado al día (070).';

-- Sin sesión no se lee: la vista corre con los permisos de su dueño y no
-- pasaría por las políticas de la tabla.
revoke all on v_comprobantes from anon, public;
grant select on v_comprobantes to authenticated;


-- ============================================================================
--  4 · EL ESTADO GUARDADO, SIEMPRE AL DÍA
-- ============================================================================
--  La columna facturas.estado sigue existiendo porque varias pantallas (el
--  pedido, el cliente, el PDF) la leen directamente. Se mantiene al día de dos
--  formas: al registrar o quitar un cobro, y cada noche a las 00:05 de Lima.
--
--  El pedido acompaña: su «situación financiera» refleja la de su factura.
--  Solo se toca si el pedido ya estaba en una situación de factura —un pedido
--  bloqueado por crédito sigue su propio camino—.
-- ----------------------------------------------------------------------------
create or replace function facturas_sincronizar_estado(p_factura_id bigint)
returns estado_factura
language plpgsql security definer set search_path = public as $$
declare
  f        facturas%rowtype;
  v_cobrado numeric;
  v_nuevo  estado_factura;
begin
  select * into f from facturas where id = p_factura_id;
  if not found or f.estado = 'anulada' then return f.estado; end if;

  select coalesce(sum(monto), 0) into v_cobrado from cobranzas where factura_id = p_factura_id;
  v_nuevo := estado_factura_al_dia(f.estado, f.total, v_cobrado, f.fecha_vencimiento);

  if v_nuevo is distinct from f.estado then
    update facturas set estado = v_nuevo where id = p_factura_id;
  end if;

  if f.pedido_id is not null then
    update pedidos
       set situacion = case v_nuevo
             when 'cobrada'              then 'cobrado'::situacion_financiera
             when 'parcialmente_cobrada' then 'parcialmente_cobrado'::situacion_financiera
             when 'vencida'              then 'vencido'::situacion_financiera
             else 'facturado'::situacion_financiera
           end
     where id = f.pedido_id
       and situacion in ('facturado', 'parcialmente_cobrado', 'cobrado', 'vencido')
       and situacion is distinct from case v_nuevo
             when 'cobrada'              then 'cobrado'::situacion_financiera
             when 'parcialmente_cobrada' then 'parcialmente_cobrado'::situacion_financiera
             when 'vencida'              then 'vencido'::situacion_financiera
             else 'facturado'::situacion_financiera
           end;
  end if;

  return v_nuevo;
end $$;
revoke all on function facturas_sincronizar_estado(bigint) from public, anon, authenticated;

/* El trabajo nocturno: todas las que cambiaron de estado sin que nadie las tocara. */
create or replace function facturas_actualizar_estados()
returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select f.id
      from facturas f
      cross join lateral (select coalesce(sum(monto), 0) as cobrado from cobranzas where factura_id = f.id) cb
     where f.estado <> 'anulada'
       and f.estado is distinct from estado_factura_al_dia(f.estado, f.total, cb.cobrado, f.fecha_vencimiento)
  loop
    perform facturas_sincronizar_estado(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function facturas_actualizar_estados() from public, anon, authenticated;


-- ============================================================================
--  5 · LOS COBROS · validados en la base
-- ============================================================================
--  Antes de guardar un cobro se bloquea su factura (`for update`): dos cobros
--  simultáneos sobre el mismo saldo no pueden pasar los dos. Se exige:
--    · que la factura no esté anulada;
--    · un monto positivo que no supere el saldo (un céntimo de tolerancia);
--    · una fecha que no sea futura (en Lima) ni anterior a la emisión.
--  Después, el estado de la factura se recalcula solo.
-- ----------------------------------------------------------------------------
create or replace function cobranzas_validar()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  f         facturas%rowtype;
  v_cobrado numeric;
  v_saldo   numeric;
begin
  select * into f from facturas where id = new.factura_id for update;
  if not found then
    raise exception 'El comprobante % no existe.', new.factura_id;
  end if;
  if f.estado = 'anulada' then
    raise exception '% está anulado: no admite cobros.', f.numero;
  end if;
  if coalesce(new.monto, 0) <= 0 then
    raise exception 'El monto del cobro tiene que ser mayor que cero.';
  end if;
  if new.fecha > (now() at time zone 'America/Lima')::date then
    raise exception 'La fecha del cobro (%) es posterior a hoy. Registre el cobro el día que llega el dinero.',
      to_char(new.fecha, 'DD/MM/YYYY');
  end if;
  if new.fecha < f.fecha_emision then
    raise exception 'La fecha del cobro (%) es anterior a la emisión de % (%). Un adelanto se registra en la proforma, no en el comprobante.',
      to_char(new.fecha, 'DD/MM/YYYY'), f.numero, to_char(f.fecha_emision, 'DD/MM/YYYY');
  end if;

  select coalesce(sum(monto), 0) into v_cobrado
    from cobranzas
   where factura_id = new.factura_id
     and (tg_op = 'INSERT' or id <> new.id);
  v_saldo := round(f.total - v_cobrado, 2);

  if new.monto > v_saldo + 0.01 then
    raise exception 'A % le quedan % % por cobrar y se intenta registrar %. Si el cliente pagó de más, registre solo el saldo y deje el excedente anotado en Observaciones.',
      f.numero, f.moneda, to_char(v_saldo, 'FM999G999G990D00'), to_char(new.monto, 'FM999G999G990D00');
  end if;

  return new;
end $$;

drop trigger if exists trg_cobranzas_validar on cobranzas;
create trigger trg_cobranzas_validar
  before insert or update of monto, fecha, factura_id on cobranzas
  for each row execute function cobranzas_validar();

create or replace function cobranzas_recalcular_factura()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform facturas_sincronizar_estado(new.factura_id);
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    perform facturas_sincronizar_estado(old.factura_id);
  end if;
  return null;
end $$;

drop trigger if exists trg_cobranzas_recalcular on cobranzas;
create trigger trg_cobranzas_recalcular
  after insert or update or delete on cobranzas
  for each row execute function cobranzas_recalcular_factura();


/* ---- Registrar un cobro: la puerta de la pantalla ---- */
create or replace function registrar_cobranza(
  p_factura_id    bigint,
  p_monto         numeric,
  p_fecha         date,
  p_medio         text,
  p_referencia    text default null,
  p_observaciones text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id      bigint;
  f         facturas%rowtype;
  v_saldo   numeric;
  v_estado  estado_factura;
begin
  if not puede('gerencia', 'operaciones') then
    raise exception 'Solo Gerencia y Operaciones registran cobros.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_medio), '') not in ('Transferencia', 'Depósito', 'Carta de crédito', 'Cheque', 'Efectivo') then
    raise exception 'Elija el medio de pago: Transferencia, Depósito, Carta de crédito, Cheque o Efectivo.';
  end if;
  if p_fecha is null then
    raise exception 'Indique la fecha en que llegó el pago.';
  end if;

  -- Las demás reglas (saldo, fechas, anulada) las impone el disparador.
  insert into cobranzas (factura_id, monto, fecha, medio, referencia, observaciones, registrado_por)
  values (p_factura_id, round(p_monto, 2), p_fecha, trim(p_medio),
          nullif(trim(coalesce(p_referencia, '')), ''),
          nullif(trim(coalesce(p_observaciones, '')), ''),
          auth.uid())
  returning id into v_id;

  select * into f from facturas where id = p_factura_id;
  select round(f.total - coalesce(sum(monto), 0), 2) into v_saldo from cobranzas where factura_id = p_factura_id;
  v_estado := f.estado;

  perform registrar_evento(
    'facturas', p_factura_id, 'cobranza_registrada',
    format('Cobro de %s %s sobre %s (%s, del %s)%s · saldo %s',
           f.moneda, to_char(round(p_monto, 2), 'FM999G999G990D00'), f.numero, trim(p_medio),
           to_char(p_fecha, 'DD/MM/YYYY'),
           coalesce(' · ref. ' || nullif(trim(coalesce(p_referencia, '')), ''), ''),
           to_char(v_saldo, 'FM999G999G990D00')),
    'info',
    jsonb_build_object('cobranza_id', v_id, 'monto', round(p_monto, 2), 'saldo', v_saldo, 'estado', v_estado));

  return jsonb_build_object('id', v_id, 'numero', f.numero, 'moneda', f.moneda,
                            'saldo', v_saldo, 'estado', v_estado);
end $$;
revoke all on function registrar_cobranza(bigint, numeric, date, text, text, text) from public, anon;
grant execute on function registrar_cobranza(bigint, numeric, date, text, text, text) to authenticated;


-- ============================================================================
--  6 · ANULAR UN COMPROBANTE
-- ============================================================================
--  Lo que el sistema modela hoy (fase 1, documento interno):
--    · solo Gerencia y Operaciones;
--    · con motivo escrito (mínimo 10 caracteres: «error» no explica nada);
--    · nunca con cobros aplicados: primero se revierten;
--    · el número NO se reutiliza: el correlativo sigue, el anulado queda;
--    · un anulado no se «desanula»: si fue un error, se emite uno nuevo;
--    · el pedido vuelve a «sin facturar» para poder emitirle el correcto.
-- ----------------------------------------------------------------------------
create or replace function facturas_proteger()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Los procesos internos (sin sesión) y las migraciones pasan.
  if auth.uid() is null then return new; end if;

  if old.estado = 'anulada' and new.estado is distinct from 'anulada' then
    raise exception '% está anulado y un anulado no se reactiva: emita un comprobante nuevo.', old.numero;
  end if;

  if (new.numero, new.total, new.subtotal, new.igv, new.moneda, new.tipo_cambio,
      new.cliente_id, new.pedido_id, new.fecha_emision, new.tipo_comprobante)
     is distinct from
     (old.numero, old.total, old.subtotal, old.igv, old.moneda, old.tipo_cambio,
      old.cliente_id, old.pedido_id, old.fecha_emision, old.tipo_comprobante) then
    raise exception 'Un comprobante emitido no se edita. Si tiene un error, anúlelo con su motivo y emita uno nuevo.';
  end if;

  if new.estado = 'anulada' and old.estado <> 'anulada' then
    if not puede('gerencia', 'operaciones') then
      raise exception 'Solo Gerencia y Operaciones anulan comprobantes.' using errcode = 'insufficient_privilege';
    end if;
    if exists (select 1 from cobranzas where factura_id = new.id) then
      raise exception '% tiene cobros registrados. Anularlo descuadraría la caja: primero hay que revertir los cobros.', new.numero;
    end if;
    if length(trim(coalesce(new.motivo_anulacion, ''))) < 10 then
      raise exception 'Escriba el motivo de la anulación (al menos 10 caracteres): queda en el comprobante para la contabilidad.';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_facturas_proteger on facturas;
create trigger trg_facturas_proteger
  before update on facturas
  for each row execute function facturas_proteger();

create or replace function anular_comprobante(p_factura_id bigint, p_motivo text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  f facturas%rowtype;
begin
  if not puede('gerencia', 'operaciones') then
    raise exception 'Solo Gerencia y Operaciones anulan comprobantes.' using errcode = 'insufficient_privilege';
  end if;

  select * into f from facturas where id = p_factura_id for update;
  if not found then raise exception 'Ese comprobante ya no existe.'; end if;
  if f.estado = 'anulada' then raise exception '% ya estaba anulado.', f.numero; end if;

  -- El disparador facturas_proteger exige el motivo y que no haya cobros.
  update facturas
     set estado = 'anulada',
         anulada_por = auth.uid(),
         anulada_en = now(),
         motivo_anulacion = trim(coalesce(p_motivo, ''))
   where id = p_factura_id;

  -- El pedido queda libre para emitirle el comprobante correcto.
  if f.pedido_id is not null
     and not exists (select 1 from facturas where pedido_id = f.pedido_id and estado <> 'anulada') then
    update pedidos set situacion = 'sin_facturar'
     where id = f.pedido_id and situacion in ('facturado', 'parcialmente_cobrado', 'cobrado', 'vencido');
  end if;

  perform registrar_evento(
    'facturas', p_factura_id, 'comprobante_anulado',
    format('%s anulado. Motivo: %s', f.numero, trim(p_motivo)),
    'advertencia',
    jsonb_build_object('numero', f.numero, 'total', f.total, 'moneda', f.moneda, 'motivo', trim(p_motivo)));

  if f.pedido_id is not null then
    perform registrar_evento(
      'pedidos', f.pedido_id, 'comprobante_anulado',
      format('Se anuló el comprobante %s del pedido: puede emitirse uno nuevo.', f.numero),
      'advertencia', jsonb_build_object('factura_id', p_factura_id));
  end if;

  return jsonb_build_object('numero', f.numero, 'pedido_id', f.pedido_id);
end $$;
revoke all on function anular_comprobante(bigint, text) from public, anon;
grant execute on function anular_comprobante(bigint, text) to authenticated;


-- ============================================================================
--  7 · QUIÉN ESCRIBE EN FINANZAS · las políticas, alineadas con la pantalla
-- ============================================================================
--  · Emitir (facturas y sus líneas): Gerencia, Operaciones y Comercial. Antes
--    la política no incluía a Operaciones, que tenía el botón y fallaba.
--  · Cobros: Gerencia y Operaciones. Antes la política dejaba a Comercial y no
--    a Operaciones: justo al revés que la pantalla.
-- ----------------------------------------------------------------------------
do $$
begin
  drop policy if exists escritura_finanzas on facturas;
  create policy escritura_finanzas on facturas for all
    using (puede('gerencia', 'operaciones', 'comercial'))
    with check (puede('gerencia', 'operaciones', 'comercial'));

  drop policy if exists escritura_finanzas on factura_lineas;
  create policy escritura_finanzas on factura_lineas for all
    using (puede('gerencia', 'operaciones', 'comercial'))
    with check (puede('gerencia', 'operaciones', 'comercial'));

  drop policy if exists escritura_finanzas on cobranzas;
  create policy escritura_finanzas on cobranzas for all
    using (puede('gerencia', 'operaciones'))
    with check (puede('gerencia', 'operaciones'));
end $$;


-- ============================================================================
--  8 · BUSCADOR UNIVERSAL · el producto lleva a su ficha
-- ============================================================================
CREATE OR REPLACE FUNCTION public.buscar_universal(p_texto text)
 RETURNS TABLE(tipo text, id bigint, titulo text, subtitulo text, fecha timestamp with time zone, ruta text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with q as (select '%' || upper(trim(p_texto)) || '%' as patron)

  -- Lotes por codigo de pallet o de lote
  select 'Lote'::text, l.id,
         l.codigo_pallet,
         (s.codigo || ' - ' || esp.nombre || ' ' || f.nombre || ' ' || s.corte)::text,
         l.creado_en,
         ('/almacenes/lotes/' || l.id)::text
    from lotes l
    join sku_presentaciones sp on sp.id = l.sku_presentacion_id
    join skus s        on s.id = sp.sku_id
    join especies esp  on esp.id = s.especie_id
    join formatos f    on f.id = s.formato_id
    cross join q
   where upper(l.codigo_pallet) like q.patron
      or upper(coalesce(l.codigo_lote,'')) like q.patron

  union all
  -- Pedidos por numero de proforma u orden de compra del cliente
  select 'Pedido'::text, pe.id, pe.numero_proforma, c.razon_social, pe.creado_en,
         ('/ventas/pedidos/' || pe.id)::text
    from pedidos pe
    join clientes c on c.id = pe.cliente_id
    cross join q
   where upper(pe.numero_proforma) like q.patron
      or upper(coalesce(pe.oc_cliente,'')) like q.patron

  union all
  -- Packing lists por codigo, contenedor, guia o DAM
  select 'Packing List'::text, pk.id,
         pk.codigo,
         (coalesce(pk.contenedor,'sin contenedor') || coalesce(' - ' || pk.guia_remision, ''))::text,
         pk.creado_en,
         ('/logistica/packing/' || pk.id)::text
    from packing_lists pk
    cross join q
   where upper(pk.codigo) like q.patron
      or upper(coalesce(pk.contenedor,'')) like q.patron
      or upper(coalesce(pk.guia_remision,'')) like q.patron
      or upper(coalesce(pk.dam,'')) like q.patron

  union all
  -- Embarques por numero o booking
  select 'Embarque'::text, e.id, e.numero,
         (coalesce(e.booking,'sin booking') || ' - ' || coalesce(d.puerto,'sin destino'))::text,
         e.creado_en, ('/logistica/embarques/' || e.id)::text
    from embarques e
    left join destinos d on d.id = e.destino_id
    cross join q
   where upper(e.numero) like q.patron
      or upper(coalesce(e.booking,'')) like q.patron

  union all
  -- Clientes por razon social, nombre corto o codigo
  select 'Cliente'::text, c.id, c.razon_social,
         (coalesce(c.pais,'') || coalesce(' - ' || c.codigo, ''))::text,
         c.creado_en, ('/ventas/clientes/' || c.id)::text
    from clientes c
    cross join q
   where upper(c.razon_social) like q.patron
      or upper(coalesce(c.nombre_corto,'')) like q.patron
      or upper(c.codigo) like q.patron

  union all
  -- Facturas por numero
  select 'Factura'::text, fa.id, fa.numero, c.razon_social, fa.creado_en,
         ('/finanzas/facturas/' || fa.id)::text
    from facturas fa
    join clientes c on c.id = fa.cliente_id
    cross join q
   where upper(fa.numero) like q.patron

  union all
  -- Traslados por numero o guia
  select 'Traslado'::text, tr.id, tr.numero,
         (ao.nombre || ' -> ' || ad.nombre)::text,
         tr.creado_en, ('/almacenes/traslados/' || tr.id)::text
    from traslados tr
    join almacenes ao on ao.id = tr.almacen_origen_id
    join almacenes ad on ad.id = tr.almacen_destino_id
    cross join q
   where upper(tr.numero) like q.patron
      or upper(coalesce(tr.guia_numero,'')) like q.patron

  union all
  -- Productos por codigo, corte o especie. Una fila por PRESENTACIÓN: la
  -- ficha del producto es la de la presentación (/ventas/productos/<id>), así
  -- que el enlace tiene que llevar ese identificador y no el del SKU.
  select 'Producto'::text, sp.id, s.codigo,
         (esp.nombre || ' - ' || f.nombre || ' - ' || s.corte
           || coalesce(' - ' || pr.descripcion, ''))::text,
         s.creado_en, ('/ventas/productos/' || sp.id)::text
    from sku_presentaciones sp
    join skus s       on s.id = sp.sku_id
    join especies esp on esp.id = s.especie_id
    join formatos f   on f.id = s.formato_id
    left join presentaciones pr on pr.id = sp.presentacion_id
    cross join q
   where upper(s.codigo) like q.patron
      or upper(s.corte) like q.patron
      or upper(esp.nombre) like q.patron

  limit 60;
$function$;


-- ============================================================================
--  9 · USUARIOS · alta, rol, estado y contraseña, solo con la clave anónima
-- ============================================================================
--  POR QUÉ ASÍ
--  La API de administración de Supabase (crear usuario, invitar) exige la
--  clave de servicio, que en producción NO está y no debe estar. La invitación
--  por correo tampoco sirve: el proyecto no tiene servidor de correo propio y
--  el de Supabase solo manda dos correos por hora, y solo a su propio equipo.
--
--  Así que Gerencia crea la cuenta con una contraseña temporal que comunica en
--  persona. Al entrar por primera vez, el sistema obliga a cambiarla
--  (usuarios.debe_cambiar_clave). Si alguien la olvida, Gerencia le pone otra
--  temporal: no hay correo de recuperación.
--
--  Todas estas funciones son SECURITY DEFINER (corren como el dueño, que puede
--  escribir en auth.users) y lo PRIMERO que hacen es comprobar el rol de quien
--  llama. Nadie puede quitarse a sí mismo el rol Gerencia ni desactivarse.
-- ----------------------------------------------------------------------------
alter table usuarios add column if not exists debe_cambiar_clave boolean not null default false;
comment on column usuarios.debe_cambiar_clave is
  'La contraseña la puso Gerencia (alta o restablecimiento): al entrar, el sistema obliga a cambiarla (070).';

/*
 * El guardián de la ficha del usuario, ampliado: el aviso de «cambie su
 * contraseña» tampoco lo puede apagar el propio usuario con un update directo
 * (la política usuario_propio le deja editar su fila). Solo lo apaga la
 * función que de verdad cambia la contraseña, que deja una marca en la
 * transacción.
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

  if (new.rol, new.activo, new.almacen_id, new.aprueba_cotizaciones, new.carga_costos)
     is distinct from (old.rol, old.activo, old.almacen_id, old.aprueba_cotizaciones, old.carga_costos)
     and v_rol is distinct from 'gerencia' then
    raise exception 'Solo Gerencia puede cambiar el rol, el estado, el almacén o los permisos de aprobar y de cargar costos de un usuario.';
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

/* Reglas mínimas de una contraseña. Supabase pide 6; aquí, 8 con letras y números. */
create or replace function usuario_validar_clave(p_clave text, p_email text default null)
returns void
language plpgsql immutable set search_path = public as $$
begin
  if p_clave is null or length(p_clave) < 8 then
    raise exception 'La contraseña debe tener al menos 8 caracteres.';
  end if;
  if p_clave !~ '[A-Za-zÁÉÍÓÚÑáéíóúñ]' or p_clave !~ '[0-9]' then
    raise exception 'La contraseña debe combinar letras y números.';
  end if;
  if p_email is not null and lower(p_clave) = lower(split_part(p_email, '@', 1)) then
    raise exception 'La contraseña no puede ser el propio nombre de usuario del correo.';
  end if;
end $$;

/* ---- Alta ---- */
create or replace function usuario_crear(
  p_email      text,
  p_nombre     text,
  p_rol        rol_usuario,
  p_clave      text,
  p_almacen_id bigint default null
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id    uuid := gen_random_uuid();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_nombre text := trim(coalesce(p_nombre, ''));
begin
  if not puede('gerencia') then
    raise exception 'Solo Gerencia puede crear usuarios.' using errcode = 'insufficient_privilege';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'El correo «%» no tiene forma de correo (nombre@empresa.pe).', p_email;
  end if;
  if length(v_nombre) < 3 then
    raise exception 'Escriba el nombre completo de la persona.';
  end if;
  perform usuario_validar_clave(p_clave, v_email);
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'Ya existe una cuenta con el correo %. Si es de alguien que se fue, reactívela en vez de crear otra.', v_email;
  end if;
  if p_almacen_id is not null and not exists (select 1 from almacenes where id = p_almacen_id) then
    raise exception 'Ese almacén no existe.';
  end if;

  /*
   * La cuenta de acceso. Los campos de texto de los «token» van vacíos y no
   * nulos: el servidor de autenticación de Supabase no sabe leer un nulo ahí
   * y la persona no podría entrar. El correo se da por confirmado porque lo
   * confirma Gerencia al crearlo; no hay correo de confirmación que mandar.
   */
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
    v_email, crypt(p_clave, gen_salt('bf', 10)), now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('nombre', v_nombre, 'rol', p_rol),
    now(), now(), '', '', '', ''
  );

  insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
  values (v_id::text, v_id,
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
          'email', now(), now());

  insert into usuarios (id, nombre, email, rol, almacen_id, activo, debe_cambiar_clave)
  values (v_id, v_nombre, v_email, p_rol, p_almacen_id, true, true);

  perform registrar_evento('usuarios', 0, 'usuario_creado',
    format('Alta de %s (%s) con rol %s', v_nombre, v_email, p_rol), 'info',
    jsonb_build_object('usuario_id', v_id, 'rol', p_rol));

  return v_id;
end $$;

/* ---- Rol (y almacén, que va con el rol de Almacén) ---- */
create or replace function usuario_cambiar_rol(p_id uuid, p_rol rol_usuario, p_almacen_id bigint default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  u usuarios%rowtype;
begin
  if not puede('gerencia') then
    raise exception 'Solo Gerencia puede cambiar el rol de un usuario.' using errcode = 'insufficient_privilege';
  end if;
  select * into u from usuarios where id = p_id for update;
  if not found then raise exception 'Ese usuario ya no existe.'; end if;

  if p_id = auth.uid() and p_rol <> 'gerencia' then
    raise exception 'No puede quitarse a sí mismo el rol Gerencia: pídaselo a otra persona de Gerencia.';
  end if;
  if u.rol = 'gerencia' and p_rol <> 'gerencia'
     and not exists (select 1 from usuarios where rol = 'gerencia' and activo and id <> p_id) then
    raise exception 'Es la única persona de Gerencia activa: el sistema se quedaría sin quien administre los usuarios.';
  end if;
  if p_almacen_id is not null and not exists (select 1 from almacenes where id = p_almacen_id) then
    raise exception 'Ese almacén no existe.';
  end if;

  update usuarios
     set rol = p_rol,
         -- El almacén solo tiene sentido para el rol de Almacén.
         almacen_id = case when p_rol = 'almacen' then coalesce(p_almacen_id, u.almacen_id) else null end
   where id = p_id;

  if u.rol is distinct from p_rol then
    perform registrar_evento('usuarios', 0, 'usuario_cambio_rol',
      format('%s pasa de %s a %s', u.nombre, u.rol, p_rol), 'advertencia',
      jsonb_build_object('usuario_id', p_id, 'antes', u.rol, 'despues', p_rol));
  end if;
end $$;

/* ---- Activar / desactivar ---- */
create or replace function usuario_cambiar_estado(p_id uuid, p_activo boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  u usuarios%rowtype;
begin
  if not puede('gerencia') then
    raise exception 'Solo Gerencia puede activar o desactivar usuarios.' using errcode = 'insufficient_privilege';
  end if;
  if p_id = auth.uid() and not p_activo then
    raise exception 'No puede desactivar su propia cuenta: pídaselo a otra persona de Gerencia.';
  end if;
  select * into u from usuarios where id = p_id for update;
  if not found then raise exception 'Ese usuario ya no existe.'; end if;
  if u.activo = p_activo then return; end if;

  if not p_activo and u.rol = 'gerencia'
     and not exists (select 1 from usuarios where rol = 'gerencia' and activo and id <> p_id) then
    raise exception 'Es la única persona de Gerencia activa: no se puede desactivar.';
  end if;

  update usuarios set activo = p_activo where id = p_id;

  /*
   * La entrada se corta también en la cuenta de acceso: con banned_until el
   * servidor de autenticación rechaza la contraseña y no renueva la sesión.
   * Y se cierran las sesiones abiertas, para que no siga dentro hasta que
   * caduque su ficha de acceso.
   */
  if p_activo then
    update auth.users set banned_until = null, updated_at = now() where id = p_id;
  else
    update auth.users set banned_until = '2999-12-31'::timestamptz, updated_at = now() where id = p_id;
    delete from auth.sessions where user_id = p_id;
  end if;

  perform registrar_evento('usuarios', 0,
    case when p_activo then 'usuario_reactivado' else 'usuario_desactivado' end,
    format('%s %s', u.nombre, case when p_activo then 'vuelve a tener acceso' else 'queda sin acceso al sistema' end),
    case when p_activo then 'info' else 'advertencia' end::severidad_alerta,
    jsonb_build_object('usuario_id', p_id));
end $$;

/* ---- Gerencia pone una contraseña temporal (olvido) ---- */
create or replace function usuario_restablecer_clave(p_id uuid, p_clave text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  u usuarios%rowtype;
begin
  if not puede('gerencia') then
    raise exception 'Solo Gerencia puede restablecer contraseñas.' using errcode = 'insufficient_privilege';
  end if;
  select * into u from usuarios where id = p_id;
  if not found then raise exception 'Ese usuario ya no existe.'; end if;
  if p_id = auth.uid() then
    raise exception 'Su propia contraseña se cambia desde «Cambiar mi contraseña», con la actual.';
  end if;
  perform usuario_validar_clave(p_clave, u.email);

  update auth.users
     set encrypted_password = crypt(p_clave, gen_salt('bf', 10)), updated_at = now()
   where id = p_id;
  delete from auth.sessions where user_id = p_id;
  update usuarios set debe_cambiar_clave = true where id = p_id;

  perform registrar_evento('usuarios', 0, 'usuario_clave_restablecida',
    format('Contraseña temporal nueva para %s', u.nombre), 'advertencia',
    jsonb_build_object('usuario_id', p_id));
end $$;

/* ---- Cada uno cambia la suya, sabiendo la actual ---- */
create or replace function cambiar_mi_clave(p_actual text, p_nueva text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id   uuid := auth.uid();
  v_hash text;
  v_email text;
begin
  if v_id is null then raise exception 'Su sesión caducó: vuelva a entrar.'; end if;
  select encrypted_password, email into v_hash, v_email from auth.users where id = v_id;
  if v_hash is null or crypt(coalesce(p_actual, ''), v_hash) <> v_hash then
    raise exception 'La contraseña actual no es correcta.';
  end if;
  if p_nueva = p_actual then
    raise exception 'La contraseña nueva tiene que ser distinta de la actual.';
  end if;
  perform usuario_validar_clave(p_nueva, v_email);

  update auth.users
     set encrypted_password = crypt(p_nueva, gen_salt('bf', 10)), updated_at = now()
   where id = v_id;

  perform set_config('sm.clave_cambiada', 'si', true);
  update usuarios set debe_cambiar_clave = false where id = v_id;
  perform set_config('sm.clave_cambiada', '', true);

  perform registrar_evento('usuarios', 0, 'usuario_cambio_clave',
    'La persona cambió su contraseña', 'info', jsonb_build_object('usuario_id', v_id));
end $$;

do $$
begin
  revoke all on function usuario_crear(text, text, rol_usuario, text, bigint) from public, anon;
  revoke all on function usuario_cambiar_rol(uuid, rol_usuario, bigint) from public, anon;
  revoke all on function usuario_cambiar_estado(uuid, boolean) from public, anon;
  revoke all on function usuario_restablecer_clave(uuid, text) from public, anon;
  revoke all on function cambiar_mi_clave(text, text) from public, anon;
  revoke all on function usuario_validar_clave(text, text) from public, anon;
  grant execute on function usuario_crear(text, text, rol_usuario, text, bigint) to authenticated;
  grant execute on function usuario_cambiar_rol(uuid, rol_usuario, bigint) to authenticated;
  grant execute on function usuario_cambiar_estado(uuid, boolean) to authenticated;
  grant execute on function usuario_restablecer_clave(uuid, text) to authenticated;
  grant execute on function cambiar_mi_clave(text, text) to authenticated;
end $$;


-- ============================================================================
--  10 · EL MOTOR DE REGLAS · que el interruptor sirva para algo
-- ============================================================================
--  Cada regla dice SOBRE QUÉ (entidad), QUÉ MIRAR (campo), CÓMO COMPARAR
--  (operador) y CON QUÉ (valor). El evaluador sabe medir estos campos:
--
--    lote     · meses_almacenado     meses en cámara de un pallet con stock
--    reserva  · dias_para_vencer     días hasta que vence una reserva viva
--    pedido   · dias_sin_movimiento  días desde el último cambio de un pedido confirmado
--    pedido   · margen_pct           margen de un pedido en curso (si tiene costo)
--    factura  · dias_vencida         días de vencida de una factura con saldo
--    traslado · dias_en_transito     días en tránsito sin que el destino lo acepte
--
--  Con la regla ACTIVA: abre una alerta por cada registro que cumple, refresca
--  el mensaje de las que siguen y cierra sola la que dejó de cumplirse. Con la
--  regla INACTIVA: cierra todas sus alertas abiertas y no abre ninguna.
--
--  Una alerta que una PERSONA marcó como atendida no se vuelve a abrir para el
--  mismo registro: ya se vio. Las que cerró el sistema (regla apagada o
--  condición resuelta) sí vuelven si la condición reaparece.
-- ----------------------------------------------------------------------------
create table if not exists reglas_evaluacion (
  regla_id    bigint primary key references reglas(id) on delete cascade,
  evaluada_en timestamptz not null default now(),
  abiertas    int not null default 0,
  nuevas      int not null default 0,
  cerradas    int not null default 0,
  medible     boolean not null default true
);
comment on table reglas_evaluacion is 'Última pasada del evaluador por cada regla (070). No se audita: cambia cada día.';
alter table reglas_evaluacion enable row level security;
drop policy if exists lectura_autenticados on reglas_evaluacion;
create policy lectura_autenticados on reglas_evaluacion for select using (es_usuario_activo());

create or replace function regla_cumple(p_valor numeric, p_operador text, p_umbral numeric)
returns boolean language sql immutable as $$
  select coalesce(case p_operador
    when '>'  then p_valor >  p_umbral
    when '>=' then p_valor >= p_umbral
    when '<'  then p_valor <  p_umbral
    when '<=' then p_valor <= p_umbral
    when '='  then p_valor =  p_umbral
    else false end, false);
$$;

/* Rellena «El lote {codigo_pallet} lleva {meses_almacenado} meses…» con los datos. */
create or replace function regla_mensaje(p_plantilla text, p_datos jsonb)
returns text language plpgsql immutable as $$
declare
  k text; v text; r text := coalesce(p_plantilla, '');
begin
  for k, v in select key, value from jsonb_each_text(coalesce(p_datos, '{}'::jsonb)) loop
    r := replace(r, '{' || k || '}', coalesce(v, ''));
  end loop;
  return r;
end $$;

create or replace function reglas_evaluar(p_regla_id bigint default null)
returns table (regla_id bigint, medible boolean, abiertas int, nuevas int, cerradas int)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  r        reglas%rowtype;
  v_hoy    date := (now() at time zone 'America/Lima')::date;
  v_clave  text;
  v_umbral numeric;
  v_op     text;
  v_medible boolean;
  v_nuevas int;
  v_cerradas int;
  v_abiertas int;
begin
  -- El trabajo programado corre sin sesión; una persona, solo si administra.
  if auth.uid() is not null and not puede('gerencia', 'operaciones') then
    raise exception 'Solo Gerencia y Operaciones pueden evaluar las reglas.' using errcode = 'insufficient_privilege';
  end if;

  create temp table if not exists _regla_cand (
    entidad_id bigint primary key, valor numeric, datos jsonb
  ) on commit drop;

  for r in select * from reglas x where p_regla_id is null or x.id = p_regla_id order by x.id loop
    truncate _regla_cand;
    v_clave  := r.entidad || ':' || coalesce(r.condicion->>'campo', '');
    v_umbral := nullif(r.condicion->>'valor', '')::numeric;
    v_op     := r.condicion->>'operador';
    v_medible := true;

    if r.activa then
      if v_clave = 'lote:meses_almacenado' then
        insert into _regla_cand
        select a.lote_id, max(a.meses_almacenado),
               jsonb_build_object('codigo_pallet', min(a.codigo_pallet),
                                  'meses_almacenado', to_char(max(a.meses_almacenado), 'FM990D0'))
          from v_anticuamiento a
         where a.fisico_kg > 0
         group by a.lote_id;

      elsif v_clave = 'reserva:dias_para_vencer' then
        insert into _regla_cand
        select rs.id, ((rs.vence_el at time zone 'America/Lima')::date - v_hoy),
               jsonb_build_object('numero_proforma', pe.numero_proforma,
                                  'dias_para_vencer', ((rs.vence_el at time zone 'America/Lima')::date - v_hoy))
          from reservas rs
          join pedido_lineas pl on pl.id = rs.pedido_linea_id
          join pedidos pe on pe.id = pl.pedido_id
         where rs.estado in ('solicitada', 'activa', 'en_preparacion')
           and rs.vence_el is not null;

      elsif v_clave = 'pedido:dias_sin_movimiento' then
        insert into _regla_cand
        select pe.id, (v_hoy - (greatest(pe.actualizado_en, pe.creado_en, ev.ultimo) at time zone 'America/Lima')::date),
               jsonb_build_object('numero_proforma', pe.numero_proforma,
                                  'dias_sin_movimiento', (v_hoy - (greatest(pe.actualizado_en, pe.creado_en, ev.ultimo) at time zone 'America/Lima')::date))
          from pedidos pe
          left join lateral (
            select max(e.ocurrido_en) as ultimo from eventos e
             where e.entidad = 'pedidos' and e.entidad_id = pe.id
          ) ev on true
         where pe.ciclo = 'confirmado';

      elsif v_clave = 'pedido:margen_pct' then
        insert into _regla_cand
        select rp.pedido_id, rp.margen_pct,
               jsonb_build_object('numero_proforma', rp.numero_proforma,
                                  'margen_pct', to_char(rp.margen_pct, 'FM990D0'))
          from v_rentabilidad_pedido rp
         where rp.ciclo in ('pendiente_validacion', 'confirmado')
           and rp.margen_pct is not null
           and coalesce(rp.costo_estimado, 0) > 0;

      elsif v_clave = 'factura:dias_vencida' then
        insert into _regla_cand
        select cc.id, cc.dias_vencida,
               jsonb_build_object('numero', cc.numero, 'dias_vencida', cc.dias_vencida, 'cliente', cc.cliente)
          from v_cuentas_cobrar cc
         where cc.saldo > 0.01;

      elsif v_clave = 'traslado:dias_en_transito' then
        insert into _regla_cand
        select t.id, (v_hoy - (coalesce(t.despachado_en, t.creado_en) at time zone 'America/Lima')::date),
               jsonb_build_object('numero', t.numero,
                                  'dias_en_transito', (v_hoy - (coalesce(t.despachado_en, t.creado_en) at time zone 'America/Lima')::date))
          from traslados t
         where t.estado = 'en_transito';

      else
        -- Un campo que el evaluador no sabe medir: no se inventa nada.
        v_medible := false;
      end if;

      delete from _regla_cand c where not regla_cumple(c.valor, v_op, v_umbral);
    end if;

    /* Cerrar lo que ya no corresponde (o todo, si la regla está apagada). */
    update alertas a
       set atendida = true,
           atendida_en = now(),
           datos = coalesce(a.datos, '{}'::jsonb)
                   || jsonb_build_object('cerrada_por', case when r.activa then 'condicion_resuelta' else 'regla_desactivada' end)
     where a.regla_id = r.id and not a.atendida
       and (not r.activa or not v_medible
            or not exists (select 1 from _regla_cand c where c.entidad_id = a.entidad_id));
    get diagnostics v_cerradas = row_count;

    /* Refrescar las que siguen abiertas: la cifra del mensaje cambia cada día. */
    update alertas a
       set mensaje = regla_mensaje(r.mensaje, c.datos),
           titulo = r.nombre,
           severidad = r.severidad,
           entidad = r.entidad,
           datos = c.datos
      from _regla_cand c
     where a.regla_id = r.id and not a.atendida and a.entidad_id = c.entidad_id;

    /* Abrir las nuevas. */
    insert into alertas (regla_id, entidad, entidad_id, severidad, titulo, mensaje, datos)
    select r.id, r.entidad, c.entidad_id, r.severidad, r.nombre, regla_mensaje(r.mensaje, c.datos), c.datos
      from _regla_cand c
     where not exists (
       select 1 from alertas a
        where a.regla_id = r.id and a.entidad_id = c.entidad_id
          and (not a.atendida or a.atendida_por is not null)
     );
    get diagnostics v_nuevas = row_count;

    select count(*) into v_abiertas from alertas a where a.regla_id = r.id and not a.atendida;

    insert into reglas_evaluacion as re (regla_id, evaluada_en, abiertas, nuevas, cerradas, medible)
    values (r.id, now(), v_abiertas, v_nuevas, v_cerradas, v_medible)
    on conflict on constraint reglas_evaluacion_pkey do update
      set evaluada_en = excluded.evaluada_en, abiertas = excluded.abiertas,
          nuevas = excluded.nuevas, cerradas = excluded.cerradas, medible = excluded.medible;

    regla_id := r.id; medible := v_medible; abiertas := v_abiertas; nuevas := v_nuevas; cerradas := v_cerradas;
    return next;
  end loop;
end $$;
comment on function reglas_evaluar is
  'Evalúa las reglas de alerta (todas o una): abre, refresca y cierra sus alertas (070).';
revoke all on function reglas_evaluar(bigint) from public, anon;
grant execute on function reglas_evaluar(bigint) to authenticated;


-- ============================================================================
--  11 · LA PRIMERA PASADA Y LOS TRABAJOS PROGRAMADOS
-- ============================================================================
select facturas_actualizar_estados();
select count(*) from reglas_evaluar(null);

do $$
begin
  -- 00:05 de Lima (05:05 UTC): las facturas que vencieron ayer amanecen vencidas.
  perform cron.unschedule('actualizar_estado_facturas')
    where exists (select 1 from cron.job where jobname = 'actualizar_estado_facturas');
  perform cron.schedule('actualizar_estado_facturas', '5 5 * * *', 'select facturas_actualizar_estados()');

  -- 06:50 de Lima, después de los demás avisos de la mañana.
  perform cron.unschedule('evaluar_reglas')
    where exists (select 1 from cron.job where jobname = 'evaluar_reglas');
  perform cron.schedule('evaluar_reglas', '50 11 * * *', 'select count(*) from reglas_evaluar(null)');
end $$;
