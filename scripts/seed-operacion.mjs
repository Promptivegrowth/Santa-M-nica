/**
 * ============================================================================
 *  SEMBRADO DE LA OPERACIÓN · Santa Mónica ERP
 * ============================================================================
 *  Aquí se genera el movimiento real del negocio: los lotes que entraron a
 *  cámara, los traslados entre bodegas, los pedidos de los clientes, las
 *  reservas, los embarques con su plano de estiba, los despachos, las facturas
 *  y las cobranzas.
 *
 *  El objetivo es que NINGUNA pantalla del sistema aparezca vacía y que todos
 *  los indicadores tengan una curva con forma.
 * ============================================================================
 */

export async function sembrarOperacion(ctx) {
  const {
    idAlm, almDb, usuarios,
    insertarLote, consultar, ejecutarSQL,
    entero, elegir, decimal, suerte, fechaMenos, fechaMas, paso, ok,
  } = ctx;

  // Atajos a los usuarios por rol, para asignar responsables coherentes
  const porRol = Object.fromEntries(usuarios.map((u) => [u.rol, u.id]));
  const uAlmacen = porRol.almacen;
  const uOperaciones = porRol.operaciones;
  const uComercial = porRol.comercial;
  const uComex = porRol.comex;
  const uCalidad = porRol.calidad;
  const uGerencia = porRol.gerencia;

  /* ======================================================================
     PASO 3 · LOTES E INGRESOS A CÁMARA
     Cada lote es un pallet que se produjo un día concreto. Las fechas se
     reparten para que el reporte de anticuamiento tenga sus cuatro rangos.
     ====================================================================== */
  paso(3, 'Generando lotes e ingresos a cámara…');

  // Unidades vendibles con su peso por bulto
  const unidades = await consultar(`
    select sp.id as sku_presentacion_id, p.peso_bulto_kg, s.codigo as sku_codigo
      from sku_presentaciones sp
      join presentaciones p on p.id = sp.presentacion_id
      join skus s on s.id = sp.sku_id
     order by sp.id
  `);
  const lineasDb = await consultar('select id from lineas_procesadoras order by id');
  const plantasDb = await consultar('select id, tipo from plantas order by id');
  const camarasDb = await consultar('select id, almacen_id from camaras order by id');

  // Prefijos de pallet parecidos a los que usa el almacén hoy
  const PREFIJOS = ['SM', 'AL', 'FL', 'TE', 'TR', 'NU', 'RL', 'CO', 'OCE'];
  const TOTAL_LOTES = 1800;

  const lotes = [];
  for (let i = 0; i < TOTAL_LOTES; i++) {
    const u = elegir(unidades);

    // Distribución de antigüedad: refleja la realidad observada en la data
    const r = Math.random();
    let diasAtras;
    if (r < 0.85) diasAtras = entero(1, 330);        // menos de 12 meses
    else if (r < 0.93) diasAtras = entero(366, 547); // 12 a 18 meses
    else if (r < 0.98) diasAtras = entero(548, 729); // 18 a 24 meses
    else diasAtras = entero(730, 900);               // más de 24 meses

    const fprod = fechaMenos(diasAtras);
    const campania = Number(fprod.slice(0, 4));
    const bultos = entero(20, 160);
    const planta = elegir(plantasDb);

    lotes.push({
      codigo_pallet: `${elegir(PREFIJOS)} ${String(campania).slice(2)} ${String(entero(1, 12)).padStart(2, '0')} ${String(i + 1).padStart(4, '0')}`,
      codigo_lote: String(100000 + i),
      campania,
      sku_presentacion_id: u.sku_presentacion_id,
      fecha_produccion: fprod,
      juliano: String(entero(1, 365)).padStart(3, '0'),
      planta_id: planta.id,
      linea_procesadora_id: elegir(lineasDb).id,
      turno: suerte(0.75) ? 'dia' : 'noche',
      proceso: planta.tipo,
      bultos_iniciales: bultos,
      peso_neto_inicial_kg: Number((bultos * Number(u.peso_bulto_kg)).toFixed(3)),
      // Costo por kilo con variación estacional, como describió el cliente
      costo_unitario: decimal(1.2, 3.4, 4),
      creado_por: uAlmacen,
    });
  }

  await insertarLote('lotes',
    ['codigo_pallet', 'codigo_lote', 'campania', 'sku_presentacion_id', 'fecha_produccion',
     'juliano', 'planta_id', 'linea_procesadora_id', 'turno', 'proceso',
     'bultos_iniciales', 'peso_neto_inicial_kg', 'costo_unitario', 'creado_por'],
    lotes);
  ok(`${lotes.length} lotes creados`);

  const lotesDb = await consultar(`
    select l.id, l.bultos_iniciales, l.peso_neto_inicial_kg, l.costo_unitario,
           l.fecha_produccion, l.sku_presentacion_id
      from lotes l order by l.id
  `);

  // Motivos de ingreso disponibles
  const motIngreso = await consultar(`select id, codigo from motivos where ambito='ingreso'`);
  const motPrimerProceso = motIngreso.find((m) => m.codigo === 'PRIMER_PROCESO').id;

  // Reparto de lotes entre bodegas: la mayoría entra a las cámaras propias
  const codigosAlm = almDb.map((a) => a.codigo);
  const pesoAlmacen = { 'STM-C2': 22, 'STM-C3': 20, 'FREEKO': 18, 'ELAMAR': 10,
                        'PERUFR': 8, 'DEPSA': 8, 'STM-C1': 7, 'EMERG': 4, 'COINRE': 2, 'HAYDUK': 1 };
  const ruleta = [];
  for (const [cod, peso] of Object.entries(pesoAlmacen)) {
    for (let i = 0; i < peso; i++) ruleta.push(cod);
  }

  /** Estado vivo del inventario en memoria, para no despachar más de lo que hay. */
  const stock = new Map(); // lote_id -> { almacen_id, bultos, peso, costo }

  const movIngreso = [];
  for (const l of lotesDb) {
    const codAlm = elegir(ruleta);
    const almacen_id = idAlm[codAlm];
    const camara = camarasDb.find((c) => c.almacen_id === almacen_id);
    const dias = Math.floor((new Date('2026-08-25') - new Date(l.fecha_produccion)) / 86400000);

    movIngreso.push({
      fecha: fechaMenos(Math.max(0, dias - entero(0, 3))) + ' 09:00:00-05',
      tipo: 'ingreso',
      lote_id: l.id,
      almacen_id,
      camara_id: camara ? camara.id : null,
      bultos: l.bultos_iniciales,
      peso_neto_kg: l.peso_neto_inicial_kg,
      costo_unitario: l.costo_unitario,
      motivo_id: motPrimerProceso,
      documento_tipo: 'ingreso',
      documento_ref: `ING-${String(l.id).padStart(6, '0')}`,
      usuario_id: uAlmacen,
    });

    stock.set(l.id, {
      almacen_id,
      bultos: l.bultos_iniciales,
      peso: Number(l.peso_neto_inicial_kg),
      costo: Number(l.costo_unitario),
      sku_presentacion_id: l.sku_presentacion_id,
      fecha_produccion: l.fecha_produccion,
    });
  }

  await insertarLote('movimientos',
    ['fecha', 'tipo', 'lote_id', 'almacen_id', 'camara_id', 'bultos', 'peso_neto_kg',
     'costo_unitario', 'motivo_id', 'documento_tipo', 'documento_ref', 'usuario_id'],
    movIngreso, 300);
  ok(`${movIngreso.length} movimientos de ingreso (Kardex)`);

  /* ======================================================================
     PASO 4 · DICTÁMENES DE CALIDAD
     Un porcentaje del stock queda observado o inmovilizado, con su motivo.
     ====================================================================== */
  paso(4, 'Emitiendo dictámenes de calidad…');

  const motBloqueo = await consultar(`select id, codigo, nombre from motivos where ambito='bloqueo'`);
  const dictamenes = [];
  const lotesMuestra = lotesDb.filter(() => suerte(0.06));

  for (const l of lotesMuestra) {
    const m = elegir(motBloqueo);
    const estado = elegir(['observado', 'observado', 'inmovilizado', 'espera_resultados']);
    dictamenes.push({
      lote_id: l.id,
      tipo: elegir(['calidad', 'microbiologia', 'camara', 'producto_terminado']),
      estado,
      motivo_id: m.id,
      motivo_texto: m.nombre,
      sustento_url: suerte(0.7) ? `/sustentos/calidad/${l.id}.pdf` : null,
      emitido_por: uCalidad,
      vigente: true,
    });
  }
  // Además, un grupo de lotes explícitamente liberados (con su registro)
  for (const l of lotesDb.filter(() => suerte(0.1)).slice(0, 120)) {
    dictamenes.push({
      lote_id: l.id, tipo: 'producto_terminado', estado: 'liberado',
      motivo_id: null, motivo_texto: null, sustento_url: null,
      emitido_por: uCalidad, vigente: true,
    });
  }
  await insertarLote('dictamenes_calidad',
    ['lote_id', 'tipo', 'estado', 'motivo_id', 'motivo_texto', 'sustento_url', 'emitido_por', 'vigente'],
    dictamenes);
  ok(`${dictamenes.length} dictámenes (${lotesMuestra.length} con observación abierta)`);

  const bloqueados = new Set(lotesMuestra.map((l) => l.id));

  /* ======================================================================
     PASO 5 · TRASLADOS ENTRE ALMACENES
     Se generan en los cuatro estados para poder probar la máquina completa.
     ====================================================================== */
  paso(5, 'Generando traslados entre bodegas…');

  const transDb = await consultar('select id from transportistas order by id');
  const vehDb = await consultar('select id from vehiculos order by id');
  const condDb = await consultar('select id from conductores order by id');

  const traslados = [];
  const trasLineas = [];
  const movTraslado = [];
  let nTras = 0;

  // Candidatos agrupados POR BODEGA: un traslado solo puede sacar producto de
  // una única bodega de origen, así que primero agrupamos por almacén.
  const porBodega = new Map();
  for (const [id, s] of stock) {
    if (bloqueados.has(id) || s.bultos <= 10) continue;
    if (!porBodega.has(s.almacen_id)) porBodega.set(s.almacen_id, []);
    porBodega.get(s.almacen_id).push([id, s]);
  }

  // Cursor por bodega para no reutilizar el mismo lote en dos traslados
  const cursor = new Map([...porBodega.keys()].map((k) => [k, 0]));
  const bodegas = [...porBodega.keys()];

  for (let i = 0; i < 70; i++) {
    const origen = elegir(bodegas);
    const lista = porBodega.get(origen);
    const desde = cursor.get(origen);
    if (desde >= lista.length) continue;

    const cuantos = Math.min(entero(1, 3), lista.length - desde);
    const grupo = lista.slice(desde, desde + cuantos);
    cursor.set(origen, desde + cuantos);
    if (!grupo.length) continue;

    const estado = elegir(['borrador', 'autorizado', 'en_transito', 'aceptado', 'aceptado', 'aceptado']);
    const destino = elegir(almDb.filter((a) => a.id !== origen)).id;
    nTras++;

    const diasAtras = entero(3, 120);
    const numero = `TRAS-2026-${String(nTras).padStart(4, '0')}`;
    const guia = `EG07-${String(3000 + nTras).padStart(7, '0')}`;

    traslados.push({
      numero,
      almacen_origen_id: origen,
      almacen_destino_id: destino,
      estado,
      guia_numero: ['en_transito', 'aceptado'].includes(estado) ? guia : null,
      transportista_id: elegir(transDb).id,
      vehiculo_id: elegir(vehDb).id,
      conductor_id: elegir(condDb).id,
      autorizado_por: estado !== 'borrador' ? uOperaciones : null,
      autorizado_en: estado !== 'borrador' ? fechaMenos(diasAtras) + ' 10:00:00-05' : null,
      despachado_por: ['en_transito', 'aceptado'].includes(estado) ? uAlmacen : null,
      despachado_en: ['en_transito', 'aceptado'].includes(estado) ? fechaMenos(diasAtras - 1) + ' 14:00:00-05' : null,
      aceptado_por: estado === 'aceptado' ? uAlmacen : null,
      aceptado_en: estado === 'aceptado' ? fechaMenos(diasAtras - 2) + ' 09:00:00-05' : null,
      fecha_programada: fechaMenos(diasAtras),
      creado_por: uAlmacen,
      _idx: nTras,
      _grupo: grupo,
      _estado: estado,
      _origen: origen,
    });
  }

  await insertarLote('traslados',
    ['numero', 'almacen_origen_id', 'almacen_destino_id', 'estado', 'guia_numero',
     'transportista_id', 'vehiculo_id', 'conductor_id', 'autorizado_por', 'autorizado_en',
     'despachado_por', 'despachado_en', 'aceptado_por', 'aceptado_en', 'fecha_programada', 'creado_por'],
    traslados);

  const trasDb = await consultar('select id, numero, estado, almacen_origen_id, almacen_destino_id, guia_numero, despachado_en, aceptado_en from traslados order by id');
  const trasPorNumero = Object.fromEntries(trasDb.map((t) => [t.numero, t]));

  for (const t of traslados) {
    const db = trasPorNumero[t.numero];
    for (const [loteId, s] of t._grupo) {
      // Se traslada una parte del lote
      const bultos = Math.max(1, Math.floor(s.bultos * 0.5));
      const pesoUnit = s.peso / s.bultos;
      const peso = Number((bultos * pesoUnit).toFixed(3));

      // Discrepancia ocasional: llega menos de lo enviado (caso real del negocio)
      const hayDiscrepancia = t._estado === 'aceptado' && suerte(0.12);
      const bultosAcep = t._estado === 'aceptado' ? (hayDiscrepancia ? bultos - entero(1, 3) : bultos) : null;
      const pesoAcep = bultosAcep !== null ? Number((bultosAcep * pesoUnit).toFixed(3)) : null;

      trasLineas.push({
        traslado_id: db.id, lote_id: loteId,
        bultos_enviados: bultos, peso_enviado_kg: peso,
        bultos_aceptados: bultosAcep, peso_aceptado_kg: pesoAcep,
        observacion: hayDiscrepancia ? 'Diferencia detectada en la recepción' : null,
      });

      // Kardex: la salida ocurre al despachar (siempre desde la bodega de origen,
      // que es la misma para todo el grupo porque agrupamos por bodega)
      if (['en_transito', 'aceptado'].includes(t._estado)) {
        movTraslado.push({
          fecha: db.despachado_en, tipo: 'traslado_salida', lote_id: loteId,
          almacen_id: db.almacen_origen_id, camara_id: null,
          bultos, peso_neto_kg: peso, costo_unitario: s.costo,
          documento_tipo: 'traslado', documento_id: db.id, documento_ref: db.guia_numero,
          usuario_id: uAlmacen,
        });
        s.bultos -= bultos;
        s.peso = Number((s.peso - peso).toFixed(3));
      }
      // Y el ingreso solo cuando el destino acepta
      if (t._estado === 'aceptado' && bultosAcep > 0) {
        movTraslado.push({
          fecha: db.aceptado_en, tipo: 'traslado_ingreso', lote_id: loteId,
          almacen_id: db.almacen_destino_id, camara_id: null,
          bultos: bultosAcep, peso_neto_kg: pesoAcep, costo_unitario: s.costo,
          documento_tipo: 'traslado', documento_id: db.id, documento_ref: db.guia_numero,
          usuario_id: uAlmacen,
        });
        // El lote ahora vive en la bodega destino: el resto del sembrado debe
        // buscarlo allí (por ejemplo, al armar un packing list).
        s.almacen_id = db.almacen_destino_id;
        s.bultos += bultosAcep;
        s.peso = Number((s.peso + pesoAcep).toFixed(3));
      }
    }
  }

  await insertarLote('traslado_lineas',
    ['traslado_id', 'lote_id', 'bultos_enviados', 'peso_enviado_kg', 'bultos_aceptados', 'peso_aceptado_kg', 'observacion'],
    trasLineas);
  await insertarLote('movimientos',
    ['fecha', 'tipo', 'lote_id', 'almacen_id', 'camara_id', 'bultos', 'peso_neto_kg',
     'costo_unitario', 'documento_tipo', 'documento_id', 'documento_ref', 'usuario_id'],
    movTraslado, 300);
  ok(`${trasDb.length} traslados · ${trasLineas.length} líneas · ${movTraslado.length} movimientos`);

  // ── RECONSTRUCCIÓN DEL INVENTARIO DISPONIBLE ──────────────────────────
  // Un traslado parcial deja el MISMO lote repartido entre dos bodegas. Por eso
  // el inventario en memoria se indexa por la pareja (lote, almacén) y se
  // reconstruye leyendo la base, que es la única fuente de verdad.
  const filasStock = await consultar(`
    select e.lote_id, e.almacen_id, e.bultos, e.peso_neto_kg, e.costo_promedio,
           l.sku_presentacion_id, l.fecha_produccion
      from existencias e
      join lotes l on l.id = e.lote_id
     where e.bultos > 0
  `);
  stock.clear();
  for (const f of filasStock) {
    stock.set(`${f.lote_id}:${f.almacen_id}`, {
      lote_id: Number(f.lote_id),
      almacen_id: Number(f.almacen_id),
      bultos: Number(f.bultos),
      peso: Number(f.peso_neto_kg),
      costo: Number(f.costo_promedio),
      sku_presentacion_id: Number(f.sku_presentacion_id),
      fecha_produccion: f.fecha_produccion,
    });
  }
  ok(`inventario reconstruido: ${stock.size} posiciones (lote + bodega)`);

  /* ======================================================================
     PASO 6 · LISTAS DE PRECIO
     ====================================================================== */
  paso(6, 'Construyendo listas de precio…');

  await insertarLote('listas_precio',
    ['nombre', 'moneda', 'incoterm', 'vigente_desde', 'vigente_hasta'],
    [
      { nombre: 'Exportación FOB 2026 · Temporada alta', moneda: 'USD', incoterm: 'FOB', vigente_desde: '2026-01-01', vigente_hasta: null },
      { nombre: 'Exportación CFR 2026',                  moneda: 'USD', incoterm: 'CFR', vigente_desde: '2026-01-01', vigente_hasta: null },
      { nombre: 'Mercado nacional 2026',                 moneda: 'PEN', incoterm: 'EXW', vigente_desde: '2026-01-01', vigente_hasta: null },
      { nombre: 'Exportación FOB 2025 (histórica)',      moneda: 'USD', incoterm: 'FOB', vigente_desde: '2025-01-01', vigente_hasta: '2025-12-31' },
    ]);
  const listasDb = await consultar('select id, nombre, moneda, incoterm from listas_precio order by id');
  const listaFob = listasDb[0].id;
  const listaCfr = listasDb[1].id;
  const listaNac = listasDb[2].id;

  const clientesDb = await consultar('select id, pais, moneda, linea_credito, dias_credito, bloqueado from clientes order by id');
  const precios = [];

  // Precio base por unidad vendible, con escalas por volumen
  for (const u of unidades) {
    const base = decimal(1900, 4200, 2);
    const escalas = [
      { desde: 0,  hasta: 25,   factor: 1.0 },
      { desde: 25, hasta: 100,  factor: 0.96 },
      { desde: 100, hasta: null, factor: 0.92 },
    ];
    for (const e of escalas) {
      precios.push({ lista_id: listaFob, sku_presentacion_id: u.sku_presentacion_id, cliente_id: null,
                     tm_desde: e.desde, tm_hasta: e.hasta, precio_tm: Number((base * e.factor).toFixed(2)) });
      precios.push({ lista_id: listaCfr, sku_presentacion_id: u.sku_presentacion_id, cliente_id: null,
                     tm_desde: e.desde, tm_hasta: e.hasta, precio_tm: Number((base * e.factor * 1.08).toFixed(2)) });
    }
    precios.push({ lista_id: listaNac, sku_presentacion_id: u.sku_presentacion_id, cliente_id: null,
                   tm_desde: 0, tm_hasta: null, precio_tm: Number((base * 3.75 * 0.85).toFixed(2)) });
  }

  // Precios pactados con los clientes más grandes
  for (const c of clientesDb.slice(0, 18)) {
    for (const u of unidades.filter(() => suerte(0.05))) {
      precios.push({ lista_id: listaFob, sku_presentacion_id: u.sku_presentacion_id, cliente_id: c.id,
                     tm_desde: 0, tm_hasta: null, precio_tm: decimal(1850, 4100, 2) });
    }
  }
  await insertarLote('precios',
    ['lista_id', 'sku_presentacion_id', 'cliente_id', 'tm_desde', 'tm_hasta', 'precio_tm'],
    precios, 500);
  ok(`${listasDb.length} listas · ${precios.length} precios`);

  /* ======================================================================
     PASO 7 · COTIZACIONES Y PEDIDOS
     ====================================================================== */
  paso(7, 'Generando cotizaciones y pedidos…');

  const destinosDb = await consultar('select id, puerto, pais from destinos order by id');
  const vendDb = await consultar('select id from vendedores order by id');

  // --- Cotizaciones ---
  const cotizaciones = [];
  for (let i = 1; i <= 140; i++) {
    const c = elegir(clientesDb);
    const nac = c.pais === 'Perú';
    cotizaciones.push({
      numero: `COT-2026-${String(i).padStart(4, '0')}`,
      cliente_id: c.id,
      vendedor_id: elegir(vendDb).id,
      estado: elegir(['borrador', 'enviada', 'enviada', 'aceptada', 'aceptada', 'aceptada', 'rechazada', 'vencida']),
      moneda: nac ? 'PEN' : 'USD',
      tipo_cambio: nac ? 1 : 3.75,
      incoterm: nac ? 'EXW' : elegir(['FOB', 'FOB', 'CFR', 'CIF']),
      destino_id: elegir(destinosDb).id,
      lista_id: nac ? listaNac : listaFob,
      fecha: fechaMenos(entero(1, 200)),
      creado_por: uComercial,
    });
  }
  await insertarLote('cotizaciones',
    ['numero', 'cliente_id', 'vendedor_id', 'estado', 'moneda', 'tipo_cambio', 'incoterm',
     'destino_id', 'lista_id', 'fecha', 'creado_por'],
    cotizaciones);
  const cotDb = await consultar('select id, cliente_id, moneda, incoterm, destino_id, estado, fecha from cotizaciones order by id');

  const cotLineas = [];
  for (const c of cotDb) {
    for (let k = 0; k < entero(1, 4); k++) {
      const u = elegir(unidades);
      const cant = decimal(8, 140, 3);
      const pl = decimal(1900, 4200, 2);
      const desc = suerte(0.25) ? decimal(0.5, 5, 2) : 0;
      cotLineas.push({
        cotizacion_id: c.id, sku_presentacion_id: u.sku_presentacion_id,
        cantidad_tm: cant, precio_lista_tm: pl,
        precio_tm: Number((pl * (1 - desc / 100)).toFixed(2)),
        descuento_pct: desc,
        descuento_autorizado_por: desc > 3 ? uGerencia : null,
        orden: k + 1,
      });
    }
  }
  await insertarLote('cotizacion_lineas',
    ['cotizacion_id', 'sku_presentacion_id', 'cantidad_tm', 'precio_lista_tm', 'precio_tm',
     'descuento_pct', 'descuento_autorizado_por', 'orden'],
    cotLineas, 500);
  ok(`${cotDb.length} cotizaciones · ${cotLineas.length} líneas`);

  // --- Pedidos ---
  const cotAceptadas = cotDb.filter((c) => c.estado === 'aceptada');
  const pedidos = [];
  const TOTAL_PEDIDOS = 420;

  for (let i = 1; i <= TOTAL_PEDIDOS; i++) {
    // Buena parte de los pedidos nace de una cotización aceptada (reuso de información)
    const desdeCot = i <= cotAceptadas.length ? cotAceptadas[i - 1] : null;
    const c = desdeCot ? clientesDb.find((x) => x.id === desdeCot.cliente_id) : elegir(clientesDb);
    const nac = c.pais === 'Perú';
    const dias = entero(1, 210);

    // Los tres ejes de estado, coherentes entre sí
    const ciclo = elegir(['borrador', 'pendiente_validacion', 'confirmado', 'confirmado',
                          'confirmado', 'despachado', 'despachado', 'cerrado', 'cerrado', 'cancelado']);
    let situacion = 'sin_facturar';
    if (c.bloqueado && ciclo === 'pendiente_validacion') situacion = 'bloqueado_credito';
    else if (ciclo === 'cerrado') situacion = elegir(['cobrado', 'cobrado', 'parcialmente_cobrado']);
    else if (ciclo === 'despachado') situacion = elegir(['facturado', 'facturado', 'parcialmente_cobrado', 'vencido']);

    pedidos.push({
      numero_proforma: `SM26-${String(100 + i)}${suerte(0.3) ? '/' + entero(1, 6) : ''}`,
      cotizacion_id: desdeCot ? desdeCot.id : null,
      cliente_id: c.id,
      vendedor_id: elegir(vendDb).id,
      oc_cliente: suerte(0.6) ? `PO-${entero(10000, 99999)}` : null,
      moneda: nac ? 'PEN' : 'USD',
      tipo_cambio: nac ? 1 : 3.75,
      incoterm: nac ? 'EXW' : elegir(['FOB', 'FOB', 'CFR', 'CIF']),
      destino_id: elegir(destinosDb).id,
      tipo_despacho: nac ? 'mercado_nacional' : 'exportacion',
      condicion_pago: c.dias_credito > 0 ? `Crédito ${c.dias_credito} días` : 'Contado',
      dias_credito: c.dias_credito,
      prioridad: elegir(['baja', 'normal', 'normal', 'normal', 'alta', 'urgente']),
      fecha_solicitada: fechaMenos(dias),
      fecha_posible: fechaMenos(dias - entero(3, 12)),
      fecha_comprometida: fechaMenos(dias - entero(5, 20)),
      ciclo,
      cobertura: 'pendiente_stock',
      situacion,
      creado_por: uComercial,
    });
  }
  await insertarLote('pedidos',
    ['numero_proforma', 'cotizacion_id', 'cliente_id', 'vendedor_id', 'oc_cliente', 'moneda',
     'tipo_cambio', 'incoterm', 'destino_id', 'tipo_despacho', 'condicion_pago', 'dias_credito',
     'prioridad', 'fecha_solicitada', 'fecha_posible', 'fecha_comprometida',
     'ciclo', 'cobertura', 'situacion', 'creado_por'],
    pedidos, 300);
  const pedDb = await consultar('select id, numero_proforma, cliente_id, ciclo, situacion, moneda, tipo_cambio, fecha_solicitada, dias_credito from pedidos order by id');

  const pedLineas = [];
  for (const p of pedDb) {
    for (let k = 0; k < entero(1, 4); k++) {
      const u = elegir(unidades);
      const cant = decimal(10, 150, 3);
      const pl = decimal(1900, 4200, 2);
      const desc = suerte(0.2) ? decimal(0.5, 6, 2) : 0;
      pedLineas.push({
        pedido_id: p.id, sku_presentacion_id: u.sku_presentacion_id,
        cantidad_tm: cant, precio_lista_tm: pl,
        precio_tm: Number((pl * (1 - desc / 100)).toFixed(2)),
        descuento_pct: desc,
        descuento_autorizado_por: desc > 3 ? uGerencia : null,
        costo_estimado_tm: decimal(1400, 3000, 2),
        orden: k + 1,
      });
    }
  }
  await insertarLote('pedido_lineas',
    ['pedido_id', 'sku_presentacion_id', 'cantidad_tm', 'precio_lista_tm', 'precio_tm',
     'descuento_pct', 'descuento_autorizado_por', 'costo_estimado_tm', 'orden'],
    pedLineas, 500);
  ok(`${pedDb.length} pedidos · ${pedLineas.length} líneas`);

  /* ======================================================================
     PASO 8 · RESERVAS
     Se apartan lotes concretos para las líneas de pedidos confirmados.
     Se dejan algunas vencidas a propósito: son el problema que el sistema
     viene a resolver, y hay que poder verlo funcionando.
     ====================================================================== */
  paso(8, 'Creando reservas contra lotes concretos…');

  const lineasDb2 = await consultar(`
    select pl.id, pl.pedido_id, pl.sku_presentacion_id, pl.cantidad_tm, p.ciclo
      from pedido_lineas pl join pedidos p on p.id = pl.pedido_id
     where p.ciclo in ('confirmado','despachado','cerrado')
     order by pl.id
  `);

  // Índice de posiciones disponibles por unidad vendible.
  // Cada entrada es una pareja (lote, bodega) con saldo libre.
  const porUnidad = new Map();
  for (const [clave, s] of stock) {
    if (s.bultos <= 0 || bloqueados.has(s.lote_id)) continue;
    if (!porUnidad.has(s.sku_presentacion_id)) porUnidad.set(s.sku_presentacion_id, []);
    porUnidad.get(s.sku_presentacion_id).push(clave);
  }

  const reservas = [];
  for (const ln of lineasDb2) {
    const disponibles = porUnidad.get(ln.sku_presentacion_id);
    if (!disponibles || !disponibles.length) continue;

    let porCubrir = Number(ln.cantidad_tm) * 1000;
    let intentos = 0;
    while (porCubrir > 100 && intentos < 4 && disponibles.length) {
      intentos++;
      const clave = elegir(disponibles);
      const s = stock.get(clave);
      if (!s || s.bultos <= 0) continue;
      const loteId = s.lote_id;

      const pesoUnit = s.peso / s.bultos;
      const bultosPosibles = Math.min(s.bultos, Math.max(1, Math.floor(porCubrir / pesoUnit)));
      if (bultosPosibles <= 0) continue;
      const peso = Number((bultosPosibles * pesoUnit).toFixed(3));

      // Estado de la reserva según el estado del pedido
      let estado, vence, liberadoPor = null, motivoLib = null;
      if (ln.ciclo === 'cerrado' || ln.ciclo === 'despachado') {
        estado = 'consumida'; vence = null;
      } else if (suerte(0.12)) {
        // Reservas caídas: exactamente el problema que reportó el cliente
        estado = elegir(['expirada', 'liberada']);
        vence = fechaMenos(entero(1, 30)) + ' 12:00:00-05';
        liberadoPor = estado === 'liberada' ? uComercial : null;
        motivoLib = estado === 'liberada'
          ? elegir(['El cliente desistió de la compra', 'Cambio de producto solicitado', 'Error en la asignación original'])
          : 'Vencimiento automático del plazo de reserva';
      } else if (suerte(0.2)) {
        estado = 'en_preparacion'; vence = fechaMas(entero(2, 12)) + ' 12:00:00-05';
      } else {
        estado = 'activa'; vence = fechaMas(entero(-2, 14)) + ' 12:00:00-05';
      }

      reservas.push({
        pedido_linea_id: ln.id, lote_id: loteId, almacen_id: s.almacen_id,
        bultos: bultosPosibles, peso_neto_kg: peso, estado,
        vence_el: vence, creado_por: uComercial,
        liberado_por: liberadoPor,
        liberado_en: liberadoPor || estado === 'expirada' ? fechaMenos(entero(1, 20)) + ' 12:00:00-05' : null,
        motivo_liberacion: motivoLib,
      });

      // Solo las reservas vivas consumen stock disponible
      if (['activa', 'en_preparacion', 'consumida'].includes(estado)) {
        s.bultos -= bultosPosibles;
        s.peso = Number((s.peso - peso).toFixed(3));
      }
      porCubrir -= peso;
    }
  }
  await insertarLote('reservas',
    ['pedido_linea_id', 'lote_id', 'almacen_id', 'bultos', 'peso_neto_kg', 'estado',
     'vence_el', 'creado_por', 'liberado_por', 'liberado_en', 'motivo_liberacion'],
    reservas, 400);
  ok(`${reservas.length} reservas`);

  // --- Cierre del ciclo: logística, facturación y trazabilidad -------------
  const { sembrarLogistica } = await import('./seed-logistica.mjs');
  await sembrarLogistica({
    ...ctx, stock, bloqueados, pedDb, clientesDb, destinosDb, unidades,
    uAlmacen, uOperaciones, uComercial, uComex, uCalidad, uGerencia,
  });

  return { stock, bloqueados, pedDb, clientesDb, destinosDb, unidades };
}
