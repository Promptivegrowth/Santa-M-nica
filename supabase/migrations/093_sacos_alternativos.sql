-- ============================================================================
--  093 · SACOS ALTERNATIVOS EN LA PROFORMA (Comercial, 25/11)
-- ============================================================================
--  En sus palabras: «BAGS OF 20 KG también debería decir "BAGS OF 20 KG/28 KG":
--  eso le da la posibilidad de que cámara PT pueda despachar con una u otra
--  presentación, y también realizarlo 20 % de 20 kg y 80 % de 28 kg, cambiando
--  la cantidad de bultos».
--
--  La línea del pedido se vende en kilos y con una presentación (sacos de
--  20 kg). Esta columna dice qué otros pesos de saco acepta el cliente para
--  esa línea: la proforma y el contrato lo declaran («*BAGS OF 20 KG/28 KG»),
--  y Almacén despacha con lo que haya —la reserva por SKU equivalente (064)
--  ya permite apartar un pallet de otra presentación del mismo producto, y
--  como todo va en kilos, el número de sacos se acomoda solo—.
--
--  Se escribe con fijar_sacos_alternativos(): las políticas de pedido_lineas
--  limitan filas, no columnas, y Comercial no debe poder cambiar precio ni
--  cantidad por esta vía. Mismos roles que la restricción de peso (047).
--
--  Re-ejecutable.
-- ============================================================================

alter table pedido_lineas add column if not exists sacos_alternativos_kg numeric(6,2)[];

comment on column pedido_lineas.sacos_alternativos_kg is
  'Otros pesos de saco que el cliente acepta para esta línea (093). La proforma imprime «*BAGS OF 20 KG/28 KG».';

create or replace function fijar_sacos_alternativos(
  p_linea_id bigint,
  p_kg       numeric[]
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_rol    rol_usuario;
  v_ped    record;
  v_kg     numeric[];
  v_base   numeric;
begin
  select rol into v_rol from usuarios where id = auth.uid();
  if v_rol is null or v_rol not in ('gerencia', 'comercial', 'operaciones', 'comex') then
    raise exception 'Su rol no puede cambiar los sacos alternativos de un pedido.';
  end if;

  select p.id, p.numero_proforma, p.ciclo, pr.peso_bulto_kg into v_ped
    from pedido_lineas l
    join pedidos p on p.id = l.pedido_id
    join sku_presentaciones sp on sp.id = l.sku_presentacion_id
    join presentaciones pr on pr.id = sp.presentacion_id
   where l.id = p_linea_id;
  if not found then raise exception 'Esa línea de pedido ya no existe.'; end if;
  if v_ped.ciclo in ('despachado', 'cerrado', 'cancelado') then
    raise exception 'El pedido % ya está %: no se le cambian los sacos.', v_ped.numero_proforma, v_ped.ciclo;
  end if;
  v_base := v_ped.peso_bulto_kg;

  --  Sin repetidos, sin el peso que ya tiene la línea, de mayor a menor.
  select array_agg(k order by k desc) into v_kg
    from (select distinct round(x, 2) k from unnest(coalesce(p_kg, '{}')) x) s
   where k is distinct from round(v_base, 2);

  if exists (select 1 from unnest(coalesce(v_kg, '{}')) k where k <= 0 or k > 100) then
    raise exception 'El peso de un saco alternativo tiene que estar entre 0 y 100 kg.';
  end if;

  update pedido_lineas set sacos_alternativos_kg = nullif(v_kg, '{}') where id = p_linea_id;

  perform registrar_evento('pedidos', v_ped.id, 'sacos_alternativos',
    format('Sacos de %s kg en %s: %s.', v_base, v_ped.numero_proforma,
           case when v_kg is null then 'sin alternativos'
                else 'también acepta ' || array_to_string(v_kg, ' / ') || ' kg' end),
    'info', jsonb_build_object('pedido_linea_id', p_linea_id, 'kg', v_kg));
end $$;

comment on function fijar_sacos_alternativos is
  'Deja los otros pesos de saco que el cliente acepta para una línea del pedido (093). Solo escribe esa columna.';

revoke all on function fijar_sacos_alternativos(bigint, numeric[]) from public;
grant execute on function fijar_sacos_alternativos(bigint, numeric[]) to authenticated;
