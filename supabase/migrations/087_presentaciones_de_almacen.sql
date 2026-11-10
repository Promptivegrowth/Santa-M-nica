-- ============================================================================
--  087 · LAS PRESENTACIONES QUE USA ALMACÉN (reunión con Dany, 10/11)
-- ============================================================================
--  Dany (Almacén: ingresos, salidas y traslados) probó la plantilla de
--  ingresos con su base de trabajo («9-11.xlsx», hoja GENERAL) y no le
--  cuadraban los productos: «no tiene filete, no tiene aleta… cómo sé yo qué
--  nombre son cada uno». No faltaban los productos: les faltaba la
--  PRESENTACIÓN con que él los produce. P. ej. «FILETE-PARA COCINA X 30 KG»
--  (521 pallets en 2026) existe como SKU 35, pero solo con 20 kg; la
--  plantilla lo rechazaba con «no tiene una presentación de 30 kg».
--
--  Se recorrió su hoja GENERAL de la campaña 2026 (25 133 pallets) con la
--  llave que su base ya trae y que coincide al 100 % con la nuestra: CODIGO
--  (= código del SKU) + PRESENTACION + TIPO DE CONGELAMIENTO. Faltaban 80
--  combinaciones, que suman 2 316 pallets. Aquí se habilitan; el número al
--  final de cada línea es cuántos pallets de 2026 la usan.
--
--  Dos presentaciones no existían: «1 X 20 KG» y «1 X 15 KG» en túnel (su
--  ID_PRES TUNEL20 KG / TUNEL15 KG con un solo bloque: jurel, filete CP SE y
--  bonito entero).
--
--  Solo AGREGA (on conflict do nothing): no borra, no desactiva ni cambia
--  nada de lo existente. Re-ejecutable.
-- ============================================================================

insert into presentaciones (codigo, congelamiento, peso_bulto_kg, descripcion)
select v.codigo, v.cong::tipo_congelamiento, v.kg, v.descripcion
from (values
  ('TUNEL20 KG#1X20', 'tunel', 20::numeric, '1 X 20 KG'),
  ('TUNEL15 KG#1X15', 'tunel', 15::numeric, '1 X 15 KG')
) as v(codigo, cong, kg, descripcion)
where not exists (
  select 1 from presentaciones p
  where p.congelamiento = v.cong::tipo_congelamiento
    and replace(upper(p.descripcion), ' ', '') = replace(upper(v.descripcion), ' ', '')
);

insert into sku_presentaciones (sku_id, presentacion_id)
select s.id, p.id
from (values
  ('03', 'placas', '2 X 10 KG'),   -- POTA-ENTERA "1-2" · 20
  ('09', 'placas', '1 X 7.5 KG'),  -- LAMINADO-RECORTE LABIO · 2
  ('15', 'placas', '1 X 7 KG'),    -- LAMINADO-RECORTE C/PIEL · 3
  ('16', 'placas', '1 X 7 KG'),    -- LAMINADO-CONOS DE POTA · 7
  ('16', 'placas', '4 X 7 KG'),    -- LAMINADO-CONOS DE POTA · 21
  ('21', 'tunel', '2 X 10 KG'),    -- FILETE-"A" 2000-4000 · 3
  ('25', 'tunel', '2 X 10 KG'),    -- FILETE-"B" 2000-4000 · 20
  ('32', 'placas', '4 X 7.5 KG'),  -- FILETE-S/PIEL-S/PANZA · 3
  ('35', 'placas', '4 X 7.5 KG'),  -- FILETE-PARA COCINA · 521
  ('38', 'placas', '2 X 10 KG'),   -- TENTACULO-S/UÑA 0-300 · 1
  ('39', 'placas', '1 X 7.5 KG'),  -- TENTACULO-S/UÑA 300-500 · 2
  ('40', 'placas', '1 X 7.5 KG'),  -- TENTACULO-S/UÑA 500-1000 · 2
  ('41', 'placas', '1 X 7.5 KG'),  -- TENTACULO-S/UÑA 1000-2000 · 56
  ('42', 'placas', '1 X 7.5 KG'),  -- TENTACULO-S/UÑA 2000-3000 · 4
  ('42', 'tunel', '2 X 15 KG'),    -- TENTACULO-S/UÑA 2000-3000 · 2
  ('46', 'placas', '1 X 7.5 KG'),  -- TENTACULO-REPRODUCTOR C/PUNTA · 18
  ('46', 'placas', '4 X 7.5 KG'),  -- TENTACULO-REPRODUCTOR C/PUNTA · 59
  ('47', 'placas', '1 X 7.5 KG'),  -- TENTACULO-REPRODUCTOR S/PUNTA · 11
  ('51', 'placas', '2 X 7 KG'),    -- NUCAS-0-100 · 6
  ('51', 'placas', '2 X 10 KG'),   -- NUCAS-0-100 · 2
  ('52', 'placas', '1 X 7 KG'),    -- NUCAS-100-300 · 1
  ('52', 'placas', '2 X 7 KG'),    -- NUCAS-100-300 · 165
  ('52', 'placas', '3 X 7 KG'),    -- NUCAS-100-300 · 151
  ('52', 'placas', '4 X 7 KG'),    -- NUCAS-100-300 · 7
  ('52', 'tunel', '2 X 10 KG'),    -- NUCAS-100-300 · 3
  ('53', 'placas', '4 X 7 KG'),    -- NUCAS-300-500 · 6
  ('53', 'tunel', '2 X 10 KG'),    -- NUCAS-300-500 · 2
  ('54', 'placas', '1 X 7 KG'),    -- NUCAS-500-UP · 8
  ('56', 'placas', '1 X 7.5 KG'),  -- TENTACULO-C/UÑA 100-300 · 1
  ('60', 'placas', '1 X 7 KG'),    -- ALETAS-1000-UP · 28
  ('60', 'tunel', '1 X 10 KG'),    -- ALETAS-1000-UP · 5
  ('61', 'tunel', '2 X 10 KG'),    -- ALETAS-0-300 · 2
  ('70', 'placas', '1 X 7 KG'),    -- PRECOCIDOS-ALETA S/PIEL · 10
  ('71', 'placas', '1 X 6.5 KG'),  -- PRECOCIDOS-DARUMA A · 1
  ('71', 'placas', '1 X 7 KG'),    -- PRECOCIDOS-DARUMA A · 58
  ('71', 'placas', '1 X 7.5 KG'),  -- PRECOCIDOS-DARUMA A · 1
  ('80', 'placas', '1 X 6.5 KG'),  -- PRECOCIDOS-PIEL (MEMBRANA) · 3
  ('81', 'placas', '1 X 6.5 KG'),  -- PRECOCIDOS-TELILLA · 8
  ('88', 'placas', '1 X 7 KG'),    -- CONOS-CONOS · 1
  ('125', 'tunel', '1 X 15 KG'),   -- BONITO ENTERO-" 1 - 3 " · 125
  ('125', 'tunel', '2 X 7.5 KG'),  -- BONITO ENTERO-" 1 - 3 " · 26
  ('135', 'placas', '1 X 6.5 KG'), -- BONITO FILETE SP SE-GRANEL · 1
  ('135', 'placas', '2 X 10 KG'),  -- BONITO FILETE SP SE-GRANEL · 7
  ('137', 'placas', '1 X 7 KG'),   -- NUCAS-1000-UP · 9
  ('137', 'placas', '2 X 7 KG'),   -- NUCAS-1000-UP · 4
  ('137', 'placas', '2 X 10 KG'),  -- NUCAS-1000-UP · 8
  ('137', 'placas', '3 X 7 KG'),   -- NUCAS-1000-UP · 1
  ('137', 'placas', '4 X 7 KG'),   -- NUCAS-1000-UP · 32
  ('138', 'placas', '1 X 7 KG'),   -- NUCAS-500-1000 · 38
  ('138', 'placas', '2 X 7 KG'),   -- NUCAS-500-1000 · 3
  ('138', 'placas', '3 X 7 KG'),   -- NUCAS-500-1000 · 10
  ('138', 'placas', '4 X 7 KG'),   -- NUCAS-500-1000 · 14
  ('144', 'tunel', '2 X 10 KG'),   -- FILETE-PIGMENTADO "1000-2000" · 11
  ('147', 'placas', '1 X 6 KG'),   -- POTA-ENTERA SIN/CLASIFICAR · 1
  ('147', 'tunel', '2 X 11 KG'),   -- POTA-ENTERA SIN/CLASIFICAR · 1
  ('157', 'tunel', '1 X 15 KG'),   -- BONITO ENTERO-" B " · 11
  ('158', 'placas', '1 X 7.5 KG'), -- RECORTE-PUNTAS CON UÑAS · 3
  ('159', 'placas', '1 X 7 KG'),   -- ALETAS-"B" · 2
  ('159', 'tunel', '2 X 10 KG'),   -- ALETAS-"B" · 5
  ('160', 'placas', '1 X 7.5 KG'), -- TENTACULO-C/UÑA 1000-2000 · 6
  ('162', 'placas', '1 X 7.5 KG'), -- FILETE-"B" 2000-4000 (P) · 80
  ('162', 'placas', '3 X 7.5 KG'), -- FILETE-"B" 2000-4000 (P) · 139
  ('162', 'tunel', '1 X 10 KG'),   -- FILETE-"B" 2000-4000 (P) · 5
  ('164', 'tunel', '1 X 20 KG'),   -- FILETE-CP SE "0-1" · 5
  ('165', 'tunel', '1 X 20 KG'),   -- FILETE-CP SE "1-2" · 13
  ('166', 'tunel', '1 X 20 KG'),   -- FILETE-CP SE "2-3" · 22
  ('169', 'placas', '1 X 7 KG'),   -- ALETAS-"P" 1000-UP · 48
  ('172', 'placas', '2 X 10 KG'),  -- POTA-ENTERA "2-3" · 18
  ('172', 'placas', '4 X 7 KG'),   -- POTA-ENTERA "2-3" · 7
  ('172', 'tunel', '2 X 10 KG'),   -- POTA-ENTERA "2-3" · 7
  ('174', 'placas', '2 X 10 KG'),  -- BONITO LOMO-GRANEL · 6
  ('174', 'tunel', '2 X 7.5 KG'),  -- BONITO LOMO-GRANEL · 5
  ('177', 'tunel', '2 X 7.5 KG'),  -- BONITO ENTERO-" 3-5 B " · 1
  ('178', 'placas', '2 X 7.5 KG'), -- TENTACULO-REPRODUCTOR C/PUNTA-30-50 · 45
  ('178', 'placas', '4 X 7.5 KG'), -- TENTACULO-REPRODUCTOR C/PUNTA-30-50 · 45
  ('179', 'tunel', '1 X 20 KG'),   -- JUREL ENTERO-900-1200 · 29
  ('182', 'tunel', '2 X 10 KG'),   -- FILETE-"L-P" 1000-2000 · 272
  ('187', 'placas', '3 X 7.5 KG'), -- FILETE-"L-P" 2000-3000 · 1
  ('188', 'placas', '3 X 7.5 KG'), -- FILETE-"L-P" 3000-4000 · 2
  ('189', 'placas', '2 X 10 KG')   -- FILETE-"L-P" 4000-UP · 24
) as v(sku, cong, descripcion)
join skus s on s.codigo = v.sku
join presentaciones p
  on p.congelamiento = v.cong::tipo_congelamiento
 and replace(upper(p.descripcion), ' ', '') = replace(upper(v.descripcion), ' ', '')
on conflict (sku_id, presentacion_id) do nothing;
