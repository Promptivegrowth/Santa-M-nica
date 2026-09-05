-- ============================================================================
--  024 · APROBACIÓN, VENCIMIENTO Y PRIORIDAD DE LA COTIZACIÓN
-- ============================================================================
--  Tres peticiones de la reunión con Oliver, que resuelven tres agujeros
--  distintos del mismo documento:
--
--  1 · APROBACIÓN
--      «Sería de que haya una aprobación de la cotización [...] para poder ser
--      enviada al cliente necesita aprobarse.»
--      Hasta ahora cualquiera podía pasar una oferta de borrador a enviada. El
--      precio es lo único que la empresa no puede deshacer después de que el
--      cliente lo vea.
--
--  2 · VENCIMIENTO
--      El campo `validez_dias` se guardaba desde el principio y no lo miraba
--      nadie: no había fecha de caducidad calculada, ni aviso, ni forma de que
--      una oferta olvidada se cerrara sola. Quedaba «enviada» para siempre y
--      ensuciaba el indicador de conversión.
--
--  3 · PRIORIDAD
--      «¿Cómo le podemos dar prioridad a ciertas proformas?» Se marca desde la
--      cotización, que es donde se conoce la urgencia del cliente, y viaja al
--      pedido al convertirla.
-- ============================================================================


-- ============================================================================
--  1. LAS COLUMNAS NUEVAS
-- ============================================================================
alter table cotizaciones
  add column if not exists aprobada_por uuid references usuarios(id),
  add column if not exists aprobada_en  timestamptz,
  add column if not exists prioridad    prioridad not null default 'normal';

comment on column cotizaciones.aprobada_por is
  'Quién autorizó que esta oferta saliera al cliente. Nulo mientras no se apruebe.';
comment on column cotizaciones.aprobada_en is
  'Cuándo se aprobó. Con aprobada_por forma la firma: sin los dos, la oferta no puede enviarse.';
comment on column cotizaciones.prioridad is
  'Urgencia pactada con el cliente. Viaja al pedido al convertir la cotización.';


-- ============================================================================
--  2. LA FECHA DE VENCIMIENTO, CALCULADA
--  Columna generada: no se escribe, se deduce. Así no puede quedar desfasada
--  respecto a `validez_dias`, que es exactamente lo que pasa cuando una fecha
--  de caducidad se guarda a mano y luego alguien cambia el plazo.
-- ============================================================================
alter table cotizaciones
  add column if not exists vence_el date
  generated always as (fecha + validez_dias) stored;

comment on column cotizaciones.vence_el is
  'Hasta cuándo se mantiene el precio ofrecido. Se calcula sola: fecha + validez_dias.';

create index if not exists idx_cotizaciones_vence on cotizaciones(vence_el)
  where estado in ('aprobada', 'enviada');


-- ============================================================================
--  3. ¿LA APROBACIÓN ES OBLIGATORIA?
--  Como todo lo demás en este sistema, es una decisión del negocio y vive en
--  Configuración, no en el código. La empresa nunca ha trabajado con
--  cotizaciones —hacía proformas directas— así que puede querer rodar sin el
--  control mientras se acostumbra, y encenderlo después.
-- ============================================================================
insert into parametros (clave, valor, tipo_dato, grupo, etiqueta, descripcion, unidad, editable_por)
values
  ('cotizacion_requiere_aprobacion', 'si', 'texto', 'comercial',
   'La cotización necesita aprobación',
   'Si está en «si», una oferta no se puede enviar al cliente hasta que Gerencia la apruebe. El precio es lo único que no se puede deshacer después de que el cliente lo vea.',
   null, 'gerencia'),
  ('cotizacion_aviso_vencimiento_dias', '3', 'numero', 'comercial',
   'Aviso previo al vencimiento de la cotización',
   'Con cuántos días de anticipación se avisa que una oferta está por caducar.',
   'días', 'comercial')
on conflict (clave) do nothing;


-- ============================================================================
--  4. LO QUE YA EXISTÍA SE DA POR APROBADO
--  Una cotización que ya salió al cliente pasó por esa decisión, aunque el
--  sistema no la registrara. Dejarlas sin firma haría que todo el histórico
--  apareciera como pendiente de aprobar, que es peor que no tener el dato.
-- ============================================================================
do $$
declare v_gerencia uuid; v_n int;
begin
  select id into v_gerencia from usuarios where rol = 'gerencia' order by id limit 1;

  update cotizaciones
     set aprobada_por = coalesce(aprobada_por, v_gerencia),
         aprobada_en  = coalesce(aprobada_en, fecha::timestamptz)
   where estado in ('enviada', 'aceptada', 'rechazada', 'vencida')
     and aprobada_en is null;
  get diagnostics v_n = row_count;

  raise notice 'Cotizaciones del histórico marcadas como aprobadas: %', v_n;
end $$;


-- ============================================================================
--  5. LAS OFERTAS CADUCAN SOLAS
--  El mismo patrón que las reservas: si nadie la atendió dentro del plazo, se
--  cierra y deja de contaminar el embudo comercial. Una oferta «enviada» de
--  hace ocho meses no está esperando respuesta, está muerta.
-- ============================================================================
create or replace function cotizaciones_expirar_vencidas()
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  with vencidas as (
    update cotizaciones
       set estado = 'vencida'
     where estado in ('aprobada', 'enviada')
       and vence_el is not null
       and vence_el < current_date
    returning id, numero
  )
  select count(*) into v_n from vencidas;

  if v_n > 0 then
    insert into alertas (entidad, entidad_id, severidad, titulo, mensaje)
    values ('cotizacion', 0, 'info', 'Cotizaciones vencidas',
            format('%s ofertas pasaron su plazo de validez sin respuesta y se cerraron. El precio ofrecido ya no se sostiene.', v_n));
  end if;
  return v_n;
end $$;

comment on function cotizaciones_expirar_vencidas is
  'Cierra las ofertas que pasaron su validez. Sin esto, el embudo comercial cuenta como vivas ofertas de hace meses.';


-- ============================================================================
--  6. AVISO DE LAS QUE ESTÁN POR VENCER
--  Se pidió que la alerta la vea Comercial, que es quien puede hacer algo:
--  llamar al cliente, o renovar el precio antes de perderlo.
-- ============================================================================
create or replace function cotizaciones_avisar_por_vencer()
returns int language plpgsql security definer set search_path = public as $$
declare v_dias int; v_n int;
begin
  select coalesce(nullif(valor,'')::int, 3) into v_dias
    from parametros where clave = 'cotizacion_aviso_vencimiento_dias';
  if v_dias is null then v_dias := 3; end if;

  select count(*) into v_n
    from cotizaciones
   where estado in ('aprobada', 'enviada')
     and vence_el between current_date and current_date + v_dias;

  if v_n > 0 then
    insert into alertas (entidad, entidad_id, severidad, titulo, mensaje)
    select 'cotizacion', 0, 'advertencia', 'Cotizaciones por vencer',
           format('%s ofertas caducan en los próximos %s días. Conviene llamar al cliente antes de perder el precio.', v_n, v_dias)
     where not exists (
       select 1 from alertas
        where entidad = 'cotizacion' and titulo = 'Cotizaciones por vencer'
          and not atendida and generada_en > now() - interval '20 hours'
     );
  end if;
  return v_n;
end $$;

comment on function cotizaciones_avisar_por_vencer is
  'Avisa a Comercial de las ofertas que caducan pronto. No repite el aviso si ya hay uno abierto del día.';
