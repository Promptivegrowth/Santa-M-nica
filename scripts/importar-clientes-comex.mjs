/**
 * ============================================================================
 *  IMPORTAR LA LISTA DE CLIENTES DE COMEX (Verificación BASC 2026)
 * ============================================================================
 *  Oliver envió «Lista Clientes - Verificación 2026.xlsx» (formato
 *  BASC.F.15.01), hecha por Comex: 74 clientes con dirección, documento
 *  tributario, contacto, forma de pago habitual y las verificaciones de
 *  seguridad (Lista Clinton, ONU terrorismo, ONU armas, acuerdo de seguridad).
 *
 *  POR DEFECTO NO ESCRIBE NADA. Cruza la lista con los clientes del ERP, revisa
 *  la calidad de los datos y deja un Excel de conciliación para revisar:
 *
 *      node scripts/importar-clientes-comex.mjs "<lista.xlsx>"
 *      node scripts/importar-clientes-comex.mjs "<lista.xlsx>" --probar   (aplica y deshace: prueba la carga)
 *      node scripts/importar-clientes-comex.mjs "<lista.xlsx>" --aplicar  (carga de verdad)
 *
 *  El Excel de conciliación lleva nombres de clientes reales: se escribe FUERA
 *  del repositorio, junto a la lista original.
 *
 *  QUÉ HACE AL APLICAR, en una sola transacción:
 *    · Cliente que ya existe (mismo nombre, sin puntuación ni «CO., LTD»):
 *      se actualizan sus datos con los de Comex. No se toca su código, su
 *      crédito ni su historial.
 *    · Cliente nuevo: se da de alta con código CLI-####.
 *    · El contacto de la lista queda como contacto principal del cliente.
 *    · Cada verificación BASC, con su fecha, en cliente_verificaciones.
 *  Los nombres «parecidos» (no iguales) NO se unen solos: se listan para que
 *  Comex diga si son el mismo cliente.
 * ============================================================================
 */
import ExcelJS from 'exceljs';
import { dirname, join, basename } from 'node:path';
import { ejecutarSQL } from './db.mjs';

const ruta = process.argv[2];
const modo = process.argv.includes('--aplicar') ? 'aplicar' : process.argv.includes('--probar') ? 'probar' : 'revisar';
if (!ruta) { console.error('Indique la ruta de la lista de Comex.'); process.exit(1); }
const consultar = async (sql) => { const r = await ejecutarSQL(sql); return Array.isArray(r) ? r : []; };

/* ==========================================================================
   LEER LA LISTA
   ========================================================================== */
const libro = new ExcelJS.Workbook();
await libro.xlsx.readFile(ruta);
const hoja = libro.worksheets[0];
const valor = (c) => {
  const v = c?.value;
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') return String(v.result ?? v.text ?? (v.richText ? v.richText.map((r) => r.text).join('') : v.hyperlink ?? '')).trim();
  return String(v).replace(/\s+/g, ' ').trim();
};
/* La fila de títulos: la que dice «Cliente». */
let filaTitulos = 0;
hoja.eachRow((fila, i) => { if (!filaTitulos && fila.values.some((x) => String(x ?? '').trim() === 'Cliente')) filaTitulos = i; });
const titulos = hoja.getRow(filaTitulos).values.map((x) => String(x ?? '').trim());
const col = (nombre, desde = 0) => titulos.findIndex((t, i) => i > desde && t.toLowerCase().startsWith(nombre.toLowerCase()));
const C = {
  n: 1, cliente: col('Cliente'), continente: col('Continente'), pais: col('Pais'), direccion: col('Dirección'), tax: col('Tax ID'),
  contacto: col('Contacto'), cargo: col('Cargo'), telefono: col('Telefono'), email: col('Email'), web: col('Página'),
  condicion: col('Condición'), pago: col('Financiamiento'), referencias: col('Referencias'), productos: col('Productos'),
  clinton: col('Verificación Lista Clinton'), persona: col('Persona'), acuerdo: col('Acuerdo'), envio: col('Fecha de Envío'),
  firma: col('Fecha de Firma'), terrorismo: col('Verificación ONU TERRORISMO'), armas: col('Verificación ONU ARMAS'),
};
C.clintonFecha = C.clinton + 1;
C.terrorismoFecha = C.terrorismo + 1;
C.armasFecha = C.armas + 1;

const filas = [];
hoja.eachRow((fila, i) => {
  if (i <= filaTitulos) return;
  const g = (k) => valor(fila.getCell(C[k]));
  if (!g('cliente') || !/^\d+$/.test(g('n'))) return;
  filas.push({
    n: Number(g('n')), cliente: g('cliente').replace(/\s+/g, ' ').trim(), continente: g('continente'), pais: g('pais'),
    direccion: g('direccion'), tax: g('tax'), contacto: g('contacto'), cargo: g('cargo'), telefono: g('telefono'),
    email: g('email').toLowerCase(), web: g('web'), condicion: g('condicion'), pago: g('pago'), referencias: g('referencias'),
    productos: g('productos'), clinton: g('clinton'), clintonFecha: g('clintonFecha'), persona: g('persona'),
    acuerdo: g('acuerdo'), envio: g('envio'), firma: g('firma'), terrorismo: g('terrorismo'),
    terrorismoFecha: g('terrorismoFecha'), armas: g('armas'), armasFecha: g('armasFecha'),
  });
});

/* ==========================================================================
   INTERPRETAR
   ========================================================================== */
const sinTildes = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const VACIAS = new Set(['CO', 'LTD', 'LIMITED', 'COMPANY', 'SA', 'S', 'A', 'SL', 'SLU', 'U', 'INC', 'CORP', 'CORPORATION', 'LLC', 'OOO', 'PTE', 'AS', 'DE', 'CV', 'THE', 'C', 'V']);
const clave = (s) => sinTildes(String(s).toUpperCase()).replace(/[^A-Z0-9]+/g, ' ').split(' ').filter((t) => t && !VACIAS.has(t)).join(' ');
const fichas = (s) => new Set(clave(s).split(' '));
/*
 * MISMO CLIENTE CON UN NOMBRE MÁS COMPLETO: si todas las palabras de un nombre
 * están en el otro («FUJIAN XIONGYI» y «FUJIAN XIONGYI TRADING CO., LTD»),
 * es el mismo. Pero no si lo único que comparten son palabras de cualquiera:
 * «QINGDAO HAIJIN FOOD» y «QINGDAO MEIMEI FOOD» son dos clientes distintos.
 */
const GENERICAS = new Set(['QINGDAO', 'SHANDONG', 'FUJIAN', 'FUZHOU', 'ZHOUSHAN', 'DALIAN', 'NINGBO', 'WEIHAI', 'SHENZHEN', 'WUHAN', 'CHINA',
  'HONG', 'KONG', 'HK', 'FOOD', 'FOODS', 'TRADING', 'TRADE', 'INTERNATIONAL', 'SEAFOOD', 'SEAFOODS', 'AQUATIC', 'IMPORT', 'EXPORT', 'SUPPLY',
  'CHAIN', 'MANAGEMENT', 'PRODUCTS', 'MARINE', 'GROUP', 'FISH', 'FISHERIES', 'LETD']);
const distintivas = (s) => new Set([...fichas(s)].filter((t) => !GENERICAS.has(t)));
/**
 * Un nombre está entero dentro del otro y lo que sobra son palabras genéricas
 * («TRADING», «SEAFOOD», la provincia, «LETD» = LTD mal escrito). Así
 * «PESCIRO» no se une con «PESCIRO ASIA INTERNACIONAL», que es otra empresa.
 */
const contenido = (a, b) => {
  const x = fichas(a); const y = fichas(b);
  const [menor, mayor] = x.size <= y.size ? [x, y] : [y, x];
  if (menor.size === 0 || ![...menor].every((t) => mayor.has(t) || t === 'LETD')) return false;
  return [...mayor].filter((t) => !menor.has(t)).every((t) => GENERICAS.has(t));
};
const parecido = (a, b) => {
  const x = distintivas(a); const y = distintivas(b);
  const i = [...x].filter((t) => y.has(t)).length;
  return i / Math.max(x.size, y.size, 1);
};
const fecha = (s) => (/^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

/** «USCI: 9137…», «NIF B85…», «RFC: ILO…», «VAT Number: GB…» → etiqueta y número. */
function documento(texto, pais) {
  const t = texto.replace(/\s+/g, ' ').trim();
  if (!t) return { etiqueta: null, numero: null };
  const m = /^(USCI|USCC|TAX ID|NIF|CIF|RFC|INN|VAT(?: NUMBER| NO\.?)?|EIN)\s*[:.]?\s*(.+)$/i.exec(t);
  if (m) {
    let et = m[1].toUpperCase().replace(/\s*NUMBER$/, '').replace(/\s*NO\.?$/, '');
    if (et === 'USCC') et = 'USCI';
    return { etiqueta: et, numero: m[2].trim() };
  }
  const porPais = { China: 'USCI', España: 'NIF', Mexico: 'RFC', México: 'RFC', Rusia: 'INN', Corea: 'BRN', Vietnam: 'MST', Singapur: 'UEN' };
  return { etiqueta: porPais[pais] ?? 'TAX ID', numero: t };
}

/** La forma de pago de Comex, estructurada como la del ERP. */
function pago(texto) {
  const t = sinTildes(texto.toUpperCase());
  let m;
  if ((m = /(\d+)\s*%\s*ADELANTO/.exec(t))) return { forma_pago: 'adelanto_saldo', adelanto_pct: Number(m[1]), dias: 0 };
  if (/100\s*%\s*ADELANTADO/.test(t)) return { forma_pago: 'contado', adelanto_pct: 100, dias: 0 };
  if (/100\s*%\s*PAGO CONTRA DOCUMENTOS/.test(t)) return { forma_pago: 'cad', adelanto_pct: 0, dias: 0 };
  if (/CARTA DE CREDITO/.test(t)) return { forma_pago: 'carta_credito', adelanto_pct: 0, dias: Number(/(\d+)\s*DIAS/.exec(t)?.[1] ?? 0) };
  if (/US\$\s*[\d,]+\s*ADELANTO/.test(t)) return { forma_pago: 'adelanto_saldo', adelanto_pct: null, dias: 0 };
  return { forma_pago: null, adelanto_pct: null, dias: 0 };
}

/* ==========================================================================
   CRUZAR CON EL ERP Y REVISAR LA CALIDAD
   ========================================================================== */
const erp = await consultar(`select id, codigo, razon_social, pais, ruc_tax_id from clientes order by id`);
/*
 * Dos clientes del ERP con el mismo nombre (sin puntuación) no se pueden
 * cruzar solos: no se sabe cuál es. Se avisan y no se tocan.
 */
const repetidosErp = new Map();
for (const c of erp) { const k = clave(c.razon_social); repetidosErp.set(k, [...(repetidosErp.get(k) ?? []), c]); }
const porClave = new Map([...repetidosErp].filter(([, v]) => v.length === 1).map(([k, v]) => [k, v[0]]));
const dudososErp = [...repetidosErp.values()].filter((v) => v.length > 1);
const observaciones = [];
const obs = (r, texto) => observaciones.push({ n: r.n, cliente: r.cliente, observacion: texto });

const enLista = new Map();
for (const r of filas) {
  const k = clave(r.cliente);
  if (enLista.has(k)) obs(r, `Repetido en la lista (igual que la fila ${enLista.get(k).n}).`);
  enLista.set(k, r);
  r.doc = documento(r.tax, r.pais);
  r.pagoErp = pago(r.pago);
  r.tipo = /^intermediario|\/\s*intermediario|^comprador\s*\/\s*intermediario/i.test(r.condicion) || r.condicion.toLowerCase() === 'intermediario' ? 'intermediario' : 'final';
  r.erp = porClave.get(k) ?? null;
  const dudoso = dudososErp.find((v) => clave(v[0].razon_social) === k);
  if (dudoso) r.omitir = true;
  if (dudoso) obs(r, `En el ERP hay ${dudoso.length} clientes con este nombre (${dudoso.map((c) => c.codigo).join(', ')}): diga cuál es y se unen; mientras, no se toca.`);
  if (!r.erp && !dudoso) {
    const contiene = erp.filter((c) => contenido(c.razon_social, r.cliente) && !dudososErp.some((v) => v.includes(c)));
    if (contiene.length === 1) { r.erp = contiene[0]; r.unidoPor = 'nombre contenido'; }
    //  Varios candidatos (el ERP ya tiene variantes del mismo cliente): que Comex elija.
    if (contiene.length > 1) r.posibles = contiene;
  }
  if (!r.erp) {
    const cand = erp.map((c) => ({ c, p: parecido(c.razon_social, r.cliente) })).filter((x) => x.p >= 0.5).sort((a, b) => b.p - a.p)[0];
    if (cand && !r.posibles) r.posibles = [cand.c];
  }
  //  Con un parecido sin confirmar no se da de alta: sería un duplicado si resulta ser el mismo.
  if (!r.erp && r.posibles) {
    r.omitir = true;
    obs(r, `Parecido a ${r.posibles.map((c) => `${c.codigo} «${c.razon_social}»`).join(' o ')}: confirme si es el mismo cliente; mientras, no se carga.`);
  }
  //  Calidad: lo que conviene que Comex revise antes de cargar.
  if (!r.tax) obs(r, 'Sin documento tributario (Tax ID): el contrato y la proforma lo piden.');
  if (!r.direccion) obs(r, 'Sin dirección.');
  if (!r.email) obs(r, 'Sin correo de contacto.');
  if (!r.clinton || !r.terrorismo || !r.armas) obs(r, 'Verificación BASC incompleta: faltan Lista Clinton u ONU.');
  if (r.acuerdo.toUpperCase() === 'SI' && !r.firma) obs(r, `Acuerdo de seguridad enviado${r.envio ? ` el ${r.envio.slice(0, 10)}` : ''} y todavía sin firmar.`);
  if (!r.pagoErp.forma_pago && r.pago) obs(r, `Forma de pago no reconocida: «${r.pago}». Se guarda como texto.`);
  if (!r.pago) obs(r, 'Sin forma de pago.');
  const pais = sinTildes(r.pais.toUpperCase());
  const dir = sinTildes(r.direccion.toUpperCase());
  //  «MOSCOW ROAD» en Qingdao no es Rusia, ni «China Insurance Building» en Hong Kong es China.
  const esHK = /HONG ?KONG|\bHK\b|KOWLOON|WANCHAI/.test(dir);
  const pistas = {
    'HONG KONG': esHK,
    ESPANA: /ESPANA|SPAIN|VIGO|MADRID|PONTEVEDRA/.test(dir),
    RUSIA: /RUSSIA|PETERSBURG|KALININGRAD/.test(dir),
    CHINA: !esHK && /\bCHINA\b|SHANDONG|QINGDAO|FUJIAN|ZHEJIANG|DALIAN|SHENZHEN|WUHAN|JIANGSU|LIAONING/.test(dir),
  };
  const nombrePais = { 'HONG KONG': 'Hong Kong', ESPANA: 'España', RUSIA: 'Rusia', CHINA: 'China' };
  for (const [p, hay] of Object.entries(pistas)) {
    if (hay && pais !== p && !(pais === 'CHINA' && p === 'HONG KONG')) obs(r, `El país dice «${r.pais}» pero la dirección parece de ${nombrePais[p]}.`);
  }
  if (/USA|UAE|DUBAI/.test(dir) && !/ESTADOS UNIDOS|EMIRATOS/.test(pais)) obs(r, `El país dice «${r.pais}» pero la dirección es de ${/DUBAI|UAE/.test(dir) ? 'Emiratos Árabes' : 'Estados Unidos'}.`);
}
//  Un mismo documento tributario en dos clientes distintos.
const porTax = new Map();
for (const r of filas) if (r.doc.numero) {
  const k = r.doc.numero.replace(/\W/g, '').toUpperCase();
  if (porTax.has(k)) obs(r, `Mismo documento tributario (${r.doc.numero}) que ${porTax.get(k).cliente}.`);
  else porTax.set(k, r);
}

const coinciden = filas.filter((r) => r.erp);
const nuevos = filas.filter((r) => !r.erp && !r.omitir);
const omitidos = filas.filter((r) => r.omitir);
const sinLista = erp.filter((c) => !filas.some((r) => r.erp?.id === c.id));
console.log(`Lista de Comex: ${filas.length} clientes`);
console.log(`  · ya están en el ERP:   ${coinciden.length}`);
console.log(`  · nuevos:               ${nuevos.length}`);
console.log(`  · sin tocar hasta que Comex confirme: ${omitidos.length} (nombre repetido o parecido en el ERP)`);
console.log(`  · en el ERP, no en la lista: ${sinLista.length}`);
console.log(`  · observaciones de calidad: ${observaciones.length}`);

/* ==========================================================================
   EL EXCEL DE CONCILIACIÓN (fuera del repositorio)
   ========================================================================== */
const salida = join(dirname(ruta), `Conciliación clientes Comex vs ERP - ${basename(ruta).replace(/\.xlsx$/i, '')}.xlsx`);
{
  const lb = new ExcelJS.Workbook();
  const hojaDe = (nombre, columnas, datos) => {
    const h = lb.addWorksheet(nombre);
    h.columns = columnas.map(([header, key, width]) => ({ header, key, width }));
    h.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    h.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF304F8C' } };
    datos.forEach((d) => h.addRow(d));
    h.views = [{ state: 'frozen', ySplit: 1 }];
  };
  hojaDe('Resumen', [['Qué', 'q', 46], ['Cuántos', 'n', 12]], [
    { q: 'Clientes en la lista de Comex', n: filas.length },
    { q: 'Ya existen en el ERP (se actualizan)', n: coinciden.length },
    { q: 'Nuevos (se dan de alta)', n: nuevos.length },
    { q: 'Sin tocar hasta que Comex confirme (nombre repetido o parecido en el ERP)', n: omitidos.length },
    { q: 'En el ERP y no en la lista (no se tocan)', n: sinLista.length },
    { q: 'Observaciones de calidad para Comex', n: observaciones.length },
  ]);
  hojaDe('Se actualizan', [['N°', 'n', 6], ['Cliente (Comex)', 'cliente', 46], ['Código ERP', 'codigo', 12], ['Nombre en el ERP', 'nombreErp', 46], ['Cómo se unió', 'union', 18], ['País ERP → Comex', 'pais', 26], ['Documento', 'doc', 30], ['Forma de pago', 'pago', 44]],
    coinciden.map((r) => ({ n: r.n, cliente: r.cliente, codigo: r.erp.codigo, nombreErp: r.erp.razon_social, union: r.unidoPor ?? 'mismo nombre', pais: `${r.erp.pais ?? '—'} → ${r.pais}`, doc: [r.doc.etiqueta, r.doc.numero].filter(Boolean).join(': '), pago: r.pago })));
  hojaDe('Nuevos', [['N°', 'n', 6], ['Cliente (Comex)', 'cliente', 46], ['País', 'pais', 14], ['Forma de pago', 'pago', 44]],
    nuevos.map((r) => ({ n: r.n, cliente: r.cliente, pais: r.pais, pago: r.pago })));
  hojaDe('Por confirmar', [['N°', 'n', 6], ['Cliente (Comex)', 'cliente', 46], ['¿Es el mismo que…? (ERP)', 'posible', 80], ['Escriba aquí el código ERP correcto', 'confirmado', 30]],
    omitidos.map((r) => ({ n: r.n, cliente: r.cliente, posible: (r.posibles ?? dudososErp.find((v) => clave(v[0].razon_social) === clave(r.cliente)) ?? []).map((c) => `${c.codigo} · ${c.razon_social}`).join('  /  ') })));
  hojaDe('En el ERP, no en la lista', [['Código', 'codigo', 12], ['Cliente', 'razon_social', 50], ['País', 'pais', 16]], sinLista);
  hojaDe('Observaciones', [['N°', 'n', 6], ['Cliente', 'cliente', 46], ['Observación', 'observacion', 90]], observaciones);
  await lb.xlsx.writeFile(salida);
  console.log(`\nConciliación: ${salida}`);
}

if (modo === 'revisar') {
  console.log('\nNo se escribió nada. Para cargar: --aplicar (o --probar para aplicar y deshacer).');
  process.exit(0);
}

/* ==========================================================================
   CARGAR (en una transacción)
   ========================================================================== */
const q = (v) => (v === null || v === undefined || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const num = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? 'null' : Number(v));
const [{ max: ultimoCodigo }] = await consultar(`select coalesce(max(substring(codigo from 'CLI-(\\d+)')::int), 0) as max from clientes`);
let siguiente = Number(ultimoCodigo);
const FUENTE = 'Comex · BASC.F.15.01 · Verificación 2026';

const sentencias = ['begin;'];
for (const r of filas) {
  if (r.omitir) continue;
  const datos = {
    razon_social: r.cliente, pais: r.pais, continente: r.continente, direccion: r.direccion,
    ruc_tax_id: r.doc.numero, etiqueta_tax_id: r.doc.etiqueta, contacto: r.contacto, email: r.email, telefono: r.telefono,
    web: r.web, condicion: r.condicion, forma_pago_habitual: r.pago, forma_pago: r.pagoErp.forma_pago,
    adelanto_pct: r.pagoErp.adelanto_pct, referencias_comerciales: r.referencias, productos_interes: r.productos,
  };
  const set = Object.entries(datos).map(([k, v]) => `${k} = ${k === 'adelanto_pct' ? num(v) : q(v)}`).join(', ');
  const idSql = r.erp ? String(r.erp.id) : `(select id from clientes where codigo = ${q(`CLI-${String(siguiente + 1).padStart(4, '0')}`)})`;
  if (r.erp) {
    sentencias.push(`update clientes set ${set}, tipo = ${q(r.tipo)}${r.pagoErp.dias ? `, dias_credito = ${r.pagoErp.dias}` : ''} where id = ${r.erp.id};`);
  } else {
    siguiente += 1;
    const codigo = `CLI-${String(siguiente).padStart(4, '0')}`;
    const cols = ['codigo', 'tipo', 'moneda', ...Object.keys(datos)];
    const vals = [q(codigo), q(r.tipo), q(r.pais === 'Perú' ? 'PEN' : 'USD'), ...Object.entries(datos).map(([k, v]) => (k === 'adelanto_pct' ? num(v) : q(v)))];
    sentencias.push(`insert into clientes (${cols.join(', ')}${r.pagoErp.dias ? ', dias_credito' : ''}) values (${vals.join(', ')}${r.pagoErp.dias ? `, ${r.pagoErp.dias}` : ''});`);
  }
  //  El contacto de la lista, como principal (si no existe ya con ese nombre).
  if (r.contacto) {
    sentencias.push(`update contactos set principal = false where cliente_id = ${idSql} and lower(nombre) <> lower(${q(r.contacto)});`);
    sentencias.push(`insert into contactos (cliente_id, nombre, cargo, telefono, email, principal, observaciones)
      select ${idSql}, ${q(r.contacto)}, ${q(r.cargo)}, ${q(r.telefono)}, ${q(r.email)}, true, ${q(FUENTE)}
       where not exists (select 1 from contactos where cliente_id = ${idSql} and lower(nombre) = lower(${q(r.contacto)}));`);
    sentencias.push(`update contactos set principal = true, cargo = coalesce(${q(r.cargo)}, cargo), telefono = coalesce(${q(r.telefono)}, telefono), email = coalesce(${q(r.email)}, email)
       where cliente_id = ${idSql} and lower(nombre) = lower(${q(r.contacto)});`);
  }
  //  Las verificaciones BASC, cada una con su fecha.
  const verif = [
    ['lista_clinton', r.clinton, fecha(r.clintonFecha), null, null],
    ['onu_terrorismo', r.terrorismo, fecha(r.terrorismoFecha), null, null],
    ['onu_armas', r.armas, fecha(r.armasFecha), null, null],
    ['acuerdo_seguridad', r.acuerdo, fecha(r.envio), fecha(r.envio), fecha(r.firma)],
  ];
  for (const [control, res, f, env, fir] of verif) {
    if (!res) continue;
    sentencias.push(`insert into cliente_verificaciones (cliente_id, control, resultado, fecha, enviado_el, firmado_el, responsable, fuente)
      values (${idSql}, ${q(control)}, ${q(res)}, ${q(f)}, ${q(env)}, ${q(fir)}, ${q(r.persona)}, ${q(FUENTE)})
      on conflict (cliente_id, control, fecha) do update set resultado = excluded.resultado, enviado_el = excluded.enviado_el,
        firmado_el = excluded.firmado_el, responsable = excluded.responsable, fuente = excluded.fuente;`);
  }
}
const comprobar = `select (select count(*) from clientes)::int clientes,
  (select count(*) from cliente_verificaciones where fuente = ${q(FUENTE)})::int verificaciones,
  (select count(*) from v_cliente_basc where al_dia)::int al_dia;`;
sentencias.push(comprobar);
sentencias.push(modo === 'aplicar' ? 'commit;' : 'rollback;');

const r = await ejecutarSQL(sentencias.join('\n'));
const resumen = Array.isArray(r) ? r : [];
console.log(`\n${modo === 'aplicar' ? 'CARGADO' : 'PRUEBA (se deshizo todo)'}: ${JSON.stringify(resumen.at?.(-1) ?? resumen)}`);
const [despues] = await consultar(`select count(*)::int clientes, (select count(*) from cliente_verificaciones)::int verificaciones from clientes`);
console.log(`En la base ahora: ${despues.clientes} clientes · ${despues.verificaciones} verificaciones`);
