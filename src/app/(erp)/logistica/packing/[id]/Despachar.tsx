'use client';

/**
 * ============================================================================
 *  DESPACHAR EL CONTENEDOR
 * ============================================================================
 *  El botón que saca la mercadería de cámara. Es la operación menos reversible
 *  del sistema: escribe salidas en el Kardex, y el Kardex no se puede editar.
 *
 *  POR ESO LA PANTALLA HACE TRES COSAS ANTES DE DEJAR PULSARLO
 *
 *  1. Enseña qué va a salir: cuántos lotes, cuántos bultos, cuántas toneladas
 *     y hacia dónde. Nadie debería despachar sin ver eso.
 *  2. Separa lo que IMPIDE despachar de lo que solo conviene saber. Sin plano
 *     de estiba no se puede; sin guía de remisión sí se puede, pero hay que
 *     saberlo antes de que el camión salga a la carretera.
 *  3. Pide escribir el número del contenedor. No es burocracia: obliga a mirar
 *     la matrícula del contenedor que se está despachando, que es exactamente
 *     el error que se quiere evitar.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icono } from '@/components/estructura/Icono';
import { ejecutarDespacho, revisarDespacho, type Revision } from '@/app/(erp)/logistica/despachos/acciones';

export function BotonDespachar({
  packingListId,
  puede,
}: {
  packingListId: number;
  puede: boolean;
}) {
  const router = useRouter();
  const [cargando, iniciarCarga] = useTransition();
  const [despachando, iniciarDespacho] = useTransition();

  const [revision, setRevision] = useState<Revision | null>(null);
  const [escrito, setEscrito] = useState('');
  const [resultado, setResultado] = useState<{ tipo: 'ok' | 'mal'; texto: string; detalles?: string[] } | null>(null);

  function abrir() {
    setResultado(null);
    iniciarCarga(async () => {
      const r = await revisarDespacho(packingListId);
      setRevision(r);
      setEscrito('');
    });
  }

  function despachar() {
    setResultado(null);
    iniciarDespacho(async () => {
      const r = await ejecutarDespacho(packingListId);
      if (!r.ok) {
        setResultado({ tipo: 'mal', texto: r.mensaje, detalles: r.detalles });
        return;
      }
      setResultado({ tipo: 'ok', texto: r.mensaje });
      setRevision(null);
      router.refresh();
    });
  }

  if (!puede) return null;

  /*
   * Si el packing no tiene contenedor cargado, no se puede pedir que se
   * escriba: se confirma con el código del packing, que siempre existe.
   */
  const aEscribir = revision?.contenedor ?? revision?.packing ?? '';
  const listo = escrito.trim().toUpperCase() === aEscribir.toUpperCase();

  return (
    <>
      <button type="button" className="btn btn-primario"
              onClick={revision ? () => setRevision(null) : abrir}
              disabled={cargando || despachando}>
        <Icono nombre="despachos" tamano={15} />
        {cargando ? 'Revisando…' : revision ? 'Cancelar' : 'Despachar'}
      </button>

      {resultado && (
        <div
          className={`ficha-aviso ${resultado.tipo === 'ok' ? 'ficha-aviso-info' : 'ficha-aviso-critico'} documento-mensaje`}
          role={resultado.tipo === 'ok' ? 'status' : 'alert'}
        >
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

      {revision && (
        <div className="despachar documento-mensaje">
          <div className="despachar-cab">
            <strong>Va a salir de cámara</strong>
            <span>Esta operación no se puede deshacer.</span>
          </div>

          <dl className="despachar-datos">
            <div><dt>Packing</dt><dd className="mono">{revision.packing}</dd></div>
            <div><dt>Contenedor</dt><dd className="mono">{revision.contenedor ?? '—'}</dd></div>
            <div><dt>Embarque</dt><dd className="mono">{revision.embarque}</dd></div>
            <div><dt>Desde</dt><dd>{revision.almacen}</dd></div>
            <div><dt>Hacia</dt><dd>{revision.destino}</dd></div>
            <div><dt>Lotes</dt><dd>{revision.lotes}</dd></div>
            <div><dt>Bultos</dt><dd>{revision.bultos.toLocaleString('es-PE')}</dd></div>
            <div><dt>Peso</dt><dd>{revision.tm.toFixed(2)} TM</dd></div>
          </dl>

          {revision.impedimentos.length > 0 && (
            <div className="despachar-bloqueo">
              <strong>
                <Icono nombre="alerta" tamano={15} /> No se puede despachar todavía
              </strong>
              <ul>
                {revision.impedimentos.map((x, i) => <li key={i}>{x}</li>)}
              </ul>
            </div>
          )}

          {revision.avisos.length > 0 && (
            <div className="despachar-avisos">
              <strong>Conviene revisar antes de que salga</strong>
              <ul>
                {revision.avisos.map((x, i) => <li key={i}>{x}</li>)}
              </ul>
            </div>
          )}

          {revision.puede && (
            <div className="despachar-confirma">
              <label htmlFor={`conf-${packingListId}`}>
                Para confirmar, escriba{' '}
                <b className="mono">{aEscribir}</b>
                {revision.contenedor ? ' (el número del contenedor)' : ' (el código del packing)'}:
              </label>
              <input
                id={`conf-${packingListId}`}
                className="campo mono"
                value={escrito}
                onChange={(e) => setEscrito(e.target.value)}
                placeholder={aEscribir}
                autoFocus
              />
              <div className="acciones-fila">
                <button type="button" className="btn btn-primario"
                        onClick={despachar} disabled={despachando || !listo}>
                  <Icono nombre="despachos" tamano={15} />
                  {despachando ? 'Despachando…' : 'Sí, despachar'}
                </button>
                <button type="button" className="btn btn-sutil"
                        onClick={() => setRevision(null)} disabled={despachando}>
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
