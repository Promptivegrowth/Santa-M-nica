-- ============================================================================
--  MIGRACIÓN 011 · RESUMEN DE ANTICUAMIENTO
-- ============================================================================
--  Problema detectado al verificar el panel: la vista v_anticuamiento devuelve
--  una fila por lote (más de mil), y la API corta la respuesta en 1.000 filas
--  por defecto. Si el panel sumaba esas filas, el total salía incompleto.
--
--  Solución: que la suma la haga la base de datos y devuelva cuatro filas.
--  Además de ser correcto, es mucho más rápido.
-- ============================================================================
create or replace view v_anticuamiento_resumen as
select
  rango,
  case rango
    when '<12'   then 1
    when '12-18' then 2
    when '18-24' then 3
    else 4
  end                                   as orden,
  count(*)                              as lotes,
  sum(fisico_kg)                        as fisico_kg,
  sum(disponible_kg)                    as disponible_kg,
  sum(valor)                            as valor,
  count(*) filter (where vencido)       as lotes_vencidos
from v_anticuamiento
where fisico_kg > 0
group by rango;

comment on view v_anticuamiento_resumen is
  'Antigüedad del stock agregada en los cuatro rangos. Evita traer miles de filas al navegador.';
