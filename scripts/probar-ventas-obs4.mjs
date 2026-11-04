/**
 * ============================================================================
 *  PRUEBA · «OBSERVACIONES ERP 4» · VENTAS, CLIENTES Y DESTINOS (migración 085)
 * ============================================================================
 *  Puntos 01, 06, 12 y 13 (modificar cotización aceptada, eliminar pedidos)
 *  de la matriz de Oliver Tello. Dos partes:
 *
 *   A. EN LA BASE, dentro de transacciones que SE DESHACEN (no queda nada,
 *      ni siquiera auditoría): datos del cliente fijados en la cotización y
 *      heredados por el pedido, «Actualizar con la ficha del cliente»,
 *      registrar_destino, autorizar / modificar una cotización aceptada (con
 *      un pallet de prueba propio y su reserva), eliminar_pedido y la
 *      política de borrado de pedidos.
 *
 *   B. EN EL NAVEGADOR (http://localhost:3010):
 *      01 · el formulario del cliente con todos los datos de la lista BASC
 *           (alta y edición), el vendedor propuesto al cotizar, el panel
 *           «Cliente en la proforma» con el aviso de diferencias y el botón
 *           «Actualizar con la ficha del cliente», y el Excel de la proforma
 *           con los datos fijados;
 *      12 · «Otro destino…» en el formulario de cotización;
 *      13 · «Autorizar modificación» → «Editar (autorizado)» → guardar: el
 *           cambio llega al pedido; «Eliminar pedido» apagado para Comercial
 *           y hecho por Gerencia (con la cotización);
 *      06 · en Disponibilidad del pedido, marcar varios pallets (también
 *           equivalentes): la suma y el botón «Apartar los N marcados». NO se
 *           reserva ningún pallet real: el pedido de prueba está marcado como
 *           facturado (la base rechaza apartarle stock) y además el primer
 *           intento se corta en la red (page.route), que debe dar el aviso de
 *           conexión sin perder lo marcado.
 *
 *  La base es la de PRODUCCIÓN. La parte B crea SUS cosas (cliente «PRUEBA-085
 *  …», cotizaciones «COT-PRB085-…», pedidos «PRB085-…», un destino «Prb085
 *  …») y las borra en `finally` con sus eventos y alertas. NO borra filas de
 *  auditoría ni del Kardex (no crea movimientos fuera de la parte A, que se
 *  deshace entera) y no reserva pallets reales.
 *
 *      BASE_URL=http://localhost:3010 node scripts/probar-ventas-obs4.mjs
 * ============================================================================
 */
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import { PDFExtract } from 'pdf.js-extract';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ejecutarSQL } from './db.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3010';
const CLAVE = process.env.CLAVE_DEMO ?? (() => {
  try { return (/^CLAVE_DEMO=(.*)$/m.exec(readFileSync('.env.local', 'utf8'))?.[1] ?? '').trim(); } catch { return ''; }
})();
const consultar = async (sql) => { const r = await ejecutarSQL(sql); return Array.isArray(r) ? r : []; };
const SEC = (n, t) => `\n${'─'.repeat(3)} ${n} · ${t} ${'─'.repeat(3)}`;
const fallos = [];
const ok = (cond, texto, detalle = '') => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${texto}${detalle ? ' · ' + String(detalle).slice(0, 220) : ''}`);
  if (!cond) fallos.push(texto);
};
const CARPETA = process.env.CAPTURAS ?? join(tmpdir(), 'probar-ventas-obs4');
mkdirSync(CARPETA, { recursive: true });
const captura = async (p, nombre) => { await p.screenshot({ path: join(CARPETA, `${nombre}.png`), fullPage: true }).catch(() => {}); };
const MSJ_SIN_CONEXION = 'Se perdió la conexión con el sistema';

const SELLO = String(Date.now()).slice(-5);
const usuarios = Object.fromEntries((await consultar(`
  select split_part(email, '@', 1) k, id::text, nombre from usuarios
   where email in ('gerencia@santamonica.pe','operaciones@santamonica.pe','comercial@santamonica.pe','comex@santamonica.pe','almacen@santamonica.pe')`))
  .map((u) => [u.k, u]));
const [prev] = await consultar(`
  select (select coalesce(max(id),0) from eventos) ev, (select coalesce(max(id),0) from auditoria) au,
         (select coalesce(max(id),0) from alertas) al, (select coalesce(max(id),0) from pedidos) ped,
         (select coalesce(max(id),0) from cotizaciones) cot, (select coalesce(max(id),0) from clientes) cli,
         (select coalesce(max(id),0) from destinos) dst, (select coalesce(max(id),0) from reservas) res,
         (select coalesce(max(id),0) from movimientos) mov, (select count(*) from reservas) nres`);

/* Productos con stock real disponible (para la pantalla de reservas): un SKU
   con varios pallets y al menos un equivalente con stock. Solo se LEEN. */
const [sku] = await consultar(`
  with d as (select v.sku_presentacion_id sp, count(*) n from v_stock_lote v
              where disponible_kg > 0 and solo_nacional_kg = 0 group by 1),
       s as (select sp.id, k.especie_id, lower(trim(k.corte)) corte from sku_presentaciones sp join skus k on k.id = sp.sku_id)
  select s.id, d.n,
         (select s2.id from s s2 join d d2 on d2.sp = s2.id where s2.especie_id = s.especie_id and s2.corte = s.corte and s2.id <> s.id limit 1) equiv
    from s join d on d.sp = s.id
   where exists (select 1 from s s2 join d d2 on d2.sp = s2.id where s2.especie_id = s.especie_id and s2.corte = s.corte and s2.id <> s.id)
   order by d.n desc limit 1`);
const [sku2] = await consultar(`select sp.id from sku_presentaciones sp where sp.activo and sp.id not in (${sku.id}, ${sku.equiv}) order by sp.id limit 1`);

/* ==========================================================================
   A · EN LA BASE (todo dentro de transacciones que se deshacen)
   ==========================================================================
   Cada bloque es un DO que anota sus comprobaciones en una tabla temporal y
   termina con un error a propósito: «PRUEBA_RESULTADO [...]». El error
   deshace TODO (clientes, pedidos, pallets, reservas, eventos y auditoría).
   ========================================================================== */
/* Fragmentos de SQL reutilizables dentro de los bloques. */
const como = (uid) => `perform set_config('request.jwt.claims', json_build_object('sub', '${uid}', 'role', 'authenticated')::text, true);`;
const anota = (cond, texto, detalle = "''") => `insert into _r (ok, texto, detalle) values (coalesce((${cond}), false), ${lit(texto)}, (${detalle})::text);`;
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
/* Intenta y guarda el mensaje de error (null si no falló). */
const intenta = (sql) => `v_err := null; begin ${sql}; exception when others then v_err := sqlerrm; end;`;

/** El escenario común: un cliente, una cotización aceptada y su pedido con dos líneas. */
const escenario = `
  insert into clientes (codigo, razon_social, pais, moneda, direccion, ruc_tax_id, etiqueta_tax_id, vendedor_id)
  values ('PRB085A-${SELLO}', 'PRUEBA-085 A SL', 'España', 'USD', 'DIR A 1', 'B111', 'CIF', (select id from vendedores where activo order by id limit 1))
  returning id into v_cli;
  insert into cotizaciones (numero, cliente_id, estado, moneda, tipo_cambio, incoterm, validez_dias, creado_por, aprobada_en, aprobada_por, observaciones)
  values ('COT-PRB085-${SELLO}', v_cli, 'aprobada', 'USD', 3.45, 'CFR', 15, '${usuarios.gerencia.id}', now(), '${usuarios.gerencia.id}', 'PRUEBA-085')
  returning id into v_cot;
  insert into cotizacion_lineas (cotizacion_id, sku_presentacion_id, cantidad_tm, precio_lista_tm, precio_tm, descuento_pct, orden)
  values (v_cot, ${sku.id}, 2, 2000, 2000, 0, 1), (v_cot, ${sku2.id}, 1, 1500, 1500, 0, 2);
  update clientes set direccion = 'DIR B 2', ruc_tax_id = 'B222' where id = v_cli;
  insert into pedidos (numero_proforma, cotizacion_id, cliente_id, tipo_cambio, ciclo, creado_por, tipo_despacho, incoterm, fecha_comprometida, observaciones)
  values ('PRB085-${SELLO}-1', v_cot, v_cli, 3.45, 'confirmado', '${usuarios.gerencia.id}', 'exportacion', 'CFR', current_date + 30, 'PRUEBA-085')
  returning id into v_ped;
  insert into pedido_lineas (pedido_id, sku_presentacion_id, cantidad_tm, precio_lista_tm, precio_tm, orden)
  values (v_ped, ${sku.id}, 2, 2000, 2000, 1) returning id into v_l1;
  insert into pedido_lineas (pedido_id, sku_presentacion_id, cantidad_tm, precio_lista_tm, precio_tm, orden)
  values (v_ped, ${sku2.id}, 1, 1500, 1500, 2) returning id into v_l2;
  update cotizaciones set estado = 'aceptada' where id = v_cot;
`;
const declaraEscenario = `v_cli bigint; v_cot bigint; v_ped bigint; v_l1 bigint; v_l2 bigint; v_lote bigint; v_res_id bigint; v_txt text; v_n int; v_j jsonb; v_ped2 bigint; v_cot2 bigint;`;
console.log(SEC('A', 'En la base, dentro de transacciones que se deshacen'));

/* ---- A1 · Datos del cliente fijados y heredados; «Actualizar con la ficha» ---- */
await ejecutarBloque('A1', `
  ${escenario}
  ${anota(`(select cliente_direccion from cotizaciones where id = v_cot) = 'DIR A 1'`, 'A1 · la cotización fija la dirección del cliente al crearse', `(select cliente_direccion from cotizaciones where id = v_cot)`)}
  ${anota(`(select cliente_tax_id || '/' || cliente_etiqueta_tax_id from cotizaciones where id = v_cot) = 'B111/CIF'`, 'A1 · y la identificación fiscal con su etiqueta (CIF)')}
  ${anota(`(select cliente_direccion from pedidos where id = v_ped) = 'DIR A 1'`, 'A1 · el pedido HEREDA los de la cotización aunque la ficha ya cambió (DIR B 2)', `(select cliente_direccion from pedidos where id = v_ped)`)}
  ${anota(`(select p.cliente_datos_en = c.cliente_datos_en from pedidos p join cotizaciones c on c.id = p.cotizacion_id where p.id = v_ped)`, 'A1 · con la misma fecha de toma de datos que la cotización')}
  insert into pedidos (numero_proforma, cliente_id, tipo_cambio, ciclo, creado_por, tipo_despacho, fecha_comprometida)
  values ('PRB085-${SELLO}-D', v_cli, 3.45, 'pendiente_validacion', '${usuarios.gerencia.id}', 'exportacion', current_date + 30) returning id into v_ped2;
  ${anota(`(select cliente_direccion from pedidos where id = v_ped2) = 'DIR B 2'`, 'A1 · un pedido directo fija los de la ficha al crearse')}
  update clientes set direccion = 'DIR C 3' where id = v_cli;
  ${anota(`(select cliente_direccion from pedidos where id = v_ped) = 'DIR A 1'`, 'A1 · corregir la ficha después NO cambia el pedido por debajo')}
  ${como(usuarios.almacen.id)}
  ${intenta(`perform actualizar_datos_cliente_documento('pedido', v_ped)`)}
  ${anota(`v_err ~ 'Actualizar los datos del cliente en un documento lo hacen'`, 'A1 · Almacén no puede «Actualizar con la ficha del cliente»', 'v_err')}
  ${como(usuarios.comex.id)}
  v_txt := actualizar_datos_cliente_documento('pedido', v_ped);
  ${anota(`(select cliente_direccion from pedidos where id = v_ped) = 'DIR C 3' and v_txt ~ 'lleva ahora los datos de la ficha'`, 'A1 · Comercio Exterior actualiza el pedido con la ficha de hoy', 'v_txt')}
  ${anota(`exists (select 1 from eventos where entidad = 'pedidos' and entidad_id = v_ped and tipo = 'datos_cliente_actualizados' and metadatos->'antes'->>'direccion' = 'DIR A 1')`, 'A1 · queda en el historial del pedido, con lo de antes')}
  ${anota(`(select cliente_direccion from cotizaciones where id = v_cot) = 'DIR A 1'`, 'A1 · la cotización sigue como se ofreció')}
  update clientes set razon_social = 'PRUEBA-085 B SL' where id = v_cli;
  update cotizaciones set cliente_id = v_cli where id = v_cot;
  ${anota(`(select cliente_razon_social from cotizaciones where id = v_cot) = 'PRUEBA-085 A SL'`, 'A1 · guardar la cotización con el MISMO cliente no la cambia')}
  insert into facturas (numero, pedido_id, cliente_id, tipo_cambio, fecha_vencimiento, creado_por) values ('PRB085-F-${SELLO}', v_ped, v_cli, 3.45, current_date + 30, '${usuarios.gerencia.id}');
  ${intenta(`perform actualizar_datos_cliente_documento('pedido', v_ped)`)}
  ${anota(`v_err ~ 'ya tiene el comprobante PRB085-F-${SELLO}'`, 'A1 · con comprobante vigente ya no se actualiza (se dice por qué)', 'v_err')}
`, declaraEscenario);

/* ---- A2 · Destinos no listados ---- */
await ejecutarBloque('A2', `
  ${como(usuarios.comercial.id)}
  v_j := registrar_destino('  Puerto   Prb085 ${SELLO} ', 'Chile');
  ${anota(`(v_j->>'nuevo')::boolean and (select puerto from destinos where id = (v_j->>'id')::bigint) = 'Puerto Prb085 ${SELLO}'`, 'A2 · Comercial agrega un destino nuevo (sin espacios de más)', 'v_j')}
  ${anota(`(registrar_destino('PUERTO PRB085 ${SELLO}', 'chile')->>'id')::bigint = (v_j->>'id')::bigint`, 'A2 · el mismo en mayúsculas no se duplica: devuelve el que hay')}
  ${anota(`(registrar_destino('vigo', 'espana')->>'id')::bigint = (select id from destinos where puerto = 'Vigo' and pais = 'España')`, 'A2 · «vigo / espana» encuentra Vigo (España), sin tildes ni mayúsculas')}
  ${intenta(`perform registrar_destino('X', 'Chile')`)}
  ${anota(`v_err ~ 'Escriba el nombre del puerto'`, 'A2 · un nombre vacío o de una letra se rechaza', 'v_err')}
  ${intenta(`perform registrar_destino('Puerto Bueno', '')`)}
  ${anota(`v_err ~ 'Escriba el país'`, 'A2 · sin país se rechaza', 'v_err')}
  ${como(usuarios.almacen.id)}
  ${intenta(`perform registrar_destino('Otro Prb085', 'Chile')`)}
  ${anota(`v_err ~ 'Agregar un destino lo hacen'`, 'A2 · Almacén no agrega destinos', 'v_err')}
`, 'v_j jsonb;');

/* ---- A3 · Modificar una cotización aceptada, con autorización ---- */
await ejecutarBloque('A3', `
  ${escenario}
  --  Un pallet PROPIO de prueba, con su ingreso, y una reserva de 1 000 kg en la línea 1.
  insert into lotes (codigo_pallet, campania, sku_presentacion_id, fecha_produccion, bultos_iniciales, peso_neto_inicial_kg, creado_por, observaciones)
  values ('PRB 085 ${SELLO}', 2026, ${sku.id}, current_date - 20, 100, 2000, '${usuarios.gerencia.id}', 'PRUEBA-085') returning id into v_lote;
  insert into movimientos (tipo, lote_id, almacen_id, bultos, peso_neto_kg, costo_unitario, documento_tipo, documento_ref, usuario_id, origen_ingreso, observaciones)
  values ('ingreso', v_lote, (select id from almacenes where activo order by id limit 1), 100, 2000, 1, 'ingreso', 'PRUEBA-085', '${usuarios.gerencia.id}', 'produccion', 'PRUEBA-085');
  insert into reservas (pedido_linea_id, lote_id, almacen_id, bultos, peso_neto_kg, estado, creado_por, observaciones)
  values (v_l1, v_lote, (select id from almacenes where activo order by id limit 1), 50, 1000, 'activa', '${usuarios.gerencia.id}', 'PRUEBA-085') returning id into v_res_id;

  ${como(usuarios.operaciones.id)}
  ${intenta(`perform autorizar_modificacion_cotizacion(v_cot, 'Cambio de precio pactado')`)}
  ${anota(`v_err ~ 'lo hacen las personas que aprueban cotizaciones'`, 'A3 · quien no aprueba cotizaciones (operaciones@ de prueba) no autoriza', 'v_err')}
  ${como(usuarios.gerencia.id)}
  ${intenta(`perform autorizar_modificacion_cotizacion(v_cot, 'abc')`)}
  ${anota(`v_err ~ 'al menos 5 caracteres'`, 'A3 · sin motivo no se autoriza', 'v_err')}
  ${como(usuarios.comercial.id)}
  ${intenta(`perform modificar_cotizacion_aceptada(v_cot, jsonb_build_object('cliente_id', v_cli, 'moneda', 'USD', 'tipo_cambio', 3.45, 'incoterm', 'CFR', 'validez_dias', 15), '[{"sku_presentacion_id": ${sku.id}, "cantidad_tm": 2, "precio_lista_tm": 2000, "precio_tm": 2100}]'::jsonb, array['los precios'])`)}
  ${anota(`v_err ~ 'no tiene autorización'`, 'A3 · sin autorización, modificar una aceptada se rechaza', 'v_err')}
  ${como(usuarios.gerencia.id)}
  v_txt := autorizar_modificacion_cotizacion(v_cot, 'Cambio de precio pactado con el cliente');
  ${anota(`v_txt ~ 'pasan también al pedido PRB085-${SELLO}-1' and (select modificacion_autorizada_por from cotizaciones where id = v_cot) = '${usuarios.gerencia.id}'`, 'A3 · Gerencia autoriza: queda quién, cuándo y por qué', 'v_txt')}
  ${anota(`exists (select 1 from eventos where entidad = 'pedidos' and entidad_id = v_ped and tipo = 'cotizacion_modificacion_autorizada')`, 'A3 · la autorización queda también en el historial del pedido')}

  ${como(usuarios.comercial.id)}
  ${intenta(`perform modificar_cotizacion_aceptada(v_cot, jsonb_build_object('cliente_id', v_cli + 1, 'moneda', 'USD', 'tipo_cambio', 3.45, 'incoterm', 'CFR', 'validez_dias', 15), '[{"sku_presentacion_id": ${sku.id}, "cantidad_tm": 2, "precio_lista_tm": 2000, "precio_tm": 2100}]'::jsonb, array['el cliente'])`)}
  ${anota(`v_err ~ 'no se cambia el cliente'`, 'A3 · el cliente no se cambia en una aceptada', 'v_err')}
  ${intenta(`perform modificar_cotizacion_aceptada(v_cot, jsonb_build_object('cliente_id', v_cli, 'moneda', 'USD', 'tipo_cambio', 3.45, 'incoterm', 'CFR', 'validez_dias', 15), '[{"sku_presentacion_id": ${sku.id}, "cantidad_tm": 0.5, "precio_lista_tm": 2000, "precio_tm": 2100}]'::jsonb, array['las cantidades'])`)}
  ${anota(`v_err ~ 'No se puede bajar' and v_err ~ '1.000,0 kg apartados|1,000.0 kg apartados|1000,0 kg|1000.0 kg'`, 'A3 · bajar una línea por debajo de lo apartado se rechaza, con los kilos', 'v_err')}
  ${intenta(`perform modificar_cotizacion_aceptada(v_cot, jsonb_build_object('cliente_id', v_cli, 'moneda', 'USD', 'tipo_cambio', 3.45, 'incoterm', 'CFR', 'validez_dias', 15), '[{"sku_presentacion_id": ${sku2.id}, "cantidad_tm": 1, "precio_lista_tm": 1500, "precio_tm": 1500}]'::jsonb, array['los productos'])`)}
  ${anota(`v_err ~ 'No se puede quitar' and v_err ~ 'stock apartado'`, 'A3 · quitar un producto con stock apartado se rechaza (suelte primero)', 'v_err')}
  ${anota(`(select modificacion_autorizada_en is not null from cotizaciones where id = v_cot) and (select count(*) from pedido_lineas where pedido_id = v_ped) = 2`, 'A3 · un intento rechazado no consume la autorización ni toca el pedido')}

  --  La buena: la línea 1 sube a 3 TM y a 2 100, la 2 se quita, entra una nueva.
  v_j := modificar_cotizacion_aceptada(v_cot,
    jsonb_build_object('cliente_id', v_cli, 'vendedor_id', (select id from vendedores where activo order by id desc limit 1), 'moneda', 'USD',
      'tipo_cambio', 3.50, 'incoterm', 'CIF', 'validez_dias', 20, 'prioridad', 'alta', 'observaciones', 'PRUEBA-085 modificada',
      'forma_pago', 'adelanto_saldo', 'adelanto_pct', 30, 'condicion_pago', '30 % de adelanto y saldo', 'contacto_nombre', 'Ana Prueba'),
    '[{"sku_presentacion_id": ${sku.id}, "cantidad_tm": 3, "precio_lista_tm": 2000, "precio_tm": 2100, "descuento_pct": 0},
      {"sku_presentacion_id": ${sku.equiv}, "cantidad_tm": 1.5, "precio_lista_tm": 1800, "precio_tm": 1800, "descuento_pct": 0}]'::jsonb,
    array['los productos', 'las cantidades', 'los precios', 'el incoterm']);
  ${anota(`(v_j->>'pedido_id')::bigint = v_ped`, 'A3 · Comercial guarda la modificación autorizada', 'v_j')}
  ${anota(`(select cantidad_tm from pedido_lineas where id = v_l1) = 3 and (select precio_tm from pedido_lineas where id = v_l1) = 2100`, 'A3 · la línea que sigue se ACTUALIZA en el pedido (misma línea: 3 TM a 2 100)')}
  ${anota(`exists (select 1 from reservas where id = v_res_id and pedido_linea_id = v_l1 and estado = 'activa')`, 'A3 · y conserva su reserva')}
  ${anota(`not exists (select 1 from pedido_lineas where id = v_l2)`, 'A3 · la línea quitada (sin reservas) sale del pedido')}
  ${anota(`exists (select 1 from pedido_lineas where pedido_id = v_ped and sku_presentacion_id = ${sku.equiv} and cantidad_tm = 1.5 and orden = 2)`, 'A3 · la línea nueva entra al pedido')}
  ${anota(`(select incoterm::text || '/' || tipo_cambio::text || '/' || prioridad::text || '/' || coalesce(contacto_nombre,'') || '/' || coalesce(observaciones,'') from pedidos where id = v_ped) = 'CIF/3.5000/alta/Ana Prueba/PRUEBA-085 modificada'`,
            'A3 · la cabecera del pedido sigue a la cotización (incoterm, TC, prioridad, contacto, observaciones)', `(select incoterm::text || '/' || tipo_cambio::text || '/' || prioridad::text || '/' || coalesce(contacto_nombre,'') || '/' || coalesce(observaciones,'') from pedidos where id = v_ped)`)}
  ${anota(`(select condicion_pago || '/' || pago_adelanto_pct::text from pedidos where id = v_ped) = '30 % de adelanto y saldo/30.00'`, 'A3 · y la forma de pago que imprime la proforma', `(select condicion_pago || '/' || coalesce(pago_adelanto_pct::text, '-') from pedidos where id = v_ped)`)}
  ${anota(`(select count(*) from cotizacion_lineas where cotizacion_id = v_cot) = 2 and (select estado::text from cotizaciones where id = v_cot) = 'aceptada'`, 'A3 · la cotización queda con sus 2 líneas nuevas y sigue aceptada')}
  ${anota(`(select modificacion_autorizada_en is null and modificacion_motivo is null from cotizaciones where id = v_cot)`, 'A3 · la autorización se CONSUME al guardar')}
  ${anota(`exists (select 1 from eventos where entidad = 'cotizaciones' and entidad_id = v_cot and tipo = 'cotizacion_aceptada_modificada' and descripcion ~ 'autorización de Marco')`, 'A3 · el historial cuenta quién modificó, quién autorizó y qué cambió',
            `(select descripcion from eventos where entidad = 'cotizaciones' and entidad_id = v_cot and tipo = 'cotizacion_aceptada_modificada' limit 1)`)}
  ${intenta(`perform modificar_cotizacion_aceptada(v_cot, jsonb_build_object('cliente_id', v_cli, 'moneda', 'USD', 'tipo_cambio', 3.45, 'incoterm', 'CFR', 'validez_dias', 15), '[{"sku_presentacion_id": ${sku.id}, "cantidad_tm": 3, "precio_lista_tm": 2000, "precio_tm": 2200}]'::jsonb, array['los precios'])`)}
  ${anota(`v_err ~ 'no tiene autorización'`, 'A3 · una segunda modificación pide otra autorización', 'v_err')}

  --  Con comprobante emitido, ya no se autoriza.
  insert into facturas (numero, pedido_id, cliente_id, tipo_cambio, fecha_vencimiento, creado_por) values ('PRB085-G-${SELLO}', v_ped, v_cli, 3.45, current_date + 30, '${usuarios.gerencia.id}');
  ${como(usuarios.gerencia.id)}
  ${intenta(`perform autorizar_modificacion_cotizacion(v_cot, 'Otro cambio de precio')`)}
  ${anota(`v_err ~ 'ya tiene el comprobante PRB085-G-${SELLO}'`, 'A3 · con comprobante vigente no se autoriza (dice cuál y qué hacer)', 'v_err')}
`, declaraEscenario);

/* ---- A4 · Eliminar un pedido (solo Gerencia) y la política de borrado ---- */
await ejecutarBloque('A4', `
  ${escenario}
  insert into lotes (codigo_pallet, campania, sku_presentacion_id, fecha_produccion, bultos_iniciales, peso_neto_inicial_kg, creado_por, observaciones)
  values ('PRB 085 ${SELLO} E', 2026, ${sku.id}, current_date - 20, 100, 2000, '${usuarios.gerencia.id}', 'PRUEBA-085') returning id into v_lote;
  insert into movimientos (tipo, lote_id, almacen_id, bultos, peso_neto_kg, costo_unitario, documento_tipo, documento_ref, usuario_id, origen_ingreso, observaciones)
  values ('ingreso', v_lote, (select id from almacenes where activo order by id limit 1), 100, 2000, 1, 'ingreso', 'PRUEBA-085', '${usuarios.gerencia.id}', 'produccion', 'PRUEBA-085');
  insert into reservas (pedido_linea_id, lote_id, almacen_id, bultos, peso_neto_kg, estado, creado_por, observaciones)
  values (v_l1, v_lote, (select id from almacenes where activo order by id limit 1), 50, 1000, 'activa', '${usuarios.gerencia.id}', 'PRUEBA-085') returning id into v_res_id;
  insert into contratos (numero, cotizacion_id, pedido_id, titulo, cuerpo, generado_por, revision) values ('CTR-PRB085-${SELLO}', v_cot, v_ped, 'PRUEBA', 'PRUEBA', '${usuarios.gerencia.id}', 1);

  ${como(usuarios.operaciones.id)}
  ${intenta(`perform eliminar_pedido(v_ped, 'Proforma duplicada por error')`)}
  ${anota(`v_err ~ 'lo hace solo Gerencia'`, 'A4 · Operaciones no elimina pedidos (tiene «Cancelar pedido»)', 'v_err')}
  ${como(usuarios.gerencia.id)}
  ${intenta(`perform eliminar_pedido(v_ped, 'abc')`)}
  ${anota(`v_err ~ 'al menos 5 caracteres'`, 'A4 · sin motivo no se elimina', 'v_err')}
  ${intenta(`perform eliminar_pedido(v_ped, 'Proforma duplicada por error')`)}
  ${anota(`v_err ~ 'reserva\\(s\\) vigente\\(s\\)' and v_err ~ 'Cancelar pedido'`, 'A4 · con reservas vigentes no se elimina: primero «Cancelar pedido»', 'v_err')}
  update reservas set estado = 'liberada', liberado_en = now(), liberado_por = '${usuarios.gerencia.id}', motivo_liberacion = 'PRUEBA-085 suelta' where id = v_res_id;
  v_txt := eliminar_pedido(v_ped, 'Proforma duplicada por error');
  ${anota(`not exists (select 1 from pedidos where id = v_ped) and v_txt ~ 'vuelve a aprobada'`, 'A4 · Gerencia elimina el pedido; la cotización vuelve a «aprobada»', 'v_txt')}
  ${anota(`(select estado::text from cotizaciones where id = v_cot) = 'aprobada'`, 'A4 · la cotización queda aprobada: se puede convertir otra vez')}
  ${anota(`not exists (select 1 from contratos where pedido_id = v_ped) and not exists (select 1 from reservas where id = v_res_id)`, 'A4 · se van sus contratos generados y las reservas ya sueltas')}
  ${anota(`exists (select 1 from eventos where entidad = 'pedidos' and entidad_id = v_ped and tipo = 'pedido_eliminado' and descripcion ~ 'Proforma duplicada')`, 'A4 · queda en el historial con el motivo')}
  ${anota(`exists (select 1 from movimientos where lote_id = v_lote)`, 'A4 · el Kardex del pallet no se toca')}

  --  Un pedido con comprobante (aunque anulado) no se elimina.
  update cotizaciones set estado = 'aceptada' where id = v_cot;
  insert into pedidos (numero_proforma, cotizacion_id, cliente_id, tipo_cambio, ciclo, creado_por, tipo_despacho, fecha_comprometida)
  values ('PRB085-${SELLO}-2', v_cot, v_cli, 3.45, 'confirmado', '${usuarios.gerencia.id}', 'exportacion', current_date + 30) returning id into v_ped2;
  insert into pedido_lineas (pedido_id, sku_presentacion_id, cantidad_tm, precio_lista_tm, precio_tm, orden) values (v_ped2, ${sku.id}, 1, 1, 1, 1);
  insert into facturas (numero, pedido_id, cliente_id, tipo_cambio, fecha_vencimiento, creado_por, estado) values ('PRB085-H-${SELLO}', v_ped2, v_cli, 3.45, current_date + 30, '${usuarios.gerencia.id}', 'anulada');
  ${intenta(`perform eliminar_pedido(v_ped2, 'Proforma duplicada por error')`)}
  ${anota(`v_err ~ 'tiene comprobantes \\(PRB085-H-${SELLO}\\), aunque estén anulados'`, 'A4 · con un comprobante (aunque anulado) no se elimina', 'v_err')}
  delete from facturas where pedido_id = v_ped2;
  v_txt := eliminar_pedido(v_ped2, 'Venta que no se concretó', true);
  ${anota(`not exists (select 1 from cotizaciones where id = v_cot) and v_txt ~ 'También se eliminó la cotización'`, 'A4 · «Eliminar también la cotización» se lleva la cotización', 'v_txt')}

  --  La política: Comercial no borra pedidos a mano…
  insert into pedidos (numero_proforma, cliente_id, tipo_cambio, ciclo, creado_por, tipo_despacho, fecha_comprometida)
  values ('PRB085-${SELLO}-3', v_cli, 3.45, 'pendiente_validacion', '${usuarios.gerencia.id}', 'exportacion', current_date + 30) returning id into v_ped;
  insert into pedido_lineas (pedido_id, sku_presentacion_id, cantidad_tm, precio_lista_tm, precio_tm, orden) values (v_ped, ${sku.id}, 1, 1, 1, 1);
  insert into pedidos (numero_proforma, cliente_id, tipo_cambio, ciclo, creado_por, tipo_despacho, fecha_comprometida)
  values ('PRB085-${SELLO}-4', v_cli, 3.45, 'pendiente_validacion', '${usuarios.comercial.id}', 'exportacion', current_date + 30) returning id into v_ped2;
  ${como(usuarios.comercial.id)}
  execute 'set local role authenticated';
  delete from pedidos where id = v_ped;
  get diagnostics v_n = row_count;
  --  …salvo el «deshacer» del servidor: el que acaba de crear, sin líneas.
  delete from pedidos where id = v_ped2;
  get diagnostics v_l2 = row_count;
  execute 'reset role';
  ${anota(`v_n = 0 and exists (select 1 from pedidos where id = v_ped)`, 'A4 · la base no deja a Comercial borrar un pedido a mano (0 filas)')}
  ${anota(`v_l2 = 1`, 'A4 · sí el que acaba de crear y quedó sin líneas (deshacer del servidor)')}
`, declaraEscenario);

async function ejecutarBloque(nombre, cuerpo, declaraciones) {
  const sql = `
    do $prueba$
    declare
      v_err text;
      v_res jsonb;
      ${declaraciones}
    begin
      create temporary table if not exists _r (n serial, ok boolean, texto text, detalle text) on commit drop;
      ${cuerpo}
      select jsonb_agg(jsonb_build_object('ok', ok, 'texto', texto, 'detalle', detalle) order by n) into v_res from _r;
      raise exception 'PRUEBA_RESULTADO %', v_res::text;
    end $prueba$;`;
  try {
    await ejecutarSQL(sql);
    ok(false, `${nombre}: el bloque no terminó como se esperaba`);
  } catch (e) {
    let m = String(e.message);
    //  La API devuelve el error como JSON: se lee el mensaje de la base.
    try { m = String(JSON.parse(m).message ?? m); } catch { /* ya es texto */ }
    const i = m.indexOf('PRUEBA_RESULTADO ');
    if (i < 0) { ok(false, `${nombre}: error inesperado`, m.slice(0, 500)); return; }
    let resto = m.slice(i + 'PRUEBA_RESULTADO '.length);
    let filas = null;
    for (const intento of [resto, resto.replace(/\\"/g, '"'), resto.replace(/\\\\/g, '\\')]) {
      const fin = intento.lastIndexOf(']');
      try { filas = JSON.parse(intento.slice(0, fin + 1)); break; } catch { /* se prueba la siguiente forma */ }
    }
    if (!filas) { ok(false, `${nombre}: no se pudo leer el resultado`, resto.slice(0, 300)); return; }
    for (const f of filas) ok(f.ok === true, f.texto, f.detalle ?? '');
  }
}

const [despues] = await consultar(`select (select count(*) from reservas) nres, (select coalesce(max(id),0) from movimientos) mov,
  (select count(*) from clientes where codigo like 'PRB085%') cli, (select count(*) from destinos where puerto ilike 'Puerto Prb085%') dst`);
const [propios] = await consultar(`select (select count(*)::int from lotes where codigo_pallet like 'PRB 085 ${SELLO}%') lotes,
  (select count(*)::int from pedidos where numero_proforma like 'PRB085-${SELLO}%') peds`);
ok(Number(despues.cli) === 0 && Number(despues.dst) === 0 && propios.lotes === 0 && propios.peds === 0,
  'A · todo lo de la parte A se deshizo (pallets, pedidos, clientes y destinos de prueba no quedan)');

if (process.env.SOLO_BASE) {
  console.log(fallos.length ? `\n${fallos.length} FALLO(S):\n - ${fallos.join('\n - ')}` : '\nTodo correcto (solo base)');
  process.exit(fallos.length ? 1 : 0);
}

/* ==========================================================================
   B · EN EL NAVEGADOR
   ========================================================================== */
const nav = await chromium.launch({ channel: 'chrome', headless: true });
const errores = [];
async function sesion(correo) {
  const ctx = await nav.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errores.push(`${correo}: ${e.message}`));
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', `${correo}@santamonica.pe`);
  await p.fill('input[type="password"]', CLAVE);
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/panel/, { timeout: 60000 });
  return p;
}
const ir = (p, ruta) => p.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle', timeout: 90000 });
const RAZON = `PRUEBA-085 ${SELLO} SL`;
const mios = { cli: null, cot: [], ped: [], dst: [] };
const [vend] = await consultar(`select id, nombre from vendedores where activo order by id limit 1`);
const [vigo] = await consultar(`select id from destinos where puerto = 'Vigo' limit 1`);
/** Corta en la red las acciones del servidor (POST con «Next-Action»). */
const cortarAcciones = (p) => p.route('**/*', (r) => (r.request().method() === 'POST' && r.request().headers()['next-action'] ? r.abort() : r.continue()));
/** Todo el texto de un PDF bajado de /api/documentos (espacios colapsados). */
async function textoPdf(p, ruta) {
  const r = await p.request.get(`${BASE}${ruta}`);
  if (!r.ok()) return { ok: false, texto: `HTTP ${r.status()}` };
  const datos = await new PDFExtract().extractBuffer(Buffer.from(await r.body()), {});
  return { ok: true, texto: datos.pages.map((pg) => pg.content.map((x) => x.str).join(' ')).join(' ').replace(/\s+/g, ' ') };
}
/** Todo el texto de un Excel bajado de /api/documentos. */
async function textoExcel(p, ruta) {
  const r = await p.request.get(`${BASE}${ruta}`);
  if (!r.ok()) return { ok: false, texto: `HTTP ${r.status()} ${(await r.text()).slice(0, 200)}` };
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(await r.body());
  let texto = '';
  libro.eachSheet((h) => h.eachRow((f) => f.eachCell((cel) => { texto += ` ${cel.text ?? ''}`; })));
  return { ok: true, texto };
}

let g = null;
let c = null;
try {
  g = await sesion('gerencia');
  c = await sesion('comercial');

  /* ---------------------------------------------------------------------
     01 · EL FORMULARIO DEL CLIENTE CON TODO LO DE LA LISTA BASC
     --------------------------------------------------------------------- */
  console.log(SEC('B1', '01 · Formulario del cliente con los datos de la lista BASC'));
  {
    await ir(g, '/ventas/clientes/nuevo');
    for (const n of ['direccion', 'etiqueta_tax_id', 'continente', 'web', 'condicion', 'forma_pago', 'adelanto_pct', 'forma_pago_habitual', 'referencias_comerciales', 'productos_interes']) {
      ok(await g.locator(`[name="${n}"]`).count() === 1, `el alta tiene el campo «${n}»`);
    }
    await g.locator('input[placeholder="Nombre legal completo"]').fill(RAZON);
    await g.locator('input[list="lista-paises"]').fill('España');
    ok(await g.locator('[name="etiqueta_tax_id"]').inputValue() === 'CIF', 'al poner España se propone «CIF» como nombre de la identificación');
    await g.locator('[name="continente"]').fill('Europa');
    await g.locator('input[placeholder="Identificación fiscal"]').fill('B27800001');
    await g.locator('[name="direccion"]').fill('TRAV. PRUEBA 085, LOCAL 1 - VIGO - 36208 - PONTEVEDRA');
    await g.locator('input[placeholder="Nombre y apellido"]').fill('Ana Prueba');
    await g.locator('input[placeholder="compras@empresa.com"]').fill('ana@prueba085.es');
    await g.locator('[name="web"]').fill('www.prueba085.es');
    await g.locator('form select').filter({ has: g.locator('option', { hasText: 'Sin asignar' }) }).selectOption(String(vend.id));
    await g.locator('[name="forma_pago"]').selectOption('adelanto_saldo');
    await g.locator('[name="adelanto_pct"]').fill('30');
    await g.locator('[name="forma_pago_habitual"]').fill('Transferencia: 30% Adelanto / 70% contra copia de documentos');
    await g.locator('[name="condicion"]').fill('Importador / Distribuidor');
    await g.locator('[name="productos_interes"]').fill('Pota, reproductores');
    await g.locator('[name="referencias_comerciales"]').fill('Banco PRUEBA, cuenta desde 2020');
    await captura(g, 'b1-alta-cliente');
    await g.click('button[type="submit"]:has-text("Crear cliente")');
    await g.waitForURL(/\/ventas\/clientes\/\d+$/, { timeout: 60000 });
    mios.cli = Number(g.url().split('/').pop());
    const [cli] = await consultar(`select * from clientes where id = ${mios.cli}`);
    ok(cli?.razon_social === RAZON, 'se crea el cliente', `${mios.cli}`);
    ok(cli?.direccion === 'TRAV. PRUEBA 085, LOCAL 1 - VIGO - 36208 - PONTEVEDRA' && cli?.etiqueta_tax_id === 'CIF' && cli?.ruc_tax_id === 'B27800001',
      'se guardan dirección, identificación fiscal y su etiqueta', `${cli?.etiqueta_tax_id} ${cli?.ruc_tax_id}`);
    ok(cli?.continente === 'Europa' && cli?.web === 'www.prueba085.es' && cli?.condicion === 'Importador / Distribuidor',
      'se guardan continente, web y condición');
    ok(cli?.forma_pago === 'adelanto_saldo' && Number(cli?.adelanto_pct) === 30 && /30% Adelanto/.test(cli?.forma_pago_habitual ?? ''),
      'se guarda la forma de pago (estructurada y como la escribe Comex)');
    ok(cli?.productos_interes === 'Pota, reproductores' && /Banco PRUEBA/.test(cli?.referencias_comerciales ?? '') && Number(cli?.vendedor_id) === Number(vend.id),
      'se guardan productos de interés, referencias y vendedor');
    const ficha = await g.locator('dl.ficha').first().innerText();
    ok(/TRAV\. PRUEBA 085/.test(ficha) && /CIF: B27800001/.test(ficha) && /Pota, reproductores/.test(ficha) && /Banco PRUEBA/.test(ficha),
      'la ficha muestra dirección, CIF, productos y referencias');
    await captura(g, 'b1-ficha-cliente');

    await ir(g, `/ventas/clientes/${mios.cli}/editar`);
    ok(await g.locator('[name="direccion"]').inputValue() === 'TRAV. PRUEBA 085, LOCAL 1 - VIGO - 36208 - PONTEVEDRA'
      && await g.locator('[name="referencias_comerciales"]').inputValue() === 'Banco PRUEBA, cuenta desde 2020'
      && await g.locator('[name="forma_pago"]').inputValue() === 'adelanto_saldo',
      'la edición trae los datos guardados');
    await g.locator('[name="direccion"]').fill('TRAV. PRUEBA 085, LOCAL 2 - VIGO');
    await g.click('button[type="submit"]:has-text("Guardar cambios")');
    await g.waitForURL(new RegExp(`/ventas/clientes/${mios.cli}$`), { timeout: 60000 });
    const [cli2] = await consultar(`select direccion from clientes where id = ${mios.cli}`);
    ok(cli2?.direccion === 'TRAV. PRUEBA 085, LOCAL 2 - VIGO', 'se corrige la dirección desde Editar');
    const [ev] = await consultar(`select descripcion from eventos where id > ${prev.ev} and entidad = 'clientes' and entidad_id = ${mios.cli} and tipo = 'cliente_modificado' order by id desc limit 1`);
    ok(/dirección: «TRAV\. PRUEBA 085, LOCAL 1/.test(ev?.descripcion ?? ''), 'la bitácora del cliente cuenta el cambio de dirección', ev?.descripcion);
  }

  /* ---------------------------------------------------------------------
     01 y 12 · AL COTIZAR: VENDEDOR PROPUESTO Y «OTRO DESTINO…»
     --------------------------------------------------------------------- */
  console.log(SEC('B2', '01 y 12 · Vendedor propuesto y «Otro destino…» al cotizar'));
  {
    await ir(c, `/ventas/cotizaciones/nueva?cliente=${mios.cli}`);
    const selVend = c.locator('select').filter({ has: c.locator('option', { hasText: 'Sin vendedor' }) });
    ok(await selVend.inputValue() === String(vend.id), 'llegando desde la ficha, se propone el vendedor asignado al cliente', vend.nombre);
    await ir(c, '/ventas/cotizaciones/nueva');
    const selCli = c.locator('select').filter({ has: c.locator('option', { hasText: '— Elija un cliente —' }) });
    await selCli.selectOption(String(mios.cli));
    ok(await selVend.inputValue() === String(vend.id), 'al elegir el cliente en el desplegable, también');
    await selVend.selectOption('');
    ok(await selVend.inputValue() === '', 'y se puede cambiar (o dejar sin vendedor)');

    const destino = c.locator('[data-campo="destino"] select');
    await destino.selectOption('otro');
    ok(await c.locator('[data-bloque="destino-nuevo"]').count() === 1, '«＋ Otro destino…» abre puerto y país');
    ok(await c.locator('[data-accion="agregar-destino"]').isDisabled(), 'sin escribir, «Agregar» está apagado');
    await c.locator('[name="destino_puerto"]').fill(`Prb085 ${SELLO}`);
    await c.locator('[name="destino_pais"]').fill('Chile');
    await c.click('[data-accion="agregar-destino"]');
    await c.locator('[data-aviso="destino"]').waitFor({ timeout: 30000 });
    const aviso = await c.locator('[data-aviso="destino"]').innerText();
    const [d] = await consultar(`select id, puerto, pais, activo from destinos where puerto = 'Prb085 ${SELLO}'`);
    if (d) mios.dst.push(d.id);
    ok(!!d && d.pais === 'Chile' && d.activo, 'el destino queda dado de alta en el maestro', aviso);
    ok(!!d && await destino.inputValue() === String(d.id), 'y queda elegido en la cotización');
    await captura(c, 'b2-otro-destino');
    //  Otra vez el mismo, escrito distinto: se elige el que hay.
    await destino.selectOption('otro');
    await c.locator('[name="destino_puerto"]').fill(`PRB085 ${SELLO}`);
    await c.locator('[name="destino_pais"]').fill('chile');
    await c.click('[data-accion="agregar-destino"]');
    await c.waitForFunction(() => /ya estaba en la lista/.test(document.querySelector('[data-aviso="destino"]')?.textContent ?? ''), null, { timeout: 30000 });
    const [{ n }] = await consultar(`select count(*)::int n from destinos where lower(puerto) = lower('Prb085 ${SELLO}')`);
    ok(n === 1, 'escrito en mayúsculas no se duplica: «ya estaba en la lista»');
    //  Un corte de red al agregar: aviso, sin perder lo escrito.
    await destino.selectOption('otro');
    await c.locator('[name="destino_puerto"]').fill(`Prb085 ${SELLO} Corte`);
    await c.locator('[name="destino_pais"]').fill('Chile');
    await cortarAcciones(c);
    await c.click('[data-accion="agregar-destino"]');
    await c.waitForFunction((t) => (document.querySelector('[data-aviso="destino"]')?.textContent ?? '').includes(t), MSJ_SIN_CONEXION, { timeout: 30000 });
    await c.unroute('**/*');
    ok(await c.locator('[name="destino_puerto"]').inputValue() === `Prb085 ${SELLO} Corte`, 'un corte de red avisa y no pierde lo escrito');
  }

  /* ---------------------------------------------------------------------
     01 · LA PROFORMA LLEVA LOS DATOS DE LA COTIZACIÓN; «ACTUALIZAR…»
     --------------------------------------------------------------------- */
  console.log(SEC('B3', '01 · Cliente en la proforma, aviso de diferencias y «Actualizar con la ficha del cliente»'));
  //  Una cotización aceptada con su pedido (por SQL: la conversión ya la prueban otras regresiones).
  const [cot] = await consultar(`
    insert into cotizaciones (numero, cliente_id, vendedor_id, destino_id, estado, moneda, tipo_cambio, incoterm, validez_dias, creado_por, aprobada_en, aprobada_por, observaciones, contacto_nombre)
    values ('COT-PRB085-${SELLO}', ${mios.cli}, ${vend.id}, ${vigo.id}, 'aprobada', 'USD', 3.45, 'CFR', 15, '${usuarios.gerencia.id}', now(), '${usuarios.gerencia.id}', 'PRUEBA-085', 'Ana Prueba')
    returning id, numero, cliente_direccion`);
  mios.cot.push(cot.id);
  await consultar(`insert into cotizacion_lineas (cotizacion_id, sku_presentacion_id, cantidad_tm, precio_lista_tm, precio_tm, descuento_pct, orden)
                   values (${cot.id}, ${sku.id}, 2, 2000, 2000, 0, 1), (${cot.id}, ${sku2.id}, 1, 1500, 1500, 0, 2)`);
  const [ped] = await consultar(`
    insert into pedidos (numero_proforma, cotizacion_id, cliente_id, vendedor_id, destino_id, tipo_cambio, incoterm, ciclo, creado_por, tipo_despacho, fecha_comprometida, observaciones, contacto_nombre)
    values ('PRB085-${SELLO}-1', ${cot.id}, ${mios.cli}, ${vend.id}, ${vigo.id}, 3.45, 'CFR', 'pendiente_validacion', '${usuarios.gerencia.id}', 'exportacion', current_date + 30, 'PRUEBA-085', 'Ana Prueba')
    returning id, numero_proforma, cliente_direccion`);
  mios.ped.push(ped.id);
  await consultar(`insert into pedido_lineas (pedido_id, sku_presentacion_id, cantidad_tm, precio_lista_tm, precio_tm, orden)
                   values (${ped.id}, ${sku.id}, 2, 2000, 2000, 1), (${ped.id}, ${sku2.id}, 1, 1500, 1500, 2)`);
  await consultar(`update cotizaciones set estado = 'aceptada' where id = ${cot.id}`);
  ok(ped.cliente_direccion === 'TRAV. PRUEBA 085, LOCAL 2 - VIGO' && cot.cliente_direccion === ped.cliente_direccion, 'cotización y pedido nacen con la dirección de la ficha');
  //  La ficha del cliente se corrige DESPUÉS (como pasó con la lista BASC).
  await consultar(`update clientes set direccion = 'AV. CORREGIDA 99 - VIGO', ruc_tax_id = 'B27899999' where id = ${mios.cli}`);
  {
    await ir(g, `/ventas/pedidos/${ped.id}`);
    const panel = g.locator('[data-bloque="datos-cliente-documento"]');
    ok(/TRAV\. PRUEBA 085, LOCAL 2/.test(await panel.locator('[data-campo="direccion"]').innerText()), '«Cliente en la proforma» muestra la dirección con que se emitió');
    ok(/CIF: B27800001/.test(await panel.locator('[data-campo="tax-id"]').innerText()), 'y la identificación fiscal (CIF: …)');
    ok(new RegExp(vend.nombre).test(await panel.locator('[data-campo="vendedor"]').innerText()), 'y el vendedor');
    const dif = g.locator('[data-aviso="datos-cliente-distintos"]');
    ok(await dif.count() === 1 && /AV\. CORREGIDA 99/.test(await dif.innerText()), 'avisa que la ficha del cliente cambió, campo por campo', await dif.innerText().catch(() => ''));
    await captura(g, 'b3-cliente-en-la-proforma');
    const xp = await textoExcel(g, `/api/documentos/proforma/${ped.id}?formato=excel`);
    //  (El Excel imprime razón social e identificación; la dirección sale en el PDF, del mismo cargador.)
    ok(xp.ok && /CIF: B27800001/.test(xp.texto) && !/B27899999/.test(xp.texto), 'el Excel de la proforma lleva la identificación fijada (CIF: B27800001), no la corregida', xp.ok ? '' : xp.texto);
    const pp = await textoPdf(g, `/api/documentos/proforma/${ped.id}?formato=pdf`);
    ok(pp.ok && /TRAV\. PRUEBA 085, LOCAL 2/i.test(pp.texto) && !/CORREGIDA/i.test(pp.texto), 'el PDF de la proforma lleva la dirección fijada, no la corregida', pp.ok ? '' : pp.texto);
    const pc = await textoPdf(g, `/api/documentos/cotizacion/${cot.id}?formato=pdf`);
    //  El PDF de la cotización (área de documentos) hoy imprime razón social e identificación, no la dirección.
    ok(pc.ok && /CIF: B27800001/.test(pc.texto) && new RegExp(RAZON).test(pc.texto), 'y el PDF de la cotización, la misma razón social e identificación', pc.ok ? '' : pc.texto);
    const xc = await textoExcel(g, `/api/documentos/cotizacion/${cot.id}?formato=excel`);
    ok(xc.ok && /CIF: B27800001/.test(xc.texto) && new RegExp(RAZON).test(xc.texto), 'el Excel de la cotización dice lo mismo que la proforma (razón social e identificación)', xc.ok ? '' : xc.texto);

    //  Comercial lo actualiza.
    await ir(c, `/ventas/pedidos/${ped.id}`);
    await c.click('[data-accion="actualizar-datos-cliente"]');
    await c.click('[data-accion="confirmar-actualizar-datos-cliente"]');
    await c.waitForFunction(() => /lleva ahora los datos de la ficha/.test(document.querySelector('[data-bloque="actualizar-datos-cliente"]')?.textContent ?? ''), null, { timeout: 30000 });
    const [p2] = await consultar(`select cliente_direccion, cliente_tax_id from pedidos where id = ${ped.id}`);
    ok(p2.cliente_direccion === 'AV. CORREGIDA 99 - VIGO' && p2.cliente_tax_id === 'B27899999', '«Actualizar con la ficha del cliente» copia los datos de hoy al pedido');
    await c.reload({ waitUntil: 'networkidle' });
    ok(await c.locator('[data-aviso="datos-cliente-distintos"]').count() === 0, 'y el aviso de diferencias desaparece');
    const [ev] = await consultar(`select descripcion from eventos where id > ${prev.ev} and entidad = 'pedidos' and entidad_id = ${ped.id} and tipo = 'datos_cliente_actualizados'`);
    ok(/AV\. CORREGIDA 99/.test(ev?.descripcion ?? ''), 'queda en el historial del pedido', ev?.descripcion);
    const xp2 = await textoExcel(c, `/api/documentos/proforma/${ped.id}?formato=excel`);
    ok(xp2.ok && /CIF: B27899999/.test(xp2.texto), 'y la proforma ya sale con la identificación nueva');
  }

  /* ---------------------------------------------------------------------
     13 · MODIFICAR LA COTIZACIÓN ACEPTADA, CON AUTORIZACIÓN
     --------------------------------------------------------------------- */
  console.log(SEC('B4', '13 · «Autorizar modificación» → «Editar (autorizado)» → el cambio llega al pedido'));
  {
    await ir(c, `/ventas/cotizaciones/${cot.id}`);
    const bAut = c.locator('[data-accion="autorizar-modificacion"]');
    ok(await bAut.count() === 1 && await bAut.isDisabled() && /Aprueba cotizaciones/.test(await bAut.getAttribute('title') ?? ''),
      'Comercial (sin la facultad) ve «Autorizar modificación» apagado, con el porqué');
    ok(/Autorizar modificación/.test(await c.locator('button[title^="Ya generó un pedido"]').first().getAttribute('title') ?? ''), 'y «Editar» apagado dice cómo se modifica');
    await ir(c, `/ventas/cotizaciones/${cot.id}/editar`);
    ok(/nohayeditar=convertida/.test(c.url()), 'sin autorización, la edición rebota a la ficha');

    await ir(g, `/ventas/cotizaciones/${cot.id}`);
    await g.click('[data-accion="autorizar-modificacion"]');
    ok(await g.locator('[data-accion="confirmar-autorizacion"]').isDisabled(), 'sin motivo, «Autorizar» está apagado');
    await g.locator('[name="motivo_modificacion"]').fill('PRUEBA-085 el cliente pidió otro precio');
    await g.click('[data-accion="confirmar-autorizacion"]');
    await g.locator('[data-aviso="modificacion-autorizada"]').waitFor({ timeout: 30000 });
    ok(/PRUEBA-085 el cliente pidió otro precio/.test(await g.locator('[data-aviso="modificacion-autorizada"]').innerText()), 'la ficha dice quién autorizó y por qué');
    await captura(g, 'b4-modificacion-autorizada');

    await ir(c, `/ventas/cotizaciones/${cot.id}`);
    ok(await c.locator('[data-accion="editar-autorizada"]').count() === 1, 'Comercial ve «Editar (autorizado)»');
    await c.click('[data-accion="editar-autorizada"]');
    await c.waitForURL(/\/editar$/, { timeout: 60000 });
    await c.waitForLoadState('networkidle');
    ok(await c.locator('[data-aviso="modificacion-autorizada"]').count() === 1, 'el formulario avisa que el cambio pasa al pedido');
    await captura(c, 'b4-editar-autorizada');
    const precio = c.locator('table input.form-mini-ancho').first();
    await precio.fill('2150');
    await c.click('button:has-text("Guardar cambios")');
    await c.waitForURL(new RegExp(`/ventas/cotizaciones/${cot.id}$`), { timeout: 60000 });
    await c.waitForLoadState('networkidle');
    const [l] = await consultar(`select precio_tm from pedido_lineas where pedido_id = ${ped.id} and sku_presentacion_id = ${sku.id}`);
    const [cl] = await consultar(`select precio_tm from cotizacion_lineas where cotizacion_id = ${cot.id} and sku_presentacion_id = ${sku.id}`);
    ok(Number(cl?.precio_tm) === 2150 && Number(l?.precio_tm) === 2150, 'el precio nuevo queda en la cotización Y en el pedido', `${cl?.precio_tm} / ${l?.precio_tm}`);
    const [cc] = await consultar(`select estado, modificacion_autorizada_en from cotizaciones where id = ${cot.id}`);
    ok(cc.estado === 'aceptada' && cc.modificacion_autorizada_en === null, 'la cotización sigue aceptada y la autorización se consumió');
    const [ev] = await consultar(`select descripcion from eventos where id > ${prev.ev} and entidad = 'pedidos' and entidad_id = ${ped.id} and tipo = 'pedido_modificado_desde_cotizacion'`);
    ok(/los precios/.test(ev?.descripcion ?? ''), 'el historial del pedido dice qué cambió y quién autorizó', ev?.descripcion);
    ok(await c.locator('[data-accion="editar-autorizada"]').count() === 0 && await c.locator('[data-accion="autorizar-modificacion"]').count() === 1,
      'después de guardar, vuelve a estar cerrada');
  }

  /* ---------------------------------------------------------------------
     06 · VARIOS PALLETS A LA VEZ (sin reservar ninguno real)
     --------------------------------------------------------------------- */
  console.log(SEC('B5', '06 · Disponibilidad: marcar varios pallets (también equivalentes) y apartarlos juntos'));
  const [pr] = await consultar(`
    insert into pedidos (numero_proforma, cliente_id, tipo_cambio, incoterm, ciclo, situacion, creado_por, tipo_despacho, destino_id, fecha_comprometida, observaciones)
    values ('PRB085-${SELLO}-R', ${mios.cli}, 3.45, 'CFR', 'confirmado', 'facturado', '${usuarios.gerencia.id}', 'exportacion', ${vigo.id}, current_date + 30, 'PRUEBA-085 (facturado a propósito: la base no le deja apartar stock)')
    returning id`);
  mios.ped.push(pr.id);
  const [lr] = await consultar(`insert into pedido_lineas (pedido_id, sku_presentacion_id, cantidad_tm, precio_lista_tm, precio_tm, orden)
                                values (${pr.id}, ${sku.id}, 50, 1000, 1000, 1) returning id`);
  {
    await ir(g, `/ventas/pedidos/${pr.id}?t=disponibilidad`);
    const fila = g.locator(`tr[data-linea="${lr.id}"]`);
    await fila.locator('button:has-text("Apartar stock")').click();
    const marcas = g.locator('input[name="marcar_pallet"]');
    await marcas.first().waitFor({ timeout: 60000 });
    const nMarcas = await marcas.count();
    ok(nMarcas >= 2, 'cada pallet trae su casilla para marcarlo', `${nMarcas} pallets`);
    await marcas.nth(0).check();
    await marcas.nth(1).check();
    const resumen = g.locator('[data-bloque="marcados"]');
    ok(/2 pallets marcados/.test(await resumen.innerText()), 'al marcar dos, se ve «2 pallets marcados», cuánto suman y cuánto cubren', (await resumen.innerText()).replace(/\s+/g, ' '));
    ok(/Apartar los 2 marcados/.test(await g.locator('[data-accion="apartar-marcados"]').innerText()), 'y el botón «Apartar los 2 marcados»');
    await g.locator('input[name="marcar_todos"]').check();
    ok(new RegExp(`${nMarcas} pallets marcados`).test(await resumen.innerText()), '«marcar todos» marca la tabla entera');
    await g.locator('input[name="marcar_todos"]').uncheck();
    ok(await resumen.count() === 0, 'y al desmarcar todos, el resumen se va');

    //  Equivalentes: misma especie y corte, otra presentación.
    await g.locator('input[name="equivalentes"]').check();
    await g.locator('tr[data-equivalente="si"]').first().waitFor({ timeout: 60000 });
    await g.locator('tr[data-equivalente="no"] input[name="marcar_pallet"]').first().check();
    await g.locator('tr[data-equivalente="si"] input[name="marcar_pallet"]').first().check();
    ok(/2 pallets marcados/.test(await resumen.innerText()) && /1 equivalente/i.test(await resumen.innerText()),
      'con «Incluir SKU equivalentes» se marcan también equivalentes (el resumen lo dice)', (await resumen.innerText()).replace(/\s+/g, ' '));
    await captura(g, 'b5-varios-pallets');

    //  Un corte de red al apartar: aviso, y lo marcado sigue marcado.
    await cortarAcciones(g);
    await g.click('[data-accion="apartar-marcados"]');
    await g.waitForFunction((t) => [...document.querySelectorAll('.reservar-mensaje')].some((e) => (e.textContent ?? '').includes(t)), MSJ_SIN_CONEXION, { timeout: 30000 });
    await g.unroute('**/*');
    ok(/2 pallets marcados/.test(await resumen.innerText()), 'un corte de red avisa y no pierde lo marcado');

    //  De verdad, contra la base: el pedido de prueba está facturado, así que cada pallet se rechaza.
    await g.click('[data-accion="apartar-marcados"]');
    await g.waitForFunction(() => [...document.querySelectorAll('.reservar-mensaje')].some((e) => /ninguno de los pallets marcados/.test(e.textContent ?? '')), null, { timeout: 60000 });
    const msj = await g.locator('.reservar-mensaje').first().innerText();
    ok(/No se pudo con: .+ya está facturado/.test(msj) && (msj.match(/ya está facturado/g) ?? []).length === 2,
      'el servidor pasa CADA pallet marcado por las validaciones de siempre (aquí, los dos rechazados)', msj.slice(0, 200));
    const [{ n }] = await consultar(`select count(*)::int n from reservas where pedido_linea_id = ${lr.id}`);
    ok(n === 0, 'no se apartó ningún pallet real');
  }

  /* ---------------------------------------------------------------------
     13 · ELIMINAR EL PEDIDO (solo Gerencia)
     --------------------------------------------------------------------- */
  console.log(SEC('B6', '13 · «Eliminar pedido»: apagado para Comercial, Gerencia lo elimina con su cotización'));
  {
    await ir(c, `/ventas/pedidos/${ped.id}`);
    const bC = c.locator('[data-accion="eliminar-pedido"]');
    ok(await bC.count() === 1 && await bC.isDisabled() && /solo Gerencia/.test(await bC.getAttribute('title') ?? ''), 'Comercial ve «Eliminar pedido» apagado: lo hace solo Gerencia (y le dice que puede cancelarlo)');
    await ir(g, `/ventas/pedidos/${ped.id}`);
    await g.click('[data-accion="eliminar-pedido"]');
    ok(await g.locator('[data-accion="confirmar-eliminar-pedido"]').isDisabled(), 'sin motivo, «Sí, eliminar» está apagado');
    await g.locator('[name="motivo_eliminacion"]').fill('PRUEBA-085 proforma de prueba');
    await g.locator('[name="con_cotizacion"]').check();
    await captura(g, 'b6-eliminar-pedido');
    await g.click('[data-accion="confirmar-eliminar-pedido"]');
    await g.waitForURL(/\/ventas\/pedidos\?eliminado=/, { timeout: 60000 });
    ok(/Pedido PRB085-.+ eliminado\. También se eliminó la cotización/.test(await g.locator('[data-aviso="pedido-eliminado"]').innerText()), 'vuelve al listado con el aviso');
    const [{ np, nc }] = await consultar(`select (select count(*)::int from pedidos where id = ${ped.id}) np, (select count(*)::int from cotizaciones where id = ${cot.id}) nc`);
    ok(np === 0 && nc === 0, 'el pedido y su cotización ya no existen');
    const [{ na }] = await consultar(`select count(*)::int na from auditoria where tabla = 'pedidos' and registro_id::text = '${ped.id}' and accion = 'DELETE'`);
    ok(na === 1, 'la auditoría conserva el borrado');
  }
} catch (e) {
  ok(false, 'la prueba se interrumpió', e.stack ?? String(e));
  if (g) { await captura(g, 'error-gerencia'); console.log('  gerencia estaba en', g.url()); }
  if (c) { await captura(c, 'error-comercial'); console.log('  comercial estaba en', c.url()); }
} finally {
  await limpiar();
  await nav.close();
}

if (errores.length) console.log(`\nErrores de página:\n - ${errores.join('\n - ')}`);
console.log(`\nCapturas en ${CARPETA}`);
console.log(fallos.length ? `\n${fallos.length} FALLO(S):\n - ${fallos.join('\n - ')}` : '\nTodo correcto');
process.exit(fallos.length ? 1 : 0);

/* ==========================================================================
   LIMPIEZA: solo lo que creó esta prueba (sin tocar la auditoría ni el Kardex)
   ========================================================================== */
async function limpiar() {
  try {
    const cli = mios.cli ?? 0;
    const peds = (await consultar(`select id from pedidos where id > ${prev.ped} and (numero_proforma like 'PRB085-${SELLO}%' or cliente_id = ${cli})`)).map((x) => x.id);
    const cots = (await consultar(`select id from cotizaciones where id > ${prev.cot} and (numero like 'COT-PRB085-${SELLO}%' or cliente_id = ${cli})`)).map((x) => x.id);
    const dsts = (await consultar(`select id from destinos where id > ${prev.dst} and puerto ilike 'Prb085 ${SELLO}%'`)).map((x) => x.id);
    const arr = (xs) => `array[${xs.join(',') || 0}]::bigint[]`;
    console.log(`\n  limpieza: ${peds.length} pedido(s), ${cots.length} cotización(es), cliente ${cli || '—'}, ${dsts.length} destino(s)`);
    await ejecutarSQL(`
      delete from contratos where pedido_id = any(${arr(peds)}) or cotizacion_id = any(${arr(cots)});
      delete from pedido_cuentas where pedido_id = any(${arr(peds)});
      delete from pedido_lineas where pedido_id = any(${arr(peds)});
      delete from pedidos where id = any(${arr(peds)});
      delete from cotizacion_cuentas where cotizacion_id = any(${arr(cots)});
      delete from cotizacion_lineas where cotizacion_id = any(${arr(cots)});
      delete from cotizaciones where id = any(${arr(cots)});
      ${cli ? `delete from contactos where cliente_id = ${cli}; delete from clientes where id = ${cli};` : ''}
      delete from destinos where id = any(${arr(dsts)});
      delete from eventos where id > ${prev.ev} and (
        (entidad = 'pedidos' and entidad_id = any(${arr([...peds, ...mios.ped])}))
        or (entidad = 'cotizaciones' and entidad_id = any(${arr([...cots, ...mios.cot])}))
        or (entidad = 'clientes' and entidad_id = ${cli || 0})
        or (entidad = 'destinos' and entidad_id = any(${arr(dsts)})));
      delete from alertas where id > ${prev.al} and (
        (entidad = 'pedidos' and entidad_id = any(${arr([...peds, ...mios.ped])})) or (entidad in ('clientes', 'cliente') and entidad_id = ${cli || 0}));
    `);
    const [q] = await consultar(`select (select count(*)::int from pedidos where numero_proforma like 'PRB085-${SELLO}%') p,
      (select count(*)::int from clientes where razon_social = '${RAZON}') c, (select count(*)::int from destinos where puerto ilike 'Prb085 ${SELLO}%') d,
      (select count(*)::int from reservas) r, (select coalesce(max(id),0) from movimientos) m, (select count(*)::int from auditoria where id > ${prev.au}) au`);
    ok(q.p === 0 && q.c === 0 && q.d === 0, 'limpieza: no queda nada de la prueba');
    //  Reservas y movimientos creados por los usuarios de prueba durante la prueba: ninguno.
    const [k] = await consultar(`select (select count(*)::int from reservas where id > ${prev.res} and creado_por in ('${usuarios.gerencia.id}', '${usuarios.comercial.id}')) r,
      (select count(*)::int from movimientos where id > ${prev.mov} and usuario_id in ('${usuarios.gerencia.id}', '${usuarios.comercial.id}')) m`);
    ok(k.r === 0 && k.m === 0, 'limpieza: ninguna reserva ni movimiento de Kardex hecho por la prueba (no se tocó ningún pallet)');
    console.log(`  (quedan ${q.au} filas nuevas de auditoría: la bitácora no se borra)`);
  } catch (e) {
    ok(false, 'limpieza', String(e.message ?? e));
  }
}
