/**
 * ============================================================================
 *  SEMBRADO DE LOGÍSTICA Y FINANZAS · Santa Mónica ERP
 * ============================================================================
 *  Cierra el ciclo de la venta:
 *    embarque → packing list → plano de estiba → despacho → factura → cobranza
 *
 *  El plano de estiba NO se inventa: se genera llamando a la misma función de
 *  base de datos que usará el sistema en producción, así que lo que se ve en
 *  pantalla es el resultado del algoritmo real.
 * ============================================================================
 */

export async function sembrarLogistica(ctx) {
  const {
    almDb, stock, pedDb, clientesDb, destinosDb,
    insertarLote, consultar, ejecutarSQL,
    entero, elegir, decimal, suerte, fechaMenos, fechaMas, paso, ok,
    uAlmacen, uComercial, uComex,
  } = ctx;

  const transDb = await consultar('select id from transportistas order by id');
  const vehDb = await consultar('select id from vehiculos order by id');
  const condDb = await consultar('select id from conductores order by id');
  const parCont = await consultar(`select
      (select valor::int from parametros where clave='contenedor_filas') as filas,
      (select valor::int from parametros where clave='contenedor_sacos_por_fila') as sacos`);
  const FILAS = parCont[0].filas;
  const SACOS = parCont[0].sacos;
  const CAPACIDAD_BULTOS = FILAS * SACOS; // 22 × 61 = 1.342, como el POT761 real

  /* ======================================================================
     PASO 9 · EMBARQUES
     Se programan a partir de los pedidos que ya avanzaron.
     ====================================================================== */
  paso(9, 'Programando embarques…');

  // Pedidos que merecen un embarque (confirmados en adelante)
  const pedidosEmbarcables = pedDb.filter((p) =>
    ['confirmado', 'despachado', 'cerrado'].includes(p.ciclo));

  const embarques = [];
  const NAVIERAS = ['COSCO', 'Maersk', 'Hapag-Lloyd', 'MSC', 'CMA CGM', 'Evergreen'];

  /*
   * QUÉ PEDIDOS LLEVA CADA EMBARQUE SE DECIDE ANTES QUE SU FECHA.
   *
   * Antes era al revés: se sorteaba la fecha del embarque —entre 25 días en el
   * futuro y 200 en el pasado— y después se repartían los pedidos en rueda.
   * Con eso, 38 de los 92 pedidos despachados aparecían saliendo ANTES de
   * haberse pedido; el peor, 178 días antes. Mientras nadie restaba fechas no
   * se notaba, pero la pantalla de tiempos lo dejó al descubierto.
   *
   * Ahora se eligen primero los pedidos y la salida se programa DESPUÉS del
   * último de ellos.
   */
  const cargaDe = [];
  for (let i = 0; i < 190; i++) {
    const cuantos = suerte(0.25) ? 2 : 1;   // algunos embarques consolidan dos
    const suyos = [];
    for (let k = 0; k < cuantos; k++) {
      suyos.push(pedidosEmbarcables[(i * 2 + k) % pedidosEmbarcables.length]);
    }
    cargaDe.push(suyos);
  }

  for (let i = 1; i <= 190; i++) {
    const alm = elegir(almDb);
    const suyos = cargaDe[i - 1];

    /* Cuántos días atrás quedó el pedido más reciente de este embarque. */
    const masReciente = Math.min(
      ...suyos.map((p) => Math.round(
        (new Date('2026-08-25') - new Date(p.fecha_solicitada)) / 86400000
      ))
    );

    /*
     * La salida va entre 5 y 25 días DESPUÉS del último pedido. Si eso cae en
     * el futuro, mejor: el planificador necesita agenda por delante.
     */
    const dias = masReciente - entero(5, 25);
    const estado = dias > 0
      ? elegir(['despachado', 'despachado', 'despachado', 'confirmado'])
      : elegir(['planificado', 'planificado', 'confirmado', 'en_preparacion']);

    embarques.push({
      numero: `EMB-2026-${String(i).padStart(4, '0')}`,
      fecha_programada: fechaMenos(dias),
      almacen_id: alm.id,
      destino_id: elegir(destinosDb).id,
      tipo_despacho: suerte(0.94) ? 'exportacion' : 'mercado_nacional',
      booking: `LMM${entero(580000, 610000)}`,
      naviera: elegir(NAVIERAS),
      transportista_id: elegir(transDb).id,
      vehiculo_id: elegir(vehDb).id,
      conductor_id: elegir(condDb).id,
      estado,
      creado_por: uComex,
    });
  }
  await insertarLote('embarques',
    ['numero', 'fecha_programada', 'almacen_id', 'destino_id', 'tipo_despacho', 'booking',
     'naviera', 'transportista_id', 'vehiculo_id', 'conductor_id', 'estado', 'creado_por'],
    embarques);
  const embDb = await consultar('select id, numero, almacen_id, estado, fecha_programada from embarques order by id');
  ok(`${embDb.length} embarques programados`);

  // Relación embarque ↔ pedido (permite agrupar y consolidar)
  /* El vínculo ya se decidió arriba: aquí solo se escribe, con los mismos
     pedidos que sirvieron para calcular la fecha de cada embarque. */
  const embPed = [];
  const usados = new Set();
  embDb.forEach((e, i) => {
    for (const p of cargaDe[i] ?? []) {
      const clave = `${e.id}-${p.id}`;
      if (usados.has(clave)) continue;
      usados.add(clave);
      embPed.push({ embarque_id: e.id, pedido_id: p.id });
    }
  });
  await insertarLote('embarque_pedidos', ['embarque_id', 'pedido_id'], embPed);
  ok(`${embPed.length} vínculos embarque ↔ pedido`);

  /* ======================================================================
     PASO 10 · PACKING LISTS Y PLANOS DE ESTIBA
     ====================================================================== */
  paso(10, 'Armando packing lists y planos de estiba…');

  // La carga de un contenedor NO se inventa: son las reservas que el pedido ya
  // consumió. Ese es el flujo real del negocio (reserva → preparación → despacho)
  // y además garantiza que el producto exista físicamente donde se dice.
  const consumidas = await consultar(`
    select r.id, r.lote_id, r.almacen_id, r.bultos, r.peso_neto_kg,
           pl.pedido_id, pl.id as pedido_linea_id, l.fecha_produccion
      from reservas r
      join pedido_lineas pl on pl.id = r.pedido_linea_id
      join lotes l on l.id = r.lote_id
     where r.estado = 'consumida'
     order by l.fecha_produccion asc, r.id asc
  `);

  // Agrupadas por pedido, para poder repartirlas entre los embarques
  const cargaPorPedido = new Map();
  for (const c of consumidas) {
    if (!cargaPorPedido.has(c.pedido_id)) cargaPorPedido.set(c.pedido_id, []);
    cargaPorPedido.get(c.pedido_id).push(c);
  }

  const pedidoDeEmbarquePrev = new Map();
  for (const ep of embPed) {
    if (!pedidoDeEmbarquePrev.has(ep.embarque_id)) pedidoDeEmbarquePrev.set(ep.embarque_id, []);
    pedidoDeEmbarquePrev.get(ep.embarque_id).push(ep.pedido_id);
  }

  const packings = [];
  const almacenRealPorCodigo = {};
  let nPk = 0;

  for (const e of embDb) {
    // Solo los embarques que ya avanzaron tienen carga armada
    if (!['despachado', 'en_preparacion', 'confirmado'].includes(e.estado)) continue;

    const pedidos = pedidoDeEmbarquePrev.get(e.id) || [];
    const lotesPk = [];
    let bultosTotal = 0;

    for (const pid of pedidos) {
      const carga = cargaPorPedido.get(pid);
      if (!carga || !carga.length) continue;
      while (carga.length && bultosTotal < CAPACIDAD_BULTOS - 40 && lotesPk.length < 16) {
        const c = carga.shift();
        const bultos = Math.min(Number(c.bultos), CAPACIDAD_BULTOS - bultosTotal);
        if (bultos < 1) break;
        const pesoUnit = Number(c.peso_neto_kg) / Number(c.bultos);
        lotesPk.push({
          loteId: c.lote_id,
          bultos,
          peso: Number((bultos * pesoUnit).toFixed(3)),
          almacen_id: c.almacen_id,
          pedido_linea_id: c.pedido_linea_id,
        });
        bultosTotal += bultos;
      }
    }
    if (!lotesPk.length) continue;

    nPk++;
    const yaDespachado = e.estado === 'despachado';
    const horaIni = entero(7, 19);
    const dur = decimal(2.5, 7, 1); // el tiempo real hoy promedia 4,9 horas
    const horaFin = Math.min(23, Math.floor(horaIni + dur));
    const codigo = `PL POT${String(300 + nPk)}`;

    // El almacén del embarque se alinea con el de la carga, para que el
    // documento sea coherente con el Kardex.
    almacenRealPorCodigo[codigo] = lotesPk[0].almacen_id;

    packings.push({
      codigo,
      embarque_id: e.id,
      contenedor: `${elegir(['TEMU', 'CGMU', 'TTNU', 'TRIU', 'OERU', 'MSDU', 'SEKU'])}${entero(1000000, 9999999)}`,
      precinto: `PRE${entero(100000, 999999)}`,
      guia_remision: `${suerte(0.5) ? 'T002' : 'EG07'}-${String(entero(1, 9999)).padStart(7, '0')}`,
      dam: `${entero(100, 999)}-2026-10-${entero(100000, 999999)}`,
      supervisor_id: uAlmacen,
      turno: horaIni >= 18 || horaIni < 6 ? 'noche' : 'dia',
      fecha_carga: e.fecha_programada,
      hora_inicio: `${String(horaIni).padStart(2, '0')}:${String(entero(0, 59)).padStart(2, '0')}:00`,
      hora_fin: `${String(horaFin).padStart(2, '0')}:${String(entero(0, 59)).padStart(2, '0')}:00`,
      filas_contenedor: FILAS,
      sacos_por_fila: SACOS,
      // Nace abierto siempre: el plano de estiba solo se puede generar
      // mientras el packing no esté cerrado. El cierre viene después.
      estado: 'en_carga',
      creado_por: uComex,
      _lotes: lotesPk,
      _despachado: yaDespachado,
      _embarque: e,
    });
  }

  await insertarLote('packing_lists',
    ['codigo', 'embarque_id', 'contenedor', 'precinto', 'guia_remision', 'dam', 'supervisor_id',
     'turno', 'fecha_carga', 'hora_inicio', 'hora_fin', 'filas_contenedor', 'sacos_por_fila',
     'estado', 'creado_por'],
    packings);
  const pkDb = await consultar('select id, codigo, embarque_id, estado, fecha_carga, guia_remision from packing_lists order by id');
  const pkPorCodigo = Object.fromEntries(pkDb.map((p) => [p.codigo, p]));
  ok(`${pkDb.length} packing lists`);

  // --- Líneas del packing ---------------------------------------------------
  // Cada línea ya sabe a qué línea de pedido corresponde, porque nació de una
  // reserva. Eso es lo que permite la trazabilidad factura → lote.
  const lineasPorPedido = await consultar(`
    select pl.id, pl.pedido_id, pl.sku_presentacion_id from pedido_lineas pl order by pl.id
  `);
  const mapaPedidoLineas = new Map();
  for (const l of lineasPorPedido) {
    if (!mapaPedidoLineas.has(l.pedido_id)) mapaPedidoLineas.set(l.pedido_id, []);
    mapaPedidoLineas.get(l.pedido_id).push(l);
  }
  const pedidoDeEmbarque = pedidoDeEmbarquePrev;

  const pkLineas = [];
  const vistas = new Set();
  for (const p of packings) {
    const db = pkPorCodigo[p.codigo];
    for (const l of p._lotes) {
      // La tabla tiene clave única (packing_list_id, lote_id): si el mismo lote
      // aparece dos veces en el contenedor, se acumula en una sola línea.
      const clave = `${db.id}-${l.loteId}`;
      const previa = pkLineas.find((x) => x._clave === clave);
      if (previa) {
        previa.bultos += l.bultos;
        previa.peso_neto_kg = Number((previa.peso_neto_kg + l.peso).toFixed(3));
        continue;
      }
      vistas.add(clave);
      pkLineas.push({
        _clave: clave,
        packing_list_id: db.id,
        lote_id: l.loteId,
        pedido_linea_id: l.pedido_linea_id,
        bultos: l.bultos,
        peso_neto_kg: l.peso,
      });
    }
  }
  await insertarLote('packing_lineas',
    ['packing_list_id', 'lote_id', 'pedido_linea_id', 'bultos', 'peso_neto_kg'], pkLineas, 400);
  ok(`${pkLineas.length} líneas de packing`);

  // El almacén del embarque se alinea con el de la carga real
  await ejecutarSQL(`
    update embarques e
       set almacen_id = sub.almacen_id
      from (
        select pk.embarque_id, min(ex.almacen_id) as almacen_id
          from packing_lists pk
          join packing_lineas pl on pl.packing_list_id = pk.id
          join existencias ex on ex.lote_id = pl.lote_id
         group by pk.embarque_id
      ) sub
     where e.id = sub.embarque_id;
  `);

  // --- Generación del plano de estiba con la FUNCIÓN REAL del sistema -----
  // Una sola llamada a la base recorre todos los packing lists.
  await ejecutarSQL(`
    do $gen$
    declare r record; v_filas int;
    begin
      for r in select id from packing_lists order by id loop
        begin
          v_filas := generar_plano_estiba(r.id);
        exception when others then
          -- Si una carga excediera el contenedor, se deja constancia y se sigue
          raise notice 'No se pudo generar el plano del packing %: %', r.id, sqlerrm;
        end;
      end loop;
    end
    $gen$;
  `);
  // Ahora sí: los packing de embarques ya despachados se cierran.
  // Este orden importa — el sistema impide regenerar el plano de un packing
  // cerrado, que es justamente la protección que queremos en producción.
  await ejecutarSQL(`
    update packing_lists pk
       set estado = 'cerrado'
      from embarques e
     where e.id = pk.embarque_id and e.estado = 'despachado';
  `);

  const planoStats = await consultar(`
    select count(distinct packing_list_id) as packings,
           count(*) as celdas,
           max(fila) as fila_max,
           sum(sacos) as sacos
      from plano_estiba`);
  ok(`plano de estiba generado: ${planoStats[0].packings} contenedores · ${planoStats[0].celdas} celdas · ${planoStats[0].sacos} sacos`);

  /* ======================================================================
     PASO 11 · DESPACHOS
     Aquí sale el producto y se cierra la venta.
     ====================================================================== */
  paso(11, 'Ejecutando despachos…');

  const despachos = [];
  const movSalida = [];
  let nDesp = 0;

  for (const p of packings) {
    if (!p._despachado) continue;
    const db = pkPorCodigo[p.codigo];
    nDesp++;
    const numero = `DESP-2026-${String(nDesp).padStart(4, '0')}`;
    const fechaSalida = `${db.fecha_carga} ${String(entero(8, 22)).padStart(2, '0')}:00:00-05`;

    despachos.push({
      packing_list_id: db.id,
      numero,
      fecha_salida: fechaSalida,
      encargado_id: uAlmacen,
      almacen_id: p._embarque.almacen_id,
      creado_por: uAlmacen,
      _codigo: p.codigo,
    });

    for (const l of p._lotes) {
      const s = stock.get(`${l.loteId}:${l.almacen_id}`);
      movSalida.push({
        fecha: fechaSalida,
        tipo: 'salida_despacho',
        lote_id: l.loteId,
        almacen_id: l.almacen_id,
        camara_id: null,
        bultos: l.bultos,
        peso_neto_kg: l.peso,
        costo_unitario: s ? s.costo : 0,
        documento_tipo: 'despacho',
        documento_ref: db.guia_remision,
        usuario_id: uAlmacen,
      });
    }
  }

  await insertarLote('despachos',
    ['packing_list_id', 'numero', 'fecha_salida', 'encargado_id', 'almacen_id', 'creado_por'],
    despachos);
  await insertarLote('movimientos',
    ['fecha', 'tipo', 'lote_id', 'almacen_id', 'camara_id', 'bultos', 'peso_neto_kg',
     'costo_unitario', 'documento_tipo', 'documento_ref', 'usuario_id'],
    movSalida, 300);
  ok(`${despachos.length} despachos · ${movSalida.length} salidas de Kardex`);

  /* ======================================================================
     PASO 12 · FACTURACIÓN Y COBRANZA
     ====================================================================== */
  paso(12, 'Emitiendo facturas y registrando cobranzas…');

  const despDb = await consultar('select id, numero, packing_list_id, fecha_salida from despachos order by id');
  const pkAEmbarque = Object.fromEntries(pkDb.map((p) => [p.id, p.embarque_id]));

  const filasIgv = await consultar(`select valor as v from parametros where clave = 'igv_porcentaje'`);
  const igv = filasIgv.length ? Number(filasIgv[0].v) : 18;

  const facturas = [];
  let nFac = 0;
  for (const d of despDb) {
    const embId = pkAEmbarque[d.packing_list_id];
    const pedidosDelEmb = pedidoDeEmbarque.get(embId) || [];
    if (!pedidosDelEmb.length) continue;

    const pedido = pedDb.find((p) => p.id === pedidosDelEmb[0]);
    if (!pedido) continue;
    const cliente = clientesDb.find((c) => c.id === pedido.cliente_id);
    nFac++;

    /*
     * El importe va EN LA MONEDA DE LA FACTURA. Se generaba el mismo rango
     * para las dos, así que las facturas en soles llevaban cifras con
     * magnitud de dólares y la cartera no se podía totalizar.
     */
    const subtotal = Number(
      (decimal(35000, 320000, 2) * (pedido.moneda === 'PEN' ? Number(pedido.tipo_cambio) : 1)).toFixed(2)
    );
    const impuesto = Number((subtotal * (igv / 100)).toFixed(2));
    const emision = String(d.fecha_salida).slice(0, 10);
    const venc = fechaMas(cliente ? cliente.dias_credito : 30, new Date(emision));

    // El estado se deduce de si ya venció y de cuánto se cobró
    const vencida = new Date(venc) < new Date('2026-08-25');
    const estado = vencida
      ? elegir(['vencida', 'vencida', 'cobrada', 'parcialmente_cobrada'])
      : elegir(['emitida', 'emitida', 'parcialmente_cobrada', 'cobrada']);

    facturas.push({
      numero: `F001-${String(nFac).padStart(6, '0')}`,
      pedido_id: pedido.id,
      cliente_id: pedido.cliente_id,
      despacho_id: d.id,
      moneda: pedido.moneda,
      tipo_cambio: pedido.tipo_cambio,
      subtotal,
      igv: impuesto,
      total: Number((subtotal + impuesto).toFixed(2)),
      fecha_emision: emision,
      fecha_vencimiento: venc,
      estado,
      creado_por: uComercial,
    });
  }
  await insertarLote('facturas',
    ['numero', 'pedido_id', 'cliente_id', 'despacho_id', 'moneda', 'tipo_cambio',
     'subtotal', 'igv', 'total', 'fecha_emision', 'fecha_vencimiento', 'estado', 'creado_por'],
    facturas, 300);
  const facDb = await consultar('select id, numero, total, estado, fecha_emision, pedido_id from facturas order by id');
  ok(`${facDb.length} facturas`);

  // Líneas de la factura, tomadas de las líneas del pedido (reuso de información)
  const facLineas = [];
  for (const f of facDb) {
    const lineas = mapaPedidoLineas.get(f.pedido_id) || [];
    const usar = lineas.slice(0, entero(1, Math.max(1, lineas.length)));
    const importePorLinea = usar.length ? Number(f.total) / usar.length : 0;
    for (const l of usar) {
      const cant = decimal(10, 120, 3);
      facLineas.push({
        factura_id: f.id,
        pedido_linea_id: l.id,
        sku_presentacion_id: l.sku_presentacion_id,
        cantidad_tm: cant,
        precio_tm: Number((importePorLinea / cant).toFixed(4)),
        importe: Number(importePorLinea.toFixed(2)),
      });
    }
  }
  await insertarLote('factura_lineas',
    ['factura_id', 'pedido_linea_id', 'sku_presentacion_id', 'cantidad_tm', 'precio_tm', 'importe'],
    facLineas, 400);

  // Cobranzas coherentes con el estado de cada factura
  const cobranzas = [];
  for (const f of facDb) {
    if (f.estado === 'cobrada') {
      cobranzas.push({
        factura_id: f.id, monto: Number(f.total), fecha: fechaMas(entero(5, 50), new Date(f.fecha_emision)),
        medio: elegir(['Transferencia', 'Carta de crédito', 'Depósito']),
        referencia: `OP-${entero(100000, 999999)}`, registrado_por: uComercial,
      });
    } else if (f.estado === 'parcialmente_cobrada') {
      const parcial = Number((Number(f.total) * decimal(0.25, 0.75, 2)).toFixed(2));
      cobranzas.push({
        factura_id: f.id, monto: parcial, fecha: fechaMas(entero(5, 40), new Date(f.fecha_emision)),
        medio: elegir(['Transferencia', 'Carta de crédito']),
        referencia: `OP-${entero(100000, 999999)}`, registrado_por: uComercial,
      });
    }
  }
  await insertarLote('cobranzas',
    ['factura_id', 'monto', 'fecha', 'medio', 'referencia', 'registrado_por'], cobranzas, 300);
  ok(`${facLineas.length} líneas de factura · ${cobranzas.length} cobranzas`);

  /* ======================================================================
     PASO 13 · ALERTAS Y LÍNEA DE TIEMPO
     Se generan a partir de la data real ya sembrada, ejecutando las mismas
     condiciones que evalúa el motor de reglas.
     ====================================================================== */
  paso(13, 'Generando alertas y eventos de trazabilidad…');

  await ejecutarSQL(`
    -- (1) Lotes que superaron el umbral de anticuamiento configurado
    insert into alertas (regla_id, entidad, entidad_id, severidad, titulo, mensaje, datos)
    select r.id, 'lote', v.lote_id,
           (case when v.meses_almacenado >= 24 then 'critica' else 'advertencia' end)::severidad_alerta,
           case when v.meses_almacenado >= 24 then 'Producto con vida útil vencida'
                else 'Producto con antigüedad elevada' end,
           format('El lote %s lleva %s meses en %s. Stock: %s kg.',
                  v.codigo_pallet, round(v.meses_almacenado), v.almacen, round(v.fisico_kg)),
           jsonb_build_object('meses', v.meses_almacenado, 'kg', v.fisico_kg, 'almacen', v.almacen)
      from v_anticuamiento v
      join reglas r on r.nombre = case when v.meses_almacenado >= 24
                                       then 'Producto que superó la vida útil'
                                       else 'Producto con más de 12 meses en cámara' end
     where v.en_alerta and v.fisico_kg > 0;

    -- (2) Reservas activas ya vencidas: el problema número uno del negocio
    insert into alertas (regla_id, entidad, entidad_id, severidad, titulo, mensaje)
    select r.id, 'reserva', rv.id, 'advertencia', 'Reserva vencida sin liberar',
           format('La reserva del pedido %s venció el %s y sigue bloqueando %s kg.',
                  p.numero_proforma, to_char(rv.vence_el,'DD/MM/YYYY'), round(rv.peso_neto_kg))
      from reservas rv
      join pedido_lineas pl on pl.id = rv.pedido_linea_id
      join pedidos p on p.id = pl.pedido_id
      join reglas r on r.nombre = 'Reserva próxima a vencer'
     where rv.estado = 'activa' and rv.vence_el < now();

    -- (3) Traslados detenidos en tránsito
    insert into alertas (regla_id, entidad, entidad_id, severidad, titulo, mensaje)
    select r.id, 'traslado', t.id, 'critica', 'Traslado detenido en tránsito',
           format('El traslado %s salió el %s y el destino aún no confirma la recepción.',
                  t.numero, to_char(t.despachado_en,'DD/MM/YYYY'))
      from traslados t
      join reglas r on r.nombre = 'Traslado detenido en tránsito'
     where t.estado = 'en_transito';

    -- (4) Facturas vencidas
    insert into alertas (regla_id, entidad, entidad_id, severidad, titulo, mensaje)
    select r.id, 'factura', f.id, 'critica', 'Factura vencida',
           format('La factura %s de %s venció el %s.', f.numero, c.razon_social,
                  to_char(f.fecha_vencimiento,'DD/MM/YYYY'))
      from facturas f
      join clientes c on c.id = f.cliente_id
      join reglas r on r.nombre = 'Factura vencida'
     where f.estado = 'vencida';

    -- (5) Documentos de flota por vencer
    insert into alertas (regla_id, entidad, entidad_id, severidad, titulo, mensaje)
    select r.id, 'vehiculo', v.id,
           (case when v.soat_vence < current_date then 'critica' else 'advertencia' end)::severidad_alerta,
           'SOAT por vencer',
           format('El SOAT del vehículo %s vence el %s.', v.placa, to_char(v.soat_vence,'DD/MM/YYYY'))
      from vehiculos v
      join reglas r on r.nombre = 'SOAT por vencer'
     where v.soat_vence <= current_date + 30;
  `);

  // Línea de tiempo: eventos legibles para la pestaña Historial
  await ejecutarSQL(`
    insert into eventos (entidad, entidad_id, tipo, descripcion, severidad, usuario_id, ocurrido_en)
    select 'lotes', l.id, 'lote_creado',
           format('Lote %s producido el %s (%s bultos)', l.codigo_pallet,
                  to_char(l.fecha_produccion,'DD/MM/YYYY'), l.bultos_iniciales),
           'info'::severidad_alerta, l.creado_por, l.fecha_produccion::timestamptz
      from lotes l;

    insert into eventos (entidad, entidad_id, tipo, descripcion, severidad, usuario_id, ocurrido_en)
    select 'traslados', t.id, 'traslado_' || t.estado::text,
           format('Traslado %s en estado %s', t.numero, t.estado),
           (case when t.estado = 'en_transito' then 'advertencia' else 'info' end)::severidad_alerta,
           coalesce(t.aceptado_por, t.despachado_por, t.autorizado_por, t.creado_por),
           coalesce(t.aceptado_en, t.despachado_en, t.autorizado_en, t.creado_en)
      from traslados t;

    insert into eventos (entidad, entidad_id, tipo, descripcion, severidad, usuario_id, ocurrido_en)
    select 'reservas', rv.id,
           'reserva_' || rv.estado::text,
           case rv.estado
             when 'liberada' then format('Reserva liberada: %s', coalesce(rv.motivo_liberacion,'sin motivo'))
             when 'expirada' then 'Reserva expirada automáticamente por vencimiento del plazo'
             when 'consumida' then 'Reserva consumida en el despacho'
             else format('Reserva de %s kg registrada', round(rv.peso_neto_kg))
           end,
           (case when rv.estado in ('liberada','expirada') then 'advertencia' else 'info' end)::severidad_alerta,
           coalesce(rv.liberado_por, rv.creado_por),
           coalesce(rv.liberado_en, rv.creado_en)
      from reservas rv;

    insert into eventos (entidad, entidad_id, tipo, descripcion, severidad, usuario_id, ocurrido_en)
    select 'pedidos', p.id, 'pedido_' || p.ciclo::text,
           format('Pedido %s · %s', p.numero_proforma, p.ciclo),
           'info'::severidad_alerta, p.creado_por, p.creado_en
      from pedidos p;

    insert into eventos (entidad, entidad_id, tipo, descripcion, severidad, usuario_id, ocurrido_en)
    select 'despachos', d.id, 'despacho_ejecutado',
           format('Despacho %s ejecutado', d.numero), 'info'::severidad_alerta, d.encargado_id, d.fecha_salida
      from despachos d;

    insert into eventos (entidad, entidad_id, tipo, descripcion, severidad, usuario_id, ocurrido_en)
    select 'dictamenes_calidad', dc.id, 'dictamen_' || dc.estado::text,
           format('Dictamen de %s: %s%s', dc.tipo, dc.estado,
                  coalesce(' · ' || dc.motivo_texto, '')),
           (case when dc.estado = 'liberado' then 'info' else 'critica' end)::severidad_alerta,
           dc.emitido_por, dc.emitido_en
      from dictamenes_calidad dc;
  `);

  const stats = await consultar(`select
      (select count(*) from alertas) alertas,
      (select count(*) from alertas where severidad='critica') criticas,
      (select count(*) from eventos) eventos`);
  ok(`${stats[0].alertas} alertas (${stats[0].criticas} críticas) · ${stats[0].eventos} eventos`);

  /* ======================================================================
     PASO 14 · PRECIOS DE MERCADO (data de aduanas importada)
     ====================================================================== */
  paso(14, 'Cargando comparativa de precios de mercado…');

  await ejecutarSQL(`
    insert into importaciones (tipo, archivo, periodo, filas_ok, filas_error, procesado_por)
    values ('aduanas', 'exportaciones_pota_2026.csv', '2026', 520, 3,
            (select id from usuarios where rol='comercial' limit 1));
  `);
  const impDb = await consultar(`select id from importaciones order by id desc limit 1`);

  const mercado = [];
  const especiesMk = ['POTA', 'POTA', 'POTA', 'MERLUZA', 'BONITO'];
  for (let semana = 1; semana <= 34; semana++) {
    for (const esp of especiesMk) {
      const tm = decimal(180, 2200, 3);
      // Precio de mercado con estacionalidad suave
      const base = 2450 + Math.sin(semana / 5) * 260 + decimal(-140, 140, 2);
      mercado.push({
        importacion_id: impDb[0].id,
        anio: 2026, semana, especie: esp,
        descripcion: `${esp} congelada · exportación`,
        toneladas: tm,
        valor_fob: Number((tm * base).toFixed(2)),
      });
    }
  }
  await insertarLote('precios_mercado',
    ['importacion_id', 'anio', 'semana', 'especie', 'descripcion', 'toneladas', 'valor_fob'],
    mercado, 300);
  ok(`${mercado.length} registros de precio de mercado`);
}
