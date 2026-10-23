'use client';

/**
 * ============================================================================
 *  REGISTRAR UN COBRO Y ANULAR EL COMPROBANTE
 * ============================================================================
 *  Las dos acciones que le faltaban a la ficha. Existían por detrás y ninguna
 *  pantalla las ofrecía, así que los cobros que se veían eran solo los que ya
 *  estaban cargados en la base.
 *
 *  Cuando una acción no se puede hacer, el botón no desaparece: se apaga y
 *  dice por qué (anulado, ya cobrada, con cobros, o un rol que no cobra). Así
 *  quien mira la ficha sabe a quién pedírselo.
 *
 *  Las reglas de verdad están en la base (migración 070); aquí solo se
 *  adelantan las que se pueden comprobar sin preguntar, para no hacer esperar
 *  un rechazo evidente.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icono } from '@/components/estructura/Icono';
import { registrarCobranza, anularComprobante, anularCobranza } from '../acciones';
import { MEDIOS_DE_PAGO, MOTIVO_MINIMO } from '@/lib/permisosFinanzas';

const cifra = (n: number) =>
  n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Aviso = { ok: boolean; texto: string } | null;

/* ==========================================================================
   REGISTRAR COBRO
   ========================================================================== */
export function RegistrarCobro({
  facturaId,
  numero,
  moneda,
  saldo,
  hoy,
  emision,
  bloqueo,
}: {
  facturaId: number;
  numero: string;
  moneda: string;
  saldo: number;
  /** Hoy en Lima (AAAA-MM-DD): tope de la fecha del cobro. */
  hoy: string;
  /** Fecha de emisión: un cobro no puede ser anterior. */
  emision: string;
  /** Si no se puede cobrar, el motivo. */
  bloqueo: string | null;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [monto, setMonto] = useState('');
  const [fecha, setFecha] = useState(hoy);
  const [medio, setMedio] = useState<string>('Transferencia');
  const [referencia, setReferencia] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [aviso, setAviso] = useState<Aviso>(null);
  const [guardando, iniciar] = useTransition();

  const valor = Number(monto.replace(',', '.'));
  const excede = monto !== '' && valor > saldo + 0.01;

  function guardar(e: React.FormEvent) {
    e.preventDefault();
    setAviso(null);
    if (!(valor > 0)) { setAviso({ ok: false, texto: 'Escriba el monto cobrado: tiene que ser mayor que cero.' }); return; }
    if (excede) {
      setAviso({ ok: false, texto: `El saldo es ${moneda} ${cifra(saldo)}: no se puede registrar más que eso.` });
      return;
    }
    iniciar(async () => {
      const r = await registrarCobranza({
        factura_id: facturaId,
        monto: valor,
        fecha,
        medio,
        referencia: referencia || null,
        observaciones: observaciones || null,
      });
      setAviso({ ok: r.ok, texto: r.mensaje });
      if (r.ok) {
        setAbierto(false);
        setMonto(''); setReferencia(''); setObservaciones('');
        router.refresh();
      }
    });
  }

  if (!abierto) {
    return (
      <div className="cobro-barra">
        <button
          type="button"
          className="btn btn-primario btn-chico"
          data-accion="registrar-cobro"
          disabled={!!bloqueo}
          title={bloqueo ?? `Registrar un pago recibido para ${numero}`}
          onClick={() => { setAviso(null); setAbierto(true); }}
        >
          <Icono nombre="cobrar" tamano={14} />
          Registrar cobro
        </button>
        {bloqueo && <span className="cobro-motivo" data-motivo="cobro">{bloqueo}</span>}
        {aviso && (
          <span role={aviso.ok ? 'status' : 'alert'} className={aviso.ok ? 'cobro-ok' : 'cobro-mal'}>
            {aviso.texto}
          </span>
        )}
        <style jsx>{`
  .cobro-barra { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; padding: 0.75rem 1rem; border-bottom: 1px solid var(--linea); }
  .cobro-motivo { font-size: 0.76rem; color: var(--tinta-3); }
  .cobro-ok { font-size: 0.78rem; color: var(--ok); }
  .cobro-mal { font-size: 0.78rem; color: var(--critico); margin: 0; }
  .cobro-form { display: flex; flex-direction: column; gap: 0.7rem; padding: 0.85rem 1rem; border-bottom: 1px solid var(--linea); background: var(--superficie-2); }
  .cobro-saldo { margin: 0; font-size: 0.82rem; color: var(--tinta-2); }
  .cobro-rejilla { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: 0.7rem; }
  .cobro-ancho { grid-column: 1 / -1; }
  .cobro-todo { align-self: flex-start; background: none; border: none; padding: 0; font-size: 0.72rem; color: var(--acento-2); cursor: pointer; text-decoration: underline; }
`}</style>
      </div>
    );
  }

  return (
    <form className="cobro-form" data-bloque="registrar-cobro" onSubmit={guardar}>
      <p className="cobro-saldo">
        Saldo por cobrar de <strong>{numero}</strong>: <strong>{moneda} {cifra(saldo)}</strong>
      </p>
      <div className="cobro-rejilla">
        <label className="form-campo">
          <span className="etiqueta">Monto ({moneda})</span>
          <input className="campo" type="number" min="0.01" step="0.01" name="monto"
                 value={monto} onChange={(e) => setMonto(e.target.value)} autoFocus
                 aria-invalid={excede ? 'true' : 'false'} required />
          <button type="button" className="cobro-todo" onClick={() => setMonto(saldo.toFixed(2))}>
            Todo el saldo
          </button>
        </label>
        <label className="form-campo">
          <span className="etiqueta">Fecha del pago</span>
          <input className="campo" type="date" name="fecha" min={emision} max={hoy}
                 value={fecha} onChange={(e) => setFecha(e.target.value)} required />
        </label>
        <label className="form-campo">
          <span className="etiqueta">Medio</span>
          <select className="campo" name="medio" value={medio} onChange={(e) => setMedio(e.target.value)}>
            {MEDIOS_DE_PAGO.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="form-campo">
          <span className="etiqueta">Referencia (operación, cheque…)</span>
          <input className="campo" type="text" name="referencia" maxLength={80}
                 value={referencia} onChange={(e) => setReferencia(e.target.value)} />
        </label>
        <label className="form-campo cobro-ancho">
          <span className="etiqueta">Observaciones</span>
          <input className="campo" type="text" name="observaciones" maxLength={300}
                 value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
        </label>
      </div>
      {excede && (
        <p className="cobro-mal" role="alert">
          Supera el saldo ({moneda} {cifra(saldo)}). Si el cliente pagó de más, registre el saldo y anote el excedente en Observaciones.
        </p>
      )}
      <div className="acciones-fila">
        <button type="submit" className="btn btn-primario btn-chico" disabled={guardando || excede}
                data-accion="guardar-cobro">
          {guardando ? 'Guardando…' : 'Guardar cobro'}
        </button>
        <button type="button" className="btn btn-sutil btn-chico" disabled={guardando}
                onClick={() => { setAbierto(false); setAviso(null); }}>
          Cancelar
        </button>
      </div>
      {aviso && !aviso.ok && <p className="cobro-mal" role="alert">{aviso.texto}</p>}
      <style jsx>{`
  .cobro-barra { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; padding: 0.75rem 1rem; border-bottom: 1px solid var(--linea); }
  .cobro-motivo { font-size: 0.76rem; color: var(--tinta-3); }
  .cobro-ok { font-size: 0.78rem; color: var(--ok); }
  .cobro-mal { font-size: 0.78rem; color: var(--critico); margin: 0; }
  .cobro-form { display: flex; flex-direction: column; gap: 0.7rem; padding: 0.85rem 1rem; border-bottom: 1px solid var(--linea); background: var(--superficie-2); }
  .cobro-saldo { margin: 0; font-size: 0.82rem; color: var(--tinta-2); }
  .cobro-rejilla { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: 0.7rem; }
  .cobro-ancho { grid-column: 1 / -1; }
  .cobro-todo { align-self: flex-start; background: none; border: none; padding: 0; font-size: 0.72rem; color: var(--acento-2); cursor: pointer; text-decoration: underline; }
`}</style>
    </form>
  );
}

/* ==========================================================================
   ANULAR UN COBRO MAL REGISTRADO (070b)
   No se borra: queda tachado, con motivo, quién y cuándo, y deja de sumar.
   ========================================================================== */
export function AnularCobro({
  cobroId,
  descripcion,
  bloqueo,
}: {
  cobroId: number;
  /** «US$ 1,000.00 del 12/10/2026», para la pregunta de confirmación. */
  descripcion: string;
  bloqueo: string | null;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [aviso, setAviso] = useState<Aviso>(null);
  const [anulando, iniciar] = useTransition();
  const corto = motivo.trim().length < MOTIVO_MINIMO;

  function anular() {
    setAviso(null);
    iniciar(async () => {
      const r = await anularCobranza(cobroId, motivo);
      setAviso({ ok: r.ok, texto: r.mensaje });
      if (r.ok) { setAbierto(false); router.refresh(); }
    });
  }

  if (!abierto) {
    return (
      <span className="anular-cobro">
        <button type="button" className="btn btn-sutil btn-chico" data-accion="anular-cobro"
                disabled={!!bloqueo} title={bloqueo ?? `Anular el cobro de ${descripcion}`}
                onClick={() => { setAviso(null); setAbierto(true); }}>
          Anular
        </button>
        {aviso && <span className={aviso.ok ? 'cobro-ok' : 'cobro-mal'} role={aviso.ok ? 'status' : 'alert'}>{aviso.texto}</span>}
        <style jsx>{`
          .anular-cobro { display: inline-flex; flex-direction: column; gap: 0.2rem; }
          .cobro-ok { font-size: 0.7rem; color: var(--ok); }
          .cobro-mal { font-size: 0.7rem; color: var(--critico); }
        `}</style>
      </span>
    );
  }

  return (
    <div className="anular-cobro-caja" data-bloque="anular-cobro">
      <span className="anular-cobro-pregunta">
        ¿Anular el cobro de {descripcion}? Deja de contar en el saldo, pero queda a la vista, tachado.
      </span>
      <textarea className="campo" name="motivo_cobro" rows={2} maxLength={300} autoFocus
                placeholder={`Motivo (al menos ${MOTIVO_MINIMO} caracteres)`}
                value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      <div className="acciones-fila">
        <button type="button" className="btn btn-peligro btn-chico" disabled={corto || anulando}
                data-accion="confirmar-anular-cobro" onClick={anular}
                title={corto ? `Escriba el motivo (al menos ${MOTIVO_MINIMO} caracteres)` : undefined}>
          {anulando ? 'Anulando…' : 'Sí, anular el cobro'}
        </button>
        <button type="button" className="btn btn-sutil btn-chico" disabled={anulando}
                onClick={() => setAbierto(false)}>
          No
        </button>
      </div>
      {aviso && !aviso.ok && <span className="cobro-mal" role="alert">{aviso.texto}</span>}
      <style jsx>{`
        .anular-cobro-caja { display: flex; flex-direction: column; gap: 0.35rem; min-width: 14rem; }
        .anular-cobro-pregunta { font-size: 0.72rem; color: var(--tinta-2); line-height: 1.35; }
        .anular-cobro-caja textarea { font-size: 0.76rem; resize: vertical; }
        .cobro-mal { font-size: 0.7rem; color: var(--critico); }
      `}</style>
    </div>
  );
}

/* ==========================================================================
   ANULAR
   ========================================================================== */
export function BotonAnular({
  facturaId,
  numero,
  bloqueo,
}: {
  facturaId: number;
  numero: string;
  bloqueo: string | null;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [aviso, setAviso] = useState<Aviso>(null);
  const [anulando, iniciar] = useTransition();

  const corto = motivo.trim().length < MOTIVO_MINIMO;

  function anular() {
    setAviso(null);
    iniciar(async () => {
      const r = await anularComprobante(facturaId, motivo);
      setAviso({ ok: r.ok, texto: r.mensaje });
      if (r.ok) { setAbierto(false); router.refresh(); }
    });
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-peligro-borde"
        data-accion="anular-comprobante"
        disabled={!!bloqueo || anulando}
        title={bloqueo ?? `Anular ${numero} dejando el motivo escrito`}
        onClick={() => { setAviso(null); setAbierto((a) => !a); }}
      >
        <Icono nombre="cerrar" tamano={15} />
        {abierto ? 'Cancelar anulación' : 'Anular comprobante'}
      </button>

      {bloqueo && <span className="sr-solo" data-motivo="anular">{bloqueo}</span>}

      {aviso && (
        <div className={`ficha-aviso ${aviso.ok ? 'ficha-aviso-info' : 'ficha-aviso-critico'} documento-mensaje`}
             role={aviso.ok ? 'status' : 'alert'}>
          <Icono nombre="alerta" tamano={17} />
          <span>{aviso.texto}</span>
        </div>
      )}

      {abierto && (
        <div className="ficha-aviso ficha-aviso-critico documento-mensaje anular-caja" data-bloque="anular">
          <Icono nombre="alerta" tamano={17} />
          <div className="anular-cuerpo">
            <strong>¿Anular {numero}?</strong>
            <span>
              El comprobante queda anulado con este motivo, su número no se vuelve a usar y deja de
              contar en las cuentas por cobrar. El pedido queda libre para emitirle uno nuevo. No se
              puede deshacer.
            </span>
            <label className="form-campo">
              <span className="etiqueta">Motivo de la anulación (al menos {MOTIVO_MINIMO} caracteres)</span>
              <textarea className="campo" name="motivo" rows={2} maxLength={300}
                        value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
            </label>
            <div className="acciones-fila">
              <button type="button" className="btn btn-peligro btn-chico" disabled={corto || anulando}
                      data-accion="confirmar-anulacion" onClick={anular}
                      title={corto ? `Escriba el motivo (al menos ${MOTIVO_MINIMO} caracteres)` : undefined}>
                {anulando ? 'Anulando…' : 'Sí, anular'}
              </button>
              <button type="button" className="btn btn-sutil btn-chico" disabled={anulando}
                      onClick={() => setAbierto(false)}>
                No, volver
              </button>
            </div>
          </div>
        </div>
      )}
      <style jsx>{`
        .anular-cuerpo { display: flex; flex-direction: column; gap: 0.5rem; flex: 1; min-width: 0; }
        .anular-cuerpo textarea { resize: vertical; }
      `}</style>
    </>
  );
}
