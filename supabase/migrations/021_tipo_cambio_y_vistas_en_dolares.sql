-- ============================================================================
--  021 · EL TIPO DE CAMBIO, BIEN DEFINIDO — Y LAS VISTAS EN DÓLARES
-- ============================================================================
--  EL PROBLEMA
--  El campo `tipo_cambio` existía en cotizaciones, pedidos y facturas, pero
--  nadie había dicho qué significa. Los datos lo demuestran: los documentos en
--  dólares guardaban 3,75 y los documentos en soles guardaban 1. O sea, se
--  había llenado como «soles por unidad de la moneda del documento».
--
--  Con esa lectura, convertir a dólares dividiendo por el campo deja un
--  importe en soles rotulado como dólares. Y peor: las vistas del tablero
--  sumaban soles y dólares en el mismo número y la pantalla lo etiquetaba US$.
--  Un pedido de S/ 400 000 entraba como si fueran 400 000 dólares.
--
--  LA DEFINICIÓN QUE SE ADOPTA
--    tipo_cambio = SOLES POR DÓLAR (PEN/USD)
--
--  Siempre. Da igual en qué moneda esté el documento. Es la cotización del día
--  en que se pactó, y es la misma convención que usa SUNAT.
--
--    · Documento en USD → importe × tipo_cambio = su equivalente en soles.
--    · Documento en PEN → importe ÷ tipo_cambio = su equivalente en dólares.
--
--  Un documento en soles con tipo_cambio = 1 es imposible bajo esa definición,
--  así que se corrige el dato viejo y se pone un candado para que no vuelva.
--
--  LA REGLA DE PRESENTACIÓN
--  El cliente pidió ver todo en dólares, y tiene razón para lo que se suma y
--  se compara. Pero un documento concreto —una factura, una proforma— tiene
--  que mostrarse en SU moneda: eso es un hecho legal, no una preferencia. De
--  ahí la convención de nombres que se estrena aquí:
--
--    · columna_usd  → convertida a dólares. Se puede sumar entre documentos.
--    · columna      → en la moneda del documento. Viaja siempre junto a
--                     `moneda` y se usa para mostrar ese documento.
-- ============================================================================


-- ============================================================================
--  1. QUÉ SIGNIFICA EL CAMPO
--  Escrito en la propia base, que es donde lo va a leer quien mantenga esto
--  dentro de dos años.
-- ============================================================================
comment on column cotizaciones.tipo_cambio is
  'Soles por dólar (PEN/USD) del día en que se pactó. Siempre esta unidad, sea cual sea la moneda del documento.';
comment on column pedidos.tipo_cambio is
  'Soles por dólar (PEN/USD) del día en que se pactó. Siempre esta unidad, sea cual sea la moneda del documento.';
comment on column facturas.tipo_cambio is
  'Soles por dólar (PEN/USD) de la fecha de emisión. Siempre esta unidad, sea cual sea la moneda del documento.';


-- ============================================================================
--  2. CORRECCIÓN DEL DATO EXISTENTE
--  Todo lo que tenga un valor que no puede ser una cotización del dólar pasa a
--  tomar el referencial de Configuración. No hay histórico real de tipos de
--  cambio en el sistema, así que el referencial es lo más honesto que se puede
--  poner; el día que se cargue una tabla de cotizaciones por fecha, se refina.
-- ============================================================================
do $$
declare
  v_tc numeric;
  v_cot int; v_ped int; v_fac int;
begin
  select coalesce(nullif(valor, '')::numeric, 3.75) into v_tc
    from parametros where clave = 'tipo_cambio_referencial';
  if v_tc is null or v_tc < 1.5 then v_tc := 3.75; end if;

  update cotizaciones set tipo_cambio = v_tc where tipo_cambio < 1.5;
  get diagnostics v_cot = row_count;

  update pedidos set tipo_cambio = v_tc where tipo_cambio < 1.5;
  get diagnostics v_ped = row_count;

  update facturas set tipo_cambio = v_tc where tipo_cambio < 1.5;
  get diagnostics v_fac = row_count;

  raise notice 'Tipo de cambio normalizado a % — cotizaciones: %, pedidos: %, facturas: %',
    v_tc, v_cot, v_ped, v_fac;
end $$;


-- ============================================================================
--  3. EL CANDADO
--  El sol nunca ha estado ni cerca de la paridad con el dólar, así que 1,5 es
--  un suelo generoso y a la vez suficiente para atrapar el error real: el «1»
--  que se colaba por el valor por defecto. Se quita ese default, además,
--  porque un valor por defecto silencioso fue justamente el origen del
--  problema: obliga a que quien inserta diga qué cambio está usando.
-- ============================================================================
alter table cotizaciones alter column tipo_cambio drop default;
alter table pedidos      alter column tipo_cambio drop default;
alter table facturas     alter column tipo_cambio drop default;

alter table cotizaciones drop constraint if exists cotizaciones_tipo_cambio_check;
alter table pedidos      drop constraint if exists pedidos_tipo_cambio_check;
alter table facturas     drop constraint if exists facturas_tipo_cambio_check;

alter table cotizaciones add constraint cotizaciones_tipo_cambio_check
  check (tipo_cambio >= 1.5 and tipo_cambio <= 100);
alter table pedidos add constraint pedidos_tipo_cambio_check
  check (tipo_cambio >= 1.5 and tipo_cambio <= 100);
alter table facturas add constraint facturas_tipo_cambio_check
  check (tipo_cambio >= 1.5 and tipo_cambio <= 100);


-- ============================================================================
--  4. EL CONVERSOR, EN UN SOLO SITIO
--  Cada pantalla que convertía por su cuenta era una ocasión más de hacerlo
--  distinto. Esta función es la única definición, y la usan tanto las vistas
--  como —a través de su gemela en TypeScript— la aplicación.
-- ============================================================================
create or replace function a_dolares(
  p_importe     numeric,
  p_moneda      moneda,
  p_tipo_cambio numeric
) returns numeric
language sql immutable parallel safe as $$
  select case
    when p_importe is null then 0
    when p_moneda = 'USD'  then p_importe
    -- Si el tipo de cambio guardado no es creíble, no se inventa: se devuelve
    -- el importe sin convertir antes que multiplicar por un número falso. El
    -- candado de arriba hace que este caso ya no deba ocurrir.
    when coalesce(p_tipo_cambio, 0) >= 1.5 then p_importe / p_tipo_cambio
    else p_importe
  end;
$$;

comment on function a_dolares is
  'Lleva un importe a dólares. tipo_cambio se interpreta siempre como soles por dólar.';


-- ============================================================================
--  5. INDICADORES COMERCIALES · ahora todo en dólares
--  Estas columnas SIEMPRE se rotularon US$ en el panel. Antes eso era falso
--  porque se sumaban soles con dólares; ahora es cierto.
-- ============================================================================
create or replace view v_kpi_ventas as
with
valor_pedidos as (
  select
    p.id, p.ciclo, p.cobertura, p.situacion, p.moneda, p.fecha_solicitada,
    p.fecha_comprometida, p.cliente_id, p.prioridad,
    -- La conversión se hace por pedido y ANTES de sumar: cada uno tiene su
    -- propio tipo de cambio, el del día en que se pactó.
    a_dolares(
      sum(pl.cantidad_tm * pl.precio_tm * (1 - pl.descuento_pct / 100)),
      p.moneda, p.tipo_cambio
    ) as venta,
    -- El costo ya está en dólares: se carga en dólares al registrar el ingreso
    -- a cámara, así que no se toca.
    sum(pl.cantidad_tm * pl.costo_estimado_tm) as costo,
    sum(pl.cantidad_tm)                        as tm
  from pedidos p
  join pedido_lineas pl on pl.pedido_id = p.id
  group by p.id
)
select
  coalesce(sum(case when ciclo = 'confirmado' then venta else 0 end), 0)        as venta_comprometida,
  coalesce(sum(case when ciclo in ('despachado','cerrado')
                     and fecha_solicitada >= date_trunc('month', current_date)
                    then venta else 0 end), 0)                                  as venta_mes,
  coalesce(sum(case when ciclo in ('despachado','cerrado') then venta else 0 end), 0) as venta_acumulada,
  coalesce(sum(case when ciclo in ('confirmado','pendiente_validacion') then venta else 0 end), 0) as backlog,
  count(*) filter (where ciclo = 'confirmado'
                     and cobertura in ('pendiente_stock','parcialmente_disponible'))  as pedidos_en_riesgo,
  coalesce(sum(venta) filter (where ciclo = 'confirmado'
                     and cobertura in ('pendiente_stock','parcialmente_disponible')), 0) as venta_en_riesgo,
  count(*) filter (where ciclo = 'confirmado')                                   as pedidos_abiertos,
  count(*) filter (where situacion = 'bloqueado_credito')                        as pedidos_bloqueados,
  count(*) filter (where ciclo = 'confirmado' and fecha_comprometida < current_date) as pedidos_atrasados,
  count(*) filter (where prioridad = 'urgente' and ciclo not in ('cerrado','cancelado')) as pedidos_urgentes,
  case when coalesce(sum(venta), 0) > 0
       then (coalesce(sum(venta),0) - coalesce(sum(costo),0)) / coalesce(sum(venta),0) * 100
       else 0 end                                                                as margen_pct,
  coalesce(sum(tm) filter (where ciclo = 'confirmado'), 0)                       as tm_comprometidas
from valor_pedidos;

comment on view v_kpi_ventas is
  'Indicadores comerciales. TODOS los importes van en dólares: se convierte cada pedido con su propio tipo de cambio antes de sumar.';


-- ============================================================================
--  6. CUENTAS POR COBRAR
--  Aquí conviven las dos cosas a propósito: el saldo en la moneda de la
--  factura, porque es lo que el cliente debe y lo que dice el documento, y el
--  saldo en dólares, que es lo único que se puede sumar en un total de cartera.
-- ============================================================================
create or replace view v_cuentas_cobrar as
select
  f.id, f.numero, f.cliente_id, c.razon_social as cliente, c.pais,
  f.moneda, f.total, f.fecha_emision, f.fecha_vencimiento, f.estado,
  coalesce((select sum(monto) from cobranzas cb where cb.factura_id = f.id), 0) as cobrado,
  f.total - coalesce((select sum(monto) from cobranzas cb where cb.factura_id = f.id), 0) as saldo,
  (current_date - f.fecha_vencimiento)                                          as dias_vencida,
  case
    when f.estado = 'cobrada' then 'Al día'
    when f.fecha_vencimiento >= current_date then 'Vigente'
    when current_date - f.fecha_vencimiento <= 30 then '1 a 30 días'
    when current_date - f.fecha_vencimiento <= 60 then '31 a 60 días'
    when current_date - f.fecha_vencimiento <= 90 then '61 a 90 días'
    else 'Más de 90 días'
  end                                                                           as tramo_antiguedad,
  -- --- Los mismos importes, en dólares, para poder totalizar la cartera ---
  f.tipo_cambio,
  a_dolares(f.total, f.moneda, f.tipo_cambio)                                   as total_usd,
  a_dolares(
    coalesce((select sum(monto) from cobranzas cb where cb.factura_id = f.id), 0),
    f.moneda, f.tipo_cambio)                                                    as cobrado_usd,
  a_dolares(
    f.total - coalesce((select sum(monto) from cobranzas cb where cb.factura_id = f.id), 0),
    f.moneda, f.tipo_cambio)                                                    as saldo_usd
from facturas f
join clientes c on c.id = f.cliente_id
where f.estado <> 'anulada';

comment on view v_cuentas_cobrar is
  'Saldos pendientes. `total`, `cobrado` y `saldo` van en la moneda de la factura; las columnas _usd son las mismas cifras en dólares y son las únicas que se pueden sumar.';


-- ============================================================================
--  7. RENTABILIDAD POR PEDIDO
--  Esta vista estaba internamente rota, y de una manera que no se veía: la
--  venta salía en la moneda del pedido y el costo real en dólares, así que el
--  margen de un pedido en soles restaba peras de manzanas. Ahora las dos
--  patas de la resta están en la misma moneda.
-- ============================================================================
create or replace view v_rentabilidad_pedido as
select
  p.id                     as pedido_id,
  p.numero_proforma,
  p.cliente_id,
  c.razon_social           as cliente,
  p.vendedor_id,
  vd.nombre                as vendedor,
  p.moneda,
  p.ciclo,
  p.fecha_solicitada,
  sum(pl.cantidad_tm)                                                   as tm,
  -- Venta en DÓLARES: es lo que permite compararla con el costo.
  a_dolares(sum(pl.cantidad_tm * pl.precio_tm * (1 - pl.descuento_pct / 100)),
            p.moneda, p.tipo_cambio)                                    as venta,
  sum(pl.cantidad_tm * pl.costo_estimado_tm)                            as costo_estimado,
  coalesce((
    select sum(pkl.peso_neto_kg / 1000 * e.costo_promedio * 1000)
      from packing_lineas pkl
      join packing_lists pk on pk.id = pkl.packing_list_id
      join embarque_pedidos ep on ep.embarque_id = pk.embarque_id
      join existencias e on e.lote_id = pkl.lote_id
     where ep.pedido_id = p.id
  ), 0)                                                                 as costo_real,
  a_dolares(sum(pl.cantidad_tm * pl.precio_tm * (1 - pl.descuento_pct / 100)),
            p.moneda, p.tipo_cambio)
    - sum(pl.cantidad_tm * pl.costo_estimado_tm)                        as margen,
  case when a_dolares(sum(pl.cantidad_tm * pl.precio_tm * (1 - pl.descuento_pct / 100)),
                      p.moneda, p.tipo_cambio) > 0
       then (a_dolares(sum(pl.cantidad_tm * pl.precio_tm * (1 - pl.descuento_pct / 100)),
                       p.moneda, p.tipo_cambio)
             - sum(pl.cantidad_tm * pl.costo_estimado_tm))
            / a_dolares(sum(pl.cantidad_tm * pl.precio_tm * (1 - pl.descuento_pct / 100)),
                        p.moneda, p.tipo_cambio) * 100
       else 0 end                                                       as margen_pct,
  -- El importe tal como figura en la proforma, por si hay que conciliarlo.
  sum(pl.cantidad_tm * pl.precio_tm * (1 - pl.descuento_pct / 100))     as venta_documento,
  p.tipo_cambio
from pedidos p
join pedido_lineas pl on pl.pedido_id = p.id
join clientes c on c.id = p.cliente_id
left join vendedores vd on vd.id = p.vendedor_id
group by p.id, p.numero_proforma, p.cliente_id, c.razon_social,
         p.vendedor_id, vd.nombre, p.moneda, p.tipo_cambio, p.ciclo, p.fecha_solicitada;

comment on view v_rentabilidad_pedido is
  'Venta contra costo. `venta`, `costo_estimado`, `costo_real` y `margen` van TODOS en dólares; `venta_documento` es el importe en la moneda de la proforma.';


-- ============================================================================
--  8. PEDIDOS CON SU SEMÁFORO
--  Se conserva `venta` en la moneda del pedido —la ficha tiene que poder
--  mostrar lo que dice la proforma— y se añade `venta_usd`, que es lo que usan
--  las listas y los totales.
-- ============================================================================
create or replace view v_pedidos_tablero as
select
  p.id, p.numero_proforma, p.cliente_id, c.razon_social as cliente, c.pais,
  p.vendedor_id, p.moneda, p.tipo_cambio, p.incoterm, p.prioridad,
  p.fecha_solicitada, p.fecha_comprometida,
  p.ciclo, p.cobertura, p.situacion,
  d.puerto as destino, d.pais as destino_pais,
  coalesce(t.tm, 0)      as tm_pedidas,
  coalesce(t.venta, 0)   as venta,
  coalesce(r.reservado_kg, 0) / 1000    as tm_reservadas,
  coalesce(r.consumido_kg, 0) / 1000    as tm_despachadas,
  case when coalesce(t.tm,0) > 0
       then least(100, (coalesce(r.reservado_kg,0) + coalesce(r.consumido_kg,0)) / 10 / coalesce(t.tm,1))
       else 0 end        as avance_pct,
  greatest(coalesce(t.tm,0) - (coalesce(r.reservado_kg,0) + coalesce(r.consumido_kg,0)) / 1000, 0) as tm_faltantes,
  (p.fecha_comprometida < current_date and p.ciclo = 'confirmado') as atrasado,
  c.bloqueado                                                     as cliente_bloqueado,
  case
    when p.ciclo in ('despachado','cerrado')                            then 'despachado'
    when c.bloqueado or p.situacion = 'bloqueado_credito'               then 'bloqueado'
    when p.fecha_comprometida < current_date and p.ciclo = 'confirmado' then 'riesgo'
    when p.cobertura in ('reservado','preparado','en_preparacion','programado','completo') then 'completo'
    else 'parcial'
  end as semaforo,
  -- La misma venta, en dólares: es la que se puede comparar y sumar.
  a_dolares(coalesce(t.venta, 0), p.moneda, p.tipo_cambio)        as venta_usd
from pedidos p
join clientes c on c.id = p.cliente_id
left join destinos d on d.id = p.destino_id
left join lateral (
  select sum(pl.cantidad_tm) as tm,
         sum(pl.cantidad_tm * pl.precio_tm * (1 - pl.descuento_pct/100)) as venta
    from pedido_lineas pl where pl.pedido_id = p.id
) t on true
left join lateral (
  select sum(case when rv.estado in ('activa','en_preparacion') then rv.peso_neto_kg else 0 end) as reservado_kg,
         sum(case when rv.estado = 'consumida' then rv.peso_neto_kg else 0 end) as consumido_kg
    from reservas rv
    join pedido_lineas pl2 on pl2.id = rv.pedido_linea_id
   where pl2.pedido_id = p.id
) r on true;

comment on view v_pedidos_tablero is
  'Pedidos con su semáforo. `venta` va en la moneda de la proforma —para mostrar el documento— y `venta_usd` en dólares, que es la que se suma y se compara.';
