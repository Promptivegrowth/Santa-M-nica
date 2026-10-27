'use client';

/**
 * ============================================================================
 *  EDITAR EL EMBARQUE YA PROGRAMADO
 * ============================================================================
 *  Lo que cambia en la coordinación después de programar: la fecha («el
 *  cliente lo pidió para el jueves»), el booking y la naviera cuando llegan,
 *  el camión y el chofer. Con las mismas reglas que el alta —destino
 *  obligatorio en exportación, vehículo con SOAT y revisión al día para la
 *  fecha de salida— comprobadas otra vez en el servidor.
 *
 *  No se cambian la bodega ni el tipo: los contenedores ya se arman ahí y para
 *  ese tipo. Un embarque despachado o cancelado ya no se edita: el botón se
 *  apaga y lo dice.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { accionSegura } from '@/lib/accionSegura';
import { editarEmbarque, type DatosEdicionEmbarque } from '../acciones';

export function EditarEmbarque({
  embarqueId,
  datos,
  tipoDespacho,
  destinos,
  transportistas,
  vehiculos,
  conductores,
  noPuede,
}: {
  embarqueId: number;
  datos: DatosEdicionEmbarque;
  tipoDespacho: string;
  destinos: { id: number; puerto: string; pais: string }[];
  transportistas: { id: number; nombre: string }[];
  vehiculos: { id: number; placa: string; soat: string | null; revision: string | null }[];
  conductores: { id: number; nombre: string }[];
  /** Si no se puede editar, por qué. */
  noPuede: string | null;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [d, setD] = useState<DatosEdicionEmbarque>(datos);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string; campo?: string } | null>(null);
  const [pendiente, iniciar] = useTransition();

  const poner = <K extends keyof DatosEdicionEmbarque>(k: K, v: DatosEdicionEmbarque[K]) => {
    setD((x) => ({ ...x, [k]: v }));
    setAviso(null);
  };
  const numero = (v: string) => (v ? Number(v) : null);
  const error = (n: string) => (aviso && !aviso.ok && aviso.campo === n ? 'si' : undefined);

  //  El aviso del vehículo, mientras se elige (el servidor lo vuelve a comprobar).
  const vehiculo = vehiculos.find((v) => v.id === d.vehiculo_id);
  const vencidos = vehiculo
    ? [vehiculo.soat && vehiculo.soat < d.fecha_programada ? 'el SOAT' : null,
       vehiculo.revision && vehiculo.revision < d.fecha_programada ? 'la revisión técnica' : null].filter(Boolean)
    : [];

  function guardar() {
    setAviso(null);
    iniciar(async () => {
      const r = await accionSegura(() => editarEmbarque(embarqueId, d));
      setAviso({ ok: r.ok, texto: r.mensaje, campo: r.ok || !('campo' in r) ? undefined : r.campo });
      if (r.ok) { setAbierto(false); router.refresh(); }
    });
  }

  if (!abierto) {
    return (
      <div style={{ padding: '0 1rem 1rem', display: 'flex', gap: '.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-secundario" data-accion="editar-embarque"
                disabled={!!noPuede} title={noPuede ?? 'Cambiar fecha, destino, booking, naviera o transporte'}
                onClick={() => { setD(datos); setAbierto(true); setAviso(null); }}>
          Editar embarque
        </button>
        {noPuede && <small style={{ color: 'var(--tinta-3)' }}>{noPuede}</small>}
        {aviso && <span role="status" style={{ color: aviso.ok ? 'var(--ok)' : 'var(--critico)', fontSize: '.85rem' }}>{aviso.texto}</span>}
      </div>
    );
  }

  return (
    <div data-bloque="editar-embarque" style={{ borderTop: '1px solid var(--linea)', paddingTop: '.8rem' }}>
      <div className="form-rejilla" style={{ padding: '0 1rem' }}>
        <label className="form-campo">
          <span>Fecha de salida <b className="req">*</b></span>
          <input type="date" className="campo" name="fecha_programada" value={d.fecha_programada} data-error={error('fecha_programada')}
                 onChange={(e) => poner('fecha_programada', e.target.value)} />
        </label>
        <label className="form-campo">
          <span>Destino {tipoDespacho === 'exportacion' && <b className="req">*</b>}</span>
          <select className="campo" name="destino_id" value={d.destino_id ?? ''} data-error={error('destino_id')}
                  onChange={(e) => poner('destino_id', numero(e.target.value))}>
            <option value="">Sin especificar</option>
            {destinos.map((x) => <option key={x.id} value={x.id}>{x.puerto}{x.pais ? `, ${x.pais}` : ''}</option>)}
          </select>
        </label>
        <label className="form-campo">
          <span>Booking</span>
          <input className="campo mono" name="booking" maxLength={40} value={d.booking ?? ''} data-error={error('booking')}
                 onChange={(e) => poner('booking', e.target.value)} placeholder="LMM000000" />
          {tipoDespacho === 'exportacion' && <small>Hace falta para confirmar una exportación.</small>}
        </label>
        <label className="form-campo">
          <span>Naviera</span>
          <input className="campo" name="naviera" maxLength={60} value={d.naviera ?? ''}
                 onChange={(e) => poner('naviera', e.target.value)} placeholder="COSCO, Maersk…" />
        </label>
        <label className="form-campo">
          <span>Transportista</span>
          <select className="campo" name="transportista_id" value={d.transportista_id ?? ''}
                  onChange={(e) => poner('transportista_id', numero(e.target.value))}>
            <option value="">Sin asignar</option>
            {transportistas.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
        </label>
        <label className="form-campo">
          <span>Vehículo</span>
          <select className="campo" name="vehiculo_id" value={d.vehiculo_id ?? ''} data-error={error('vehiculo_id')}
                  onChange={(e) => poner('vehiculo_id', numero(e.target.value))}>
            <option value="">Sin asignar</option>
            {vehiculos.map((v) => <option key={v.id} value={v.id}>{v.placa}</option>)}
          </select>
        </label>
        <label className="form-campo">
          <span>Conductor</span>
          <select className="campo" name="conductor_id" value={d.conductor_id ?? ''}
                  onChange={(e) => poner('conductor_id', numero(e.target.value))}>
            <option value="">Sin asignar</option>
            {conductores.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <label className="form-campo form-campo-ancho">
          <span>Observaciones</span>
          <textarea className="campo" name="observaciones_edicion" rows={3} maxLength={1000} value={d.observaciones ?? ''}
                    onChange={(e) => poner('observaciones', e.target.value)} />
        </label>
      </div>

      {vencidos.length > 0 && (
        <p className="form-mensaje error" style={{ margin: '.4rem 1rem' }}>
          A {vehiculo?.placa} se le vence {vencidos.join(' y ')} antes del {d.fecha_programada}. Un camión sin
          documentos en regla no puede salir.
        </p>
      )}

      <div style={{ padding: '.6rem 1rem 1rem', display: 'flex', gap: '.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primario" disabled={pendiente} data-accion="guardar-embarque" onClick={guardar}>
          {pendiente ? 'Guardando…' : 'Guardar cambios'}
        </button>
        <button type="button" className="btn btn-sutil" disabled={pendiente} onClick={() => setAbierto(false)}>Cancelar</button>
        {aviso && !aviso.ok && <span role="alert" style={{ color: 'var(--critico)', fontSize: '.85rem' }}>{aviso.texto}</span>}
      </div>
    </div>
  );
}
