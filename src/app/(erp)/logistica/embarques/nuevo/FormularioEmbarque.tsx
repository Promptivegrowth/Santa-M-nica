'use client';

/**
 * ============================================================================
 *  PROGRAMAR UN EMBARQUE
 * ============================================================================
 *  PRIMERO EL PEDIDO, DESPUÉS LA BODEGA
 *
 *  Este formulario empezó pidiendo la bodega de salida antes que los pedidos,
 *  y estaba mal. Nadie piensa «hoy despacho desde Freeko»: piensa «tengo que
 *  sacar el pedido de AGI Trading». La bodega no es una decisión de partida,
 *  es una CONSECUENCIA de dónde quedó apartado el stock.
 *
 *  Así que ahora se eligen primero los pedidos y el sistema propone la bodega
 *  desde la que se puede cargar más. Se puede cambiar —a veces el contenedor
 *  ya está reservado en un terminal concreto y entonces sí manda la bodega—,
 *  pero el valor que llega puesto es el correcto casi siempre.
 *
 *  POR QUÉ UNA SOLA BODEGA Y NO VARIAS
 *  Porque un contenedor se arrima al muelle de UNA cámara y se carga ahí.
 *  Recorrer tres almacenes recogiendo pallets rompe la cadena de frío y
 *  multiplica movimientos y documentos. Lo que quede en otra bodega necesita
 *  un traslado antes, y esta pantalla lo dice con los kilos exactos para que
 *  se pueda decidir si compensa.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Icono } from '@/components/estructura/Icono';
import { crearEmbarque, type DatosEmbarque, type PedidoEmbarcable } from '../acciones';
import { consolidarEnBodega } from '@/app/(erp)/almacenes/traslados/acciones';

const cifra = (n: number, d = 1) =>
  n.toLocaleString('es-PE', { minimumFractionDigits: d, maximumFractionDigits: d });

export function FormularioEmbarque({
  almacenes,
  destinos,
  transportistas,
  vehiculos,
  conductores,
  pedidos,
  hoy,
}: {
  almacenes: { id: number; nombre: string }[];
  destinos: { id: number; puerto: string; pais: string }[];
  transportistas: { id: number; nombre: string }[];
  vehiculos: { id: number; placa: string; soat: string | null; revision: string | null }[];
  conductores: { id: number; nombre: string }[];
  pedidos: PedidoEmbarcable[];
  hoy: string;
}) {
  const router = useRouter();
  const [guardando, iniciar] = useTransition();

  const [d, setD] = useState<DatosEmbarque>({
    fecha_programada: hoy,
    almacen_id: almacenes[0]?.id ?? 0,
    destino_id: null,
    tipo_despacho: 'exportacion',
    booking: '',
    naviera: '',
    transportista_id: null,
    vehiculo_id: null,
    conductor_id: null,
    observaciones: '',
    pedidos: [],
  });

  const [problema, setProblema] = useState<{ mensaje: string; campo?: string } | null>(null);
  const [consolidando, iniciarConsolidacion] = useTransition();
  const [consolidado, setConsolidado] =
    useState<{ ok: boolean; texto: string; enlaces?: { id: number; numero: string }[] } | null>(null);

  function campo<K extends keyof DatosEmbarque>(k: K, v: DatosEmbarque[K]) {
    setD((p) => ({ ...p, [k]: v }));
    setProblema(null);
  }

  /** Si el usuario ya eligió bodega a mano, no se le vuelve a mover. */
  const [bodegaTocada, setBodegaTocada] = useState(false);

  function alternarPedido(id: number) {
    setD((p) => {
      const yaEstaba = p.pedidos.includes(id);
      const siguiente = yaEstaba
        ? p.pedidos.filter((x) => x !== id)
        : [...p.pedidos, id];

      /*
       * Al marcar el PRIMER pedido se propone la bodega donde tiene más kilos
       * apartados: es la que permite cargar más sin trasladar nada. Solo se
       * propone si el usuario no eligió una a mano, y solo con el primero:
       * cambiarle la bodega al marcar el cuarto pedido sería desconcertante.
       */
      if (!yaEstaba && p.pedidos.length === 0 && !bodegaTocada) {
        const pedido = pedidos.find((x) => x.id === id);
        const mayor = pedido?.bodegas?.[0];
        if (mayor) return { ...p, pedidos: siguiente, almacen_id: mayor.almacen_id };
      }
      return { ...p, pedidos: siguiente };
    });
    setProblema(null);
  }

  /* El aviso del vehículo se calcula aquí para verlo al elegirlo, sin esperar
     a guardar. El servidor lo vuelve a comprobar: esto es comodidad. */
  const vehiculo = vehiculos.find((v) => v.id === d.vehiculo_id);
  const vencidos = vehiculo
    ? [
        vehiculo.soat && vehiculo.soat < d.fecha_programada ? 'el SOAT' : null,
        vehiculo.revision && vehiculo.revision < d.fecha_programada ? 'la revisión técnica' : null,
      ].filter(Boolean)
    : [];

  const elegidos = pedidos.filter((p) => d.pedidos.includes(p.id));
  const tmElegidas = elegidos.reduce((s, p) => s + p.tm_reservadas, 0);

  /* Lo que de verdad se podrá cargar: solo lo que está en la bodega elegida. */
  const tmCargables = elegidos.reduce(
    (total, p) => total + p.bodegas
      .filter((b) => b.almacen_id === d.almacen_id)
      .reduce((k, b) => k + b.kg, 0) / 1000,
    0
  );
  const nombreBodega = almacenes.find((a) => a.id === d.almacen_id)?.nombre ?? 'la bodega elegida';

  /*
   * Cuántos kilos de los pedidos elegidos hay en CADA bodega. Con eso se sabe
   * cuál conviene, y se puede enseñar la comparación en vez de obligar a
   * deducirla de los chips uno por uno.
   */
  const kgPorBodega = new Map<number, number>();
  for (const p of elegidos) {
    for (const b of p.bodegas) {
      kgPorBodega.set(b.almacen_id, (kgPorBodega.get(b.almacen_id) ?? 0) + b.kg);
    }
  }
  const opcionesBodega = [...kgPorBodega.entries()]
    .map(([almacen_id, kg]) => ({
      almacen_id, kg,
      nombre: almacenes.find((a) => a.id === almacen_id)?.nombre ?? '—',
    }))
    .sort((a, b) => b.kg - a.kg);
  const mejorBodega = opcionesBodega[0];

  /** Lo que se quedaría en otra bodega y necesitaría un traslado. */
  const tmVaradas = tmElegidas - tmCargables;

  /**
   * Arma los traslados que hacen falta para poder cargarlo todo desde la
   * bodega elegida. Es la salida al problema, no solo el aviso de que existe.
   */
  function consolidar() {
    setConsolidado(null);
    iniciarConsolidacion(async () => {
      const r = await consolidarEnBodega(d.pedidos, d.almacen_id);
      setConsolidado({
        ok: r.ok,
        texto: r.mensaje,
        enlaces: r.ok ? r.traslados.map((t) => ({ id: t.id, numero: t.numero })) : undefined,
      });
    });
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    setProblema(null);
    iniciar(async () => {
      const r = await crearEmbarque(d);
      if (!r.ok) { setProblema({ mensaje: r.mensaje, campo: r.campo }); return; }

      /*
       * Se va a la FICHA del embarque, no a la lista.
       *
       * Volver a la lista dejaba al usuario buscando entre 190 embarques el
       * que acababa de crear —y la lista ordena por fecha, así que uno para
       * mañana queda al fondo—. Además, el paso siguiente es crearle el
       * contenedor, y eso se hace justamente en su ficha.
       */
      router.push(`/logistica/embarques/${r.id}`);
      router.refresh();
    });
  }

  const error = (n: string) => (problema?.campo === n ? 'si' : undefined);

  return (
    <form className="form-maestro" onSubmit={enviar}>
      {problema && (
        <div className="ficha-aviso ficha-aviso-critico" role="alert">
          <Icono nombre="alerta" tamano={17} />
          <span>{problema.mensaje}</span>
        </div>
      )}

      <fieldset className="form-bloque">
        <legend>Qué pedidos van en este embarque</legend>

        {pedidos.length === 0 ? (
          <p className="form-pista" style={{ marginTop: 0 }}>
            No hay pedidos con stock apartado esperando embarque. Aparte stock desde la pestaña de
            cobertura de un pedido y vuelva.
          </p>
        ) : (
          <>
            <p className="form-pista" style={{ marginTop: 0, marginBottom: '.6rem' }}>
              Marque los pedidos que salen. La bodega de abajo se propone sola según dónde esté
              su mercadería.
              <br />
              <b>Cubierto</b> compara lo apartado con lo que pidió el cliente: al 50 % todavía le
              falta la mitad por conseguir. Se puede embarcar igual —eso es un{' '}
              <b>despacho parcial</b>— y el resto sale en el próximo.
            </p>

            <div className="tabla-envoltorio">
              <table className="datos">
                <thead>
                  <tr>
                    <th></th>
                    <th>Proforma</th>
                    <th>Cliente</th>
                    <th>Destino</th>
                    <th>
                      Dónde está lo apartado
                      <small>al marcar, dice cuál sube</small>
                    </th>
                    <th className="num">
                      Pidió
                      <small>el cliente</small>
                    </th>
                    <th className="num">
                      Apartado
                      <small>en total</small>
                    </th>
                    <th className="num">
                      Cubierto
                      <small>de lo que pidió</small>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pedidos.map((p) => {
                    const cobertura = (p.tm_reservadas / (p.tm_pedidas || 1)) * 100;
                    const elegido = d.pedidos.includes(p.id);

                    /*
                     * Los kilos que SÍ se pueden cargar en este embarque son
                     * solo los que están en la bodega de salida. El resto
                     * necesita un traslado antes, y más vale saberlo ahora que
                     * el día de la carga con el contenedor esperando.
                     */
                    const enEstaBodega = p.bodegas
                      .filter((b) => b.almacen_id === d.almacen_id)
                      .reduce((k, b) => k + b.kg, 0);
                    const fuera = p.bodegas.filter((b) => b.almacen_id !== d.almacen_id);

                    return (
                      <tr key={p.id} data-elegido={elegido ? 'si' : 'no'}>
                        <td>
                          <input type="checkbox" checked={elegido}
                                 onChange={() => alternarPedido(p.id)}
                                 aria-label={`Incluir ${p.numero}`} />
                        </td>
                        <td className="mono">{p.numero}</td>
                        <td style={{ fontSize: '.78rem' }}>{p.cliente}</td>
                        <td style={{ fontSize: '.78rem' }}>{p.destino}</td>
                        <td style={{ fontSize: '.74rem' }}>
                          {/*
                            Los chips solo se marcan como «sube» o «se queda»
                            cuando ESA fila está elegida. Antes se marcaban
                            todas contra la bodega por defecto, que era la
                            primera alfabéticamente y casi nunca tenía nada:
                            la tabla entera salía tachada antes de que el
                            usuario hiciera nada, y parecía que no funcionaba.
                          */}
                          {p.bodegas.length === 0 ? '—' : p.bodegas.map((b) => {
                            const cargable = b.almacen_id === d.almacen_id;
                            return (
                              <span key={b.almacen_id} className="bodega-chip"
                                    data-aqui={!elegido ? 'neutro' : cargable ? 'si' : 'no'}
                                    title={!elegido
                                      ? `${cifra(b.kg / 1000, 2)} TM apartadas en ${b.nombre}`
                                      : cargable
                                        ? 'Está en la bodega de salida: sube al contenedor'
                                        : 'Está en otra bodega: no sube a este contenedor'}>
                                {b.nombre} · {cifra(b.kg / 1000, 2)} TM
                                {elegido && <i>{cargable ? 'sube' : 'se queda'}</i>}
                              </span>
                            );
                          })}
                          {elegido && fuera.length > 0 && (
                            <span className="bodega-aviso">
                              Suben {cifra(enEstaBodega / 1000, 2)} TM desde {nombreBodega}.
                            </span>
                          )}
                        </td>
                        <td className="num mono">{cifra(p.tm_pedidas)} TM</td>
                        <td className="num mono">{cifra(p.tm_reservadas)} TM</td>
                        <td className="num mono"
                            style={{ color: cobertura >= 99 ? 'var(--ok)' : 'var(--atencion)' }}>
                          {cifra(cobertura, 0)} %
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {elegidos.length > 0 && (
              <div className="decision">
                <div className="decision-cab">
                  <strong>Desde qué bodega conviene salir</strong>
                  <span>
                    {elegidos.length} pedido{elegidos.length === 1 ? '' : 's'} ·{' '}
                    {cifra(tmElegidas, 2)} TM apartadas en total
                  </span>
                </div>

                {/*
                  Cada bodega con lo que se cargaría desde ella. Elegir es un
                  clic aquí, no bajar al desplegable: esta es LA decisión de
                  la pantalla y merece estar donde se toma.
                */}
                <ul className="decision-bodegas">
                  {opcionesBodega.map((o) => {
                    const pct = tmElegidas > 0 ? (o.kg / 1000 / tmElegidas) * 100 : 0;
                    const activa = o.almacen_id === d.almacen_id;
                    return (
                      <li key={o.almacen_id}>
                        <button type="button" data-activa={activa ? 'si' : 'no'}
                                onClick={() => { setBodegaTocada(true); campo('almacen_id', o.almacen_id); }}>
                          <span className="dec-nombre">{o.nombre}</span>
                          <span className="dec-kg">{cifra(o.kg / 1000, 2)} TM</span>
                          <span className="dec-barra">
                            <i style={{ width: `${Math.max(3, pct)}%` }} />
                          </span>
                          <span className="dec-pct">{cifra(pct, 0)} %</span>
                          {activa && <span className="dec-marca">Elegida</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>

                {tmVaradas > 0.005 ? (
                  <div className="decision-falta">
                    <p>
                      <b>Quedan {cifra(tmVaradas, 2)} TM en otra bodega.</b> El contenedor se carga
                      en una sola —{nombreBodega}—, así que cuando el camión esté en el muelle esos
                      kilos seguirán donde están. Dos salidas, las dos válidas:
                    </p>
                    <div className="decision-opciones">
                      <div>
                        <b>Despachar parcial</b>
                        <small>
                          Salen {cifra(tmCargables, 2)} TM ahora y el resto en el próximo embarque.
                          Es lo normal cuando son pocos kilos: mover mercadería cuesta un camión y
                          medio día.
                        </small>
                        <span className="decision-nada">No hay que hacer nada: siga programando.</span>
                      </div>
                      <div>
                        <b>Consolidar primero</b>
                        <small>
                          Junta esas {cifra(tmVaradas, 2)} TM en {nombreBodega} y sale todo en un
                          solo contenedor. Compensa cuando son toneladas.
                        </small>
                        <button type="button" className="btn btn-secundario btn-chico"
                                onClick={consolidar} disabled={consolidando}>
                          <Icono nombre="traslados" tamano={14} />
                          {consolidando ? 'Armando…' : `Armar el traslado de ${cifra(tmVaradas, 2)} TM`}
                        </button>
                      </div>
                    </div>

                    {consolidado && (
                      <div className={`ficha-aviso ${consolidado.ok ? 'ficha-aviso-info' : 'ficha-aviso-critico'}`}
                           role={consolidado.ok ? 'status' : 'alert'}>
                        <Icono nombre="alerta" tamano={16} />
                        <span>
                          {consolidado.texto}
                          {consolidado.enlaces?.length ? (
                            <>
                              {' '}
                              {consolidado.enlaces.map((t) => (
                                <Link key={t.id} href={`/almacenes/traslados/${t.id}`}
                                      style={{ marginInlineEnd: '.5rem' }}>
                                  {t.numero}
                                </Link>
                              ))}
                            </>
                          ) : null}
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="decision-completo">
                    <Icono nombre="ingresos" tamano={15} />
                    Todo lo apartado está en {nombreBodega}: suben las {cifra(tmCargables, 2)} TM
                    completas.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </fieldset>

      <fieldset className="form-bloque">
        <legend>Cuándo y hacia dónde</legend>
        <div className="form-rejilla">
          <label className="form-campo">
            <span>Fecha de salida <b className="req">*</b></span>
            <input className="campo" type="date" value={d.fecha_programada} data-error={error('fecha_programada')}
                   onChange={(e) => campo('fecha_programada', e.target.value)} required />
          </label>

          <label className="form-campo">
            <span>Tipo</span>
            <select className="campo" value={d.tipo_despacho}
                    onChange={(e) => campo('tipo_despacho', e.target.value as DatosEmbarque['tipo_despacho'])}>
              <option value="exportacion">Exportación</option>
              <option value="mercado_nacional">Mercado nacional</option>
              <option value="traslado">Traslado</option>
            </select>
          </label>

          <label className="form-campo">
            <span>Bodega de salida <b className="req">*</b></span>
            <select className="campo" value={d.almacen_id || ''} data-error={error('almacen_id')}
                    onChange={(e) => { setBodegaTocada(true); campo('almacen_id', Number(e.target.value)); }}
                    required>
              {almacenes.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre}
                  {kgPorBodega.get(a.id)
                    ? ` — ${cifra((kgPorBodega.get(a.id) ?? 0) / 1000, 2)} TM cargables`
                    : ''}
                </option>
              ))}
            </select>
            <small>
              {elegidos.length === 0
                ? 'Se propone sola al elegir el primer pedido, según dónde esté su stock.'
                : mejorBodega && mejorBodega.almacen_id !== d.almacen_id
                  ? `Desde ${mejorBodega.nombre} se cargarían ${cifra(mejorBodega.kg / 1000, 2)} TM, más que desde aquí.`
                  : 'Es la bodega con más kilos cargables de los pedidos elegidos.'}
            </small>
          </label>

          <label className="form-campo">
            <span>Destino {d.tipo_despacho === 'exportacion' && <b className="req">*</b>}</span>
            <select className="campo" value={d.destino_id ?? ''} data-error={error('destino_id')}
                    onChange={(e) => campo('destino_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">Sin especificar</option>
              {destinos.map((x) => (
                <option key={x.id} value={x.id}>{x.puerto}{x.pais ? `, ${x.pais}` : ''}</option>
              ))}
            </select>
          </label>

          <label className="form-campo">
            <span>Booking</span>
            <input className="campo mono" value={d.booking ?? ''} maxLength={40}
                   onChange={(e) => campo('booking', e.target.value)} placeholder="LMM000000" />
          </label>

          <label className="form-campo">
            <span>Naviera</span>
            <input className="campo" value={d.naviera ?? ''} maxLength={60}
                   onChange={(e) => campo('naviera', e.target.value)} placeholder="COSCO, Maersk…" />
          </label>
        </div>
      </fieldset>

      <fieldset className="form-bloque">
        <legend>Quién lo lleva</legend>
        <div className="form-rejilla">
          <label className="form-campo">
            <span>Transportista</span>
            <select className="campo" value={d.transportista_id ?? ''}
                    onChange={(e) => campo('transportista_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">Sin asignar</option>
              {transportistas.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
          </label>

          <label className="form-campo">
            <span>Vehículo</span>
            <select className="campo" value={d.vehiculo_id ?? ''} data-error={error('vehiculo_id')}
                    onChange={(e) => campo('vehiculo_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">Sin asignar</option>
              {vehiculos.map((v) => <option key={v.id} value={v.id}>{v.placa}</option>)}
            </select>
          </label>

          <label className="form-campo">
            <span>Conductor</span>
            <select className="campo" value={d.conductor_id ?? ''}
                    onChange={(e) => campo('conductor_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">Sin asignar</option>
              {conductores.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
        </div>

        {vencidos.length > 0 && (
          <div className="form-consecuencia local" style={{ borderColor: 'var(--critico)', background: 'var(--critico-suave)' }}>
            <Icono nombre="alerta" tamano={16} />
            <span>
              A <b>{vehiculo?.placa}</b> se le vence {vencidos.join(' y ')} antes del{' '}
              {d.fecha_programada}. Un camión sin documentos en regla no puede salir.
            </span>
          </div>
        )}
      </fieldset>

      <fieldset className="form-bloque">
        <legend>Observaciones</legend>
        <label className="form-campo form-campo-ancho">
          <span>Notas de este embarque</span>
          <input className="campo" value={d.observaciones ?? ''} maxLength={300}
                 onChange={(e) => campo('observaciones', e.target.value)}
                 placeholder="Instrucciones especiales, coordinaciones, lo que convenga dejar dicho" />
          <small>Sale en la ficha del embarque y en el calendario.</small>
        </label>
      </fieldset>

      <div className="form-acciones">
        <button type="submit" className="btn btn-primario" disabled={guardando}>
          <Icono nombre="embarques" tamano={15} />
          {guardando ? 'Programando…' : 'Programar embarque'}
        </button>
      </div>
    </form>
  );
}
