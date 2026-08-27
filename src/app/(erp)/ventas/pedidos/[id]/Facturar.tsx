'use client';

/**
 * ============================================================================
 *  EMITIR EL COMPROBANTE DEL PEDIDO
 * ============================================================================
 *  Enseña la factura ANTES de emitirla: qué tipo sale, con qué IGV, línea por
 *  línea y con los totales calculados. Emitir a ciegas y descubrir después que
 *  salió boleta en vez de factura obliga a anular y volver a emitir, que en el
 *  Perú es un trámite y no un clic.
 *
 *  El tipo de comprobante NO se elige: se deduce del país y del RUC. La
 *  pantalla lo explica ahí mismo, para que quede claro que no es un olvido.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icono } from '@/components/estructura/Icono';
import { previaFactura, emitirComprobante, type Previa } from '@/app/(erp)/finanzas/facturas/acciones';

const cifra = (n: number) =>
  n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function BotonFacturar({ pedidoId, puede }: { pedidoId: number; puede: boolean }) {
  const router = useRouter();
  const [cargando, iniciarCarga] = useTransition();
  const [emitiendo, iniciarEmision] = useTransition();

  const [previa, setPrevia] = useState<Previa | null>(null);
  const [resultado, setResultado] = useState<{ tipo: 'ok' | 'mal'; texto: string; detalles?: string[] } | null>(null);

  function abrir() {
    setResultado(null);
    iniciarCarga(async () => setPrevia(await previaFactura(pedidoId)));
  }

  function emitir() {
    setResultado(null);
    iniciarEmision(async () => {
      const r = await emitirComprobante(pedidoId);
      if (!r.ok) { setResultado({ tipo: 'mal', texto: r.mensaje, detalles: r.detalles }); return; }
      setResultado({ tipo: 'ok', texto: r.mensaje });
      setPrevia(null);
      router.refresh();
    });
  }

  if (!puede) return null;

  return (
    <>
      <button type="button" className="btn btn-primario"
              onClick={previa ? () => setPrevia(null) : abrir}
              disabled={cargando || emitiendo}>
        <Icono nombre="facturas" tamano={15} />
        {cargando ? 'Preparando…' : previa ? 'Cancelar' : 'Emitir comprobante'}
      </button>

      {resultado && (
        <div className={`ficha-aviso ${resultado.tipo === 'ok' ? 'ficha-aviso-info' : 'ficha-aviso-critico'} documento-mensaje`}
             role={resultado.tipo === 'ok' ? 'status' : 'alert'}>
          <Icono nombre="alerta" tamano={17} />
          <span>
            <strong>{resultado.texto}</strong>
            {resultado.detalles?.length ? (
              <ul className="documento-detalles">
                {resultado.detalles.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            ) : null}
          </span>
        </div>
      )}

      {previa && (
        <div className="facturar documento-mensaje">
          <div className="facturar-cab">
            <div>
              <strong>{previa.titulo}</strong>
              <span>
                {previa.cliente} · {previa.pais}
                {previa.identificacion !== '—' && <> · <span className="mono">{previa.identificacion}</span></>}
              </span>
            </div>
            <span className="facturar-tipo" data-tipo={previa.tipo}>{previa.tipo}</span>
          </div>

          {/* Por qué sale este comprobante y no otro */}
          <p className="facturar-regla">
            <Icono nombre="alerta" tamano={15} />
            <span>
              {previa.igvPct === 0
                ? 'Cliente del extranjero: factura de exportación, inafecta al IGV.'
                : previa.tipo === 'factura'
                  ? `Cliente peruano con RUC válido: factura electrónica con IGV del ${previa.igvPct} %.`
                  : `Cliente peruano sin RUC válido: sale BOLETA, que no da derecho a crédito fiscal.`}
            </span>
          </p>

          {previa.avisos.length > 0 && (
            <div className="facturar-avisos">
              <strong>Antes de emitir</strong>
              <ul>{previa.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>
            </div>
          )}

          {previa.impedimentos.length > 0 && (
            <div className="facturar-bloqueo">
              <strong><Icono nombre="alerta" tamano={15} /> No se puede emitir</strong>
              <ul>{previa.impedimentos.map((a, i) => <li key={i}>{a}</li>)}</ul>
            </div>
          )}

          <div className="tabla-envoltorio">
            <table className="datos">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="num">TM</th>
                  <th className="num">Precio</th>
                  <th className="num">Importe</th>
                </tr>
              </thead>
              <tbody>
                {previa.lineas.map((l, i) => (
                  <tr key={i}>
                    <td>{l.producto}</td>
                    <td className="num mono">{l.tm.toFixed(3)}</td>
                    <td className="num mono">{cifra(l.precio)}</td>
                    <td className="num mono"><strong>{cifra(l.importe)}</strong></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={3} className="num">Subtotal</th>
                  <th className="num mono">{previa.moneda} {cifra(previa.subtotal)}</th>
                </tr>
                <tr>
                  <th colSpan={3} className="num">IGV {previa.igvPct} %</th>
                  <th className="num mono">{previa.moneda} {cifra(previa.igv)}</th>
                </tr>
                <tr className="facturar-total">
                  <th colSpan={3} className="num">Total</th>
                  <th className="num mono">{previa.moneda} {cifra(previa.total)}</th>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="facturar-vence">Vence el {previa.vencimiento}.</p>

          {previa.puede && (
            <div className="acciones-fila">
              <button type="button" className="btn btn-primario" onClick={emitir} disabled={emitiendo}>
                <Icono nombre="facturas" tamano={15} />
                {emitiendo ? 'Emitiendo…' : `Emitir ${previa.titulo.toLowerCase()}`}
              </button>
              <button type="button" className="btn btn-sutil" onClick={() => setPrevia(null)}>
                Cancelar
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
