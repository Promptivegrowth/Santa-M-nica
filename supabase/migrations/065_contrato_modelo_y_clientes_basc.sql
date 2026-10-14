-- ============================================================================
--  065 · CONTRATO INSTITUCIONAL Y LISTA DE CLIENTES BASC
-- ============================================================================
--  Oliver respondió las preguntas de octubre y mandó dos documentos:
--
--   1. El MODELO DE CONTRATO (Word, contrato SM26-378). Reemplaza la plantilla
--      provisional de la 064. El contrato nace de la proforma —su número es el
--      de la proforma: SM26-378 → SM-2026-378— y guarda los datos con que se
--      generó, para que el PDF y el Word de mañana digan lo mismo.
--
--   2. La LISTA DE CLIENTES – VERIFICACIÓN BASC de Comex (formato
--      BASC.F.15.01): por cliente, sus datos, su forma de pago habitual y las
--      verificaciones de seguridad (Lista Clinton, ONU terrorismo, ONU armas,
--      acuerdo de seguridad). Aquí van las columnas y la tabla; la carga de
--      los 74 clientes la hace scripts/importar-clientes-comex.mjs.
--
--  Re-ejecutable.
-- ============================================================================


-- ============================================================================
--  1. CONTRATOS: de la proforma, con revisión y datos
-- ============================================================================
do $$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'contratos' and column_name = 'pedido_id') then
    alter table contratos
      add column pedido_id bigint references pedidos(id) on delete restrict,
      add column revision  int not null default 0 check (revision >= 0),
      add column datos     jsonb;
    alter table contratos alter column cotizacion_id drop not null;
    alter table contratos alter column cuerpo drop not null;
  end if;
end $$;
create index if not exists contratos_pedido_idx on contratos (pedido_id, revision);
comment on column contratos.datos is
  'Los campos variables tal como se generaron (065). El texto fijo es el del modelo institucional.';

--  Una revisión por número dentro del mismo pedido.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contratos_pedido_revision_unica') then
    alter table contratos add constraint contratos_pedido_revision_unica unique (pedido_id, revision);
  end if;
end $$;

--  La firma del contrato: en el modelo es un BLOQUE —el trazo y debajo el
--  nombre, el cargo, la empresa y el RUC—, distinto de la firma suelta de la
--  proforma. Se sube desde Configuración; vacía, se usa la de la proforma.
insert into parametros (clave, valor, tipo_dato, grupo, etiqueta, descripcion, unidad, editable_por) values
  ('firmante_firma_contrato', '', 'texto', 'empresa', 'Firma del contrato (con nombre y cargo)',
   'Imagen PNG o JPG del bloque de firma del contrato de venta, como en el modelo: trazo, nombre, cargo, empresa y RUC.', null, 'gerencia')
on conflict (clave) do nothing;

--  La plantilla de texto provisional de la 064 deja de usarse: ahora manda el
--  modelo de Santa Mónica (plantillas/contrato-venta.docx).
delete from plantillas_documento where clave = 'contrato_venta';


-- ============================================================================
--  2. CLIENTES: lo que trae la lista BASC de Comex
-- ============================================================================
do $$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'clientes' and column_name = 'continente') then
    alter table clientes
      add column continente             text,
      add column web                    text,
      add column condicion              text,
      add column forma_pago_habitual    text,
      add column forma_pago             text check (forma_pago in ('contado', 'adelanto_saldo', 'credito', 'carta_credito', 'cad')),
      add column adelanto_pct           numeric(5,2) check (adelanto_pct between 0 and 100),
      add column referencias_comerciales text,
      add column productos_interes      text;
  end if;
end $$;
comment on column clientes.forma_pago_habitual is
  'Tal como la escribió Comex en la lista BASC («Transferencia: 20% Adelanto / 80% contra copia de documentos»).';
comment on column clientes.forma_pago is
  'La misma forma de pago, estructurada: se propone al cotizar (065).';

/*
 * Las verificaciones BASC, una fila por control y fecha. Se guardan como
 * historia y no como columnas del cliente porque se repiten: la lista es
 * «Verificación 2026», y el año que viene habrá otra.
 */
create table if not exists cliente_verificaciones (
  id           bigserial primary key,
  cliente_id   bigint not null references clientes(id) on delete cascade,
  control      text not null check (control in ('lista_clinton', 'onu_terrorismo', 'onu_armas', 'acuerdo_seguridad')),
  resultado    text not null,
  fecha        date,
  --  Acuerdo de seguridad: cuándo se envió y cuándo volvió firmado.
  enviado_el   date,
  firmado_el   date,
  responsable  text,
  fuente       text not null default 'manual',
  creado_por   uuid references usuarios(id),
  creado_en    timestamptz not null default now(),
  unique (cliente_id, control, fecha)
);
create index if not exists cliente_verificaciones_cliente_idx on cliente_verificaciones (cliente_id, control, fecha desc);

alter table cliente_verificaciones enable row level security;
drop policy if exists "verificaciones_lectura"   on cliente_verificaciones;
drop policy if exists "verificaciones_escritura" on cliente_verificaciones;
create policy "verificaciones_lectura" on cliente_verificaciones for select to authenticated using (true);
create policy "verificaciones_escritura" on cliente_verificaciones for all to authenticated
  using (puede('gerencia', 'operaciones', 'comercial', 'comex'))
  with check (puede('gerencia', 'operaciones', 'comercial', 'comex'));

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'audit_cliente_verificaciones') then
    create trigger audit_cliente_verificaciones after insert or update or delete on cliente_verificaciones
      for each row execute function auditar_cambios();
  end if;
end $$;

--  La última verificación de cada control, por cliente: es lo que se mira.
create or replace view v_cliente_basc as
select c.id as cliente_id,
       max(v.fecha) filter (where v.control = 'lista_clinton')     as clinton_fecha,
       (array_agg(v.resultado order by v.fecha desc nulls last) filter (where v.control = 'lista_clinton'))[1]  as clinton,
       max(v.fecha) filter (where v.control = 'onu_terrorismo')    as onu_terrorismo_fecha,
       (array_agg(v.resultado order by v.fecha desc nulls last) filter (where v.control = 'onu_terrorismo'))[1] as onu_terrorismo,
       max(v.fecha) filter (where v.control = 'onu_armas')         as onu_armas_fecha,
       (array_agg(v.resultado order by v.fecha desc nulls last) filter (where v.control = 'onu_armas'))[1]      as onu_armas,
       (array_agg(v.resultado order by v.fecha desc nulls last) filter (where v.control = 'acuerdo_seguridad'))[1] as acuerdo,
       max(v.enviado_el) filter (where v.control = 'acuerdo_seguridad') as acuerdo_enviado,
       max(v.firmado_el) filter (where v.control = 'acuerdo_seguridad') as acuerdo_firmado,
       --  Al día: las tres listas consultadas en el último año, sin alertas, y el acuerdo firmado.
       (    coalesce(max(v.fecha) filter (where v.control = 'lista_clinton'),  '1900-01-01') >= current_date - 365
        and coalesce(max(v.fecha) filter (where v.control = 'onu_terrorismo'), '1900-01-01') >= current_date - 365
        and coalesce(max(v.fecha) filter (where v.control = 'onu_armas'),      '1900-01-01') >= current_date - 365
        and coalesce((array_agg(v.resultado order by v.fecha desc nulls last) filter (where v.control = 'lista_clinton'))[1], '') ilike 'ok%'
        and coalesce((array_agg(v.resultado order by v.fecha desc nulls last) filter (where v.control = 'onu_terrorismo'))[1], '') ilike 'negativo%'
        and coalesce((array_agg(v.resultado order by v.fecha desc nulls last) filter (where v.control = 'onu_armas'))[1], '') ilike 'negativo%'
        and max(v.firmado_el) filter (where v.control = 'acuerdo_seguridad') is not null
       ) as al_dia
  from clientes c
  left join cliente_verificaciones v on v.cliente_id = c.id
 group by c.id;
alter view v_cliente_basc set (security_invoker = true);


-- ============================================================================
--  3. LA LISTA DE CLIENTES CON SU ESTADO BASC
-- ============================================================================
--  La pantalla de clientes lee esta vista: los clientes y, al final, si su
--  verificación está al día. Columnas nuevas al final, como manda una vista.
-- ============================================================================
create or replace view v_clientes_lista as
select c.*,
       b.al_dia                       as basc_al_dia,
       (b.clinton is not null)        as basc_verificado,
       greatest(b.clinton_fecha, b.onu_terrorismo_fecha, b.onu_armas_fecha) as basc_ultima
  from clientes c
  left join v_cliente_basc b on b.cliente_id = c.id;
alter view v_clientes_lista set (security_invoker = true);
