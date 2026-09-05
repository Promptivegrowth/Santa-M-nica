-- ============================================================================
--  034 · QUIÉN VE Y QUIÉN ESCRIBE LOS COSTOS
-- ============================================================================
--  ESCRIBE: solo GERENCIA. Oliver fue explícito: «ese lo tendría que ingresar
--  Marco, que tiene todos los datos». No es una restricción de comodidad — el
--  costo de producción determina el margen de toda la empresa, y quien lo
--  teclea decide, de hecho, si un pedido parece rentable o no.
--
--  LEE: solo quien ya puede ver costos. Es la misma línea que separa a los
--  roles en el resto del sistema —gerencia, operaciones y comercial— y que
--  deja fuera a almacén, calidad, comex y consulta. Enseñarle a Almacén lo que
--  cuesta producir un kilo no le ayuda a cargar un contenedor, y en cambio es
--  información que la empresa no reparte.
--
--  Ojo con esto: es la PRIMERA tabla del sistema cuya lectura no es para todos
--  los autenticados. Las demás usan `lectura_autenticados`.
-- ============================================================================
alter table costos_mensuales enable row level security;

drop policy if exists "lectura_costos" on costos_mensuales;
create policy "lectura_costos" on costos_mensuales
  for select to authenticated
  using ( puede('gerencia', 'operaciones', 'comercial') );

drop policy if exists "escritura_costos" on costos_mensuales;
create policy "escritura_costos" on costos_mensuales
  for all to authenticated
  using ( puede('gerencia') )
  with check ( puede('gerencia') );


-- ============================================================================
--  MANTENER `actualizado_en` AL DÍA
--  Sin esto, la columna diría siempre la fecha de creación y nadie sabría si
--  el costo de este mes se revisó o se quedó como estaba.
-- ============================================================================
create or replace function costos_marcar_actualizado()
returns trigger language plpgsql as $$
begin
  new.actualizado_en := now();
  return new;
end $$;

drop trigger if exists trg_costos_actualizado on costos_mensuales;
create trigger trg_costos_actualizado
  before update on costos_mensuales
  for each row execute function costos_marcar_actualizado();


-- ============================================================================
--  DATOS DE DEMOSTRACIÓN
--  Seis meses de costos para todos los productos activos, con una estructura
--  realista para pota congelada: la materia prima pesa alrededor del 70 % del
--  costo, la mano de obra un 22 % y el resto de variables un 8 %.
--
--  Se derivan del costo que ya tiene cada lote —`lotes.costo_unitario`— para
--  que las dos cifras del sistema cuenten la misma historia: si el estándar
--  mensual no se pareciera al costo de los pallets que hay en cámara, el
--  margen y el inventario valorizado se contradirían sin explicación.
--
--  TODOS LOS DATOS DE ESTE SISTEMA SON FICTICIOS.
-- ============================================================================
do $$
declare
  v_gerencia uuid;
  v_n int;
begin
  select id into v_gerencia from usuarios where rol = 'gerencia' order by id limit 1;

  insert into costos_mensuales
    (sku_id, anio, mes, materia_prima_kg, conversion_kg, variable_kg, registrado_por, observaciones)
  select
    base.sku_id,
    p.anio,
    p.mes,
    /*
     * Una variación estacional suave, de ±6 %, para que la pantalla tenga una
     * curva y no una línea recta. La pota sube de precio fuera de campaña.
     */
    round((base.costo * 0.70 * (1 + 0.06 * sin(p.mes::numeric)))::numeric, 4),
    round((base.costo * 0.22)::numeric, 4),
    round((base.costo * 0.08)::numeric, 4),
    v_gerencia,
    'Carga inicial de demostración'
  from (
    select s.id as sku_id,
           -- El costo medio de los lotes de ese producto; si nunca se produjo,
           -- el promedio general, para no dejar el catálogo a medias.
           coalesce(avg(l.costo_unitario) filter (where l.costo_unitario > 0),
                    (select avg(costo_unitario) from lotes where costo_unitario > 0)) as costo
      from skus s
      left join sku_presentaciones sp on sp.sku_id = s.id
      left join lotes l on l.sku_presentacion_id = sp.id
     where s.activo
     group by s.id
  ) base
  cross join (
    -- Los seis meses hasta el actual.
    select extract(year  from d)::int as anio,
           extract(month from d)::int as mes
      from generate_series(
             date_trunc('month', current_date) - interval '5 months',
             date_trunc('month', current_date),
             interval '1 month') d
  ) p
  on conflict (sku_id, anio, mes) do nothing;

  get diagnostics v_n = row_count;
  raise notice 'Costos mensuales sembrados: % filas', v_n;
end $$;
