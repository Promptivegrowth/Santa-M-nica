-- ============================================================================
--  082 · EL NÚMERO DE PROFORMA SE PUEDE ESCRIBIR Y CORREGIR
-- ============================================================================
--  EL PEDIDO
--  Oliver Tello (Operaciones): «poder modificar el número de Proforma».
--  Santa Mónica tiene su propia numeración real —la columna PROFORMA de su
--  base anterior: SM26-144, SM26-026, SM26-384…— y el sistema ponía el suyo
--  con un correlativo que nadie podía tocar. Si el ERP dice SM26-624 y el
--  correo al cliente dice SM26-390, el número deja de servir para lo único
--  para lo que existe: que todos hablen de lo mismo.
--
--  QUÉ CAMBIA
--   1. Al crear el pedido (directo o «Convertir en pedido») el número viene
--      PROPUESTO —el siguiente de la numeración— y se puede cambiar.
--   2. En la ficha del pedido, «Cambiar número», mientras no tenga un
--      comprobante (factura o boleta) emitido y vigente: el comprobante lo
--      lleva impreso y ya salió a SUNAT y al cliente.
--   3. Gerencia y Operaciones fijan en Configuración el PRÓXIMO número
--      automático, para que el sistema siga la numeración real.
--
--  LAS REGLAS (las mismas en la pantalla, en el servidor y aquí)
--   · Se guarda en MAYÚSCULAS y SIN ESPACIOS: «sm26 - 390» es SM26-390. Así
--     «único» no depende de cómo lo tecleó cada uno.
--   · En la serie del sistema (SM + año + guion + número) el número va con
--     TRES cifras como mínimo, que es como lo escribe Santa Mónica: SM26-26 se
--     guarda SM26-026. Si no, SM26-26 y SM26-026 serían «distintos» y
--     acabarían siendo dos proformas con el mismo número.
--   · No vacío, hasta 30 caracteres, solo letras, números, guion, punto y
--     guion bajo, y con al menos una cifra. La BARRA sigue prohibida (045):
--     separa el contenedor dentro de la proforma (SM26-225/3).
--   · Único: un índice sobre el número normalizado lo garantiza aunque dos
--     personas guarden a la vez.
--
--  EL CORRELATIVO, AHORA
--  Antes cada pedido «consumía» un número con siguiente_correlativo('SM'), y
--  el contador era lo único que mandaba. Ahora:
--   · proponer_numero_proforma() mira el contador SIN consumirlo, y si el
--     siguiente ya lo usa algún pedido (alguien lo escribió a mano), lo SALTA.
--     Nunca propone un número repetido.
--   · Al guardar un pedido con un número de la serie, el contador avanza hasta
--     ese número si estaba por debajo: escribir a mano SM26-500 hace que el
--     siguiente propuesto sea SM26-501. Se eligió saltar (y no solo avisar)
--     porque si alguien escribe el número real, la numeración real sigue
--     desde ahí. La pantalla lo avisa ANTES de guardar, y si fue un error,
--     Configuración permite volver a fijar el próximo.
--   · Un número fuera de la serie (p. ej. «EXP-2026-15») no mueve el contador.
--   · El año es el de Lima, no el de UTC: el 31 de diciembre a las 8 de la
--     noche todavía se numera con el año que termina.
--
--  LOS DOCUMENTOS
--  Todos leen el número del pedido al generarse (proforma PDF/Excel, factura,
--  embarque, packing, despacho, reportes, buscador): toman el vigente. La
--  única copia es la del CONTRATO, que es una foto firmada de la proforma con
--  su propia revisión (contratos.datos): no se reescribe por debajo; la
--  pantalla avisa que hay que generarlo de nuevo. Las alertas abiertas del
--  pedido y de sus reservas, que llevan el número en el texto, se corrigen
--  aquí mismo. Lo que pasó antes (eventos) se queda como se escribió.
--
--  Re-ejecutable.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
--  1 · CÓMO SE ESCRIBE UN NÚMERO DE PROFORMA
-- ────────────────────────────────────────────────────────────────────────────
create or replace function normalizar_numero_proforma(p text)
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
  -- Mayúsculas y sin espacios: «sm26 - 390» y «SM26-390» son el mismo.
  v := upper(regexp_replace(p, '\s+', '', 'g'));
  -- La serie del sistema, con tres cifras como mínimo (como la escribe Santa Mónica).
  m := regexp_match(v, '^SM(\d{2})-(\d+)$');
  if m is not null then
    cifras := coalesce(nullif(ltrim(m[2], '0'), ''), '0');
    v := 'SM' || m[1] || '-' || lpad(cifras, greatest(3, length(cifras)), '0');
  end if;
  return v;
end $$;

comment on function normalizar_numero_proforma(text) is
  'El número de proforma como se guarda: en mayúsculas, sin espacios y, en la serie SMaa-n, con tres cifras como mínimo (SM26-26 → SM26-026). Es la clave de unicidad.';

/* El número de la serie del sistema para un año y un correlativo: SM26-026, SM26-624. */
create or replace function formato_numero_proforma(p_anio int, p_numero int)
returns text
language sql
immutable
set search_path = public as $$
  select 'SM' || lpad((p_anio % 100)::text, 2, '0') || '-'
         || lpad(p_numero::text, greatest(3, length(p_numero::text)), '0');
$$;

/* El año de la numeración: el de Lima. */
create or replace function anio_numeracion_proforma()
returns int
language sql
stable
set search_path = public as $$
  select extract(year from (now() at time zone 'America/Lima'))::int;
$$;


-- ────────────────────────────────────────────────────────────────────────────
--  2 · QUÉ LE PASA A UN NÚMERO (null si está bien)
-- ────────────────────────────────────────────────────────────────────────────
--  Los mismos textos que src/lib/numeroProforma.ts, para que el usuario lea lo
--  mismo lo detecte la pantalla, el servidor o la base.
create or replace function problema_numero_proforma(p_numero text, p_pedido_id bigint default null)
returns text
language plpgsql
stable
security definer
set search_path = public as $$
declare
  v text := normalizar_numero_proforma(p_numero);
  v_otro record;
begin
  if v is null or v = '' then
    return 'Escriba el número de proforma.';
  end if;
  if length(v) > 30 then
    return format('El número de proforma puede tener hasta 30 caracteres (este tiene %s).', length(v));
  end if;
  if position('/' in v) > 0 then
    return 'El número de proforma no lleva barra «/»: la barra separa el contenedor dentro de la proforma (SM26-225/3). Use guion, por ejemplo SM26-225-1.';
  end if;
  if v !~ '^[A-Z0-9][A-Z0-9._-]*$' then
    return 'El número de proforma solo puede llevar letras sin tilde, números, guion (-), punto (.) o guion bajo (_). Ejemplo: SM26-390.';
  end if;
  if v !~ '[0-9]' then
    return 'El número de proforma tiene que llevar al menos una cifra (por ejemplo SM26-390).';
  end if;

  select p.numero_proforma, c.razon_social into v_otro
    from pedidos p left join clientes c on c.id = p.cliente_id
   where normalizar_numero_proforma(p.numero_proforma) = v
     and (p_pedido_id is null or p.id <> p_pedido_id)
   limit 1;
  if found then
    return format('Ya existe la proforma %s (%s). Elija otro número: el próximo libre de la numeración es %s.',
                  v_otro.numero_proforma, coalesce(v_otro.razon_social, 'sin cliente'), proponer_numero_proforma());
  end if;
  return null;
end $$;

comment on function problema_numero_proforma(text, bigint) is
  'Por qué un número de proforma no sirve (vacío, largo, barra, caracteres, sin cifras o repetido), o null si sirve. p_pedido_id: el pedido que se está renombrando, que no choca consigo mismo.';


-- ────────────────────────────────────────────────────────────────────────────
--  3 · EL PRÓXIMO NÚMERO AUTOMÁTICO, SIN CONSUMIRLO Y SIN REPETIR
-- ────────────────────────────────────────────────────────────────────────────
--  Lee el contador y propone el siguiente; si ya lo usa un pedido (porque
--  alguien lo escribió a mano, o porque Configuración bajó el contador por
--  debajo de números ya usados), prueba el siguiente. No escribe nada: el
--  contador avanza cuando el pedido SE GUARDA (disparador del punto 5). Si dos
--  personas reciben la misma propuesta, el índice único decide y el servidor
--  le da al segundo el siguiente libre.
--
--  Se declara antes que problema_numero_proforma la llame en ejecución (plpgsql
--  resuelve los nombres al correr, así que el orden del archivo no importa).
create or replace function proponer_numero_proforma()
returns text
language plpgsql
stable
security definer
set search_path = public as $$
declare
  v_anio int := anio_numeracion_proforma();
  v_n int;
  v_num text;
begin
  select ultimo into v_n from correlativos where serie = 'SM' and anio = v_anio;
  v_n := coalesce(v_n, 0) + 1;
  loop
    v_num := formato_numero_proforma(v_anio, v_n);
    exit when not exists (
      select 1 from pedidos where normalizar_numero_proforma(numero_proforma) = v_num
    );
    v_n := v_n + 1;
  end loop;
  return v_num;
end $$;

comment on function proponer_numero_proforma() is
  'El número que se propone al crear un pedido: el siguiente del contador SM del año (de Lima), saltando los que ya use algún pedido. No consume el número.';


-- ────────────────────────────────────────────────────────────────────────────
--  4 · ÚNICO DE VERDAD: SOBRE EL NÚMERO NORMALIZADO
-- ────────────────────────────────────────────────────────────────────────────
--  La restricción vieja (UNIQUE sobre el texto tal cual) se queda: no estorba.
--  Esta es la que cuenta, porque «sm26-390» y «SM26-390 » chocan aquí.
create unique index if not exists pedidos_numero_proforma_normalizado
  on pedidos (normalizar_numero_proforma(numero_proforma));

comment on index pedidos_numero_proforma_normalizado is
  'Dos pedidos no pueden tener el mismo número de proforma, sin importar mayúsculas, espacios ni ceros a la izquierda en la serie SMaa-n.';


-- ────────────────────────────────────────────────────────────────────────────
--  5 · LOS DISPARADORES DEL NÚMERO
-- ────────────────────────────────────────────────────────────────────────────
/*
 * ANTES de guardar: normaliza, valida y, si es un CAMBIO, comprueba que se
 * pueda cambiar. Es la última palabra: aunque alguien escriba en la tabla sin
 * pasar por la pantalla, el número sale igual de limpio y con el mismo motivo.
 */
create or replace function pedidos_numero_proforma_antes()
returns trigger
language plpgsql
security definer
set search_path = public as $$
declare
  v_problema text;
  v_fac record;
begin
  new.numero_proforma := normalizar_numero_proforma(new.numero_proforma);

  if tg_op = 'UPDATE' and new.numero_proforma is not distinct from normalizar_numero_proforma(old.numero_proforma) then
    return new;   -- no cambió (como mucho, la forma de escribirlo)
  end if;

  v_problema := problema_numero_proforma(new.numero_proforma, case when tg_op = 'UPDATE' then new.id end);
  if v_problema is not null then
    raise exception using errcode = 'P0001', message = v_problema;
  end if;

  if tg_op = 'UPDATE' then
    /*
     * HASTA CUÁNDO SE PUEDE CAMBIAR: mientras no haya un comprobante emitido y
     * vigente. La factura o la boleta llevan el número impreso, ya se
     * declararon a SUNAT y ya las tiene el cliente: cambiarlo en el sistema
     * dejaría dos papeles que no coinciden. Con el comprobante anulado, sí.
     */
    select f.numero into v_fac
      from facturas f
     where f.pedido_id = new.id and f.estado <> 'anulada'
     order by f.fecha_emision, f.id
     limit 1;
    if found then
      raise exception using errcode = 'P0001', message = format(
        'La proforma %s ya tiene emitido el comprobante %s: su número ya no se puede cambiar, porque el comprobante lo lleva impreso y ya salió al cliente. Si de verdad hay que corregirlo, primero tiene que anularse ese comprobante en Facturación.',
        old.numero_proforma, v_fac.numero);
    end if;
  end if;

  return new;
end $$;

drop trigger if exists pedidos_numero_proforma_antes on pedidos;
create trigger pedidos_numero_proforma_antes
  before insert or update of numero_proforma on pedidos
  for each row execute function pedidos_numero_proforma_antes();

/*
 * DESPUÉS de guardar:
 *  · el contador alcanza al número escrito si es de la serie y está por
 *    encima (así no se vuelve a proponer uno repetido y la numeración sigue
 *    desde el número real);
 *  · en un cambio, el historial lo cuenta (de X a Y, quién) y las alertas
 *    abiertas del pedido y de sus reservas dicen el número nuevo.
 */
create or replace function pedidos_numero_proforma_despues()
returns trigger
language plpgsql
security definer
set search_path = public as $$
declare
  m text[];
  v_quien text;
begin
  m := regexp_match(new.numero_proforma, '^SM(\d{2})-(\d{1,6})$');
  if m is not null then
    insert into correlativos (serie, anio, ultimo)
    values ('SM', 2000 + m[1]::int, m[2]::int)
    on conflict (serie, anio) do update
      set ultimo = greatest(correlativos.ultimo, excluded.ultimo);
  end if;

  if tg_op = 'UPDATE' and new.numero_proforma is distinct from old.numero_proforma then
    select nombre into v_quien from usuarios where id = auth.uid();

    insert into eventos (entidad, entidad_id, tipo, descripcion, severidad, metadatos, usuario_id)
    values ('pedidos', new.id, 'numero_proforma_cambiado',
            format('%s cambió el número de proforma de %s a %s.', coalesce(v_quien, 'El sistema'),
                   old.numero_proforma, new.numero_proforma),
            'info',
            jsonb_build_object('antes', old.numero_proforma, 'despues', new.numero_proforma),
            auth.uid());

    update alertas a
       set mensaje = replace(a.mensaje, old.numero_proforma, new.numero_proforma),
           titulo  = replace(a.titulo,  old.numero_proforma, new.numero_proforma),
           datos   = case when a.datos ? 'numero_proforma'
                          then jsonb_set(a.datos, '{numero_proforma}', to_jsonb(new.numero_proforma))
                          else a.datos end
     where not a.atendida
       and ((a.entidad = 'pedidos' and a.entidad_id = new.id)
         or (a.entidad = 'reservas' and a.entidad_id in (
               select r.id from reservas r join pedido_lineas pl on pl.id = r.pedido_linea_id
                where pl.pedido_id = new.id)));
  end if;

  return null;
end $$;

drop trigger if exists pedidos_numero_proforma_despues on pedidos;
create trigger pedidos_numero_proforma_despues
  after insert or update of numero_proforma on pedidos
  for each row execute function pedidos_numero_proforma_despues();


-- ────────────────────────────────────────────────────────────────────────────
--  6 · CONFIGURACIÓN: FIJAR EL PRÓXIMO NÚMERO AUTOMÁTICO
-- ────────────────────────────────────────────────────────────────────────────
--  Quién y cuándo lo fijó a mano por última vez (el avance normal, al guardar
--  pedidos, no lo toca: no es una decisión de nadie).
alter table correlativos add column if not exists actualizado_en  timestamptz;
alter table correlativos add column if not exists actualizado_por uuid references usuarios(id);

create or replace function fijar_proximo_numero_proforma(p_proximo int)
returns text
language plpgsql
security definer
set search_path = public as $$
declare
  v_anio int := anio_numeracion_proforma();
  v_num text;
  v_antes text := proponer_numero_proforma();
  v_ped record;
  v_quien text;
begin
  if not puede('gerencia', 'operaciones') then
    raise exception using errcode = 'P0001',
      message = 'Fijar la numeración de proformas corresponde a Gerencia u Operaciones.';
  end if;
  if p_proximo is null or p_proximo < 1 or p_proximo > 999999 then
    raise exception using errcode = 'P0001',
      message = 'El próximo número tiene que ser un entero entre 1 y 999999.';
  end if;

  v_num := formato_numero_proforma(v_anio, p_proximo);
  select p.numero_proforma, c.razon_social into v_ped
    from pedidos p left join clientes c on c.id = p.cliente_id
   where normalizar_numero_proforma(p.numero_proforma) = v_num limit 1;
  if found then
    raise exception using errcode = 'P0001', message = format(
      '%s ya es la proforma de %s. Elija un número libre: el próximo tiene que ser uno que ningún pedido use todavía.',
      v_ped.numero_proforma, coalesce(v_ped.razon_social, 'otro pedido'));
  end if;

  insert into correlativos (serie, anio, ultimo, actualizado_en, actualizado_por)
  values ('SM', v_anio, p_proximo - 1, now(), auth.uid())
  on conflict (serie, anio) do update
    set ultimo = excluded.ultimo, actualizado_en = excluded.actualizado_en,
        actualizado_por = excluded.actualizado_por;

  select nombre into v_quien from usuarios where id = auth.uid();
  insert into eventos (entidad, entidad_id, tipo, descripcion, severidad, metadatos, usuario_id)
  values ('correlativos', v_anio, 'numeracion_proforma_fijada',
          format('%s fijó el próximo número automático de proforma en %s (antes se proponía %s).',
                 coalesce(v_quien, 'El sistema'), v_num, v_antes),
          'info', jsonb_build_object('serie', 'SM', 'anio', v_anio, 'antes', v_antes, 'despues', v_num),
          auth.uid());

  return proponer_numero_proforma();
end $$;

comment on function fijar_proximo_numero_proforma(int) is
  'Configuración › Parámetros: fija el próximo número automático de proforma del año (de Lima). Solo Gerencia y Operaciones; no acepta un número que ya use un pedido. Devuelve lo que se propondrá ahora.';

/* Lo que muestra Configuración, en una sola llamada. */
create or replace function estado_numeracion_proforma()
returns jsonb
language sql
stable
security definer
set search_path = public as $$
  select jsonb_build_object(
    'anio',           a.anio,
    'prefijo',        'SM' || lpad((a.anio % 100)::text, 2, '0') || '-',
    'ultimo',         coalesce(c.ultimo, 0),
    'propuesto',      proponer_numero_proforma(),
    'mayor_usado',    (select max((regexp_match(normalizar_numero_proforma(p.numero_proforma), '^SM\d{2}-(\d{1,6})$'))[1]::int)
                         from pedidos p
                        where normalizar_numero_proforma(p.numero_proforma) like 'SM' || lpad((a.anio % 100)::text, 2, '0') || '-%'),
    'actualizado_en', c.actualizado_en,
    'actualizado_por', (select u.nombre from usuarios u where u.id = c.actualizado_por)
  )
  from (select anio_numeracion_proforma() anio) a
  left join correlativos c on c.serie = 'SM' and c.anio = a.anio
  where es_usuario_activo();
$$;


-- ────────────────────────────────────────────────────────────────────────────
--  7 · PERMISOS
-- ────────────────────────────────────────────────────────────────────────────
revoke all on function problema_numero_proforma(text, bigint) from public, anon;
revoke all on function proponer_numero_proforma() from public, anon;
revoke all on function fijar_proximo_numero_proforma(int) from public, anon;
revoke all on function estado_numeracion_proforma() from public, anon;
revoke all on function pedidos_numero_proforma_antes() from public, anon;
revoke all on function pedidos_numero_proforma_despues() from public, anon;
grant execute on function problema_numero_proforma(text, bigint) to authenticated;
grant execute on function proponer_numero_proforma() to authenticated;
grant execute on function fijar_proximo_numero_proforma(int) to authenticated;
grant execute on function estado_numeracion_proforma() to authenticated;
