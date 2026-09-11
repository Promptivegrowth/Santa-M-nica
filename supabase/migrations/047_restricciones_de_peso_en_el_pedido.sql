-- ============================================================================
--  047 · LAS RESTRICCIONES DE PESO VIVEN EN EL PEDIDO
-- ============================================================================
--  LO QUE HABÍA Y POR QUÉ ESTABA MAL
--  En la migración 031 puse las restricciones en DOS sitios: un maestro por
--  destino —Tailandia 26 t, Europa 30 kg por bulto— y una confirmación por
--  embarque que mandaba sobre el maestro.
--
--  Lo pregunté y Oliver fue tajante:
--
--    «Esa restricción debe registrarse en el pedido, ya que no hay un maestro.
--     El 90 % de las observaciones son que el cliente indica a Comercial.»
--
--  O sea: el maestro por destino no existe en su operación. Me lo inventé
--  razonando que «Tailandia 26 toneladas» suena a norma de país. Puede que lo
--  sea, pero no es así como les llega el dato: les llega por correo, cliente a
--  cliente, pedido a pedido, y muchas veces a última hora.
--
--  UN MAESTRO QUE NADIE MANTIENE ES PEOR QUE NO TENERLO
--  Si la tabla de destinos se queda ahí, con dos topes de ejemplo puestos por
--  mí y el resto vacío, va a pasar una de dos cosas: o nadie la llena y los
--  avisos no saltan nunca, o alguien la llena una vez y queda desactualizada
--  para siempre. En ambos casos el sistema afirma haber comprobado un límite
--  que en realidad no comprobó. Por eso se quita, no se deja vacía.
--
--  DÓNDE SE EDITA AHORA
--  En el pedido, que es donde Comercial tiene la información. El planificador
--  la ENSEÑA —calculada sobre los pedidos que lleva cada embarque— pero ya no
--  la edita: un embarque puede consolidar dos pedidos, y entonces no habría
--  forma de saber a cuál de los dos se le está poniendo el tope.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
--  1 · EL PEDIDO GUARDA SU PROPIA RESTRICCIÓN
-- ────────────────────────────────────────────────────────────────────────────
alter table pedidos
  add column if not exists peso_neto_max_kg   numeric(12,2)
    check (peso_neto_max_kg is null or peso_neto_max_kg > 0),
  add column if not exists peso_bruto_max_kg  numeric(12,2)
    check (peso_bruto_max_kg is null or peso_bruto_max_kg > 0),
  add column if not exists nota_restricciones text,
  add column if not exists restricciones_por  uuid references usuarios(id),
  add column if not exists restricciones_en   timestamptz;

comment on column pedidos.peso_neto_max_kg is
  'Peso neto máximo por contenedor que admite este pedido. Lo indica el cliente a Comercial —«para Tailandia no más de 26 toneladas»— y se registra aquí porque es aquí donde llega el dato, no en un maestro.';
comment on column pedidos.peso_bruto_max_kg is
  'Peso bruto máximo por contenedor: producto más empaque. Es el que suele venir en el correo de la naviera.';
comment on column pedidos.nota_restricciones is
  'Lo que Comercial necesita que sepa Logística antes de cargar. Campo libre a propósito: las restricciones cambian y muchas veces no se conocen hasta el final.';
comment on column pedidos.restricciones_por is
  'Quién dejó la restricción. Cuando un contenedor se para porque no cabe, lo primero que se pregunta es quién dijo ese número.';


-- ────────────────────────────────────────────────────────────────────────────
--  2 · LO QUE YA ESTABA ANOTADO NO SE PIERDE
-- ────────────────────────────────────────────────────────────────────────────
--  Lo que Comercial hubiera dejado en un embarque pasa a SUS pedidos. Si el
--  embarque llevaba dos, los dos heredan la misma nota: es lo más fiel que se
--  puede ser sin inventar a cuál de ellos iba dirigida.
--  Va dentro de un bloque que comprueba que las columnas viejas sigan ahí: el
--  paso 3 las borra, así que al volver a ejecutar la migración —cosa que pasa
--  mientras se está construyendo— este UPDATE fallaría por referirse a algo
--  que ya no existe. Una migración que solo funciona la primera vez no es una
--  migración, es un script.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'embarques'
       and column_name = 'peso_neto_max_kg'
  ) then
    execute $sql$
      update pedidos p set
          peso_neto_max_kg   = coalesce(p.peso_neto_max_kg, x.neto),
          peso_bruto_max_kg  = coalesce(p.peso_bruto_max_kg, x.bruto),
          nota_restricciones = coalesce(p.nota_restricciones, x.nota),
          restricciones_por  = coalesce(p.restricciones_por, x.quien),
          restricciones_en   = coalesce(p.restricciones_en, x.cuando)
        from (
          select ep.pedido_id,
                 max(e.peso_neto_max_kg)   as neto,
                 max(e.peso_bruto_max_kg)  as bruto,
                 max(e.nota_comercial)     as nota,
                 max(e.nota_comercial_por::text)::uuid as quien,
                 max(e.nota_comercial_en)  as cuando
            from embarque_pedidos ep
            join embarques e on e.id = ep.embarque_id
           where e.peso_neto_max_kg is not null
              or e.peso_bruto_max_kg is not null
              or e.nota_comercial is not null
           group by ep.pedido_id
        ) x
       where x.pedido_id = p.id;
    $sql$;
  end if;
end $$;


-- ────────────────────────────────────────────────────────────────────────────
--  3 · FUERA LAS DOS FUENTES QUE SOBRAN
-- ────────────────────────────────────────────────────────────────────────────
--  La vista y la función que las usaban se rehacen más abajo; hay que soltarlas
--  antes de poder tocar las columnas.
drop view if exists v_embarque_topes;
drop function if exists fijar_tope_embarque(bigint, numeric, numeric, text);

alter table destinos
  drop column if exists peso_neto_max_kg,
  drop column if exists peso_bulto_max_kg,
  drop column if exists nota_restricciones;

alter table embarques
  drop column if exists peso_neto_max_kg,
  drop column if exists peso_bruto_max_kg,
  drop column if exists nota_comercial,
  drop column if exists nota_comercial_por,
  drop column if exists nota_comercial_en;


-- ────────────────────────────────────────────────────────────────────────────
--  4 · EL TOPE DEL EMBARQUE SE CALCULA, NO SE GUARDA
-- ────────────────────────────────────────────────────────────────────────────
--  Un embarque puede consolidar varios pedidos. Si cada uno trae su límite, el
--  que rige es EL MÁS ESTRICTO: basta que uno de los clientes no admita más de
--  veintiséis toneladas para que el contenedor no pueda llevar más.
--
--  Por eso `min()` y no `max()` ni un promedio. Con `max()` el sistema
--  autorizaría una carga que el cliente más exigente va a rechazar en destino,
--  y el error se descubriría con el contenedor ya en el barco.
create or replace view v_embarque_topes as
select
  e.id                                  as embarque_id,
  e.numero,
  e.fecha_programada,
  d.puerto                              as destino,
  d.pais,

  t.tope_neto_kg,
  t.tope_bruto_kg,
  --  De qué pedido salió el límite que manda, para que la pantalla lo explique
  --  y se pueda ir a corregirlo.
  t.pedido_del_tope,
  t.proforma_del_tope,
  t.notas                               as nota_comercial,
  t.pedidos_con_tope,

  coalesce(c.peso_kg, 0)                as cargado_kg,
  coalesce(c.bultos, 0)                 as cargado_bultos,

  /*
   * ¿Se pasó? Solo se responde cuando hay tope Y hay carga: sin una de las
   * dos, la pregunta no tiene sentido y devolver «false» haría creer que se
   * comprobó algo.
   */
  case
    when t.tope_neto_kg is null then null
    when coalesce(c.peso_kg, 0) = 0 then null
    else coalesce(c.peso_kg, 0) > t.tope_neto_kg
  end                                   as excede,

  case
    when t.tope_neto_kg is null or coalesce(c.peso_kg, 0) = 0 then null
    else coalesce(c.peso_kg, 0) >= t.tope_neto_kg * 0.95
  end                                   as cerca_del_tope,

  case
    when t.tope_neto_kg is null or t.tope_neto_kg = 0 then null
    else round(coalesce(c.peso_kg, 0) / t.tope_neto_kg * 100, 1)
  end                                   as ocupacion_pct,

  --  Cuántos kilos hay que bajar. Es la cifra que necesita Almacén cuando el
  --  aviso salta: saber que «se pasó» no dice cuántos pallets quitar.
  case
    when t.tope_neto_kg is null then null
    when coalesce(c.peso_kg, 0) <= t.tope_neto_kg then 0
    else coalesce(c.peso_kg, 0) - t.tope_neto_kg
  end                                   as exceso_kg
from embarques e
left join destinos d on d.id = e.destino_id
left join lateral (
  select
    min(p.peso_neto_max_kg)   as tope_neto_kg,
    min(p.peso_bruto_max_kg)  as tope_bruto_kg,
    count(*) filter (where p.peso_neto_max_kg is not null
                        or p.peso_bruto_max_kg is not null) as pedidos_con_tope,
    -- El pedido que impone el límite: el del mínimo.
    (array_agg(p.id order by p.peso_neto_max_kg nulls last))[1]              as pedido_del_tope,
    (array_agg(p.numero_proforma order by p.peso_neto_max_kg nulls last))[1] as proforma_del_tope,
    string_agg(
      p.numero_proforma || ': ' || p.nota_restricciones,
      ' · ' order by p.numero_proforma
    ) filter (where nullif(btrim(p.nota_restricciones), '') is not null)     as notas
  from embarque_pedidos ep
  join pedidos p on p.id = ep.pedido_id
 where ep.embarque_id = e.id
) t on true
left join lateral (
  select sum(pl.peso_neto_kg) as peso_kg, sum(pl.bultos) as bultos
    from packing_lists pk
    join packing_lineas pl on pl.packing_list_id = pk.id
   where pk.embarque_id = e.id and pk.estado <> 'anulado'
) c on true
where e.estado <> 'cancelado';

comment on view v_embarque_topes is
  'El límite de peso que rige para cada embarque, calculado sobre los pedidos que lleva: manda el MÁS ESTRICTO, porque basta que un cliente no admita más de 26 toneladas para que el contenedor no pueda llevar más. Ya no hay tope por destino ni por embarque: la restricción se registra en el pedido, que es donde le llega a Comercial.';


-- ────────────────────────────────────────────────────────────────────────────
--  5 · QUIÉN PUEDE ESCRIBIRLA
-- ────────────────────────────────────────────────────────────────────────────
--  Comercial es quien recibe el correo del cliente y quien tiene que dejarlo
--  anotado, pero la tabla de pedidos no la escribe Comercial entera: las
--  políticas de escritura de pedidos son más estrechas.
--
--  PostgreSQL protege FILAS, no columnas. Para dejar que Comercial toque estos
--  tres campos —y solo estos tres— hace falta una función con permisos
--  propios, igual que se hizo con el tope del embarque.
create or replace function fijar_restriccion_pedido(
  p_pedido_id bigint,
  p_neto_kg   numeric,
  p_bruto_kg  numeric,
  p_nota      text
) returns void language plpgsql security definer set search_path = public as $$
declare v_rol rol_usuario;
begin
  select rol into v_rol from usuarios where id = auth.uid();

  if v_rol is null or v_rol not in ('gerencia', 'comercial', 'operaciones', 'comex') then
    raise exception 'Su rol no puede fijar restricciones de peso en un pedido.';
  end if;

  if p_neto_kg is not null and p_neto_kg <= 0 then
    raise exception 'El peso neto máximo tiene que ser mayor que cero.';
  end if;
  if p_bruto_kg is not null and p_bruto_kg <= 0 then
    raise exception 'El peso bruto máximo tiene que ser mayor que cero.';
  end if;
  --  El bruto incluye el empaque: no puede ser menor que el neto. Si lo fuera,
  --  la carga sería imposible y el aviso saltaría siempre.
  if p_neto_kg is not null and p_bruto_kg is not null and p_bruto_kg < p_neto_kg then
    raise exception 'El peso bruto no puede ser menor que el neto: el bruto incluye el empaque.';
  end if;

  update pedidos
     set peso_neto_max_kg   = p_neto_kg,
         peso_bruto_max_kg  = p_bruto_kg,
         nota_restricciones = nullif(btrim(coalesce(p_nota, '')), ''),
         restricciones_por  = auth.uid(),
         restricciones_en   = now()
   where id = p_pedido_id;

  if not found then
    raise exception 'El pedido % no existe.', p_pedido_id;
  end if;
end $$;

comment on function fijar_restriccion_pedido is
  'Deja la restricción de peso que el cliente comunicó a Comercial. Existe como función con permisos propios porque PostgreSQL protege filas y no columnas: sin ella, dejar que Comercial escriba estos tres campos obligaría a dejarle escribir el pedido entero.';

revoke all on function fijar_restriccion_pedido(bigint, numeric, numeric, text) from public;
grant execute on function fijar_restriccion_pedido(bigint, numeric, numeric, text) to authenticated;


-- ────────────────────────────────────────────────────────────────────────────
--  6 · DATOS DE DEMOSTRACIÓN
-- ────────────────────────────────────────────────────────────────────────────
--  Los dos casos que dio Oliver, puestos ahora donde corresponde: en los
--  pedidos que van a esos destinos, no en un maestro. Solo sobre pedidos
--  abiertos: retocar los ya despachados cambiaría el pasado.
update pedidos p set
    peso_neto_max_kg = 26000,
    nota_restricciones = 'El cliente no admite más de 26 TM netas por contenedor.',
    restricciones_en = now()
  from destinos d
 where d.id = p.destino_id
   and d.pais ilike '%Tailandia%'
   and p.ciclo not in ('despachado', 'cerrado', 'cancelado')
   and p.peso_neto_max_kg is null;

update pedidos p set
    nota_restricciones = 'Europa: la ley laboral no admite bultos de más de 30 kg.',
    restricciones_en = now()
  from destinos d
 where d.id = p.destino_id
   and d.pais in ('España', 'Portugal', 'Francia', 'Italia', 'Alemania', 'Países Bajos', 'Bélgica', 'Grecia')
   and p.ciclo not in ('despachado', 'cerrado', 'cancelado')
   and p.nota_restricciones is null;
