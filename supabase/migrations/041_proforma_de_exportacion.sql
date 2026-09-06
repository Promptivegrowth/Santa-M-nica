-- ============================================================================
--  041 · LO QUE LE FALTA A LA PROFORMA PARA SER LA DE VERDAD
-- ============================================================================
--  Oliver mandó la proforma real: la SM26-312 de DALIAN BRIGHT ASIA, 7 FCL de
--  alas de pota. Comparada con la que emite hoy el sistema, no es una
--  diferencia de diseño: es que faltan DATOS, y son datos sin los cuales el
--  documento no sirve para lo que tiene que servir.
--
--  Una proforma de exportación no es un presupuesto bonito. Es el papel con el
--  que el comprador chino abre la carta de crédito en su banco y con el que su
--  aduana autoriza la importación. Si le falta el número CEU de la planta, el
--  banco no la acepta. Si no dice DOSIDICUS GIGAS, la autoridad sanitaria no
--  sabe qué animal es. Si no dice FAO 87, no se puede certificar el origen.
--
--  QUÉ FALTABA, UNO POR UNO
--
--   · Los registros sanitarios de la planta (FDA y CEU). No estaban en ningún
--     sitio del sistema.
--   · El nombre científico y el nombre en inglés de cada especie. La proforma
--     va a China: «POTA» no le dice nada a nadie allí.
--   · La dirección del comprador. La tabla de clientes no tenía dirección
--     —ni una columna—, y la proforma real la lleva completa, porque es la
--     dirección a la que la aduana de destino consigna la mercadería.
--   · Cómo se llama el identificador fiscal en cada país: en China es USCI,
--     en Estados Unidos EIN, en Europa VAT. Poner «Tax ID» a todo es lo que
--     hace un sistema que no sabe a dónde exporta.
--   · Cuántos sacos van, cuántos bloques trae cada saco y de qué talla es el
--     producto. La proforma real lo dice línea por línea; nosotros teníamos
--     «2 X 11 KG» y nada más.
--   · Tolerancia de peso, tipo y número de contenedor, mes de embarque, puerto
--     de carga, zona de pesca y el reparto del pago (20 % adelanto / 80 %
--     contra documentos).
--   · La dirección del banco. Un SWIFT sin dirección no basta para una
--     transferencia internacional.
--   · La lista de documentos que se emitirán y las condiciones del contrato.
--
--  TODO ES CONFIGURABLE. Nada de esto se escribe en el código: la zona de
--  pesca cambia, el banco cambia y la lista de documentos cambia según el
--  cliente. Van a parámetros y a columnas, no a constantes.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
--  1 · LA ESPECIE, COMO LA ENTIENDE UNA ADUANA
-- ────────────────────────────────────────────────────────────────────────────
--  El nombre científico es el único que no depende del idioma: es el que usan
--  el certificado sanitario, el de origen y la partida arancelaria.
alter table especies
  add column if not exists nombre_cientifico text,
  add column if not exists nombre_ingles     text;

comment on column especies.nombre_cientifico is
  'Nombre científico (DOSIDICUS GIGAS). Va en la proforma y en el certificado sanitario: es el único nombre que no cambia de un país a otro.';
comment on column especies.nombre_ingles is
  'Nombre comercial en inglés (GIANT SQUID). La proforma de exportación se lee en el país de destino.';

update especies set nombre_cientifico = v.cientifico, nombre_ingles = v.ingles
  from (values
    ('POTA',      'DOSIDICUS GIGAS',        'GIANT SQUID'),
    ('MERLUZA',   'MERLUCCIUS GAYI PERUANUS','PERUVIAN HAKE'),
    ('BONITO',    'SARDA CHILIENSIS',       'PACIFIC BONITO'),
    ('ATUN',      'THUNNUS ALBACARES',      'YELLOWFIN TUNA'),
    ('CABALLA',   'SCOMBER JAPONICUS',      'PACIFIC CHUB MACKEREL'),
    ('ANCHOVETA', 'ENGRAULIS RINGENS',      'PERUVIAN ANCHOVY'),
    ('PERICO',    'CORYPHAENA HIPPURUS',    'MAHI MAHI'),
    ('JUREL',     'TRACHURUS MURPHYI',      'JACK MACKEREL')
  ) as v(nombre, cientifico, ingles)
 where especies.nombre = v.nombre;


-- ────────────────────────────────────────────────────────────────────────────
--  2 · EL FORMATO, EN INGLÉS
-- ────────────────────────────────────────────────────────────────────────────
alter table formatos add column if not exists nombre_ingles text;

comment on column formatos.nombre_ingles is
  'Cómo se llama el corte en inglés (ALETAS → WINGS). Sin esto la descripción de la proforma sale a medias en el idioma del comprador.';

update formatos set nombre_ingles = v.ingles
  from (values
    ('LAMINADO',      'LAMINATED'),
    ('POTA',          'SQUID'),
    ('FILETE',        'FILLET'),
    ('TENTACULO',     'TENTACLES'),
    ('ALETAS',        'WINGS'),
    ('NUCAS',         'NECKS'),
    ('PRECOCIDOS',    'PRECOOKED'),
    ('CONOS',         'TUBES'),
    ('FILETE INTERF', 'INTERLEAVED FILLET'),
    ('HGT',           'HEADED GUTTED TAILED'),
    ('HUEVERA',       'ROE')
  ) as v(nombre, ingles)
 where formatos.nombre = v.nombre;


-- ────────────────────────────────────────────────────────────────────────────
--  3 · LA TALLA DEL PRODUCTO
-- ────────────────────────────────────────────────────────────────────────────
--  «SIZE: 1000-UP» es lo primero que mira el comprador: define el precio. Hoy
--  vive escondida dentro del texto del corte —«"A" 1000-2000»— donde no se
--  puede filtrar ni imprimir aparte.
alter table skus add column if not exists talla text;

comment on column skus.talla is
  'Talla o calibre en gramos (1000-UP, 500-1000). Se extrae del corte, donde estaba mezclada con el resto del texto, para poder imprimirla en la proforma como campo propio.';

--  Se saca del corte con una expresión regular y se normaliza al formato que
--  usa el comercio internacional: «500-1000» y «1000-UP».
update skus set talla = case
    when corte ~ '[0-9]+\s*-\s*UP'        then regexp_replace(substring(corte from '[0-9]+\s*-\s*UP'), '\s+', '', 'g')
    when corte ~ '[0-9]+\s*-\s*[0-9]+'    then regexp_replace(substring(corte from '[0-9]+\s*-\s*[0-9]+'), '\s+', '', 'g')
    else null
  end
 where talla is null;


-- ────────────────────────────────────────────────────────────────────────────
--  4 · CUÁNTOS BLOQUES TRAE CADA SACO
-- ────────────────────────────────────────────────────────────────────────────
--  «PACKING: 03 BLOCKS x 7 KG» le dice al comprador cómo viene partida la
--  mercadería dentro del saco. El dato ya estaba, pero como TEXTO —«3 X 7 KG»—,
--  que sirve para leerlo y no para calcular con él.
alter table presentaciones
  add column if not exists bloques_por_bulto integer,
  add column if not exists peso_bloque_kg    numeric(8,3);

comment on column presentaciones.bloques_por_bulto is
  'Cuántos bloques van dentro de un saco. Estaba solo dentro del texto de la descripción; separado se puede imprimir, sumar y comprobar contra el peso del bulto.';
comment on column presentaciones.peso_bloque_kg is
  'Cuánto pesa cada bloque. bloques × peso_bloque debe dar el peso del bulto: si no cuadra, la descripción está mal escrita.';

update presentaciones set
  bloques_por_bulto = nullif(substring(descripcion from '^\s*([0-9]+)\s*[Xx]'), '')::integer,
  peso_bloque_kg    = nullif(substring(descripcion from '[Xx]\s*([0-9]+(?:\.[0-9]+)?)\s*KG'), '')::numeric
 where descripcion ~ '^\s*[0-9]+\s*[Xx]\s*[0-9]';


-- ────────────────────────────────────────────────────────────────────────────
--  5 · LA DIRECCIÓN DEL COMPRADOR Y CÓMO SE LLAMA SU IDENTIFICADOR FISCAL
-- ────────────────────────────────────────────────────────────────────────────
--  La proforma real lleva la dirección completa del comprador en tres líneas.
--  Nuestra tabla de clientes no tenía dirección: ni una columna.
alter table clientes
  add column if not exists direccion       text,
  add column if not exists etiqueta_tax_id text;

comment on column clientes.direccion is
  'Dirección fiscal completa del cliente. Es la que se consigna en la proforma y en el conocimiento de embarque; la aduana de destino compara ambas.';
comment on column clientes.etiqueta_tax_id is
  'Cómo se llama el identificador fiscal en el país del cliente: USCI en China, EIN en Estados Unidos, VAT en Europa, RUC en Perú. Se rellena solo según el país, pero se puede corregir a mano cuando el cliente use otro.';

--  Se rellena según el país. Es una foto del momento, no una regla: si mañana
--  un cliente ruso usa otro identificador, se le corrige el suyo sin tocar a
--  los demás.
update clientes set etiqueta_tax_id = case pais
    when 'Perú'            then 'RUC'
    when 'China'           then 'USCI'
    when 'Estados Unidos'  then 'EIN'
    when 'Rusia'           then 'INN'
    when 'Corea del Sur'   then 'BRN'
    when 'Japón'           then 'CORPORATE NUMBER'
    when 'España'          then 'VAT'
    when 'Italia'          then 'VAT'
    when 'Portugal'        then 'VAT'
    when 'Francia'         then 'VAT'
    else 'TAX ID'
  end
 where etiqueta_tax_id is null;


-- ────────────────────────────────────────────────────────────────────────────
--  6 · EL BANCO, COMO LO PIDE UNA TRANSFERENCIA INTERNACIONAL
-- ────────────────────────────────────────────────────────────────────────────
--  Un SWIFT sin dirección de banco no basta: el banco emisor la exige para
--  completar la orden.
alter table cuentas_bancarias
  add column if not exists direccion_banco text;

comment on column cuentas_bancarias.direccion_banco is
  'Dirección de la sucursal del banco. Va en la proforma porque el banco del comprador la necesita para emitir la transferencia o la carta de crédito.';

update cuentas_bancarias
   set direccion_banco = 'AV. REP. DE PANAMA NRO. 3055, URB. EL PALOMAR, SAN ISIDRO, LIMA - PERU'
 where direccion_banco is null and banco ilike '%BBVA%';


-- ────────────────────────────────────────────────────────────────────────────
--  7 · LAS CONDICIONES DEL EMBARQUE, POR PEDIDO
-- ────────────────────────────────────────────────────────────────────────────
--  Todo esto cambia de un pedido a otro y se negocia con el cliente, así que
--  va en el pedido y no en parámetros.
alter table pedidos
  add column if not exists contenedor_tipo      text,
  add column if not exists contenedores         integer,
  add column if not exists tolerancia_pct       numeric(5,2),
  add column if not exists mes_embarque         date,
  add column if not exists pago_adelanto_pct    numeric(5,2),
  add column if not exists puerto_embarque      text;

comment on column pedidos.contenedor_tipo is
  'Tipo de contenedor pactado (40 HC REEFER). Define cuánto entra y a qué temperatura viaja.';
comment on column pedidos.contenedores is
  'Cuántos contenedores cubre esta proforma. La real decía «07 FCL REEFER 40 HC».';
comment on column pedidos.tolerancia_pct is
  'Margen de peso aceptado sobre lo pactado, arriba y abajo. La pesca no da kilos exactos: sin tolerancia, cualquier embarque incumple el contrato.';
comment on column pedidos.mes_embarque is
  'Mes en que se embarca. En la proforma se imprime como mes y año —AUGUST 2026—, no como día: el comprador acepta el mes, no la fecha exacta.';
comment on column pedidos.pago_adelanto_pct is
  'Qué parte se cobra por adelantado. El resto va contra copia de documentos. Es la condición que más se negocia y la que decide si se produce o no.';
comment on column pedidos.puerto_embarque is
  'Puerto de carga. Casi siempre Paita, pero no siempre: por eso se guarda en el pedido y solo toma de parámetros el valor por defecto.';

--  Valores por defecto para lo ya sembrado, coherentes con la proforma real.
update pedidos p set
    contenedor_tipo   = coalesce(p.contenedor_tipo, '40 HC REEFER'),
    tolerancia_pct    = coalesce(p.tolerancia_pct, 10),
    pago_adelanto_pct = coalesce(p.pago_adelanto_pct,
                                 case when p.condicion_pago ilike '%adelant%' then 100 else 20 end),
    mes_embarque      = coalesce(p.mes_embarque, date_trunc('month', p.fecha_comprometida)::date),
    puerto_embarque   = coalesce(p.puerto_embarque, 'PAITA, PERU');

--  Cuántos contenedores: los que ya tiene armados en packing, y si aún no hay
--  ninguno se estima con la capacidad configurada del contenedor.
--
--  El packing no cuelga del pedido: cuelga del EMBARQUE, y un embarque puede
--  llevar varios pedidos. Por eso se cuenta pasando por embarque_pedidos y con
--  `distinct`: sin él, un contenedor compartido se contaría dos veces.
update pedidos p set contenedores = coalesce((
    select count(distinct pl.id)::int
      from embarque_pedidos ep
      join packing_lists pl on pl.embarque_id = ep.embarque_id
     where ep.pedido_id = p.id), 0)
 where p.contenedores is null;

update pedidos p set contenedores = greatest(1, ceil(t.tm / 25.0)::int)
  from (select pedido_id, sum(cantidad_tm) as tm from pedido_lineas group by pedido_id) t
 where t.pedido_id = p.id and coalesce(p.contenedores, 0) = 0;


-- ────────────────────────────────────────────────────────────────────────────
--  8 · LOS DATOS DE LA PLANTA Y DEL CONTRATO
-- ────────────────────────────────────────────────────────────────────────────
--  Los registros sanitarios identifican a la PLANTA, no al producto. Sin ellos
--  la mercadería no entra a Estados Unidos ni a China.
insert into parametros (clave, valor, tipo_dato, grupo, etiqueta, editable_por, descripcion) values
  ('empresa_fda', '10222582442', 'texto', 'empresa', 'Registro FDA', 'gerencia',
   'Número de registro ante la FDA de Estados Unidos. Identifica a la PLANTA, no al producto. Sin él la mercadería no entra a ese mercado.'),
  ('empresa_ceu', 'P009-PAI-IDPS', 'texto', 'empresa', 'Código CEU (SANIPES)', 'gerencia',
   'Código de establecimiento habilitado por SANIPES. Es el que el comprador presenta a su autoridad sanitaria; va impreso en la proforma, encima de la tabla de productos.'),
  ('empresa_telefono', '51-73-213202 / 213200', 'texto', 'empresa', 'Teléfonos', 'gerencia',
   'Teléfonos de planta tal como se imprimen en el membrete.'),
  ('empresa_fax', '51-73-212836', 'texto', 'empresa', 'Fax', 'gerencia',
   'Fax. Sigue en el membrete porque varios bancos asiáticos aún lo piden en el juego de documentos.'),
  ('empresa_web', 'www.santamonicafishing.com', 'texto', 'empresa', 'Sitio web', 'gerencia',
   'Sitio web de la empresa, tal como aparece en el membrete.'),
  ('pais_origen', 'PERU', 'texto', 'comercial', 'País de origen', 'gerencia',
   'País de origen de la mercadería. Va en la proforma y debe coincidir con el certificado de origen.'),
  ('zona_pesca', 'FAO 87 OCEAN PACIFIC', 'texto', 'comercial', 'Zona de pesca (FAO)', 'gerencia',
   'Zona FAO de captura. La exigen la trazabilidad pesquera europea y la china: identifica dónde se pescó.'),
  ('puerto_embarque', 'PAITA, PERU', 'texto', 'comercial', 'Puerto de embarque', 'gerencia',
   'Puerto de carga por defecto. Cada pedido puede llevar otro.'),
  ('proforma_tolerancia_pct', '10', 'numero', 'comercial', 'Tolerancia de peso', 'gerencia',
   'Margen de peso aceptado sobre lo pactado, arriba y abajo, para pedidos nuevos. La pesca no da kilos exactos: sin tolerancia, cualquier embarque incumple el contrato.'),
  ('proforma_documentos',
   'COMMERCIAL INVOICE|PACKING LIST|BILL OF LADING|HEALTH CERTIFICATE|CERTIFICATE OF ORIGIN',
   'texto', 'comercial', 'Documentos que se emiten', 'gerencia',
   'Documentos que la empresa se compromete a emitir, separados por barra vertical. Se imprimen en la proforma: es la lista que el banco del comprador exige para liberar el pago.'),
  ('proforma_condiciones',
   'INSURANCE TO BE COVERED BY BUYER TO THE FULL AMOUNT OF INVOICE|CONTRACTS SUBJECT TO CATCH AND FORCE MAJEURE|ALL TERMS FINAL AT INVOICE',
   'texto', 'comercial', 'Condiciones del contrato', 'gerencia',
   'Condiciones del contrato de venta, separadas por barra vertical. «Subject to catch» es la que protege a la empresa cuando la pesca no alcanza.')
on conflict (clave) do nothing;

--  El membrete real de la proforma que mandó el cliente. La dirección que
--  teníamos —Chimbote— no es la de la planta que exporta.
update parametros set valor = 'TIERRA COLORADA S/N, ZONA INDUSTRIAL III - PAITA - PIURA'
 where clave = 'empresa_direccion';


-- ────────────────────────────────────────────────────────────────────────────
--  9 · UN DESCUADRE QUE SALIÓ AL SEPARAR EL DATO
-- ────────────────────────────────────────────────────────────────────────────
--  Al partir «3 X 7 KG» en bloques y peso apareció una presentación que no
--  cuadra: PLACAS15 KG#3 dice «2 X 15 KG» —que son 30 kilos— pero el saco pesa
--  15. Está en 39 líneas de pedido.
--
--  Manda `peso_bulto_kg`, que es el que usa todo el sistema para calcular
--  pesos, reservas y carga de contenedor; el texto es lo que estaba mal
--  escrito. Dos bloques en un saco de 15 kilos son de 7,5 cada uno.
--
--  Mientras el dato vivía dentro de una frase, nadie podía verlo. Es la razón
--  de separarlo.
update presentaciones
   set descripcion       = '2 X 7.5 KG',
       bloques_por_bulto = 2,
       peso_bloque_kg    = 7.5
 where codigo = 'PLACAS15 KG#3';

--  Y para que no vuelva a pasar: si se declaran bloques, tienen que sumar el
--  peso del saco. Se admite un gramo de diferencia por el redondeo.
alter table presentaciones drop constraint if exists presentaciones_bloques_cuadran;
alter table presentaciones add constraint presentaciones_bloques_cuadran
  check (
    bloques_por_bulto is null
    or peso_bloque_kg is null
    or abs(bloques_por_bulto * peso_bloque_kg - peso_bulto_kg) <= 0.001
  );

comment on constraint presentaciones_bloques_cuadran on presentaciones is
  'Los bloques declarados tienen que sumar el peso del saco. Sin esto, una presentación puede decir «2 X 15 KG» en un saco de 15 kilos y nadie se entera: el texto se imprime en la proforma y el peso se usa para calcular la carga.';


-- ────────────────────────────────────────────────────────────────────────────
--  10 · DIRECCIONES DE LOS COMPRADORES
-- ────────────────────────────────────────────────────────────────────────────
--  La columna acaba de nacer vacía y la proforma la necesita. Se rellena con
--  direcciones verosímiles del país de cada cliente —los datos de esta base son
--  de demostración— para que el documento se pueda revisar completo.
--
--  Cuando llegue el maestro de clientes real, estas direcciones se pisan: por
--  eso el relleno solo toca las que están vacías.
update clientes set direccion = case pais
    when 'China'          then 'NO. ' || (100 + (id * 7) % 800) || ' HUANGHAI AVENUE, ECONOMIC AND TECHNOLOGICAL DEVELOPMENT ZONE, ' ||
                               (array['DALIAN, LIAONING','QINGDAO, SHANDONG','ZHOUSHAN, ZHEJIANG','FUZHOU, FUJIAN'])[1 + id % 4] || ' PROVINCE, CHINA'
    when 'Estados Unidos' then (1000 + (id * 13) % 8000) || ' ' ||
                               (array['HARBOR BLVD','SEAFOOD WAY','COMMERCE DR','PORT AVE'])[1 + id % 4] || ', ' ||
                               (array['LOS ANGELES, CA 90731','SEATTLE, WA 98104','MIAMI, FL 33122','NEWARK, NJ 07105'])[1 + id % 4] || ', USA'
    when 'España'         then 'CALLE ' || (array['MUELLE PESQUERO','PUERTO NORTE','LA MARINA','ATUNEROS'])[1 + id % 4] || ' ' ||
                               (1 + (id * 3) % 90) || ', ' ||
                               (array['36202 VIGO','08039 BARCELONA','28053 MADRID','04002 ALMERIA'])[1 + id % 4] || ', ESPAÑA'
    when 'Rusia'          then (array['ULITSA PORTOVAYA','PROSPEKT MIRA','NABEREZHNAYA'])[1 + id % 3] || ' ' || (1 + (id * 5) % 60) || ', ' ||
                               (array['VLADIVOSTOK 690003','MURMANSK 183038','SAINT PETERSBURG 199106'])[1 + id % 3] || ', RUSSIA'
    when 'Perú'           then (array['AV. ARGENTINA','AV. NESTOR GAMBETTA','CAL. LOS FRUTALES','AV. ELMER FAUCETT'])[1 + id % 4] || ' NRO. ' ||
                               (100 + (id * 11) % 3000) || ', ' ||
                               (array['CALLAO','LIMA','PAITA, PIURA','CHIMBOTE, ANCASH'])[1 + id % 4] || ', PERU'
    else 'PORT AREA ' || (1 + (id * 3) % 40) || ', ' || upper(pais)
  end
 where direccion is null or btrim(direccion) = '';


-- ────────────────────────────────────────────────────────────────────────────
--  11 · EL IDENTIFICADOR FISCAL DE LOS COMPRADORES DEL EXTRANJERO
-- ────────────────────────────────────────────────────────────────────────────
--  La proforma de prueba salía con el aviso «el cliente no tiene Tax ID
--  registrado», y tenía razón: ningún cliente extranjero lo tenía. Sin ese
--  número la aduana de destino no puede despachar la carga.
--
--  Se generan con el formato real de cada país —el USCI chino son 18
--  caracteres, el EIN estadounidense 9 dígitos con guion— para que la
--  verificación del documento se pueda probar de verdad. Son de demostración y
--  se pisan cuando llegue el maestro real.
update clientes set ruc_tax_id = case pais
    when 'China'          then '91' || lpad(((id * 373) % 1000000)::text, 6, '0') || 'MA' ||
                               upper(substr(md5(razon_social), 1, 9))
    when 'Estados Unidos' then lpad(((id * 97) % 100)::text, 2, '0') || '-' ||
                               lpad(((id * 1327) % 10000000)::text, 7, '0')
    when 'España'         then 'ES' || chr((65 + (id % 26))::int) || lpad(((id * 811) % 100000000)::text, 8, '0')
    when 'Rusia'          then lpad(((id * 5077) % 10000000000)::text, 10, '0')
    when 'Corea del Sur'  then lpad(((id * 311) % 1000)::text, 3, '0') || '-' ||
                               lpad(((id * 17) % 100)::text, 2, '0') || '-' ||
                               lpad(((id * 929) % 100000)::text, 5, '0')
    when 'Japón'          then lpad(((id * 7919) % 10000000000000)::text, 13, '0')
    else upper(substr(md5(razon_social), 1, 12))
  end
 where ruc_tax_id is null or btrim(ruc_tax_id) = '';
