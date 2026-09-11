-- ============================================================================
--  049 · LA RAZÓN SOCIAL ES S.A., NO S.A.C.
-- ============================================================================
--  El sistema decía «INDUSTRIAL PESQUERA SANTA MÓNICA S.A.C.». Lo pregunté
--  porque su propia proforma —la SM26-312 que mandó— dice «S.A.», y respondió
--  que va S.A.
--
--  No es un detalle de estilo: la razón social va impresa en la proforma, en
--  la factura y en el contrato de venta que firma el comprador. Un nombre
--  legal que no coincide con el del RUC es motivo de observación en aduana y
--  de rechazo en un banco.
--
--  El RUC (20205572229) ya coincidía con el de su documento, así que la única
--  discrepancia era el sufijo.
-- ============================================================================
update parametros
   set valor = 'INDUSTRIAL PESQUERA SANTA MÓNICA S.A.'
 where clave = 'empresa_razon_social';
