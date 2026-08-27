-- ============================================================================
--  018 · RUC DE LOS CLIENTES PERUANOS
-- ============================================================================
--  EL PROBLEMA
--  Ningún cliente peruano tenía RUC cargado. Como el sistema decide entre
--  factura y boleta mirando precisamente eso —RUC de once dígitos: factura;
--  sin RUC: boleta—, TODA venta local salía como boleta. Había boletas de
--  S/ 417 000 a nombre de una empresa, que en el Perú no corresponde: una
--  boleta es para consumidor final y no da derecho a crédito fiscal.
--
--  No era un fallo del programa. La regla estaba bien escrita y el verificador
--  de documentos incluso lo advertía. Faltaba el dato.
--
--  QUÉ HACE ESTA MIGRACIÓN
--  1. Calcula RUC válidos de verdad, con su dígito verificador (módulo 11),
--     para los clientes peruanos que son empresas. Un RUC inventado al azar
--     no serviría: el sistema lo rechazaría igual que SUNAT.
--  2. Recalcula el tipo de comprobante de las facturas ya emitidas.
--
--  NO se deja ningún cliente sin RUC. Se intentó dejar tres como consumidores
--  finales para conservar el camino de la boleta, pero los tres son empresas
--  con razón social de empresa: una boleta a nombre de «J. MARR (SEAFOODS)
--  LIMITED» sería tan poco creíble como el problema que veníamos a arreglar.
--  La regla de la boleta sigue viva en el código y se demuestra registrando un
--  cliente sin RUC, que es exactamente como ocurriría en la realidad.
--
--  LOS DATOS SIGUEN SIENDO FICTICIOS. Estos RUC son sintácticamente válidos
--  pero no corresponden a ninguna empresa real; sirven para probar la regla.
-- ============================================================================

-- --- Dígito verificador de un RUC peruano -----------------------------------
-- Se multiplican los diez primeros dígitos por los pesos 5,4,3,2,7,6,5,4,3,2;
-- se suma; el resto de dividir entre 11 se resta de 11. Si sale 10 el dígito
-- es 0, y si sale 11 es 1. Es el mismo cálculo que hace SUNAT.
create or replace function ruc_digito_verificador(p_diez text) returns int
language plpgsql immutable as $$
declare
  v_pesos int[] := array[5,4,3,2,7,6,5,4,3,2];
  v_suma  int := 0;
  v_resto int;
  i int;
begin
  if length(p_diez) <> 10 or p_diez !~ '^[0-9]{10}$' then
    raise exception 'Se esperaban diez dígitos, llegó «%»', p_diez;
  end if;

  for i in 1..10 loop
    v_suma := v_suma + (substr(p_diez, i, 1))::int * v_pesos[i];
  end loop;

  v_resto := 11 - (v_suma % 11);
  return case when v_resto = 10 then 0 when v_resto = 11 then 1 else v_resto end;
end;
$$;

comment on function ruc_digito_verificador is
  'Dígito verificador de un RUC peruano (módulo 11), a partir de sus diez primeros dígitos.';


-- --- Asignación --------------------------------------------------------------
do $$
declare
  r record;
  v_diez text;
  v_ruc  text;
begin
  for r in
    select id from clientes
    where pais = 'Perú' and activo
      and (ruc_tax_id is null or length(ruc_tax_id) <> 11)
    order by id
  loop
    -- Prefijo 20: persona jurídica. El resto se deriva del id del cliente,
    -- así la asignación es reproducible y nunca hay dos RUC iguales.
    v_diez := '20' || lpad(r.id::text, 8, '0');
    v_ruc  := v_diez || ruc_digito_verificador(v_diez)::text;
    update clientes set ruc_tax_id = v_ruc where id = r.id;
  end loop;
end $$;


-- --- Recálculo del tipo de comprobante ---------------------------------------
-- La regla vuelve a aplicarse sobre lo ya emitido: cliente peruano con RUC de
-- once dígitos → factura; sin RUC → boleta. Las exportaciones no se tocan:
-- siempre son factura, y sin IGV.
update facturas f
set tipo_comprobante = case
      when c.pais <> 'Perú' then 'factura'::tipo_comprobante
      when c.ruc_tax_id is not null and length(c.ruc_tax_id) = 11 then 'factura'::tipo_comprobante
      else 'boleta'::tipo_comprobante
    end
from clientes c
where c.id = f.cliente_id;


-- --- Comprobación ------------------------------------------------------------
-- Si algo quedó mal, la migración falla aquí y no en una factura delante del
-- cliente. Una boleta de más de S/ 5 000 a una empresa es exactamente el caso
-- que esta migración vino a eliminar.
do $$
declare
  v_invalidos int;
  v_boletas_grandes int;
begin
  select count(*) into v_invalidos
  from clientes
  where pais = 'Perú' and activo and ruc_tax_id is not null
    and (length(ruc_tax_id) <> 11
         or ruc_tax_id !~ '^[0-9]{11}$'
         or substr(ruc_tax_id, 11, 1)::int <> ruc_digito_verificador(substr(ruc_tax_id, 1, 10)));

  if v_invalidos > 0 then
    raise exception 'Quedaron % RUC con dígito verificador incorrecto', v_invalidos;
  end if;

  select count(*) into v_boletas_grandes
  from facturas f
  join clientes c on c.id = f.cliente_id
  where f.tipo_comprobante = 'boleta' and f.total > 5000 and c.ruc_tax_id is not null;

  if v_boletas_grandes > 0 then
    raise exception 'Quedaron % boletas de más de S/ 5 000 a clientes con RUC', v_boletas_grandes;
  end if;
end $$;
