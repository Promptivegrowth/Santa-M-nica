-- ============================================================================
--  070b · ANULAR UN COBRO MAL REGISTRADO · ALERTAS DE LOTE SIN DUPLICAR
-- ============================================================================
--  1. UN COBRO NO SE BORRA: SE ANULA
--     Un pago mal registrado (monto equivocado, factura equivocada) se anula
--     dejando el motivo, quién y cuándo. Deja de contar en el saldo —el estado
--     de la factura y la situación del pedido se recalculan solos— pero sigue
--     a la vista, tachado, para que la caja se pueda reconstruir. Borrarlo
--     haría desaparecer justo el rastro que una auditoría pide.
--
--     Todo lo que suma cobros pasa a sumar solo los VIGENTES: las cuentas por
--     cobrar, la lista de comprobantes, el estado guardado, el control de
--     saldo al cobrar, la regla «no se anula una factura con cobros» y los
--     tiempos del flujo (la fecha de cobro).
--
--  2. LA REGLA MÁS GRAVE GANA
--     «Producto con más de 12 meses en cámara» abría alerta también para los
--     pallets que ya estaban en «Producto que superó la vida útil» (24 meses):
--     el mismo pallet salía dos veces. Cuando dos reglas activas miden lo mismo
--     sobre lo mismo (misma entidad y mismo campo), el registro queda solo en
--     la de mayor severidad. Si la grave se apaga, la otra lo vuelve a cubrir.
--
--  Re-ejecutable. Después de aplicarla se vuelve a correr la 072 (permisos).
-- ============================================================================


-- ============================================================================
--  1 · EL COBRO ANULADO
-- ============================================================================
alter table cobranzas add column if not exists anulada boolean not null default false;
alter table cobranzas add column if not exists anulada_por uuid references usuarios(id);
alter table cobranzas add column if not exists anulada_en timestamptz;
alter table cobranzas add column if not exists motivo_anulacion text;
comment on column cobranzas.anulada is
  'Cobro mal registrado y anulado (070b): no cuenta en el saldo, pero no se borra.';


/* ---- Cuentas por cobrar: solo los cobros vigentes (mismas columnas) ---- */
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
    from cobranzas x where x.factura_id = f.id and not x.anulada
) cb
where f.estado <> 'anulada';

/* ---- La lista de comprobantes: igual ---- */
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
    from cobranzas x where x.factura_id = f.id and not x.anulada
) cb;

/* ---- Tiempos del flujo: la fecha de cobro sale de un cobro vigente ----
   Se toca solo la condición del cruce, sobre la definición que esté viva
   (esta vista es de otra área y puede haber cambiado). */
do $$
declare
  v_def text := pg_get_viewdef('v_tiempos_flujo'::regclass, true);
begin
  if v_def not ilike '%cb.factura_id = fa.id AND NOT cb.anulada%' then
    v_def := replace(v_def,
      'LEFT JOIN cobranzas cb ON cb.factura_id = fa.id',
      'LEFT JOIN cobranzas cb ON cb.factura_id = fa.id AND NOT cb.anulada');
    execute 'create or replace view v_tiempos_flujo as ' || v_def;
  end if;
end $$;


/* ---- El estado guardado: suma solo cobros vigentes ---- */
create or replace function facturas_sincronizar_estado(p_factura_id bigint)
returns estado_factura
language plpgsql security definer set search_path = public as $$
declare
  f         facturas%rowtype;
  v_cobrado numeric;
  v_nuevo   estado_factura;
  v_sit     situacion_financiera;
begin
  select * into f from facturas where id = p_factura_id;
  if not found or f.estado = 'anulada' then return f.estado; end if;

  select coalesce(sum(monto), 0) into v_cobrado
    from cobranzas where factura_id = p_factura_id and not anulada;
  v_nuevo := estado_factura_al_dia(f.estado, f.total, v_cobrado, f.fecha_vencimiento);

  if v_nuevo is distinct from f.estado then
    update facturas set estado = v_nuevo where id = p_factura_id;
  end if;

  if f.pedido_id is not null then
    v_sit := case v_nuevo
      when 'cobrada'              then 'cobrado'::situacion_financiera
      when 'parcialmente_cobrada' then 'parcialmente_cobrado'::situacion_financiera
      when 'vencida'              then 'vencido'::situacion_financiera
      else 'facturado'::situacion_financiera
    end;
    update pedidos set situacion = v_sit
     where id = f.pedido_id
       and situacion in ('facturado', 'parcialmente_cobrado', 'cobrado', 'vencido')
       and situacion is distinct from v_sit;
  end if;

  return v_nuevo;
end $$;
revoke all on function facturas_sincronizar_estado(bigint) from public, anon, authenticated;

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
      cross join lateral (
        select coalesce(sum(monto), 0) as cobrado from cobranzas
         where factura_id = f.id and not anulada
      ) cb
     where f.estado <> 'anulada'
       and f.estado is distinct from estado_factura_al_dia(f.estado, f.total, cb.cobrado, f.fecha_vencimiento)
  loop
    perform facturas_sincronizar_estado(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function facturas_actualizar_estados() from public, anon, authenticated;


/* ---- Al cobrar, el saldo es el de los cobros vigentes ----
   Y un cobro anulado ya no se toca: ni se reactiva ni cambia su monto. */
create or replace function cobranzas_validar()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  f         facturas%rowtype;
  v_cobrado numeric;
  v_saldo   numeric;
begin
  if tg_op = 'UPDATE' then
    if old.anulada and auth.uid() is not null then
      raise exception 'Ese cobro está anulado: no se modifica ni se reactiva. Si el pago era bueno, regístrelo de nuevo.';
    end if;
    -- Anular (y nada más) no pasa por el control de saldo.
    if new.anulada and not old.anulada then
      if auth.uid() is not null and not puede('gerencia', 'operaciones') then
        raise exception 'Solo Gerencia y Operaciones anulan cobros.' using errcode = 'insufficient_privilege';
      end if;
      if length(trim(coalesce(new.motivo_anulacion, ''))) < 10 then
        raise exception 'Escriba el motivo de la anulación del cobro (al menos 10 caracteres).';
      end if;
      if (new.monto, new.fecha, new.factura_id) is distinct from (old.monto, old.fecha, old.factura_id) then
        raise exception 'Al anular un cobro no se cambia su monto, su fecha ni su comprobante.';
      end if;
      return new;
    end if;
  end if;
  if new.anulada then return new; end if;

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
     and not anulada
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
  before insert or update of monto, fecha, factura_id, anulada on cobranzas
  for each row execute function cobranzas_validar();

/* ---- registrar_cobranza: el saldo que devuelve, sin los anulados ---- */
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

  insert into cobranzas (factura_id, monto, fecha, medio, referencia, observaciones, registrado_por)
  values (p_factura_id, round(p_monto, 2), p_fecha, trim(p_medio),
          nullif(trim(coalesce(p_referencia, '')), ''),
          nullif(trim(coalesce(p_observaciones, '')), ''),
          auth.uid())
  returning id into v_id;

  select * into f from facturas where id = p_factura_id;
  select round(f.total - coalesce(sum(monto), 0), 2) into v_saldo
    from cobranzas where factura_id = p_factura_id and not anulada;

  perform registrar_evento(
    'facturas', p_factura_id, 'cobranza_registrada',
    format('Cobro de %s %s sobre %s (%s, del %s)%s · saldo %s',
           f.moneda, to_char(round(p_monto, 2), 'FM999G999G990D00'), f.numero, trim(p_medio),
           to_char(p_fecha, 'DD/MM/YYYY'),
           coalesce(' · ref. ' || nullif(trim(coalesce(p_referencia, '')), ''), ''),
           to_char(v_saldo, 'FM999G999G990D00')),
    'info',
    jsonb_build_object('cobranza_id', v_id, 'monto', round(p_monto, 2), 'saldo', v_saldo, 'estado', f.estado));

  return jsonb_build_object('id', v_id, 'numero', f.numero, 'moneda', f.moneda,
                            'saldo', v_saldo, 'estado', f.estado);
end $$;

/* ---- Anular una factura: lo que la frena son los cobros VIGENTES ---- */
create or replace function facturas_proteger()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
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
    if exists (select 1 from cobranzas where factura_id = new.id and not anulada) then
      raise exception '% tiene cobros registrados. Anularlo descuadraría la caja: primero hay que anular esos cobros.', new.numero;
    end if;
    if length(trim(coalesce(new.motivo_anulacion, ''))) < 10 then
      raise exception 'Escriba el motivo de la anulación (al menos 10 caracteres): queda en el comprobante para la contabilidad.';
    end if;
  end if;

  return new;
end $$;

/* ---- La puerta de la pantalla ---- */
create or replace function anular_cobranza(p_cobranza_id bigint, p_motivo text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c        cobranzas%rowtype;
  f        facturas%rowtype;
  v_saldo  numeric;
  v_estado estado_factura;
begin
  if not puede('gerencia', 'operaciones') then
    raise exception 'Solo Gerencia y Operaciones anulan cobros.' using errcode = 'insufficient_privilege';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 10 then
    raise exception 'Escriba el motivo de la anulación del cobro (al menos 10 caracteres).';
  end if;

  select * into c from cobranzas where id = p_cobranza_id for update;
  if not found then raise exception 'Ese cobro ya no existe.'; end if;
  if c.anulada then raise exception 'Ese cobro ya estaba anulado.'; end if;

  select * into f from facturas where id = c.factura_id;
  if f.estado = 'anulada' then
    raise exception '% está anulado: sus cobros ya no cuentan.', f.numero;
  end if;

  -- El disparador de cobranzas recalcula el estado de la factura y del pedido.
  update cobranzas
     set anulada = true, anulada_por = auth.uid(), anulada_en = now(),
         motivo_anulacion = trim(p_motivo)
   where id = p_cobranza_id;

  select round(f.total - coalesce(sum(monto), 0), 2) into v_saldo
    from cobranzas where factura_id = f.id and not anulada;
  select estado into v_estado from facturas where id = f.id;

  perform registrar_evento(
    'facturas', f.id, 'cobranza_anulada',
    format('Cobro de %s %s del %s anulado%s. Motivo: %s · saldo %s',
           f.moneda, to_char(c.monto, 'FM999G999G990D00'), to_char(c.fecha, 'DD/MM/YYYY'),
           coalesce(' (ref. ' || c.referencia || ')', ''), trim(p_motivo),
           to_char(v_saldo, 'FM999G999G990D00')),
    'advertencia',
    jsonb_build_object('cobranza_id', c.id, 'monto', c.monto, 'motivo', trim(p_motivo),
                       'saldo', v_saldo, 'estado', v_estado));

  return jsonb_build_object('numero', f.numero, 'moneda', f.moneda, 'monto', c.monto,
                            'saldo', v_saldo, 'estado', v_estado);
end $$;
revoke all on function anular_cobranza(bigint, text) from public, anon;
grant execute on function anular_cobranza(bigint, text) to authenticated;


-- ============================================================================
--  2 · REGLAS: EL MISMO REGISTRO, SOLO EN LA REGLA MÁS GRAVE
-- ============================================================================
create or replace function regla_rango(p severidad_alerta)
returns int language sql immutable as $$
  select case p when 'critica' then 3 when 'advertencia' then 2 else 1 end;
$$;

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
  if auth.uid() is not null and not puede('gerencia', 'operaciones') then
    raise exception 'Solo Gerencia y Operaciones pueden evaluar las reglas.' using errcode = 'insufficient_privilege';
  end if;

  create temp table if not exists _regla_cand (
    entidad_id bigint primary key, valor numeric, datos jsonb
  ) on commit drop;

  /*
   * Al tocar una regla se evalúan también las que miden lo mismo (misma
   * entidad y campo): apagar «vida útil» hace que «12 meses» recupere esos
   * pallets, y encenderla hace que los suelte.
   */
  for r in
    select x.* from reglas x
     where p_regla_id is null
        or x.id = p_regla_id
        or exists (select 1 from reglas y
                    where y.id = p_regla_id and y.entidad = x.entidad
                      and y.condicion->>'campo' = x.condicion->>'campo')
     order by x.id
  loop
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
        v_medible := false;
      end if;

      delete from _regla_cand c where not regla_cumple(c.valor, v_op, v_umbral);

      /* La regla más grave gana: fuera lo que ya cubre otra activa, sobre lo
         mismo, de mayor severidad (o igual severidad y umbral más exigente). */
      delete from _regla_cand c
       where exists (
         select 1 from reglas o
          where o.id <> r.id and o.activa
            and o.entidad = r.entidad
            and o.condicion->>'campo' = r.condicion->>'campo'
            and (regla_rango(o.severidad) > regla_rango(r.severidad)
                 or (regla_rango(o.severidad) = regla_rango(r.severidad) and o.id < r.id))
            and regla_cumple(c.valor, o.condicion->>'operador', nullif(o.condicion->>'valor', '')::numeric)
       );
    end if;

    update alertas a
       set atendida = true,
           atendida_en = now(),
           datos = coalesce(a.datos, '{}'::jsonb)
                   || jsonb_build_object('cerrada_por', case when r.activa then 'condicion_resuelta' else 'regla_desactivada' end)
     where a.regla_id = r.id and not a.atendida
       and (not r.activa or not v_medible
            or not exists (select 1 from _regla_cand c where c.entidad_id = a.entidad_id));
    get diagnostics v_cerradas = row_count;

    update alertas a
       set mensaje = regla_mensaje(r.mensaje, c.datos),
           titulo = r.nombre,
           severidad = r.severidad,
           entidad = r.entidad,
           datos = c.datos
      from _regla_cand c
     where a.regla_id = r.id and not a.atendida and a.entidad_id = c.entidad_id;

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
revoke all on function reglas_evaluar(bigint) from public, anon;
grant execute on function reglas_evaluar(bigint) to authenticated;


-- ============================================================================
--  3 · PRIMERA PASADA
-- ============================================================================
select facturas_actualizar_estados();
select count(*) from reglas_evaluar(null);
