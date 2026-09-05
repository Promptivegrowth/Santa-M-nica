'use client';

/**
 * ============================================================================
 *  COPIAR LOS COSTOS DEL MES ANTERIOR
 * ============================================================================
 *  El botón que hace sostenible esta pantalla. Son 191 productos por tres
 *  campos: 573 números cada mes. Nadie sostiene eso, y un sistema que lo exige
 *  acaba con los costos sin cargar y el margen sin calcular.
 *
 *  Copia SOLO lo que falta: nunca pisa un valor ya escrito, porque quien lo
 *  escribió a mano lo hizo con un motivo.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icono } from '@/components/estructura/Icono';
import { copiarMesAnterior } from './acciones';

export function CopiarMes({
  anio,
  mes,
  faltan,
}: {
  anio: number;
  mes: number;
  /** Cuántos productos siguen sin costo este mes. */
  faltan: number;
}) {
  const router = useRouter();
  const [copiando, iniciar] = useTransition();
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  if (faltan === 0) return null;

  return (
    <div className="costos-copiar">
      <div>
        <strong>{faltan} producto{faltan === 1 ? '' : 's'} sin costo este mes</strong>
        <span>
          Sus pedidos se están midiendo con el último costo anterior que haya cargado. Puede
          copiar el mes pasado y ajustar solo lo que se movió.
        </span>
      </div>

      <button type="button" className="btn btn-secundario btn-chico" disabled={copiando}
              onClick={() => iniciar(async () => {
                const r = await copiarMesAnterior(anio, mes);
                setAviso({ ok: r.ok, texto: r.mensaje });
                if (r.ok) router.refresh();
              })}>
        <Icono nombre="reportes" tamano={14} />
        {copiando ? 'Copiando…' : 'Copiar del mes anterior'}
      </button>

      {aviso && (
        <p className={`ficha-aviso ${aviso.ok ? 'ficha-aviso-ok' : 'ficha-aviso-critico'}`}
           role="status">
          {aviso.texto}
        </p>
      )}
    </div>
  );
}
