/**
 * ============================================================================
 *  IMPORTADOR DEL MAESTRO DE OLIVER · «DATA 2025 (28).xlsx»
 * ============================================================================
 *  Lee el archivo que lleva la operación en Excel y lo convierte en algo que el
 *  sistema pueda sostener. No es un volcado: son reglas, y cada una viene de
 *  algo que preguntamos y él respondió.
 *
 *  ── LAS CUATRO DECISIONES QUE LO GOBIERNAN ──────────────────────────────────
 *
 *  1. EL KARDEX ARRANCA LIMPIO.
 *     Oliver: «muchas veces solo le cambian el estatus —almacenado pasa a
 *     traslado, o reempaque, reproceso— y ya pierde su trazabilidad como
 *     ingreso, se vuelven 2 salidas».
 *
 *     Eso no es una molestia: hace imposible reconstruir el histórico. Se
 *     comprobó restando: de 11 461 combinaciones de pallet y producto, 10 866
 *     darían saldo NEGATIVO —19 024 toneladas en rojo— porque 10 801 tienen
 *     salida sin ningún ingreso registrado. Cargar eso sería entregar un
 *     inventario que no cuadra desde el primer día, y un inventario que no
 *     cuadra nadie lo vuelve a mirar.
 *
 *     Así que el saldo sale de otro lado: de las filas cuyo ESTATUS FINAL es
 *     ALMACENADO, que son las que siguen en cámara. Ahí sí cuadra: 595 de 597
 *     combinaciones dan positivo.
 *
 *  2. EL HISTÓRICO, SOLO CAMPAÑA 2026.
 *     18 846 filas de 2026 contra 1 409 de 2025 y 87 de 2023-2024. Lo viejo es
 *     además lo anterior a Axim, que es justo lo que Oliver dice que quedó con
 *     un solo número de pallet. Es la parte más sucia y la menos útil.
 *
 *  3. PERO EL SALDO INICIAL, DE TODAS LAS CAMPAÑAS.
 *     Esta es la corrección importante, y salió de mirar los datos: hay 134 TM
 *     —167 pallets— de campañas 2023 a 2025 TODAVÍA EN CÁMARA. Migrar «solo
 *     2026» habría dicho 827 TM cuando en realidad tienen 961.
 *
 *     Y peor: ese producto viejo es exactamente el que alimenta la pantalla de
 *     anticuamiento que Oliver pidió. Dejarlo fuera habría vaciado la función
 *     que más le interesaba.
 *
 *  4. UN PALLET CON VARIOS PRODUCTOS NO ES UN PALLET.
 *     Oliver: «el pallet siempre es consecutivo; en ese caso es porque
 *     pertenece a la producción externa, la cual la ingresamos de manera masiva
 *     por SKU y tonelada». Los datos lo confirman: en los pallets con varios
 *     productos, el 57 % es Servis Chiroque —un maquilador— frente al 31 % de
 *     planta propia; en los de un solo producto es al revés, 80 % planta
 *     propia.
 *
 *     Así que esos se cargan como una posición por SKU, marcada como carga
 *     masiva, en vez de fingir un pallet físico que no existe.
 *
 *  ── LO QUE SE IGNORA ────────────────────────────────────────────────────────
 *   · «__PowerAppsId__». Oliver: «ahí no le hagas caso». Además no es única
 *     —19 785 valores para 20 342 filas— y en 77 filas contiene la palabra
 *     LIBERADO en vez de un identificador.
 *   · Las 637 filas finales vacías y las 13 con columnas de más.
 *
 *  ── CÓMO SE USA ─────────────────────────────────────────────────────────────
 *      node scripts/importar-data.mjs                 → simula y reporta
 *      node scripts/importar-data.mjs --aplicar       → escribe en la base
 *
 *  SIMULA POR DEFECTO, A PROPÓSITO. Este script reemplaza el inventario de una
 *  empresa: tiene que ser más fácil mirarlo que ejecutarlo.
 * ============================================================================
 */
import ExcelJS from 'exceljs';
import path from 'node:path';
import { existsSync } from 'node:fs';

const APLICAR = process.argv.includes('--aplicar');
const ARCHIVO = process.argv.find((a) => a.endsWith('.xlsx'))
  ?? 'DATA 2025 (28).xlsx';

/** La campaña cuyo histórico de movimientos se migra. El saldo va aparte. */
const CAMPANA_HISTORICO = '2026';

/* ==========================================================================
   LAS COLUMNAS, POR POSICIÓN
   --------------------------------------------------------------------------
   Las cabeceras del archivo traen los acentos rotos —«CAMPA?A», «N?PALLET»— y
   buscarlas por nombre falla en silencio: devuelve undefined y el importador
   cargaría columnas vacías sin quejarse. Por posición no hay ambigüedad.
   ========================================================================== */
const C = {
  semana: 1, campana: 2, fechaProduccion: 3, fechaLiberacion: 4, fechaReproceso: 5,
  pallet: 6, descripcion: 7, camara: 8, linea: 9, almacen: 10,
  movimiento: 11, motivoIngreso: 12, motivoSalida: 13, estatus: 14, cliente: 15,
  turno: 16, codigo: 17, empaque: 18, idPres: 19, presentacion: 20,
  pesoBulto: 21, congelamiento: 22, aros: 23, total: 24, pesoNeto: 25,
  operacionIngreso: 26, operacionDespacho: 27, proformaFcl: 28, proforma: 29,
  encargado: 30, clienteDespacho: 31, destino: 32, booking: 33, tipoDespacho: 34,
  semanaDespacho: 35, fechaDespacho: 36, guia: 37, contenedor: 38,
  turnoDespacho: 39, horaInicio: 40, horaFin: 41, almacenSalida: 42,
  condCalidad: 43, condMicro: 44, condCamara: 45, condFinal: 46, resumenObs: 47,
  // 48 = __PowerAppsId__ · no se lee
};

/**
 * El valor de una celda, sea cual sea la forma en que ExcelJS la devuelva.
 *
 * ESTE ARCHIVO ESTÁ LLENO DE FÓRMULAS. Columnas centrales —CAMPAÑA, ID_PRES,
 * PESO NETO— no guardan un valor: guardan `{formula, result}`. Leerlas sin
 * mirar `result` devuelve «[object Object]» y el importador carga basura sin
 * quejarse, que es como empezó este lector.
 *
 * Y una fórmula puede haberse quedado en error —`#REF!`, `#N/A`—. Eso no es un
 * valor vacío: es un dato roto en el origen, y se cuenta aparte para poder
 * avisar en vez de convertirlo en cero.
 */
let erroresDeFormula = 0;
const texto = (c) => {
  let v = c?.value;
  if (v === null || v === undefined) return null;
  //  Fórmula: interesa su resultado, no su texto.
  if (typeof v === 'object' && 'result' in v) v = v.result;
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && v.error) { erroresDeFormula++; return null; }
  if (typeof v === 'object' && v.richText) return v.richText.map((t) => t.text).join('').trim() || null;
  if (typeof v === 'object' && v.text) return String(v.text).trim() || null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim() || null;
};
const numero = (c) => {
  const v = texto(c);
  if (v === null) return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
/** Los seriales de Excel cuentan días desde el 30/12/1899. */
const fecha = (c) => {
  let v = c?.value;
  if (typeof v === 'object' && v !== null && 'result' in v) v = v.result;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const n = numero(c);
  if (n === null || n <= 1) return null;
  return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
};

/**
 * El peso neto de una fila.
 *
 * EL ARCHIVO TRAE FÓRMULAS ROTAS. En la versión del 28/09, 3 653 filas tienen
 * #VALUE! en el PESO NETO, y 194 de ellas son stock ALMACENADO. Leídas tal
 * cual, cuentan como cero y el inventario sale 222,7 TM por debajo —un 9 %—,
 * sin ningún aviso.
 *
 * El peso se puede reconstruir: TOTAL (los bultos) por PESO BULTO. En el
 * archivo anterior esa multiplicación cuadraba con el PESO NETO en el 99,6 %
 * de las filas, así que no es una aproximación: es la misma cuenta que hacía
 * la fórmula antes de romperse. En las 194 filas de stock se pudo recuperar
 * en todas.
 */
let pesosReconstruidos = 0;
function pesoNeto(fila) {
  const directo = numero(fila.getCell(C.pesoNeto));
  if (directo !== null) return directo;

  const bultos = numero(fila.getCell(C.total));
  const porBulto = Number(String(texto(fila.getCell(C.pesoBulto)) ?? '')
    .toUpperCase().replace(/KG|KS/g, '').trim());
  if (bultos !== null && Number.isFinite(porBulto) && porBulto > 0) {
    pesosReconstruidos++;
    return bultos * porBulto;
  }
  return 0;
}

/* ==========================================================================
   LECTURA
   ========================================================================== */
async function leer() {
  const ruta = path.resolve(ARCHIVO);
  if (!existsSync(ruta)) {
    console.error(`No se encontró el archivo: ${ruta}`);
    process.exit(1);
  }
  console.log(`Leyendo ${path.basename(ruta)}…`);
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.readFile(ruta);

  const general = libro.getWorksheet('GENERAL');
  const datos = libro.getWorksheet('DATOS');
  const presentaciones = libro.getWorksheet('TB-PRESENTAACIONES');
  const capacidad = libro.getWorksheet('CAPACIDAD');
  if (!general || !datos) {
    console.error('El archivo no tiene las hojas GENERAL y DATOS. ¿Es el maestro correcto?');
    process.exit(1);
  }
  return { general, datos, presentaciones, capacidad };
}

/* ==========================================================================
   MAESTROS
   ========================================================================== */
function leerProductos(hoja) {
  /*
   * El maestro vive en las columnas R..W de la hoja DATOS, a partir de la
   * fila 3. Sus nombres no son los nuestros:
   *   su CLASIFICACIÓN   = nuestro FORMATO   (LAMINADO, FILETE, ALETAS…)
   *   su FORMATO         = BLOQUES/BOLSAS, que es casi constante y no aporta
   *   su CLASIFICACIÓN 2 = nuestra FAMILIA COMERCIAL
   */
  const filas = [];
  hoja.eachRow((fila, n) => {
    if (n < 3) return;
    const codigo = texto(fila.getCell(18));
    if (!codigo) return;
    filas.push({
      codigo,
      especie: texto(fila.getCell(19)),
      formato: texto(fila.getCell(20)),   // ellos lo llaman CLASIFICACIÓN
      corte: texto(fila.getCell(21)),
      familia: texto(fila.getCell(23)),   // ellos lo llaman CLASIFICACIÓN 2
    });
  });
  return filas;
}

function leerPresentaciones(hoja) {
  if (!hoja) return [];
  const filas = [];
  hoja.eachRow((fila, n) => {
    if (n < 2) return;
    const id = texto(fila.getCell(1));
    if (!id) return;
    const pesoTexto = texto(fila.getCell(3)) ?? '';
    filas.push({
      id,
      congelamiento: texto(fila.getCell(2)),
      pesoBultoKg: Number(pesoTexto.replace(/[^\d.]/g, '')) || null,
      descripcion: texto(fila.getCell(4)),
    });
  });
  return filas;
}

function leerCapacidad(hoja) {
  if (!hoja) return [];
  const filas = [];
  hoja.eachRow((fila, n) => {
    if (n < 2) return;
    const planta = texto(fila.getCell(2));
    if (!planta) return;
    filas.push({
      planta,
      almacen: texto(fila.getCell(3)),
      camara: texto(fila.getCell(4)),
      nombre: texto(fila.getCell(5)),
      capacidadTm: numero(fila.getCell(6)),
      activo: (texto(fila.getCell(7)) ?? '').toUpperCase() === 'ACTIVO',
    });
  });
  return filas;
}

/* ==========================================================================
   LAS DOS CORRECCIONES QUE SE APLICAN AL VUELO
   ========================================================================== */
/**
 * `PLACAS15 KG` dice «2 X 15 KG» en un saco de 15 kilos. Son 30: el texto está
 * mal, no el peso. Su propio `TUNEL15 KG` dice «2 X 7.5 KG», que es la mitad
 * correcta. Está en 39 líneas de pedido, así que se corrige y se avisa.
 */
function corregirPresentacion(p) {
  if (p.id === 'PLACAS15 KG' && p.descripcion === '2 X 15 KG') {
    return { ...p, descripcion: '2 X 7.5 KG', corregida: '2 X 15 KG en un saco de 15 kg' };
  }
  return p;
}

/**
 * `PLACAS20 KG` aparece DOS veces con presentaciones distintas —«4 X 5 KG» y
 * «2 X 10 KG»—, así que el identificador no identifica. Se desambigua con un
 * sufijo en vez de perder una de las dos: las dos existen de verdad.
 */
function desambiguar(lista) {
  const vistos = new Map();
  return lista.map((p) => {
    const n = (vistos.get(p.id) ?? 0) + 1;
    vistos.set(p.id, n);
    const repetido = lista.filter((x) => x.id === p.id).length > 1;
    return repetido ? { ...p, id: `${p.id}#${n}`, idOriginal: p.id } : p;
  });
}

/* ==========================================================================
   EL RECORRIDO DE «GENERAL»
   ========================================================================== */
function recorrer(hoja) {
  const salida = {
    filas: 0, vacias: 0, malformadas: 0,
    saldo: new Map(),        // lo que sigue en cámara, de TODAS las campañas
    movimientos: [],         // el histórico, solo de la campaña elegida
    porCampana: new Map(),
    clientes: new Set(),
    destinos: new Set(),
    proformas: new Set(),
    palletsSku: new Map(),   // pallet -> conjunto de SKU, para detectar la carga masiva
  };

  hoja.eachRow((fila, n) => {
    if (n < 2) return;
    salida.filas++;

    const pallet = texto(fila.getCell(C.pallet));
    if (!pallet) { salida.vacias++; return; }
    if (fila.cellCount > 48) salida.malformadas++;

    const campana = texto(fila.getCell(C.campana));
    const codigo = texto(fila.getCell(C.codigo));
    const estatus = texto(fila.getCell(C.estatus));
    const movimiento = texto(fila.getCell(C.movimiento));
    const kg = pesoNeto(fila);

    salida.porCampana.set(campana, (salida.porCampana.get(campana) ?? 0) + 1);
    if (!salida.palletsSku.has(pallet)) salida.palletsSku.set(pallet, new Set());
    salida.palletsSku.get(pallet).add(codigo);

    /* ---- SALDO: lo que quedó ALMACENADO, venga de la campaña que venga ---- */
    if (estatus === 'ALMACENADO') {
      const clave = [pallet, codigo, texto(fila.getCell(C.almacen)), texto(fila.getCell(C.camara))].join('|');
      const previo = salida.saldo.get(clave) ?? {
        pallet, codigo, campana,
        almacen: texto(fila.getCell(C.almacen)),
        camara: texto(fila.getCell(C.camara)),
        presentacion: texto(fila.getCell(C.idPres)),
        fechaProduccion: fecha(fila.getCell(C.fechaProduccion)),
        lineaProcesadora: texto(fila.getCell(C.linea)),
        //  Regla de Oliver: la columna AU (RESUMEN OBS) dice si el producto
        //  está disponible —OK— u observado —OBS—, y la AT (CONDICIÓN FINAL
        //  EVALUACIONES PT) dice por qué. Se comprobó que AU coincide en todas
        //  las filas con «las cuatro condiciones en LIBERADO».
        disponible: (texto(fila.getCell(C.resumenObs)) ?? 'OK').toUpperCase() !== 'OBS',
        motivo: texto(fila.getCell(C.condFinal)),
        kg: 0, filas: 0,
      };
      //  Un ALMACENADO con movimiento de SALIDA resta: son las dos filas que
      //  quedan en negativo, y se reportan en vez de esconderse.
      previo.kg += movimiento === 'INGRESO' ? kg : -kg;
      previo.filas++;
      //  Se conserva la fecha de producción MÁS ANTIGUA: es la que manda para
      //  el anticuamiento y la vida útil.
      const f = fecha(fila.getCell(C.fechaProduccion));
      if (f && (!previo.fechaProduccion || f < previo.fechaProduccion)) previo.fechaProduccion = f;
      salida.saldo.set(clave, previo);
    }

    /* ---- HISTÓRICO: solo la campaña elegida ---- */
    if (campana === CAMPANA_HISTORICO) {
      salida.movimientos.push({
        pallet, codigo, campana, movimiento, estatus, kg,
        fecha: fecha(fila.getCell(C.fechaProduccion)),
        fechaDespacho: fecha(fila.getCell(C.fechaDespacho)),
        almacen: texto(fila.getCell(C.almacen)),
        proforma: texto(fila.getCell(C.proforma)),
        contenedor: texto(fila.getCell(C.contenedor)),
        guia: texto(fila.getCell(C.guia)),
      });
    }

    const cli = texto(fila.getCell(C.cliente)) ?? texto(fila.getCell(C.clienteDespacho));
    if (cli) salida.clientes.add(cli);
    const dst = texto(fila.getCell(C.destino));
    //  Los números de booking se colaron en la columna de destino: «LMM0589194».
    if (dst && !/^(LMM|\d{8,})/.test(dst)) salida.destinos.add(dst);
    const prf = texto(fila.getCell(C.proforma));
    if (prf) salida.proformas.add(prf);
  });

  return salida;
}

/* ==========================================================================
   INFORME
   ========================================================================== */
function informar(m, productos, presentaciones, capacidad) {
  const tm = (kg) => (kg / 1000).toLocaleString('es-PE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const n = (x) => x.toLocaleString('es-PE');
  const titulo = (t) => console.log(`\n${'─'.repeat(72)}\n  ${t}\n${'─'.repeat(72)}`);

  titulo('LO QUE TRAE EL ARCHIVO');
  console.log(`  filas leídas ................ ${n(m.filas)}`);
  console.log(`  vacías (se descartan) ....... ${n(m.vacias)}`);
  console.log(`  con columnas de más ......... ${n(m.malformadas)}`);
  if (erroresDeFormula) {
    console.log(`  fórmulas en error ........... ${n(erroresDeFormula)}  ← revisar: en el origen`);
  }
  console.log(`  útiles ...................... ${n(m.filas - m.vacias)}`);
  console.log('\n  por campaña:');
  for (const [c, q] of [...m.porCampana].sort()) {
    const marca = c === CAMPANA_HISTORICO ? '  ← histórico migrado' : '';
    console.log(`    ${String(c).padEnd(8)} ${String(n(q)).padStart(8)} filas${marca}`);
  }

  titulo('MAESTROS');
  console.log(`  productos ................... ${n(productos.length)}`);
  console.log(`  presentaciones .............. ${n(presentaciones.length)}`);
  console.log(`  almacenes y cámaras ......... ${n(capacidad.length)}`);
  console.log(`  clientes (solo el nombre) ... ${n(m.clientes.size)}`);
  console.log(`  destinos .................... ${n(m.destinos.size)}`);
  console.log(`  proformas ................... ${n(m.proformas.size)}`);

  const corregidas = presentaciones.filter((p) => p.corregida);
  const desambiguadas = presentaciones.filter((p) => p.idOriginal);
  if (corregidas.length || desambiguadas.length) {
    console.log('\n  correcciones aplicadas al maestro del cliente:');
    for (const p of corregidas) console.log(`    · ${p.id}: «${p.corregida}» → «${p.descripcion}»`);
    for (const p of desambiguadas) console.log(`    · ${p.idOriginal} repetido → ${p.id} («${p.descripcion}»)`);
  }

  titulo('SALDO INICIAL · lo que sigue en cámara');
  const saldo = [...m.saldo.values()];
  const positivos = saldo.filter((s) => s.kg > 0.5);
  const negativos = saldo.filter((s) => s.kg < -0.5);
  const kgTotal = positivos.reduce((t, s) => t + s.kg, 0);
  console.log(`  posiciones .................. ${n(positivos.length)}`);
  console.log(`  pallets distintos ........... ${n(new Set(positivos.map((s) => s.pallet)).size)}`);
  console.log(`  TONELADAS ................... ${tm(kgTotal)} TM`);
  if (negativos.length) {
    console.log(`  con saldo negativo .......... ${n(negativos.length)}  (se descartan y se listan abajo)`);
  }

  const disponible = positivos.filter((x) => x.disponible);
  const observado = positivos.filter((x) => !x.disponible);
  console.log(`
  disponible (AU = OK) ........ ${tm(disponible.reduce((t, x) => t + x.kg, 0))} TM`);
  console.log(`  observado  (AU = OBS) ....... ${tm(observado.reduce((t, x) => t + x.kg, 0))} TM`);
  const motivos = new Map();
  for (const x of observado) motivos.set(x.motivo, (motivos.get(x.motivo) ?? 0) + x.kg);
  for (const [mo, kg] of [...motivos].sort((a, b) => b[1] - a[1])) {
    const marca = /NACIONAL/i.test(mo ?? '') ? '  ← solo mercado nacional' : '';
    console.log(`    ${String(mo ?? 'sin motivo').slice(0, 34).padEnd(34)} ${tm(kg).padStart(8)} TM${marca}`);
  }
  if (pesosReconstruidos) {
    console.log(`
  pesos reconstruidos (bultos × peso por bulto): ${n(pesosReconstruidos)}`);
    console.log('  El PESO NETO venía con #VALUE!; sin reconstruirlo, esas filas');
    console.log('  contaban como cero y el stock salía por debajo sin avisar.');
  }

  const porCamp = new Map();
  for (const s of positivos) porCamp.set(s.campana, (porCamp.get(s.campana) ?? 0) + s.kg);
  console.log('\n  de qué campaña viene ese stock:');
  for (const [c, kg] of [...porCamp].sort()) {
    const aviso = c !== CAMPANA_HISTORICO ? '  ← se carga igual: está físicamente en cámara' : '';
    console.log(`    ${String(c).padEnd(8)} ${tm(kg).padStart(9)} TM${aviso}`);
  }

  const porAlm = new Map();
  for (const s of positivos) porAlm.set(s.almacen, (porAlm.get(s.almacen) ?? 0) + s.kg);
  console.log('\n  por almacén:');
  for (const [a, kg] of [...porAlm].sort((x, y) => y[1] - x[1])) {
    console.log(`    ${String(a ?? '—').slice(0, 26).padEnd(26)} ${tm(kg).padStart(9)} TM`);
  }

  titulo('PALLETS QUE NO SON PALLETS · carga masiva de producción externa');
  const masivos = [...m.palletsSku.entries()].filter(([, sk]) => sk.size > 1);
  console.log(`  pallets con más de un producto ... ${n(masivos.length)} de ${n(m.palletsSku.size)}`);
  console.log('  Se cargan como una posición POR SKU, marcadas como carga masiva:');
  console.log('  fingir un pallet físico que no existe rompería la trazabilidad.');
  for (const [p, sk] of masivos.sort((a, b) => b[1].size - a[1].size).slice(0, 5)) {
    console.log(`    ${p.padEnd(20)} ${sk.size} productos`);
  }

  titulo('HISTÓRICO · para consultar, no para cuadrar');
  console.log(`  movimientos de la campaña ${CAMPANA_HISTORICO} ... ${n(m.movimientos.length)}`);
  const ingresos = m.movimientos.filter((x) => x.movimiento === 'INGRESO').length;
  console.log(`    ingresos .................... ${n(ingresos)}`);
  console.log(`    salidas ..................... ${n(m.movimientos.length - ingresos)}`);
  console.log('\n  Se carga como CONSULTA, no como kardex: al cambiar de estatus se');
  console.log('  pierde el ingreso y quedan dos salidas, así que restar entradas menos');
  console.log('  salidas daría negativo en el 95 % de los lotes. El inventario real es');
  console.log('  el saldo de arriba, y el kardex del sistema arranca desde la migración.');

  if (negativos.length) {
    titulo('REVISAR · posiciones con saldo negativo');
    for (const s of negativos) {
      console.log(`  ${s.pallet.padEnd(20)} SKU ${String(s.codigo).padEnd(5)} ${tm(s.kg).padStart(9)} TM  (${s.filas} filas)`);
    }
  }

  titulo(APLICAR ? 'APLICANDO' : 'SIMULACIÓN · no se escribió nada');
  if (!APLICAR) {
    console.log('  Para escribir en la base:  node scripts/importar-data.mjs --aplicar');
    console.log('\n  FALTA ANTES DE APLICAR:');
    console.log('   · El maestro de clientes con RUC, dirección y país. El archivo');
    console.log('     solo trae el nombre, y la proforma de exportación necesita los');
    console.log('     tres: la aduana de destino los compara con el conocimiento de');
    console.log('     embarque.');
    console.log('   · Una base limpia. Cargar esto encima de los datos de');
    console.log('     demostración mezclaría lo real con lo inventado.');
  }
  return { positivos, negativos, kgTotal };
}

/* ==========================================================================
   PRINCIPAL
   ========================================================================== */
const { general, datos, presentaciones: hojaPres, capacidad: hojaCap } = await leer();

const productos = leerProductos(datos);
const presentaciones = desambiguar(leerPresentaciones(hojaPres)).map(corregirPresentacion);
const capacidad = leerCapacidad(hojaCap);
const m = recorrer(general);

const r = informar(m, productos, presentaciones, capacidad);

if (APLICAR) {
  console.log('\n  La escritura todavía no está conectada: falta el maestro de clientes');
  console.log('  y decidir contra qué base se carga. El análisis de arriba es completo');
  console.log('  y las reglas están fijadas; lo que falta es el destino, no el cómo.');
  process.exit(2);
}

/* Un resumen de una línea, para poder comprobarlo desde una prueba. */
console.log(`\nRESUMEN ${r.positivos.length} posiciones · ${(r.kgTotal / 1000).toFixed(1)} TM · ` +
            `${m.movimientos.length} movimientos · ${productos.length} productos`);
