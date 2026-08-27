/**
 * ============================================================================
 *  REPORTES EN PDF · el mismo dato que el Excel, pero para imprimir y firmar
 * ============================================================================
 *  El Excel sirve para trabajar la información; el PDF sirve para otra cosa:
 *  imprimirlo, firmarlo, adjuntarlo a un correo o llevarlo a una reunión sin
 *  que nadie pueda cambiar una cifra por el camino.
 *
 *  DECISIONES QUE MERECEN EXPLICACIÓN
 *
 *  · Va en APAISADO. Un reporte de almacén tiene diez u once columnas; en
 *    vertical no caben sin encoger la letra hasta hacerla ilegible.
 *
 *  · La cabecera se repite en TODAS las páginas, con «página N de M». Un
 *    reporte de sesenta hojas que se desordena sobre una mesa se vuelve a
 *    ordenar solo si cada hoja dice cuál es.
 *
 *  · El pie de cada página lleva quién lo generó y cuándo, y los filtros que
 *    estaban puestos. Sin eso, dos impresiones del mismo reporte con distinto
 *    filtro son indistinguibles, y alguien acabará discutiendo por qué «el
 *    sistema dio dos números diferentes».
 *
 *  · Los totales se calculan AQUÍ, sumando las filas que realmente se
 *    imprimieron. No se copian de la pantalla: si la consulta trajo un tope de
 *    filas, el total tiene que ser el de lo impreso, no el del universo.
 * ============================================================================
 */
import PDFDocument from 'pdfkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MARCA_PDF as MARCA, limpiarDocumento, cifra } from './textoPdf';

/* --------------------------------------------------------------------------
   Geometría de la hoja A4 apaisada
   -------------------------------------------------------------------------- */
const MARGEN = 30;
const ANCHO = 841.89;
const ALTO = 595.28;
const ANCHO_UTIL = ANCHO - MARGEN * 2;   // 781.89
const ALTO_CABECERA = 74;
const ALTO_PIE = 30;

export type ColumnaPdf = {
  titulo: string;
  clave: string;
  /** Peso relativo del ancho. Se reparte el ancho útil en proporción. */
  peso: number;
  alineado?: 'left' | 'right' | 'center';
  /** Cómo se dibuja el valor. Por defecto, texto tal cual. */
  tipo?: 'texto' | 'numero' | 'entero' | 'dinero' | 'fecha' | 'fechaHora';
  /** Traducción de valores en bruto (enumerados) a texto legible. */
  mapa?: Record<string, string>;
};

export type OpcionesPdfReporte = {
  titulo: string;
  subtitulo: string;
  columnas: ColumnaPdf[];
  filas: Record<string, unknown>[];
  /** Claves numéricas que llevan total al pie de la tabla. */
  totalizar?: string[];
  /** Filtros aplicados, tal como los verá quien reciba la impresión. */
  filtros?: Record<string, string>;
  /** Resumen de cabecera: pares etiqueta/valor destacados arriba. */
  resumen?: { etiqueta: string; valor: string }[];
  usuario: string;
  /** Momento de generación. Se pasa desde fuera para que sea comprobable. */
  generadoEn: Date;
  /** Se anota si la consulta llegó al tope y hay más datos de los impresos. */
  truncadoEn?: number;
};

type Lienzo = PDFKit.PDFDocument;

/** El logotipo, si está. Si falta, el reporte se emite igual. */
function logotipo(doc: Lienzo, x: number, y: number): boolean {
  try {
    doc.image(readFileSync(join(process.cwd(), 'public', 'logo.png')), x, y, { height: 22 });
    return true;
  } catch {
    return false;
  }
}

/** Da formato a una celda según el tipo declarado en la columna. */
function celda(bruto: unknown, tipo: ColumnaPdf['tipo'], mapa?: Record<string, string>): string {
  if (bruto === null || bruto === undefined || bruto === '') return '—';

  const valor = mapa && typeof bruto === 'string' ? (mapa[bruto] ?? bruto) : bruto;

  switch (tipo) {
    case 'numero':
      return cifra(Number(valor), 2);
    case 'entero':
      return cifra(Number(valor), 0);
    case 'dinero':
      return 'US$ ' + cifra(Number(valor), 2);
    case 'fecha': {
      const d = new Date(String(valor));
      return isNaN(d.getTime()) ? String(valor) : d.toLocaleDateString('es-PE');
    }
    case 'fechaHora': {
      const d = new Date(String(valor));
      if (isNaN(d.getTime())) return String(valor);
      /*
       * Formato corto y en 24 horas, a propósito. El formato largo de es-PE
       * añade « 02:14 p. m. », y ese sufijo con espacios no cabía en la
       * columna: se partía y la segunda línea se montaba sobre la fila
       * siguiente. En un parte de almacén nadie necesita el «p. m.».
       */
      return d.toLocaleString('es-PE', {
        day: '2-digit', month: '2-digit', year: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).replace(',', '');
    }
    default:
      return String(valor);
  }
}

/**
 * Recorta un texto para que quepa en el ancho dado, midiéndolo con la fuente
 * que está puesta en ese momento.
 *
 * POR QUÉ SE HACE A MANO
 * pdfkit tiene opciones para esto (`lineBreak: false`, `ellipsis: true`), pero
 * en la práctica seguía partiendo valores largos —«Santa Mónica · Cámara 03»,
 * un corte de tres palabras— y la segunda línea se dibujaba encima de la fila
 * siguiente, dejando el reporte ilegible justo donde más denso es. Midiendo y
 * cortando aquí, el resultado es el mismo siempre: una línea, nunca dos.
 */
function recortar(doc: Lienzo, texto: string, ancho: number): string {
  if (doc.widthOfString(texto) <= ancho) return texto;

  // Búsqueda binaria: con doce columnas por fila y miles de filas, probar
  // carácter a carácter se nota en el tiempo de generación.
  let bajo = 0;
  let alto = texto.length;
  while (bajo < alto) {
    const medio = Math.ceil((bajo + alto) / 2);
    if (doc.widthOfString(texto.slice(0, medio) + '...') <= ancho) bajo = medio;
    else alto = medio - 1;
  }
  return bajo > 0 ? texto.slice(0, bajo).trimEnd() + '...' : '';
}

/**
 * La cabecera de página.
 *
 * Se dibuja con `doc.text(..., x, y)` posicionado a mano en todos los casos:
 * si se dejara fluir, pdfkit arrastraría el cursor y la primera fila de la
 * tabla aparecería en un sitio distinto en la página 1 que en la 7.
 */
function cabecera(doc: Lienzo, op: OpcionesPdfReporte) {
  doc.rect(0, 0, ANCHO, 5).fill(MARCA.azulProfundo);
  doc.rect(0, 5, ANCHO, 1.6).fill(MARCA.verdeAzulado);

  const y = 16;
  const hayLogo = logotipo(doc, MARGEN, y + 2);
  const xTexto = hayLogo ? MARGEN + 78 : MARGEN;

  doc.fillColor(MARCA.azulProfundo).font('Helvetica-Bold').fontSize(13)
    .text(op.titulo, xTexto, y, { width: 430, lineBreak: false });
  doc.fillColor(MARCA.tintaSuave).font('Helvetica').fontSize(7.6)
    .text(op.subtitulo, xTexto, y + 18, { width: 430, lineBreak: false });
  doc.fillColor(MARCA.tintaSuave).font('Helvetica').fontSize(6.8)
    .text('INDUSTRIAL PESQUERA SANTA MONICA S.A.C.  ·  RUC 20205572229', xTexto, y + 30, {
      width: 430, lineBreak: false,
    });

  /* Bloque de la derecha: cuándo, quién y con qué filtros. */
  const xDer = ANCHO - MARGEN - 250;
  doc.fillColor(MARCA.tintaSuave).font('Helvetica').fontSize(6.6)
    .text(
      `Generado el ${op.generadoEn.toLocaleString('es-PE', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })}  por  ${op.usuario}`,
      xDer, y, { width: 250, align: 'right', lineBreak: false }
    );

  const filtros = Object.entries(op.filtros ?? {});
  const textoFiltros = filtros.length
    ? filtros.map(([k, v]) => `${k}: ${v}`).join('   ·   ')
    : 'Sin filtros: el reporte incluye todo el universo de datos';
  doc.fillColor(MARCA.tinta).font('Helvetica-Bold').fontSize(6.6)
    .text(textoFiltros, xDer, y + 11, { width: 250, align: 'right', height: 20 });

  /* Resumen destacado: las cifras que se leen antes que la tabla. */
  if (op.resumen?.length) {
    let x = xTexto;
    const yRes = y + 42;
    for (const r of op.resumen) {
      doc.fillColor(MARCA.tintaSuave).font('Helvetica').fontSize(5.8)
        .text(r.etiqueta.toUpperCase(), x, yRes, { width: 118, lineBreak: false, characterSpacing: 0.4 });
      doc.fillColor(MARCA.azulProfundo).font('Helvetica-Bold').fontSize(9)
        .text(r.valor, x, yRes + 8, { width: 118, lineBreak: false });
      x += 126;
    }
  }

  doc.moveTo(MARGEN, ALTO_CABECERA - 4).lineTo(ANCHO - MARGEN, ALTO_CABECERA - 4)
    .lineWidth(0.8).strokeColor(MARCA.azulProfundo).stroke();
}

/** La fila de títulos de la tabla, sobre fondo de marca. */
function tituloColumnas(doc: Lienzo, cols: ColumnaPdf[], anchos: number[], y: number): number {
  const alto = 15;
  doc.rect(MARGEN, y, ANCHO_UTIL, alto).fill(MARCA.azulProfundo);

  let x = MARGEN;
  cols.forEach((c, i) => {
    doc.fillColor(MARCA.blanco).font('Helvetica-Bold').fontSize(6.4);
    doc.text(recortar(doc, c.titulo.toUpperCase(), anchos[i] - 6), x + 3, y + 5, {
      width: anchos[i] - 6,
      align: c.alineado ?? 'left',
      lineBreak: false,
    });
    x += anchos[i];
  });
  return y + alto;
}

/** El pie: numeración y la nota de procedencia. */
function pie(doc: Lienzo, pagina: number, total: number) {
  const y = ALTO - ALTO_PIE + 6;
  doc.moveTo(MARGEN, y - 4).lineTo(ANCHO - MARGEN, y - 4)
    .lineWidth(0.5).strokeColor(MARCA.linea).stroke();

  doc.fillColor(MARCA.tintaSuave).font('Helvetica').fontSize(6.4)
    .text(
      'Reporte emitido por el sistema de gestion de Santa Monica. Las cifras corresponden al momento de la generacion.',
      MARGEN, y, { width: ANCHO_UTIL - 90, lineBreak: false }
    );
  doc.fillColor(MARCA.tinta).font('Helvetica-Bold').fontSize(6.8)
    .text(`Pagina ${pagina} de ${total}`, ANCHO - MARGEN - 90, y, {
      width: 90, align: 'right', lineBreak: false,
    });
}

/**
 * Dibuja el reporte completo y devuelve el PDF en memoria.
 */
export async function generarPdfReporte(opciones: OpcionesPdfReporte): Promise<Buffer> {
  // Una sola limpieza sobre todo el contenido, antes de dibujar nada.
  const op = limpiarDocumento(opciones);

  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margins: { top: MARGEN, bottom: MARGEN, left: MARGEN, right: MARGEN },
    bufferPages: true,   // hace falta para poder escribir «de M» al final
    info: {
      Title: op.titulo,
      Author: 'Industrial Pesquera Santa Monica S.A.C.',
      Subject: op.subtitulo,
      Creator: 'ERP Santa Monica',
    },
  });

  const trozos: Buffer[] = [];
  doc.on('data', (t: Buffer) => trozos.push(t));
  const terminado = new Promise<Buffer>((resolver) => {
    doc.on('end', () => resolver(Buffer.concat(trozos)));
  });

  /* ---- Reparto del ancho: cada columna se lleva su peso proporcional ----
     Se redondea a la baja y el sobrante se le da a la primera columna, así
     la suma es EXACTA y la última columna nunca se sale de la hoja. */
  const pesoTotal = op.columnas.reduce((s, c) => s + c.peso, 0);
  const anchos = op.columnas.map((c) => Math.floor((c.peso / pesoTotal) * ANCHO_UTIL));
  anchos[0] += ANCHO_UTIL - anchos.reduce((s, a) => s + a, 0);

  const ALTO_FILA = 13;
  const yInicio = ALTO_CABECERA + 4;
  const yTope = ALTO - ALTO_PIE - 24;   // deja sitio para la franja de totales

  cabecera(doc, op);
  let y = tituloColumnas(doc, op.columnas, anchos, yInicio);

  const totales: Record<string, number> = {};
  (op.totalizar ?? []).forEach((k) => { totales[k] = 0; });

  op.filas.forEach((fila, indice) => {
    /* ¿Cabe otra fila? Si no, se cierra la página y se repite la cabecera. */
    if (y + ALTO_FILA > yTope) {
      doc.addPage();
      cabecera(doc, op);
      y = tituloColumnas(doc, op.columnas, anchos, yInicio);
    }

    // Bandas alternas: en una tabla de once columnas es lo que evita que el
    // ojo salte de renglón al leer de izquierda a derecha.
    if (indice % 2 === 1) {
      doc.rect(MARGEN, y, ANCHO_UTIL, ALTO_FILA).fill(MARCA.grisSuave);
    }

    let x = MARGEN;
    op.columnas.forEach((c, i) => {
      const bruto = fila[c.clave];
      if (op.totalizar?.includes(c.clave)) totales[c.clave] += Number(bruto ?? 0);

      const esNumero = c.tipo && c.tipo !== 'texto' && c.tipo !== 'fecha' && c.tipo !== 'fechaHora';
      doc.fillColor(MARCA.tinta)
        .font(esNumero ? 'Courier' : 'Helvetica')
        .fontSize(6.6)
        // El recorte se hace DESPUÉS de fijar la fuente y el tamaño: medir con
        // otra fuente daría un ancho que no es el que se va a dibujar.
        .text(recortar(doc, celda(bruto, c.tipo, c.mapa), anchos[i] - 6), x + 3, y + 4, {
          width: anchos[i] - 6,
          align: c.alineado ?? (esNumero ? 'right' : 'left'),
          lineBreak: false,
        });
      x += anchos[i];
    });

    y += ALTO_FILA;
  });

  /* ---- Franja de totales ---- */
  if ((op.totalizar ?? []).length > 0) {
    if (y + 18 > yTope + 20) {
      doc.addPage();
      cabecera(doc, op);
      y = tituloColumnas(doc, op.columnas, anchos, yInicio);
    }
    doc.rect(MARGEN, y, ANCHO_UTIL, 16).fill(MARCA.azulProfundo);

    let x = MARGEN;
    op.columnas.forEach((c, i) => {
      if (i === 0) {
        doc.fillColor(MARCA.blanco).font('Helvetica-Bold').fontSize(6.8)
          .text(`TOTAL  ·  ${cifra(op.filas.length, 0)} registros`, x + 3, y + 5, {
            width: anchos[i] * 2, lineBreak: false,
          });
      } else if (op.totalizar?.includes(c.clave)) {
        doc.fillColor(MARCA.blanco).font('Courier-Bold').fontSize(6.8)
          .text(celda(totales[c.clave], c.tipo), x + 3, y + 5, {
            width: anchos[i] - 6, align: 'right', lineBreak: false,
          });
      }
      x += anchos[i];
    });
    y += 16;
  }

  /* ---- Aviso de corte, si lo hubo ---- */
  if (op.truncadoEn && op.filas.length >= op.truncadoEn) {
    doc.fillColor(MARCA.critico).font('Helvetica-Bold').fontSize(6.6)
      .text(
        `Atencion: el reporte se corto en ${cifra(op.truncadoEn, 0)} filas. Acote los filtros para verlo completo; los totales de arriba son solo de lo impreso.`,
        MARGEN, y + 4, { width: ANCHO_UTIL, lineBreak: false }
      );
  }

  /* ---- Numeración: solo ahora se sabe cuántas páginas salieron ---- */
  const rango = doc.bufferedPageRange();
  for (let i = 0; i < rango.count; i++) {
    doc.switchToPage(rango.start + i);
    /*
     * pdfkit se niega a escribir por debajo del margen inferior: si se le
     * pide, abre una página más. Poniendo el margen a cero mientras se dibuja
     * el pie, se le permite llegar al borde sin generar hojas en blanco.
     */
    doc.page.margins.bottom = 0;
    pie(doc, i + 1, rango.count);
  }

  doc.end();
  return terminado;
}
