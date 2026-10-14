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
 * ============================================================================
 */
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatosContrato } from './contratoVenta';

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
    producto_en: d.producto.en, producto_es: d.producto.es,
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
    zip.file('word/document.xml', doc);
  }

  /* El título del archivo, para quien lo abra desde el correo. */
  const core = (await zip.file('docProps/core.xml')!.async('string'))
    .replace(/<dc:title>[^<]*<\/dc:title>/, `<dc:title>${escapar(`Contrato ${d.numero}`)}</dc:title>`);
  zip.file('docProps/core.xml', core);

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
