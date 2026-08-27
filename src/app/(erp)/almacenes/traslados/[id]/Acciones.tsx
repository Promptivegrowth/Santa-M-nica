'use client';

/**
 * ============================================================================
 *  LAS CUATRO FIRMAS DE UN TRASLADO
 * ============================================================================
 *  Solo se ofrece el paso que toca. Un traslado solicitado se puede autorizar,
 *  no aceptar; uno en tránsito se puede aceptar, no volver a despachar. Poner
 *  los cuatro botones siempre visibles y desactivar tres es peor: obliga a
 *  averiguar por qué están apagados.
 *
 *  EL PASO QUE MÁS IMPORTA ES EL ÚLTIMO
 *  Al aceptar se anota lo que REALMENTE llegó, línea por línea. Llega
 *  precargado con lo enviado —que es lo que ocurre casi siempre— y se corrige
 *  lo que no cuadre. Esa diferencia es la que hoy se pierde: el producto que
 *  «salió pero no llegó» y del que nadie tiene registro.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icono } from '@/components/estructura/Icono';
import {
  autorizarTraslado, despacharTraslado, aceptarTraslado, anularTraslado,
} from '../acciones';

export type LineaRecibo = {
  linea_id: number;
  pallet: string;
  producto: string;
  bultos_enviados: number;
  peso_enviado: number;
};

const cifra = (n: number, d = 1) =>
  n.toLocaleString('es-PE', { minimumFractionDigits: d, maximumFractionDigits: d });

export function AccionesTraslado({
  trasladoId,
  estado,
  lineas,
  rol,
}: {
  trasladoId: number;
  estado: string;
  lineas: LineaRecibo[];
  rol: string;
}) {
  const router = useRouter();
  const [trabajando, iniciar] = useTransition();
  const [panel, setPanel] = useState<'despachar' | 'aceptar' | 'anular' | null>(null);
  const [guia, setGuia] = useState('');
  const [motivo, setMotivo] = useState('');
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'mal'; texto: string } | null>(null);

  /** Lo recibido arranca igual a lo enviado: es el caso normal. */
  const [recibido, setRecibido] = useState(
    () => new Map(lineas.map((l) => [l.linea_id, { bultos: l.bultos_enviados, peso: l.peso_enviado, obs: '' }]))
  );

  const puedeAutorizar = ['gerencia', 'operaciones'].includes(rol);
  const puedeMover = ['gerencia', 'operaciones', 'almacen'].includes(rol);

  function correr(accion: () => Promise<{ ok: boolean; mensaje: string }>) {
    setAviso(null);
    iniciar(async () => {
      const r = await accion();
      setAviso({ tipo: r.ok ? 'ok' : 'mal', texto: r.mensaje });
      if (r.ok) { setPanel(null); router.refresh(); }
    });
  }

  const hayDiferencias = lineas.some((l) => {
    const r = recibido.get(l.linea_id)!;
    return Math.abs(r.peso - l.peso_enviado) > 0.01 || r.bultos !== l.bultos_enviados;
  });

  return (
    <>
      {/* ------------- Botón del paso que toca ------------- */}
      {estado === 'borrador' && puedeAutorizar && (
        <button type="button" className="btn btn-primario" disabled={trabajando}
                onClick={() => correr(() => autorizarTraslado(trasladoId))}>
          <Icono nombre="guardar" tamano={15} />
          {trabajando ? 'Autorizando…' : 'Autorizar'}
        </button>
      )}

      {estado === 'autorizado' && puedeMover && (
        <button type="button" className="btn btn-primario"
                onClick={() => setPanel(panel === 'despachar' ? null : 'despachar')}>
          <Icono nombre="traslados" tamano={15} />
          {panel === 'despachar' ? 'Cancelar' : 'Despachar'}
        </button>
      )}

      {estado === 'en_transito' && puedeMover && (
        <button type="button" className="btn btn-primario"
                onClick={() => setPanel(panel === 'aceptar' ? null : 'aceptar')}>
          <Icono nombre="ingresos" tamano={15} />
          {panel === 'aceptar' ? 'Cancelar' : 'Recibir en destino'}
        </button>
      )}

      {['borrador', 'autorizado'].includes(estado) && puedeAutorizar && (
        <button type="button" className="btn btn-sutil"
                onClick={() => setPanel(panel === 'anular' ? null : 'anular')}>
          Anular
        </button>
      )}

      {aviso && (
        <div className={`ficha-aviso ${aviso.tipo === 'ok' ? 'ficha-aviso-info' : 'ficha-aviso-critico'} documento-mensaje`}
             role={aviso.tipo === 'ok' ? 'status' : 'alert'}>
          <Icono nombre="alerta" tamano={17} />
          <span>{aviso.texto}</span>
        </div>
      )}

      {/* ------------- Despachar: hace falta la guía ------------- */}
      {panel === 'despachar' && (
        <div className="traslado-panel documento-mensaje">
          <strong>Despachar el traslado</strong>
          <p>
            Al despachar, el stock <b>sale de la bodega de origen</b> y queda en tránsito hasta que
            alguien lo reciba en destino.
          </p>
          <label className="form-campo" style={{ maxWidth: '18rem' }}>
            <span>Guía de remisión</span>
            <input className="campo mono" value={guia} onChange={(e) => setGuia(e.target.value)}
                   placeholder="EG07-0000000" autoFocus />
            <small>SUNAT la exige para que el camión circule.</small>
          </label>
          <div className="acciones-fila">
            <button type="button" className="btn btn-primario" disabled={trabajando || !guia.trim()}
                    onClick={() => correr(() => despacharTraslado(trasladoId, guia))}>
              {trabajando ? 'Despachando…' : 'Despachar'}
            </button>
            <button type="button" className="btn btn-sutil" onClick={() => setPanel(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {/* ------------- Aceptar: se cuenta lo que llegó ------------- */}
      {panel === 'aceptar' && (
        <div className="traslado-panel documento-mensaje">
          <strong>¿Qué llegó de verdad?</strong>
          <p>
            Viene precargado con lo que se envió. <b>Corrija lo que no coincida</b>: la diferencia
            queda registrada como discrepancia, con su alerta. Es exactamente lo que hoy se pierde.
          </p>

          <div className="tabla-envoltorio">
            <table className="datos">
              <thead>
                <tr>
                  <th>Pallet</th>
                  <th className="num">Enviado</th>
                  <th className="num">Bultos recibidos</th>
                  <th className="num">Kilos recibidos</th>
                  <th>Observación</th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((l) => {
                  const r = recibido.get(l.linea_id)!;
                  const dif = r.peso - l.peso_enviado;
                  return (
                    <tr key={l.linea_id} data-mal={Math.abs(dif) > 0.01 ? 'si' : 'no'}>
                      <td className="mono">
                        {l.pallet}
                        <small style={{ display: 'block', color: 'var(--tinta-3)' }}>{l.producto}</small>
                      </td>
                      <td className="num mono">
                        {l.bultos_enviados} · {cifra(l.peso_enviado)} kg
                      </td>
                      <td className="num">
                        <input className="campo mono" type="number" min={0} step={1} style={{ width: '5.5rem' }}
                               value={r.bultos}
                               onChange={(e) => setRecibido((m) => new Map(m).set(l.linea_id, { ...r, bultos: Number(e.target.value) }))} />
                      </td>
                      <td className="num">
                        <input className="campo mono" type="number" min={0} step={0.1} style={{ width: '7rem' }}
                               value={r.peso}
                               onChange={(e) => setRecibido((m) => new Map(m).set(l.linea_id, { ...r, peso: Number(e.target.value) }))} />
                        {Math.abs(dif) > 0.01 && (
                          <small style={{ display: 'block', color: 'var(--critico)', fontWeight: 600 }}>
                            {dif > 0 ? '+' : ''}{cifra(dif)} kg
                          </small>
                        )}
                      </td>
                      <td>
                        <input className="campo" value={r.obs} maxLength={200}
                               placeholder={Math.abs(dif) > 0.01 ? 'Por qué no cuadra' : ''}
                               onChange={(e) => setRecibido((m) => new Map(m).set(l.linea_id, { ...r, obs: e.target.value }))} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {hayDiferencias && (
            <p className="traslado-alerta">
              <Icono nombre="alerta" tamano={15} />
              Hay diferencias con lo enviado. Se van a registrar como discrepancia: no se pierden,
              se investigan.
            </p>
          )}

          <div className="acciones-fila">
            <button type="button" className="btn btn-primario" disabled={trabajando}
                    onClick={() => correr(() => aceptarTraslado(
                      trasladoId,
                      lineas.map((l) => {
                        const r = recibido.get(l.linea_id)!;
                        return { linea_id: l.linea_id, bultos: r.bultos, peso_kg: r.peso, observacion: r.obs };
                      })
                    ))}>
              {trabajando ? 'Recibiendo…' : 'Confirmar recepción'}
            </button>
            <button type="button" className="btn btn-sutil" onClick={() => setPanel(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {/* ------------- Anular ------------- */}
      {panel === 'anular' && (
        <div className="traslado-panel documento-mensaje">
          <strong>Anular el traslado</strong>
          <p>Solo se puede mientras el stock no se haya movido.</p>
          <label className="form-campo" style={{ maxWidth: '26rem' }}>
            <span>Motivo</span>
            <input className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)}
                   placeholder="Por qué ya no corresponde" maxLength={200} autoFocus />
          </label>
          <div className="acciones-fila">
            <button type="button" className="btn btn-primario"
                    disabled={trabajando || motivo.trim().length < 5}
                    onClick={() => correr(() => anularTraslado(trasladoId, motivo))}>
              {trabajando ? 'Anulando…' : 'Anular'}
            </button>
            <button type="button" className="btn btn-sutil" onClick={() => setPanel(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </>
  );
}
