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
 *
 *  QUÉ PASA CON LA DIFERENCIA (y por eso se dice con estas palabras)
 *  El origen ya registró en el Kardex la salida de TODO lo enviado al
 *  despachar; al confirmar, el destino registra la entrada de lo RECIBIDO.
 *  Un faltante deja de figurar en el inventario; un sobrante lo aumenta. No se
 *  escribe ningún ajuste solo: la diferencia queda en el historial del
 *  traslado y como aviso en Alertas, y se corrige —si corresponde— en
 *  «Ajustes de stock» (migración 069).
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icono } from '@/components/estructura/Icono';
import { accionSegura } from '@/lib/accionSegura';
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
  guiaInicial = '',
  origen = 'el origen',
  destino = 'el destino',
}: {
  trasladoId: number;
  estado: string;
  lineas: LineaRecibo[];
  rol: string;
  /** Si la guía se escribió al crear el traslado, viene puesta al despachar. */
  guiaInicial?: string;
  origen?: string;
  destino?: string;
}) {
  const router = useRouter();
  const [trabajando, iniciar] = useTransition();
  const [panel, setPanel] = useState<'despachar' | 'aceptar' | 'anular' | null>(null);
  const [guia, setGuia] = useState(guiaInicial);
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
      //  Un corte de red vuelve como mensaje, sin tumbar la ficha ni perder lo anotado.
      const r = await accionSegura(accion);
      setAviso({ tipo: r.ok ? 'ok' : 'mal', texto: r.mensaje });
      if (r.ok) { setPanel(null); router.refresh(); }
    });
  }

  const hayDiferencias = lineas.some((l) => {
    const r = recibido.get(l.linea_id)!;
    return Math.abs(r.peso - l.peso_enviado) > 0.005 || r.bultos !== l.bultos_enviados;
  });

  /* Los totales de la diferencia, separados: no es lo mismo que falte a que sobre. */
  const enviadoKg = lineas.reduce((s, l) => s + l.peso_enviado, 0);
  const recibidoKg = lineas.reduce((s, l) => s + (recibido.get(l.linea_id)?.peso ?? 0), 0);
  let faltaKg = 0, sobraKg = 0, faltaB = 0, sobraB = 0;
  for (const l of lineas) {
    const r = recibido.get(l.linea_id)!;
    const dk = r.peso - l.peso_enviado;
    const db = r.bultos - l.bultos_enviados;
    if (dk < -0.005) faltaKg += -dk; else if (dk > 0.005) sobraKg += dk;
    if (db < 0) faltaB += -db; else if (db > 0) sobraB += db;
  }
  /* Bultos y kilos van juntos: o llegó algo de ese pallet, o no llegó nada. */
  const incoherente = lineas.some((l) => {
    const r = recibido.get(l.linea_id)!;
    return r.bultos < 0 || r.peso < 0 || (r.bultos === 0) !== (r.peso <= 0);
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
            Viene precargado con lo que se envió. <b>Cuente y corrija lo que no coincida</b>, pallet por
            pallet: la diferencia entre lo enviado y lo recibido queda escrita con su número, en el
            historial del traslado y como aviso en Alertas.
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
                  const difB = r.bultos - l.bultos_enviados;
                  return (
                    <tr key={l.linea_id} data-mal={Math.abs(dif) > 0.005 || difB !== 0 ? 'si' : 'no'}>
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
                        {difB !== 0 && (
                          <small style={{ display: 'block', color: 'var(--critico)', fontWeight: 600 }} data-dif="bultos">
                            {difB < 0 ? `Faltan ${-difB}` : `Sobran ${difB}`}
                          </small>
                        )}
                      </td>
                      <td className="num">
                        <input className="campo mono" type="number" min={0} step={0.1} style={{ width: '7rem' }}
                               value={r.peso}
                               onChange={(e) => setRecibido((m) => new Map(m).set(l.linea_id, { ...r, peso: Number(e.target.value) }))} />
                        {Math.abs(dif) > 0.005 && (
                          <small style={{ display: 'block', color: 'var(--critico)', fontWeight: 600 }} data-dif="kilos">
                            {dif < 0 ? `Faltan ${cifra(-dif)} kg` : `Sobran ${cifra(dif)} kg`}
                          </small>
                        )}
                      </td>
                      <td>
                        <input className="campo" value={r.obs} maxLength={200}
                               placeholder={Math.abs(dif) > 0.005 || difB !== 0 ? 'Por qué no cuadra' : ''}
                               onChange={(e) => setRecibido((m) => new Map(m).set(l.linea_id, { ...r, obs: e.target.value }))} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {incoherente && (
            <p className="traslado-alerta" role="alert">
              <Icono nombre="alerta" tamano={15} />
              En cada pallet, bultos y kilos recibidos van juntos: si no llegó nada ponga cero en los
              dos; si llegó algo, indique bultos y kilos.
            </p>
          )}

          {hayDiferencias && !incoherente && (
            <div className="traslado-alerta" data-bloque="diferencia-recepcion">
              <Icono nombre="alerta" tamano={15} />
              <span>
                <b>
                  Lo recibido no coincide con lo enviado:{' '}
                  {[
                    faltaKg > 0.005 || faltaB > 0
                      ? `faltan ${faltaB > 0 ? `${faltaB} bulto${faltaB === 1 ? '' : 's'} · ` : ''}${cifra(faltaKg)} kg`
                      : '',
                    sobraKg > 0.005 || sobraB > 0
                      ? `sobran ${sobraB > 0 ? `${sobraB} bulto${sobraB === 1 ? '' : 's'} · ` : ''}${cifra(sobraKg)} kg`
                      : '',
                  ].filter(Boolean).join(' y ')}
                </b>{' '}
                (salieron {cifra(enviadoKg)} kg de {origen}; se recibirán {cifra(recibidoKg)} kg en {destino}).
                Al confirmar, {destino} registra en el Kardex la entrada de lo recibido; la salida de lo
                enviado ya se registró en {origen} al despachar.
                {faltaKg > 0.005 && ' El faltante deja de figurar en el inventario: no está en ninguna bodega.'}
                {sobraKg > 0.005 && ' El sobrante entra en el destino y aumenta el inventario.'}
                {' '}No se escribe ningún ajuste: cada diferencia queda en el historial del traslado y
                como aviso en Alertas. Si el faltante aparece, o el sobrante fue un error de pesaje, se
                corrige en «Ajustes de stock».
              </span>
            </div>
          )}

          <div className="acciones-fila">
            <button type="button" className="btn btn-primario" disabled={trabajando || incoherente}
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
