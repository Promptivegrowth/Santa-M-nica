-- ============================================================================
--  094 · NOMBRE COMERCIAL POR PRODUCTO (Isaac, Comercial, 25/11)
-- ============================================================================
--  La proforma y el contrato nombraban el producto con el de su FORMATO (la
--  familia): todos los «CONOS» salían «FROZEN GIANT SQUID TUBES / CONOS DE
--  POTA CONGELADOS», y TUBES son tubos de pota, otro producto. Isaac: «genera
--  por cada ID creado un NOMBRE COMERCIAL; ahí ellos escribirían lo que ves
--  como CONOS DE POTA CONGELADO».
--
--  Si el producto tiene nombre comercial, manda; si no, sigue el del formato.
--  Se llena en Ventas › Productos › Editar. Re-ejecutable.
-- ============================================================================

alter table skus add column if not exists nombre_comercial_en text;
alter table skus add column if not exists nombre_comercial_es text;

comment on column skus.nombre_comercial_en is 'Nombre del producto en inglés para proforma y contrato (094). Vacío = el del formato.';
comment on column skus.nombre_comercial_es is 'Nombre del producto en castellano para proforma y contrato (094). Vacío = el del formato.';

--  El inglés de CONOS decía TUBES (tubos): son conos.
update formatos set descripcion_en = 'FROZEN GIANT SQUID CONES'
 where nombre = 'CONOS' and descripcion_en = 'FROZEN GIANT SQUID TUBES';
