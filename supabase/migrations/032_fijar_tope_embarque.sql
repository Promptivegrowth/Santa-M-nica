-- ============================================================================
--  032 · QUE COMERCIAL PUEDA ESCRIBIR EL TOPE, Y SOLO EL TOPE
-- ============================================================================
--  EL FALLO QUE LO DESTAPÓ
--  La pantalla decía «Topes de EMB-2026-0187 guardados» y en la base no había
--  cambiado nada. La política de escritura de `embarques` admite gerencia,
--  operaciones, comex y almacén —no comercial—, así que el UPDATE no daba
--  error: simplemente afectaba a CERO filas. Un rechazo silencioso es peor que
--  un error, porque el usuario se va convencido de que lo guardó.
--
--  POR QUÉ UNA FUNCIÓN Y NO AMPLIAR LA POLÍTICA
--  Las políticas de PostgreSQL son por FILA, no por columna. Añadir comercial
--  a `escritura_logistica` le daría también la fecha de salida, la bodega, el
--  destino y el estado del embarque — cosas que no le corresponden y que
--  romperían la operación si se tocaran por error.
--
--  Esta función escribe exactamente tres columnas y nada más. Es el mismo
--  patrón que ya usan `ejecutar_despacho` o `reserva_crear`: la operación se
--  autoriza por lo que HACE, no por la tabla que toca.
-- ============================================================================
create or replace function fijar_tope_embarque(
  p_embarque_id  bigint,
  p_neto_kg      numeric,
  p_bruto_kg     numeric,
  p_nota         text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado estado_embarque;
  v_numero text;
begin
  -- Quién puede. Comercial entra porque el dato es suyo: lo conoce por el
  -- destino del cliente. Almacén no: lo consume, no lo decide.
  if not puede(variadic array['gerencia','operaciones','comercial','comex']::rol_usuario[]) then
    raise exception 'Su rol no puede fijar los topes de un embarque';
  end if;

  select estado, numero into v_estado, v_numero from embarques where id = p_embarque_id;
  if v_numero is null then
    raise exception 'Ese embarque no existe';
  end if;
  if v_estado = 'despachado' then
    raise exception '% ya salió: fijarle un tope ahora no cambiaría lo que se cargó', v_numero;
  end if;

  -- Cero o negativo no es «sin tope»: es un dato mal escrito que bloquearía
  -- cualquier carga. El vacío sí significa «hereda el del destino».
  if p_neto_kg is not null and p_neto_kg <= 0 then
    raise exception 'El peso neto máximo tiene que ser mayor que cero';
  end if;
  if p_bruto_kg is not null and p_bruto_kg <= 0 then
    raise exception 'El peso bruto máximo tiene que ser mayor que cero';
  end if;
  if p_neto_kg is not null and p_bruto_kg is not null and p_bruto_kg < p_neto_kg then
    raise exception 'El peso bruto no puede ser menor que el neto: el bruto incluye el empaque';
  end if;

  update embarques
     set peso_neto_max_kg  = p_neto_kg,
         peso_bruto_max_kg = p_bruto_kg,
         nota_comercial    = nullif(btrim(coalesce(p_nota, '')), ''),
         nota_comercial_por = case
           when p_neto_kg is null and p_bruto_kg is null
                and nullif(btrim(coalesce(p_nota, '')), '') is null then null
           else auth.uid()
         end,
         nota_comercial_en = case
           when p_neto_kg is null and p_bruto_kg is null
                and nullif(btrim(coalesce(p_nota, '')), '') is null then null
           else now()
         end
   where id = p_embarque_id;
end $$;

comment on function fijar_tope_embarque is
  'Escribe el tope de peso y la nota de Comercial de un embarque, y nada más. Existe porque las políticas de fila no pueden limitar POR COLUMNA: ampliar la política le habría dado a Comercial también la fecha, la bodega y el destino.';

revoke all on function fijar_tope_embarque(bigint, numeric, numeric, text) from public;
grant execute on function fijar_tope_embarque(bigint, numeric, numeric, text) to authenticated;
