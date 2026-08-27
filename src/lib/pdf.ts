/**
 * ============================================================================
 *  IMPRESIÓN DE DOCUMENTOS EN PDF
 * ============================================================================
 *  Dibuja en A4 la cotización, la proforma, la factura o la boleta que armó
 *  documentos.ts. Un solo diseño para los cuatro: cambia el título, el color
 *  de la franja y las notas del pie, no la estructura.
 *
 *  POR QUÉ SE DIBUJA Y NO SE CONVIERTE DESDE HTML
 *  Convertir HTML a PDF exige levantar un navegador entero en el servidor:
 *  cientos de megas y medio segundo por documento. Aquí se dibuja directo, y
 *  además da control exacto sobre lo que importa en un comprobante —que los
 *  importes queden alineados a la derecha y que nada se parta entre páginas—.
 *
 *  LO QUE SE CUIDÓ
 *   · Los importes van en una fuente monoespaciada y alineados: una columna de
 *     cifras que no alinea es ilegible, y en un comprobante eso es grave.
 *   · La cabecera se repite en cada página, con «página N de M»: una factura
 *     de cuarenta líneas se imprime y se traspapela.
 *   · Las inconsistencias que encontró la verificación se imprimen DENTRO del
 *     documento. Esconderlas en la pantalla sería justo lo contrario de para
 *     qué sirven.
 * ============================================================================
 */
import PDFDocument from 'pdfkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Documento } from './documentos';
import { importeEnLetras } from './importeEnLetras';

/* --------------------------------------------------------------------------
   La marca. Los mismos valores que usa la aplicación y los reportes Excel.
   -------------------------------------------------------------------------- */
const MARCA = {
  azulProfundo: '#304F8C',
  azulMedio: '#5095BF',
  verdeAzulado: '#53A6A6',
  tinta: '#1F2937',
  tintaSuave: '#6B7280',
  linea: '#D9DFE8',
  grisSuave: '#F3F5F9',
  critico: '#B3261E',
  atencion: '#8A5A00',
  blanco: '#FFFFFF',
};

/* Márgenes y geometría de la hoja */
const MARGEN = 42;
const ANCHO_A4 = 595.28;
const ALTO_A4 = 841.89;
const ANCHO_UTIL = ANCHO_A4 - MARGEN * 2;

/**
 * Las columnas de la tabla de productos, con su ancho en puntos.
 * Suman el ancho útil exacto: si sumaran de más, la última se saldría.
 */
const COLUMNAS = [
  { titulo: '#', ancho: 18, alineado: 'left' as const },
  { titulo: 'CÓDIGO', ancho: 44, alineado: 'left' as const },
  { titulo: 'DESCRIPCIÓN', ancho: 150, alineado: 'left' as const },
  { titulo: 'PRESENTACIÓN', ancho: 66, alineado: 'left' as const },
  { titulo: 'CANT. TM', ancho: 56, alineado: 'right' as const },
  { titulo: 'PRECIO', ancho: 60, alineado: 'right' as const },
  { titulo: 'DSCTO', ancho: 36, alineado: 'right' as const },
  // La más ancha de las numéricas: un importe de siete cifras con separadores
  // ocupa más que un precio, y si no cabe se parte en dos líneas.
  { titulo: 'IMPORTE', ancho: 81, alineado: 'right' as const },
];

const simboloMoneda = (m: string) => (m === 'PEN' ? 'S/' : 'US$');

/** Cifra con separador de miles y dos decimales. */
function cifra(n: number, decimales = 2): string {
  return n.toLocaleString('es-PE', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
}

/* --------------------------------------------------------------------------
   TEXTO QUE LAS FUENTES DEL PDF SABEN DIBUJAR
   --------------------------------------------------------------------------
   Las catorce fuentes que trae todo lector de PDF -Helvetica, Courier- usan
   la codificacion WinAnsi. Cubre el castellano entero, pero no el resto de
   Unicode: un caracter que no este ahi no se dibuja, sale otro en su lugar.

   Ya paso una vez y se descubrio mirando el PDF, no leyendo el codigo: el
   signo menos matematico salia como una comilla, tanto en el descuento como
   en la nota de "conservar a -18 grados". Como las observaciones las escribe
   el usuario y puede pegar cualquier cosa, se limpia el documento ENTERO de
   una vez antes de dibujarlo, en lugar de ir corrigiendo caso por caso.

   Se compara por codigo de caracter y no con una expresion regular: la lista
   de caracteres raros escapados es justo la clase de cosa que se rompe al
   copiarla de un sitio a otro.
   -------------------------------------------------------------------------- */

/** Lo que se cambia por un equivalente que si se puede dibujar. */
const EQUIVALENTES = new Map<number, string>([
  [0x2212, '-'],    // signo menos matematico
  [0x2192, '->'],   // flecha derecha
  [0x2190, '<-'],   // flecha izquierda
  [0x2248, '~'],    // aproximadamente
  [0x2264, '<='],
  [0x2265, '>='],
  [0x00a0, ' '],    // espacio duro
]);

/**
 * Los caracteres de WinAnsi que en Unicode viven fuera del rango 0x20-0xFF.
 * Son los que ocupan las posiciones 0x80-0x9F de la codificacion: comillas
 * tipograficas, rayas, puntos suspensivos y el simbolo del euro.
 */
const EXTRA_WINANSI = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

/** Deja el texto en caracteres que la fuente pueda dibujar. */
function seguro(texto: string): string {
  let salida = '';
  for (const caracter of texto) {
    const codigo = caracter.codePointAt(0) ?? 0;

    const sustituto = EQUIVALENTES.get(codigo);
    if (sustituto !== undefined) {
      salida += sustituto;
      continue;
    }

    if ((codigo >= 0x20 && codigo <= 0xff) || EXTRA_WINANSI.has(codigo)) {
      salida += caracter;
    }
    // Lo demas se descarta: mejor un hueco que un simbolo equivocado en un
    // comprobante que sale de la empresa.
  }
  return salida;
}

/**
 * Recorre el documento entero limpiando cada texto.
 *
 * Se hace UNA vez al empezar a dibujar y no en cada llamada a `.text()`: asi
 * no hay forma de olvidarse de un campo nuevo.
 */
function limpiarDocumento<T>(valor: T): T {
  if (typeof valor === 'string') return seguro(valor) as unknown as T;
  if (Array.isArray(valor)) return valor.map(limpiarDocumento) as unknown as T;
  if (valor && typeof valor === 'object') {
    const salida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor)) salida[k] = limpiarDocumento(v);
    return salida as T;
  }
  return valor;
}

/* ==========================================================================
   PIEZAS DEL DIBUJO
   ========================================================================== */

type Lienzo = PDFKit.PDFDocument;

/** El logotipo, si está. Si falta, el documento se emite igual. */
function logotipo(doc: Lienzo, x: number, y: number) {
  try {
    const ruta = join(process.cwd(), 'public', 'logo.png');
    doc.image(readFileSync(ruta), x, y, { height: 26 });
    return true;
  } catch {
    return false;
  }
}

/**
 * La cabecera: emisor a la izquierda, recuadro del documento a la derecha.
 * Se repite en todas las páginas para que una hoja suelta siga identificada.
 */
function cabecera(doc: Lienzo, d: Documento) {
  const y = MARGEN;

  /* ---- Franja de color: es lo que hace que se reconozca de lejos ---- */
  doc.rect(0, 0, ANCHO_A4, 6).fill(MARCA.azulProfundo);
  doc.rect(0, 6, ANCHO_A4, 2).fill(MARCA.verdeAzulado);

  const hayLogo = logotipo(doc, MARGEN, y + 6);

  doc.fillColor(MARCA.azulProfundo).font('Helvetica-Bold').fontSize(12)
    .text(d.emisor.razonSocial, MARGEN, y + (hayLogo ? 38 : 6), { width: 300 });

  doc.fillColor(MARCA.tintaSuave).font('Helvetica').fontSize(8)
    .text(`RUC ${d.emisor.ruc}`, MARGEN, doc.y + 1, { width: 300 })
    .text(d.emisor.direccion, { width: 300 });

  /* ---- Recuadro del documento ---- */
  const anchoCaja = 190;
  const xCaja = ANCHO_A4 - MARGEN - anchoCaja;
  const altoCaja = 62;

  doc.roundedRect(xCaja, y, anchoCaja, altoCaja, 4)
    .lineWidth(1).strokeColor(MARCA.azulProfundo).stroke();

  doc.rect(xCaja, y, anchoCaja, 20).fill(MARCA.azulProfundo);
  doc.fillColor(MARCA.blanco).font('Helvetica-Bold').fontSize(9)
    .text(d.titulo, xCaja, y + 6, { width: anchoCaja, align: 'center' });

  doc.fillColor(MARCA.tintaSuave).font('Helvetica').fontSize(7)
    .text('RUC DEL EMISOR', xCaja, y + 26, { width: anchoCaja, align: 'center' });
  doc.fillColor(MARCA.tinta).font('Courier-Bold').fontSize(10)
    .text(d.emisor.ruc, xCaja, y + 35, { width: anchoCaja, align: 'center' });
  doc.fillColor(MARCA.azulProfundo).font('Courier-Bold').fontSize(11)
    .text(d.numero, xCaja, y + 48, { width: anchoCaja, align: 'center' });

  return y + altoCaja + 14;
}

/** Los datos del cliente y las condiciones, en dos columnas. */
function bloqueDatos(doc: Lienzo, d: Documento, y: number): number {
  const anchoIzq = 268;
  const anchoDer = ANCHO_UTIL - anchoIzq - 10;
  const xDer = MARGEN + anchoIzq + 10;

  // El recuadro tiene que dar de si cuando hay contacto: tres lineas mas.
  const filas = Math.max(3, Math.ceil(d.datos.length / 2));
  const alto = 20 + filas * 11 + 8 + (d.contacto ? 34 : 0);

  doc.roundedRect(MARGEN, y, anchoIzq, alto, 3).fill(MARCA.grisSuave);
  doc.roundedRect(xDer, y, anchoDer, alto, 3).fill(MARCA.grisSuave);

  /* ---- Cliente ---- */
  doc.fillColor(MARCA.azulProfundo).font('Helvetica-Bold').fontSize(7)
    .text('CLIENTE', MARGEN + 8, y + 7);
  doc.fillColor(MARCA.tinta).font('Helvetica-Bold').fontSize(9)
    .text(d.receptor.razonSocial, MARGEN + 8, y + 17, { width: anchoIzq - 16 });
  doc.fillColor(MARCA.tintaSuave).font('Helvetica').fontSize(7.5)
    .text(`${d.receptor.etiquetaIdentificacion}: ${d.receptor.identificacion}   ·   ${d.receptor.pais}`,
      MARGEN + 8, doc.y + 1, { width: anchoIzq - 16 });
  if (d.receptor.contacto || d.receptor.email) {
    doc.text([d.receptor.contacto, d.receptor.email].filter(Boolean).join('  ·  '),
      MARGEN + 8, doc.y + 1, { width: anchoIzq - 16 });
  }

  /*
   * A quien va dirigido dentro de esa empresa. Va debajo del cliente y no en
   * un bloque aparte porque responde a la misma pregunta: quien recibe esto.
   * Si no hay contacto, el hueco simplemente no existe.
   */
  if (d.contacto) {
    doc.fillColor(MARCA.azulProfundo).font('Helvetica-Bold').fontSize(6.5)
      .text('ATENCIÓN A', MARGEN + 8, doc.y + 4);
    doc.fillColor(MARCA.tinta).font('Helvetica-Bold').fontSize(8)
      .text(
        d.contacto.nombre + (d.contacto.cargo ? `  ·  ${d.contacto.cargo}` : ''),
        MARGEN + 8, doc.y + 1, { width: anchoIzq - 16 }
      );
    const via = [d.contacto.telefono, d.contacto.email].filter(Boolean).join('  ·  ');
    if (via) {
      doc.fillColor(MARCA.tintaSuave).font('Helvetica').fontSize(7)
        .text(via, MARGEN + 8, doc.y + 1, { width: anchoIzq - 16 });
    }
  }

  /* ---- Condiciones, dos por línea ---- */
  let yd = y + 7;
  doc.fillColor(MARCA.azulProfundo).font('Helvetica-Bold').fontSize(7).text('CONDICIONES', xDer + 8, yd);
  yd += 10;
  for (const dato of d.datos) {
    doc.fillColor(MARCA.tintaSuave).font('Helvetica').fontSize(7)
      .text(`${dato.etiqueta}:`, xDer + 8, yd, { width: 78, continued: false });
    doc.fillColor(MARCA.tinta).font('Helvetica-Bold').fontSize(7)
      .text(dato.valor, xDer + 88, yd, { width: anchoDer - 96 });
    yd += 11;
  }

  return y + Math.max(alto, yd - y + 6) + 12;
}

/** La fila de encabezados de la tabla. */
function encabezadoTabla(doc: Lienzo, y: number): number {
  doc.rect(MARGEN, y, ANCHO_UTIL, 16).fill(MARCA.azulProfundo);
  let x = MARGEN;
  doc.fillColor(MARCA.blanco).font('Helvetica-Bold').fontSize(6.5);
  for (const c of COLUMNAS) {
    doc.text(c.titulo, x + 4, y + 5, { width: c.ancho - 8, align: c.alineado });
    x += c.ancho;
  }
  return y + 16;
}

/** Dibuja las líneas, saltando de página cuando hace falta. */
function tabla(doc: Lienzo, d: Documento, yInicial: number): number {
  let y = encabezadoTabla(doc, yInicial);
  const limite = ALTO_A4 - MARGEN - 150; // se reserva sitio para totales y pie

  d.lineas.forEach((l, i) => {
    // Dos líneas de texto caben en 22 puntos; si no cabe, página nueva.
    if (y + 22 > limite) {
      doc.addPage();
      y = cabecera(doc, d);
      y = encabezadoTabla(doc, y);
    }

    if (i % 2 === 1) doc.rect(MARGEN, y, ANCHO_UTIL, 22).fill(MARCA.grisSuave);

    const valores = [
      String(l.n),
      l.codigo,
      l.descripcion,
      l.presentacion,
      cifra(l.cantidadTm, 3),
      cifra(l.precioTm),
      l.descuentoPct > 0 ? `${cifra(l.descuentoPct, 1)}%` : '—',
      cifra(l.importe),
    ];

    let x = MARGEN;
    valores.forEach((v, j) => {
      const c = COLUMNAS[j];
      // Las cifras en monoespaciada: es lo que hace que la columna alinee.
      doc.font(c.alineado === 'right' ? 'Courier' : 'Helvetica').fontSize(7.5)
        .fillColor(MARCA.tinta)
        .text(v, x + 4, y + 7, { width: c.ancho - 8, align: c.alineado, lineBreak: false });
      x += c.ancho;
    });

    doc.moveTo(MARGEN, y + 22).lineTo(MARGEN + ANCHO_UTIL, y + 22)
      .lineWidth(0.4).strokeColor(MARCA.linea).stroke();

    y += 22;
  });

  return y;
}

/** Totales a la derecha e importe en letras a la izquierda. */
function totales(doc: Lienzo, d: Documento, y: number): number {
  const anchoCaja = 200;
  const x = ANCHO_A4 - MARGEN - anchoCaja;
  const sm = simboloMoneda(d.moneda);

  const filas: [string, string, boolean][] = [
    ['Subtotal', `${sm} ${cifra(d.totales.subtotal)}`, false],
  ];
  if (d.totales.descuento > 0) {
    filas.push(['Descuento aplicado', `- ${sm} ${cifra(d.totales.descuento)}`, false]);
  }
  filas.push([
    d.totales.igvPct > 0 ? `IGV (${cifra(d.totales.igvPct, 0)} %)` : 'IGV (exportación, inafecto)',
    `${sm} ${cifra(d.totales.igv)}`,
    false,
  ]);
  filas.push(['TOTAL', `${sm} ${cifra(d.totales.total)}`, true]);

  let yy = y + 8;
  for (const [etiqueta, valor, destacado] of filas) {
    if (destacado) {
      doc.rect(x, yy - 3, anchoCaja, 20).fill(MARCA.azulProfundo);
      doc.fillColor(MARCA.blanco).font('Helvetica-Bold').fontSize(9)
        .text(etiqueta, x + 8, yy + 3, { width: 90 });
      doc.font('Courier-Bold').fontSize(11)
        .text(valor, x + 98, yy + 2, { width: anchoCaja - 106, align: 'right' });
      yy += 22;
    } else {
      doc.fillColor(MARCA.tintaSuave).font('Helvetica').fontSize(8)
        .text(etiqueta, x + 8, yy, { width: 100 });
      doc.fillColor(MARCA.tinta).font('Courier').fontSize(8.5)
        .text(valor, x + 108, yy - 1, { width: anchoCaja - 116, align: 'right' });
      yy += 13;
    }
  }

  /* ---- Importe en letras ---- */
  doc.fillColor(MARCA.tintaSuave).font('Helvetica-Bold').fontSize(6.5)
    .text('SON', MARGEN, y + 10);
  doc.fillColor(MARCA.tinta).font('Helvetica-Bold').fontSize(8)
    .text(importeEnLetras(d.totales.total, d.moneda), MARGEN, y + 19, { width: ANCHO_UTIL - anchoCaja - 20 });

  return yy + 6;
}

/**
 * Los avisos de la verificación, impresos dentro del documento.
 * No se esconden: si algo no cuadra, quien lo tiene en la mano debe saberlo.
 */
function avisos(doc: Lienzo, d: Documento, y: number): number {
  if (!d.avisos.length) return y;

  const alto = 14 + d.avisos.length * 10;
  doc.roundedRect(MARGEN, y, ANCHO_UTIL, alto, 3)
    .fillAndStroke('#FFF8E6', MARCA.atencion);

  doc.fillColor(MARCA.atencion).font('Helvetica-Bold').fontSize(6.5)
    .text('OBSERVACIONES DE LA VERIFICACIÓN', MARGEN + 8, y + 5);

  let yy = y + 15;
  for (const a of d.avisos) {
    doc.fillColor(MARCA.tinta).font('Helvetica').fontSize(7)
      .text(`· ${a}`, MARGEN + 8, yy, { width: ANCHO_UTIL - 16 });
    yy += 10;
  }
  return y + alto + 8;
}

/**
 * Donde pagar.
 *
 * Va justo despues de los totales porque es lo que el cliente busca cuando
 * termina de mirar cuanto debe. Se pinta en dos columnas para que quepan
 * cuatro cuentas sin empujar el pie a otra pagina.
 *
 * Si el documento no lleva ninguna cuenta, el bloque no existe: la seccion es
 * opcional y un recuadro vacio solo ocuparia sitio.
 */
function cuentas(doc: Lienzo, d: Documento, y: number): number {
  if (!d.cuentas.length) return y;

  const columnas = 2;
  const anchoCol = ANCHO_UTIL / columnas;
  const filas = Math.ceil(d.cuentas.length / columnas);
  const alto = 16 + filas * 30;

  doc.roundedRect(MARGEN, y, ANCHO_UTIL, alto, 3).fill(MARCA.grisSuave);
  doc.fillColor(MARCA.azulProfundo).font('Helvetica-Bold').fontSize(6.5)
    .text('DATOS PARA EL PAGO', MARGEN + 8, y + 5);

  d.cuentas.forEach((c, i) => {
    const col = i % columnas;
    const fila = Math.floor(i / columnas);
    const x = MARGEN + 8 + col * anchoCol;
    const yy = y + 16 + fila * 30;
    const esDetraccion = c.tipo === 'detraccion';

    doc.fillColor(esDetraccion ? MARCA.atencion : MARCA.tinta)
      .font('Helvetica-Bold').fontSize(7.5)
      .text(
        `${c.banco}  ·  ${esDetraccion ? 'DETRACCIÓN' : c.moneda}`,
        x, yy, { width: anchoCol - 16, lineBreak: false }
      );

    doc.fillColor(MARCA.tinta).font('Courier').fontSize(8)
      .text(`Cta. ${c.numero}`, x, yy + 9, { width: anchoCol - 16, lineBreak: false });

    const extra = [c.cci ? `CCI ${c.cci}` : '', c.swift ? `SWIFT ${c.swift}` : '']
      .filter(Boolean)
      .join('   ');
    if (extra) {
      doc.fillColor(MARCA.tintaSuave).font('Courier').fontSize(6.5)
        .text(extra, x, yy + 19, { width: anchoCol - 16, lineBreak: false });
    }
  });

  return y + alto + 8;
}

/** Notas legales, observaciones y firma. */
function pie(doc: Lienzo, d: Documento, y: number) {
  if (d.observaciones) {
    doc.fillColor(MARCA.azulProfundo).font('Helvetica-Bold').fontSize(6.5)
      .text('OBSERVACIONES', MARGEN, y);
    doc.fillColor(MARCA.tinta).font('Helvetica').fontSize(7.5)
      .text(d.observaciones, MARGEN, y + 9, { width: ANCHO_UTIL });
    y = doc.y + 8;
  }

  doc.moveTo(MARGEN, y).lineTo(MARGEN + ANCHO_UTIL, y)
    .lineWidth(0.5).strokeColor(MARCA.linea).stroke();

  doc.fillColor(MARCA.tintaSuave).font('Helvetica').fontSize(6.5);
  let yy = y + 6;
  for (const n of d.notas) {
    doc.text(`· ${n}`, MARGEN, yy, { width: ANCHO_UTIL - 150 });
    yy = doc.y + 1;
  }

  /* ---- Espacio de firma, a la derecha ---- */
  const xFirma = ANCHO_A4 - MARGEN - 150;
  doc.moveTo(xFirma, yy + 22).lineTo(ANCHO_A4 - MARGEN, yy + 22)
    .lineWidth(0.5).strokeColor(MARCA.tintaSuave).stroke();
  doc.fillColor(MARCA.tintaSuave).font('Helvetica').fontSize(6.5)
    .text(d.emisor.marca, xFirma, yy + 25, { width: 150, align: 'center' });
}

/** El sello diagonal: ANULADA, BORRADOR… Se dibuja encima de todo. */
function sello(doc: Lienzo, texto: string) {
  doc.save();
  doc.rotate(-32, { origin: [ANCHO_A4 / 2, ALTO_A4 / 2] });
  doc.fillColor(MARCA.critico).opacity(0.14).font('Helvetica-Bold').fontSize(76)
    .text(texto, 0, ALTO_A4 / 2 - 40, { width: ANCHO_A4, align: 'center' });
  doc.opacity(1);
  doc.restore();
}

/* ==========================================================================
   GENERACIÓN
   ========================================================================== */

/**
 * Devuelve el PDF completo como buffer, listo para descargar.
 *
 * Si la verificación encontró ERRORES no se genera nada: se lanza. Un
 * comprobante cuyos totales no cuadran no debe existir como archivo, porque
 * en cuanto existe alguien lo manda.
 */
export async function generarPdf(documento: Documento): Promise<Buffer> {
  const d = limpiarDocumento(documento);

  if (d.errores.length) {
    throw new Error(
      `El documento no se puede emitir porque sus datos no cuadran:\n· ${d.errores.join('\n· ')}`
    );
  }

  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGEN,
    bufferPages: true, // hace falta para numerar «página N de M» al final
    info: {
      Title: `${d.titulo} ${d.numero}`,
      Author: d.emisor.razonSocial,
      Subject: `${d.titulo} para ${d.receptor.razonSocial}`,
      Creator: 'Santa Mónica ERP',
    },
  });

  const trozos: Buffer[] = [];
  doc.on('data', (c: Buffer) => trozos.push(c));
  const terminado = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(trozos)));
  });

  let y = cabecera(doc, d);
  y = bloqueDatos(doc, d, y);
  y = tabla(doc, d, y);
  y = totales(doc, d, y);
  y = cuentas(doc, d, y);
  y = avisos(doc, d, y);
  pie(doc, d, y);

  /* ---- Numeración y sello, en todas las páginas ---- */
  const rango = doc.bufferedPageRange();
  for (let i = 0; i < rango.count; i++) {
    doc.switchToPage(rango.start + i);
    if (d.sello) sello(doc, d.sello);

    /*
     * El pie va en la zona de margen, y pdfkit reacciona a cualquier texto que
     * cruce el margen inferior creando una página nueva. Por eso se anula el
     * margen mientras se escribe: sin esto aparecía una hoja en blanco al
     * final con solo el pie, y encima el contador decía «página 1 de 1».
     */
    const margenOriginal = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    doc.fillColor(MARCA.tintaSuave).font('Helvetica').fontSize(6.5)
      .text(
        `${d.titulo} ${d.numero}   ·   Página ${i + 1} de ${rango.count}`,
        MARGEN,
        ALTO_A4 - 26,
        { width: ANCHO_UTIL, align: 'center', lineBreak: false }
      );

    doc.page.margins.bottom = margenOriginal;
  }

  doc.end();
  return terminado;
}
