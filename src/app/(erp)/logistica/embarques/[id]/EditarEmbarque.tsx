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
 *  Y los datos de PROGRAMACIÓN («Observaciones ERP 4», 07, 11 y 13): semana
 *  de despacho, fecha de zarpe, operador logístico y N.º de packing. Esos se
 *  siguen corrigiendo aunque el embarque ya se haya despachado —la nave puede
 *  zarpar más tarde, el PL puede tener que alinearse con la numeración real—;
 *  en ese caso el resto del formulario se apaga y lo dice.
 *
 *  No se cambian la bodega ni el tipo: los contenedores ya se arman ahí y para
 *  ese tipo. Un embarque cancelado ya no se edita: el botón se apaga y lo dice.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { accionSegura } from '@/lib/accionSegura';
import { normalizarNumeroPacking, problemaNumeroPacking, semanaIso } from '@/lib/numeroPacking';
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
  soloProgramacion = false,
  sugerenciasOperador = [],
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
  /** Ya despachado: solo semana, zarpe, operador y N.º de packing. */
  soloProgramacion?: boolean;
  /** Operadores logísticos ya usados, para no escribirlos cada vez distinto. */
  sugerenciasOperador?: string[];
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [d, setD] = useState<DatosEdicionEmbarque>(datos);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string; campo?: string } | null>(null);
  const [pendiente, iniciar] = useTransition();
  /** Si la semana se escribió a mano, ya no sigue a la fecha. */
  const [semanaTocada, setSemanaTocada] = useState(false);

  const poner = <K extends keyof DatosEdicionEmbarque>(k: K, v: DatosEdicionEmbarque[K]) => {
    setD((x) => ({ ...x, [k]: v }));
    setAviso(null);
  };
  const numero = (v: string) => (v ? Number(v) : null);
  const error = (n: string) => (aviso && !aviso.ok && aviso.campo === n ? 'si' : undefined);
  const bloqueado = soloProgramacion;
  const semanaDeFecha = semanaIso(d.fecha_programada);

  //  El aviso del vehículo, mientras se elige (el servidor lo vuelve a comprobar).
  const vehiculo = vehiculos.find((v) => v.id === d.vehiculo_id);
  const vencidos = vehiculo && !bloqueado
    ? [vehiculo.soat && vehiculo.soat < d.fecha_programada ? 'el SOAT' : null,
       vehiculo.revision && vehiculo.revision < d.fecha_programada ? 'la revisión técnica' : null].filter(Boolean)
    : [];
  const zarpeAntes = !!d.fecha_zarpe && d.fecha_zarpe < d.fecha_programada;
  const problemaPl = (d.numero_packing ?? '').trim() ? problemaNumeroPacking(d.numero_packing) : null;

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
                disabled={!!noPuede}
                title={noPuede ?? (soloProgramacion
                  ? 'Ya despachado: puede corregir la semana, el zarpe, el operador logístico y el N.º de packing'
                  : 'Cambiar fecha, destino, booking, naviera, transporte, zarpe, operador o N.º de packing')}
                onClick={() => {
                  setD({ ...datos, semana_despacho: datos.semana_despacho ?? semanaIso(datos.fecha_programada) });
                  setSemanaTocada(datos.semana_despacho != null && datos.semana_despacho !== semanaIso(datos.fecha_programada));
                  setAbierto(true); setAviso(null);
                }}>
          {soloProgramacion ? 'Corregir programación' : 'Editar embarque'}
        </button>
        {noPuede && <small style={{ color: 'var(--tinta-3)' }}>{noPuede}</small>}
        {aviso && <span role="status" data-aviso="editar-embarque" style={{ color: aviso.ok ? 'var(--ok)' : 'var(--critico)', fontSize: '.85rem' }}>{aviso.texto}</span>}
      </div>
    );
  }

  return (
    <div data-bloque="editar-embarque" style={{ borderTop: '1px solid var(--linea)', paddingTop: '.8rem' }}>
      {bloqueado && (
        <p className="form-pista" style={{ margin: '0 1rem .6rem' }}>
          El embarque ya se despachó: la fecha, el destino, el booking y el transporte quedan como salieron. La
          programación (semana, zarpe, operador logístico y N.º de packing) sí se puede corregir.
        </p>
      )}
      <div className="form-rejilla" style={{ padding: '0 1rem' }}>
        <label className="form-campo">
          <span>Fecha de despacho <b className="req">*</b></span>
          <input type="date" className="campo" name="fecha_programada" value={d.fecha_programada} data-error={error('fecha_programada')}
                 disabled={bloqueado}
                 onChange={(e) => {
                   const f = e.target.value;
                   setD((x) => ({ ...x, fecha_programada: f, semana_despacho: semanaTocada ? x.semana_despacho : semanaIso(f) }));
                   setAviso(null);
                 }} />
          <small>El día que sale de la bodega. La fecha real se anota al despachar.</small>
        </label>
        <label className="form-campo">
          <span>Semana de despacho</span>
          <input type="number" className="campo mono" name="semana_despacho" min={1} max={53} value={d.semana_despacho ?? ''}
                 data-error={error('semana_despacho')}
                 onChange={(e) => { setSemanaTocada(true); poner('semana_despacho', e.target.value ? Number(e.target.value) : null); }} />
          <small>
            {semanaTocada && d.semana_despacho !== semanaDeFecha
              ? <>La fecha cae en la semana {semanaDeFecha}. <button type="button" className="enlace-boton" onClick={() => { setSemanaTocada(false); poner('semana_despacho', semanaDeFecha); }}>Usar esa</button></>
              : 'Sale sola de la fecha; cámbiela si se programa por semana.'}
          </small>
        </label>
        <label className="form-campo">
          <span>Fecha de zarpe</span>
          <input type="date" className="campo" name="fecha_zarpe" value={d.fecha_zarpe ?? ''} data-error={error('fecha_zarpe') ?? (zarpeAntes ? 'si' : undefined)}
                 min={d.fecha_programada || undefined}
                 onChange={(e) => poner('fecha_zarpe', e.target.value || null)} />
          <small>{zarpeAntes ? 'No puede ser antes del despacho.' : 'Cuándo zarpa la nave (no es la de despacho).'}</small>
        </label>
        <label className="form-campo">
          <span>N.º de packing</span>
          <input className="campo mono" name="numero_packing" maxLength={30} value={d.numero_packing ?? ''} data-error={error('numero_packing') ?? (problemaPl ? 'si' : undefined)}
                 onChange={(e) => poner('numero_packing', e.target.value.toUpperCase())}
                 onBlur={(e) => poner('numero_packing', normalizarNumeroPacking(e.target.value) || null)}
                 placeholder="PL POT1124" />
          <small>{problemaPl ?? 'El PL de su numeración. Si su contenedor lo lleva, cambia también.'}</small>
        </label>
        <label className="form-campo">
          <span>Operador logístico</span>
          <input className="campo" name="operador_logistico" maxLength={80} value={d.operador_logistico ?? ''} list={`operadores-${embarqueId}`}
                 data-error={error('operador_logistico')}
                 onChange={(e) => poner('operador_logistico', e.target.value)} placeholder="Agente de carga" />
          <datalist id={`operadores-${embarqueId}`}>
            {sugerenciasOperador.map((o) => <option key={o} value={o} />)}
          </datalist>
        </label>
        <label className="form-campo">
          <span>Destino {tipoDespacho === 'exportacion' && <b className="req">*</b>}</span>
          <select className="campo" name="destino_id" value={d.destino_id ?? ''} data-error={error('destino_id')} disabled={bloqueado}
                  onChange={(e) => poner('destino_id', numero(e.target.value))}>
            <option value="">Sin especificar</option>
            {destinos.map((x) => <option key={x.id} value={x.id}>{x.puerto}{x.pais ? `, ${x.pais}` : ''}</option>)}
          </select>
        </label>
        <label className="form-campo">
          <span>Booking</span>
          <input className="campo mono" name="booking" maxLength={40} value={d.booking ?? ''} data-error={error('booking')} disabled={bloqueado}
                 onChange={(e) => poner('booking', e.target.value)} placeholder="LMM000000" />
          {tipoDespacho === 'exportacion' && <small>Hace falta para confirmar una exportación.</small>}
        </label>
        <label className="form-campo">
          <span>Naviera</span>
          <input className="campo" name="naviera" maxLength={60} value={d.naviera ?? ''} disabled={bloqueado}
                 onChange={(e) => poner('naviera', e.target.value)} placeholder="COSCO, Maersk…" />
        </label>
        <label className="form-campo">
          <span>Transportista</span>
          <select className="campo" name="transportista_id" value={d.transportista_id ?? ''} disabled={bloqueado}
                  onChange={(e) => poner('transportista_id', numero(e.target.value))}>
            <option value="">Sin asignar</option>
            {transportistas.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
        </label>
        <label className="form-campo">
          <span>Vehículo</span>
          <select className="campo" name="vehiculo_id" value={d.vehiculo_id ?? ''} data-error={error('vehiculo_id')} disabled={bloqueado}
                  onChange={(e) => poner('vehiculo_id', numero(e.target.value))}>
            <option value="">Sin asignar</option>
            {vehiculos.map((v) => <option key={v.id} value={v.id}>{v.placa}</option>)}
          </select>
        </label>
        <label className="form-campo">
          <span>Conductor</span>
          <select className="campo" name="conductor_id" value={d.conductor_id ?? ''} disabled={bloqueado}
                  onChange={(e) => poner('conductor_id', numero(e.target.value))}>
            <option value="">Sin asignar</option>
            {conductores.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <label className="form-campo form-campo-ancho">
          <span>Observaciones</span>
          <textarea className="campo" name="observaciones_edicion" rows={3} maxLength={1000} value={d.observaciones ?? ''} disabled={bloqueado}
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
        <button type="button" className="btn btn-primario" disabled={pendiente || !!problemaPl || zarpeAntes} data-accion="guardar-embarque"
                title={problemaPl ?? (zarpeAntes ? 'La fecha de zarpe no puede ser antes del despacho.' : undefined)}
                onClick={guardar}>
          {pendiente ? 'Guardando…' : 'Guardar cambios'}
        </button>
        <button type="button" className="btn btn-sutil" disabled={pendiente} onClick={() => setAbierto(false)}>Cancelar</button>
        {aviso && !aviso.ok && <span role="alert" data-aviso="editar-embarque" style={{ color: 'var(--critico)', fontSize: '.85rem' }}>{aviso.texto}</span>}
      </div>
    </div>
  );
}
