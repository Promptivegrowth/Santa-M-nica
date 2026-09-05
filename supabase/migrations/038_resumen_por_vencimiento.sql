-- ============================================================================
--  038 · EL RESUMEN POR VENCIMIENTO, CONTADO EN LA BASE
-- ============================================================================
--  EL FALLO QUE LO PROVOCA
--  Las tarjetas de anticuamiento decían «26 pallets vencidos» cuando en la base
--  hay 47. La pantalla se traía las filas y las contaba en memoria, y la API de
--  Supabase devuelve como mucho MIL FILAS por consulta cuando no se pide otra
--  cosa. Con 1 519 lotes en cámara, el corte se comía un tercio del inventario
--  sin decir nada.
--
--  Es un error silencioso de los peores: la cifra sale, parece razonable y
--  nadie la contrasta. Subir el límite lo taparía hasta que el almacén crezca.
--  Lo que no falla es contar donde están los datos.
-- ============================================================================
create or replace view v_anticuamiento_situacion as
select
  situacion_vida_util           as situacion,
  count(*)                      as lotes,
  coalesce(sum(fisico_kg), 0)   as fisico_kg,
  coalesce(sum(disponible_kg), 0) as disponible_kg,
  coalesce(sum(valor), 0)       as valor,
  min(dias_para_vencer)         as dias_min,
  max(dias_para_vencer)         as dias_max
from v_anticuamiento
where fisico_kg > 0
group by situacion_vida_util;

comment on view v_anticuamiento_situacion is
  'Cuántos pallets, cuántos kilos y cuánto valor hay vencidos, por vencer y vigentes. Existe para que las pantallas no cuenten filas en memoria: la API corta en mil por consulta y el conteo salía corto sin avisar.';
