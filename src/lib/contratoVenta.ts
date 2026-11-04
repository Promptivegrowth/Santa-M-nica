/**
 * ============================================================================
 *  CONTRATO DE VENTA INTERNACIONAL · los datos variables
 * ============================================================================
 *  Observaciones de octubre, punto 8, con el modelo institucional que envió
 *  Oliver: «el modelo de contrato que debe generarse al aprobar la cotización,
 *  al igual que se genera la proforma».
 *
 *  EL CONTRATO NACE DE LA PROFORMA. Su número es el de la proforma —SM26-378
 *  da el contrato SM-2026-378— y casi todo lo que dice (cantidad, tolerancia,
 *  mes de embarque, puerto de carga, adelanto) vive en el pedido. Una
 *  cotización aprobada que todavía no es proforma no tiene esos datos.
 *
 *  En el Word del modelo, lo variable está resaltado en amarillo. Esto es
 *  exactamente eso: el número, la fecha, el comprador, el producto en inglés
 *  y castellano, la cantidad, el precio, el empaque, el periodo de embarque,
 *  los puertos y la forma de pago. Más el banco y el vendedor, que salen de
 *  Configuración. Todo lo demás es texto fijo (contratoTextos.ts).
 *
 *  Antes de generarse, la pantalla deja revisar y corregir cada campo: el
 *  comprador puede llamar «GRADE B» a lo que el maestro llama de otra forma.
 *  Lo que se genera se guarda tal cual, para que el PDF y el Word de dentro de
 *  un año digan lo mismo que el que se firmó.
 * ============================================================================
 */
import type { crearClienteServidor } from '@/lib/supabase/servidor';
import { uno } from '@/lib/relaciones';
//  085 · El comprador del contrato es el de la proforma: los datos fijados en el pedido.
import { clienteDelDocumento } from '@/lib/datosClienteDocumento';
import { hoyEnLima } from '@/lib/fechas';
import type { FormaPago } from '@/lib/condicionesVenta';
import {
  nombreComercial, tallaImpresa, pesoCorto, puertoDestino, llevaCertificadoCaptura,
} from '@/lib/productoDocumento';
import { resolverFirmante } from '@/lib/firmanteDocumento';

type Cliente = Awaited<ReturnType<typeof crearClienteServidor>>;

export type DatosContrato = {
  numero: string;
  proforma: string;
  fecha: string;
  vendedor: { nombre: string; direccion: string };
  comprador: { nombre: string; direccion: string; documento: string };
  /**
   * Una línea por ÍTEM, en los dos idiomas: «(1) FROZEN GIANT SQUID SEXUAL
   * TENTACLES, WITH TIP, SIZE: 50CM-UP». El PDF y el Word las intercalan
   * —(1) inglés, (1) castellano, (2)…— como el contrato del modelo.
   */
  producto: { en: string; es: string };
  cantidad: string;
  precio: string;
  empaque: string;
  periodo: { en: string; es: string };
  puertoCarga: string;
  /** En inglés: «VIGO, SPAIN». */
  puertoDescarga: string;
  /** 083 · En castellano: «VIGO, ESPAÑA». Los contratos de antes no lo traen (se repite el inglés). */
  puertoDescargaEs?: string;
  /** Líneas de la forma de pago, en los dos idiomas. */
  pago: { en: string; es: string };
  banco: { nombre: string; direccion: string; pais: string; swift: string; cuenta: string; beneficiario: string };
  /** Documento F, opcional: el certificado de captura. Vacío = no va. */
  documentoF: { en: string; es: string };
  /**
   * Quién firma por Santa Mónica. Lo pone el servidor, nunca la pantalla:
   * desde la 083, quien aprobó la cotización (su firma de «Mi firma»), o
   * Gerencia por defecto. `usuarioId` vacío = la de Configuración.
   */
  firmante?: { nombre: string; cargo: string; ruc: string; usuarioId?: string | null; motivo?: string };
};

const MESES_EN = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const MESES_ES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SETIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

/** «2026-10-09» → «OCTOBER 09, 2026 / 09 DE OCTUBRE 2026», como el modelo. Sin pasar por husos. */
export function fechaBilingue(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  const dd = String(d).padStart(2, '0');
  return `${MESES_EN[m - 1]} ${dd}, ${a} / ${dd} DE ${MESES_ES[m - 1]} ${a}`;
}

/** «2026-10-01» → { en: 'OCTOBER, 2026', es: 'OCTUBRE, 2026' }. */
export function periodoBilingue(iso: string | null | undefined): { en: string; es: string } {
  if (!iso || !/^\d{4}-\d{2}/.test(iso)) return { en: '', es: '' };
  const a = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return { en: `${MESES_EN[m - 1]}, ${a}`, es: `${MESES_ES[m - 1]}, ${a}` };
}

/**
 * El número del contrato sale de la proforma: SM26-378 → SM-2026-378. Una
 * segunda versión es «(Rev.)», como el modelo; la tercera, «(Rev. 2)».
 */
export function numeroContrato(proforma: string, revision: number): string {
  const m = /^SM(\d{2})-(\d+)$/.exec(proforma.trim());
  const base = m ? `SM-20${m[1]}-${m[2]}` : `C-${proforma.trim()}`;
  return revision === 0 ? base : revision === 1 ? `${base} (Rev.)` : `${base} (Rev. ${revision})`;
}

const kg = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** «2.450», con tres decimales como la proforma (y hasta cuatro si los tiene). */
const precioKg = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 4 });

/**
 * El producto como se imprime en el contrato: (1) inglés, (1) castellano,
 * (2) inglés, (2) castellano… como el modelo SM26-384. Si quien revisó el
 * contrato dejó distinto número de líneas en un idioma que en el otro, se
 * imprime primero todo el inglés y después todo el castellano (como antes):
 * mejor eso que emparejar mal un ítem con la traducción de otro.
 */
export function productoIntercalado(p: { en: string; es: string }): string {
  const en = String(p.en ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
  const es = String(p.es ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
  if (en.length > 1 && en.length === es.length) return en.flatMap((x, i) => [x, es[i]]).join('\n');
  return [...en, ...es].join('\n');
}

/**
 * La forma de pago en las palabras del contrato. El caso del modelo —20 %
 * adelanto, 80 % contra copia de documentos— es el de casi todos los clientes
 * de la lista de Comex; los demás son los que aparecen en esa misma lista.
 */
export function pagoBilingue(forma: FormaPago | null, adelantoPct: number, dias: number, textoLibre: string | null): { en: string; es: string } {
  const p = Math.round(adelantoPct * 100) / 100;
  if (forma === 'contado' || p >= 100) {
    return { en: '100% ADVANCE PAYMENT', es: '100% PAGO ADELANTADO' };
  }
  if (forma === 'carta_credito') {
    return dias > 0
      ? { en: `IRREVOCABLE LETTER OF CREDIT AT ${dias} DAYS FROM BILL OF LADING DATE`, es: `CARTA DE CRÉDITO IRREVOCABLE A ${dias} DÍAS DE LA FECHA DE ZARPE (B/L)` }
      : { en: 'IRREVOCABLE LETTER OF CREDIT AT SIGHT', es: 'CARTA DE CRÉDITO IRREVOCABLE A LA VISTA' };
  }
  if (forma === 'cad' || (forma !== 'credito' && p === 0 && !textoLibre)) {
    return { en: '100% AGAINST COPY OF DOCUMENTS BY EMAIL', es: '100% CONTRA COPIA DE DOCUMENTOS POR CORREO' };
  }
  if (forma === 'credito') {
    return { en: `${dias > 0 ? dias : 30} DAYS CREDIT FROM BILL OF LADING DATE`, es: `CRÉDITO A ${dias > 0 ? dias : 30} DÍAS DE LA FECHA DEL B/L` };
  }
  if (p > 0) {
    return {
      en: `${p}% ADVANCE PAYMENT\n${100 - p}% AGAINST COPY OF DOCUMENTS BY EMAIL`,
      es: `${p}% PAGO ADELANTADO\n${100 - p}% CONTRA COPIA DE DOCUMENTOS POR CORREO`,
    };
  }
  const libre = (textoLibre ?? '').toUpperCase();
  return { en: libre, es: libre };
}

/** «sacos» → BAGS; el modelo dice «BAGS OF 21 KG AND/OR 20 KG». */
function empaqueEn(tipo: string, kgs: number[]): string {
  const unidad = tipo === 'cajas' ? 'BOXES' : tipo === 'block' ? 'BLOCKS' : 'BAGS';
  const pesos = [...new Set(kgs.filter((k) => k > 0))].sort((a, b) => b - a).map((k) => `${Number(k.toFixed(2))} KG`);
  return pesos.length ? `${unidad} OF ${pesos.join(' AND/OR ')}` : '';
}

export type ResultadoArmado = { ok: true; datos: DatosContrato; revision: number } | { ok: false; mensaje: string };

/** Arma el contrato de un pedido con lo que dice la proforma, el cliente y Configuración. */
export async function armarDatosContrato(supabase: Cliente, pedidoId: number): Promise<ResultadoArmado> {
  const [{ data: ped }, { data: lineas }, { data: params }, { data: cuentas }, { count }] = await Promise.all([
    supabase.from('pedidos')
      .select('id, numero_proforma, cotizacion_id, creado_por, certificado_captura, fecha_tentativa_despacho, incoterm, moneda, mes_embarque, fecha_comprometida, tolerancia_pct, puerto_embarque, forma_pago, pago_adelanto_pct, dias_credito, condicion_pago, ciclo, cliente_razon_social, cliente_direccion, cliente_tax_id, cliente_etiqueta_tax_id, cliente_datos_en, clientes(razon_social, direccion, ruc_tax_id, etiqueta_tax_id, pais), destinos(puerto, pais)')
      .eq('id', pedidoId).maybeSingle(),
    supabase.from('pedido_lineas')
      .select('cantidad_tm, precio_tm, descuento_pct, orden, sku_presentaciones(skus(corte, talla, empaque, formatos(descripcion_en, descripcion_es)), presentaciones(peso_bulto_kg))')
      .eq('pedido_id', pedidoId).order('orden'),
    supabase.from('parametros').select('clave, valor')
      .in('clave', ['empresa_razon_social', 'empresa_domicilio_fiscal', 'empresa_direccion_planta', 'puerto_embarque',
                    'empresa_ruc', 'proforma_tolerancia_pct']),
    supabase.from('pedido_cuentas')
      .select('cuentas_bancarias(banco, tipo, moneda, numero, swift, titular, direccion_banco, principal)').eq('pedido_id', pedidoId),
    supabase.from('contratos').select('id', { count: 'exact', head: true }).eq('pedido_id', pedidoId),
  ]);
  if (!ped) return { ok: false, mensaje: 'Ese pedido no existe.' };
  if (!lineas?.length) return { ok: false, mensaje: 'El pedido no tiene productos: no hay nada que contratar.' };
  if (ped.ciclo === 'cancelado') return { ok: false, mensaje: `El pedido ${ped.numero_proforma} está cancelado.` };

  const p = new Map((params ?? []).map((x) => [String(x.clave), String(x.valor ?? '')]));
  const cliente = clienteDelDocumento(ped as Record<string, unknown>, uno<Record<string, unknown>>(ped.clientes));
  const destino = uno<Record<string, unknown>>(ped.destinos);
  //  083 · El destino en inglés para el precio y el puerto («VIGO, SPAIN») y en
  //  castellano para la segunda línea del puerto («VIGO, ESPAÑA»), como el modelo.
  const destinoTexto = puertoDestino(destino?.puerto, destino?.pais, 'en');
  const destinoTextoEs = puertoDestino(destino?.puerto, destino?.pais, 'es');
  const moneda = String(ped.moneda ?? 'USD');

  /*
   * ---- Productos, cantidad, precio y empaque (083, puntos 02 y 03) ----
   * Un ÍTEM por producto y talla, en el orden de la proforma: las líneas que
   * solo cambian de saco (el mismo reproductor en sacos de 20 y de 30) son el
   * mismo ítem, como en el contrato del modelo. Cada ítem lleva su precio; si
   * un ítem tiene dos precios (uno por saco), se dice cuál es cuál. Así cada
   * línea de la proforma tiene su ítem y su precio en el contrato.
   */
  let totalKg = 0;
  const items: { en: string; es: string; precios: { precio: number; saco: number }[] }[] = [];
  const pesos: number[] = [];
  let tipoEmpaque = 'sacos';
  let todosReproductores = true;
  for (const l of lineas) {
    const sp = uno<Record<string, unknown>>(l.sku_presentaciones);
    const sku = uno<Record<string, unknown>>(sp?.skus);
    const f = uno<Record<string, unknown>>(sku?.formatos);
    const nombre = nombreComercial({ corte: sku?.corte as string, formatoEn: f?.descripcion_en as string, formatoEs: f?.descripcion_es as string });
    const talla = tallaImpresa(sku?.talla as string, sku?.corte as string) ?? '';
    const en = `${nombre.en}${talla ? `, SIZE: ${talla}` : ''}`;
    const es = `${nombre.es}${talla ? `, TALLAS: ${talla}` : ''}`;
    todosReproductores = todosReproductores && nombre.reproductor;
    totalKg += Number(l.cantidad_tm) * 1000;
    const precio = (Number(l.precio_tm) / 1000) * (1 - Number(l.descuento_pct ?? 0) / 100);
    const saco = Number(uno<Record<string, unknown>>(sp?.presentaciones)?.peso_bulto_kg ?? 0);
    let item = items.find((x) => x.en === en);
    if (!item) { item = { en, es, precios: [] }; items.push(item); }
    if (!item.precios.some((x) => Math.abs(x.precio - precio) < 0.00005)) item.precios.push({ precio, saco });
    pesos.push(saco);
    tipoEmpaque = String(sku?.empaque ?? tipoEmpaque);
  }
  //  Con un solo ítem no se numera: «(1)» suelto sobra.
  const marca = (i: number) => (items.length > 1 ? `(${i + 1}) ` : '');
  const incoterm = [String(ped.incoterm ?? ''), destinoTexto].filter(Boolean).join(' ');
  const unidadSaco = tipoEmpaque === 'cajas' ? 'BOXES' : tipoEmpaque === 'block' ? 'BLOCKS' : 'BAGS';
  const todosLosPrecios = [...new Set(items.flatMap((x) => x.precios.map((pr) => pr.precio.toFixed(4))))];
  const precio = todosLosPrecios.length === 1
    //  Un solo precio para todo: una sola línea, sin numerar.
    ? `${precioKg(items[0].precios[0].precio)} ${moneda}/KG ${incoterm}`
    : items.flatMap((x, i) => x.precios.map((pr) =>
        `${marca(i)}${precioKg(pr.precio)} ${moneda}/KG ${incoterm}` +
        (x.precios.length > 1 && pr.saco > 0 ? ` - ${unidadSaco} X ${pesoCorto(pr.saco)} KG` : ''))).join('\n');
  //  Sin tolerancia en el pedido, la de Configuración (la misma que usa la proforma).
  const tol = ped.tolerancia_pct != null ? Number(ped.tolerancia_pct) : Number(p.get('proforma_tolerancia_pct') ?? 0);

  /* ---- La cuenta: la del pedido en su moneda; si no, la principal ---- */
  let cuenta = (cuentas ?? []).map((c) => uno<Record<string, unknown>>(c.cuentas_bancarias))
    .find((c) => c && c.tipo !== 'detraccion' && c.moneda === moneda);
  if (!cuenta) {
    const { data: principal } = await supabase.from('cuentas_bancarias')
      .select('banco, tipo, moneda, numero, swift, titular, direccion_banco')
      .eq('activo', true).eq('moneda', moneda).neq('tipo', 'detraccion')
      .order('principal', { ascending: false }).limit(1).maybeSingle();
    cuenta = principal ?? undefined;
  }

  /*
   * ---- Documento F: el certificado de captura (083, punto 05) ----
   * Lo decide la cotización (y el pedido lo hereda): tiene un costo adicional
   * y se negocia en cada venta. Solo si nadie lo decidió (pedidos de antes de
   * la 083) se propone para la Unión Europea, como antes.
   */
  const documentoF = llevaCertificadoCaptura(ped.certificado_captura as boolean | null, String(destino?.pais ?? cliente?.pais ?? ''))
    ? { en: 'Catch Certificate', es: 'Certificado de Captura' }
    : { en: '', es: '' };

  /* ---- Quién firma: quien aprobó la cotización, o Gerencia (083) ---- */
  const firmante = await resolverFirmante(supabase, ped as Record<string, unknown>);

  const revision = count ?? 0;
  const proforma = String(ped.numero_proforma);
  const etiqueta = String(cliente?.etiqueta_tax_id ?? (cliente?.pais === 'Perú' ? 'RUC' : 'TAX ID'));
  return {
    ok: true,
    revision,
    datos: {
      numero: numeroContrato(proforma, revision),
      proforma,
      fecha: fechaBilingue(hoyEnLima()),
      vendedor: {
        nombre: p.get('empresa_razon_social') ?? '',
        direccion: (p.get('empresa_domicilio_fiscal') || p.get('empresa_direccion_planta') || '').toUpperCase(),
      },
      comprador: {
        nombre: String(cliente?.razon_social ?? '').toUpperCase(),
        direccion: String(cliente?.direccion ?? '').toUpperCase(),
        documento: cliente?.ruc_tax_id ? `${etiqueta}: ${cliente.ruc_tax_id}.` : '',
      },
      producto: {
        en: items.map((x, i) => `${marca(i)}${x.en}`).join('\n'),
        es: items.map((x, i) => `${marca(i)}${x.es}`).join('\n'),
      },
      cantidad: `${kg(totalKg)} KG${tol > 0 ? ` (+/- ${Number(tol.toFixed(2))}%)` : ''}`,
      precio,
      //  «BAGS OF 30 KG AND/OR 20 KG FOR SEXUAL TENTACLES», como el modelo, si todo son reproductores.
      empaque: `${empaqueEn(tipoEmpaque, pesos)}${todosReproductores && pesos.some((k) => k > 0) ? ' FOR SEXUAL TENTACLES' : ''}`,
      //  El mes: el de embarque; si no, el de la fecha tentativa de despacho; si no, el comprometido.
      periodo: periodoBilingue((ped.mes_embarque as string) ?? (ped.fecha_tentativa_despacho as string) ?? (ped.fecha_comprometida as string) ?? null),
      puertoCarga: String(ped.puerto_embarque ?? p.get('puerto_embarque') ?? 'PAITA, PERU').toUpperCase().replace(/,(?=\S)/g, ', '),
      puertoDescarga: destinoTexto,
      puertoDescargaEs: destinoTextoEs,
      pago: pagoBilingue((ped.forma_pago as FormaPago | null) ?? null, Number(ped.pago_adelanto_pct ?? 0), Number(ped.dias_credito ?? 0), (ped.condicion_pago as string) ?? null),
      banco: {
        nombre: String(cuenta?.banco ?? '').toUpperCase(),
        direccion: String(cuenta?.direccion_banco ?? '').toUpperCase(),
        pais: 'LIMA – PERU',
        swift: String(cuenta?.swift ?? ''),
        cuenta: String(cuenta?.numero ?? ''),
        beneficiario: String(cuenta?.titular || p.get('empresa_razon_social') || '').toUpperCase(),
      },
      documentoF,
      firmante: { nombre: firmante.nombre, cargo: firmante.cargo, ruc: p.get('empresa_ruc') ?? '', usuarioId: firmante.usuarioId, motivo: firmante.motivo },
    },
  };
}

/** Revisa lo que llega de la pantalla: nada vacío donde el contrato no puede quedar en blanco. */
export function revisarDatosContrato(d: DatosContrato): string | null {
  const faltan: string[] = [];
  if (!d.comprador?.nombre?.trim()) faltan.push('el comprador');
  if (!d.comprador?.direccion?.trim()) faltan.push('la dirección del comprador');
  if (!d.producto?.en?.trim() || !d.producto?.es?.trim()) faltan.push('el producto en inglés y castellano');
  if (!d.cantidad?.trim()) faltan.push('la cantidad');
  if (!d.precio?.trim()) faltan.push('el precio');
  if (!d.periodo?.en?.trim() || !d.periodo?.es?.trim()) faltan.push('el periodo de embarque');
  if (!d.puertoCarga?.trim() || !d.puertoDescarga?.trim()) faltan.push('los puertos');
  if (!d.pago?.en?.trim() || !d.pago?.es?.trim()) faltan.push('la forma de pago');
  if (!d.banco?.cuenta?.trim() || !d.banco?.swift?.trim()) faltan.push('la cuenta bancaria y el SWIFT');
  if (faltan.length) return `Falta ${faltan.join(', ')}.`;
  //  Cada texto por separado: el JSON entero siempre trae «}}» al cerrar objetos.
  const textos: string[] = [];
  const recorrer = (o: unknown) => {
    if (typeof o === 'string') textos.push(o);
    else if (o && typeof o === 'object') Object.values(o).forEach(recorrer);
  };
  recorrer(d);
  if (textos.some((t) => /\{\{|\}\}/.test(t))) return 'Hay texto con llaves {{ }}: corríjalo antes de generar.';
  return null;
}
