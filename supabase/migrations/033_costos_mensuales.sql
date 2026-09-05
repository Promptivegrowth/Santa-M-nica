-- ============================================================================
--  033 · LOS TRES COSTOS Y EL MARGEN DE CONTRIBUCIÓN
-- ============================================================================
--  Lo pidió Oliver, y es el cambio más de fondo del acta:
--
--    «Lo que queríamos hallar era el margen de contribución. No la utilidad,
--     sino el margen de contribución: costo de venta menos tu costo total de
--     producción. Mi costo total de producción incluye mi precio de materia
--     prima, mi costo de conversión —que básicamente es la mano de obra— y
--     otro costo variable. Son tres. A llenar al inicio de mes. Ese lo tendría
--     que ingresar Marco, que tiene todos los datos.»
--
--  QUÉ CAMBIA RESPECTO A LO QUE HABÍA
--  El sistema ya guardaba UN costo: `lotes.costo_unitario`, tecleado a mano al
--  registrar el ingreso de cada pallet. Servía para valorizar el inventario,
--  pero no permite ver de qué se compone el costo ni, por tanto, calcular un
--  margen de contribución.
--
--  Esto no lo sustituye: convive con él. El costo del lote sigue valorizando
--  lo que hay en cámara —es lo que costó ESE pallet— y el costo mensual es el
--  estándar del producto, que es contra el que se mide el margen.
--
--  POR QUÉ POR MES Y POR PRODUCTO, Y NO POR LOTE
--  Porque así es como la empresa lo conoce. La materia prima se compra a un
--  precio de campaña, la mano de obra se calcula por planilla del mes y el
--  variable se prorratea. Pedir esos tres datos pallet por pallet sería pedir
--  algo que nadie tiene.
--
--  POR QUÉ SE GUARDA POR KILO
--  Para no mezclar unidades con `lotes.costo_unitario`, que ya está en dólares
--  por kilo. Los precios de venta van por tonelada y la conversión se hace al
--  compararlos, en un solo sitio.
-- ============================================================================


-- ============================================================================
--  1. LA TABLA
-- ============================================================================
create table if not exists costos_mensuales (
  id                bigserial primary key,
  sku_id            bigint not null references skus(id) on delete cascade,
  anio              int not null check (anio between 2000 and 2100),
  mes               int not null check (mes between 1 and 12),

  /* Los tres que pidió, en dólares por kilo. */
  materia_prima_kg  numeric(14,4) not null default 0 check (materia_prima_kg >= 0),
  conversion_kg     numeric(14,4) not null default 0 check (conversion_kg >= 0),
  variable_kg       numeric(14,4) not null default 0 check (variable_kg >= 0),

  /*
   * El costo total no se guarda: se calcula. Una columna generada no puede
   * quedar desincronizada de sus sumandos, que es lo que pasa tarde o temprano
   * cuando alguien actualiza uno de los tres y se olvida del total.
   */
  total_kg          numeric(14,4)
                    generated always as (materia_prima_kg + conversion_kg + variable_kg) stored,

  observaciones     text,
  registrado_por    uuid not null references usuarios(id),
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),

  unique (sku_id, anio, mes)
);

comment on table costos_mensuales is
  'Los tres componentes del costo de producción de cada producto, por mes: materia prima, conversión (mano de obra) y variable. Los carga Gerencia al inicio de mes. Es el estándar contra el que se mide el margen de contribución, distinto del costo de cada lote, que valoriza el inventario.';

comment on column costos_mensuales.materia_prima_kg is 'Lo que costó el kilo de pota comprada, en dólares.';
comment on column costos_mensuales.conversion_kg is 'Mano de obra y proceso, en dólares por kilo.';
comment on column costos_mensuales.variable_kg is 'El resto de costos variables prorrateados, en dólares por kilo.';
comment on column costos_mensuales.total_kg is 'Costo total de producción por kilo. Se calcula solo: no puede desincronizarse de sus tres partes.';

create index if not exists idx_costos_sku_periodo on costos_mensuales(sku_id, anio desc, mes desc);


-- ============================================================================
--  2. EL COSTO QUE RIGE EN UNA FECHA
--  Se busca el último período CARGADO que no sea posterior a la fecha. Si en
--  marzo nadie cargó los costos, un pedido de marzo se mide con los de
--  febrero: es lo que haría cualquiera a mano, y es mejor que devolver cero,
--  que daría un margen del 100 % y nadie lo notaría.
-- ============================================================================
create or replace function costo_produccion_kg(p_sku_id bigint, p_fecha date)
returns numeric
language sql stable parallel safe as $$
  select c.total_kg
    from costos_mensuales c
   where c.sku_id = p_sku_id
     and make_date(c.anio, c.mes, 1) <= date_trunc('month', p_fecha)::date
   order by c.anio desc, c.mes desc
   limit 1;
$$;

comment on function costo_produccion_kg is
  'Costo total de producción por kilo vigente para un producto en una fecha: el último período cargado que no sea posterior. Devuelve NULL si nunca se cargó ninguno — y NULL es la respuesta correcta, porque un cero daría un margen del 100 %.';


-- ============================================================================
--  3. EL MARGEN DE CONTRIBUCIÓN, LÍNEA POR LÍNEA
--
--  margen = precio de venta − costo total de producción
--
--  Todo en dólares por tonelada. El costo se guarda por kilo, así que se
--  multiplica aquí: en un solo sitio y a la vista, no repartido por las
--  pantallas.
-- ============================================================================
create or replace view v_margen_contribucion as
select
  pl.id                          as pedido_linea_id,
  p.id                           as pedido_id,
  p.numero_proforma,
  p.cliente_id,
  cl.razon_social                as cliente,
  p.fecha_solicitada,
  p.ciclo,
  s.id                           as sku_id,
  s.codigo                       as sku,
  s.corte,
  s.clasificacion_comercial      as familia,
  pl.cantidad_tm,

  -- Lo que se vende, en dólares por tonelada y ya sin el descuento.
  a_dolares(pl.precio_tm * (1 - pl.descuento_pct / 100), p.moneda, p.tipo_cambio) as precio_tm,

  /* Los tres componentes, llevados a tonelada. */
  cm.materia_prima_kg * 1000     as materia_prima_tm,
  cm.conversion_kg    * 1000     as conversion_tm,
  cm.variable_kg      * 1000     as variable_tm,
  cm.total_kg         * 1000     as costo_produccion_tm,
  cm.anio                        as costo_anio,
  cm.mes                         as costo_mes,

  -- El margen unitario y el de la línea entera.
  a_dolares(pl.precio_tm * (1 - pl.descuento_pct / 100), p.moneda, p.tipo_cambio)
    - cm.total_kg * 1000         as margen_tm,

  (a_dolares(pl.precio_tm * (1 - pl.descuento_pct / 100), p.moneda, p.tipo_cambio)
    - cm.total_kg * 1000) * pl.cantidad_tm as margen_linea,

  case
    when a_dolares(pl.precio_tm * (1 - pl.descuento_pct / 100), p.moneda, p.tipo_cambio) > 0
     and cm.total_kg is not null
    then round(
      100 * (a_dolares(pl.precio_tm * (1 - pl.descuento_pct / 100), p.moneda, p.tipo_cambio)
             - cm.total_kg * 1000)
      / a_dolares(pl.precio_tm * (1 - pl.descuento_pct / 100), p.moneda, p.tipo_cambio), 2)
    else null
  end                            as margen_pct,

  -- Sin costo cargado no hay margen que calcular, y decirlo es parte del dato.
  (cm.total_kg is null)          as sin_costo
from pedido_lineas pl
join pedidos p  on p.id = pl.pedido_id
join clientes cl on cl.id = p.cliente_id
join sku_presentaciones sp on sp.id = pl.sku_presentacion_id
join skus s on s.id = sp.sku_id
left join lateral (
  select c.total_kg, c.materia_prima_kg, c.conversion_kg, c.variable_kg, c.anio, c.mes
    from costos_mensuales c
   where c.sku_id = s.id
     and make_date(c.anio, c.mes, 1) <= date_trunc('month', p.fecha_solicitada)::date
   order by c.anio desc, c.mes desc
   limit 1
) cm on true;

comment on view v_margen_contribucion is
  'Margen de contribución por línea de pedido: precio de venta menos costo total de producción, ambos en dólares por tonelada. `sin_costo` marca las líneas cuyo producto no tiene costos cargados para ese mes: no se puede calcular su margen y hay que decirlo, no rellenarlo con cero.';
