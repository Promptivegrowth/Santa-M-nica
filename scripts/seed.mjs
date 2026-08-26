#!/usr/bin/env node
/**
 * ============================================================================
 *  SEMBRADOR DE DATOS · Santa Mónica ERP
 * ============================================================================
 *  ¿Qué hace este archivo?
 *  Llena la base de datos con información de prueba para que TODAS las
 *  pantallas del sistema se vean vivas: con lotes, pedidos, embarques,
 *  facturas y alertas reales.
 *
 *  IMPORTANTE: no se está migrando la información del cliente. Lo que se
 *  reutiliza del Excel es únicamente el CATÁLOGO (los 191 productos, las
 *  bodegas, los destinos y los nombres de clientes ya consolidados), para que
 *  el equipo reconozca de inmediato lo que ve. Todos los movimientos, pedidos
 *  y documentos son generados.
 *
 *  Uso:  node scripts/seed.mjs
 * ============================================================================
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ejecutarSQL } from './db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(__dirname, '..');

// --- Configuración -----------------------------------------------------------
const URL_SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CLAVE_DEMO = 'SantaMonica2026';

/* ==========================================================================
   GENERADOR PSEUDOALEATORIO CON SEMILLA
   Usamos una semilla fija para que, si volvemos a sembrar, salga exactamente
   lo mismo. Así las pruebas son repetibles.
   ========================================================================== */
let _semilla = 20260825;
function aleatorio() {
  _semilla = (_semilla * 1664525 + 1013904223) % 4294967296;
  return _semilla / 4294967296;
}
const entero = (min, max) => Math.floor(aleatorio() * (max - min + 1)) + min;
const elegir = (arr) => arr[Math.floor(aleatorio() * arr.length)];
const decimal = (min, max, dec = 2) => Number((aleatorio() * (max - min) + min).toFixed(dec));
/** Devuelve true con la probabilidad indicada (0 a 1). */
const suerte = (p) => aleatorio() < p;

/** Resta días a una fecha y devuelve 'YYYY-MM-DD'. */
function fechaMenos(dias, base = new Date('2026-08-25')) {
  const d = new Date(base);
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}
function fechaMas(dias, base = new Date('2026-08-25')) {
  return fechaMenos(-dias, base);
}

/* ==========================================================================
   UTILIDADES SQL
   ========================================================================== */
/** Escapa un valor para incrustarlo en SQL de forma segura. */
function sql(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** Inserta muchas filas de una sola vez, en tandas para no saturar la API. */
async function insertarLote(tabla, columnas, filas, tanda = 400) {
  let total = 0;
  for (let i = 0; i < filas.length; i += tanda) {
    const parte = filas.slice(i, i + tanda);
    const valores = parte
      .map((f) => `(${columnas.map((c) => sql(f[c])).join(',')})`)
      .join(',');
    await ejecutarSQL(
      `insert into ${tabla} (${columnas.join(',')}) values ${valores};`
    );
    total += parte.length;
  }
  return total;
}

/** Consulta que devuelve filas. */
async function consultar(q) {
  const r = await ejecutarSQL(q);
  return Array.isArray(r) ? r : [];
}

const paso = (n, txt) => console.log(`\n▸ [${n}] ${txt}`);
const ok = (txt) => console.log(`   ✓ ${txt}`);

/* ==========================================================================
   PASO 1 · USUARIOS
   Un usuario por rol, todos con la misma contraseña, para el acceso rápido
   del login durante el desarrollo.
   ========================================================================== */
const USUARIOS = [
  { email: 'gerencia@santamonica.pe',    nombre: 'Marco A. León Linares', rol: 'gerencia',    cargo: 'Gerencia General' },
  { email: 'operaciones@santamonica.pe', nombre: 'Oliver Tello',          rol: 'operaciones', cargo: 'Jefatura de Operaciones' },
  { email: 'comercial@santamonica.pe',   nombre: 'Andrea Ríos',           rol: 'comercial',   cargo: 'Ventas' },
  { email: 'comex@santamonica.pe',       nombre: 'Paolo Quiñones',        rol: 'comex',       cargo: 'Comercio Exterior' },
  { email: 'almacen@santamonica.pe',     nombre: 'Luis Palacios',         rol: 'almacen',     cargo: 'Jefatura de Almacén' },
  { email: 'calidad@santamonica.pe',     nombre: 'Karina Sotelo',         rol: 'calidad',     cargo: 'Aseguramiento de Calidad' },
  { email: 'consulta@santamonica.pe',    nombre: 'Invitado Santa Mónica', rol: 'consulta',    cargo: 'Solo lectura' },
];

async function crearUsuarios() {
  paso(1, 'Creando los 7 usuarios (uno por rol)…');
  const creados = [];

  for (const u of USUARIOS) {
    // Buscamos si ya existe para no duplicar en re-siembras
    const listado = await fetch(
      `${URL_SUPABASE}/auth/v1/admin/users?page=1&per_page=200`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    ).then((r) => r.json());

    let existente = (listado.users || []).find((x) => x.email === u.email);

    if (!existente) {
      const resp = await fetch(`${URL_SUPABASE}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: u.email,
          password: CLAVE_DEMO,
          email_confirm: true,
          user_metadata: { nombre: u.nombre, rol: u.rol, cargo: u.cargo },
        }),
      });
      const datos = await resp.json();
      if (!resp.ok) throw new Error(`No se pudo crear ${u.email}: ${JSON.stringify(datos)}`);
      existente = datos;
      ok(`creado ${u.email}`);
    } else {
      ok(`ya existía ${u.email}`);
    }
    creados.push({ ...u, id: existente.id });
  }

  ok(`${creados.length} usuarios listos en el sistema de autenticación`);
  return creados;
}

/**
 * Espejo de los usuarios en la tabla del negocio.
 * Se ejecuta DESPUÉS de sembrar los maestros porque el TRUNCATE ... CASCADE
 * sobre almacenes arrastra la tabla usuarios (que referencia a almacenes).
 */
async function sincronizarUsuarios(creados, idAlm) {
  await ejecutarSQL(`
    insert into usuarios (id, nombre, email, rol, almacen_id) values
    ${creados
      .map((u) => `(${sql(u.id)},${sql(u.nombre)},${sql(u.email)},${sql(u.rol)},${
        u.rol === 'almacen' && idAlm ? sql(idAlm['STM-C3']) : 'null'
      })`)
      .join(',')}
    on conflict (id) do update
      set nombre = excluded.nombre, rol = excluded.rol,
          email = excluded.email, almacen_id = excluded.almacen_id;
  `);
  ok(`${creados.length} usuarios sincronizados en la tabla usuarios`);
}

/* ==========================================================================
   PASO 2 · MAESTROS
   ========================================================================== */
async function sembrarMaestros(catalogo, _usuarios) {
  paso(2, 'Sembrando maestros (plantas, almacenes, productos, clientes)…');

  // --- Limpieza de datos operativos previos (mantiene parámetros y motivos) ---
  await ejecutarSQL(`
    truncate table
      cobranzas, factura_lineas, facturas,
      despachos, plano_estiba, packing_lineas, packing_lists,
      embarque_pedidos, embarques,
      reservas, pedido_lineas, pedidos,
      cotizacion_lineas, cotizaciones,
      precios, listas_precio,
      traslado_lineas, traslados,
      dictamenes_calidad, movimientos, existencias, lotes,
      alertas, eventos, auditoria,
      precios_mercado, importaciones,
      sku_presentaciones, skus, formatos, especies, presentaciones,
      camaras, almacenes_habilitados,
      vehiculos, conductores, transportistas,
      clientes, vendedores, destinos,
      lineas_procesadoras, almacenes, plantas
    restart identity cascade;
  `);
  ok('tablas operativas limpiadas');

  // IMPORTANTE: el TRUNCATE ... CASCADE se propaga por la cadena de claves
  // foráneas almacenes → usuarios → parametros / reglas, así que también borra
  // la configuración base. La reponemos aplicando de nuevo la migración 007.
  const datosBase = readFileSync(resolve(raiz, 'supabase/migrations/007_datos_base.sql'), 'utf8');
  await ejecutarSQL('delete from reglas; delete from motivos; delete from parametros;');
  await ejecutarSQL(datosBase);
  ok('configuración base repuesta (parámetros, motivos y reglas)');

  // --- Plantas -------------------------------------------------------------
  const plantas = [
    { codigo: 'STM',   nombre: 'Santa Mónica',    tipo: 'propia' },
    { codigo: 'CHIR',  nombre: 'Servis Chiroque', tipo: 'maquila' },
    { codigo: 'CELT',  nombre: 'Servis Celta',    tipo: 'maquila' },
    { codigo: 'OCEA',  nombre: 'Oceano',          tipo: 'maquila' },
    { codigo: 'HAYD',  nombre: 'Hayduk',          tipo: 'maquila' },
  ];
  await insertarLote('plantas', ['codigo', 'nombre', 'tipo'], plantas);
  ok(`${plantas.length} plantas`);

  // --- Almacenes (los 10 reales, con su capacidad) --------------------------
  const almacenes = [
    { codigo: 'STM-C1', nombre: 'Santa Mónica · Cámara 01', tipo: 'propio',  operador: 'Santa Mónica', planta: 'STM', capacidad_tm: 150,  ciudad: 'Chimbote', despachos_dia_max: 3 },
    { codigo: 'STM-C2', nombre: 'Santa Mónica · Cámara 02', tipo: 'propio',  operador: 'Santa Mónica', planta: 'STM', capacidad_tm: 250,  ciudad: 'Chimbote', despachos_dia_max: 6 },
    { codigo: 'STM-C3', nombre: 'Santa Mónica · Cámara 03', tipo: 'propio',  operador: 'Santa Mónica', planta: 'STM', capacidad_tm: 796,  ciudad: 'Chimbote', despachos_dia_max: 6 },
    { codigo: 'FREEKO', nombre: 'Freeko',                   tipo: 'externo', operador: 'Freeko',       planta: null,  capacidad_tm: 1300, ciudad: 'Chimbote', despachos_dia_max: 5 },
    { codigo: 'ELAMAR', nombre: 'Elamar',                   tipo: 'externo', operador: 'Elamar',       planta: null,  capacidad_tm: 500,  ciudad: 'Chimbote', despachos_dia_max: 4 },
    { codigo: 'PERUFR', nombre: 'Perufrost',                tipo: 'externo', operador: 'Perufrost',    planta: null,  capacidad_tm: 500,  ciudad: 'Chimbote', despachos_dia_max: 4 },
    { codigo: 'DEPSA',  nombre: 'Depsa',                    tipo: 'externo', operador: 'Depsa',        planta: null,  capacidad_tm: 300,  ciudad: 'Callao',   despachos_dia_max: 4 },
    { codigo: 'COINRE', nombre: 'Coinrefri',                tipo: 'externo', operador: 'Coinrefri',    planta: null,  capacidad_tm: 30,   ciudad: 'Chimbote', despachos_dia_max: 2 },
    { codigo: 'EMERG',  nombre: 'Emergent Cold',            tipo: 'externo', operador: 'Emergent Cold',planta: null,  capacidad_tm: 400,  ciudad: 'Callao',   despachos_dia_max: 3 },
    { codigo: 'HAYDUK', nombre: 'Hayduk',                   tipo: 'externo', operador: 'Hayduk',       planta: null,  capacidad_tm: 250,  ciudad: 'Chimbote', despachos_dia_max: 2 },
  ];
  const idPlanta = {};
  (await consultar('select id, codigo from plantas')).forEach((p) => (idPlanta[p.codigo] = p.id));
  await insertarLote(
    'almacenes',
    ['codigo', 'nombre', 'tipo', 'operador', 'planta_id', 'capacidad_tm', 'ciudad', 'despachos_dia_max'],
    almacenes.map((a) => ({ ...a, planta_id: a.planta ? idPlanta[a.planta] : null }))
  );
  ok(`${almacenes.length} almacenes`);

  const almDb = await consultar('select id, codigo, nombre, tipo from almacenes order by id');
  const idAlm = Object.fromEntries(almDb.map((a) => [a.codigo, a.id]));

  // --- Cámaras dentro de los almacenes propios ------------------------------
  await insertarLote('camaras', ['almacen_id', 'nombre', 'capacidad_tm'], [
    { almacen_id: idAlm['STM-C1'], nombre: 'Cámara 01', capacidad_tm: 150 },
    { almacen_id: idAlm['STM-C2'], nombre: 'Cámara 02', capacidad_tm: 250 },
    { almacen_id: idAlm['STM-C3'], nombre: 'Cámara 03', capacidad_tm: 796 },
  ]);

  // --- Matriz almacén habilitado por país ----------------------------------
  const paises = ['China', 'Tailandia', 'Rusia', 'España', 'Japón', 'Corea del Sur',
                  'Portugal', 'Vietnam', 'México', 'Estonia', 'Perú', 'Liberia', 'Costa de Marfil'];
  const habilitados = [];
  for (const a of almDb) {
    for (const p of paises) {
      // Regla ficticia pero coherente: Coinrefri y Hayduk (pequeños) solo mercado local
      const hab = ['COINRE', 'HAYDUK'].includes(a.codigo) ? p === 'Perú' : true;
      habilitados.push({ almacen_id: a.id, pais: p, habilitado: hab });
    }
  }
  await insertarLote('almacenes_habilitados', ['almacen_id', 'pais', 'habilitado'], habilitados);
  ok(`${habilitados.length} combinaciones almacén/país`);

  // --- Líneas procesadoras --------------------------------------------------
  const lineas = catalogo.lineas_procesadoras.slice(0, 10).map((n) => ({ nombre: n, planta_id: null }));
  await insertarLote('lineas_procesadoras', ['nombre', 'planta_id'], lineas);
  ok(`${lineas.length} líneas procesadoras`);

  // --- Especies, formatos, presentaciones, SKUs -----------------------------
  const skusVal = catalogo.skus.filter((s) => s.codigo && s.especie && s.formato && s.corte);
  const especies = [...new Set(skusVal.map((s) => s.especie))];
  await insertarLote('especies', ['nombre'], especies.map((n) => ({ nombre: n })));
  const idEsp = Object.fromEntries((await consultar('select id, nombre from especies')).map((e) => [e.nombre, e.id]));

  const paresFmt = [...new Set(skusVal.map((s) => `${s.especie}||${s.formato}`))];
  await insertarLote('formatos', ['especie_id', 'nombre'],
    paresFmt.map((p) => { const [e, f] = p.split('||'); return { especie_id: idEsp[e], nombre: f }; }));
  const fmtDb = await consultar('select f.id, f.nombre, e.nombre as especie from formatos f join especies e on e.id=f.especie_id');
  const idFmt = Object.fromEntries(fmtDb.map((f) => [`${f.especie}||${f.nombre}`, f.id]));
  ok(`${especies.length} especies · ${paresFmt.length} formatos`);

  await insertarLote('presentaciones', ['codigo', 'congelamiento', 'peso_bulto_kg', 'descripcion'],
    catalogo.presentaciones.map((p, i) => ({ ...p, codigo: `${p.codigo}#${i + 1}` })));
  const presDb = await consultar('select id, peso_bulto_kg, descripcion, congelamiento from presentaciones order by id');
  ok(`${presDb.length} presentaciones`);

  // SKUs: uno por cada producto del catálogo real
  await insertarLote('skus',
    ['codigo', 'especie_id', 'formato_id', 'corte', 'clasificacion_comercial', 'empaque'],
    skusVal.map((s) => ({
      codigo: s.codigo,
      especie_id: idEsp[s.especie],
      formato_id: idFmt[`${s.especie}||${s.formato}`],
      corte: s.corte,
      clasificacion_comercial: s.clasificacion || s.formato,
      empaque: 'sacos',
    })));
  const skuDb = await consultar('select id, codigo from skus order by id');
  ok(`${skuDb.length} SKUs`);

  // Unidades vendibles: cada SKU en 1 a 3 presentaciones
  const sp = [];
  for (const s of skuDb) {
    const n = entero(1, 3);
    const usadas = new Set();
    for (let i = 0; i < n; i++) {
      const p = elegir(presDb);
      if (usadas.has(p.id)) continue;
      usadas.add(p.id);
      sp.push({ sku_id: s.id, presentacion_id: p.id });
    }
  }
  await insertarLote('sku_presentaciones', ['sku_id', 'presentacion_id'], sp);
  ok(`${sp.length} unidades vendibles (SKU + presentación)`);

  // --- Vendedores -----------------------------------------------------------
  const vendedores = [
    { nombre: 'Venta Directa Santa Mónica', tipo: 'final' },
    { nombre: 'Pacific Seafood Brokers',    tipo: 'intermediario' },
    { nombre: 'Andes Trading Agents',       tipo: 'intermediario' },
    { nombre: 'Global Fish Representación', tipo: 'intermediario' },
    { nombre: 'Asia Link Comercial',        tipo: 'intermediario' },
  ];
  await insertarLote('vendedores', ['nombre', 'tipo'], vendedores);
  const vendDb = await consultar('select id from vendedores order by id');

  // --- Clientes (nombres consolidados del catálogo real) --------------------
  const clientes = catalogo.clientes.slice(0, 90).map((c, i) => {
    const pais = /QINGDAO|SHENZHEN|ZHOUSHAN|WEIHAI|SUQIAN|WUHAN|DALIAN|YANTAI|CHINA|HONGKONG|HONG KONG|CMCC|MERMAID|GIANT/i.test(c.razon_social) ? 'China'
      : /BOONSIRI|PRAKAIPORN|THAI/i.test(c.razon_social) ? 'Tailandia'
      : /MAGIC FISH|OOO/i.test(c.razon_social) ? 'Rusia'
      : /KULALIA|FROXA|VIGO/i.test(c.razon_social) ? 'España'
      : /UMIOS|HIZEN|JAPAN/i.test(c.razon_social) ? 'Japón'
      : /OPTIMIZE|DIRECT INTERNATIONAL/i.test(c.razon_social) ? 'Estados Unidos'
      : /AGI TRADING/i.test(c.razon_social) ? 'Emiratos Árabes Unidos'
      : 'Perú';
    return {
      codigo: `CLI-${String(i + 1).padStart(4, '0')}`,
      razon_social: c.razon_social,
      nombre_corto: c.razon_social.split(/[\s,]+/).slice(0, 2).join(' '),
      tipo: 'final',
      pais,
      vendedor_id: elegir(vendDb).id,
      moneda: pais === 'Perú' ? 'PEN' : 'USD',
      // Línea de crédito proporcional a su volumen histórico
      linea_credito: Math.round((50 + c.movimientos * 1.5) / 10) * 10000,
      dias_credito: elegir([0, 15, 30, 30, 45, 60]),
      bloqueado: suerte(0.04),
      motivo_bloqueo: null,
    };
  });
  clientes.forEach((c) => { if (c.bloqueado) c.motivo_bloqueo = elegir(['Línea de crédito excedida', 'Documentos vencidos sin regularizar', 'Pendiente de revisión comercial']); });
  await insertarLote('clientes',
    ['codigo', 'razon_social', 'nombre_corto', 'tipo', 'pais', 'vendedor_id', 'moneda', 'linea_credito', 'dias_credito', 'bloqueado', 'motivo_bloqueo'],
    clientes);
  ok(`${clientes.length} clientes`);

  // --- Destinos -------------------------------------------------------------
  await insertarLote('destinos', ['puerto', 'pais'],
    catalogo.destinos.map((d) => ({ puerto: d.puerto, pais: d.pais })));
  ok(`${catalogo.destinos.length} destinos`);

  // --- Transporte -----------------------------------------------------------
  const transportistas = [
    { razon_social: 'Transportes Costa Norte S.A.C.', tipo: 'tercero', ruc: '20481234567' },
    { razon_social: 'Logística Refrigerada Perú',     tipo: 'tercero', ruc: '20512345678' },
    { razon_social: 'Flota Santa Mónica',             tipo: 'propio',  ruc: '20205572229' },
    { razon_social: 'Andina Cargo Express',           tipo: 'tercero', ruc: '20556789012' },
  ];
  await insertarLote('transportistas', ['razon_social', 'tipo', 'ruc'], transportistas);
  const transDb = await consultar('select id, tipo from transportistas order by id');

  const vehiculos = [];
  for (let i = 0; i < 14; i++) {
    const t = elegir(transDb);
    vehiculos.push({
      placa: `${elegir(['A','B','C','D','V','T'])}${entero(1,9)}${elegir(['A','B','C','G','J','M'])}-${entero(100,999)}`,
      transportista_id: t.id,
      marca: elegir(['Volvo', 'Scania', 'Hino', 'Freightliner', 'International']),
      modelo: `FH${entero(400, 540)}`,
      capacidad_tm: elegir([24, 28, 30, 32]),
      // Algunos vencen pronto para que las alertas tengan de qué avisar
      soat_vence: fechaMas(entero(-20, 300)),
      revision_vence: fechaMas(entero(-15, 260)),
    });
  }
  await insertarLote('vehiculos', ['placa', 'transportista_id', 'marca', 'modelo', 'capacidad_tm', 'soat_vence', 'revision_vence'], vehiculos);

  const nombresCond = ['Juan Palacios Ríos','Carlos Sullón Vega','Miguel Ancajima','Jean Carlos Zapata',
    'Eduardo Sánchez','Jesús Mendoza','Anghelo Ruiz','Henrry Chávez','Jhonatan Príncipe','Estefani Rojas'];
  const conductores = nombresCond.map((n) => ({
    nombre: n,
    dni: String(40000000 + entero(1, 9999999)),
    licencia: `Q${entero(10000000, 99999999)}`,
    licencia_vence: fechaMas(entero(-10, 400)),
    transportista_id: elegir(transDb).id,
  }));
  await insertarLote('conductores', ['nombre', 'dni', 'licencia', 'licencia_vence', 'transportista_id'], conductores);
  ok(`${transportistas.length} transportistas · ${vehiculos.length} vehículos · ${conductores.length} conductores`);

  return { idAlm, almDb, skuDb, presDb };
}

/* ==========================================================================
   ARRANQUE
   ========================================================================== */
async function principal() {
  console.log('════════════════════════════════════════════════════════════');
  console.log('  SEMBRADO DE DATOS · SANTA MÓNICA ERP');
  console.log('════════════════════════════════════════════════════════════');

  const rutaCatalogo = resolve(raiz, 'supabase/seed/catalogo.json');
  if (!existsSync(rutaCatalogo)) throw new Error('Falta supabase/seed/catalogo.json');
  const catalogo = JSON.parse(readFileSync(rutaCatalogo, 'utf8'));

  const usuarios = await crearUsuarios();
  const ctx = await sembrarMaestros(catalogo, usuarios);
  await sincronizarUsuarios(usuarios, ctx.idAlm);

  // Los pasos operativos viven en su propio archivo para mantener esto legible
  const { sembrarOperacion } = await import('./seed-operacion.mjs');
  await sembrarOperacion({ ...ctx, usuarios, sql, insertarLote, consultar, ejecutarSQL,
                           aleatorio, entero, elegir, decimal, suerte, fechaMenos, fechaMas, paso, ok });

  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  ✓ SEMBRADO COMPLETO');
  console.log('════════════════════════════════════════════════════════════');
  console.log(`\n  Usuarios de prueba (contraseña: ${CLAVE_DEMO}):`);
  USUARIOS.forEach((u) => console.log(`   · ${u.email.padEnd(30)} ${u.rol.padEnd(12)} ${u.nombre}`));
  console.log('');
}

principal().catch((e) => {
  console.error('\n✗ ERROR EN EL SEMBRADO:', e.message);
  process.exit(1);
});
