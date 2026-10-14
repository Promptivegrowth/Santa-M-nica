'use client';

/** Registrar una verificación BASC del cliente (la del año que viene, por ejemplo). */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { registrarVerificacion, type Control } from '../accionesBasc';

const OPCIONES: { control: Control; texto: string; resultado: string }[] = [
  { control: 'lista_clinton', texto: 'Lista Clinton', resultado: 'OK' },
  { control: 'onu_terrorismo', texto: 'ONU · terrorismo', resultado: 'Negativo' },
  { control: 'onu_armas', texto: 'ONU · armas', resultado: 'Negativo' },
  { control: 'acuerdo_seguridad', texto: 'Acuerdo de seguridad', resultado: 'SI' },
];

export function NuevaVerificacion({ clienteId, hoy }: { clienteId: number; hoy: string }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [control, setControl] = useState<Control>('lista_clinton');
  const [resultado, setResultado] = useState('OK');
  const [fecha, setFecha] = useState(hoy);
  const [enviado, setEnviado] = useState('');
  const [firmado, setFirmado] = useState('');
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, iniciar] = useTransition();

  if (!abierto) {
    return (
      <button type="button" className="btn btn-secundario btn-chico" data-accion="nueva-verificacion" onClick={() => setAbierto(true)}>
        Registrar verificación
      </button>
    );
  }
  return (
    <div className="abono-form" data-bloque="nueva-verificacion">
      <label className="form-campo">
        <span className="etiqueta">Control</span>
        <select className="campo" name="control" value={control} onChange={(e) => {
          const c = e.target.value as Control;
          setControl(c);
          setResultado(OPCIONES.find((o) => o.control === c)?.resultado ?? '');
        }}>
          {OPCIONES.map((o) => <option key={o.control} value={o.control}>{o.texto}</option>)}
        </select>
      </label>
      <label className="form-campo">
        <span className="etiqueta">Resultado</span>
        <input className="campo" name="resultado" value={resultado} onChange={(e) => setResultado(e.target.value)} />
      </label>
      <label className="form-campo">
        <span className="etiqueta">Fecha</span>
        <input className="campo" type="date" name="fecha" max={hoy} value={fecha} onChange={(e) => setFecha(e.target.value)} />
      </label>
      {control === 'acuerdo_seguridad' && (
        <>
          <label className="form-campo">
            <span className="etiqueta">Enviado el</span>
            <input className="campo" type="date" name="enviado" value={enviado} onChange={(e) => setEnviado(e.target.value)} />
          </label>
          <label className="form-campo">
            <span className="etiqueta">Firmado el</span>
            <input className="campo" type="date" name="firmado" value={firmado} onChange={(e) => setFirmado(e.target.value)} />
          </label>
        </>
      )}
      <div className="acciones-fila">
        <button type="button" className="btn btn-primario btn-chico" disabled={pendiente}
                onClick={() => iniciar(async () => {
                  const r = await registrarVerificacion({ cliente_id: clienteId, control, resultado, fecha, enviado_el: enviado || null, firmado_el: firmado || null });
                  setAviso({ ok: r.ok, texto: r.mensaje });
                  if (r.ok) { setAbierto(false); router.refresh(); }
                })}>
          {pendiente ? 'Guardando…' : 'Guardar'}
        </button>
        <button type="button" className="btn btn-sutil btn-chico" onClick={() => setAbierto(false)}>Cancelar</button>
      </div>
      {aviso && !aviso.ok && <p role="alert" className="form-mensaje error">{aviso.texto}</p>}
    </div>
  );
}
