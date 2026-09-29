'use client';

/**
 * ============================================================================
 *  CARGAR EL MES CON LOS COSTOS QUE RIGEN
 * ============================================================================
 *  El botón que hace sostenible la carga obligatoria de cada mes. Son 191
 *  productos por tres campos: 573 números cada mes. Nadie sostiene eso, y un
 *  sistema que lo exige acaba con los costos sin cargar y el margen sin
 *  calcular.
 *
 *  Registra como carga del mes el costo que rige hoy, solo para los productos
 *  que todavía no la tienen: nunca pisa un valor ya escrito. Después se ajusta
 *  lo que se movió.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icono } from '@/components/estructura/Icono';
import { cargarMesConVigentes } from './acciones';

export function CopiarMes({
  periodo,
  nombreMes,
  faltan,
  esMesActual,
}: {
  periodo: string;
  nombreMes: string;
  /** Cuántos productos siguen sin la carga de ese mes. */
  faltan: number;
  esMesActual: boolean;
}) {
  const router = useRouter();
  const [copiando, iniciar] = useTransition();
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  if (faltan === 0 && !aviso) return null;

  return (
    <div className="costos-copiar" data-bloque="cargar-mes">
      <div>
        <strong>
          {faltan} producto{faltan === 1 ? '' : 's'} sin la carga de {nombreMes}
        </strong>
        <span>
          {esMesActual
            ? 'La carga del mes es obligatoria. Mientras falte, sus ingresos se valorizan con el último costo que regía. '
            : 'Se puede dejar lista antes de que empiece el mes: regirá desde el día 1. '}
          Puede cargar todos con el costo que rige hoy y ajustar solo lo que se movió.
        </span>
      </div>

      {faltan > 0 && (
        <button type="button" className="btn btn-secundario btn-chico" disabled={copiando}
                onClick={() => iniciar(async () => {
                  const r = await cargarMesConVigentes(periodo);
                  setAviso({ ok: r.ok, texto: r.mensaje });
                  if (r.ok) router.refresh();
                })}>
          <Icono nombre="reportes" tamano={14} />
          {copiando ? 'Cargando…' : 'Cargar con los costos vigentes'}
        </button>
      )}

      {aviso && (
        <p className={`ficha-aviso ${aviso.ok ? 'ficha-aviso-ok' : 'ficha-aviso-critico'}`}
           role="status">
          {aviso.texto}
        </p>
      )}
    </div>
  );
}
