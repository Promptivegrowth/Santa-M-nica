'use client';

/**
 * ============================================================================
 *  NUMERACIÓN DE PROFORMAS · Configuración › Parámetros (082)
 * ============================================================================
 *  Para que el sistema siga la numeración real de Santa Mónica: aquí se dice
 *  cuál es el PRÓXIMO número automático de proforma del año. Es el que viene
 *  propuesto al crear un pedido (directo o desde una cotización), que además
 *  se puede cambiar a mano en cada pedido.
 *
 *  Cómo se mueve solo, sin que nadie toque esto:
 *   · al guardar un pedido con un número de la serie, la numeración sigue
 *     desde ese número si era mayor (escribir SM26-500 a mano hace que el
 *     siguiente propuesto sea SM26-501);
 *   · si el próximo ya lo usa algún pedido, la propuesta lo salta.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { fijarProximoNumeroProforma } from './acciones';
import { accionSegura } from '@/lib/accionSegura';
import { fechaHora } from '@/lib/formato';

export type EstadoNumeracion = {
  anio: number;
  prefijo: string;
  ultimo: number;
  propuesto: string;
  mayor_usado: number | null;
  actualizado_en: string | null;
  actualizado_por: string | null;
};

export function NumeracionProforma({ estado, editable }: { estado: EstadoNumeracion; editable: boolean }) {
  const router = useRouter();
  //  El número del propuesto, sin el prefijo: «624» de SM26-624.
  const propuestoN = Number(/-(\d+)$/.exec(estado.propuesto)?.[1] ?? estado.ultimo + 1);
  const [valor, setValor] = useState(String(propuestoN));
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, iniciar] = useTransition();

  const n = Number(valor);
  const valido = /^\d{1,6}$/.test(valor.trim()) && n >= 1;
  const vista = valido ? `${estado.prefijo}${String(n).padStart(3, '0')}` : null;
  const porDebajo = valido && estado.mayor_usado !== null && n <= estado.mayor_usado;

  function guardar() {
    setAviso(null);
    iniciar(async () => {
      const r = await accionSegura(() => fijarProximoNumeroProforma(n));
      setAviso({ ok: r.ok, texto: r.mensaje });
      if (r.ok) router.refresh();
    });
  }

  return (
    <div style={{ padding: '.9rem 1rem 1rem' }} data-bloque="numeracion-proforma">
      <dl className="ficha" style={{ marginBottom: '.8rem' }}>
        <div><dt>Serie del año {estado.anio}</dt><dd className="mono">{estado.prefijo}…</dd></div>
        <div><dt>Se propondrá en el próximo pedido</dt><dd className="mono" data-propuesto>{estado.propuesto}</dd></div>
        <div>
          <dt>Mayor número usado en la serie</dt>
          <dd className="mono" data-mayor-usado>
            {estado.mayor_usado !== null ? `${estado.prefijo}${String(estado.mayor_usado).padStart(3, '0')}` : 'Ninguno todavía'}
          </dd>
        </div>
        <div>
          <dt>Fijado a mano por última vez</dt>
          <dd data-fijado>
            {estado.actualizado_en
              ? `${fechaHora(estado.actualizado_en)} · ${estado.actualizado_por ?? '—'}`
              : 'Nunca: sigue el contador del sistema'}
          </dd>
        </div>
      </dl>

      {editable ? (
        <div className="param-editor">
          <label style={{ display: 'flex', alignItems: 'center', gap: '.45rem', flexWrap: 'wrap' }}>
            <span className="etiqueta" style={{ margin: 0 }}>Próximo número automático</span>
            <span className="mono" aria-hidden>{estado.prefijo}</span>
            <input
              className="campo mono"
              type="number"
              min={1}
              max={999999}
              step={1}
              name="proximo_numero_proforma"
              value={valor}
              disabled={pendiente}
              style={{ width: '7rem', padding: '.32rem .5rem', fontSize: '.84rem' }}
              onChange={(e) => { setValor(e.target.value); if (aviso) setAviso(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && valido) guardar(); }}
            />
            <button type="button" className="btn btn-primario" data-accion="fijar-numeracion"
                    disabled={pendiente || !valido || n === propuestoN}
                    style={{ padding: '.3rem .7rem', fontSize: '.8rem' }}
                    onClick={guardar}>
              {pendiente ? 'Guardando…' : 'Guardar'}
            </button>
          </label>
          {vista && n !== propuestoN && (
            <p style={{ margin: '.35rem 0 0', fontSize: '.76rem', color: 'var(--tinta-2)' }} data-vista>
              El próximo pedido se propondrá como <strong className="mono">{vista}</strong>
              {porDebajo && <> · ojo: ya hay números usados hasta {estado.prefijo}{String(estado.mayor_usado).padStart(3, '0')}; cuando la numeración llegue a uno usado, lo saltará</>}.
            </p>
          )}
          {aviso && (
            <p role={aviso.ok ? 'status' : 'alert'} data-aviso="numeracion"
               style={{ margin: '.35rem 0 0', fontSize: '.76rem', color: aviso.ok ? 'var(--ok)' : 'var(--critico)', maxWidth: '40rem' }}>
              {aviso.texto}
            </p>
          )}
        </div>
      ) : (
        <p className="param-nota">Lo cambian Gerencia y Operaciones.</p>
      )}

      <p className="pie-explicativo" style={{ marginTop: '.8rem' }}>
        Es el número que viene <strong>propuesto</strong> al crear un pedido (directo o con «Convertir en pedido»);
        en cada pedido se puede cambiar a mano. Si alguien guarda a mano un número de la serie mayor que el
        propuesto, la numeración sigue desde ese número; si el próximo ya lo usa un pedido, se salta. Un número
        fuera de la serie (por ejemplo «EXP-2026-15») no mueve la numeración. Cada año empieza su propia serie.
      </p>
    </div>
  );
}
