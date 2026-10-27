-- ============================================================================
--  075 · EL DESPACHO CON LO QUE SALIÓ DE VERDAD
-- ============================================================================
--  Pedido de Oliver Tello (jefe de Operaciones), reunión de octubre:
--
--    «Al despachar un contenedor no siempre sale la cantidad exacta que se
--     cargó en el packing. A veces se ejecutan muestreos —se sacan sacos o
--     kilos como muestra— u ocurre otro inconveniente: sacos dañados, un
--     pallet que no entra, un rechazo en el muelle…»
--
--  Hasta ahora ejecutar_despacho sacaba del Kardex y de las reservas
--  EXACTAMENTE lo cargado en el packing. Desde aquí, quien despacha puede
--  declarar por pallet lo que salió de verdad, con un motivo obligatorio
--  cuando difiere. Lo que pasa con la diferencia depende del motivo:
--
--    · MUESTREO y SACOS DAÑADOS / MERMA → salen del stock, pero NO como venta:
--      cada uno es su propio movimiento del Kardex (salida_muestra,
--      salida_merma), igual que en Ajustes de stock (069), con su motivo del
--      catálogo. La reserva de esos kilos se libera: ya no hay mercadería que
--      la respalde.
--    · NO ENTRÓ EN EL CONTENEDOR y OTRO → la mercadería vuelve a cámara (no se
--      escribe nada en el Kardex) y su reserva SIGUE apartada para el mismo
--      pedido: queda pendiente para el próximo embarque y se puede liberar
--      desde Reservas como cualquier otra.
--
--  En los cuatro casos el cliente recibe menos, así que el pedido y el
--  embarque tienen que decirlo:
--    · El despachado del pedido (reservas consumidas) ya cuenta solo lo que
--      salió, porque solo eso se consume.
--    · El embarque guarda, línea por línea, cuánto NO salió
--      (embarque_lineas.kg_no_despachado). Cuando el embarque queda
--      despachado, eso deja de contar como «programado» y vuelve a «por
--      programar»: el pedido se puede meter en otro embarque por ese saldo.
--    · El packing guarda lo cargado y lo despachado (packing_lineas): sus
--      columnas de siempre pasan a decir lo que SALIÓ —así el margen, el
--      cierre, los objetivos, la trazabilidad y el recall cuentan lo real sin
--      tocarlos— y las nuevas guardan lo que se había cargado y el motivo.
--    · El Fill Rate compara lo cargado (lo que se planeó mandar) con lo que
--      salió.
--
--  DE PASO, TRES ARREGLOS DEL DESPACHO
--    1. Un pallet que Calidad bloqueó DESPUÉS de subirlo al contenedor ya no
--       sale: la base lo rechaza diciendo qué pallet y por qué. (Hasta hoy el
--       despacho no miraba el bloqueo.)
--    2. La función no comprobaba el rol (era SECURITY DEFINER sin puede()).
--    3. Lo que salió en un packing ya despachado no se puede editar ni borrar
--       desde la aplicación: es historia, igual que el Kardex.
--
--  Re-ejecutable: columnas «if not exists», restricciones en bloques DO,
--  funciones «create or replace», vistas que solo agregan columnas al final.
-- ============================================================================


/* ==========================================================================
   1 · LO CARGADO Y LO DESPACHADO, EN EL PACKING
   ========================================================================== */
alter table packing_lineas add column if not exists bultos_cargados    int;
alter table packing_lineas add column if not exists kg_cargados        numeric(14,3);
alter table packing_lineas add column if not exists motivo_diferencia  text;
alter table packing_lineas add column if not exists detalle_diferencia text;

comment on column packing_lineas.bultos is
  'Bultos del pallet en el contenedor. Antes de despachar, lo cargado; después, lo que SALIÓ de verdad (075).';
comment on column packing_lineas.peso_neto_kg is
  'Kilos del pallet en el contenedor. Antes de despachar, lo cargado; después, lo que SALIÓ de verdad (075).';
comment on column packing_lineas.bultos_cargados is
  'Solo si al despachar salió distinto de lo cargado: los bultos que se habían cargado (075). Nulo = salió todo.';
comment on column packing_lineas.kg_cargados is
  'Solo si al despachar salió distinto de lo cargado: los kilos que se habían cargado (075).';
comment on column packing_lineas.motivo_diferencia is
  'Por qué salió distinto de lo cargado: muestreo, merma (sacos dañados), no_entro (no entró en el contenedor) u otro (075).';
comment on column packing_lineas.detalle_diferencia is
  'Lo que escribió quien despachó sobre la diferencia (obligatorio con «otro»).';

do $$
begin
  --  Un pallet que no entró entero queda con 0 bultos y 0 kg despachados: eso
  --  solo vale si se guardó lo cargado.
  if exists (select 1 from pg_constraint where conrelid = 'packing_lineas'::regclass and conname = 'packing_lineas_bultos_check') then
    alter table packing_lineas drop constraint packing_lineas_bultos_check;
  end if;
  if exists (select 1 from pg_constraint where conrelid = 'packing_lineas'::regclass and conname = 'packing_lineas_peso_neto_kg_check') then
    alter table packing_lineas drop constraint packing_lineas_peso_neto_kg_check;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'packing_lineas'::regclass and conname = 'packing_lineas_cantidades_validas') then
    alter table packing_lineas add constraint packing_lineas_cantidades_validas check (
      (bultos > 0 and peso_neto_kg > 0)
      or (bultos_cargados is not null and bultos >= 0 and peso_neto_kg >= 0)
    );
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'packing_lineas'::regclass and conname = 'packing_lineas_despacho_coherente') then
    alter table packing_lineas add constraint packing_lineas_despacho_coherente check (
      bultos_cargados is null
      or (kg_cargados is not null and motivo_diferencia is not null
          and bultos <= bultos_cargados and peso_neto_kg <= kg_cargados + 0.001)
    );
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'packing_lineas'::regclass and conname = 'packing_lineas_motivo_diferencia_valido') then
    alter table packing_lineas add constraint packing_lineas_motivo_diferencia_valido check (
      motivo_diferencia is null or motivo_diferencia in ('muestreo', 'merma', 'no_entro', 'otro')
    );
  end if;
end $$;


/* ==========================================================================
   2 · LO QUE NO SALIÓ, EN EL EMBARQUE
   ========================================================================== */
alter table embarque_lineas add column if not exists kg_no_despachado numeric(14,3) not null default 0;
comment on column embarque_lineas.kg_no_despachado is
  'Kilos de esta línea que estaban en el contenedor y no salieron (muestreo, merma, no entró…). Con el embarque despachado dejan de contar como programados (075).';

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'embarque_lineas'::regclass and conname = 'embarque_lineas_no_despachado_valido') then
    alter table embarque_lineas add constraint embarque_lineas_no_despachado_valido
      check (kg_no_despachado >= 0 and kg_no_despachado <= cantidad_kg + 0.001);
  end if;
end $$;


/* ==========================================================================
   3 · LOS MOTIVOS DEL KARDEX PARA LO QUE SALE AL DESPACHAR
   --------------------------------------------------------------------------
   Los mismos tipos de movimiento que Ajustes de stock (069): una muestra es
   salida_muestra y una merma es salida_merma, cada una con su motivo del
   catálogo. Se agregan dos motivos propios para que el Kardex y los reportes
   distingan lo que salió en el muelle de lo que se sacó en cámara.
   La merma pide autorización como todas las mermas: en Ajustes de stock la
   registra Gerencia u Operaciones. En el despacho no se exige, porque la
   declara quien despacha frente al contenedor y queda con su nombre.
   ========================================================================== */
insert into motivos (ambito, codigo, nombre, requiere_autorizacion, activo, tipos_movimiento)
values ('salida', 'M_DESPACHO', 'Muestreo al despachar', false, true, array['salida_muestra']::tipo_movimiento[]),
       ('salida', 'MERMA_DESPACHO', 'Sacos dañados al despachar', true, true, array['salida_merma']::tipo_movimiento[])
on conflict (ambito, codigo) do nothing;


/* ==========================================================================
   4 · UN PACKING DESPACHADO NO SE EDITA
   --------------------------------------------------------------------------
   Lo que dice un packing cerrado es lo que salió: el margen, el reporte de
   carga y la trazabilidad se leen de ahí. Ya no admitía pallets nuevos
   (068); ahora tampoco se cambian ni se quitan los que tiene. Las sesiones
   de servicio (sin usuario: migraciones, limpieza de pruebas) sí pueden.
   ejecutar_despacho actualiza las líneas ANTES de cerrar el packing.
   ========================================================================== */
create or replace function packing_lineas_cerrado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_estado estado_packing; v_codigo text;
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  select estado, codigo into v_estado, v_codigo
    from packing_lists where id = coalesce(old.packing_list_id, new.packing_list_id);
  if v_estado = 'cerrado' then
    raise exception 'El packing % ya se despachó: lo que salió no se cambia. Si hay un error, se corrige con un ajuste de stock.', v_codigo
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_packing_lineas_cerrado on packing_lineas;
create trigger trg_packing_lineas_cerrado
  before update or delete on packing_lineas
  for each row execute function packing_lineas_cerrado();


/* ==========================================================================
   5 · POR QUÉ UN PALLET ESTÁ BLOQUEADO, EN UNA FRASE
   --------------------------------------------------------------------------
   Lo mismo que lote_bloqueado(), pero diciendo qué dictamen y por qué: es lo
   que necesita leer quien está frente al contenedor. Nulo si no está
   bloqueado. La usan el despacho y la ficha del packing.
   ========================================================================== */
create or replace function lote_bloqueo_texto(p_lote_id bigint)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select string_agg(
           format('%s%s',
             case d.estado
               when 'inmovilizado' then 'inmovilizado'
               when 'observado' then 'observado'
               else 'en espera de resultados' end,
             coalesce(': ' || nullif(btrim(coalesce(m.nombre, d.motivo_texto, '')), ''), '')),
           ' · ' order by d.emitido_en desc)
    from dictamenes_calidad d
    left join motivos m on m.id = d.motivo_id
   where d.lote_id = p_lote_id and d.vigente
     and d.estado in ('observado', 'inmovilizado', 'espera_resultados')
     and not coalesce(m.condiciona_venta, false);
$$;
comment on function lote_bloqueo_texto is
  'Por qué un pallet está bloqueado por Calidad («inmovilizado: Producto parasitado»), o nulo si no lo está (075).';
revoke execute on function lote_bloqueo_texto(bigint) from public, anon;
grant execute on function lote_bloqueo_texto(bigint) to authenticated;


/* ==========================================================================
   6 · EJECUTAR EL DESPACHO, CON LO QUE SALIÓ
   --------------------------------------------------------------------------
   p_ajustes: nulo o una lista, un elemento por pallet que salió distinto:
     [{ "lote_id": 12, "bultos": 48, "kg": 1200, "motivo": "muestreo",
        "detalle": "SGS sacó 2 sacos" }]
   «bultos» y «kg» son lo que SALIÓ. Un pallet que no está en la lista salió
   entero. Todo pasa o nada pasa: la función corre en una transacción.
   ========================================================================== */
drop function if exists ejecutar_despacho(bigint, text);

create or replace function ejecutar_despacho(
  p_packing_list_id bigint,
  p_numero          text,
  p_ajustes         jsonb default null
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  pk  packing_lists%rowtype;
  emb embarques%rowtype;
  ln  record;
  r   record;
  aj  jsonb;
  ex  existencias%rowtype;
  v_despacho_id bigint;
  v_db int;  v_dk numeric(14,3);        -- lo que salió
  v_xb int;  v_xk numeric(14,3);        -- la diferencia
  v_motivo  text;
  v_detalle text;
  v_sale_dif boolean;                   -- ¿la diferencia sale del stock?
  v_sale_b  int;                        -- lo que sale del stock en total
  v_sale_kg numeric(14,3);
  v_bloqueo text;
  v_motivo_id bigint;
  v_nombre_dif text;
  v_costo numeric;
  v_queda  numeric;                     -- kilos por consumir
  v_suelta numeric;                     -- kilos de reserva por liberar
  v_aparte numeric;                     -- kilos que siguen apartados (no salieron)
  v_resto  numeric;
  v_rb     int;
  v_parte  numeric;
  v_bultos int;
  v_n      numeric;
  v_linea  text;
  v_no_salio jsonb := '{}'::jsonb;      -- pedido_linea_id → kg que no salieron
  v_diferencias text[] := '{}';
  v_cargado_kg numeric := 0;
  v_salio_kg   numeric := 0;
  k text;
begin
  /* ---- Quién ---- */
  if not puede('gerencia', 'operaciones', 'almacen', 'comex') then
    raise exception 'Despachan Gerencia, Operaciones, Almacén o Comercio Exterior: su usuario no puede sacar mercadería de cámara.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into pk from packing_lists where id = p_packing_list_id for update;
  if not found then raise exception 'Ese packing list ya no existe.'; end if;
  if pk.estado = 'cerrado' then raise exception 'El packing % ya fue despachado.', pk.codigo; end if;
  if pk.estado = 'anulado' then
    raise exception 'El packing % está anulado (su embarque se canceló): no se puede despachar.', pk.codigo;
  end if;

  select * into emb from embarques where id = pk.embarque_id;

  if not exists (select 1 from packing_lineas where packing_list_id = p_packing_list_id) then
    raise exception 'El packing % no tiene ni un pallet cargado.', pk.codigo;
  end if;
  if not exists (select 1 from plano_estiba where packing_list_id = p_packing_list_id) then
    raise exception 'No se puede despachar sin plano de estiba: sin él no se sabe qué pallet quedó en cada fila del contenedor.';
  end if;

  /* ---- Los ajustes tienen que ser de pallets de este contenedor, uno por pallet ---- */
  if p_ajustes is not null and jsonb_typeof(p_ajustes) <> 'array' then
    raise exception 'Lo que salió de cada pallet llegó mal armado. Recargue la pantalla y vuelva a intentarlo.';
  end if;
  if exists (
      select 1 from jsonb_array_elements(coalesce(p_ajustes, '[]'::jsonb)) x
       where not exists (select 1 from packing_lineas pl
                          where pl.packing_list_id = p_packing_list_id
                            and pl.lote_id::text = x->>'lote_id')) then
    raise exception 'Se indicó lo que salió de un pallet que no está en este contenedor. Recargue la pantalla.';
  end if;
  if (select count(*) from jsonb_array_elements(coalesce(p_ajustes, '[]'::jsonb)))
     <> (select count(distinct x->>'lote_id') from jsonb_array_elements(coalesce(p_ajustes, '[]'::jsonb)) x) then
    raise exception 'Un mismo pallet llegó dos veces en lo que salió. Recargue la pantalla.';
  end if;

  insert into despachos (packing_list_id, numero, almacen_id, encargado_id, creado_por)
  values (p_packing_list_id, p_numero, emb.almacen_id, pk.supervisor_id, auth.uid())
  returning id into v_despacho_id;

  for ln in
    select pl.*, l.codigo_pallet
      from packing_lineas pl join lotes l on l.id = pl.lote_id
     where pl.packing_list_id = p_packing_list_id
     order by pl.id
  loop
    /* ---- 1 · Lo que salió de este pallet ---- */
    select x into aj from jsonb_array_elements(coalesce(p_ajustes, '[]'::jsonb)) x
     where x->>'lote_id' = ln.lote_id::text limit 1;

    begin
      v_db := coalesce((aj->>'bultos')::int, ln.bultos);
      v_dk := round(coalesce((aj->>'kg')::numeric, ln.peso_neto_kg), 3);
    exception when others then
      raise exception 'Lo que salió del pallet % no es un número: revise los bultos y los kilos.', ln.codigo_pallet;
    end;

    if v_db < 0 or v_dk < 0 then
      raise exception 'Del pallet % no pueden salir cantidades negativas.', ln.codigo_pallet;
    end if;
    if v_db > ln.bultos then
      raise exception 'Del pallet % se cargaron % bultos: no pueden salir % (no se despacha más de lo cargado).',
        ln.codigo_pallet, ln.bultos, v_db;
    end if;
    if v_dk > ln.peso_neto_kg + 0.001 then
      raise exception 'Del pallet % se cargaron % kg: no pueden salir % kg (no se despacha más de lo cargado).',
        ln.codigo_pallet, texto_kg(ln.peso_neto_kg), texto_kg(v_dk);
    end if;
    if (v_db = 0) <> (v_dk <= 0.0005) then
      raise exception 'Del pallet % salen % bultos y % kg: si salen bultos tienen que salir kilos, y al revés.',
        ln.codigo_pallet, v_db, texto_kg(v_dk);
    end if;

    v_xb := ln.bultos - v_db;
    v_xk := round(ln.peso_neto_kg - v_dk, 3);
    if v_xk < 0 then v_xk := 0; end if;
    v_motivo := null; v_detalle := null; v_sale_dif := false;

    if v_xb > 0 or v_xk > 0.0005 then
      v_motivo  := nullif(btrim(coalesce(aj->>'motivo', '')), '');
      v_detalle := nullif(btrim(coalesce(aj->>'detalle', '')), '');
      if v_motivo is null or v_motivo not in ('muestreo', 'merma', 'no_entro', 'otro') then
        raise exception 'Del pallet % salen % de % bultos: diga el motivo de la diferencia (muestreo, sacos dañados, no entró u otro).',
          ln.codigo_pallet, v_db, ln.bultos;
      end if;
      if v_motivo = 'otro' and length(coalesce(v_detalle, '')) < 5 then
        raise exception 'Del pallet % salió distinto de lo cargado por «otro» motivo: escriba qué pasó (al menos 5 letras).', ln.codigo_pallet;
      end if;
      if v_xb > 0 and v_xk <= 0.0005 then
        raise exception 'Del pallet % salen % bultos menos pero los mismos kilos: corrija los kilos que salieron.', ln.codigo_pallet, v_xb;
      end if;
      if v_motivo in ('no_entro', 'otro') and v_xb = 0 then
        raise exception 'Lo que no sale del pallet % vuelve a cámara en sacos enteros: indique cuántos bultos no salieron.', ln.codigo_pallet;
      end if;
      v_sale_dif := v_motivo in ('muestreo', 'merma');
    end if;

    /* ---- 2 · Un pallet bloqueado por Calidad no sale ----
       Solo puede quedarse en cámara: «no entró» u «otro» por el pallet entero. */
    v_bloqueo := lote_bloqueo_texto(ln.lote_id);
    if v_bloqueo is not null and (v_db > 0 or v_sale_dif) then
      raise exception 'El pallet % está bloqueado por Calidad (%) y no puede salir. Quítelo del contenedor o espere a que Calidad lo libere.',
        ln.codigo_pallet, v_bloqueo
        using hint = 'bloqueado_calidad';
    end if;

    /* ---- 3 · Tiene que estar en la bodega ---- */
    select * into ex from existencias
     where lote_id = ln.lote_id and almacen_id = emb.almacen_id for update;
    v_sale_b  := v_db + (case when v_sale_dif then v_xb else 0 end);
    v_sale_kg := v_dk + (case when v_sale_dif then v_xk else 0 end);
    if v_sale_b > 0 or v_sale_kg > 0.0005 then
      if not found or ex.bultos < v_sale_b or ex.peso_neto_kg < v_sale_kg - 0.001 then
        raise exception 'El pallet % ya no tiene en la bodega lo que se cargó: hay % bultos · % kg y saldrían % bultos · % kg. Revise el contenedor.',
          ln.codigo_pallet, coalesce(ex.bultos, 0), texto_kg(coalesce(ex.peso_neto_kg, 0)),
          v_sale_b, texto_kg(v_sale_kg);
      end if;
    end if;
    v_costo := coalesce(ex.costo_promedio, 0);

    /* ---- 4 · El Kardex: lo que salió al cliente ---- */
    if v_db > 0 then
      insert into movimientos (tipo, lote_id, almacen_id, bultos, peso_neto_kg, costo_unitario,
                               documento_tipo, documento_id, documento_ref, usuario_id, observaciones)
      values ('salida_despacho', ln.lote_id, emb.almacen_id, v_db, v_dk, v_costo,
              'despacho', v_despacho_id, p_numero, auth.uid(),
              case when v_motivo is not null then
                format('Cargados %s · %s kg; salieron %s · %s kg.', texto_bultos(ln.bultos), texto_kg(ln.peso_neto_kg),
                       texto_bultos(v_db), texto_kg(v_dk)) end);
    end if;

    /* ---- 5 · El Kardex: la muestra o la merma, cada una con su movimiento ---- */
    if v_sale_dif then
      select id, nombre into v_motivo_id, v_nombre_dif from motivos
       where ambito = 'salida' and codigo = case v_motivo when 'muestreo' then 'M_DESPACHO' else 'MERMA_DESPACHO' end;
      insert into movimientos (tipo, lote_id, almacen_id, bultos, peso_neto_kg, costo_unitario, motivo_id,
                               documento_tipo, documento_id, documento_ref, usuario_id, autorizado_por, observaciones)
      values (case v_motivo when 'muestreo' then 'salida_muestra' else 'salida_merma' end::tipo_movimiento,
              ln.lote_id, emb.almacen_id, v_xb, v_xk, v_costo, v_motivo_id,
              'despacho', v_despacho_id, p_numero, auth.uid(),
              case when puede('gerencia', 'operaciones') then auth.uid() end,
              format('%s en el despacho %s (packing %s)%s', coalesce(v_nombre_dif, 'Salida'), p_numero, pk.codigo,
                     coalesce(': ' || v_detalle, '.')));
    end if;

    /* ---- 6 · Las reservas ----
       En el mismo orden de siempre (066): primero la de la línea del pedido a
       la que va el pallet, luego las de los pedidos de este embarque.
         a) se consume lo que salió;
         b) si la diferencia salió del stock (muestra, merma), se libera esa
            parte de la reserva: ya no hay mercadería que la respalde;
         c) si no salió del stock (no entró, otro), la reserva sigue apartada.
       En b) y c) se anota a qué línea del pedido le faltó: eso es lo que el
       embarque deja de dar por programado. */
    v_queda  := v_dk;
    v_suelta := case when v_sale_dif then v_xk else 0 end;
    v_aparte := case when v_motivo in ('no_entro', 'otro') then v_xk else 0 end;
    for r in
      select rv.*
        from reservas rv
        join pedido_lineas pl on pl.id = rv.pedido_linea_id
       where rv.lote_id = ln.lote_id
         and rv.almacen_id = emb.almacen_id
         and rv.estado in ('activa', 'en_preparacion')
         and (rv.pedido_linea_id = ln.pedido_linea_id
              or pl.pedido_id in (select pedido_id from embarque_pedidos where embarque_id = pk.embarque_id))
       order by (rv.pedido_linea_id = ln.pedido_linea_id) desc nulls last, rv.id
       for update of rv
    loop
      exit when v_queda <= 0.0005 and v_suelta <= 0.0005 and v_aparte <= 0.0005;
      v_resto := r.peso_neto_kg;
      v_rb    := r.bultos;

      -- a) Lo que salió: consumida.
      if v_queda > 0.0005 then
        if v_resto <= v_queda + 0.0005 then
          update reservas set estado = 'consumida' where id = r.id;
          v_queda := v_queda - v_resto;
          continue;
        end if;
        v_parte  := v_queda;
        v_bultos := greatest(1, round(v_rb * v_parte / v_resto)::int);
        v_resto  := v_resto - v_parte;
        v_rb     := greatest(1, v_rb - v_bultos);
        update reservas set peso_neto_kg = v_resto, bultos = v_rb where id = r.id;
        insert into reservas (pedido_linea_id, lote_id, almacen_id, bultos, peso_neto_kg, estado,
                              vence_el, creado_por, observaciones)
        values (r.pedido_linea_id, r.lote_id, r.almacen_id, v_bultos, v_parte, 'consumida',
                r.vence_el, auth.uid(), format('Parte despachada en %s', p_numero));
        v_queda := 0;
      end if;

      -- b) Lo que salió como muestra o merma: liberada.
      if v_suelta > 0.0005 then
        v_n := least(v_resto, v_suelta);
        if v_resto - v_n <= 0.0005 then
          update reservas
             set estado = 'liberada', liberado_por = auth.uid(), liberado_en = now(),
                 motivo_liberacion = format('Salió como %s al despachar %s (pallet %s).',
                   case v_motivo when 'muestreo' then 'muestra' else 'merma' end, p_numero, ln.codigo_pallet)
           where id = r.id;
        else
          v_bultos := greatest(1, round(v_rb * v_n / v_resto)::int);
          update reservas set peso_neto_kg = v_resto - v_n, bultos = greatest(1, v_rb - v_bultos) where id = r.id;
          insert into reservas (pedido_linea_id, lote_id, almacen_id, bultos, peso_neto_kg, estado, vence_el,
                                creado_por, liberado_por, liberado_en, motivo_liberacion, observaciones)
          values (r.pedido_linea_id, r.lote_id, r.almacen_id, v_bultos, v_n, 'liberada', r.vence_el,
                  auth.uid(), auth.uid(), now(),
                  format('Salió como %s al despachar %s (pallet %s).',
                    case v_motivo when 'muestreo' then 'muestra' else 'merma' end, p_numero, ln.codigo_pallet),
                  format('Parte que no llegó al cliente en %s', p_numero));
        end if;
        v_linea := r.pedido_linea_id::text;
        v_no_salio := jsonb_set(v_no_salio, array[v_linea], to_jsonb(coalesce((v_no_salio->>v_linea)::numeric, 0) + v_n));
        v_suelta := v_suelta - v_n;

      -- c) Lo que no salió y vuelve a cámara: sigue apartado para su pedido.
      elsif v_aparte > 0.0005 then
        v_n := least(v_resto, v_aparte);
        update reservas
           set observaciones = concat_ws(' · ', observaciones,
                 format('%s kg no salieron en %s: siguen apartados', texto_kg(v_n), p_numero))
         where id = r.id;
        v_linea := r.pedido_linea_id::text;
        v_no_salio := jsonb_set(v_no_salio, array[v_linea], to_jsonb(coalesce((v_no_salio->>v_linea)::numeric, 0) + v_n));
        v_aparte := v_aparte - v_n;
      end if;
    end loop;

    /* ---- 7 · El packing guarda lo cargado y pasa a decir lo que salió ---- */
    if v_motivo is not null then
      update packing_lineas
         set bultos_cargados = ln.bultos, kg_cargados = ln.peso_neto_kg,
             bultos = v_db, peso_neto_kg = v_dk,
             motivo_diferencia = v_motivo, detalle_diferencia = v_detalle
       where id = ln.id;
      v_diferencias := v_diferencias || format('%s: salieron %s de %s (%s · %s kg menos)%s',
        ln.codigo_pallet, v_db, texto_bultos(ln.bultos),
        case v_motivo when 'muestreo' then 'muestreo' when 'merma' then 'sacos dañados'
                      when 'no_entro' then 'no entró en el contenedor' else 'otro motivo' end,
        texto_kg(v_xk), coalesce(': ' || v_detalle, ''));
    end if;
    v_cargado_kg := v_cargado_kg + ln.peso_neto_kg;
    v_salio_kg   := v_salio_kg + v_dk;
  end loop;

  /* ---- 8 · Lo que no salió deja de estar «programado» en este embarque ---- */
  for k in select jsonb_object_keys(v_no_salio) loop
    update embarque_lineas el
       set kg_no_despachado = least(el.cantidad_kg, el.kg_no_despachado + (v_no_salio->>k)::numeric)
     where el.id = (select id from embarque_lineas
                     where embarque_id = pk.embarque_id and pedido_linea_id = k::bigint
                     order by cantidad_kg - kg_no_despachado desc, id limit 1);
  end loop;

  update packing_lists set estado = 'cerrado' where id = p_packing_list_id;
  -- El embarque, despachado solo si ya no le queda ningún contenedor abierto.
  update embarques set estado = case
           when exists (select 1 from packing_lists
                         where embarque_id = pk.embarque_id and id <> p_packing_list_id
                           and estado in ('abierto', 'en_carga'))
           then 'en_preparacion'::estado_embarque else 'despachado'::estado_embarque end
   where id = pk.embarque_id;

  /* ---- 9 · El historial: en el despacho y en el packing ---- */
  perform registrar_evento('despachos', v_despacho_id, 'despacho_ejecutado',
    format('Despacho %s ejecutado desde el packing %s: salieron %s kg%s',
           p_numero, pk.codigo, texto_kg(v_salio_kg),
           case when cardinality(v_diferencias) > 0
                then format(' de %s kg cargados. Diferencias: %s.', texto_kg(v_cargado_kg), array_to_string(v_diferencias, ' · '))
                else '.' end),
    case when cardinality(v_diferencias) > 0 then 'advertencia' else 'info' end::severidad_alerta,
    jsonb_build_object('packing_list_id', p_packing_list_id, 'cargado_kg', v_cargado_kg, 'salio_kg', v_salio_kg));
  perform registrar_evento('packing_lists', p_packing_list_id, 'despacho_ejecutado',
    format('Despachado en %s%s', p_numero,
           case when cardinality(v_diferencias) > 0
                then '. Salió distinto de lo cargado: ' || array_to_string(v_diferencias, ' · ') || '.'
                else ': salió todo lo cargado.' end),
    case when cardinality(v_diferencias) > 0 then 'advertencia' else 'info' end::severidad_alerta,
    jsonb_build_object('despacho_id', v_despacho_id));

  return v_despacho_id;
end;
$$;
comment on function ejecutar_despacho(bigint, text, jsonb) is
  'Despacha un packing: Kardex, reservas, packing cerrado y embarque. Con p_ajustes, lo que salió de verdad por pallet y el motivo de la diferencia (075).';
revoke execute on function ejecutar_despacho(bigint, text, jsonb) from public, anon;
grant execute on function ejecutar_despacho(bigint, text, jsonb) to authenticated;


/* ==========================================================================
   7 · LO PROGRAMADO DEJA DE CONTAR LO QUE NO SALIÓ
   --------------------------------------------------------------------------
   Mientras el embarque tiene contenedores por salir, lo que no entró en uno
   puede ir en el siguiente del mismo embarque: sigue programado. Cuando el
   embarque queda despachado, lo que no salió vuelve a «por programar».
   ========================================================================== */
create or replace view v_pedido_linea_programacion as
 SELECT pl.id AS pedido_linea_id,
    pl.pedido_id,
    pl.sku_presentacion_id,
    pl.cantidad_tm * 1000::numeric AS pedido_kg,
    COALESCE(pr.programado_kg, 0::numeric) AS programado_kg,
    COALESCE(rs.despachado_kg, 0::numeric) AS despachado_kg,
    COALESCE(rs.reservado_kg, 0::numeric) AS reservado_kg,
    GREATEST(pl.cantidad_tm * 1000::numeric - COALESCE(pr.programado_kg, 0::numeric), 0::numeric) AS por_programar_kg
   FROM pedido_lineas pl
     LEFT JOIN LATERAL ( SELECT sum(el.cantidad_kg
                                    - CASE WHEN e.estado = 'despachado'::estado_embarque THEN el.kg_no_despachado ELSE 0::numeric END) AS programado_kg
           FROM embarque_lineas el
             JOIN embarques e ON e.id = el.embarque_id
          WHERE el.pedido_linea_id = pl.id AND e.estado <> 'cancelado'::estado_embarque) pr ON true
     LEFT JOIN LATERAL ( SELECT sum(r.peso_neto_kg) FILTER (WHERE r.estado = 'consumida'::estado_reserva) AS despachado_kg,
            sum(r.peso_neto_kg) FILTER (WHERE r.estado = ANY (ARRAY['activa'::estado_reserva, 'en_preparacion'::estado_reserva])) AS reservado_kg
           FROM reservas r
          WHERE r.pedido_linea_id = pl.id) rs ON true;

/* La misma regla al programar: lo que no salió de un embarque despachado se
   puede volver a programar en otro sin que el tope de la línea lo impida. */
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

  select coalesce(sum(el.cantidad_kg
                      - case when e.estado = 'despachado' then el.kg_no_despachado else 0 end), 0)
    into v_otros_kg
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


/* ==========================================================================
   8 · EL FILL RATE: LO CARGADO CONTRA LO QUE SALIÓ
   --------------------------------------------------------------------------
   «programado_kg» de cada contenedor es lo que se cargó (lo que se planeó
   mandar); la columna nueva «despachado_kg», lo que salió de verdad. El
   Fill Rate semanal compara una con otra.
   ========================================================================== */
create or replace view v_contenedor_cumplimiento as
 SELECT pk.id AS packing_list_id,
    e.id AS embarque_id,
    e.numero AS embarque,
    e.fecha_programada,
    date_trunc('week'::text, e.fecha_programada::timestamp with time zone)::date AS semana,
    COALESCE(c.kg, 0::numeric) AS programado_kg,
    d.fecha_salida,
    d.fecha_salida IS NOT NULL AS despachado,
    d.fecha_salida IS NOT NULL AND d.fecha_salida <= e.fecha_programada AS a_tiempo,
    CASE WHEN d.fecha_salida IS NOT NULL THEN COALESCE(c.salio_kg, 0::numeric) ELSE 0::numeric END AS despachado_kg
   FROM packing_lists pk
     JOIN embarques e ON e.id = pk.embarque_id AND e.estado <> 'cancelado'::estado_embarque
     LEFT JOIN LATERAL ( SELECT sum(COALESCE(pl.kg_cargados, pl.peso_neto_kg)) AS kg,
                                sum(pl.peso_neto_kg) AS salio_kg
           FROM packing_lineas pl
          WHERE pl.packing_list_id = pk.id) c ON true
     LEFT JOIN LATERAL ( SELECT min((dp.fecha_salida AT TIME ZONE 'America/Lima'::text)::date) AS fecha_salida
           FROM despachos dp
          WHERE dp.packing_list_id = pk.id) d ON true
  WHERE pk.estado <> 'anulado'::estado_packing;

create or replace view v_cumplimiento_semanal as
 WITH fill AS (
         SELECT v_contenedor_cumplimiento.semana,
            count(*) AS contenedores,
            count(*) FILTER (WHERE v_contenedor_cumplimiento.despachado) AS contenedores_despachados,
            sum(v_contenedor_cumplimiento.programado_kg) AS programado_kg,
            sum(v_contenedor_cumplimiento.despachado_kg) FILTER (WHERE v_contenedor_cumplimiento.despachado) AS atendido_kg
           FROM v_contenedor_cumplimiento
          GROUP BY v_contenedor_cumplimiento.semana
        ), por_pedido AS (
         SELECT date_trunc('week'::text, pc.fecha_programada::timestamp with time zone)::date AS semana,
            pc.pedido_id,
            bool_and(cc.despachado) AS completo,
            bool_and(cc.a_tiempo) AS a_tiempo
           FROM v_pedido_contenedores pc
             JOIN v_contenedor_cumplimiento cc ON cc.packing_list_id = pc.packing_list_id
          GROUP BY (date_trunc('week'::text, pc.fecha_programada::timestamp with time zone)::date), pc.pedido_id
        ), otif AS (
         SELECT por_pedido.semana,
            count(*) AS pedidos_programados,
            count(*) FILTER (WHERE por_pedido.completo AND por_pedido.a_tiempo) AS pedidos_otif,
            count(*) FILTER (WHERE por_pedido.completo AND NOT por_pedido.a_tiempo) AS pedidos_tarde,
            count(*) FILTER (WHERE NOT por_pedido.completo) AS pedidos_incompletos
           FROM por_pedido
          GROUP BY por_pedido.semana
        ), sin_carga AS (
         SELECT date_trunc('week'::text, e.fecha_programada::timestamp with time zone)::date AS semana,
            count(*) AS embarques
           FROM embarques e
          WHERE e.estado <> 'cancelado'::estado_embarque AND NOT (EXISTS ( SELECT 1
                   FROM packing_lists pk
                  WHERE pk.embarque_id = e.id AND pk.estado <> 'anulado'::estado_packing))
          GROUP BY (date_trunc('week'::text, e.fecha_programada::timestamp with time zone)::date)
        )
 SELECT f.semana,
    EXTRACT(week FROM f.semana)::integer AS numero_semana,
    f.contenedores,
    f.contenedores_despachados,
    f.programado_kg,
    COALESCE(f.atendido_kg, 0::numeric) AS atendido_kg,
        CASE
            WHEN f.programado_kg > 0::numeric THEN round(COALESCE(f.atendido_kg, 0::numeric) / f.programado_kg * 100::numeric, 1)
            ELSE NULL::numeric
        END AS fill_rate,
    COALESCE(o.pedidos_programados, 0::bigint) AS pedidos_programados,
    COALESCE(o.pedidos_otif, 0::bigint) AS pedidos_otif,
    COALESCE(o.pedidos_tarde, 0::bigint) AS pedidos_tarde,
    COALESCE(o.pedidos_incompletos, 0::bigint) AS pedidos_incompletos,
        CASE
            WHEN COALESCE(o.pedidos_programados, 0::bigint) > 0 THEN round(o.pedidos_otif::numeric / o.pedidos_programados::numeric * 100::numeric, 1)
            ELSE NULL::numeric
        END AS otif,
    COALESCE(s.embarques, 0::bigint) AS embarques_sin_carga,
    (f.semana + 6) >= (now() AT TIME ZONE 'America/Lima'::text)::date AS semana_abierta
   FROM fill f
     LEFT JOIN otif o ON o.semana = f.semana
     LEFT JOIN sin_carga s ON s.semana = f.semana;


/* ==========================================================================
   9 · EL PLANO SE APUNTA EN EL HISTORIAL DEL PACKING
   --------------------------------------------------------------------------
   generar_plano_estiba registraba su evento con la entidad «packing_list»
   (sin la s) y el historial de la ficha, que busca «packing_lists», no lo
   veía nunca. Mismo cuerpo, entidad corregida.
   ========================================================================== */
create or replace function generar_plano_estiba(p_packing_list_id bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
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

  perform registrar_evento('packing_lists', p_packing_list_id, 'plano_generado',
    format('Plano de estiba generado: %s filas utilizadas', v_filas_usadas), 'info');

  return v_filas_usadas;
end;
$$;
