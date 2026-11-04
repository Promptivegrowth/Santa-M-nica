/**
 * ============================================================================
 *  EL CONTRATO EN WORD, SOBRE EL MODELO DE SANTA MÓNICA
 * ============================================================================
 *  Se llena la plantilla que salió del propio contrato modelo
 *  (plantillas/contrato-venta.docx, ver scripts/preparar-plantilla-contrato):
 *  cabecera, tablas, viñetas, cursivas y anexo quedan EXACTAMENTE como el
 *  Word que usa Comex. Solo se reemplazan los marcadores {{campo}}.
 *
 *  Un valor de varias líneas va con saltos de línea dentro del mismo párrafo,
 *  como en el modelo. El documento F se quita entero si el contrato no lo
 *  lleva. La firma del gerente se pone desde Configuración.
 *
 *  083 · Como el contrato SM26-384 del modelo: el producto por ítems
 *  intercalados —(1) inglés, (1) castellano, (2)…—, el puerto de descarga en
 *  inglés y después en castellano, sin el resaltado amarillo que la plantilla
 *  conservaba del Word de trabajo, y la firma de quien aprobó la cotización:
 *  si es su trazo suelto (no el bloque de Gerencia), se escriben debajo su
 *  nombre, cargo, empresa y RUC, como en el bloque del modelo.
 * ============================================================================
 */
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { productoIntercalado, type DatosContrato } from './contratoVenta';

const PLANTILLA = join(process.cwd(), 'plantillas', 'contrato-venta.docx');

const escapar = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Un texto con saltos de línea, como runs de Word: <w:t>…</w:t><w:br/><w:t>…</w:t>. */
const conSaltos = (s: string) => s.split('\n').map((l) => `<w:t xml:space="preserve">${escapar(l)}</w:t>`).join('<w:br/>');

/** Ancho y alto de un PNG, leídos de su cabecera. */
function medidasPng(b: Buffer): { ancho: number; alto: number } | null {
  if (b.length < 24 || b.toString('ascii', 1, 4) !== 'PNG') return null;
  return { ancho: b.readUInt32BE(16), alto: b.readUInt32BE(20) };
}

export async function generarDocxContrato(d: DatosContrato, firma: { imagen: string | null; esBloque: boolean }): Promise<Buffer> {
  const firmaDataUrl = firma.imagen;
  const zip = await JSZip.loadAsync(readFileSync(PLANTILLA));
  let xml = await zip.file('word/document.xml')!.async('string');

  const valores: Record<string, string> = {
    numero: d.numero, proforma: d.proforma, fecha: d.fecha,
    vendedor_nombre: d.vendedor.nombre, vendedor_direccion: d.vendedor.direccion,
    comprador_nombre: d.comprador.nombre, comprador_direccion: d.comprador.direccion, comprador_documento: d.comprador.documento,
    //  083 · Intercalado en el primer marcador; el segundo párrafo se quita abajo.
    producto_en: productoIntercalado(d.producto), producto_es: '',
    cantidad: d.cantidad, precio: d.precio, empaque: d.empaque,
    periodo_en: d.periodo.en, periodo_es: d.periodo.es,
    puerto_carga: d.puertoCarga, puerto_descarga: d.puertoDescarga,
    pago_en: d.pago.en, pago_es: d.pago.es,
    banco_nombre: d.banco.nombre, banco_direccion: d.banco.direccion, banco_pais: d.banco.pais,
    banco_swift: d.banco.swift, banco_cuenta: d.banco.cuenta, banco_beneficiario: d.banco.beneficiario,
    documento_f_en: d.documentoF.en, documento_f_es: d.documentoF.es,
  };

  /* El documento F se quita entero si no va: su párrafo y el de su traducción. */
  if (!d.documentoF.en.trim()) {
    xml = xml.replace(/<w:p[ >](?:(?!<w:p[ >])[\s\S])*?\{\{documento_f_(?:en|es)\}\}[\s\S]*?<\/w:p>/g, '');
  }
  /* 083 · El producto ya va entero (e intercalado) en {{producto_en}}: el párrafo del castellano sobra. */
  xml = xml.replace(/<w:p[ >](?:(?!<w:p[ >])[\s\S])*?\{\{producto_es\}\}[\s\S]*?<\/w:p>/g, '');
  /* 083 · El puerto de descarga: la primera vez en inglés, la segunda en castellano. */
  let vecesPuerto = 0;
  xml = xml.replace(/<w:t xml:space="preserve">\{\{puerto_descarga\}\}<\/w:t>/g, () =>
    conSaltos((vecesPuerto++ === 0 ? d.puertoDescarga : (d.puertoDescargaEs || d.puertoDescarga)) ?? ''));
  /* 083 · Sin el resaltado amarillo de los campos variables del Word de trabajo: el contrato va en negro. */
  xml = xml.replace(/<w:highlight w:val="[^"]*"\/>/g, '');
  /* El comprador sin documento tributario: se quita la línea, no queda «USCI: .». */
  if (!d.comprador.documento.trim()) {
    xml = xml.replace(/<w:p[ >](?:(?!<w:p[ >])[\s\S])*?\{\{comprador_documento\}\}[\s\S]*?<\/w:p>/g, '');
  }

  xml = xml.replace(/<w:t xml:space="preserve">\{\{([a-z_]+)\}\}<\/w:t>/g, (todo, campo: string) =>
    campo in valores ? conSaltos(valores[campo] ?? '') : todo);
  if (/\{\{[a-z_]+\}\}/.test(xml)) throw new Error('Quedó un marcador sin llenar en el contrato.');
  zip.file('word/document.xml', xml);

  /* ---- La firma: la de Configuración, en el lugar de la imagen vacía ---- */
  const rels = await zip.file('word/_rels/document.xml.rels')!.async('string');
  const destino = rels.match(/<Relationship [^>]*Id="rId11"[^>]*>/)?.[0]?.match(/Target="([^"]+)"/)?.[1];
  const png = firmaDataUrl?.startsWith('data:image/png;base64,') ? Buffer.from(firmaDataUrl.split(',')[1], 'base64') : null;
  const medidas = png ? medidasPng(png) : null;
  if (destino && png && medidas) {
    zip.file(`word/${destino}`, png);
    /*
     * Cabe en el recuadro del modelo sin deformarse: se escala para que entre
     * entero (ni más ancho ni más alto que el original).
     */
    const caja = (cx: number, cy: number) => {
      const escala = Math.min(cx / medidas.ancho, cy / medidas.alto);
      return [Math.round(medidas.ancho * escala), Math.round(medidas.alto * escala)];
    };
    let doc = await zip.file('word/document.xml')!.async('string');
    doc = doc.replace(/(<wp:extent cx=")(\d+)(" cy=")(\d+)("\/>[\s\S]*?r:embed="rId11")/g, (_t, a, cx, b, cy, c) => {
      const [x, y] = caja(Number(cx), Number(cy));
      return `${a}${x}${b}${y}${c}`;
    });
    doc = doc.replace(/(r:embed="rId11"[\s\S]*?<a:ext cx=")(\d+)(" cy=")(\d+)(")/g, (_t, a, cx, b, cy, c) => {
      const [x, y] = caja(Number(cx), Number(cy));
      return `${a}${x}${b}${y}${c}`;
    });
    /*
     * 083 · Si es el trazo suelto de quien aprobó (no el bloque de Gerencia,
     * que ya trae dibujados nombre, cargo, empresa y RUC), se escriben debajo
     * de la línea «SELLER … BUYER», bajo la imagen, como en el bloque del modelo.
     */
    if (!firma.esBloque && d.firmante?.nombre) {
      const linea = (t: string, negrita = false) =>
        `<w:r><w:rPr>${negrita ? '<w:b/><w:bCs/>' : ''}<w:sz w:val="14"/><w:szCs w:val="14"/></w:rPr><w:t xml:space="preserve">${escapar(t)}</w:t></w:r>`;
      const textos = [d.firmante.nombre, d.firmante.cargo, d.vendedor.nombre, d.firmante.ruc ? `RUC: ${d.firmante.ruc}` : '']
        .filter((t) => String(t ?? '').trim());
      const bloque = '<w:p><w:pPr><w:spacing w:before="560" w:after="0" w:line="240" w:lineRule="auto"/>' +
        '<w:ind w:left="1300"/></w:pPr>' +
        textos.map((t, i) => (i > 0 ? '<w:r><w:br/></w:r>' : '') + linea(t, i === 0)).join('') + '</w:p>';
      doc = doc.replace(/ELLER\s+BUYER<\/w:t>[\s\S]*?<\/w:p>/g, (parrafo) => parrafo + bloque);
    }
    zip.file('word/document.xml', doc);
  }

  /* El título del archivo, para quien lo abra desde el correo. */
  const core = (await zip.file('docProps/core.xml')!.async('string'))
    .replace(/<dc:title>[^<]*<\/dc:title>/, `<dc:title>${escapar(`Contrato ${d.numero}`)}</dc:title>`);
  zip.file('docProps/core.xml', core);

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
