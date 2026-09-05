-- ============================================================================
--  031 · CUÁNTO PUEDE IR EN EL CONTENEDOR, Y QUIÉN LO DICE
-- ============================================================================
--  De la reunión con Oliver, y es de las cosas más concretas que pidió:
--
--    «Nosotros dependemos mucho de un correo que a veces lo envían a última
--     hora en el que nos ponen el peso neto o el peso bruto total que puede ir
--     en el contenedor. Y a veces tenemos el contenedor ya cargando y todavía
--     no confirman. [...] Para Tailandia no se puede cargar más de 26
--     toneladas. Para toda Europa ya no se puede cargar bultos de más de 30
--     kilos, porque la ley dice que la persona no puede cargar más de eso.»
--
--  El dato existe —Comercial lo conoce por el destino de la proforma— pero
--  viajaba por correo y llegaba tarde, con el contenedor ya cargándose.
--
--  DOS NIVELES, Y ESO ES LO QUE LO HACE ÚTIL
--
--  1 · EN EL DESTINO. «Tailandia: 26 TM» es una regla del mercado, no de un
--      embarque concreto. Se configura una vez y vale para todos los que van
--      allí. Es la diferencia entre una nota que hay que reescribir cada vez y
--      un dato que el sistema ya sabe.
--
--  2 · EN EL EMBARQUE. Lo que Comercial confirme para ESA salida manda sobre
--      el valor del destino. Oliver avisó de que estas reglas son «muy
--      cambiantes», así que siempre tiene que poder decirse a mano.
--
--  Y CON ESO SE PUEDE AVISAR
--  Capturar el tope solo sirve si alguien compara. Teniéndolo aquí, el
--  planificador puede decir «este contenedor va 1,4 TM por encima del tope de
--  Tailandia» mientras todavía se está cargando, que es justo el momento en
--  que Oliver dijo que se enteran tarde.
-- ============================================================================


-- ============================================================================
--  1. EL TOPE DEL DESTINO
-- ============================================================================
alter table destinos
  add column if not exists peso_neto_max_kg  numeric(12,2)
    check (peso_neto_max_kg is null or peso_neto_max_kg > 0),
  add column if not exists peso_bulto_max_kg numeric(10,3)
    check (peso_bulto_max_kg is null or peso_bulto_max_kg > 0),
  add column if not exists nota_restricciones text;

comment on column destinos.peso_neto_max_kg is
  'Máximo de producto que admite un contenedor a este destino. Tailandia, por ejemplo, no acepta más de 26 000 kg. Nulo = sin tope conocido.';
comment on column destinos.peso_bulto_max_kg is
  'Máximo por bulto que admite el destino. En Europa la ley laboral lo fija en 30 kg. Nulo = sin tope conocido.';
comment on column destinos.nota_restricciones is
  'Cualquier otra restricción del mercado que convenga tener delante al programar.';


-- ============================================================================
--  2. LO QUE COMERCIAL CONFIRMA PARA ESTE EMBARQUE
-- ============================================================================
alter table embarques
  add column if not exists peso_neto_max_kg  numeric(12,2)
    check (peso_neto_max_kg is null or peso_neto_max_kg > 0),
  add column if not exists peso_bruto_max_kg numeric(12,2)
    check (peso_bruto_max_kg is null or peso_bruto_max_kg > 0),
  add column if not exists nota_comercial    text,
  add column if not exists nota_comercial_por uuid references usuarios(id),
  add column if not exists nota_comercial_en  timestamptz;

comment on column embarques.peso_neto_max_kg is
  'Peso neto máximo confirmado por Comercial para esta salida. Manda sobre el tope del destino.';
comment on column embarques.peso_bruto_max_kg is
  'Peso bruto máximo confirmado por Comercial: producto más empaque. Es el que suele venir en el correo de la naviera.';
comment on column embarques.nota_comercial is
  'Lo que Comercial necesita que sepa Logística antes de cargar. Se pidió campo libre porque las restricciones cambian y no siempre se conocen de antemano.';


-- ============================================================================
--  3. TOPES DE EJEMPLO PARA LOS DESTINOS QUE MENCIONÓ
--  Solo los dos casos que dio, y solo donde el destino coincide. El resto se
--  llena desde Configuración a medida que se conozcan: inventar topes sería
--  peor que dejarlos vacíos, porque un tope falso bloquea una carga buena.
-- ============================================================================
update destinos set peso_neto_max_kg = 26000
 where pais ilike '%Tailandia%' and peso_neto_max_kg is null;

update destinos set peso_bulto_max_kg = 30
 where pais in ('España', 'Portugal', 'Francia', 'Italia', 'Alemania', 'Países Bajos', 'Bélgica', 'Grecia')
   and peso_bulto_max_kg is null;


-- ============================================================================
--  4. LA VISTA QUE USA EL PLANIFICADOR
--  Resuelve aquí la herencia destino → embarque para que ninguna pantalla
--  tenga que acordarse de cuál manda.
-- ============================================================================
create or replace view v_embarque_topes as
select
  e.id                                  as embarque_id,
  e.numero,
  e.fecha_programada,
  d.puerto                              as destino,
  d.pais,

  -- Lo que confirmó Comercial para esta salida, si lo confirmó.
  e.peso_neto_max_kg                    as tope_propio_neto_kg,
  e.peso_bruto_max_kg                   as tope_propio_bruto_kg,
  d.peso_neto_max_kg                    as tope_destino_neto_kg,
  d.peso_bulto_max_kg                   as tope_destino_bulto_kg,

  -- El que rige: manda el del embarque; si no hay, el del destino.
  coalesce(e.peso_neto_max_kg, d.peso_neto_max_kg)  as tope_neto_kg,
  -- De dónde salió, para que la pantalla lo pueda explicar.
  case
    when e.peso_neto_max_kg is not null then 'embarque'
    when d.peso_neto_max_kg is not null then 'destino'
    else null
  end                                   as origen_tope,

  e.nota_comercial,
  d.nota_restricciones,

  -- Lo que lleva cargado ahora mismo, sumando todos sus contenedores.
  coalesce(c.peso_kg, 0)                as cargado_kg,
  coalesce(c.bultos, 0)                 as cargado_bultos,

  /*
   * ¿Se pasó? Solo se responde cuando hay tope Y hay carga: sin una de las
   * dos, la pregunta no tiene sentido y devolver «false» haría creer que se
   * comprobó algo.
   */
  case
    when coalesce(e.peso_neto_max_kg, d.peso_neto_max_kg) is null then null
    when coalesce(c.peso_kg, 0) = 0 then null
    else coalesce(c.peso_kg, 0) > coalesce(e.peso_neto_max_kg, d.peso_neto_max_kg)
  end                                   as excede,

  coalesce(c.peso_kg, 0) - coalesce(e.peso_neto_max_kg, d.peso_neto_max_kg) as exceso_kg,

  /*
   * Qué porcentaje del tope se lleva ocupado, y si ya está cerca.
   *
   * Avisar solo cuando se ha pasado llega tarde: para entonces el contenedor
   * está cargado y hay que bajar pallets. A partir del 95 % todavía se puede
   * decidir qué no sube, que es cuando la advertencia sirve para algo.
   */
  case
    when coalesce(e.peso_neto_max_kg, d.peso_neto_max_kg) is null then null
    else round(100.0 * coalesce(c.peso_kg, 0)
               / coalesce(e.peso_neto_max_kg, d.peso_neto_max_kg), 1)
  end                                   as ocupacion_pct,

  case
    when coalesce(e.peso_neto_max_kg, d.peso_neto_max_kg) is null then null
    when coalesce(c.peso_kg, 0) = 0 then null
    else coalesce(c.peso_kg, 0) >= 0.95 * coalesce(e.peso_neto_max_kg, d.peso_neto_max_kg)
  end                                   as cerca_del_tope
from embarques e
left join destinos d on d.id = e.destino_id
left join lateral (
  select sum(pl.peso_neto_kg) as peso_kg, sum(pl.bultos) as bultos
    from packing_lists pk
    join packing_lineas pl on pl.packing_list_id = pk.id
   where pk.embarque_id = e.id and pk.estado <> 'anulado'
) c on true;

comment on view v_embarque_topes is
  'El tope de peso que rige para cada embarque —el suyo propio o, si no lo tiene, el de su destino— junto a lo que lleva cargado. `excede` es nulo cuando no hay tope o no hay carga: la pregunta solo se responde cuando se puede.';
