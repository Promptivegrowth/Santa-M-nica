-- ============================================================================
--  013 · TIPO DE COMPROBANTE
-- ============================================================================
--  En Perú no todos los comprobantes son iguales, y el documento que se
--  imprime tiene que decir cuál es:
--
--    FACTURA   se emite a quien tiene RUC. Da derecho a crédito fiscal, así
--              que lleva el RUC del comprador y detalla el IGV.
--    BOLETA    se emite a consumidor final, con DNI. Sin crédito fiscal.
--
--  Santa Mónica exporta el 98 % de lo que produce, así que casi todo es
--  factura —una factura de exportación, que además va sin IGV—. Pero la venta
--  al mercado nacional existe y necesita boleta, y hasta ahora la tabla no
--  sabía distinguirlas: imprimía todo con el mismo título.
--
--  El valor se deduce de si el cliente tiene RUC, que es la regla real, y
--  queda editable: hay casos de borde que solo conoce la administración.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'tipo_comprobante') then
    create type tipo_comprobante as enum ('factura', 'boleta');
  end if;
end $$;

alter table facturas
  add column if not exists tipo_comprobante tipo_comprobante not null default 'factura';

-- ----------------------------------------------------------------------------
--  Se marca como boleta lo que se emitió a un cliente sin RUC peruano.
--  El RUC peruano son 11 dígitos; cualquier otra cosa —un VAT europeo, un
--  Tax ID estadounidense— es un cliente extranjero, y a esos se les factura.
-- ----------------------------------------------------------------------------
update facturas f
   set tipo_comprobante = 'boleta'
  from clientes c
 where c.id = f.cliente_id
   and c.pais = 'Perú'
   and (c.ruc_tax_id is null or c.ruc_tax_id !~ '^[0-9]{11}$')
   and f.tipo_comprobante = 'factura';

comment on column facturas.tipo_comprobante is
  'Factura (comprador con RUC) o boleta (consumidor final). Decide el título y el detalle del documento impreso.';

create index if not exists idx_facturas_tipo on facturas (tipo_comprobante);
