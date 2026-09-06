-- ============================================================================
--  044 · QUIÉN FIRMA LA PROFORMA
-- ============================================================================
--  EL HUECO
--  La proforma que manda el cliente lleva, bajo la raya del vendedor, la firma
--  escaneada de la persona que firma, su nombre, su cargo y el RUC de la
--  empresa. La nuestra solo tenía la raya y la razón social.
--
--  No es un detalle de maquetación. Un contrato de venta dice QUIÉN se obliga
--  en nombre de la empresa: el comprador y su banco necesitan saber que quien
--  firmó tenía facultad para hacerlo. Una raya sin nombre no dice nada.
--
--  POR QUÉ CONFIGURABLE Y NO EN EL CÓDIGO
--  Porque la persona cambia. Escribir «Cathy Lee» dentro del PDF significa que
--  el día que ascienda, se vaya o firme otro por vacaciones, hay que tocar el
--  código y volver a desplegar para emitir una proforma. Eso no es una opción
--  en un documento que sale todos los días.
--
--  LA FIRMA ESCANEADA, DENTRO DE LA BASE
--  Se guarda como imagen incrustada (data URI) en el propio parámetro, no como
--  archivo suelto en el servidor. Tres razones:
--
--   · Viaja con la copia de seguridad. Una firma en disco se pierde en el
--     primer redespliegue y nadie se entera hasta que sale una proforma sin
--     ella.
--   · No hace falta montar almacenamiento de archivos solo para esto.
--   · Y se controla igual que el resto: quien puede cambiar los datos de la
--     empresa puede cambiar la firma, y nadie más.
--
--  Es una imagen pequeña —una firma recortada son unas decenas de kilobytes—,
--  así que cabe de sobra en un campo de texto. El límite de tamaño lo pone la
--  pantalla que la sube, que es donde se puede avisar al usuario.
-- ============================================================================
insert into parametros (clave, valor, tipo_dato, grupo, etiqueta, editable_por, descripcion) values
  ('firmante_nombre', 'Cathy Lee', 'texto', 'empresa', 'Quién firma las proformas', 'gerencia',
   'Nombre de la persona que firma los contratos de venta en nombre de la empresa. Va impreso bajo la firma, porque el comprador y su banco necesitan saber quién se obligó.'),

  ('firmante_cargo', 'Jefe Comercial y Exportaciones', 'texto', 'empresa', 'Cargo de quien firma', 'gerencia',
   'Cargo de la persona que firma. Es lo que acredita ante el comprador que tenía facultad para hacerlo.'),

  ('firmante_firma', '', 'texto', 'empresa', 'Firma escaneada', 'gerencia',
   'La firma escaneada, incrustada como imagen. Se sube desde esta misma pantalla. Si se deja vacía, la proforma sale con la raya para firmar a mano, que es igual de válido.')
on conflict (clave) do nothing;

--  El único parámetro del sistema que puede quedar vacío a propósito: una
--  empresa que prefiera firmar a mano no debería verse obligada a subir una
--  imagen para poder emitir.
comment on table parametros is
  'Los ajustes del negocio que el cliente cambia sin tocar código. Todos exigen un valor salvo «firmante_firma», que vacío significa «se firma a mano».';
