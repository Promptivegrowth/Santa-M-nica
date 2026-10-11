'use client';

/**
 * ============================================================================
 *  REGISTRAR LO QUE EL CLIENTE ABONÓ (observaciones de octubre, punto 6)
 * ============================================================================
 *  «Monto efectivamente abonado (editable)». El abono llega cuando llega —a
 *  veces con la cotización ya aprobada o con la proforma emitida—, así que se
 *  registra desde la ficha sin tener que editar el documento entero.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { registrarAbono } from '@/app/(erp)/ventas/cotizaciones/acciones';

export function RegistrarAbono({
  tipo, id, abonado, fecha, hoy,
}: {
  tipo: 'cotizacion' | 'pedido';
  id: number;
  abonado: number | null;
  fecha: string | null;
  hoy: string;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [monto, setMonto] = useState(abonado === null ? '' : String(abonado));
  const [dia, setDia] = useState(fecha ?? hoy);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [guardando, iniciar] = useTransition();

  function guardar(borrar = false) {
    setAviso(null);
    iniciar(async () => {
      const r = await registrarAbono(tipo, id, borrar || monto === '' ? null : Number(monto), borrar ? null : dia);
      setAviso({ ok: r.ok, texto: r.mensaje });
      if (r.ok) { setAbierto(false); router.refresh(); }
    });
  }

  if (!abierto) {
    return (
      <>
        <button type="button" className="btn btn-secundario btn-chico" data-accion="registrar-abono"
                onClick={() => setAbierto(true)}>
          {abonado === null ? 'Registrar abono' : 'Corregir abono'}
        </button>
        {aviso && <span role="status" style={{ marginLeft: '.5rem', fontSize: '.75rem', color: aviso.ok ? 'var(--ok)' : 'var(--critico)' }}>{aviso.texto}</span>}
      </>
    );
  }

  return (
    <div className="abono-form" data-bloque="abono">
      <label className="form-campo">
        <span className="etiqueta">Monto abonado</span>
        <input className="campo" type="number" min="0" step="0.01" name="monto_abonado"
               value={monto} onChange={(e) => setMonto(e.target.value)} autoFocus />
      </label>
      <label className="form-campo">
        <span className="etiqueta">Fecha del abono</span>
        <input className="campo" type="date" max={hoy} name="fecha_abono"
               value={dia} onChange={(e) => setDia(e.target.value)} />
      </label>
      <div className="acciones-fila">
        <button type="button" className="btn btn-primario btn-chico" disabled={guardando} onClick={() => guardar()}>
          {guardando ? 'Guardando…' : 'Guardar abono'}
        </button>
        {abonado !== null && (
          <button type="button" className="btn btn-sutil btn-chico" disabled={guardando} onClick={() => guardar(true)}>
            Borrar abono
          </button>
        )}
        <button type="button" className="btn btn-sutil btn-chico" disabled={guardando} onClick={() => setAbierto(false)}>
          Cancelar
        </button>
      </div>
      {aviso && !aviso.ok && <p role="alert" style={{ margin: 0, fontSize: '.75rem', color: 'var(--critico)' }}>{aviso.texto}</p>}
    </div>
  );
}
