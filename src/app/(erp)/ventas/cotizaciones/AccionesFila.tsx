'use client';

/**
 * ============================================================================
 *  ACCIONES SOBRE UNA COTIZACIÓN
 * ============================================================================
 *  Cuatro cosas se pueden hacer desde el listado:
 *
 *   VER        siempre disponible
 *   EDITAR     solo mientras sea borrador o esté enviada, y no se haya
 *              convertido en pedido. Los precios de una venta cerrada no
 *              se cambian.
 *   CONVERTIR  cuando el cliente acepta. Crea el pedido heredando todo.
 *   ELIMINAR   solo si no generó pedido. Si lo generó, borrarla dejaría el
 *              pedido huérfano y rompería la trazabilidad del precio.
 *
 *  Las tres últimas se comprueban también en el servidor: lo que se oculta
 *  aquí es comodidad, no seguridad.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { convertirEnPedido, eliminarCotizacion } from './acciones';
import { Icono } from '@/components/estructura/Icono';

export function AccionesFila({
  cotizacionId,
  numero,
  estado,
  yaConvertida,
  puedeOperar,
}: {
  cotizacionId: number;
  numero: string;
  estado: string;
  yaConvertida: boolean;
  /**
   * Los roles de solo consulta (almacén, calidad, finanzas) también necesitan
   * abrir la ficha para saber qué se ofreció. Lo que no pueden es cambiarla:
   * a ellos se les muestra únicamente el botón de ver.
   */
  puedeOperar: boolean;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState<'convertir' | 'eliminar' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const editable = puedeOperar && !yaConvertida && ['borrador', 'enviada'].includes(estado);
  const convertible = puedeOperar && !yaConvertida && !['rechazada', 'vencida'].includes(estado);
  const borrable = puedeOperar && !yaConvertida;

  function convertir() {
    setError(null);
    iniciar(async () => {
      const r = await convertirEnPedido(cotizacionId);
      if (r.ok) router.push(`/ventas/pedidos/${r.id}`);
      else { setError(r.mensaje); setConfirmando(null); }
    });
  }

  function eliminar() {
    setError(null);
    iniciar(async () => {
      const r = await eliminarCotizacion(cotizacionId);
      if (r.ok) { setConfirmando(null); router.refresh(); }
      else { setError(r.mensaje); setConfirmando(null); }
    });
  }

  /* ---- Modo confirmación: ocupa el sitio de los botones ---- */
  if (confirmando) {
    const esBorrado = confirmando === 'eliminar';
    return (
      <div className="acciones-fila">
        <span className="accion-confirmar">
          <span>{esBorrado ? '¿Eliminar?' : '¿Convertir?'}</span>
          <button
            type="button"
            className="btn btn-primario"
            style={{ padding: '.15rem .45rem', fontSize: '.72rem' }}
            onClick={esBorrado ? eliminar : convertir}
            disabled={pendiente}
          >
            {pendiente ? '…' : 'Sí'}
          </button>
          <button
            type="button"
            className="btn btn-sutil"
            style={{ padding: '.15rem .4rem', fontSize: '.72rem' }}
            onClick={() => setConfirmando(null)}
            disabled={pendiente}
          >
            No
          </button>
        </span>
      </div>
    );
  }

  return (
    <>
      <div className="acciones-fila">
        <Link
          href={`/ventas/cotizaciones/${cotizacionId}`}
          className="accion-btn"
          title={`Ver el detalle de ${numero}`}
          aria-label={`Ver ${numero}`}
        >
          <Icono nombre="buscar" tamano={14} />
        </Link>

        {puedeOperar && (editable ? (
          <Link
            href={`/ventas/cotizaciones/${cotizacionId}/editar`}
            className="accion-btn"
            title={`Editar ${numero}`}
            aria-label={`Editar ${numero}`}
          >
            <Icono nombre="configuracion" tamano={14} />
          </Link>
        ) : (
          <button
            type="button"
            className="accion-btn"
            disabled
            title={
              yaConvertida
                ? 'No se puede editar: ya generó un pedido'
                : `Una cotización ${estado} no se puede editar`
            }
          >
            <Icono nombre="configuracion" tamano={14} />
          </button>
        ))}

        {puedeOperar && (convertible ? (
          <button
            type="button"
            className="accion-btn"
            onClick={() => setConfirmando('convertir')}
            title={`Convertir ${numero} en pedido`}
            aria-label={`Convertir ${numero} en pedido`}
          >
            <Icono nombre="pedido" tamano={14} />
          </button>
        ) : yaConvertida ? (
          <span className="pill pill-ok" title="Esta cotización ya generó un pedido">Pedido</span>
        ) : (
          <button type="button" className="accion-btn" disabled title={`Una cotización ${estado} no se convierte`}>
            <Icono nombre="pedido" tamano={14} />
          </button>
        ))}

        {puedeOperar && (
        <button
          type="button"
          className="accion-btn accion-btn-peligro"
          onClick={() => setConfirmando('eliminar')}
          disabled={!borrable}
          title={
            borrable
              ? `Eliminar ${numero}`
              : 'No se puede eliminar: ya generó un pedido'
          }
          aria-label={`Eliminar ${numero}`}
        >
          <Icono nombre="papelera" tamano={14} />
        </button>
        )}
      </div>

      {error && <span className="accion-error">{error}</span>}
    </>
  );
}
