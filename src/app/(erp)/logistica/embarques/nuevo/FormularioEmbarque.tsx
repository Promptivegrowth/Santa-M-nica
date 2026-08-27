'use client';

/**
 * ============================================================================
 *  PROGRAMAR UN EMBARQUE
 * ============================================================================
 *  Un embarque es la salida: qué día, desde qué bodega, hacia qué puerto.
 *
 *  LO QUE HACE ÚTIL ESTA PANTALLA
 *  Que enseñe los pedidos que se pueden cargar CON SU COBERTURA. Un pedido al
 *  40 % se puede embarcar igual —despacho parcial—, pero conviene saberlo
 *  antes y no cuando el contenedor está a medio llenar. Los que están al 100 %
 *  salen primero, que son los que de verdad están listos.
 *
 *  Y que avise si el camión tiene el SOAT vencido para esa fecha, antes de
 *  programarlo. Enterarse en la carretera cuesta el flete y el contenedor.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
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

  function alternarPedido(id: number) {
    setD((p) => ({
      ...p,
      pedidos: p.pedidos.includes(id) ? p.pedidos.filter((x) => x !== id) : [...p.pedidos, id],
    }));
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
                    onChange={(e) => campo('almacen_id', Number(e.target.value))} required>
              {almacenes.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
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
                    <th className="num">Pedido</th>
                    <th className="num">Apartado</th>
                    <th className="num">Cobertura</th>
                  </tr>
                </thead>
                <tbody>
                  {pedidos.map((p) => {
                    const cobertura = (p.tm_reservadas / (p.tm_pedidas || 1)) * 100;
                    const elegido = d.pedidos.includes(p.id);
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
              <p className="form-pista">
                <b>{elegidos.length} pedido{elegidos.length === 1 ? '' : 's'}</b> con{' '}
                <b>{cifra(tmElegidas, 2)} TM</b> apartadas en total.
              </p>
            )}
          </>
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
