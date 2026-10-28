-- ============================================================================
--  078 · DETALLES QUE ENCONTRARON LOS REDACTORES DEL MANUAL
-- ============================================================================
--  Re-ejecutable: solo `update` con valor fijo y `create or replace`.
--
--   1. NOMBRES DE PERSONAS EN TEXTOS QUE VE EL USUARIO. Varias descripciones de
--      Configuración › Parámetros y la de la regla «Producto con anticuamiento»
--      decían «Hoy Oliver lo controla…», «Lo pidió Oliver así…», «el Excel de
--      Oliver». El manual se lee en toda la empresa y las personas cambian de
--      puesto: se dice el rol o el hecho, no quién. (Los nombres de los
--      usuarios, el firmante de los contratos y la bitácora de quién hizo qué
--      SÍ son datos y no se tocan.)
--
--   2. AUDITORÍA SIN «CAMBIOS» QUE NO CAMBIAN NADA. Un pedido aparecía tres
--      veces en el mismo minuto («Fecha de actualización»), una a nombre de
--      «Mantenimiento técnico». Investigado (pedido 5, SM26-105, 27/10 18:07):
--      la columna «origen» (077) estaba bien puesta. Eran dos pruebas
--      automáticas: el usuario demo gerencia@ apartó stock desde el navegador
--      (dos filas «usuario») y la limpieza de la prueba, por la API de
--      administración, lo deshizo (la fila «mantenimiento»). En las tres lo
--      único que cambió fue `actualizado_en`: los disparadores de reservas
--      «tocan» el pedido para recalcular su cobertura. Esas filas no dicen
--      nada a quien audita (el cambio de verdad está en la reserva), así que el
--      disparador ya no las escribe. Las 547 que ya existían no se borran (la
--      auditoría no se borra): la pantalla Auditoría las deja fuera.
-- ============================================================================


-- ============================================================================
--  1. TEXTOS SIN NOMBRES DE PERSONAS
-- ============================================================================
update parametros set descripcion =
  'Tope de almacenes despachando a la vez. Se fijó en 4 porque es el límite práctico de la operación.'
 where clave = 'despachos_simultaneos_max';

update parametros set descripcion =
  'Tipo de cambio fijo con el que Objetivos mensuales pasa soles a dólares (costo total de manipulación). Es fijo a propósito y se cambia aquí, como en la hoja de cálculo que se usaba antes.'
 where clave = 'objetivos_tipo_cambio';

update parametros set descripcion =
  'Primer mes (AAAA-MM) en que los indicadores de Objetivos salen del sistema. Los meses anteriores son el histórico cargado desde la hoja de cálculo que se usaba antes.'
 where clave = 'objetivos_erp_desde';

update parametros set descripcion =
  'Días de plazo de la prioridad alta: se fijó entre urgente y normal.'
 where clave = 'plazo_dias_alta';

update parametros set descripcion =
  'Proyección lineal = real ÷ este número × días del mes. Es un valor fijo por decisión de la empresa.'
 where clave = 'cierre_dias_proyeccion';

update parametros set descripcion =
  'Días de proceso que se consideran por mes en la proyección lineal (la empresa considera 26).'
 where clave = 'cierre_dias_mes';

update parametros set descripcion =
  'si / no. Se ocultó temporalmente a pedido de la empresa (octubre 2026). Los datos se conservan.'
 where clave = 'modulo_objetivos_activo';

update parametros set descripcion =
  'A partir de cuántos meses en cámara el sistema empieza a avisar. Es el umbral de la regla «Producto con anticuamiento». Antes se controlaba a mano a los 12 meses.'
 where clave = 'anticuamiento_alerta_meses';

update reglas set descripcion =
  'Avisa cuando un lote lleva en cámara los meses del parámetro «Alerta de anticuamiento». Antes se controlaba a mano.'
 where nombre = 'Producto con anticuamiento'
   and descripcion ~ '\mOliver\M';


-- ============================================================================
--  2. LA AUDITORÍA NO ANOTA LOS «TOQUES» DE LA FECHA DE ACTUALIZACIÓN
-- ============================================================================
--  Igual que la versión anterior (mismas columnas; `origen` sigue saliendo de
--  su valor por defecto, origen_actual()), con una condición más: si TODO lo
--  que cambió son campos que se mueven solos al guardar (los mismos de
--  CAMPOS_SIN_INTERES en src/lib/etiquetas.ts), no se escribe la fila.
create or replace function auditar_cambios()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_antes jsonb;
  v_despues jsonb;
  v_id text;
  v_campos text[];
begin
  if tg_op = 'DELETE' then
    v_antes := to_jsonb(old); v_despues := null; v_id := (to_jsonb(old)->>'id');
  elsif tg_op = 'INSERT' then
    v_antes := null; v_despues := to_jsonb(new); v_id := (to_jsonb(new)->>'id');
  else
    v_antes := to_jsonb(old); v_despues := to_jsonb(new); v_id := (to_jsonb(new)->>'id');
    -- Detecta qué columnas cambiaron realmente
    select array_agg(key) into v_campos
      from jsonb_each(v_despues)
     where v_antes -> key is distinct from v_despues -> key;
    -- Si nada cambió, no ensuciamos la auditoría
    if v_campos is null then return new; end if;
    -- 078: tampoco si lo único que cambió es la fecha (o el autor) de la
    -- última actualización: es un «toque» de otro disparador, no un cambio.
    if v_campos <@ array['actualizado_en', 'actualizado_por']::text[] then return new; end if;
  end if;

  insert into auditoria (tabla, registro_id, accion, datos_antes, datos_despues, campos_cambiados, usuario_id)
  values (tg_table_name, coalesce(v_id,'?'), tg_op, v_antes, v_despues, v_campos, auth.uid());

  return coalesce(new, old);
end;
$$;
