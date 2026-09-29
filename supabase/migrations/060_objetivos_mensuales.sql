-- ============================================================================
--  060 · OBJETIVOS MENSUALES (y un agujero de permisos que había que cerrar)
-- ============================================================================
--  Oliver: «habría que aumentar un módulo que diga Objetivos mensuales, que
--  solo lo pueda visualizar Marco y mi persona». Es su Excel «Objetivos 2026»
--  —«COMPROMISOS PARA EL ÉXITO PSTM»—: unos cincuenta indicadores de la
--  operación, mes a mes. Sus respuestas:
--
--    1. Objetivos mensuales y anuales, con un valor ESPERADO y un MÁXIMO.
--    2. Fuera los restos de plantilla (harina, camarón, hoja «Mejoras»…).
--    3. Lo que el ERP ya sabe, que lo alimente el ERP.
--    4. Tipo de cambio fijo y configurable.
--    5. Los valores de junio y julio que parecían copiados son reales.
--    6. Lo ven Marco y él. Nadie más.
-- ============================================================================


-- ============================================================================
--  0. EL AGUJERO: CUALQUIERA PODÍA CAMBIARSE EL ROL
--  La política «usuario_propio» (006) deja a cada uno actualizar su propia
--  fila —para su nombre, sus preferencias—, pero no limita QUÉ columnas. Se
--  comprobó con el usuario de Consulta: `update usuarios set rol='gerencia'`
--  sobre sí mismo funcionaba. Y todos los permisos del sistema salen de esa
--  columna.
--
--  PostgreSQL protege filas, no columnas, así que se cierra con un disparador:
--  las columnas que dan poder solo las cambia quien tiene autoridad para ello.
--  Sin sesión (migraciones, mantenimiento) no se aplica.
-- ============================================================================
create or replace function usuarios_proteger_permisos()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_quien uuid := auth.uid();
  v_rol   rol_usuario;
begin
  if v_quien is null then
    return new;
  end if;
  select rol into v_rol from usuarios where id = v_quien;

  if (new.rol, new.activo, new.almacen_id, new.aprueba_cotizaciones)
     is distinct from (old.rol, old.activo, old.almacen_id, old.aprueba_cotizaciones)
     and v_rol is distinct from 'gerencia' then
    raise exception 'Solo Gerencia puede cambiar el rol, el estado, el almacén o la facultad de aprobar de un usuario.';
  end if;

  if new.ve_objetivos is distinct from old.ve_objetivos
     and not coalesce((select ve_objetivos from usuarios where id = v_quien), false) then
    raise exception 'Solo quien ya tiene acceso a Objetivos mensuales puede darlo o quitarlo.';
  end if;

  return new;
end $$;


-- ============================================================================
--  1. QUIÉN VE LOS OBJETIVOS
--  Por persona, no por rol: «Marco y mi persona». Otro gerente u otro jefe de
--  operaciones no lo vería. Se marca a mano, como los aprobadores (048).
-- ============================================================================
alter table usuarios add column if not exists ve_objetivos boolean not null default false;
comment on column usuarios.ve_objetivos is
  'Puede ver y editar Objetivos mensuales. Por persona: lo pidió Oliver para Marco y para él. Solo quien ya lo tiene puede darlo.';

--  Los dos de hoy. Por correo, que es lo que identifica a la persona.
update usuarios set ve_objetivos = true
 where email in ('gerencia@santamonica.pe', 'operaciones@santamonica.pe') and not ve_objetivos;

drop trigger if exists trg_usuarios_proteger_permisos on usuarios;
create trigger trg_usuarios_proteger_permisos
  before update on usuarios
  for each row execute function usuarios_proteger_permisos();

create or replace function puede_ver_objetivos() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select ve_objetivos and activo from usuarios where id = auth.uid()), false);
$$;


-- ============================================================================
--  2. LOS INDICADORES
--  Cada fila del Excel, con lo que hace falta para calcularla bien:
--
--    tipo = manual     lo digita Oliver (costos, materia prima…)
--           erp        lo calcula el sistema (fuente)
--           calculado  sale de otros indicadores: (Σ numerador ÷ Σ denominador)
--                      × factor, y ÷ tipo de cambio si pasa soles a dólares
--
--    agregacion (la columna del año)
--           suma       volúmenes y costos
--           promedio   precios y tarifas
--           primero    saldos de inicio de mes (inventario inicial)
--           ratio      el ratio del año = Σ numeradores ÷ Σ denominadores,
--                      no el promedio de los ratios mensuales
--
--    sentido  menor = mejor (costos), mayor = mejor (volúmenes), o
--             informativo (sin semáforo)
-- ============================================================================
create table if not exists objetivos_indicadores (
  id           bigserial primary key,
  codigo       text not null unique,
  nombre       text not null,
  bloque       text not null,
  unidad       text not null,
  orden        int not null,
  tipo         text not null check (tipo in ('manual', 'erp', 'calculado')),
  agregacion   text not null check (agregacion in ('suma', 'promedio', 'primero', 'ratio')),
  sentido      text not null check (sentido in ('mayor', 'menor', 'informativo')),
  decimales    int not null default 2,
  fuente       text,
  numerador    text[],
  denominador  text[],
  factor       numeric not null default 1,
  dividir_tc   boolean not null default false,
  descripcion  text,
  activo       boolean not null default true,
  constraint objetivos_ind_erp_con_fuente check (tipo <> 'erp' or fuente is not null),
  constraint objetivos_ind_calc_con_formula check (tipo <> 'calculado' or numerador is not null)
);
comment on table objetivos_indicadores is
  'Catálogo de indicadores de Objetivos mensuales (el Excel «Objetivos 2026» de Oliver), con cómo se obtiene cada uno.';

insert into objetivos_indicadores
  (orden, bloque, codigo, nombre, unidad, tipo, agregacion, sentido, decimales, fuente, numerador, denominador, factor, dividir_tc, descripcion)
values
  -- ── Volúmenes ──
  (10,  'Volúmenes', 'mp_pota',        'Materia prima · pota',            'Tn', 'manual', 'suma', 'informativo', 2, null, null, null, 1, false, null),
  (11,  'Volúmenes', 'mp_bonito',      'Materia prima · bonito',          'Tn', 'manual', 'suma', 'informativo', 2, null, null, null, 1, false, null),
  (12,  'Volúmenes', 'mp_merluza',     'Materia prima · merluza',         'Tn', 'manual', 'suma', 'informativo', 2, null, null, null, 1, false, null),
  (13,  'Volúmenes', 'mp_total',       'Volumen de materia prima',        'Tn', 'calculado', 'suma', 'mayor', 2, null, '{mp_pota,mp_bonito,mp_merluza}', null, 1, false, null),
  (20,  'Volúmenes', 'pt_stm_pota',    'PT planta propia · pota',         'Tn', 'erp', 'suma', 'informativo', 2, 'pt_propia_pota', null, null, 1, false, 'Ingresos a cámara de lotes de proceso propio.'),
  (21,  'Volúmenes', 'pt_stm_bonito',  'PT planta propia · bonito',       'Tn', 'erp', 'suma', 'informativo', 2, 'pt_propia_bonito', null, null, 1, false, null),
  (22,  'Volúmenes', 'pt_stm_merluza', 'PT planta propia · merluza',      'Tn', 'erp', 'suma', 'informativo', 2, 'pt_propia_merluza', null, null, 1, false, null),
  (23,  'Volúmenes', 'pt_stm_otras',   'PT planta propia · otras especies','Tn', 'erp', 'suma', 'informativo', 2, 'pt_propia_otras', null, null, 1, false, 'El Excel no las tenía; el ERP sí las registra y sin esta fila no cuadraría el total.'),
  (24,  'Volúmenes', 'pt_stm',         'Volumen de PT planta propia (STM)','Tn', 'calculado', 'suma', 'mayor', 2, null, '{pt_stm_pota,pt_stm_bonito,pt_stm_merluza,pt_stm_otras}', null, 1, false, null),
  (30,  'Volúmenes', 'pt_maq_pota',    'PT maquila · pota',               'Tn', 'erp', 'suma', 'informativo', 2, 'pt_maquila_pota', null, null, 1, false, 'Ingresos a cámara de lotes de maquila.'),
  (31,  'Volúmenes', 'pt_maq_bonito',  'PT maquila · bonito',             'Tn', 'erp', 'suma', 'informativo', 2, 'pt_maquila_bonito', null, null, 1, false, null),
  (32,  'Volúmenes', 'pt_maq_merluza', 'PT maquila · merluza',            'Tn', 'erp', 'suma', 'informativo', 2, 'pt_maquila_merluza', null, null, 1, false, null),
  (33,  'Volúmenes', 'pt_maq_otras',   'PT maquila · otras especies',     'Tn', 'erp', 'suma', 'informativo', 2, 'pt_maquila_otras', null, null, 1, false, null),
  (34,  'Volúmenes', 'pt_maq',         'Volumen de PT maquila',           'Tn', 'calculado', 'suma', 'informativo', 2, null, '{pt_maq_pota,pt_maq_bonito,pt_maq_merluza,pt_maq_otras}', null, 1, false, null),
  (40,  'Volúmenes', 'fact_maq_pota',  'PT facturado de maquila · pota',  'Tn', 'manual', 'suma', 'informativo', 2, null, null, null, 1, false, null),
  (41,  'Volúmenes', 'fact_maq_bonito','PT facturado de maquila · bonito','Tn', 'manual', 'suma', 'informativo', 2, null, null, null, 1, false, null),
  (42,  'Volúmenes', 'fact_maq',       'Volumen de PT facturado de maquila','Tn','calculado', 'suma', 'informativo', 2, null, '{fact_maq_pota,fact_maq_bonito}', null, 1, false, null),
  (45,  'Volúmenes', 'part_planta',    '% congelado en planta propia',    '%',  'calculado', 'ratio', 'mayor', 1, null, '{pt_stm}', '{pt_stm,pt_maq}', 100, false, null),
  (46,  'Volúmenes', 'part_maquila',   '% congelado en maquila',          '%',  'calculado', 'ratio', 'menor', 1, null, '{pt_maq}', '{pt_stm,pt_maq}', 100, false, null),
  -- ── Maquila ──
  (50,  'Maquila', 'costo_maquila',    'Costo de maquila facturado',      'USD',    'manual', 'suma', 'informativo', 0, null, null, null, 1, false, null),
  (51,  'Maquila', 'tarifa_frescos',   'Tarifa de maquila · frescos',     'USD/Tn', 'manual', 'promedio', 'menor', 2, null, null, null, 1, false, null),
  (52,  'Maquila', 'tarifa_precocido', 'Tarifa de maquila · precocido',   'USD/Tn', 'manual', 'promedio', 'menor', 2, null, null, null, 1, false, null),
  (53,  'Maquila', 'tarifa_bonito',    'Tarifa de maquila · bonito',      'USD/Tn', 'manual', 'promedio', 'menor', 2, null, null, null, 1, false, null),
  -- ── Inventario ──
  (60,  'Inventario', 'inv_stm',       'Inventario inicial · STM',        'Tn', 'erp', 'primero', 'informativo', 2, 'inv_stm', null, null, 1, false, 'Stock en cámaras propias el día 1 del mes.'),
  (61,  'Inventario', 'inv_freeko',    'Inventario inicial · Freeko',     'Tn', 'erp', 'primero', 'informativo', 2, 'inv_freeko', null, null, 1, false, null),
  (62,  'Inventario', 'inv_otros',     'Inventario inicial · otros almacenes','Tn','erp', 'primero', 'informativo', 2, 'inv_otros', null, null, 1, false, null),
  (63,  'Inventario', 'inv_total',     'Inventario inicial total',        'Tn', 'calculado', 'primero', 'informativo', 2, null, '{inv_stm,inv_freeko,inv_otros}', null, 1, false, null),
  -- ── Fletes ──
  (70,  'Fletes', 'flete_chimbote_paita','Flete Chimbote – Paita',        'USD', 'manual', 'suma', 'informativo', 0, null, null, null, 1, false, null),
  (71,  'Fletes', 'flete_entre_externos','Flete entre almacenes externos','USD', 'manual', 'suma', 'informativo', 0, null, null, null, 1, false, null),
  (72,  'Fletes', 'flete_planta_externo','Flete planta → almacén externo','USD', 'manual', 'suma', 'informativo', 0, null, null, null, 1, false, null),
  (73,  'Fletes', 'sobrecosto_flete',   'Sobrecosto de fletes',           'USD', 'manual', 'suma', 'menor', 0, null, null, null, 1, false, null),
  (74,  'Fletes', 'flete_total',        'Movimiento entre almacenes',     'USD', 'calculado', 'suma', 'menor', 0, null, '{flete_chimbote_paita,flete_entre_externos,flete_planta_externo,sobrecosto_flete}', null, 1, false, 'Incluye el sobrecosto, como en junio y julio del Excel.'),
  (75,  'Fletes', 'viajes_externo',     'Viajes a almacén externo',       'N°',  'manual', 'suma', 'informativo', 0, null, null, null, 1, false, 'En el Excel iba escrito dentro de la fórmula (÷26, ÷49…).'),
  (76,  'Fletes', 'costo_viaje',        'Costo por viaje',                'USD/viaje', 'calculado', 'ratio', 'menor', 2, null, '{flete_total}', '{viajes_externo}', 1, false, null),
  (77,  'Fletes', 'flete_tn',           'Costo de fletes por Tn producida','USD/Tn', 'calculado', 'ratio', 'menor', 2, null, '{flete_total}', '{pt_stm,pt_maq}', 1, false, null),
  (78,  'Fletes', 'servicios_fletes',   'Servicios de fletes',            'S/',  'manual', 'suma', 'informativo', 0, null, null, null, 1, false, null),
  -- ── Embarques ──
  (80,  'Embarques', 'tn_embarcadas',   'Toneladas embarcadas',           'Tn',  'erp', 'suma', 'mayor', 2, 'tn_embarcadas', null, null, 1, false, 'Kilos de los contenedores despachados en el mes.'),
  (81,  'Embarques', 'contenedores',    'Contenedores despachados',       'FCL', 'erp', 'suma', 'mayor', 0, 'contenedores', null, null, 1, false, null),
  (82,  'Embarques', 'tn_contenedor',   'Toneladas por contenedor',       'Tn/FCL', 'calculado', 'ratio', 'mayor', 2, null, '{tn_embarcadas}', '{contenedores}', 1, false, null),
  -- ── Manipuleo ──
  (90,  'Manipuleo', 'estiba_terceros', 'Estiba y etiquetado · terceros', 'S/',  'manual', 'suma', 'informativo', 0, null, null, null, 1, false, null),
  (91,  'Manipuleo', 'tn_terceros',     'Toneladas atendidas por terceros','Tn', 'manual', 'suma', 'informativo', 2, null, null, null, 1, false, null),
  (92,  'Manipuleo', 'estiba_terceros_tn','Estiba y etiquetado por Tn · terceros','S/Tn','calculado', 'ratio', 'menor', 2, null, '{estiba_terceros}', '{tn_terceros}', 1, false, null),
  (93,  'Manipuleo', 'personal_emb',    'Personal propio · embarques',    'S/',  'manual', 'suma', 'informativo', 0, null, null, null, 1, false, null),
  (94,  'Manipuleo', 'tn_movidas_emb',  'Toneladas movidas (embarques y traslados)','Tn','manual', 'suma', 'informativo', 2, null, null, null, 1, false, null),
  (95,  'Manipuleo', 'estiba_propia_tn','Estiba y etiquetado por Tn · personal propio','S/Tn','calculado', 'ratio', 'menor', 2, null, '{personal_emb}', '{tn_movidas_emb}', 1, false, null),
  (96,  'Manipuleo', 'costo_manipuleo', 'Manipuleo en almacén externo',   'S/',  'manual', 'suma', 'informativo', 0, null, null, null, 1, false, null),
  (97,  'Manipuleo', 'tn_movidas_ext',  'Toneladas movidas en almacén externo','Tn','manual', 'suma', 'informativo', 2, null, null, null, 1, false, 'Estiba, etiquetado y reempaque.'),
  (98,  'Manipuleo', 'manipuleo_tn',    'Manipuleo en almacén externo por Tn','S/Tn','calculado', 'ratio', 'menor', 2, null, '{costo_manipuleo}', '{tn_movidas_ext}', 1, false, null),
  (99,  'Manipuleo', 'personal_recep',  'Personal propio · recepción',    'S/',  'manual', 'suma', 'informativo', 0, null, null, null, 1, false, null),
  (100, 'Manipuleo', 'recepcion_tn',    'Recepción por Tn',               'S/Tn','calculado', 'ratio', 'menor', 2, null, '{personal_recep}', '{pt_stm}', 1, false, null),
  (101, 'Manipuleo', 'costo_atender',   'Costo de atender',               'S/Tn','calculado', 'ratio', 'menor', 2, null, '{estiba_terceros,personal_recep}', '{tn_terceros,tn_movidas_emb}', 1, false, null),
  (102, 'Manipuleo', 'manipulacion_total','Costo total de manipulación',  'USD/Tn','calculado', 'ratio', 'menor', 2, null, '{estiba_terceros,personal_emb,costo_manipuleo,personal_recep}', '{pt_stm,pt_maq}', 1, true, 'Soles pasados a dólares con el tipo de cambio fijo de Objetivos.'),
  -- ── Energía ──
  (110, 'Energía', 'energia_kwh_tn',    'Energía eléctrica por Tn',       'kWh/Tn','manual', 'promedio', 'menor', 2, null, null, null, 1, false, null),
  (111, 'Energía', 'precio_kwh',        'Precio de la energía',           'S/kWh', 'manual', 'promedio', 'menor', 3, null, null, null, 1, false, null),
  (112, 'Energía', 'gas_m3',            'Consumo de gas',                 'm³',    'manual', 'suma', 'informativo', 0, null, null, null, 1, false, null),
  (113, 'Energía', 'precio_gas',        'Precio del gas',                 'S/m³',  'manual', 'promedio', 'menor', 4, null, null, null, 1, false, null),
  (114, 'Energía', 'tn_precocido',      'Toneladas de precocido',         'Tn',    'erp', 'suma', 'informativo', 2, 'tn_precocido', null, null, 1, false, 'Ingresos de proceso propio del formato PRECOCIDOS.'),
  (115, 'Energía', 'gas_tn',            'Consumo de gas por Tn de precocido','m³/Tn','calculado', 'ratio', 'menor', 2, null, '{gas_m3}', '{tn_precocido}', 1, false, null),
  -- ── Almacenamiento externo ──
  (120, 'Almacenamiento externo', 'costo_alm_ext','Costo de almacenamiento externo','USD','manual', 'suma', 'informativo', 0, null, null, null, 1, false, null),
  (121, 'Almacenamiento externo', 'tn_alm_ext',   'Toneladas en almacenes externos','Tn', 'erp', 'promedio', 'informativo', 2, 'tn_alm_ext', null, null, 1, false, 'Stock en almacenes externos al cierre del mes.'),
  (122, 'Almacenamiento externo', 'alm_ext_tn',   'Costo por Tn almacenada',        'USD/Tn','calculado', 'ratio', 'menor', 2, null, '{costo_alm_ext}', '{tn_alm_ext}', 1, false, null),
  (123, 'Almacenamiento externo', 'alm_ext_venta','Costo de almacenaje por Tn vendida','USD/Tn','calculado', 'ratio', 'menor', 2, null, '{costo_alm_ext}', '{tn_embarcadas}', 1, false, null),
  (124, 'Almacenamiento externo', 'alm_ext_prod', 'Costo de almacenaje por Tn producida','USD/Tn','calculado', 'ratio', 'menor', 2, null, '{costo_alm_ext}', '{pt_stm,pt_maq}', 1, false, null),
  -- ── Personal ──
  (130, 'Personal', 'alimentacion',     'Alimentación',                   'S/',   'manual', 'suma', 'informativo', 0, null, null, null, 1, false, null),
  (131, 'Personal', 'alimentacion_tn',  'Alimentación por Tn',            'S/Tn', 'calculado', 'ratio', 'menor', 2, null, '{alimentacion}', '{pt_stm}', 1, false, null),
  (132, 'Personal', 'transporte',       'Transporte',                     'S/',   'manual', 'suma', 'informativo', 0, null, null, null, 1, false, null),
  (133, 'Personal', 'transporte_tn',    'Transporte por Tn',              'S/Tn', 'calculado', 'ratio', 'menor', 2, null, '{transporte}', '{pt_stm}', 1, false, null)
on conflict (codigo) do nothing;


-- ============================================================================
--  3. LOS VALORES, LAS METAS Y SU HISTORIAL
--  Un valor digitado en un indicador del ERP o calculado MANDA sobre el
--  cálculo: así entra el histórico del Excel de los meses en que el ERP
--  todavía no existía, y queda marcado en pantalla como «ajuste».
-- ============================================================================
create table if not exists objetivos_valores (
  id             bigserial primary key,
  indicador_id   bigint not null references objetivos_indicadores(id) on delete cascade,
  anio           int not null check (anio between 2000 and 2100),
  mes            int not null check (mes between 1 and 12),
  valor          numeric(18,6) not null,
  observacion    text,
  registrado_por uuid references usuarios(id),
  actualizado_en timestamptz not null default now(),
  unique (indicador_id, anio, mes)
);

--  mes nulo = la meta del AÑO.
create table if not exists objetivos_metas (
  id             bigserial primary key,
  indicador_id   bigint not null references objetivos_indicadores(id) on delete cascade,
  anio           int not null check (anio between 2000 and 2100),
  mes            int check (mes between 1 and 12),
  esperado       numeric(18,6),
  maximo         numeric(18,6),
  registrado_por uuid references usuarios(id),
  actualizado_en timestamptz not null default now(),
  constraint objetivos_meta_con_algo check (esperado is not null or maximo is not null),
  constraint objetivos_meta_orden check (esperado is null or maximo is null or maximo >= esperado)
);
create unique index if not exists objetivos_metas_unica on objetivos_metas (indicador_id, anio, coalesce(mes, 0));

create table if not exists objetivos_historial (
  id             bigserial primary key,
  que            text not null check (que in ('valor', 'meta')),
  indicador_id   bigint not null references objetivos_indicadores(id) on delete cascade,
  anio           int not null,
  mes            int,
  antes          text,
  despues        text,
  usuario_id     uuid,
  usuario_nombre text,
  registrado_en  timestamptz not null default now()
);
create index if not exists idx_obj_hist on objetivos_historial (registrado_en desc);

create or replace function objetivos_registrar_historial()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_usuario uuid := coalesce(auth.uid(), case when tg_op = 'DELETE' then old.registrado_por else new.registrado_por end);
  v_nombre  text;
  v_fila    record := coalesce(new, old);
  v_antes   text;
  v_despues text;
begin
  select nombre into v_nombre from usuarios where id = v_usuario;
  if tg_table_name = 'objetivos_valores' then
    v_antes   := case when tg_op <> 'INSERT' then old.valor::text end;
    v_despues := case when tg_op <> 'DELETE' then new.valor::text end;
  else
    v_antes   := case when tg_op <> 'INSERT' then format('esperado %s · máximo %s', coalesce(old.esperado::text, '—'), coalesce(old.maximo::text, '—')) end;
    v_despues := case when tg_op <> 'DELETE' then format('esperado %s · máximo %s', coalesce(new.esperado::text, '—'), coalesce(new.maximo::text, '—')) end;
  end if;
  if v_antes is not distinct from v_despues then return v_fila; end if;
  insert into objetivos_historial (que, indicador_id, anio, mes, antes, despues, usuario_id, usuario_nombre)
  values (case when tg_table_name = 'objetivos_valores' then 'valor' else 'meta' end,
          v_fila.indicador_id, v_fila.anio, v_fila.mes, v_antes, v_despues, v_usuario, v_nombre);
  return v_fila;
end $$;

drop trigger if exists trg_obj_valores_hist on objetivos_valores;
create trigger trg_obj_valores_hist after insert or update or delete on objetivos_valores
  for each row execute function objetivos_registrar_historial();
drop trigger if exists trg_obj_metas_hist on objetivos_metas;
create trigger trg_obj_metas_hist after insert or update or delete on objetivos_metas
  for each row execute function objetivos_registrar_historial();


-- ============================================================================
--  4. SOLO MARCO Y OLIVER
--  En la base, no en la pantalla: otro usuario que pida estas tablas por la
--  API recibe cero filas y no puede escribir.
-- ============================================================================
alter table objetivos_indicadores enable row level security;
alter table objetivos_valores     enable row level security;
alter table objetivos_metas       enable row level security;
alter table objetivos_historial   enable row level security;

drop policy if exists "objetivos_indicadores" on objetivos_indicadores;
create policy "objetivos_indicadores" on objetivos_indicadores for all to authenticated
  using (puede_ver_objetivos()) with check (puede_ver_objetivos());
drop policy if exists "objetivos_valores" on objetivos_valores;
create policy "objetivos_valores" on objetivos_valores for all to authenticated
  using (puede_ver_objetivos()) with check (puede_ver_objetivos());
drop policy if exists "objetivos_metas" on objetivos_metas;
create policy "objetivos_metas" on objetivos_metas for all to authenticated
  using (puede_ver_objetivos()) with check (puede_ver_objetivos());
drop policy if exists "objetivos_historial" on objetivos_historial;
create policy "objetivos_historial" on objetivos_historial for select to authenticated
  using (puede_ver_objetivos());


-- ============================================================================
--  5. PARÁMETROS
-- ============================================================================
insert into parametros (clave, valor, tipo_dato, grupo, etiqueta, descripcion, unidad, editable_por) values
  ('objetivos_tipo_cambio', '3.4', 'numero', 'sistema', 'Tipo de cambio de Objetivos',
   'Tipo de cambio fijo con el que Objetivos mensuales pasa soles a dólares (costo total de manipulación). Lo pidió Oliver así: fijo y configurable, como en su Excel.',
   'S/ por US$', 'gerencia'),
  ('objetivos_erp_desde', '2026-09', 'texto', 'sistema', 'Objetivos: el ERP alimenta desde',
   'Primer mes (AAAA-MM) en que los indicadores del ERP salen del sistema. Los meses anteriores son el histórico del Excel de Oliver.',
   'AAAA-MM', 'gerencia')
on conflict (clave) do nothing;


-- ============================================================================
--  6. LO QUE ALIMENTA EL ERP
--  Un año de golpe: una fila por fuente y mes, hasta el mes en curso. Todo en
--  toneladas salvo los contenedores, y los meses en hora de Lima.
-- ============================================================================
create or replace function objetivos_erp(p_anio int)
returns table (fuente text, mes int, valor numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_hoy date := (now() at time zone 'America/Lima')::date;
begin
  if not puede_ver_objetivos() then
    return;
  end if;

  return query
  with meses as (
    select m, make_date(p_anio, m, 1) as inicio, (make_date(p_anio, m, 1) + interval '1 month')::date as fin
      from generate_series(1, 12) m
     where make_date(p_anio, m, 1) <= v_hoy
  ),
  ingresos as (
    select (k.fecha at time zone 'America/Lima')::date as dia, l.proceso::text as proceso,
           case when k.especie in ('POTA', 'BONITO', 'MERLUZA') then lower(k.especie) else 'otras' end as especie,
           k.formato, k.entrada_kg
      from v_kardex k join lotes l on l.id = k.lote_id
     where k.tipo = 'ingreso'
       and (k.fecha at time zone 'America/Lima')::date >= make_date(p_anio, 1, 1)
       and (k.fecha at time zone 'America/Lima')::date <  make_date(p_anio + 1, 1, 1)
  ),
  produccion as (
    --  Todas las combinaciones, aunque el mes no tenga ingresos: cero es un dato.
    select 'pt_' || pr.proceso || '_' || es.especie as fuente, ms.m,
           coalesce((select sum(i.entrada_kg) from ingresos i
                      where i.proceso = pr.proceso and i.especie = es.especie
                        and i.dia >= ms.inicio and i.dia < ms.fin), 0) / 1000 as valor
      from meses ms
      cross join (values ('propia'), ('maquila')) pr(proceso)
      cross join (values ('pota'), ('bonito'), ('merluza'), ('otras')) es(especie)
  ),
  precocido as (
    select 'tn_precocido', ms.m,
           coalesce((select sum(i.entrada_kg) from ingresos i
                      where i.proceso = 'propia' and i.formato = 'PRECOCIDOS'
                        and i.dia >= ms.inicio and i.dia < ms.fin), 0) / 1000
      from meses ms
  ),
  despachado as (
    select (d.fecha_salida at time zone 'America/Lima')::date as dia, d.id,
           (select coalesce(sum(pkl.peso_neto_kg), 0) from packing_lineas pkl
             where pkl.packing_list_id = d.packing_list_id) as kg
      from despachos d
      join packing_lists pk on pk.id = d.packing_list_id and pk.estado <> 'anulado'
  ),
  embarques as (
    select 'tn_embarcadas', ms.m,
           coalesce((select sum(kg) from despachado x where x.dia >= ms.inicio and x.dia < ms.fin), 0) / 1000
      from meses ms
    union all
    select 'contenedores', ms.m,
           (select count(*) from despachado x where x.dia >= ms.inicio and x.dia < ms.fin)::numeric
      from meses ms
  ),
  saldos as (
    --  Stock a una fecha = todo lo que entró menos todo lo que salió antes.
    select a.tipo::text as tipo_almacen, a.codigo, (k.fecha at time zone 'America/Lima')::date as dia,
           coalesce(k.entrada_kg, 0) - coalesce(k.salida_kg, 0) as neto
      from v_kardex k join almacenes a on a.id = k.almacen_id
  ),
  inventario as (
    select 'inv_stm', ms.m, coalesce((select sum(neto) from saldos s where s.tipo_almacen = 'propio' and s.dia < ms.inicio), 0) / 1000
      from meses ms
    union all
    select 'inv_freeko', ms.m, coalesce((select sum(neto) from saldos s where s.codigo = 'FREEKO' and s.dia < ms.inicio), 0) / 1000
      from meses ms
    union all
    select 'inv_otros', ms.m, coalesce((select sum(neto) from saldos s where s.tipo_almacen <> 'propio' and s.codigo <> 'FREEKO' and s.dia < ms.inicio), 0) / 1000
      from meses ms
    union all
    --  Al cierre del mes; si el mes está en curso, a hoy.
    select 'tn_alm_ext', ms.m, coalesce((select sum(neto) from saldos s where s.tipo_almacen <> 'propio' and s.dia < ms.fin), 0) / 1000
      from meses ms
  )
  select * from produccion
  union all select * from precocido
  union all select * from embarques
  union all select * from inventario;
end $$;

comment on function objetivos_erp is
  'Los indicadores de Objetivos mensuales que salen del ERP, un año por llamada. Devuelve vacío a quien no tiene acceso a Objetivos.';

--  Dar o quitar el acceso. Es función propia porque Oliver no es Gerencia y
--  la política de usuarios solo deja a Gerencia tocar filas ajenas; así lo
--  puede hacer cualquiera de los dos autorizados, y nadie más.
create or replace function fijar_acceso_objetivos(p_usuario uuid, p_valor boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not puede_ver_objetivos() then
    raise exception 'Solo quien ya tiene acceso a Objetivos mensuales puede darlo o quitarlo.';
  end if;
  if p_usuario = auth.uid() and not p_valor then
    raise exception 'No puede quitarse el acceso a sí mismo: pídaselo a la otra persona autorizada.';
  end if;
  update usuarios set ve_objetivos = p_valor where id = p_usuario;
  if not found then
    raise exception 'Ese usuario no existe.';
  end if;
end $$;
revoke all on function fijar_acceso_objetivos(uuid, boolean) from public, anon;
grant execute on function fijar_acceso_objetivos(uuid, boolean) to authenticated;

revoke all on function objetivos_erp(int) from public, anon;
grant execute on function objetivos_erp(int) to authenticated;
revoke all on function puede_ver_objetivos() from anon;
