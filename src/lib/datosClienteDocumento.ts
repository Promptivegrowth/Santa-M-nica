/**
 * ============================================================================
 *  LOS DATOS DEL CLIENTE QUE LLEVA CADA DOCUMENTO (migración 085)
 * ============================================================================
 *  «Observaciones ERP 4», punto 01 (Oliver): «dirección, identificación
 *  fiscal y vendedor debe coincidir en cotización con proforma».
 *
 *  Antes la cotización y la proforma leían la ficha del cliente al generar el
 *  PDF. Si la ficha se corregía entre una y otra (pasó con KULALIA el 03/11:
 *  la lista BASC se cargó siete minutos después de crear el pedido), los dos
 *  documentos decían cosas distintas.
 *
 *  Ahora la cotización FIJA razón social, dirección e identificación fiscal
 *  al crearse, y el pedido las hereda de ella (lo hace la base, 085). Este
 *  archivo es lo único que tienen que saber los documentos:
 *
 *    · clienteDelDocumento(doc, cliente) devuelve los datos con los que se
 *      imprime: los fijados en el documento si los tiene; si es anterior a
 *      la 085 (sin copia), los de la ficha, como siempre.
 *    · diferenciasConLaFicha(doc, cliente) dice qué cambió en la ficha desde
 *      que se emitió el documento, para avisarlo en pantalla y ofrecer
 *      «Actualizar con la ficha del cliente».
 *
 *  Función pura: no lee la base ni el reloj.
 * ============================================================================
 */

type Registro = Record<string, unknown> | null | undefined;

/** Los campos de la ficha que el documento fija, y su nombre en el documento. */
const CAMPOS: { ficha: string; documento: string; nombre: string }[] = [
  { ficha: 'razon_social', documento: 'cliente_razon_social', nombre: 'razón social' },
  { ficha: 'direccion', documento: 'cliente_direccion', nombre: 'dirección' },
  { ficha: 'ruc_tax_id', documento: 'cliente_tax_id', nombre: 'identificación fiscal' },
  { ficha: 'etiqueta_tax_id', documento: 'cliente_etiqueta_tax_id', nombre: 'nombre de la identificación fiscal' },
];

/** Columnas del documento que hay que pedir a la base (para los `select` con lista de columnas). */
export const COLUMNAS_CLIENTE_DOCUMENTO =
  'cliente_razon_social, cliente_direccion, cliente_tax_id, cliente_etiqueta_tax_id, cliente_datos_en';

/** ¿El documento tiene sus propios datos del cliente (posterior a la 085)? */
export function tieneDatosFijados(doc: Registro): boolean {
  return !!doc && doc.cliente_datos_en !== null && doc.cliente_datos_en !== undefined;
}

/**
 * La ficha del cliente con los datos fiscales que fijó el documento encima.
 * Se devuelve con las MISMAS claves que la ficha (razon_social, direccion,
 * ruc_tax_id, etiqueta_tax_id, y el resto tal cual: país, contacto…), para
 * que quien la use no tenga que cambiar nada más.
 */
export function clienteDelDocumento<T extends Record<string, unknown>>(doc: Registro, cliente: T | null | undefined): T | null {
  if (!tieneDatosFijados(doc)) return cliente ?? null;
  const base = { ...(cliente ?? {}) } as Record<string, unknown>;
  for (const c of CAMPOS) base[c.ficha] = doc![c.documento] ?? null;
  return base as T;
}

const normal = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().toUpperCase();

/** Qué dice distinto la ficha de hoy respecto de lo que fijó el documento. Vacío = coinciden. */
export function diferenciasConLaFicha(doc: Registro, cliente: Registro): { campo: string; documento: string; ficha: string }[] {
  if (!tieneDatosFijados(doc) || !cliente) return [];
  return CAMPOS
    .filter((c) => normal(doc![c.documento]) !== normal(cliente[c.ficha]))
    .map((c) => ({
      campo: c.nombre,
      documento: String(doc![c.documento] ?? '') || '(vacío)',
      ficha: String(cliente[c.ficha] ?? '') || '(vacío)',
    }));
}
