'use client';

/**
 * ============================================================================
 *  EDITAR LOS DATOS DEL CONTENEDOR
 * ============================================================================
 *  El packing se crea con el número de contenedor que se conocía en ese
 *  momento; el precinto, la guía de remisión y la DAM llegan después, el día
 *  de la carga. Hasta ahora no había dónde escribirlos y el despacho avisaba
 *  «sin guía de remisión» sin ofrecer cómo corregirlo.
 *
 *  Solo mientras el packing está abierto: uno despachado es un documento
 *  cerrado. El servidor vuelve a comprobarlo (y que el contenedor no se
 *  achique por debajo del plano ya hecho).
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { accionSegura } from '@/lib/accionSegura';
import { guardarDatosPacking, type DatosPacking } from '../acciones';

export function EditarDatosPacking({
  packingId,
  datos,
  supervisores,
}: {
  packingId: number;
  datos: DatosPacking;
  supervisores: { id: string; nombre: string }[];
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [d, setD] = useState<DatosPacking>(datos);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, iniciar] = useTransition();

  const poner = <K extends keyof DatosPacking>(k: K, v: DatosPacking[K]) => setD((x) => ({ ...x, [k]: v }));
  const texto = (k: 'contenedor' | 'precinto' | 'guia_remision' | 'dam' | 'fecha_carga' | 'hora_inicio' | 'hora_fin' | 'observaciones') =>
    ({ value: d[k] ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement>) => poner(k, e.target.value || null) });

  function guardar() {
    setAviso(null);
    iniciar(async () => {
      const r = await accionSegura(() => guardarDatosPacking(packingId, d));
      setAviso({ ok: r.ok, texto: r.mensaje ?? '' });
      if (r.ok) { setAbierto(false); router.refresh(); }
    });
  }

  if (!abierto) {
    return (
      <div className="editar-datos-pie" style={{ padding: '0 1rem 1rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
        <button type="button" className="btn btn-secundario" data-accion="editar-datos-packing"
                onClick={() => { setD(datos); setAbierto(true); setAviso(null); }}>
          Editar datos del contenedor
        </button>
        {aviso && <span role="status" style={{ color: aviso.ok ? 'var(--ok)' : 'var(--critico)', fontSize: '0.85rem' }}>{aviso.texto}</span>}
      </div>
    );
  }

  return (
    <div data-bloque="editar-datos-packing">
      <div className="form-rejilla">
        <label className="form-campo"><span>N.° contenedor</span><input className="campo mono" name="contenedor" {...texto('contenedor')} placeholder="MSKU1234567" /></label>
        <label className="form-campo"><span>Precinto</span><input className="campo mono" name="precinto" {...texto('precinto')} /></label>
        <label className="form-campo"><span>Guía de remisión</span><input className="campo mono" name="guia_remision" {...texto('guia_remision')} placeholder="EG07-0000000" /></label>
        <label className="form-campo"><span>DAM</span><input className="campo mono" name="dam" {...texto('dam')} /></label>
        <label className="form-campo">
          <span>Supervisor</span>
          <select className="campo" name="supervisor_id" value={d.supervisor_id ?? ''} onChange={(e) => poner('supervisor_id', e.target.value || null)}>
            <option value="">— Sin asignar —</option>
            {supervisores.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </label>
        <label className="form-campo">
          <span>Turno</span>
          <select className="campo" name="turno" value={d.turno} onChange={(e) => poner('turno', e.target.value as 'dia' | 'noche')}>
            <option value="dia">Día</option>
            <option value="noche">Noche</option>
          </select>
        </label>
        <label className="form-campo"><span>Fecha de carga</span><input type="date" className="campo" name="fecha_carga" {...texto('fecha_carga')} /></label>
        <label className="form-campo"><span>Hora inicio</span><input type="time" className="campo" name="hora_inicio" {...texto('hora_inicio')} /></label>
        <label className="form-campo"><span>Hora fin</span><input type="time" className="campo" name="hora_fin" {...texto('hora_fin')} /></label>
        <label className="form-campo">
          <span>Filas del contenedor</span>
          <input type="number" min={1} className="campo" name="filas_contenedor" value={d.filas_contenedor}
                 onChange={(e) => poner('filas_contenedor', Number(e.target.value))} />
        </label>
        <label className="form-campo">
          <span>Sacos por fila</span>
          <input type="number" min={1} className="campo" name="sacos_por_fila" value={d.sacos_por_fila}
                 onChange={(e) => poner('sacos_por_fila', Number(e.target.value))} />
        </label>
        <label className="form-campo form-ancho"><span>Observaciones</span><input className="campo" name="observaciones" {...texto('observaciones')} maxLength={500} /></label>
      </div>
      <div style={{ padding: '0 1rem 1rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primario" disabled={pendiente} data-accion="guardar-datos-packing" onClick={guardar}>
          {pendiente ? 'Guardando…' : 'Guardar datos'}
        </button>
        <button type="button" className="btn btn-sutil" disabled={pendiente} onClick={() => setAbierto(false)}>Cancelar</button>
        {aviso && <span role="alert" style={{ color: aviso.ok ? 'var(--ok)' : 'var(--critico)', fontSize: '0.85rem' }}>{aviso.texto}</span>}
      </div>
    </div>
  );
}
