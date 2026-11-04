-- ============================================================================
--  084 · LA PROGRAMACIÓN DE EMBARQUES COMO LA LLEVA SANTA MÓNICA
-- ============================================================================
--  «Observaciones ERP 4» de Oliver Tello (Operaciones), puntos 07, 08, 09, 10,
--  11 y el número de packing del 13. Lo que dijo en la reunión:
--
--   · «Semana de salida» (p. ej. 45) y «Fecha de zarpe» son DOS datos y no
--     coinciden: lo que se despacha jueves o viernes zarpa el lunes. La fecha
--     real de salida se pone al despachar (despachos.fecha_salida, ya existe).
--   · La vista que más van a usar es la LISTA, como su Excel: N.º de embarque,
--     fecha de despacho, booking, naviera, OPERADOR LOGÍSTICO, almacén de
--     despacho y un N.º DE PACKING correlativo propio que ellos asignan.
--   · Al programar, poder subir el packing list en PDF o Excel —el que se
--     declara al cliente y a SANIPES difiere del real por la sobreproducción
--     declarada el sábado— y la ETIQUETA que sube Comercial, con comentarios.
--
--  QUÉ AGREGA
--   1. En el embarque: semana de despacho, fecha de zarpe, operador logístico
--      y N.º de packing (PL). Reglas en un disparador (la última palabra,
--      aunque alguien escriba en la tabla sin pasar por la pantalla).
--   2. El N.º de packing con el mismo patrón que el número de proforma (082):
--      PROPUESTO (el siguiente de la serie de la casa, «PL POT1124»),
--      EDITABLE, ÚNICO y en el HISTORIAL. Vive en el embarque —es la fila de
--      su Excel— y en cada contenedor (packing_lists.codigo, que ya existía y
--      ya se llamaba así: «PL POT###»). El primer contenedor del embarque
--      toma el PL del embarque; si después se cambia uno, cambia el otro.
--   3. Los documentos del embarque (etiqueta, packing declarado, packing
--      real, otros) en el MISMO repositorio privado que los archivos del
--      despacho, y aceptando Excel además de PDF e imágenes.
--   4. Los comentarios del embarque: una bitácora de quién dijo qué y cuándo
--      («etiqueta con el logo nuevo del cliente», «SANIPES pidió corregir el
--      peso declarado»), que es el seguimiento del packing list.
--
--  POR QUÉ EL PL ES DE LA CASA Y NO DEL SISTEMA
--  En la hoja GENERAL de «DATA 2025» la columna «OPERACIÓN DESPACHOS (PL)»
--  llega a PL POT1123 (28/10/2026, semana 44). El sistema numeraba sus
--  contenedores desde PL POT001: dos numeraciones para la misma cosa. Ahora
--  la propuesta sigue un contador que Gerencia u Operaciones pueden fijar
--  (p. ej. en 1124) y que avanza solo cuando alguien escribe a mano un número
--  mayor de la serie: si se escribe el real, la numeración real sigue desde ahí.
--
--  Re-ejecutable. No toca datos existentes: los embarques que ya había quedan
--  sin PL, sin zarpe y sin operador hasta que alguien los complete; su semana
--  se calcula de la fecha mientras no se escriba otra.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
--  1 · LAS COLUMNAS NUEVAS DEL EMBARQUE
-- ────────────────────────────────────────────────────────────────────────────
alter table embarques add column if not exists semana_despacho    smallint;
alter table embarques add column if not exists fecha_zarpe        date;
alter table embarques add column if not exists operador_logistico text;
alter table embarques add column if not exists numero_packing     text;

comment on column embarques.semana_despacho is
  'Semana de despacho (ISO, 1 a 53) en que se programa la salida de la bodega. Si no se escribe, la de fecha_programada. Es la «Semana de salida» de Oliver.';
comment on column embarques.fecha_zarpe is
  'Fecha de zarpe de la nave (ETD). No coincide con el despacho: lo que sale de la bodega jueves o viernes zarpa el lunes. No puede ser antes del despacho programado.';
comment on column embarques.operador_logistico is
  'El operador logístico / agente de carga que coordina la salida (texto libre, como la naviera).';
comment on column embarques.numero_packing is
  'N.º de packing (PL) que asigna Santa Mónica, p. ej. PL POT1124. Único entre los embarques no cancelados y los contenedores de otros embarques. El primer contenedor lo toma como su código.';


-- ────────────────────────────────────────────────────────────────────────────
--  2 · CÓMO SE ESCRIBE UN N.º DE PACKING
-- ────────────────────────────────────────────────────────────────────────────
--  Se guarda en MAYÚSCULAS, sin espacios a los lados y con UN espacio entre
--  palabras: «pl  pot1124 » es «PL POT1124». En la serie de la casa (PL POT +
--  número) el número va con tres cifras como mínimo, como lo hacía el sistema
--  (PL POT001), y se acepta escrito junto: «PLPOT1124» es «PL POT1124».
--
--  Para decir si dos números son EL MISMO se comparan sin ningún espacio: así
--  «PL POT1124» y «PL POT 1124» chocan aunque se escriban distinto.
create or replace function normalizar_numero_packing(p text)
returns text
language plpgsql
immutable
set search_path = public as $$
declare
  v text;
  m text[];
  cifras text;
begin
  if p is null then return null; end if;
  v := upper(btrim(regexp_replace(p, '\s+', ' ', 'g')));
  if v = '' then return null; end if;
  m := regexp_match(replace(v, ' ', ''), '^PLPOT(\d+)$');
  if m is not null then
    cifras := coalesce(nullif(ltrim(m[1], '0'), ''), '0');
    v := 'PL POT' || lpad(cifras, greatest(3, length(cifras)), '0');
  end if;
  return v;
end $$;

create or replace function clave_numero_packing(p text)
returns text
language sql
immutable
set search_path = public as $$
  select replace(normalizar_numero_packing(p), ' ', '');
$$;

comment on function normalizar_numero_packing(text) is
  'El N.º de packing como se guarda: mayúsculas, un espacio entre palabras y, en la serie PL POT, tres cifras como mínimo (PLPOT26 → PL POT026).';
comment on function clave_numero_packing(text) is
  'El N.º de packing sin espacios: la clave con la que se decide si dos números son el mismo.';

/* El número de la serie de la casa: PL POT1124. */
create or replace function formato_numero_packing(p_numero int)
returns text
language sql
immutable
set search_path = public as $$
  select 'PL POT' || lpad(p_numero::text, greatest(3, length(p_numero::text)), '0');
$$;

/* El número de la serie dentro de un PL, o null si no es de la serie. */
create or replace function cifra_numero_packing(p text)
returns int
language sql
immutable
set search_path = public as $$
  select (regexp_match(clave_numero_packing(p), '^PLPOT(\d{1,7})$'))[1]::int;
$$;

/* ¿Lo usa ya alguien? (un embarque vivo o cualquier contenedor) */
create or replace function numero_packing_usado(p_clave text)
returns boolean
language sql
stable
security definer
set search_path = public as $$
  select exists (select 1 from embarques e
                  where e.estado <> 'cancelado' and clave_numero_packing(e.numero_packing) = p_clave)
      or exists (select 1 from packing_lists pk where clave_numero_packing(pk.codigo) = p_clave);
$$;


-- ────────────────────────────────────────────────────────────────────────────
--  3 · EL PRÓXIMO NÚMERO, SIN CONSUMIRLO Y SIN REPETIR
-- ────────────────────────────────────────────────────────────────────────────
--  Contador en `correlativos` con serie 'PL' y año 0: la numeración de packing
--  de Santa Mónica NO se reinicia cada año (PL POT1111, 1112… siguen).
create or replace function proponer_numero_packing()
returns text
language plpgsql
stable
security definer
set search_path = public as $$
declare
  v_n int;
  v_num text;
begin
  select ultimo into v_n from correlativos where serie = 'PL' and anio = 0;
  /*
   * Sin contador todavía, se arranca después del mayor número de la serie que
   * ya exista: con los contenedores que el sistema numeró antes de esta
   * migración (PL POT001, PL POT002) no se vuelve a proponer uno usado.
   */
  if v_n is null then
    select coalesce(max(n), 0) into v_n from (
      select cifra_numero_packing(codigo) n from packing_lists
      union all
      select cifra_numero_packing(numero_packing) from embarques) x;
  end if;
  v_n := coalesce(v_n, 0) + 1;
  loop
    v_num := formato_numero_packing(v_n);
    exit when not numero_packing_usado(clave_numero_packing(v_num));
    v_n := v_n + 1;
  end loop;
  return v_num;
end $$;

comment on function proponer_numero_packing() is
  'El N.º de packing que se propone: el siguiente del contador PL (sin año), saltando los que ya use un embarque vivo o un contenedor. No consume el número.';

/*
 * El código que se propone para un CONTENEDOR NUEVO de un embarque: el PL del
 * embarque si ninguno de sus contenedores lo lleva todavía (el primer
 * contenedor es «el» packing de esa fila); si no, el siguiente de la serie.
 */
create or replace function proponer_codigo_packing(p_embarque_id bigint)
returns text
language plpgsql
stable
security definer
set search_path = public as $$
declare
  v_pl text;
begin
  select numero_packing into v_pl from embarques where id = p_embarque_id;
  if v_pl is not null and not exists (
       select 1 from packing_lists where clave_numero_packing(codigo) = clave_numero_packing(v_pl)) then
    return v_pl;
  end if;
  return proponer_numero_packing();
end $$;

/* El contador alcanza al número escrito si es de la serie y está por encima. */
create or replace function avanzar_contador_packing(p text)
returns void
language plpgsql
security definer
set search_path = public as $$
declare
  v_n int := cifra_numero_packing(p);
begin
  if v_n is null then return; end if;
  insert into correlativos (serie, anio, ultimo) values ('PL', 0, v_n)
  on conflict (serie, anio) do update set ultimo = greatest(correlativos.ultimo, excluded.ultimo);
end $$;


-- ────────────────────────────────────────────────────────────────────────────
--  4 · QUÉ LE PASA A UN N.º DE PACKING (null si está bien)
-- ────────────────────────────────────────────────────────────────────────────
--  Los mismos textos que src/lib/numeroPacking.ts.
--   p_embarque_id  el embarque del que se habla (el que se renombra, o el
--                  del contenedor).
--   p_packing_id   el contenedor que se renombra (null si es uno nuevo o si
--                  se trata del PL del embarque).
--   p_es_packing   true si el número es el código de un contenedor; false si
--                  es el PL del embarque.
--
--  Un contenedor puede llevar el PL de SU embarque (es lo normal: el primero
--  lo toma), pero no el de otro embarque, ni el de otro contenedor.
create or replace function problema_numero_packing(
  p_numero text, p_embarque_id bigint, p_packing_id bigint default null, p_es_packing boolean default false)
returns text
language plpgsql
stable
security definer
set search_path = public as $$
declare
  v text := normalizar_numero_packing(p_numero);
  k text := clave_numero_packing(p_numero);
  v_otro record;
begin
  if v is null then
    return 'Escriba el N.º de packing (por ejemplo PL POT1124).';
  end if;
  if length(v) > 30 then
    return format('El N.º de packing puede tener hasta 30 caracteres (este tiene %s).', length(v));
  end if;
  if v !~ '^[A-Z0-9][A-Z0-9 ._-]*$' then
    return 'El N.º de packing solo puede llevar letras sin tilde, números, espacios, guion (-), punto (.) o guion bajo (_). Ejemplo: PL POT1124.';
  end if;
  if v !~ '[0-9]' then
    return 'El N.º de packing tiene que llevar al menos una cifra (por ejemplo PL POT1124).';
  end if;

  -- ¿Lo tiene OTRO embarque vivo?
  select e.numero, e.fecha_programada into v_otro
    from embarques e
   where e.estado <> 'cancelado'
     and clave_numero_packing(e.numero_packing) = k
     and (p_embarque_id is null or e.id <> p_embarque_id)
   limit 1;
  if found then
    return format('El N.º de packing %s ya lo tiene el embarque %s (despacho del %s). Elija otro: el próximo libre es %s.',
                  v, v_otro.numero, to_char(v_otro.fecha_programada, 'DD/MM/YYYY'), proponer_numero_packing());
  end if;

  -- ¿Lo lleva algún contenedor? (de otro embarque; o, si es un contenedor, cualquier otro)
  select pk.codigo, e.numero into v_otro
    from packing_lists pk join embarques e on e.id = pk.embarque_id
   where clave_numero_packing(pk.codigo) = k
     and (p_packing_id is null or pk.id <> p_packing_id)
     and (p_es_packing or p_embarque_id is null or pk.embarque_id <> p_embarque_id)
   limit 1;
  if found then
    return format('El N.º de packing %s ya lo lleva un contenedor del embarque %s. Elija otro: el próximo libre es %s.',
                  v, v_otro.numero, proponer_numero_packing());
  end if;
  return null;
end $$;

comment on function problema_numero_packing(text, bigint, bigint, boolean) is
  'Por qué un N.º de packing no sirve (vacío, largo, caracteres, sin cifras, o lo usa otro embarque u otro contenedor), o null si sirve.';

/* Un nombre de unicidad por si dos personas guardan a la vez: el índice decide. */
create unique index if not exists embarques_numero_packing_unico
  on embarques (clave_numero_packing(numero_packing))
  where numero_packing is not null and estado <> 'cancelado';
create unique index if not exists packing_lists_codigo_clave_unica
  on packing_lists (clave_numero_packing(codigo));


-- ────────────────────────────────────────────────────────────────────────────
--  5 · EL EMBARQUE: SEMANA, ZARPE, OPERADOR Y PL (antes de guardar)
-- ────────────────────────────────────────────────────────────────────────────
create or replace function embarques_programacion_antes()
returns trigger
language plpgsql
security definer
set search_path = public as $$
declare
  v_problema text;
  v_semana_vieja int;
begin
  /* ---- Semana de despacho ----
     Si no viene, la de la fecha. Si cambia la fecha y la semana era la de la
     fecha anterior (la automática), se mueve con ella; si alguien escribió
     otra a mano, se respeta. */
  if tg_op = 'UPDATE' then
    v_semana_vieja := extract(week from old.fecha_programada)::int;
    if new.fecha_programada is distinct from old.fecha_programada
       and new.semana_despacho is not distinct from old.semana_despacho
       and (old.semana_despacho is null or old.semana_despacho = v_semana_vieja) then
      new.semana_despacho := extract(week from new.fecha_programada)::int;
    end if;
  end if;
  if new.semana_despacho is null and tg_op = 'INSERT' then
    new.semana_despacho := extract(week from new.fecha_programada)::int;
  end if;
  if new.semana_despacho is not null and (new.semana_despacho < 1 or new.semana_despacho > 53) then
    raise exception using errcode = 'P0001',
      message = format('La semana de despacho tiene que estar entre 1 y 53 (se escribió %s).', new.semana_despacho);
  end if;

  /* ---- Fecha de zarpe ----
     La nave no puede zarpar antes de que el contenedor salga de la bodega. */
  if new.fecha_zarpe is not null and new.fecha_zarpe < new.fecha_programada then
    raise exception using errcode = 'P0001', message = format(
      'La fecha de zarpe (%s) no puede ser antes del despacho programado (%s): el contenedor tiene que salir de la bodega antes de que zarpe la nave. Corrija una de las dos.',
      to_char(new.fecha_zarpe, 'DD/MM/YYYY'), to_char(new.fecha_programada, 'DD/MM/YYYY'));
  end if;

  /* ---- Operador logístico ---- */
  new.operador_logistico := nullif(btrim(regexp_replace(coalesce(new.operador_logistico, ''), '\s+', ' ', 'g')), '');
  if length(new.operador_logistico) > 80 then
    raise exception using errcode = 'P0001',
      message = 'El operador logístico no puede pasar de 80 caracteres.';
  end if;

  /* ---- N.º de packing ---- */
  new.numero_packing := normalizar_numero_packing(new.numero_packing);
  if new.numero_packing is not null
     and (tg_op = 'INSERT'
          or clave_numero_packing(new.numero_packing) is distinct from clave_numero_packing(old.numero_packing)
          or (old.estado = 'cancelado' and new.estado <> 'cancelado')) then
    v_problema := problema_numero_packing(new.numero_packing, case when tg_op = 'UPDATE' then new.id end, null, false);
    if v_problema is not null then
      raise exception using errcode = 'P0001', message = v_problema;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists embarques_programacion_antes on embarques;
create trigger embarques_programacion_antes
  before insert or update of fecha_programada, semana_despacho, fecha_zarpe, operador_logistico, numero_packing, estado
  on embarques
  for each row execute function embarques_programacion_antes();

/*
 * DESPUÉS de guardar el PL del embarque:
 *  · el contador alcanza al número escrito si es de la serie;
 *  · en un cambio, el historial lo cuenta (de X a Y, quién) y el contenedor
 *    de este embarque que llevaba el número viejo toma el nuevo: son el
 *    mismo packing.
 *  Si el cambio llega desde el contenedor (punto 6), ese disparador ya dejó
 *  su historial: aquí no se repite (pg_trigger_depth).
 */
create or replace function embarques_numero_packing_despues()
returns trigger
language plpgsql
security definer
set search_path = public as $$
declare
  v_quien text;
  v_renombrados int := 0;
begin
  if new.numero_packing is not null then
    perform avanzar_contador_packing(new.numero_packing);
  end if;

  if tg_op = 'UPDATE' and new.numero_packing is distinct from old.numero_packing
     and pg_trigger_depth() = 1 then
    select nombre into v_quien from usuarios where id = auth.uid();

    if old.numero_packing is not null and new.numero_packing is not null then
      update packing_lists set codigo = new.numero_packing
       where embarque_id = new.id
         and clave_numero_packing(codigo) = clave_numero_packing(old.numero_packing);
      get diagnostics v_renombrados = row_count;
    end if;

    insert into eventos (entidad, entidad_id, tipo, descripcion, severidad, metadatos, usuario_id)
    values ('embarques', new.id, 'numero_packing_cambiado',
            case
              when old.numero_packing is null then format('%s asignó el N.º de packing %s.', coalesce(v_quien, 'El sistema'), new.numero_packing)
              when new.numero_packing is null then format('%s quitó el N.º de packing %s.', coalesce(v_quien, 'El sistema'), old.numero_packing)
              else format('%s cambió el N.º de packing de %s a %s%s.', coalesce(v_quien, 'El sistema'),
                          old.numero_packing, new.numero_packing,
                          case when v_renombrados > 0 then ' (también en su contenedor)' else '' end)
            end,
            'info',
            jsonb_build_object('antes', old.numero_packing, 'despues', new.numero_packing),
            auth.uid());
  end if;
  return null;
end $$;

drop trigger if exists embarques_numero_packing_despues on embarques;
create trigger embarques_numero_packing_despues
  after insert or update of numero_packing on embarques
  for each row execute function embarques_numero_packing_despues();


-- ────────────────────────────────────────────────────────────────────────────
--  6 · EL CÓDIGO DEL CONTENEDOR (packing_lists.codigo)
-- ────────────────────────────────────────────────────────────────────────────
create or replace function packing_codigo_antes()
returns trigger
language plpgsql
security definer
set search_path = public as $$
declare
  v_problema text;
begin
  new.codigo := normalizar_numero_packing(new.codigo);
  if tg_op = 'UPDATE' and clave_numero_packing(new.codigo) is not distinct from clave_numero_packing(old.codigo) then
    return new;
  end if;
  v_problema := problema_numero_packing(new.codigo, new.embarque_id, case when tg_op = 'UPDATE' then new.id end, true);
  if v_problema is not null then
    raise exception using errcode = 'P0001', message = v_problema;
  end if;
  return new;
end $$;

drop trigger if exists packing_codigo_antes on packing_lists;
create trigger packing_codigo_antes
  before insert or update of codigo on packing_lists
  for each row execute function packing_codigo_antes();

create or replace function packing_codigo_despues()
returns trigger
language plpgsql
security definer
set search_path = public as $$
declare
  v_quien text;
  v_emb record;
begin
  perform avanzar_contador_packing(new.codigo);

  if tg_op = 'UPDATE' and new.codigo is distinct from old.codigo then
    select nombre into v_quien from usuarios where id = auth.uid();
    insert into eventos (entidad, entidad_id, tipo, descripcion, severidad, metadatos, usuario_id)
    values ('packing_lists', new.id, 'numero_packing_cambiado',
            format('%s cambió el N.º de packing de %s a %s.', coalesce(v_quien, 'El sistema'), old.codigo, new.codigo),
            'info', jsonb_build_object('antes', old.codigo, 'despues', new.codigo), auth.uid());

    /* Si era el PL del embarque, el embarque toma el nuevo (son el mismo). */
    if pg_trigger_depth() = 1 then
      select id, numero, numero_packing into v_emb from embarques where id = new.embarque_id;
      if found and clave_numero_packing(v_emb.numero_packing) = clave_numero_packing(old.codigo) then
        update embarques set numero_packing = new.codigo where id = v_emb.id;
        insert into eventos (entidad, entidad_id, tipo, descripcion, severidad, metadatos, usuario_id)
        values ('embarques', v_emb.id, 'numero_packing_cambiado',
                format('%s cambió el N.º de packing de %s a %s (desde su contenedor).', coalesce(v_quien, 'El sistema'), old.codigo, new.codigo),
                'info', jsonb_build_object('antes', old.codigo, 'despues', new.codigo), auth.uid());
      end if;
    end if;
  end if;
  return null;
end $$;

drop trigger if exists packing_codigo_despues on packing_lists;
create trigger packing_codigo_despues
  after insert or update of codigo on packing_lists
  for each row execute function packing_codigo_despues();


-- ────────────────────────────────────────────────────────────────────────────
--  7 · FIJAR EL PRÓXIMO N.º DE PACKING (Gerencia u Operaciones)
-- ────────────────────────────────────────────────────────────────────────────
create or replace function fijar_proximo_numero_packing(p_proximo int)
returns text
language plpgsql
security definer
set search_path = public as $$
declare
  v_num text;
  v_antes text := proponer_numero_packing();
  v_quien text;
begin
  if not puede('gerencia', 'operaciones') then
    raise exception using errcode = 'P0001',
      message = 'Fijar la numeración de packing corresponde a Gerencia u Operaciones.';
  end if;
  if p_proximo is null or p_proximo < 1 or p_proximo > 9999999 then
    raise exception using errcode = 'P0001',
      message = 'El próximo número tiene que ser un entero entre 1 y 9999999.';
  end if;
  v_num := formato_numero_packing(p_proximo);
  if numero_packing_usado(clave_numero_packing(v_num)) then
    raise exception using errcode = 'P0001', message = format(
      '%s ya lo usa un embarque o un contenedor. Elija un número libre: el próximo tiene que ser uno que nadie use todavía.', v_num);
  end if;

  insert into correlativos (serie, anio, ultimo, actualizado_en, actualizado_por)
  values ('PL', 0, p_proximo - 1, now(), auth.uid())
  on conflict (serie, anio) do update
    set ultimo = excluded.ultimo, actualizado_en = excluded.actualizado_en,
        actualizado_por = excluded.actualizado_por;

  select nombre into v_quien from usuarios where id = auth.uid();
  insert into eventos (entidad, entidad_id, tipo, descripcion, severidad, metadatos, usuario_id)
  values ('correlativos', 0, 'numeracion_packing_fijada',
          format('%s fijó el próximo N.º de packing en %s (antes se proponía %s).', coalesce(v_quien, 'El sistema'), v_num, v_antes),
          'info', jsonb_build_object('serie', 'PL', 'antes', v_antes, 'despues', v_num), auth.uid());

  return proponer_numero_packing();
end $$;

create or replace function estado_numeracion_packing()
returns jsonb
language sql
stable
security definer
set search_path = public as $$
  select jsonb_build_object(
    'propuesto',       proponer_numero_packing(),
    'ultimo',          c.ultimo,
    'mayor_usado',     (select max(n) from (
                          select cifra_numero_packing(codigo) n from packing_lists
                          union all select cifra_numero_packing(numero_packing) from embarques) x),
    'actualizado_en',  c.actualizado_en,
    'actualizado_por', (select u.nombre from usuarios u where u.id = c.actualizado_por)
  )
  from (select 1) uno
  left join correlativos c on c.serie = 'PL' and c.anio = 0
  where es_usuario_activo();
$$;


-- ────────────────────────────────────────────────────────────────────────────
--  8 · LOS DOCUMENTOS DEL EMBARQUE (etiqueta, packing declarado, real…)
-- ────────────────────────────────────────────────────────────────────────────
--  El MISMO repositorio privado que los archivos del despacho (064), con su
--  propia carpeta por embarque: «embarque-<id>/<tipo>/…». Se acepta Excel,
--  porque el packing list se arma en Excel y así se manda al cliente.
update storage.buckets
   set allowed_mime_types = (
         select array_agg(distinct t order by t) from unnest(
           coalesce(allowed_mime_types, array[]::text[]) || array[
             'application/pdf', 'image/jpeg', 'image/png',
             'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
             'application/vnd.ms-excel']) t)
 where id = 'despachos';

create table if not exists embarque_archivos (
  id            bigserial primary key,
  embarque_id   bigint not null references embarques(id) on delete cascade,
  tipo          text not null check (tipo in ('etiqueta', 'packing_declarado', 'packing_real', 'otro')),
  ruta          text not null unique,
  nombre        text not null,
  tipo_mime     text not null,
  tamano_bytes  bigint not null check (tamano_bytes > 0),
  comentario    text check (comentario is null or length(comentario) <= 500),
  subido_por    uuid references usuarios(id) default auth.uid(),
  subido_en     timestamptz not null default now()
);
create index if not exists embarque_archivos_embarque_idx on embarque_archivos (embarque_id, tipo, subido_en);

comment on table embarque_archivos is
  'Documentos del embarque: modelo de etiqueta (lo sube Comercial), packing list declarado al cliente / SANIPES, packing real y otros. Cada subida es una versión: la última de cada tipo es la vigente.';

alter table embarque_archivos enable row level security;
drop policy if exists "embarque_archivos_lectura"   on embarque_archivos;
drop policy if exists "embarque_archivos_escritura" on embarque_archivos;
drop policy if exists "embarque_archivos_borrado"   on embarque_archivos;
create policy "embarque_archivos_lectura" on embarque_archivos for select to authenticated
  using (es_usuario_activo());
create policy "embarque_archivos_escritura" on embarque_archivos for insert to authenticated
  with check (puede('gerencia', 'operaciones', 'comercial', 'comex', 'almacen') and subido_por = auth.uid());
--  Lo quita quien lo subió, o Gerencia u Operaciones.
create policy "embarque_archivos_borrado" on embarque_archivos for delete to authenticated
  using (puede('gerencia', 'operaciones')
         or (subido_por = auth.uid() and puede('comercial', 'comex', 'almacen')));

/* El repositorio: Comercial también sube a la carpeta de los embarques (la etiqueta es suya). */
drop policy if exists "embarques_archivos_subir"  on storage.objects;
drop policy if exists "embarques_archivos_borrar" on storage.objects;
create policy "embarques_archivos_subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'despachos' and name like 'embarque-%'
              and puede('gerencia', 'operaciones', 'comercial', 'comex', 'almacen'));
create policy "embarques_archivos_borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'despachos' and name like 'embarque-%'
         and puede('gerencia', 'operaciones', 'comercial', 'comex', 'almacen'));


-- ────────────────────────────────────────────────────────────────────────────
--  9 · LOS COMENTARIOS DEL EMBARQUE
-- ────────────────────────────────────────────────────────────────────────────
--  Una bitácora: no se editan ni se borran. Lo dicho queda con su autor y su
--  hora, que es justo lo que se necesita para seguir un packing list que va
--  y vuelve entre Comercial, Comercio Exterior y el cliente.
create table if not exists embarque_comentarios (
  id           bigserial primary key,
  embarque_id  bigint not null references embarques(id) on delete cascade,
  texto        text not null check (length(btrim(texto)) between 1 and 1000),
  archivo_id   bigint references embarque_archivos(id) on delete set null,
  autor_id     uuid not null references usuarios(id) default auth.uid(),
  creado_en    timestamptz not null default now()
);
create index if not exists embarque_comentarios_embarque_idx on embarque_comentarios (embarque_id, creado_en);

alter table embarque_comentarios enable row level security;
drop policy if exists "embarque_comentarios_lectura"   on embarque_comentarios;
drop policy if exists "embarque_comentarios_escritura" on embarque_comentarios;
create policy "embarque_comentarios_lectura" on embarque_comentarios for select to authenticated
  using (es_usuario_activo());
create policy "embarque_comentarios_escritura" on embarque_comentarios for insert to authenticated
  with check (puede('gerencia', 'operaciones', 'comercial', 'comex', 'almacen') and autor_id = auth.uid());

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'audit_embarque_archivos') then
    create trigger audit_embarque_archivos after insert or update or delete on embarque_archivos
      for each row execute function auditar_cambios();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'audit_embarque_comentarios') then
    create trigger audit_embarque_comentarios after insert or update or delete on embarque_comentarios
      for each row execute function auditar_cambios();
  end if;
end $$;


-- ────────────────────────────────────────────────────────────────────────────
--  10 · PERMISOS DE LAS FUNCIONES
-- ────────────────────────────────────────────────────────────────────────────
revoke all on function numero_packing_usado(text) from public, anon;
revoke all on function proponer_numero_packing() from public, anon;
revoke all on function proponer_codigo_packing(bigint) from public, anon;
revoke all on function avanzar_contador_packing(text) from public, anon, authenticated;
revoke all on function problema_numero_packing(text, bigint, bigint, boolean) from public, anon;
revoke all on function fijar_proximo_numero_packing(int) from public, anon;
revoke all on function estado_numeracion_packing() from public, anon;
revoke all on function embarques_programacion_antes() from public, anon;
revoke all on function embarques_numero_packing_despues() from public, anon;
revoke all on function packing_codigo_antes() from public, anon;
revoke all on function packing_codigo_despues() from public, anon;
grant execute on function numero_packing_usado(text) to authenticated;
grant execute on function proponer_numero_packing() to authenticated;
grant execute on function proponer_codigo_packing(bigint) to authenticated;
grant execute on function problema_numero_packing(text, bigint, bigint, boolean) to authenticated;
grant execute on function fijar_proximo_numero_packing(int) to authenticated;
grant execute on function estado_numeracion_packing() to authenticated;
