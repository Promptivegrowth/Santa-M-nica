-- ============================================================================
--  050 · LA EMPRESA TIENE DOS DIRECCIONES Y CADA DOCUMENTO LLEVA LA SUYA
-- ============================================================================
--  EL FALLO
--  El sistema guardaba UNA dirección —la planta de Paita— y todos los
--  documentos la imprimían. Incluida la factura.
--
--  La ficha de SUNAT dice otra cosa:
--
--    RUC 20205572229 · INDUSTRIAL PESQUERA SANTA MONICA S.A.
--    Domicilio fiscal: AV. MANUEL OLGUIN NRO. 501 INT. 702,
--                      URB. RESIDENCIAL ISABELITA, SANTIAGO DE SURCO, LIMA
--
--  O sea: el domicilio fiscal está en Lima y la planta en Paita. No es que una
--  esté mal; son dos cosas distintas que van en documentos distintos.
--
--   · La FACTURA y la BOLETA llevan el domicilio fiscal. Es requisito de
--     SUNAT y lo valida contra su padrón: una factura con la dirección de la
--     planta es una factura observable.
--
--   · La PROFORMA lleva la planta. Es la que tiene el registro FDA y el código
--     CEU de SANIPES, y es de donde sale físicamente la mercadería. Poner el
--     domicilio fiscal de Surco en un contrato de exportación sería peor: la
--     autoridad sanitaria del comprador busca la planta habilitada, no la
--     oficina.
--
--  POR QUÉ SE RENOMBRA EL PARÁMETRO
--  «empresa_direccion» a secas, conviviendo con «empresa_domicilio_fiscal», es
--  una invitación a equivocarse: nadie sabría cuál de las dos es. Se llama
--  «empresa_direccion_planta» y se acabó la duda.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
--  1 · LA QUE YA ESTABA, CON NOMBRE CLARO
-- ────────────────────────────────────────────────────────────────────────────
update parametros
   set clave       = 'empresa_direccion_planta',
       etiqueta    = 'Dirección de planta',
       descripcion = 'Dónde está la planta que produce y embarca. Va en el membrete de la proforma, junto al FDA y el CEU: es la planta habilitada, y es la que busca la autoridad sanitaria del comprador. NO es el domicilio fiscal.'
 where clave = 'empresa_direccion';


-- ────────────────────────────────────────────────────────────────────────────
--  2 · LA QUE FALTABA
-- ────────────────────────────────────────────────────────────────────────────
insert into parametros (clave, valor, tipo_dato, grupo, etiqueta, editable_por, descripcion) values
  ('empresa_domicilio_fiscal',
   'AV. MANUEL OLGUIN NRO. 501 INT. 702, URB. RESIDENCIAL ISABELITA, SANTIAGO DE SURCO - LIMA',
   'texto', 'empresa', 'Domicilio fiscal', 'gerencia',
   'El domicilio inscrito en SUNAT. Va en la factura y en la boleta, donde es obligatorio y se valida contra el padrón. No es la dirección de la planta.'),

  ('empresa_nombre_comercial', 'IND. PESQ. SANTA MONICA S.A.',
   'texto', 'empresa', 'Nombre comercial (SUNAT)', 'gerencia',
   'El nombre comercial inscrito en SUNAT, distinto de la marca con la que se exporta («Santa Mónica Fishing»). Se guarda porque algunos sistemas de emisión electrónica lo piden.')
on conflict (clave) do nothing;
