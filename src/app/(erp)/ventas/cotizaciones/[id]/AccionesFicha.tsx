'use client';

/**
 * ============================================================================
 *  BOTONERA DE LA FICHA DE COTIZACIÓN
 * ============================================================================
 *  Es la misma lógica que las acciones del listado, pero con botones grandes y
 *  con texto: aquí el usuario ya abrió el documento y va a decidir sobre él,
 *  así que las opciones se nombran en vez de esconderse tras un icono.
 *
 *  Cuando una acción no está permitida NO se oculta: se deshabilita y se
 *  explica por qué en el texto de ayuda. Un botón que desaparece deja al
 *  usuario preguntándose qué hizo mal.
 * ============================================================================
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  convertirEnPedido, eliminarCotizacion, cambiarEstadoCotizacion, aprobarCotizacion,
} from '../acciones';
import { Icono } from '@/components/estructura/Icono';

export function AccionesFicha({
  cotizacionId,
  numero,
  estado,
  yaConvertida,
  aprobada,
  requiereAprobacion,
  puedeAprobar,
}: {
  cotizacionId: number;
  numero: string;
  estado: string;
  yaConvertida: boolean;
  /** ¿Ya tiene la firma de Gerencia? */
  aprobada: boolean;
  /** ¿La empresa exige esa firma? Se configura, no está en el código. */
  requiereAprobacion: boolean;
  /** ¿El usuario que está mirando puede darla? */
  puedeAprobar: boolean;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const editable = !yaConvertida && ['borrador', 'aprobada', 'enviada'].includes(estado);
  const convertible = !yaConvertida && !['rechazada', 'vencida'].includes(estado);

  /*
   * Una oferta solo sale al cliente si lleva la firma —cuando la empresa la
   * exige—. El botón no se esconde: se deshabilita y dice por qué. Un botón
   * que desaparece deja al usuario preguntándose qué hizo mal.
   */
  const puedeEnviar = !requiereAprobacion || aprobada;

  function accion(fn: () => Promise<{ ok: boolean; mensaje?: string; id?: number }>, alPedido = false) {
    setError(null);
    iniciar(async () => {
      const r = await fn();
      if (r.ok) {
        if (alPedido && r.id) router.push(`/ventas/pedidos/${r.id}`);
        else router.refresh();
      } else {
        setError(r.mensaje ?? 'No se pudo completar la acción.');
      }
      setConfirmando(false);
    });
  }

  /**
   * El borrado va aparte porque su final es distinto: la ficha que se está
   * mirando deja de existir. Si aquí hiciéramos router.refresh() el usuario
   * se quedaría delante de un 404. Se vuelve al listado, que es donde tiene
   * sentido continuar trabajando.
   */
  function borrar() {
    setError(null);
    iniciar(async () => {
      const r = await eliminarCotizacion(cotizacionId);
      if (r.ok) router.push('/ventas/cotizaciones?borrada=' + encodeURIComponent(numero));
      else { setError(r.mensaje); setConfirmando(false); }
    });
  }

  return (
    <div className="ficha-botonera">
      {/* --- Aprobar: la firma que autoriza el precio --- */}
      {estado === 'borrador' && requiereAprobacion && (
        <button
          type="button"
          className="btn btn-primario"
          disabled={pendiente || !puedeAprobar}
          title={puedeAprobar
            ? 'Autoriza el precio para que la oferta pueda salir al cliente'
            : 'Solo Gerencia puede aprobar una cotización'}
          onClick={() => accion(() => aprobarCotizacion(cotizacionId))}
        >
          <Icono nombre="guardar" tamano={15} />
          {pendiente ? 'Aprobando…' : 'Aprobar'}
        </button>
      )}

      {/* --- Marcar como enviada: solo con la firma puesta --- */}
      {['borrador', 'aprobada'].includes(estado) && (
        <button
          type="button"
          className="btn btn-secundario"
          disabled={pendiente || !puedeEnviar}
          title={puedeEnviar
            ? 'Registra que la oferta ya se le pasó al cliente'
            : `${numero} todavía no está aprobada: el precio no puede salir sin el visto bueno de Gerencia`}
          onClick={() => accion(() => cambiarEstadoCotizacion(cotizacionId, 'enviada'))}
        >
          <Icono nombre="reportes" tamano={15} />
          Marcar como enviada
        </button>
      )}

      {/* --- Rechazo: el cliente dijo que no --- */}
      {estado === 'enviada' && (
        <button
          type="button"
          className="btn btn-secundario"
          disabled={pendiente}
          onClick={() => accion(() => cambiarEstadoCotizacion(cotizacionId, 'rechazada'))}
        >
          <Icono nombre="cerrar" tamano={15} />
          Marcar rechazada
        </button>
      )}

      {editable ? (
        <Link href={`/ventas/cotizaciones/${cotizacionId}/editar`} className="btn btn-secundario">
          <Icono nombre="configuracion" tamano={15} />
          Editar
        </Link>
      ) : (
        <button
          type="button"
          className="btn btn-secundario"
          disabled
          title={
            yaConvertida
              ? 'Ya generó un pedido: los precios de una venta cerrada no se modifican'
              : `Una cotización ${estado} no se puede editar`
          }
        >
          <Icono nombre="configuracion" tamano={15} />
          Editar
        </button>
      )}

      {/* --- Eliminar, con confirmación en dos pasos --- */}
      {confirmando ? (
        <span className="accion-confirmar">
          <span>¿Eliminar {numero}?</span>
          <button
            type="button"
            className="btn btn-primario"
            style={{ padding: '.2rem .5rem', fontSize: '.75rem' }}
            disabled={pendiente}
            onClick={borrar}
          >
            {pendiente ? 'Eliminando…' : 'Sí, eliminar'}
          </button>
          <button
            type="button"
            className="btn btn-sutil"
            style={{ padding: '.2rem .5rem', fontSize: '.75rem' }}
            disabled={pendiente}
            onClick={() => setConfirmando(false)}
          >
            Cancelar
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="btn btn-peligro-borde"
          disabled={yaConvertida || pendiente}
          onClick={() => setConfirmando(true)}
          title={yaConvertida ? 'No se puede eliminar: ya generó un pedido' : `Eliminar ${numero}`}
        >
          <Icono nombre="papelera" tamano={15} />
          Eliminar
        </button>
      )}

      {/* --- La acción principal: cerrar la venta --- */}
      {convertible && (
        <button
          type="button"
          className="btn btn-primario"
          disabled={pendiente}
          onClick={() => accion(() => convertirEnPedido(cotizacionId), true)}
        >
          <Icono nombre="pedido" tamano={15} />
          {pendiente ? 'Convirtiendo…' : 'Convertir en pedido'}
        </button>
      )}

      {error && <span className="accion-error">{error}</span>}
    </div>
  );
}
