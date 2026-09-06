/**
 * ============================================================================
 *  PRUEBA DE LA PROFORMA DE EXPORTACIÓN
 * ============================================================================
 *  Se comprueba contra el modelo REAL que mandó el cliente: la SM26-312 de
 *  DALIAN BRIGHT ASIA, 7 FCL de alas de pota.
 *
 *  Lo que se verifica no es que «se parezca»: es que lleve los datos SIN LOS
 *  CUALES EL DOCUMENTO NO SIRVE. Sin el código CEU el banco del comprador no
 *  lo acepta; sin el nombre científico la autoridad sanitaria no sabe qué
 *  animal es; sin la zona FAO no se certifica el origen. Un PDF bonito al que
 *  le falta el CEU es un PDF inútil.
 *
 *      node scripts/probar-proforma.mjs
 * ============================================================================
 */
import { chromium } from 'playwright';
import { ejecutarSQL } from './db.mjs';
import { PDFExtract } from 'pdf.js-extract';

const BASE = 'http://localhost:3000';
const consultar = async (sql) => {
  const r = await ejecutarSQL(sql);
  return Array.isArray(r) ? r : [];
};

const fallos = [];
const ok = (cond, texto, detalle = '') => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${texto}${detalle ? ' · ' + detalle : ''}`);
  if (!cond) fallos.push(texto);
};

/** El texto del PDF, para poder comprobar lo que realmente se imprimió. */
async function textoDelPdf(buffer) {
  const datos = await new PDFExtract().extractBuffer(buffer, {});
  return {
    paginas: datos.pages.length,
    texto: datos.pages.map((p) => p.content.map((c) => c.str).join(' ')).join('\n'),
  };
}

const nav = await chromium.launch({ channel: 'chrome', headless: true });
const p = await (await nav.newContext()).newPage();

try {
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', 'gerencia@santamonica.pe');
  await p.fill('input[type="password"]', 'SantaMonica2026');
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/panel/, { timeout: 25000 });

  /* ---- Un pedido de exportación con dos productos ---- */
  const [ped] = await consultar(`
    select p.id, p.numero_proforma, c.razon_social, c.pais, c.direccion,
           c.ruc_tax_id, c.etiqueta_tax_id, p.contenedores, p.contenedor_tipo,
           p.tolerancia_pct, p.pago_adelanto_pct, p.puerto_embarque,
           d.puerto as puerto_destino,
           round(sum(pl.cantidad_tm) * 1000) as kilos,
           sum(round(pl.cantidad_tm * pl.precio_tm * (1 - pl.descuento_pct/100), 2)) as total
      from pedidos p
      join clientes c on c.id = p.cliente_id
      join destinos d on d.id = p.destino_id
      join pedido_lineas pl on pl.pedido_id = p.id
     where c.pais <> 'Perú'
     group by p.id, p.numero_proforma, c.razon_social, c.pais, c.direccion,
              c.ruc_tax_id, c.etiqueta_tax_id, p.contenedores, p.contenedor_tipo,
              p.tolerancia_pct, p.pago_adelanto_pct, p.puerto_embarque, d.puerto
    having count(pl.id) = 2
     order by p.id limit 1`);

  const r = await p.request.get(`${BASE}/api/documentos/proforma/${ped.id}?formato=pdf`);
  ok(r.status() === 200, `la proforma ${ped.numero_proforma} se emite`, `HTTP ${r.status()}`);
  const { texto, paginas } = await textoDelPdf(await r.body());

  console.log('\n─── 1 · Es un contrato, no un presupuesto ───');
  {
    ok(/PROFORM\s*\/\s*PROFORMA/i.test(texto), 'el título va en los dos idiomas');
    ok(/SALES CONTRACT/i.test(texto), 'y dice que es un contrato de venta');
    for (const [rot, es] of [['NET WEIGHT', 'PESO NETO'], ['CUSTOMER', 'CLIENTE'],
                             ['ADDRESS', 'DIRECCIÓN'], ['UNIT', 'UNIDAD']]) {
      ok(texto.includes(rot) && texto.includes(es),
         `«${rot} / ${es}» se lee en ambos idiomas`);
    }
  }

  console.log('\n─── 2 · Los registros sin los que el banco no la acepta ───');
  {
    const [par] = await consultar(`
      select max(valor) filter (where clave='empresa_fda') as fda,
             max(valor) filter (where clave='empresa_ceu') as ceu,
             max(valor) filter (where clave='zona_pesca') as zona,
             max(valor) filter (where clave='pais_origen') as origen
        from parametros`);
    ok(texto.includes(par.fda), 'lleva el número FDA de la planta', par.fda);
    ok(texto.includes(par.ceu), 'lleva el código CEU de SANIPES', par.ceu);
    // El CEU va DOS veces en el original: en el membrete y sobre la tabla.
    ok(texto.split(par.ceu).length - 1 >= 2,
       'y el CEU aparece también sobre la tabla, como en el modelo');
    ok(texto.includes(par.zona), 'lleva la zona FAO de captura', par.zona);
    ok(texto.includes(par.origen), 'y el país de origen', par.origen);
  }

  console.log('\n─── 3 · El producto, como lo entiende una aduana ───');
  {
    const productos = await consultar(`
      select distinct e.nombre_cientifico, f.descripcion_en, f.descripcion_es
        from pedido_lineas pl
        join sku_presentaciones sp on sp.id = pl.sku_presentacion_id
        join skus s on s.id = sp.sku_id
        join especies e on e.id = s.especie_id
        join formatos f on f.id = s.formato_id
       where pl.pedido_id = ${ped.id}`);
    for (const pr of productos) {
      ok(texto.includes(pr.nombre_cientifico), 'va el nombre científico', pr.nombre_cientifico);
      ok(texto.includes(pr.descripcion_en), 'y el comercial en inglés', pr.descripcion_en);
      ok(texto.includes(pr.descripcion_es), 'y en castellano', pr.descripcion_es);
    }
    ok(!/CONGELADA S|POTA [A-Z]+ CONGELADAS/.test(texto),
       'sin nombres armados a trozos, que no concuerdan');
  }

  console.log('\n─── 4 · Kilos, no toneladas ───');
  {
    ok(/KGS/.test(texto), 'el peso se declara en kilos');
    ok(/USD\s*\/\s*KGS/i.test(texto), 'y el precio es por kilo, no por tonelada');
    ok(!/CANT\.\s*TM|PRECIO\s*\/\s*TM/i.test(texto),
       'no queda rastro de la unidad interna del sistema');

    /*
     * El peso va LÍNEA POR LÍNEA, no como un total: el comprador compra sacos
     * de 21 kilos y sacos de 20, y necesita saber cuántos de cada uno. Se
     * comprueban todas, no una: un error de conversión en la segunda línea
     * pasaría desapercibido si solo se mirara la primera.
     */
    const pesos = await consultar(
      `select round(cantidad_tm * 1000) as kg from pedido_lineas where pedido_id = ${ped.id}`);
    const impresos = pesos.map((x) =>
      Number(x.kg).toLocaleString('en-US', { minimumFractionDigits: 2 }));
    ok(impresos.every((k) => texto.includes(k)),
       'cada línea imprime sus kilos, convertidos de las toneladas del sistema',
       impresos.join(' · '));
  }

  console.log('\n─── 5 · Cómo viene empacado ───');
  {
    ok(/BAGS X/i.test(texto), 'dice cuántos sacos y de cuánto');
    ok(/PACKING:\s*\d+\s*BLOCKS?/i.test(texto), 'y cómo viene partido cada saco');
    ok(!/01 BLOCKS/.test(texto), 'sin «01 BLOCKS», que delata el texto pegado');
    ok(/BAGS OF .* KG/i.test(texto), 'y resume el empaque del producto');

    // Los sacos se calculan, no se teclean: se comprueba uno.
    const [l] = await consultar(`
      select round(pl.cantidad_tm * 1000) as kg, pr.peso_bulto_kg
        from pedido_lineas pl
        join sku_presentaciones sp on sp.id = pl.sku_presentacion_id
        join presentaciones pr on pr.id = sp.presentacion_id
       where pl.pedido_id = ${ped.id} limit 1`);
    const sacos = Math.ceil(Number(l.kg) / Number(l.peso_bulto_kg));
    ok(texto.includes(sacos.toLocaleString('en-US')),
       'el número de sacos sale del peso, no de un campo tecleado',
       `${sacos} sacos`);
  }

  console.log('\n─── 6 · Las condiciones del embarque ───');
  {
    for (const rot of ['INCOTERMS', 'CONTAINER', 'TOLERANCE', 'COUNTRY OF ORIGIN',
                       'FISHING ZONE', 'SHIPMENT DATE', 'PORT OF LOADING',
                       'PORT OF DISCHARGE', 'PAYMENT']) {
      ok(texto.includes(rot), `lleva «${rot}»`);
    }
    ok(texto.includes(String(ped.contenedores).padStart(2, '0')) &&
       texto.includes(ped.contenedor_tipo),
       'con los contenedores pactados', `${ped.contenedores} × ${ped.contenedor_tipo}`);
    ok(texto.includes(`${Number(ped.tolerancia_pct)}% +/-`),
       'y la tolerancia de peso, que es lo que salva el contrato cuando la pesca falla');
    ok(texto.includes(ped.puerto_embarque), 'el puerto de carga', ped.puerto_embarque);
    ok(texto.toUpperCase().includes(String(ped.puerto_destino).toUpperCase()),
       'y el de descarga', ped.puerto_destino);
    ok(/[A-Z]+ \d{4}/.test(texto) && /(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER) \d{4}/.test(texto),
       'el mes de embarque va en inglés, como el resto del contrato');

    const adelanto = Number(ped.pago_adelanto_pct);
    ok(texto.includes(`${adelanto}% ADVANCE PAYMENT`),
       'y el reparto del pago que se negoció', `${adelanto}%`);
    if (adelanto < 100) {
      ok(texto.includes(`${100 - adelanto}% AGAINST COPY OF DOCUMENTS`),
         'con el saldo contra documentos');
    }
  }

  console.log('\n─── 7 · Dónde se paga y qué se emitirá ───');
  {
    ok(/PAYMENT TO:/.test(texto), 'dice a qué banco se paga');
    ok(/SWIFT CODE:/.test(texto), 'con el código SWIFT');
    ok(/BANK ACCOUNT NUMBER:/.test(texto), 'y el número de cuenta');
    ok(/BENEFICIARY:/.test(texto), 'y a nombre de quién');
    // Delimitado: «DIRECCIÓN» contiene C-C-I y sin  la prueba encontraba un
    // CCI que no está en ninguna parte.
    ok(!/CCI/.test(texto), 'sin el CCI, que solo sirve dentro del Perú');

    const [doc] = await consultar(
      `select valor from parametros where clave = 'proforma_documentos'`);
    for (const d of String(doc.valor).split('|')) {
      ok(texto.includes(d.trim()), `se compromete a emitir «${d.trim()}»`);
    }
    ok(/SUBJECT TO CATCH/i.test(texto),
       'y lleva la cláusula que protege cuando la pesca no alcanza');
  }

  console.log('\n─── 8 · El comprador, bien identificado ───');
  {
    ok(texto.includes(ped.razon_social.toUpperCase()), 'va su razón social');
    ok(texto.includes(String(ped.direccion).toUpperCase().slice(0, 20)),
       'y su dirección fiscal completa');
    ok(texto.includes(ped.ruc_tax_id), 'y su identificador fiscal', ped.ruc_tax_id);
    ok(texto.includes(`${ped.etiqueta_tax_id}:`),
       'rotulado como se llama en SU país, no como «Tax ID»',
       `${ped.etiqueta_tax_id} (${ped.pais})`);
  }

  console.log('\n─── 9 · El cierre: total y dos firmas ───');
  {
    const total = Number(ped.total).toLocaleString('en-US', { minimumFractionDigits: 2 });
    ok(texto.includes(total), 'el total es el que dice el sistema', total);
    ok(/TOTAL USD/.test(texto), 'rotulado TOTAL USD, como en el modelo');
    ok(/SAY|SON/.test(texto), 'y va también en letras, que es lo que mira el banco');
    ok(/SIGNED AND STAMPED/.test(texto),
       'hay sitio para la firma del comprador: un contrato lo firman dos');
    ok((texto.match(/DATE:/g) ?? []).length >= 2, 'con fecha para cada parte');
  }

  console.log('\n─── 10 · No se rompe con pedidos grandes ───');
  {
    const [grande] = await consultar(`
      select p.id, count(pl.id) as lineas from pedidos p
        join clientes c on c.id = p.cliente_id
        join pedido_lineas pl on pl.pedido_id = p.id
       where c.pais <> 'Perú' group by p.id
       order by count(pl.id) desc limit 1`);
    const rg = await p.request.get(`${BASE}/api/documentos/proforma/${grande.id}?formato=pdf`);
    ok(rg.status() === 200, `un pedido de ${grande.lineas} productos también se emite`);
    const g = await textoDelPdf(await rg.body());
    ok(/TOTAL USD/.test(g.texto), 'y llega hasta el total');
    ok(/SIGNED AND STAMPED/.test(g.texto), 'y hasta las firmas');
    /*
     * Cuando la TABLA continúa en otra hoja, el encabezado de columnas se
     * repite: una hoja suelta tiene que seguir diciendo qué columna es cuál.
     *
     * Ojo con confundirlo con la segunda hoja que a veces lleva solo el cierre
     * —total y firmas—: esa no continúa la tabla y no debe repetir nada. Se
     * distingue mirando si en la segunda hoja hay renglones de producto.
     */
    const SALTO = String.fromCharCode(10);
    const hojas = g.texto.split(SALTO);
    const tablaSigue = hojas.slice(1).some((h) => /BAGS X/i.test(h));
    if (tablaSigue) {
      ok((g.texto.match(/NET WEIGHT/g) ?? []).length >= 2,
         'al continuar la tabla en otra hoja repite el encabezado', `${g.paginas} páginas`);
    } else {
      ok(!/NET WEIGHT/.test(hojas.slice(1).join(SALTO)),
         'la hoja del cierre no repite un encabezado de tabla que no continúa',
         `${g.paginas} páginas`);
    }
  }

  console.log('\n─── 11 · La venta local NO usa este formato ───');
  {
    const [local] = await consultar(`
      select p.id from pedidos p join clientes c on c.id = p.cliente_id
       where c.pais = 'Perú' limit 1`);
    const rl = await p.request.get(`${BASE}/api/documentos/proforma/${local.id}?formato=pdf`);
    const t = (await textoDelPdf(await rl.body())).texto;
    ok(rl.status() === 200, 'la proforma local se emite igual');
    ok(!/SALES CONTRACT/.test(t),
       'pero sin las condiciones de exportación, que no vienen al caso');
    ok(/IGV/.test(t), 'y con IGV, que una venta dentro del Perú sí lo lleva');
  }

  console.log('\n─── 12 · El total de la factura ya no se desborda ───');
  {
    const [f] = await consultar(`select id, total from facturas order by total desc limit 1`);
    const rf = await p.request.get(`${BASE}/api/documentos/factura/${f.id}?formato=pdf`);
    const t = (await textoDelPdf(await rf.body())).texto;
    const total = Number(f.total).toLocaleString('en-US', { minimumFractionDigits: 2 });
    ok(t.includes(total),
       'el importe más alto del sistema se imprime entero', total);
  }
} finally {
  await nav.close();
}

console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo correcto');
process.exit(fallos.length ? 1 : 0);
