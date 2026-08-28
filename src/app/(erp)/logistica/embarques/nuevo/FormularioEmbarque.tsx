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
  const mejorBodega = [...kgPorBodega.entries()]
    .map(([almacen_id, kg]) => ({
      almacen_id, kg,
      nombre: almacenes.find((a) => a.id === almacen_id)?.nombre ?? '—',
    }))
    .sort((a, b) => b.kg - a.kg)[0];

  /** Lo que se quedaría en otra bodega y necesitaría un traslado. */
  const tmVaradas = tmElegidas - tmCargables;

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    setProblema(null);
    iniciar(async () => {
      const r = await crearEmbarque(d);
      if (!r.ok) { setProblema({ mensaje: r.mensaje, campo: r.campo }); return; }
      router.push('/logistica/embarques');
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
              Se puede embarcar un pedido aunque no esté cubierto al 100 %: eso es un{' '}
              <b>despacho parcial</b>. Los más cubiertos salen primero.
            </p>

            <div className="tabla-envoltorio">
              <table className="datos">
                <thead>
                  <tr>
                    <th></th>
                    <th>Proforma</th>
                    <th>Cliente</th>
                    <th>Destino</th>
                    <th>Su stock está en</th>
                    <th className="num">Pedido</th>
                    <th className="num">Apartado</th>
                    <th className="num">Cobertura</th>
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
                          {p.bodegas.length === 0 ? '—' : p.bodegas.map((b) => (
                            <span key={b.almacen_id} className="bodega-chip"
                                  data-aqui={b.almacen_id === d.almacen_id ? 'si' : 'no'}>
                              {b.nombre} · {cifra(b.kg / 1000, 2)} TM
                            </span>
                          ))}
                          {elegido && fuera.length > 0 && (
                            <span className="bodega-aviso">
                              Desde esta bodega solo se podrán cargar {cifra(enEstaBodega / 1000, 2)} TM.
                              El resto necesita un traslado.
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

            {tmVaradas > 0.005 && (
              <div className="varado">
                <Icono nombre="alerta" tamano={16} />
                <span>
                  <b>{cifra(tmVaradas, 2)} TM quedarían fuera de este embarque</b> porque están en
                  otra bodega. Hay dos salidas y las dos son válidas:
                  <ul>
                    <li>
                      <b>Despachar parcial:</b> sale lo que está en {nombreBodega} y el resto en el
                      próximo embarque. Es lo normal cuando son pocos kilos.
                    </li>
                    <li>
                      <b>Trasladar primero:</b> mover esa mercadería a {nombreBodega} y cargar todo
                      junto. Cuesta un camión y medio día, así que compensa cuando son toneladas.{' '}
                      <Link href="/almacenes/traslados">Ir a traslados</Link>
                    </li>
                  </ul>
                </span>
              </div>
            )}

            {elegidos.length > 0 && (
              <p className="form-pista">
                <b>{elegidos.length} pedido{elegidos.length === 1 ? '' : 's'}</b> con{' '}
                <b>{cifra(tmElegidas, 2)} TM</b> apartadas, de las cuales{' '}
                <b>{cifra(tmCargables, 2)} TM</b> están en {nombreBodega} y se podrán cargar.
              </p>
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
