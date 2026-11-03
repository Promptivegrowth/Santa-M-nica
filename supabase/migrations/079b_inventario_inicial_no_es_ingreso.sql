-- ============================================================================
--  079b · EL INVENTARIO INICIAL NO ES UN INGRESO DEL DÍA
-- ============================================================================
--  Re-ejecutable (create or replace view; solo agrega columnas al final).
--
--  La carga inicial (080) dejó los saldos de DATA 2025 como movimientos
--  «ingreso» con documento_tipo = 'inventario_inicial' (documento
--  INV-INICIAL-nnnnnn), fechados el día de la carga. En Stock › Ingresos y en
--  Movimientos del día salían como «Ingreso de producción» de ese día. Esas
--  pantallas leen v_kardex: se le agregan dos columnas para distinguirlos sin
--  repetir la regla en cada pantalla:
--
--    clase_movimiento  el tipo del movimiento, salvo el inventario inicial,
--                      que es «inventario_inicial».
--    origen_registro   el origen del ingreso (produccion / compras), salvo el
--                      inventario inicial, que es «inventario_inicial».
-- ============================================================================
create or replace view v_kardex as
 SELECT m.id,
    m.fecha,
    m.tipo,
    signo_movimiento(m.tipo) AS signo,
    m.lote_id,
    l.codigo_pallet,
    l.fecha_produccion,
    m.almacen_id,
    a.nombre AS almacen,
    sp.id AS sku_presentacion_id,
    s.codigo AS sku_codigo,
    esp.nombre AS especie,
    fo.nombre AS formato,
    s.corte,
    pr.descripcion AS presentacion,
        CASE
            WHEN signo_movimiento(m.tipo) = 1 THEN m.bultos
            ELSE 0
        END AS entrada_bultos,
        CASE
            WHEN signo_movimiento(m.tipo) = 1 THEN m.peso_neto_kg
            ELSE 0::numeric
        END AS entrada_kg,
        CASE
            WHEN signo_movimiento(m.tipo) = '-1'::integer THEN m.bultos
            ELSE 0
        END AS salida_bultos,
        CASE
            WHEN signo_movimiento(m.tipo) = '-1'::integer THEN m.peso_neto_kg
            ELSE 0::numeric
        END AS salida_kg,
    m.costo_unitario,
    m.peso_neto_kg * m.costo_unitario AS valor,
    m.documento_tipo,
    m.documento_id,
    m.documento_ref,
    mo.nombre AS motivo,
    u.nombre AS usuario,
    ua.nombre AS autorizado_por,
    m.origen_ingreso,
    m.proveedor,
        -- 079b · Los saldos de la carga inicial no son ingresos del día.
        CASE
            WHEN m.tipo = 'ingreso'::tipo_movimiento AND m.documento_tipo = 'inventario_inicial' THEN 'inventario_inicial'::text
            ELSE m.tipo::text
        END AS clase_movimiento,
        CASE
            WHEN m.documento_tipo = 'inventario_inicial' THEN 'inventario_inicial'::text
            ELSE m.origen_ingreso
        END AS origen_registro
   FROM movimientos m
     JOIN lotes l ON l.id = m.lote_id
     JOIN almacenes a ON a.id = m.almacen_id
     JOIN sku_presentaciones sp ON sp.id = l.sku_presentacion_id
     JOIN skus s ON s.id = sp.sku_id
     JOIN especies esp ON esp.id = s.especie_id
     JOIN formatos fo ON fo.id = s.formato_id
     JOIN presentaciones pr ON pr.id = sp.presentacion_id
     LEFT JOIN motivos mo ON mo.id = m.motivo_id
     LEFT JOIN usuarios u ON u.id = m.usuario_id
     LEFT JOIN usuarios ua ON ua.id = m.autorizado_por;
