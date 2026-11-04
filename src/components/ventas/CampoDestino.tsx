'use client';

/**
 * ============================================================================
 *  CAMPO «DESTINO» DE LA COTIZACIÓN Y DEL PEDIDO, CON «OTRO DESTINO…»
 * ============================================================================
 *  «Observaciones ERP 4», punto 12 (Oliver): «permitir ingreso manual de
 *  destinos no listados». La lista sigue siendo la del maestro; al final hay
 *  una opción «＋ Otro destino (no está en la lista)…» que abre dos casillas,
 *  puerto y país, y un botón «Agregar». El destino queda dado de alta para
 *  todos (y elegido en este documento). Si ya existía, se elige ese.
 *
 *  Va en un componente aparte para no engordar FormularioVenta, que es de
 *  varias áreas.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { agregarDestino } from '@/app/(erp)/ventas/accionesDestino';
import { accionSegura } from '@/lib/accionSegura';

export type OpcionDestino = { id: number; nombre: string; pais: string };

/** El valor especial del desplegable que abre las casillas. */
const OTRO = 'otro';

export function CampoDestino({
  destinos,
  valor,
  onChange,
  onAgregado,
  disabled = false,
}: {
  destinos: OpcionDestino[];
  valor: number | '';
  onChange: (id: number | '') => void;
  /** El destino recién dado de alta, para sumarlo a la lista del formulario. */
  onAgregado: (d: OpcionDestino) => void;
  disabled?: boolean;
}) {
  const [escribiendo, setEscribiendo] = useState(false);
  const [puerto, setPuerto] = useState('');
  const [pais, setPais] = useState('');
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [agregando, iniciar] = useTransition();

  //  Los países que ya se usan, para sugerirlos al escribir.
  const paises = [...new Set(destinos.map((d) => d.pais).filter(Boolean))].sort();

  function agregar() {
    setAviso(null);
    iniciar(async () => {
      //  Un corte de red vuelve como aviso aquí, sin perder lo escrito (076).
      const r = await accionSegura(() => agregarDestino(puerto, pais));
      if (!r.ok) { setAviso({ ok: false, texto: r.mensaje }); return; }
      onAgregado(r.destino);
      onChange(r.destino.id);
      setEscribiendo(false);
      setPuerto('');
      setPais('');
      setAviso({ ok: true, texto: r.mensaje });
    });
  }

  return (
    <div className="form-campo" data-campo="destino">
      <span className="etiqueta">Destino</span>
      <select
        className="campo"
        name="destino"
        aria-label="Destino"
        value={escribiendo ? OTRO : valor}
        disabled={disabled}
        onChange={(e) => {
          setAviso(null);
          if (e.target.value === OTRO) { setEscribiendo(true); return; }
          setEscribiendo(false);
          onChange(e.target.value ? Number(e.target.value) : '');
        }}
      >
        <option value="">Sin definir</option>
        {destinos.map((d) => <option key={d.id} value={d.id}>{d.nombre} · {d.pais}</option>)}
        <option value={OTRO}>＋ Otro destino (no está en la lista)…</option>
      </select>

      {escribiendo && (
        <span className="campo-destino-nuevo" data-bloque="destino-nuevo"
              style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem', marginTop: '.35rem', alignItems: 'center' }}>
          <input className="campo" name="destino_puerto" placeholder="Puerto o ciudad" maxLength={80}
                 value={puerto} onChange={(e) => { setPuerto(e.target.value); setAviso(null); }}
                 style={{ flex: '1 1 9rem', minWidth: 0 }} autoFocus disabled={agregando} />
          <input className="campo" name="destino_pais" placeholder="País" maxLength={60} list="paises-destino"
                 value={pais} onChange={(e) => { setPais(e.target.value); setAviso(null); }}
                 style={{ flex: '1 1 7rem', minWidth: 0 }} disabled={agregando} />
          <datalist id="paises-destino">
            {paises.map((p) => <option key={p} value={p} />)}
          </datalist>
          <button type="button" className="btn btn-secundario btn-chico" data-accion="agregar-destino"
                  disabled={agregando || puerto.trim().length < 2 || pais.trim().length < 2}
                  title={puerto.trim().length < 2 || pais.trim().length < 2
                    ? 'Escriba el puerto y el país'
                    : 'Lo agrega a la lista de destinos y lo elige en este documento'}
                  onClick={agregar}>
            {agregando ? 'Agregando…' : 'Agregar'}
          </button>
          <button type="button" className="btn btn-sutil btn-chico" disabled={agregando}
                  onClick={() => { setEscribiendo(false); setAviso(null); }}>
            Cancelar
          </button>
        </span>
      )}
      {aviso && (
        <small role={aviso.ok ? 'status' : 'alert'} data-aviso="destino"
               style={{ color: aviso.ok ? 'var(--ok)' : 'var(--critico)' }}>
          {aviso.texto}
        </small>
      )}
      {escribiendo && !aviso && (
        <small>Queda en la lista de destinos para todos. Si ya existe con ese nombre, se elige el que hay.</small>
      )}
    </div>
  );
}
