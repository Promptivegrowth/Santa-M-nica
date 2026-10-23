-- ============================================================================
--  068 · LOGÍSTICA: LO QUE LA GUÍA DE USO DEJÓ COMO «LIMITACIÓN CONOCIDA»
-- ============================================================================
--  La guía de uso tuvo que avisar de varios huecos del módulo de Logística.
--  Esta migración pone la parte de la base de datos de sus arreglos:
--
--   1. CANCELAR UN EMBARQUE Y QUITARLE UN PEDIDO, de una sola vez y con sus
--      controles dentro de la base (embarque_cancelar, embarque_quitar_pedido).
--      Confirmar y editar son una sola escritura y se hacen desde la acción.
--
--   2. EL PACKING PASA SOLO A «EN CARGA». Ninguna pantalla lo hacía: el estado
--      existía en el enum y en los filtros, pero solo lo tenían los datos de
--      la carga inicial. Ahora lo pone un disparador: al subir el primer
--      pallet a un packing abierto pasa a «en carga»; si se le quitan todos,
--      vuelve a «abierto». Un disparador, y no la acción, porque al contenedor
--      se le suben pallets desde tres sitios (la precarga al crearlo, «Agregar
--      pallet» y «Cargar los N») y los tres tienen que decir lo mismo.
--      De paso: un packing anulado o cerrado ya no admite pallets ni se
--      despacha, también en la base.
--
--   3. FLOTA EDITABLE. Comercio Exterior coordina el transporte y tiene que
--      poder dar de alta un camión o un chofer; hasta ahora solo Gerencia y
--      Operaciones podían escribir esas tablas (y ninguna pantalla lo hacía).
--
--   4. EL TRASLADO DE CONSOLIDACIÓN FALLABA AL DESPACHARLO. «Armar el
--      traslado» (al programar un embarque con lo apartado repartido en dos
--      bodegas) crea un traslado que mueve PRECISAMENTE stock apartado. Pero
--      traslado_despachar validaba contra el DISPONIBLE, y lo apartado no lo
--      es: un pallet apartado entero daba «disponible: 0 kg, solicitado:
--      4.740 kg» y el traslado se quedaba autorizado para siempre.
--      Además, al aceptarlo, las reservas se mudaban de la más antigua a la
--      más nueva sin mirar de quién eran: con dos pedidos en el mismo pallet
--      podía mudarse la del pedido equivocado; y en un traslado NORMAL (de
--      stock libre) se mudaban reservas que no habían viajado.
--      El arreglo de fondo de esas dos funciones lo trae la 069 (área de
--      Stock, que es dueña de los traslados). Aquí queda la columna
--      traslados.consolida_pedidos —el traslado dice para qué pedidos junta
--      la mercadería— y el control de Logística: un pallet ya subido a un
--      contenedor abierto no se lleva a otra bodega.
-- ============================================================================


/* ==========================================================================
   1 · EMBARQUES: CANCELAR Y QUITAR UN PEDIDO
   ========================================================================== */

alter table embarques add column if not exists motivo_cancelacion text;

/*
 * CANCELAR UN EMBARQUE
 *
 *  · Con motivo: sin él nadie sabe después por qué no salió.
 *  · No si ya salió algún contenedor (un packing cerrado es un despacho:
 *    escribió el Kardex y consumió reservas, y eso no se deshace cancelando).
 *  · Sus contenedores abiertos o en carga se ANULAN y se vacían: el pallet
 *    sigue en cámara y tiene que poder subir a otro contenedor.
 *  · Los pedidos quedan libres para programarse de nuevo: todo lo que cuenta
 *    lo programado ya excluye los embarques cancelados. El vínculo se
 *    conserva para que la ficha siga diciendo qué llevaba.
 *  · Las reservas NO se sueltan: son del pedido, no del embarque. El cliente
 *    sigue esperando esa mercadería.
 */
create or replace function embarque_cancelar(p_embarque_id bigint, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e embarques%rowtype;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_pk record;
  v_anulados int := 0;
  v_pallets int := 0;
  v_n int;
  v_codigos text[] := '{}';
  v_pedidos int;
begin
  if not puede('gerencia', 'operaciones', 'comex') then
    raise exception 'Su rol no puede cancelar embarques: lo hacen Gerencia, Operaciones y Comercio Exterior.'
      using errcode = 'insufficient_privilege';
  end if;
  if length(v_motivo) < 5 then
    raise exception 'Escriba por qué se cancela el embarque (al menos 5 caracteres): sin motivo nadie sabrá después qué pasó.';
  end if;

  select * into e from embarques where id = p_embarque_id for update;
  if not found then raise exception 'Ese embarque ya no existe.'; end if;
  if e.estado = 'cancelado' then raise exception 'El embarque % ya estaba cancelado.', e.numero; end if;
  if e.estado = 'despachado' then
    raise exception 'El embarque % ya se despachó: lo que salió de cámara no se cancela.', e.numero;
  end if;
  if exists (select 1 from packing_lists where embarque_id = p_embarque_id and estado = 'cerrado') then
    raise exception 'El embarque % ya tiene un contenedor despachado: no se puede cancelar. Lo que falta, déjelo sin cargar o quite sus pedidos.', e.numero;
  end if;

  --  Los contenedores todavía abiertos: se vacían y se anulan.
  for v_pk in
    select id, codigo from packing_lists
     where embarque_id = p_embarque_id and estado in ('abierto', 'en_carga')
     for update
  loop
    delete from plano_estiba where packing_list_id = v_pk.id;
    delete from packing_lineas where packing_list_id = v_pk.id;
    get diagnostics v_n = row_count;
    v_pallets := v_pallets + v_n;
    update packing_lists set estado = 'anulado' where id = v_pk.id;
    v_anulados := v_anulados + 1;
    v_codigos := v_codigos || v_pk.codigo;
  end loop;

  select count(*) into v_pedidos from embarque_pedidos where embarque_id = p_embarque_id;

  update embarques set estado = 'cancelado', motivo_cancelacion = v_motivo where id = p_embarque_id;

  perform registrar_evento('embarques', p_embarque_id, 'embarque_cancelado',
    format('Embarque %s cancelado: %s.%s Sus %s pedido(s) quedan libres para programarse de nuevo; las reservas siguen apartadas para ellos.',
           e.numero, v_motivo,
           case when v_anulados > 0
                then format(' Se anularon %s contenedor(es) (%s) y se bajaron %s pallet(s).',
                            v_anulados, array_to_string(v_codigos, ', '), v_pallets)
                else '' end,
           v_pedidos),
    'advertencia',
    jsonb_build_object('motivo', v_motivo, 'packings_anulados', v_anulados, 'pallets_bajados', v_pallets));

  return jsonb_build_object('numero', e.numero, 'packings_anulados', v_anulados,
                            'pallets_bajados', v_pallets, 'pedidos', v_pedidos);
end $$;
revoke execute on function embarque_cancelar(bigint, text) from public, anon;
grant execute on function embarque_cancelar(bigint, text) to authenticated;


/*
 * QUITAR UN PEDIDO DEL EMBARQUE
 *
 * Solo si ninguno de sus pallets está ya en un contenedor de ese embarque (ni
 * por la línea del pedido que guarda el packing, ni por estar apartado para
 * él). Si lo está, primero se baja del contenedor: quitar el pedido dejaría
 * un pallet cargado que ya no se sabe para quién es.
 * Se van con él sus cantidades por producto (embarque_lineas): esos kilos
 * vuelven a quedar «por programar».
 */
create or replace function embarque_quitar_pedido(p_embarque_id bigint, p_pedido_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e embarques%rowtype;
  v_pf text;
  v_cargados text;
  v_lineas int;
begin
  if not puede('gerencia', 'operaciones', 'comex', 'almacen') then
    raise exception 'Su rol no puede cambiar los pedidos de un embarque.' using errcode = 'insufficient_privilege';
  end if;

  select * into e from embarques where id = p_embarque_id for update;
  if not found then raise exception 'Ese embarque ya no existe.'; end if;
  if e.estado in ('despachado', 'cancelado') then
    raise exception 'El embarque % está %: ya no se le cambian los pedidos.', e.numero,
      case e.estado when 'despachado' then 'despachado' else 'cancelado' end;
  end if;

  select numero_proforma into v_pf from pedidos where id = p_pedido_id;
  if not exists (select 1 from embarque_pedidos where embarque_id = p_embarque_id and pedido_id = p_pedido_id) then
    raise exception 'La proforma % no está en el embarque %.', coalesce(v_pf, '?'), e.numero;
  end if;

  select string_agg(distinct format('%s (%s)', l.codigo_pallet, pk.codigo), ', ')
    into v_cargados
    from packing_lineas pkl
    join packing_lists pk on pk.id = pkl.packing_list_id
    join lotes l on l.id = pkl.lote_id
   where pk.embarque_id = p_embarque_id
     and pk.estado <> 'anulado'
     and (pkl.pedido_linea_id in (select id from pedido_lineas where pedido_id = p_pedido_id)
          or exists (select 1 from reservas rv join pedido_lineas pl on pl.id = rv.pedido_linea_id
                      where rv.lote_id = pkl.lote_id and rv.almacen_id = e.almacen_id
                        and rv.estado in ('activa', 'en_preparacion', 'consumida')
                        and pl.pedido_id = p_pedido_id));
  if v_cargados is not null then
    raise exception 'La proforma % ya tiene pallets en un contenedor de este embarque: %. Quítelos del packing primero y vuelva a intentarlo.',
      v_pf, v_cargados;
  end if;

  delete from embarque_lineas
   where embarque_id = p_embarque_id
     and pedido_linea_id in (select id from pedido_lineas where pedido_id = p_pedido_id);
  get diagnostics v_lineas = row_count;
  delete from embarque_pedidos where embarque_id = p_embarque_id and pedido_id = p_pedido_id;

  perform registrar_evento('embarques', p_embarque_id, 'embarque_pedido_quitado',
    format('Se quitó la proforma %s del embarque %s%s. Vuelve a quedar por programar.', v_pf, e.numero,
           case when v_lineas > 0 then format(' (con sus %s producto(s) programado(s))', v_lineas) else '' end),
    'info', jsonb_build_object('pedido_id', p_pedido_id));
  perform registrar_evento('pedidos', p_pedido_id, 'embarque_pedido_quitado',
    format('Se quitó del embarque %s. Vuelve a quedar por programar.', e.numero), 'info',
    jsonb_build_object('embarque_id', p_embarque_id));

  return jsonb_build_object('numero', e.numero, 'proforma', v_pf, 'lineas', v_lineas);
end $$;
revoke execute on function embarque_quitar_pedido(bigint, bigint) from public, anon;
grant execute on function embarque_quitar_pedido(bigint, bigint) to authenticated;


/* ==========================================================================
   2 · EL ESTADO DEL PACKING LO DICE SU CARGA
   ========================================================================== */

/*
 * Antes de subir un pallet: el contenedor tiene que seguir abierto. La acción
 * ya lo comprueba para poder decirlo con palabras; esto es la garantía.
 */
create or replace function packing_lineas_antes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_estado estado_packing; v_codigo text;
begin
  select estado, codigo into v_estado, v_codigo from packing_lists where id = new.packing_list_id;
  if v_estado in ('cerrado', 'anulado') then
    raise exception 'El packing % está %: ya no admite pallets.', v_codigo,
      case v_estado when 'cerrado' then 'despachado' else 'anulado' end;
  end if;
  return new;
end $$;

/*
 * Después de subir o bajar un pallet: el primero lo pasa a «en carga»; si se
 * bajan todos, vuelve a «abierto». Cerrado y anulado no se tocan nunca.
 */
create or replace function packing_lineas_estado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_id bigint := coalesce(new.packing_list_id, old.packing_list_id);
begin
  if tg_op = 'INSERT' then
    update packing_lists set estado = 'en_carga' where id = v_id and estado = 'abierto';
  elsif tg_op = 'DELETE' then
    update packing_lists set estado = 'abierto'
     where id = v_id and estado = 'en_carga'
       and not exists (select 1 from packing_lineas where packing_list_id = v_id);
  end if;
  return null;
end $$;

drop trigger if exists trg_packing_lineas_antes on packing_lineas;
create trigger trg_packing_lineas_antes
  before insert on packing_lineas
  for each row execute function packing_lineas_antes();

drop trigger if exists trg_packing_lineas_estado on packing_lineas;
create trigger trg_packing_lineas_estado
  after insert or delete on packing_lineas
  for each row execute function packing_lineas_estado();

/* Un packing anulado no se despacha (ejecutar_despacho solo miraba «cerrado»). */
create or replace function despachos_packing_vigente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_estado estado_packing; v_codigo text;
begin
  select estado, codigo into v_estado, v_codigo from packing_lists where id = new.packing_list_id;
  if v_estado = 'anulado' then
    raise exception 'El packing % está anulado (su embarque se canceló): no se puede despachar.', v_codigo;
  end if;
  return new;
end $$;

drop trigger if exists trg_despachos_packing_vigente on despachos;
create trigger trg_despachos_packing_vigente
  before insert on despachos
  for each row execute function despachos_packing_vigente();

--  Los datos ya cuadran hoy (todos los «en carga» tienen pallets y los
--  «abiertos» están vacíos), pero se deja dicho por si se re-ejecuta.
update packing_lists pk set estado = 'en_carga'
 where pk.estado = 'abierto' and exists (select 1 from packing_lineas l where l.packing_list_id = pk.id);
update packing_lists pk set estado = 'abierto'
 where pk.estado = 'en_carga' and not exists (select 1 from packing_lineas l where l.packing_list_id = pk.id);


/* ==========================================================================
   3 · FLOTA: COMERCIO EXTERIOR TAMBIÉN DA DE ALTA CAMIONES Y CHOFERES
   ========================================================================== */
do $$
declare t text;
begin
  foreach t in array array['transportistas', 'vehiculos', 'conductores'] loop
    execute format('drop policy if exists escritura_maestros on %I', t);
    execute format(
      'create policy escritura_maestros on %I for all
         using (puede(''gerencia'', ''operaciones'', ''comex''))
         with check (puede(''gerencia'', ''operaciones'', ''comex''))', t);
  end loop;
end $$;

--  La flota queda en la auditoría: quién cambió una fecha de SOAT y cuándo.
drop trigger if exists audit_transportistas on transportistas;
create trigger audit_transportistas after insert or update or delete on transportistas
  for each row execute function auditar_cambios();
drop trigger if exists audit_vehiculos on vehiculos;
create trigger audit_vehiculos after insert or update or delete on vehiculos
  for each row execute function auditar_cambios();
drop trigger if exists audit_conductores on conductores;
create trigger audit_conductores after insert or update or delete on conductores
  for each row execute function auditar_cambios();

--  Dos vehículos con la misma placa no existen.
create unique index if not exists vehiculos_placa_unica on vehiculos (upper(btrim(placa)));


/* ==========================================================================
   4 · EL TRASLADO DE CONSOLIDACIÓN: LO APARTADO VIAJA CON SU RESERVA
   ========================================================================== */

--  Para qué pedidos se junta la mercadería. Vacío = traslado normal (de stock libre).
alter table traslados add column if not exists consolida_pedidos bigint[];

/*
 * LAS FUNCIONES DEL TRASLADO (traslado_despachar, traslado_aceptar) SON DE
 * LA 069 («Ajustes y traslados a mano», área de Stock), que se aplica
 * después y las reescribe: el despacho ya compara contra el FÍSICO no
 * bloqueado, que es el arreglo de fondo del «disponible: 0 kg». Aquí no se
 * redefinen para no pisarse. Se deja:
 *   · la columna consolida_pedidos, que «Armar el traslado» ya llena: dice
 *     para qué pedidos se junta la mercadería (sirve para mudar SUS reservas
 *     primero al aceptar; ver el informe de la 068);
 *   · el control que es de Logística: un pallet subido a un contenedor
 *     abierto no sale de la bodega en un traslado.
 */
drop function if exists traslado_mudar_reservas(traslados, bigint, numeric, bigint[]);

create or replace function movimientos_traslado_no_cargado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fisico numeric;
  v_en_packing numeric;
  v_contenedores text;
  v_pallet text;
begin
  --  Antes de que el movimiento descuente la existencia (proyectar_existencia va después).
  select coalesce(sum(peso_neto_kg), 0) into v_fisico
    from existencias where lote_id = new.lote_id and almacen_id = new.almacen_id;
  select coalesce(sum(pkl.peso_neto_kg), 0), string_agg(distinct pk.codigo, ', ')
    into v_en_packing, v_contenedores
    from packing_lineas pkl
    join packing_lists pk on pk.id = pkl.packing_list_id
    join embarques e on e.id = pk.embarque_id
   where pkl.lote_id = new.lote_id and e.almacen_id = new.almacen_id
     and pk.estado in ('abierto', 'en_carga');
  if v_en_packing > 0 and v_fisico - new.peso_neto_kg < v_en_packing - 0.0005 then
    select codigo_pallet into v_pallet from lotes where id = new.lote_id;
    raise exception 'El pallet % está cargado en el contenedor % de esa bodega. Bájelo del packing antes de trasladarlo.',
      coalesce(v_pallet, new.lote_id::text), v_contenedores;
  end if;
  return new;
end $$;

drop trigger if exists trg_movimientos_traslado_no_cargado on movimientos;
create trigger trg_movimientos_traslado_no_cargado
  before insert on movimientos
  for each row when (new.tipo = 'traslado_salida')
  execute function movimientos_traslado_no_cargado();
