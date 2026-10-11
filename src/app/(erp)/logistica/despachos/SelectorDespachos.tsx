'use client';

/**
 * ============================================================================
 *  SELECTOR DE DESPACHOS (observaciones de octubre, punto 14)
 * ============================================================================
 *  «Agregar un selector que permita elegir los registros que se desean
 *  gestionar … manteniendo la relación con la proforma, embarque, productos
 *  y cantidades.» El documento deja para la validación si se elige por
 *  operación o por ítem, así que se puede de las DOS maneras:
 *
 *    · Por operación: la casilla del despacho marca todos sus ítems.
 *    · Por ítem: se despliega el despacho y se marcan pallets sueltos. La
 *      casilla del despacho queda «a medias» para que se note.
 *
 *  Con lo elegido: exportar a Excel o sacar el reporte de carga en PDF. Las
 *  dos salidas llevan la proforma, el embarque, el producto y la cantidad de
 *  cada ítem.
 * ============================================================================
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Icono } from '@/components/estructura/Icono';
import type { Despacho } from '@/lib/despachosDatos';

const cifra = (n: number, d = 3) => n.toLocaleString('es-PE', { minimumFractionDigits: d, maximumFractionDigits: d });
const fechaHora = (v: string) =>
  new Date(v).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Lima' });

/** Casilla con estado «a medias», que el HTML solo admite por código. */
function Casilla({ marcada, aMedias, onChange, etiqueta, ...resto }: {
  marcada: boolean; aMedias?: boolean; onChange: () => void; etiqueta: string; [k: `data-${string}`]: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = !!aMedias; }, [aMedias]);
  return <input ref={ref} type="checkbox" checked={marcada} onChange={onChange} aria-label={etiqueta} {...resto} />;
}

export function SelectorDespachos({ despachos }: { despachos: Despacho[] }) {
  /** Ítems elegidos, por despacho. */
  const [elegidos, setElegidos] = useState<Map<number, Set<number>>>(new Map());
  const [abiertos, setAbiertos] = useState<Set<number>>(new Set());

  const todosLosItems = (d: Despacho) => new Set(d.items.map((i) => i.id));
  function alternarDespacho(d: Despacho) {
    setElegidos((m) => {
      const n = new Map(m);
      const actual = n.get(d.id);
      if (actual && actual.size === d.items.length) n.delete(d.id); else n.set(d.id, todosLosItems(d));
      return n;
    });
  }
  function alternarItem(d: Despacho, item: number) {
    setElegidos((m) => {
      const n = new Map(m);
      const s = new Set(n.get(d.id) ?? []);
      if (s.has(item)) s.delete(item); else s.add(item);
      if (s.size) n.set(d.id, s); else n.delete(d.id);
      return n;
    });
  }
  function alternarTodos() {
    setElegidos((m) => (m.size === despachos.length ? new Map() : new Map(despachos.map((d) => [d.id, todosLosItems(d)]))));
  }

  const resumen = useMemo(() => {
    let items = 0, kg = 0, bultos = 0;
    for (const d of despachos) {
      const s = elegidos.get(d.id);
      if (!s) continue;
      for (const i of d.items) if (s.has(i.id)) { items += 1; kg += i.kg; bultos += i.bultos; }
    }
    return { despachos: elegidos.size, items, kg, bultos };
  }, [elegidos, despachos]);

  /* La dirección de las salidas: los despachos y, si no van enteros, los ítems. */
  const consulta = useMemo(() => {
    const ids = [...elegidos.keys()];
    const parciales = despachos.filter((d) => elegidos.has(d.id) && elegidos.get(d.id)!.size < d.items.length);
    const items = parciales.flatMap((d) => [...elegidos.get(d.id)!]);
    const p = new URLSearchParams({ ids: ids.join(',') });
    if (items.length) p.set('items', items.join(','));
    return p.toString();
  }, [elegidos, despachos]);

  const algo = resumen.despachos > 0;

  return (
    <>
      {/* ---- La barra de lo elegido ---- */}
      <div className="selector-barra" data-bloque="selector" aria-live="polite">
        <label className="selector-todos">
          <Casilla marcada={elegidos.size === despachos.length && despachos.length > 0}
                   aMedias={elegidos.size > 0 && elegidos.size < despachos.length}
                   onChange={alternarTodos} etiqueta="Elegir todos los despachos" data-casilla="todos" />
          <span>Todos</span>
        </label>
        <span className="selector-resumen" data-elegidos={`${resumen.despachos}-${resumen.items}`}>
          {algo
            ? <><b>{resumen.despachos}</b> despacho{resumen.despachos === 1 ? '' : 's'} · <b>{resumen.items}</b> ítem{resumen.items === 1 ? '' : 's'} · {cifra(resumen.kg / 1000)} TM · {resumen.bultos.toLocaleString('es-PE')} bultos</>
            : 'Elija despachos enteros o despliegue uno para elegir ítems sueltos.'}
        </span>
        <div className="selector-acciones">
          <a className="btn btn-secundario btn-chico" aria-disabled={!algo} data-accion="excel"
             href={algo ? `/api/despachos/excel?${consulta}` : undefined}
             onClick={(e) => { if (!algo) e.preventDefault(); }}>
            <Icono nombre="descargar" tamano={14} /> Excel de lo elegido
          </a>
          <a className="btn btn-primario btn-chico" aria-disabled={!algo} data-accion="reporte"
             href={algo ? `/api/despachos/reporte?${consulta}` : undefined}
             onClick={(e) => { if (!algo) e.preventDefault(); }}>
            <Icono nombre="descargar" tamano={14} /> Reporte de carga (PDF)
          </a>
          {algo && <button type="button" className="btn btn-sutil btn-chico" onClick={() => setElegidos(new Map())}>Limpiar</button>}
        </div>
      </div>

      <div className="tabla-envoltorio" style={{ border: 'none', borderRadius: 0 }}>
        <table className="datos" data-cuadro="despachos">
          <thead>
            <tr>
              <th style={{ width: '2rem' }}></th>
              <th>Despacho</th><th>Proforma(s)</th><th>Embarque</th><th>Contenedor</th><th>Guía</th>
              <th className="num">Ítems</th><th className="num">TM</th><th className="num">Salida</th><th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {despachos.map((d) => {
              const s = elegidos.get(d.id);
              const abierto = abiertos.has(d.id);
              const tmDespacho = d.items.reduce((t, i) => t + i.kg, 0) / 1000;
              return (
                <Fragment key={d.id}>
                  <tr data-despacho={d.id} data-elegido={s ? (s.size === d.items.length ? 'todo' : 'parte') : 'no'}>
                    <td>
                      <Casilla marcada={!!s && s.size === d.items.length} aMedias={!!s && s.size < d.items.length}
                               onChange={() => alternarDespacho(d)} etiqueta={`Elegir el despacho ${d.numero}`}
                               data-casilla={`despacho-${d.id}`} />
                    </td>
                    <td className="mono">
                      <Link href={`/logistica/despachos/${d.id}`} className="enlace-ficha">{d.numero}</Link>
                    </td>
                    <td style={{ fontSize: '.76rem' }}>
                      {d.proformas.length === 0 ? '—' : d.proformas.map((p, i) => (
                        <span key={p.pedido_id}>{i > 0 ? ', ' : ''}<Link href={`/ventas/pedidos/${p.pedido_id}`} className="enlace-ficha">{p.numero}</Link></span>
                      ))}
                    </td>
                    <td className="mono">
                      {d.embarque_id ? <Link href={`/logistica/embarques/${d.embarque_id}`} className="enlace-ficha">{d.embarque}</Link> : '—'}
                    </td>
                    <td className="mono">{d.contenedor ?? '—'}</td>
                    <td className="mono">{d.guia ?? '—'}</td>
                    <td className="num">
                      <button type="button" className="enlace-boton" data-desplegar={d.id}
                              aria-expanded={abierto}
                              onClick={() => setAbiertos((a) => { const n = new Set(a); if (n.has(d.id)) n.delete(d.id); else n.add(d.id); return n; })}>
                        {s && s.size < d.items.length ? `${s.size} de ${d.items.length}` : d.items.length} {abierto ? '▴' : '▾'}
                      </button>
                    </td>
                    <td className="num">{cifra(tmDespacho)}</td>
                    <td className="num">{fechaHora(d.fecha_salida)}</td>
                    <td>
                      <Link href={`/logistica/despachos/${d.id}`} className="accion-btn" title="Ver la ficha del despacho">
                        <Icono nombre="ver" tamano={15} />
                      </Link>
                    </td>
                  </tr>
                  {abierto && (
                    <tr className="fila-detalle-proforma" data-items={d.id}>
                      <td colSpan={10}>
                        <table className="detalle-proforma">
                          <thead>
                            <tr><th></th><th>Pallet</th><th>SKU</th><th>Producto</th><th>Proforma</th><th className="num">Bultos</th><th className="num">TM</th></tr>
                          </thead>
                          <tbody>
                            {d.items.map((i) => (
                              <tr key={i.id} data-item={i.id}>
                                <td>
                                  <Casilla marcada={!!s?.has(i.id)} onChange={() => alternarItem(d, i.id)}
                                           etiqueta={`Elegir el pallet ${i.pallet}`} data-casilla={`item-${i.id}`} />
                                </td>
                                <td className="mono">{i.pallet}</td>
                                <td className="mono">{i.sku}</td>
                                <td>{i.producto}</td>
                                <td className="mono">
                                  {i.pedido_id ? <Link href={`/ventas/pedidos/${i.pedido_id}`} className="enlace-ficha">{i.proforma}</Link> : '—'}
                                </td>
                                <td className="num">{i.bultos.toLocaleString('es-PE')}</td>
                                <td className="num">{cifra(i.kg / 1000)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
