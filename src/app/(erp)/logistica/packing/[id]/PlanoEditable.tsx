'use client';

/**
 * ============================================================================
 *  PLANO DE ESTIBA EDITABLE
 * ============================================================================
 *  La cuadrícula es lotes × filas del contenedor. Cada casilla dice cuántos
 *  sacos de ese lote van en esa fila.
 *
 *  LA IDEA: QUE EL ERROR SE VEA ANTES DE GUARDAR
 *  Todo se recalcula mientras se escribe, y lo que no cuadra se pinta:
 *
 *    · Fila que se pasa de su cupo  → la columna entera en rojo.
 *    · Lote con sacos de más o de menos → su fila en rojo, con la diferencia.
 *    · Contenedor que no cierra → el botón de guardar no deja.
 *
 *  Así nadie descubre el problema al pulsar guardar, que es cuando ya se
 *  perdieron diez minutos de trabajo.
 *
 *  DOS AYUDAS QUE AHORRAN TRABAJO DE VERDAD
 *  · «Completar fila»: llena la fila hasta su cupo con lo que le falte al
 *    lote. Es lo que se hace a mano el 90 % de las veces.
 *  · «Repartir el resto»: coloca todo lo que le falta a un lote en las filas
 *    que tengan hueco, de arriba abajo.
 *
 *  Y el botón de rehacer con FIFO sigue estando, para volver al punto de
 *  partida sin borrar casilla por casilla.
 * ============================================================================
 */
import { useState, useMemo, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icono } from '@/components/estructura/Icono';
import { guardarPlano, regenerarPlano, type CeldaPlano } from '../acciones';

export type LoteDelPlano = {
  lote_id: number;
  codigo_pallet: string;
  producto: string;
  bultos: number;
};

const cifra = (n: number) => n.toLocaleString('es-PE');

export function PlanoEditable({
  packingId,
  lotes,
  celdasIniciales,
  filas,
  cupoFila,
  puedeEditar,
}: {
  packingId: number;
  lotes: LoteDelPlano[];
  celdasIniciales: CeldaPlano[];
  filas: number;
  cupoFila: number;
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const [guardando, iniciarGuardado] = useTransition();
  const [rehaciendo, iniciarRehacer] = useTransition();

  /*
   * El plano vive en un mapa «lote:fila → sacos». Una matriz completa sería
   * más intuitiva de leer, pero con 22 filas y varios lotes casi todas las
   * casillas están vacías, y el mapa evita arrastrar ese vacío.
   */
  const [celdas, setCeldas] = useState<Map<string, number>>(() => {
    const m = new Map<string, number>();
    for (const c of celdasIniciales) m.set(`${c.lote_id}:${c.fila}`, c.sacos);
    return m;
  });

  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'mal'; texto: string; detalles?: string[] } | null>(null);
  const [tocado, setTocado] = useState(false);

  const columnas = useMemo(() => Array.from({ length: filas }, (_, i) => i + 1), [filas]);

  const valor = (loteId: number, fila: number) => celdas.get(`${loteId}:${fila}`) ?? 0;

  function poner(loteId: number, fila: number, sacos: number) {
    setCeldas((previo) => {
      const m = new Map(previo);
      const n = Math.max(0, Math.floor(sacos || 0));
      if (n === 0) m.delete(`${loteId}:${fila}`);
      else m.set(`${loteId}:${fila}`, n);
      return m;
    });
    setTocado(true);
    setAviso(null);
  }

  /* ---- Los totales, recalculados en cada tecla ---- */
  const totales = useMemo(() => {
    const porLote = new Map<number, number>();
    const porFila = new Map<number, number>();
    let total = 0;

    for (const [clave, sacos] of celdas) {
      const [l, f] = clave.split(':').map(Number);
      porLote.set(l, (porLote.get(l) ?? 0) + sacos);
      porFila.set(f, (porFila.get(f) ?? 0) + sacos);
      total += sacos;
    }
    return { porLote, porFila, total };
  }, [celdas]);

  const bultosTotales = lotes.reduce((s, l) => s + l.bultos, 0);

  /* ---- Qué está mal, ahora mismo ---- */
  const problemas = useMemo(() => {
    const lista: string[] = [];
    const filasMal = new Set<number>();
    const lotesMal = new Set<number>();

    for (const [fila, n] of totales.porFila) {
      if (n > cupoFila) {
        filasMal.add(fila);
        lista.push(`La fila ${fila} lleva ${n} sacos y caben ${cupoFila}.`);
      }
    }
    for (const l of lotes) {
      const puesto = totales.porLote.get(l.lote_id) ?? 0;
      if (puesto !== l.bultos) {
        lotesMal.add(l.lote_id);
        lista.push(
          puesto > l.bultos
            ? `${l.codigo_pallet}: sobran ${puesto - l.bultos} sacos.`
            : `${l.codigo_pallet}: faltan ${l.bultos - puesto} sacos por colocar.`
        );
      }
    }
    return { lista, filasMal, lotesMal, cierra: lista.length === 0 };
  }, [totales, lotes, cupoFila]);

  /* ---- Las dos ayudas ---- */
  function completarFila(loteId: number, fila: number) {
    const enFila = totales.porFila.get(fila) ?? 0;
    const actual = valor(loteId, fila);
    const huecoFila = cupoFila - (enFila - actual);
    const lote = lotes.find((l) => l.lote_id === loteId)!;
    const faltaLote = lote.bultos - ((totales.porLote.get(loteId) ?? 0) - actual);
    poner(loteId, fila, Math.max(0, Math.min(huecoFila, faltaLote)));
  }

  function repartirResto(loteId: number) {
    const lote = lotes.find((l) => l.lote_id === loteId)!;
    setCeldas((previo) => {
      const m = new Map(previo);

      // Se recalcula el ocupado por fila SIN contar este lote: se va a
      // recolocar entero, así que su reparto anterior no cuenta.
      const ocupado = new Map<number, number>();
      for (const [clave, sacos] of m) {
        const [l, f] = clave.split(':').map(Number);
        if (l === loteId) { m.delete(clave); continue; }
        ocupado.set(f, (ocupado.get(f) ?? 0) + sacos);
      }

      let restante = lote.bultos;
      for (const fila of columnas) {
        if (restante <= 0) break;
        const hueco = cupoFila - (ocupado.get(fila) ?? 0);
        if (hueco <= 0) continue;
        const n = Math.min(hueco, restante);
        m.set(`${loteId}:${fila}`, n);
        restante -= n;
      }
      return m;
    });
    setTocado(true);
    setAviso(null);
  }

  function vaciar(loteId: number) {
    setCeldas((previo) => {
      const m = new Map(previo);
      for (const clave of [...m.keys()]) {
        if (Number(clave.split(':')[0]) === loteId) m.delete(clave);
      }
      return m;
    });
    setTocado(true);
    setAviso(null);
  }

  /* ---- Guardar y rehacer ---- */
  function guardar() {
    setAviso(null);
    const lista: CeldaPlano[] = [];
    for (const [clave, sacos] of celdas) {
      const [lote_id, fila] = clave.split(':').map(Number);
      lista.push({ lote_id, fila, sacos });
    }

    iniciarGuardado(async () => {
      const r = await guardarPlano(packingId, lista);
      setAviso({
        tipo: r.ok ? 'ok' : 'mal',
        texto: r.mensaje,
        detalles: r.ok ? undefined : r.detalles,
      });
      if (r.ok) { setTocado(false); router.refresh(); }
    });
  }

  function rehacer() {
    setAviso(null);
    iniciarRehacer(async () => {
      const r = await regenerarPlano(packingId);
      setAviso({ tipo: r.ok ? 'ok' : 'mal', texto: r.mensaje });
      if (r.ok) router.refresh();
    });
  }

  if (lotes.length === 0) {
    return (
      <p className="plano-vacio">
        Este packing no tiene lotes cargados todavía. Agréguelos arriba y después repártalos en el
        contenedor.
      </p>
    );
  }

  const filasUsadas = [...totales.porFila.values()].filter((n) => n > 0).length;

  return (
    <div className="plano">
      {/* ---------------- Barra de estado ---------------- */}
      <div className="plano-barra">
        <div className="plano-cifras">
          <span>
            <b>{cifra(totales.total)}</b> de {cifra(bultosTotales)} sacos colocados
          </span>
          <span>
            <b>{filasUsadas}</b> de {filas} filas usadas
          </span>
          <span>Cupo por fila: <b>{cupoFila}</b></span>
        </div>

        {puedeEditar && (
          <div className="plano-acciones">
            <button type="button" className="btn btn-sutil btn-chico"
                    onClick={rehacer} disabled={rehaciendo || guardando}>
              <Icono nombre="volver" tamano={14} />
              {rehaciendo ? 'Rehaciendo…' : 'Rehacer con FIFO'}
            </button>
            <button type="button" className="btn btn-primario btn-chico"
                    onClick={guardar} disabled={guardando || !problemas.cierra || !tocado}>
              <Icono nombre="guardar" tamano={14} />
              {guardando ? 'Guardando…' : 'Guardar plano'}
            </button>
          </div>
        )}
      </div>

      {/* ---------------- Qué falta para que cierre ---------------- */}
      {puedeEditar && !problemas.cierra && (
        <div className="plano-problemas">
          <strong><Icono nombre="alerta" tamano={15} /> El plano todavía no cierra</strong>
          <ul>
            {problemas.lista.slice(0, 6).map((x, i) => <li key={i}>{x}</li>)}
            {problemas.lista.length > 6 && <li>…y {problemas.lista.length - 6} más.</li>}
          </ul>
        </div>
      )}

      {puedeEditar && problemas.cierra && tocado && (
        <p className="plano-cierra">
          <Icono nombre="ingresos" tamano={15} />
          Todo cuadra: cada lote tiene sus sacos colocados y ninguna fila se pasa. Ya se puede guardar.
        </p>
      )}

      {aviso && (
        <div className={`ficha-aviso ${aviso.tipo === 'ok' ? 'ficha-aviso-info' : 'ficha-aviso-critico'}`}
             role={aviso.tipo === 'ok' ? 'status' : 'alert'}>
          <Icono nombre="alerta" tamano={16} />
          <span>
            <strong>{aviso.texto}</strong>
            {aviso.detalles?.length ? (
              <ul className="documento-detalles">
                {aviso.detalles.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            ) : null}
          </span>
        </div>
      )}

      {/* ---------------- La cuadrícula ---------------- */}
      <div className="tabla-envoltorio plano-envoltorio">
        <table className="datos plano-rejilla">
          <thead>
            <tr>
              <th className="plano-col-lote">Lote y producto</th>
              <th className="num">Bultos</th>
              {columnas.map((f) => (
                <th key={f} className="num plano-col-fila" data-mal={problemas.filasMal.has(f) ? 'si' : 'no'}>
                  {f}
                </th>
              ))}
              <th className="num">Puestos</th>
              {puedeEditar && <th></th>}
            </tr>
          </thead>

          <tbody>
            {lotes.map((l) => {
              const puesto = totales.porLote.get(l.lote_id) ?? 0;
              const mal = problemas.lotesMal.has(l.lote_id);
              return (
                <tr key={l.lote_id} data-mal={mal ? 'si' : 'no'}>
                  <td className="plano-col-lote">
                    <b className="mono">{l.codigo_pallet}</b>
                    <small>{l.producto}</small>
                  </td>
                  <td className="num mono">{cifra(l.bultos)}</td>

                  {columnas.map((f) => {
                    const v = valor(l.lote_id, f);
                    return (
                      <td key={f} className="num plano-celda"
                          data-lleno={v > 0 ? 'si' : 'no'}
                          data-mal={problemas.filasMal.has(f) ? 'si' : 'no'}>
                        {puedeEditar ? (
                          <input
                            type="number" min={0} max={cupoFila} step={1}
                            value={v || ''}
                            onChange={(e) => poner(l.lote_id, f, Number(e.target.value))}
                            onDoubleClick={() => completarFila(l.lote_id, f)}
                            aria-label={`Sacos del pallet ${l.codigo_pallet} en la fila ${f}`}
                            title="Doble clic para llenar esta fila con lo que falte"
                          />
                        ) : (
                          v || ''
                        )}
                      </td>
                    );
                  })}

                  <td className="num mono" data-mal={mal ? 'si' : 'no'}>
                    <b>{cifra(puesto)}</b>
                    {mal && (
                      <small className="plano-dif">
                        {puesto > l.bultos ? `+${puesto - l.bultos}` : `−${l.bultos - puesto}`}
                      </small>
                    )}
                  </td>

                  {puedeEditar && (
                    <td>
                      <div className="acciones-fila">
                        <button type="button" className="btn btn-sutil btn-chico"
                                onClick={() => repartirResto(l.lote_id)}
                                title="Colocar todos sus sacos en las filas con hueco">
                          Repartir
                        </button>
                        <button type="button" className="btn btn-sutil btn-chico"
                                onClick={() => vaciar(l.lote_id)} title="Quitarlo del plano">
                          Vaciar
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>

          <tfoot>
            <tr>
              <th className="plano-col-lote">Sacos por fila</th>
              <th className="num mono">{cifra(bultosTotales)}</th>
              {columnas.map((f) => {
                const n = totales.porFila.get(f) ?? 0;
                return (
                  <th key={f} className="num mono" data-mal={problemas.filasMal.has(f) ? 'si' : 'no'}>
                    {n || ''}
                  </th>
                );
              })}
              <th className="num mono">{cifra(totales.total)}</th>
              {puedeEditar && <th></th>}
            </tr>
            <tr className="plano-saldo">
              <td className="plano-col-lote">Hueco que queda</td>
              <td></td>
              {columnas.map((f) => {
                const libre = cupoFila - (totales.porFila.get(f) ?? 0);
                return (
                  <td key={f} className="num mono" data-mal={libre < 0 ? 'si' : 'no'}>
                    {libre === cupoFila ? '' : libre}
                  </td>
                );
              })}
              <td></td>
              {puedeEditar && <td></td>}
            </tr>
          </tfoot>
        </table>
      </div>

      {puedeEditar && (
        <p className="pie-explicativo">
          Escriba los sacos en cada casilla. <b>Doble clic</b> en una casilla la llena hasta el cupo
          de la fila con lo que le falte a ese lote. <b>Repartir</b> coloca todos los sacos de un
          lote en las filas con hueco, de la primera a la última. Nada se guarda hasta que el plano
          cierre: cada lote con sus sacos exactos y ninguna fila pasada de cupo.
        </p>
      )}
    </div>
  );
}
