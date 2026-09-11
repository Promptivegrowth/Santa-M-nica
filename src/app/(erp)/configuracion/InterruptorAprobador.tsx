'use client';

/**
 * ============================================================================
 *  QUIÉN PUEDE APROBAR COTIZACIONES
 * ============================================================================
 *  Oliver nombró a tres personas: «aprueba Gerente, Cathy Lee y Marco León».
 *  No un cargo: tres personas. Y una de ellas es Jefe Comercial y
 *  Exportaciones, o sea que la facultad cruza el organigrama.
 *
 *  Por eso se marca aquí, uno por uno, y no se deduce del rol. Cuando alguien
 *  deje el puesto, se le quita a esa persona y se le da a quien la reemplace,
 *  sin cambiarle el rol a nadie ni tocar el código.
 *
 *  EL AVISO NO ES DECORATIVO
 *  Dar esta facultad a alguien de Comercial significa que esa persona puede
 *  aprobar sus propias ofertas. Puede ser deliberado —es lo que pidió el
 *  cliente— pero quien lo marca debe saberlo en ese momento, no descubrirlo
 *  después revisando por qué se aprobó un descuento.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { alternarAprobador } from './acciones';

export function InterruptorAprobador({
  id,
  nombre,
  rol,
  aprueba,
  editable,
}: {
  id: string;
  nombre: string;
  rol: string;
  aprueba: boolean;
  editable: boolean;
}) {
  const [valor, setValor] = useState(aprueba);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  //  Quien vende y además aprueba se autoriza a sí mismo. Se avisa al marcar,
  //  no después.
  const seAutoAprueba = !valor && rol === 'comercial';

  function alternar() {
    setError(null);
    if (seAutoAprueba) {
      const seguro = window.confirm(
        `${nombre} es del área Comercial: si puede aprobar, podrá autorizar sus propias ` +
        `cotizaciones y el control deja de ser independiente.\n\n¿Continuar?`
      );
      if (!seguro) return;
    }
    iniciar(async () => {
      const r = await alternarAprobador(id, !valor);
      if (r.ok) setValor(!valor);
      else setError(r.mensaje);
    });
  }

  if (!editable) {
    return (
      <span style={{ fontSize: '.74rem', color: 'var(--tinta-3)' }}>
        {valor ? 'Sí' : '—'}
      </span>
    );
  }

  return (
    <>
      <label className="aprobador">
        <input
          type="checkbox"
          checked={valor}
          disabled={pendiente}
          onChange={alternar}
        />
        <span>{valor ? 'Aprueba' : 'No aprueba'}</span>
      </label>
      {error && (
        <p style={{ margin: '.2rem 0 0', fontSize: '.7rem', color: 'var(--critico)' }}>{error}</p>
      )}
      <style jsx>{`
        .aprobador { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.74rem; cursor: pointer; }
        .aprobador input { cursor: pointer; }
      `}</style>
    </>
  );
}
