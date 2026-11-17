-- ============================================================================
--  091 · PORTAL: «reclamos pendientes» de un contenedor, solo de ESTA proforma
-- ============================================================================
--  En un contenedor consolidado (un packing list con pedidos de varios
--  clientes), privado.datos_portal contaba los reclamos abiertos de todo el
--  contenedor: un cliente veía en su portal un número que incluía los
--  reclamos de otro. Ahora cuenta solo los de la proforma consultada.
--
--  Se reescribe solo esa condición sobre la definición vigente de la función
--  (la de 090), sin copiarla entera. Re-ejecutable: si ya está corregida, no
--  hace nada.
-- ============================================================================
do $$
declare
  v_def text := pg_get_functiondef('privado.datos_portal(bigint,text)'::regprocedure);
  v_antes text := 'where r.packing_list_id = vc.packing_list_id and r.estado <> ''cerrado''';
  v_despues text := 'where r.packing_list_id = vc.packing_list_id and r.pedido_id = p.id and r.estado <> ''cerrado''';
begin
  if position(v_despues in v_def) > 0 then
    raise notice '091: privado.datos_portal ya cuenta los reclamos por proforma.';
  elsif position(v_antes in v_def) = 0 then
    raise exception '091: no se encontró la condición a corregir en privado.datos_portal; revise la función a mano.';
  else
    execute replace(v_def, v_antes, v_despues);
    raise notice '091: privado.datos_portal corregida.';
  end if;
end $$;

revoke all on function privado.datos_portal(bigint, text) from public, anon, authenticated;
