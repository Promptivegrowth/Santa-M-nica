'use client';

/**
 * ============================================================================
 *  UNA FILA DE COSTO, EDITABLE EN SITIO
 * ============================================================================
 *  Son 191 productos. Abrir un formulario por cada uno haría de la carga
 *  mensual una tarea de media mañana, y una tarea de media mañana acaba sin
 *  hacerse: los costos se quedarían sin cargar y el margen sin calcular.
 *
 *  Por eso se edita en la propia tabla, con los tres campos a la vista y el
 *  total actualizándose mientras se escribe. Se guarda al salir del campo
 *  —cambiar de casilla ya es la señal de que ese número está puesto— y solo
 *  si de verdad cambió.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { guardarCosto, borrarCosto } from './acciones';

export function FilaCosto({
  skuId,
  codigo,
  corte,
  familia,
  anio,
  mes,
  mp,
  conv,
  varia,
  puedeEditar,
}: {
  skuId: number;
  codigo: string;
  corte: string;
  familia: string;
  anio: number;
  mes: number;
  mp: number | null;
  conv: number | null;
  varia: number | null;
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const [guardando, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const texto = (v: number | null) => (v === null ? '' : String(v));
  const [a, setA] = useState(texto(mp));
  const [b, setB] = useState(texto(conv));
  const [c, setC] = useState(texto(varia));

  /** Lo que había cuando se cargó la página, para no guardar sin cambios. */
  const original = `${texto(mp)}|${texto(conv)}|${texto(varia)}`;
  const total = (Number(a) || 0) + (Number(b) || 0) + (Number(c) || 0);
  const cargado = mp !== null;

  function guardar() {
    if (!puedeEditar) return;
    if (`${a}|${b}|${c}` === original) return;   // nada que hacer
    setError(null);

    // Los tres vacíos sobre una fila que sí tenía costo significan «quítalo».
    if (a.trim() === '' && b.trim() === '' && c.trim() === '') {
      if (!cargado) return;
      iniciar(async () => {
        const r = await borrarCosto(skuId, anio, mes);
        if (!r.ok) setError(r.mensaje);
        router.refresh();
      });
      return;
    }

    iniciar(async () => {
      const r = await guardarCosto({
        sku_id: skuId,
        anio, mes,
        materia_prima_kg: Number(a) || 0,
        conversion_kg: Number(b) || 0,
        variable_kg: Number(c) || 0,
      });
      if (!r.ok) setError(r.mensaje);
      router.refresh();
    });
  }

  const campo = (valor: string, set: (v: string) => void) => (
    <input
      className="campo mono costo-campo"
      type="number" step="0.0001" min="0"
      value={valor}
      disabled={!puedeEditar || guardando}
      onChange={(e) => set(e.target.value)}
      onBlur={guardar}
      // Enter guarda sin tener que salir del campo con el ratón.
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      placeholder="—"
    />
  );

  return (
    <>
      <tr data-sin-costo={cargado ? 'no' : 'si'}>
        <td className="mono">{codigo}</td>
        <td style={{ fontSize: '.78rem' }}>{corte}</td>
        <td style={{ fontSize: '.72rem', color: 'var(--tinta-3)' }}>{familia}</td>
        <td className="num">{campo(a, setA)}</td>
        <td className="num">{campo(b, setB)}</td>
        <td className="num">{campo(c, setC)}</td>
        <td className="num mono">
          {total > 0 ? (
            <strong>{total.toFixed(4)}</strong>
          ) : (
            <span style={{ color: 'var(--tinta-3)' }}>sin cargar</span>
          )}
        </td>
        <td className="num mono" style={{ fontSize: '.74rem', color: 'var(--tinta-3)' }}>
          {/* El mismo costo por tonelada, que es la unidad en la que se venden
              y con la que se compara el precio. Así nadie multiplica a mano. */}
          {total > 0 ? `${(total * 1000).toLocaleString('es-PE', { maximumFractionDigits: 0 })}` : '—'}
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={8} className="costo-error">{error}</td>
        </tr>
      )}
    </>
  );
}
