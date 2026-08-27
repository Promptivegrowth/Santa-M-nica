-- ============================================================================
--  019 · CORRELATIVOS DE COMPROBANTES, DESPACHOS Y TRASLADOS
-- ============================================================================
--  EL PROBLEMA
--  La tabla de correlativos solo estaba sembrada para cotizaciones (COT) y
--  proformas (SM). Al emitir el primer comprobante desde la pantalla, el
--  contador de la serie F001 arrancaba en 1 y devolvía «F001-000001», que ya
--  existía: la factura no se emitía y el error que salía era el de una clave
--  duplicada, que no le dice nada a quien está facturando.
--
--  Lo mismo habría pasado con los despachos y los traslados en cuanto se
--  usaran desde la pantalla.
--
--  QUÉ HACE
--  Siembra cada serie con el número más alto que ya existe, para que el
--  siguiente que entregue sea el que sigue de verdad. Es idempotente: si ya
--  estaba sembrada, se queda con el mayor de los dos.
-- ============================================================================

-- --- Comprobantes ------------------------------------------------------------
-- Los números tienen la forma «F001-000069»: la serie es lo de antes del
-- guion y el correlativo lo de después.
insert into correlativos (serie, anio, ultimo)
select
  split_part(f.numero, '-', 1)                                as serie,
  extract(year from f.fecha_emision)::int                     as anio,
  max(nullif(regexp_replace(split_part(f.numero, '-', 2), '\D', '', 'g'), '')::int) as ultimo
from facturas f
where f.numero like '%-%'
group by 1, 2
on conflict (serie, anio) do update
  set ultimo = greatest(correlativos.ultimo, excluded.ultimo);


-- --- Despachos y traslados ---------------------------------------------------
-- Sus números son «DESP-2026-0074» y «TRAS-2026-0070»: tres tramos separados
-- por guiones. El correlativo es el ÚLTIMO tramo, no todos los dígitos
-- juntos: al concatenarlos, el año se colaba en el número y el contador
-- quedaba en 60074 en vez de 74.
insert into correlativos (serie, anio, ultimo)
select 'DESP', split_part(d.numero, '-', 2)::int,
       max(split_part(d.numero, '-', 3)::int)
from despachos d
where d.numero ~ '^DESP-\d{4}-\d+$'
group by 2
on conflict (serie, anio) do update
  set ultimo = greatest(correlativos.ultimo, excluded.ultimo);

insert into correlativos (serie, anio, ultimo)
select 'TRAS', split_part(t.numero, '-', 2)::int,
       max(split_part(t.numero, '-', 3)::int)
from traslados t
where t.numero ~ '^TRAS-\d{4}-\d+$'
group by 2
on conflict (serie, anio) do update
  set ultimo = greatest(correlativos.ultimo, excluded.ultimo);

-- Las filas mal calculadas de un intento anterior, si quedaron.
delete from correlativos where serie in ('DES', 'TRA');


-- --- Series que todavía no tienen ni un documento ----------------------------
-- B001 son las boletas: hoy no hay ninguna porque todos los clientes peruanos
-- tienen RUC, pero el contador tiene que existir antes de la primera.
insert into correlativos (serie, anio, ultimo)
values ('B001', extract(year from now())::int, 0)
on conflict (serie, anio) do nothing;


-- --- Comprobación ------------------------------------------------------------
-- Si algún contador quedara por debajo de un número ya emitido, la próxima
-- emisión chocaría. Mejor que falle aquí.
do $$
declare v_malos int;
begin
  select count(*) into v_malos
  from (
    select split_part(f.numero, '-', 1) serie,
           extract(year from f.fecha_emision)::int anio,
           max(nullif(regexp_replace(split_part(f.numero, '-', 2), '\D', '', 'g'), '')::int) usado
    from facturas f where f.numero like '%-%'
    group by 1, 2
  ) x
  join correlativos c on c.serie = x.serie and c.anio = x.anio
  where c.ultimo < x.usado;

  if v_malos > 0 then
    raise exception 'Quedaron % series con el contador por debajo de un número ya emitido', v_malos;
  end if;
end $$;
