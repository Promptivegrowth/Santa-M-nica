/**
 * ============================================================================
 *  ENTREGA Y PAGO · el mismo bloque en la cotización y en la proforma
 * ============================================================================
 *  Observaciones de octubre, puntos 3, 4, 5 y 6:
 *    · de dónde salió el tipo de cambio y de qué día es,
 *    · la fecha tentativa de despacho o, si no hay, el plazo de la prioridad,
 *    · la forma de pago, el adelanto calculado, lo abonado y la diferencia.
 *  Los cálculos son los de `condicionesVenta`: los mismos que el formulario.
 * ============================================================================
 */
import { Panel } from '@/components/ui/Pagina';
import { RegistrarAbono } from './RegistrarAbono';
import { dinero, fecha, num } from '@/lib/formato';
import {
  FORMAS_PAGO, calcularAdelanto, plazoReferencia, type FormaPago, type Prioridad,
} from '@/lib/condicionesVenta';

export function BloqueCondiciones({
  tipo, id, moneda, total, doc, desde, plazos, hoy, puedeRegistrarAbono, puedeVerImportes,
}: {
  tipo: 'cotizacion' | 'pedido';
  id: number;
  moneda: 'USD' | 'PEN';
  /** El total que paga el cliente (con IGV si es nacional). */
  total: number;
  doc: Record<string, unknown>;
  /** Desde qué fecha corre el plazo de la prioridad: la de la cotización o la solicitud del pedido. */
  desde: string;
  plazos: Record<Prioridad, number>;
  hoy: string;
  puedeRegistrarAbono: boolean;
  puedeVerImportes: boolean;
}) {
  const prioridad = ((doc.prioridad as string) ?? 'normal') as Prioridad;
  const plazo = plazoReferencia(prioridad, desde, (doc.fecha_tentativa_despacho as string) ?? null, plazos);
  const forma = (doc.forma_pago as FormaPago | null) ?? null;
  const pct = Number(tipo === 'cotizacion' ? doc.adelanto_pct ?? 0 : doc.pago_adelanto_pct ?? 0);
  const abonado = doc.adelanto_abonado === null || doc.adelanto_abonado === undefined ? null : Number(doc.adelanto_abonado);
  const a = calcularAdelanto(total, pct, abonado);
  const fuente = doc.tipo_cambio_fuente as string | null;

  return (
    <Panel titulo="Entrega y pago" className="mb-espacio">
      <dl className="ficha" data-bloque="condiciones">
        <div>
          <dt>Tipo de cambio</dt>
          <dd data-tc-fuente={fuente ?? 'sin-dato'}>
            S/ {num(Number(doc.tipo_cambio ?? 0), 3)} por US$
            <br />
            <small style={{ color: 'var(--tinta-3)' }}>
              {fuente === 'sunat'
                ? `SUNAT · ${doc.tipo_cambio_clase ?? 'venta'} · publicado el ${fecha(doc.tipo_cambio_fecha as string)}`
                : fuente === 'manual'
                  ? `Escrito a mano${doc.tipo_cambio_fecha ? ` el ${fecha(doc.tipo_cambio_fecha as string)}` : ''}`
                  : 'Anterior al tipo de cambio automático'}
            </small>
          </dd>
        </div>
        <div>
          <dt>Fecha tentativa de despacho</dt>
          <dd>{doc.fecha_tentativa_despacho ? fecha(doc.fecha_tentativa_despacho as string) : <span style={{ color: 'var(--tinta-3)' }}>No se indicó</span>}</dd>
        </div>
        <div>
          <dt>Plazo de referencia</dt>
          <dd data-plazo={plazo.origen} data-fecha={plazo.fecha}>
            <strong>{fecha(plazo.fecha)}</strong>
            <br />
            <small style={{ color: 'var(--tinta-3)' }}>
              {plazo.origen === 'tentativa'
                ? `La fecha tentativa manda · prioridad ${plazo.texto.toLowerCase()}`
                : `Por prioridad: ${plazo.texto.toLowerCase()}`}
            </small>
          </dd>
        </div>
        <div><dt>Forma de pago</dt><dd>{forma ? FORMAS_PAGO[forma] : (doc.condicion_pago as string) ?? 'Sin definir'}</dd></div>
        <div><dt>% de adelanto</dt><dd>{pct > 0 ? `${num(pct, pct % 1 ? 2 : 0)} %` : '—'}</dd></div>
        {puedeVerImportes && (
          <>
            <div><dt>Monto del adelanto</dt><dd data-adelanto="monto">{pct > 0 ? dinero(a.monto, moneda, 2) : '—'}</dd></div>
            <div>
              <dt>Monto abonado</dt>
              <dd data-adelanto="abonado">
                {a.abonado === null ? <span style={{ color: 'var(--tinta-3)' }}>Sin registrar</span> : (
                  <>{dinero(a.abonado, moneda, 2)}{doc.adelanto_abonado_en ? <small style={{ color: 'var(--tinta-3)' }}> · {fecha(doc.adelanto_abonado_en as string)}</small> : null}</>
                )}
              </dd>
            </div>
            <div>
              <dt>Diferencia</dt>
              <dd data-adelanto="diferencia" data-valor={a.diferencia ?? ''}
                  style={{ fontWeight: 600, color: a.diferencia === null ? undefined : a.diferencia < -0.005 ? 'var(--critico)' : a.diferencia > 0.005 ? 'var(--atencion)' : 'var(--ok)' }}>
                {a.diferencia === null ? '—'
                  : a.diferencia < -0.005 ? `Falta ${dinero(-a.diferencia, moneda, 2)}`
                  : a.diferencia > 0.005 ? `Abonó ${dinero(a.diferencia, moneda, 2)} de más`
                  : 'Adelanto cubierto'}
              </dd>
            </div>
          </>
        )}
      </dl>
      {puedeRegistrarAbono && puedeVerImportes && (
        <div style={{ padding: '.2rem 1rem .9rem' }}>
          <RegistrarAbono tipo={tipo} id={id} abonado={a.abonado} fecha={(doc.adelanto_abonado_en as string) ?? null} hoy={hoy} />
        </div>
      )}
    </Panel>
  );
}
