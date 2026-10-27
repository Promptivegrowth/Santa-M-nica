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
 *
 *  LO QUE SALIÓ DE VERDAD (075, pedido de Oliver Tello)
 *  Por defecto sale todo lo cargado: el caso normal no lleva ni un clic de
 *  más. Cuando en el muelle salió otra cosa —un muestreo, sacos dañados, un
 *  pallet que no entró—, «Ajustar lo que salió» abre, por pallet, los bultos
 *  y kilos reales y el motivo de la diferencia, que es obligatorio. Al poner
 *  los bultos, los kilos se calculan solos en proporción; se pueden corregir
 *  (un muestreo de kilos sueltos no cambia los bultos).
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icono } from '@/components/estructura/Icono';
import { accionSegura } from '@/lib/accionSegura';
import {
  ejecutarDespacho, revisarDespacho,
  type Revision, type LineaRevision, type MotivoDiferencia, type AjusteDespacho,
} from '@/app/(erp)/logistica/despachos/acciones';
import './despachar.css';

const MOTIVOS: { valor: MotivoDiferencia; texto: string; efecto: string }[] = [
  { valor: 'muestreo', texto: 'Muestreo', efecto: 'Sale del stock como muestra, no como venta.' },
  { valor: 'merma', texto: 'Sacos dañados / merma', efecto: 'Sale del stock como merma, no como venta.' },
  { valor: 'no_entro', texto: 'No entró en el contenedor', efecto: 'Vuelve a cámara, apartado para su pedido.' },
  { valor: 'otro', texto: 'Otro (escriba)', efecto: 'Vuelve a cámara, apartado para su pedido.' },
];
const SALE_DEL_STOCK = new Set<MotivoDiferencia>(['muestreo', 'merma']);

type Fila = { bultos: string; kg: string; kgTocado: boolean; motivo: MotivoDiferencia | ''; detalle: string };

const cifra = (n: number, d = 0) => n.toLocaleString('es-PE', { minimumFractionDigits: d, maximumFractionDigits: d });
const redondo = (n: number) => Math.round(n * 1000) / 1000;

/** Lo que sale de un pallet, leído del formulario, con su problema si lo hay. */
function leer(l: LineaRevision, f: Fila | undefined) {
  const b = f ? Number(f.bultos) : l.bultos;
  const kg = f ? redondo(Number(f.kg)) : l.kg;
  const faltanB = l.bultos - b;
  const faltanKg = redondo(l.kg - kg);
  const hayDiferencia = faltanB !== 0 || faltanKg > 0.0005;
  let problema: string | null = null;
  if (f && (f.bultos.trim() === '' || f.kg.trim() === '')) problema = 'Indique bultos y kilos.';
  else if (!Number.isInteger(b) || !Number.isFinite(kg)) problema = 'Los bultos van en enteros.';
  else if (b < 0 || kg < 0) problema = 'No puede ser negativo.';
  else if (b > l.bultos || kg > l.kg + 0.001) problema = 'No sale más de lo cargado.';
  else if ((b === 0) !== (kg <= 0.0005)) problema = 'Si salen bultos salen kilos, y al revés.';
  // Sin ajustar, el bloqueo ya está en «No se puede despachar todavía».
  else if (f && l.bloqueo && (b > 0 || (hayDiferencia && f.motivo && SALE_DEL_STOCK.has(f.motivo)))) {
    problema = 'Bloqueado por Calidad: no puede salir. Ponga 0 bultos y «No entró».';
  }
  else if (hayDiferencia && !f?.motivo) problema = 'Elija el motivo.';
  else if (hayDiferencia && f?.motivo === 'otro' && f.detalle.trim().length < 5) problema = 'Escriba qué pasó.';
  else if (faltanB > 0 && faltanKg <= 0.0005) problema = 'Faltan bultos: corrija los kilos.';
  else if (hayDiferencia && f?.motivo && !SALE_DEL_STOCK.has(f.motivo) && faltanB === 0) {
    problema = 'Lo que vuelve a cámara son sacos enteros: baje los bultos.';
  }
  return { b, kg, faltanB, faltanKg, hayDiferencia, problema };
}

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
  const [ajustando, setAjustando] = useState(false);
  const [filas, setFilas] = useState<Record<number, Fila>>({});

  function abrir() {
    setResultado(null);
    iniciarCarga(async () => {
      const r = await accionSegura(() => revisarDespacho(packingListId));
      if (r && 'sinConexion' in r) { setResultado({ tipo: 'mal', texto: r.mensaje }); return; }
      setRevision(r);
      setEscrito('');
      setAjustando(false);
      setFilas({});
    });
  }

  /** Abre el ajuste con cada pallet en «sale todo», para tocar solo lo que cambió. */
  function abrirAjuste() {
    if (!revision) return;
    const inicial: Record<number, Fila> = {};
    for (const l of revision.lineas) {
      inicial[l.lote_id] = filas[l.lote_id] ?? {
        bultos: String(l.bultos), kg: String(l.kg), kgTocado: false, motivo: '', detalle: '',
      };
    }
    setFilas(inicial);
    setAjustando(true);
  }

  function cambiar(l: LineaRevision, cambio: Partial<Fila>) {
    setFilas((prev) => {
      const actual = prev[l.lote_id] ?? { bultos: String(l.bultos), kg: String(l.kg), kgTocado: false, motivo: '', detalle: '' };
      const nueva = { ...actual, ...cambio };
      // Los kilos siguen a los bultos en proporción, hasta que se escriben a mano.
      if (cambio.bultos !== undefined && !nueva.kgTocado) {
        const b = Number(cambio.bultos);
        if (Number.isFinite(b) && l.bultos > 0) nueva.kg = String(redondo(l.kg * b / l.bultos));
      }
      return { ...prev, [l.lote_id]: nueva };
    });
  }

  const lineas = revision?.lineas ?? [];
  const lecturas = lineas.map((l) => ({ l, ...leer(l, ajustando ? filas[l.lote_id] : undefined) }));
  const conDiferencia = lecturas.filter((x) => x.hayDiferencia);
  const conProblema = lecturas.filter((x) => x.problema);
  const bultosSalen = lecturas.reduce((t, x) => t + (Number.isFinite(x.b) ? x.b : 0), 0);
  const kgSalen = lecturas.reduce((t, x) => t + (Number.isFinite(x.kg) ? x.kg : 0), 0);

  /*
   * Un pallet bloqueado por Calidad impide despachar, salvo que se declare que
   * no sale (0 bultos, «no entró» u «otro»): entonces se queda en cámara.
   */
  const bloqueadoQueSeQueda = (l: LineaRevision) => {
    const f = ajustando ? filas[l.lote_id] : undefined;
    return !!l.bloqueo && !!f && Number(f.bultos) === 0 && !!f.motivo && !SALE_DEL_STOCK.has(f.motivo);
  };
  const impedimentos = (revision?.impedimentos ?? []).filter((t) =>
    !lineas.some((l) => bloqueadoQueSeQueda(l) && t.startsWith(`El pallet ${l.pallet} está bloqueado`)));
  const soloBloqueos = (revision?.impedimentos ?? []).length > 0 &&
    (revision?.impedimentos ?? []).every((t) => lineas.some((l) => l.bloqueo && t.startsWith(`El pallet ${l.pallet} está bloqueado`)));
  const puedeConfirmar = !!revision && impedimentos.length === 0 && conProblema.length === 0 && lineas.length > 0;

  function despachar() {
    setResultado(null);
    const ajustes: AjusteDespacho[] = ajustando
      ? conDiferencia.map((x) => ({
          lote_id: x.l.lote_id,
          bultos: x.b,
          kg: x.kg,
          motivo: filas[x.l.lote_id]?.motivo ?? '',
          detalle: filas[x.l.lote_id]?.detalle.trim() || null,
        }))
      : [];
    iniciarDespacho(async () => {
      const r = await accionSegura(() => ejecutarDespacho(packingListId, ajustes));
      if (!r.ok) {
        setResultado({ tipo: 'mal', texto: r.mensaje, detalles: 'detalles' in r ? r.detalles : undefined });
        return;
      }
      setResultado({ tipo: 'ok', texto: r.mensaje });
      setRevision(null);
      setAjustando(false);
      setFilas({});
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
      <button type="button" className="btn btn-primario" data-accion="despachar"
              onClick={revision ? () => setRevision(null) : abrir}
              disabled={cargando || despachando}>
        <Icono nombre="despachos" tamano={15} />
        {cargando ? 'Revisando…' : revision ? 'Cancelar' : 'Despachar'}
      </button>

      {resultado && (
        <div
          className={`ficha-aviso ${resultado.tipo === 'ok' ? 'ficha-aviso-info' : 'ficha-aviso-critico'} documento-mensaje`}
          role={resultado.tipo === 'ok' ? 'status' : 'alert'}
          data-resultado-despacho={resultado.tipo}
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
        <div className="despachar documento-mensaje" data-ajustando={ajustando ? 'si' : 'no'}>
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

          {impedimentos.length > 0 && (
            <div className="despachar-bloqueo">
              <strong>
                <Icono nombre="alerta" tamano={15} /> No se puede despachar todavía
              </strong>
              <ul>
                {impedimentos.map((x, i) => <li key={i}>{x}</li>)}
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

          {/* ---- Lo que sale: todo, salvo que se diga otra cosa ---- */}
          {(revision.puede || soloBloqueos) && lineas.length > 0 && (
            <div className="despachar-sale" data-diferencia={conDiferencia.length ? 'si' : 'no'}>
              <span data-bloque="resumen-salida">
                {conDiferencia.length === 0 ? (
                  <>Sale <strong>todo lo cargado</strong>: {cifra(revision.bultos)} bultos · {cifra(revision.tm, 3)} TM.</>
                ) : (
                  <>
                    Salen <strong>{cifra(bultosSalen)} de {cifra(revision.bultos)} bultos</strong> ·{' '}
                    {cifra(kgSalen / 1000, 3)} de {cifra(revision.tm, 3)} TM.{' '}
                    {conDiferencia.length} pallet{conDiferencia.length === 1 ? '' : 's'} con diferencia.
                  </>
                )}
              </span>
              {ajustando ? (
                <button type="button" className="btn btn-sutil btn-chico" data-accion="sale-todo"
                        onClick={() => { setAjustando(false); setFilas({}); }} disabled={despachando}>
                  Volver a «sale todo»
                </button>
              ) : (
                <button type="button" className="btn btn-secundario btn-chico" data-accion="ajustar-salida"
                        onClick={abrirAjuste} disabled={despachando}
                        title="Para declarar un muestreo, sacos dañados o lo que no entró en el contenedor">
                  <Icono nombre="editar" tamano={14} />
                  Ajustar lo que salió
                </button>
              )}
            </div>
          )}

          {ajustando && (
            <div className="despachar-ajustes" data-bloque="ajustes-despacho">
              <table>
                <thead>
                  <tr>
                    <th>Pallet</th>
                    <th className="num">Cargado</th>
                    <th className="num">Salió (bultos)</th>
                    <th className="num">Salió (kg)</th>
                    <th className="num">Diferencia</th>
                    <th>Motivo</th>
                    <th>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {lecturas.map(({ l, faltanB, faltanKg, hayDiferencia, problema }) => {
                    const f = filas[l.lote_id];
                    const motivo = MOTIVOS.find((m) => m.valor === f?.motivo);
                    return (
                      <tr key={l.lote_id} data-lote={l.lote_id}
                          data-diferencia={hayDiferencia ? 'si' : 'no'} data-error={problema ? 'si' : 'no'}
                          data-bloqueado={l.bloqueo ? 'si' : 'no'}>
                        <td>
                          <span className="mono">{l.pallet}</span>
                          {l.bloqueo && <span className="marca-bloqueo">Bloqueado por Calidad</span>}
                          <small>{l.producto}</small>
                        </td>
                        <td className="num">
                          {cifra(l.bultos)} b
                          <small>{cifra(l.kg, 1)} kg</small>
                        </td>
                        <td className="num">
                          <input className="campo mono" type="number" min={0} max={l.bultos} step={1}
                                 name={`salio-bultos-${l.lote_id}`} aria-label={`Bultos que salieron de ${l.pallet}`}
                                 value={f?.bultos ?? ''} onChange={(e) => cambiar(l, { bultos: e.target.value })} />
                        </td>
                        <td className="num">
                          <input className="campo mono" type="number" min={0} max={l.kg} step="0.001"
                                 name={`salio-kg-${l.lote_id}`} aria-label={`Kilos que salieron de ${l.pallet}`}
                                 value={f?.kg ?? ''} onChange={(e) => cambiar(l, { kg: e.target.value, kgTocado: true })} />
                        </td>
                        <td className="num">
                          {hayDiferencia && !problema?.startsWith('No sale más') ? (
                            <span className="despachar-dif">
                              −{cifra(faltanB)} b
                              <small>−{cifra(faltanKg, 1)} kg</small>
                            </span>
                          ) : '—'}
                        </td>
                        <td>
                          <select className="campo" name={`motivo-${l.lote_id}`} aria-label={`Motivo de la diferencia de ${l.pallet}`}
                                  value={f?.motivo ?? ''} disabled={!hayDiferencia}
                                  onChange={(e) => cambiar(l, { motivo: e.target.value as MotivoDiferencia | '' })}>
                            <option value="">{hayDiferencia ? 'Elija el motivo…' : 'Salió todo'}</option>
                            {MOTIVOS.map((m) => <option key={m.valor} value={m.valor}>{m.texto}</option>)}
                          </select>
                          {hayDiferencia && motivo && <small>{motivo.efecto}</small>}
                          {problema && <small data-tono="critico" role="alert">{problema}</small>}
                        </td>
                        <td>
                          <input className="campo" type="text" maxLength={200}
                                 name={`detalle-${l.lote_id}`} aria-label={`Detalle de la diferencia de ${l.pallet}`}
                                 placeholder={f?.motivo === 'otro' ? 'Qué pasó (obligatorio)' : f?.motivo === 'muestreo' ? 'Quién la sacó (opcional)' : 'Opcional'}
                                 value={f?.detalle ?? ''} disabled={!hayDiferencia}
                                 onChange={(e) => cambiar(l, { detalle: e.target.value })} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="despachar-ajustes-pie">
                Cambie solo los pallets que no salieron enteros. <b>Muestreo</b> y <b>sacos dañados</b> salen
                del stock con su propio movimiento (no como venta); lo que <b>no entró</b> u <b>otro</b> vuelve
                a cámara apartado para el mismo pedido, que queda con ese saldo pendiente para el próximo
                embarque. El plano de estiba queda como se cargó.
              </p>
            </div>
          )}

          {(revision.puede || soloBloqueos) && (
            <div className="despachar-confirma">
              {!puedeConfirmar ? (
                <p className="form-pista" style={{ margin: 0 }} data-motivo="despachar">
                  {conProblema.length
                    ? `Corrija ${conProblema.length === 1 ? 'el pallet marcado' : `los ${conProblema.length} pallets marcados`} en rojo para poder despachar.`
                    : 'Quite del contenedor el pallet bloqueado, o declárelo con «Ajustar lo que salió»: 0 bultos y «No entró en el contenedor».'}
                </p>
              ) : (
                <>
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
                    <button type="button" className="btn btn-primario" data-accion="confirmar-despacho"
                            onClick={despachar} disabled={despachando || !listo}>
                      <Icono nombre="despachos" tamano={15} />
                      {despachando ? 'Despachando…' : conDiferencia.length ? 'Sí, despachar lo que salió' : 'Sí, despachar'}
                    </button>
                    <button type="button" className="btn btn-sutil"
                            onClick={() => setRevision(null)} disabled={despachando}>
                      Cancelar
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
