-- ============================================================================
--  067 · EL COSTO ESTIMADO DE CADA LÍNEA SALE DEL COSTO VIGENTE
-- ============================================================================
--  Lo encontró la revisión de Análisis: las acciones que crean cotizaciones y
--  pedidos —también la conversión cotización → pedido y el pedido directo—
--  grababan `costo_estimado_tm = 0`. Con 071 una línea con costo cero ya no
--  inventa un margen del 100 %, pero entonces TODO pedido nuevo salía «Sin
--  costo» en Rentabilidad, aunque Finanzas tuviera el costo del producto
--  cargado.
--
--  LA REGLA ES LA DE FINANZAS › COSTOS, NO UNA NUEVA
--  El costo que rige para un producto en una fecha es la última carga de
--  `costos_mensuales` con `vigente_desde` ≤ esa fecha (057:
--  `costo_produccion_kg(sku, fecha)`, la misma que valoriza el lote al
--  entrar a cámara). Está en US$ por kilo; la línea guarda US$ por TM, así
--  que se multiplica por 1000. La fecha es HOY en Lima: el costo que rige el
--  día en que se cotiza o se registra el pedido.
--
--  POR QUÉ EN LA BASE Y NO EN LA ACCIÓN
--  Comercio Exterior registra pedidos directos pero no ve costos (la
--  política de `costos_mensuales` no se lo deja leer). Si la acción buscara
--  el costo con la sesión del usuario, sus pedidos seguirían en cero; y una
--  función que se lo devolviera a la pantalla le abriría los costos. El
--  disparador lo escribe en la fila sin enseñárselo a nadie.
--
--  QUÉ SE RESPETA
--    · Cotización: la línea guarda su costo estimado (columna nueva). Si llega
--      sin él (NULL), se toma el vigente. Al EDITAR, la acción manda el que ya
--      tenía cada línea cuyo producto no cambió, así que solo las líneas
--      nuevas o con otro producto toman el costo de hoy.
--    · Pedido: si la línea llega con costo (> 0) se respeta —es el heredado
--      de la cotización al convertir—; si llega sin él (NULL o 0), el vigente.
--    · Sin costo vigente para ese producto: la cotización queda en NULL y el
--      pedido en 0, como hasta ahora; Rentabilidad lo cuenta «sin costo».
--    · Solo al INSERTAR. Las líneas que ya existen no se tocan.
--
--  Re-ejecutable.
-- ============================================================================

alter table cotizacion_lineas add column if not exists costo_estimado_tm numeric(14,4);
comment on column cotizacion_lineas.costo_estimado_tm is
  'Costo estimado en US$ por TM, del costo vigente de Finanzas al cotizar (067). NULL = no había costo vigente. Pasa al pedido al convertir.';

/* ---- El costo vigente de una presentación, en US$ por TM ---- */
create or replace function costo_estimado_tm_vigente(p_sku_presentacion_id bigint)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select round(costo_produccion_kg(sp.sku_id, (now() at time zone 'America/Lima')::date) * 1000, 4)
    from sku_presentaciones sp
   where sp.id = p_sku_presentacion_id;
$$;
comment on function costo_estimado_tm_vigente(bigint) is
  'US$ por TM que rige HOY (Lima) para el SKU de esa presentación, según costo_produccion_kg (057). Solo la usan los disparadores de 067: no se expone a la API.';
--  No es para la API: quien no ve costos no debe poder pedirlo por aquí.
revoke execute on function costo_estimado_tm_vigente(bigint) from public, anon, authenticated;

/* ---- Cotización: si la línea llega sin costo, el vigente ---- */
create or replace function cotizacion_lineas_costo_estimado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.costo_estimado_tm is null then
    new.costo_estimado_tm := costo_estimado_tm_vigente(new.sku_presentacion_id);
  end if;
  return new;
end $$;
revoke execute on function cotizacion_lineas_costo_estimado() from public, anon;
grant execute on function cotizacion_lineas_costo_estimado() to authenticated;

drop trigger if exists costo_estimado_al_cotizar on cotizacion_lineas;
create trigger costo_estimado_al_cotizar
  before insert on cotizacion_lineas
  for each row execute function cotizacion_lineas_costo_estimado();

/* ---- Pedido: se respeta el heredado; si no hay, el vigente (o 0) ---- */
create or replace function pedido_lineas_costo_estimado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.costo_estimado_tm, 0) <= 0 then
    new.costo_estimado_tm := coalesce(costo_estimado_tm_vigente(new.sku_presentacion_id), 0);
  end if;
  return new;
end $$;
revoke execute on function pedido_lineas_costo_estimado() from public, anon;
grant execute on function pedido_lineas_costo_estimado() to authenticated;

drop trigger if exists costo_estimado_al_vender on pedido_lineas;
create trigger costo_estimado_al_vender
  before insert on pedido_lineas
  for each row execute function pedido_lineas_costo_estimado();
