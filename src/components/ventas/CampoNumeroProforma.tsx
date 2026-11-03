'use client';

/**
 * ============================================================================
 *  CAMPO «N.º DE PROFORMA» (082)
 * ============================================================================
 *  Oliver pidió poder poner el número de proforma que corresponde: Santa Mónica
 *  tiene su numeración real. El campo llega con el número PROPUESTO por el
 *  sistema (el siguiente de la numeración) y se puede cambiar.
 *
 *  Lo usan el pedido directo, los tres «Convertir en pedido» de la cotización
 *  (ficha, listado y contrato) y el «Cambiar número» de la ficha del pedido,
 *  para que en todos se lea lo mismo:
 *   · si la forma está mal (barra, tildes, vacío…), lo dice al escribir;
 *   · si es un número de la serie MAYOR que el propuesto, avisa de que la
 *     numeración automática va a seguir desde ahí (antes de guardar);
 *   · si se cambió, ofrece volver al propuesto.
 *  Que esté repetido solo lo puede decir el servidor, al guardar.
 * ============================================================================
 */
import { useCallback, useId, useState } from 'react';
import { avisoSaltoNumeracion, normalizarNumeroProforma, problemaNumeroProforma, LARGO_MAX_PROFORMA } from '@/lib/numeroProforma';
import { numeroProformaPropuesto } from '@/app/(erp)/ventas/pedidos/acciones';
import { accionSegura } from '@/lib/accionSegura';

/**
 * El número propuesto, pedido al servidor en el momento de convertir (no al
 * abrir la pantalla: entre que se abre la cotización y se convierte, otro
 * pedido pudo llevarse el número). `pedir()` lo trae y lo pone en el campo.
 */
export function usePropuestaProforma() {
  const [propuesto, setPropuesto] = useState<string | null>(null);
  const [valor, setValor] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pedir = useCallback(async () => {
    setError(null);
    const r = await accionSegura(() => numeroProformaPropuesto());
    if (r.ok) { setPropuesto(r.numero); setValor(r.numero); }
    else setError(r.mensaje);
    return r.ok;
  }, []);
  return { propuesto, valor, setValor, pedir, error };
}

export function CampoNumeroProforma({
  valor,
  onChange,
  propuesto,
  disabled = false,
  compacto = false,
  etiqueta = 'N.º de proforma *',
  ayuda,
  error = null,
}: {
  valor: string;
  onChange: (v: string) => void;
  /** El que propone el sistema; null mientras se consulta (o en «Cambiar número»). */
  propuesto: string | null;
  disabled?: boolean;
  /** En la fila del listado: sin etiqueta ni ayuda larga. */
  compacto?: boolean;
  etiqueta?: string;
  /** Texto de ayuda propio (si no, el de «propuesto / escrito a mano»). */
  ayuda?: string;
  /** Lo que contestó el servidor sobre el número (p. ej. «Ya existe…»), junto al campo. */
  error?: string | null;
}) {
  const id = useId();
  const tocado = valor.trim() !== '' && !!propuesto && normalizarNumeroProforma(valor) !== normalizarNumeroProforma(propuesto);
  const problema = (valor.trim() === '' ? null : problemaNumeroProforma(valor)) ?? error;
  const salto = problema ? null : avisoSaltoNumeracion(valor, propuesto);

  const entrada = (
    <input
      id={id}
      className="campo mono"
      type="text"
      name="numero_proforma"
      data-campo="numero-proforma"
      autoComplete="off"
      spellCheck={false}
      maxLength={LARGO_MAX_PROFORMA + 10}
      placeholder={propuesto ?? 'Consultando…'}
      value={valor}
      disabled={disabled}
      aria-invalid={problema ? 'true' : 'false'}
      style={compacto ? { width: '8.5rem', padding: '.15rem .4rem', fontSize: '.74rem' } : undefined}
      onChange={(e) => onChange(e.target.value)}
      title={compacto ? 'N.º de proforma: el propuesto por el sistema, o el número que corresponda' : undefined}
    />
  );

  if (compacto) {
    return (
      <>
        {entrada}
        {(problema || salto) && (
          <span className="accion-error" data-aviso-numero={problema ? 'problema' : 'salto'} style={{ maxWidth: '18rem' }}>
            {problema ?? salto}
          </span>
        )}
      </>
    );
  }

  return (
    <label className="form-campo" htmlFor={id} data-bloque="numero-proforma">
      <span className="etiqueta">{etiqueta}</span>
      {entrada}
      {problema ? (
        <span className="form-aviso-campo" data-aviso-numero="problema">{problema}</span>
      ) : salto ? (
        <span className="form-aviso-campo" data-aviso-numero="salto">{salto}</span>
      ) : null}
      <small data-numero-origen={tocado ? 'manual' : 'propuesto'}>
        {ayuda ?? (tocado ? (
          <>
            Escrito a mano.{' '}
            <button type="button" className="enlace-boton" disabled={disabled} onClick={() => onChange(propuesto ?? '')}>
              Volver al propuesto ({propuesto})
            </button>
          </>
        ) : propuesto
          ? 'Propuesto por el sistema: el siguiente de la numeración. Puede cambiarlo por el número que corresponda.'
          : 'Consultando el próximo número…')}
      </small>
    </label>
  );
}
