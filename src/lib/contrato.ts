/**
 * ============================================================================
 *  CONTRATO DE VENTA DESDE UNA COTIZACIÓN APROBADA
 * ============================================================================
 *  Observaciones ERP (oct. 2026), punto 8: «cuando una cotización cambie a
 *  Aprobada, permitir generar un contrato a partir de una plantilla
 *  institucional, completándolo automáticamente con cliente, productos,
 *  cantidades, precios y condiciones. Debe poder revisarse y descargarse».
 *
 *  LA PLANTILLA es texto con marcadores entre llaves dobles —{{cliente}},
 *  {{productos}}— guardado en `plantillas_documento`. Gerencia la cambia
 *  desde la propia pantalla del contrato. Cuando llegue la plantilla
 *  institucional se pega ahí: no hay que tocar código.
 *
 *  Un marcador que la plantilla use y el sistema no conozca se deja tal cual
 *  y se avisa: es preferible ver «{{puerto}}» en la revisión que un hueco en
 *  blanco que nadie nota hasta que el cliente lo firma.
 * ============================================================================
 */
import type { crearClienteServidor } from '@/lib/supabase/servidor';
import { uno } from '@/lib/relaciones';
import { importeEnLetras } from '@/lib/importeEnLetras';
import { fechaLarga } from '@/lib/formato';
import { hoyEnLima } from '@/lib/fechas';
import {
  FORMAS_PAGO, calcularAdelanto, diasDePlazos, plazoReferencia, totalConImpuesto,
  type FormaPago, type Prioridad,
} from '@/lib/condicionesVenta';

type Cliente = Awaited<ReturnType<typeof crearClienteServidor>>;

/** Lo que el sistema sabe poner, con su explicación para quien edita la plantilla. */
export const MARCADORES: { clave: string; que: string }[] = [
  { clave: 'empresa', que: 'Razón social de Santa Mónica' },
  { clave: 'ruc_empresa', que: 'RUC de Santa Mónica' },
  { clave: 'direccion_empresa', que: 'Domicilio fiscal de Santa Mónica' },
  { clave: 'cliente', que: 'Razón social del cliente' },
  { clave: 'documento_cliente', que: 'RUC / Tax ID del cliente' },
  { clave: 'direccion_cliente', que: 'Dirección del cliente' },
  { clave: 'pais_cliente', que: 'País del cliente' },
  { clave: 'contacto', que: 'Persona a quien va dirigida la cotización' },
  { clave: 'numero_cotizacion', que: 'Número de la cotización' },
  { clave: 'fecha_cotizacion', que: 'Fecha de la cotización' },
  { clave: 'productos', que: 'Lista de productos: cantidad, precio e importe' },
  { clave: 'toneladas', que: 'Toneladas totales' },
  { clave: 'total', que: 'Importe total con moneda' },
  { clave: 'total_letras', que: 'Importe total en letras' },
  { clave: 'moneda', que: 'USD o PEN' },
  { clave: 'incoterm', que: 'FOB, CFR, CIF…' },
  { clave: 'destino', que: 'Puerto y país de destino (con coma delante)' },
  { clave: 'forma_pago', que: 'Forma de pago, adelanto y saldo' },
  { clave: 'entrega', que: 'Fecha tentativa de despacho o plazo según prioridad' },
  { clave: 'observaciones', que: 'Observaciones de la cotización' },
  { clave: 'fecha_contrato', que: 'Fecha de hoy, en letras' },
];

const dineroTexto = (n: number, moneda: string) =>
  `${moneda === 'PEN' ? 'S/' : 'US$'} ${n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tmTexto = (n: number) => n.toLocaleString('es-PE', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export type ContratoArmado = {
  titulo: string;
  cuerpo: string;
  /** Marcadores de la plantilla que el sistema no sabe llenar. */
  sinResolver: string[];
  plantillaActualizada: string | null;
};

/** Reemplaza los marcadores. Devuelve el texto y los que quedaron sin llenar. */
export function llenarPlantilla(plantilla: string, valores: Record<string, string>) {
  const sinResolver = new Set<string>();
  const texto = plantilla.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (entero, clave: string) => {
    const k = clave.toLowerCase();
    if (k in valores) return valores[k];
    sinResolver.add(k);
    return entero;
  });
  return { texto, sinResolver: [...sinResolver] };
}

export async function armarContrato(supabase: Cliente, cotizacionId: number): Promise<ContratoArmado | null> {
  const [{ data: cot }, { data: lineas }, { data: params }, { data: plantilla }] = await Promise.all([
    supabase.from('cotizaciones')
      .select('*, clientes(razon_social, ruc_tax_id, etiqueta_tax_id, direccion, pais), destinos(puerto, pais)')
      .eq('id', cotizacionId).maybeSingle(),
    supabase.from('cotizacion_lineas')
      .select('cantidad_tm, precio_tm, descuento_pct, orden, sku_presentaciones(skus(codigo, corte, especies(nombre), formatos(nombre)), presentaciones(descripcion))')
      .eq('cotizacion_id', cotizacionId).order('orden'),
    supabase.from('parametros').select('clave, valor')
      .or('clave.like.empresa_%,clave.eq.igv_porcentaje,clave.like.plazo_dias_%'),
    supabase.from('plantillas_documento').select('titulo, cuerpo, actualizado_en').eq('clave', 'contrato_venta').maybeSingle(),
  ]);
  if (!cot || !plantilla) return null;

  const p = new Map((params ?? []).map((x) => [String(x.clave), String(x.valor ?? '')]));
  const cliente = uno<Record<string, unknown>>(cot.clientes);
  const destino = uno<Record<string, unknown>>(cot.destinos);
  const moneda = String(cot.moneda ?? 'USD');

  /* ---- Los productos, uno por línea, numerados ---- */
  let subtotal = 0;
  let toneladas = 0;
  const productos = (lineas ?? []).map((l, i) => {
    const sp = uno<Record<string, unknown>>(l.sku_presentaciones);
    const sku = uno<Record<string, unknown>>(sp?.skus);
    const pres = uno<Record<string, unknown>>(sp?.presentaciones);
    const precio = Number(l.precio_tm) * (1 - Number(l.descuento_pct ?? 0) / 100);
    const importe = Number(l.cantidad_tm) * precio;
    subtotal += importe;
    toneladas += Number(l.cantidad_tm);
    const nombre = [
      uno<Record<string, unknown>>(sku?.especies)?.nombre,
      uno<Record<string, unknown>>(sku?.formatos)?.nombre,
      sku?.corte,
    ].filter(Boolean).join(' ');
    return `${i + 1}. ${sku?.codigo ?? ''} · ${nombre} · ${pres?.descripcion ?? ''}: ` +
      `${tmTexto(Number(l.cantidad_tm))} TM a ${dineroTexto(precio, moneda)} por TM = ${dineroTexto(importe, moneda)}`;
  });

  const total = totalConImpuesto(subtotal, cliente?.pais as string, Number(p.get('igv_porcentaje') ?? 18));

  /* ---- La forma de pago, con el adelanto en cifras ---- */
  const forma = (cot.forma_pago as FormaPago | null) ?? null;
  const pct = Number(cot.adelanto_pct ?? 0);
  const a = calcularAdelanto(total, pct, null);
  const formaPago = !forma
    ? 'A convenir entre las partes.'
    : pct > 0
      ? `${FORMAS_PAGO[forma]}: ${pct} % de adelanto (${dineroTexto(a.monto, moneda)}) y el saldo de ` +
        `${dineroTexto(total - a.monto, moneda)} conforme a lo acordado.`
      : `${FORMAS_PAGO[forma]}.`;

  /* ---- La entrega: la fecha tentativa o el plazo de la prioridad ---- */
  const plazo = plazoReferencia(
    (cot.prioridad ?? 'normal') as Prioridad,
    String(cot.fecha ?? hoyEnLima()).slice(0, 10),
    (cot.fecha_tentativa_despacho as string) ?? null,
    diasDePlazos((params ?? []) as { clave: string; valor: unknown }[])
  );
  const entrega = plazo.origen === 'tentativa'
    ? `Fecha tentativa de despacho: ${fechaLarga(plazo.fecha)}.`
    : `Plazo de entrega referencial (prioridad ${plazo.texto.toLowerCase()}): hasta el ${fechaLarga(plazo.fecha)}.`;

  const valores: Record<string, string> = {
    empresa: p.get('empresa_razon_social') ?? '',
    ruc_empresa: p.get('empresa_ruc') ?? '',
    direccion_empresa: p.get('empresa_domicilio_fiscal') || p.get('empresa_direccion_planta') || '',
    cliente: String(cliente?.razon_social ?? ''),
    documento_cliente: `${cliente?.etiqueta_tax_id ?? (cliente?.pais === 'Perú' ? 'RUC' : 'Tax ID')} ${cliente?.ruc_tax_id ?? '—'}`,
    direccion_cliente: String(cliente?.direccion ?? '—'),
    pais_cliente: String(cliente?.pais ?? ''),
    contacto: [cot.contacto_nombre, cot.contacto_cargo].filter(Boolean).join(', ') || '—',
    numero_cotizacion: String(cot.numero),
    fecha_cotizacion: fechaLarga(String(cot.fecha ?? '').slice(0, 10)),
    productos: productos.join('\n') || '—',
    toneladas: `${tmTexto(toneladas)} TM`,
    total: dineroTexto(total, moneda),
    total_letras: importeEnLetras(total, moneda),
    moneda,
    incoterm: String(cot.incoterm ?? ''),
    destino: destino?.puerto ? `, ${destino.puerto}${destino.pais ? `, ${destino.pais}` : ''}` : '',
    forma_pago: formaPago,
    entrega,
    observaciones: (cot.observaciones as string)?.trim() || 'Ninguna.',
    fecha_contrato: fechaLarga(hoyEnLima()),
  };

  const { texto, sinResolver } = llenarPlantilla(String(plantilla.cuerpo), valores);
  const tit = llenarPlantilla(String(plantilla.titulo), valores);
  return {
    titulo: tit.texto,
    cuerpo: texto,
    sinResolver: [...new Set([...sinResolver, ...tit.sinResolver])],
    plantillaActualizada: (plantilla.actualizado_en as string) ?? null,
  };
}
