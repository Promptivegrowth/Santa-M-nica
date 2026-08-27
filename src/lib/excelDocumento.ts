/**
 * ============================================================================
 *  DOCUMENTOS COMERCIALES EN EXCEL
 * ============================================================================
 *  La cotización, la proforma, la factura y la boleta también se descargan en
 *  Excel, no solo en PDF. No es un capricho: el cliente que recibe una
 *  cotización de cuarenta líneas la quiere en una hoja para comparar, y el
 *  contador quiere las cifras sin retipearlas de un PDF —que es justo donde se
 *  cuelan los errores de transcripción—.
 *
 *  Es el MISMO documento verificado que va al PDF, así que las dos versiones
 *  no pueden discrepar: si discreparan, sería porque una de las dos se armó
 *  con otros datos, y eso aquí no puede pasar.
 *
 *  UNA DECISIÓN QUE PARECE RARA
 *  Los totales se escriben como NÚMEROS, no como fórmulas. Una hoja con
 *  fórmulas se recalcula sola en cuanto alguien toca una celda, y entonces el
 *  Excel deja de decir lo mismo que el PDF y que la base de datos. Este
 *  archivo es un comprobante, no una calculadora.
 * ============================================================================
 */
import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MARCA } from './excel';
import { importeEnLetras } from './importeEnLetras';
import type { Documento } from './documentos';

const COLS = 8;

export async function generarDocumentoExcel(d: Documento): Promise<Buffer> {
  if (d.errores.length) {
    throw new Error(
      `El documento no se puede emitir porque sus datos no cuadran:\n· ${d.errores.join('\n· ')}`
    );
  }

  const libro = new ExcelJS.Workbook();
  libro.creator = 'Santa Mónica ERP';
  libro.company = d.emisor.razonSocial;
  libro.created = new Date();

  const hoja = libro.addWorksheet(d.titulo.slice(0, 28), {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1 },
    views: [{ showGridLines: false }],
  });

  hoja.columns = [
    { width: 5 }, { width: 12 }, { width: 34 }, { width: 16 },
    { width: 12 }, { width: 13 }, { width: 9 }, { width: 15 },
  ];

  const simbolo = d.moneda === 'PEN' ? 'S/' : 'US$';
  const formatoMoneda = `"${simbolo}" #,##0.00`;

  /** Escribe una celda de texto con el estilo de la marca. */
  const escribir = (
    fila: number,
    col: number,
    valor: string,
    op: { negrita?: boolean; tamano?: number; color?: string; hasta?: number } = {}
  ) => {
    if (op.hasta) hoja.mergeCells(fila, col, fila, op.hasta);
    const c = hoja.getCell(fila, col);
    c.value = valor;
    c.font = {
      name: 'Calibri',
      size: op.tamano ?? 9,
      bold: op.negrita ?? false,
      color: { argb: op.color ?? MARCA.tinta },
    };
    return c;
  };

  let f = 1;

  /* ═════════ CABECERA ═════════ */
  try {
    const idLogo = libro.addImage({
      // El `as` es por los tipos de ExcelJS, que declaran su propio Buffer.
      buffer: readFileSync(join(process.cwd(), 'public', 'logo.png')) as unknown as ExcelJS.Buffer,
      extension: 'png',
    });
    hoja.addImage(idLogo, { tl: { col: 0.2, row: 0.2 }, ext: { width: 132, height: 34 } });
    hoja.getRow(1).height = 30;
    f = 3;
  } catch {
    /* Sin logotipo el documento vale igual: no se deja de emitir por eso. */
  }

  hoja.mergeCells(1, 6, 1, COLS);
  const celdaTitulo = hoja.getCell(1, 6);
  celdaTitulo.value = d.titulo;
  celdaTitulo.font = { name: 'Calibri', size: 12, bold: true, color: { argb: MARCA.blanco } };
  celdaTitulo.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MARCA.azulProfundo } };
  celdaTitulo.alignment = { horizontal: 'center', vertical: 'middle' };
  hoja.getRow(1).height = Math.max(hoja.getRow(1).height ?? 0, 24);

  hoja.mergeCells(2, 6, 2, COLS);
  const celdaNumero = hoja.getCell(2, 6);
  celdaNumero.value = d.numero;
  celdaNumero.font = { name: 'Consolas', size: 12, bold: true, color: { argb: MARCA.azulProfundo } };
  celdaNumero.alignment = { horizontal: 'center' };

  escribir(f, 1, d.emisor.razonSocial, { negrita: true, tamano: 12, color: MARCA.azulProfundo, hasta: 5 });
  escribir(f + 1, 1, `RUC ${d.emisor.ruc}  ·  ${d.emisor.direccion}`, { tamano: 8, hasta: 5 });
  f += 3;

  /* ═════════ CLIENTE Y CONDICIONES ═════════ */
  const filaBloque = f;
  escribir(f, 1, 'CLIENTE', { negrita: true, tamano: 7, color: MARCA.azulProfundo });
  escribir(f + 1, 1, d.receptor.razonSocial, { negrita: true, tamano: 10, hasta: 4 });
  escribir(
    f + 2, 1,
    `${d.receptor.etiquetaIdentificacion}: ${d.receptor.identificacion}   ·   ${d.receptor.pais}`,
    { tamano: 8, hasta: 4 }
  );
  const contactoCliente = [d.receptor.contacto, d.receptor.email].filter(Boolean).join('  ·  ');
  if (contactoCliente) escribir(f + 3, 1, contactoCliente, { tamano: 8, hasta: 4 });

  // A quién va dirigido dentro de esa empresa. Puede faltar: la sección es
  // opcional y el documento sale igual sin ella.
  if (d.contacto) {
    escribir(f + 4, 1, 'ATENCIÓN A', { negrita: true, tamano: 7, color: MARCA.azulProfundo });
    escribir(
      f + 5, 1,
      d.contacto.nombre + (d.contacto.cargo ? `  ·  ${d.contacto.cargo}` : ''),
      { negrita: true, tamano: 9, hasta: 4 }
    );
    const via = [d.contacto.telefono, d.contacto.email].filter(Boolean).join('  ·  ');
    if (via) escribir(f + 6, 1, via, { tamano: 8, hasta: 4 });
  }

  escribir(filaBloque, 6, 'CONDICIONES', { negrita: true, tamano: 7, color: MARCA.azulProfundo });
  d.datos.forEach((dato, i) => {
    escribir(filaBloque + 1 + i, 6, dato.etiqueta, { tamano: 8, color: 'FF6F7D95' });
    escribir(filaBloque + 1 + i, 7, dato.valor, { tamano: 8, negrita: true, hasta: COLS });
  });

  f = Math.max(filaBloque + (d.contacto ? 8 : 5), filaBloque + 2 + d.datos.length);

  /* ═════════ TABLA DE PRODUCTOS ═════════ */
  const ENCABEZADOS = [
    '#', 'Código', 'Descripción', 'Presentación', 'Cant. TM', 'Precio / TM', 'Dscto.', 'Importe',
  ];
  const filaEnc = f;

  ENCABEZADOS.forEach((t, i) => {
    const c = hoja.getCell(filaEnc, i + 1);
    c.value = t;
    c.font = { name: 'Calibri', size: 9, bold: true, color: { argb: MARCA.blanco } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MARCA.azulProfundo } };
    c.alignment = { horizontal: i >= 4 ? 'right' : 'left', vertical: 'middle' };
    c.border = { bottom: { style: 'medium', color: { argb: MARCA.verdeAzulado } } };
  });
  hoja.getRow(filaEnc).height = 18;

  d.lineas.forEach((l, i) => {
    const fila = filaEnc + 1 + i;
    const valores: (string | number)[] = [
      l.n, l.codigo, l.descripcion, l.presentacion,
      l.cantidadTm, l.precioTm, l.descuentoPct / 100, l.importe,
    ];
    valores.forEach((v, j) => {
      const c = hoja.getCell(fila, j + 1);
      c.value = v;
      c.font = { name: j >= 4 ? 'Consolas' : 'Calibri', size: 9, color: { argb: MARCA.tinta } };
      c.alignment = { horizontal: j >= 4 ? 'right' : 'left', vertical: 'middle', wrapText: j === 2 };
      if (j === 4) c.numFmt = '#,##0.000';
      if (j === 5 || j === 7) c.numFmt = formatoMoneda;
      if (j === 6) c.numFmt = '0.0%';
      if (i % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MARCA.grisSuave } };
      c.border = { bottom: { style: 'hair', color: { argb: MARCA.grisLinea } } };
    });
  });

  f = filaEnc + d.lineas.length + 2;

  /* ═════════ TOTALES ═════════ */
  const totales: [string, number, boolean][] = [['Subtotal', d.totales.subtotal, false]];
  if (d.totales.descuento > 0) totales.push(['Descuento aplicado', -d.totales.descuento, false]);
  totales.push([
    d.totales.igvPct > 0 ? `IGV (${d.totales.igvPct.toFixed(0)} %)` : 'IGV (exportación, inafecto)',
    d.totales.igv,
    false,
  ]);
  totales.push(['TOTAL', d.totales.total, true]);

  for (const [etiqueta, valor, destacado] of totales) {
    hoja.mergeCells(f, 5, f, 7);
    const cEtiqueta = hoja.getCell(f, 5);
    cEtiqueta.value = etiqueta;
    cEtiqueta.alignment = { horizontal: 'right', vertical: 'middle' };
    cEtiqueta.font = {
      name: 'Calibri', size: destacado ? 11 : 9, bold: destacado,
      color: { argb: destacado ? MARCA.blanco : MARCA.tinta },
    };

    const cValor = hoja.getCell(f, 8);
    cValor.value = valor;
    cValor.numFmt = formatoMoneda;
    cValor.font = {
      name: 'Consolas', size: destacado ? 12 : 9, bold: destacado,
      color: { argb: destacado ? MARCA.blanco : MARCA.tinta },
    };
    cValor.alignment = { horizontal: 'right', vertical: 'middle' };

    if (destacado) {
      for (let col = 5; col <= COLS; col++) {
        hoja.getCell(f, col).fill = {
          type: 'pattern', pattern: 'solid', fgColor: { argb: MARCA.azulProfundo },
        };
      }
      hoja.getRow(f).height = 20;
    }
    f++;
  }

  /* ═════════ IMPORTE EN LETRAS ═════════ */
  f++;
  escribir(f, 1, 'SON', { negrita: true, tamano: 7, color: 'FF6F7D95' });
  escribir(f, 2, importeEnLetras(d.totales.total, d.moneda), { negrita: true, tamano: 9, hasta: COLS });
  f += 2;

  /* ═════════ DATOS PARA EL PAGO ═════════ */
  if (d.cuentas.length) {
    escribir(f, 1, 'DATOS PARA EL PAGO', { negrita: true, tamano: 7, color: MARCA.azulProfundo, hasta: COLS });
    f++;

    const CAB = ['Banco', 'Tipo', 'Moneda', 'Número de cuenta', 'CCI', 'SWIFT'];
    CAB.forEach((t, i) => {
      const c = hoja.getCell(f, i + 1);
      c.value = t;
      c.font = { name: 'Calibri', size: 8, bold: true, color: { argb: MARCA.blanco } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MARCA.azulProfundo } };
    });
    // Las dos últimas columnas quedan libres: el SWIFT se extiende sobre ellas.
    hoja.mergeCells(f, 6, f, COLS);
    f++;

    for (const cu of d.cuentas) {
      const esDetraccion = cu.tipo === 'detraccion';
      const valores = [
        cu.banco,
        esDetraccion ? 'Detracción' : cu.tipo === 'ahorros' ? 'Ahorros' : 'Corriente',
        cu.moneda,
        cu.numero,
        cu.cci || '—',
        cu.swift || '—',
      ];
      valores.forEach((v, i) => {
        const c = hoja.getCell(f, i + 1);
        c.value = v;
        c.font = {
          name: i >= 3 ? 'Consolas' : 'Calibri',
          size: 8.5,
          bold: esDetraccion && i <= 1,
          color: { argb: esDetraccion ? MARCA.atencion : MARCA.tinta },
        };
        c.border = { bottom: { style: 'hair', color: { argb: MARCA.grisLinea } } };
      });
      hoja.mergeCells(f, 6, f, COLS);
      f++;
    }
    f++;
  }

  /* ═════════ OBSERVACIONES DE LA VERIFICACIÓN ═════════ */
  if (d.avisos.length) {
    const c = escribir(f, 1, 'OBSERVACIONES DE LA VERIFICACIÓN', {
      negrita: true, tamano: 8, color: MARCA.atencion, hasta: COLS,
    });
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF6E0' } };
    f++;
    for (const a of d.avisos) {
      const ca = escribir(f, 1, `· ${a}`, { tamano: 8, hasta: COLS });
      ca.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF6E0' } };
      ca.alignment = { wrapText: true, vertical: 'top' };
      hoja.getRow(f).height = 24;
      f++;
    }
    f++;
  }

  /* ═════════ OBSERVACIONES Y NOTAS ═════════ */
  if (d.observaciones) {
    escribir(f, 1, 'OBSERVACIONES', { negrita: true, tamano: 7, color: MARCA.azulProfundo });
    f++;
    const c = escribir(f, 1, d.observaciones, { tamano: 8, hasta: COLS });
    c.alignment = { wrapText: true, vertical: 'top' };
    hoja.getRow(f).height = 28;
    f += 2;
  }

  for (const n of d.notas) {
    const c = escribir(f, 1, `· ${n}`, { tamano: 8, color: 'FF6F7D95', hasta: COLS });
    c.font = { ...c.font, italic: true };
    c.alignment = { wrapText: true, vertical: 'top' };
    f++;
  }

  if (d.sello) {
    f++;
    const c = escribir(f, 1, `*** DOCUMENTO ${d.sello} ***`, {
      negrita: true, tamano: 14, color: MARCA.critico, hasta: COLS,
    });
    c.alignment = { horizontal: 'center' };
  }

  const buffer = await libro.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
