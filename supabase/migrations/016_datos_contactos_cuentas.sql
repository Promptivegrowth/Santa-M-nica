-- ============================================================================
--  016 · DATOS DE ARRANQUE PARA CONTACTOS Y CUENTAS
-- ============================================================================
--  Ficticios, como todo el resto de la demostración. Sirven para que las dos
--  secciones nuevas de la cotización se vean llenas desde el primer momento en
--  lugar de con un «sin datos» que no enseña nada.
-- ============================================================================

/* ---------------------------------------------------------------------------
   CUENTAS DE COBRO DE SANTA MÓNICA
   ---------------------------------------------------------------------------
   Cuatro, que son las que tiene cualquier exportador peruano:

     · una en dólares, donde entra el 98 % de lo que factura;
     · una en soles, para la venta nacional;
     · la de detracción en el Banco de la Nación, obligatoria por el régimen
       de detracciones (SPOT);
     · una segunda en dólares en otro banco, porque ningún exportador cobra
       por un solo banco.
   --------------------------------------------------------------------------- */
insert into cuentas_bancarias (banco, tipo, moneda, numero, cci, swift, titular, principal, activo, observaciones)
values
  ('BBVA Perú', 'corriente', 'USD', '0011-0234-0100056789-41',
   '011-234-000100056789-41', 'BCONPEPL',
   'INDUSTRIAL PESQUERA SANTA MÓNICA S.A.C.', true, true,
   'Cuenta principal de cobro para exportaciones.'),

  ('BBVA Perú', 'corriente', 'PEN', '0011-0234-0100056790-05',
   '011-234-000100056790-05', 'BCONPEPL',
   'INDUSTRIAL PESQUERA SANTA MÓNICA S.A.C.', true, true,
   'Cuenta de cobro para venta al mercado nacional.'),

  ('Banco de la Nación', 'detraccion', 'PEN', '00-068-123456',
   '018-068-000123456-18', null,
   'INDUSTRIAL PESQUERA SANTA MÓNICA S.A.C.', true, true,
   'Cuenta de detracciones (SPOT). El comprador nacional deposita aquí el porcentaje que le corresponde retener.'),

  ('Banco de Crédito del Perú', 'corriente', 'USD', '193-9876543-1-92',
   '002-193-009876543192-15', 'BCPLPEPL',
   'INDUSTRIAL PESQUERA SANTA MÓNICA S.A.C.', false, true,
   'Cuenta alterna en dólares.')
on conflict do nothing;

/* ---------------------------------------------------------------------------
   CONTACTOS DE LOS CLIENTES
   ---------------------------------------------------------------------------
   A cada cliente activo se le crean dos: quien compra y quien coordina el
   embarque. Es el reparto real en una importadora, y es lo que hace útil
   poder elegir a cuál se dirige la cotización.

   Los nombres se arman con el código del cliente para que sean distintos
   entre sí y reconocibles, sin fingir que son personas reales.
   --------------------------------------------------------------------------- */
insert into contactos (cliente_id, nombre, cargo, telefono, email, principal, activo)
select
  c.id,
  'Contacto comercial ' || c.codigo,
  'Jefe de Compras',
  '+51 9' || lpad((c.id * 7919 % 100000000)::text, 8, '0'),
  'compras.' || lower(replace(c.codigo, ' ', '')) || '@ejemplo.com',
  true,
  true
from clientes c
where c.activo
  and not exists (select 1 from contactos x where x.cliente_id = c.id and x.principal);

insert into contactos (cliente_id, nombre, cargo, telefono, email, principal, activo)
select
  c.id,
  'Contacto logístico ' || c.codigo,
  'Coordinador de Importaciones',
  '+51 9' || lpad((c.id * 6131 % 100000000)::text, 8, '0'),
  'logistica.' || lower(replace(c.codigo, ' ', '')) || '@ejemplo.com',
  false,
  true
from clientes c
where c.activo
  and (select count(*) from contactos x where x.cliente_id = c.id) < 2;

/* ---------------------------------------------------------------------------
   Y se enganchan a lo que ya existe
   ---------------------------------------------------------------------------
   Las cotizaciones y pedidos que ya estaban en el sistema se quedan con el
   contacto principal de su cliente y con las cuentas marcadas como
   principales. Sin esto, las secciones nuevas saldrían vacías en todos los
   documentos anteriores y parecería que no funcionan.
   --------------------------------------------------------------------------- */
update cotizaciones co
   set contacto_id       = ct.id,
       contacto_nombre   = ct.nombre,
       contacto_cargo    = ct.cargo,
       contacto_telefono = ct.telefono,
       contacto_email    = ct.email
  from contactos ct
 where ct.cliente_id = co.cliente_id
   and ct.principal
   and co.contacto_id is null;

update pedidos pe
   set contacto_id       = ct.id,
       contacto_nombre   = ct.nombre,
       contacto_cargo    = ct.cargo,
       contacto_telefono = ct.telefono,
       contacto_email    = ct.email
  from contactos ct
 where ct.cliente_id = pe.cliente_id
   and ct.principal
   and pe.contacto_id is null;

-- Las cuentas que se muestran: la que coincide con la moneda del documento,
-- más la de detracción cuando el cliente es peruano.
insert into cotizacion_cuentas (cotizacion_id, cuenta_id)
select co.id, cu.id
from cotizaciones co
join clientes cl on cl.id = co.cliente_id
join cuentas_bancarias cu on cu.activo and cu.principal
where (cu.moneda = co.moneda and cu.tipo <> 'detraccion')
   or (cu.tipo = 'detraccion' and cl.pais = 'Perú')
on conflict do nothing;

insert into pedido_cuentas (pedido_id, cuenta_id)
select pe.id, cu.id
from pedidos pe
join clientes cl on cl.id = pe.cliente_id
join cuentas_bancarias cu on cu.activo and cu.principal
where (cu.moneda = pe.moneda and cu.tipo <> 'detraccion')
   or (cu.tipo = 'detraccion' and cl.pais = 'Perú')
on conflict do nothing;
