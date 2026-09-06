-- ============================================================================
--  042 · EL NOMBRE COMERCIAL DEL PRODUCTO, EN LOS DOS IDIOMAS
-- ============================================================================
--  EL FALLO
--  La primera proforma de exportación salió diciendo «POTA LAMINADO CONGELADAS»
--  y «FROZEN LAMINATED GIANT SQUID». Ninguna de las dos es como se llama el
--  producto: la de arriba no concuerda en género ni en número, y la de abajo
--  invierte el orden que usa el sector —primero la especie, después el corte:
--  «FROZEN GIANT SQUID WINGS»—.
--
--  POR QUÉ NO SE ARREGLA PEGANDO PALABRAS
--  Porque el castellano concuerda: son «ALAS DE POTA CONGELADAS» pero «FILETE
--  DE POTA CONGELADO». Deducir el género y el número de cada corte para pegar
--  la terminación correcta es adivinar, y adivinar en un documento que firma
--  una aduana no vale la pena.
--
--  Además, el nombre comercial NO es la suma de sus partes: «laminado de pota»
--  se vende como GIANT SQUID SHEETS, y «HGT» quiere decir descabezado,
--  eviscerado y sin cola. Eso no sale de ninguna regla: se sabe o no se sabe.
--
--  DÓNDE VA
--  En el formato, no en la especie, porque cada formato YA pertenece a una
--  especie —`formatos.especie_id`—: el FILETE de pota y el de merluza son dos
--  filas distintas. Así el nombre se escribe una vez, completo, y el cliente
--  lo corrige desde el maestro si su comprador lo llama de otra manera.
-- ============================================================================
alter table formatos
  add column if not exists descripcion_es text,
  add column if not exists descripcion_en text;

comment on column formatos.descripcion_es is
  'Nombre comercial completo del producto en castellano, con la concordancia correcta: «ALAS DE POTA CONGELADAS». Se escribe entero y no se arma pegando especie y formato, porque el castellano concuerda y el nombre comercial no siempre es la suma de sus partes.';
comment on column formatos.descripcion_en is
  'Nombre comercial completo en inglés, en el orden del sector: FROZEN + especie + corte. Es el nombre que leen la aduana y el banco del comprador.';

update formatos f set descripcion_es = v.es, descripcion_en = v.en
  from (values
    -- POTA
    ('POTA', 'LAMINADO',            'LAMINAS DE POTA CONGELADAS',                    'FROZEN GIANT SQUID SHEETS'),
    ('POTA', 'POTA',                'POTA CONGELADA',                                'FROZEN GIANT SQUID'),
    ('POTA', 'FILETE',              'FILETE DE POTA CONGELADO',                      'FROZEN GIANT SQUID FILLET'),
    ('POTA', 'TENTACULO',           'TENTACULOS DE POTA CONGELADOS',                 'FROZEN GIANT SQUID TENTACLES'),
    ('POTA', 'ALETAS',              'ALAS DE POTA CONGELADAS',                       'FROZEN GIANT SQUID WINGS'),
    ('POTA', 'NUCAS',               'NUCAS DE POTA CONGELADAS',                      'FROZEN GIANT SQUID NECKS'),
    ('POTA', 'PRECOCIDOS',          'PRECOCIDOS DE POTA CONGELADOS',                 'FROZEN PRECOOKED GIANT SQUID'),
    ('POTA', 'CONOS',               'CONOS DE POTA CONGELADOS',                      'FROZEN GIANT SQUID TUBES'),
    ('POTA', 'ALETA TUBO',          'ALETA Y TUBO DE POTA CONGELADOS',               'FROZEN GIANT SQUID WINGS AND TUBES'),
    ('POTA', 'RECORTE',             'RECORTES DE POTA CONGELADOS',                   'FROZEN GIANT SQUID TRIMMINGS'),
    -- MERLUZA
    ('MERLUZA', 'FILETE',           'FILETE DE MERLUZA CONGELADO',                   'FROZEN HAKE FILLET'),
    ('MERLUZA', 'FILETE INTERF',    'FILETE INTERFOLIADO DE MERLUZA CONGELADO',      'FROZEN INTERLEAVED HAKE FILLET'),
    ('MERLUZA', 'HGT',              'MERLUZA DESCABEZADA Y EVISCERADA CONGELADA',    'FROZEN HAKE HEADED GUTTED TAILED'),
    ('MERLUZA', 'HUEVERA',          'HUEVERA DE MERLUZA CONGELADA',                  'FROZEN HAKE ROE'),
    ('MERLUZA', 'ENTERA INTERF.',   'MERLUZA ENTERA INTERFOLIADA CONGELADA',         'FROZEN WHOLE INTERLEAVED HAKE'),
    -- BONITO
    ('BONITO', 'BONITO',            'BONITO CONGELADO',                              'FROZEN PACIFIC BONITO'),
    ('BONITO', 'BONITO ENTERO',     'BONITO ENTERO CONGELADO',                       'FROZEN WHOLE PACIFIC BONITO'),
    ('BONITO', 'BONITO FILETE SP SE','FILETE DE BONITO SIN PIEL Y SIN ESPINA CONGELADO', 'FROZEN BONITO FILLET SKINLESS BONELESS'),
    ('BONITO', 'BONITO LOMO',       'LOMO DE BONITO CONGELADO',                      'FROZEN BONITO LOIN'),
    -- RESTO
    ('ATUN',      'ATUN "BA"',      'ATUN CONGELADO',                                'FROZEN YELLOWFIN TUNA'),
    ('CABALLA',   'CABALLA ENTERA', 'CABALLA ENTERA CONGELADA',                      'FROZEN WHOLE CHUB MACKEREL'),
    ('ANCHOVETA', 'ANCHOVETA BLANCA','ANCHOVETA BLANCA CONGELADA',                   'FROZEN WHITE PERUVIAN ANCHOVY'),
    ('ANCHOVETA', 'ANCHOVETA NEGRA','ANCHOVETA NEGRA CONGELADA',                     'FROZEN BLACK PERUVIAN ANCHOVY'),
    ('PERICO',    'FILETE',         'FILETE DE PERICO CONGELADO',                    'FROZEN MAHI MAHI FILLET'),
    ('PERICO',    'VENAS',          'VENAS DE PERICO CONGELADAS',                    'FROZEN MAHI MAHI VEINS'),
    ('JUREL',     'JUREL ENTERO',   'JUREL ENTERO CONGELADO',                        'FROZEN WHOLE JACK MACKEREL')
  ) as v(especie, formato, es, en)
  join especies e on e.nombre = v.especie
 where f.especie_id = e.id and f.nombre = v.formato;

--  Red de seguridad: si mañana se da de alta un formato y nadie escribe su
--  nombre comercial, la proforma no puede salir en blanco. Se compone uno
--  provisional —sin adornos gramaticales, para que se note que hay que
--  corregirlo— en lugar de imprimir un hueco.
update formatos f
   set descripcion_es = coalesce(f.descripcion_es, e.nombre || ' ' || f.nombre || ' CONGELADO'),
       descripcion_en = coalesce(f.descripcion_en,
                                 'FROZEN ' || coalesce(e.nombre_ingles, e.nombre) || ' ' ||
                                 coalesce(f.nombre_ingles, f.nombre))
  from especies e
 where e.id = f.especie_id
   and (f.descripcion_es is null or f.descripcion_en is null);
