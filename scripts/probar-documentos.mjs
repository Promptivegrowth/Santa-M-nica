#!/usr/bin/env node
/**
 * ============================================================================
 *  PRUEBA DE DOCUMENTOS · cotización, proforma, factura y boleta
 * ============================================================================
 *  No basta con que la descarga responda 200. Un PDF corrupto también responde
 *  200. Aquí se descarga cada documento en los dos formatos y se comprueba:
 *
 *   · que el archivo sea de verdad lo que dice ser (cabecera del formato)
 *   · que ABRA: el Excel se vuelve a leer con ExcelJS y se recorre
 *   · que lleve la marca: logotipo y colores de la empresa
 *   · que las cifras del archivo coincidan con las de la BASE DE DATOS
 *   · que un rol sin permiso reciba 403 y no un archivo
 *   · que un documento inexistente reciba 404
 *
 *  La comprobación de las cifras es la que importa. Todo lo demás es forma;
 *  esa es la que evita mandarle al cliente un total que no es el suyo.
 * ============================================================================
 */
import { createClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import './db.mjs';

const BASE = process.env.URL_PRUEBA ?? 'http://localhost:3000';
const REF = process.env.SUPABASE_PROJECT_REF;
const SALIDA = 'documentos-prueba';

let ok = 0;
let fallo = 0;
const errores = [];

function comprobar(nombre, condicion, detalle = '') {
  if (condicion) {
    ok++;
    console.log(`   OK  ${nombre}`);
  } else {
    fallo++;
    errores.push(`${nombre}${detalle ? ' — ' + detalle : ''}`);
    console.log(`   ..  ${nombre}${detalle ? '  (' + detalle + ')' : ''}`);
  }
}

function titulo(t) {
  console.log(`\n-- ${t} ${'-'.repeat(Math.max(0, 60 - t.length))}`);
}

async function cookieDe(rol) {
  const cli = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } }
  );
  const { data, error } = await cli.auth.signInWithPassword({
    email: `${rol}@santamonica.pe`,
    password: 'SantaMonica2026',
  });
  if (error) throw new Error(`${rol}: ${error.message}`);
  return `sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(data.session)).toString('base64')}`;
}

/** Redondeo a céntimos, igual que el que hace el generador. */
const cent = (n) => Math.round(Number(n) * 100) / 100;

async function principal() {
  console.log('================================================================');
  console.log('  PRUEBA DE DOCUMENTOS COMERCIALES');
  console.log('================================================================');

  fs.mkdirSync(SALIDA, { recursive: true });

  const cookie = await cookieDe('gerencia');
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  /* ---- Se elige un registro real de cada tipo ---- */
  const [{ data: cot }, { data: ped }, { data: fac }, { data: bol }] = await Promise.all([
    admin.from('cotizaciones').select('id, numero').limit(1).single(),
    admin.from('pedidos').select('id, numero_proforma').limit(1).single(),
    admin.from('facturas').select('id, numero, subtotal, igv, total, moneda')
      .eq('tipo_comprobante', 'factura').eq('estado', 'emitida').limit(1).single(),
    admin.from('facturas').select('id, numero, subtotal, igv, total, moneda')
      .eq('tipo_comprobante', 'boleta').limit(1).single(),
  ]);

  const CASOS = [
    { tipo: 'cotizacion', id: cot?.id, numero: cot?.numero, guardado: null },
    { tipo: 'proforma', id: ped?.id, numero: ped?.numero_proforma, guardado: null },
    { tipo: 'factura', id: fac?.id, numero: fac?.numero, guardado: fac },
    { tipo: 'boleta', id: bol?.id, numero: bol?.numero, guardado: bol },
  ];

  /* ══════════════════════════════════════════════════════════════════════
     PDF
     ══════════════════════════════════════════════════════════════════════ */
  titulo('Descarga en PDF');

  for (const c of CASOS) {
    if (!c.id) {
      comprobar(`Hay un/a ${c.tipo} en los datos de prueba`, false);
      continue;
    }

    const r = await fetch(`${BASE}/api/documentos/${c.tipo}/${c.id}?formato=pdf`, {
      headers: { cookie },
    });

    if (!r.ok) {
      const cuerpo = await r.json().catch(() => ({}));
      comprobar(`${c.tipo} ${c.numero} se descarga en PDF`, false,
        `HTTP ${r.status} · ${cuerpo.error ?? ''} ${(cuerpo.detalles ?? []).join(' | ')}`);
      continue;
    }

    const bytes = Buffer.from(await r.arrayBuffer());
    const archivo = path.join(SALIDA, `${c.tipo}-${c.id}.pdf`);
    fs.writeFileSync(archivo, bytes);

    const texto = bytes.toString('latin1');
    comprobar(`${c.tipo} ${c.numero} se descarga en PDF`,
      bytes.subarray(0, 5).toString() === '%PDF-' && bytes.length > 3000,
      `${(bytes.length / 1024).toFixed(1)} kB`);

    comprobar(`  · el PDF de ${c.tipo} se cierra correctamente`,
      texto.includes('%%EOF'), 'sin marca de fin de archivo');

    /*
     * El contenido del PDF va comprimido, asi que buscar el numero como texto
     * plano no prueba nada. Lo que si se puede comprobar sin descomprimir es
     * la estructura: que declare paginas y que traiga los objetos de fuente e
     * imagen que el diseno necesita.
     */
    const paginas = (texto.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    comprobar(`  · el PDF de ${c.tipo} tiene al menos una pagina`, paginas >= 1,
      `${paginas} paginas declaradas`);
    comprobar(`  · trae las fuentes y el logotipo incrustados`,
      texto.includes('/Font') && texto.includes('/Image'),
      `fuentes=${texto.includes('/Font')} imagen=${texto.includes('/Image')}`);

    comprobar(`  · trae el nombre de archivo correcto`,
      (r.headers.get('content-disposition') ?? '').includes('.pdf'),
      r.headers.get('content-disposition') ?? '');

    comprobar(`  · no se cachea`,
      (r.headers.get('cache-control') ?? '').includes('no-store'));
  }

  /* ══════════════════════════════════════════════════════════════════════
     EXCEL · aquí sí se puede mirar dentro
     ══════════════════════════════════════════════════════════════════════ */
  titulo('Descarga en Excel y verificación de las cifras');

  for (const c of CASOS) {
    if (!c.id) continue;

    const r = await fetch(`${BASE}/api/documentos/${c.tipo}/${c.id}?formato=excel`, {
      headers: { cookie },
    });

    if (!r.ok) {
      const cuerpo = await r.json().catch(() => ({}));
      comprobar(`${c.tipo} ${c.numero} se descarga en Excel`, false,
        `HTTP ${r.status} · ${cuerpo.error ?? ''}`);
      continue;
    }

    const bytes = Buffer.from(await r.arrayBuffer());
    const archivo = path.join(SALIDA, `${c.tipo}-${c.id}.xlsx`);
    fs.writeFileSync(archivo, bytes);

    comprobar(`${c.tipo} ${c.numero} se descarga en Excel`,
      bytes.subarray(0, 2).toString() === 'PK' && bytes.length > 5000,
      `${(bytes.length / 1024).toFixed(1)} kB`);

    /* ---- Se vuelve a abrir con ExcelJS: si no abre, no sirve ---- */
    const libro = new ExcelJS.Workbook();
    let abre = true;
    try {
      await libro.xlsx.readFile(archivo);
    } catch (e) {
      abre = false;
      comprobar(`  · el Excel de ${c.tipo} abre`, false, e.message);
    }
    if (!abre) continue;

    const hoja = libro.worksheets[0];
    comprobar(`  · el Excel de ${c.tipo} abre y tiene contenido`,
      !!hoja && hoja.rowCount > 10, `${hoja?.rowCount ?? 0} filas`);

    comprobar(`  · lleva el logotipo de la empresa`,
      libro.model.media?.length > 0, `${libro.model.media?.length ?? 0} imágenes`);

    /* ---- Se recorre buscando el número y el total ---- */
    let textoHoja = '';
    let totalHallado = null;
    hoja.eachRow((fila) => {
      fila.eachCell((celda) => {
        const v = celda.value;
        if (typeof v === 'string') textoHoja += v + '\n';
        if (typeof v === 'number' && celda.numFmt?.includes('#,##0.00')) {
          // El total es el último importe destacado de la hoja
          totalHallado = v;
        }
      });
    });

    comprobar(`  · el Excel muestra el número ${c.numero}`,
      textoHoja.includes(String(c.numero)));
    comprobar(`  · el Excel identifica al emisor por su RUC`,
      textoHoja.includes('20205572229'), 'no aparece el RUC de Santa Mónica');
    comprobar(`  · el Excel trae el importe en letras`,
      /CON \d{2}\/100/.test(textoHoja), 'falta la línea «SON …»');

    /* ---- Y LO IMPORTANTE: que las cifras coincidan con la base ---- */
    if (c.guardado) {
      const esperado = cent(c.guardado.total);
      const enHoja = totalHallado === null ? null : cent(totalHallado);
      comprobar(
        `  · el total del archivo coincide con el de la base (${esperado})`,
        enHoja !== null && Math.abs(enHoja - esperado) < 0.02,
        `archivo ${enHoja} · base ${esperado}`
      );
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     LA VERIFICACIÓN, CONTRASTADA CONTRA LA BASE
     ══════════════════════════════════════════════════════════════════════ */
  titulo('La verificación compara con lo guardado');

  /*
   * Se corrompe A PROPÓSITO el total de una factura, se comprueba que la
   * descarga se niega explicando por qué, y se deja como estaba. Es la única
   * forma de saber que la verificación sirve para algo: si no se prueba
   * rompiendo algo, no se ha probado.
   */
  const { data: cobaya } = await admin
    .from('facturas')
    .select('id, numero, total')
    .eq('estado', 'emitida')
    .limit(1)
    .single();

  if (cobaya) {
    const totalOriginal = cobaya.total;
    await admin.from('facturas').update({ total: Number(totalOriginal) + 1000 }).eq('id', cobaya.id);

    const r = await fetch(`${BASE}/api/documentos/factura/${cobaya.id}?formato=pdf`, {
      headers: { cookie },
    });
    const cuerpo = await r.json().catch(() => ({}));

    comprobar('Una factura descuadrada NO se puede descargar',
      r.status === 422, `HTTP ${r.status}`);
    comprobar('  · y se explica exactamente qué no cuadra',
      Array.isArray(cuerpo.detalles) && cuerpo.detalles.some((d) => d.includes('total')),
      (cuerpo.detalles ?? []).join(' | ').slice(0, 120));

    // Se deja como estaba
    await admin.from('facturas').update({ total: totalOriginal }).eq('id', cobaya.id);

    const r2 = await fetch(`${BASE}/api/documentos/factura/${cobaya.id}?formato=pdf`, {
      headers: { cookie },
    });
    comprobar('  · y al restaurar el dato vuelve a emitirse', r2.ok, `HTTP ${r2.status}`);
  }

  /* ══════════════════════════════════════════════════════════════════════
     PERMISOS Y ERRORES
     ══════════════════════════════════════════════════════════════════════ */
  titulo('Permisos y casos límite');

  const cookieAlmacen = await cookieDe('almacen');
  const rAlmacen = await fetch(`${BASE}/api/documentos/factura/${fac?.id}?formato=pdf`, {
    headers: { cookie: cookieAlmacen },
  });
  comprobar('Almacén NO puede descargar comprobantes con precios',
    rAlmacen.status === 403, `HTTP ${rAlmacen.status}`);

  const cookieComex = await cookieDe('comex');
  const rComex = await fetch(`${BASE}/api/documentos/proforma/${ped?.id}?formato=pdf`, {
    headers: { cookie: cookieComex },
  });
  comprobar('Comex SÍ puede descargar la proforma para la aduana',
    rComex.ok, `HTTP ${rComex.status}`);

  const rSinSesion = await fetch(`${BASE}/api/documentos/factura/${fac?.id}?formato=pdf`, {
    redirect: 'manual',
  });
  comprobar('Sin sesión no se descarga nada',
    rSinSesion.status === 401 || rSinSesion.status === 302 || rSinSesion.status === 307,
    `HTTP ${rSinSesion.status}`);

  const rInexistente = await fetch(`${BASE}/api/documentos/factura/99999999?formato=pdf`, {
    headers: { cookie },
  });
  comprobar('Un documento inexistente devuelve 404', rInexistente.status === 404,
    `HTTP ${rInexistente.status}`);

  const rTipoMalo = await fetch(`${BASE}/api/documentos/recibo/1?formato=pdf`, {
    headers: { cookie },
  });
  comprobar('Un tipo de documento inventado devuelve 400', rTipoMalo.status === 400,
    `HTTP ${rTipoMalo.status}`);

  console.log('\n================================================================');
  console.log(`  RESULTADO: ${ok} pasaron · ${fallo} fallaron`);
  console.log('================================================================');
  if (errores.length) {
    console.log('\n  Fallaron:');
    errores.forEach((e) => console.log(`   .. ${e}`));
  }
  console.log(`\n  Archivos guardados en ./${SALIDA}/\n`);
  process.exit(fallo > 0 ? 1 : 0);
}

principal().catch((e) => {
  console.error('\nERROR:', e.message);
  process.exit(1);
});
