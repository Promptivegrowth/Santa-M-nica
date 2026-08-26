-- ============================================================================
--  SANTA MÓNICA ERP · MIGRACIÓN 008 · CORRECCIÓN DE LA PROYECCIÓN DE SALDOS
-- ============================================================================
--  Problema detectado en pruebas:
--
--  La versión anterior usaba "INSERT ... ON CONFLICT DO UPDATE" para actualizar
--  el saldo. Parece correcto, pero PostgreSQL evalúa las restricciones CHECK
--  sobre la fila que se INTENTA insertar ANTES de resolver el conflicto y
--  convertirlo en un UPDATE.
--
--  Resultado: al registrar una salida de 28 bultos sobre un lote que tenía 57,
--  Postgres primero veía la fila propuesta con -28 bultos, chocaba con la
--  restricción "el saldo no puede ser negativo" y abortaba, aunque el saldo
--  final habría sido 29.
--
--  Solución: intentar primero el UPDATE y, solo si el lote todavía no tiene
--  saldo en esa bodega, hacer el INSERT. De paso, obtenemos un mensaje de error
--  mucho más claro cuando alguien intenta sacar producto de donde no hay.
-- ============================================================================

create or replace function proyectar_existencia() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s int := signo_movimiento(new.tipo);   -- +1 entra, -1 sale
  bultos_prev  int;
  peso_prev    numeric(14,3);
  costo_prev   numeric(14,6);
  costo_nuevo  numeric(14,6);
begin
  -- ¿Ya existe saldo de este lote en esta bodega?
  select bultos, peso_neto_kg, costo_promedio
    into bultos_prev, peso_prev, costo_prev
    from existencias
   where lote_id = new.lote_id and almacen_id = new.almacen_id
   for update;

  if found then
    -- ---- COSTO PROMEDIO MÓVIL ----
    -- Solo se recalcula cuando ENTRA producto. Al salir, el costo no cambia.
    -- Fórmula: (valor que ya había + valor que entra) / (kilos totales)
    costo_nuevo := costo_prev;
    if s = 1 and (peso_prev + new.peso_neto_kg) > 0 then
      costo_nuevo := ((peso_prev * costo_prev) + (new.peso_neto_kg * new.costo_unitario))
                     / (peso_prev + new.peso_neto_kg);
    end if;

    -- Validación con mensaje entendible: no se puede sacar más de lo que hay
    if s = -1 and (bultos_prev - new.bultos) < 0 then
      raise exception
        'No hay stock suficiente del lote % en el almacén %: hay % bultos y se intentan retirar %.',
        new.lote_id, new.almacen_id, bultos_prev, new.bultos
        using errcode = 'check_violation';
    end if;

    update existencias
       set bultos         = bultos + (s * new.bultos),
           peso_neto_kg   = peso_neto_kg + (s * new.peso_neto_kg),
           camara_id      = coalesce(new.camara_id, camara_id),
           costo_promedio = costo_nuevo,
           actualizado_en = now()
     where lote_id = new.lote_id and almacen_id = new.almacen_id;

  else
    -- No hay saldo previo: solo tiene sentido si el movimiento SUMA.
    if s = -1 then
      raise exception
        'No se puede retirar el lote % del almacén %: no tiene existencias registradas allí.',
        new.lote_id, new.almacen_id
        using errcode = 'check_violation';
    end if;

    insert into existencias (lote_id, almacen_id, camara_id, bultos, peso_neto_kg, costo_promedio, actualizado_en)
    values (new.lote_id, new.almacen_id, new.camara_id,
            new.bultos, new.peso_neto_kg, new.costo_unitario, now());
  end if;

  return new;
end;
$$;

comment on function proyectar_existencia is
  'Proyecta el Kardex sobre el saldo vivo. Usa UPDATE-luego-INSERT para que las restricciones CHECK no se evalúen sobre valores intermedios negativos.';
