'use client';

/**
 * ============================================================================
 *  AGREGAR Y QUITAR PEDIDOS DE UN EMBARQUE YA PROGRAMADO
 * ============================================================================
 *  Antes los pedidos solo se elegían al programar: si se olvidaba uno, había
 *  que programar otro embarque. Ahora:
 *
 *  · AGREGAR: se ofrecen las proformas con stock apartado EN LA BODEGA DEL
 *    EMBARQUE y saldo por programar —las mismas reglas que el alta—, y por
 *    cada producto «Sale ahora (TM)», que viene con lo apartado allí sin
 *    pasar del saldo. Bajarlo es un despacho parcial.
 *  · QUITAR: solo si ninguno de sus pallets está ya en un contenedor. Si lo
 *    está, el botón se apaga y dice cuál hay que bajar primero.
 *
 *  Todo se vuelve a comprobar en el servidor (y en la base, para quitar).
 *
 *  Un corte de red no rompe la pantalla (accionSegura): vuelve como un aviso
 *  en el mismo cuadro y lo marcado sigue marcado.
 * ============================================================================
 */
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Icono } from '@/components/estructura/Icono';
import { accionSegura } from '@/lib/accionSegura';
import {
  agregarPedidosAEmbarque, lineasParaEmbarcar, pedidosParaAgregar, quitarPedidoDeEmbarque,
  type LineaEmbarcable, type PedidoEmbarcable,
} from '../acciones';
import { consolidarEnBodega } from '@/app/(erp)/almacenes/traslados/acciones';

const cifra = (n: number, d = 1) =>
  n.toLocaleString('es-PE', { minimumFractionDigits: d, maximumFractionDigits: d });

/* ---------------------------------------------------------------------------
   AGREGAR
   --------------------------------------------------------------------------- */
export function AgregarPedidos({
  embarqueId,
  almacenId,
  bodega,
  noPuede,
  noPuedeTrasladar,
}: {
  embarqueId: number;
  almacenId: number;
  bodega: string;
  /** Si no se pueden agregar pedidos, por qué (despachado, cancelado). */
  noPuede: string | null;
  /**
   * Armar traslados lo hacen Gerencia, Operaciones y Almacén. A los demás el
   * botón se les apaga y dice por qué (antes lo veían y el servidor les
   * respondía con un error al pulsarlo).
   */
  noPuedeTrasladar: string | null;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [candidatos, setCandidatos] = useState<PedidoEmbarcable[] | null>(null);
  const [elegidos, setElegidos] = useState<number[]>([]);
  const [lineas, setLineas] = useState<LineaEmbarcable[]>([]);
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [tocadas, setTocadas] = useState<Set<string>>(new Set());
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [consolidado, setConsolidado] = useState<{ ok: boolean; texto: string; enlaces?: { id: number; numero: string }[] } | null>(null);
  const [pendiente, iniciar] = useTransition();
  const [consolidando, iniciarConsolidacion] = useTransition();

  const idsElegidos = elegidos.join(',');
  useEffect(() => {
    let vigente = true;
    const ids = idsElegidos ? idsElegidos.split(',').map(Number) : [];
    accionSegura(() => lineasParaEmbarcar(ids)).then((ls) => { if (vigente && Array.isArray(ls)) setLineas(ls); });
    return () => { vigente = false; };
  }, [idsElegidos]);

  const clave = (l: LineaEmbarcable) => `${l.pedido_linea_id}-${l.sku_presentacion_id}`;
  /** Lo que se propone: lo apartado en la bodega del embarque, sin pasar del saldo. */
  const propuesta = (l: LineaEmbarcable) => {
    const enBodega = l.bodegas.filter((b) => b.almacen_id === almacenId).reduce((t, b) => t + b.kg, 0);
    return Math.max(0, Math.min(enBodega, l.por_programar_kg)) / 1000;
  };
  const tmDe = (l: LineaEmbarcable) => {
    const k = clave(l);
    return tocadas.has(k) ? Number(cantidades[k] || 0) : propuesta(l);
  };

  function abrir() {
    setAbierto(true);
    setAviso(null);
    setConsolidado(null);
    if (candidatos === null) {
      accionSegura(() => pedidosParaAgregar(embarqueId)).then((r) => {
        if (Array.isArray(r)) setCandidatos(r);
        else { setCandidatos([]); setAviso({ ok: false, texto: r.mensaje }); }
      });
    }
  }

  function alternar(id: number) {
    setElegidos((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
    setAviso(null);
  }

  const visibles = lineas.filter((l) => elegidos.includes(l.pedido_id));
  const elegidosDatos = (candidatos ?? []).filter((p) => elegidos.includes(p.id));
  const kgFuera = elegidosDatos.reduce(
    (t, p) => t + p.bodegas.filter((b) => b.almacen_id !== almacenId).reduce((k, b) => k + b.kg, 0), 0);

  function agregar() {
    setAviso(null);
    iniciar(async () => {
      const r = await accionSegura(() => agregarPedidosAEmbarque(
        embarqueId,
        elegidos,
        visibles
          .map((l) => ({ pedido_linea_id: l.pedido_linea_id, sku_presentacion_id: l.sku_presentacion_id, cantidad_kg: Math.round(tmDe(l) * 1000 * 1000) / 1000 }))
          .filter((l) => l.cantidad_kg > 0)
      ));
      setAviso({ ok: r.ok, texto: r.mensaje });
      if (r.ok) {
        setAbierto(false); setElegidos([]); setCandidatos(null); setTocadas(new Set()); setCantidades({});
        router.refresh();
      }
    });
  }

  function consolidar() {
    setConsolidado(null);
    iniciarConsolidacion(async () => {
      const r = await accionSegura(() => consolidarEnBodega(elegidos, almacenId));
      setConsolidado({ ok: r.ok, texto: r.mensaje, enlaces: r.ok ? r.traslados.map((t) => ({ id: t.id, numero: t.numero })) : undefined });
    });
  }

  if (!abierto) {
    return (
      <span style={{ display: 'inline-flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
        {aviso?.ok && <span role="status" style={{ fontSize: '.8rem', color: 'var(--ok)' }}>{aviso.texto}</span>}
        <button type="button" className="btn btn-secundario btn-chico" data-accion="agregar-pedidos"
                disabled={!!noPuede} title={noPuede ?? 'Sumar proformas a este embarque'} onClick={abrir}>
          <Icono nombre="mas" tamano={14} />
          Agregar pedidos
        </button>
      </span>
    );
  }

  return (
    <div className="traslado-panel" data-bloque="agregar-pedidos" style={{ maxWidth: 'none', marginBottom: '.8rem' }}>
      <strong>Agregar pedidos a este embarque</strong>
      <p>
        Solo aparecen las proformas con stock apartado en <b>{bodega}</b> —la bodega de este embarque— y
        con saldo por programar. Marque las que se suman y revise cuánto sale de cada producto.
      </p>

      {candidatos === null ? (
        <p role="status">Buscando pedidos…</p>
      ) : candidatos.length === 0 ? (
        <p data-vacio="si">
          No hay pedidos con stock apartado en {bodega} esperando embarque. Aparte stock desde la cobertura del
          pedido, o prográmelo en otro embarque desde la bodega donde está su mercadería.
        </p>
      ) : (
        <div className="tabla-envoltorio">
          <table className="datos">
            <thead>
              <tr>
                <th></th><th>Proforma</th><th>Cliente</th><th>Destino</th>
                <th>Dónde está lo apartado</th><th className="num">Pidió</th><th className="num">Apartado</th>
              </tr>
            </thead>
            <tbody>
              {candidatos.map((p) => (
                <tr key={p.id} data-elegido={elegidos.includes(p.id) ? 'si' : 'no'}>
                  <td>
                    <input type="checkbox" checked={elegidos.includes(p.id)} onChange={() => alternar(p.id)}
                           aria-label={`Agregar ${p.numero}`} />
                  </td>
                  <td className="mono">{p.numero}</td>
                  <td style={{ fontSize: '.78rem' }}>{p.cliente}</td>
                  <td style={{ fontSize: '.78rem' }}>{p.destino}</td>
                  <td style={{ fontSize: '.74rem' }}>
                    {p.bodegas.map((b) => (
                      <span key={b.almacen_id} className="bodega-chip" data-aqui={b.almacen_id === almacenId ? 'si' : 'no'}>
                        {b.nombre} · {cifra(b.kg / 1000, 2)} TM
                        <i>{b.almacen_id === almacenId ? 'sube' : 'se queda'}</i>
                      </span>
                    ))}
                  </td>
                  <td className="num mono">{cifra(p.tm_pedidas)} TM</td>
                  <td className="num mono">{cifra(p.tm_reservadas)} TM</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {visibles.length > 0 && (
        <div className="embarque-lineas" data-bloque="embarque-lineas-agregar">
          <div className="decision-cab">
            <strong>Qué sale de cada proforma</strong>
            <span>Se propone lo apartado en {bodega}. Bájelo para un despacho parcial.</span>
          </div>
          <div className="tabla-envoltorio">
            <table className="datos">
              <thead>
                <tr>
                  <th>Proforma</th><th>Producto pedido</th><th>SKU apartado</th>
                  <th className="num">Pedido</th><th className="num">En otros embarques</th>
                  <th className="num">Apartado</th><th className="num">Sale ahora (TM)</th><th className="num">Queda pendiente</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((l) => {
                  const k = clave(l);
                  const saleLinea = lineas.filter((x) => x.pedido_linea_id === l.pedido_linea_id).reduce((t, x) => t + tmDe(x), 0);
                  const pendienteKg = Math.max(0, l.por_programar_kg / 1000 - saleLinea);
                  const excede = saleLinea * 1000 > l.por_programar_kg + 0.5;
                  return (
                    <tr key={k} data-linea={k} data-alerta={excede ? 'si' : 'no'}>
                      <td className="mono">{(candidatos ?? []).find((p) => p.id === l.pedido_id)?.numero}</td>
                      <td style={{ fontSize: '.74rem' }}>{l.producto}</td>
                      <td style={{ fontSize: '.74rem' }}>
                        {l.reservado_kg > 0 ? l.sku : <span style={{ color: 'var(--tinta-3)' }}>Sin apartar</span>}
                        {l.equivalente && <> <span className="pill pill-atencion">Equivalente</span></>}
                      </td>
                      <td className="num mono">{cifra(l.pedido_kg / 1000, 3)}</td>
                      <td className="num mono">{l.programado_kg > 0 ? cifra(l.programado_kg / 1000, 3) : '—'}</td>
                      <td className="num mono">{cifra(l.reservado_kg / 1000, 3)}</td>
                      <td className="num">
                        <input className="campo form-mini" type="number" min="0" step="0.001" name={`sale-${k}`}
                               value={tocadas.has(k) ? cantidades[k] ?? '' : String(Math.round(propuesta(l) * 1000) / 1000)}
                               onChange={(e) => {
                                 setTocadas((t) => new Set(t).add(k));
                                 setCantidades((c) => ({ ...c, [k]: e.target.value }));
                                 setAviso(null);
                               }} />
                        {excede && <><br /><span className="pill pill-critico">Más que el saldo</span></>}
                      </td>
                      <td className="num mono">{cifra(pendienteKg, 3)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Lo apartado en otra bodega no sube: se avisa con los kilos y se ofrece juntarlo. */}
      {kgFuera > 5 && (
        <div className="decision-falta">
          <p>
            <b>Quedan {cifra(kgFuera / 1000, 2)} TM apartadas en otra bodega.</b> El contenedor se carga en {bodega}:
            esos kilos no suben salvo que antes se trasladen.
          </p>
          <button type="button" className="btn btn-secundario btn-chico" onClick={consolidar}
                  disabled={consolidando || !!noPuedeTrasladar} title={noPuedeTrasladar ?? undefined}
                  data-accion="consolidar-agregar">
            <Icono nombre="traslados" tamano={14} />
            {consolidando ? 'Armando…' : `Armar el traslado de ${cifra(kgFuera / 1000, 2)} TM`}
          </button>
          {noPuedeTrasladar && (
            <p className="form-pista" data-motivo="consolidar" style={{ margin: '.35rem 0 0' }}>{noPuedeTrasladar}</p>
          )}
          {consolidado && (
            <div className={`ficha-aviso ${consolidado.ok ? 'ficha-aviso-info' : 'ficha-aviso-critico'}`} role={consolidado.ok ? 'status' : 'alert'}>
              <Icono nombre="alerta" tamano={16} />
              <span>
                {consolidado.texto}{' '}
                {consolidado.enlaces?.map((t) => (
                  <Link key={t.id} href={`/almacenes/traslados/${t.id}`} style={{ marginInlineEnd: '.5rem' }}>{t.numero}</Link>
                ))}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="acciones-fila">
        <button type="button" className="btn btn-primario" data-accion="confirmar-agregar-pedidos"
                disabled={pendiente || elegidos.length === 0} onClick={agregar}>
          {pendiente ? 'Agregando…' : elegidos.length ? `Agregar ${elegidos.length} pedido${elegidos.length === 1 ? '' : 's'} al embarque` : 'Agregar al embarque'}
        </button>
        <button type="button" className="btn btn-sutil" disabled={pendiente} onClick={() => setAbierto(false)}>Cancelar</button>
      </div>
      {aviso && !aviso.ok && <p role="alert" className="form-mensaje error">{aviso.texto}</p>}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   QUITAR (un botón por fila de la tabla de pedidos)
   --------------------------------------------------------------------------- */
export function QuitarPedido({
  embarqueId,
  pedidoId,
  proforma,
  noPuede,
}: {
  embarqueId: number;
  pedidoId: number;
  proforma: string;
  /** Si no se puede quitar, por qué (pallets ya en un contenedor, embarque cerrado…). */
  noPuede: string | null;
}) {
  const router = useRouter();
  const [seguro, setSeguro] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  if (!seguro) {
    return (
      <button type="button" className="accion-btn" data-accion="quitar-pedido" data-pedido={pedidoId}
              disabled={!!noPuede} title={noPuede ?? `Quitar ${proforma} de este embarque`}
              onClick={() => { setSeguro(true); setError(null); }}>
        <Icono nombre="papelera" tamano={15} />
      </button>
    );
  }
  return (
    <span style={{ display: 'inline-flex', gap: '.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <button type="button" className="btn btn-peligro btn-chico" disabled={pendiente} data-accion="confirmar-quitar-pedido"
              onClick={() => iniciar(async () => {
                const r = await accionSegura(() => quitarPedidoDeEmbarque(embarqueId, pedidoId));
                if (!r.ok) { setError(r.mensaje); return; }
                setSeguro(false);
                router.refresh();
              })}>
        {pendiente ? 'Quitando…' : `Quitar ${proforma}`}
      </button>
      <button type="button" className="btn btn-sutil btn-chico" disabled={pendiente} onClick={() => setSeguro(false)}>No</button>
      {error && <span role="alert" style={{ fontSize: '.74rem', color: 'var(--critico)', maxWidth: '18rem' }}>{error}</span>}
    </span>
  );
}
