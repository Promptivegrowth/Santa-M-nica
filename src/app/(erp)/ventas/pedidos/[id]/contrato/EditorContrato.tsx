'use client';

/**
 * ============================================================================
 *  REVISAR EL CONTRATO ANTES DE GENERARLO
 * ============================================================================
 *  Son los campos que en el modelo de Santa Mónica están en amarillo, ya
 *  llenos con la proforma. Se corrigen aquí —por ejemplo, agregar «GRADE B»
 *  al producto— y se genera. El texto legal fijo no se toca: es el del modelo.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { DatosContrato } from '@/lib/contratoVenta';
import { generarContrato } from './acciones';

type Ruta = string;

function Campo({ etiqueta, valor, onCambio, lineas = 1, nombre, ayuda }: {
  etiqueta: string; valor: string; onCambio: (v: string) => void; lineas?: number; nombre: Ruta; ayuda?: string;
}) {
  return (
    <label className="form-campo contrato-campo">
      <span className="etiqueta">{etiqueta}</span>
      {lineas > 1
        ? <textarea className="campo" rows={lineas} name={nombre} value={valor} onChange={(e) => onCambio(e.target.value)} />
        : <input className="campo" name={nombre} value={valor} onChange={(e) => onCambio(e.target.value)} />}
      {ayuda && <small>{ayuda}</small>}
    </label>
  );
}

export function EditorContrato({ pedidoId, inicial, siguiente }: { pedidoId: number; inicial: DatosContrato; siguiente: string }) {
  const router = useRouter();
  const [d, setD] = useState<DatosContrato>(inicial);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [guardando, iniciar] = useTransition();

  /** Cambia un campo anidado: ['comprador', 'nombre']. */
  const poner = (ruta: string[], v: string) => setD((previo) => {
    const copia = structuredClone(previo) as Record<string, unknown>;
    let o = copia;
    for (const k of ruta.slice(0, -1)) o = o[k] as Record<string, unknown>;
    o[ruta[ruta.length - 1]] = v;
    return copia as DatosContrato;
  });
  const val = (ruta: string[]) => ruta.reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], d) as string ?? '';
  const campo = (etiqueta: string, ruta: string[], lineas = 1, ayuda?: string) => (
    <Campo etiqueta={etiqueta} nombre={ruta.join('.')} valor={val(ruta)} onCambio={(v) => poner(ruta, v)} lineas={lineas} ayuda={ayuda} />
  );

  return (
    <div className="contrato-editor" data-bloque="contrato-editor">
      <p className="pie-explicativo" style={{ margin: 0 }}>
        Se generará como <b className="mono" data-siguiente={siguiente}>{siguiente}</b>, con fecha de hoy. Lo que está aquí
        es lo que en el modelo va resaltado en amarillo; el resto del contrato es el texto fijo de Santa Mónica.
      </p>

      <fieldset className="form-bloque">
        <legend>Comprador</legend>
        <div className="contrato-rejilla">
          {campo('Razón social', ['comprador', 'nombre'])}
          {campo('Documento tributario', ['comprador', 'documento'], 1, 'Como lo pide el cliente: USCI, Tax ID, NIF, RFC…')}
          {campo('Dirección', ['comprador', 'direccion'], 2)}
        </div>
      </fieldset>

      <fieldset className="form-bloque">
        <legend>Producto y condiciones</legend>
        <div className="contrato-rejilla">
          {campo('Product (inglés)', ['producto', 'en'], 2, 'Una línea por producto. Se puede agregar el grado: «, GRADE B».')}
          {campo('Producto (castellano)', ['producto', 'es'], 2)}
          {campo('Quantity / Cantidad', ['cantidad'], 1, 'Kilos totales y tolerancia de la proforma.')}
          {campo('Price / Precio', ['precio'], 2, 'Precio por kilo con el incoterm y el destino.')}
          {campo('Packing / Empaquetado', ['empaque'])}
          {campo('Period for shipment', ['periodo', 'en'])}
          {campo('Periodo de envío', ['periodo', 'es'])}
          {campo('Loading port / Puerto de carga', ['puertoCarga'])}
          {campo('Destination port / Puerto de descarga', ['puertoDescarga'])}
        </div>
      </fieldset>

      <fieldset className="form-bloque">
        <legend>Pago y banco</legend>
        <div className="contrato-rejilla">
          {campo('Payment terms (inglés)', ['pago', 'en'], 2, 'Una línea por tramo: «20% ADVANCE PAYMENT».')}
          {campo('Términos de pago (castellano)', ['pago', 'es'], 2)}
          {campo('Payment to / Banco', ['banco', 'nombre'])}
          {campo('Dirección del banco', ['banco', 'direccion'])}
          {campo('País', ['banco', 'pais'])}
          {campo('SWIFT', ['banco', 'swift'])}
          {campo('Cuenta bancaria', ['banco', 'cuenta'])}
          {campo('Beneficiario', ['banco', 'beneficiario'])}
        </div>
      </fieldset>

      <fieldset className="form-bloque">
        <legend>Documento F (opcional)</legend>
        <div className="contrato-rejilla">
          {campo('Document F (inglés)', ['documentoF', 'en'], 1, 'Vacío = el contrato no lo lleva. Se propone el certificado de captura para la Unión Europea.')}
          {campo('Documento F (castellano)', ['documentoF', 'es'])}
        </div>
      </fieldset>

      <div className="acciones-fila">
        <button type="button" className="btn btn-primario" disabled={guardando} data-accion="generar-contrato"
                onClick={() => {
                  setAviso(null);
                  iniciar(async () => {
                    const r = await generarContrato(pedidoId, d);
                    setAviso({ ok: r.ok, texto: r.mensaje });
                    if (r.ok) router.refresh();
                  });
                }}>
          {guardando ? 'Generando…' : `Generar ${siguiente}`}
        </button>
        <button type="button" className="btn btn-sutil" disabled={guardando} onClick={() => { setD(inicial); setAviso(null); }}>
          Volver a lo de la proforma
        </button>
      </div>
      {aviso && (
        <p role={aviso.ok ? 'status' : 'alert'} className={aviso.ok ? 'form-mensaje ok' : 'form-mensaje error'}>{aviso.texto}</p>
      )}
    </div>
  );
}
