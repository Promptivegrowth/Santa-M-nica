/**
 * ============================================================================
 *  PREPARA LA PLANTILLA DEL CONTRATO A PARTIR DEL MODELO DE SANTA MÓNICA
 * ============================================================================
 *  Oliver envió el contrato real SM26-378 (Qingdao Haiyujia, alas de pota) como
 *  modelo. En ese Word, lo que cambia en cada venta está RESALTADO EN AMARILLO.
 *  Este script toma ese Word y deja una plantilla:
 *
 *    · cada párrafo resaltado pasa a ser un marcador {{campo}}, con el mismo
 *      formato (negrita, letra) pero sin el amarillo;
 *    · los datos del banco y del vendedor, también marcadores: salen de
 *      Configuración, no del Word;
 *    · la firma del gerente se QUITA del archivo (queda una imagen vacía): se
 *      pone al generar, desde Configuración, igual que en la proforma. Una
 *      firma no se guarda en el repositorio de código;
 *    · los metadatos con nombres de personas se limpian.
 *
 *  Al terminar comprueba que no quede NINGÚN dato del cliente del modelo:
 *  el repositorio no guarda documentos de clientes reales.
 *
 *      node scripts/preparar-plantilla-contrato.mjs "<ruta al modelo .docx>"
 *
 *  Escribe plantillas/contrato-venta.docx. Si mañana Legal cambia el modelo,
 *  se vuelve a correr con el Word nuevo.
 * ============================================================================
 */
import JSZip from 'jszip';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const origen = process.argv[2];
if (!origen) { console.error('Indique la ruta del Word modelo.'); process.exit(1); }
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DESTINO = join(RAIZ, 'plantillas', 'contrato-venta.docx');

const zip = await JSZip.loadAsync(readFileSync(origen));
let xml = await zip.file('word/document.xml').async('string');

/* ---- Los párrafos, en orden (también los que están dentro de tablas) ---- */
const RE_PARRAFO = /<w:p[ >][\s\S]*?<\/w:p>/g;
const parrafos = xml.match(RE_PARRAFO);
const textoDe = (p) => (p.match(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join('');
const pPr = (p) => p.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? '';
const rPrs = (p) => [...p.matchAll(/<w:r[ >][\s\S]*?<\/w:r>/g)].map((r) => r[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? '');
const sinResaltado = (rpr) => rpr.replace(/<w:highlight [^>]*\/>/g, '');
const abre = (p) => p.match(/^<w:p[^>]*>/)[0];
/*
 * Los campos que pueden tener VARIAS líneas (un producto por línea, los tramos
 * del pago) van alineados a la izquierda: justificado, Word estira cada línea
 * antes de un salto y «FROZEN GIANT SQUID» sale con huecos de un centímetro.
 */
const MULTILINEA = new Set(['producto_en', 'producto_es', 'precio', 'pago_en', 'pago_es']);
const marcador = (p, campo) => {
  let pp = sinResaltado(pPr(p));
  if (MULTILINEA.has(campo)) pp = pp.replace(/<w:jc w:val="both"\/>/g, '');
  return `${abre(p)}${pp}<w:r>${sinResaltado(rPrs(p)[0] ?? '')}<w:t xml:space="preserve">{{${campo}}}</w:t></w:r></w:p>`;
};

/* ---- Qué párrafo es qué campo (índices verificados contra el modelo) ---- */
const CAMPOS = {
  1: 'numero', 5: 'proforma', 9: 'fecha',
  13: 'vendedor_nombre', 14: 'vendedor_direccion',
  18: 'comprador_nombre', 19: 'comprador_direccion', 20: 'comprador_documento',
  24: 'producto_en', 25: 'producto_es',
  29: 'cantidad', 33: 'precio', 36: 'empaque',
  40: 'periodo_en', 41: 'periodo_es',
  45: 'puerto_carga', 46: 'puerto_carga',
  50: 'puerto_descarga', 51: 'puerto_descarga',
  71: 'pago_en', 74: 'pago_es',
};
/* El texto que tiene que haber en cada uno: si el modelo cambia, se avisa en vez de marcar mal. */
const ESPERADO = {
  1: 'SM-2026-378', 5: 'SM26-378', 18: 'QINGDAO HAIYUJIA', 24: 'FROZEN GIANT SQUID WINGS', 29: '80,955.00 KG',
  71: '20% ADVANCE PAYMENT', 74: '20% PAGO ADELANTADO', 86: 'PAYMENT TO', 91: 'BENEFICIARY', 106: 'captura',
};
for (const [i, t] of Object.entries(ESPERADO)) {
  if (!textoDe(parrafos[i]).includes(t)) { console.error(`El párrafo ${i} no dice «${t}»: el modelo cambió.`); process.exit(1); }
}

const nuevos = [...parrafos];
for (const [i, campo] of Object.entries(CAMPOS)) nuevos[i] = marcador(parrafos[i], campo);
//  La segunda línea de la forma de pago se une a la primera (va con salto de línea).
nuevos[72] = '';
nuevos[75] = '';

//  Datos del banco: se conserva la etiqueta en negrita y se marca el valor.
const BANCO = { 86: 'banco_nombre', 87: 'banco_direccion', 88: 'banco_pais', 89: 'banco_swift', 90: 'banco_cuenta', 91: 'banco_beneficiario' };
for (const [i, campo] of Object.entries(BANCO)) {
  const p = parrafos[i];
  const etiqueta = textoDe(p).split(':')[0] + ': ';
  const r = rPrs(p);
  nuevos[i] = `${abre(p)}${pPr(p)}<w:r>${r[0]}<w:t xml:space="preserve">${etiqueta}</w:t></w:r><w:r>${r[r.length - 1]}<w:t xml:space="preserve">{{${campo}}}</w:t></w:r></w:p>`;
}

/*
 * Documento F: en el modelo dice «captura» en amarillo, es decir, el
 * certificado de captura que se agrega cuando corresponde. Queda como dos
 * párrafos —inglés numerado y castellano en cursiva, igual que A–E— que se
 * quitan si el contrato no lo lleva.
 */
const fEn = parrafos[104].replace(/<w:r[ >][\s\S]*<\/w:r>/, '') // el formato del ítem E, sin su texto
  .replace(/<\/w:p>$/, `<w:r>${rPrs(parrafos[104])[0]}<w:t xml:space="preserve">{{documento_f_en}}</w:t></w:r></w:p>`);
const fEs = parrafos[105].replace(/<w:r[ >][\s\S]*<\/w:r>/, '')
  .replace(/<\/w:p>$/, `<w:r>${rPrs(parrafos[105])[0]}<w:t xml:space="preserve">{{documento_f_es}}</w:t></w:r></w:p>`);
nuevos[106] = fEn + fEs;

let i = 0;
xml = xml.replace(RE_PARRAFO, () => nuevos[i++]);
zip.file('word/document.xml', xml);

/* ---- La firma fuera: una imagen PNG transparente de 1×1 en su lugar ---- */
const rels = await zip.file('word/_rels/document.xml.rels').async('string');
const firma = rels.match(/Id="rId11"[^>]*Target="([^"]+)"/)?.[1] ?? rels.match(/Target="([^"]+)"[^>]*Id="rId11"/)?.[1];
if (!firma) { console.error('No se encontró la imagen de la firma (rId11).'); process.exit(1); }
const VACIA = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
zip.file(`word/${firma}`, VACIA);

/* ---- Metadatos sin nombres de personas ---- */
const core = (await zip.file('docProps/core.xml').async('string'))
  .replace(/<dc:creator>[^<]*<\/dc:creator>/, '<dc:creator>Industrial Pesquera Santa Mónica S.A.</dc:creator>')
  .replace(/<cp:lastModifiedBy>[^<]*<\/cp:lastModifiedBy>/, '<cp:lastModifiedBy>ERP Santa Mónica</cp:lastModifiedBy>')
  .replace(/<dc:title>[^<]*<\/dc:title>/, '<dc:title>Contrato de venta internacional</dc:title>');
zip.file('docProps/core.xml', core);
const app = (await zip.file('docProps/app.xml').async('string'))
  .replace(/<Company>[^<]*<\/Company>/, '<Company>Industrial Pesquera Santa Mónica S.A.</Company>')
  .replace(/(<TitlesOfParts>[\s\S]*?<vt:lpstr>)[^<]*(<\/vt:lpstr>)/, '$1Contrato de venta internacional$2');
zip.file('docProps/app.xml', app);

/* ---- Comprobación: nada del cliente del modelo queda en el archivo ---- */
const todo = await Promise.all(Object.values(zip.files).filter((f) => !f.dir && /\.(xml|rels)$/.test(f.name)).map((f) => f.async('string')));
const PROHIBIDO = ['QINGDAO', 'HAIYUJIA', '91370203595293841R', 'FUZHOUBEI', 'SHIDAO', '80,955', 'SM26-378', 'SM-2026-378', 'Cathy', 'Italo'];
const encontrados = PROHIBIDO.filter((p) => todo.some((t) => t.toUpperCase().includes(p.toUpperCase())));
if (encontrados.length) { console.error('Quedan datos del modelo:', encontrados.join(', ')); process.exit(1); }

const marcadores = [...new Set(xml.match(/\{\{[a-z_]+\}\}/g))];
mkdirSync(dirname(DESTINO), { recursive: true });
writeFileSync(DESTINO, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log(`Plantilla lista: ${DESTINO}`);
console.log(`${marcadores.length} marcadores: ${marcadores.join(' ')}`);
