-- ============================================================================
--  080 · CARGA INICIAL DEL STOCK REAL (DATA 2025)
-- ============================================================================
--  Re-ejecutable: altas con `where not exists` / `on conflict do nothing` y
--  `create or replace`. NO borra ni carga stock: eso lo hace, UNA sola vez, el
--  guion de carga inicial (fuera del repositorio, porque lleva los datos reales
--  de la empresa), que se apoya en lo que deja esta migración.
--
--  Lo que deja preparado:
--
--   1. MOTIVO «INVENTARIO INICIAL». Cada pallet del stock real entra al Kardex
--      con este motivo y con fecha del día de la carga: es el saldo con el que
--      arranca el sistema, no un ingreso de producción de ese día. El motivo
--      con que entró en la base anterior (primer proceso, traslado desde
--      almacén tercero, reproceso, reimportación) queda en las observaciones.
--
--   2. MAESTROS QUE FALTABAN PARA CARGAR EL STOCK:
--      · Producto 192 (POTA · FILETE · "A" 2000-4000 (P) · FILETE FRESCO CP):
--        está en la hoja DATOS de la base anterior y tiene stock, pero no en el
--        catálogo del sistema.
--      · Presentaciones PLACAS 21 KG «7 X 3 KG» y PLACAS 22 KG «1 X 22 KG»:
--        tienen stock en la base anterior y no estaban (ni en la hoja de
--        presentaciones de la base anterior: se usaron igual).
--      · Línea procesadora «SANTA MONICA 2».
--
--   3. LA BODEGA «NO RECIBE ESTE ORIGEN» NO APLICA AL SALDO INICIAL. Desde 074
--      un ingreso de Producción solo entra por las bodegas que reciben
--      producción. El saldo inicial no es un ingreso: es producto que YA está
--      en Perufrost o Depsa porque llegó por traslado. La excepción es
--      estrecha: solo la conexión de administración (sin usuario de la app),
--      con la marca `app.carga_inicial = si` de la transacción y documento
--      «inventario_inicial». Desde la aplicación sigue rigiendo la regla.
--
--   4. EL KARDEX TAMPOCO SE VACÍA CON TRUNCATE. El disparador de 002 impide
--      borrar o cambiar movimientos fila por fila, pero un TRUNCATE no pasa por
--      él. Para empezar limpio hay que vaciar el Kardex de prueba UNA vez (sin
--      tocar la regla de inmutabilidad), así que ahora el TRUNCATE también se
--      rechaza, salvo con la misma marca de la carga inicial y desde la
--      conexión de administración.
-- ============================================================================


-- ============================================================================
--  1. MOTIVO «INVENTARIO INICIAL»
-- ============================================================================
insert into motivos (ambito, codigo, nombre, requiere_autorizacion, activo, condiciona_venta)
values ('ingreso', 'INVENTARIO_INICIAL', 'Inventario inicial', false, true, false)
on conflict (ambito, codigo) do nothing;


-- ============================================================================
--  2. MAESTROS QUE FALTABAN
-- ============================================================================

-- ---- Línea procesadora ----------------------------------------------------
insert into lineas_procesadoras (nombre, activo)
values ('SANTA MONICA 2', true)
on conflict (nombre) do nothing;

-- ---- Producto 192 (copiado de la hoja DATOS de la base anterior) ----------
insert into skus (codigo, especie_id, formato_id, corte, clasificacion_comercial, empaque, talla, activo)
select '192', e.id, f.id, '"A" 2000-4000 (P)', 'FILETE FRESCO CP', 'sacos', '2000-4000', true
  from especies e
  join formatos f on f.especie_id = e.id and f.nombre = 'FILETE'
 where e.nombre = 'POTA'
on conflict (codigo) do nothing;

-- ---- Presentaciones -------------------------------------------------------
--  El código sigue la costumbre del catálogo: «PLACAS21 KG#<id>».
do $$
declare
  r record;
  v_id bigint;
begin
  for r in
    select * from (values
      ('placas'::tipo_congelamiento, 21.000::numeric, '7 X 3 KG',  7, 3.000::numeric),
      ('placas'::tipo_congelamiento, 22.000::numeric, '1 X 22 KG', 1, 22.000::numeric)
    ) as t(congelamiento, peso, descripcion, bloques, peso_bloque)
  loop
    if not exists (select 1 from presentaciones
                    where congelamiento = r.congelamiento and peso_bulto_kg = r.peso
                      and descripcion = r.descripcion) then
      insert into presentaciones (codigo, congelamiento, peso_bulto_kg, descripcion, activo,
                                  bloques_por_bulto, peso_bloque_kg)
      values ('NUEVA-' || r.descripcion, r.congelamiento, r.peso, r.descripcion, true,
              r.bloques, r.peso_bloque)
      returning id into v_id;
      update presentaciones
         set codigo = upper(r.congelamiento::text) || trim_scale(r.peso)::text || ' KG#' || v_id
       where id = v_id;
    end if;
  end loop;
end $$;


-- ============================================================================
--  3. EL SALDO INICIAL ENTRA DONDE ESTÁ
-- ============================================================================
--  Marca de la carga inicial: solo la conexión de administración (auth.uid()
--  nulo: ningún usuario de la aplicación) puede ponerla, y solo dura la
--  transacción que la pone (set_config(..., true)).
create or replace function carga_inicial_en_curso()
returns boolean
language sql
stable
set search_path = public
as $$
  select auth.uid() is null
     and coalesce(current_setting('app.carga_inicial', true), '') = 'si';
$$;

revoke execute on function carga_inicial_en_curso() from public, anon;
grant execute on function carga_inicial_en_curso() to authenticated;

create or replace function movimientos_ingreso_bodega_valida()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_motivo text;
begin
  if new.tipo <> 'ingreso' then return new; end if;

  --  080: el saldo inicial no es un ingreso por esa bodega, es lo que YA hay
  --  en ella (llegó por traslado en la base anterior).
  if new.documento_tipo = 'inventario_inicial' and carga_inicial_en_curso() then
    return new;
  end if;

  v_motivo := almacen_rechaza_ingreso(new.almacen_id, new.origen_ingreso);
  if v_motivo is not null then raise exception '%', v_motivo; end if;
  return new;
end $$;


-- ============================================================================
--  4. EL KARDEX NO SE VACÍA
-- ============================================================================
create or replace function bloquear_vaciado_kardex()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if carga_inicial_en_curso() then
    return null;
  end if;
  raise exception
    'El Kardex es inmutable: no se permite vaciar los movimientos. Para corregir, registre un movimiento inverso.'
    using errcode = 'check_violation';
end $$;

drop trigger if exists trg_kardex_no_truncate on movimientos;
create trigger trg_kardex_no_truncate
  before truncate on movimientos
  for each statement execute function bloquear_vaciado_kardex();
