/**
 * ============================================================================
 *  «CLIENTE EN EL DOCUMENTO» · lo que sale impreso (migración 085)
 * ============================================================================
 *  Punto 01 de «Observaciones ERP 4»: dirección, identificación fiscal y
 *  vendedor tienen que coincidir entre la cotización y la proforma. Este
 *  panel enseña exactamente los datos con los que se imprime el documento
 *  —los fijados al emitirse, o los de la ficha si es anterior a la 085— y,
 *  si la ficha del cliente cambió después, lo dice campo por campo y ofrece
 *  «Actualizar con la ficha del cliente».
 * ============================================================================
 */
import { Panel } from '@/components/ui/Pagina';
import { Icono } from '@/components/estructura/Icono';
import { fechaHora } from '@/lib/formato';
import { clienteDelDocumento, diferenciasConLaFicha, tieneDatosFijados } from '@/lib/datosClienteDocumento';
import { ActualizarDatosCliente } from './ActualizarDatosCliente';

export function PanelDatosCliente({
  tipo,
  id,
  doc,
  ficha,
  vendedor,
  vendedorFicha,
  puede,
  bloqueo = null,
  origen = null,
}: {
  tipo: 'cotizacion' | 'pedido';
  id: number;
  /** El documento (cotización o pedido) con sus columnas cliente_*. */
  doc: Record<string, unknown>;
  /** La ficha del cliente: razon_social, direccion, ruc_tax_id, etiqueta_tax_id. */
  ficha: Record<string, unknown> | null | undefined;
  /** El vendedor del documento y el asignado en la ficha (nombres). */
  vendedor: string | null;
  vendedorFicha: string | null;
  /** ¿Puede actualizar? (quienes venden) */
  puede: boolean;
  /** Por qué no se puede aunque tenga el rol (p. ej. comprobante emitido). */
  bloqueo?: string | null;
  /** En el pedido: el número de la cotización de la que heredó los datos. */
  origen?: string | null;
}) {
  const impreso = clienteDelDocumento(doc, ficha ?? {}) ?? {};
  const diferencias = diferenciasConLaFicha(doc, ficha);
  const fijados = tieneDatosFijados(doc);
  const etiqueta = String(impreso.etiqueta_tax_id ?? '') || 'Identificación';

  return (
    <Panel titulo={tipo === 'pedido' ? 'Cliente en la proforma' : 'Cliente en la cotización'}>
      <dl className="ficha" data-bloque="datos-cliente-documento">
        <div><dt>Razón social</dt><dd data-campo="razon-social">{String(impreso.razon_social ?? '') || '—'}</dd></div>
        <div><dt>Dirección</dt><dd data-campo="direccion">{String(impreso.direccion ?? '') || '—'}</dd></div>
        <div>
          <dt>Identificación fiscal</dt>
          <dd className="mono" data-campo="tax-id">{impreso.ruc_tax_id ? `${etiqueta}: ${String(impreso.ruc_tax_id)}` : '—'}</dd>
        </div>
        <div>
          <dt>Vendedor</dt>
          <dd data-campo="vendedor">
            {vendedor ?? 'Sin vendedor'}
            {vendedorFicha && vendedorFicha !== vendedor && (
              <><br /><small style={{ color: 'var(--atencion)' }}>En la ficha del cliente: {vendedorFicha}</small></>
            )}
          </dd>
        </div>
        <div>
          <dt>Datos tomados</dt>
          <dd>
            <small style={{ color: 'var(--tinta-3)' }}>
              {fijados
                ? origen
                  ? `De la cotización ${origen} (fijados el ${fechaHora(String(doc.cliente_datos_en))})`
                  : `De la ficha del cliente el ${fechaHora(String(doc.cliente_datos_en))}`
                : 'Documento anterior a noviembre 2026: se leen de la ficha del cliente al imprimir.'}
            </small>
          </dd>
        </div>
      </dl>

      {diferencias.length > 0 && (
        <div className="ficha-aviso ficha-aviso-atencion" role="status" data-aviso="datos-cliente-distintos" style={{ margin: '0 1rem .75rem' }}>
          <Icono nombre="alerta" tamano={16} />
          <span>
            <strong>La ficha del cliente cambió desde que se emitió.</strong>{' '}
            {diferencias.map((d) => `${d.campo}: aquí «${d.documento}», en la ficha «${d.ficha}»`).join(' · ')}.
            {' '}El documento sigue imprimiendo lo de aquí hasta que se actualice.
          </span>
        </div>
      )}

      {fijados && (
        <div style={{ padding: '0 1rem 1rem' }}>
          <ActualizarDatosCliente
            tipo={tipo}
            id={id}
            bloqueo={!puede ? 'Lo hacen Gerencia, Operaciones, Comercial o Comercio Exterior.' : bloqueo}
          />
        </div>
      )}
    </Panel>
  );
}
