-- ============================================================================
--  063 · CIERRE SEMANAL DE PRODUCCIÓN · «Avance de plan»
-- ============================================================================
--  El reporte que usa Marco (Excel «Cierre Semanal_Producción», hoja
--  «1. RESUMEN T»). Oliver definió cada columna:
--
--     1  Plan MP           lo ingresa Marco al inicio del mes; modificable
--     2  Real MP           lo ingresa Oliver al final del mes
--     3  % Cump            2 ÷ 1
--     4  Ped/Ent           2 − 1
--     5  Prod. Plan        proyección de producción del mes
--     6  Prod. Real        la producción del mes ya registrada en ingresos   ← ERP
--     7  % Cump            6 ÷ 5
--     8  Stock Real        el stock al inicio del mes                        ← ERP
--     9  Plan Ventas       proyección de ventas del mes, al inicio
--    10  Ventas            las ventas del mes a la fecha                     ← ERP
--    11  Proy. lineal prod (6 ÷ 20) × 26   «el 20 y el 26 son fijos»
--    12  % Cum. proy prod  11 ÷ 5
--    13  Proy. lineal vent (10 ÷ 20) × 26
--    14  % ventas al día   10 ÷ 9
--
--  Las categorías son las del Excel: pota y merluza —que el ERP conoce por
--  especie— y las dos harinas residuales, que no son productos del ERP y se
--  ingresan a mano entera (también su producción, stock y ventas).
--
--  Lo ven y lo editan Marco y Oliver: el mismo permiso personal que Objetivos
--  mensuales (060).
-- ============================================================================


-- ============================================================================
--  1. LAS CATEGORÍAS
-- ============================================================================
create table if not exists cierre_categorias (
  id       bigserial primary key,
  codigo   text not null unique,
  nombre   text not null,
  orden    int not null,
  --  La especie del ERP de la que salen producción, stock y ventas. Nula =
  --  categoría que el ERP no conoce: todo a mano.
  especie  text,
  activo   boolean not null default true
);
comment on table cierre_categorias is
  'Filas del cierre semanal de producción. Con especie, el ERP pone producción real, stock inicial y ventas; sin especie (harinas residuales), se ingresan.';

insert into cierre_categorias (codigo, nombre, orden, especie) values
  ('pota',           'POTA',                    10, 'POTA'),
  ('merluza',        'MERLUZA',                 20, 'MERLUZA'),
  ('harina_pota',    'HARINA RESIDUAL POTA',    30, null),
  ('harina_pescado', 'HARINA RESIDUAL PESCADO', 40, null)
on conflict (codigo) do nothing;


-- ============================================================================
--  2. LO QUE SE INGRESA, MES A MES
-- ============================================================================
create table if not exists cierre_valores (
  id             bigserial primary key,
  categoria_id   bigint not null references cierre_categorias(id) on delete cascade,
  anio           int not null check (anio between 2000 and 2100),
  mes            int not null check (mes between 1 and 12),
  campo          text not null check (campo in
                   ('plan_mp', 'real_mp', 'plan_prod', 'plan_ventas', 'real_prod', 'stock_inicial', 'ventas')),
  valor          numeric(14,3) not null check (valor >= 0),
  registrado_por uuid references usuarios(id),
  actualizado_en timestamptz not null default now(),
  unique (categoria_id, anio, mes, campo)
);
comment on table cierre_valores is
  'Los datos del cierre que no salen del ERP: planes, materia prima real y, en las categorías sin especie, también producción, stock y ventas. Toneladas.';

--  Producción, stock y ventas de una categoría con especie los pone el ERP:
--  no se aceptan a mano, para que no haya dos cifras de lo mismo.
create or replace function cierre_validar_campo()
returns trigger language plpgsql as $$
begin
  if new.campo in ('real_prod', 'stock_inicial', 'ventas')
     and (select especie from cierre_categorias where id = new.categoria_id) is not null then
    raise exception 'La producción real, el stock inicial y las ventas de esta categoría salen del ERP: no se ingresan a mano.';
  end if;
  return new;
end $$;
drop trigger if exists trg_cierre_validar on cierre_valores;
create trigger trg_cierre_validar before insert or update on cierre_valores
  for each row execute function cierre_validar_campo();

create table if not exists cierre_historial (
  id             bigserial primary key,
  categoria_id   bigint not null references cierre_categorias(id) on delete cascade,
  anio           int not null,
  mes            int not null,
  campo          text not null,
  antes          numeric(14,3),
  despues        numeric(14,3),
  usuario_id     uuid,
  usuario_nombre text,
  registrado_en  timestamptz not null default now()
);
create index if not exists idx_cierre_hist on cierre_historial (registrado_en desc);

create or replace function cierre_registrar_historial()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_fila record := coalesce(new, old);
  v_usuario uuid := coalesce(auth.uid(), case when tg_op = 'DELETE' then old.registrado_por else new.registrado_por end);
begin
  if tg_op = 'UPDATE' and old.valor = new.valor then return new; end if;
  insert into cierre_historial (categoria_id, anio, mes, campo, antes, despues, usuario_id, usuario_nombre)
  values (v_fila.categoria_id, v_fila.anio, v_fila.mes, v_fila.campo,
          case when tg_op <> 'INSERT' then old.valor end,
          case when tg_op <> 'DELETE' then new.valor end,
          v_usuario, (select nombre from usuarios where id = v_usuario));
  return v_fila;
end $$;
drop trigger if exists trg_cierre_historial on cierre_valores;
create trigger trg_cierre_historial after insert or update or delete on cierre_valores
  for each row execute function cierre_registrar_historial();


-- ============================================================================
--  3. SOLO MARCO Y OLIVER
-- ============================================================================
alter table cierre_categorias enable row level security;
alter table cierre_valores    enable row level security;
alter table cierre_historial  enable row level security;
drop policy if exists "cierre_categorias" on cierre_categorias;
create policy "cierre_categorias" on cierre_categorias for select to authenticated using (puede_ver_objetivos());
drop policy if exists "cierre_valores" on cierre_valores;
create policy "cierre_valores" on cierre_valores for all to authenticated
  using (puede_ver_objetivos()) with check (puede_ver_objetivos());
drop policy if exists "cierre_historial" on cierre_historial;
create policy "cierre_historial" on cierre_historial for select to authenticated using (puede_ver_objetivos());


-- ============================================================================
--  4. EL 20 Y EL 26
--  «Siempre consideramos para procesos 26 días totales, el 20 también es
--  fijo.» Fijos, pero en Parámetros: si un día cambian, no hace falta tocar
--  el sistema.
-- ============================================================================
insert into parametros (clave, valor, tipo_dato, grupo, etiqueta, descripcion, unidad, editable_por) values
  ('cierre_dias_proyeccion', '20', 'numero', 'sistema', 'Cierre: días de la proyección',
   'Proyección lineal = real ÷ este número × días del mes. Oliver: «el 20 es fijo».', 'días', 'gerencia'),
  ('cierre_dias_mes', '26', 'numero', 'sistema', 'Cierre: días del mes',
   'Días de proceso que se consideran por mes en la proyección lineal. Oliver: «siempre consideramos 26 días totales».', 'días', 'gerencia')
on conflict (clave) do nothing;


-- ============================================================================
--  5. LO QUE PONE EL ERP
--  Por especie, en toneladas, para un mes:
--    · producción real: los ingresos a cámara del mes (propios y de maquila);
--    · stock inicial: lo que había el día 1, en todos los almacenes;
--    · ventas: lo despachado en el mes, a la fecha.
--  En hora de Lima, como todo el sistema.
-- ============================================================================
create or replace function cierre_erp(p_anio int, p_mes int)
returns table (especie text, prod_real numeric, stock_inicial numeric, ventas numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_desde date := make_date(p_anio, p_mes, 1);
  v_hasta date := (make_date(p_anio, p_mes, 1) + interval '1 month')::date;
begin
  if not puede_ver_objetivos() then return; end if;
  return query
  with esp as (select distinct c.especie from cierre_categorias c where c.especie is not null and c.activo),
  k as (
    select k.especie as esp, (k.fecha at time zone 'America/Lima')::date as dia, k.tipo,
           coalesce(k.entrada_kg, 0) as entra, coalesce(k.salida_kg, 0) as sale
      from v_kardex k
     where k.especie in (select e.especie from esp e)
  ),
  vent as (
    select esp_.nombre as esp, coalesce(sum(pkl.peso_neto_kg), 0) as kg
      from despachos d
      join packing_lists pk on pk.id = d.packing_list_id and pk.estado <> 'anulado'
      join packing_lineas pkl on pkl.packing_list_id = pk.id
      join lotes l on l.id = pkl.lote_id
      join sku_presentaciones sp on sp.id = l.sku_presentacion_id
      join skus s on s.id = sp.sku_id
      join especies esp_ on esp_.id = s.especie_id
     where (d.fecha_salida at time zone 'America/Lima')::date >= v_desde
       and (d.fecha_salida at time zone 'America/Lima')::date <  v_hasta
     group by esp_.nombre
  )
  select e.especie,
         round(coalesce((select sum(entra) from k where k.esp = e.especie and k.tipo = 'ingreso'
                           and k.dia >= v_desde and k.dia < v_hasta), 0) / 1000, 3),
         round(coalesce((select sum(entra - sale) from k where k.esp = e.especie and k.dia < v_desde), 0) / 1000, 3),
         round(coalesce((select v.kg from vent v where v.esp = e.especie), 0) / 1000, 3)
    from esp e;
end $$;
revoke all on function cierre_erp(int, int) from public, anon;
grant execute on function cierre_erp(int, int) to authenticated;
