-- ============================================================================
--  017 · CORRELATIVOS DE DOCUMENTOS
-- ============================================================================
--  EL FALLO QUE ESTO ARREGLA
--  Al convertir una cotización en pedido, el sistema devolvía:
--
--      duplicate key value violates unique constraint "pedidos_numero_proforma_key"
--
--  El número de proforma se calculaba CONTANDO las filas de la tabla:
--
--      SM26-{cantidad de pedidos + 1}
--
--  Eso funciona mientras los números vayan seguidos y nunca se borre nada. En
--  cuanto hay huecos —421 pedidos pero el último es el SM26-520— el siguiente
--  número calculado ya existe, y la conversión revienta con un error de base
--  de datos delante del usuario.
--
--  Y aunque no hubiera huecos seguiría estando mal: dos personas convirtiendo
--  a la vez cuentan lo mismo y piden el mismo número.
--
--  CÓMO SE RESUELVE
--  Un contador por serie y año, incrementado con `on conflict do update
--  returning`, que PostgreSQL resuelve de forma atómica: si dos sesiones lo
--  piden a la vez, una espera a la otra y cada una se lleva un número
--  distinto. No hace falta bloquear nada a mano.
--
--  Los contadores arrancan en el máximo que ya existe, para que los números
--  nuevos sigan a los de la demostración en lugar de chocar con ellos.
-- ============================================================================

create table if not exists correlativos (
  serie  text not null,
  anio   int  not null,
  ultimo int  not null default 0,
  primary key (serie, anio)
);

comment on table correlativos is
  'Último número usado por cada serie de documento y año. Se incrementa de forma atómica.';

/* ---------------------------------------------------------------------------
   El único punto por el que se pide un número nuevo
   --------------------------------------------------------------------------- */
create or replace function siguiente_correlativo(p_serie text, p_anio int)
returns int
language plpgsql
security definer
set search_path = public as $$
declare
  v_numero int;
begin
  /*
   * INSERT ... ON CONFLICT DO UPDATE ... RETURNING es atómico: la fila queda
   * bloqueada mientras se actualiza, así que dos llamadas simultáneas nunca
   * devuelven el mismo valor. Es la diferencia con leer el máximo y sumarle
   * uno, que sí puede repetirse.
   */
  insert into correlativos (serie, anio, ultimo)
  values (p_serie, p_anio, 1)
  on conflict (serie, anio)
    do update set ultimo = correlativos.ultimo + 1
  returning ultimo into v_numero;

  return v_numero;
end;
$$;

comment on function siguiente_correlativo is
  'Devuelve el siguiente número de una serie, sin posibilidad de repetirlo aunque se pida a la vez.';

/* ---------------------------------------------------------------------------
   Se arranca desde lo que ya hay
   ---------------------------------------------------------------------------
   El número va al final del código, después del último guion, y puede llevar
   ceros delante. Se extrae con una expresión regular en vez de suponer una
   longitud fija, porque COT-2026-0140 y SM26-520 no la tienen igual.
   --------------------------------------------------------------------------- */
insert into correlativos (serie, anio, ultimo)
select 'COT', 2026, coalesce(max((regexp_match(numero, '(\d+)$'))[1]::int), 0)
from cotizaciones
where numero like 'COT-2026-%'
on conflict (serie, anio) do update
  set ultimo = greatest(correlativos.ultimo, excluded.ultimo);

insert into correlativos (serie, anio, ultimo)
select 'SM', 2026, coalesce(max((regexp_match(numero_proforma, '(\d+)$'))[1]::int), 0)
from pedidos
where numero_proforma like 'SM26-%'
on conflict (serie, anio) do update
  set ultimo = greatest(correlativos.ultimo, excluded.ultimo);

/* ---------------------------------------------------------------------------
   Seguridad
   ---------------------------------------------------------------------------
   La tabla no se toca a mano nunca: solo la función, que es SECURITY DEFINER
   y por tanto ignora estas políticas. Se deja lectura para poder auditar por
   dónde va cada serie.
   --------------------------------------------------------------------------- */
alter table correlativos enable row level security;

drop policy if exists correlativos_lectura on correlativos;
create policy correlativos_lectura on correlativos
  for select using (es_usuario_activo());
