'use client';

/**
 * «CAMBIAR N.º» DEL PACKING («Observaciones ERP 4», punto 13; migración 084).
 *
 * El sistema numeraba los contenedores desde PL POT001 y la numeración real
 * de Santa Mónica va por la 1123: los que ya existen hay que poder alinearlos,
 * también si ya salieron (el número no fue a SUNAT y los reportes leen el
 * vigente). Queda en el historial; si era el PL de su embarque, el embarque
 * toma el nuevo. Lo repetido lo rechaza la base, con el mismo texto.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { accionSegura } from '@/lib/accionSegura';
import { normalizarNumeroPacking, problemaNumeroPacking } from '@/lib/numeroPacking';
import { cambiarNumeroPacking } from '../acciones';

export function CambiarNumeroPacking({ packingId, actual, puede, noPuede }: {
  packingId: number;
  actual: string;
  puede: boolean;
  noPuede: string | null;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [valor, setValor] = useState(actual);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [guardando, iniciar] = useTransition();
  const problema = problemaNumeroPacking(valor);

  function guardar() {
    setAviso(null);
    iniciar(async () => {
      const r = await accionSegura(() => cambiarNumeroPacking(packingId, valor));
      setAviso({ ok: r.ok, texto: r.mensaje });
      if (r.ok) { setAbierto(false); router.refresh(); }
    });
  }

  if (!abierto) {
    return (
      <span className="no-imprimir" style={{ display: 'inline-flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginLeft: '.5rem' }}>
        <button type="button" className="enlace-boton" data-accion="cambiar-numero-packing" disabled={!puede}
                title={noPuede ?? 'Corregir el N.º de packing para que coincida con su numeración'}
                onClick={() => { setValor(actual); setAbierto(true); setAviso(null); }}>
          Cambiar N.º
        </button>
        {aviso && <small role="status" data-aviso="numero-packing" style={{ color: aviso.ok ? 'var(--ok)' : 'var(--critico)' }}>{aviso.texto}</small>}
      </span>
    );
  }
  return (
    <span className="no-imprimir" data-bloque="cambiar-numero-packing" style={{ display: 'inline-flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap', marginLeft: '.5rem' }}>
      <input className="campo mono" name="nuevo_numero_packing" value={valor} maxLength={30} style={{ width: '10rem' }} autoFocus
             onChange={(e) => setValor(e.target.value.toUpperCase())}
             onBlur={(e) => setValor(normalizarNumeroPacking(e.target.value))} />
      <button type="button" className="btn btn-primario btn-chico" data-accion="guardar-numero-packing"
              disabled={guardando || !!problema} title={problema ?? undefined} onClick={guardar}>
        {guardando ? 'Guardando…' : 'Guardar'}
      </button>
      <button type="button" className="btn btn-sutil btn-chico" onClick={() => setAbierto(false)}>Cancelar</button>
      {(problema || aviso) && (
        <small role="alert" data-aviso="numero-packing" style={{ color: aviso?.ok ? 'var(--ok)' : 'var(--critico)' }}>
          {aviso?.texto ?? problema}
        </small>
      )}
    </span>
  );
}
